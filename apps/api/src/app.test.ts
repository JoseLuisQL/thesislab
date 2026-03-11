import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

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
  const createZipArchive = (entries: Record<string, string>) => {
    const localFileRecords: Buffer[] = [];
    const centralDirectoryRecords: Buffer[] = [];
    let offset = 0;

    for (const [name, content] of Object.entries(entries)) {
      const fileNameBuffer = Buffer.from(name, 'utf8');
      const uncompressed = Buffer.from(content, 'utf8');
      const compressed = zlib.deflateRawSync(uncompressed);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(0, 14);
      localHeader.writeUInt32LE(compressed.length, 18);
      localHeader.writeUInt32LE(uncompressed.length, 22);
      localHeader.writeUInt16LE(fileNameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);

      const localRecord = Buffer.concat([localHeader, fileNameBuffer, compressed]);
      localFileRecords.push(localRecord);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(8, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(0, 16);
      centralHeader.writeUInt32LE(compressed.length, 20);
      centralHeader.writeUInt32LE(uncompressed.length, 24);
      centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);

      const centralRecord = Buffer.concat([centralHeader, fileNameBuffer]);
      centralDirectoryRecords.push(centralRecord);
      offset += localRecord.length;
    }

    const centralDirectory = Buffer.concat(centralDirectoryRecords);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(centralDirectoryRecords.length, 8);
    endRecord.writeUInt16LE(centralDirectoryRecords.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localFileRecords, centralDirectory, endRecord]);
  };

  const createPdfWithOutline = (titles: Array<{ level: number; title: string }>) => {
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
  };

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

  it('initializes resumable create state and makes successful imports the active workspace for continuation flows', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-active-workspace-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Hallazgos}\n\\section{Resultados}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis resumible',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const created = createResponse.json() as {
      thesis: {
        thesis: {
          id: string;
          activeImportId: string | null;
          currentState: string;
        };
        nextStepSummary: string;
      };
    };

    expect(created.thesis.thesis.currentState).toBe('draft');
    expect(created.thesis.thesis.activeImportId).toBeNull();
    expect(created.thesis.nextStepSummary).toMatch(/Define el alcance inicial/i);

    const beforeImportResume = await app.inject({
      method: 'GET',
      url: `/theses/${created.thesis.thesis.id}/resume`,
    });

    expect(beforeImportResume.statusCode).toBe(200);
    expect((beforeImportResume.json() as { resume: { thesis: { activeImportId: string | null }; activeWorkspace?: null; nextAction: string } }).resume).toMatchObject({
      thesis: { activeImportId: null },
    });

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${created.thesis.thesis.id}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        id: string;
        status: string;
        recommendations: Array<{ code: string; triggeredBy: string[] }>;
        report: {
          recommendedNextSteps: Array<{ code: string; triggeredBy: string[] }>;
          normalizationSummary: { rootNodeIds: string[] } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.recommendations).toContainEqual(
      expect.objectContaining({
        code: 'ACTIVATE_IMPORTED_WORKSPACE',
        triggeredBy: expect.arrayContaining(['finding:structure:ready', 'finding:normalization:complete']),
      }),
    );

    const detailAfterImport = await app.inject({
      method: 'GET',
      url: `/theses/${created.thesis.thesis.id}`,
    });
    const resumeAfterImport = await app.inject({
      method: 'GET',
      url: `/theses/${created.thesis.thesis.id}/resume`,
    });

    expect(detailAfterImport.statusCode).toBe(200);
    expect(resumeAfterImport.statusCode).toBe(200);

    const detailPayload = detailAfterImport.json() as {
      thesis: {
        thesis: {
          id: string;
          activeImportId: string | null;
          currentState: string;
        };
        nextStepSummary: string;
        activeWorkspace: {
          intakeJobId: string;
          rootNodeIds: string[];
          nodeCount: number;
          replacementOfIntakeJobId: string | null;
        } | null;
      };
    };
    const resumePayload = resumeAfterImport.json() as {
      resume: {
        thesis: {
          id: string;
          activeImportId: string | null;
          currentState: string;
        };
        nextAction: string;
        activeWorkspace: {
          intakeJobId: string;
          rootNodeIds: string[];
          nodeCount: number;
          replacementOfIntakeJobId: string | null;
        } | null;
      };
    };

    expect(detailPayload.thesis.thesis.activeImportId).toBe(intakePayload.intakeJob.id);
    expect(detailPayload.thesis.thesis.currentState).toBe('active');
    expect(detailPayload.thesis.nextStepSummary).toMatch(/importad[ao].*activo|workspace activo/i);
    expect(detailPayload.thesis.activeWorkspace).toMatchObject({
      intakeJobId: intakePayload.intakeJob.id,
      rootNodeIds: intakePayload.intakeJob.report?.normalizationSummary?.rootNodeIds,
      replacementOfIntakeJobId: null,
    });
    expect(resumePayload.resume.thesis.activeImportId).toBe(intakePayload.intakeJob.id);
    expect(resumePayload.resume.thesis.currentState).toBe('active');
    expect(resumePayload.resume.nextAction).toBe(detailPayload.thesis.nextStepSummary);
    expect(resumePayload.resume.activeWorkspace).toMatchObject({
      intakeJobId: intakePayload.intakeJob.id,
      replacementOfIntakeJobId: null,
    });
  });

  it('accepts host-style repo-root import paths on the live-style mounted service boundary', async () => {
    const hostRepoRoot = '/root/thesislab';
    const mountedWorkspaceRoot = process.cwd();
    const relativeFixtureDir = path.join('tmp', 'live-hostpath-intake', 'latex-project');
    const latexDir = path.join(mountedWorkspaceRoot, relativeFixtureDir);
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Importacion host}\n\\section{Ruta montada}\n\\end{document}\n',
      'utf8',
    );

    vi.stubEnv('HOST_REPO_ROOT', hostRepoRoot);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis ruta host montada',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: hostRepoRoot,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: path.join(hostRepoRoot, relativeFixtureDir),
      },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          replacement: null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.importRootPath).toBe(latexDir);
    expect(intakePayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      replacement: null,
    });
  });

  it('accepts host-style repo-root tmp fixture paths when the service cwd is nested below the mounted repo root', async () => {
    const hostRepoRoot = '/root/thesislab';
    const mountedWorkspaceRoot = process.cwd();
    const relativeFixtureDir = path.join('tmp', 'hostpath-manual-check', 'latex-project');
    const latexDir = path.join(mountedWorkspaceRoot, relativeFixtureDir);
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Importacion host nested}\n\\section{Ruta tmp}\n\\end{document}\n',
      'utf8',
    );

    vi.stubEnv('HOST_REPO_ROOT', hostRepoRoot);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis ruta host nested',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: hostRepoRoot,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: path.join(hostRepoRoot, relativeFixtureDir),
      },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.importRootPath).toBe(latexDir);
    expect(intakePayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      failures: [],
    });
  });

  it('keeps repeated re-imports recoverable and exposes forward/backward lineage on active and superseded imports', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-reimport-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    const mainTex = path.join(latexDir, 'main.tex');

    fs.writeFileSync(
      mainTex,
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Version Uno}\n\\section{Marco inicial}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis con reimportación',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const firstImport = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(firstImport.statusCode).toBe(201);
    const firstImportPayload = firstImport.json() as {
      intakeJob: {
        id: string;
        report: { normalizationSummary: { rootNodeIds: string[]; nodeCount: number } | null } | null;
      };
    };

    fs.writeFileSync(
      mainTex,
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Version Dos}\n\\section{Marco actualizado v2}\n\\subsection{Hallazgos nuevos}\n\\end{document}\n',
      'utf8',
    );

    const secondImport = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    if (secondImport.statusCode !== 201) {
      throw new Error(`Second import failed: ${secondImport.statusCode} ${secondImport.body}`);
    }

    const secondImportPayload = secondImport.json() as {
      intakeJob: {
        id: string;
        status: string;
        report: {
          warnings: string[];
          recommendedNextSteps: Array<{ code: string; triggeredBy: string[]; message: string }>;
          replacement: {
            isReimport: boolean;
            replacesIntakeJobId: string;
            replacedByIntakeJobId: string | null;
            recoverableCheckpointId: string;
            supersedesWorkspace: boolean;
          } | null;
          normalizationSummary: { rootNodeIds: string[]; nodeCount: number } | null;
        } | null;
      };
    };

    expect(secondImportPayload.intakeJob.status).toBe('succeeded');
    expect(secondImportPayload.intakeJob.report?.replacement).toEqual({
      isReimport: true,
      replacesIntakeJobId: firstImportPayload.intakeJob.id,
      recoverableCheckpointId: expect.any(String),
      supersedesWorkspace: true,
    });

    fs.writeFileSync(
      mainTex,
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Version Tres}\n\\section{Marco actualizado v3}\n\\subsection{Hallazgos nuevos}\n\\subsection{Continuidad explícita}\n\\end{document}\n',
      'utf8',
    );

    const thirdImport = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    if (thirdImport.statusCode !== 201) {
      throw new Error(`Third import failed: ${thirdImport.statusCode} ${thirdImport.body}`);
    }

    const thirdImportPayload = thirdImport.json() as {
      intakeJob: {
        id: string;
        status: string;
        report: {
          warnings: string[];
          recommendedNextSteps: Array<{ code: string; triggeredBy: string[]; message: string }>;
          replacement: {
            isReimport: boolean;
            replacesIntakeJobId: string;
            replacedByIntakeJobId: string | null;
            recoverableCheckpointId: string;
            supersedesWorkspace: boolean;
          } | null;
          normalizationSummary: { rootNodeIds: string[]; nodeCount: number } | null;
        } | null;
      };
    };

    expect(thirdImportPayload.intakeJob.status).toBe('succeeded');
    expect(thirdImportPayload.intakeJob.report?.replacement).toMatchObject({
      isReimport: true,
      replacesIntakeJobId: secondImportPayload.intakeJob.id,
      recoverableCheckpointId: expect.any(String),
      supersedesWorkspace: true,
    });
    expect(thirdImportPayload.intakeJob.report?.replacement?.replacedByIntakeJobId ?? null).toBeNull();
    expect(thirdImportPayload.intakeJob.report?.warnings.some((warning) => /re-importaci[oó]n|reimport/i.test(warning))).toBe(true);
    expect(thirdImportPayload.intakeJob.report?.recommendedNextSteps).toContainEqual(
      expect.objectContaining({
        code: 'REVIEW_REIMPORT_REPLACEMENT',
        triggeredBy: expect.arrayContaining([`reimport:replaces:${secondImportPayload.intakeJob.id}`]),
      }),
    );
    expect(thirdImportPayload.intakeJob.report?.recommendedNextSteps).toContainEqual(
      expect.objectContaining({
        code: 'ACTIVATE_IMPORTED_WORKSPACE',
        triggeredBy: expect.arrayContaining(['finding:structure:ready', 'finding:normalization:complete']),
      }),
    );
    expect(thirdImportPayload.intakeJob.report?.recommendedNextSteps).not.toContainEqual(
      expect.objectContaining({
        code: 'REVIEW_INTAKE_REPORT',
      }),
    );

    const supersededFirstResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${firstImportPayload.intakeJob.id}`,
    });
    const supersededSecondResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${secondImportPayload.intakeJob.id}`,
    });
    const thirdNodesResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${thirdImportPayload.intakeJob.id}/nodes`,
    });
    const checkpointsResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/checkpoints`,
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}`,
    });
    const resumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/resume`,
    });

    expect(supersededFirstResponse.statusCode).toBe(200);
    expect(supersededSecondResponse.statusCode).toBe(200);
    expect(thirdNodesResponse.statusCode).toBe(200);
    expect(checkpointsResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);

    const supersededFirstPayload = supersededFirstResponse.json() as {
      intakeJob: {
        id: string;
        report: {
          replacement: { replacedByIntakeJobId: string | null; replacedByRecoverableCheckpointId: string | null } | null;
        } | null;
      };
    };
    const supersededSecondPayload = supersededSecondResponse.json() as {
      intakeJob: {
        id: string;
        report: {
          replacement: {
            isReimport: boolean;
            replacesIntakeJobId: string;
            replacedByIntakeJobId: string | null;
            recoverableCheckpointId: string | null;
            replacedByRecoverableCheckpointId: string | null;
          } | null;
        } | null;
      };
    };
    const thirdNodes = thirdNodesResponse.json() as { nodes: Array<{ id: string }> };
    const checkpointsPayload = checkpointsResponse.json() as {
      checkpoints: Array<{ id: string; reason: string; note: string | null; scope: string }>;
    };
    const detailPayload = detailResponse.json() as {
      thesis: {
        thesis: { activeImportId: string | null; currentState: string };
        activeWorkspace: {
          intakeJobId: string;
          replacementOfIntakeJobId: string | null;
          replacedByIntakeJobId: string | null;
          nodeCount: number;
          recoverableCheckpointId: string | null;
        } | null;
      };
    };
    const resumePayload = resumeResponse.json() as {
      resume: {
        thesis: { activeImportId: string | null; currentState: string };
        latestCheckpoint: { id: string; reason: string; note: string | null } | null;
        activeWorkspace: {
          intakeJobId: string;
          replacementOfIntakeJobId: string | null;
          replacedByIntakeJobId: string | null;
          nodeCount: number;
          recoverableCheckpointId: string | null;
        } | null;
      };
    };

    expect(thirdNodes.nodes.length).toBeGreaterThan(0);
    expect(supersededFirstPayload.intakeJob.report?.replacement).toEqual({
      replacedByIntakeJobId: secondImportPayload.intakeJob.id,
      replacedByRecoverableCheckpointId: secondImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId ?? null,
    });
    expect(supersededSecondPayload.intakeJob.report?.replacement).toEqual({
      isReimport: true,
      replacesIntakeJobId: firstImportPayload.intakeJob.id,
      recoverableCheckpointId: secondImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId ?? null,
      supersedesWorkspace: true,
      replacedByIntakeJobId: thirdImportPayload.intakeJob.id,
      replacedByRecoverableCheckpointId: thirdImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId ?? null,
    });
    expect(checkpointsPayload.checkpoints).toContainEqual(
      expect.objectContaining({
        id: secondImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId,
        reason: 'before-reimport-replacement',
        scope: 'intake-workspace',
        note: expect.stringContaining(firstImportPayload.intakeJob.id),
      }),
    );
    expect(checkpointsPayload.checkpoints).toContainEqual(
      expect.objectContaining({
        id: thirdImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId,
        reason: 'before-reimport-replacement',
        scope: 'intake-workspace',
        note: expect.stringContaining(secondImportPayload.intakeJob.id),
      }),
    );
    expect(detailPayload.thesis.thesis.activeImportId).toBe(thirdImportPayload.intakeJob.id);
    expect(detailPayload.thesis.thesis.currentState).toBe('active');
    expect(detailPayload.thesis.activeWorkspace).toMatchObject({
      intakeJobId: thirdImportPayload.intakeJob.id,
      replacementOfIntakeJobId: secondImportPayload.intakeJob.id,
      replacedByIntakeJobId: thirdImportPayload.intakeJob.report?.replacement?.replacedByIntakeJobId ?? null,
      recoverableCheckpointId: thirdImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId,
      nodeCount: thirdImportPayload.intakeJob.report?.normalizationSummary?.nodeCount,
    });
    expect(resumePayload.resume.thesis.activeImportId).toBe(thirdImportPayload.intakeJob.id);
    expect(resumePayload.resume.thesis.currentState).toBe('active');
    expect(resumePayload.resume.latestCheckpoint).toMatchObject({
      id: thirdImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId,
      reason: 'before-reimport-replacement',
    });
    expect(resumePayload.resume.activeWorkspace).toMatchObject({
      intakeJobId: thirdImportPayload.intakeJob.id,
      replacementOfIntakeJobId: secondImportPayload.intakeJob.id,
      replacedByIntakeJobId: thirdImportPayload.intakeJob.report?.replacement?.replacedByIntakeJobId ?? null,
      recoverableCheckpointId: thirdImportPayload.intakeJob.report?.replacement?.recoverableCheckpointId,
      nodeCount: thirdImportPayload.intakeJob.report?.normalizationSummary?.nodeCount,
    });
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
    fs.writeFileSync(
      path.join(latexDir, 'appendix.tex'),
      '\\chapter{Apéndice}\nContenido que no debe entrar en el grafo.\n',
      'utf8',
    );

    const docxPath = path.join(fixtureRoot, 'outline.docx');
    fs.writeFileSync(
      docxPath,
      createZipArchive({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Marco teórico</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Antecedentes</w:t></w:r></w:p></w:body></w:document>',
        'word/styles.xml': '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style></w:styles>',
      }),
    );

    const pdfPath = path.join(fixtureRoot, 'outline.pdf');
    fs.writeFileSync(
      pdfPath,
      createPdfWithOutline([
        { level: 1, title: 'Introducción' },
        { level: 2, title: 'Marco teórico' },
        { level: 3, title: 'Estado del arte' },
        { level: 2, title: 'Resultados' },
      ]),
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
          structureSummary: {
            entrypoint: string | null;
            items: string[];
            selection: { mode: string; reason: string; candidates: string[] };
            includeGraph: {
              rootFile: string | null;
              filesInOrder: string[];
              edges: Array<{ from: string; to: string; command: string; line: number }>;
              unresolved: unknown[];
              blocked: unknown[];
              cycles: unknown[];
            } | null;
            outline: Array<{
              id: string;
              title: string | null;
              level: number;
              nodeType: string;
              sourcePath: string | null;
              anchor: { start: string | null; end: string | null };
            }>;
          } | null;
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
          structureSummary: { items: string[] } | null;
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
        items: ['main.tex', 'chapter1.tex', 'sections/methodology.tex'],
        selection: {
          mode: 'deterministic',
          reason: 'A single root candidate containing a document preamble was found.',
          candidates: ['main.tex'],
        },
        includeGraph: {
          rootFile: 'main.tex',
          filesInOrder: ['main.tex', 'chapter1.tex', 'sections/methodology.tex'],
          edges: [
            { from: 'main.tex', to: 'chapter1.tex', command: 'input', line: 3 },
            { from: 'chapter1.tex', to: 'sections/methodology.tex', command: 'input', line: 4 },
          ],
          unresolved: [],
          blocked: [],
          cycles: [],
        },
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
        items: ['word/document.xml', 'chapter:Introducción', 'section:Marco teórico', 'subsection:Antecedentes'],
      },
      normalizationSummary: {
        nodeCount: 4,
        provenanceCoverage: { available: 4, unavailable: 0 },
      },
    });

    expect(pdfJob.intakeJob.sourceFormat).toBe('pdf');
    expect(pdfJob.intakeJob.detection).toMatchObject({ format: 'pdf', matchedBy: 'extension:.pdf' });
    expect(pdfJob.intakeJob.report.detectedFormat).toBe('pdf');
    expect(pdfJob.intakeJob.report.terminalStatus).toBe('succeeded');
    expect(pdfJob.intakeJob.report.structureSummary).toMatchObject({
      items: [
        'document:outline.pdf',
        'chapter:Introducción',
        'section:Marco teórico',
        'subsection:Estado del arte',
        'section:Resultados',
      ],
    });
    expect(pdfJob.intakeJob.report.normalizationSummary).toMatchObject({
      nodeCount: 5,
      provenanceCoverage: { available: 5, unavailable: 0 },
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
      expect.stringMatching(/^latex:main\.tex:document:1:main-tex:[0-9a-f-]+$/),
      expect.stringMatching(/^latex:chapter1\.tex:chapter:1:introduccion:[0-9a-f-]+$/),
      expect.stringMatching(/^latex:chapter1\.tex:section:2:marco-teorico:[0-9a-f-]+$/),
      expect.stringMatching(/^latex:sections\/methodology\.tex:section:1:metodologia:[0-9a-f-]+$/),
      expect.stringMatching(/^latex:sections\/methodology\.tex:subsection:2:datos:[0-9a-f-]+$/),
    ]);
    expect(nodesPayload.nodes.map((node) => node.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(nodesPayload.nodes[1]).toMatchObject({
      nodeType: 'chapter',
      title: 'Introduccion',
      parentNodeId: nodesPayload.nodes[0]?.id ?? null,
      provenanceKind: 'latex',
      provenance: { kind: 'latex', filePath: 'chapter1.tex', lineStart: 1, lineEnd: 1 },
    });
    expect(latexJob.intakeJob.report.structureSummary?.outline).toMatchObject([
      {
        title: 'Introduccion',
        level: 1,
        nodeType: 'chapter',
        sourcePath: 'chapter1.tex',
        anchor: { start: '1', end: '1' },
      },
      {
        title: 'Marco teorico',
        level: 2,
        nodeType: 'section',
        sourcePath: 'chapter1.tex',
        anchor: { start: '2', end: '2' },
      },
      {
        title: 'Metodologia',
        level: 2,
        nodeType: 'section',
        sourcePath: 'sections/methodology.tex',
        anchor: { start: '1', end: '1' },
      },
      {
        title: 'Datos',
        level: 3,
        nodeType: 'subsection',
        sourcePath: 'sections/methodology.tex',
        anchor: { start: '2', end: '2' },
      },
    ]);

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
    fs.writeFileSync(
      docxPath,
      createZipArchive({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Solo texto plano</w:t></w:r></w:p></w:body></w:document>',
      }),
    );

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

    expect((docxNodes.json() as { nodes: Array<{ provenanceKind: string }> }).nodes.some((node) => node.provenanceKind === 'unavailable')).toBe(true);
    expect((pdfNodes.json() as { nodes: Array<{ provenanceKind: string }> }).nodes.some((node) => node.provenanceKind === 'unavailable')).toBe(true);
  });

  it('accepts workspace-local relative intake roots against a real workspace boundary path', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-relative-'));
    const latexDir = path.join(fixtureRoot, 'imports', 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\\n\\begin{document}\\n\\section{Introducción}\\nTexto\\n\\end{document}\\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis intake relativa',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    expect(fs.existsSync(path.resolve('imports/latex-project'))).toBe(false);
    expect(fs.existsSync(path.resolve(fixtureRoot, 'imports/latex-project'))).toBe(true);

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: 'imports/latex-project' },
    });

    expect(intakeResponse.statusCode).toBe(201);
    const payload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
        } | null;
      };
    };

    expect(payload.intakeJob.status).toBe('succeeded');
    expect(payload.intakeJob.importRootPath).toBe(latexDir);
    expect(payload.intakeJob.report?.terminalStatus).toBe('succeeded');
    expect(payload.intakeJob.report?.failures).toEqual([]);
  });

  it('accepts external absolute intake roots when the stored workspace path is an unavailable host mount path', async () => {
    const hostWorkspaceRoot = path.join('/tmp', `host-workspace-${randomUUID()}`);
    const externalWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-external-live-'));
    const latexDir = path.join(externalWorkspaceRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Workspace externo}\\n\\section{Ruta /tmp}\\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis workspace externo',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: hostWorkspaceRoot,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
          structureSummary: {
            entrypoint: string | null;
          } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.importRootPath).toBe(latexDir);
    expect(intakePayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      failures: [],
      structureSummary: {
        entrypoint: 'main.tex',
      },
    });
  });

  it('accepts host /tmp intake roots on the manifest-started container boundary', async () => {
    const hostTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-host-tmp-mounted-'));
    const latexDir = path.join(hostTmpRoot, 'latex-project');
    const missingWorkspacePath = path.join(hostTmpRoot, 'missing', 'workspace-root');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Tmp montado}\n\\section{Host /tmp visible}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis host tmp montado',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: missingWorkspacePath,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
          structureSummary: {
            entrypoint: string | null;
          } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.importRootPath).toBe(latexDir);
    expect(intakePayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      failures: [],
      structureSummary: {
        entrypoint: 'main.tex',
      },
    });
  });

  it('accepts external absolute intake roots when the stored workspace path points to a missing nested path under the external workspace', async () => {
    const externalWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-external-missing-workspace-'));
    const latexDir = path.join(externalWorkspaceRoot, 'latex-project');
    const missingWorkspacePath = path.join(externalWorkspaceRoot, 'missing', 'workspace-root');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Fallback absoluto}\n\\section{Workspace ausente}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis fallback workspace ausente',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: missingWorkspacePath,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
          structureSummary: {
            entrypoint: string | null;
          } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.importRootPath).toBe(latexDir);
    expect(intakePayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      failures: [],
      structureSummary: {
        entrypoint: 'main.tex',
      },
    });
  });

  it('preserves the nearest real workspace boundary when the stored workspace path is missing but the import root is nested inside it', async () => {
    const realWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-missing-workspace-boundary-'));
    const latexDir = path.join(realWorkspaceRoot, 'projects', 'latex-project');
    const missingWorkspacePath = path.join(realWorkspaceRoot, 'missing', 'workspace-root');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Boundary fallback}\n\\section{Nested import}\n\\end{document}\n',
      'utf8',
    );
    const escapedFile = path.join(realWorkspaceRoot, 'projects', 'outside.tex');
    fs.writeFileSync(escapedFile, '\\section{Outside boundary}\n', 'utf8');
    fs.writeFileSync(
      path.join(latexDir, 'escaped.tex'),
      `\\documentclass{report}\n\\begin{document}\n\\input{${path.relative(latexDir, escapedFile).replace(/\\/g, '/').replace(/\.tex$/, '')}}\n\\end{document}\n`,
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis boundary fallback',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: missingWorkspacePath,
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const allowedResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });
    const blockedResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: path.join(realWorkspaceRoot, 'projects', 'latex-project', 'escaped.tex') },
    });

    expect(allowedResponse.statusCode).toBe(201);
    expect(blockedResponse.statusCode).toBe(201);

    const allowedPayload = allowedResponse.json() as {
      intakeJob: {
        status: string;
        importRootPath: string;
        report: {
          terminalStatus: string;
          failures: Array<{ code: string }>;
        } | null;
      };
    };

    expect(allowedPayload.intakeJob.status).toBe('succeeded');
    expect(allowedPayload.intakeJob.importRootPath).toBe(latexDir);
    expect(allowedPayload.intakeJob.report).toMatchObject({
      terminalStatus: 'succeeded',
      failures: [],
    });
    expect((blockedResponse.json() as { intakeJob: { status: string; report: { failures: Array<{ code: string }> } } }).intakeJob).toMatchObject({
      status: 'failed',
      report: {
        failures: [expect.objectContaining({ code: 'LATEX_INCLUDE_OUTSIDE_BOUNDARY' })],
      },
    });
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

  it('reports ambiguous LaTeX roots deterministically without fabricating a canonical entrypoint', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-ambiguous-root-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'alpha.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Alpha}\n\\end{document}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'beta.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\chapter{Beta}\n\\end{document}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis latex ambigua',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);
    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        detectedEntrypoint: string | null;
        report: {
          terminalStatus: string;
          structureSummary: {
            entrypoint: string | null;
            selection: { mode: string; candidates: string[]; reason: string };
            includeGraph: unknown;
            outline: unknown[];
          } | null;
          failures: Array<{ code: string; message: string }>;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('failed');
    expect(intakePayload.intakeJob.detectedEntrypoint).toBeNull();
    expect(intakePayload.intakeJob.report?.terminalStatus).toBe('failed');
    expect(intakePayload.intakeJob.report?.structureSummary).toMatchObject({
      entrypoint: null,
      selection: {
        mode: 'ambiguous',
        candidates: ['alpha.tex', 'beta.tex'],
      },
      includeGraph: null,
      outline: [],
    });
    expect(intakePayload.intakeJob.report?.failures).toContainEqual(
      expect.objectContaining({
        code: 'LATEX_ENTRYPOINT_NOT_FOUND',
        message: expect.stringContaining('deterministic'),
      }),
    );
  });

  it('reports unresolved includes and cycle-safe include traversal in the LaTeX structure summary', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-graph-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(path.join(latexDir, 'sections'), { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      '\\documentclass{report}\n\\begin{document}\n\\input{sections/intro}\n\\input{missing-section}\n\\end{document}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'intro.tex'),
      '\\chapter{Intro}\n\\input{loop}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'loop.tex'),
      '\\section{Loop}\n\\input{intro}\n',
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis latex grafo',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });

    expect(intakeResponse.statusCode).toBe(201);
    const intakePayload = intakeResponse.json() as {
      intakeJob: {
        status: string;
        report: {
          terminalStatus: string;
          warnings: string[];
          structureSummary: {
            includeGraph: {
              filesInOrder: string[];
              edges: Array<{ from: string; to: string; command: string; line: number }>;
              unresolved: Array<{ from: string; target: string; command: string; line: number; reason: string }>;
              blocked: unknown[];
              cycles: Array<{ path: string[] }>;
            } | null;
            outline: Array<{ title: string | null; level: number; sourcePath: string | null }>;
          } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.report?.terminalStatus).toBe('succeeded');
    expect(intakePayload.intakeJob.report?.warnings).toContain(
      'Unresolved LaTeX include missing-section.tex from main.tex:4.',
    );
    expect(intakePayload.intakeJob.report?.warnings.some((warning) => warning.includes('Cycle-safe traversal skipped recursive include'))).toBe(true);
    expect(intakePayload.intakeJob.report?.structureSummary?.includeGraph).toEqual({
      rootFile: 'main.tex',
      filesInOrder: ['main.tex', 'sections/intro.tex', 'sections/loop.tex'],
      edges: [
        { from: 'main.tex', to: 'sections/intro.tex', command: 'input', line: 3 },
        { from: 'sections/intro.tex', to: 'sections/loop.tex', command: 'input', line: 2 },
        { from: 'sections/loop.tex', to: 'sections/intro.tex', command: 'input', line: 2 },
      ],
      unresolved: [
        { from: 'main.tex', target: 'missing-section', command: 'input', line: 4, reason: 'missing_target' },
      ],
      blocked: [],
      cycles: [
        { path: ['main.tex', 'sections/intro.tex', 'sections/loop.tex', 'sections/intro.tex'] },
      ],
    });
    expect(intakePayload.intakeJob.report?.structureSummary?.outline).toEqual([
      expect.objectContaining({ title: 'Intro', level: 1, sourcePath: 'sections/intro.tex' }),
      expect.objectContaining({ title: 'Loop', level: 2, sourcePath: 'sections/loop.tex' }),
    ]);
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
