import { type ZoteroCollectionPayload, type ZoteroItemPayload, type ZoteroLibraryPayload } from '@thesis-research-os/zotero-bridge';
export type CapabilityState = 'available' | 'degraded' | 'unavailable';
export type RuntimeCapabilityKey = 'openclaw' | 'playwright' | 'pandoc' | 'libreoffice' | 'latex' | 'ocr' | 'zotero' | 'crossref' | 'mcp';
export type RuntimeCapabilitySnapshot = {
    key: RuntimeCapabilityKey;
    state: CapabilityState;
    summary: string;
    detail: string;
};
export interface WorkspaceRuntime {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    exists(filePath: string): Promise<boolean>;
}
export interface BrowserRuntime {
    search(query: string): Promise<Array<{
        title: string;
        url: string;
        snippet: string;
    }>>;
    fetch(url: string): Promise<{
        title: string;
        text: string;
        html: string;
    }>;
}
export interface LatexToolchain {
    detect(): RuntimeCapabilitySnapshot;
}
export interface DocumentConverter {
    detectPandoc(): RuntimeCapabilitySnapshot;
    detectLibreOffice(): RuntimeCapabilitySnapshot;
}
export interface OcrEngine {
    detect(): RuntimeCapabilitySnapshot;
}
export interface NotificationRuntime {
    notify(message: string): Promise<void>;
}
export interface McpRuntimeClient {
    configured: boolean;
    callTool<T>(toolName: string, args: Record<string, unknown>): Promise<T>;
}
export interface ZoteroBridgeRuntime {
    mode: 'mcp' | 'connector';
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
    resolveMapping(filter: {
        libraryId: string;
        collectionKey?: string | null;
        itemKey?: string | null;
    }): Promise<{
        connectorStatus: 'ready' | 'degraded';
        normalizedData: {
            library: ZoteroLibraryPayload | null;
            collection: ZoteroCollectionPayload | null;
            item: ZoteroItemPayload | null;
            connectorMessage: string | null;
            connectorCode: string | null;
        };
    }>;
}
export interface AgentRuntime {
    configured: boolean;
    searchAcademic(query: string): Promise<Array<{
        title: string;
        url: string;
        snippet: string;
        source: string;
    }>>;
    fetchPage(url: string): Promise<{
        title: string;
        text: string;
        html: string;
    }>;
    extractSources(url: string): Promise<Array<{
        title: string;
        authors: string[];
        doi: string | null;
        url: string;
    }>>;
}
export type RuntimeEnvironmentReport = {
    capabilities: Record<RuntimeCapabilityKey, RuntimeCapabilitySnapshot>;
};
export declare function detectRuntimeEnvironment(): RuntimeEnvironmentReport;
export declare class LocalRuntimeAdapter implements WorkspaceRuntime, NotificationRuntime {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    exists(filePath: string): Promise<boolean>;
    notify(_message: string): Promise<undefined>;
}
export declare class OpenClawRuntimeAdapter extends LocalRuntimeAdapter {
    readonly configured: boolean;
}
export declare class HttpMcpRuntimeClient implements McpRuntimeClient {
    readonly configured: boolean;
    callTool<T>(toolName: string, args: Record<string, unknown>): Promise<T>;
}
export declare function createZoteroBridgeRuntime(): ZoteroBridgeRuntime;
export declare function createAgentRuntime(): AgentRuntime;
//# sourceMappingURL=index.d.ts.map