// university-policy-engine — policy profiles, compliance runs, and issue types

export type PolicyRuleDisposition = 'pass' | 'violation' | 'warning' | 'skipped';

export type PolicyRuleDefinition = {
  id: string;
  title: string;
  description: string;
  category: 'structure' | 'metadata';
  severity: 'warning' | 'violation';
  remediation: string;
  requiredSectionTitle?: string;
  minimumDocumentChildren?: number;
};

export type PolicyProfilePayload = {
  id: string;
  institutionId: string;
  institution: string;
  faculty: string;
  version: string;
  title: string;
  requiredSections: string[];
  rules: Array<PolicyRuleDefinition & { disposition: PolicyRuleDisposition }>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ComplianceRunSummary = {
  degradedConfidence: boolean;
  warnings: string[];
  evaluatedNodeCount: number;
  structureSelectionMode: string | null;
};

export type ComplianceRuleResultPayload = {
  ruleId: string;
  title: string;
  category: PolicyRuleDefinition['category'];
  disposition: PolicyRuleDisposition;
  severity: 'warning' | 'violation' | null;
  issueId: string | null;
  normalizedNodeId: string | null;
  message: string;
  remediation: string | null;
};

export type ComplianceIssuePayload = {
  id: string;
  thesisId: string;
  complianceRunId: string;
  policyProfileId: string;
  ruleId: string;
  normalizedNodeId: string | null;
  severity: 'warning' | 'violation';
  message: string;
  remediation: string | null;
  disposition: PolicyRuleDisposition;
  evidenceContext: {
    sourceIds: string[];
    evidenceFragmentIds: string[];
    zoteroMappingIds: string[];
    buildRunId: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type ComplianceRunPayload = {
  id: string;
  thesisId: string;
  policyProfileId: string;
  policyProfileVersion: string;
  policyInstitutionId: string;
  status: 'completed' | 'completed_with_warnings' | 'failed';
  summary: ComplianceRunSummary;
  counts: {
    evaluated: number;
    warnings: number;
    skipped: number;
    violations: number;
  };
  ruleResults: ComplianceRuleResultPayload[];
  issues: ComplianceIssuePayload[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// --- Errors ---

export class PolicyProfileNotFoundError extends Error {
  constructor() {
    super('No active policy profile is configured.');
    this.name = 'PolicyProfileNotFoundError';
  }
}
