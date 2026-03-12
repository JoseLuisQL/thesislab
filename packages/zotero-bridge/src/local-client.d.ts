import type { ZoteroLibraryPayload, ZoteroCollectionPayload, ZoteroItemPayload, ZoteroConnectorMode } from './index.js';
export type ZoteroLocalConfig = {
    /** Base URL for the local Zotero API (default: http://localhost:23119/api) */
    baseUrl?: string;
    /** Timeout in ms (default: 8000) */
    timeout?: number;
    /** Mode label for payloads (default: local) */
    mode?: ZoteroConnectorMode;
};
/**
 * Client that talks to the Zotero desktop app's local HTTP API.
 * No API key needed — uses `Zotero-Allowed-Request: 1` header.
 */
export declare class ZoteroLocalClient {
    private baseUrl;
    private timeout;
    private modeLabel;
    constructor(config?: ZoteroLocalConfig);
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
    /** Check if Zotero is running and accessible */
    ping(): Promise<boolean>;
    private mapItem;
}
