import type { ZoteroLibraryPayload, ZoteroCollectionPayload, ZoteroItemPayload, ZoteroConnectorMode } from './index.js';
export type ZoteroClientConfig = {
    apiKey: string;
    userId: string;
    mode: ZoteroConnectorMode;
    baseUrl?: string;
    timeoutMs?: number;
};
export declare class ZoteroHttpClient {
    private readonly baseUrl;
    private readonly headers;
    private readonly timeoutMs;
    private readonly mode;
    private readonly userId;
    constructor(config: ZoteroClientConfig);
    private request;
    listLibraries(): Promise<ZoteroLibraryPayload[]>;
    listCollections(filter?: {
        libraryKey?: string | null;
    }): Promise<ZoteroCollectionPayload[]>;
    listItems(filter?: {
        libraryKey?: string | null;
        collectionKey?: string | null;
    }): Promise<ZoteroItemPayload[]>;
    searchItems(filter: {
        query: string;
        libraryKey?: string | null;
        collectionKey?: string | null;
    }): Promise<ZoteroItemPayload[]>;
    private mapItems;
    private resolveLibraryPrefix;
}
export declare class ZoteroApiError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode: number);
}
