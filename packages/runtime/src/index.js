import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createZoteroConnector, } from '@thesis-research-os/zotero-bridge';
const LATEX_BINARIES = ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber'];
const OCR_BINARIES = ['tesseract'];
const WINDOWS_COMMAND_RESOLVERS = ['where.exe', 'where'];
function commandExists(command) {
    const resolvers = process.platform === 'win32' ? WINDOWS_COMMAND_RESOLVERS : ['which'];
    for (const resolver of resolvers) {
        const result = spawnSync(resolver, [command], {
            encoding: 'utf8',
            stdio: 'pipe',
            shell: false,
        });
        if (result.status === 0) {
            return true;
        }
    }
    return false;
}
function hasWorkspacePackage(packageName) {
    const packageJsonPath = path.resolve(process.cwd(), 'node_modules', packageName, 'package.json');
    return fs.existsSync(packageJsonPath);
}
async function fetchJson(input, init) {
    const response = await fetch(input, init);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.json();
}
export function detectRuntimeEnvironment() {
    const openClawConfigured = Boolean(process.env.OPENCLAW_BASE_URL?.trim() || process.env.OPENCLAW_API_KEY?.trim());
    const playwrightInstalled = hasWorkspacePackage('playwright') || hasWorkspacePackage('@playwright/test');
    const pandocAvailable = commandExists('pandoc');
    const libreOfficeAvailable = commandExists('soffice') || commandExists('libreoffice');
    const latexAvailable = LATEX_BINARIES.every((binary) => commandExists(binary));
    const ocrAvailable = OCR_BINARIES.some((binary) => commandExists(binary));
    const zoteroMode = process.env.ZOTERO_CONNECTOR_MODE?.trim() || 'mock';
    const zoteroApiKey = process.env.ZOTERO_API_KEY?.trim();
    const zoteroUserId = process.env.ZOTERO_USER_ID?.trim();
    const mcpBridgeUrl = process.env.THESIS_MCP_BRIDGE_URL?.trim();
    const zoteroConfigured = zoteroMode === 'local'
        || (zoteroMode === 'live' && Boolean(zoteroApiKey && zoteroUserId));
    const mcpInstalled = hasWorkspacePackage('@modelcontextprotocol/sdk');
    const zoteroCapability = zoteroMode === 'mcp' && mcpBridgeUrl
        ? {
            key: 'zotero',
            state: 'available',
            summary: 'Zotero bridge via MCP',
            detail: 'Zotero operations are routed through the configured MCP bridge.',
        }
        : zoteroMode === 'mcp'
            ? {
                key: 'zotero',
                state: 'degraded',
                summary: 'Zotero MCP bridge missing',
                detail: 'Set THESIS_MCP_BRIDGE_URL to route Zotero operations through MCP.',
            }
            : zoteroMode === 'local'
                ? {
                    key: 'zotero',
                    state: 'available',
                    summary: 'Connected to Zotero desktop',
                    detail: 'Zotero connector is using the local desktop API at localhost:23119. No API key needed.',
                }
                : zoteroMode === 'live' && zoteroConfigured
                    ? {
                        key: 'zotero',
                        state: 'available',
                        summary: 'Live connector active',
                        detail: 'Zotero connector is using the live Web API v3 with your API key.',
                    }
                    : zoteroMode === 'mock'
                        ? {
                            key: 'zotero',
                            state: 'degraded',
                            summary: 'Mock connector only',
                            detail: 'Zotero runs in mock mode, so local workflows remain usable while bibliography sync is explicitly degraded.',
                        }
                        : {
                            key: 'zotero',
                            state: 'degraded',
                            summary: 'Connector not fully attached',
                            detail: `Zotero connector mode "${zoteroMode}" is configured, but the connector-backed capability remains offline until its credentials are complete.`,
                        };
    return {
        capabilities: {
            openclaw: {
                key: 'openclaw',
                state: openClawConfigured ? 'available' : 'degraded',
                summary: openClawConfigured ? 'OpenClaw runtime configured' : 'OpenClaw runtime not configured',
                detail: openClawConfigured
                    ? 'OpenClaw environment variables are present and the runtime adapter can be enabled.'
                    : 'Local runtime remains active; OpenClaw can be enabled by wiring its endpoint and credentials.',
            },
            playwright: {
                key: 'playwright',
                state: playwrightInstalled ? 'available' : 'degraded',
                summary: playwrightInstalled ? 'Playwright fallback installed' : 'Playwright fallback missing',
                detail: playwrightInstalled
                    ? 'Browser fallback can run locally when OpenClaw browser control is unavailable.'
                    : 'Install Playwright to enable local browser fallback for research workflows.',
            },
            pandoc: {
                key: 'pandoc',
                state: pandocAvailable ? 'available' : 'degraded',
                summary: pandocAvailable ? 'Pandoc detected' : 'Pandoc not detected',
                detail: pandocAvailable
                    ? 'DOCX normalization can use native Pandoc.'
                    : 'DOCX imports will fall back to structural XML parsing until Pandoc is installed.',
            },
            libreoffice: {
                key: 'libreoffice',
                state: libreOfficeAvailable ? 'available' : 'degraded',
                summary: libreOfficeAvailable ? 'LibreOffice detected' : 'LibreOffice not detected',
                detail: libreOfficeAvailable
                    ? 'Fallback office document conversion is available.'
                    : 'LibreOffice headless fallback is unavailable on this machine.',
            },
            latex: {
                key: 'latex',
                state: latexAvailable ? 'available' : 'degraded',
                summary: latexAvailable ? 'Native LaTeX toolchain detected' : 'Native LaTeX toolchain incomplete',
                detail: latexAvailable
                    ? 'latexmk and bibliography binaries are available natively.'
                    : 'LaTeX builds will remain degraded until latexmk and bibliography binaries are installed.',
            },
            ocr: {
                key: 'ocr',
                state: ocrAvailable ? 'available' : 'degraded',
                summary: ocrAvailable ? 'OCR binary detected' : 'OCR binary not detected',
                detail: ocrAvailable
                    ? 'Scanned PDFs can use a native OCR toolchain.'
                    : 'Scanned PDF ingestion remains degraded until OCR support is installed.',
            },
            zotero: zoteroCapability,
            crossref: {
                key: 'crossref',
                state: 'available',
                summary: 'Crossref DOI resolution active',
                detail: 'Crossref public API is reachable without local binaries.',
            },
            mcp: {
                key: 'mcp',
                state: mcpInstalled ? 'available' : 'unavailable',
                summary: mcpInstalled ? 'MCP SDK installed' : 'MCP SDK not installed',
                detail: mcpInstalled
                    ? 'The MCP server package can expose Thesis Research OS tools.'
                    : 'Install the MCP SDK to enable the MCP bridge.',
            },
        },
    };
}
export class LocalRuntimeAdapter {
    async readFile(filePath) {
        return fs.promises.readFile(filePath, 'utf8');
    }
    async writeFile(filePath, content) {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
    async exists(filePath) {
        return fs.existsSync(filePath);
    }
    async notify(_message) {
        return undefined;
    }
}
export class OpenClawRuntimeAdapter extends LocalRuntimeAdapter {
    configured = Boolean(process.env.OPENCLAW_BASE_URL?.trim() || process.env.OPENCLAW_API_KEY?.trim());
}
export class HttpMcpRuntimeClient {
    configured = Boolean(process.env.THESIS_MCP_BRIDGE_URL?.trim());
    async callTool(toolName, args) {
        const baseUrl = process.env.THESIS_MCP_BRIDGE_URL?.trim();
        if (!baseUrl) {
            throw new Error('THESIS_MCP_BRIDGE_URL is not configured.');
        }
        return fetchJson(`${baseUrl.replace(/\/$/, '')}/mcp/tools/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ toolName, args }),
        });
    }
}
class ConnectorZoteroBridgeRuntime {
    mode = 'connector';
    connector = createZoteroConnector();
    listLibraries() {
        return Promise.resolve(this.connector.listLibraries());
    }
    listCollections(filter) {
        return Promise.resolve(this.connector.listCollections(filter));
    }
    listItems(filter) {
        return Promise.resolve(this.connector.listItems(filter));
    }
    searchItems(filter) {
        return Promise.resolve(this.connector.searchItems(filter));
    }
    async resolveMapping(filter) {
        const [libraries, collections, items] = await Promise.all([
            this.listLibraries(),
            this.listCollections({ libraryKey: filter.libraryId }),
            this.listItems({ libraryKey: filter.libraryId, collectionKey: filter.collectionKey ?? null }),
        ]);
        const library = libraries.find((entry) => entry.id === filter.libraryId || entry.key === filter.libraryId) ?? null;
        const collection = filter.collectionKey
            ? collections.find((entry) => entry.key === filter.collectionKey)
            : null;
        const item = filter.itemKey
            ? items.find((entry) => entry.key === filter.itemKey)
            : null;
        const missing = [
            library ? null : 'library',
            filter.collectionKey && !collection ? 'collection' : null,
            filter.itemKey && !item ? 'item' : null,
        ].filter((value) => value !== null);
        return {
            connectorStatus: missing.length === 0 ? 'ready' : 'degraded',
            normalizedData: {
                library,
                collection: collection ?? null,
                item: item ?? null,
                connectorMessage: missing.length === 0 ? null : `Zotero bridge could not resolve ${missing.join(', ')}.`,
                connectorCode: missing.length === 0 ? null : 'ZOTERO_CONNECTOR_RESOLUTION_FAILED',
            },
        };
    }
}
class McpZoteroBridgeRuntime {
    client;
    mode = 'mcp';
    constructor(client) {
        this.client = client;
    }
    async listLibraries() {
        const payload = await this.client.callTool('zotero.list_libraries', {});
        return payload.libraries;
    }
    async listCollections(filter) {
        const payload = await this.client.callTool('zotero.list_collections', filter ?? {});
        return payload.collections;
    }
    async listItems(filter) {
        const payload = await this.client.callTool('zotero.list_items', filter ?? {});
        return payload.items;
    }
    async searchItems(filter) {
        const payload = await this.client.callTool('zotero.search_items', filter);
        return payload.items;
    }
    async resolveMapping(filter) {
        return this.client.callTool('zotero.resolve_mapping', filter);
    }
}
export function createZoteroBridgeRuntime() {
    const mode = process.env.ZOTERO_CONNECTOR_MODE?.trim();
    const mcpClient = new HttpMcpRuntimeClient();
    if (mode === 'mcp' && mcpClient.configured) {
        return new McpZoteroBridgeRuntime(mcpClient);
    }
    return new ConnectorZoteroBridgeRuntime();
}
class LocalAgentRuntime {
    configured = true;
    async searchAcademic(query) {
        const url = new URL('https://api.crossref.org/works');
        url.searchParams.set('query.bibliographic', query);
        url.searchParams.set('rows', '10');
        const payload = await fetchJson(url.toString(), {
            headers: {
                'User-Agent': 'ThesisResearchOS/0.1 (local agent runtime)',
            },
        });
        return (payload.message?.items ?? []).map((item) => ({
            title: item.title?.[0] ?? 'Untitled source',
            url: item.DOI ? `https://doi.org/${item.DOI}` : item.URL ?? '',
            snippet: `${item['container-title']?.[0] ?? item.type ?? 'crossref'}${item.DOI ? ` · DOI ${item.DOI}` : ''}`,
            source: item['container-title']?.[0] ?? item.type ?? 'crossref',
        })).filter((item) => item.url);
    }
    async fetchPage(url) {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'ThesisResearchOS/0.1 (local agent runtime)',
            },
            redirect: 'follow',
        });
        if (!response.ok) {
            throw new Error(`Fetch failed with ${response.status}`);
        }
        const html = await response.text();
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return { title, text, html };
    }
    async extractSources(url) {
        const page = await this.fetchPage(url);
        const dois = Array.from(new Set(Array.from(`${page.html}\n${page.text}`.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi)).map((match) => match[0])));
        return dois.map((doi) => ({
            title: page.title,
            authors: [],
            doi,
            url: `https://doi.org/${doi}`,
        }));
    }
}
class OpenClawAgentRuntime {
    configured = Boolean(process.env.OPENCLAW_BASE_URL?.trim() || process.env.OPENCLAW_API_KEY?.trim());
    async runTask(task, payload) {
        const baseUrl = process.env.OPENCLAW_BASE_URL?.trim();
        if (!baseUrl) {
            throw new Error('OPENCLAW_BASE_URL is not configured.');
        }
        return fetchJson(`${baseUrl.replace(/\/$/, '')}/agents/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.OPENCLAW_API_KEY?.trim()
                    ? { Authorization: `Bearer ${process.env.OPENCLAW_API_KEY.trim()}` }
                    : {}),
            },
            body: JSON.stringify({ task, payload }),
        });
    }
    searchAcademic(query) {
        return this.runTask('research.search', { query });
    }
    fetchPage(url) {
        return this.runTask('research.fetch', { url });
    }
    extractSources(url) {
        return this.runTask('research.extract_sources', { url });
    }
}
export function createAgentRuntime() {
    const openClaw = new OpenClawAgentRuntime();
    if (openClaw.configured) {
        return openClaw;
    }
    return new LocalAgentRuntime();
}
