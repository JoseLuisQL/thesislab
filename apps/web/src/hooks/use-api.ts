import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${url}`, init);
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : 'Network request failed.');
  }

  const contentType = response.headers?.get?.('content-type') ?? 'application/json';
  const isJson = contentType.includes('application/json') || typeof response.json === 'function';
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload
      ? String((payload as { message?: unknown }).message ?? `API ${response.status}`)
      : `API ${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === 'string');
}

export type CapabilityState = 'available' | 'degraded' | 'unavailable' | string;

export type CapabilityCard = {
  key: string;
  label: string;
  state: CapabilityState;
  summary: string;
  detail: string;
  kind: string;
  localFirst?: boolean;
  optional?: boolean;
};

export type CapabilityPayload = {
  ok: boolean;
  service: string;
  mission: string;
  timestamp: string;
  posture: {
    mode: string;
    state: string;
    summary: string;
    detail?: string;
  };
  workflows: CapabilityCard[];
  integrations: CapabilityCard[];
};

export type ThesisSummary = {
  id: string;
  title: string;
  slug: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  defaultLanguage: string;
  currentState: string;
  latestStatusAt: string;
  statusSummary: string;
  blockers: string[];
  nextStepSummary: string;
  activeImportId: string | null;
  activeBuildRunId: string | null;
  openClawAgentId: string | null;
  openClawSessionKey: string | null;
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: UnknownRecord | null;
  policyProfileId: string | null;
  officialWorkspacePath: string | null;
  officialEntrypoint: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThesisTransition = {
  state: string;
  statusSummary: string;
  transitionedAt: string;
  source?: string | null;
};

export type ThesisDetail = {
  thesis: ThesisSummary;
  state: string;
  latestStatusAt: string;
  statusSummary: string;
  blockers: string[];
  nextStepSummary: string;
  checkpointCount: number;
  feedbackCount: number;
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: UnknownRecord | null;
  transitions: ThesisTransition[];
};

export type PolicyProfile = {
  id: string;
  institution: string;
  faculty: string;
  version: string;
  title: string;
  requiredSections: string[];
  isActive: boolean;
};

export type OpenClawAgentSummary = {
  id: string;
  workspace: string | null;
  agentDir: string | null;
  isDefault: boolean;
  routes: string[];
  bindingDetails: string[];
};

export type OpenClawStatus = {
  installed: boolean;
  statusAvailable: boolean;
  configPath: string | null;
  gatewayUrl: string | null;
  gatewayReachable: boolean;
  gatewayError: string | null;
  defaultAgentId: string | null;
  agents: OpenClawAgentSummary[];
  issues: string[];
};

export type OpenClawAssignment = {
  thesisId: string;
  thesisTarget: {
    agentId: string | null;
    sessionKey: string | null;
  };
  workflowPackTargets: Array<{
    workflowPackId: string;
    name: string;
    status: string;
    agentId: string | null;
    sessionKey: string | null;
  }>;
};

export type ResumeCheckpoint = {
  id: string;
  label: string;
  reason: string;
  checkpointedAt: string;
};

export type ResumeFeedback = {
  id: string;
  sourceType: string;
  summary: string | null;
  body: string;
  recordedAt: string;
};

export type ResumeRun = {
  id: string;
  status: string;
  createdAt: string;
};

export type ResumeFinding = {
  id: string;
  severity: string;
  title: string;
  message: string;
};

export type ResumePayload = {
  thesis: ThesisSummary | null;
  statusSummary: string;
  blockers: string[];
  nextAction: string;
  latestCheckpoint: ResumeCheckpoint | null;
  recentFeedback: ResumeFeedback[];
  latestComplianceRun: ResumeRun | null;
  latestAcademicQaRun: ResumeRun | null;
  recentComplianceFindings: ResumeFinding[];
  recentAcademicQaFindings: ResumeFinding[];
};

export type WorkflowPack = {
  id: string;
  name: string;
  description: string;
  status: string;
  progress: {
    totalSteps: number;
    completedSteps: number;
    blockedSteps: number;
  };
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    status: string;
    isCurrent: boolean;
  }>;
};

export type IntakeRecommendation = {
  code: string;
  message: string;
  triggeredBy: string[];
};

export type IntakeNode = {
  id: string;
  normalizedNodeId: string;
  title: string | null;
  nodeType: 'chapter' | 'section' | 'subsection' | string;
  level: number;
  sourcePath: string | null;
  anchor: { start: string | null; end: string | null };
};

export type IntakeJob = {
  id: string;
  thesisId: string;
  sourceFormat: string;
  status: string;
  importRootPath: string;
  detectedEntrypoint: string | null;
  warnings: string[];
  recommendations: IntakeRecommendation[];
  startedAt: string;
  completedAt: string | null;
  report: UnknownRecord | null;
};

export type SourceRecord = {
  id: string;
  thesisId: string;
  sourceType: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  locator: string | null;
  status: string;
  evidenceCount: number;
  claimCount: number;
};

export type EvidenceFragment = {
  id: string;
  thesisId: string;
  sourceId: string;
  normalizedNodeId: string | null;
  taskId: string | null;
  locator: string | null;
  snippet: string;
  extractionMethod: string;
  confidence: number | null;
  status: string;
};

export type ClaimRecord = {
  id: string;
  thesisId: string;
  normalizedNodeId: string | null;
  text: string;
  status: string;
  supportSummary: string;
  evidenceLinks: unknown[];
};

export type CitationRecord = {
  id: string;
  thesisId: string;
  sourceId: string | null;
  zoteroMappingId: string | null;
  normalizedNodeId: string | null;
  claimId: string | null;
  citationKey: string;
  locator: string | null;
  style: string;
  status: string;
};

export type ComplianceIssue = {
  id: string;
  severity: string;
  message: string;
  remediation: string | null;
  ruleId: string;
};

export type ComplianceRun = {
  id: string;
  thesisId: string;
  policyProfileId: string | null;
  policyProfileVersion: string;
  status: string;
  counts: {
    evaluated: number;
    warnings: number;
    skipped: number;
    violations: number;
  };
  issues: ComplianceIssue[];
  startedAt: string;
};

export type AcademicQaIssue = {
  id: string;
  category: string;
  severity: string;
  message: string;
  remediation: string | null;
};

export type AcademicQaRun = {
  id: string;
  thesisId: string;
  status: string;
  summary: {
    findingsByCategory: Record<string, number>;
    assessedClaimCount: number;
    assessedSectionCount: number;
    skippedCount: number;
  };
  issues: AcademicQaIssue[];
  startedAt: string;
};

export type LatexOutlineNode = {
  normalizedNodeId: string;
  title: string | null;
  nodeType: 'chapter' | 'section' | 'subsection' | string;
  sourcePath: string | null;
  anchor: { start: string | null; end: string | null };
  level: number;
};

export type LatexStructure = {
  entrypoint: string | null;
  selection: {
    mode: string;
    reason: string;
    candidates: string[];
  };
  outline: LatexOutlineNode[];
  includeGraph: UnknownRecord | null;
};

export type LatexSectionPreview = {
  node: LatexOutlineNode;
  content: string;
};

export type LatexBuildRun = {
  id: string;
  status: string;
  startedAt: string;
  bibliographyStatus: string;
  diagnosticsSummary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  diagnostics: Array<{
    severity: string;
    message: string;
    filePath: string | null;
    line: number | null;
  }>;
};

type ThesisMutationInput = {
  title: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  policyProfileId?: string | null;
  openClawAgentId?: string | null;
  openClawSessionKey?: string | null;
  officialWorkspacePath?: string | null;
  officialEntrypoint?: string | null;
  defaultLanguage?: string;
};

function normalizeThesisSummary(value: unknown): ThesisSummary {
  const record = asRecord(value);
  const thesis = asRecord(record.thesis ?? value);

  return {
    id: asString(thesis.id),
    title: asString(thesis.title, 'Untitled thesis'),
    slug: asString(thesis.slug),
    degreeProgram: asString(thesis.degreeProgram),
    institution: asString(thesis.institution),
    workspacePath: asString(thesis.workspacePath),
    defaultLanguage: asString(thesis.defaultLanguage, 'es'),
    currentState: asString(record.state ?? thesis.currentState, 'draft'),
    latestStatusAt: asString(record.latestStatusAt ?? thesis.latestStatusAt),
    statusSummary: asString(record.statusSummary),
    blockers: asStringArray(record.blockers),
    nextStepSummary: asString(record.nextStepSummary ?? thesis.nextStepSummary),
    activeImportId: asNullableString(thesis.activeImportId) ?? asNullableString(asRecord(record.activeWorkspace).intakeJobId),
    activeBuildRunId: asNullableString(thesis.activeBuildRunId) ?? asNullableString(asRecord(record.activeWorkspace).latestBuildRunId),
    openClawAgentId: asNullableString(thesis.openClawAgentId),
    openClawSessionKey: asNullableString(thesis.openClawSessionKey),
    latestCheckpointId: asNullableString(record.latestCheckpointId),
    latestFeedbackId: asNullableString(record.latestFeedbackId),
    activeWorkspace: record.activeWorkspace ? asRecord(record.activeWorkspace) : null,
    policyProfileId: asNullableString(thesis.policyProfileId),
    officialWorkspacePath: asNullableString(thesis.officialWorkspacePath),
    officialEntrypoint: asNullableString(thesis.officialEntrypoint),
    createdAt: asString(thesis.createdAt),
    updatedAt: asString(thesis.updatedAt),
  };
}

function normalizeThesisDetail(value: unknown): ThesisDetail {
  const record = asRecord(value);
  return {
    thesis: normalizeThesisSummary(record),
    state: asString(record.state, normalizeThesisSummary(record).currentState),
    latestStatusAt: asString(record.latestStatusAt),
    statusSummary: asString(record.statusSummary),
    blockers: asStringArray(record.blockers),
    nextStepSummary: asString(record.nextStepSummary),
    checkpointCount: asNumber(record.checkpointCount),
    feedbackCount: asNumber(record.feedbackCount),
    latestCheckpointId: asNullableString(record.latestCheckpointId),
    latestFeedbackId: asNullableString(record.latestFeedbackId),
    activeWorkspace: record.activeWorkspace ? asRecord(record.activeWorkspace) : null,
    transitions: asArray(record.transitions).map((transition) => {
      const item = asRecord(transition);
      return {
        state: asString(item.state),
        statusSummary: asString(item.statusSummary),
        transitionedAt: asString(item.transitionedAt),
        source: asNullableString(item.source),
      };
    }),
  };
}

function normalizePolicyProfile(value: unknown): PolicyProfile {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    institution: asString(record.institution),
    faculty: asString(record.faculty),
    version: asString(record.version),
    title: asString(record.title),
    requiredSections: asStringArray(record.requiredSections),
    isActive: Boolean(record.isActive),
  };
}

function normalizeResume(value: unknown): ResumePayload {
  const record = asRecord(value);
  const thesis = record.thesis ? normalizeThesisSummary(record.thesis) : null;
  return {
    thesis,
    statusSummary: asString(record.statusSummary),
    blockers: asStringArray(record.blockers),
    nextAction: asString(record.nextAction ?? record.nextStepSummary),
    latestCheckpoint: record.latestCheckpoint
      ? {
          id: asString(asRecord(record.latestCheckpoint).id),
          label: asString(asRecord(record.latestCheckpoint).label),
          reason: asString(asRecord(record.latestCheckpoint).reason),
          checkpointedAt: asString(asRecord(record.latestCheckpoint).checkpointedAt),
        }
      : null,
    recentFeedback: asArray(record.recentFeedback).map((feedback) => {
      const item = asRecord(feedback);
      return {
        id: asString(item.id),
        sourceType: asString(item.sourceType),
        summary: asNullableString(item.summary),
        body: asString(item.body),
        recordedAt: asString(item.recordedAt),
      };
    }),
    latestComplianceRun: record.latestComplianceRun
      ? {
          id: asString(asRecord(record.latestComplianceRun).id),
          status: asString(asRecord(record.latestComplianceRun).status),
          createdAt: asString(asRecord(record.latestComplianceRun).createdAt),
        }
      : null,
    latestAcademicQaRun: record.latestAcademicQaRun
      ? {
          id: asString(asRecord(record.latestAcademicQaRun).id),
          status: asString(asRecord(record.latestAcademicQaRun).status),
          createdAt: asString(asRecord(record.latestAcademicQaRun).createdAt),
        }
      : null,
    recentComplianceFindings: asArray(record.recentComplianceFindings).map((finding) => {
      const item = asRecord(finding);
      return {
        id: asString(item.id),
        severity: asString(item.severity),
        title: asString(item.title),
        message: asString(item.message),
      };
    }),
    recentAcademicQaFindings: asArray(record.recentAcademicQaFindings).map((finding) => {
      const item = asRecord(finding);
      return {
        id: asString(item.id),
        severity: asString(item.severity),
        title: asString(item.title),
        message: asString(item.message),
      };
    }),
  };
}

function normalizeWorkflowPack(value: unknown): WorkflowPack {
  const record = asRecord(value);
  const progressRecord = asRecord(record.progress);
  return {
    id: asString(record.id),
    name: asString(record.name),
    description: asString(record.description),
    status: asString(record.status),
    progress: {
      totalSteps: asNumber(progressRecord.totalSteps),
      completedSteps: asNumber(progressRecord.completedSteps),
      blockedSteps: asNumber(progressRecord.blockedSteps),
    },
    steps: asArray(record.steps).map((step) => {
      const item = asRecord(step);
      return {
        id: asString(item.id),
        title: asString(item.title),
        description: asString(item.description),
        status: asString(item.status),
        isCurrent: Boolean(item.isCurrent),
      };
    }),
  };
}

function normalizeIntakeJob(value: unknown): IntakeJob {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    sourceFormat: asString(record.sourceFormat),
    status: asString(record.status),
    importRootPath: asString(record.importRootPath),
    detectedEntrypoint: asNullableString(record.detectedEntrypoint),
    warnings: asStringArray(record.warnings),
    recommendations: asArray(record.recommendations).map((recommendation) => {
      const item = asRecord(recommendation);
      return {
        code: asString(item.code),
        message: asString(item.message),
        triggeredBy: asStringArray(item.triggeredBy),
      };
    }),
    startedAt: asString(record.startedAt),
    completedAt: asNullableString(record.completedAt),
    report: record.report ? asRecord(record.report) : null,
  };
}

function normalizeIntakeNode(value: unknown): IntakeNode {
  const record = asRecord(value);
  const anchor = asRecord(record.anchor);
  return {
    id: asString(record.id),
    normalizedNodeId: asString(record.id),
    title: asNullableString(record.title),
    nodeType: asString(record.nodeType),
    level: asNumber(record.level, 1),
    sourcePath: asNullableString(record.sourcePath),
    anchor: {
      start: asNullableString(anchor.start ?? record.sourceStart),
      end: asNullableString(anchor.end ?? record.sourceEnd),
    },
  };
}

function normalizeSource(value: unknown): SourceRecord {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    sourceType: asString(record.sourceType),
    title: asString(record.title),
    authors: asStringArray(record.authors),
    publicationYear: typeof record.publicationYear === 'number' ? record.publicationYear : null,
    locator: asNullableString(record.locator),
    status: asString(record.status),
    evidenceCount: asNumber(record.evidenceCount),
    claimCount: asNumber(record.claimCount),
  };
}

function normalizeEvidence(value: unknown): EvidenceFragment {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    sourceId: asString(record.sourceId),
    normalizedNodeId: asNullableString(record.normalizedNodeId),
    taskId: asNullableString(record.taskId),
    locator: asNullableString(record.locator),
    snippet: asString(record.snippet),
    extractionMethod: asString(record.extractionMethod),
    confidence: typeof record.confidence === 'number' ? record.confidence : null,
    status: asString(record.status),
  };
}

function normalizeClaim(value: unknown): ClaimRecord {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    normalizedNodeId: asNullableString(record.normalizedNodeId),
    text: asString(record.text),
    status: asString(record.status),
    supportSummary: asString(record.supportSummary),
    evidenceLinks: asArray(record.evidenceLinks),
  };
}

function normalizeCitation(value: unknown): CitationRecord {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    sourceId: asNullableString(record.sourceId),
    zoteroMappingId: asNullableString(record.zoteroMappingId),
    normalizedNodeId: asNullableString(record.normalizedNodeId),
    claimId: asNullableString(record.claimId),
    citationKey: asString(record.citationKey),
    locator: asNullableString(record.locator),
    style: asString(record.style),
    status: asString(record.status),
  };
}

function normalizeComplianceRun(value: unknown): ComplianceRun {
  const record = asRecord(value);
  const counts = asRecord(record.counts);
  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    policyProfileId: asNullableString(record.policyProfileId),
    policyProfileVersion: asString(record.policyProfileVersion),
    status: asString(record.status),
    counts: {
      evaluated: asNumber(counts.evaluated),
      warnings: asNumber(counts.warnings),
      skipped: asNumber(counts.skipped),
      violations: asNumber(counts.violations),
    },
    issues: asArray(record.issues).map((issue) => {
      const item = asRecord(issue);
      return {
        id: asString(item.id),
        severity: asString(item.severity),
        message: asString(item.message),
        remediation: asNullableString(item.remediation),
        ruleId: asString(item.ruleId),
      };
    }),
    startedAt: asString(record.startedAt),
  };
}

function normalizeAcademicQaRun(value: unknown): AcademicQaRun {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  const findingsByCategory = Object.fromEntries(
    Object.entries(asRecord(summary.findingsByCategory)).map(([key, value]) => [key, asNumber(value)]),
  );

  return {
    id: asString(record.id),
    thesisId: asString(record.thesisId),
    status: asString(record.status),
    summary: {
      findingsByCategory,
      assessedClaimCount: asNumber(summary.assessedClaimCount),
      assessedSectionCount: asNumber(summary.assessedSectionCount),
      skippedCount: asNumber(summary.skippedCount),
    },
    issues: asArray(record.issues).map((issue) => {
      const item = asRecord(issue);
      return {
        id: asString(item.id),
        category: asString(item.category),
        severity: asString(item.severity),
        message: asString(item.message),
        remediation: asNullableString(item.remediation),
      };
    }),
    startedAt: asString(record.startedAt),
  };
}

function normalizeLatexOutlineNode(value: unknown): LatexOutlineNode {
  const record = asRecord(value);
  const anchor = asRecord(record.anchor);
  return {
    normalizedNodeId: asString(record.normalizedNodeId ?? record.id),
    title: asNullableString(record.title),
    nodeType: asString(record.nodeType),
    sourcePath: asNullableString(record.sourcePath),
    anchor: {
      start: asNullableString(anchor.start),
      end: asNullableString(anchor.end),
    },
    level: asNumber(record.level, 1),
  };
}

function normalizeLatexBuildRun(value: unknown): LatexBuildRun {
  const record = asRecord(value);
  const summary = asRecord(record.diagnosticsSummary);
  return {
    id: asString(record.id),
    status: asString(record.status),
    startedAt: asString(record.startedAt),
    bibliographyStatus: asString(record.bibliographyStatus),
    diagnosticsSummary: {
      errorCount: asNumber(summary.errorCount),
      warningCount: asNumber(summary.warningCount),
      infoCount: asNumber(summary.infoCount),
    },
    diagnostics: asArray(record.diagnostics).map((diagnostic) => {
      const item = asRecord(diagnostic);
      return {
        severity: asString(item.severity),
        message: asString(item.message),
        filePath: asNullableString(item.filePath),
        line: typeof item.line === 'number' ? item.line : null,
      };
    }),
  };
}

// --- Status ---

export function useCapabilities() {
  return useQuery<CapabilityPayload>({
    queryKey: ['capabilities'],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>('/status/capabilities');
      return {
        ok: true,
        service: asString(payload.service),
        mission: asString(payload.mission),
        timestamp: asString(payload.timestamp),
        posture: {
          mode: asString(asRecord(payload.posture).mode),
          state: asString(asRecord(payload.posture).state),
          summary: asString(asRecord(payload.posture).summary),
          detail: asString(asRecord(payload.posture).detail),
        },
        workflows: asArray(payload.workflows).map((item) => ({
          key: asString(asRecord(item).key),
          label: asString(asRecord(item).label),
          state: asString(asRecord(item).state),
          summary: asString(asRecord(item).summary),
          detail: asString(asRecord(item).detail),
          kind: asString(asRecord(item).kind),
          localFirst: Boolean(asRecord(item).localFirst),
        })),
        integrations: asArray(payload.integrations).map((item) => ({
          key: asString(asRecord(item).key),
          label: asString(asRecord(item).label),
          state: asString(asRecord(item).state),
          summary: asString(asRecord(item).summary),
          detail: asString(asRecord(item).detail),
          kind: asString(asRecord(item).kind),
          optional: Boolean(asRecord(item).optional),
        })),
      };
    },
    staleTime: 30_000,
  });
}

export function useOpenClawStatus() {
  return useQuery<{ ok: true; status: OpenClawStatus }>({
    queryKey: ['openclaw-status'],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>('/openclaw/status');
      const status = asRecord(payload.status);
      return {
        ok: true,
        status: {
          installed: Boolean(status.installed),
          statusAvailable: Boolean(status.statusAvailable),
          configPath: asNullableString(status.configPath),
          gatewayUrl: asNullableString(status.gatewayUrl),
          gatewayReachable: Boolean(status.gatewayReachable),
          gatewayError: asNullableString(status.gatewayError),
          defaultAgentId: asNullableString(status.defaultAgentId),
          agents: asArray(status.agents).map((agent) => {
            const item = asRecord(agent);
            return {
              id: asString(item.id),
              workspace: asNullableString(item.workspace),
              agentDir: asNullableString(item.agentDir),
              isDefault: Boolean(item.isDefault),
              routes: asStringArray(item.routes),
              bindingDetails: asStringArray(item.bindingDetails),
            };
          }),
          issues: asStringArray(status.issues),
        },
      };
    },
    staleTime: 15_000,
  });
}

// --- Policies ---

export function usePolicyProfiles() {
  return useQuery<{ ok: true; policyProfiles: PolicyProfile[] }>({
    queryKey: ['policy-profiles'],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>('/policy-profiles');
      return {
        ok: true,
        policyProfiles: asArray(payload.policyProfiles ?? payload.profiles).map(normalizePolicyProfile),
      };
    },
    staleTime: 60_000,
  });
}

export function useActivePolicyProfile() {
  return useQuery<{ ok: true; policyProfile: PolicyProfile | null }>({
    queryKey: ['policy-profiles', 'active'],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>('/policy-profiles/active');
      return {
        ok: true,
        policyProfile: payload.policyProfile ? normalizePolicyProfile(payload.policyProfile) : null,
      };
    },
    staleTime: 60_000,
  });
}

// --- Theses ---

export function useTheses() {
  return useQuery<{ ok: true; theses: ThesisSummary[] }>({
    queryKey: ['theses'],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>('/theses');
      return {
        ok: true,
        theses: asArray(payload.theses).map(normalizeThesisSummary),
      };
    },
    staleTime: 15_000,
  });
}

export function useThesisDetail(thesisId: string | null) {
  return useQuery<{ ok: true; thesis: ThesisDetail }>({
    queryKey: ['thesis', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}`);
      return {
        ok: true,
        thesis: normalizeThesisDetail(payload.thesis),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useThesisResume(thesisId: string | null) {
  return useQuery<{ ok: true; resume: ResumePayload }>({
    queryKey: ['thesis-resume', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/resume`);
      return {
        ok: true,
        resume: normalizeResume(payload.resume),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useOpenClawAssignment(thesisId: string | null) {
  return useQuery<{ ok: true; assignment: OpenClawAssignment }>({
    queryKey: ['openclaw-assignment', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/openclaw-assignment`);
      const assignment = asRecord(payload.assignment);
      return {
        ok: true,
        assignment: {
          thesisId: asString(assignment.thesisId),
          thesisTarget: {
            agentId: asNullableString(asRecord(assignment.thesisTarget).agentId),
            sessionKey: asNullableString(asRecord(assignment.thesisTarget).sessionKey),
          },
          workflowPackTargets: asArray(assignment.workflowPackTargets).map((target) => {
            const item = asRecord(target);
            return {
              workflowPackId: asString(item.workflowPackId),
              name: asString(item.name),
              status: asString(item.status),
              agentId: asNullableString(item.agentId),
              sessionKey: asNullableString(item.sessionKey),
            };
          }),
        },
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useCreateThesisMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ThesisMutationInput) => {
      const response = await postJson<UnknownRecord>('/theses', payload);
      return { ok: true, thesis: normalizeThesisDetail(response.thesis) };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['theses'] });
    },
  });
}

export function useUpdateThesisMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<ThesisMutationInput>) => {
      const response = await patchJson<UnknownRecord>(`/theses/${thesisId}`, payload);
      return { ok: true, thesis: normalizeThesisDetail(response.thesis) };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['theses'] }),
        queryClient.invalidateQueries({ queryKey: ['thesis', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
      ]);
    },
  });
}

export function useUpdateOpenClawAssignmentMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { agentId?: string | null; sessionKey?: string | null }) =>
      patchJson<{ ok: true; assignment: OpenClawAssignment }>(`/theses/${thesisId}/openclaw-assignment`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['openclaw-assignment', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['theses'] }),
      ]);
    },
  });
}

export function useUpdateWorkflowPackOpenClawAssignmentMutation(thesisId: string | null, workflowPackId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { agentId?: string | null; sessionKey?: string | null }) =>
      patchJson<{ ok: true; workflowPack: WorkflowPack }>(
        `/theses/${thesisId}/workflow-packs/${workflowPackId}/openclaw-assignment`,
        payload,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['openclaw-assignment', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['workflow-packs', thesisId] }),
      ]);
    },
  });
}

// --- Workflow ---

export function useWorkflowPacks(thesisId: string | null) {
  return useQuery<{ ok: true; workflowPacks: WorkflowPack[] }>({
    queryKey: ['workflow-packs', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/workflow-packs`);
      return {
        ok: true,
        workflowPacks: asArray(payload.workflowPacks ?? payload.packs).map(normalizeWorkflowPack),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

// --- Intake ---

export function useIntakeJob(thesisId: string | null, intakeJobId: string | null) {
  return useQuery<{ ok: true; intakeJob: IntakeJob }>({
    queryKey: ['intake-job', thesisId, intakeJobId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/intake-jobs/${intakeJobId}`);
      return {
        ok: true,
        intakeJob: normalizeIntakeJob(payload.intakeJob),
      };
    },
    enabled: Boolean(thesisId && intakeJobId),
    staleTime: 10_000,
  });
}

export function useIntakeReport(thesisId: string | null, intakeJobId: string | null) {
  return useQuery<{ ok: true; report: UnknownRecord }>({
    queryKey: ['intake-report', thesisId, intakeJobId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/intake-jobs/${intakeJobId}/report`);
      return { ok: true, report: asRecord(payload.report) };
    },
    enabled: Boolean(thesisId && intakeJobId),
    staleTime: 10_000,
  });
}

export function useIntakeNodes(thesisId: string | null, intakeJobId: string | null) {
  return useQuery<{ ok: true; nodes: IntakeNode[] }>({
    queryKey: ['intake-nodes', thesisId, intakeJobId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/intake-jobs/${intakeJobId}/nodes`);
      return {
        ok: true,
        nodes: asArray(payload.nodes).map(normalizeIntakeNode),
      };
    },
    enabled: Boolean(thesisId && intakeJobId),
    staleTime: 10_000,
  });
}

export function useCreateIntakeJobMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (importRootPath: string) => {
      const response = await postJson<UnknownRecord>(`/theses/${thesisId}/intake-jobs`, { importRootPath });
      return { ok: true, intakeJob: normalizeIntakeJob(response.intakeJob) };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['theses'] }),
        queryClient.invalidateQueries({ queryKey: ['thesis', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
      ]);
    },
  });
}

// --- Sources / Evidence / Claims / Citations ---

export function useSources(thesisId: string | null) {
  return useQuery<{ ok: true; sources: SourceRecord[] }>({
    queryKey: ['sources', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/sources`);
      return {
        ok: true,
        sources: asArray(payload.sources).map(normalizeSource),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useEvidence(thesisId: string | null) {
  return useQuery<{ ok: true; evidenceFragments: EvidenceFragment[] }>({
    queryKey: ['evidence', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/evidence-fragments`);
      return {
        ok: true,
        evidenceFragments: asArray(payload.evidenceFragments ?? payload.fragments).map(normalizeEvidence),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useClaims(thesisId: string | null) {
  return useQuery<{ ok: true; claims: ClaimRecord[] }>({
    queryKey: ['claims', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/claims`);
      return {
        ok: true,
        claims: asArray(payload.claims).map(normalizeClaim),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useCitations(thesisId: string | null) {
  return useQuery<{ ok: true; citations: CitationRecord[] }>({
    queryKey: ['citations', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/citations`);
      return {
        ok: true,
        citations: asArray(payload.citations).map(normalizeCitation),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

// --- Compliance / QA ---

export function useComplianceRuns(thesisId: string | null) {
  return useQuery<{ ok: true; complianceRuns: ComplianceRun[] }>({
    queryKey: ['compliance-runs', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/compliance-runs`);
      return {
        ok: true,
        complianceRuns: asArray(payload.complianceRuns ?? payload.runs).map(normalizeComplianceRun),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useAcademicQaRuns(thesisId: string | null) {
  return useQuery<{ ok: true; academicQaRuns: AcademicQaRun[] }>({
    queryKey: ['academic-qa-runs', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/academic-qa-runs`);
      return {
        ok: true,
        academicQaRuns: asArray(payload.academicQaRuns ?? payload.runs).map(normalizeAcademicQaRun),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useCreateComplianceRunMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ ok: true; complianceRun: ComplianceRun }>(`/theses/${thesisId}/compliance-runs`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['compliance-runs', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
      ]);
    },
  });
}

export function useCreateAcademicQaRunMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ ok: true; academicQaRun: AcademicQaRun }>(`/theses/${thesisId}/academic-qa-runs`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['academic-qa-runs', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
      ]);
    },
  });
}

// --- LaTeX ---

export function useLatexStructure(thesisId: string | null) {
  return useQuery<{ ok: true; structure: LatexStructure }>({
    queryKey: ['latex-structure', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/latex/structure`);
      const structure = asRecord(payload.structure);
      return {
        ok: true,
        structure: {
          entrypoint: asNullableString(structure.entrypoint),
          selection: {
            mode: asString(asRecord(structure.selection).mode),
            reason: asString(asRecord(structure.selection).reason),
            candidates: asStringArray(asRecord(structure.selection).candidates),
          },
          outline: asArray(structure.outline).map(normalizeLatexOutlineNode),
          includeGraph: structure.includeGraph ? asRecord(structure.includeGraph) : null,
        },
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useLatexSectionPreview(thesisId: string | null, normalizedNodeId: string | null) {
  return useQuery<{ ok: true; section: LatexSectionPreview }>({
    queryKey: ['latex-section-preview', thesisId, normalizedNodeId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/latex/sections/${normalizedNodeId}`);
      const section = asRecord(payload.section);
      return {
        ok: true,
        section: {
          node: normalizeLatexOutlineNode(section.node),
          content: asString(section.content),
        },
      };
    },
    enabled: Boolean(thesisId && normalizedNodeId),
    staleTime: 10_000,
  });
}

export function useLatexBuilds(thesisId: string | null) {
  return useQuery<{ ok: true; runs: LatexBuildRun[] }>({
    queryKey: ['latex-builds', thesisId],
    queryFn: async () => {
      const payload = await requestJson<UnknownRecord>(`/theses/${thesisId}/latex/builds`);
      const history = asRecord(payload.history);
      return {
        ok: true,
        runs: asArray(history.runs ?? payload.builds).map(normalizeLatexBuildRun),
      };
    },
    enabled: Boolean(thesisId),
    staleTime: 10_000,
  });
}

export function useLatexEditMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      target: {
        normalizedNodeId?: string;
        sourcePath: string;
        title: string;
        nodeType: 'chapter' | 'section' | 'subsection';
        anchorStart: string;
        anchorEnd?: string | null;
      };
      replacement: string;
      note?: string | null;
      createdBy: string;
    }) => postJson<{ ok: true; edit: unknown }>(`/theses/${thesisId}/latex/edits`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['latex-structure', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis', thesisId] }),
      ]);
    },
  });
}

export function useLatexBuildMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (createdBy: string) => postJson<{ ok: true; build: unknown }>(`/theses/${thesisId}/latex/builds`, { createdBy }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['latex-builds', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['thesis-resume', thesisId] }),
      ]);
    },
  });
}

// --- Research actions ---

export function useResearchSearchMutation(thesisId: string | null) {
  return useMutation({
    mutationFn: (query: string) => postJson<{ ok: true; results: Array<{ title: string; url: string; snippet: string; source: string }> }>(
      `/theses/${thesisId}/research/search`,
      { query },
    ),
  });
}

export function useResearchFetchMutation(thesisId: string | null) {
  return useMutation({
    mutationFn: (url: string) => postJson<{ ok: true; page: { title: string; text: string; html: string } }>(
      `/theses/${thesisId}/research/fetch`,
      { url },
    ),
  });
}

export function useResearchCaptureMutation(thesisId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      source: { sourceType: 'book' | 'article' | 'web' | 'pdf' | 'note' | 'other'; title: string; authors?: string[]; locator?: string | null; publicationYear?: number | null };
      evidence?: { snippet: string; extractionMethod: string; confidence?: number | null; status?: 'captured' | 'needs_review' | 'rejected' };
      claim?: { text: string; status?: 'draft' | 'supported' | 'contested' | 'archived' };
      citation?: { citationKey: string; locator?: string | null; style?: string; status?: 'draft' | 'linked' | 'validated' };
    }) => postJson<{ ok: true; captured: unknown }>(`/theses/${thesisId}/research/capture`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sources', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['evidence', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['claims', thesisId] }),
        queryClient.invalidateQueries({ queryKey: ['citations', thesisId] }),
      ]);
    },
  });
}

export function useSyncZoteroBibliographyMutation(thesisId: string | null) {
  return useMutation({
    mutationFn: () => postJson<{ ok: true; sync: { filePath: string; writtenEntries: number; missingItemKeys: string[]; bibliography: string } }>(
      `/theses/${thesisId}/zotero/sync-bibliography`,
      {},
    ),
  });
}
