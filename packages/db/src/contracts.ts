export type EntityId = string;

export type ThesisScopedRecord = {
  thesisId: EntityId;
};

export type TimestampFields = {
  createdAt: string;
  updatedAt: string;
};

export type PersistedRecord = {
  id: EntityId;
} & TimestampFields;

export type ThesisLifecycleState =
  | 'draft'
  | 'intake'
  | 'active'
  | 'blocked'
  | 'review'
  | 'completed';

export type ThesisRecord = TimestampFields & {
  id: EntityId;
  title: string;
  slug: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  defaultLanguage: string;
  currentState: ThesisLifecycleState;
  latestStatusAt: string;
  nextStepSummary: string;
  activeImportId: EntityId | null;
  activeBuildRunId: EntityId | null;
};

export type ThesisStateRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  state: ThesisLifecycleState;
  source: string;
  statusSummary: string;
  blockersJson: string;
  transitionedFrom: ThesisLifecycleState | null;
  transitionedAt: string;
  isCurrent: boolean;
};

export type WorkflowTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done';

export type WorkflowTaskRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  parentTaskId: EntityId | null;
  title: string;
  intent: string;
  status: WorkflowTaskStatus;
  priority: number;
  sortOrder: number;
  dueAt: string | null;
  activeCheckpointId: EntityId | null;
};

export type WorkflowTaskCheckpointRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  taskId: EntityId;
  label: string;
  summary: string;
  progressPercent: number;
  blocker: string | null;
  checkpointedAt: string;
};

export type WorkflowPackStatus = 'pending' | 'in_progress' | 'blocked' | 'completed';

export type WorkflowPackRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  name: string;
  description: string;
  status: WorkflowPackStatus;
  currentStepId: EntityId | null;
};

export type WorkflowStepRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  workflowPackId: EntityId;
  title: string;
  description: string;
  status: WorkflowPackStatus;
  stepOrder: number;
};

export type CheckpointRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  label: string | null;
  note: string | null;
  scope: string;
  reason: string;
  snapshotPath: string | null;
  createdBy: string;
  checkpointedAt: string;
};

export type FeedbackSource = 'user' | 'system' | 'qa' | 'compliance';

export type FeedbackEntryRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  sourceType: FeedbackSource;
  body: string;
  summary: string | null;
  recordedAt: string;
};

export type IntakeStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
export type SourceFormat = 'latex' | 'docx' | 'pdf' | 'unknown';

export type IntakeJobRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  sourceFormat: SourceFormat;
  status: IntakeStatus;
  importRootPath: string;
  detectedEntrypoint: string | null;
  reportJson: string;
  warningsJson: string;
  recommendationsJson: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type ProvenanceKind = 'latex' | 'docx' | 'pdf' | 'unavailable';
export type NormalizedNodeType = 'document' | 'chapter' | 'section' | 'subsection' | 'paragraph' | 'claim';

export type NormalizedNodeRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  intakeJobId: EntityId | null;
  parentNodeId: EntityId | null;
  nodeType: NormalizedNodeType;
  title: string | null;
  content: string | null;
  ordinal: number;
  sourcePath: string | null;
  sourceStart: string | null;
  sourceEnd: string | null;
  provenanceKind: ProvenanceKind;
  provenanceJson: string;
};

export type SourceStatus = 'registered' | 'ingesting' | 'ready' | 'degraded' | 'failed';
export type SourceType = 'book' | 'article' | 'web' | 'pdf' | 'note' | 'other';

export type SourceRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  sourceType: SourceType;
  title: string;
  authorsJson: string;
  publicationYear: number | null;
  locator: string | null;
  status: SourceStatus;
  ingestMetadataJson: string;
};

export type EvidenceStatus = 'captured' | 'needs_review' | 'rejected';

export type EvidenceFragmentRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  sourceId: EntityId;
  normalizedNodeId: EntityId | null;
  taskId: EntityId | null;
  locator: string | null;
  snippet: string;
  extractionMethod: string;
  confidence: number | null;
  status: EvidenceStatus;
  provenanceJson: string;
};

export type ClaimStatus = 'draft' | 'supported' | 'contested' | 'archived';

export type ClaimRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  normalizedNodeId: EntityId | null;
  text: string;
  status: ClaimStatus;
  supportSummary: string;
};

export type ClaimEvidenceLinkRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  claimId: EntityId;
  evidenceFragmentId: EntityId;
  rationale: string;
};

export type ZoteroMappingScope = 'thesis' | 'chapter' | 'source';

export type ZoteroMappingRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  normalizedNodeId: EntityId | null;
  sourceId: EntityId | null;
  scope: ZoteroMappingScope;
  libraryId: string;
  collectionKey: string | null;
  itemKey: string | null;
  normalizedDataJson: string;
  connectorStatus: string;
  lastSyncedAt: string | null;
};

export type PolicyProfileRecord = TimestampFields & {
  id: EntityId;
  institution: string;
  faculty: string;
  version: string;
  title: string;
  requiredSectionsJson: string;
  ruleDefinitionsJson: string;
  isActive: boolean;
};

export type RunStatus = 'queued' | 'running' | 'completed' | 'completed_with_warnings' | 'failed';

export type ComplianceRunRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  policyProfileId: EntityId;
  status: RunStatus;
  summaryJson: string;
  evaluatedRuleCount: number;
  warningRuleCount: number;
  skippedRuleCount: number;
  startedAt: string;
  completedAt: string | null;
};

export type ComplianceIssueRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  complianceRunId: EntityId;
  policyProfileId: EntityId;
  ruleId: string;
  normalizedNodeId: EntityId | null;
  severity: 'warning' | 'violation';
  message: string;
  remediation: string | null;
  disposition: 'pass' | 'violation' | 'warning' | 'skipped';
};

export type AcademicQaRunRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  status: RunStatus;
  assessedScopeJson: string;
  skippedScopeJson: string;
  summaryJson: string;
  startedAt: string;
  completedAt: string | null;
};

export type AcademicQaIssueRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  academicQaRunId: EntityId;
  claimId: EntityId | null;
  normalizedNodeId: EntityId | null;
  category: 'evidence_gap' | 'citation_weakness' | 'methodology' | 'coherence';
  severity: 'warning' | 'issue';
  message: string;
  rationale: string;
  remediation: string | null;
  triggeringCondition: string;
};

export type BuildRunRecord = TimestampFields & {
  id: EntityId;
  thesisId: EntityId;
  checkpointId: EntityId | null;
  status: RunStatus;
  engine: string;
  artifactPath: string | null;
  diagnosticsJson: string;
  bibliographyStatus: string;
  startedAt: string;
  completedAt: string | null;
  isLatestSuccessful: boolean;
};

export interface Repository<TRecord> {
  findById(id: EntityId): Promise<TRecord | null>;
  listByThesisId?(thesisId: EntityId): Promise<TRecord[]>;
}

export interface PersistenceHelpers {
  createId(): EntityId;
  now(): string;
}

export interface ThesisRepository extends Repository<ThesisRecord> {}
export interface ThesisStateRepository extends Repository<ThesisStateRecord> {}
export interface WorkflowTaskRepository extends Repository<WorkflowTaskRecord> {}
export interface WorkflowTaskCheckpointRepository
  extends Repository<WorkflowTaskCheckpointRecord> {}
export interface WorkflowPackRepository extends Repository<WorkflowPackRecord> {}
export interface WorkflowStepRepository extends Repository<WorkflowStepRecord> {}
export interface CheckpointRepository extends Repository<CheckpointRecord> {}
export interface FeedbackEntryRepository extends Repository<FeedbackEntryRecord> {}
export interface IntakeJobRepository extends Repository<IntakeJobRecord> {}
export interface NormalizedNodeRepository extends Repository<NormalizedNodeRecord> {}
export interface SourceRepository extends Repository<SourceRecord> {}
export interface EvidenceFragmentRepository extends Repository<EvidenceFragmentRecord> {}
export interface ClaimRepository extends Repository<ClaimRecord> {}
export interface ClaimEvidenceLinkRepository extends Repository<ClaimEvidenceLinkRecord> {}
export interface ZoteroMappingRepository extends Repository<ZoteroMappingRecord> {}
export interface PolicyProfileRepository extends Repository<PolicyProfileRecord> {
  findActive(): Promise<PolicyProfileRecord | null>;
}
export interface ComplianceRunRepository extends Repository<ComplianceRunRecord> {}
export interface ComplianceIssueRepository extends Repository<ComplianceIssueRecord> {}
export interface AcademicQaRunRepository extends Repository<AcademicQaRunRecord> {}
export interface AcademicQaIssueRepository extends Repository<AcademicQaIssueRecord> {}
export interface BuildRunRepository extends Repository<BuildRunRecord> {}

export interface DomainRepositories {
  theses: ThesisRepository;
  thesisStates: ThesisStateRepository;
  workflowTasks: WorkflowTaskRepository;
  workflowTaskCheckpoints: WorkflowTaskCheckpointRepository;
  workflowPacks: WorkflowPackRepository;
  workflowSteps: WorkflowStepRepository;
  checkpoints: CheckpointRepository;
  feedbackEntries: FeedbackEntryRepository;
  intakeJobs: IntakeJobRepository;
  normalizedNodes: NormalizedNodeRepository;
  sources: SourceRepository;
  evidenceFragments: EvidenceFragmentRepository;
  claims: ClaimRepository;
  claimEvidenceLinks: ClaimEvidenceLinkRepository;
  zoteroMappings: ZoteroMappingRepository;
  policyProfiles: PolicyProfileRepository;
  complianceRuns: ComplianceRunRepository;
  complianceIssues: ComplianceIssueRepository;
  academicQaRuns: AcademicQaRunRepository;
  academicQaIssues: AcademicQaIssueRepository;
  buildRuns: BuildRunRepository;
}

export interface DomainRepositoryRegistry {
  repositories: DomainRepositories;
  helpers: PersistenceHelpers;
}
