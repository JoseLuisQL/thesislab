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
export declare const DEFAULT_ZOTERO_CONNECTOR_MODE: ZoteroConnectorMode;
export declare const DEFAULT_ZOTERO_DATASET: ZoteroMockDataset;
export declare class ZoteroMappingNotFoundError extends Error {
    readonly thesisId: string;
    readonly mappingId: string;
    constructor(thesisId: string, mappingId: string);
}
export declare function resolveZoteroConnectorMode(): ZoteroConnectorMode;
export { ZoteroHttpClient, ZoteroApiError, type ZoteroClientConfig } from './client.js';
export { zoteroItemToBibtex, exportCollectionToBibtex } from './bibtex.js';
export { ZoteroLocalClient, type ZoteroLocalConfig } from './local-client.js';
export type ZoteroConnector = {
    mode: ZoteroConnectorMode;
    listLibraries(): Promise<ZoteroLibraryPayload[]> | ZoteroLibraryPayload[];
    listCollections(filter?: {
        libraryKey?: string | null;
    }): Promise<ZoteroCollectionPayload[]> | ZoteroCollectionPayload[];
    listItems(filter?: {
        libraryKey?: string | null;
        collectionKey?: string | null;
    }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
    searchItems(filter: {
        query: string;
        libraryKey?: string | null;
        collectionKey?: string | null;
    }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
};
export declare function createZoteroConnector(): ZoteroConnector;
export declare function resolveZoteroMcpConnectorMode(): ZoteroConnectorMode;
export declare function createMcpBridgeConnector(): ZoteroConnector;
export declare function createZoteroConnectorForMode(mode: ZoteroConnectorMode): ZoteroConnector;
