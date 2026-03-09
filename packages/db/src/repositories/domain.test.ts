import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../client.js';
import { checkpoints, policyProfiles, theses } from '../schema.js';
import { createDomainRepositories, createDomainRepositoryRegistry } from './domain.js';

function createTempDatabaseUrl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thesis-db-repos-'));
  return `file:${path.join(dir, 'repositories.sqlite')}`;
}

describe('domain repository boundaries', () => {
  let databaseUrl: string;

  beforeEach(() => {
    databaseUrl = createTempDatabaseUrl();
  });

  it('exposes all persistence repositories expected by downstream features', async () => {
    const connection = createDatabaseConnection(databaseUrl);
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../drizzle/0000_domain_core.sql'),
      'utf8',
    );
    await connection.sqlite.executeMultiple(migrationSql);
    const repositories = createDomainRepositories(connection.db);

    expect(Object.keys(repositories).sort()).toEqual([
      'academicQaIssues',
      'academicQaRuns',
      'buildRuns',
      'checkpoints',
      'claimEvidenceLinks',
      'claims',
      'complianceIssues',
      'complianceRuns',
      'evidenceFragments',
      'feedbackEntries',
      'intakeJobs',
      'normalizedNodes',
      'policyProfiles',
      'sources',
      'theses',
      'thesisStates',
      'workflowPacks',
      'workflowSteps',
      'workflowTaskCheckpoints',
      'workflowTasks',
      'zoteroMappings',
    ]);

    connection.sqlite.close();
  });

  it('provides deterministic persistence helpers and thesis-scoped repository access', async () => {
    const connection = createDatabaseConnection(databaseUrl);
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../drizzle/0000_domain_core.sql'),
      'utf8',
    );
    await connection.sqlite.executeMultiple(migrationSql);
    const registry = createDomainRepositoryRegistry(connection.db);

    const thesisAId = registry.helpers.createId();
    const thesisBId = registry.helpers.createId();
    const sharedTimestamp = registry.helpers.now();

    await connection.db.insert(policyProfiles).values({
      id: registry.helpers.createId(),
      institution: 'Universidad Demo',
      faculty: 'Ingeniería',
      version: '2026.1',
      title: 'Perfil principal',
      requiredSectionsJson: '[]',
      ruleDefinitionsJson: '[]',
      isActive: true,
      createdAt: sharedTimestamp,
      updatedAt: sharedTimestamp,
    });

    await connection.db.insert(theses).values([
      {
        id: thesisAId,
        title: 'Alpha',
        slug: 'alpha',
        degreeProgram: 'MSc Computer Science',
        institution: 'Universidad Demo',
        workspacePath: '/tmp/alpha',
        defaultLanguage: 'es',
        currentState: 'draft',
        latestStatusAt: sharedTimestamp,
        nextStepSummary: 'Start alpha',
        activeImportId: null,
        activeBuildRunId: null,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      },
      {
        id: thesisBId,
        title: 'Beta',
        slug: 'beta',
        degreeProgram: 'MSc Computer Science',
        institution: 'Universidad Demo',
        workspacePath: '/tmp/beta',
        defaultLanguage: 'es',
        currentState: 'draft',
        latestStatusAt: sharedTimestamp,
        nextStepSummary: 'Start beta',
        activeImportId: null,
        activeBuildRunId: null,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      },
    ]);

    await connection.db.insert(checkpoints).values([
      {
        id: 'checkpoint-alpha-newer',
        thesisId: thesisAId,
        label: 'newer',
        note: null,
        scope: 'workspace',
        reason: 'newest first tie-break',
        snapshotPath: null,
        createdBy: 'test',
        checkpointedAt: '2026-03-09T10:00:00.000Z',
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
      {
        id: 'checkpoint-alpha-older',
        thesisId: thesisAId,
        label: 'older',
        note: null,
        scope: 'workspace',
        reason: 'newest first tie-break',
        snapshotPath: null,
        createdBy: 'test',
        checkpointedAt: '2026-03-09T09:00:00.000Z',
        createdAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
      },
      {
        id: 'checkpoint-beta-only',
        thesisId: thesisBId,
        label: 'beta-only',
        note: null,
        scope: 'workspace',
        reason: 'scope isolation',
        snapshotPath: null,
        createdBy: 'test',
        checkpointedAt: '2026-03-09T11:00:00.000Z',
        createdAt: '2026-03-09T11:00:00.000Z',
        updatedAt: '2026-03-09T11:00:00.000Z',
      },
      {
        id: 'checkpoint-alpha-same-time-b',
        thesisId: thesisAId,
        label: 'same-time-b',
        note: null,
        scope: 'workspace',
        reason: 'id tie-break',
        snapshotPath: null,
        createdBy: 'test',
        checkpointedAt: '2026-03-09T08:00:00.000Z',
        createdAt: '2026-03-09T08:00:00.000Z',
        updatedAt: '2026-03-09T08:00:00.000Z',
      },
      {
        id: 'checkpoint-alpha-same-time-a',
        thesisId: thesisAId,
        label: 'same-time-a',
        note: null,
        scope: 'workspace',
        reason: 'id tie-break',
        snapshotPath: null,
        createdBy: 'test',
        checkpointedAt: '2026-03-09T08:00:00.000Z',
        createdAt: '2026-03-09T08:00:00.000Z',
        updatedAt: '2026-03-09T08:00:00.000Z',
      },
    ]);

    const thesisACheckpoints = await registry.repositories.checkpoints.listByThesisId?.(thesisAId);
    const thesisBCheckpoints = await registry.repositories.checkpoints.listByThesisId?.(thesisBId);
    const foundThesis = await registry.repositories.theses.findById(thesisAId);
    const activePolicy = await registry.repositories.policyProfiles.findActive();
    const tableTimestamp = thesisACheckpoints?.[0]
      ? {
          createdAt: thesisACheckpoints[0].createdAt,
          updatedAt: thesisACheckpoints[0].updatedAt,
        }
      : null;

    expect(foundThesis?.id).toBe(thesisAId);
    expect(activePolicy?.isActive).toBe(true);
    expect(thesisACheckpoints?.map((checkpoint) => checkpoint.id)).toEqual([
      'checkpoint-alpha-newer',
      'checkpoint-alpha-older',
      'checkpoint-alpha-same-time-a',
      'checkpoint-alpha-same-time-b',
    ]);
    expect(thesisBCheckpoints?.map((checkpoint) => checkpoint.id)).toEqual(['checkpoint-beta-only']);
    expect(tableTimestamp).toEqual({
      createdAt: '2026-03-09T10:00:00.000Z',
      updatedAt: '2026-03-09T10:00:00.000Z',
    });

    connection.sqlite.close();
  });
});
