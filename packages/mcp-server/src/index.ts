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
  'list_evidence',
  'List all evidence fragments for a thesis',
  { thesisId: z.string().describe('UUID of the thesis') },
  async ({ thesisId }) => {
    const data = await apiGet<{ fragments: unknown[] }>(`/theses/${thesisId}/evidence`);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.fragments, null, 2),
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
    const data = await apiPost<{ evidenceFragment: unknown }>(`/theses/${thesisId}/evidence`, {
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
