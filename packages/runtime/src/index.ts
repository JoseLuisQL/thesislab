import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildOpenClawSessionKey,
  callOpenClawAgentTurn,
  probeOpenClawGatewaySync,
  readOpenClawGatewayStatus,
  type OpenClawGatewayStatus,
} from './openclaw.js';

export type CapabilityState = 'available' | 'degraded' | 'unavailable';
export type RuntimeCapabilityKey =
  | 'openclaw'
  | 'playwright'
  | 'pandoc'
  | 'libreoffice'
  | 'latex'
  | 'ocr'
  | 'zotero'
  | 'crossref'
  | 'mcp';

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
  search(query: string): Promise<Array<{ title: string; url: string; snippet: string }>>;
  fetch(url: string): Promise<{ title: string; text: string; html: string }>;
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

export type ZoteroConnectorMode = 'mock' | 'test' | 'live' | 'local';

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

export interface ZoteroBridgeRuntime {
  mode: 'mcp' | 'connector';
  listLibraries(): Promise<ZoteroLibraryPayload[]>;
  listCollections(filter?: { libraryKey?: string | null }): Promise<ZoteroCollectionPayload[]>;
  listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]>;
  searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]>;
  resolveMapping(filter: { libraryId: string; collectionKey?: string | null; itemKey?: string | null }): Promise<{
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
  searchAcademic(query: string, target?: AgentTarget | null): Promise<Array<{ title: string; url: string; snippet: string; source: string }>>;
  fetchPage(url: string, target?: AgentTarget | null): Promise<{ title: string; text: string; html: string }>;
  extractSources(url: string, target?: AgentTarget | null): Promise<Array<{ title: string; authors: string[]; doi: string | null; url: string }>>;
}

export type RuntimeEnvironmentReport = {
  capabilities: Record<RuntimeCapabilityKey, RuntimeCapabilitySnapshot>;
};

export type AgentTarget = {
  agentId?: string | null;
  sessionKey?: string | null;
};

type DirectZoteroConnector = {
  listLibraries(): Promise<ZoteroLibraryPayload[]> | ZoteroLibraryPayload[];
  listCollections(filter?: { libraryKey?: string | null }): Promise<ZoteroCollectionPayload[]> | ZoteroCollectionPayload[];
  listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
  searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): Promise<ZoteroItemPayload[]> | ZoteroItemPayload[];
};

type ZoteroBridgeModule = {
  createZoteroConnector(): DirectZoteroConnector;
  createMcpBridgeConnector?: () => DirectZoteroConnector;
};

const LATEX_BINARIES = ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber'];
const OCR_BINARIES = ['tesseract'];
const WINDOWS_COMMAND_RESOLVERS = ['where.exe', 'where'];

function commandExists(command: string) {
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

function hasWorkspacePackage(packageName: string) {
  const packageJsonPath = path.resolve(process.cwd(), 'node_modules', packageName, 'package.json');
  return fs.existsSync(packageJsonPath);
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function loadZoteroBridgeConnector(mode: 'connector' | 'mcp'): Promise<DirectZoteroConnector> {
  const module = await import('@thesis-research-os/zotero-bridge') as ZoteroBridgeModule;
  if (mode === 'mcp' && typeof module.createMcpBridgeConnector === 'function') {
    return module.createMcpBridgeConnector();
  }

  return module.createZoteroConnector();
}

export function detectRuntimeEnvironment(): RuntimeEnvironmentReport {
  const openClawStatus = probeOpenClawGatewaySync();
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

  const zoteroCapability: RuntimeCapabilitySnapshot = zoteroMode === 'mcp' && mcpBridgeUrl
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
        state: !openClawStatus.installed
          ? 'unavailable'
          : openClawStatus.gatewayReachable
            ? 'available'
            : 'degraded',
        summary: !openClawStatus.installed
          ? 'OpenClaw CLI not installed'
          : openClawStatus.gatewayReachable
            ? `OpenClaw gateway reachable (${openClawStatus.defaultAgentId ?? 'default agent'})`
            : 'OpenClaw installed but gateway unreachable',
        detail: !openClawStatus.installed
          ? 'Install and configure OpenClaw to enable brain-driven agent routing.'
          : openClawStatus.gatewayReachable
            ? `Gateway ${openClawStatus.gatewayUrl ?? 'local'} is reachable and can execute bound agents.`
            : openClawStatus.issues.join(' ') || 'OpenClaw gateway is not currently reachable.',
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

export class LocalRuntimeAdapter implements WorkspaceRuntime, NotificationRuntime {
  async readFile(filePath: string) {
    return fs.promises.readFile(filePath, 'utf8');
  }

  async writeFile(filePath: string, content: string) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
  }

  async exists(filePath: string) {
    return fs.existsSync(filePath);
  }

  async notify(_message: string) {
    return undefined;
  }
}

export class OpenClawRuntimeAdapter extends LocalRuntimeAdapter {
  readonly configured = Boolean(process.env.OPENCLAW_BASE_URL?.trim() || process.env.OPENCLAW_API_KEY?.trim());
}

export class HttpMcpRuntimeClient implements McpRuntimeClient {
  readonly configured = Boolean(process.env.THESIS_MCP_BRIDGE_URL?.trim());

  async callTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const baseUrl = process.env.THESIS_MCP_BRIDGE_URL?.trim();
    if (!baseUrl) {
      throw new Error('THESIS_MCP_BRIDGE_URL is not configured.');
    }

    return fetchJson<T>(`${baseUrl.replace(/\/$/, '')}/mcp/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ toolName, args }),
    });
  }
}

class ConnectorZoteroBridgeRuntime implements ZoteroBridgeRuntime {
  readonly mode = 'connector' as const;

  private async getConnector() {
    return loadZoteroBridgeConnector('connector');
  }

  async listLibraries() {
    const connector = await this.getConnector();
    return Promise.resolve(connector.listLibraries());
  }

  async listCollections(filter?: { libraryKey?: string | null }) {
    const connector = await this.getConnector();
    return Promise.resolve(connector.listCollections(filter));
  }

  async listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }) {
    const connector = await this.getConnector();
    return Promise.resolve(connector.listItems(filter));
  }

  async searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }) {
    const connector = await this.getConnector();
    return Promise.resolve(connector.searchItems(filter));
  }

  async resolveMapping(filter: { libraryId: string; collectionKey?: string | null; itemKey?: string | null }) {
    const [libraries, collections, items] = await Promise.all([
      this.listLibraries(),
      this.listCollections({ libraryKey: filter.libraryId }),
      this.listItems({ libraryKey: filter.libraryId, collectionKey: null }),
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
    ].filter((value): value is string => value !== null);

    return {
      connectorStatus: missing.length === 0 ? 'ready' as const : 'degraded' as const,
      normalizedData: {
        library,
        collection: collection ?? null,
        item: item ?? null,
        connectorMessage: missing.length === 0 ? null : `Zotero connector could not resolve ${missing.join(', ')} for the requested mapping refresh.`,
        connectorCode: missing.length === 0 ? null : 'ZOTERO_CONNECTOR_RESOLUTION_FAILED',
      },
    };
  }
}

class McpZoteroBridgeRuntime implements ZoteroBridgeRuntime {
  readonly mode = 'mcp' as const;
  constructor(private readonly client: McpRuntimeClient) {}

  async listLibraries() {
    const payload = await this.client.callTool<{ libraries: ZoteroLibraryPayload[] }>('zotero.list_libraries', {});
    return payload.libraries;
  }

  async listCollections(filter?: { libraryKey?: string | null }) {
    const payload = await this.client.callTool<{ collections: ZoteroCollectionPayload[] }>('zotero.list_collections', filter ?? {});
    return payload.collections;
  }

  async listItems(filter?: { libraryKey?: string | null; collectionKey?: string | null }) {
    const payload = await this.client.callTool<{ items: ZoteroItemPayload[] }>('zotero.list_items', filter ?? {});
    return payload.items;
  }

  async searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }) {
    const payload = await this.client.callTool<{ items: ZoteroItemPayload[] }>('zotero.search_items', filter);
    return payload.items;
  }

  async resolveMapping(filter: { libraryId: string; collectionKey?: string | null; itemKey?: string | null }) {
    return this.client.callTool<{
      connectorStatus: 'ready' | 'degraded';
      normalizedData: {
        library: ZoteroLibraryPayload | null;
        collection: ZoteroCollectionPayload | null;
        item: ZoteroItemPayload | null;
        connectorMessage: string | null;
        connectorCode: string | null;
      };
    }>('zotero.resolve_mapping', filter);
  }
}

export function createZoteroBridgeRuntime(): ZoteroBridgeRuntime {
  const mode = process.env.ZOTERO_CONNECTOR_MODE?.trim();
  const mcpClient = new HttpMcpRuntimeClient();

  if (mode === 'mcp' && mcpClient.configured) {
    return new McpZoteroBridgeRuntime(mcpClient);
  }

  return new ConnectorZoteroBridgeRuntime();
}

class LocalAgentRuntime implements AgentRuntime {
  readonly configured = true;

  async searchAcademic(query: string, _target?: AgentTarget | null) {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query.bibliographic', query);
    url.searchParams.set('rows', '10');

    const payload = await fetchJson<{
      message?: {
        items?: Array<{
          title?: string[];
          DOI?: string;
          URL?: string;
          type?: string;
          'container-title'?: string[];
        }>;
      };
    }>(url.toString(), {
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

  async fetchPage(url: string, _target?: AgentTarget | null) {
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

  async extractSources(url: string, target?: AgentTarget | null): Promise<Array<{ title: string; authors: string[]; doi: string | null; url: string }>> {
    const page = await this.fetchPage(url, target);
    const dois = Array.from(new Set(Array.from(`${page.html}\n${page.text}`.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi)).map((match) => match[0])));
    return dois.map((doi) => ({
      title: page.title,
      authors: [],
      doi,
      url: `https://doi.org/${doi}`,
    }));
  }
}

class GatewayOpenClawAgentRuntime implements AgentRuntime {
  private readonly localFallback = new LocalAgentRuntime();
  private readonly status = probeOpenClawGatewaySync();
  readonly configured = this.status.installed && this.status.gatewayReachable;

  async searchAcademic(query: string, target?: AgentTarget | null) {
    try {
      const result = await callOpenClawAgentTurn({
        message: [
          'Search for academic sources and return JSON only.',
          'Return an object with a "results" array.',
          'Each result must include: title, url, snippet, source.',
          `Query: ${query}`,
        ].join('\n'),
        agentId: target?.agentId ?? null,
        sessionKey: target?.sessionKey ?? (target?.agentId ? buildOpenClawSessionKey(target.agentId) : null),
        thinking: 'high',
      });
      const parsed = JSON.parse(result.text) as {
        results?: Array<{ title?: string; url?: string; snippet?: string; source?: string }>;
      };
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      return results
        .map((item) => ({
          title: typeof item.title === 'string' ? item.title : 'Untitled source',
          url: typeof item.url === 'string' ? item.url : '',
          snippet: typeof item.snippet === 'string' ? item.snippet : '',
          source: typeof item.source === 'string' ? item.source : 'openclaw',
        }))
        .filter((item) => item.url);
    } catch {
      return this.localFallback.searchAcademic(query, target);
    }
  }

  async fetchPage(url: string, target?: AgentTarget | null) {
    try {
      const result = await callOpenClawAgentTurn({
        message: [
          'Open the provided URL and return JSON only.',
          'Return an object with: title, text, html.',
          'If raw html is unavailable, return an empty string for html.',
          `URL: ${url}`,
        ].join('\n'),
        agentId: target?.agentId ?? null,
        sessionKey: target?.sessionKey ?? (target?.agentId ? buildOpenClawSessionKey(target.agentId) : null),
        thinking: 'medium',
      });
      const parsed = JSON.parse(result.text) as {
        title?: string;
        text?: string;
        html?: string;
      };
      if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
        throw new Error('OpenClaw returned no page text.');
      }
      return {
        title: typeof parsed.title === 'string' ? parsed.title : url,
        text: parsed.text,
        html: typeof parsed.html === 'string' ? parsed.html : '',
      };
    } catch {
      return this.localFallback.fetchPage(url, target);
    }
  }

  async extractSources(url: string, target?: AgentTarget | null): Promise<Array<{ title: string; authors: string[]; doi: string | null; url: string }>> {
    try {
      const result = await callOpenClawAgentTurn({
        message: [
          'Inspect the provided page and return JSON only.',
          'Return an object with a "sources" array.',
          'Each source must include: title, authors, doi, url.',
          `URL: ${url}`,
        ].join('\n'),
        agentId: target?.agentId ?? null,
        sessionKey: target?.sessionKey ?? (target?.agentId ? buildOpenClawSessionKey(target.agentId) : null),
        thinking: 'medium',
      });
      const parsed = JSON.parse(result.text) as {
        sources?: Array<{ title?: string; authors?: string[]; doi?: string | null; url?: string }>;
      };
      const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
      return sources
        .map((item) => ({
          title: typeof item.title === 'string' ? item.title : 'Untitled source',
          authors: Array.isArray(item.authors) ? item.authors.filter((author): author is string => typeof author === 'string') : [],
          doi: typeof item.doi === 'string' ? item.doi : null,
          url: typeof item.url === 'string' ? item.url : '',
        }))
        .filter((item) => item.url);
    } catch {
      return this.localFallback.extractSources(url, target);
    }
  }
}

class OpenClawAgentRuntime implements AgentRuntime {
  readonly configured = Boolean(process.env.OPENCLAW_BASE_URL?.trim() || process.env.OPENCLAW_API_KEY?.trim());

  private async runTask<T>(task: string, payload: Record<string, unknown>): Promise<T> {
    const baseUrl = process.env.OPENCLAW_BASE_URL?.trim();
    if (!baseUrl) {
      throw new Error('OPENCLAW_BASE_URL is not configured.');
    }

    return fetchJson<T>(`${baseUrl.replace(/\/$/, '')}/agents/run`, {
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

  searchAcademic(query: string, target?: AgentTarget | null) {
    return this.runTask<Array<{ title: string; url: string; snippet: string; source: string }>>('research.search', {
      query,
      ...(target?.agentId ? { agentId: target.agentId } : {}),
      ...(target?.sessionKey ? { sessionKey: target.sessionKey } : {}),
    });
  }

  fetchPage(url: string, target?: AgentTarget | null) {
    return this.runTask<{ title: string; text: string; html: string }>('research.fetch', {
      url,
      ...(target?.agentId ? { agentId: target.agentId } : {}),
      ...(target?.sessionKey ? { sessionKey: target.sessionKey } : {}),
    });
  }

  extractSources(url: string, target?: AgentTarget | null) {
    return this.runTask<Array<{ title: string; authors: string[]; doi: string | null; url: string }>>('research.extract_sources', {
      url,
      ...(target?.agentId ? { agentId: target.agentId } : {}),
      ...(target?.sessionKey ? { sessionKey: target.sessionKey } : {}),
    });
  }
}

export function createAgentRuntime(): AgentRuntime {
  const gateway = new GatewayOpenClawAgentRuntime();
  if (gateway.configured) {
    return gateway;
  }

  const openClaw = new OpenClawAgentRuntime();
  if (openClaw.configured) {
    return openClaw;
  }

  return new LocalAgentRuntime();
}

export {
  buildOpenClawSessionKey,
  callOpenClawAgentTurn,
  probeOpenClawGatewaySync,
  readOpenClawGatewayStatus,
  type OpenClawGatewayStatus,
};
