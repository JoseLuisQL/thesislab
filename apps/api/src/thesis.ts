import { asc, desc, eq } from 'drizzle-orm';

import {
  createDatabaseConnection,
  checkpoints,
  feedbackEntries,
  thesisStates,
  theses,
  type ThesisDbClient,
  type ThesisLifecycleState,
} from '@thesis-research-os/db';
import { randomUUID } from 'node:crypto';

type ThesisBlockers = string[];

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
