import { relations, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const sqliteIsoTimestampDefault = sql`(STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))`;

const timestampColumns = {
  createdAt: text('created_at').notNull().default(sqliteIsoTimestampDefault),
  updatedAt: text('updated_at').notNull().default(sqliteIsoTimestampDefault),
};

export const theses = sqliteTable('theses', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  degreeProgram: text('degree_program').notNull(),
  institution: text('institution').notNull(),
  workspacePath: text('workspace_path').notNull(),
  defaultLanguage: text('default_language').notNull(),
  currentState: text('current_state').notNull(),
  latestStatusAt: text('latest_status_at').notNull(),
  nextStepSummary: text('next_step_summary').notNull(),
  activeImportId: text('active_import_id'),
  activeBuildRunId: text('active_build_run_id'),
  ...timestampColumns,
}, (table) => ({
  slugIndex: uniqueIndex('theses_slug_idx').on(table.slug),
}));

export const thesisStates = sqliteTable('thesis_states', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  source: text('source').notNull(),
  statusSummary: text('status_summary').notNull(),
  blockersJson: text('blockers_json').notNull().default('[]'),
  transitionedFrom: text('transitioned_from'),
  transitionedAt: text('transitioned_at').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  ...timestampColumns,
});

export const workflowTasks = sqliteTable('workflow_tasks', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => workflowTasks.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  intent: text('intent').notNull(),
  status: text('status').notNull(),
  priority: integer('priority').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  dueAt: text('due_at'),
  activeCheckpointId: text('active_checkpoint_id'),
  ...timestampColumns,
});

export const workflowTaskCheckpoints = sqliteTable('workflow_task_checkpoints', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  summary: text('summary').notNull(),
  progressPercent: integer('progress_percent').notNull().default(0),
  blocker: text('blocker'),
  checkpointedAt: text('checkpointed_at').notNull(),
  ...timestampColumns,
});

export const workflowPacks = sqliteTable('workflow_packs', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  currentStepId: text('current_step_id'),
  ...timestampColumns,
});

export const workflowSteps = sqliteTable('workflow_steps', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  workflowPackId: text('workflow_pack_id').notNull().references(() => workflowPacks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  stepOrder: integer('step_order').notNull(),
  ...timestampColumns,
});

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  label: text('label'),
  note: text('note'),
  scope: text('scope').notNull(),
  reason: text('reason').notNull(),
  snapshotPath: text('snapshot_path'),
  snapshotMetadataJson: text('snapshot_metadata_json'),
  createdBy: text('created_by').notNull(),
  checkpointedAt: text('checkpointed_at').notNull(),
  ...timestampColumns,
});

export const feedbackEntries = sqliteTable('feedback_entries', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  body: text('body').notNull(),
  summary: text('summary'),
  recordedAt: text('recorded_at').notNull(),
  ...timestampColumns,
});

export const intakeJobs = sqliteTable('intake_jobs', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  sourceFormat: text('source_format').notNull(),
  status: text('status').notNull(),
  importRootPath: text('import_root_path').notNull(),
  detectedEntrypoint: text('detected_entrypoint'),
  reportJson: text('report_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  recommendationsJson: text('recommendations_json').notNull().default('[]'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  ...timestampColumns,
});

export const normalizedNodes = sqliteTable('normalized_nodes', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  intakeJobId: text('intake_job_id').references(() => intakeJobs.id, { onDelete: 'set null' }),
  parentNodeId: text('parent_node_id').references((): AnySQLiteColumn => normalizedNodes.id, { onDelete: 'set null' }),
  nodeType: text('node_type').notNull(),
  title: text('title'),
  content: text('content'),
  ordinal: integer('ordinal').notNull(),
  sourcePath: text('source_path'),
  sourceStart: text('source_start'),
  sourceEnd: text('source_end'),
  provenanceKind: text('provenance_kind').notNull(),
  provenanceJson: text('provenance_json').notNull().default('{}'),
  ...timestampColumns,
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  authorsJson: text('authors_json').notNull().default('[]'),
  publicationYear: integer('publication_year'),
  locator: text('locator'),
  status: text('status').notNull(),
  ingestMetadataJson: text('ingest_metadata_json').notNull().default('{}'),
  ...timestampColumns,
});

export const evidenceFragments = sqliteTable('evidence_fragments', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  normalizedNodeId: text('normalized_node_id').references((): AnySQLiteColumn => normalizedNodes.id, { onDelete: 'set null' }),
  taskId: text('task_id').references((): AnySQLiteColumn => workflowTasks.id, { onDelete: 'set null' }),
  locator: text('locator'),
  snippet: text('snippet').notNull(),
  extractionMethod: text('extraction_method').notNull(),
  confidence: real('confidence'),
  status: text('status').notNull(),
  provenanceJson: text('provenance_json').notNull().default('{}'),
  ...timestampColumns,
});

export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  normalizedNodeId: text('normalized_node_id').references(() => normalizedNodes.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  status: text('status').notNull(),
  supportSummary: text('support_summary').notNull().default(''),
  evidenceOrderingJson: text('evidence_ordering_json').notNull().default('{"evidenceFragmentIdOrder":[]}'),
  ...timestampColumns,
});

export const claimEvidenceLinks = sqliteTable('claim_evidence_links', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  claimId: text('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  evidenceFragmentId: text('evidence_fragment_id').notNull().references(() => evidenceFragments.id, { onDelete: 'cascade' }),
  rationale: text('rationale').notNull(),
  ...timestampColumns,
}, (table) => ({
  uniqueLinkIndex: uniqueIndex('claim_evidence_links_unique_idx').on(
    table.claimId,
    table.evidenceFragmentId,
  ),
}));

export const zoteroMappings = sqliteTable('zotero_mappings', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  normalizedNodeId: text('normalized_node_id').references((): AnySQLiteColumn => normalizedNodes.id, { onDelete: 'set null' }),
  sourceId: text('source_id').references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
  scope: text('scope').notNull(),
  libraryId: text('library_id').notNull(),
  collectionKey: text('collection_key'),
  itemKey: text('item_key'),
  normalizedDataJson: text('normalized_data_json').notNull().default('{}'),
  connectorStatus: text('connector_status').notNull(),
  lastSyncedAt: text('last_synced_at'),
  ...timestampColumns,
});

export const policyProfiles = sqliteTable('policy_profiles', {
  id: text('id').primaryKey(),
  institution: text('institution').notNull(),
  faculty: text('faculty').notNull(),
  version: text('version').notNull(),
  title: text('title').notNull(),
  requiredSectionsJson: text('required_sections_json').notNull().default('[]'),
  ruleDefinitionsJson: text('rule_definitions_json').notNull().default('[]'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  ...timestampColumns,
});

export const complianceRuns = sqliteTable('compliance_runs', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  policyProfileId: text('policy_profile_id').notNull().references(() => policyProfiles.id, { onDelete: 'restrict' }),
  status: text('status').notNull(),
  summaryJson: text('summary_json').notNull().default('{}'),
  evaluatedRuleCount: integer('evaluated_rule_count').notNull().default(0),
  warningRuleCount: integer('warning_rule_count').notNull().default(0),
  skippedRuleCount: integer('skipped_rule_count').notNull().default(0),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  ...timestampColumns,
});

export const complianceIssues = sqliteTable('compliance_issues', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  complianceRunId: text('compliance_run_id').notNull().references(() => complianceRuns.id, { onDelete: 'cascade' }),
  policyProfileId: text('policy_profile_id').notNull().references(() => policyProfiles.id, { onDelete: 'restrict' }),
  ruleId: text('rule_id').notNull(),
  normalizedNodeId: text('normalized_node_id').references(() => normalizedNodes.id, { onDelete: 'set null' }),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  remediation: text('remediation'),
  disposition: text('disposition').notNull(),
  ...timestampColumns,
});

export const academicQaRuns = sqliteTable('academic_qa_runs', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  assessedScopeJson: text('assessed_scope_json').notNull().default('{}'),
  skippedScopeJson: text('skipped_scope_json').notNull().default('{}'),
  summaryJson: text('summary_json').notNull().default('{}'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  ...timestampColumns,
});

export const academicQaIssues = sqliteTable('academic_qa_issues', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  academicQaRunId: text('academic_qa_run_id').notNull().references(() => academicQaRuns.id, { onDelete: 'cascade' }),
  claimId: text('claim_id').references(() => claims.id, { onDelete: 'set null' }),
  normalizedNodeId: text('normalized_node_id').references(() => normalizedNodes.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  rationale: text('rationale').notNull(),
  remediation: text('remediation'),
  triggeringCondition: text('triggering_condition').notNull(),
  ...timestampColumns,
});

export const buildRuns = sqliteTable('build_runs', {
  id: text('id').primaryKey(),
  thesisId: text('thesis_id').notNull().references(() => theses.id, { onDelete: 'cascade' }),
  checkpointId: text('checkpoint_id').references(() => checkpoints.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  engine: text('engine').notNull(),
  artifactPath: text('artifact_path'),
  diagnosticsJson: text('diagnostics_json').notNull().default('{}'),
  bibliographyStatus: text('bibliography_status').notNull().default('unknown'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  isLatestSuccessful: integer('is_latest_successful', { mode: 'boolean' }).notNull().default(false),
  ...timestampColumns,
});

export const thesisRelations = relations(theses, ({ many }) => ({
  states: many(thesisStates),
  workflowTasks: many(workflowTasks),
  workflowPacks: many(workflowPacks),
  checkpoints: many(checkpoints),
  feedbackEntries: many(feedbackEntries),
  intakeJobs: many(intakeJobs),
  normalizedNodes: many(normalizedNodes),
  sources: many(sources),
  evidenceFragments: many(evidenceFragments),
  claims: many(claims),
  zoteroMappings: many(zoteroMappings),
  complianceRuns: many(complianceRuns),
  academicQaRuns: many(academicQaRuns),
  buildRuns: many(buildRuns),
}));

export const thesisStateRelations = relations(thesisStates, ({ one }) => ({
  thesis: one(theses, {
    fields: [thesisStates.thesisId],
    references: [theses.id],
  }),
}));

export const workflowTaskRelations = relations(workflowTasks, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [workflowTasks.thesisId],
    references: [theses.id],
  }),
  checkpoints: many(workflowTaskCheckpoints),
}));

export const workflowTaskCheckpointRelations = relations(workflowTaskCheckpoints, ({ one }) => ({
  thesis: one(theses, {
    fields: [workflowTaskCheckpoints.thesisId],
    references: [theses.id],
  }),
  task: one(workflowTasks, {
    fields: [workflowTaskCheckpoints.taskId],
    references: [workflowTasks.id],
  }),
}));

export const workflowPackRelations = relations(workflowPacks, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [workflowPacks.thesisId],
    references: [theses.id],
  }),
  steps: many(workflowSteps),
}));

export const workflowStepRelations = relations(workflowSteps, ({ one }) => ({
  thesis: one(theses, {
    fields: [workflowSteps.thesisId],
    references: [theses.id],
  }),
  workflowPack: one(workflowPacks, {
    fields: [workflowSteps.workflowPackId],
    references: [workflowPacks.id],
  }),
}));

export const checkpointRelations = relations(checkpoints, ({ one }) => ({
  thesis: one(theses, {
    fields: [checkpoints.thesisId],
    references: [theses.id],
  }),
}));

export const feedbackEntryRelations = relations(feedbackEntries, ({ one }) => ({
  thesis: one(theses, {
    fields: [feedbackEntries.thesisId],
    references: [theses.id],
  }),
}));

export const intakeJobRelations = relations(intakeJobs, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [intakeJobs.thesisId],
    references: [theses.id],
  }),
  normalizedNodes: many(normalizedNodes),
}));

export const normalizedNodeRelations = relations(normalizedNodes, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [normalizedNodes.thesisId],
    references: [theses.id],
  }),
  intakeJob: one(intakeJobs, {
    fields: [normalizedNodes.intakeJobId],
    references: [intakeJobs.id],
  }),
  parent: one(normalizedNodes, {
    fields: [normalizedNodes.parentNodeId],
    references: [normalizedNodes.id],
  }),
  children: many(normalizedNodes),
}));

export const sourceRelations = relations(sources, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [sources.thesisId],
    references: [theses.id],
  }),
  evidenceFragments: many(evidenceFragments),
}));

export const evidenceFragmentRelations = relations(evidenceFragments, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [evidenceFragments.thesisId],
    references: [theses.id],
  }),
  source: one(sources, {
    fields: [evidenceFragments.sourceId],
    references: [sources.id],
  }),
  claimLinks: many(claimEvidenceLinks),
}));

export const claimRelations = relations(claims, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [claims.thesisId],
    references: [theses.id],
  }),
  evidenceLinks: many(claimEvidenceLinks),
}));

export const claimEvidenceLinkRelations = relations(claimEvidenceLinks, ({ one }) => ({
  thesis: one(theses, {
    fields: [claimEvidenceLinks.thesisId],
    references: [theses.id],
  }),
  claim: one(claims, {
    fields: [claimEvidenceLinks.claimId],
    references: [claims.id],
  }),
  evidenceFragment: one(evidenceFragments, {
    fields: [claimEvidenceLinks.evidenceFragmentId],
    references: [evidenceFragments.id],
  }),
}));

export const zoteroMappingRelations = relations(zoteroMappings, ({ one }) => ({
  thesis: one(theses, {
    fields: [zoteroMappings.thesisId],
    references: [theses.id],
  }),
}));

export const policyProfileRelations = relations(policyProfiles, ({ many }) => ({
  complianceRuns: many(complianceRuns),
  complianceIssues: many(complianceIssues),
}));

export const complianceRunRelations = relations(complianceRuns, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [complianceRuns.thesisId],
    references: [theses.id],
  }),
  policyProfile: one(policyProfiles, {
    fields: [complianceRuns.policyProfileId],
    references: [policyProfiles.id],
  }),
  issues: many(complianceIssues),
}));

export const complianceIssueRelations = relations(complianceIssues, ({ one }) => ({
  thesis: one(theses, {
    fields: [complianceIssues.thesisId],
    references: [theses.id],
  }),
  complianceRun: one(complianceRuns, {
    fields: [complianceIssues.complianceRunId],
    references: [complianceRuns.id],
  }),
  policyProfile: one(policyProfiles, {
    fields: [complianceIssues.policyProfileId],
    references: [policyProfiles.id],
  }),
}));

export const academicQaRunRelations = relations(academicQaRuns, ({ one, many }) => ({
  thesis: one(theses, {
    fields: [academicQaRuns.thesisId],
    references: [theses.id],
  }),
  issues: many(academicQaIssues),
}));

export const academicQaIssueRelations = relations(academicQaIssues, ({ one }) => ({
  thesis: one(theses, {
    fields: [academicQaIssues.thesisId],
    references: [theses.id],
  }),
  academicQaRun: one(academicQaRuns, {
    fields: [academicQaIssues.academicQaRunId],
    references: [academicQaRuns.id],
  }),
}));

export const buildRunRelations = relations(buildRuns, ({ one }) => ({
  thesis: one(theses, {
    fields: [buildRuns.thesisId],
    references: [theses.id],
  }),
  checkpoint: one(checkpoints, {
    fields: [buildRuns.checkpointId],
    references: [checkpoints.id],
  }),
}));

export const schema = {
  theses,
  thesisStates,
  workflowTasks,
  workflowTaskCheckpoints,
  workflowPacks,
  workflowSteps,
  checkpoints,
  feedbackEntries,
  intakeJobs,
  normalizedNodes,
  sources,
  evidenceFragments,
  claims,
  claimEvidenceLinks,
  zoteroMappings,
  policyProfiles,
  complianceRuns,
  complianceIssues,
  academicQaRuns,
  academicQaIssues,
  buildRuns,
};
