import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp, resolveRuntimeDatabaseUrl } from './app.js';
import { createDatabaseConnection } from '@thesis-research-os/db';

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
    vi.stubEnv('DOCKER_API_VERSION', '1.44');
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

describe('GET /zotero/*', () => {
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

  it('lists Zotero libraries, collections, and items with stable normalized fields in mock mode', async () => {
    const [librariesResponse, collectionsResponse, itemsResponse] = await Promise.all([
      app.inject({ method: 'GET', url: '/zotero/libraries' }),
      app.inject({ method: 'GET', url: '/zotero/collections?libraryKey=lib-user-main' }),
      app.inject({ method: 'GET', url: '/zotero/items?libraryKey=lib-user-main' }),
    ]);

    expect(librariesResponse.statusCode).toBe(200);
    expect(collectionsResponse.statusCode).toBe(200);
    expect(itemsResponse.statusCode).toBe(200);

    const librariesPayload = librariesResponse.json() as {
      libraries: Array<{
        id: string;
        key: string;
        mode: string;
        externalId: string;
        name: string;
        kind: string;
        itemCount: number;
        collectionCount: number;
      }>;
    };
    const collectionsPayload = collectionsResponse.json() as {
      collections: Array<{
        id: string;
        key: string;
        mode: string;
        externalId: string;
        libraryId: string;
        libraryKey: string;
        parentCollectionKey: string | null;
        name: string;
        path: string[];
        itemCount: number;
      }>;
    };
    const itemsPayload = itemsResponse.json() as {
      items: Array<{
        id: string;
        key: string;
        mode: string;
        externalId: string;
        libraryId: string;
        libraryKey: string;
        collectionKeys: string[];
        itemType: string;
        title: string;
        creators: string[];
        date: string | null;
      }>;
    };

    expect(librariesPayload.libraries).toEqual([
      expect.objectContaining({
        id: 'lib-user-main',
        key: 'lib-user-main',
        mode: 'mock',
        externalId: 'lib-user-main',
        name: 'Main Research Library',
        kind: 'user',
        itemCount: 3,
        collectionCount: 2,
      }),
      expect.objectContaining({
        id: 'lib-group-thesis-lab',
        key: 'lib-group-thesis-lab',
        mode: 'mock',
        externalId: 'lib-group-thesis-lab',
        name: 'Thesis Lab Group Library',
        kind: 'group',
        itemCount: 1,
        collectionCount: 1,
      }),
    ]);

    expect(collectionsPayload.collections).toEqual([
      expect.objectContaining({
        id: 'col-ml-core',
        key: 'col-ml-core',
        mode: 'mock',
        externalId: 'col-ml-core',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        parentCollectionKey: null,
        name: 'Machine Learning Core',
        path: ['Machine Learning Core'],
        itemCount: 2,
      }),
      expect.objectContaining({
        id: 'col-ml-methods',
        key: 'col-ml-methods',
        mode: 'mock',
        externalId: 'col-ml-methods',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        parentCollectionKey: 'col-ml-core',
        name: 'Methods',
        path: ['Machine Learning Core', 'Methods'],
        itemCount: 1,
      }),
    ]);

    expect(itemsPayload.items).toEqual([
      expect.objectContaining({
        id: 'item-methods-2023',
        key: 'item-methods-2023',
        mode: 'mock',
        externalId: 'item-methods-2023',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        collectionKeys: ['col-ml-core', 'col-ml-methods'],
        itemType: 'book',
        title: 'Research Methods for Thesis Workflows',
        creators: ['Elena Method'],
        date: '2023',
      }),
      expect.objectContaining({
        id: 'item-zotero-schema-2026',
        key: 'item-zotero-schema-2026',
        mode: 'mock',
        externalId: 'item-zotero-schema-2026',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        collectionKeys: [],
        itemType: 'report',
        title: 'Stable Zotero Normalization Schema',
        creators: ['Schema Team'],
        date: '2026-02-01',
      }),
      expect.objectContaining({
        id: 'item-traceability-2024',
        key: 'item-traceability-2024',
        mode: 'mock',
        externalId: 'item-traceability-2024',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        collectionKeys: ['col-ml-core'],
        itemType: 'journalArticle',
        title: 'Traceable Evidence in AI Research',
        creators: ['Ada Lovelace', 'Grace Hopper'],
        date: '2024',
      }),
    ]);
  });

  it('searches Zotero items and keeps identifier semantics stable across connector modes', async () => {
    vi.stubEnv('ZOTERO_CONNECTOR_MODE', 'test');

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/zotero/items/search?q=traceable&libraryKey=lib-user-main',
    });

    expect(searchResponse.statusCode).toBe(200);

    const payload = searchResponse.json() as {
      items: Array<{
        id: string;
        key: string;
        mode: string;
        externalId: string;
        libraryId: string;
        libraryKey: string;
        collectionKeys: string[];
        itemType: string;
        title: string;
        creators: string[];
        date: string | null;
      }>;
    };

    expect(payload.items).toEqual([
      expect.objectContaining({
        id: 'item-traceability-2024',
        key: 'item-traceability-2024',
        mode: 'test',
        externalId: 'item-traceability-2024',
        libraryId: 'lib-user-main',
        libraryKey: 'lib-user-main',
        collectionKeys: ['col-ml-core'],
        itemType: 'journalArticle',
        title: 'Traceable Evidence in AI Research',
        creators: ['Ada Lovelace', 'Grace Hopper'],
        date: '2024',
      }),
    ]);
  });

  it('persists thesis and chapter Zotero mappings, scopes mapping lists, refreshes metadata without changing local identity, and exposes degraded connector states', async () => {
    const thesisAResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis Zotero A',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-zotero-a',
      },
    });
    const thesisBResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis Zotero B',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-zotero-b',
      },
    });

    const thesisAId = (thesisAResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const thesisBId = (thesisBResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/intake-jobs`,
      payload: {
        importRootPath: '/workspace/tmp/user-testing-intake-normalization/latex-project',
      },
    });

    expect(intakeResponse.statusCode).toBe(201);
    const intakeJobId = (intakeResponse.json() as { intakeJob: { id: string } }).intakeJob.id;
    const nodesResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/intake-jobs/${intakeJobId}/nodes`,
    });
    const chapterNodeId = (nodesResponse.json() as { nodes: Array<{ id: string; nodeType: string }> }).nodes.find(
      (node) => node.nodeType === 'chapter',
    )?.id;

    expect(chapterNodeId).toEqual(expect.any(String));

    const thesisMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/zotero-mappings`,
      payload: {
        scope: 'thesis',
        libraryId: 'lib-user-main',
        collectionKey: 'col-ml-core',
        itemKey: 'item-traceability-2024',
      },
    });
    const chapterMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/zotero-mappings`,
      payload: {
        scope: 'chapter',
        normalizedNodeId: chapterNodeId,
        libraryId: 'lib-user-main',
        collectionKey: 'col-ml-methods',
        itemKey: 'item-methods-2023',
      },
    });
    const thesisBMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisBId}/zotero-mappings`,
      payload: {
        scope: 'thesis',
        libraryId: 'lib-group-thesis-lab',
        collectionKey: 'col-group-bibliography',
        itemKey: 'item-group-citations-2022',
      },
    });

    if (thesisMappingResponse.statusCode !== 201) {
      throw new Error(`unexpected thesis mapping response: ${thesisMappingResponse.statusCode} ${thesisMappingResponse.body}`);
    }
    if (chapterMappingResponse.statusCode !== 201) {
      throw new Error(`unexpected chapter mapping response: ${chapterMappingResponse.statusCode} ${chapterMappingResponse.body}`);
    }
    if (thesisBMappingResponse.statusCode !== 201) {
      throw new Error(`unexpected thesis B mapping response: ${thesisBMappingResponse.statusCode} ${thesisBMappingResponse.body}`);
    }
    expect(chapterMappingResponse.statusCode).toBe(201);
    expect(thesisBMappingResponse.statusCode).toBe(201);

    const thesisMapping = (thesisMappingResponse.json() as { mapping: { id: string; scope: string; normalizedNodeId: string | null; normalizedData: { item: { key: string; title: string } } } }).mapping;
    const chapterMapping = (chapterMappingResponse.json() as { mapping: { id: string; scope: string; normalizedNodeId: string | null; normalizedData: { item: { key: string; title: string } } } }).mapping;

    expect(thesisMapping.scope).toBe('thesis');
    expect(thesisMapping.normalizedNodeId).toBeNull();
    expect(thesisMapping.normalizedData.item).toEqual(
      expect.objectContaining({ key: 'item-traceability-2024', title: 'Traceable Evidence in AI Research' }),
    );
    expect(chapterMapping.scope).toBe('chapter');
    expect(chapterMapping.normalizedNodeId).toBe(chapterNodeId);
    expect(chapterMapping.normalizedData.item).toEqual(
      expect.objectContaining({ key: 'item-methods-2023', title: 'Research Methods for Thesis Workflows' }),
    );

    const thesisScopedListResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/zotero-mappings`,
    });
    const chapterScopedListResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/zotero-mappings?scope=chapter&normalizedNodeId=${chapterNodeId}`,
    });
    const thesisBListResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisBId}/zotero-mappings`,
    });

    expect(thesisScopedListResponse.statusCode).toBe(200);
    expect(chapterScopedListResponse.statusCode).toBe(200);
    expect(thesisBListResponse.statusCode).toBe(200);

    const thesisScopedMappings = (thesisScopedListResponse.json() as { mappings: Array<{ id: string; thesisId: string }> }).mappings;
    const chapterScopedMappings = (chapterScopedListResponse.json() as { mappings: Array<{ id: string; normalizedNodeId: string | null }> }).mappings;
    const thesisBMappings = (thesisBListResponse.json() as { mappings: Array<{ id: string }> }).mappings;

    expect(thesisScopedMappings.map((mapping) => mapping.id)).toEqual([chapterMapping.id, thesisMapping.id]);
    expect(thesisScopedMappings.every((mapping) => mapping.thesisId === thesisAId)).toBe(true);
    expect(chapterScopedMappings).toEqual([
      expect.objectContaining({ id: chapterMapping.id, normalizedNodeId: chapterNodeId }),
    ]);
    expect(thesisBMappings).toEqual([
      expect.objectContaining({ id: (thesisBMappingResponse.json() as { mapping: { id: string } }).mapping.id }),
    ]);

    const refreshedMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/zotero-mappings/${thesisMapping.id}/refresh`,
      payload: {
        itemKey: 'item-zotero-schema-2026',
      },
    });

    expect(refreshedMappingResponse.statusCode).toBe(200);
    const refreshedMapping = (refreshedMappingResponse.json() as { mapping: { id: string; thesisId: string; normalizedNodeId: string | null; normalizedData: { item: { key: string; title: string } }; connectorStatus: string; degraded: { isDegraded: boolean } } }).mapping;
    expect(refreshedMapping.id).toBe(thesisMapping.id);
    expect(refreshedMapping.thesisId).toBe(thesisAId);
    expect(refreshedMapping.normalizedNodeId).toBeNull();
    expect(refreshedMapping.connectorStatus).toBe('ready');
    expect(refreshedMapping.degraded.isDegraded).toBe(false);
    expect(refreshedMapping.normalizedData.item).toEqual(
      expect.objectContaining({ key: 'item-zotero-schema-2026', title: 'Stable Zotero Normalization Schema' }),
    );

    const degradedMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/zotero-mappings/${chapterMapping.id}/refresh`,
      payload: {
        itemKey: 'missing-item',
      },
    });

    expect(degradedMappingResponse.statusCode).toBe(200);
    const degradedMapping = (degradedMappingResponse.json() as { mapping: { id: string; normalizedNodeId: string | null; connectorStatus: string; degraded: { isDegraded: boolean; code: string | null; message: string | null }; normalizedData: { item: unknown; collection: { key: string } | null } } }).mapping;
    expect(degradedMapping.id).toBe(chapterMapping.id);
    expect(degradedMapping.normalizedNodeId).toBe(chapterNodeId);
    expect(degradedMapping.connectorStatus).toBe('degraded');
    expect(degradedMapping.degraded).toEqual({
      isDegraded: true,
      code: 'ZOTERO_CONNECTOR_RESOLUTION_FAILED',
      message: 'Zotero connector could not resolve item for the requested mapping refresh.',
    });
    expect(degradedMapping.normalizedData.item).toBeNull();
    expect(degradedMapping.normalizedData.collection).toEqual(expect.objectContaining({ key: 'col-ml-methods' }));

    const mappingDetailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/zotero-mappings/${chapterMapping.id}`,
    });
    expect(mappingDetailResponse.statusCode).toBe(200);
    expect((mappingDetailResponse.json() as { mapping: { id: string; connectorStatus: string; degraded: { code: string | null } } }).mapping).toEqual(
      expect.objectContaining({
        id: chapterMapping.id,
        connectorStatus: 'degraded',
        degraded: expect.objectContaining({ code: 'ZOTERO_CONNECTOR_RESOLUTION_FAILED' }),
      }),
    );
  });
});

describe('resolveRuntimeDatabaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a relative workspace database path when no explicit database env is configured', async () => {
    vi.stubEnv('HOST_REPO_ROOT', '/root/thesislab');

    expect(resolveRuntimeDatabaseUrl()).toBe(`file:${path.resolve(process.cwd(), 'data', 'thesis-research-os.sqlite')}`);
  });

});

describe('thesis lifecycle registry routes', () => {
  let databaseUrl: string;

  const createTestDatabaseUrl = () => {
    const databasePath = path.join(
      os.tmpdir(),
      `thesis-api-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );

    return `file:${databasePath}`;
  };

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
    databaseUrl = createTestDatabaseUrl();
    vi.stubEnv('DATABASE_URL', databaseUrl);
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await app.close();

    const databasePath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;

    if (databasePath) {
      fs.rmSync(databasePath, { force: true });
    }
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
        latestComplianceRun: { id: string } | null;
        latestAcademicQaRun: { id: string } | null;
        recentComplianceFindings: Array<unknown>;
        recentAcademicQaFindings: Array<unknown>;
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
    expect(resumePayload.resume.latestComplianceRun).toBeNull();
    expect(resumePayload.resume.latestAcademicQaRun).toBeNull();
    expect(resumePayload.resume.recentComplianceFindings).toEqual([]);
    expect(resumePayload.resume.recentAcademicQaFindings).toEqual([]);
  });

  it('preserves thesis-scoped QA and compliance continuity, grounded support context, fresh reruns, and traceability in resume flows', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crossflow-support-aware-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    const mainTex = path.join(latexDir, 'main.tex');

    fs.writeFileSync(
      mainTex,
      String.raw`\documentclass{report}
\begin{document}
\chapter{Introducción}
Marco inicial.

\chapter{Metodología}
\section{Metodología}
Diseño del estudio.

\chapter{Resultados}
\section{Resultados}
Hallazgos principales.
\end{document}
`,
      'utf8',
    );

    const createPrimaryResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis continuidad cruzada',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });
    const createSecondaryResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis aislada secundaria',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const primaryThesisId = (createPrimaryResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const secondaryThesisId = (createSecondaryResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });
    expect(intakeResponse.statusCode).toBe(201);

    const setupResponse = await app.inject({ method: 'GET', url: `/theses/${primaryThesisId}/evidence-context-setup` });
    expect(setupResponse.statusCode).toBe(200);
    const setup = (setupResponse.json() as {
      setup: {
        normalizedNodes: Array<{ id: string; title: string | null; nodeType: string }>;
      };
    }).setup;
    const methodologyNode = setup.normalizedNodes.find((node) => node.title?.includes('Metodología') && node.nodeType === 'section');
    const resultsNode = setup.normalizedNodes.find((node) => node.title?.includes('Resultados') && node.nodeType === 'section');
    expect(methodologyNode).toBeTruthy();
    expect(resultsNode).toBeTruthy();

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Base empírica principal',
        authors: ['Ana Evidencia'],
        publicationYear: 2024,
      },
    });
    expect(sourceResponse.statusCode).toBe(201);
    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const evidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/evidence-fragments`,
      payload: {
        sourceId,
        normalizedNodeId: resultsNode!.id,
        snippet: 'El experimento mostró mejoras del 10%.',
        extractionMethod: 'manual',
        locator: 'p. 12',
      },
    });
    expect(evidenceResponse.statusCode).toBe(201);
    const evidenceId = (evidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/claims`,
      payload: {
        text: 'Los resultados son consistentes con la literatura previa.',
        normalizedNodeId: resultsNode!.id,
      },
    });
    expect(claimResponse.statusCode).toBe(201);
    const claimId = (claimResponse.json() as { claim: { id: string } }).claim.id;

    const linkEvidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/claims/${claimId}/evidence-links`,
      payload: {
        evidenceFragmentIds: [evidenceId],
        rationale: 'La evidencia respalda el resultado reportado.',
      },
    });
    expect(linkEvidenceResponse.statusCode).toBe(200);

    const zoteroMappingResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/zotero-mappings`,
      payload: {
        scope: 'thesis',
        libraryId: 'lib-user-main',
        collectionKey: 'col-ml-core',
        itemKey: 'item-traceability-2024',
      },
    });
    expect(zoteroMappingResponse.statusCode).toBe(201);
    const zoteroMappingId = (zoteroMappingResponse.json() as { mapping: { id: string } }).mapping.id;

    const firstBuildResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/latex/builds`,
      payload: { createdBy: 'qa-reviewer' },
    });
    expect(firstBuildResponse.statusCode).toBe(201);
    const firstBuildRunId = (firstBuildResponse.json() as { build: { buildRun: { id: string } } }).build.buildRun.id;

    const firstComplianceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/compliance-runs`,
    });
    const firstQaResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/academic-qa-runs`,
    });
    expect(firstComplianceResponse.statusCode).toBe(201);
    expect(firstQaResponse.statusCode).toBe(201);

    const firstComplianceRun = (firstComplianceResponse.json() as { complianceRun: { id: string; issues: Array<{ id: string }> } }).complianceRun;
    const firstAcademicQaRun = (firstQaResponse.json() as { academicQaRun: { id: string; issues: Array<{ id: string; category: string }> } }).academicQaRun;

    const secondaryComplianceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${secondaryThesisId}/compliance-runs`,
    });
    const secondaryQaResponse = await app.inject({
      method: 'POST',
      url: `/theses/${secondaryThesisId}/academic-qa-runs`,
    });
    expect(secondaryComplianceResponse.statusCode).toBe(201);
    expect(secondaryQaResponse.statusCode).toBe(201);

    const initialResumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${primaryThesisId}/resume`,
    });
    expect(initialResumeResponse.statusCode).toBe(200);

    const initialResume = (initialResumeResponse.json() as {
      resume: {
        activeWorkspace: { latestBuildRunId: string | null } | null;
        latestComplianceRun: { id: string } | null;
        latestAcademicQaRun: { id: string } | null;
        recentComplianceFindings: Array<{ id: string; thesisId: string; complianceRunId: string; evidenceContext: { sourceIds: string[]; evidenceFragmentIds: string[]; zoteroMappingIds: string[]; buildRunId: string | null } }>;
        recentAcademicQaFindings: Array<{ id: string; thesisId: string; academicQaRunId: string; claimId: string | null; normalizedNodeId: string | null; supportContext: { sourceIds: string[]; evidenceFragmentIds: string[]; zoteroMappingIds: string[]; buildRunId: string | null } }>;
      };
    }).resume;

    expect(initialResume.activeWorkspace?.latestBuildRunId).toBe(firstBuildRunId);
    expect(initialResume.latestComplianceRun?.id).toBe(firstComplianceRun.id);
    expect(initialResume.latestAcademicQaRun?.id).toBe(firstAcademicQaRun.id);
    expect(initialResume.recentComplianceFindings.every((issue) => issue.thesisId === primaryThesisId)).toBe(true);
    expect(initialResume.recentAcademicQaFindings.every((issue) => issue.thesisId === primaryThesisId)).toBe(true);
    expect(initialResume.recentComplianceFindings.some((issue) => issue.complianceRunId === firstComplianceRun.id)).toBe(true);
    expect(initialResume.recentAcademicQaFindings.some((issue) => issue.academicQaRunId === firstAcademicQaRun.id)).toBe(true);

    const evidenceLinkedFinding = initialResume.recentAcademicQaFindings.find((issue) => issue.claimId === claimId);
    expect(evidenceLinkedFinding).toMatchObject({
      normalizedNodeId: resultsNode!.id,
      supportContext: {
        sourceIds: [sourceId],
        evidenceFragmentIds: [evidenceId],
        zoteroMappingIds: [zoteroMappingId],
        buildRunId: firstBuildRunId,
      },
    });

    const methodologyFinding = initialResume.recentAcademicQaFindings.find((issue) => issue.normalizedNodeId === methodologyNode!.id);
    expect(methodologyFinding?.supportContext.buildRunId).toBe(firstBuildRunId);

    const complianceIssueWithContext = initialResume.recentComplianceFindings[0];
    expect(complianceIssueWithContext?.evidenceContext.buildRunId).toBe(firstBuildRunId);
    expect(complianceIssueWithContext?.evidenceContext.sourceIds).toEqual([sourceId]);
    expect(complianceIssueWithContext?.evidenceContext.evidenceFragmentIds).toEqual([evidenceId]);
    expect(complianceIssueWithContext?.evidenceContext.zoteroMappingIds).toEqual([zoteroMappingId]);

    fs.writeFileSync(
      mainTex,
      String.raw`\documentclass{report}
\begin{document}
\chapter{Introducción}
Marco inicial.

\chapter{Metodología}
\section{Metodología}
Diseño del estudio.

\chapter{Resultados}
\section{Resultados}
Hallazgos principales.

\chapter{Conclusiones}
\section{Conclusiones}
Conclusiones finales.
\end{document}
`,
      'utf8',
    );

    const reimportResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/intake-jobs`,
      payload: { importRootPath: latexDir },
    });
    expect(reimportResponse.statusCode).toBe(201);

    const secondBuildResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/latex/builds`,
      payload: { createdBy: 'qa-reviewer' },
    });
    expect(secondBuildResponse.statusCode).toBe(201);
    const secondBuildRunId = (secondBuildResponse.json() as { build: { buildRun: { id: string } } }).build.buildRun.id;

    const secondComplianceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/compliance-runs`,
    });
    const secondQaResponse = await app.inject({
      method: 'POST',
      url: `/theses/${primaryThesisId}/academic-qa-runs`,
    });
    expect(secondComplianceResponse.statusCode).toBe(201);
    expect(secondQaResponse.statusCode).toBe(201);

    const secondComplianceRun = (secondComplianceResponse.json() as { complianceRun: { id: string; issues: Array<{ id: string }> } }).complianceRun;
    const secondAcademicQaRun = (secondQaResponse.json() as { academicQaRun: { id: string; issues: Array<{ id: string; category: string }> } }).academicQaRun;

    expect(secondComplianceRun.id).not.toBe(firstComplianceRun.id);
    expect(secondAcademicQaRun.id).not.toBe(firstAcademicQaRun.id);
    expect(secondComplianceRun.issues).toEqual([]);
    expect(secondAcademicQaRun.issues.map((issue) => issue.id)).not.toEqual(firstAcademicQaRun.issues.map((issue) => issue.id));

    const finalResumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${primaryThesisId}/resume`,
    });
    const secondaryResumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${secondaryThesisId}/resume`,
    });
    expect(finalResumeResponse.statusCode).toBe(200);
    expect(secondaryResumeResponse.statusCode).toBe(200);

    const finalResume = (finalResumeResponse.json() as {
      resume: {
        activeWorkspace: { latestBuildRunId: string | null } | null;
        latestComplianceRun: { id: string } | null;
        latestAcademicQaRun: { id: string } | null;
        recentComplianceFindings: Array<{ id: string; complianceRunId: string; evidenceContext: { buildRunId: string | null } }>;
        recentAcademicQaFindings: Array<{ id: string; academicQaRunId: string; supportContext: { buildRunId: string | null } }>;
      };
    }).resume;
    const secondaryResume = (secondaryResumeResponse.json() as {
      resume: {
        latestComplianceRun: { id: string } | null;
        latestAcademicQaRun: { id: string } | null;
        recentComplianceFindings: Array<{ thesisId: string }>;
        recentAcademicQaFindings: Array<{ thesisId: string }>;
      };
    }).resume;

    expect(finalResume.activeWorkspace?.latestBuildRunId).toBe(secondBuildRunId);
    expect(finalResume.latestComplianceRun?.id).toBe(secondComplianceRun.id);
    expect(finalResume.latestAcademicQaRun?.id).toBe(secondAcademicQaRun.id);
    expect(finalResume.recentComplianceFindings.every((issue) => issue.complianceRunId === secondComplianceRun.id)).toBe(true);
    expect(finalResume.recentAcademicQaFindings.every((issue) => issue.academicQaRunId === secondAcademicQaRun.id)).toBe(true);
    expect(finalResume.recentComplianceFindings.every((issue) => issue.evidenceContext.buildRunId === secondBuildRunId)).toBe(true);
    expect(finalResume.recentAcademicQaFindings.every((issue) => issue.supportContext.buildRunId === secondBuildRunId)).toBe(true);
    expect(secondaryResume.latestComplianceRun?.id).not.toBe(secondComplianceRun.id);
    expect(secondaryResume.latestAcademicQaRun?.id).not.toBe(secondAcademicQaRun.id);
    expect(secondaryResume.recentComplianceFindings.every((issue) => issue.thesisId === secondaryThesisId)).toBe(true);
    expect(secondaryResume.recentAcademicQaFindings.every((issue) => issue.thesisId === secondaryThesisId)).toBe(true);

    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

  it('registers thesis-scoped sources deterministically, supports search/listing, and preserves PDF ingest states', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis de fuentes',
        degreeProgram: 'Máster en Biblioteconomía',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-sources',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const firstPdfSource = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'pdf',
        title: 'Evidence in AI Systems',
        authors: ['Ada Lovelace', 'Grace Hopper'],
        publicationYear: 2024,
        locator: 'doi:10.1234/evidence',
        ingest: {
          pdfText: 'This PDF contains enough extracted text to be considered a successful ingest for downstream evidence workflows. '.repeat(3),
          pdfMetadata: {
            pageCount: 12,
            fileName: 'evidence-ai.pdf',
          },
        },
      },
    });

    const duplicatePdfSource = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'pdf',
        title: 'Evidence in AI Systems',
        authors: ['Ada Lovelace', 'Grace Hopper'],
        publicationYear: 2024,
        locator: 'doi:10.1234/evidence',
        ingest: {
          pdfText: 'This PDF contains enough extracted text to be considered a successful ingest for downstream evidence workflows. '.repeat(3),
        },
      },
    });

    const degradedPdfSource = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'pdf',
        title: 'Weak Scan OCR',
        authors: ['Archivist Demo'],
        locator: 'file://weak-scan.pdf',
        ingest: {
          pdfText: 'few words',
          pdfMetadata: {
            pageCount: 2,
          },
        },
      },
    });

    const failedPdfSource = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'pdf',
        title: 'Unreadable Scan',
        authors: ['Archivist Demo'],
        locator: 'file://unreadable-scan.pdf',
      },
    });

    const articleSource = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Deterministic Registry Design',
        authors: ['Linus Example'],
        publicationYear: 2022,
        locator: 'doi:10.1234/registry',
      },
    });

    expect(firstPdfSource.statusCode).toBe(201);
    expect(duplicatePdfSource.statusCode).toBe(200);
    expect(degradedPdfSource.statusCode).toBe(201);
    expect(failedPdfSource.statusCode).toBe(201);
    expect(articleSource.statusCode).toBe(201);

    const createdSource = firstPdfSource.json() as { source: { id: string; status: string; ingest: { ingestStatus: string; pdfExtractionStatus: string; pdfMetadata: Record<string, unknown> | null } }; duplicate: boolean };
    const duplicateSource = duplicatePdfSource.json() as { source: { id: string }; duplicate: boolean };
    const degradedSource = degradedPdfSource.json() as { source: { status: string; ingest: { ingestStatus: string; pdfExtractionStatus: string; warnings: string[] } } };
    const failedSource = failedPdfSource.json() as { source: { status: string; ingest: { ingestStatus: string; pdfExtractionStatus: string; failures: Array<{ code: string; message: string }> } } };

    expect(createdSource.duplicate).toBe(false);
    expect(createdSource.source.status).toBe('ready');
    expect(createdSource.source.ingest.ingestStatus).toBe('succeeded');
    expect(createdSource.source.ingest.pdfExtractionStatus).toBe('succeeded');
    expect(createdSource.source.ingest.pdfMetadata).toEqual(expect.objectContaining({ pageCount: 12 }));
    expect(duplicateSource.duplicate).toBe(true);
    expect(duplicateSource.source.id).toBe(createdSource.source.id);
    expect(degradedSource.source.status).toBe('degraded');
    expect(degradedSource.source.ingest.pdfExtractionStatus).toBe('degraded');
    expect(degradedSource.source.ingest.warnings).toContain('PDF extraction degraded because extracted text was weak or incomplete.');
    expect(failedSource.source.status).toBe('failed');
    expect(failedSource.source.ingest.pdfExtractionStatus).toBe('failed');
    expect(failedSource.source.ingest.failures).toContainEqual(
      expect.objectContaining({ code: 'PDF_TEXT_UNAVAILABLE' }),
    );

    const listResponse = await app.inject({ method: 'GET', url: `/theses/${thesisId}/sources` });
    const searchResponse = await app.inject({ method: 'GET', url: `/theses/${thesisId}/sources?q=registry` });
    const detailResponse = await app.inject({ method: 'GET', url: `/theses/${thesisId}/sources/${createdSource.source.id}` });

    expect(listResponse.statusCode).toBe(200);
    expect(searchResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);

    const listPayload = listResponse.json() as { sources: Array<{ id: string; title: string; sourceType: string; evidenceCount: number; claimCount: number; ingest: { signature: string } }> };
    const searchPayload = searchResponse.json() as { sources: Array<{ title: string }> };
    const detailPayload = detailResponse.json() as { source: { id: string; thesisId: string; authors: string[]; ingest: { signature: string } } };

    expect(listPayload.sources.map((source) => source.title)).toEqual([
      'Deterministic Registry Design',
      'Evidence in AI Systems',
      'Unreadable Scan',
      'Weak Scan OCR',
    ]);
    expect(searchPayload.sources).toEqual([
      expect.objectContaining({ title: 'Deterministic Registry Design' }),
    ]);
    expect(detailPayload.source.id).toBe(createdSource.source.id);
    expect(detailPayload.source.thesisId).toBe(thesisId);
    expect(detailPayload.source.authors).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(detailPayload.source.ingest.signature).toEqual(expect.any(String));
  });

  it('creates provenance-rich evidence fragments linked to thesis section and task context', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis de evidencia',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-evidence',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: '/workspace/tmp/user-testing-intake-normalization/latex-project',
      },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const intakeJobId = (intakeResponse.json() as { intakeJob: { id: string } }).intakeJob.id;

    const taskResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks`,
      payload: {
        title: 'Relacionar evidencia',
        intent: 'Conectar evidencia con la sección correcta',
        status: 'in_progress',
        priority: 1,
        sortOrder: 1,
      },
    });

    expect(taskResponse.statusCode).toBe(201);

    const createdTask = taskResponse.json() as { task: { id: string; title: string; status: string } };

    const nodesResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${intakeJobId}/nodes`,
    });

    expect(nodesResponse.statusCode).toBe(200);

    const normalizedNodeId = ((nodesResponse.json() as { nodes: Array<{ id: string; nodeType: string; title: string | null }> }).nodes.find(
      (node) => node.nodeType === 'section',
    )?.id);

    expect(normalizedNodeId).toEqual(expect.any(String));

    const setupResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/evidence-context-setup`,
    });

    expect(setupResponse.statusCode).toBe(200);
    const setupPayload = (setupResponse.json() as {
      setup: { thesisId: string; activeImportId: string | null; normalizedNodes: Array<{ id: string }>; tasks: Array<{ id: string }> };
    }).setup;

    expect(setupPayload.thesisId).toBe(thesisId);
    expect(setupPayload.activeImportId).toBe(intakeJobId);
    expect(setupPayload.normalizedNodes).toContainEqual(expect.objectContaining({ id: normalizedNodeId }));
    expect(setupPayload.tasks).toContainEqual(expect.objectContaining({ id: createdTask.task.id }));

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Theoretical Grounding',
        authors: ['Beatriz Researcher'],
        locator: 'doi:10.1000/theory',
      },
    });

    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const evidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 14',
        snippet: 'The framework establishes a repeatable relationship between traceability and thesis support.',
        extractionMethod: 'pdf-parse',
        confidence: 0.81,
        provenance: {
          page: 14,
          boundingBox: [10, 20, 200, 80],
          extractionStatus: 'succeeded',
        },
        normalizedNodeId,
        taskId: createdTask.task.id,
      },
    });

    if (evidenceResponse.statusCode !== 201) {
      throw new Error(`unexpected evidence response: ${evidenceResponse.statusCode} ${evidenceResponse.body}`);
    }

    const createdEvidence = evidenceResponse.json() as {
      evidenceFragment: {
        id: string;
        sourceId: string;
        locator: string | null;
        extractionMethod: string;
        provenance: Record<string, unknown> | null;
        context: {
          section: { id: string; title: string | null; nodeType: string } | null;
          task: { id: string; title: string; status: string } | null;
        };
      };
    };

    expect(createdEvidence.evidenceFragment.sourceId).toBe(sourceId);
    expect(createdEvidence.evidenceFragment.locator).toBe('p. 14');
    expect(createdEvidence.evidenceFragment.extractionMethod).toBe('pdf-parse');
    expect(createdEvidence.evidenceFragment.provenance).toEqual(expect.objectContaining({ page: 14 }));
    expect(createdEvidence.evidenceFragment.context.section).toEqual(
      expect.objectContaining({ id: normalizedNodeId, nodeType: 'section' }),
    );
    expect(createdEvidence.evidenceFragment.context.task).toEqual(
      expect.objectContaining({ id: createdTask.task.id, title: 'Relacionar evidencia', status: 'in_progress' }),
    );

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/evidence-fragments/${createdEvidence.evidenceFragment.id}`,
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/evidence-fragments`,
    });
    const sourceDetailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/sources/${sourceId}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(sourceDetailResponse.statusCode).toBe(200);

    const detailPayload = detailResponse.json() as { evidenceFragment: { id: string; context: { section: { id: string } | null; task: { id: string } | null } } };
    const listPayload = listResponse.json() as { evidenceFragments: Array<{ id: string; source: { id: string; title: string } }> };
    const sourcePayload = sourceDetailResponse.json() as { source: { evidenceCount: number; claimCount: number } };

    expect(detailPayload.evidenceFragment.context.section?.id).toBe(normalizedNodeId);
    expect(detailPayload.evidenceFragment.context.task?.id).toBe(createdTask.task.id);
    expect(listPayload.evidenceFragments).toEqual([
      expect.objectContaining({
        id: createdEvidence.evidenceFragment.id,
        source: expect.objectContaining({ id: sourceId, title: 'Theoretical Grounding' }),
      }),
    ]);
    expect(sourcePayload.source.evidenceCount).toBe(1);
    expect(sourcePayload.source.claimCount).toBe(0);
  });

  it('rejects evidence context links that cross thesis scope', async () => {
    const thesisA = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis A contexto',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-a-context',
      },
    });
    const thesisB = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis B contexto',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-b-context',
      },
    });

    const thesisAId = (thesisA.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const thesisBId = (thesisB.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const dbUrl = process.env.DATABASE_URL as string;
    const connection = createDatabaseConnection(dbUrl);

    try {
      await connection.db.insert((await import('@thesis-research-os/db')).workflowTasks).values({
        id: 'task-cross-thesis',
        thesisId: thesisBId,
        parentTaskId: null,
        title: 'Task B',
        intent: 'Other thesis task',
        status: 'pending',
        priority: 1,
        sortOrder: 1,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      });
    } finally {
      connection.sqlite.close();
    }

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Scoped Source',
      },
    });

    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;
    const response = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/evidence-fragments`,
      payload: {
        sourceId,
        snippet: 'Scoped snippet',
        extractionMethod: 'manual',
        taskId: 'task-cross-thesis',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      ok: false,
      code: 'EVIDENCE_CONTEXT_SCOPE_ERROR',
      message: `Workflow task task-cross-thesis is not available for thesis ${thesisAId}.`,
      thesisId: thesisAId,
    });
  });

  it('exposes thesis-scoped public evidence context setup with tasks and active-import normalized nodes', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis de setup público',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-evidence-setup',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: '/workspace/tmp/user-testing-intake-normalization/latex-project',
      },
    });

    expect(intakeResponse.statusCode).toBe(201);
    const intakeJobId = (intakeResponse.json() as { intakeJob: { id: string } }).intakeJob.id;

    const taskOneResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks`,
      payload: {
        title: 'Primera tarea',
        intent: 'Preparar contexto de investigación',
        status: 'pending',
        priority: 1,
        sortOrder: 2,
      },
    });
    const taskTwoResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks`,
      payload: {
        title: 'Segunda tarea',
        intent: 'Vincular evidencia al capítulo',
        status: 'in_progress',
        priority: 2,
        sortOrder: 1,
      },
    });

    expect(taskOneResponse.statusCode).toBe(201);
    expect(taskTwoResponse.statusCode).toBe(201);

    const listTasksResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks`,
    });

    expect(listTasksResponse.statusCode).toBe(200);
    expect((listTasksResponse.json() as { tasks: Array<{ title: string; status: string }> }).tasks.map((task) => ({
      title: task.title,
      status: task.status,
    }))).toEqual([
      { title: 'Segunda tarea', status: 'in_progress' },
      { title: 'Primera tarea', status: 'pending' },
    ]);

    const setupResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/evidence-context-setup`,
    });

    expect(setupResponse.statusCode).toBe(200);

    const setupPayload = setupResponse.json() as {
      setup: {
        thesisId: string;
        activeImportId: string | null;
        normalizedNodes: Array<{ id: string; thesisId: string }>;
        tasks: Array<{ title: string; status: string }>;
      };
    };

    expect(setupPayload.setup.thesisId).toBe(thesisId);
    expect(setupPayload.setup.activeImportId).toBe(intakeJobId);
    expect(setupPayload.setup.normalizedNodes.length).toBeGreaterThan(0);
    expect(setupPayload.setup.normalizedNodes.every((node) => node.thesisId === thesisId)).toBe(true);
    expect(setupPayload.setup.tasks.map((task) => ({ title: task.title, status: task.status }))).toEqual([
      { title: 'Segunda tarea', status: 'in_progress' },
      { title: 'Primera tarea', status: 'pending' },
    ]);
  });

  it('creates thesis-scoped roadmap tasks with stable IDs and persists task checkpoints across detail, list, and resume flows', async () => {
    const thesisResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis con roadmap y progreso',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-roadmap',
      },
    });

    expect(thesisResponse.statusCode).toBe(201);
    const thesisId = (thesisResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const taskResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks`,
      payload: {
        title: 'Redactar marco teórico',
        intent: 'Organizar las fuentes y cerrar la sección base del marco teórico.',
        status: 'in_progress',
        priority: 3,
        sortOrder: 10,
      },
    });

    expect(taskResponse.statusCode).toBe(201);
    const createdTask = taskResponse.json() as {
      task: {
        id: string;
        thesisId: string;
        title: string;
        intent: string;
        status: string;
        priority: number;
        sortOrder: number;
        activeCheckpointId: string | null;
      };
    };

    expect(createdTask.task).toMatchObject({
      thesisId,
      title: 'Redactar marco teórico',
      intent: 'Organizar las fuentes y cerrar la sección base del marco teórico.',
      status: 'in_progress',
      priority: 3,
      sortOrder: 10,
      activeCheckpointId: null,
    });
    expect(createdTask.task.id).toEqual(expect.any(String));

    const checkpointOlderResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks/${createdTask.task.id}/checkpoints`,
      payload: {
        label: 'Primer avance',
        summary: 'Se completó el bosquejo inicial del capítulo.',
        progressPercent: 35,
        blocker: null,
        checkpointedAt: '2026-03-10T09:00:00.000Z',
      },
    });
    const checkpointLatestResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks/${createdTask.task.id}/checkpoints`,
      payload: {
        label: 'Segundo avance',
        summary: 'Se vinculó la bibliografía clave y quedó lista la revisión con tutor.',
        progressPercent: 80,
        blocker: 'Pendiente de comentarios del tutor',
        checkpointedAt: '2026-03-10T12:00:00.000Z',
      },
    });

    if (checkpointOlderResponse.statusCode !== 201 || checkpointLatestResponse.statusCode !== 201) {
      throw new Error(`unexpected task checkpoint responses: ${checkpointOlderResponse.statusCode} ${checkpointOlderResponse.body} / ${checkpointLatestResponse.statusCode} ${checkpointLatestResponse.body}`);
    }

    const latestCheckpoint = checkpointLatestResponse.json() as {
      checkpoint: {
        id: string;
        thesisId: string;
        taskId: string;
        progressPercent: number;
        blocker: string | null;
      };
    };

    expect(latestCheckpoint.checkpoint).toMatchObject({
      thesisId,
      taskId: createdTask.task.id,
      progressPercent: 80,
      blocker: 'Pendiente de comentarios del tutor',
    });

    const listTasksResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks`,
    });
    const detailTaskResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks/${createdTask.task.id}`,
    });
    const listCheckpointsResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks/${createdTask.task.id}/checkpoints`,
    });
    const resumeResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/resume`,
    });

    expect(listTasksResponse.statusCode).toBe(200);
    expect(detailTaskResponse.statusCode).toBe(200);
    expect(listCheckpointsResponse.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);

    expect((listTasksResponse.json() as {
      tasks: Array<{ id: string; activeCheckpointId: string | null; status: string; intent: string }>;
    }).tasks).toEqual([
      expect.objectContaining({
        id: createdTask.task.id,
        activeCheckpointId: latestCheckpoint.checkpoint.id,
        status: 'in_progress',
        intent: 'Organizar las fuentes y cerrar la sección base del marco teórico.',
      }),
    ]);

    expect((detailTaskResponse.json() as {
      task: { id: string; activeCheckpointId: string | null; priority: number; sortOrder: number };
    }).task).toMatchObject({
      id: createdTask.task.id,
      activeCheckpointId: latestCheckpoint.checkpoint.id,
      priority: 3,
      sortOrder: 10,
    });

    expect((listCheckpointsResponse.json() as {
      checkpoints: Array<{ id: string; progressPercent: number; blocker: string | null }>;
    }).checkpoints).toEqual([
      expect.objectContaining({
        id: latestCheckpoint.checkpoint.id,
        progressPercent: 80,
        blocker: 'Pendiente de comentarios del tutor',
      }),
      expect.objectContaining({
        progressPercent: 35,
        blocker: null,
      }),
    ]);

    expect((resumeResponse.json() as {
      resume: {
        activeTask: { id: string; activeCheckpointId: string | null; status: string } | null;
        recentTaskCheckpoints: Array<{ id: string; taskId: string; progressPercent: number; blocker: string | null }>;
      };
    }).resume).toMatchObject({
      activeTask: {
        id: createdTask.task.id,
        activeCheckpointId: latestCheckpoint.checkpoint.id,
        status: 'in_progress',
      },
      recentTaskCheckpoints: [
        {
          id: latestCheckpoint.checkpoint.id,
          taskId: createdTask.task.id,
          progressPercent: 80,
          blocker: 'Pendiente de comentarios del tutor',
        },
        {
          taskId: createdTask.task.id,
          progressPercent: 35,
          blocker: null,
        },
      ],
    });
  });

  it('fails safely for unknown workflow task detail and checkpoint routes', async () => {
    const thesisResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis sin tareas conocidas',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-unknown-task',
      },
    });

    const thesisId = (thesisResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks/missing-task`,
    });
    const checkpointListResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/tasks/missing-task/checkpoints`,
    });
    const checkpointCreateResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/tasks/missing-task/checkpoints`,
      payload: {
        label: 'Intento inválido',
        summary: 'No debería crear un checkpoint para una tarea inexistente.',
      },
    });

    for (const response of [detailResponse, checkpointListResponse, checkpointCreateResponse]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        ok: false,
        code: 'WORKFLOW_TASK_NOT_FOUND',
        message: `Workflow task missing-task was not found for thesis ${thesisId}.`,
        thesisId,
        taskId: 'missing-task',
      });
    }
  });

  it('creates claims, links and unlinks evidence, exposes traceability, and keeps zero-evidence state explicit', async () => {
    const thesisResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis de claims',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-claims',
      },
    });

    const thesisId = (thesisResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Traceability Source',
        authors: ['Ana Investigadora'],
      },
    });

    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const evidenceAResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 10',
        snippet: 'La fuente respalda la afirmación principal.',
        extractionMethod: 'manual',
      },
    });
    const evidenceBResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 11',
        snippet: 'La segunda evidencia añade contexto verificable.',
        extractionMethod: 'manual',
      },
    });

    const evidenceAId = (evidenceAResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;
    const evidenceBId = (evidenceBResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims`,
      payload: {
        text: 'La argumentación del marco teórico está respaldada por evidencia trazable.',
        status: 'draft',
        supportSummary: 'Pendiente de enlazar evidencia',
      },
    });

    expect(claimResponse.statusCode).toBe(201);
    const createdClaim = claimResponse.json() as {
      claim: {
        id: string;
        supportSummary: string;
        linkedEvidenceCount: number;
        linkedEvidenceIds: string[];
        hasEvidence: boolean;
        traceability: { evidenceFragments: unknown[]; sourceIds: string[] };
      };
    };

    expect(createdClaim.claim.linkedEvidenceCount).toBe(0);
    expect(createdClaim.claim.linkedEvidenceIds).toEqual([]);
    expect(createdClaim.claim.hasEvidence).toBe(false);
    expect(createdClaim.claim.traceability.evidenceFragments).toEqual([]);
    expect(createdClaim.claim.traceability.sourceIds).toEqual([]);
    expect(createdClaim.claim.supportSummary).toBe('Pendiente de enlazar evidencia');

    const linkResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims/${createdClaim.claim.id}/evidence-links`,
      payload: {
        evidenceFragmentIds: [evidenceAId, evidenceBId],
        rationale: 'Ambos fragmentos sustentan la afirmación y su procedencia.',
      },
    });

    expect(linkResponse.statusCode).toBe(200);
    const linkedClaim = linkResponse.json() as {
      claim: {
        supportSummary: string;
        linkedEvidenceCount: number;
        linkedEvidenceIds: string[];
        hasEvidence: boolean;
        traceability: {
          evidenceFragments: Array<{ id: string; rationale: string; source: { id: string; title: string } }>;
          sourceIds: string[];
        };
      };
    };

    expect(linkedClaim.claim.linkedEvidenceCount).toBe(2);
    expect(linkedClaim.claim.linkedEvidenceIds).toEqual([evidenceAId, evidenceBId]);
    expect(linkedClaim.claim.hasEvidence).toBe(true);
    expect(linkedClaim.claim.supportSummary).toBe('Pendiente de enlazar evidencia');
    expect(linkedClaim.claim.traceability.evidenceFragments).toEqual([
      expect.objectContaining({
        id: evidenceAId,
        rationale: 'Ambos fragmentos sustentan la afirmación y su procedencia.',
        source: expect.objectContaining({ id: sourceId, title: 'Traceability Source' }),
      }),
      expect.objectContaining({
        id: evidenceBId,
        rationale: 'Ambos fragmentos sustentan la afirmación y su procedencia.',
        source: expect.objectContaining({ id: sourceId, title: 'Traceability Source' }),
      }),
    ]);
    expect(linkedClaim.claim.traceability.sourceIds).toEqual([sourceId]);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/claims/${createdClaim.claim.id}`,
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/claims`,
    });
    const sourceDetailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/sources/${sourceId}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(sourceDetailResponse.statusCode).toBe(200);

    const claimDetail = detailResponse.json() as { claim: { traceability: { evidenceFragments: Array<{ id: string }> } } };
    const claimList = listResponse.json() as { claims: Array<{ id: string; linkedEvidenceCount: number }> };
    const sourceDetail = sourceDetailResponse.json() as { source: { evidenceCount: number; claimCount: number } };

    expect(claimDetail.claim.traceability.evidenceFragments.map((fragment) => fragment.id)).toEqual([evidenceAId, evidenceBId]);
    expect(claimList.claims).toEqual([
      expect.objectContaining({ id: createdClaim.claim.id, linkedEvidenceCount: 2 }),
    ]);
    expect(sourceDetail.source.evidenceCount).toBe(2);
    expect(sourceDetail.source.claimCount).toBe(1);

    const unlinkResponse = await app.inject({
      method: 'DELETE',
      url: `/theses/${thesisId}/claims/${createdClaim.claim.id}/evidence-links/${evidenceAId}`,
    });
    const evidenceDetailAfterUnlink = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/evidence-fragments/${evidenceAId}`,
    });

    expect(unlinkResponse.statusCode).toBe(200);
    expect(evidenceDetailAfterUnlink.statusCode).toBe(200);

    const unlinkedClaim = unlinkResponse.json() as {
      claim: { supportSummary: string; linkedEvidenceIds: string[]; linkedEvidenceCount: number; hasEvidence: boolean };
    };
    expect(unlinkedClaim.claim.linkedEvidenceIds).toEqual([evidenceBId]);
    expect(unlinkedClaim.claim.linkedEvidenceCount).toBe(1);
    expect(unlinkedClaim.claim.hasEvidence).toBe(true);
    expect(unlinkedClaim.claim.supportSummary).toBe('Pendiente de enlazar evidencia');

    const secondUnlinkResponse = await app.inject({
      method: 'DELETE',
      url: `/theses/${thesisId}/claims/${createdClaim.claim.id}/evidence-links/${evidenceAId}`,
    });

    expect(secondUnlinkResponse.statusCode).toBe(404);
    expect(secondUnlinkResponse.json()).toEqual({
      ok: false,
      code: 'CLAIM_EVIDENCE_LINK_NOT_FOUND',
      message: `Claim ${createdClaim.claim.id} is not linked to evidence fragment ${evidenceAId} for thesis ${thesisId}.`,
      thesisId,
      claimId: createdClaim.claim.id,
      evidenceFragmentId: evidenceAId,
    });

    const claimDetailAfterMissingUnlink = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/claims/${createdClaim.claim.id}`,
    });

    expect(claimDetailAfterMissingUnlink.statusCode).toBe(200);
    expect((claimDetailAfterMissingUnlink.json() as {
      claim: { linkedEvidenceIds: string[]; linkedEvidenceCount: number; hasEvidence: boolean };
    }).claim).toMatchObject({
      linkedEvidenceIds: [evidenceBId],
      linkedEvidenceCount: 1,
      hasEvidence: true,
    });
  });

  it('keeps linked evidence ordering stable across repeated reads and unlinks when links share the same timestamp', async () => {
    const thesisResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis de orden estable de evidencia',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-claims-stable-order',
      },
    });

    const thesisId = (thesisResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Stable Ordering Source',
        authors: ['Lucía Orden'],
      },
    });

    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const firstEvidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 21',
        snippet: 'Primer fragmento enlazado.',
        extractionMethod: 'manual',
      },
    });
    const secondEvidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 22',
        snippet: 'Segundo fragmento enlazado.',
        extractionMethod: 'manual',
      },
    });
    const thirdEvidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        locator: 'p. 23',
        snippet: 'Tercer fragmento enlazado.',
        extractionMethod: 'manual',
      },
    });

    const firstEvidenceId = (firstEvidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;
    const secondEvidenceId = (secondEvidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;
    const thirdEvidenceId = (thirdEvidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims`,
      payload: {
        text: 'La evidencia enlazada debe mantener un orden estable.',
        status: 'draft',
        supportSummary: 'Resumen redactado por la persona usuaria',
      },
    });

    const claimId = (claimResponse.json() as { claim: { id: string } }).claim.id;

    const linkResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims/${claimId}/evidence-links`,
      payload: {
        evidenceFragmentIds: [thirdEvidenceId, firstEvidenceId, secondEvidenceId],
        rationale: 'El orden del request debe preservarse.',
      },
    });

    expect(linkResponse.statusCode).toBe(200);
    expect((linkResponse.json() as { claim: { linkedEvidenceIds: string[]; traceability: { evidenceFragments: Array<{ id: string }> } } }).claim).toMatchObject({
      linkedEvidenceIds: [thirdEvidenceId, firstEvidenceId, secondEvidenceId],
      supportSummary: 'Resumen redactado por la persona usuaria',
      traceability: {
        evidenceFragments: [
          expect.objectContaining({ id: thirdEvidenceId }),
          expect.objectContaining({ id: firstEvidenceId }),
          expect.objectContaining({ id: secondEvidenceId }),
        ],
      },
    });

    for (let index = 0; index < 3; index += 1) {
      const detailResponse = await app.inject({
        method: 'GET',
        url: `/theses/${thesisId}/claims/${claimId}`,
      });
      const listResponse = await app.inject({
        method: 'GET',
        url: `/theses/${thesisId}/claims`,
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(listResponse.statusCode).toBe(200);

      const detailClaim = detailResponse.json() as {
        claim: { linkedEvidenceIds: string[]; traceability: { evidenceFragments: Array<{ id: string }> } };
      };
      const listClaims = listResponse.json() as {
        claims: Array<{ id: string; linkedEvidenceIds: string[]; traceability: { evidenceFragments: Array<{ id: string }> } }>;
      };

      expect(detailClaim.claim.linkedEvidenceIds).toEqual([thirdEvidenceId, firstEvidenceId, secondEvidenceId]);
      expect((detailClaim.claim as { supportSummary?: string }).supportSummary).toBe('Resumen redactado por la persona usuaria');
      expect(detailClaim.claim.traceability.evidenceFragments.map((fragment) => fragment.id)).toEqual([
        thirdEvidenceId,
        firstEvidenceId,
        secondEvidenceId,
      ]);
      expect(listClaims.claims).toContainEqual(
        expect.objectContaining({
          id: claimId,
          supportSummary: 'Resumen redactado por la persona usuaria',
          linkedEvidenceIds: [thirdEvidenceId, firstEvidenceId, secondEvidenceId],
          traceability: expect.objectContaining({
            evidenceFragments: [
              expect.objectContaining({ id: thirdEvidenceId }),
              expect.objectContaining({ id: firstEvidenceId }),
              expect.objectContaining({ id: secondEvidenceId }),
            ],
          }),
        }),
      );
    }

    const unlinkResponse = await app.inject({
      method: 'DELETE',
      url: `/theses/${thesisId}/claims/${claimId}/evidence-links/${firstEvidenceId}`,
    });

    expect(unlinkResponse.statusCode).toBe(200);
    expect((unlinkResponse.json() as { claim: { linkedEvidenceIds: string[]; traceability: { evidenceFragments: Array<{ id: string }> } } }).claim).toMatchObject({
      linkedEvidenceIds: [thirdEvidenceId, secondEvidenceId],
      supportSummary: 'Resumen redactado por la persona usuaria',
      traceability: {
        evidenceFragments: [
          expect.objectContaining({ id: thirdEvidenceId }),
          expect.objectContaining({ id: secondEvidenceId }),
        ],
      },
    });

    const detailAfterUnlink = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/claims/${claimId}`,
    });

    expect(detailAfterUnlink.statusCode).toBe(200);
    expect((detailAfterUnlink.json() as { claim: { linkedEvidenceIds: string[]; traceability: { evidenceFragments: Array<{ id: string }> } } }).claim).toMatchObject({
      linkedEvidenceIds: [thirdEvidenceId, secondEvidenceId],
      supportSummary: 'Resumen redactado por la persona usuaria',
      traceability: {
        evidenceFragments: [
          expect.objectContaining({ id: thirdEvidenceId }),
          expect.objectContaining({ id: secondEvidenceId }),
        ],
      },
    });
  });

  it('rejects cross-thesis claim-evidence links explicitly', async () => {
    const thesisAResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis A claims',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-a-claims',
      },
    });
    const thesisBResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis B claims',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-b-claims',
      },
    });

    const thesisAId = (thesisAResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;
    const thesisBId = (thesisBResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisBId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Cross Thesis Evidence',
      },
    });
    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const evidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisBId}/evidence-fragments`,
      payload: {
        sourceId,
        snippet: 'Solo pertenece a la tesis B.',
        extractionMethod: 'manual',
      },
    });
    const evidenceId = (evidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/claims`,
      payload: {
        text: 'Claim de la tesis A',
      },
    });
    const claimId = (claimResponse.json() as { claim: { id: string } }).claim.id;

    const linkResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisAId}/claims/${claimId}/evidence-links`,
      payload: {
        evidenceFragmentIds: [evidenceId],
        rationale: 'No debería permitirse.',
      },
    });

    expect(linkResponse.statusCode).toBe(409);
    expect(linkResponse.json()).toEqual({
      ok: false,
      code: 'CLAIM_EVIDENCE_SCOPE_ERROR',
      message: `Evidence fragment ${evidenceId} is not available for thesis ${thesisAId}.`,
      thesisId: thesisAId,
    });

    const claimDetail = await app.inject({
      method: 'GET',
      url: `/theses/${thesisAId}/claims/${claimId}`,
    });
    expect(claimDetail.statusCode).toBe(200);
    expect((claimDetail.json() as { claim: { linkedEvidenceCount: number; linkedEvidenceIds: string[] } }).claim).toEqual(
      expect.objectContaining({ linkedEvidenceCount: 0, linkedEvidenceIds: [] }),
    );
  });

  it('loads one active policy profile and persists deterministic compliance runs with rule-level dispositions and stable issue IDs', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-compliance-violation-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      String.raw`\documentclass{report}
\begin{document}
\chapter{Introducción}
Contexto general.

\chapter{Metodología}
Descripción del método.

\end{document}
`,
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis con incumplimientos de política',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: latexDir,
      },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const profileResponse = await app.inject({
      method: 'GET',
      url: '/policy-profiles/active',
    });

    expect(profileResponse.statusCode).toBe(200);
    const profilePayload = profileResponse.json() as {
      ok: boolean;
      policyProfile: {
        id: string;
        institutionId: string;
        institution: string;
        faculty: string;
        version: string;
        requiredSections: string[];
        rules: Array<{ id: string; disposition: string; title: string }>;
      };
    };

    expect(profilePayload.ok).toBe(true);
    expect(profilePayload.policyProfile).toMatchObject({
      institutionId: 'universidad-demo::ingenieria',
      institution: 'Universidad Demo',
      faculty: 'Ingeniería',
      version: '2026.1',
    });
    expect(profilePayload.policyProfile.requiredSections).toEqual([
      'Introducción',
      'Metodología',
      'Resultados',
      'Conclusiones',
    ]);
    expect(profilePayload.policyProfile.rules.map((rule) => rule.id)).toEqual([
      'structure.required-introduction',
      'structure.required-methodology',
      'structure.required-results',
      'structure.required-conclusions',
      'metadata.min-section-count',
    ]);

    const runResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/compliance-runs`,
    });

    expect(runResponse.statusCode).toBe(201);
    const runPayload = runResponse.json() as {
      ok: boolean;
      complianceRun: {
        id: string;
        thesisId: string;
        policyProfileId: string;
        policyProfileVersion: string;
        status: string;
        counts: {
          evaluated: number;
          warnings: number;
          skipped: number;
          violations: number;
        };
        ruleResults: Array<{
          ruleId: string;
          disposition: 'pass' | 'violation' | 'warning' | 'skipped';
          issueId: string | null;
          severity: string | null;
        }>;
        issues: Array<{
          id: string;
          ruleId: string;
          policyProfileId: string;
          normalizedNodeId: string | null;
          severity: string;
          remediation: string | null;
        }>;
      };
    };

    expect(runPayload.ok).toBe(true);
    expect(runPayload.complianceRun.thesisId).toBe(thesisId);
    expect(runPayload.complianceRun.policyProfileId).toBe(profilePayload.policyProfile.id);
    expect(runPayload.complianceRun.policyProfileVersion).toBe('2026.1');
    expect(runPayload.complianceRun.status).toBe('completed');
    expect(runPayload.complianceRun.counts).toEqual({
      evaluated: 5,
      warnings: 0,
      skipped: 0,
      violations: 2,
    });
    expect(runPayload.complianceRun.ruleResults).toEqual([
      expect.objectContaining({ ruleId: 'structure.required-introduction', disposition: 'pass', issueId: null }),
      expect.objectContaining({ ruleId: 'structure.required-methodology', disposition: 'pass', issueId: null }),
      expect.objectContaining({ ruleId: 'structure.required-results', disposition: 'violation', severity: 'violation' }),
      expect.objectContaining({ ruleId: 'structure.required-conclusions', disposition: 'violation', severity: 'violation' }),
      expect.objectContaining({ ruleId: 'metadata.min-section-count', disposition: 'pass', issueId: null }),
    ]);
    expect(runPayload.complianceRun.issues).toHaveLength(2);
    expect(runPayload.complianceRun.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyProfileId: profilePayload.policyProfile.id,
          ruleId: 'structure.required-results',
          severity: 'violation',
        }),
        expect.objectContaining({
          policyProfileId: profilePayload.policyProfile.id,
          ruleId: 'structure.required-conclusions',
          severity: 'violation',
        }),
      ]),
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/compliance-runs`,
    });

    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as {
      complianceRuns: Array<{
        id: string;
        counts: { evaluated: number; warnings: number; skipped: number; violations: number };
        issues: Array<{ id: string }>;
      }>;
    };

    expect(listPayload.complianceRuns).toHaveLength(1);
    expect(listPayload.complianceRuns[0]?.id).toBe(runPayload.complianceRun.id);
    expect(listPayload.complianceRuns[0]?.counts.violations).toBe(2);
    expect(listPayload.complianceRuns[0]?.issues.map((issue) => issue.id)).toEqual(
      runPayload.complianceRun.issues.map((issue) => issue.id),
    );

    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('downgrades structure-dependent rules to warnings and skips metadata rules when structure confidence is low', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-compliance-warning-'));
    const pdfPath = path.join(fixtureRoot, 'outline.pdf');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    fs.writeFileSync(
      pdfPath,
      Buffer.from('%PDF-1.4\ntexto sin encabezados claros\n%%EOF', 'utf8'),
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis con estructura degradada',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const intakeResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/intake-jobs`,
      payload: {
        importRootPath: pdfPath,
      },
    });

    expect(intakeResponse.statusCode).toBe(201);

    const runResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/compliance-runs`,
    });

    expect(runResponse.statusCode).toBe(201);
    const payload = runResponse.json() as {
      complianceRun: {
        status: string;
        summary: {
          degradedConfidence: boolean;
          warnings: string[];
        };
        counts: {
          evaluated: number;
          warnings: number;
          skipped: number;
          violations: number;
        };
        ruleResults: Array<{
          ruleId: string;
          disposition: 'pass' | 'violation' | 'warning' | 'skipped';
          issueId: string | null;
        }>;
        issues: Array<{
          id: string;
          ruleId: string;
          severity: string;
          disposition: string;
        }>;
      };
    };

    expect(payload.complianceRun.status).toBe('completed_with_warnings');
    expect(payload.complianceRun.summary.degradedConfidence).toBe(true);
    expect(payload.complianceRun.summary.warnings[0]).toMatch(/confianza de estructura/i);
    expect(payload.complianceRun.counts).toEqual({
      evaluated: 4,
      warnings: 4,
      skipped: 1,
      violations: 0,
    });
    expect(payload.complianceRun.ruleResults).toEqual([
      expect.objectContaining({ ruleId: 'structure.required-introduction', disposition: 'warning' }),
      expect.objectContaining({ ruleId: 'structure.required-methodology', disposition: 'warning' }),
      expect.objectContaining({ ruleId: 'structure.required-results', disposition: 'warning' }),
      expect.objectContaining({ ruleId: 'structure.required-conclusions', disposition: 'warning' }),
      expect.objectContaining({ ruleId: 'metadata.min-section-count', disposition: 'skipped' }),
    ]);
    expect(payload.complianceRun.issues).toHaveLength(4);
    expect(payload.complianceRun.issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(payload.complianceRun.issues.every((issue) => issue.disposition === 'warning')).toBe(true);

    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('runs academic QA with separate evidence, citation, methodology, and coherence issues plus assessed and skipped scope reporting', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'academic-qa-analysis-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(path.join(latexDir, 'sections'), { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      String.raw`\documentclass{report}
\begin{document}
\chapter{Introducción}
Marco general.

\chapter{Metodología}
\section{Metodología}
Diseño del estudio.

\chapter{Resultados}
\section{Resultados}
Hallazgos principales.
\end{document}
`,
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis con QA académico',
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

    const setupResponse = await app.inject({ method: 'GET', url: `/theses/${thesisId}/evidence-context-setup` });
    expect(setupResponse.statusCode).toBe(200);
    const setup = (setupResponse.json() as {
      setup: {
        normalizedNodes: Array<{ id: string; title: string | null; nodeType: string }>;
      };
    }).setup;
    const methodologyNode = setup.normalizedNodes.find((node) => node.title?.includes('Metodología') && node.nodeType === 'section');
    const resultsNode = setup.normalizedNodes.find((node) => node.title?.includes('Resultados') && node.nodeType === 'section');
    expect(methodologyNode).toBeTruthy();
    expect(resultsNode).toBeTruthy();

    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/sources`,
      payload: {
        sourceType: 'article',
        title: 'Fuente única para claims',
        authors: ['Ana Evidencia'],
        publicationYear: 2024,
      },
    });
    expect(sourceResponse.statusCode).toBe(201);
    const sourceId = (sourceResponse.json() as { source: { id: string } }).source.id;

    const evidenceResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/evidence-fragments`,
      payload: {
        sourceId,
        normalizedNodeId: resultsNode?.id,
        snippet: 'El experimento mostró mejoras del 10%.',
        extractionMethod: 'manual',
        locator: 'p. 12',
      },
    });
    expect(evidenceResponse.statusCode).toBe(201);
    const evidenceId = (evidenceResponse.json() as { evidenceFragment: { id: string } }).evidenceFragment.id;

    const unsupportedClaimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims`,
      payload: {
        text: 'La hipótesis principal está demostrada.',
        normalizedNodeId: methodologyNode?.id,
      },
    });
    expect(unsupportedClaimResponse.statusCode).toBe(201);
    const unsupportedClaimId = (unsupportedClaimResponse.json() as { claim: { id: string } }).claim.id;

    const weakCitationClaimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims`,
      payload: {
        text: 'Los resultados son consistentes con la literatura previa.',
        normalizedNodeId: resultsNode?.id,
      },
    });
    expect(weakCitationClaimResponse.statusCode).toBe(201);
    const weakCitationClaimId = (weakCitationClaimResponse.json() as { claim: { id: string } }).claim.id;

    const skippedClaimResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims`,
      payload: {
        text: 'Claim sin sección enlazada.',
      },
    });
    expect(skippedClaimResponse.statusCode).toBe(201);
    const skippedClaimId = (skippedClaimResponse.json() as { claim: { id: string } }).claim.id;

    const linkResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/claims/${weakCitationClaimId}/evidence-links`,
      payload: {
        evidenceFragmentIds: [evidenceId],
        rationale: 'La evidencia respalda el resultado reportado.',
      },
    });
    expect(linkResponse.statusCode).toBe(200);

    const qaResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/academic-qa-runs`,
    });
    expect(qaResponse.statusCode).toBe(201);

    const qaPayload = qaResponse.json() as {
      ok: boolean;
      academicQaRun: {
        id: string;
        thesisId: string;
        status: string;
        issueCategories: string[];
        assessedScope: {
          claimIds: string[];
          normalizedNodeIds: string[];
          counts: { claims: number; sections: number };
        };
        skippedScope: Array<{ entityType: string; entityId: string; reason: string }>;
        summary: {
          findingsByCategory: Record<string, number>;
          assessedClaimCount: number;
          assessedSectionCount: number;
          skippedCount: number;
        };
        issues: Array<{
          id: string;
          category: string;
          claimId: string | null;
          normalizedNodeId: string | null;
          triggeringCondition: string;
          rationale: string;
          remediation: string | null;
          groundedIn: { entityType: string; entityId: string };
        }>;
      };
    };

    expect(qaPayload.ok).toBe(true);
    expect(qaPayload.academicQaRun.thesisId).toBe(thesisId);
    expect(qaPayload.academicQaRun.status).toBe('completed');
    expect(qaPayload.academicQaRun.issueCategories).toEqual([
      'citation-weakness',
      'coherence',
      'evidence-gap',
      'methodology',
    ]);
    expect(qaPayload.academicQaRun.assessedScope.claimIds).toEqual(expect.arrayContaining([unsupportedClaimId, weakCitationClaimId]));
    expect(qaPayload.academicQaRun.assessedScope.normalizedNodeIds).toEqual(expect.arrayContaining([methodologyNode!.id, resultsNode!.id]));
    expect(qaPayload.academicQaRun.skippedScope).toEqual([
      expect.objectContaining({ entityType: 'claim', entityId: skippedClaimId, reason: 'Claim is not linked to a thesis section.' }),
    ]);
    expect(qaPayload.academicQaRun.summary).toEqual({
      findingsByCategory: {
        'evidence-gap': 1,
        'citation-weakness': 1,
        methodology: 1,
        coherence: 1,
      },
      assessedClaimCount: 2,
      assessedSectionCount: expect.any(Number),
      skippedCount: 1,
    });
    expect(qaPayload.academicQaRun.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'evidence-gap',
        claimId: unsupportedClaimId,
        normalizedNodeId: methodologyNode!.id,
        triggeringCondition: 'zero-evidence',
        groundedIn: { entityType: 'claim', entityId: unsupportedClaimId },
      }),
      expect.objectContaining({
        category: 'citation-weakness',
        claimId: weakCitationClaimId,
        normalizedNodeId: resultsNode!.id,
        triggeringCondition: 'weak-citation-support',
        groundedIn: { entityType: 'claim', entityId: weakCitationClaimId },
      }),
      expect.objectContaining({
        category: 'methodology',
        claimId: null,
        normalizedNodeId: methodologyNode!.id,
        triggeringCondition: 'methodology-no-support',
        rationale: expect.stringMatching(/metodolog/i),
        remediation: expect.stringMatching(/evidencia/i),
        groundedIn: { entityType: 'section', entityId: methodologyNode!.id },
      }),
      expect.objectContaining({
        category: 'coherence',
        claimId: null,
        normalizedNodeId: resultsNode!.id,
        triggeringCondition: 'missing-bibliography-linkage',
        rationale: expect.stringMatching(/coherencia|marco/i),
        remediation: expect.stringMatching(/Zotero|evidencia/i),
        groundedIn: { entityType: 'section', entityId: resultsNode!.id },
      }),
    ]));

    const qaListResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/academic-qa-runs`,
    });
    expect(qaListResponse.statusCode).toBe(200);
    const qaListPayload = qaListResponse.json() as {
      academicQaRuns: Array<{
        id: string;
        issueCategories: string[];
        skippedScope: Array<{ entityId: string }>;
        issues: Array<{ category: string; groundedIn: { entityId: string } }>;
      }>;
    };
    expect(qaListPayload.academicQaRuns).toHaveLength(1);
    expect(qaListPayload.academicQaRuns[0]).toEqual(expect.objectContaining({
      id: qaPayload.academicQaRun.id,
      issueCategories: qaPayload.academicQaRun.issueCategories,
    }));
    expect(qaListPayload.academicQaRuns[0]?.skippedScope).toEqual([
      expect.objectContaining({ entityId: skippedClaimId }),
    ]);

    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

  it('edits only the requested LaTeX section, creates a checkpoint first, rejects stale targets safely, and restores snapshots byte-for-byte', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-edit-restore-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(path.join(latexDir, 'sections'), { recursive: true });
    const mainTex = path.join(latexDir, 'main.tex');
    const introTex = path.join(latexDir, 'sections', 'intro.tex');

    fs.writeFileSync(
      mainTex,
      String.raw`\documentclass{report}
\begin{document}
\chapter{Main Chapter}
\input{sections/intro}
\section{Evaluation}
Original evaluation body.
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(
      introTex,
      String.raw`\section{Introduction}
Original intro body.
\subsection{Context}
Original context body.
`,
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis latex editable',
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
        id: string;
        report: {
          structureSummary: {
            outline: Array<{
              id: string;
              title: string | null;
              nodeType: string;
              sourcePath: string | null;
              anchor: { start: string | null; end: string | null };
            }>;
          } | null;
        } | null;
      };
    };

    const introSection = intakePayload.intakeJob.report?.structureSummary?.outline.find((node) => node.title === 'Introduction');
    expect(introSection).toBeTruthy();

    const introBeforeHash = createHash('sha256').update(fs.readFileSync(introTex, 'utf8')).digest('hex');
    const mainBeforeHash = createHash('sha256').update(fs.readFileSync(mainTex, 'utf8')).digest('hex');

    const editResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/latex/edits`,
      payload: {
        target: {
          normalizedNodeId: introSection?.id,
          sourcePath: introSection?.sourcePath,
          title: introSection?.title,
          nodeType: introSection?.nodeType,
          anchorStart: introSection?.anchor.start,
          anchorEnd: introSection?.anchor.end,
        },
        replacement: String.raw`\section{Introduction}
Updated intro body.
`,
        createdBy: 'user:test',
      },
    });

    expect(editResponse.statusCode).toBe(201);
    const editPayload = editResponse.json() as {
      edit: {
        checkpoint: { id: string; reason: string; snapshotPath: string | null };
        changedFiles: Array<{
          path: string;
          changedRange: { startLine: number; endLine: number };
          unchangedContext: { before: boolean; after: boolean };
          sha256Before: string;
          sha256After: string;
        }>;
        structure: { outline: Array<{ title: string | null; anchor: { start: string | null; end: string | null } }> };
      };
    };

    expect(editPayload.edit.checkpoint.reason).toBe('before-latex-edit');
    expect(editPayload.edit.checkpoint.snapshotPath).toEqual(expect.any(String));
    expect(editPayload.edit.changedFiles).toEqual([
      expect.objectContaining({
        path: 'sections/intro.tex',
        changedRange: { startLine: 1, endLine: 3 },
        unchangedContext: { before: true, after: true },
        sha256Before: introBeforeHash,
      }),
    ]);

    const introAfterEdit = fs.readFileSync(introTex, 'utf8');
    const mainAfterEditHash = createHash('sha256').update(fs.readFileSync(mainTex, 'utf8')).digest('hex');
    expect(introAfterEdit).toContain('Updated intro body.');
    expect(introAfterEdit).toContain('Original context body.');
    expect(mainAfterEditHash).toBe(mainBeforeHash);

    const refreshedJobResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${intakePayload.intakeJob.id}`,
    });
    expect(refreshedJobResponse.statusCode).toBe(200);
    const refreshedJob = refreshedJobResponse.json() as {
      intakeJob: {
        report: {
          structureSummary: {
            outline: Array<{
              id: string;
              title: string | null;
              nodeType: string;
              sourcePath: string | null;
              anchor: { start: string | null; end: string | null };
            }>;
          } | null;
        } | null;
      };
    };
    const refreshedIntroSection = refreshedJob.intakeJob.report?.structureSummary?.outline.find((node) => node.title === 'Introduction');
    expect(refreshedIntroSection).toBeTruthy();

    const staleEditResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/latex/edits`,
      payload: {
        target: {
          normalizedNodeId: refreshedIntroSection?.id,
          sourcePath: refreshedIntroSection?.sourcePath,
          title: refreshedIntroSection?.title,
          nodeType: refreshedIntroSection?.nodeType,
          anchorStart: '999',
          anchorEnd: refreshedIntroSection?.anchor.end,
        },
        replacement: String.raw`\section{Introduction}
This stale edit must fail.
`,
        createdBy: 'user:test',
      },
    });

    expect(staleEditResponse.statusCode).toBe(409);
    const stalePayload = staleEditResponse.json() as {
      code: string;
      reasons: string[];
      structure: { outline: Array<{ title: string | null; anchor: { start: string | null; end: string | null } }> };
    };
    expect(stalePayload.code).toBe('LATEX_EDIT_TARGET_CONFLICT');
    expect(stalePayload.reasons).toContain('The requested LaTeX edit target anchors are stale for the current structure.');
    expect(createHash('sha256').update(fs.readFileSync(introTex, 'utf8')).digest('hex')).toBe(
      createHash('sha256').update(introAfterEdit).digest('hex'),
    );
    expect(createHash('sha256').update(fs.readFileSync(mainTex, 'utf8')).digest('hex')).toBe(mainBeforeHash);

    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/latex/checkpoints/${editPayload.edit.checkpoint.id}/restore`,
    });

    expect(restoreResponse.statusCode).toBe(200);
    const restorePayload = restoreResponse.json() as {
      restore: {
        restoredFiles: Array<{ path: string; sha256Before: string; sha256After: string }>;
      };
    };
    expect(restorePayload.restore.restoredFiles).toEqual([
      expect.objectContaining({
        path: 'sections/intro.tex',
        sha256Before: editPayload.edit.changedFiles[0]?.sha256After,
        sha256After: introBeforeHash,
      }),
    ]);
    expect(fs.readFileSync(introTex, 'utf8')).toBe(String.raw`\section{Introduction}
Original intro body.
\subsection{Context}
Original context body.
`);
    expect(createHash('sha256').update(fs.readFileSync(mainTex, 'utf8')).digest('hex')).toBe(mainBeforeHash);
  });

  it('runs LaTeX builds with bibliography diagnostics, preserves the last successful artifact, and exposes build history', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-build-history-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(latexDir, { recursive: true });

    const mainTex = path.join(latexDir, 'main.tex');
    const refsBib = path.join(latexDir, 'refs.bib');

    fs.writeFileSync(
      mainTex,
      String.raw`\documentclass{report}
\begin{document}
\chapter{Main Chapter}
\cite{demo}
\bibliography{refs}
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(refsBib, '@book{demo,title={Demo},author={Autor},year={2024}}\n', 'utf8');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis build latex',
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

    const firstBuildResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/latex/builds`,
      payload: { createdBy: 'user:test' },
    });

    expect(firstBuildResponse.statusCode).toBe(201);
    const firstBuildPayload = firstBuildResponse.json() as {
      build: {
        buildRun: {
          id: string;
          status: string;
          artifactPath: string | null;
          retainedArtifactPath: string | null;
          bibliographyStatus: string;
          bibliography: { mode: string; status: string; inputs: string[]; missingInputs: string[]; commands: string[] };
          diagnosticsSummary: { errorCount: number; warningCount: number; infoCount: number };
          checkpointId: string | null;
        };
        history: {
          latestAttempted: { id: string };
          latestSuccessful: { id: string; artifactPath: string | null } | null;
          runs: Array<{ id: string }>;
        };
      };
    };

    expect(['completed', 'completed_with_warnings', 'failed']).toContain(firstBuildPayload.build.buildRun.status);
    expect(firstBuildPayload.build.buildRun.bibliographyStatus).toBe('ready');
    expect(firstBuildPayload.build.buildRun.bibliography).toMatchObject({
      mode: 'bibliography',
      status: 'ready',
      inputs: ['refs.bib'],
      missingInputs: [],
      commands: ['bibtex'],
    });
    expect(firstBuildPayload.build.buildRun.checkpointId).toEqual(expect.any(String));
    expect([null, expect.any(String)]).toContainEqual(firstBuildPayload.build.buildRun.artifactPath);
    expect(firstBuildPayload.build.buildRun.retainedArtifactPath).toBe(firstBuildPayload.build.buildRun.artifactPath);
    expect(firstBuildPayload.build.buildRun.diagnosticsSummary.warningCount).toBe(0);
    expect(firstBuildPayload.build.buildRun.diagnosticsSummary.infoCount).toBeGreaterThanOrEqual(1);
    if (firstBuildPayload.build.buildRun.artifactPath) {
      expect(fs.existsSync(firstBuildPayload.build.buildRun.artifactPath)).toBe(true);
    }
    const successfulArtifactPath = firstBuildPayload.build.buildRun.artifactPath;
    if (successfulArtifactPath) {
      expect(firstBuildPayload.build.history.latestSuccessful?.id).toBe(firstBuildPayload.build.buildRun.id);
    }

    fs.unlinkSync(refsBib);

    const failingBuildResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/latex/builds`,
      payload: { createdBy: 'user:test' },
    });

    expect(failingBuildResponse.statusCode).toBe(201);
    const failingBuildPayload = failingBuildResponse.json() as {
      build: {
        buildRun: {
          id: string;
          status: string;
          artifactPath: string | null;
          retainedArtifactPath: string | null;
          bibliographyStatus: string;
          bibliography: { mode: string; status: string; missingInputs: string[] };
          diagnostics: Array<{ category: string; severity: string; filePath: string | null; line: number | null; mappingStatus: string; message: string }>;
          logPath: string | null;
        };
        history: {
          latestAttempted: { id: string; status: string };
          latestSuccessful: { id: string; artifactPath: string | null; retainedArtifactPath: string | null } | null;
          runs: Array<{ id: string; status: string }>;
        };
      };
    };

    expect(failingBuildPayload.build.buildRun.status).toBe('failed');
    expect(failingBuildPayload.build.buildRun.artifactPath).toBeNull();
    expect(failingBuildPayload.build.buildRun.retainedArtifactPath).toBe(successfulArtifactPath ?? null);
    expect(failingBuildPayload.build.buildRun.bibliographyStatus).toBe('missing_inputs');
    expect(failingBuildPayload.build.buildRun.bibliography).toMatchObject({
      mode: 'bibliography',
      status: 'missing_inputs',
      missingInputs: ['refs.bib'],
    });
    expect(failingBuildPayload.build.buildRun.diagnostics).toContainEqual(
      expect.objectContaining({
        category: 'bibliography',
        severity: 'error',
        filePath: 'main.tex',
        line: 5,
        mappingStatus: 'mapped',
      }),
    );
    expect(failingBuildPayload.build.history.latestAttempted.id).toBe(failingBuildPayload.build.buildRun.id);
    if (successfulArtifactPath) {
      expect(failingBuildPayload.build.history.latestSuccessful?.id).toBe(firstBuildPayload.build.buildRun.id);
      expect(failingBuildPayload.build.history.latestSuccessful?.artifactPath).toBe(successfulArtifactPath);
    } else {
      expect(failingBuildPayload.build.history.latestSuccessful).toBeNull();
    }
    expect(failingBuildPayload.build.history.runs.map((run) => run.id)).toEqual([
      failingBuildPayload.build.buildRun.id,
      firstBuildPayload.build.buildRun.id,
    ]);
    expect(fs.readFileSync(failingBuildPayload.build.buildRun.logPath as string, 'utf8')).toContain('Missing bibliography file refs.bib');

    const historyResponse = await app.inject({ method: 'GET', url: `/theses/${thesisId}/latex/builds` });
    expect(historyResponse.statusCode).toBe(200);
    const historyPayload = historyResponse.json() as {
      history: {
        latestAttempted: { id: string; status: string } | null;
        latestSuccessful: { id: string; retainedArtifactPath: string | null } | null;
        runs: Array<{ id: string; status: string; retainedArtifactPath: string | null }>;
      };
    };
    expect(historyPayload.history.latestAttempted).toMatchObject({ id: failingBuildPayload.build.buildRun.id, status: 'failed' });
    if (successfulArtifactPath) {
      expect(historyPayload.history.latestSuccessful).toMatchObject({ id: firstBuildPayload.build.buildRun.id, retainedArtifactPath: successfulArtifactPath });
    } else {
      expect(historyPayload.history.latestSuccessful).toBeNull();
    }
    expect(historyPayload.history.runs).toHaveLength(2);

    const buildDetailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/latex/builds/${failingBuildPayload.build.buildRun.id}`,
    });
    expect(buildDetailResponse.statusCode).toBe(200);
    expect((buildDetailResponse.json() as { buildRun: { id: string; bibliography: { missingInputs: string[] } } }).buildRun).toMatchObject({
      id: failingBuildPayload.build.buildRun.id,
      bibliography: { missingInputs: ['refs.bib'] },
    });
  });

  it('detects biblatex and unsupported bibliography configurations explicitly during LaTeX builds', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-build-bibliography-modes-'));
    const biblatexDir = path.join(fixtureRoot, 'biblatex-project');
    const unsupportedDir = path.join(fixtureRoot, 'unsupported-project');
    fs.mkdirSync(biblatexDir, { recursive: true });
    fs.mkdirSync(unsupportedDir, { recursive: true });

    fs.writeFileSync(
      path.join(biblatexDir, 'main.tex'),
      String.raw`\documentclass{report}
\addbibresource{library.bib}
\begin{document}
\printbibliography
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(path.join(biblatexDir, 'library.bib'), '@book{demo,title={Demo}}\n', 'utf8');

    fs.writeFileSync(
      path.join(unsupportedDir, 'main.tex'),
      String.raw`\documentclass{report}
\bibliographystyle{plain}
\bibliography{refs}
\begin{document}
\printbibliography
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(path.join(unsupportedDir, 'refs.bib'), '@book{demo,title={Demo}}\n', 'utf8');

    const createBiblatex = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis biblatex',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });
    const biblatexThesisId = (createBiblatex.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const createUnsupported = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis unsupported bibliography',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: fixtureRoot,
      },
    });
    const unsupportedThesisId = (createUnsupported.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    await app.inject({ method: 'POST', url: `/theses/${biblatexThesisId}/intake-jobs`, payload: { importRootPath: biblatexDir } });
    await app.inject({ method: 'POST', url: `/theses/${unsupportedThesisId}/intake-jobs`, payload: { importRootPath: unsupportedDir } });

    const biblatexBuild = await app.inject({
      method: 'POST',
      url: `/theses/${biblatexThesisId}/latex/builds`,
      payload: { createdBy: 'user:test' },
    });
    const unsupportedBuild = await app.inject({
      method: 'POST',
      url: `/theses/${unsupportedThesisId}/latex/builds`,
      payload: { createdBy: 'user:test' },
    });

    expect(biblatexBuild.statusCode).toBe(201);
    expect(unsupportedBuild.statusCode).toBe(201);

    expect((biblatexBuild.json() as { build: { buildRun: { status: string; bibliographyStatus: string; bibliography: { mode: string; commands: string[]; status: string }; diagnosticsSummary: { errorCount: number; warningCount: number; infoCount: number } } } }).build.buildRun).toMatchObject({
      bibliographyStatus: 'ready',
      bibliography: { mode: 'biblatex', commands: ['biber'], status: 'ready' },
    });
    const biblatexBuildPayload = biblatexBuild.json() as { build: { buildRun: { status: string; diagnosticsSummary: { errorCount: number; warningCount: number; infoCount: number }; logPath: string | null } } };
    expect(['completed', 'completed_with_warnings', 'failed']).toContain(biblatexBuildPayload.build.buildRun.status);
    expect(biblatexBuildPayload.build.buildRun.diagnosticsSummary.warningCount).toBe(0);
    expect(biblatexBuildPayload.build.buildRun.logPath).toEqual(expect.any(String));

    const unsupportedBuildPayload = (unsupportedBuild.json() as { build: { buildRun: { status: string; bibliographyStatus: string; bibliography: { mode: string; status: string }; diagnostics: Array<{ category: string; message: string }> } } }).build.buildRun;
    expect(unsupportedBuildPayload).toMatchObject({
      status: 'failed',
      bibliographyStatus: 'unsupported',
      bibliography: { mode: 'unsupported', status: 'unsupported' },
    });
    expect(unsupportedBuildPayload.diagnostics).toContainEqual(expect.objectContaining({ category: 'bibliography', message: 'Unsupported bibliography workflow detected; automatic bibliography execution skipped.' }));
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
      String.raw`\documentclass{report}
\begin{document}
\input{sections/intro}
\input{missing-section}
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'intro.tex'),
      String.raw`\chapter{Intro}
\input{loop}
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'loop.tex'),
      String.raw`\section{Loop}
\input{intro}
`,
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
            outline: Array<{ title: string | null; level: number; sourcePath: string | null; anchor: { start: string | null; end: string | null } }>;
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
      expect.objectContaining({ title: 'Intro', level: 1, sourcePath: 'sections/intro.tex', anchor: { start: '1', end: '1' } }),
      expect.objectContaining({ title: 'Loop', level: 2, sourcePath: 'sections/loop.tex', anchor: { start: '1', end: '1' } }),
    ]);
  });

  it('preserves include nesting in the structural outline order and parent-child normalized nodes', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-outline-nesting-'));
    const latexDir = path.join(fixtureRoot, 'latex-project');
    fs.mkdirSync(path.join(latexDir, 'chapters'), { recursive: true });
    fs.mkdirSync(path.join(latexDir, 'sections'), { recursive: true });
    fs.writeFileSync(
      path.join(latexDir, 'main.tex'),
      String.raw`\documentclass{report}
\begin{document}
\chapter{Main Chapter}
\input{sections/background}
\input{chapters/results}
\end{document}
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'sections', 'background.tex'),
      String.raw`\section{Background}
\subsection{Prior Work}
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(latexDir, 'chapters', 'results.tex'),
      String.raw`\chapter{Results}
\section{Evaluation}
`,
      'utf8',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis latex outline',
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
        id: string;
        status: string;
        detectedEntrypoint: string | null;
        report: {
          structureSummary: {
            entrypoint: string | null;
            selection: { mode: string; reason: string; candidates: string[] };
            outline: Array<{ title: string | null; level: number; sourcePath: string | null; anchor: { start: string | null; end: string | null } }>;
          } | null;
        } | null;
      };
    };

    expect(intakePayload.intakeJob.status).toBe('succeeded');
    expect(intakePayload.intakeJob.detectedEntrypoint).toBe('main.tex');
    expect(intakePayload.intakeJob.report?.structureSummary).toMatchObject({
      entrypoint: 'main.tex',
      selection: {
        mode: 'deterministic',
        candidates: ['main.tex'],
      },
    });
    expect(intakePayload.intakeJob.report?.structureSummary?.outline).toEqual([
      expect.objectContaining({ title: 'Main Chapter', level: 1, sourcePath: 'main.tex', anchor: { start: '3', end: '3' } }),
      expect.objectContaining({ title: 'Background', level: 2, sourcePath: 'sections/background.tex', anchor: { start: '1', end: '1' } }),
      expect.objectContaining({ title: 'Prior Work', level: 3, sourcePath: 'sections/background.tex', anchor: { start: '2', end: '2' } }),
      expect.objectContaining({ title: 'Results', level: 1, sourcePath: 'chapters/results.tex', anchor: { start: '1', end: '1' } }),
      expect.objectContaining({ title: 'Evaluation', level: 2, sourcePath: 'chapters/results.tex', anchor: { start: '2', end: '2' } }),
    ]);

    const nodesResponse = await app.inject({
      method: 'GET',
      url: `/theses/${thesisId}/intake-jobs/${intakePayload.intakeJob.id}/nodes`,
    });

    expect(nodesResponse.statusCode).toBe(200);
    const nodes = (nodesResponse.json() as {
      nodes: Array<{ id: string; title: string | null; nodeType: string; parentNodeId: string | null; sourcePath: string | null; sourceStart: string | null; sourceEnd: string | null }>;
    }).nodes;

    const mainChapter = nodes.find((node) => node.title === 'Main Chapter');
    const background = nodes.find((node) => node.title === 'Background');
    const priorWork = nodes.find((node) => node.title === 'Prior Work');
    const results = nodes.find((node) => node.title === 'Results');
    const evaluation = nodes.find((node) => node.title === 'Evaluation');

    expect(mainChapter).toBeDefined();
    expect(background).toMatchObject({ parentNodeId: mainChapter?.id, sourcePath: 'sections/background.tex', sourceStart: '1', sourceEnd: '1' });
    expect(priorWork).toMatchObject({ parentNodeId: background?.id, sourcePath: 'sections/background.tex', sourceStart: '2', sourceEnd: '2' });
    expect(results).toMatchObject({ parentNodeId: expect.any(String), sourcePath: 'chapters/results.tex', sourceStart: '1', sourceEnd: '1' });
    expect(evaluation).toMatchObject({ parentNodeId: results?.id, sourcePath: 'chapters/results.tex', sourceStart: '2', sourceEnd: '2' });
    expect(results?.parentNodeId).not.toBe(mainChapter?.id);
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
