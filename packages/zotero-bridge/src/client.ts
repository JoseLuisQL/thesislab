// zotero-bridge/src/client.ts — Real Zotero Web API v3 HTTP client

import type {
  ZoteroLibraryPayload,
  ZoteroCollectionPayload,
  ZoteroItemPayload,
  ZoteroConnectorMode,
} from './index.js';

export type ZoteroClientConfig = {
  apiKey: string;
  userId: string;
  mode: ZoteroConnectorMode;
  baseUrl?: string;
  timeoutMs?: number;
};

type ZoteroApiLibrary = {
  id: number;
  type: string;
  name: string;
  links: Record<string, unknown>;
  meta: { numItems?: number; numCollections?: number };
};

type ZoteroApiCollection = {
  key: string;
  version: number;
  data: {
    key: string;
    name: string;
    parentCollection: string | false;
  };
  meta: { numItems?: number; numCollections?: number };
};

type ZoteroApiItem = {
  key: string;
  version: number;
  data: {
    key: string;
    itemType: string;
    title: string;
    creators?: Array<{ firstName?: string; lastName?: string; name?: string; creatorType: string }>;
    date?: string;
    collections?: string[];
  };
};

export class ZoteroHttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly mode: ZoteroConnectorMode;
  private readonly userId: string;

  constructor(config: ZoteroClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.zotero.org';
    this.userId = config.userId;
    this.mode = config.mode;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.headers = {
      'Zotero-API-Version': '3',
      'Zotero-API-Key': config.apiKey,
      'Accept': 'application/json',
    };
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ZoteroApiError(
          `Zotero API error: ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listLibraries(): Promise<ZoteroLibraryPayload[]> {
    const now = new Date().toISOString();

    // Zotero API returns groups the user belongs to
    const groups = await this.request<Array<{
      id: number;
      data: { id: number; name: string; type: string };
      meta: { numItems?: number };
    }>>(`/users/${this.userId}/groups`);

    const libraries: ZoteroLibraryPayload[] = [
      // User's own library
      {
        id: `user-${this.userId}`,
        key: `user-${this.userId}`,
        mode: this.mode,
        externalId: this.userId,
        name: 'My Library',
        kind: 'user',
        itemCount: 0, // Will be populated on item fetch
        collectionCount: 0,
        createdAt: now,
        updatedAt: now,
      },
      // Group libraries
      ...groups.map((g): ZoteroLibraryPayload => ({
        id: `group-${g.id}`,
        key: `group-${g.id}`,
        mode: this.mode,
        externalId: String(g.id),
        name: g.data.name,
        kind: 'group',
        itemCount: g.meta?.numItems ?? 0,
        collectionCount: 0,
        createdAt: now,
        updatedAt: now,
      })),
    ];

    return libraries;
  }

  async listCollections(filter: { libraryKey?: string | null } = {}): Promise<ZoteroCollectionPayload[]> {
    const now = new Date().toISOString();
    const prefix = this.resolveLibraryPrefix(filter.libraryKey);
    const raw = await this.request<ZoteroApiCollection[]>(`${prefix}/collections?limit=100`);

    // Build parent-child path map
    const pathMap = new Map<string, string[]>();
    const buildPath = (key: string): string[] => {
      if (pathMap.has(key)) return pathMap.get(key)!;
      const col = raw.find((c) => c.key === key);
      if (!col) return [];
      const parent = col.data.parentCollection;
      const parentPath = parent ? buildPath(parent) : [];
      const path = [...parentPath, col.data.name];
      pathMap.set(key, path);
      return path;
    };

    return raw.map((col): ZoteroCollectionPayload => {
      const path = buildPath(col.key);
      return {
        id: col.key,
        key: col.key,
        mode: this.mode,
        externalId: col.key,
        libraryId: filter.libraryKey ?? `user-${this.userId}`,
        libraryKey: filter.libraryKey ?? `user-${this.userId}`,
        parentCollectionKey: col.data.parentCollection || null,
        name: col.data.name,
        path,
        itemCount: col.meta?.numItems ?? 0,
        createdAt: now,
        updatedAt: now,
      };
    }).sort((a, b) => a.path.join(' / ').localeCompare(b.path.join(' / ')));
  }

  async listItems(filter: { libraryKey?: string | null; collectionKey?: string | null } = {}): Promise<ZoteroItemPayload[]> {
    const now = new Date().toISOString();
    const prefix = this.resolveLibraryPrefix(filter.libraryKey);
    const path = filter.collectionKey
      ? `${prefix}/collections/${filter.collectionKey}/items?limit=100&itemType=-attachment`
      : `${prefix}/items?limit=100&itemType=-attachment`;

    const raw = await this.request<ZoteroApiItem[]>(path);
    return this.mapItems(raw, filter.libraryKey, now);
  }

  async searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> {
    const now = new Date().toISOString();
    const prefix = this.resolveLibraryPrefix(filter.libraryKey);
    const q = encodeURIComponent(filter.query);
    const path = filter.collectionKey
      ? `${prefix}/collections/${filter.collectionKey}/items?q=${q}&limit=50&itemType=-attachment`
      : `${prefix}/items?q=${q}&limit=50&itemType=-attachment`;

    const raw = await this.request<ZoteroApiItem[]>(path);
    return this.mapItems(raw, filter.libraryKey, now);
  }

  private mapItems(raw: ZoteroApiItem[], libraryKey: string | null | undefined, now: string): ZoteroItemPayload[] {
    return raw.map((item): ZoteroItemPayload => ({
      id: item.key,
      key: item.key,
      mode: this.mode,
      externalId: item.key,
      libraryId: libraryKey ?? `user-${this.userId}`,
      libraryKey: libraryKey ?? `user-${this.userId}`,
      collectionKeys: item.data.collections ?? [],
      itemType: item.data.itemType,
      title: item.data.title ?? 'Untitled',
      creators: (item.data.creators ?? []).map((c) =>
        c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' '),
      ),
      date: item.data.date ?? null,
      createdAt: now,
      updatedAt: now,
    })).sort((a, b) => a.title.localeCompare(b.title));
  }

  private resolveLibraryPrefix(libraryKey: string | null | undefined): string {
    if (!libraryKey || libraryKey.startsWith('user-')) {
      return `/users/${this.userId}`;
    }
    if (libraryKey.startsWith('group-')) {
      const groupId = libraryKey.replace('group-', '');
      return `/groups/${groupId}`;
    }
    return `/users/${this.userId}`;
  }
}

export class ZoteroApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ZoteroApiError';
  }
}
