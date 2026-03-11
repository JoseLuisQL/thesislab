// academic-qa — QA runs, issue categories, and evaluation types

export type AcademicQaIssueCategory = 'evidence-gap' | 'citation-weakness' | 'methodology' | 'coherence';

export type AcademicQaIssuePayload = {
  id: string;
  thesisId: string;
  academicQaRunId: string;
  claimId: string | null;
  normalizedNodeId: string | null;
  category: AcademicQaIssueCategory;
  severity: 'warning' | 'issue';
  message: string;
  rationale: string;
  remediation: string | null;
  triggeringCondition: string;
  supportContext: {
    sourceIds: string[];
    evidenceFragmentIds: string[];
    zoteroMappingIds: string[];
    buildRunId: string | null;
  };
  groundedIn: {
    entityType: 'claim' | 'section';
    entityId: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AcademicQaRunPayload = {
  id: string;
  thesisId: string;
  status: 'completed' | 'completed_with_warnings';
  issueCategories: AcademicQaIssueCategory[];
  assessedScope: {
    claimIds: string[];
    normalizedNodeIds: string[];
    counts: {
      claims: number;
      sections: number;
    };
  };
  skippedScope: Array<{
    entityType: 'claim' | 'section';
    entityId: string;
    reason: string;
  }>;
  summary: {
    findingsByCategory: Record<AcademicQaIssueCategory, number>;
    assessedClaimCount: number;
    assessedSectionCount: number;
    skippedCount: number;
  };
  issues: AcademicQaIssuePayload[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// --- Errors ---

export class AcademicQaRunNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly academicQaRunId: string) {
    super(`Academic QA run ${academicQaRunId} was not found for thesis ${thesisId}.`);
    this.name = 'AcademicQaRunNotFoundError';
  }
}

// --- Pure functions ---

export const ALL_QA_CATEGORIES: AcademicQaIssueCategory[] = [
  'evidence-gap',
  'citation-weakness',
  'methodology',
  'coherence',
];

export function createEmptyFindingsByCategory(): Record<AcademicQaIssueCategory, number> {
  return {
    'evidence-gap': 0,
    'citation-weakness': 0,
    'methodology': 0,
    'coherence': 0,
  };
}
