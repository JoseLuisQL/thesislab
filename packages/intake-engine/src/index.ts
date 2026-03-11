// intake-engine — format detection, inspection, and normalization types

import type { SourceFormat } from '@thesis-research-os/thesis-registry';

export type { SourceFormat } from '@thesis-research-os/thesis-registry';

export type IntakeStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export type IntakeReportRecommendation = {
  code: string;
  message: string;
  triggeredBy: string[];
};

export type IntakeFailureDiagnostic = {
  code: string;
  message: string;
  detail?: string;
};

export type IntakeFormatDetection = {
  format: SourceFormat;
  reason: string;
  matchedBy: string;
};

export type IntakeReportReplacement = {
  isReimport?: boolean;
  replacesIntakeJobId?: string;
  recoverableCheckpointId?: string;
  supersedesWorkspace?: boolean;
  replacedByIntakeJobId?: string;
  replacedByRecoverableCheckpointId?: string;
};

export type IntakeReportSummary = {
  thesisId: string;
  intakeJobId: string;
  terminalStatus: IntakeStatus;
  detectedFormat: SourceFormat;
  detection: IntakeFormatDetection;
  extractionStatus: 'not_started' | 'completed' | 'failed';
  normalizationStatus: 'not_started' | 'completed' | 'failed';
  structureSummary: {
    entrypoint: string | null;
    itemCount: number;
    items: string[];
    selection: {
      mode: 'deterministic' | 'ambiguous' | 'missing';
      reason: string;
      candidates: string[];
    };
    includeGraph: LatexIncludeGraph | null;
    outline: StructureOutlineEntry[];
  } | null;
  normalizationSummary: {
    nodeCount: number;
    rootNodeIds: string[];
    provenanceCoverage: {
      available: number;
      unavailable: number;
    };
  } | null;
  replacement: IntakeReportReplacement | null;
  warnings: string[];
  failures: IntakeFailureDiagnostic[];
  recommendedNextSteps: IntakeReportRecommendation[];
};

export type LatexIncludeGraph = {
  rootFile: string | null;
  filesInOrder: string[];
  edges: Array<{
    from: string;
    to: string;
    command: 'input' | 'include';
    line: number;
  }>;
  unresolved: Array<{
    from: string;
    target: string;
    command: 'input' | 'include';
    line: number;
    reason: string;
  }>;
  blocked: Array<{
    from: string;
    target: string;
    command: 'input' | 'include';
    line: number;
    resolvedPath: string;
    reason: string;
  }>;
  cycles: Array<{ path: string[] }>;
};

export type StructureOutlineEntry = {
  id: string;
  title: string | null;
  level: number;
  nodeType: string;
  sourcePath: string | null;
  anchor: {
    start: string | null;
    end: string | null;
  };
};

export type IntakeJobPayload = {
  id: string;
  thesisId: string;
  sourceFormat: SourceFormat;
  status: IntakeStatus;
  importRootPath: string;
  detectedEntrypoint: string | null;
  detection: IntakeFormatDetection;
  report: IntakeReportSummary | null;
  warnings: string[];
  recommendations: IntakeReportRecommendation[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateIntakeJobInput = {
  importRootPath: string;
};

// --- Errors ---

export class IntakeJobNotFoundError extends Error {
  constructor(thesisId: string, intakeJobId: string) {
    super(`Intake job ${intakeJobId} was not found for thesis ${thesisId}.`);
    this.name = 'IntakeJobNotFoundError';
  }
}

export class IntakeBoundaryViolationError extends Error {
  constructor(
    public readonly thesisId: string,
    public readonly importRootPath: string,
    public readonly resolvedPath: string,
  ) {
    super(
      `Import path ${importRootPath} resolves outside thesis ${thesisId} workspace boundary: ${resolvedPath}.`,
    );
    this.name = 'IntakeBoundaryViolationError';
  }
}
