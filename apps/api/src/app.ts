import Fastify from 'fastify';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { buildHealthPayload } from '@thesis-research-os/shared';
import { createDatabaseConnection, getMigrationsDirectory } from '@thesis-research-os/db';

import { buildLocalFirstStatusPayload } from './status.js';
import {
  type CreateCheckpointInput,
  type CreateFeedbackInput,
  type CreateIntakeJobInput,
  IntakeJobNotFoundError,
  ThesisNotFoundError,
  createThesisLifecycleService,
  type TransitionThesisInput,
} from './thesis.js';

const createThesisSchema = z.object({
  title: z.string().trim().min(1),
  degreeProgram: z.string().trim().min(1),
  institution: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  defaultLanguage: z.string().trim().min(2).optional(),
});

const updateThesisSchema = createThesisSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  'At least one field must be provided.',
);

const transitionThesisSchema = z.object({
  state: z.enum(['draft', 'intake', 'active', 'blocked', 'review', 'completed']),
  source: z.string().trim().min(1),
  statusSummary: z.string().trim().min(1),
  blockers: z.array(z.string().trim().min(1)).optional(),
  nextStepSummary: z.string().trim().min(1).optional(),
});

const createCheckpointSchema = z.object({
  label: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().min(1).nullable().optional(),
  scope: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  snapshotPath: z.string().trim().min(1).nullable().optional(),
  createdBy: z.string().trim().min(1),
  checkpointedAt: z.string().datetime().optional(),
});

const createFeedbackSchema = z.object({
  sourceType: z.enum(['user', 'system', 'qa', 'compliance']),
  body: z.string().trim().min(1),
  summary: z.string().trim().min(1).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
});

const createIntakeJobSchema = z.object({
  importRootPath: z.string().trim().min(1),
});

export function createApp() {
  const testDatabaseUrl = process.env.VITEST
    ? `file:${path.join(os.tmpdir(), `thesis-api-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)}`
    : process.env.DATABASE_URL;
  const app = Fastify({ logger: true });
  let schemaReady: Promise<void> | null = null;
  let thesisLifecycle: ReturnType<typeof createThesisLifecycleService> | null = null;

  const getThesisLifecycle = async () => {
    schemaReady ??= ensureDatabaseSchema(testDatabaseUrl);
    await schemaReady;

    if (!thesisLifecycle) {
      thesisLifecycle = createThesisLifecycleService(testDatabaseUrl);
    }

    return thesisLifecycle;
  };

  app.addHook('onClose', async () => {
    thesisLifecycle?.close();
  });


  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ThesisNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'THESIS_NOT_FOUND',
        message: error.message,
      });
    }

    if (error instanceof IntakeJobNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'INTAKE_JOB_NOT_FOUND',
        message: error.message,
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Request payload failed validation.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    throw error;
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'api',
    ...buildHealthPayload('foundation-platform'),
  }));

  app.get('/status/capabilities', async () => buildLocalFirstStatusPayload());

  app.post('/theses', async (request, reply) => {
    const payload = createThesisSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.createThesis(payload);

    return reply.status(201).send({ ok: true, thesis });
  });

  app.get('/theses/:thesisId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.getThesisDetail(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, thesis };
  });

  app.patch('/theses/:thesisId', async (request) => {
    const payload = updateThesisSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.updateThesis(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return { ok: true, thesis };
  });

  app.post('/theses/:thesisId/state', async (request) => {
    const payload = transitionThesisSchema.parse(request.body) as TransitionThesisInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.transitionThesis(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return { ok: true, thesis };
  });

  app.post('/theses/:thesisId/checkpoints', async (request, reply) => {
    const payload = createCheckpointSchema.parse(request.body) as CreateCheckpointInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const checkpoint = await (await getThesisLifecycle()).service.createCheckpoint(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, checkpoint });
  });

  app.get('/theses/:thesisId/checkpoints', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const checkpoints = await (await getThesisLifecycle()).service.listCheckpoints(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, checkpoints };
  });

  app.post('/theses/:thesisId/feedback', async (request, reply) => {
    const payload = createFeedbackSchema.parse(request.body) as CreateFeedbackInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const feedback = await (await getThesisLifecycle()).service.createFeedback(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, feedback });
  });

  app.get('/theses/:thesisId/feedback', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const feedback = await (await getThesisLifecycle()).service.listFeedback(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, feedback };
  });

  app.get('/theses/:thesisId/resume', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const resume = await (await getThesisLifecycle()).service.getResume(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, resume };
  });

  app.post('/theses/:thesisId/intake-jobs', async (request, reply) => {
    const payload = createIntakeJobSchema.parse(request.body) as CreateIntakeJobInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const intakeJob = await (await getThesisLifecycle()).service.createIntakeJob(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, intakeJob });
  });

  app.get('/theses/:thesisId/intake-jobs/:intakeJobId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; intakeJobId: string };
    const intakeJob = await (await getThesisLifecycle()).service.getIntakeJob(params.thesisId, params.intakeJobId);

    return { ok: true, intakeJob };
  });

  app.get('/theses/:thesisId/intake-jobs/:intakeJobId/report', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; intakeJobId: string };
    const report = await (await getThesisLifecycle()).service.getIntakeReport(params.thesisId, params.intakeJobId);

    return { ok: true, report };
  });

  return app;
}

async function ensureDatabaseSchema(databaseUrl?: string) {
  const connection = createDatabaseConnection(databaseUrl);

  try {
    const existingTables = await connection.sqlite.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? LIMIT 1",
      args: ['table', 'sqlite_%'],
    });

    if (existingTables.rows.length > 0) {
      return;
    }

    const migrationSql = await import('node:fs/promises').then((fs) =>
      fs.readFile(`${getMigrationsDirectory()}/0000_domain_core.sql`, 'utf8'),
    );
    await connection.sqlite.executeMultiple(migrationSql);
  } finally {
    connection.sqlite.close();
  }
}
