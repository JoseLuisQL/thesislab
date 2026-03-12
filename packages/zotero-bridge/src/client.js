// zotero-bridge/src/client.ts — Real Zotero Web API v3 HTTP client
export class ZoteroHttpClient {
    baseUrl;
    headers;
    timeoutMs;
    mode;
    userId;
    constructor(config) {
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
    async request(path) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(url, {
                headers: this.headers,
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new ZoteroApiError(`Zotero API error: ${response.status} ${response.statusText}`, response.status);
            }
            return (await response.json());
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listLibraries() {
        const now = new Date().toISOString();
        // Zotero API returns groups the user belongs to
        const groups = await this.request(`/users/${this.userId}/groups`);
        const libraries = [
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
            ...groups.map((g) => ({
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
    async listCollections(filter = {}) {
        const now = new Date().toISOString();
        const prefix = this.resolveLibraryPrefix(filter.libraryKey);
        const raw = await this.request(`${prefix}/collections?limit=100`);
        // Build parent-child path map
        const pathMap = new Map();
        const buildPath = (key) => {
            if (pathMap.has(key))
                return pathMap.get(key);
            const col = raw.find((c) => c.key === key);
            if (!col)
                return [];
            const parent = col.data.parentCollection;
            const parentPath = parent ? buildPath(parent) : [];
            const path = [...parentPath, col.data.name];
            pathMap.set(key, path);
            return path;
        };
        return raw.map((col) => {
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
    async listItems(filter = {}) {
        const now = new Date().toISOString();
        const prefix = this.resolveLibraryPrefix(filter.libraryKey);
        const path = filter.collectionKey
            ? `${prefix}/collections/${filter.collectionKey}/items?limit=100&itemType=-attachment`
            : `${prefix}/items?limit=100&itemType=-attachment`;
        const raw = await this.request(path);
        return this.mapItems(raw, filter.libraryKey, now);
    }
    async searchItems(filter) {
        const now = new Date().toISOString();
        const prefix = this.resolveLibraryPrefix(filter.libraryKey);
        const q = encodeURIComponent(filter.query);
        const path = filter.collectionKey
            ? `${prefix}/collections/${filter.collectionKey}/items?q=${q}&limit=50&itemType=-attachment`
            : `${prefix}/items?q=${q}&limit=50&itemType=-attachment`;
        const raw = await this.request(path);
        return this.mapItems(raw, filter.libraryKey, now);
    }
    mapItems(raw, libraryKey, now) {
        return raw.map((item) => ({
            id: item.key,
            key: item.key,
            mode: this.mode,
            externalId: item.key,
            libraryId: libraryKey ?? `user-${this.userId}`,
            libraryKey: libraryKey ?? `user-${this.userId}`,
            collectionKeys: item.data.collections ?? [],
            itemType: item.data.itemType,
            title: item.data.title ?? 'Untitled',
            creators: (item.data.creators ?? []).map((c) => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' ')),
            date: item.data.date ?? null,
            createdAt: now,
            updatedAt: now,
        })).sort((a, b) => a.title.localeCompare(b.title));
    }
    resolveLibraryPrefix(libraryKey) {
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
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ZoteroApiError';
    }
}
