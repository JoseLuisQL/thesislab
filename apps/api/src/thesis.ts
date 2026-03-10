import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { asc, desc, eq } from 'drizzle-orm';

import {
  createDatabaseConnection,
  checkpoints,
  feedbackEntries,
  intakeJobs,
  normalizedNodes,
  type IntakeStatus,
  type SourceFormat,
  thesisStates,
  theses,
  type ThesisDbClient,
  type ThesisLifecycleState,
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
  } | null;
  warnings: string[];
  failures: IntakeFailureDiagnostic[];
  recommendedNextSteps: IntakeReportRecommendation[];
};

type IntakeExtractionStatus = IntakeReportSummary['extractionStatus'];
type IntakeNormalizationStatus = IntakeReportSummary['normalizationStatus'];
type InsertNormalizedNode = typeof normalizedNodes.$inferInsert;

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
  transitions: ThesisStatePayload[];
};

export type ThesisCheckpointPayload = {
  id: string;
  thesisId: string;
  label: string | null;
  note: string | null;
  scope: string;
  reason: string;
  snapshotPath: string | null;
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
  createdBy: string;
  checkpointedAt?: string;
};

export type CreateFeedbackInput = {
  sourceType: 'user' | 'system' | 'qa' | 'compliance';
  body: string;
  summary?: string | null;
  recordedAt?: string;
};

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

export class ThesisLifecycleService {
  constructor(private readonly db: ThesisDbClient) {}

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
      createdBy: input.createdBy,
      checkpointedAt,
      createdAt: checkpointedAt,
      updatedAt: checkpointedAt,
    });

    const checkpoint = await this.db.query.checkpoints.findFirst({
      where: (fields, operators) => operators.eq(fields.id, id),
    });

    return this.mapCheckpointRecord(checkpoint ?? {
      id,
      thesisId,
      label: input.label ?? null,
      note: input.note ?? null,
      scope: input.scope,
      reason: input.reason,
      snapshotPath: input.snapshotPath ?? null,
      createdBy: input.createdBy,
      checkpointedAt,
      createdAt: checkpointedAt,
      updatedAt: checkpointedAt,
    });
  }

  async listCheckpoints(thesisId: string): Promise<ThesisCheckpointPayload[]> {
    await this.requireThesis(thesisId);

    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.thesisId, thesisId))
      .orderBy(desc(checkpoints.checkpointedAt), asc(checkpoints.id))
      .all();

    return rows.map((row) => this.mapCheckpointRecord(row));
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

  async getResume(thesisId: string): Promise<ThesisResumePayload> {
    const detail = await this.getThesisDetail(thesisId);
    const checkpoints = await this.listCheckpoints(thesisId);
    const feedback = await this.listFeedback(thesisId);

    return {
      thesis: detail.thesis,
      state: detail.state,
      latestStatusAt: detail.latestStatusAt,
      statusSummary: detail.statusSummary,
      blockers: detail.blockers,
      nextAction: detail.nextStepSummary,
      latestCheckpoint: checkpoints[0] ?? null,
      recentFeedback: feedback.slice(0, 5),
    };
  }

  async createIntakeJob(thesisId: string, input: CreateIntakeJobInput): Promise<IntakeJobPayload> {
    await this.requireThesis(thesisId);

    const normalizedPath = path.resolve(input.importRootPath);
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
        warnings: job.warnings,
        failures: job.report?.failures ?? [],
        recommendedNextSteps: job.recommendations,
      };
    }

    return job.report;
  }

  private async runIntakeJob(thesisId: string, intakeJobId: string) {
    const job = await this.getIntakeJob(thesisId, intakeJobId);
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

    await this.db.transaction(async (tx) => {
      await tx
        .delete(normalizedNodes)
        .where(eq(normalizedNodes.intakeJobId, intakeJobId));

      if (outcome.status !== 'failed' && outcome.normalizedNodes.length > 0) {
        await tx.insert(normalizedNodes).values(outcome.normalizedNodes);
      }

      await tx
        .update(intakeJobs)
        .set({
          sourceFormat: outcome.detection.format,
          status: outcome.status,
          detectedEntrypoint: outcome.detectedEntrypoint,
          reportJson: JSON.stringify(outcome.report),
          warningsJson: JSON.stringify(outcome.report.warnings),
          recommendationsJson: JSON.stringify(outcome.report.recommendedNextSteps),
          startedAt,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(intakeJobs.id, intakeJobId));
    });
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

  private async requireThesis(thesisId: string) {
    const thesis = await this.db.query.theses.findFirst({
      where: (fields, operators) => operators.eq(fields.id, thesisId),
    });

    if (!thesis) {
      throw new ThesisNotFoundError(thesisId);
    }

    return thesis;
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
    createdBy: string;
    checkpointedAt: string;
    createdAt: string;
    updatedAt: string;
  }): ThesisCheckpointPayload {
    return { ...record };
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
    recommendations.push({
      code: 'REVIEW_INTAKE_REPORT',
      message: 'Review the detected structure and continue with normalization or QA.',
      triggeredBy: ['terminal:succeeded'],
    });
  } else {
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
    ? fs.readdirSync(importRootPath).filter((entry) => entry.toLowerCase().endsWith('.tex')).sort()
    : [path.basename(importRootPath)];
  const rootDir = stats.isDirectory() ? importRootPath : path.dirname(importRootPath);
  const entrypoint = texFiles.find((entry) => entry.toLowerCase() === 'main.tex') ?? texFiles[0] ?? null;

  if (!entrypoint) {
    failures.push({
      code: 'LATEX_ENTRYPOINT_NOT_FOUND',
      message: 'No .tex entrypoint was found inside the provided LaTeX import boundary.',
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
      normalizedNodeSeed.push({
        id: randomUUID(),
        parentNodeId: null,
        nodeType: 'document',
        title: path.basename(absoluteEntrypoint),
        content: null,
        sourcePath: path.relative(rootDir, absoluteEntrypoint) || path.basename(absoluteEntrypoint),
        sourceStart: '1',
        sourceEnd: String(content.split(/\r?\n/).length),
        provenanceKind: 'latex',
        provenanceJson: JSON.stringify({ kind: 'latex', entrypoint: absoluteEntrypoint }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return {
    detectedEntrypoint: entrypoint,
    structureSummary: entrypoint
      ? {
          entrypoint,
          itemCount: texFiles.length,
          items: texFiles,
        }
      : null,
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
    const xml = buffer.toString('utf8');
    if (!xml.includes('word/document.xml')) {
      warnings.push('DOCX container opened but inline XML relationships were not fully inspected in this lightweight parser.');
    }
    normalizedNodeSeed.push({
      id: randomUUID(),
      parentNodeId: null,
      nodeType: 'document',
      title: path.basename(importRootPath),
      content: null,
      sourcePath: path.basename(importRootPath),
      sourceStart: 'document.xml',
      sourceEnd: 'document.xml',
      provenanceKind: 'docx',
      provenanceJson: JSON.stringify({ kind: 'docx', file: importRootPath }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    structureSummary = {
      entrypoint: 'word/document.xml',
      itemCount: 1,
      items: ['word/document.xml'],
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
    warnings.push('PDF outline extraction is currently limited to container validation in this milestone.');
    normalizedNodeSeed.push({
      id: randomUUID(),
      parentNodeId: null,
      nodeType: 'document',
      title: path.basename(importRootPath),
      content: null,
      sourcePath: path.basename(importRootPath),
      sourceStart: 'page:1',
      sourceEnd: 'page:1',
      provenanceKind: 'pdf',
      provenanceJson: JSON.stringify({ kind: 'pdf', file: importRootPath }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    detectedEntrypoint: path.basename(importRootPath),
    structureSummary: failures.length === 0
      ? {
          entrypoint: path.basename(importRootPath),
          itemCount: 1,
          items: ['page:1'],
        }
      : null,
    warnings,
    failures,
    normalizedNodes: failures.length === 0 ? normalizedNodeSeed : [],
  };
}
