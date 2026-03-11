// zotero-bridge/src/local-client.ts — Zotero Desktop Local API client
// Connects to Zotero running on the same machine via http://localhost:23119/api/

import type {
  ZoteroLibraryPayload,
  ZoteroCollectionPayload,
  ZoteroItemPayload,
  ZoteroConnectorMode,
} from './index.js';

export type ZoteroLocalConfig = {
  /** Base URL for the local Zotero API (default: http://localhost:23119/api) */
  baseUrl?: string;
  /** Timeout in ms (default: 8000) */
  timeout?: number;
  /** Mode label for payloads (default: local) */
  mode?: ZoteroConnectorMode;
};

type ZoteroApiItem = {
  key: string;
  version: number;
  library: { type: string; id: number; name: string };
  data: {
    key: string;
    version: number;
    itemType: string;
    title?: string;
    creators?: Array<{ creatorType: string; firstName?: string; lastName?: string; name?: string }>;
    date?: string;
    DOI?: string;
    url?: string;
    abstractNote?: string;
    publicationTitle?: string;
    collections?: string[];
    [k: string]: unknown;
  };
};

type ZoteroApiCollection = {
  key: string;
  version: number;
  library: { type: string; id: number; name: string };
  data: {
    key: string;
    name: string;
    parentCollection: string | false;
    [k: string]: unknown;
  };
  meta?: { numItems?: number };
};

/**
 * Client that talks to the Zotero desktop app's local HTTP API.
 * No API key needed — uses `Zotero-Allowed-Request: 1` header.
 */
export class ZoteroLocalClient {
  private baseUrl: string;
  private timeout: number;
  private modeLabel: ZoteroConnectorMode;

  constructor(config: ZoteroLocalConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:23119/api').replace(/\/$/, '');
    this.timeout = config.timeout ?? 8000;
    this.modeLabel = config.mode ?? 'local' as ZoteroConnectorMode;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          'Zotero-API-Version': '3',
          'Zotero-Allowed-Request': '1',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Zotero local API ${res.status}: ${text || res.statusText}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async listLibraries(): Promise<ZoteroLibraryPayload[]> {
    const now = new Date().toISOString();
    try {
      // Get library info by fetching one item
      const items = await this.request<ZoteroApiItem[]>('/users/0/items?limit=1');
      const lib = items[0]?.library;
      const collections = await this.request<ZoteroApiCollection[]>('/users/0/collections');
      const allItems = await this.request<ZoteroApiItem[]>('/users/0/items?limit=0');

      const id = lib ? String(lib.id) : '0';
      const name = lib?.name ?? 'Mi biblioteca';
      const kind = (lib?.type === 'group' ? 'group' : 'user') as 'user' | 'group';

      return [{
        id,
        key: id,
        mode: this.modeLabel,
        externalId: id,
        name,
        kind,
        itemCount: allItems.length,
        collectionCount: collections.length,
        createdAt: now,
        updatedAt: now,
      }];
    } catch {
      return [{
        id: '0', key: '0', mode: this.modeLabel, externalId: '0',
        name: 'Mi biblioteca', kind: 'user',
        itemCount: 0, collectionCount: 0,
        createdAt: now, updatedAt: now,
      }];
    }
  }

  async listCollections(filter?: { libraryKey?: string | null }): Promise<ZoteroCollectionPayload[]> {
    const now = new Date().toISOString();
    const path = filter?.libraryKey && filter.libraryKey !== '0'
      ? `/groups/${filter.libraryKey}/collections`
      : '/users/0/collections';

    const raw = await this.request<ZoteroApiCollection[]>(path);
    const libKey = filter?.libraryKey ?? '0';

    return raw.map((c): ZoteroCollectionPayload => ({
      id: c.data.key,
      key: c.data.key,
      mode: this.modeLabel,
      externalId: c.data.key,
      libraryId: libKey,
      libraryKey: libKey,
      parentCollectionKey: c.data.parentCollection || null,
      name: c.data.name,
      path: [c.data.name],
      itemCount: c.meta?.numItems ?? 0,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> {
    const now = new Date().toISOString();
    let path: string;
    if (filter?.collectionKey) {
      path = `/users/0/collections/${filter.collectionKey}/items?limit=100`;
    } else if (filter?.libraryKey && filter.libraryKey !== '0') {
      path = `/groups/${filter.libraryKey}/items?limit=100`;
    } else {
      path = '/users/0/items?limit=100';
    }

    const raw = await this.request<ZoteroApiItem[]>(path);
    const libKey = filter?.libraryKey ?? '0';

    return raw
      .filter((item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note')
      .map((item) => this.mapItem(item, libKey, now));
  }

  async searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> {
    const now = new Date().toISOString();
    let base: string;
    if (filter.collectionKey) {
      base = `/users/0/collections/${filter.collectionKey}/items`;
    } else if (filter.libraryKey && filter.libraryKey !== '0') {
      base = `/groups/${filter.libraryKey}/items`;
    } else {
      base = '/users/0/items';
    }

    const path = `${base}?q=${encodeURIComponent(filter.query)}&limit=50&qmode=everything`;
    const raw = await this.request<ZoteroApiItem[]>(path);
    const libKey = filter.libraryKey ?? '0';

    return raw
      .filter((item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note')
      .map((item) => this.mapItem(item, libKey, now));
  }

  /** Check if Zotero is running and accessible */
  async ping(): Promise<boolean> {
    try {
      await this.request<unknown>('/users/0/items?limit=1');
      return true;
    } catch {
      return false;
    }
  }

  private mapItem(item: ZoteroApiItem, libraryKey: string, timestamp: string): ZoteroItemPayload {
    const d = item.data;
    const creators = (d.creators ?? []).map((c) => {
      if (c.name) return c.name;
      return [c.firstName, c.lastName].filter(Boolean).join(' ');
    });

    return {
      id: d.key,
      key: d.key,
      mode: this.modeLabel,
      externalId: d.key,
      libraryId: libraryKey,
      libraryKey,
      collectionKeys: d.collections ?? [],
      itemType: d.itemType,
      title: d.title ?? 'Untitled',
      creators,
      date: d.date ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
