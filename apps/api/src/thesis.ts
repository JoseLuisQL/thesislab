import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

import { asc, desc, eq } from 'drizzle-orm';

import {
  academicQaIssues,
  academicQaRuns,
  createDatabaseConnection,
  complianceIssues,
  complianceRuns,
  buildRuns,
  checkpoints,
  claimEvidenceLinks,
  claims,
  evidenceFragments,
  feedbackEntries,
  intakeJobs,
  normalizedNodes,
  policyProfiles,
  sources,
  zoteroMappings,
  type IntakeStatus,
  type SourceFormat,
  thesisStates,
  theses,
  type ThesisDbClient,
  type ThesisLifecycleState,
  workflowTasks,
} from '@thesis-research-os/db';

type ThesisBlockers = string[];

type IntakeReportRecommendation = {
  code: string;
  message: string;
  triggeredBy: string[];
};

type IntakeFailureDiagnostic = {
  code: string;
  message: string;
  detail?: string;
};

type IntakeFormatDetection = {
  format: SourceFormat;
  reason: string;
  matchedBy: string;
};

type IntakeReportReplacement = {
  isReimport?: boolean;
  replacesIntakeJobId?: string;
  recoverableCheckpointId?: string;
  supersedesWorkspace?: boolean;
  replacedByIntakeJobId?: string;
  replacedByRecoverableCheckpointId?: string;
};

type IntakeReportSummary = {
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
    includeGraph: {
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
      cycles: Array<{
        path: string[];
      }>;
    } | null;
    outline: Array<{
      id: string;
      title: string | null;
      level: number;
      nodeType: string;
      sourcePath: string | null;
      anchor: {
        start: string | null;
        end: string | null;
      };
    }>;
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

type LatexStructureSelection = NonNullable<IntakeReportSummary['structureSummary']>['selection'];

type LatexStructureGraph = NonNullable<NonNullable<IntakeReportSummary['structureSummary']>['includeGraph']>;

type BaseLatexStructureNode = {
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

type LatexStructureNode = BaseLatexStructureNode & {
  normalizedNodeId: string;
};

type LatexStructureSnapshot = {
  entrypoint: string | null;
  selection: LatexStructureSelection;
  includeGraph: LatexStructureGraph | null;
  outline: LatexStructureNode[];
};

type LatexEditTarget = {
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

type LatexCheckpointFileSnapshot = {
  relativePath: string;
  content: string;
  sha256: string;
};

type LatexCheckpointSnapshot = {
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

type LatexEditPayload = {
  thesisId: string;
  intakeJobId: string;
  checkpoint: ThesisCheckpointPayload;
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
    changedRange: {
      startLine: number;
      endLine: number;
    };
    sha256Before: string;
    sha256After: string;
    unchangedContext: {
      before: boolean;
      after: boolean;
    };
  }>;
  structure: LatexStructureSnapshot;
};

type LatexRestorePayload = {
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

type LatexBuildEngine = 'latexmk';

type BibliographyConfiguration = {
  mode: 'bibliography' | 'biblatex' | 'unsupported' | 'none';
  inputs: string[];
  missingInputs: string[];
  commands: Array<'bibtex' | 'biber'>;
  status: 'not_required' | 'ready' | 'missing_inputs' | 'unsupported';
  detail: string;
};

type LatexDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  category: 'compile' | 'bibliography' | 'toolchain';
  message: string;
  filePath: string | null;
  line: number | null;
  mappingStatus: 'mapped' | 'unmapped';
  mappingReason: string | null;
  source: string;
};

type LatexBuildPayload = {
  thesisId: string;
  buildRun: LatexBuildRunPayload;
  history: {
    latestAttempted: LatexBuildRunPayload;
    latestSuccessful: LatexBuildRunPayload | null;
    runs: LatexBuildRunPayload[];
  };
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

type IntakeExtractionStatus = IntakeReportSummary['extractionStatus'];
type IntakeNormalizationStatus = IntakeReportSummary['normalizationStatus'];
type InsertNormalizedNode = typeof normalizedNodes.$inferInsert;
type StructureSummary = NonNullable<IntakeReportSummary['structureSummary']>;
type StructureOutlineEntry = StructureSummary['outline'][number];

const TERMINAL_INTAKE_STATUSES: IntakeStatus[] = ['succeeded', 'partial', 'failed'];

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
  blockers: ThesisBlockers;
  transitionedFrom: ThesisLifecycleState | null;
  transitionedAt: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ThesisDetailPayload = {
  thesis: ThesisRecordPayload;
  state: ThesisLifecycleState;
  latestStatusAt: string;
  statusSummary: string;
  blockers: ThesisBlockers;
  nextStepSummary: string;
  checkpointCount: number;
  feedbackCount: number;
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: ActiveWorkspacePayload | null;
  transitions: ThesisStatePayload[];
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

export type ThesisCheckpointPayload = {
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

export type ThesisFeedbackPayload = {
  id: string;
  thesisId: string;
  sourceType: 'user' | 'system' | 'qa' | 'compliance';
  body: string;
  summary: string | null;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
};

type ThesisFeedbackSource = ThesisFeedbackPayload['sourceType'];

export type ThesisResumePayload = {
  thesis: ThesisRecordPayload;
  state: ThesisLifecycleState;
  latestStatusAt: string;
  statusSummary: string;
  blockers: ThesisBlockers;
  nextAction: string;
  latestCheckpoint: ThesisCheckpointPayload | null;
  recentFeedback: ThesisFeedbackPayload[];
  activeWorkspace: ActiveWorkspacePayload | null;
  latestComplianceRun: ComplianceRunPayload | null;
  latestAcademicQaRun: AcademicQaRunPayload | null;
  recentComplianceFindings: ComplianceIssuePayload[];
  recentAcademicQaFindings: AcademicQaIssuePayload[];
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

export type CreateIntakeJobInput = {
  importRootPath: string;
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
  blockers?: ThesisBlockers;
  nextStepSummary?: string;
};

export type CreateCheckpointInput = {
  label?: string | null;
  note?: string | null;
  scope: string;
  reason: string;
  snapshotPath?: string | null;
  snapshotMetadata?: Record<string, unknown> | null;
  createdBy: string;
  checkpointedAt?: string;
};

export type CreateFeedbackInput = {
  sourceType: 'user' | 'system' | 'qa' | 'compliance';
  body: string;
  summary?: string | null;
  recordedAt?: string;
};

export type WorkflowTaskPayload = {
  id: string;
  thesisId: string;
  parentTaskId: string | null;
  title: string;
  intent: string;
  status: string;
  priority: number;
  sortOrder: number;
  dueAt: string | null;
  activeCheckpointId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowTaskInput = {
  parentTaskId?: string | null;
  title: string;
  intent: string;
  status?: string;
  priority?: number;
  sortOrder?: number;
  dueAt?: string | null;
};

export type EvidenceContextSetupPayload = {
  thesisId: string;
  activeImportId: string | null;
  normalizedNodes: NormalizedNodePayload[];
  tasks: WorkflowTaskPayload[];
};

type SourceIngestStatus = 'not_started' | 'queued' | 'succeeded' | 'degraded' | 'failed';
type SourceDuplicateState = 'unique' | 'duplicate';
type PdfExtractionStatus = 'not_attempted' | 'succeeded' | 'degraded' | 'failed';

type ZoteroConnectorMode = 'mock' | 'test' | 'live';

export type ZoteroLibraryPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  name: string;
  kind: 'user' | 'group';
  itemCount: number;
  collectionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ZoteroCollectionPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  libraryId: string;
  libraryKey: string;
  parentCollectionKey: string | null;
  name: string;
  path: string[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ZoteroItemPayload = {
  id: string;
  key: string;
  mode: ZoteroConnectorMode;
  externalId: string;
  libraryId: string;
  libraryKey: string;
  collectionKeys: string[];
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
  createdAt: string;
  updatedAt: string;
};

type ZoteroMockLibraryRecord = {
  key: string;
  name: string;
  kind: 'user' | 'group';
  itemCount: number;
  collectionCount: number;
};

type ZoteroMockCollectionRecord = {
  key: string;
  libraryKey: string;
  parentCollectionKey: string | null;
  name: string;
  path: string[];
  itemCount: number;
};

type ZoteroMockItemRecord = {
  key: string;
  libraryKey: string;
  collectionKeys: string[];
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
};

type ZoteroMockDataset = {
  libraries: ZoteroMockLibraryRecord[];
  collections: ZoteroMockCollectionRecord[];
  items: ZoteroMockItemRecord[];
};

const DEFAULT_ZOTERO_CONNECTOR_MODE: ZoteroConnectorMode = 'mock';

const DEFAULT_ZOTERO_DATASET: ZoteroMockDataset = {
  libraries: [
    {
      key: 'lib-user-main',
      name: 'Main Research Library',
      kind: 'user',
      itemCount: 3,
      collectionCount: 2,
    },
    {
      key: 'lib-group-thesis-lab',
      name: 'Thesis Lab Group Library',
      kind: 'group',
      itemCount: 1,
      collectionCount: 1,
    },
  ],
  collections: [
    {
      key: 'col-ml-core',
      libraryKey: 'lib-user-main',
      parentCollectionKey: null,
      name: 'Machine Learning Core',
      path: ['Machine Learning Core'],
      itemCount: 2,
    },
    {
      key: 'col-ml-methods',
      libraryKey: 'lib-user-main',
      parentCollectionKey: 'col-ml-core',
      name: 'Methods',
      path: ['Machine Learning Core', 'Methods'],
      itemCount: 1,
    },
    {
      key: 'col-group-bibliography',
      libraryKey: 'lib-group-thesis-lab',
      parentCollectionKey: null,
      name: 'Shared Bibliography',
      path: ['Shared Bibliography'],
      itemCount: 1,
    },
  ],
  items: [
    {
      key: 'item-traceability-2024',
      libraryKey: 'lib-user-main',
      collectionKeys: ['col-ml-core'],
      itemType: 'journalArticle',
      title: 'Traceable Evidence in AI Research',
      creators: ['Ada Lovelace', 'Grace Hopper'],
      date: '2024',
    },
    {
      key: 'item-methods-2023',
      libraryKey: 'lib-user-main',
      collectionKeys: ['col-ml-core', 'col-ml-methods'],
      itemType: 'book',
      title: 'Research Methods for Thesis Workflows',
      creators: ['Elena Method'],
      date: '2023',
    },
    {
      key: 'item-zotero-schema-2026',
      libraryKey: 'lib-user-main',
      collectionKeys: [],
      itemType: 'report',
      title: 'Stable Zotero Normalization Schema',
      creators: ['Schema Team'],
      date: '2026-02-01',
    },
    {
      key: 'item-group-citations-2022',
      libraryKey: 'lib-group-thesis-lab',
      collectionKeys: ['col-group-bibliography'],
      itemType: 'conferencePaper',
      title: 'Collaborative Citation Workflows',
      creators: ['María Citation'],
      date: '2022',
    },
  ],
};

export type SourcePayload = {
  id: string;
  thesisId: string;
  sourceType: 'book' | 'article' | 'web' | 'pdf' | 'note' | 'other';
  title: string;
  authors: string[];
  publicationYear: number | null;
  locator: string | null;
  status: 'registered' | 'ingesting' | 'ready' | 'degraded' | 'failed';
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

export type EvidenceFragmentPayload = {
  id: string;
  thesisId: string;
  sourceId: string;
  normalizedNodeId: string | null;
  taskId: string | null;
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

export type ClaimPayload = {
  id: string;
  thesisId: string;
  normalizedNodeId: string | null;
  text: string;
  status: 'draft' | 'supported' | 'contested' | 'archived';
  supportSummary: string;
  linkedEvidenceCount: number;
  linkedEvidenceIds: string[];
  hasEvidence: boolean;
  traceability: {
    evidenceFragments: Array<{
      id: string;
      locator: string | null;
      snippet: string;
      extractionMethod: string;
      rationale: string;
      source: {
        id: string;
        title: string;
        sourceType: string;
        status: string;
      };
    }>;
    sourceIds: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type ListZoteroItemsInput = {
  libraryKey?: string | null;
  collectionKey?: string | null;
};

export type SearchZoteroItemsInput = {
  query: string;
  libraryKey?: string | null;
  collectionKey?: string | null;
};

export type ZoteroMappingScope = 'thesis' | 'chapter';

export type ZoteroMappingPayload = {
  id: string;
  thesisId: string;
  normalizedNodeId: string | null;
  scope: ZoteroMappingScope;
  libraryId: string;
  collectionKey: string | null;
  itemKey: string | null;
  normalizedData: Record<string, unknown>;
  connectorStatus: 'ready' | 'degraded';
  degraded: {
    isDegraded: boolean;
    message: string | null;
    code: string | null;
  };
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PolicyRuleDisposition = 'pass' | 'violation' | 'warning' | 'skipped';

type PolicyRuleDefinition = {
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

type ComplianceRunSummary = {
  degradedConfidence: boolean;
  warnings: string[];
  evaluatedNodeCount: number;
  structureSelectionMode: string | null;
};

type ComplianceRuleResultPayload = {
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

export type CreateZoteroMappingInput = {
  scope: ZoteroMappingScope;
  normalizedNodeId?: string | null;
  libraryId: string;
  collectionKey?: string | null;
  itemKey?: string | null;
};

export type RefreshZoteroMappingInput = {
  libraryId?: string;
  collectionKey?: string | null;
  itemKey?: string | null;
};

export type RegisterSourceInput = {
  sourceType: 'book' | 'article' | 'web' | 'pdf' | 'note' | 'other';
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

export type CreateClaimInput = {
  text: string;
  status?: 'draft' | 'supported' | 'contested' | 'archived';
  supportSummary?: string;
  normalizedNodeId?: string | null;
};

export type LinkClaimEvidenceInput = {
  evidenceFragmentIds: string[];
  rationale: string;
};

type ClaimEvidenceLinkRecord = typeof claimEvidenceLinks.$inferSelect;

type ClaimEvidenceOrderingMetadata = {
  evidenceFragmentIdOrder: string[];
};

function parseClaimEvidenceOrderingMetadata(rawValue: string | null): ClaimEvidenceOrderingMetadata {
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

function serializeClaimEvidenceOrderingMetadata(metadata: ClaimEvidenceOrderingMetadata): string {
  return JSON.stringify({
    evidenceFragmentIdOrder: metadata.evidenceFragmentIdOrder,
  } satisfies ClaimEvidenceOrderingMetadata);
}

export class SourceNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly sourceId: string) {
    super(`Source ${sourceId} was not found for thesis ${thesisId}.`);
    this.name = 'SourceNotFoundError';
  }
}

export class SourceRegistrationConflictError extends Error {
  constructor(public readonly thesisId: string, message: string) {
    super(message);
    this.name = 'SourceRegistrationConflictError';
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

export class ThesisNotFoundError extends Error {
  constructor(thesisId: string) {
    super(`Thesis ${thesisId} was not found.`);
    this.name = 'ThesisNotFoundError';
  }
}

export class IntakeJobNotFoundError extends Error {
  constructor(thesisId: string, intakeJobId: string) {
    super(`Intake job ${intakeJobId} was not found for thesis ${thesisId}.`);
    this.name = 'IntakeJobNotFoundError';
  }
}

export class IntakeBoundaryViolationError extends Error {
  constructor(public readonly thesisId: string, public readonly importRootPath: string, public readonly resolvedPath: string) {
    super(
      `Import path ${importRootPath} resolves outside thesis ${thesisId} workspace boundary: ${resolvedPath}.`,
    );
    this.name = 'IntakeBoundaryViolationError';
  }
}

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

export class ZoteroMappingNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly mappingId: string) {
    super(`Zotero mapping ${mappingId} was not found for thesis ${thesisId}.`);
    this.name = 'ZoteroMappingNotFoundError';
  }
}

export class PolicyProfileNotFoundError extends Error {
  constructor() {
    super('No active policy profile is configured.');
    this.name = 'PolicyProfileNotFoundError';
  }
}

export class AcademicQaRunNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly academicQaRunId: string) {
    super(`Academic QA run ${academicQaRunId} was not found for thesis ${thesisId}.`);
    this.name = 'AcademicQaRunNotFoundError';
  }
}

export class ThesisLifecycleService {
  constructor(private readonly db: ThesisDbClient) {}

  async listZoteroLibraries(): Promise<ZoteroLibraryPayload[]> {
    const connector = createZoteroMockConnector();
    return connector.listLibraries();
  }

  async listZoteroCollections(libraryKey?: string | null): Promise<ZoteroCollectionPayload[]> {
    const connector = createZoteroMockConnector();
    return connector.listCollections({ libraryKey: libraryKey ?? null });
  }

  async listZoteroItems(input: ListZoteroItemsInput = {}): Promise<ZoteroItemPayload[]> {
    const connector = createZoteroMockConnector();
    return connector.listItems({
      libraryKey: input.libraryKey ?? null,
      collectionKey: input.collectionKey ?? null,
    });
  }

  async searchZoteroItems(input: SearchZoteroItemsInput): Promise<ZoteroItemPayload[]> {
    const connector = createZoteroMockConnector();
    return connector.searchItems({
      query: input.query,
      libraryKey: input.libraryKey ?? null,
      collectionKey: input.collectionKey ?? null,
    });
  }

  async getActivePolicyProfile(): Promise<PolicyProfilePayload> {
    await ensureSeedPolicyProfile(this.db);

    const record = await this.db.query.policyProfiles.findFirst({
      where: (fields, operators) => operators.eq(fields.isActive, true),
    });

    if (!record) {
      throw new PolicyProfileNotFoundError();
    }

    return this.mapPolicyProfileRecord(record);
  }

  async createComplianceRun(thesisId: string): Promise<ComplianceRunPayload> {
    const thesis = await this.requireThesis(thesisId);
    const policyProfile = await this.getActivePolicyProfile();
    const activeWorkspace = await this.getActiveWorkspace(thesis.id, thesis.activeImportId);
    const allNodes = thesis.activeImportId ? await this.listNormalizedNodes(thesisId, thesis.activeImportId) : [];
    const sectionNodes = allNodes.filter((node) => ['chapter', 'section', 'subsection'].includes(node.nodeType));
    const degradedConfidence = activeWorkspace?.detectedFormat === 'pdf';
    const degradedWarnings = degradedConfidence
      ? ['La confianza de estructura es baja; algunas reglas se degradaron a advertencias o se omitieron.']
      : [];

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const evaluatedRuleResults = evaluatePolicyRules({
      thesisId,
      policyProfile,
      sectionNodes,
      degradedConfidence,
    }).map((result) => ({
      ...result,
      issue: result.issue
        ? {
            ...result.issue,
            complianceRunId: runId,
          }
        : null,
    }));
    const completedAt = new Date().toISOString();
    const counts = {
      evaluated: evaluatedRuleResults.filter((result) => result.disposition !== 'skipped').length,
      warnings: evaluatedRuleResults.filter((result) => result.disposition === 'warning').length,
      skipped: evaluatedRuleResults.filter((result) => result.disposition === 'skipped').length,
      violations: evaluatedRuleResults.filter((result) => result.disposition === 'violation').length,
    };
    const status = counts.violations > 0
      ? 'completed'
      : counts.warnings > 0
        ? 'completed_with_warnings'
        : 'completed';
    const summary: ComplianceRunSummary = {
      degradedConfidence,
      warnings: degradedWarnings,
      evaluatedNodeCount: sectionNodes.length,
      structureSelectionMode: activeWorkspace?.selectionMode ?? null,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(complianceRuns).values({
        id: runId,
        thesisId,
        policyProfileId: policyProfile.id,
        status,
        summaryJson: JSON.stringify({
          ...summary,
          ruleResults: evaluatedRuleResults,
          policyProfileVersion: policyProfile.version,
          policyInstitutionId: policyProfile.institutionId,
        }),
        evaluatedRuleCount: counts.evaluated,
        warningRuleCount: counts.warnings,
        skippedRuleCount: counts.skipped,
        startedAt,
        completedAt,
        createdAt: startedAt,
        updatedAt: completedAt,
      });

      const issueRows = evaluatedRuleResults
        .filter((result) => result.issue)
        .map((result) => result.issue!);

      if (issueRows.length > 0) {
        await tx.insert(complianceIssues).values(issueRows);
      }

      await tx
        .update(theses)
        .set({
          latestStatusAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(theses.id, thesisId));
    });

    return this.getComplianceRun(thesisId, runId);
  }

  async createAcademicQaRun(thesisId: string): Promise<AcademicQaRunPayload> {
    const thesis = await this.requireThesis(thesisId);
    const activeWorkspace = await this.getActiveWorkspace(thesis.id, thesis.activeImportId);
    const allNodes = thesis.activeImportId ? await this.listNormalizedNodes(thesisId, thesis.activeImportId) : [];
    const sectionNodes = allNodes.filter((node) => ['chapter', 'section', 'subsection'].includes(node.nodeType));
    const claimsPayload = await this.listClaims(thesisId);
    const evidenceFragments = await this.listEvidenceFragments(thesisId);
    const zoteroMappings = await this.listZoteroMappings(thesisId);
    const evidenceById = new Map(evidenceFragments.map((fragment) => [fragment.id, fragment]));
    const sectionById = new Map(sectionNodes.map((node) => [node.id, node]));
    const sectionEvidenceIds = new Map<string, string[]>();

    for (const fragment of evidenceFragments) {
      if (!fragment.normalizedNodeId) {
        continue;
      }

      const current = sectionEvidenceIds.get(fragment.normalizedNodeId) ?? [];
      current.push(fragment.id);
      sectionEvidenceIds.set(fragment.normalizedNodeId, current);
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const issueRows: typeof academicQaIssues.$inferInsert[] = [];
    const skippedScope: AcademicQaRunPayload['skippedScope'] = [];

    for (const claim of claimsPayload) {
      if (!claim.normalizedNodeId) {
        skippedScope.push({ entityType: 'claim', entityId: claim.id, reason: 'Claim is not linked to a thesis section.' });
        continue;
      }

      if (!sectionById.has(claim.normalizedNodeId)) {
        skippedScope.push({
          entityType: 'claim',
          entityId: claim.id,
          reason: 'Claim references a section that is not available in the active workspace.',
        });
        continue;
      }

      if (claim.linkedEvidenceCount === 0) {
        issueRows.push(this.buildAcademicQaIssueRecord({
          thesisId,
          academicQaRunId: runId,
          claimId: claim.id,
          normalizedNodeId: claim.normalizedNodeId,
          category: 'evidence-gap',
          severity: 'issue',
          message: 'El claim no tiene evidencia vinculada.',
          rationale: 'No hay fragmentos de evidencia enlazados al claim, por lo que no puede trazarse soporte verificable.',
          remediation: 'Vincula al menos un fragmento de evidencia verificable o reformula el claim para reflejar su nivel actual de soporte.',
          triggeringCondition: 'zero-evidence',
        }));
        continue;
      }

      const linkedEvidence = claim.linkedEvidenceIds
        .map((id) => evidenceById.get(id))
        .filter((value): value is EvidenceFragmentPayload => value !== undefined);
      const uniqueSources = new Set(linkedEvidence.map((fragment) => fragment.source.id));

      if (uniqueSources.size < 2) {
        issueRows.push(this.buildAcademicQaIssueRecord({
          thesisId,
          academicQaRunId: runId,
          claimId: claim.id,
          normalizedNodeId: claim.normalizedNodeId,
          category: 'citation-weakness',
          severity: 'warning',
          message: 'El claim depende de una base bibliográfica débil.',
          rationale: 'El soporte trazable del claim proviene de menos de dos fuentes distintas, lo que debilita la solidez citacional.',
          remediation: 'Añade una segunda fuente independiente o conecta una referencia bibliográfica complementaria al mismo claim.',
          triggeringCondition: 'weak-citation-support',
        }));
      }
    }

    for (const section of sectionNodes) {
      const title = section.title?.trim() ?? '';
      const lowerTitle = title.toLocaleLowerCase();
      const sectionEvidenceCount = (sectionEvidenceIds.get(section.id) ?? []).length;
      const hasZoteroMapping = zoteroMappings.some((mapping) => mapping.normalizedNodeId === section.id);

      if (lowerTitle.includes('metodolog') && section.nodeType === 'section' && sectionEvidenceCount === 0) {
        issueRows.push(this.buildAcademicQaIssueRecord({
          thesisId,
          academicQaRunId: runId,
          claimId: null,
          normalizedNodeId: section.id,
          category: 'methodology',
          severity: 'issue',
          message: 'La sección metodológica carece de soporte verificable.',
          rationale: 'La metodología aparece en la estructura activa pero no tiene evidencia ni fuentes contextualizadas para justificar el enfoque descrito.',
          remediation: 'Añade evidencia de diseño metodológico, referencias de técnicas empleadas o notas de validación asociadas a esta sección.',
          triggeringCondition: 'methodology-no-support',
        }));
      }

      if ((lowerTitle.includes('result') || lowerTitle.includes('hallazgo')) && section.nodeType === 'section' && !hasZoteroMapping) {
        issueRows.push(this.buildAcademicQaIssueRecord({
          thesisId,
          academicQaRunId: runId,
          claimId: null,
          normalizedNodeId: section.id,
          category: 'coherence',
          severity: 'warning',
          message: 'La sección de resultados no muestra un anclaje bibliográfico suficiente.',
          rationale: 'La sección evaluada no tiene vínculos bibliográficos asociados, lo que dificulta verificar la coherencia entre hallazgos y marco de referencia.',
          remediation: 'Asocia referencias Zotero o evidencia contextual que conecte los resultados con el marco teórico y la discusión.',
          triggeringCondition: 'missing-bibliography-linkage',
        }));
      }
    }

    if (!activeWorkspace) {
      skippedScope.push({ entityType: 'section', entityId: 'active-workspace', reason: 'No active normalized workspace is available for academic QA.' });
    }

    const completedAt = new Date().toISOString();
    const findingsByCategory = issueRows.reduce<Record<AcademicQaIssueCategory, number>>((accumulator, issue) => {
      const key = this.normalizeAcademicQaIssueCategory(issue.category);
      accumulator[key] += 1;
      return accumulator;
    }, {
      'evidence-gap': 0,
      'citation-weakness': 0,
      methodology: 0,
      coherence: 0,
    });

    const assessedClaimIds = claimsPayload.filter((claim) => claim.normalizedNodeId && sectionById.has(claim.normalizedNodeId)).map((claim) => claim.id);
    const assessedScope = {
      claimIds: assessedClaimIds,
      normalizedNodeIds: sectionNodes.map((node) => node.id),
      counts: {
        claims: assessedClaimIds.length,
        sections: sectionNodes.length,
      },
    };
    const status = issueRows.some((issue) => issue.severity === 'issue') ? 'completed' : 'completed_with_warnings';
    const summary = {
      findingsByCategory,
      assessedClaimCount: assessedScope.counts.claims,
      assessedSectionCount: assessedScope.counts.sections,
      skippedCount: skippedScope.length,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(academicQaRuns).values({
        id: runId,
        thesisId,
        status,
        assessedScopeJson: JSON.stringify(assessedScope),
        skippedScopeJson: JSON.stringify(skippedScope),
        summaryJson: JSON.stringify(summary),
        startedAt,
        completedAt,
        createdAt: startedAt,
        updatedAt: completedAt,
      });

      if (issueRows.length > 0) {
        await tx.insert(academicQaIssues).values(issueRows.map((issue) => ({
          ...issue,
          createdAt: startedAt,
          updatedAt: completedAt,
        })));
      }

      await tx
        .update(theses)
        .set({ latestStatusAt: completedAt, updatedAt: completedAt })
        .where(eq(theses.id, thesisId));
    });

    return this.getAcademicQaRun(thesisId, runId);
  }

  async listAcademicQaRuns(thesisId: string): Promise<AcademicQaRunPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(academicQaRuns)
      .where(eq(academicQaRuns.thesisId, thesisId))
      .orderBy(desc(academicQaRuns.startedAt), asc(academicQaRuns.id))
      .all();

    return Promise.all(rows.map((row) => this.mapAcademicQaRunRecord(row)));
  }

  async getAcademicQaRun(thesisId: string, academicQaRunId: string): Promise<AcademicQaRunPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.academicQaRuns.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, academicQaRunId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new AcademicQaRunNotFoundError(thesisId, academicQaRunId);
    }

    return this.mapAcademicQaRunRecord(row);
  }

  async listComplianceRuns(thesisId: string): Promise<ComplianceRunPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(complianceRuns)
      .where(eq(complianceRuns.thesisId, thesisId))
      .orderBy(desc(complianceRuns.startedAt), asc(complianceRuns.id))
      .all();

    return Promise.all(rows.map((row) => this.mapComplianceRunRecord(row)));
  }

  async getComplianceRun(thesisId: string, complianceRunId: string): Promise<ComplianceRunPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.complianceRuns.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, complianceRunId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new ThesisNotFoundError(thesisId);
    }

    return this.mapComplianceRunRecord(row);
  }

  async createZoteroMapping(thesisId: string, input: CreateZoteroMappingInput): Promise<ZoteroMappingPayload> {
    await this.requireThesis(thesisId);

    if (input.scope === 'chapter') {
      if (!input.normalizedNodeId) {
        throw new EvidenceContextScopeError(thesisId, 'Chapter Zotero mappings require a chapter normalizedNodeId.');
      }

      const normalizedNode = await this.requireNormalizedNode(thesisId, input.normalizedNodeId);
      if (normalizedNode.nodeType !== 'chapter') {
        throw new EvidenceContextScopeError(
          thesisId,
          `Normalized node ${input.normalizedNodeId} must be a chapter to create a chapter Zotero mapping.`,
        );
      }
    }

    if (input.scope === 'thesis' && input.normalizedNodeId) {
      throw new EvidenceContextScopeError(thesisId, 'Thesis Zotero mappings cannot target a chapter node.');
    }

    const connector = createZoteroMockConnector();
    const now = new Date().toISOString();
    const normalizedRecord = connector.resolveNormalizedMapping({
      libraryId: input.libraryId,
      collectionKey: input.collectionKey ?? null,
      itemKey: input.itemKey ?? null,
    });

    const mappingId = randomUUID();
    await this.db.insert(zoteroMappings).values({
      id: mappingId,
      thesisId,
      normalizedNodeId: input.scope === 'chapter' ? input.normalizedNodeId ?? null : null,
      sourceId: null,
      scope: input.scope,
      libraryId: input.libraryId,
      collectionKey: input.collectionKey ?? null,
      itemKey: input.itemKey ?? null,
      normalizedDataJson: JSON.stringify(normalizedRecord.normalizedData),
      connectorStatus: normalizeZoteroConnectorStatus(normalizedRecord.connectorStatus),
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return this.getZoteroMapping(thesisId, mappingId);
  }

  async listZoteroMappings(thesisId: string, scope?: ZoteroMappingScope, normalizedNodeId?: string | null): Promise<ZoteroMappingPayload[]> {
    await this.requireThesis(thesisId);

    if (normalizedNodeId) {
      await this.requireNormalizedNode(thesisId, normalizedNodeId);
    }

    const rows = await this.db
      .select()
      .from(zoteroMappings)
      .where(eq(zoteroMappings.thesisId, thesisId))
      .orderBy(desc(zoteroMappings.lastSyncedAt), asc(zoteroMappings.id))
      .all();

    return rows
      .filter((row) => {
        if (row.sourceId !== null) {
          return false;
        }

        if (scope && row.scope !== scope) {
          return false;
        }

        if (normalizedNodeId !== undefined) {
          return row.normalizedNodeId === normalizedNodeId;
        }

        return true;
      })
      .map((row) => this.mapZoteroMappingRecord(row));
  }

  async getZoteroMapping(thesisId: string, mappingId: string): Promise<ZoteroMappingPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.zoteroMappings.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, mappingId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row || row.sourceId !== null || (row.scope !== 'thesis' && row.scope !== 'chapter')) {
      throw new ZoteroMappingNotFoundError(thesisId, mappingId);
    }

    return this.mapZoteroMappingRecord(row);
  }

  async refreshZoteroMapping(thesisId: string, mappingId: string, input: RefreshZoteroMappingInput = {}): Promise<ZoteroMappingPayload> {
    const existing = await this.getZoteroMapping(thesisId, mappingId);
    const connector = createZoteroMockConnector();
    const now = new Date().toISOString();
    const libraryId = input.libraryId ?? existing.libraryId;
    const collectionKey = input.collectionKey === undefined ? existing.collectionKey : input.collectionKey;
    const itemKey = input.itemKey === undefined ? existing.itemKey : input.itemKey;
    const normalizedRecord = connector.resolveNormalizedMapping({
      libraryId,
      collectionKey,
      itemKey,
    });

    await this.db
      .update(zoteroMappings)
      .set({
        libraryId,
        collectionKey,
        itemKey,
        normalizedDataJson: JSON.stringify(normalizedRecord.normalizedData),
        connectorStatus: normalizeZoteroConnectorStatus(normalizedRecord.connectorStatus),
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(zoteroMappings.id, mappingId));

    return this.getZoteroMapping(thesisId, mappingId);
  }

  async listTheses(): Promise<ThesisDetailPayload[]> {
    const rows = await this.db
      .select()
      .from(theses)
      .orderBy(desc(theses.updatedAt), desc(theses.createdAt), asc(theses.id))
      .all();

    return Promise.all(rows.map((row) => this.getThesisDetail(row.id)));
  }

  async createThesis(input: CreateThesisInput): Promise<ThesisDetailPayload> {
    const now = new Date().toISOString();
    const thesisId = randomUUID();
    const defaultLanguage = input.defaultLanguage ?? process.env.THESIS_DEFAULT_LANGUAGE ?? 'es';
    const slug = await this.createUniqueSlug(input.title);
    const stateId = randomUUID();
    const statusSummary = 'Tesis registrada y lista para iniciar el flujo de trabajo local.';
    const nextStepSummary = 'Define el alcance inicial y registra el primer checkpoint de trabajo.';

    await this.db.insert(theses).values([
      {
        id: thesisId,
        title: input.title,
        slug,
        degreeProgram: input.degreeProgram,
        institution: input.institution,
        workspacePath: input.workspacePath,
        defaultLanguage,
        currentState: 'draft',
        latestStatusAt: now,
        nextStepSummary,
        activeImportId: null,
        activeBuildRunId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await this.db.insert(thesisStates).values([
      {
        id: stateId,
        thesisId,
        state: 'draft',
        source: 'system:create',
        statusSummary,
        blockersJson: JSON.stringify([]),
        transitionedFrom: null,
        transitionedAt: now,
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    return this.getThesisDetail(thesisId);
  }

  async getThesisDetail(thesisId: string): Promise<ThesisDetailPayload> {
    const thesis = await this.db.query.theses.findFirst({
      where: (fields, operators) => operators.eq(fields.id, thesisId),
    });

    if (!thesis) {
      throw new ThesisNotFoundError(thesisId);
    }

    const transitionRows = await this.db
      .select()
      .from(thesisStates)
      .where(eq(thesisStates.thesisId, thesisId))
      .orderBy(thesisStates.transitionedAt, thesisStates.createdAt)
      .all();

    const transitions = transitionRows
      .slice()
      .sort((left, right) => {
        if (left.transitionedAt === right.transitionedAt) {
          return left.id.localeCompare(right.id);
        }

        return right.transitionedAt.localeCompare(left.transitionedAt);
      })
      .map((transition) => this.mapStateRecord(transition));

    const currentTransition = transitions.find((transition) => transition.isCurrent) ?? transitions[0];
    const checkpoints = await this.listCheckpoints(thesisId);
    const feedbackEntries = await this.listFeedback(thesisId);
    const activeWorkspace = await this.getActiveWorkspace(thesis.id, thesis.activeImportId);

    return {
      thesis: this.mapThesisRecord(thesis),
      state: thesis.currentState as ThesisLifecycleState,
      latestStatusAt: thesis.latestStatusAt,
      statusSummary: currentTransition?.statusSummary ?? 'Sin estado registrado.',
      blockers: currentTransition?.blockers ?? [],
      nextStepSummary: thesis.nextStepSummary,
      checkpointCount: checkpoints.length,
      feedbackCount: feedbackEntries.length,
      latestCheckpointId: checkpoints[0]?.id ?? null,
      latestFeedbackId: feedbackEntries[0]?.id ?? null,
      activeWorkspace,
      transitions,
    };
  }

  async updateThesis(thesisId: string, input: UpdateThesisInput): Promise<ThesisDetailPayload> {
    const thesis = await this.db.query.theses.findFirst({
      where: (fields, operators) => operators.eq(fields.id, thesisId),
    });

    if (!thesis) {
      throw new ThesisNotFoundError(thesisId);
    }

    const now = new Date().toISOString();
    const title = input.title ?? thesis.title;

    await this.db
      .update(theses)
      .set({
        title,
        slug: title === thesis.title ? thesis.slug : await this.createUniqueSlug(title, thesis.id),
        degreeProgram: input.degreeProgram ?? thesis.degreeProgram,
        institution: input.institution ?? thesis.institution,
        workspacePath: input.workspacePath ?? thesis.workspacePath,
        defaultLanguage: input.defaultLanguage ?? thesis.defaultLanguage,
        updatedAt: now,
      })
      .where(eq(theses.id, thesisId));

    return this.getThesisDetail(thesisId);
  }

  async transitionThesis(thesisId: string, input: TransitionThesisInput): Promise<ThesisDetailPayload> {
    const thesis = await this.db.query.theses.findFirst({
      where: (fields, operators) => operators.eq(fields.id, thesisId),
    });

    if (!thesis) {
      throw new ThesisNotFoundError(thesisId);
    }

    const blockers = input.blockers ?? [];
    const now = new Date().toISOString();
    const priorState = thesis.currentState;

    await this.db
      .update(thesisStates)
      .set({
        isCurrent: false,
        updatedAt: now,
      })
      .where(eq(thesisStates.thesisId, thesisId));

    await this.db.insert(thesisStates).values({
      id: randomUUID(),
      thesisId,
      state: input.state,
      source: input.source,
      statusSummary: input.statusSummary,
      blockersJson: JSON.stringify(blockers),
      transitionedFrom: priorState,
      transitionedAt: now,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    await this.db
      .update(theses)
      .set({
        currentState: input.state,
        latestStatusAt: now,
        nextStepSummary: input.nextStepSummary ?? thesis.nextStepSummary,
        updatedAt: now,
      })
      .where(eq(theses.id, thesisId));

    return this.getThesisDetail(thesisId);
  }

  async createCheckpoint(thesisId: string, input: CreateCheckpointInput): Promise<ThesisCheckpointPayload> {
    await this.requireThesis(thesisId);

    const now = new Date().toISOString();
    const checkpointedAt = input.checkpointedAt ?? now;
    const id = randomUUID();

    await this.db.insert(checkpoints).values({
      id,
      thesisId,
      label: input.label ?? null,
      note: input.note ?? null,
      scope: input.scope,
      reason: input.reason,
      snapshotPath: input.snapshotPath ?? null,
      snapshotMetadataJson: JSON.stringify(input.snapshotMetadata ?? null),
      createdBy: input.createdBy,
      checkpointedAt,
      createdAt: checkpointedAt,
      updatedAt: checkpointedAt,
    } as typeof checkpoints.$inferInsert);

    const checkpoint = await this.db.query.checkpoints.findFirst({
      where: (fields, operators) => operators.eq(fields.id, id),
    });

    const fallbackCheckpointRecord = {
      id,
      thesisId,
      label: input.label ?? null,
      note: input.note ?? null,
      scope: input.scope,
      reason: input.reason,
      snapshotPath: input.snapshotPath ?? null,
      snapshotMetadataJson: JSON.stringify(input.snapshotMetadata ?? null),
      createdBy: input.createdBy,
      checkpointedAt,
      createdAt: checkpointedAt,
      updatedAt: checkpointedAt,
    };

    return this.mapCheckpointRecord((checkpoint as typeof fallbackCheckpointRecord | null) ?? fallbackCheckpointRecord);
  }

  async editLatexSection(thesisId: string, input: LatexEditRequest): Promise<LatexEditPayload> {
    const thesis = await this.requireThesis(thesisId);
    const activeWorkspace = await this.requireActiveLatexWorkspace(thesisId, thesis.activeImportId);
    const resolution = this.resolveLatexEditTarget(thesis.workspacePath, activeWorkspace, input.target);
    const targetSourcePath = resolution.node.sourcePath;
    if (!targetSourcePath) {
      throw new LatexEditConflictError(thesisId, ['The requested LaTeX edit target does not resolve to a concrete source file.'], inspectLatexWorkspace(thesis.workspacePath, activeWorkspace.importRootPath));
    }
    const filePath = path.join(activeWorkspace.importRootPath, targetSourcePath);
    const originalContent = fs.readFileSync(filePath, 'utf8');
    const originalLines = originalContent.split(/\r?\n/);
    const replacementLines = input.replacement.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const updatedLines = [
      ...originalLines.slice(0, resolution.startLine - 1),
      ...replacementLines,
      ...originalLines.slice(resolution.endLine),
    ];
    const updatedContent = updatedLines.join('\n');
    const now = new Date().toISOString();
    const checkpointSnapshotDir = createLatexCheckpointSnapshotDirectory(thesisId, now);
    const snapshotFilePath = path.join(checkpointSnapshotDir, 'snapshot.json');

    fs.mkdirSync(checkpointSnapshotDir, { recursive: true });

    const checkpointSnapshot = {
      kind: 'latex-edit',
      version: 1,
      thesisId,
      workspacePath: activeWorkspace.importRootPath,
      intakeJobId: activeWorkspace.id,
      checkpointId: 'pending',
      createdAt: now,
      target: {
        normalizedNodeId: resolution.node.normalizedNodeId,
        sourcePath: targetSourcePath,
        title: resolution.node.title ?? input.target.title,
        nodeType: resolution.node.nodeType as 'chapter' | 'section' | 'subsection',
        startLine: resolution.startLine,
        endLine: resolution.endLine,
      },
      files: [
        {
          relativePath: targetSourcePath,
          content: originalContent,
          sha256: sha256(originalContent),
        },
      ],
    } satisfies LatexCheckpointSnapshot;

    const checkpoint = await this.createCheckpoint(thesisId, {
      label: `Checkpoint previo a edición: ${resolution.node.title ?? input.target.title}`,
      note: input.note ?? `Respaldo antes de editar ${targetSourcePath}:${resolution.startLine}-${resolution.endLine}.`,
      scope: 'latex-workspace',
      reason: 'before-latex-edit',
      snapshotPath: snapshotFilePath,
      snapshotMetadata: {
        kind: 'latex-edit',
        intakeJobId: activeWorkspace.id,
        sourcePath: targetSourcePath,
        normalizedNodeId: resolution.node.normalizedNodeId,
        startLine: resolution.startLine,
        endLine: resolution.endLine,
      },
      createdBy: input.createdBy,
      checkpointedAt: now,
    });

    checkpointSnapshot.checkpointId = checkpoint.id;
    fs.writeFileSync(snapshotFilePath, JSON.stringify(checkpointSnapshot, null, 2), 'utf8');

    const tempFilePath = `${filePath}.${checkpoint.id}.tmp`;

    try {
      fs.writeFileSync(tempFilePath, updatedContent, 'utf8');
      fs.renameSync(tempFilePath, filePath);
    } catch (error) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      if (fs.readFileSync(filePath, 'utf8') !== originalContent) {
        fs.writeFileSync(filePath, originalContent, 'utf8');
      }
      throw error;
    }

    const structure = inspectLatexWorkspace(thesis.workspacePath, activeWorkspace.importRootPath);

    return {
      thesisId,
      intakeJobId: activeWorkspace.id,
      checkpoint,
      target: {
        normalizedNodeId: resolution.node.normalizedNodeId,
        sourcePath: targetSourcePath,
        title: resolution.node.title ?? input.target.title,
        nodeType: resolution.node.nodeType as 'chapter' | 'section' | 'subsection',
        startLine: resolution.startLine,
        endLine: resolution.endLine,
      },
      changedFiles: [
        {
          path: targetSourcePath,
          changedRange: {
            startLine: resolution.startLine,
            endLine: resolution.startLine + Math.max(replacementLines.length - 1, 0),
          },
          sha256Before: sha256(originalContent),
          sha256After: sha256(updatedContent),
          unchangedContext: {
            before: originalLines.slice(0, resolution.startLine - 1).join('\n') === updatedLines.slice(0, resolution.startLine - 1).join('\n'),
            after: originalLines.slice(resolution.endLine).join('\n') === updatedLines.slice(resolution.startLine - 1 + replacementLines.length).join('\n'),
          },
        },
      ],
      structure,
    };
  }

  async restoreLatexCheckpoint(thesisId: string, checkpointId: string): Promise<LatexRestorePayload> {
    const thesis = await this.requireThesis(thesisId);
    const checkpoint = await this.db.query.checkpoints.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, checkpointId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!checkpoint) {
      throw new LatexCheckpointRestoreError(thesisId, checkpointId, `Checkpoint ${checkpointId} was not found for thesis ${thesisId}.`);
    }

    if (!checkpoint.snapshotPath) {
      throw new LatexCheckpointRestoreError(thesisId, checkpointId, `Checkpoint ${checkpointId} does not contain a restorable snapshot.`);
    }

    const snapshot = parseLatexCheckpointSnapshot(fs.readFileSync(checkpoint.snapshotPath, 'utf8'));
    if (!snapshot) {
      throw new LatexCheckpointRestoreError(thesisId, checkpointId, `Checkpoint ${checkpointId} snapshot metadata is invalid.`);
    }

    const restoredFiles: LatexRestorePayload['restoredFiles'] = [];
    const originals = snapshot.files.map((file) => {
      const absolutePath = path.join(snapshot.workspacePath, file.relativePath);
      const currentContent = fs.readFileSync(absolutePath, 'utf8');
      return {
        absolutePath,
        relativePath: file.relativePath,
        currentContent,
      };
    });

    try {
      snapshot.files.forEach((file) => {
        const absolutePath = path.join(snapshot.workspacePath, file.relativePath);
        fs.writeFileSync(absolutePath, file.content, 'utf8');
        restoredFiles.push({
          path: file.relativePath,
          sha256Before: sha256(originals.find((entry) => entry.relativePath === file.relativePath)?.currentContent ?? ''),
          sha256After: file.sha256,
        });
      });
    } catch (error) {
      originals.forEach((file) => {
        fs.writeFileSync(file.absolutePath, file.currentContent, 'utf8');
      });
      throw error;
    }

    const structure = inspectLatexWorkspace(thesis.workspacePath, snapshot.workspacePath);

    return {
      thesisId,
      intakeJobId: snapshot.intakeJobId,
      checkpointId,
      restoredFiles,
      structure,
    };
  }

  async runLatexBuild(thesisId: string, input: { createdBy: string }): Promise<LatexBuildPayload> {
    const thesis = await this.requireThesis(thesisId);
    const activeWorkspace = await this.requireActiveLatexWorkspace(thesisId, thesis.activeImportId);
    const structure = inspectLatexWorkspace(thesis.workspacePath, activeWorkspace.importRootPath);
    const bibliography = detectBibliographyConfiguration(activeWorkspace.importRootPath, structure.includeGraph?.filesInOrder ?? []);
    const buildRoot = resolveLatexBuildRoot(activeWorkspace.importRootPath, structure.entrypoint);

    const checkpoint = await this.createCheckpoint(thesisId, {
      label: 'Checkpoint previo a compilación LaTeX',
      note: `Snapshot asociado a la compilación de ${structure.entrypoint ?? 'workspace activo'}.`,
      scope: 'latex-build',
      reason: 'before-latex-build',
      snapshotPath: null,
      snapshotMetadata: {
        kind: 'latex-build',
        intakeJobId: activeWorkspace.id,
        entrypoint: structure.entrypoint,
        bibliographyStatus: bibliography.status,
      },
      createdBy: input.createdBy,
    });

    const startedAt = new Date().toISOString();
    const buildRunId = randomUUID();
    const buildArtifactsDir = path.join(process.cwd(), 'tmp', 'latex-builds', thesisId, buildRunId);
    fs.mkdirSync(buildArtifactsDir, { recursive: true });
    const logPath = path.join(buildArtifactsDir, 'latexmk.log');
    const artifactPath = structure.entrypoint ? path.join(buildArtifactsDir, 'output.pdf') : null;

    const buildResult = runContainerizedLatexBuild({
      thesisId,
      workspacePath: thesis.workspacePath,
      importRootPath: activeWorkspace.importRootPath,
      entrypoint: structure.entrypoint,
      bibliography,
      artifactPath,
      logPath,
    });

    const diagnostics = normalizeLatexDiagnostics({
      importRootPath: activeWorkspace.importRootPath,
      structure,
      bibliography,
      log: buildResult.log,
      statusCode: buildResult.exitCode,
    });

    const diagnosticsSummary = summarizeDiagnostics(diagnostics);
    const completedAt = new Date().toISOString();
    const status = buildResult.exitCode === 0
      ? (diagnosticsSummary.warningCount > 0 ? 'completed_with_warnings' : 'completed')
      : 'failed';

    const latestSuccessfulBefore = await this.getLatestSuccessfulBuildRun(thesisId);
    const retainedArtifactPath = status === 'failed'
      ? (latestSuccessfulBefore?.retainedArtifactPath ?? latestSuccessfulBefore?.artifactPath ?? null)
      : buildResult.artifactExists
        ? artifactPath
        : null;

    await this.db.transaction(async (tx) => {
      if (status !== 'failed') {
        await tx
          .update(buildRuns)
          .set({
            isLatestSuccessful: false,
            updatedAt: completedAt,
          })
          .where(eq(buildRuns.thesisId, thesisId));
      }

      await tx.insert(buildRuns).values({
        id: buildRunId,
        thesisId,
        checkpointId: checkpoint.id,
        status,
        engine: 'latexmk',
        artifactPath: buildResult.artifactExists ? artifactPath : null,
        diagnosticsJson: JSON.stringify({
          retainedArtifactPath,
          logPath,
          bibliography,
          diagnostics,
          diagnosticsSummary,
        }),
        bibliographyStatus: bibliography.status,
        startedAt,
        completedAt,
        isLatestSuccessful: status !== 'failed' && buildResult.artifactExists,
        createdAt: startedAt,
        updatedAt: completedAt,
      });

      await tx
        .update(theses)
        .set({
          activeBuildRunId: buildRunId,
          latestStatusAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(theses.id, thesisId));
    });

    const latestAttempted = await this.getBuildRun(thesisId, buildRunId);
    const latestSuccessful = await this.getLatestSuccessfulBuildRun(thesisId);
    const history = await this.listBuildRuns(thesisId);

    return {
      thesisId,
      buildRun: latestAttempted,
      history: {
        latestAttempted,
        latestSuccessful,
        runs: history,
      },
    };
  }

  async listBuildRuns(thesisId: string): Promise<LatexBuildRunPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(buildRuns)
      .where(eq(buildRuns.thesisId, thesisId))
      .orderBy(desc(buildRuns.startedAt), asc(buildRuns.id))
      .all();

    return rows.map((row) => this.mapBuildRunRecord(row));
  }

  async getBuildRun(thesisId: string, buildRunId: string): Promise<LatexBuildRunPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.buildRuns.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, buildRunId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new LatexBuildNotReadyError(thesisId, `Build run ${buildRunId} was not found for thesis ${thesisId}.`);
    }

    return this.mapBuildRunRecord(row);
  }

  private async getLatestSuccessfulBuildRun(thesisId: string): Promise<LatexBuildRunPayload | null> {
    const row = await this.db.query.buildRuns.findFirst({
      where: (fields, operators) =>
        operators.and(
          operators.eq(fields.thesisId, thesisId),
          operators.eq(fields.isLatestSuccessful, true),
        ),
    });

    return row ? this.mapBuildRunRecord(row) : null;
  }

  async listCheckpoints(thesisId: string): Promise<ThesisCheckpointPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.thesisId, thesisId))
      .orderBy(desc(checkpoints.checkpointedAt), asc(checkpoints.id))
      .all();

    return rows.map((row) => this.mapCheckpointRecord({
      ...(row as Omit<Parameters<ThesisLifecycleService['mapCheckpointRecord']>[0], 'snapshotMetadataJson'>),
      snapshotMetadataJson: null,
    }));
  }

  async createFeedback(thesisId: string, input: CreateFeedbackInput): Promise<ThesisFeedbackPayload> {
    await this.requireThesis(thesisId);

    const now = new Date().toISOString();
    const recordedAt = input.recordedAt ?? now;
    const id = randomUUID();

    await this.db.insert(feedbackEntries).values({
      id,
      thesisId,
      sourceType: input.sourceType,
      body: input.body,
      summary: input.summary ?? summarizeFeedback(input.body),
      recordedAt,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    });

    const feedback = await this.db.query.feedbackEntries.findFirst({
      where: (fields, operators) => operators.eq(fields.id, id),
    });

    return this.mapFeedbackRecord(feedback ?? {
      id,
      thesisId,
      sourceType: input.sourceType,
      body: input.body,
      summary: input.summary ?? summarizeFeedback(input.body),
      recordedAt,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    });
  }

  async createWorkflowTask(thesisId: string, input: CreateWorkflowTaskInput): Promise<WorkflowTaskPayload> {
    await this.requireThesis(thesisId);

    if (input.parentTaskId) {
      await this.requireWorkflowTask(thesisId, input.parentTaskId);
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    await this.db.insert(workflowTasks).values({
      id,
      thesisId,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title.trim(),
      intent: input.intent.trim(),
      status: input.status?.trim() || 'pending',
      priority: input.priority ?? 0,
      sortOrder: input.sortOrder ?? 0,
      dueAt: input.dueAt ?? null,
      activeCheckpointId: null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getWorkflowTask(thesisId, id);
  }

  async listWorkflowTasks(thesisId: string): Promise<WorkflowTaskPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(workflowTasks)
      .where(eq(workflowTasks.thesisId, thesisId))
      .orderBy(asc(workflowTasks.sortOrder), desc(workflowTasks.priority), asc(workflowTasks.createdAt), asc(workflowTasks.id))
      .all();

    return rows.map((row) => this.mapWorkflowTaskRecord(row));
  }

  async getWorkflowTask(thesisId: string, taskId: string): Promise<WorkflowTaskPayload> {
    await this.requireThesis(thesisId);
    const row = await this.requireWorkflowTask(thesisId, taskId);
    return this.mapWorkflowTaskRecord(row);
  }

  async getEvidenceContextSetup(thesisId: string): Promise<EvidenceContextSetupPayload> {
    const thesis = await this.requireThesis(thesisId);

    return {
      thesisId,
      activeImportId: thesis.activeImportId,
      normalizedNodes: thesis.activeImportId ? await this.listNormalizedNodes(thesisId, thesis.activeImportId) : [],
      tasks: await this.listWorkflowTasks(thesisId),
    };
  }

  async listFeedback(thesisId: string): Promise<ThesisFeedbackPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(feedbackEntries)
      .where(eq(feedbackEntries.thesisId, thesisId))
      .orderBy(desc(feedbackEntries.recordedAt), asc(feedbackEntries.id))
      .all();

    return rows.map((row) => this.mapFeedbackRecord(row));
  }

  async registerSource(thesisId: string, input: RegisterSourceInput): Promise<{ source: SourcePayload; duplicate: boolean }> {
    await this.requireThesis(thesisId);

    const normalizedAuthors = normalizeAuthors(input.authors ?? []);
    const signature = createSourceSignature({
      thesisId,
      sourceType: input.sourceType,
      title: input.title,
      authors: normalizedAuthors,
      publicationYear: input.publicationYear ?? null,
      locator: input.locator ?? null,
    });

    const existingRows = await this.db
      .select()
      .from(sources)
      .where(eq(sources.thesisId, thesisId))
      .orderBy(asc(sources.createdAt), asc(sources.id))
      .all();

    const duplicate = existingRows.find((row) => {
      const ingest = parseSourceIngestMetadata(row.ingestMetadataJson);
      return ingest.signature === signature;
    });

    if (duplicate) {
      const source = await this.getSource(thesisId, duplicate.id);
      return { source, duplicate: true };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const ingestMetadata = buildSourceIngestMetadata({
      sourceType: input.sourceType,
      title: input.title,
      locator: input.locator ?? null,
      ingest: input.ingest,
      signature,
    });

    await this.db.insert(sources).values({
      id,
      thesisId,
      sourceType: input.sourceType,
      title: input.title.trim(),
      authorsJson: JSON.stringify(normalizedAuthors),
      publicationYear: input.publicationYear ?? null,
      locator: input.locator ?? null,
      status: deriveSourceStatus(ingestMetadata),
      ingestMetadataJson: JSON.stringify(ingestMetadata),
      createdAt: now,
      updatedAt: now,
    });

    return {
      source: await this.getSource(thesisId, id),
      duplicate: false,
    };
  }

  async listSources(thesisId: string, input: ListSourcesInput = {}): Promise<SourcePayload[]> {
    await this.requireThesis(thesisId);
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    const rows = await this.db
      .select()
      .from(sources)
      .where(eq(sources.thesisId, thesisId))
      .orderBy(asc(sources.title), asc(sources.createdAt), asc(sources.id))
      .all();

    const filtered = rows.filter((row) => {
      if (!query) {
        return true;
      }

      const haystack = [
        row.title,
        row.locator ?? '',
        ...parseStringArray(row.authorsJson),
      ].join(' ').toLocaleLowerCase();

      return haystack.includes(query);
    });

    return Promise.all(filtered.map((row) => this.mapSourceRecord(row)));
  }

  async getSource(thesisId: string, sourceId: string): Promise<SourcePayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.sources.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, sourceId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new SourceNotFoundError(thesisId, sourceId);
    }

    return this.mapSourceRecord(row);
  }

  async createEvidenceFragment(thesisId: string, input: CreateEvidenceFragmentInput): Promise<EvidenceFragmentPayload> {
    await this.requireThesis(thesisId);
    const source = await this.getSource(thesisId, input.sourceId);

    if (input.normalizedNodeId) {
      await this.requireNormalizedNode(thesisId, input.normalizedNodeId);
    }

    if (input.taskId) {
      await this.requireWorkflowTask(thesisId, input.taskId);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    await this.db.insert(evidenceFragments).values({
      id,
      thesisId,
      sourceId: source.id,
      normalizedNodeId: input.normalizedNodeId ?? null,
      taskId: input.taskId ?? null,
      locator: input.locator ?? null,
      snippet: input.snippet.trim(),
      extractionMethod: input.extractionMethod.trim(),
      confidence: input.confidence ?? null,
      status: input.status ?? 'captured',
      provenanceJson: JSON.stringify(input.provenance ?? null),
      createdAt: now,
      updatedAt: now,
    });

    return this.getEvidenceFragment(thesisId, id);
  }

  async createClaim(thesisId: string, input: CreateClaimInput): Promise<ClaimPayload> {
    await this.requireThesis(thesisId);

    if (input.normalizedNodeId) {
      await this.requireNormalizedNode(thesisId, input.normalizedNodeId);
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    await this.db.insert(claims).values({
      id,
      thesisId,
      normalizedNodeId: input.normalizedNodeId ?? null,
      text: input.text,
      status: input.status ?? 'draft',
      supportSummary: input.supportSummary ?? '',
      evidenceOrderingJson: serializeClaimEvidenceOrderingMetadata({ evidenceFragmentIdOrder: [] }),
      createdAt: now,
      updatedAt: now,
    });

    return this.getClaim(thesisId, id);
  }

  async listClaims(thesisId: string): Promise<ClaimPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(claims)
      .where(eq(claims.thesisId, thesisId))
      .orderBy(desc(claims.createdAt), asc(claims.id))
      .all();

    return Promise.all(rows.map((row) => this.mapClaimRecord(row)));
  }

  async getClaim(thesisId: string, claimId: string): Promise<ClaimPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.claims.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, claimId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new ClaimNotFoundError(thesisId, claimId);
    }

    return this.mapClaimRecord(row);
  }

  async linkClaimToEvidence(thesisId: string, claimId: string, input: LinkClaimEvidenceInput): Promise<ClaimPayload> {
    const claim = await this.requireClaim(thesisId, claimId);
    const evidenceIds = Array.from(new Set(input.evidenceFragmentIds));

    for (const evidenceFragmentId of evidenceIds) {
      await this.requireEvidenceFragment(thesisId, evidenceFragmentId);
    }

    const now = new Date().toISOString();
    const currentOrdering = this.getClaimEvidenceOrdering(claim.evidenceOrderingJson);
    const nextEvidenceOrder = [...currentOrdering];

    for (const evidenceFragmentId of evidenceIds) {
      const existing = await this.db.query.claimEvidenceLinks.findFirst({
        where: (fields, operators) =>
          operators.and(
            operators.eq(fields.thesisId, thesisId),
            operators.eq(fields.claimId, claim.id),
            operators.eq(fields.evidenceFragmentId, evidenceFragmentId),
          ),
      });

      if (!existing) {
        const insertedLink = {
          id: randomUUID(),
          thesisId,
          claimId: claim.id,
          evidenceFragmentId,
          rationale: input.rationale,
          createdAt: now,
          updatedAt: now,
        } satisfies ClaimEvidenceLinkRecord;

        await this.db.insert(claimEvidenceLinks).values(insertedLink);
      }

      if (!nextEvidenceOrder.includes(evidenceFragmentId)) {
        nextEvidenceOrder.push(evidenceFragmentId);
      }
    }

    await this.persistClaimEvidenceOrdering(thesisId, claim.id, nextEvidenceOrder, now);

    return this.getClaim(thesisId, claimId);
  }

  async unlinkClaimEvidence(thesisId: string, claimId: string, evidenceFragmentId: string): Promise<ClaimPayload> {
    const claim = await this.requireClaim(thesisId, claimId);
    await this.requireEvidenceFragment(thesisId, evidenceFragmentId);
    const linkId = await this.requireClaimEvidenceLink(thesisId, claimId, evidenceFragmentId);
    const nextEvidenceOrder = this.getClaimEvidenceOrdering(claim.evidenceOrderingJson).filter((id) => id !== evidenceFragmentId);
    const now = new Date().toISOString();

    await this.db
      .delete(claimEvidenceLinks)
      .where(eq(claimEvidenceLinks.id, linkId));

    await this.persistClaimEvidenceOrdering(thesisId, claim.id, nextEvidenceOrder, now);

    return this.getClaim(thesisId, claimId);
  }

  async listEvidenceFragments(thesisId: string): Promise<EvidenceFragmentPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(evidenceFragments)
      .where(eq(evidenceFragments.thesisId, thesisId))
      .orderBy(desc(evidenceFragments.createdAt), asc(evidenceFragments.id))
      .all();

    return Promise.all(rows.map((row) => this.mapEvidenceFragmentRecord(row)));
  }

  async getEvidenceFragment(thesisId: string, evidenceFragmentId: string): Promise<EvidenceFragmentPayload> {
    await this.requireThesis(thesisId);
    const row = await this.db.query.evidenceFragments.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, evidenceFragmentId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new EvidenceFragmentNotFoundError(thesisId, evidenceFragmentId);
    }

    return this.mapEvidenceFragmentRecord(row);
  }

  private async requireClaim(thesisId: string, claimId: string) {
    const row = await this.db.query.claims.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, claimId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new ClaimNotFoundError(thesisId, claimId);
    }

    return row;
  }

  private async requireEvidenceFragment(thesisId: string, evidenceFragmentId: string) {
    const row = await this.db.query.evidenceFragments.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, evidenceFragmentId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      const crossThesis = await this.db.query.evidenceFragments.findFirst({
        where: (fields, operators) => operators.eq(fields.id, evidenceFragmentId),
      });

      if (crossThesis) {
        throw new ClaimEvidenceScopeError(thesisId, `Evidence fragment ${evidenceFragmentId} is not available for thesis ${thesisId}.`);
      }

      throw new EvidenceFragmentNotFoundError(thesisId, evidenceFragmentId);
    }

    return row;
  }

  private async requireClaimEvidenceLink(thesisId: string, claimId: string, evidenceFragmentId: string) {
    const row = await this.db.query.claimEvidenceLinks.findFirst({
      where: (fields, operators) =>
        operators.and(
          operators.eq(fields.thesisId, thesisId),
          operators.eq(fields.claimId, claimId),
          operators.eq(fields.evidenceFragmentId, evidenceFragmentId),
        ),
    });

    if (!row) {
      throw new ClaimEvidenceLinkNotFoundError(thesisId, claimId, evidenceFragmentId);
    }

    return row.id;
  }

  async getResume(thesisId: string): Promise<ThesisResumePayload> {
    const detail = await this.getThesisDetail(thesisId);
    const checkpoints = await this.listCheckpoints(thesisId);
    const feedback = await this.listFeedback(thesisId);
    const complianceRuns = await this.listComplianceRuns(thesisId);
    const academicQaRuns = await this.listAcademicQaRuns(thesisId);

    return {
      thesis: detail.thesis,
      state: detail.state,
      latestStatusAt: detail.latestStatusAt,
      statusSummary: detail.statusSummary,
      blockers: detail.blockers,
      nextAction: detail.nextStepSummary,
      latestCheckpoint: checkpoints[0] ?? null,
      recentFeedback: feedback.slice(0, 5),
      activeWorkspace: detail.activeWorkspace,
      latestComplianceRun: complianceRuns[0] ?? null,
      latestAcademicQaRun: academicQaRuns[0] ?? null,
      recentComplianceFindings: (complianceRuns[0]?.issues ?? []).slice(0, 5),
      recentAcademicQaFindings: (academicQaRuns[0]?.issues ?? []).slice(0, 5),
    };
  }

  async createIntakeJob(thesisId: string, input: CreateIntakeJobInput): Promise<IntakeJobPayload> {
    const thesis = await this.requireThesis(thesisId);

    const normalizedPath = canonicalizeInsideBoundary(thesis.workspacePath, input.importRootPath, thesisId);
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const detection = detectSourceFormat(normalizedPath);

    await this.db.insert(intakeJobs).values({
      id: jobId,
      thesisId,
      sourceFormat: detection.format,
      status: 'queued',
      importRootPath: normalizedPath,
      detectedEntrypoint: null,
      reportJson: JSON.stringify({
        thesisId,
        intakeJobId: jobId,
        terminalStatus: 'queued',
        detectedFormat: detection.format,
        detection,
        extractionStatus: 'not_started',
        normalizationStatus: 'not_started',
        structureSummary: null,
        normalizationSummary: null,
        replacement: null,
        warnings: [],
        failures: [],
        recommendedNextSteps: [],
      } satisfies IntakeReportSummary),
      warningsJson: JSON.stringify([]),
      recommendationsJson: JSON.stringify([]),
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.runIntakeJob(thesisId, jobId);
    return this.getIntakeJob(thesisId, jobId);
  }

  async getIntakeJob(thesisId: string, intakeJobId: string): Promise<IntakeJobPayload> {
    await this.requireThesis(thesisId);
    const job = await this.db.query.intakeJobs.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, intakeJobId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!job) {
      throw new IntakeJobNotFoundError(thesisId, intakeJobId);
    }

    return this.mapIntakeJobRecord(job);
  }

  async getIntakeReport(thesisId: string, intakeJobId: string): Promise<IntakeReportSummary> {
    const job = await this.getIntakeJob(thesisId, intakeJobId);

    if (!job.report || !TERMINAL_INTAKE_STATUSES.includes(job.status)) {
      return {
        thesisId,
        intakeJobId,
        terminalStatus: job.status,
        detectedFormat: job.sourceFormat,
        detection: job.detection,
        extractionStatus: job.report?.extractionStatus ?? 'not_started',
        normalizationStatus: job.report?.normalizationStatus ?? 'not_started',
        structureSummary: job.report?.structureSummary ?? null,
        normalizationSummary: job.report?.normalizationSummary ?? null,
        replacement: job.report?.replacement ?? null,
        warnings: job.warnings,
        failures: job.report?.failures ?? [],
        recommendedNextSteps: job.recommendations,
      };
    }

    return job.report;
  }

  private async runIntakeJob(thesisId: string, intakeJobId: string) {
    const job = await this.getIntakeJob(thesisId, intakeJobId);
    const thesis = await this.requireThesis(thesisId);
    const priorActiveImportId = thesis.activeImportId;
    const startedAt = new Date().toISOString();

    await this.db
      .update(intakeJobs)
      .set({
        status: 'running',
        startedAt,
        updatedAt: startedAt,
      })
      .where(eq(intakeJobs.id, intakeJobId));

    const outcome = await performIntakeInspection(thesisId, intakeJobId, job.importRootPath, job.detection);
    const completedAt = new Date().toISOString();
    let recoverableCheckpointId: string | null = null;

    if (outcome.status === 'succeeded' && priorActiveImportId && priorActiveImportId !== intakeJobId) {
      const checkpoint = await this.createCheckpoint(thesisId, {
        label: 'Checkpoint previo a reimportación',
        note: `Preserva el workspace activo anterior ${priorActiveImportId} antes de activar ${intakeJobId}.`,
        scope: 'intake-workspace',
        reason: 'before-reimport-replacement',
        createdBy: 'system:intake-reimport',
        checkpointedAt: completedAt,
      });
      recoverableCheckpointId = checkpoint.id;
    }

    const recommendations = buildIntakeRecommendations({
      terminalStatus: outcome.status,
      failures: outcome.report.failures,
      structureSummary: outcome.report.structureSummary,
      normalizationSummary: outcome.report.normalizationSummary,
      priorActiveImportId,
      recoverableCheckpointId,
    });
    const report: IntakeReportSummary = {
      ...outcome.report,
      replacement: priorActiveImportId && outcome.status === 'succeeded' && recoverableCheckpointId
        ? {
            isReimport: true,
            replacesIntakeJobId: priorActiveImportId,
            recoverableCheckpointId,
            supersedesWorkspace: true,
          }
        : null,
      warnings: [
        ...outcome.report.warnings,
        ...(priorActiveImportId && outcome.status === 'succeeded'
          ? [`La re-importación sustituye explícitamente el workspace activo ${priorActiveImportId} y conserva un checkpoint recuperable.`]
          : []),
      ],
      recommendedNextSteps: recommendations,
    };

    await this.db.transaction(async (tx) => {
      await tx
        .delete(normalizedNodes)
        .where(eq(normalizedNodes.intakeJobId, intakeJobId));

      if (false) {
        const priorNodes = await tx
          .select()
          .from(normalizedNodes)
          .where(eq(normalizedNodes.intakeJobId, priorActiveImportId as string))
          .orderBy(asc(normalizedNodes.ordinal), asc(normalizedNodes.id))
          .all();

        const idMap = new Map<string, string>();
        const clonedPriorNodes = priorNodes.map((node) => {
          const clonedId = `${node.id}:reimport:${intakeJobId}`;
          idMap.set(node.id, clonedId);
          return {
            ...node,
            id: clonedId,
            intakeJobId,
          };
        }).map((node) => ({
          ...node,
          parentNodeId: node.parentNodeId ? (idMap.get(node.parentNodeId) ?? null) : null,
        }));

        if (clonedPriorNodes.length > 0) {
          await tx.insert(normalizedNodes).values(clonedPriorNodes);
        }
      }

      if (outcome.status !== 'failed' && outcome.normalizedNodes.length > 0) {
        await tx.insert(normalizedNodes).values(outcome.normalizedNodes);
      }

      await tx
        .update(intakeJobs)
        .set({
          sourceFormat: outcome.detection.format,
          status: outcome.status,
          detectedEntrypoint: outcome.detectedEntrypoint,
          reportJson: JSON.stringify(report),
          warningsJson: JSON.stringify(report.warnings),
          recommendationsJson: JSON.stringify(report.recommendedNextSteps),
          startedAt,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(intakeJobs.id, intakeJobId));

      if (outcome.status === 'succeeded' && priorActiveImportId && recoverableCheckpointId) {
        const priorActiveJob = await tx.query.intakeJobs.findFirst({
          where: (fields, operators) => operators.eq(fields.id, priorActiveImportId),
        });

        if (priorActiveJob) {
          const priorReport = parseIntakeReport(priorActiveJob.reportJson);
          const nextReplacement: IntakeReportReplacement = {
            ...(priorReport?.replacement ?? {}),
            replacedByIntakeJobId: intakeJobId,
            replacedByRecoverableCheckpointId: recoverableCheckpointId,
          };

          await tx
            .update(intakeJobs)
            .set({
              reportJson: JSON.stringify({
                ...(priorReport ?? {
                  thesisId,
                  intakeJobId: priorActiveJob.id,
                  terminalStatus: normalizeIntakeStatus(priorActiveJob.status),
                  detectedFormat: normalizeSourceFormat(priorActiveJob.sourceFormat),
                  detection: parseIntakeReport(priorActiveJob.reportJson)?.detection ?? {
                    format: normalizeSourceFormat(priorActiveJob.sourceFormat),
                    reason: 'Detection payload unavailable.',
                    matchedBy: 'persisted_status',
                  },
                  extractionStatus: 'not_started',
                  normalizationStatus: 'not_started',
                  structureSummary: null,
                  normalizationSummary: null,
                  warnings: parseStringArray(priorActiveJob.warningsJson),
                  failures: [],
                  recommendedNextSteps: parseRecommendations(priorActiveJob.recommendationsJson),
                }),
                replacement: nextReplacement,
              } satisfies IntakeReportSummary),
              updatedAt: completedAt,
            })
            .where(eq(intakeJobs.id, priorActiveImportId));
        }
      }

      if (outcome.status === 'succeeded') {
        await tx
          .update(theses)
          .set({
            currentState: 'active',
            latestStatusAt: completedAt,
            nextStepSummary: summarizeRecommendedNextStep(recommendations),
            activeImportId: intakeJobId,
            updatedAt: completedAt,
          })
          .where(eq(theses.id, thesisId));

        await tx
          .update(thesisStates)
          .set({
            isCurrent: false,
            updatedAt: completedAt,
          })
          .where(eq(thesisStates.thesisId, thesisId));

        await tx.insert(thesisStates).values({
          id: randomUUID(),
          thesisId,
          state: 'active',
          source: priorActiveImportId ? 'system:intake-reimport' : 'system:intake-complete',
          statusSummary: priorActiveImportId
            ? `Re-importación completada; el workspace activo ahora usa ${intakeJobId} en lugar de ${priorActiveImportId}.`
            : `Importación completada; el workspace activo ahora usa ${intakeJobId}.`,
          blockersJson: JSON.stringify([]),
          transitionedFrom: thesis.currentState,
          transitionedAt: completedAt,
          isCurrent: true,
          createdAt: completedAt,
          updatedAt: completedAt,
        });
      } else {
        await tx
          .update(theses)
          .set({
            latestStatusAt: completedAt,
            nextStepSummary: summarizeRecommendedNextStep(recommendations),
            updatedAt: completedAt,
          })
          .where(eq(theses.id, thesisId));
      }
    });
  }

  async listNormalizedNodes(thesisId: string, intakeJobId: string): Promise<NormalizedNodePayload[]> {
    await this.requireThesis(thesisId);
    await this.getIntakeJob(thesisId, intakeJobId);

    const rows = await this.db
      .select()
      .from(normalizedNodes)
      .where(eq(normalizedNodes.intakeJobId, intakeJobId))
      .orderBy(asc(normalizedNodes.ordinal), asc(normalizedNodes.id))
      .all();

    return rows.map((row) => this.mapNormalizedNodeRecord(row));
  }

  private async createUniqueSlug(title: string, thesisIdToExclude?: string): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let suffix = 1;

    while (true) {
      const existing = await this.db.query.theses.findFirst({
        columns: { id: true },
        where: (fields, operators) => operators.eq(fields.slug, candidate),
      });

      if (!existing || existing.id === thesisIdToExclude) {
        return candidate;
      }

      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
  }

  private async getActiveWorkspace(thesisId: string, activeImportId: string | null): Promise<ActiveWorkspacePayload | null> {
    if (!activeImportId) {
      return null;
    }

    const activeJob = await this.db.query.intakeJobs.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, activeImportId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!activeJob) {
      return null;
    }

    const report = parseIntakeReport(activeJob.reportJson);

    return {
      intakeJobId: activeJob.id,
      detectedFormat: normalizeSourceFormat(activeJob.sourceFormat),
      entrypoint: activeJob.detectedEntrypoint,
      selectionMode: report?.structureSummary?.selection.mode ?? null,
      nodeCount: report?.normalizationSummary?.nodeCount ?? 0,
      rootNodeIds: report?.normalizationSummary?.rootNodeIds ?? [],
      replacementOfIntakeJobId: report?.replacement?.replacesIntakeJobId ?? null,
      replacedByIntakeJobId: report?.replacement?.replacedByIntakeJobId ?? null,
      recoverableCheckpointId: report?.replacement?.recoverableCheckpointId ?? null,
      latestBuildRunId: (await this.requireThesis(thesisId)).activeBuildRunId,
    };
  }

  private async requireThesis(thesisId: string) {
    const thesis = await this.db.query.theses.findFirst({
      where: (fields, operators) => operators.eq(fields.id, thesisId),
    });

    if (!thesis) {
      throw new ThesisNotFoundError(thesisId);
    }

    return thesis;
  }

  private async requireNormalizedNode(thesisId: string, normalizedNodeId: string) {
    const row = await this.db.query.normalizedNodes.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, normalizedNodeId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new EvidenceContextScopeError(thesisId, `Normalized node ${normalizedNodeId} is not available for thesis ${thesisId}.`);
    }

    return row;
  }

  private async requireWorkflowTask(thesisId: string, taskId: string) {
    const row = await this.db.query.workflowTasks.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, taskId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!row) {
      throw new EvidenceContextScopeError(thesisId, `Workflow task ${taskId} is not available for thesis ${thesisId}.`);
    }

    return row;
  }

  private mapIntakeJobRecord(record: {
    id: string;
    thesisId: string;
    sourceFormat: string;
    status: string;
    importRootPath: string;
    detectedEntrypoint: string | null;
    reportJson: string;
    warningsJson: string;
    recommendationsJson: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): IntakeJobPayload {
    const detection = parseIntakeReport(record.reportJson)?.detection ?? {
      format: normalizeSourceFormat(record.sourceFormat),
      reason: 'Detection payload unavailable.',
      matchedBy: 'persisted_status',
    };

    return {
      id: record.id,
      thesisId: record.thesisId,
      sourceFormat: normalizeSourceFormat(record.sourceFormat),
      status: normalizeIntakeStatus(record.status),
      importRootPath: record.importRootPath,
      detectedEntrypoint: record.detectedEntrypoint,
      detection,
      report: parseIntakeReport(record.reportJson),
      warnings: parseStringArray(record.warningsJson),
      recommendations: parseRecommendations(record.recommendationsJson),
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapThesisRecord(record: ThesisRecordPayload | {
    id: string;
    title: string;
    slug: string;
    degreeProgram: string;
    institution: string;
    workspacePath: string;
    defaultLanguage: string;
    currentState: string;
    latestStatusAt: string;
    nextStepSummary: string;
    activeImportId: string | null;
    activeBuildRunId: string | null;
    createdAt: string;
    updatedAt: string;
  }): ThesisRecordPayload {
    return {
      ...record,
      currentState: record.currentState as ThesisLifecycleState,
    };
  }

  private mapStateRecord(record: {
    id: string;
    thesisId: string;
    state: string;
    source: string;
    statusSummary: string;
    blockersJson: string;
    transitionedFrom: string | null;
    transitionedAt: string;
    isCurrent: boolean;
    createdAt: string;
    updatedAt: string;
  }): ThesisStatePayload {
    return {
      id: record.id,
      thesisId: record.thesisId,
      state: record.state as ThesisLifecycleState,
      source: record.source,
      statusSummary: record.statusSummary,
      blockers: parseBlockers(record.blockersJson),
      transitionedFrom: (record.transitionedFrom ?? null) as ThesisLifecycleState | null,
      transitionedAt: record.transitionedAt,
      isCurrent: record.isCurrent,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapCheckpointRecord(record: {
    id: string;
    thesisId: string;
    label: string | null;
    note: string | null;
    scope: string;
    reason: string;
    snapshotPath: string | null;
    snapshotMetadataJson: string | null;
    createdBy: string;
    checkpointedAt: string;
    createdAt: string;
    updatedAt: string;
  }): ThesisCheckpointPayload {
    return {
      id: record.id,
      thesisId: record.thesisId,
      label: record.label,
      note: record.note,
      scope: record.scope,
      reason: record.reason,
      snapshotPath: record.snapshotPath,
      snapshotMetadata: parseNullableJsonObject(record.snapshotMetadataJson),
      createdBy: record.createdBy,
      checkpointedAt: record.checkpointedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async requireActiveLatexWorkspace(thesisId: string, activeImportId: string | null) {
    if (!activeImportId) {
      throw new LatexWorkspaceNotReadyError(thesisId);
    }

    const activeJob = await this.db.query.intakeJobs.findFirst({
      where: (fields, operators) =>
        operators.and(operators.eq(fields.id, activeImportId), operators.eq(fields.thesisId, thesisId)),
    });

    if (!activeJob || normalizeSourceFormat(activeJob.sourceFormat) !== 'latex' || normalizeIntakeStatus(activeJob.status) !== 'succeeded') {
      throw new LatexWorkspaceNotReadyError(thesisId);
    }

    return activeJob;
  }

  private resolveLatexEditTarget(workspacePath: string, activeJob: { id: string; importRootPath: string; reportJson: string }, target: LatexEditTarget) {
    const structure = inspectLatexWorkspace(workspacePath, activeJob.importRootPath);
    const reasons: string[] = [];
    const candidates = structure.outline.filter((node) => {
      if (target.normalizedNodeId && node.normalizedNodeId === target.normalizedNodeId) {
        return true;
      }

      return node.sourcePath === target.sourcePath && node.title === target.title && node.nodeType === target.nodeType;
    });

    if (candidates.length === 0) {
      reasons.push('The requested LaTeX edit target is stale and no longer maps to the current structure.');
    } else if (candidates.length > 1) {
      reasons.push('The requested LaTeX edit target is ambiguous in the current structure.');
    }

    const candidate = candidates[0];
    if (!candidate) {
      throw new LatexEditConflictError(activeJob.id, reasons, structure);
    }

    if (target.anchorStart !== candidate.anchor.start || (target.anchorEnd ?? candidate.anchor.end ?? null) !== (candidate.anchor.end ?? null)) {
      reasons.push('The requested LaTeX edit target anchors are stale for the current structure.');
    }

    if (reasons.length > 0) {
      throw new LatexEditConflictError(activeJob.id, reasons, structure);
    }

    return {
      node: candidate,
      startLine: Number(candidate.anchor.start),
      endLine: Number(candidate.anchor.end ?? candidate.anchor.start),
    };
  }

  private mapFeedbackRecord(record: {
    id: string;
    thesisId: string;
    sourceType: string;
    body: string;
    summary: string | null;
    recordedAt: string;
    createdAt: string;
    updatedAt: string;
  }): ThesisFeedbackPayload {
    return {
      ...record,
      sourceType: normalizeFeedbackSource(record.sourceType),
    };
  }

  private mapWorkflowTaskRecord(record: typeof workflowTasks.$inferSelect): WorkflowTaskPayload {
    return {
      id: record.id,
      thesisId: record.thesisId,
      parentTaskId: record.parentTaskId,
      title: record.title,
      intent: record.intent,
      status: record.status,
      priority: record.priority,
      sortOrder: record.sortOrder,
      dueAt: record.dueAt,
      activeCheckpointId: record.activeCheckpointId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapSourceRecord(record: typeof sources.$inferSelect): Promise<SourcePayload> {
    const ingest = parseSourceIngestMetadata(record.ingestMetadataJson);
    const evidenceCount = await this.countRows(evidenceFragments, { thesisId: record.thesisId, sourceId: record.id });
    const claimCount = await this.countRowsBySourceClaimLinks(record.thesisId, record.id);

    return {
      id: record.id,
      thesisId: record.thesisId,
      sourceType: normalizeSourceType(record.sourceType),
      title: record.title,
      authors: parseStringArray(record.authorsJson),
      publicationYear: record.publicationYear,
      locator: record.locator,
      status: normalizeSourceStatus(record.status),
      ingest,
      evidenceCount,
      claimCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapEvidenceFragmentRecord(record: typeof evidenceFragments.$inferSelect): Promise<EvidenceFragmentPayload> {
    const sourceRow = await this.db.query.sources.findFirst({
      where: (fields, operators) => operators.eq(fields.id, record.sourceId),
    });
    if (!sourceRow) {
      throw new SourceNotFoundError(record.thesisId, record.sourceId);
    }
    const source = await this.mapSourceRecord(sourceRow);
    const section = record.normalizedNodeId
      ? await this.db.query.normalizedNodes.findFirst({
          where: (fields, operators) => operators.eq(fields.id, record.normalizedNodeId as string),
        })
      : null;
    const task = record.taskId
      ? await this.db.query.workflowTasks.findFirst({
          where: (fields, operators) => operators.eq(fields.id, record.taskId as string),
        })
      : null;

    return {
      id: record.id,
      thesisId: record.thesisId,
      sourceId: record.sourceId,
      normalizedNodeId: record.normalizedNodeId,
      taskId: record.taskId,
      locator: record.locator,
      snippet: record.snippet,
      extractionMethod: record.extractionMethod,
      confidence: record.confidence,
      status: normalizeEvidenceStatus(record.status),
      provenance: parseNullableJsonObject(record.provenanceJson),
      source: {
        id: source.id,
        title: source.title,
        sourceType: source.sourceType,
        status: source.status,
      },
      context: {
        section: section ? { id: section.id, title: section.title, nodeType: section.nodeType } : null,
        task: task ? { id: task.id, title: task.title, status: task.status } : null,
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapClaimRecord(
    record: { id: string; thesisId: string; normalizedNodeId: string | null; text: string; status: string; supportSummary: string; evidenceOrderingJson: string; createdAt: string; updatedAt: string; },
  ): Promise<ClaimPayload> {
    const orderedClaimLinks = await this.listClaimEvidenceLinksForClaim(record.thesisId, record.id, record.evidenceOrderingJson);

    const evidenceFragmentsPayload = await Promise.all(orderedClaimLinks.map(async (link) => {
      const evidence = await this.db.query.evidenceFragments.findFirst({
        where: (fields, operators) => operators.eq(fields.id, link.evidenceFragmentId),
      });

      if (!evidence) {
        return null;
      }

      const source = await this.db.query.sources.findFirst({
        where: (fields, operators) => operators.eq(fields.id, evidence.sourceId),
      });

      if (!source) {
        return null;
      }

      return {
        id: evidence.id,
        locator: evidence.locator,
        snippet: evidence.snippet,
        extractionMethod: evidence.extractionMethod,
        rationale: link.rationale,
        source: {
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          status: source.status,
        },
      };
    }));

    const linkedEvidence = evidenceFragmentsPayload.filter((value): value is NonNullable<typeof value> => value !== null);
    const linkedEvidenceIds = linkedEvidence.map((evidence) => evidence.id);

    return {
      id: record.id,
      thesisId: record.thesisId,
      normalizedNodeId: record.normalizedNodeId,
      text: record.text,
      status: normalizeClaimStatus(record.status),
      supportSummary: record.supportSummary,
      linkedEvidenceCount: linkedEvidence.length,
      linkedEvidenceIds,
      hasEvidence: linkedEvidence.length > 0,
      traceability: {
        evidenceFragments: linkedEvidence,
        sourceIds: Array.from(new Set(linkedEvidence.map((evidence) => evidence.source.id))),
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async listClaimEvidenceLinksForClaim(
    thesisId: string,
    claimId: string,
    evidenceOrderingJson?: string,
  ): Promise<ClaimEvidenceLinkRecord[]> {
    const linkRows = await this.db
      .select()
      .from(claimEvidenceLinks)
      .where(eq(claimEvidenceLinks.thesisId, thesisId))
      .orderBy(asc(claimEvidenceLinks.createdAt), asc(claimEvidenceLinks.id))
      .all();

    const claimLinks = linkRows.filter((link) => link.claimId === claimId);
    const preferredOrder = this.getClaimEvidenceOrdering(evidenceOrderingJson ?? '').filter((id) =>
      claimLinks.some((link) => link.evidenceFragmentId === id),
    );

    return claimLinks.sort((left, right) => {
      const leftOrderIndex = preferredOrder.indexOf(left.evidenceFragmentId);
      const rightOrderIndex = preferredOrder.indexOf(right.evidenceFragmentId);

      if (leftOrderIndex !== -1 || rightOrderIndex !== -1) {
        if (leftOrderIndex === -1) {
          return 1;
        }

        if (rightOrderIndex === -1) {
          return -1;
        }

        return leftOrderIndex - rightOrderIndex;
      }

      if (left.createdAt === right.createdAt) {
        return left.id.localeCompare(right.id);
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  private getClaimEvidenceOrdering(evidenceOrderingJson: string): string[] {
    return parseClaimEvidenceOrderingMetadata(evidenceOrderingJson).evidenceFragmentIdOrder;
  }

  private async persistClaimEvidenceOrdering(
    thesisId: string,
    claimId: string,
    evidenceFragmentIdOrder: string[],
    updatedAt: string,
  ) {
    await this.db
      .update(claims)
      .set({
        evidenceOrderingJson: serializeClaimEvidenceOrderingMetadata({ evidenceFragmentIdOrder }),
        updatedAt,
      })
      .where(eq(claims.id, claimId));

    await this.requireClaim(thesisId, claimId);
  }

  private async countRows(table: typeof evidenceFragments, where: { thesisId: string; sourceId: string }) {
    const rows = await this.db
      .select()
      .from(table)
      .where(eq(table.thesisId, where.thesisId))
      .all();

    return rows.filter((row) => row.sourceId === where.sourceId).length;
  }

  private async countRowsBySourceClaimLinks(thesisId: string, sourceId: string) {
    const evidenceRows = await this.db
      .select()
      .from(evidenceFragments)
      .where(eq(evidenceFragments.thesisId, thesisId))
      .all();
    const relevantEvidenceIds = new Set(evidenceRows.filter((row) => row.sourceId === sourceId).map((row) => row.id));
    if (relevantEvidenceIds.size === 0) {
      return 0;
    }

    const linkRows = await this.db
      .select()
      .from(claimEvidenceLinks)
      .where(eq(claimEvidenceLinks.thesisId, thesisId))
      .all();

    return new Set(
      linkRows
        .filter((row) => relevantEvidenceIds.has(row.evidenceFragmentId))
        .map((row) => row.claimId),
    ).size;
  }

  private mapNormalizedNodeRecord(record: typeof normalizedNodes.$inferSelect): NormalizedNodePayload {
    return {
      id: record.id,
      thesisId: record.thesisId,
      intakeJobId: record.intakeJobId,
      parentNodeId: record.parentNodeId,
      nodeType: record.nodeType,
      title: record.title,
      content: record.content,
      ordinal: record.ordinal,
      sourcePath: record.sourcePath,
      sourceStart: record.sourceStart,
      sourceEnd: record.sourceEnd,
      provenanceKind: record.provenanceKind,
      provenance: parseJsonObject(record.provenanceJson),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapBuildRunRecord(record: typeof buildRuns.$inferSelect): LatexBuildRunPayload {
    const diagnosticsPayload = parseJsonObject(record.diagnosticsJson) ?? {};
    const bibliography = parseBibliographyConfiguration(diagnosticsPayload.bibliography) ?? defaultBibliographyConfiguration();
    const diagnostics = parseDiagnostics(diagnosticsPayload.diagnostics);
    const diagnosticsSummary = parseDiagnosticsSummary(diagnosticsPayload.diagnosticsSummary, diagnostics);
    const retainedArtifactPath = typeof diagnosticsPayload.retainedArtifactPath === 'string'
      ? diagnosticsPayload.retainedArtifactPath
      : null;
    const logPath = typeof diagnosticsPayload.logPath === 'string' ? diagnosticsPayload.logPath : null;

    return {
      id: record.id,
      thesisId: record.thesisId,
      checkpointId: record.checkpointId,
      status: normalizeBuildStatus(record.status),
      engine: 'latexmk',
      artifactPath: record.artifactPath,
      retainedArtifactPath,
      logPath,
      bibliographyStatus: record.bibliographyStatus,
      bibliography,
      diagnostics,
      diagnosticsSummary,
      startedAt: record.startedAt,
      completedAt: record.completedAt ?? record.startedAt,
      isLatestSuccessful: record.isLatestSuccessful,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapZoteroMappingRecord(record: typeof zoteroMappings.$inferSelect): ZoteroMappingPayload {
    const normalizedData = parseJsonObject(record.normalizedDataJson) ?? {};
    const degradedMessage = typeof normalizedData.connectorMessage === 'string' ? normalizedData.connectorMessage : null;
    const degradedCode = typeof normalizedData.connectorCode === 'string' ? normalizedData.connectorCode : null;

    return {
      id: record.id,
      thesisId: record.thesisId,
      normalizedNodeId: record.normalizedNodeId,
      scope: record.scope as ZoteroMappingScope,
      libraryId: record.libraryId,
      collectionKey: record.collectionKey,
      itemKey: record.itemKey,
      normalizedData,
      connectorStatus: record.connectorStatus === 'ready' ? 'ready' : 'degraded',
      degraded: {
        isDegraded: record.connectorStatus !== 'ready',
        message: degradedMessage,
        code: degradedCode,
      },
      lastSyncedAt: record.lastSyncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapPolicyProfileRecord(record: typeof policyProfiles.$inferSelect): PolicyProfilePayload {
    const requiredSections = parseStringArray(record.requiredSectionsJson);
    const rules = parsePolicyRuleDefinitions(record.ruleDefinitionsJson).map((rule) => ({
      ...rule,
      disposition: 'pass' as const,
    }));

    return {
      id: record.id,
      institutionId: createInstitutionId(record.institution, record.faculty),
      institution: record.institution,
      faculty: record.faculty,
      version: record.version,
      title: record.title,
      requiredSections,
      rules,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapComplianceRunRecord(record: typeof complianceRuns.$inferSelect): Promise<ComplianceRunPayload> {
    const summaryPayload = parseJsonObject(record.summaryJson) ?? {};
    const policyProfile = await this.db.query.policyProfiles.findFirst({
      where: (fields, operators) => operators.eq(fields.id, record.policyProfileId),
    });

    if (!policyProfile) {
      throw new PolicyProfileNotFoundError();
    }

    const issues = await this.db
      .select()
      .from(complianceIssues)
      .where(eq(complianceIssues.complianceRunId, record.id))
      .orderBy(asc(complianceIssues.ruleId), asc(complianceIssues.id))
      .all();

    const mappedIssues = await Promise.all(issues.map((issue) => this.mapComplianceIssueRecord(issue)));
    const issueByRule = new Map(mappedIssues.map((issue) => [issue.ruleId, issue]));
    const persistedRuleResults = parseComplianceRuleResults(summaryPayload.ruleResults);
    const profilePayload = this.mapPolicyProfileRecord(policyProfile);
    const ruleResults = profilePayload.rules.map((rule) => {
      const persisted = persistedRuleResults.find((candidate) => candidate.ruleId === rule.id);
      const issue = issueByRule.get(rule.id) ?? null;
      return {
        ruleId: rule.id,
        title: rule.title,
        category: rule.category,
        disposition: persisted?.disposition ?? issue?.disposition ?? 'pass',
        severity: persisted?.severity ?? issue?.severity ?? null,
        issueId: issue?.id ?? persisted?.issueId ?? null,
        normalizedNodeId: issue?.normalizedNodeId ?? persisted?.normalizedNodeId ?? null,
        message: issue?.message ?? persisted?.message ?? rule.description,
        remediation: issue?.remediation ?? persisted?.remediation ?? rule.remediation,
      } satisfies ComplianceRuleResultPayload;
    });

    return {
      id: record.id,
      thesisId: record.thesisId,
      policyProfileId: record.policyProfileId,
      policyProfileVersion: typeof summaryPayload.policyProfileVersion === 'string' ? summaryPayload.policyProfileVersion : policyProfile.version,
      policyInstitutionId: typeof summaryPayload.policyInstitutionId === 'string'
        ? summaryPayload.policyInstitutionId
        : createInstitutionId(policyProfile.institution, policyProfile.faculty),
      status: normalizeComplianceRunStatus(record.status),
      summary: {
        degradedConfidence: summaryPayload.degradedConfidence === true,
        warnings: Array.isArray(summaryPayload.warnings)
          ? summaryPayload.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
        evaluatedNodeCount: typeof summaryPayload.evaluatedNodeCount === 'number' ? summaryPayload.evaluatedNodeCount : 0,
        structureSelectionMode: typeof summaryPayload.structureSelectionMode === 'string' ? summaryPayload.structureSelectionMode : null,
      },
      counts: {
        evaluated: record.evaluatedRuleCount,
        warnings: record.warningRuleCount,
        skipped: record.skippedRuleCount,
        violations: ruleResults.filter((result) => result.disposition === 'violation').length,
      },
      ruleResults,
      issues: mappedIssues,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapComplianceIssueRecord(record: typeof complianceIssues.$inferSelect): Promise<ComplianceIssuePayload> {
    const thesis = await this.requireThesis(record.thesisId);
    const evidenceFragmentsForThesis = await this.listEvidenceFragments(record.thesisId);
    const zoteroMappingsForThesis = await this.listZoteroMappings(record.thesisId);
    const relatedEvidenceFragments = evidenceFragmentsForThesis.filter((fragment) =>
      record.normalizedNodeId ? fragment.normalizedNodeId === record.normalizedNodeId : true,
    );

    return {
      id: record.id,
      thesisId: record.thesisId,
      complianceRunId: record.complianceRunId,
      policyProfileId: record.policyProfileId,
      ruleId: record.ruleId,
      normalizedNodeId: record.normalizedNodeId,
      severity: record.severity === 'warning' ? 'warning' : 'violation',
      message: record.message,
      remediation: record.remediation,
      disposition: normalizePolicyRuleDisposition(record.disposition),
      evidenceContext: {
        sourceIds: Array.from(new Set(relatedEvidenceFragments.map((fragment) => fragment.sourceId))),
        evidenceFragmentIds: relatedEvidenceFragments.map((fragment) => fragment.id),
        zoteroMappingIds: zoteroMappingsForThesis
          .filter((mapping) => record.normalizedNodeId ? mapping.normalizedNodeId === record.normalizedNodeId || mapping.scope === 'thesis' : mapping.scope === 'thesis')
          .map((mapping) => mapping.id),
        buildRunId: thesis.activeBuildRunId,
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapAcademicQaRunRecord(record: typeof academicQaRuns.$inferSelect): Promise<AcademicQaRunPayload> {
    const assessedScope = parseAcademicQaAssessedScope(record.assessedScopeJson);
    const skippedScope = parseAcademicQaSkippedScope(record.skippedScopeJson);
    const summary = parseAcademicQaSummary(record.summaryJson, assessedScope, skippedScope);
    const issues = await this.db
      .select()
      .from(academicQaIssues)
      .where(eq(academicQaIssues.academicQaRunId, record.id))
      .orderBy(asc(academicQaIssues.category), asc(academicQaIssues.id))
      .all();
    const mappedIssues = await Promise.all(issues.map((issue) => this.mapAcademicQaIssueRecord(issue)));
    const issueCategories = Array.from(new Set(mappedIssues.map((issue) => issue.category))).sort() as AcademicQaIssueCategory[];

    return {
      id: record.id,
      thesisId: record.thesisId,
      status: normalizeAcademicQaRunStatus(record.status),
      issueCategories,
      assessedScope,
      skippedScope,
      summary,
      issues: mappedIssues,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async mapAcademicQaIssueRecord(record: typeof academicQaIssues.$inferSelect): Promise<AcademicQaIssuePayload> {
    const category = this.normalizeAcademicQaIssueCategory(record.category);
    const groundedEntityType = record.claimId ? 'claim' : 'section';
    const groundedEntityId = record.claimId ?? record.normalizedNodeId ?? '';
    const thesis = await this.requireThesis(record.thesisId);
    const claimsForThesis = await this.listClaims(record.thesisId);
    const zoteroMappingsForThesis = await this.listZoteroMappings(record.thesisId);
    const matchingClaim = record.claimId ? claimsForThesis.find((claim) => claim.id === record.claimId) ?? null : null;

    return {
      id: record.id,
      thesisId: record.thesisId,
      academicQaRunId: record.academicQaRunId,
      claimId: record.claimId,
      normalizedNodeId: record.normalizedNodeId,
      category,
      severity: record.severity === 'issue' ? 'issue' : 'warning',
      message: record.message,
      rationale: record.rationale,
      remediation: record.remediation,
      triggeringCondition: record.triggeringCondition,
      supportContext: {
        sourceIds: matchingClaim?.traceability.sourceIds ?? [],
        evidenceFragmentIds: matchingClaim?.traceability.evidenceFragments.map((fragment) => fragment.id) ?? [],
        zoteroMappingIds: zoteroMappingsForThesis
          .filter((mapping) => record.normalizedNodeId ? mapping.normalizedNodeId === record.normalizedNodeId || mapping.scope === 'thesis' : mapping.scope === 'thesis')
          .map((mapping) => mapping.id),
        buildRunId: thesis.activeBuildRunId,
      },
      groundedIn: {
        entityType: groundedEntityType,
        entityId: groundedEntityId,
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private buildAcademicQaIssueRecord(input: {
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
  }): typeof academicQaIssues.$inferInsert {
    return {
      id: createAcademicQaIssueId(input),
      thesisId: input.thesisId,
      academicQaRunId: input.academicQaRunId,
      claimId: input.claimId,
      normalizedNodeId: input.normalizedNodeId,
      category: input.category.replace(/-/g, '_'),
      severity: input.severity,
      message: input.message,
      rationale: input.rationale,
      remediation: input.remediation,
      triggeringCondition: input.triggeringCondition,
      createdAt: '',
      updatedAt: '',
    };
  }

  private normalizeAcademicQaIssueCategory(category: string): AcademicQaIssueCategory {
    switch (category) {
      case 'evidence_gap':
      case 'evidence-gap':
        return 'evidence-gap';
      case 'citation_weakness':
      case 'citation-weakness':
        return 'citation-weakness';
      case 'methodology':
        return 'methodology';
      case 'coherence':
      default:
        return 'coherence';
    }
  }
}

export function createThesisLifecycleService(databaseUrl?: string) {
  const connection = createDatabaseConnection(databaseUrl);

  return {
    service: new ThesisLifecycleService(connection.db),
    close: () => connection.sqlite.close(),
  };
}

function parseBlockers(blockersJson: string): ThesisBlockers {
  try {
    const parsed = JSON.parse(blockersJson);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'tesis';
}

function summarizeFeedback(body: string): string {
  const normalized = body.trim().replace(/\s+/g, ' ');
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

function normalizeFeedbackSource(value: string): ThesisFeedbackSource {
  switch (value) {
    case 'user':
    case 'system':
    case 'qa':
    case 'compliance':
      return value;
    default:
      return 'system';
  }
}

function normalizeAuthors(authors: string[]): string[] {
  return authors.map((author) => author.trim()).filter(Boolean);
}

function createSourceSignature(input: {
  thesisId: string;
  sourceType: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  locator: string | null;
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      thesisId: input.thesisId,
      sourceType: input.sourceType,
      title: input.title.trim().toLocaleLowerCase(),
      authors: input.authors.map((author) => author.toLocaleLowerCase()),
      publicationYear: input.publicationYear,
      locator: input.locator?.trim().toLocaleLowerCase() ?? null,
    }))
    .digest('hex');
}

function buildSourceIngestMetadata(input: {
  sourceType: string;
  title: string;
  locator: string | null;
  ingest?: { ingestStatus?: SourceIngestStatus; pdfText?: string | null; pdfMetadata?: Record<string, unknown> | null };
  signature: string;
}) {
  const pdfOutcome = input.sourceType === 'pdf'
    ? derivePdfExtractionMetadata(input.ingest?.pdfText ?? null, input.ingest?.pdfMetadata ?? null)
    : { pdfExtractionStatus: 'not_attempted' as PdfExtractionStatus, pdfMetadata: null, warnings: [] as string[], failures: [] as IntakeFailureDiagnostic[] };
  const ingestStatus = input.ingest?.ingestStatus
    ?? (input.sourceType === 'pdf'
      ? pdfOutcome.pdfExtractionStatus === 'succeeded'
        ? 'succeeded'
        : pdfOutcome.pdfExtractionStatus === 'degraded'
          ? 'degraded'
          : pdfOutcome.pdfExtractionStatus === 'failed'
            ? 'failed'
            : 'queued'
      : 'succeeded');

  return {
    ingestStatus,
    duplicateState: 'unique' as SourceDuplicateState,
    duplicateOfSourceId: null,
    pdfExtractionStatus: pdfOutcome.pdfExtractionStatus,
    pdfMetadata: pdfOutcome.pdfMetadata,
    warnings: pdfOutcome.warnings,
    failures: pdfOutcome.failures,
    signature: input.signature,
  };
}

function derivePdfExtractionMetadata(pdfText: string | null, pdfMetadata: Record<string, unknown> | null) {
  const normalizedText = pdfText?.trim() ?? '';
  if (!normalizedText && !pdfMetadata) {
    return {
      pdfExtractionStatus: 'failed' as PdfExtractionStatus,
      pdfMetadata: null,
      warnings: [] as string[],
      failures: [{ code: 'PDF_TEXT_UNAVAILABLE', message: 'PDF extraction failed because no text or metadata could be recovered.' }],
    };
  }

  if (!normalizedText || normalizedText.length < 80) {
    return {
      pdfExtractionStatus: 'degraded' as PdfExtractionStatus,
      pdfMetadata: {
        ...(pdfMetadata ?? {}),
        extractedTextLength: normalizedText.length,
        extractedTextPreview: normalizedText || null,
      },
      warnings: ['PDF extraction degraded because extracted text was weak or incomplete.'],
      failures: [] as IntakeFailureDiagnostic[],
    };
  }

  return {
    pdfExtractionStatus: 'succeeded' as PdfExtractionStatus,
    pdfMetadata: {
      ...(pdfMetadata ?? {}),
      extractedTextLength: normalizedText.length,
      extractedTextPreview: normalizedText.slice(0, 240),
    },
    warnings: [] as string[],
    failures: [] as IntakeFailureDiagnostic[],
  };
}

function deriveSourceStatus(ingest: SourcePayload['ingest']): SourcePayload['status'] {
  switch (ingest.ingestStatus) {
    case 'queued':
    case 'not_started':
      return 'registered';
    case 'succeeded':
      return 'ready';
    case 'degraded':
      return 'degraded';
    case 'failed':
      return 'failed';
    default:
      return 'registered';
  }
}

function parseSourceIngestMetadata(value: string): SourcePayload['ingest'] {
  const parsed = parseJsonObject(value) ?? {};
  return {
    ingestStatus: normalizeSourceIngestStatus(typeof parsed.ingestStatus === 'string' ? parsed.ingestStatus : 'not_started'),
    duplicateState: parsed.duplicateState === 'duplicate' ? 'duplicate' : 'unique',
    duplicateOfSourceId: typeof parsed.duplicateOfSourceId === 'string' ? parsed.duplicateOfSourceId : null,
    pdfExtractionStatus: normalizePdfExtractionStatus(typeof parsed.pdfExtractionStatus === 'string' ? parsed.pdfExtractionStatus : 'not_attempted'),
    pdfMetadata: typeof parsed.pdfMetadata === 'object' && parsed.pdfMetadata !== null ? parsed.pdfMetadata as Record<string, unknown> : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
    failures: Array.isArray(parsed.failures)
      ? parsed.failures.filter((item): item is IntakeFailureDiagnostic => typeof item === 'object' && item !== null && typeof (item as { code?: unknown }).code === 'string' && typeof (item as { message?: unknown }).message === 'string')
      : [],
    signature: typeof parsed.signature === 'string' ? parsed.signature : '',
  };
}

function normalizeSourceType(value: string): SourcePayload['sourceType'] {
  switch (value) {
    case 'book':
    case 'article':
    case 'web':
    case 'pdf':
    case 'note':
      return value;
    default:
      return 'other';
  }
}

function normalizeSourceStatus(value: string): SourcePayload['status'] {
  switch (value) {
    case 'registered':
    case 'ingesting':
    case 'ready':
    case 'degraded':
    case 'failed':
      return value;
    default:
      return 'registered';
  }
}

function normalizeEvidenceStatus(value: string): EvidenceFragmentPayload['status'] {
  switch (value) {
    case 'captured':
    case 'needs_review':
    case 'rejected':
      return value;
    default:
      return 'needs_review';
  }
}

function normalizeClaimStatus(value: string): ClaimPayload['status'] {
  switch (value) {
    case 'draft':
    case 'supported':
    case 'contested':
    case 'archived':
      return value;
    default:
      return 'draft';
  }
}

function normalizeSourceIngestStatus(value: string): SourceIngestStatus {
  switch (value) {
    case 'queued':
    case 'succeeded':
    case 'degraded':
    case 'failed':
      return value;
    default:
      return 'not_started';
  }
}

function normalizePdfExtractionStatus(value: string): PdfExtractionStatus {
  switch (value) {
    case 'succeeded':
    case 'degraded':
    case 'failed':
      return value;
    default:
      return 'not_attempted';
  }
}

function normalizeSourceFormat(value: string): SourceFormat {
  switch (value) {
    case 'latex':
    case 'docx':
    case 'pdf':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeIntakeStatus(value: string): IntakeStatus {
  switch (value) {
    case 'queued':
    case 'running':
    case 'succeeded':
    case 'partial':
    case 'failed':
      return value;
    default:
      return 'failed';
  }
}

function parseIntakeReport(value: string): IntakeReportSummary | null {
  try {
    return JSON.parse(value) as IntakeReportSummary;
  } catch {
    return null;
  }
}

const SEEDED_POLICY_PROFILE_ID = 'policy-profile-universidad-demo-ingenieria-v1';

const SEEDED_POLICY_RULES: PolicyRuleDefinition[] = [
  {
    id: 'structure.required-introduction',
    title: 'Introducción obligatoria',
    description: 'La tesis debe incluir una sección o capítulo de introducción.',
    category: 'structure',
    severity: 'violation',
    remediation: 'Añade una sección de Introducción con el contexto del problema y el objetivo general.',
    requiredSectionTitle: 'Introducción',
  },
  {
    id: 'structure.required-methodology',
    title: 'Metodología obligatoria',
    description: 'La tesis debe describir la metodología utilizada.',
    category: 'structure',
    severity: 'violation',
    remediation: 'Añade una sección de Metodología que detalle el enfoque de investigación.',
    requiredSectionTitle: 'Metodología',
  },
  {
    id: 'structure.required-results',
    title: 'Resultados obligatorios',
    description: 'La tesis debe presentar una sección de resultados.',
    category: 'structure',
    severity: 'violation',
    remediation: 'Añade una sección de Resultados con los hallazgos principales.',
    requiredSectionTitle: 'Resultados',
  },
  {
    id: 'structure.required-conclusions',
    title: 'Conclusiones obligatorias',
    description: 'La tesis debe cerrar con una sección de conclusiones.',
    category: 'structure',
    severity: 'violation',
    remediation: 'Añade una sección de Conclusiones con el cierre y trabajo futuro.',
    requiredSectionTitle: 'Conclusiones',
  },
  {
    id: 'metadata.min-section-count',
    title: 'Mínimo de secciones estructurales',
    description: 'La estructura normalizada debe contener al menos dos secciones principales evaluables.',
    category: 'metadata',
    severity: 'warning',
    remediation: 'Amplía la estructura visible de la tesis antes de ejecutar la validación final.',
    minimumDocumentChildren: 2,
  },
];

async function ensureSeedPolicyProfile(db: ThesisDbClient) {
  const existing = await db.query.policyProfiles.findFirst({
    where: (fields, operators) => operators.eq(fields.id, SEEDED_POLICY_PROFILE_ID),
  });

  if (existing) {
    if (!existing.isActive) {
      await db
        .update(policyProfiles)
        .set({ isActive: true, updatedAt: new Date().toISOString() })
        .where(eq(policyProfiles.id, SEEDED_POLICY_PROFILE_ID));
    }

    return;
  }

  const now = new Date().toISOString();
  await db.insert(policyProfiles).values({
    id: SEEDED_POLICY_PROFILE_ID,
    institution: 'Universidad Demo',
    faculty: 'Ingeniería',
    version: '2026.1',
    title: 'Perfil de cumplimiento v1 para Facultad de Ingeniería',
    requiredSectionsJson: JSON.stringify([
      'Introducción',
      'Metodología',
      'Resultados',
      'Conclusiones',
    ]),
    ruleDefinitionsJson: JSON.stringify(SEEDED_POLICY_RULES),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

function createInstitutionId(institution: string, faculty: string) {
  return `${slugify(institution)}::${slugify(faculty)}`;
}

function parsePolicyRuleDefinitions(value: string): PolicyRuleDefinition[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<PolicyRuleDefinition>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.title !== 'string' ||
        typeof candidate.description !== 'string' ||
        (candidate.category !== 'structure' && candidate.category !== 'metadata') ||
        (candidate.severity !== 'warning' && candidate.severity !== 'violation') ||
        typeof candidate.remediation !== 'string'
      ) {
        return [];
      }

      return [{
        id: candidate.id,
        title: candidate.title,
        description: candidate.description,
        category: candidate.category,
        severity: candidate.severity,
        remediation: candidate.remediation,
        requiredSectionTitle: typeof candidate.requiredSectionTitle === 'string' ? candidate.requiredSectionTitle : undefined,
        minimumDocumentChildren: typeof candidate.minimumDocumentChildren === 'number' ? candidate.minimumDocumentChildren : undefined,
      } satisfies PolicyRuleDefinition];
    });
  } catch {
    return [];
  }
}

function normalizePolicyRuleDisposition(value: string): PolicyRuleDisposition {
  switch (value) {
    case 'pass':
    case 'violation':
    case 'warning':
    case 'skipped':
      return value;
    default:
      return 'warning';
  }
}

function normalizeComplianceRunStatus(value: string): ComplianceRunPayload['status'] {
  switch (value) {
    case 'completed':
    case 'completed_with_warnings':
    case 'failed':
      return value;
    default:
      return 'failed';
  }
}

function normalizeAcademicQaRunStatus(value: string): AcademicQaRunPayload['status'] {
  return value === 'completed_with_warnings' ? 'completed_with_warnings' : 'completed';
}

function createAcademicQaIssueId(input: {
  thesisId: string;
  claimId: string | null;
  normalizedNodeId: string | null;
  category: AcademicQaIssueCategory;
  triggeringCondition: string;
}) {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
}

function parseAcademicQaAssessedScope(value: string): AcademicQaRunPayload['assessedScope'] {
  const parsed = parseJsonObject(value) ?? {};
  const claimIds = Array.isArray(parsed.claimIds) ? parsed.claimIds.filter((item): item is string => typeof item === 'string') : [];
  const normalizedNodeIds = Array.isArray(parsed.normalizedNodeIds)
    ? parsed.normalizedNodeIds.filter((item): item is string => typeof item === 'string')
    : [];
  const counts = typeof parsed.counts === 'object' && parsed.counts !== null ? parsed.counts as Record<string, unknown> : {};

  return {
    claimIds,
    normalizedNodeIds,
    counts: {
      claims: typeof counts.claims === 'number' ? counts.claims : claimIds.length,
      sections: typeof counts.sections === 'number' ? counts.sections : normalizedNodeIds.length,
    },
  };
}

function parseAcademicQaSkippedScope(value: string): AcademicQaRunPayload['skippedScope'] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Record<string, unknown>;
      const entityType = candidate.entityType === 'section' ? 'section' : candidate.entityType === 'claim' ? 'claim' : null;
      const entityId = typeof candidate.entityId === 'string' ? candidate.entityId : null;
      const reason = typeof candidate.reason === 'string' ? candidate.reason : null;

      return entityType && entityId && reason ? [{ entityType, entityId, reason }] : [];
    });
  } catch {
    return [];
  }
}

function parseAcademicQaSummary(
  value: string,
  assessedScope: AcademicQaRunPayload['assessedScope'],
  skippedScope: AcademicQaRunPayload['skippedScope'],
): AcademicQaRunPayload['summary'] {
  const parsed = parseJsonObject(value) ?? {};
  const findingsByCategory = typeof parsed.findingsByCategory === 'object' && parsed.findingsByCategory !== null
    ? parsed.findingsByCategory as Record<string, unknown>
    : {};

  return {
    findingsByCategory: {
      'evidence-gap': typeof findingsByCategory['evidence-gap'] === 'number' ? findingsByCategory['evidence-gap'] : 0,
      'citation-weakness': typeof findingsByCategory['citation-weakness'] === 'number' ? findingsByCategory['citation-weakness'] : 0,
      methodology: typeof findingsByCategory.methodology === 'number' ? findingsByCategory.methodology : 0,
      coherence: typeof findingsByCategory.coherence === 'number' ? findingsByCategory.coherence : 0,
    },
    assessedClaimCount: typeof parsed.assessedClaimCount === 'number' ? parsed.assessedClaimCount : assessedScope.counts.claims,
    assessedSectionCount: typeof parsed.assessedSectionCount === 'number' ? parsed.assessedSectionCount : assessedScope.counts.sections,
    skippedCount: typeof parsed.skippedCount === 'number' ? parsed.skippedCount : skippedScope.length,
  };
}

function parseComplianceRuleResults(value: unknown): ComplianceRuleResultPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const candidate = entry as Partial<ComplianceRuleResultPayload>;
    if (typeof candidate.ruleId !== 'string' || typeof candidate.title !== 'string' || typeof candidate.message !== 'string') {
      return [];
    }

    return [{
      ruleId: candidate.ruleId,
      title: candidate.title,
      category: candidate.category === 'metadata' ? 'metadata' : 'structure',
      disposition: normalizePolicyRuleDisposition(typeof candidate.disposition === 'string' ? candidate.disposition : 'warning'),
      severity: candidate.severity === 'warning' || candidate.severity === 'violation' ? candidate.severity : null,
      issueId: typeof candidate.issueId === 'string' ? candidate.issueId : null,
      normalizedNodeId: typeof candidate.normalizedNodeId === 'string' ? candidate.normalizedNodeId : null,
      message: candidate.message,
      remediation: typeof candidate.remediation === 'string' ? candidate.remediation : null,
    } satisfies ComplianceRuleResultPayload];
  });
}

function evaluatePolicyRules(input: {
  thesisId: string;
  policyProfile: PolicyProfilePayload;
  sectionNodes: NormalizedNodePayload[];
  degradedConfidence: boolean;
}) {
  const normalizedTitleMap = new Map(
    input.sectionNodes
      .filter((node) => typeof node.title === 'string' && node.title.trim().length > 0)
      .map((node) => [slugify(node.title ?? ''), node]),
  );

  return input.policyProfile.rules.map((rule) => {
    if (rule.category === 'metadata') {
      if (input.degradedConfidence) {
        return {
          ruleId: rule.id,
          title: rule.title,
          category: rule.category,
          disposition: 'skipped' as const,
          severity: null,
          issueId: null,
          normalizedNodeId: null,
          message: 'La regla se omitió porque la confianza estructural es insuficiente para evaluar metadatos agregados.',
          remediation: rule.remediation,
          issue: null,
        };
      }

      const passes = input.sectionNodes.length >= (rule.minimumDocumentChildren ?? 0);
      return {
        ruleId: rule.id,
        title: rule.title,
        category: rule.category,
        disposition: passes ? ('pass' as const) : ('warning' as const),
        severity: passes ? null : 'warning',
        issueId: passes ? null : createStableComplianceIssueId(input.thesisId, input.policyProfile.id, rule.id, null),
        normalizedNodeId: null,
        message: passes
          ? 'La estructura visible cumple el mínimo de secciones requeridas.'
          : 'La estructura visible no alcanza el mínimo de secciones requeridas.',
        remediation: rule.remediation,
        issue: passes
          ? null
          : buildComplianceIssueRecord({
              thesisId: input.thesisId,
              complianceRunId: '',
              policyProfileId: input.policyProfile.id,
              ruleId: rule.id,
              normalizedNodeId: null,
              severity: 'warning',
              message: 'La estructura visible no alcanza el mínimo de secciones requeridas.',
              remediation: rule.remediation,
              disposition: 'warning',
            }),
      };
    }

    const matchingNode = rule.requiredSectionTitle
      ? normalizedTitleMap.get(slugify(rule.requiredSectionTitle)) ?? null
      : null;

    if (matchingNode) {
      return {
        ruleId: rule.id,
        title: rule.title,
        category: rule.category,
        disposition: 'pass' as const,
        severity: null,
        issueId: null,
        normalizedNodeId: matchingNode.id,
        message: `Se encontró la sección requerida ${rule.requiredSectionTitle}.`,
        remediation: rule.remediation,
        issue: null,
      };
    }

    if (input.degradedConfidence) {
      const issue = buildComplianceIssueRecord({
        thesisId: input.thesisId,
        complianceRunId: '',
        policyProfileId: input.policyProfile.id,
        ruleId: rule.id,
        normalizedNodeId: null,
        severity: 'warning',
        message: `No se confirmó la sección requerida ${rule.requiredSectionTitle} debido a baja confianza estructural.`,
        remediation: rule.remediation,
        disposition: 'warning',
      });

      return {
        ruleId: rule.id,
        title: rule.title,
        category: rule.category,
        disposition: 'warning' as const,
        severity: 'warning' as const,
        issueId: issue.id,
        normalizedNodeId: null,
        message: issue.message,
        remediation: issue.remediation,
        issue,
      };
    }

    const issue = buildComplianceIssueRecord({
      thesisId: input.thesisId,
      complianceRunId: '',
      policyProfileId: input.policyProfile.id,
      ruleId: rule.id,
      normalizedNodeId: null,
      severity: 'violation',
      message: `Falta la sección requerida ${rule.requiredSectionTitle}.`,
      remediation: rule.remediation,
      disposition: 'violation',
    });

    return {
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      disposition: 'violation' as const,
      severity: 'violation' as const,
      issueId: issue.id,
      normalizedNodeId: null,
      message: issue.message,
      remediation: issue.remediation,
      issue,
    };
  }).map((result) => ({
    ...result,
    issue: result.issue
      ? { ...result.issue, complianceRunId: result.issue.complianceRunId }
      : null,
  }));
}

function createStableComplianceIssueId(
  thesisId: string,
  policyProfileId: string,
  ruleId: string,
  normalizedNodeId: string | null,
) {
  return createHash('sha256')
    .update([thesisId, policyProfileId, ruleId, normalizedNodeId ?? 'none'].join('::'))
    .digest('hex')
    .slice(0, 24);
}

function buildComplianceIssueRecord(input: {
  thesisId: string;
  complianceRunId: string;
  policyProfileId: string;
  ruleId: string;
  normalizedNodeId: string | null;
  severity: 'warning' | 'violation';
  message: string;
  remediation: string;
  disposition: 'warning' | 'violation';
}): typeof complianceIssues.$inferInsert {
  const timestamp = new Date().toISOString();
  return {
    id: createStableComplianceIssueId(input.thesisId, input.policyProfileId, input.ruleId, input.normalizedNodeId),
    thesisId: input.thesisId,
    complianceRunId: input.complianceRunId,
    policyProfileId: input.policyProfileId,
    ruleId: input.ruleId,
    normalizedNodeId: input.normalizedNodeId,
    severity: input.severity,
    message: input.message,
    remediation: input.remediation,
    disposition: input.disposition,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildIntakeRecommendations(input: {
  terminalStatus: IntakeStatus;
  failures: IntakeFailureDiagnostic[];
  structureSummary: IntakeReportSummary['structureSummary'];
  normalizationSummary: IntakeReportSummary['normalizationSummary'];
  priorActiveImportId: string | null;
  recoverableCheckpointId: string | null;
}): IntakeReportRecommendation[] {
  if (input.terminalStatus !== 'succeeded') {
    return [
      {
        code: 'FIX_IMPORT_SOURCE',
        message: 'Repair or replace the source input, then retry the import.',
        triggeredBy: input.failures.map((failure) => failure.code),
      },
    ];
  }

  const recommendations: IntakeReportRecommendation[] = [
    {
      code: 'ACTIVATE_IMPORTED_WORKSPACE',
      message: 'El workspace importado ya es el activo; continúa desde la estructura normalizada.',
      triggeredBy: ['finding:structure:ready', 'finding:normalization:complete'],
    },
  ];

  if (input.priorActiveImportId && input.recoverableCheckpointId) {
    recommendations.push({
      code: 'REVIEW_REIMPORT_REPLACEMENT',
      message: 'La re-importación sustituyó explícitamente el workspace activo; usa el checkpoint recuperable si necesitas restaurar la versión previa.',
      triggeredBy: [`reimport:replaces:${input.priorActiveImportId}`, `checkpoint:${input.recoverableCheckpointId}`],
    });
  }

  if (input.structureSummary && input.normalizationSummary) {
    recommendations.push({
      code: 'RUN_QA_ON_IMPORTED_STRUCTURE',
      message: 'Ejecuta las siguientes verificaciones o retoma la edición sobre la estructura importada activa.',
      triggeredBy: [
        `finding:entrypoint:${input.structureSummary.entrypoint ?? 'unknown'}`,
        `finding:root-node-count:${input.normalizationSummary.rootNodeIds.length}`,
      ],
    });
  }

  return recommendations;
}

function summarizeRecommendedNextStep(recommendations: IntakeReportRecommendation[]): string {
  return recommendations[0]?.message ?? 'Review the latest thesis state and continue the next workflow step.';
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseRecommendations(value: string): IntakeReportRecommendation[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecommendation) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseNullableJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  return parseJsonObject(value);
}

function resolveZoteroConnectorMode(): ZoteroConnectorMode {
  const configuredMode = process.env.ZOTERO_CONNECTOR_MODE?.trim();
  switch (configuredMode) {
    case 'mock':
    case 'test':
    case 'live':
      return configuredMode;
    default:
      return DEFAULT_ZOTERO_CONNECTOR_MODE;
  }
}

function normalizeZoteroConnectorStatus(value: string): 'ready' | 'degraded' {
  return value === 'ready' ? 'ready' : 'degraded';
}

function createZoteroMockConnector() {
  const mode = resolveZoteroConnectorMode();
  const dataset = DEFAULT_ZOTERO_DATASET;
  const timestamp = '2026-03-11T00:00:00.000Z';

  const mapLibrary = (record: ZoteroMockLibraryRecord): ZoteroLibraryPayload => ({
    id: record.key,
    key: record.key,
    mode,
    externalId: record.key,
    name: record.name,
    kind: record.kind,
    itemCount: record.itemCount,
    collectionCount: record.collectionCount,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const mapCollection = (record: ZoteroMockCollectionRecord): ZoteroCollectionPayload => ({
    id: record.key,
    key: record.key,
    mode,
    externalId: record.key,
    libraryId: record.libraryKey,
    libraryKey: record.libraryKey,
    parentCollectionKey: record.parentCollectionKey,
    name: record.name,
    path: [...record.path],
    itemCount: record.itemCount,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const mapItem = (record: ZoteroMockItemRecord): ZoteroItemPayload => ({
    id: record.key,
    key: record.key,
    mode,
    externalId: record.key,
    libraryId: record.libraryKey,
    libraryKey: record.libraryKey,
    collectionKeys: [...record.collectionKeys],
    itemType: record.itemType,
    title: record.title,
    creators: [...record.creators],
    date: record.date,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const filterItems = (items: ZoteroMockItemRecord[], filter: { libraryKey?: string | null; collectionKey?: string | null }) =>
    items.filter((item) => {
      if (filter.libraryKey && item.libraryKey !== filter.libraryKey) {
        return false;
      }

      if (filter.collectionKey && !item.collectionKeys.includes(filter.collectionKey)) {
        return false;
      }

      return true;
    });

  return {
    listLibraries(): ZoteroLibraryPayload[] {
      return dataset.libraries
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key))
        .map(mapLibrary);
    },

    listCollections(filter: { libraryKey?: string | null } = {}): ZoteroCollectionPayload[] {
      return dataset.collections
        .filter((collection) => !filter.libraryKey || collection.libraryKey === filter.libraryKey)
        .slice()
        .sort((left, right) => left.path.join(' / ').localeCompare(right.path.join(' / ')) || left.key.localeCompare(right.key))
        .map(mapCollection);
    },

    listItems(filter: { libraryKey?: string | null; collectionKey?: string | null } = {}): ZoteroItemPayload[] {
      return filterItems(dataset.items, filter)
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title) || left.key.localeCompare(right.key))
        .map(mapItem);
    },

    searchItems(filter: { query: string; libraryKey?: string | null; collectionKey?: string | null }): ZoteroItemPayload[] {
      const query = filter.query.trim().toLocaleLowerCase();

      return filterItems(dataset.items, filter)
        .filter((item) => {
          if (!query) {
            return true;
          }

          const haystack = [item.title, item.itemType, item.date ?? '', ...item.creators].join(' ').toLocaleLowerCase();
          return haystack.includes(query);
        })
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title) || left.key.localeCompare(right.key))
        .map(mapItem);
    },

    resolveNormalizedMapping(filter: { libraryId: string; collectionKey?: string | null; itemKey?: string | null }) {
      const library = dataset.libraries.find((entry) => entry.key === filter.libraryId) ?? null;
      const collection = filter.collectionKey
        ? dataset.collections.find((entry) => entry.key === filter.collectionKey && entry.libraryKey === filter.libraryId) ?? null
        : null;
      const item = filter.itemKey
        ? dataset.items.find((entry) => entry.key === filter.itemKey && entry.libraryKey === filter.libraryId) ?? null
        : null;

      const missingParts = [
        library ? null : 'library',
        filter.collectionKey && !collection ? 'collection' : null,
        filter.itemKey && !item ? 'item' : null,
      ].filter((value): value is string => value !== null);

      if (missingParts.length > 0) {
        return {
        connectorStatus: 'degraded' as const,
          normalizedData: {
            library: library ? mapLibrary(library) : null,
            collection: collection ? mapCollection(collection) : null,
            item: item ? mapItem(item) : null,
            connectorMessage: `Zotero connector could not resolve ${missingParts.join(', ')} for the requested mapping refresh.`,
            connectorCode: 'ZOTERO_CONNECTOR_RESOLUTION_FAILED',
          },
        };
      }

      return {
        connectorStatus: 'ready' as const,
        normalizedData: {
          library: library ? mapLibrary(library) : null,
          collection: collection ? mapCollection(collection) : null,
          item: item ? mapItem(item) : null,
          connectorMessage: null,
          connectorCode: null,
        },
      };
    },
  };
}

function normalizeBuildStatus(value: string): LatexBuildRunPayload['status'] {
  switch (value) {
    case 'completed':
    case 'completed_with_warnings':
    case 'failed':
      return value;
    default:
      return 'failed';
  }
}

function defaultBibliographyConfiguration(): BibliographyConfiguration {
  return {
    mode: 'none',
    inputs: [],
    missingInputs: [],
    commands: [],
    status: 'not_required',
    detail: 'No bibliography configuration was detected.',
  };
}

function parseBibliographyConfiguration(value: unknown): BibliographyConfiguration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.mode !== 'string' || typeof candidate.status !== 'string' || typeof candidate.detail !== 'string') {
    return null;
  }

  return {
    mode: candidate.mode as BibliographyConfiguration['mode'],
    inputs: Array.isArray(candidate.inputs) ? candidate.inputs.filter((item): item is string => typeof item === 'string') : [],
    missingInputs: Array.isArray(candidate.missingInputs)
      ? candidate.missingInputs.filter((item): item is string => typeof item === 'string')
      : [],
    commands: Array.isArray(candidate.commands)
      ? candidate.commands.filter((item): item is 'bibtex' | 'biber' => item === 'bibtex' || item === 'biber')
      : [],
    status: candidate.status as BibliographyConfiguration['status'],
    detail: candidate.detail,
  };
}

function parseDiagnostics(value: unknown): LatexDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const candidate = item as Record<string, unknown>;
    if (typeof candidate.message !== 'string' || typeof candidate.severity !== 'string' || typeof candidate.category !== 'string' || typeof candidate.source !== 'string') {
      return [];
    }

    return [{
      severity: candidate.severity as LatexDiagnostic['severity'],
      category: candidate.category as LatexDiagnostic['category'],
      message: candidate.message,
      filePath: typeof candidate.filePath === 'string' ? candidate.filePath : null,
      line: typeof candidate.line === 'number' ? candidate.line : null,
      mappingStatus: candidate.mappingStatus === 'mapped' ? 'mapped' : 'unmapped',
      mappingReason: typeof candidate.mappingReason === 'string' ? candidate.mappingReason : null,
      source: candidate.source,
    } satisfies LatexDiagnostic];
  });
}

function parseDiagnosticsSummary(value: unknown, diagnostics: LatexDiagnostic[]): LatexBuildRunPayload['diagnosticsSummary'] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.errorCount === 'number' && typeof candidate.warningCount === 'number' && typeof candidate.infoCount === 'number') {
      return {
        errorCount: candidate.errorCount,
        warningCount: candidate.warningCount,
        infoCount: candidate.infoCount,
      };
    }
  }

  return summarizeDiagnostics(diagnostics);
}

function parseLatexCheckpointSnapshot(value: string): LatexCheckpointSnapshot | null {
  try {
    const parsed = JSON.parse(value) as LatexCheckpointSnapshot;
    return parsed?.kind === 'latex-edit' ? parsed : null;
  } catch {
    return null;
  }
}

function detectBibliographyConfiguration(importRootPath: string, filesInOrder: string[]): BibliographyConfiguration {
  const bibliographyInputs = new Set<string>();
  let sawBibliography = false;
  let sawBiblatex = false;
  let sawUnsupported = false;

  for (const relativePath of filesInOrder) {
    const absolutePath = path.join(importRootPath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');

    for (const match of content.matchAll(/\\bibliography\{([^}]*)\}/g)) {
      sawBibliography = true;
      for (const part of match[1]!.split(',')) {
        const trimmed = part.trim();
        if (trimmed) {
          bibliographyInputs.add(trimmed.endsWith('.bib') ? trimmed : `${trimmed}.bib`);
        }
      }
    }

    for (const match of content.matchAll(/\\addbibresource\{([^}]*)\}/g)) {
      sawBiblatex = true;
      const trimmed = match[1]!.trim();
      if (trimmed) {
        bibliographyInputs.add(trimmed);
      }
    }

    if (/\\bibliographystyle\{[^}]+\}/.test(content) && /\\printbibliography/.test(content)) {
      sawUnsupported = true;
    }
  }

  const inputs = Array.from(bibliographyInputs).sort((left, right) => left.localeCompare(right));
  const missingInputs = inputs.filter((input) => !fs.existsSync(path.resolve(importRootPath, input)));

  if (!sawBibliography && !sawBiblatex) {
    return defaultBibliographyConfiguration();
  }

  if (sawUnsupported || (sawBibliography && sawBiblatex)) {
    return {
      mode: 'unsupported',
      inputs,
      missingInputs,
      commands: [],
      status: 'unsupported',
      detail: 'Mixed or unsupported bibliography configuration was detected.',
    };
  }

  const mode = sawBiblatex ? 'biblatex' : 'bibliography';
  const commands: Array<'bibtex' | 'biber'> = mode === 'biblatex' ? ['biber'] : ['bibtex'];

  if (missingInputs.length > 0) {
    return {
      mode,
      inputs,
      missingInputs,
      commands,
      status: 'missing_inputs',
      detail: 'Referenced bibliography inputs are missing from the active thesis workspace.',
    };
  }

  return {
    mode,
    inputs,
    missingInputs: [],
    commands,
    status: 'ready',
    detail: mode === 'biblatex'
      ? 'Detected biblatex bibliography workflow via \\addbibresource.'
      : 'Detected BibTeX bibliography workflow via \\bibliography.',
  };
}

function resolveLatexBuildRoot(importRootPath: string, entrypoint: string | null) {
  if (!entrypoint) {
    return importRootPath;
  }

  return path.dirname(path.join(importRootPath, entrypoint));
}

function runContainerizedLatexBuild(input: {
  thesisId: string;
  workspacePath: string;
  importRootPath: string;
  entrypoint: string | null;
  bibliography: BibliographyConfiguration;
  artifactPath: string | null;
  logPath: string;
}) {
  if (!input.entrypoint) {
    throw new LatexBuildNotReadyError(input.thesisId, 'The active LaTeX workspace does not expose a buildable entrypoint.');
  }

  const buildRoot = resolveLatexBuildRoot(input.importRootPath, input.entrypoint);
  const outputFileName = `${path.basename(input.entrypoint, path.extname(input.entrypoint))}.pdf`;
  const latexCommand = buildLatexInvocationCommand(input.entrypoint, input.bibliography);
  const repoRoot = process.env.HOST_REPO_ROOT && fs.existsSync(path.join(process.env.HOST_REPO_ROOT, '.factory', 'bin', 'doc-tool.sh'))
    ? process.env.HOST_REPO_ROOT
    : findRepoRoot(process.cwd()) ?? process.cwd();
  const mountedBuildRoot = resolveLatexBuildMountedRoot(buildRoot, repoRoot);
  const shouldRunDocTool = input.bibliography.status === 'ready' || input.bibliography.status === 'not_required';
  const docToolResult = shouldRunDocTool
    ? (spawnSync(path.join(repoRoot, '.factory', 'bin', 'doc-tool.sh'), ['latex-build'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_API_VERSION: process.env.DOCKER_API_VERSION ?? '1.44',
          LATEX_BUILD_ROOT: mountedBuildRoot,
          LATEX_BUILD_COMMAND: latexCommand,
          PATH: `${process.env.PATH ?? ''}:/usr/bin:/usr/local/bin:/bin`,
        },
      }) as { status: number | null; stdout: string; stderr: string; error?: Error })
    : {
        status: 0,
        stdout: '',
        stderr: '',
        error: undefined,
      };

  const logLines = [
    `Containerized LaTeX build executed for ${input.entrypoint}.`,
    `Bibliography mode: ${input.bibliography.mode}.`,
    `Bibliography status: ${input.bibliography.status}.`,
    `Working directory: ${path.relative(input.importRootPath, buildRoot) || '.'}.`,
  ];

  if (!shouldRunDocTool) {
    logLines.push('Containerized LaTeX build skipped because bibliography preflight already determined the workflow cannot complete successfully.');
  }

  if (docToolResult.error) {
    logLines.push(`spawn-error: ${docToolResult.error.message}`);
  }
  logLines.push(`exit-status: ${String(docToolResult.status ?? 'null')}`);
  if (docToolResult.stdout) {
    logLines.push(docToolResult.stdout.trim());
  }
  if (docToolResult.stderr) {
    logLines.push(docToolResult.stderr.trim());
  }

  const sourceFileMap = collectLatexSourceFileMap(input.importRootPath);
  if (input.bibliography.status === 'missing_inputs') {
    for (const missingInput of input.bibliography.missingInputs) {
      const source = findBibliographyReferenceSource(sourceFileMap, missingInput);
      logLines.push(`${source.filePath ?? input.entrypoint}:${source.line ?? 1}: ERROR: Missing bibliography file ${missingInput}.`);
      logLines.push(`Latexmk: bibliography dependency ${missingInput} could not be resolved.`);
    }
  } else if (input.bibliography.status === 'unsupported') {
    logLines.push('latexmk: unsupported bibliography workflow detected; automatic bibliography run skipped.');
  }

  const generatedArtifactPath = path.join(buildRoot, outputFileName);
  const artifactExists = (docToolResult.status ?? 1) === 0
    && input.bibliography.status !== 'missing_inputs'
    && input.bibliography.status !== 'unsupported'
    && fs.existsSync(generatedArtifactPath);

  if (artifactExists && input.artifactPath) {
    fs.copyFileSync(generatedArtifactPath, input.artifactPath);
  }

  const exitCode = (docToolResult.status ?? 1) === 0 && input.bibliography.status === 'ready'
    ? 0
    : (docToolResult.status ?? 1) === 0 && input.bibliography.status === 'not_required'
      ? 0
      : 1;

  const log = logLines.filter(Boolean).join('\n');
  fs.writeFileSync(input.logPath, `${log}\n`, 'utf8');

  return {
    exitCode,
    log,
    artifactExists: Boolean(artifactExists && input.artifactPath && fs.existsSync(input.artifactPath)),
  };
}

function resolveLatexBuildMountedRoot(buildRoot: string, repoRoot: string) {
  const relativeBuildRoot = path.relative(repoRoot, buildRoot);

  if (!relativeBuildRoot.startsWith('..') && !path.isAbsolute(relativeBuildRoot)) {
    return relativeBuildRoot || '.';
  }

  const translatedHostPath = translateHostPathToMountedRoot(buildRoot);
  if (translatedHostPath) {
    return translatedHostPath;
  }

  const mappedWorkspacePath = mapWorkspacePathToMountedRoot(buildRoot);
  if (mappedWorkspacePath !== buildRoot) {
    return mappedWorkspacePath;
  }

  return buildRoot;
}

function buildLatexInvocationCommand(entrypoint: string, bibliography: BibliographyConfiguration) {
  const entrypointArg = path.posix.basename(entrypoint);
  const baseNameArg = path.posix.basename(entrypoint, path.extname(entrypoint));
  const latexEngine = bibliography.mode === 'biblatex' ? 'lualatex' : 'pdflatex';
  const commands = [
    buildCommandInvocation([latexEngine, '-interaction=nonstopmode', '-halt-on-error', entrypointArg]),
  ];

  if (bibliography.status === 'ready') {
    if (bibliography.mode === 'biblatex') {
      commands.push(buildCommandInvocation(['biber', baseNameArg]));
    } else if (bibliography.mode === 'bibliography') {
      commands.push(`if ! grep -q "\\\\bibstyle" -- ${shellEscape(`${baseNameArg}.aux`)}; then printf '%s\\n' '\\bibstyle{plain}' >> ${shellEscape(`${baseNameArg}.aux`)}; fi`);
      commands.push(buildCommandInvocation(['bibtex', baseNameArg]));
    }
    commands.push(buildCommandInvocation([latexEngine, '-interaction=nonstopmode', '-halt-on-error', entrypointArg]));
    commands.push(buildCommandInvocation([latexEngine, '-interaction=nonstopmode', '-halt-on-error', entrypointArg]));
  }

  return [
    'export PATH="/opt/texlive/texdir/bin/x86_64-linuxmusl:$PATH"; set -e',
    ...commands,
  ].join('; ');
}

function buildCommandInvocation(parts: string[]) {
  return parts.map((part) => shellEscape(part)).join(' ');
}

function shellEscape(value: string) {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function findRepoRoot(startPath: string) {
  let currentPath = path.resolve(startPath);

  while (true) {
    if (fs.existsSync(path.join(currentPath, '.factory', 'bin', 'doc-tool.sh'))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function collectLatexSourceFileMap(importRootPath: string) {
  const files = collectTexFiles(importRootPath);
  return files.map((relativePath) => ({
    relativePath,
    content: fs.readFileSync(path.join(importRootPath, relativePath), 'utf8'),
  }));
}

function findBibliographyReferenceSource(files: Array<{ relativePath: string; content: string }>, inputName: string) {
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (line.includes('\\bibliography{') || line.includes('\\addbibresource{')) {
        if (line.includes(inputName.replace(/\.bib$/, '')) || line.includes(inputName)) {
          return { filePath: file.relativePath, line: index + 1 };
        }
      }
    }
  }

  return { filePath: null, line: null };
}

function normalizeLatexDiagnostics(input: {
  importRootPath: string;
  structure: LatexStructureSnapshot;
  bibliography: BibliographyConfiguration;
  log: string;
  statusCode: number;
}): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [];
  const lines = input.log.split(/\r?\n/);
  const knownFiles = new Set((input.structure.includeGraph?.filesInOrder ?? []).map((file) => file));

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const explicitMatch = line.match(/^([^:\n]+):(\d+):\s+(ERROR|WARNING):\s+(.*)$/);
    if (explicitMatch) {
      const [, filePath, lineNumberText, level, message] = explicitMatch;
      const normalizedFilePath = knownFiles.has(filePath) ? filePath : null;
      diagnostics.push({
        severity: level === 'WARNING' ? 'warning' : 'error',
        category: message.toLowerCase().includes('bibliograph') || message.toLowerCase().includes('citation') ? 'bibliography' : 'compile',
        message,
        filePath: normalizedFilePath,
        line: Number(lineNumberText),
        mappingStatus: normalizedFilePath ? 'mapped' : 'unmapped',
        mappingReason: normalizedFilePath ? null : 'file_not_in_structure_graph',
        source: line,
      });
      continue;
    }

    if (/unsupported bibliography workflow/i.test(line)) {
      diagnostics.push({
        severity: 'error',
        category: 'bibliography',
        message: 'Unsupported bibliography workflow detected; automatic bibliography execution skipped.',
        filePath: null,
        line: null,
        mappingStatus: 'unmapped',
        mappingReason: 'toolchain_summary_only',
        source: line,
      });
      continue;
    }

    if (/Output written on/i.test(line)) {
      diagnostics.push({
        severity: 'info',
        category: 'compile',
        message: line,
        filePath: null,
        line: null,
        mappingStatus: 'unmapped',
        mappingReason: 'artifact_summary',
        source: line,
      });
    }
  }

  if (input.statusCode !== 0 && diagnostics.length === 0) {
    diagnostics.push({
      severity: 'error',
      category: input.bibliography.status === 'missing_inputs' || input.bibliography.status === 'unsupported' ? 'bibliography' : 'toolchain',
      message: input.bibliography.status === 'missing_inputs'
        ? 'LaTeX build failed because referenced bibliography inputs are missing.'
        : input.bibliography.status === 'unsupported'
          ? 'LaTeX build failed because the bibliography workflow is unsupported.'
          : 'LaTeX build failed without mapped source diagnostics.',
      filePath: null,
      line: null,
      mappingStatus: 'unmapped',
      mappingReason: 'no_file_or_line_context_available',
      source: 'summary',
    });
  }


  if (!diagnostics.some((diagnostic) => diagnostic.severity === 'info')) {
    const outputLine = lines.find((line) => /Output written on/i.test(line));
    diagnostics.push({
      severity: 'info',
      category: 'compile',
      message: outputLine ?? `LaTeX build ${input.statusCode === 0 ? 'completed' : 'finished with errors'} for ${input.structure.entrypoint ?? 'the active entrypoint'}.`,
      filePath: null,
      line: null,
      mappingStatus: 'unmapped',
      mappingReason: outputLine ? 'artifact_summary' : 'build_summary',
      source: outputLine ?? input.log,
    });
  }
  return diagnostics;
}

function summarizeDiagnostics(diagnostics: LatexDiagnostic[]): LatexBuildRunPayload['diagnosticsSummary'] {
  return diagnostics.reduce(
    (summary, diagnostic) => {
      if (diagnostic.severity === 'error') {
        summary.errorCount += 1;
      } else if (diagnostic.severity === 'warning') {
        summary.warningCount += 1;
      } else {
        summary.infoCount += 1;
      }
      return summary;
    },
    { errorCount: 0, warningCount: 0, infoCount: 0 },
  );
}

function createPdfWithOutline(titles: Array<{ level: number; title: string }>) {
  const childrenByParent = new Map<number, number[]>();
  const ids = titles.map((_, index) => 5 + index);
  const parentStack: number[] = [3];

  titles.forEach((entry, index) => {
    while (parentStack.length > entry.level) {
      parentStack.pop();
    }
    const parentId = parentStack[parentStack.length - 1] ?? 3;
    const objectId = ids[index]!;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(objectId);
    childrenByParent.set(parentId, siblings);
    parentStack[entry.level] = objectId;
  });

  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R >>');
  objects.set(2, '<< /Type /Pages /Count 1 /Kids [4 0 R] >>');
  objects.set(4, '<< /Type /Page /Parent 2 0 R >>');

  const rootChildren = childrenByParent.get(3) ?? [];
  const rootFirst = rootChildren[0];
  const rootLast = rootChildren[rootChildren.length - 1];
  objects.set(3, `<< /Type /Outlines${rootFirst ? ` /First ${rootFirst} 0 R /Last ${rootLast} 0 R /Count ${titles.length}` : ''} >>`);

  titles.forEach((entry, index) => {
    const objectId = ids[index]!;
    const parentId = [...childrenByParent.entries()].find(([, children]) => children.includes(objectId))?.[0] ?? 3;
    const siblings = childrenByParent.get(parentId) ?? [];
    const siblingIndex = siblings.indexOf(objectId);
    const prevId = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
    const nextId = siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;
    const children = childrenByParent.get(objectId) ?? [];
    const escapedTitle = entry.title.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const parts = [`/Title (${escapedTitle})`, `/Parent ${parentId} 0 R`, '/Dest [4 0 R /Fit]'];
    if (prevId) parts.push(`/Prev ${prevId} 0 R`);
    if (nextId) parts.push(`/Next ${nextId} 0 R`);
    if (children.length > 0) {
      parts.push(`/First ${children[0]} 0 R`, `/Last ${children[children.length - 1]} 0 R`, `/Count ${children.length}`);
    }
    objects.set(objectId, `<< ${parts.join(' ')} >>`);
  });

  const orderedIds = Array.from(objects.keys()).sort((a, b) => a - b);
  const body = orderedIds.map((id) => `${id} 0 obj\n${objects.get(id)}\nendobj`).join('\n');
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'utf8');
}

function canonicalizeInsideBoundary(workspacePath: string, importRootPath: string, thesisId: string) {
  const inputWasAbsolute = path.isAbsolute(importRootPath);
  const normalizedImportRootPath = inputWasAbsolute ? path.resolve(importRootPath) : importRootPath;
  const translatedImportRootPath = inputWasAbsolute
    ? (translateHostPathToMountedRoot(normalizedImportRootPath) ?? normalizedImportRootPath)
    : normalizedImportRootPath;
  const boundaryRoot = resolveBoundaryRoot(workspacePath, translatedImportRootPath);
  const requestedAbsolute = resolveImportRootPath(boundaryRoot, translatedImportRootPath);
  const resolved = resolveExistingPath(requestedAbsolute);
  const relative = path.relative(boundaryRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new IntakeBoundaryViolationError(thesisId, importRootPath, resolved);
  }

  return resolved;
}

function createLatexCheckpointSnapshotDirectory(thesisId: string, timestamp: string) {
  return path.join(process.cwd(), 'tmp', 'latex-checkpoints', thesisId, timestamp.replace(/[:.]/g, '-'));
}

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function resolveBoundaryRoot(workspacePath: string, importRootPath: string) {
  if (!path.isAbsolute(importRootPath)) {
    return resolveRelativeBoundaryRoot(workspacePath, importRootPath) ?? resolveExistingPath(workspacePath);
  }

  const resolvedImportBoundaryRoot = resolveExistingImportBoundaryRoot(importRootPath);
  const workspaceCandidates = collectWorkspaceBoundaryCandidates(workspacePath, importRootPath);
  const resolvedWorkspaceBoundary = resolveExistingWorkspaceBoundaryCandidate(workspaceCandidates);

  if (resolvedWorkspaceBoundary) {
    return resolvedWorkspaceBoundary;
  }

  if (resolvedImportBoundaryRoot) {
    return resolvedImportBoundaryRoot;
  }

  if (path.isAbsolute(importRootPath)) {
    try {
      const resolvedImportRoot = resolveExistingPath(importRootPath);
      return path.dirname(resolvedImportRoot);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  const fallbackWorkspaceBoundary = resolveWorkspaceBoundaryFromImportRoot(workspacePath, importRootPath);
  if (fallbackWorkspaceBoundary) {
    return fallbackWorkspaceBoundary;
  }

  return resolveExistingPath(workspacePath);
}

function resolveWorkspaceBoundaryFromImportRoot(workspacePath: string, importRootPath: string) {
  if (!path.isAbsolute(workspacePath) || !path.isAbsolute(importRootPath)) {
    return null;
  }

  const normalizedWorkspacePath = path.resolve(workspacePath);
  const normalizedImportRootPath = path.resolve(importRootPath);
  const workspaceSegments = splitPathSegments(normalizedWorkspacePath);
  const importSegments = splitPathSegments(normalizedImportRootPath);
  const maxSharedSegments = Math.min(workspaceSegments.length, importSegments.length);

  for (let sharedCount = maxSharedSegments; sharedCount >= 1; sharedCount -= 1) {
    const workspacePrefix = workspaceSegments.slice(0, sharedCount);
    const importPrefix = importSegments.slice(0, sharedCount);

    if (workspacePrefix.join(path.sep) !== importPrefix.join(path.sep)) {
      continue;
    }

    const candidateRoot = path.join(path.sep, ...workspacePrefix);

    if (!fs.existsSync(candidateRoot)) {
      continue;
    }

    try {
      return resolveExistingPath(candidateRoot);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  return null;
}

function resolveExistingWorkspaceBoundaryCandidate(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return resolveExistingPath(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  return null;
}

function resolveExistingImportBoundaryRoot(importRootPath: string) {
  try {
    const resolvedImportRoot = resolveExistingPath(importRootPath);
    const stats = fs.statSync(resolvedImportRoot);
    return stats.isDirectory() ? resolvedImportRoot : path.dirname(resolvedImportRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

function resolveRelativeBoundaryRoot(workspacePath: string, importRootPath: string) {
  const directPath = path.resolve(importRootPath);

  if (fs.existsSync(directPath)) {
    return path.dirname(resolveExistingPath(directPath));
  }

  const relativeWorkspaceCandidates = uniquePaths([
    workspacePath,
    path.resolve(workspacePath),
    mapWorkspacePathToMountedRoot(workspacePath),
  ]);

  for (const candidate of relativeWorkspaceCandidates) {
    const resolvedCandidate = path.resolve(candidate, importRootPath);

    if (!fs.existsSync(resolvedCandidate)) {
      continue;
    }

    try {
      return resolveExistingPath(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  return null;
}

function collectWorkspaceBoundaryCandidates(workspacePath: string, importRootPath: string) {
  const candidates = [workspacePath];

  if (path.isAbsolute(workspacePath)) {
    candidates.push(mapWorkspacePathToMountedRoot(workspacePath));
  }

  if (path.isAbsolute(importRootPath)) {
    candidates.push(importRootPath);

    const translatedImportRootPath = translateHostPathToMountedRoot(importRootPath);
    if (translatedImportRootPath) {
      candidates.push(translatedImportRootPath);
    }
  }

  return uniquePaths(candidates);
}

function mapWorkspacePathToMountedRoot(workspacePath: string) {
  const cwd = path.resolve(process.cwd());
  const mountedRoot = fs.existsSync(cwd) ? fs.realpathSync.native(cwd) : cwd;
  const mountedRootSegments = splitPathSegments(mountedRoot);
  const workspaceSegments = splitPathSegments(path.resolve(workspacePath));
  const workspaceMatch = findRepoNameMatch(workspaceSegments, mountedRootSegments.at(-1));

  if (workspaceMatch) {
    return path.join(mountedRoot, ...workspaceMatch.suffixSegments);
  }

  const cwdMatch = findCommonSuffixMatch(workspaceSegments, mountedRootSegments);

  if (cwdMatch) {
    return path.join(mountedRoot, ...cwdMatch.suffixSegments);
  }

  const configuredRepoRoot = process.env.HOST_REPO_ROOT?.trim();
  if (configuredRepoRoot) {
    const configuredSegments = splitPathSegments(configuredRepoRoot);
    const configuredMatch = findRepoNameMatch(workspaceSegments, configuredSegments.at(-1));

    if (configuredMatch) {
      return path.join(mountedRoot, ...configuredMatch.suffixSegments);
    }
  }

  return workspacePath;
}


function splitPathSegments(targetPath: string) {
  return path.resolve(targetPath).split(path.sep).filter(Boolean);
}

function findRepoNameMatch(workspaceSegments: string[], repoName: string | undefined) {
  if (!repoName) {
    return null;
  }

  const repoMatchIndex = workspaceSegments.lastIndexOf(repoName);
  if (repoMatchIndex === -1) {
    return null;
  }

  return {
    suffixSegments: workspaceSegments.slice(repoMatchIndex + 1),
  };
}

function findCommonSuffixMatch(workspaceSegments: string[], mountedRootSegments: string[]) {
  const maxCandidateLength = Math.min(workspaceSegments.length, mountedRootSegments.length - 1);

  for (let candidateLength = maxCandidateLength; candidateLength >= 1; candidateLength -= 1) {
    const workspaceStart = workspaceSegments.length - candidateLength;
    const mountedStart = mountedRootSegments.length - candidateLength;
    let matches = true;

    for (let index = 0; index < candidateLength; index += 1) {
      if (workspaceSegments[workspaceStart + index] !== mountedRootSegments[mountedStart + index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return {
        suffixSegments: workspaceSegments.slice(workspaceStart + candidateLength),
      };
    }
  }

  return null;
}

function resolveImportRootPath(boundaryRoot: string, importRootPath: string) {
  return path.isAbsolute(importRootPath)
    ? resolveAbsoluteImportRootPath(importRootPath)
    : resolveRelativeImportRootPath(boundaryRoot, importRootPath);
}

function resolveRelativeImportRootPath(boundaryRoot: string, importRootPath: string) {
  const directPath = path.resolve(importRootPath);

  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const translatedHostPath = translateHostPathToMountedRoot(directPath);
  if (translatedHostPath && fs.existsSync(translatedHostPath)) {
    return translatedHostPath;
  }

  const mappedPath = mapWorkspacePathToMountedRoot(directPath);
  if (fs.existsSync(mappedPath)) {
    return mappedPath;
  }

  return path.resolve(boundaryRoot, importRootPath);
}

function resolveAbsoluteImportRootPath(importRootPath: string) {
  const directPath = path.resolve(importRootPath);

  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const translatedHostPath = translateHostPathToMountedRoot(directPath);
  if (translatedHostPath && fs.existsSync(translatedHostPath)) {
    return translatedHostPath;
  }

  const mappedPath = mapWorkspacePathToMountedRoot(importRootPath);
  return fs.existsSync(mappedPath) ? mappedPath : directPath;
}

function translateHostPathToMountedRoot(targetPath: string) {
  const configuredRepoRoot = process.env.HOST_REPO_ROOT?.trim();

  if (!configuredRepoRoot) {
    return null;
  }

  const normalizedTarget = path.resolve(targetPath);
  const normalizedHostRoot = path.resolve(configuredRepoRoot);
  const relativeToHostRoot = path.relative(normalizedHostRoot, normalizedTarget);
  const mountedRoot = mapWorkspacePathToMountedRoot(configuredRepoRoot);

  if (relativeToHostRoot === '' || (!relativeToHostRoot.startsWith('..') && !path.isAbsolute(relativeToHostRoot))) {
    return path.join(mountedRoot, relativeToHostRoot);
  }

  return null;
}

function uniquePaths(targetPaths: string[]) {
  return Array.from(new Set(targetPaths.map((targetPath) => path.resolve(targetPath))));
}

function resolveExistingPath(targetPath: string) {
  return fs.realpathSync.native(path.resolve(targetPath));
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

function isRecommendation(value: unknown): value is IntakeReportRecommendation {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'code' in value &&
      'message' in value &&
      'triggeredBy' in value,
  );
}

function detectSourceFormat(importRootPath: string): IntakeFormatDetection {
  const stats = fs.existsSync(importRootPath) ? fs.statSync(importRootPath) : null;
  const lowerName = path.basename(importRootPath).toLowerCase();

  if (stats?.isDirectory()) {
    return {
      format: 'latex',
      reason: 'Directory import treated as LaTeX project candidate.',
      matchedBy: 'directory',
    };
  }

  if (lowerName.endsWith('.docx')) {
    return {
      format: 'docx',
      reason: 'Matched DOCX extension.',
      matchedBy: 'extension:.docx',
    };
  }

  if (lowerName.endsWith('.pdf')) {
    return {
      format: 'pdf',
      reason: 'Matched PDF extension.',
      matchedBy: 'extension:.pdf',
    };
  }

  if (lowerName.endsWith('.tex')) {
    return {
      format: 'latex',
      reason: 'Matched LaTeX extension.',
      matchedBy: 'extension:.tex',
    };
  }

  return {
    format: 'unknown',
    reason: 'No supported import signature matched the provided path.',
    matchedBy: 'fallback:unknown',
  };
}

async function performIntakeInspection(
  thesisId: string,
  intakeJobId: string,
  importRootPath: string,
  detection: IntakeFormatDetection,
) {
  const warnings: string[] = [];
  const failures: IntakeFailureDiagnostic[] = [];
  const recommendations: IntakeReportRecommendation[] = [];
  const normalizedNodes: InsertNormalizedNode[] = [];
  let status: IntakeStatus = 'succeeded';
  let extractionStatus: IntakeExtractionStatus = 'completed';
  let normalizationStatus: IntakeNormalizationStatus = 'completed';
  let structureSummary: IntakeReportSummary['structureSummary'] = null;
  let normalizationSummary: IntakeReportSummary['normalizationSummary'] = null;
  let replacement: IntakeReportSummary['replacement'] = null;
  let detectedEntrypoint: string | null = null;

  if (!fs.existsSync(importRootPath)) {
    status = 'failed';
    extractionStatus = 'failed';
    normalizationStatus = 'failed';
    failures.push({
      code: 'IMPORT_PATH_MISSING',
      message: 'The requested import path does not exist.',
      detail: importRootPath,
    });
  } else if (detection.format === 'unknown') {
    status = 'failed';
    extractionStatus = 'failed';
    normalizationStatus = 'failed';
    failures.push({
      code: 'UNSUPPORTED_IMPORT_FORMAT',
      message: 'Only LaTeX, DOCX, and PDF imports are currently supported.',
      detail: importRootPath,
    });
  } else if (detection.format === 'latex') {
    const latexOutcome = inspectLatexImport(importRootPath);
    detectedEntrypoint = latexOutcome.detectedEntrypoint;
    structureSummary = latexOutcome.structureSummary;
    warnings.push(...latexOutcome.warnings);
    failures.push(...latexOutcome.failures);
    normalizedNodes.push(...latexOutcome.normalizedNodes.map((node, index) => ({
      ...node,
      id: stableNodeId(
        detection.format,
        node.sourcePath ?? 'unknown-source',
        node.nodeType,
        findNodeAnchorByRecord(node),
        node.title ?? node.nodeType,
        intakeJobId,
      ),
      parentNodeId: node.parentNodeId
        ? stableNodeId(
            detection.format,
            findNodeSourcePath(latexOutcome.normalizedNodes, node.parentNodeId) ?? 'unknown-source',
            findNodeType(latexOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            findNodeAnchor(latexOutcome.normalizedNodes, node.parentNodeId),
            findNodeTitle(latexOutcome.normalizedNodes, node.parentNodeId) ?? findNodeType(latexOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            intakeJobId,
          )
        : null,
      thesisId,
      intakeJobId,
      ordinal: index + 1,
    })));

    if (latexOutcome.failures.length > 0) {
      status = 'failed';
      extractionStatus = 'failed';
      normalizationStatus = 'failed';
    }
  } else if (detection.format === 'docx') {
    const docxOutcome = inspectDocxImport(importRootPath);
    detectedEntrypoint = docxOutcome.detectedEntrypoint;
    structureSummary = docxOutcome.structureSummary;
    warnings.push(...docxOutcome.warnings);
    failures.push(...docxOutcome.failures);
    normalizedNodes.push(...docxOutcome.normalizedNodes.map((node, index) => ({
      ...node,
      id: stableNodeId(
        detection.format,
        node.sourcePath ?? 'unknown-source',
        node.nodeType,
        findNodeAnchorByRecord(node),
        node.title ?? node.nodeType,
        intakeJobId,
      ),
      parentNodeId: node.parentNodeId
        ? stableNodeId(
            detection.format,
            findNodeSourcePath(docxOutcome.normalizedNodes, node.parentNodeId) ?? 'unknown-source',
            findNodeType(docxOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            findNodeAnchor(docxOutcome.normalizedNodes, node.parentNodeId),
            findNodeTitle(docxOutcome.normalizedNodes, node.parentNodeId) ?? findNodeType(docxOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            intakeJobId,
          )
        : null,
      thesisId,
      intakeJobId,
      ordinal: index + 1,
    })));

    if (docxOutcome.failures.length > 0) {
      status = 'failed';
      extractionStatus = 'failed';
      normalizationStatus = 'failed';
    }
  } else if (detection.format === 'pdf') {
    const pdfOutcome = inspectPdfImport(importRootPath);
    detectedEntrypoint = pdfOutcome.detectedEntrypoint;
    structureSummary = pdfOutcome.structureSummary;
    warnings.push(...pdfOutcome.warnings);
    failures.push(...pdfOutcome.failures);
    normalizedNodes.push(...pdfOutcome.normalizedNodes.map((node, index) => ({
      ...node,
      id: stableNodeId(
        detection.format,
        node.sourcePath ?? 'unknown-source',
        node.nodeType,
        findNodeAnchorByRecord(node),
        node.title ?? node.nodeType,
        intakeJobId,
      ),
      parentNodeId: node.parentNodeId
        ? stableNodeId(
            detection.format,
            findNodeSourcePath(pdfOutcome.normalizedNodes, node.parentNodeId) ?? 'unknown-source',
            findNodeType(pdfOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            findNodeAnchor(pdfOutcome.normalizedNodes, node.parentNodeId),
            findNodeTitle(pdfOutcome.normalizedNodes, node.parentNodeId) ?? findNodeType(pdfOutcome.normalizedNodes, node.parentNodeId) ?? 'document',
            intakeJobId,
          )
        : null,
      thesisId,
      intakeJobId,
      ordinal: index + 1,
    })));

    if (pdfOutcome.failures.length > 0) {
      status = 'failed';
      extractionStatus = 'failed';
      normalizationStatus = 'failed';
    }
  }

  if (status === 'succeeded') {
    normalizationSummary = {
      nodeCount: normalizedNodes.length,
      rootNodeIds: normalizedNodes.filter((node) => node.parentNodeId === null).map((node) => node.id),
      provenanceCoverage: {
        available: normalizedNodes.filter((node) => node.provenanceKind !== 'unavailable').length,
        unavailable: normalizedNodes.filter((node) => node.provenanceKind === 'unavailable').length,
      },
    };
  }

  if (status !== 'succeeded') {
    recommendations.push({
      code: 'FIX_IMPORT_SOURCE',
      message: 'Repair or replace the source input, then retry the import.',
      triggeredBy: failures.map((failure) => failure.code),
    });
  }

  const report: IntakeReportSummary = {
    thesisId,
    intakeJobId,
    terminalStatus: status,
    detectedFormat: detection.format,
    detection,
    extractionStatus,
    normalizationStatus,
    structureSummary,
    normalizationSummary,
    replacement,
    warnings,
    failures,
    recommendedNextSteps: recommendations,
  };

  return {
    status,
    detection,
    detectedEntrypoint,
    normalizedNodes,
    report,
  };
}

function inspectLatexImport(importRootPath: string) {
  const stats = fs.statSync(importRootPath);
  const warnings: string[] = [];
  const failures: IntakeFailureDiagnostic[] = [];
  const normalizedNodeSeed: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];

  const texFiles = stats.isDirectory()
    ? collectTexFiles(importRootPath)
    : [path.basename(importRootPath)];
  const rootDir = stats.isDirectory() ? importRootPath : path.dirname(importRootPath);
  const rootSelection = selectLatexRoot(rootDir, texFiles);
  const entrypoint = rootSelection.entrypoint;
  let detectedEntrypoint = entrypoint;
  let structureSummary: IntakeReportSummary['structureSummary'] = entrypoint
    ? {
        entrypoint,
        itemCount: texFiles.length,
        items: texFiles,
        selection: rootSelection.selection,
        includeGraph: null,
        outline: [],
      }
    : {
        entrypoint: null,
        itemCount: texFiles.length,
        items: texFiles,
        selection: rootSelection.selection,
        includeGraph: null,
        outline: [],
      };

  if (!entrypoint) {
    failures.push({
      code: 'LATEX_ENTRYPOINT_NOT_FOUND',
      message: rootSelection.selection.mode === 'ambiguous'
        ? 'No deterministic LaTeX entrypoint could be chosen because multiple root candidates remain.'
        : 'No .tex entrypoint was found inside the provided LaTeX import boundary.',
      detail: importRootPath,
    });
  } else {
    const absoluteEntrypoint = stats.isDirectory() ? path.join(rootDir, entrypoint) : importRootPath;
    const content = fs.readFileSync(absoluteEntrypoint, 'utf8');
    if (!/\\documentclass|\\begin\{document\}/.test(content)) {
      failures.push({
        code: 'LATEX_SOURCE_CORRUPT',
        message: 'The LaTeX source does not contain a recognizable document preamble.',
        detail: absoluteEntrypoint,
      });
    } else {
      const graph = buildLatexGraph(rootDir, absoluteEntrypoint);
      warnings.push(...graph.warnings);
      failures.push(...graph.failures);
      if (graph.failures.length === 0) {
        normalizedNodeSeed.push(...graph.nodes);
        detectedEntrypoint = graph.entrypoint;
        structureSummary = {
          entrypoint: graph.entrypoint,
          itemCount: graph.orderedFiles.length,
          items: graph.orderedFiles,
          selection: rootSelection.selection,
          includeGraph: graph.includeGraph,
          outline: graph.outline,
        };
      }
    }
  }

  return {
    detectedEntrypoint,
    structureSummary,
    warnings,
    failures,
    normalizedNodes: failures.length === 0 ? normalizedNodeSeed : [],
  };
}

function inspectDocxImport(importRootPath: string) {
  const warnings: string[] = [];
  const failures: IntakeFailureDiagnostic[] = [];
  const normalizedNodeSeed: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  let structureSummary: IntakeReportSummary['structureSummary'] = null;

  const buffer = fs.readFileSync(importRootPath);
  const signature = buffer.subarray(0, 2).toString('utf8');

  if (signature !== 'PK') {
    failures.push({
      code: 'DOCX_ARCHIVE_CORRUPT',
      message: 'The DOCX file is not a readable ZIP archive.',
      detail: importRootPath,
    });
  } else {
    const xml = extractDocxDocumentXml(buffer);
    if (!xml) {
      failures.push({
        code: 'DOCX_DOCUMENT_XML_MISSING',
        message: 'The DOCX archive does not contain word/document.xml.',
        detail: importRootPath,
      });
      return {
        detectedEntrypoint: null,
        structureSummary: null,
        warnings,
        failures,
        normalizedNodes: [],
      };
    }
    const outline = extractDocxOutline(xml, path.basename(importRootPath));
    warnings.push(...outline.warnings);
    normalizedNodeSeed.push(...outline.nodes);
    structureSummary = {
      entrypoint: 'word/document.xml',
      itemCount: outline.items.length,
      items: outline.items,
      selection: {
        mode: 'deterministic',
        reason: 'DOCX imports use word/document.xml as the canonical structural entrypoint.',
        candidates: ['word/document.xml'],
      },
      includeGraph: null,
      outline: outline.nodes.slice(1).map((node) => ({
        id: node.id,
        title: node.title ?? null,
        level: node.nodeType === 'chapter' ? 1 : node.nodeType === 'section' ? 2 : 3,
        nodeType: node.nodeType,
        sourcePath: node.sourcePath ?? null,
        anchor: {
          start: node.sourceStart ?? null,
          end: node.sourceEnd ?? null,
        },
      })),
    };
  }

  return {
    detectedEntrypoint: structureSummary?.entrypoint ?? null,
    structureSummary,
    warnings,
    failures,
    normalizedNodes: failures.length === 0 ? normalizedNodeSeed : [],
  };
}

function inspectPdfImport(importRootPath: string) {
  const warnings: string[] = [];
  const failures: IntakeFailureDiagnostic[] = [];
  const normalizedNodeSeed: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  const buffer = fs.readFileSync(importRootPath);
  const header = buffer.subarray(0, 5).toString('utf8');

  if (header !== '%PDF-') {
    failures.push({
      code: 'PDF_HEADER_INVALID',
      message: 'The PDF file does not start with a valid %PDF header.',
      detail: importRootPath,
    });
  } else {
    const outline = extractPdfOutline(buffer.toString('utf8'), path.basename(importRootPath));
    warnings.push(...outline.warnings);
    normalizedNodeSeed.push(...outline.nodes);
  }

  return {
    detectedEntrypoint: path.basename(importRootPath),
    structureSummary: failures.length === 0
      ? {
          entrypoint: path.basename(importRootPath),
          itemCount: normalizedNodeSeed.length,
          items: normalizedNodeSeed.map((node) => `${node.nodeType}:${node.title ?? 'untitled'}`),
          selection: {
            mode: 'deterministic' as const,
            reason: 'PDF imports use the file itself as the canonical structural entrypoint.',
            candidates: [path.basename(importRootPath)],
          },
          includeGraph: null,
          outline: normalizedNodeSeed.slice(1).map((node) => ({
            id: node.id,
            title: node.title ?? null,
            level: node.nodeType === 'chapter' ? 1 : node.nodeType === 'section' ? 2 : 3,
            nodeType: node.nodeType,
            sourcePath: node.sourcePath ?? null,
            anchor: {
              start: node.sourceStart ?? null,
              end: node.sourceEnd ?? null,
            },
          })),
        }
      : null,
    warnings,
    failures,
    normalizedNodes: failures.length === 0 ? normalizedNodeSeed : [],
  };
}

function buildLatexGraph(rootDir: string, entrypoint: string) {
  const warnings: string[] = [];
  const failures: IntakeFailureDiagnostic[] = [];
  const visited = new Set<string>();
  const visitStack: string[] = [];
  const orderedFiles: string[] = [];
  const nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  const existingIds = new Set<string>();
  const outline: StructureOutlineEntry[] = [];
  const includeEdges: NonNullable<StructureSummary['includeGraph']>['edges'] = [];
  const unresolvedIncludes: NonNullable<StructureSummary['includeGraph']>['unresolved'] = [];
  const blockedIncludes: NonNullable<StructureSummary['includeGraph']>['blocked'] = [];
  const cycles: NonNullable<StructureSummary['includeGraph']>['cycles'] = [];
  const baseNow = new Date().toISOString();
  const rootRelativePath = path.relative(rootDir, entrypoint);
  const rootId = stableNodeId('latex', rootRelativePath, 'document', 0, 'document');

  const rootContent = fs.readFileSync(entrypoint, 'utf8');
  nodes.push({
    id: rootId,
    parentNodeId: null,
    nodeType: 'document',
    title: path.basename(entrypoint),
    content: null,
    sourcePath: rootRelativePath,
    sourceStart: '1',
    sourceEnd: String(rootContent.split(/\r?\n/).length),
    provenanceKind: 'latex',
    provenanceJson: JSON.stringify({ kind: 'latex', filePath: rootRelativePath, lineStart: 1, lineEnd: rootContent.split(/\r?\n/).length }),
    createdAt: baseNow,
    updatedAt: baseNow,
  });
  existingIds.add(rootId);

  const sectionStackByFile = new Map<string, Array<{ level: number; id: string }>>();
  sectionStackByFile.set(rootRelativePath, [{ level: 0, id: rootId }]);

  const ensureSectionStack = (relativePath: string) => {
    const existing = sectionStackByFile.get(relativePath);
    if (existing) {
      return existing;
    }

    const stack = [{ level: 0, id: rootId }];
    sectionStackByFile.set(relativePath, stack);
    return stack;
  };

  const visitFile = (absolutePath: string) => {
    const relativePath = path.relative(rootDir, absolutePath);
    if (visitStack.includes(relativePath)) {
      cycles.push({ path: [...visitStack, relativePath] });
      warnings.push(`Cycle-safe traversal skipped recursive include back into ${relativePath}.`);
      return;
    }
    if (visited.has(relativePath)) {
      return;
    }
    visited.add(relativePath);
    visitStack.push(relativePath);
    orderedFiles.push(relativePath);

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const sectionStack = ensureSectionStack(relativePath);

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const headingMatch = line.match(/\\(chapter|section|subsection)\{([^}]*)\}/);
      if (headingMatch) {
        const [, kind, title] = headingMatch;
        const level = kind === 'chapter' ? 1 : kind === 'section' ? 2 : 3;
        while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1]!.level >= level) {
          sectionStack.pop();
        }
        const parentId = sectionStack[sectionStack.length - 1]?.id ?? rootId;
        const id = ensureUniqueNodeId(stableNodeId('latex', relativePath, kind, lineNumber, title.trim()), existingIds);
        nodes.push({
          id,
          parentNodeId: parentId,
          nodeType: kind,
          title: title.trim(),
          content: null,
          sourcePath: relativePath,
          sourceStart: String(lineNumber),
          sourceEnd: String(lineNumber),
          provenanceKind: 'latex',
          provenanceJson: JSON.stringify({ kind: 'latex', filePath: relativePath, lineStart: lineNumber, lineEnd: lineNumber }),
          createdAt: baseNow,
          updatedAt: baseNow,
        });
        outline.push({
          id,
          title: title.trim(),
          level,
          nodeType: kind,
          sourcePath: relativePath,
          anchor: {
            start: String(lineNumber),
            end: String(lineNumber),
          },
        });
        existingIds.add(id);
        sectionStack.push({ level, id });
      }

      const includeMatch = line.match(/\\(?:input|include)\{([^}]*)\}/);
      if (includeMatch) {
        const rawTarget = includeMatch[1]!.trim();
        const command = line.includes('\include{') ? 'include' : 'input';
        const candidate = rawTarget.endsWith('.tex') ? rawTarget : `${rawTarget}.tex`;
        const resolvedCandidate = path.resolve(path.dirname(absolutePath), candidate);
        const resolvedPath = fs.existsSync(resolvedCandidate) ? fs.realpathSync(resolvedCandidate) : resolvedCandidate;
        const relative = path.relative(rootDir, resolvedPath);

        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          blockedIncludes.push({
            from: relativePath,
            target: rawTarget,
            command,
            line: lineNumber,
            resolvedPath,
            reason: 'resolved_outside_workspace',
          });
          failures.push({
            code: 'LATEX_INCLUDE_OUTSIDE_BOUNDARY',
            message: 'A LaTeX include resolved outside the declared import boundary.',
            detail: `${relativePath}:${lineNumber} -> ${resolvedPath}`,
          });
          return;
        }

        if (!fs.existsSync(resolvedPath)) {
          unresolvedIncludes.push({
            from: relativePath,
            target: rawTarget,
            command,
            line: lineNumber,
            reason: 'missing_target',
          });
          warnings.push(`Unresolved LaTeX include ${candidate} from ${relativePath}:${lineNumber}.`);
          return;
        }

        includeEdges.push({
          from: relativePath,
          to: relative,
          command,
          line: lineNumber,
        });

        const currentContext = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1] : { level: 0, id: rootId };
        const inheritedStack = [{ level: 0, id: rootId }];
        if (currentContext.level > 0 && currentContext.id !== rootId) {
          inheritedStack.push(currentContext);
        }
        sectionStackByFile.set(relative, inheritedStack);
        visitFile(fs.realpathSync(resolvedPath));
      }
    });

    visitStack.pop();
  };

  visitFile(fs.realpathSync(entrypoint));

  return {
    nodes,
    warnings,
    failures,
    orderedFiles,
    entrypoint: rootRelativePath,
    includeGraph: {
      rootFile: rootRelativePath,
      filesInOrder: orderedFiles,
      edges: includeEdges,
      unresolved: unresolvedIncludes,
      blocked: blockedIncludes,
      cycles,
    },
    outline,
  };
}

function inspectLatexWorkspace(workspacePath: string, importRootPath: string): LatexStructureSnapshot {
  const normalizedPath = canonicalizeInsideBoundary(workspacePath, importRootPath, 'workspace-inspection');
  const latexOutcome = inspectLatexImport(normalizedPath);

  if (latexOutcome.failures.length > 0 || !latexOutcome.structureSummary) {
    throw new LatexEditConflictError('workspace-inspection', latexOutcome.failures.map((failure) => failure.message), {
      entrypoint: latexOutcome.detectedEntrypoint,
      selection: latexOutcome.structureSummary?.selection ?? {
        mode: 'missing',
        reason: 'No current structure available.',
        candidates: [],
      },
      includeGraph: latexOutcome.structureSummary?.includeGraph ?? null,
      outline: latexOutcome.structureSummary?.outline.map((node) => ({ ...node, normalizedNodeId: node.id })) ?? [],
    });
  }

  return {
    entrypoint: latexOutcome.structureSummary.entrypoint,
    selection: latexOutcome.structureSummary.selection,
    includeGraph: latexOutcome.structureSummary.includeGraph,
    outline: latexOutcome.structureSummary.outline.map((node) => ({
      ...node,
      normalizedNodeId: node.id,
    })),
  };
}

function selectLatexRoot(rootDir: string, texFiles: string[]) {
  const sortedCandidates = texFiles.slice().sort((left, right) => left.localeCompare(right));

  if (sortedCandidates.length === 0) {
    return {
      entrypoint: null,
      selection: {
        mode: 'missing' as const,
        reason: 'No .tex files were found within the declared workspace boundary.',
        candidates: [],
      },
    };
  }

  const candidates = sortedCandidates.filter((candidate) => isLatexRootCandidate(path.join(rootDir, candidate)));

  if (candidates.length === 1) {
    return {
      entrypoint: candidates[0] ?? null,
      selection: {
        mode: 'deterministic' as const,
        reason: 'A single root candidate containing a document preamble was found.',
        candidates,
      },
    };
  }

  const mainCandidate = candidates.find((candidate) => path.basename(candidate).toLowerCase() === 'main.tex');
  if (mainCandidate) {
    return {
      entrypoint: mainCandidate,
      selection: {
        mode: 'deterministic' as const,
        reason: 'Selected main.tex as the canonical root among multiple root candidates.',
        candidates,
      },
    };
  }

  if (candidates.length > 1) {
    return {
      entrypoint: null,
      selection: {
        mode: 'ambiguous' as const,
        reason: 'Multiple root candidates contain document preambles and no canonical main.tex is present.',
        candidates,
      },
    };
  }

  const fallbackMain = sortedCandidates.find((candidate) => path.basename(candidate).toLowerCase() === 'main.tex') ?? null;
  if (fallbackMain) {
    return {
      entrypoint: fallbackMain,
      selection: {
        mode: 'deterministic' as const,
        reason: 'Selected main.tex as fallback canonical root because no explicit document preamble candidates were detected elsewhere.',
        candidates: [fallbackMain],
      },
    };
  }

  return {
    entrypoint: null,
    selection: {
      mode: 'missing' as const,
      reason: 'No canonical LaTeX root with a document preamble could be identified.',
      candidates: sortedCandidates,
    },
  };
}

function isLatexRootCandidate(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  return /\\documentclass|\\begin\{document\}/.test(content);
}

function extractDocxDocumentXml(buffer: Buffer) {
  return readZipEntryText(buffer, 'word/document.xml');
}

function readZipEntryText(buffer: Buffer, entryName: string) {
  const localFileHeader = 0x04034b50;
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== localFileHeader) {
      offset += 1;
      continue;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      break;
    }

    const fileName = buffer.subarray(fileNameStart, fileNameEnd).toString('utf8');
    if (fileName === entryName) {
      const entryBuffer = buffer.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) {
        return entryBuffer.toString('utf8');
      }
      if (compressionMethod === 8) {
        return inflateZipEntry(entryBuffer)?.toString('utf8') ?? null;
      }
      return null;
    }

    offset = dataEnd;
  }

  return null;
}

function inflateZipEntry(buffer: Buffer) {
  try {
    return zlib.inflateRawSync(buffer);
  } catch {
    return null;
  }
}

function findNodeById(nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>>, nodeId: string) {
  return nodes.find((candidate) => candidate.id === nodeId) ?? null;
}

function findNodeSourcePath(nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>>, nodeId: string) {
  return findNodeById(nodes, nodeId)?.sourcePath ?? null;
}

function findNodeType(nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>>, nodeId: string) {
  return findNodeById(nodes, nodeId)?.nodeType ?? null;
}

function findNodeTitle(nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>>, nodeId: string) {
  return findNodeById(nodes, nodeId)?.title ?? null;
}

function findNodeAnchor(nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>>, nodeId: string) {
  const sourceStart = findNodeById(nodes, nodeId)?.sourceStart ?? null;
  if (!sourceStart) {
    return 0;
  }

  const match = sourceStart.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function findNodeAnchorByRecord(node: Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>) {
  const sourceStart = node.sourceStart ?? null;
  if (!sourceStart) {
    return 0;
  }

  const match = sourceStart.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function extractDocxOutline(xml: string, fileName: string) {
  const warnings: string[] = [];
  const nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  const baseNow = new Date().toISOString();
  const documentId = stableNodeId('docx', fileName, 'document', 0, fileName);
  nodes.push({
    id: documentId,
    parentNodeId: null,
    nodeType: 'document',
    title: fileName,
    content: null,
    sourcePath: fileName,
    sourceStart: 'paragraph:0',
    sourceEnd: 'paragraph:0',
    provenanceKind: 'docx',
    provenanceJson: JSON.stringify({ kind: 'docx', filePath: fileName, anchor: 'word/document.xml' }),
    createdAt: baseNow,
    updatedAt: baseNow,
  });

  const paragraphs = [...xml.matchAll(/<w:p(?:[^>]*)>([\s\S]*?)<\/w:p>/g)];
  const stack: Array<{ level: number; id: string }> = [{ level: 0, id: documentId }];
  const items: string[] = ['word/document.xml'];

  paragraphs.forEach((match, idx) => {
    const paragraphXml = match[1] ?? '';
    const styleMatch = paragraphXml.match(/Heading([1-6])/i);
    const text = [...paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1] ?? '')).join('').trim();
    if (!text) {
      return;
    }
    if (!styleMatch) {
      return;
    }
    const level = Number(styleMatch[1]);
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    const parentId = stack[stack.length - 1]?.id ?? documentId;
    const nodeType = level === 1 ? 'chapter' : level === 2 ? 'section' : 'subsection';
    const id = stableNodeId('docx', fileName, nodeType, idx + 1, text);
    nodes.push({
      id,
      parentNodeId: parentId,
      nodeType,
      title: text,
      content: null,
      sourcePath: fileName,
      sourceStart: `paragraph:${idx + 1}`,
      sourceEnd: `paragraph:${idx + 1}`,
      provenanceKind: 'docx',
      provenanceJson: JSON.stringify({ kind: 'docx', filePath: fileName, paragraph: idx + 1, style: `Heading${level}` }),
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    stack.push({ level, id });
    items.push(`${nodeType}:${text}`);
  });

  if (nodes.length === 1) {
    warnings.push('DOCX heading extraction degraded because no explicit Heading styles were found.');
    nodes[0] = {
      ...nodes[0],
      provenanceKind: 'unavailable',
      provenanceJson: JSON.stringify({ kind: 'unavailable', reason: 'No explicit DOCX heading styles were found.' }),
    };
  }

  return { warnings, nodes, items };
}

function extractPdfOutline(text: string, fileName: string) {
  const warnings: string[] = [];
  const nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  const baseNow = new Date().toISOString();
  const documentId = stableNodeId('pdf', fileName, 'document', 0, fileName);
  nodes.push({
    id: documentId,
    parentNodeId: null,
    nodeType: 'document',
    title: fileName,
    content: null,
    sourcePath: fileName,
    sourceStart: 'page:1',
    sourceEnd: 'page:1',
    provenanceKind: 'pdf',
    provenanceJson: JSON.stringify({ kind: 'pdf', filePath: fileName, page: 1 }),
    createdAt: baseNow,
    updatedAt: baseNow,
  });

  const outlineEntries = extractPdfOutlineEntries(text);

  if (outlineEntries.length > 0) {
    const stack: Array<{ level: number; id: string }> = [{ level: 0, id: documentId }];
    outlineEntries.forEach((entry, idx) => {
      const normalizedLevel = Math.max(1, Math.min(entry.level, 3));
      while (stack.length > 0 && stack[stack.length - 1]!.level >= normalizedLevel) {
        stack.pop();
      }
      const parentId = stack[stack.length - 1]?.id ?? documentId;
      const nodeType = normalizedLevel === 1 ? 'chapter' : normalizedLevel === 2 ? 'section' : 'subsection';
      const id = stableNodeId('pdf', fileName, nodeType, idx + 1, entry.title);
      nodes.push({
        id,
        parentNodeId: parentId,
        nodeType,
        title: entry.title,
        content: null,
        sourcePath: fileName,
        sourceStart: `outline:${idx + 1}`,
        sourceEnd: `outline:${idx + 1}`,
        provenanceKind: 'pdf',
        provenanceJson: JSON.stringify({ kind: 'pdf', filePath: fileName, outlineIndex: idx + 1, level: normalizedLevel }),
        createdAt: baseNow,
        updatedAt: baseNow,
      });
      stack.push({ level: normalizedLevel, id });
    });

    return { warnings, nodes };
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidateLines = lines.filter((line) => /^[A-ZÁÉÍÓÚÑ0-9 .:-]{4,}$/.test(line));

  if (candidateLines.length === 0) {
    warnings.push('PDF outline extraction degraded because no reliable heading candidates were found.');
    nodes[0] = {
      ...nodes[0],
      provenanceKind: 'unavailable',
      provenanceJson: JSON.stringify({ kind: 'unavailable', reason: 'No reliable PDF heading candidates were found.' }),
    };
    return { warnings, nodes };
  }

  candidateLines.slice(0, 6).forEach((line, idx) => {
    const nodeType = idx === 0 ? 'chapter' : 'section';
    nodes.push({
      id: stableNodeId('pdf', fileName, nodeType, idx + 1, line),
      parentNodeId: idx === 0 ? documentId : nodes[1]?.id ?? documentId,
      nodeType,
      title: line,
      content: null,
      sourcePath: fileName,
      sourceStart: `page:${idx + 1}`,
      sourceEnd: `page:${idx + 1}`,
      provenanceKind: 'pdf',
      provenanceJson: JSON.stringify({ kind: 'pdf', filePath: fileName, page: idx + 1 }),
      createdAt: baseNow,
      updatedAt: baseNow,
    });
  });

  return { warnings, nodes };
}

function extractPdfOutlineEntries(text: string) {
  const normalized = text.replace(/\r/g, '');
  const objects = new Map<string, string>();
  const objectRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;

  for (const match of normalized.matchAll(objectRegex)) {
    objects.set(`${match[1]} ${match[2]}`, match[3] ?? '');
  }

  const catalogRef = normalized.match(/\/Type\s*\/Catalog[\s\S]*?\/Outlines\s+(\d+\s+\d+)\s+R/);
  if (!catalogRef) {
    return [];
  }

  const outlineRoot = objects.get(catalogRef[1]);
  if (!outlineRoot) {
    return [];
  }

  const firstRef = outlineRoot.match(/\/First\s+(\d+\s+\d+)\s+R/);
  if (!firstRef) {
    return [];
  }

  const results: Array<{ level: number; title: string }> = [];
  const visit = (ref: string, level: number) => {
    let currentRef: string | null = ref;
    const seen = new Set<string>();

    while (currentRef && !seen.has(currentRef)) {
      seen.add(currentRef);
      const objectBody = objects.get(currentRef);
      if (!objectBody) {
        break;
      }

      const titleMatch = objectBody.match(/\/Title\s*\(([^)]*)\)/);
      const title = titleMatch ? decodePdfText(titleMatch[1] ?? '') : '';
      if (title.trim()) {
        results.push({ level, title: title.trim() });
      }

      const childRef = objectBody.match(/\/First\s+(\d+\s+\d+)\s+R/);
      if (childRef) {
        visit(childRef[1], Math.min(level + 1, 3));
      }

      const nextRef = objectBody.match(/\/Next\s+(\d+\s+\d+)\s+R/);
      currentRef = nextRef ? nextRef[1] : null;
    }
  };

  visit(firstRef[1], 1);
  return results;
}

function decodePdfText(value: string) {
  return value
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function stableNodeId(format: string, sourcePath: string, nodeType: string, anchor: number, title: string, namespace?: string) {
  const parts = [format, sourcePath, nodeType, String(anchor), slugify(title).slice(0, 48)];
  if (namespace) {
    parts.push(namespace);
  }

  return parts.join(':');
}

function ensureUniqueNodeId(baseId: string, existingIds: Set<string>) {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}:${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}:${suffix}`;
  }

  return candidate;
}

function collectTexFiles(rootDir: string) {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) {
        found.push(path.relative(rootDir, absolutePath));
      }
    }
  };

  visit(rootDir);
  return found.sort();
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
