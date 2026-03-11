// thesis-registry — types, errors, and pure functions for thesis projects

export type ThesisLifecycleState =
  | 'draft'
  | 'intake'
  | 'active'
  | 'blocked'
  | 'review'
  | 'completed';

export type ThesisRecordPayload = {
  id: string;
  title: string;
  slug: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  defaultLanguage: string;
  currentState: ThesisLifecycleState;
  latestStatusAt: string;
  nextStepSummary: string;
  activeImportId: string | null;
  activeBuildRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThesisStatePayload = {
  id: string;
  thesisId: string;
  state: ThesisLifecycleState;
  source: string;
  statusSummary: string;
  blockers: string[];
  transitionedFrom: ThesisLifecycleState | null;
  transitionedAt: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ActiveWorkspacePayload = {
  intakeJobId: string;
  detectedFormat: SourceFormat;
  entrypoint: string | null;
  selectionMode: 'deterministic' | 'ambiguous' | 'missing' | null;
  nodeCount: number;
  rootNodeIds: string[];
  replacementOfIntakeJobId: string | null;
  replacedByIntakeJobId: string | null;
  recoverableCheckpointId: string | null;
  latestBuildRunId: string | null;
};

export type ThesisDetailPayload = {
  thesis: ThesisRecordPayload;
  state: ThesisLifecycleState;
  latestStatusAt: string;
  statusSummary: string;
  blockers: string[];
  nextStepSummary: string;
  checkpointCount: number;
  feedbackCount: number;
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: ActiveWorkspacePayload | null;
  transitions: ThesisStatePayload[];
};

export type CreateThesisInput = {
  title: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  defaultLanguage?: string;
};

export type UpdateThesisInput = Partial<Omit<CreateThesisInput, 'defaultLanguage'>> & {
  defaultLanguage?: string;
};

export type TransitionThesisInput = {
  state: ThesisLifecycleState;
  source: string;
  statusSummary: string;
  blockers?: string[];
  nextStepSummary?: string;
};

export type SourceFormat = 'latex' | 'docx' | 'pdf' | 'unknown';

// --- Errors ---

export class ThesisNotFoundError extends Error {
  constructor(public readonly thesisId: string) {
    super(`Thesis ${thesisId} was not found.`);
    this.name = 'ThesisNotFoundError';
  }
}

// --- Pure functions ---

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function generateThesisSlug(title: string, existingSlugs: Set<string>): string {
  const base = slugify(title);
  if (!existingSlugs.has(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (existingSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}
