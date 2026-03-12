#!/usr/bin/env node
// MCP Server for Thesis Research OS
// Exposes thesis operations as MCP tools and resources via stdio transport

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.THESIS_API_URL ?? 'http://localhost:3100';

// --- Helpers ---

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// --- Server setup ---

const server = new McpServer({
  name: 'thesis-research-os',
  version: '0.1.0',
});

// --- Tools ---

server.tool(
  'zotero.list_libraries',
  'List Zotero libraries through the MCP bridge contract',
  {},
  async () => {
    const data = await apiGet<{ libraries: unknown[] }>('/zotero/libraries');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ libraries: data.libraries }, null, 2),
      }],
    };
  },
);

server.tool(
  'zotero.list_collections',
  'List Zotero collections through the MCP bridge contract',
  {
    libraryKey: z.string().optional(),
  },
  async ({ libraryKey }) => {
    const suffix = libraryKey ? `?libraryKey=${encodeURIComponent(libraryKey)}` : '';
    const data = await apiGet<{ collections: unknown[] }>(`/zotero/collections${suffix}`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ collections: data.collections }, null, 2),
      }],
    };
  },
);

server.tool(
  'zotero.list_items',
  'List Zotero items through the MCP bridge contract',
  {
    libraryKey: z.string().optional(),
    collectionKey: z.string().optional(),
  },
  async ({ libraryKey, collectionKey }) => {
    const search = new URLSearchParams();
    if (libraryKey) search.set('libraryKey', libraryKey);
    if (collectionKey) search.set('collectionKey', collectionKey);
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    const data = await apiGet<{ items: unknown[] }>(`/zotero/items${suffix}`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ items: data.items }, null, 2),
      }],
    };
  },
);

server.tool(
  'zotero.search_items',
  'Search Zotero items through the MCP bridge contract',
  {
    query: z.string(),
    libraryKey: z.string().optional(),
    collectionKey: z.string().optional(),
  },
  async ({ query, libraryKey, collectionKey }) => {
    const search = new URLSearchParams({ q: query });
    if (libraryKey) search.set('libraryKey', libraryKey);
    if (collectionKey) search.set('collectionKey', collectionKey);
    const data = await apiGet<{ items: unknown[] }>(`/zotero/items/search?${search.toString()}`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ items: data.items }, null, 2),
      }],
    };
  },
);

server.tool(
  'zotero.resolve_mapping',
  'Resolve a Zotero mapping payload through the MCP bridge contract',
  {
    libraryId: z.string(),
    collectionKey: z.string().nullable().optional(),
    itemKey: z.string().nullable().optional(),
  },
  async ({ libraryId, collectionKey, itemKey }) => {
    const data = await apiPost<unknown>('/mcp/tools/call', {
      toolName: 'zotero.resolve_mapping',
      args: { libraryId, collectionKey: collectionKey ?? null, itemKey: itemKey ?? null },
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  },
);

server.tool(
  'list_theses',
  'List all thesis projects in the system',
  {},
  async () => {
    const data = await apiGet<{ theses: unknown[] }>('/theses');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.theses, null, 2),
      }],
    };
  },
);

server.tool(
  'get_thesis',
  'Get detailed information about a specific thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ thesis: unknown }>(`/theses/${thesisId}`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.thesis, null, 2),
      }],
    };
  },
);

server.tool(
  'resume_thesis',
  'Get the resume payload for a thesis — next action, latest checkpoint, recent feedback',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ resume: unknown }>(`/theses/${thesisId}/resume`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.resume, null, 2),
      }],
    };
  },
);

server.tool(
  'list_sources',
  'List all registered sources for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ sources: unknown[] }>(`/theses/${thesisId}/sources`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.sources, null, 2),
      }],
    };
  },
);

server.tool(
  'list_citations',
  'List all citations for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ citations: unknown[] }>(`/theses/${thesisId}/citations`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.citations, null, 2),
      }],
    };
  },
);

server.tool(
  'list_evidence',
  'List all evidence fragments for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ evidenceFragments: unknown[] }>(`/theses/${thesisId}/evidence-fragments`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.evidenceFragments, null, 2),
      }],
    };
  },
);

server.tool(
  'research_search',
  'Search academic sources using the configured research adapter',
  {
    thesisId: z.string().describe('UUID of the thesis'),
    query: z.string().describe('Academic search query'),
  },
  async ({ thesisId, query }) => {
    const data = await apiPost<{ results: unknown[] }>(`/theses/${thesisId}/research/search`, { query });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.results, null, 2),
      }],
    };
  },
);

server.tool(
  'research_fetch',
  'Fetch a research page and return extracted text/html metadata',
  {
    thesisId: z.string().describe('UUID of the thesis'),
    url: z.string().describe('URL to fetch'),
  },
  async ({ thesisId, url }) => {
    const data = await apiPost<{ page: unknown }>(`/theses/${thesisId}/research/fetch`, { url });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.page, null, 2),
      }],
    };
  },
);

server.tool(
  'sync_zotero_bibliography',
  'Write the Zotero-backed bibliography file for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiPost<{ sync: unknown }>(`/theses/${thesisId}/zotero/sync-bibliography`, {});
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.sync, null, 2),
      }],
    };
  },
);

server.tool(
  'create_evidence',
  'Create a new evidence fragment for a thesis source',
  {
    thesisId: z.string().describe('UUID of the thesis'),
    sourceId: z.string().describe('UUID of the source'),
    snippet: z.string().describe('The evidence text snippet'),
    extractionMethod: z.string().describe('How the evidence was extracted (e.g. manual, pdf-parse, web-scrape)'),
  },
  async ({ thesisId, sourceId, snippet, extractionMethod }) => {
    const data = await apiPost<{ evidenceFragment: unknown }>(`/theses/${thesisId}/evidence-fragments`, {
      sourceId,
      snippet,
      extractionMethod,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.evidenceFragment, null, 2),
      }],
    };
  },
);

server.tool(
  'capture_research',
  'Persist a research capture as source, evidence, claim, and optional citation',
  {
    thesisId: z.string().describe('UUID of the thesis'),
    payload: z.object({
      source: z.object({
        sourceType: z.enum(['book', 'article', 'web', 'pdf', 'note', 'other']),
        title: z.string(),
        authors: z.array(z.string()).optional(),
        publicationYear: z.number().int().nullable().optional(),
        locator: z.string().nullable().optional(),
      }),
      evidence: z.object({
        snippet: z.string(),
        extractionMethod: z.string(),
        confidence: z.number().nullable().optional(),
        status: z.enum(['captured', 'needs_review', 'rejected']).optional(),
      }).optional(),
      claim: z.object({
        text: z.string(),
        status: z.enum(['draft', 'supported', 'contested', 'archived']).optional(),
      }).optional(),
      citation: z.object({
        citationKey: z.string(),
        locator: z.string().nullable().optional(),
        style: z.string().optional(),
        status: z.enum(['draft', 'linked', 'validated']).optional(),
      }).optional(),
    }),
  },
  async ({ thesisId, payload }) => {
    const data = await apiPost<{ captured: unknown }>(`/theses/${thesisId}/research/capture`, payload);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.captured, null, 2),
      }],
    };
  },
);

server.tool(
  'list_claims',
  'List all claims for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ claims: unknown[] }>(`/theses/${thesisId}/claims`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.claims, null, 2),
      }],
    };
  },
);

server.tool(
  'resolve_doi',
  'Resolve a DOI to get academic metadata from Crossref',
  { doi: z.string().describe('The DOI to resolve (e.g. 10.1145/3442188.3445922)') },
  async ({ doi }) => {
    const data = await apiGet<unknown>(`/resolve-doi?doi=${encodeURIComponent(doi)}`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  },
);

// --- Resources ---

server.resource(
  'thesis-list',
  'thesis://list',
  async (uri) => {
    const data = await apiGet<{ theses: Array<{ id: string; title: string; currentState: string }> }>('/theses');
    const summary = data.theses.map((t) => `• ${t.title} [${t.currentState}] (${t.id})`).join('\n');
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: `Thesis Projects:\n${summary || 'No theses found.'}`,
      }],
    };
  },
);

server.resource(
  'system-capabilities',
  'thesis://capabilities',
  async (uri) => {
    const data = await apiGet<unknown>('/status/capabilities');
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      }],
    };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Thesis Research OS MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err);
  process.exit(1);
});
