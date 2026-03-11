// evidence-graph — claims, evidence fragments, and claim-evidence linking

export type EvidenceFragmentPayload = {
  id: string;
  thesisId: string;
  sourceId: string;
  locator: string | null;
  snippet: string;
  extractionMethod: string;
  confidence: number | null;
  status: 'captured' | 'needs_review' | 'rejected';
  provenance: Record<string, unknown> | null;
  source: {
    id: string;
    title: string;
    sourceType: string;
    status: string;
  };
  context: {
    section: { id: string; title: string | null; nodeType: string } | null;
    task: { id: string; title: string; status: string } | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateEvidenceFragmentInput = {
  sourceId: string;
  locator?: string | null;
  snippet: string;
  extractionMethod: string;
  confidence?: number | null;
  status?: 'captured' | 'needs_review' | 'rejected';
  provenance?: Record<string, unknown> | null;
  normalizedNodeId?: string | null;
  taskId?: string | null;
};

export type ClaimStatus = 'draft' | 'supported' | 'contested' | 'archived';

export type ClaimPayload = {
  id: string;
  thesisId: string;
  normalizedNodeId: string | null;
  text: string;
  status: ClaimStatus;
  supportSummary: string;
  evidenceLinks: Array<{
    id: string;
    evidenceFragmentId: string;
    rationale: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type CreateClaimInput = {
  text: string;
  status?: ClaimStatus;
  supportSummary?: string;
  normalizedNodeId?: string | null;
};

export type LinkClaimEvidenceInput = {
  evidenceFragmentIds: string[];
  rationale: string;
};

export type EvidenceContextSetupPayload = {
  thesisId: string;
  activeImportId: string | null;
  normalizedNodes: NormalizedNodePayload[];
  tasks: Array<{ id: string; title: string; status: string }>;
};

export type NormalizedNodePayload = {
  id: string;
  thesisId: string;
  intakeJobId: string | null;
  parentNodeId: string | null;
  nodeType: string;
  title: string | null;
  content: string | null;
  ordinal: number;
  sourcePath: string | null;
  sourceStart: string | null;
  sourceEnd: string | null;
  provenanceKind: string;
  provenance: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

// --- Errors ---

export class SourceNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly sourceId: string) {
    super(`Source ${sourceId} was not found for thesis ${thesisId}.`);
    this.name = 'SourceNotFoundError';
  }
}

export class EvidenceFragmentNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly evidenceFragmentId: string) {
    super(`Evidence fragment ${evidenceFragmentId} was not found for thesis ${thesisId}.`);
    this.name = 'EvidenceFragmentNotFoundError';
  }
}

export class EvidenceContextScopeError extends Error {
  constructor(public readonly thesisId: string, message: string) {
    super(message);
    this.name = 'EvidenceContextScopeError';
  }
}

export class ClaimNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly claimId: string) {
    super(`Claim ${claimId} was not found for thesis ${thesisId}.`);
    this.name = 'ClaimNotFoundError';
  }
}

export class ClaimEvidenceScopeError extends Error {
  constructor(public readonly thesisId: string, message: string) {
    super(message);
    this.name = 'ClaimEvidenceScopeError';
  }
}

export class ClaimEvidenceLinkNotFoundError extends Error {
  constructor(
    public readonly thesisId: string,
    public readonly claimId: string,
    public readonly evidenceFragmentId: string,
  ) {
    super(
      `Claim ${claimId} is not linked to evidence fragment ${evidenceFragmentId} for thesis ${thesisId}.`,
    );
    this.name = 'ClaimEvidenceLinkNotFoundError';
  }
}

// --- Pure functions ---

export type ClaimEvidenceOrderingMetadata = {
  evidenceFragmentIdOrder: string[];
};

export function parseClaimEvidenceOrderingMetadata(rawValue: string | null): ClaimEvidenceOrderingMetadata {
  if (!rawValue) {
    return { evidenceFragmentIdOrder: [] };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ClaimEvidenceOrderingMetadata>;
    return {
      evidenceFragmentIdOrder: Array.isArray(parsed.evidenceFragmentIdOrder)
        ? parsed.evidenceFragmentIdOrder.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return { evidenceFragmentIdOrder: [] };
  }
}

export function serializeClaimEvidenceOrderingMetadata(metadata: ClaimEvidenceOrderingMetadata): string {
  return JSON.stringify({
    evidenceFragmentIdOrder: metadata.evidenceFragmentIdOrder,
  } satisfies ClaimEvidenceOrderingMetadata);
}
