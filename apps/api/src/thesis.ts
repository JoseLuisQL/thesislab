import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

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
  activeWorkspace: ActiveWorkspacePayload | null;
  transitions: ThesisStatePayload[];
};

export type ActiveWorkspacePayload = {
  intakeJobId: string;
  detectedFormat: SourceFormat;
  entrypoint: string | null;
  nodeCount: number;
  rootNodeIds: string[];
  replacementOfIntakeJobId: string | null;
  replacedByIntakeJobId: string | null;
  recoverableCheckpointId: string | null;
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
  activeWorkspace: ActiveWorkspacePayload | null;
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

export class IntakeBoundaryViolationError extends Error {
  constructor(public readonly thesisId: string, public readonly importRootPath: string, public readonly resolvedPath: string) {
    super(
      `Import path ${importRootPath} resolves outside thesis ${thesisId} workspace boundary: ${resolvedPath}.`,
    );
    this.name = 'IntakeBoundaryViolationError';
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
      activeWorkspace: detail.activeWorkspace,
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
      nodeCount: report?.normalizationSummary?.nodeCount ?? 0,
      rootNodeIds: report?.normalizationSummary?.rootNodeIds ?? [],
      replacementOfIntakeJobId: report?.replacement?.replacesIntakeJobId ?? null,
      replacedByIntakeJobId: report?.replacement?.replacedByIntakeJobId ?? null,
      recoverableCheckpointId: report?.replacement?.recoverableCheckpointId ?? null,
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

function canonicalizeInsideBoundary(workspacePath: string, importRootPath: string, thesisId: string) {
  const translatedImportRootPath = translateHostPathToMountedRoot(path.resolve(importRootPath)) ?? importRootPath;
  const boundaryRoot = resolveBoundaryRoot(workspacePath, translatedImportRootPath);
  const requestedAbsolute = resolveImportRootPath(boundaryRoot, translatedImportRootPath);
  const resolved = resolveExistingPath(requestedAbsolute);
  const relative = path.relative(boundaryRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new IntakeBoundaryViolationError(thesisId, importRootPath, resolved);
  }

  return resolved;
}

function resolveBoundaryRoot(workspacePath: string, importRootPath: string) {
  const workspaceCandidates = [workspacePath];

  if (path.isAbsolute(workspacePath)) {
    workspaceCandidates.push(mapWorkspacePathToMountedRoot(workspacePath));
  }

  for (const candidate of workspaceCandidates) {
    try {
      return resolveExistingPath(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
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

  return resolveExistingPath(workspacePath);
}

function mapWorkspacePathToMountedRoot(workspacePath: string) {
  const cwd = path.resolve(process.cwd());
  const mountedRoot = fs.realpathSync.native(cwd);
  const workspaceSegments = splitPathSegments(path.resolve(workspacePath));
  const workspaceMatch = findRepoNameMatch(workspaceSegments, splitPathSegments(mountedRoot).at(-1));

  if (workspaceMatch) {
    return path.join(mountedRoot, ...workspaceMatch.suffixSegments);
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

function resolveImportRootPath(boundaryRoot: string, importRootPath: string) {
  return path.isAbsolute(importRootPath)
    ? resolveAbsoluteImportRootPath(importRootPath)
    : path.resolve(boundaryRoot, importRootPath);
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
  const entrypoint = texFiles.find((entry) => entry.toLowerCase() === 'main.tex') ?? texFiles[0] ?? null;
  let detectedEntrypoint = entrypoint;
  let structureSummary: IntakeReportSummary['structureSummary'] = entrypoint
    ? {
        entrypoint,
        itemCount: texFiles.length,
        items: texFiles,
      }
    : null;

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
  const orderedFiles: string[] = [];
  const nodes: Array<Omit<typeof normalizedNodes.$inferInsert, 'thesisId' | 'intakeJobId' | 'ordinal'>> = [];
  const existingIds = new Set<string>();
  const rootId = stableNodeId('latex', path.relative(rootDir, entrypoint), 'document', 0, 'document');

  const rootContent = fs.readFileSync(entrypoint, 'utf8');
  nodes.push({
    id: rootId,
    parentNodeId: null,
    nodeType: 'document',
    title: path.basename(entrypoint),
    content: null,
    sourcePath: path.relative(rootDir, entrypoint),
    sourceStart: '1',
    sourceEnd: String(rootContent.split(/\r?\n/).length),
    provenanceKind: 'latex',
    provenanceJson: JSON.stringify({ kind: 'latex', filePath: path.relative(rootDir, entrypoint), lineStart: 1, lineEnd: rootContent.split(/\r?\n/).length }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  existingIds.add(rootId);

  const sectionStack: Array<{ level: number; id: string }> = [{ level: 0, id: rootId }];

  const visitFile = (absolutePath: string) => {
    const relativePath = path.relative(rootDir, absolutePath);
    if (visited.has(relativePath)) {
      return;
    }
    visited.add(relativePath);
    orderedFiles.push(relativePath);

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);

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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        existingIds.add(id);
        sectionStack.push({ level, id });
      }

      const includeMatch = line.match(/\\(?:input|include)\{([^}]*)\}/);
      if (includeMatch) {
        const rawTarget = includeMatch[1]!.trim();
        const candidate = rawTarget.endsWith('.tex') ? rawTarget : `${rawTarget}.tex`;
        const resolvedCandidate = path.resolve(path.dirname(absolutePath), candidate);
        const resolvedPath = fs.existsSync(resolvedCandidate) ? fs.realpathSync(resolvedCandidate) : resolvedCandidate;
        const relative = path.relative(rootDir, resolvedPath);

        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          failures.push({
            code: 'LATEX_INCLUDE_OUTSIDE_BOUNDARY',
            message: 'A LaTeX include resolved outside the declared import boundary.',
            detail: `${relativePath}:${lineNumber} -> ${resolvedPath}`,
          });
          return;
        }

        if (!fs.existsSync(resolvedPath)) {
          warnings.push(`Unresolved LaTeX include ${candidate} from ${relativePath}:${lineNumber}.`);
          return;
        }

        visitFile(fs.realpathSync(resolvedPath));
      }
    });
  };

  visitFile(fs.realpathSync(entrypoint));

  return { nodes, warnings, failures, orderedFiles, entrypoint: path.relative(rootDir, entrypoint) };
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
