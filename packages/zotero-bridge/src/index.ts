// zotero-bridge — Zotero connector types, mock dataset, and mapping operations
import { ZoteroLocalClient } from './local-client.js';
import { ZoteroHttpClient } from './client.js';

export type ZoteroConnectorMode = 'mock' | 'test' | 'live' | 'local';
export type ZoteroMappingScope = 'thesis' | 'chapter' | 'source';

export type ZoteroLibraryPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  name: string;
  kind: 'user' | 'group';
  itemCount: number;
  collectionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ZoteroCollectionPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  libraryId: string;
  libraryKey: string;
  parentCollectionKey: string | null;
  name: string;
  path: string[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ZoteroItemPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  libraryId: string;
  libraryKey: string;
  collectionKeys: string[];
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ZoteroMappingPayload = {
  id: string;
  thesisId: string;
  normalizedNodeId: string | null;
  sourceId: string | null;
  scope: ZoteroMappingScope;
  libraryId: string;
  collectionKey: string | null;
  itemKey: string | null;
  normalizedData: Record<string, unknown>;
  connectorStatus: string;
  degraded: {
    isDegraded: boolean;
    code: string | null;
    message: string | null;
  };
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateZoteroMappingInput = {
  scope: ZoteroMappingScope;
  normalizedNodeId?: string | null;
  libraryId: string;
  collectionKey?: string | null;
  itemKey?: string | null;
};

export type RefreshZoteroMappingInput = {
  libraryId?: string;
  collectionKey?: string | null;
  itemKey?: string | null;
};

export type ListZoteroItemsInput = {
  libraryKey?: string;
  collectionKey?: string;
};

// --- Mock Dataset ---

export type ZoteroMockLibraryRecord = {
  key: string;
  name: string;
  kind: 'user' | 'group';
  itemCount: number;
  collectionCount: number;
};

export type ZoteroMockCollectionRecord = {
  key: string;
  libraryKey: string;
  parentCollectionKey: string | null;
  name: string;
  path: string[];
  itemCount: number;
};

export type ZoteroMockItemRecord = {
  key: string;
  libraryKey: string;
  collectionKeys: string[];
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
};

export type ZoteroMockDataset = {
  libraries: ZoteroMockLibraryRecord[];
  collections: ZoteroMockCollectionRecord[];
  items: ZoteroMockItemRecord[];
};

export const DEFAULT_ZOTERO_CONNECTOR_MODE: ZoteroConnectorMode = 'mock';

export const DEFAULT_ZOTERO_DATASET: ZoteroMockDataset = {
  libraries: [
    {
      key: 'lib-user-main',
      name: 'Main Research Library',
      kind: 'user',
      itemCount: 3,
      collectionCount: 2,
    },
    {
      key: 'lib-group-thesis-lab',
      name: 'Thesis Lab Group Library',
      kind: 'group',
      itemCount: 1,
      collectionCount: 1,
    },
  ],
  collections: [
    {
      key: 'col-ml-core',
      libraryKey: 'lib-user-main',
      parentCollectionKey: null,
      name: 'Machine Learning Core',
      path: ['Machine Learning Core'],
      itemCount: 2,
    },
    {
      key: 'col-ml-methods',
      libraryKey: 'lib-user-main',
      parentCollectionKey: 'col-ml-core',
      name: 'Methods',
      path: ['Machine Learning Core', 'Methods'],
      itemCount: 1,
    },
    {
      key: 'col-group-bibliography',
      libraryKey: 'lib-group-thesis-lab',
      parentCollectionKey: null,
      name: 'Shared Bibliography',
      path: ['Shared Bibliography'],
      itemCount: 1,
    },
  ],
  items: [
    {
      key: 'item-traceability-2024',
      libraryKey: 'lib-user-main',
      collectionKeys: ['col-ml-core'],
      itemType: 'journalArticle',
      title: 'Traceable Evidence in AI Research',
      creators: ['Ada Lovelace', 'Grace Hopper'],
      date: '2024',
    },
    {
      key: 'item-methods-2023',
      libraryKey: 'lib-user-main',
      collectionKeys: ['col-ml-core', 'col-ml-methods'],
      itemType: 'book',
      title: 'Research Methods for Thesis Workflows',
      creators: ['Elena Method'],
      date: '2023',
    },
    {
      key: 'item-zotero-schema-2026',
      libraryKey: 'lib-user-main',
      collectionKeys: [],
      itemType: 'report',
      title: 'Stable Zotero Normalization Schema',
      creators: ['Schema Team'],
      date: '2026-02-01',
    },
    {
      key: 'item-group-citations-2022',
      libraryKey: 'lib-group-thesis-lab',
      collectionKeys: ['col-group-bibliography'],
      itemType: 'conferencePaper',
      title: 'Collaborative Citation Workflows',
      creators: ['María Citation'],
      date: '2022',
    },
  ],
};

// --- Errors ---

export class ZoteroMappingNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly mappingId: string) {
    super(`Zotero mapping ${mappingId} was not found for thesis ${thesisId}.`);
    this.name = 'ZoteroMappingNotFoundError';
  }
}

// --- Pure functions ---

export function resolveZoteroConnectorMode(): ZoteroConnectorMode {
  const envMode = (typeof process !== 'undefined' ? process.env?.ZOTERO_CONNECTOR_MODE : undefined)?.trim() || '';
  switch (envMode) {
    case 'mock':
    case 'test':
    case 'live':
    case 'local':
      return envMode;
    default:
      return DEFAULT_ZOTERO_CONNECTOR_MODE;
  }
}

// --- Client re-exports ---

export { ZoteroHttpClient, ZoteroApiError, type ZoteroClientConfig } from './client.js';
export { zoteroItemToBibtex, exportCollectionToBibtex } from './bibtex.js';
export { ZoteroLocalClient, type ZoteroLocalConfig } from './local-client.js';

// --- Connector factory ---

export type ZoteroConnector = {
  mode: ZoteroConnectorMode;
  listLibraries(): Promise<ZoteroLibraryPayload[]> | ZoteroLibraryPayload[];
  listCollections(filter?: { libraryKey?: string | null }): Promise<ZoteroCollectionPayload[]> | ZoteroCollectionPayload[];
  listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
  searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
};

export function createZoteroConnector(): ZoteroConnector {
  return createZoteroConnectorForMode(resolveZoteroConnectorMode());
}

export function resolveZoteroMcpConnectorMode(): ZoteroConnectorMode {
  const overrideMode = (typeof process !== 'undefined' ? process.env?.ZOTERO_MCP_CONNECTOR_MODE : undefined)?.trim() || '';
  switch (overrideMode) {
    case 'mock':
    case 'test':
    case 'live':
    case 'local':
      return overrideMode;
    default:
      if ((typeof process !== 'undefined' ? process.env?.ZOTERO_LOCAL_URL : undefined)?.trim()) {
        return 'local';
      }
      if ((typeof process !== 'undefined' ? process.env?.ZOTERO_API_KEY : undefined)?.trim()
        && (typeof process !== 'undefined' ? process.env?.ZOTERO_USER_ID : undefined)?.trim()) {
        return 'live';
      }
      return DEFAULT_ZOTERO_CONNECTOR_MODE;
  }
}

export function createMcpBridgeConnector(): ZoteroConnector {
  return createZoteroConnectorForMode(resolveZoteroMcpConnectorMode());
}

export function createZoteroConnectorForMode(mode: ZoteroConnectorMode): ZoteroConnector {
  const apiKey = (typeof process !== 'undefined' ? process.env?.ZOTERO_API_KEY : undefined)?.trim();
  const userId = (typeof process !== 'undefined' ? process.env?.ZOTERO_USER_ID : undefined)?.trim();

  // Local mode: connect to desktop Zotero at localhost:23119
  if (mode === 'local') {
    const localUrl = (typeof process !== 'undefined' ? process.env?.ZOTERO_LOCAL_URL : undefined)?.trim();
    const client = new ZoteroLocalClient({ baseUrl: localUrl, mode });
    return {
      mode,
      listLibraries: () => client.listLibraries(),
      listCollections: (filter) => client.listCollections(filter),
      listItems: (filter) => client.listItems(filter),
      searchItems: (filter) => client.searchItems(filter),
    };
  }

  if (mode === 'live' && apiKey && userId) {
    const client = new ZoteroHttpClient({ apiKey, userId, mode });
    return {
      mode,
      listLibraries: () => client.listLibraries(),
      listCollections: (filter) => client.listCollections(filter),
      listItems: (filter) => client.listItems(filter),
      searchItems: (filter) => client.searchItems(filter),
    };
  }

  // Fallback to mock connector
  return createMockConnector(mode);
}

function createMockConnector(mode: ZoteroConnectorMode): ZoteroConnector {
  const dataset = DEFAULT_ZOTERO_DATASET;
  const timestamp = new Date().toISOString();

  return {
    mode,
    listLibraries: () =>
      dataset.libraries
        .map((r): ZoteroLibraryPayload => ({
          id: r.key, key: r.key, mode, externalId: r.key, name: r.name, kind: r.kind,
          itemCount: r.itemCount, collectionCount: r.collectionCount, createdAt: timestamp, updatedAt: timestamp,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),

    listCollections: (filter) =>
      dataset.collections
        .filter((c) => !filter?.libraryKey || c.libraryKey === filter.libraryKey)
        .map((c): ZoteroCollectionPayload => ({
          id: c.key, key: c.key, mode, externalId: c.key, libraryId: c.libraryKey, libraryKey: c.libraryKey,
          parentCollectionKey: c.parentCollectionKey, name: c.name, path: [...c.path],
          itemCount: c.itemCount, createdAt: timestamp, updatedAt: timestamp,
        }))
        .sort((a, b) => a.path.join(' / ').localeCompare(b.path.join(' / '))),

    listItems: (filter) =>
      dataset.items
        .filter((i) => (!filter?.libraryKey || i.libraryKey === filter.libraryKey) && (!filter?.collectionKey || i.collectionKeys.includes(filter.collectionKey)))
        .map((i): ZoteroItemPayload => ({
          id: i.key, key: i.key, mode, externalId: i.key, libraryId: i.libraryKey, libraryKey: i.libraryKey,
          collectionKeys: [...i.collectionKeys], itemType: i.itemType, title: i.title,
          creators: [...i.creators], date: i.date, createdAt: timestamp, updatedAt: timestamp,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),

    searchItems: (filter) =>
      dataset.items
        .filter((i) => (!filter.libraryKey || i.libraryKey === filter.libraryKey) && (!filter.collectionKey || i.collectionKeys.includes(filter.collectionKey)))
        .filter((i) => {
          const q = filter.query.trim().toLowerCase();
          if (!q) return true;
          return [i.title, i.itemType, i.date ?? '', ...i.creators].join(' ').toLowerCase().includes(q);
        })
        .map((i): ZoteroItemPayload => ({
          id: i.key, key: i.key, mode, externalId: i.key, libraryId: i.libraryKey, libraryKey: i.libraryKey,
          collectionKeys: [...i.collectionKeys], itemType: i.itemType, title: i.title,
          creators: [...i.creators], date: i.date, createdAt: timestamp, updatedAt: timestamp,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
