// latex-engine — LaTeX structure, editing, building, and diagnostics types

import type { StructureOutlineEntry, LatexIncludeGraph } from '@thesis-research-os/intake-engine';

export type LatexStructureSelection = {
  mode: 'deterministic' | 'ambiguous' | 'missing';
  reason: string;
  candidates: string[];
};

export type LatexStructureNode = StructureOutlineEntry & {
  normalizedNodeId: string;
};

export type LatexStructureSnapshot = {
  entrypoint: string | null;
  selection: LatexStructureSelection;
  includeGraph: LatexIncludeGraph | null;
  outline: LatexStructureNode[];
};

export type LatexEditTarget = {
  normalizedNodeId?: string;
  sourcePath: string;
  title: string;
  nodeType: 'chapter' | 'section' | 'subsection';
  anchorStart: string;
  anchorEnd?: string | null;
};

export type LatexEditRequest = {
  target: LatexEditTarget;
  replacement: string;
  note?: string | null;
  createdBy: string;
};

export type LatexCheckpointFileSnapshot = {
  relativePath: string;
  content: string;
  sha256: string;
};

export type LatexCheckpointSnapshot = {
  kind: 'latex-edit';
  version: 1;
  thesisId: string;
  workspacePath: string;
  intakeJobId: string;
  checkpointId: string;
  createdAt: string;
  target: {
    normalizedNodeId: string;
    sourcePath: string;
    title: string;
    nodeType: 'chapter' | 'section' | 'subsection';
    startLine: number;
    endLine: number;
  };
  files: LatexCheckpointFileSnapshot[];
};

export type LatexEditPayload = {
  thesisId: string;
  intakeJobId: string;
  checkpoint: {
    id: string;
    thesisId: string;
    label: string | null;
    note: string | null;
    scope: string;
    reason: string;
    snapshotPath: string | null;
    snapshotMetadata: Record<string, unknown> | null;
    createdBy: string;
    checkpointedAt: string;
    createdAt: string;
    updatedAt: string;
  };
  target: {
    normalizedNodeId: string;
    sourcePath: string;
    title: string;
    nodeType: 'chapter' | 'section' | 'subsection';
    startLine: number;
    endLine: number;
  };
  changedFiles: Array<{
    path: string;
    changedRange: { startLine: number; endLine: number };
    sha256Before: string;
    sha256After: string;
    unchangedContext: { before: boolean; after: boolean };
  }>;
  structure: LatexStructureSnapshot;
};

export type LatexRestorePayload = {
  thesisId: string;
  intakeJobId: string;
  checkpointId: string;
  restoredFiles: Array<{
    path: string;
    sha256Before: string;
    sha256After: string;
  }>;
  structure: LatexStructureSnapshot;
};

export type LatexBuildEngine = 'latexmk';

export type BibliographyConfiguration = {
  mode: 'bibliography' | 'biblatex' | 'unsupported' | 'none';
  inputs: string[];
  missingInputs: string[];
  commands: Array<'bibtex' | 'biber'>;
  status: 'not_required' | 'ready' | 'missing_inputs' | 'unsupported';
  detail: string;
};

export type LatexDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  category: 'compile' | 'bibliography' | 'toolchain';
  message: string;
  filePath: string | null;
  line: number | null;
  mappingStatus: 'mapped' | 'unmapped';
  mappingReason: string | null;
  source: string;
};

export type LatexBuildRunPayload = {
  id: string;
  thesisId: string;
  checkpointId: string | null;
  status: 'completed' | 'failed' | 'completed_with_warnings';
  engine: LatexBuildEngine;
  artifactPath: string | null;
  retainedArtifactPath: string | null;
  logPath: string | null;
  bibliographyStatus: string;
  bibliography: BibliographyConfiguration;
  diagnostics: LatexDiagnostic[];
  diagnosticsSummary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  startedAt: string;
  completedAt: string;
  isLatestSuccessful: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LatexBuildPayload = {
  thesisId: string;
  buildRun: LatexBuildRunPayload;
  history: {
    latestAttempted: LatexBuildRunPayload;
    latestSuccessful: LatexBuildRunPayload | null;
    runs: LatexBuildRunPayload[];
  };
};

// --- Errors ---

export class LatexWorkspaceNotReadyError extends Error {
  constructor(public readonly thesisId: string) {
    super(`Thesis ${thesisId} does not have an active LaTeX workspace ready for editing.`);
    this.name = 'LatexWorkspaceNotReadyError';
  }
}

export class LatexEditConflictError extends Error {
  constructor(
    public readonly thesisId: string,
    public readonly reasons: string[],
    public readonly snapshot: LatexStructureSnapshot,
  ) {
    super(reasons[0] ?? `LaTeX edit target conflict for thesis ${thesisId}.`);
    this.name = 'LatexEditConflictError';
  }
}

export class LatexCheckpointRestoreError extends Error {
  constructor(public readonly thesisId: string, public readonly checkpointId: string, message: string) {
    super(message);
    this.name = 'LatexCheckpointRestoreError';
  }
}

export class LatexBuildNotReadyError extends Error {
  constructor(public readonly thesisId: string, message: string) {
    super(message);
    this.name = 'LatexBuildNotReadyError';
  }
}
