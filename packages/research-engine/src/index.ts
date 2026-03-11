// research-engine — source registration types and duplicate checking

export type SourceIngestStatus = 'not_started' | 'queued' | 'succeeded' | 'degraded' | 'failed';
export type SourceDuplicateState = 'unique' | 'duplicate';
export type PdfExtractionStatus = 'not_attempted' | 'succeeded' | 'degraded' | 'failed';
export type SourceType = 'book' | 'article' | 'web' | 'pdf' | 'note' | 'other';
export type SourceStatus = 'registered' | 'ingesting' | 'ready' | 'degraded' | 'failed';

export type IntakeFailureDiagnostic = {
  code: string;
  message: string;
  detail?: string;
};

export type SourcePayload = {
  id: string;
  thesisId: string;
  sourceType: SourceType;
  title: string;
  authors: string[];
  publicationYear: number | null;
  locator: string | null;
  status: SourceStatus;
  ingest: {
    ingestStatus: SourceIngestStatus;
    duplicateState: SourceDuplicateState;
    duplicateOfSourceId: string | null;
    pdfExtractionStatus: PdfExtractionStatus;
    pdfMetadata: Record<string, unknown> | null;
    warnings: string[];
    failures: IntakeFailureDiagnostic[];
    signature: string;
  };
  evidenceCount: number;
  claimCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RegisterSourceInput = {
  sourceType: SourceType;
  title: string;
  authors?: string[];
  publicationYear?: number | null;
  locator?: string | null;
  ingest?: {
    ingestStatus?: SourceIngestStatus;
    pdfText?: string | null;
    pdfMetadata?: Record<string, unknown> | null;
  };
};

export type ListSourcesInput = {
  query?: string | null;
};

// --- Errors ---

export class SourceRegistrationConflictError extends Error {
  constructor(public readonly thesisId: string, message: string) {
    super(message);
    this.name = 'SourceRegistrationConflictError';
  }
}

// --- Pure functions ---

export function computeSourceSignature(title: string, sourceType: string, locator: string | null): string {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedType = sourceType.trim().toLowerCase();
  const normalizedLocator = (locator ?? '').trim().toLowerCase();
  return `${normalizedType}::${normalizedTitle}::${normalizedLocator}`;
}

// --- Crossref / DOI re-exports ---

export { resolveDoi, type CrossrefMetadata, type DoiResolutionResult } from './crossref.js';
export { parseBibtexFile, type BibtexEntry } from './bibtex-parser.js';

// --- Research Adapter (browser research interface) ---

export type ResearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

export interface ResearchAdapter {
  search(query: string): Promise<ResearchResult[]>;
  fetchPage(url: string): Promise<{ title: string; text: string; html: string }>;
  extractSources(url: string): Promise<Array<{ title: string; authors: string[]; doi: string | null; url: string }>>;
}

export class StubResearchAdapter implements ResearchAdapter {
  async search(query: string): Promise<ResearchResult[]> {
    console.warn(`[StubResearchAdapter] search("${query}") — browser research not configured. Install Playwright for real browser research.`);
    return [];
  }

  async fetchPage(url: string): Promise<{ title: string; text: string; html: string }> {
    console.warn(`[StubResearchAdapter] fetchPage("${url}") — browser research not configured.`);
    return { title: '', text: '', html: '' };
  }

  async extractSources(url: string): Promise<Array<{ title: string; authors: string[]; doi: string | null; url: string }>> {
    console.warn(`[StubResearchAdapter] extractSources("${url}") — browser research not configured.`);
    return [];
  }
}

export function createResearchAdapter(): ResearchAdapter {
  return new StubResearchAdapter();
}

