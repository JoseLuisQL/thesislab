// zotero-bridge/src/local-client.ts — Zotero Desktop Local API client
// Connects to Zotero running on the same machine via http://localhost:23119/api/
/**
 * Client that talks to the Zotero desktop app's local HTTP API.
 * No API key needed — uses `Zotero-Allowed-Request: 1` header.
 */
export class ZoteroLocalClient {
    baseUrl;
    timeout;
    modeLabel;
    constructor(config = {}) {
        this.baseUrl = (config.baseUrl ?? 'http://localhost:23119/api').replace(/\/$/, '');
        this.timeout = config.timeout ?? 8000;
        this.modeLabel = config.mode ?? 'local';
    }
    async request(path) {
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
            return (await res.json());
        }
        finally {
            clearTimeout(timer);
        }
    }
    async listLibraries() {
        const now = new Date().toISOString();
        try {
            // Get library info by fetching one item
            const items = await this.request('/users/0/items?limit=1');
            const lib = items[0]?.library;
            const collections = await this.request('/users/0/collections');
            const allItems = await this.request('/users/0/items?limit=0');
            const id = lib ? String(lib.id) : '0';
            const name = lib?.name ?? 'Mi biblioteca';
            const kind = (lib?.type === 'group' ? 'group' : 'user');
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
        }
        catch {
            return [{
                    id: '0', key: '0', mode: this.modeLabel, externalId: '0',
                    name: 'Mi biblioteca', kind: 'user',
                    itemCount: 0, collectionCount: 0,
                    createdAt: now, updatedAt: now,
                }];
        }
    }
    async listCollections(filter) {
        const now = new Date().toISOString();
        const path = filter?.libraryKey && filter.libraryKey !== '0'
            ? `/groups/${filter.libraryKey}/collections`
            : '/users/0/collections';
        const raw = await this.request(path);
        const libKey = filter?.libraryKey ?? '0';
        return raw.map((c) => ({
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
    async listItems(filter) {
        const now = new Date().toISOString();
        let path;
        if (filter?.collectionKey) {
            path = `/users/0/collections/${filter.collectionKey}/items?limit=100`;
        }
        else if (filter?.libraryKey && filter.libraryKey !== '0') {
            path = `/groups/${filter.libraryKey}/items?limit=100`;
        }
        else {
            path = '/users/0/items?limit=100';
        }
        const raw = await this.request(path);
        const libKey = filter?.libraryKey ?? '0';
        return raw
            .filter((item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note')
            .map((item) => this.mapItem(item, libKey, now));
    }
    async searchItems(filter) {
        const now = new Date().toISOString();
        let base;
        if (filter.collectionKey) {
            base = `/users/0/collections/${filter.collectionKey}/items`;
        }
        else if (filter.libraryKey && filter.libraryKey !== '0') {
            base = `/groups/${filter.libraryKey}/items`;
        }
        else {
            base = '/users/0/items';
        }
        const path = `${base}?q=${encodeURIComponent(filter.query)}&limit=50&qmode=everything`;
        const raw = await this.request(path);
        const libKey = filter.libraryKey ?? '0';
        return raw
            .filter((item) => item.data.itemType !== 'attachment' && item.data.itemType !== 'note')
            .map((item) => this.mapItem(item, libKey, now));
    }
    /** Check if Zotero is running and accessible */
    async ping() {
        try {
            await this.request('/users/0/items?limit=1');
            return true;
        }
        catch {
            return false;
        }
    }
    mapItem(item, libraryKey, timestamp) {
        const d = item.data;
        const creators = (d.creators ?? []).map((c) => {
            if (c.name)
                return c.name;
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
