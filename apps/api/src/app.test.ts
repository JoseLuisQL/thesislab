import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

vi.mock('@thesis-research-os/db', async () => {
  const actual = await vi.importActual<typeof import('@thesis-research-os/db')>('@thesis-research-os/db');

  return {
    ...actual,
    runMigrations: vi.fn().mockResolvedValue({
      filePath: '/tmp/test.sqlite',
      migrationsFolder: '/tmp/migrations',
      migrationFiles: [],
    }),
  };
});

describe('GET /health', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the baseline readiness payload', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'api',
      mission: 'foundation-platform',
      timestamp: expect.any(String),
    });
  });

  it('supports manifest validation via curl-friendly json fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        accept: 'application/json',
      },
    });

    const payload = response.json() as {
      ok: boolean;
      service: string;
      mission: string;
      timestamp: string;
    };

    expect(response.headers['content-type']).toContain('application/json');
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('api');
    expect(payload.mission).toBe('foundation-platform');
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });

});

describe('API port contract', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('prefers PORT_API over PORT and falls back to the mission default', async () => {
    vi.stubEnv('PORT_API', '3123');
    vi.stubEnv('PORT', '3999');

    const { resolveApiPort } = await import('./server.js');

    expect(resolveApiPort()).toBe(3123);

    vi.stubEnv('PORT_API', '');
    expect(resolveApiPort()).toBe(3100);
  });
});

describe('GET /status/capabilities', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns local-first posture with explicit core workflow capabilities', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      ok: boolean;
      service: string;
      mission: string;
      timestamp: string;
      posture: {
        mode: string;
        state: string;
        summary: string;
      };
      workflows: Array<{
        key: string;
        state: string;
        kind: string;
        localFirst: boolean;
      }>;
      integrations: Array<{
        key: string;
        state: string;
        kind: string;
        optional: boolean;
      }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('api');
    expect(payload.mission).toBe('foundation-platform');
    expect(payload.posture).toMatchObject({
      mode: 'local-first',
      state: 'ready',
    });
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(payload.workflows).toEqual([
      expect.objectContaining({
        key: 'create',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'intake',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'resume',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'latex',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'qa',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
    ]);
    expect(payload.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'zotero',
          state: 'degraded',
          kind: 'integration',
          optional: true,
        }),
        expect.objectContaining({
          key: 'connectors',
          state: 'degraded',
          kind: 'integration',
          optional: true,
        }),
      ]),
    );
  });

  it('surfaces explicit degraded Zotero status from connector mode', async () => {
    vi.stubEnv('ZOTERO_CONNECTOR_MODE', 'offline');
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      integrations: Array<{
        key: string;
        state: string;
        summary: string;
        detail: string;
      }>;
    };

    expect(payload.integrations).toContainEqual(
      expect.objectContaining({
        key: 'zotero',
        state: 'degraded',
        summary: 'Connector not fully attached',
        detail: expect.stringContaining('offline'),
      }),
    );
  });

  it('keeps the default mock-mode degradation explicit for validator-facing service checks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
      headers: {
        accept: 'application/json',
      },
    });

    expect(response.headers['content-type']).toContain('application/json');

    const payload = response.json() as {
      integrations: Array<{
        key: string;
        summary: string;
        detail: string;
      }>;
    };

    expect(payload.integrations).toContainEqual(
      expect.objectContaining({
        key: 'zotero',
        summary: 'Mock connector only',
        detail: expect.stringContaining('local workflows remain usable'),
      }),
    );
  });
});

describe('thesis lifecycle registry routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a thesis with durable identity and safe empty-state detail payload', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis sobre aprendizaje automático',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-a',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const created = createResponse.json() as {
      ok: boolean;
      thesis: {
        thesis: {
          id: string;
          title: string;
          slug: string;
          workspacePath: string;
          currentState: string;
        };
        checkpointCount: number;
        feedbackCount: number;
        latestCheckpointId: string | null;
        latestFeedbackId: string | null;
        nextStepSummary: string;
        transitions: Array<{
          transitionedFrom: string | null;
          source: string;
          isCurrent: boolean;
        }>;
      };
    };

    expect(created.ok).toBe(true);
    expect(created.thesis.thesis.id).toEqual(expect.any(String));
    expect(created.thesis.thesis.slug).toBe('tesis-sobre-aprendizaje-automatico');
    expect(created.thesis.thesis.currentState).toBe('draft');
    expect(created.thesis.checkpointCount).toBe(0);
    expect(created.thesis.feedbackCount).toBe(0);
    expect(created.thesis.latestCheckpointId).toBeNull();
    expect(created.thesis.latestFeedbackId).toBeNull();
    expect(created.thesis.nextStepSummary).toMatch(/Define el alcance inicial/i);
    expect(created.thesis.transitions).toEqual([
      expect.objectContaining({
        transitionedFrom: null,
        source: 'system:create',
        isCurrent: true,
      }),
    ]);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${created.thesis.thesis.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);

    const detail = detailResponse.json() as {
      ok: boolean;
      thesis: {
        thesis: {
          id: string;
          title: string;
          workspacePath: string;
        };
        state: string;
        checkpointCount: number;
        feedbackCount: number;
        blockers: string[];
      };
    };

    expect(detail.ok).toBe(true);
    expect(detail.thesis.thesis.id).toBe(created.thesis.thesis.id);
    expect(detail.thesis.thesis.title).toBe('Tesis sobre aprendizaje automático');
    expect(detail.thesis.thesis.workspacePath).toBe('/workspace/thesis-a');
    expect(detail.thesis.state).toBe('draft');
    expect(detail.thesis.blockers).toEqual([]);
    expect(detail.thesis.checkpointCount).toBe(0);
    expect(detail.thesis.feedbackCount).toBe(0);
  });

  it('updates thesis metadata without losing durable identity', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis inicial',
        degreeProgram: 'Máster en Historia',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-b',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/theses/${thesisId}`,
      payload: {
        title: 'Tesis actualizada',
        workspacePath: '/workspace/thesis-b-v2',
      },
    });

    expect(updateResponse.statusCode).toBe(200);

    const updated = updateResponse.json() as {
      thesis: {
        thesis: {
          id: string;
          title: string;
          degreeProgram: string;
          institution: string;
          workspacePath: string;
          slug: string;
        };
        checkpointCount: number;
        feedbackCount: number;
      };
    };

    expect(updated.thesis.thesis.id).toBe(thesisId);
    expect(updated.thesis.thesis.title).toBe('Tesis actualizada');
    expect(updated.thesis.thesis.degreeProgram).toBe('Máster en Historia');
    expect(updated.thesis.thesis.institution).toBe('Universidad Demo');
    expect(updated.thesis.thesis.workspacePath).toBe('/workspace/thesis-b-v2');
    expect(updated.thesis.thesis.slug).toBe('tesis-actualizada');
    expect(updated.thesis.checkpointCount).toBe(0);
    expect(updated.thesis.feedbackCount).toBe(0);
  });

  it('persists inspectable state transitions with thesis-specific blockers and next steps', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis bloqueada',
        degreeProgram: 'Doctorado en Educación',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-c',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const transitionResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/state`,
      payload: {
        state: 'blocked',
        source: 'user:status-review',
        statusSummary: 'Faltan aprobaciones del tutor para continuar.',
        blockers: ['Esperando revisión metodológica'],
        nextStepSummary: 'Solicita la revisión metodológica y agenda una reunión con el tutor.',
      },
    });

    expect(transitionResponse.statusCode).toBe(200);

    const transitioned = transitionResponse.json() as {
      thesis: {
        thesis: {
          currentState: string;
        };
        state: string;
        statusSummary: string;
        blockers: string[];
        nextStepSummary: string;
        transitions: Array<{
          state: string;
          source: string;
          transitionedFrom: string | null;
          transitionedAt: string;
          isCurrent: boolean;
        }>;
      };
    };

    expect(transitioned.thesis.thesis.currentState).toBe('blocked');
    expect(transitioned.thesis.state).toBe('blocked');
    expect(transitioned.thesis.statusSummary).toBe('Faltan aprobaciones del tutor para continuar.');
    expect(transitioned.thesis.blockers).toEqual(['Esperando revisión metodológica']);
    expect(transitioned.thesis.nextStepSummary).toBe(
      'Solicita la revisión metodológica y agenda una reunión con el tutor.',
    );
    expect(transitioned.thesis.transitions[0]).toEqual(
      expect.objectContaining({
        state: 'blocked',
        source: 'user:status-review',
        transitionedFrom: 'draft',
        isCurrent: true,
      }),
    );
    expect(() => new Date(transitioned.thesis.transitions[0].transitionedAt).toISOString()).not.toThrow();
    expect(transitioned.thesis.transitions[1]).toEqual(
      expect.objectContaining({
        state: 'draft',
        source: 'system:create',
        isCurrent: false,
      }),
    );
  });

  it('fails safely for unknown thesis IDs without fabricating thesis data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/theses/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      ok: false,
      code: 'THESIS_NOT_FOUND',
      message: 'Thesis does-not-exist was not found.',
    });
  });

  it('creates thesis-scoped checkpoints and feedback, returns deterministic newest-first ordering, and aggregates resume context', async () => {
    const thesisAResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis A',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-a-memory',
      },
    });
    const thesisBResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis B',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-b-memory',
      },
    });

    const thesisAId = (thesisAResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const thesisBId = (thesisBResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/state`,
      payload: {
        state: 'blocked',
        source: 'user:review',
        statusSummary: 'Pendiente de comentarios del tutor.',
        blockers: ['Esperando comentarios del tutor'],
        nextStepSummary: 'Revisa el feedback recibido y planifica la siguiente iteración.',
      },
    });

    const checkpointOlder = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/checkpoints`,
      payload: {
        label: 'Checkpoint anterior',
        note: 'Versión previa',
        scope: 'chapter:introduction',
        reason: 'before-feedback',
        createdBy: 'user:test',
        checkpointedAt: '2026-03-10T09:00:00.000Z',
      },
    });
    const checkpointNewer = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/checkpoints`,
      payload: {
        label: 'Checkpoint reciente',
        note: 'Versión más nueva',
        scope: 'workspace',
        reason: 'after-feedback',
        createdBy: 'user:test',
        checkpointedAt: '2026-03-10T10:00:00.000Z',
      },
    });
    await app.inject({
      method: 'POST',
      url: `/theses/${thesisBId}/checkpoints`,
      payload: {
        label: 'Checkpoint thesis B',
        scope: 'workspace',
        reason: 'other-thesis',
        createdBy: 'user:test',
        checkpointedAt: '2026-03-10T11:00:00.000Z',
      },
    });

    const feedbackOlder = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/feedback`,
      payload: {
        sourceType: 'user',
        body: 'Debo mejorar la introducción con más contexto empírico.',
        recordedAt: '2026-03-10T09:30:00.000Z',
      },
    });
    const feedbackNewer = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/feedback`,
      payload: {
        sourceType: 'qa',
        body: 'El capítulo uno necesita conectar mejor la pregunta de investigación con el marco teórico.',
        summary: 'Alinear pregunta y marco teórico',
        recordedAt: '2026-03-10T10:30:00.000Z',
      },
    });
    await app.inject({
      method: 'POST',
      url: `/theses/${thesisBId}/feedback`,
      payload: {
        sourceType: 'system',
        body: 'Feedback de otra tesis',
        recordedAt: '2026-03-10T11:30:00.000Z',
      },
    });

    expect(checkpointOlder.statusCode).toBe(201);
    expect(checkpointNewer.statusCode).toBe(201);
    expect(feedbackOlder.statusCode).toBe(201);
    expect(feedbackNewer.statusCode).toBe(201);

    const checkpointList = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/checkpoints`,
    });
    const feedbackList = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/feedback`,
    });
    const resumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/resume`,
    });

    expect(checkpointList.statusCode).toBe(200);
    expect(feedbackList.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);

    const checkpointPayload = checkpointList.json() as {
      checkpoints: Array<{ id: string; thesisId: string; label: string | null; scope: string; reason: string }>;
    };
    const feedbackPayload = feedbackList.json() as {
      feedback: Array<{ id: string; thesisId: string; sourceType: string; body: string; summary: string | null }>;
    };
    const resumePayload = resumeResponse.json() as {
      resume: {
        thesis: { id: string };
        blockers: string[];
        nextAction: string;
        latestCheckpoint: { id: string; thesisId: string; label: string | null; scope: string; reason: string } | null;
        recentFeedback: Array<{ id: string; thesisId: string; sourceType: string; body: string; summary: string | null }>;
      };
    };

    expect(checkpointPayload.checkpoints).toHaveLength(2);
    expect(checkpointPayload.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      (checkpointNewer.json() as { checkpoint: { id: string } }).checkpoint.id,
      (checkpointOlder.json() as { checkpoint: { id: string } }).checkpoint.id,
    ]);
    expect(checkpointPayload.checkpoints[0]).toMatchObject({
      thesisId: thesisAId,
      label: 'Checkpoint reciente',
      scope: 'workspace',
      reason: 'after-feedback',
    });

    expect(feedbackPayload.feedback).toHaveLength(2);
    expect(feedbackPayload.feedback.map((entry) => entry.id)).toEqual([
      (feedbackNewer.json() as { feedback: { id: string } }).feedback.id,
      (feedbackOlder.json() as { feedback: { id: string } }).feedback.id,
    ]);
    expect(feedbackPayload.feedback[0]).toMatchObject({
      thesisId: thesisAId,
      sourceType: 'qa',
      summary: 'Alinear pregunta y marco teórico',
    });
    expect(feedbackPayload.feedback[1]?.summary).toMatch(/Debo mejorar la introducción/i);

    expect(resumePayload.resume.thesis.id).toBe(thesisAId);
    expect(resumePayload.resume.blockers).toEqual(['Esperando comentarios del tutor']);
    expect(resumePayload.resume.nextAction).toBe('Revisa el feedback recibido y planifica la siguiente iteración.');
    expect(resumePayload.resume.latestCheckpoint).toMatchObject({
      id: (checkpointNewer.json() as { checkpoint: { id: string } }).checkpoint.id,
      thesisId: thesisAId,
      label: 'Checkpoint reciente',
      scope: 'workspace',
      reason: 'after-feedback',
    });
    expect(resumePayload.resume.recentFeedback.map((entry) => entry.id)).toEqual([
      (feedbackNewer.json() as { feedback: { id: string } }).feedback.id,
      (feedbackOlder.json() as { feedback: { id: string } }).feedback.id,
    ]);
    expect(resumePayload.resume.recentFeedback.every((entry) => entry.thesisId === thesisAId)).toBe(true);
  });

  it('fails safely for unknown thesis memory and resume routes', async () => {
    const checkpointResponse = await app.inject({
      method: 'GET',
      url: '/theses/does-not-exist/checkpoints',
    });
    const feedbackResponse = await app.inject({
      method: 'GET',
      url: '/theses/does-not-exist/feedback',
    });
    const resumeResponse = await app.inject({
      method: 'GET',
      url: '/theses/does-not-exist/resume',
    });

    for (const response of [checkpointResponse, feedbackResponse, resumeResponse]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        ok: false,
        code: 'THESIS_NOT_FOUND',
        message: 'Thesis does-not-exist was not found.',
      });
    }
  });

  it('creates deterministic terminal intake jobs and reports explicit format detection for latex, docx, and pdf', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-fixtures-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'chapter1.tex'),
      '\\chapter{Introduccion}\n\\section{Marco teorico}\nTexto base.\n\\input{sections/methodology}\n',
      'utf8',
    );
    fs.mkdirSync(path.join(latexDir, 'sections'), { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'methodology.tex'),
      '\\section{Metodologia}\n\\subsection{Datos}\nDetalle metodologico.\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\input{chapter1}\n\\end{document}\n',
      'utf8',
    );

    const docxPath = path.join(fixtureRoot, 'outline.docx');
    fs.writeFileSync(
      docxPath,
      Buffer.from(
        'PK\u0003\u0004word/document.xml<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Marco teórico</w:t></w:r></w:p>',
        'utf8',
      ),
    );

    const pdfPath = path.join(fixtureRoot, 'outline.pdf');
    fs.writeFileSync(
      pdfPath,
      Buffer.from('%PDF-1.4\nINTRODUCCION\nMARCO TEORICO\nRESULTADOS\n%%EOF', 'utf8'),
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis intake exitosa',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const latexResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });
    const docxResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: docxPath },
    });
    const pdfResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: pdfPath },
    });

    for (const response of [latexResponse, docxResponse, pdfResponse]) {
      expect(response.statusCode).toBe(201);
      const payload = response.json() as { intakeJob: { id: string; status: string; report: { terminalStatus: string } | null } };
      expect(payload.intakeJob.id).toEqual(expect.any(String));
      expect(payload.intakeJob.status).toBe('succeeded');
      expect(payload.intakeJob.report?.terminalStatus).toBe('succeeded');
    }

    const latexJob = latexResponse.json() as {
      intakeJob: {
        id: string;
        sourceFormat: string;
        detection: { format: string; matchedBy: string };
        report: {
          detectedFormat: string;
          terminalStatus: string;
          structureSummary: { entrypoint: string | null; items: string[] } | null;
          normalizationSummary: { nodeCount: number; provenanceCoverage: { available: number; unavailable: number } } | null;
        };
      };
    };
    const docxJob = docxResponse.json() as {
      intakeJob: {
        id: string;
        sourceFormat: string;
        detection: { format: string; matchedBy: string };
        report: {
          detectedFormat: string;
          terminalStatus: string;
          structureSummary: { entrypoint: string | null; items: string[] } | null;
          normalizationSummary: { nodeCount: number; provenanceCoverage: { available: number; unavailable: number } } | null;
          warnings: string[];
        };
      };
    };
    const pdfJob = pdfResponse.json() as {
      intakeJob: {
        id: string;
        sourceFormat: string;
        detection: { format: string; matchedBy: string };
        report: {
          detectedFormat: string;
          terminalStatus: string;
          warnings: string[];
          normalizationSummary: { nodeCount: number; provenanceCoverage: { available: number; unavailable: number } } | null;
        };
      };
    };

    expect(latexJob.intakeJob.sourceFormat).toBe('latex');
    expect(latexJob.intakeJob.detection).toMatchObject({ format: 'latex', matchedBy: 'directory' });
    expect(latexJob.intakeJob.report).toMatchObject({
      detectedFormat: 'latex',
      terminalStatus: 'succeeded',
      structureSummary: {
        entrypoint: 'main.tex',
        items: ['chapter1.tex', 'main.tex', 'sections/methodology.tex'],
      },
      normalizationSummary: {
        nodeCount: 5,
      },
    });

    expect(docxJob.intakeJob.sourceFormat).toBe('docx');
    expect(docxJob.intakeJob.detection).toMatchObject({ format: 'docx', matchedBy: 'extension:.docx' });
    expect(docxJob.intakeJob.report).toMatchObject({
      detectedFormat: 'docx',
      terminalStatus: 'succeeded',
      structureSummary: {
        entrypoint: 'word/document.xml',
        items: ['word/document.xml', 'chapter:Introducción', 'section:Marco teórico'],
      },
      normalizationSummary: {
        nodeCount: 3,
        provenanceCoverage: { available: 3, unavailable: 0 },
      },
    });

    expect(pdfJob.intakeJob.sourceFormat).toBe('pdf');
    expect(pdfJob.intakeJob.detection).toMatchObject({ format: 'pdf', matchedBy: 'extension:.pdf' });
    expect(pdfJob.intakeJob.report.detectedFormat).toBe('pdf');
    expect(pdfJob.intakeJob.report.terminalStatus).toBe('succeeded');
    expect(pdfJob.intakeJob.report.normalizationSummary).toMatchObject({
      nodeCount: 4,
      provenanceCoverage: { available: 4, unavailable: 0 },
    });

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${latexJob.intakeJob.id}`,
    });
    const reportResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${latexJob.intakeJob.id}/report`,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(reportResponse.statusCode).toBe(200);
    expect((statusResponse.json() as { intakeJob: { status: string } }).intakeJob.status).toBe('succeeded');
    expect((reportResponse.json() as { report: { terminalStatus: string } }).report.terminalStatus).toBe('succeeded');

    const nodesResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${latexJob.intakeJob.id}/nodes`,
    });

    expect(nodesResponse.statusCode).toBe(200);
    const nodesPayload = nodesResponse.json() as {
      nodes: Array<{
        id: string;
        nodeType: string;
        title: string | null;
        parentNodeId: string | null;
        ordinal: number;
        provenanceKind: string;
        provenance: Record<string, unknown> | null;
      }>;
    };

    expect(nodesPayload.nodes.map((node) => node.id)).toEqual([
      'latex:main.tex:document:0:document',
      'latex:chapter1.tex:chapter:1:introduccion',
      'latex:chapter1.tex:section:2:marco-teorico',
      'latex:sections/methodology.tex:section:1:metodologia',
      'latex:sections/methodology.tex:subsection:2:datos',
    ]);
    expect(nodesPayload.nodes.map((node) => node.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(nodesPayload.nodes[1]).toMatchObject({
      nodeType: 'chapter',
      title: 'Introduccion',
      parentNodeId: 'latex:main.tex:document:0:document',
      provenanceKind: 'latex',
      provenance: { kind: 'latex', filePath: 'chapter1.tex', lineStart: 1, lineEnd: 1 },
    });

    const nodesRepeatResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${latexJob.intakeJob.id}/nodes`,
    });

    expect((nodesRepeatResponse.json() as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id)).toEqual(
      nodesPayload.nodes.map((node) => node.id),
    );
  });

  it('extracts degraded DOCX and PDF outlines with explicit provenance-unavailable warnings when semantics are weak', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-degraded-'));
    const docxPath = path.join(fixtureRoot, 'degraded.docx');
    fs.writeFileSync(docxPath, Buffer.from('PK\u0003\u0004word/document.xml<w:p><w:r><w:t>Solo texto plano</w:t></w:r></w:p>', 'utf8'));

    const pdfPath = path.join(fixtureRoot, 'degraded.pdf');
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\ntexto sin encabezados claros\n%%EOF', 'utf8'));

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis intake degradada',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const docxResponse = await app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: docxPath } });
    const pdfResponse = await app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: pdfPath } });

    expect(docxResponse.statusCode).toBe(201);
    expect(pdfResponse.statusCode).toBe(201);

    const docxJob = docxResponse.json() as { intakeJob: { id: string; report: { warnings: string[]; normalizationSummary: { provenanceCoverage: { unavailable: number } } | null } } };
    const pdfJob = pdfResponse.json() as { intakeJob: { id: string; report: { warnings: string[]; normalizationSummary: { provenanceCoverage: { unavailable: number } } | null } } };

    expect(docxJob.intakeJob.report.warnings).toContain('DOCX heading extraction degraded because no explicit Heading styles were found.');
    expect(docxJob.intakeJob.report.normalizationSummary?.provenanceCoverage.unavailable).toBe(1);
    expect(pdfJob.intakeJob.report.warnings).toContain('PDF outline extraction degraded because no reliable heading candidates were found.');
    expect(pdfJob.intakeJob.report.normalizationSummary?.provenanceCoverage.unavailable).toBe(1);

    const docxNodes = await app.inject({ method: 'GET', url: `/theses/${thesisId}/intake-jobs/${docxJob.intakeJob.id}/nodes` });
    const pdfNodes = await app.inject({ method: 'GET', url: `/theses/${thesisId}/intake-jobs/${pdfJob.intakeJob.id}/nodes` });

    expect((docxNodes.json() as { nodes: Array<{ provenanceKind: string }> }).nodes).toEqual([
      expect.objectContaining({ provenanceKind: 'unavailable' }),
    ]);
    expect((pdfNodes.json() as { nodes: Array<{ provenanceKind: string }> }).nodes).toEqual([
      expect.objectContaining({ provenanceKind: 'unavailable' }),
    ]);
  });

  it('blocks LaTeX intake that escapes the thesis workspace boundary through include roots or symlinks', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-boundary-'));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-external-'));
    const escapedProject = path.join(workspaceRoot, 'escaped-project');
    const linkedProject = path.join(workspaceRoot, 'linked-project');
    fs.mkdirSync(escapedProject, { recursive: true });
    fs.mkdirSync(linkedProject, { recursive: true });
    fs.writeFileSync(path.join(externalRoot, 'outside.tex'), '\\section{Fuera}\n', 'utf8');
    fs.writeFileSync(
      path.join(escapedProject, 'main.tex'),
      `\\documentclass{report}\n\\begin{document}\n\\input{${path.relative(escapedProject, path.join(externalRoot, 'outside.tex')).replace(/\\/g, '/').replace(/\.tex$/, '')}}\n\\end{document}\n`,
      'utf8',
    );
    fs.symlinkSync(externalRoot, path.join(linkedProject, 'shared'));
    fs.writeFileSync(
      path.join(linkedProject, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\input{shared/outside}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis boundary',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: workspaceRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const escapedResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: escapedProject },
    });
    const linkedResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: linkedProject },
    });

    expect(escapedResponse.statusCode).toBe(201);
    expect(linkedResponse.statusCode).toBe(201);

    const escapedJob = escapedResponse.json() as { intakeJob: { status: string; report: { failures: Array<{ code: string }> } } };
    const linkedJob = linkedResponse.json() as { intakeJob: { status: string; report: { failures: Array<{ code: string }> } } };

    expect(escapedJob.intakeJob.status).toBe('failed');
    expect(linkedJob.intakeJob.status).toBe('failed');
    expect(escapedJob.intakeJob.report.failures).toContainEqual(expect.objectContaining({ code: 'LATEX_INCLUDE_OUTSIDE_BOUNDARY' }));
    expect(linkedJob.intakeJob.report.failures).toContainEqual(expect.objectContaining({ code: 'LATEX_INCLUDE_OUTSIDE_BOUNDARY' }));

    const outsidePathResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: externalRoot },
    });

    expect(outsidePathResponse.statusCode).toBe(400);
    expect(outsidePathResponse.json()).toEqual(expect.objectContaining({
      ok: false,
      code: 'INTAKE_BOUNDARY_VIOLATION',
      thesisId,
    }));
  });

  it('fails unsupported or corrupt imports explicitly without persisting a fake successful model', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-invalid-'));
    const corruptLatexDir = path.join(fixtureRoot, 'latex-corrupt');
    fs.mkdirSync(corruptLatexDir, { recursive: true });
    fs.writeFileSync(path.join(corruptLatexDir, 'notes.txt'), 'sin tex', 'utf8');

    const corruptDocxPath = path.join(fixtureRoot, 'broken.docx');
    fs.writeFileSync(corruptDocxPath, Buffer.from('not-a-zip-docx', 'utf8'));

    const corruptPdfPath = path.join(fixtureRoot, 'broken.pdf');
    fs.writeFileSync(corruptPdfPath, Buffer.from('not-a-pdf', 'utf8'));

    const unsupportedPath = path.join(fixtureRoot, 'unknown.bin');
    fs.writeFileSync(unsupportedPath, Buffer.from([0, 1, 2, 3]));

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis intake fallida',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const failingResponses = await Promise.all([
      app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: corruptLatexDir } }),
      app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: corruptDocxPath } }),
      app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: corruptPdfPath } }),
      app.inject({ method: 'POST', url: `/theses/${thesisId}/intake-jobs`, payload: { importRootPath: unsupportedPath } }),
    ]);

    for (const response of failingResponses) {
      expect(response.statusCode).toBe(201);
      const payload = response.json() as {
        intakeJob: {
          status: string;
          sourceFormat: string;
          report: {
            terminalStatus: string;
            failures: Array<{ code: string }>;
            normalizationStatus: string;
          };
        };
      };

      expect(payload.intakeJob.status).toBe('failed');
      expect(payload.intakeJob.report.terminalStatus).toBe('failed');
      expect(payload.intakeJob.report.normalizationStatus).toBe('failed');
      expect(payload.intakeJob.report.failures.length).toBeGreaterThan(0);
    }

    const [latexFailure, docxFailure, pdfFailure, unsupportedFailure] = failingResponses.map((response) =>
      response.json() as {
        intakeJob: {
          sourceFormat: string;
          report: { failures: Array<{ code: string }>; structureSummary: unknown; recommendedNextSteps: Array<{ code: string }> };
        };
      },
    );

    expect(latexFailure.intakeJob.sourceFormat).toBe('latex');
    expect(latexFailure.intakeJob.report.failures).toContainEqual(
      expect.objectContaining({ code: 'LATEX_ENTRYPOINT_NOT_FOUND' }),
    );
    expect(docxFailure.intakeJob.sourceFormat).toBe('docx');
    expect(docxFailure.intakeJob.report.failures).toContainEqual(
      expect.objectContaining({ code: 'DOCX_ARCHIVE_CORRUPT' }),
    );
    expect(pdfFailure.intakeJob.sourceFormat).toBe('pdf');
    expect(pdfFailure.intakeJob.report.failures).toContainEqual(
      expect.objectContaining({ code: 'PDF_HEADER_INVALID' }),
    );
    expect(unsupportedFailure.intakeJob.sourceFormat).toBe('unknown');
    expect(unsupportedFailure.intakeJob.report.failures).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_IMPORT_FORMAT' }),
    );
    expect(unsupportedFailure.intakeJob.report.structureSummary).toBeNull();
    expect(unsupportedFailure.intakeJob.report.recommendedNextSteps).toContainEqual(
      expect.objectContaining({ code: 'FIX_IMPORT_SOURCE' }),
    );
  });

  it('fails safely when an intake job lookup uses an unknown job id', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis sin intake',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/no-intake',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    for (const url of [
      `/theses/${thesisId}/intake-jobs/does-not-exist`,
      `/theses/${thesisId}/intake-jobs/does-not-exist/report`,
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        ok: false,
        code: 'INTAKE_JOB_NOT_FOUND',
        message: `Intake job does-not-exist was not found for thesis ${thesisId}.`,
      });
    }
  });
});
