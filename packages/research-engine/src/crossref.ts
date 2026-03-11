// research-engine/src/crossref.ts — Crossref REST API client for DOI resolution

export type CrossrefMetadata = {
  doi: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  journal: string | null;
  publisher: string | null;
  type: string;
  url: string;
  abstract: string | null;
  issnPrint: string | null;
  issnOnline: string | null;
  referenceCount: number;
  citedByCount: number;
};

export type DoiResolutionResult =
  | { ok: true; metadata: CrossrefMetadata }
  | { ok: false; error: string; statusCode?: number };

const CROSSREF_BASE = 'https://api.crossref.org';

export async function resolveDoi(doi: string, mailto?: string): Promise<DoiResolutionResult> {
  const cleanDoi = doi.trim().replace(/^https?:\/\/doi\.org\//, '');

  if (!cleanDoi) {
    return { ok: false, error: 'Empty DOI provided.' };
  }

  const params = new URLSearchParams();
  if (mailto) {
    params.set('mailto', mailto);
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const url = `${CROSSREF_BASE}/works/${encodeURIComponent(cleanDoi)}${qs}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ThesisResearchOS/1.0 (mailto:thesis-os@research.local)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        ok: false,
        error: `Crossref API returned ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const body = await response.json() as {
      status: string;
      message: {
        DOI: string;
        title?: string[];
        author?: Array<{ given?: string; family?: string; name?: string }>;
        published?: { 'date-parts'?: number[][] };
        'published-print'?: { 'date-parts'?: number[][] };
        'published-online'?: { 'date-parts'?: number[][] };
        'container-title'?: string[];
        publisher?: string;
        type?: string;
        URL?: string;
        abstract?: string;
        ISSN?: string[];
        'reference-count'?: number;
        'is-referenced-by-count'?: number;
      };
    };

    const msg = body.message;

    const dateParts = msg.published?.['date-parts']?.[0]
      ?? msg['published-print']?.['date-parts']?.[0]
      ?? msg['published-online']?.['date-parts']?.[0];

    const authors = (msg.author ?? []).map((a) => {
      if (a.name) return a.name;
      return [a.given, a.family].filter(Boolean).join(' ');
    });

    return {
      ok: true,
      metadata: {
        doi: msg.DOI,
        title: msg.title?.[0] ?? 'Untitled',
        authors,
        publicationYear: dateParts?.[0] ?? null,
        journal: msg['container-title']?.[0] ?? null,
        publisher: msg.publisher ?? null,
        type: msg.type ?? 'unknown',
        url: msg.URL ?? `https://doi.org/${msg.DOI}`,
        abstract: msg.abstract ?? null,
        issnPrint: msg.ISSN?.[0] ?? null,
        issnOnline: msg.ISSN?.[1] ?? null,
        referenceCount: msg['reference-count'] ?? 0,
        citedByCount: msg['is-referenced-by-count'] ?? 0,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to resolve DOI: ${message}`,
    };
  }
}
