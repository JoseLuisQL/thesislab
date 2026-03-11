import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../client.js';
import {
  checkpoints,
  claims,
  feedbackEntries,
  normalizedNodes,
  policyProfiles,
  sources,
  theses,
  workflowPacks,
  workflowSteps,
  workflowTaskCheckpoints,
  workflowTasks,
  zoteroMappings,
} from '../schema.js';
import {
  createDomainRepositories,
  createDomainRepositoryRegistry,
  createPersistenceHelpers,
} from './domain.js';

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

  it('keeps repository helper timestamps aligned with database default timestamps', async () => {
    const connection = createDatabaseConnection(databaseUrl);
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../drizzle/0000_domain_core.sql'),
      'utf8',
    );
    await connection.sqlite.executeMultiple(migrationSql);
    const registry = createDomainRepositoryRegistry(connection.db);

    const helperTimestamp = registry.helpers.now();

    await connection.sqlite.execute(`
      INSERT INTO policy_profiles (id, institution, faculty, version, title)
      VALUES ('policy-default-timestamps', 'Universidad Demo', 'Ingeniería', '2026.1', 'Perfil principal')
    `);

    const policy = await registry.repositories.policyProfiles.findById('policy-default-timestamps');

    expect(helperTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(policy?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(policy?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    connection.sqlite.close();
  });

  it('re-exports the committed registry helper surface for downstream consumers', async () => {
    const connection = createDatabaseConnection(databaseUrl);
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../drizzle/0000_domain_core.sql'),
      'utf8',
    );
    await connection.sqlite.executeMultiple(migrationSql);

    expect(createPersistenceHelpers).toBeTypeOf('function');

    const repositoryFactoryKeys = Object.keys(createDomainRepositories(connection.db)).sort();
    const registry = createDomainRepositoryRegistry(connection.db);

    expect(Object.keys(registry).sort()).toEqual(['helpers', 'repositories']);
    expect(Object.keys(registry.repositories).sort()).toEqual(repositoryFactoryKeys);
    expect(registry.helpers).toEqual({
      createId: createPersistenceHelpers().createId,
      now: createPersistenceHelpers().now,
    });
    expect(registry.helpers.createId).toBe(createPersistenceHelpers().createId);
    expect(registry.helpers.now).toBe(createPersistenceHelpers().now);

    connection.sqlite.close();
  });

  it('covers thesis-scoped repositories with deterministic ordering semantics', async () => {
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
        slug: 'alpha-contracts',
        degreeProgram: 'MSc Computer Science',
        institution: 'Universidad Demo',
        workspacePath: '/tmp/alpha-contracts',
        defaultLanguage: 'es',
        currentState: 'draft',
        latestStatusAt: sharedTimestamp,
        nextStepSummary: 'Continue alpha',
        activeImportId: null,
        activeBuildRunId: null,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      },
      {
        id: thesisBId,
        title: 'Beta',
        slug: 'beta-contracts',
        degreeProgram: 'MSc Computer Science',
        institution: 'Universidad Demo',
        workspacePath: '/tmp/beta-contracts',
        defaultLanguage: 'es',
        currentState: 'draft',
        latestStatusAt: sharedTimestamp,
        nextStepSummary: 'Continue beta',
        activeImportId: null,
        activeBuildRunId: null,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      },
    ]);

    await connection.db.insert(feedbackEntries).values([
      {
        id: 'feedback-alpha-newer',
        thesisId: thesisAId,
        sourceType: 'user',
        body: 'Newest alpha feedback',
        summary: null,
        recordedAt: '2026-03-09T10:10:00.000Z',
        createdAt: '2026-03-09T10:10:00.000Z',
        updatedAt: '2026-03-09T10:10:00.000Z',
      },
      {
        id: 'feedback-alpha-older',
        thesisId: thesisAId,
        sourceType: 'system',
        body: 'Older alpha feedback',
        summary: null,
        recordedAt: '2026-03-09T10:05:00.000Z',
        createdAt: '2026-03-09T10:05:00.000Z',
        updatedAt: '2026-03-09T10:05:00.000Z',
      },
      {
        id: 'feedback-alpha-same-time-b',
        thesisId: thesisAId,
        sourceType: 'qa',
        body: 'Alpha tie break B',
        summary: null,
        recordedAt: '2026-03-09T10:00:00.000Z',
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
      {
        id: 'feedback-alpha-same-time-a',
        thesisId: thesisAId,
        sourceType: 'qa',
        body: 'Alpha tie break A',
        summary: null,
        recordedAt: '2026-03-09T10:00:00.000Z',
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
      {
        id: 'feedback-beta-only',
        thesisId: thesisBId,
        sourceType: 'user',
        body: 'Beta feedback',
        summary: null,
        recordedAt: '2026-03-09T11:00:00.000Z',
        createdAt: '2026-03-09T11:00:00.000Z',
        updatedAt: '2026-03-09T11:00:00.000Z',
      },
    ]);

    await connection.db.insert(workflowTasks).values([
      {
        id: 'task-alpha-newer',
        thesisId: thesisAId,
        parentTaskId: null,
        title: 'Newest alpha task',
        intent: 'Validate ordering',
        status: 'in_progress',
        priority: 1,
        sortOrder: 1,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-09T09:10:00.000Z',
        updatedAt: '2026-03-09T09:10:00.000Z',
      },
      {
        id: 'task-alpha-older',
        thesisId: thesisAId,
        parentTaskId: null,
        title: 'Older alpha task',
        intent: 'Validate isolation',
        status: 'pending',
        priority: 2,
        sortOrder: 2,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-09T09:05:00.000Z',
        updatedAt: '2026-03-09T09:05:00.000Z',
      },
      {
        id: 'task-alpha-same-time-b',
        thesisId: thesisAId,
        parentTaskId: null,
        title: 'Alpha task B',
        intent: 'Tie break B',
        status: 'blocked',
        priority: 3,
        sortOrder: 3,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
      },
      {
        id: 'task-alpha-same-time-a',
        thesisId: thesisAId,
        parentTaskId: null,
        title: 'Alpha task A',
        intent: 'Tie break A',
        status: 'done',
        priority: 4,
        sortOrder: 4,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
      },
      {
        id: 'task-beta-only',
        thesisId: thesisBId,
        parentTaskId: null,
        title: 'Beta only task',
        intent: 'Isolation',
        status: 'pending',
        priority: 1,
        sortOrder: 1,
        dueAt: null,
        activeCheckpointId: null,
        createdAt: '2026-03-09T11:05:00.000Z',
        updatedAt: '2026-03-09T11:05:00.000Z',
      },
    ]);

    await connection.db.insert(workflowTaskCheckpoints).values([
      {
        id: 'task-checkpoint-alpha-newer',
        thesisId: thesisAId,
        taskId: 'task-alpha-newer',
        label: 'Newest alpha task checkpoint',
        summary: 'Newest progress update',
        progressPercent: 90,
        blocker: null,
        checkpointedAt: '2026-03-09T09:20:00.000Z',
        createdAt: '2026-03-09T09:20:00.000Z',
        updatedAt: '2026-03-09T09:20:00.000Z',
      },
      {
        id: 'task-checkpoint-alpha-older',
        thesisId: thesisAId,
        taskId: 'task-alpha-older',
        label: 'Older alpha task checkpoint',
        summary: 'Older progress update',
        progressPercent: 40,
        blocker: 'Needs input',
        checkpointedAt: '2026-03-09T09:15:00.000Z',
        createdAt: '2026-03-09T09:15:00.000Z',
        updatedAt: '2026-03-09T09:15:00.000Z',
      },
      {
        id: 'task-checkpoint-alpha-same-time-b',
        thesisId: thesisAId,
        taskId: 'task-alpha-same-time-b',
        label: 'Alpha task checkpoint B',
        summary: 'Tie break B',
        progressPercent: 10,
        blocker: null,
        checkpointedAt: '2026-03-09T09:00:00.000Z',
        createdAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
      },
      {
        id: 'task-checkpoint-alpha-same-time-a',
        thesisId: thesisAId,
        taskId: 'task-alpha-same-time-a',
        label: 'Alpha task checkpoint A',
        summary: 'Tie break A',
        progressPercent: 20,
        blocker: null,
        checkpointedAt: '2026-03-09T09:00:00.000Z',
        createdAt: '2026-03-09T09:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
      },
      {
        id: 'task-checkpoint-beta-only',
        thesisId: thesisBId,
        taskId: 'task-beta-only',
        label: 'Beta only task checkpoint',
        summary: 'Beta progress update',
        progressPercent: 70,
        blocker: null,
        checkpointedAt: '2026-03-09T11:06:00.000Z',
        createdAt: '2026-03-09T11:06:00.000Z',
        updatedAt: '2026-03-09T11:06:00.000Z',
      },
    ]);

    await connection.db.insert(workflowPacks).values([
      {
        id: 'workflow-pack-alpha-newer',
        thesisId: thesisAId,
        name: 'Newest alpha pack',
        description: 'Newest workflow pack',
        status: 'in_progress',
        currentStepId: null,
        createdAt: '2026-03-09T08:50:00.000Z',
        updatedAt: '2026-03-09T08:50:00.000Z',
      },
      {
        id: 'workflow-pack-alpha-older',
        thesisId: thesisAId,
        name: 'Older alpha pack',
        description: 'Older workflow pack',
        status: 'pending',
        currentStepId: null,
        createdAt: '2026-03-09T08:45:00.000Z',
        updatedAt: '2026-03-09T08:45:00.000Z',
      },
      {
        id: 'workflow-pack-alpha-same-time-b',
        thesisId: thesisAId,
        name: 'Alpha pack B',
        description: 'Tie break B',
        status: 'blocked',
        currentStepId: null,
        createdAt: '2026-03-09T08:40:00.000Z',
        updatedAt: '2026-03-09T08:40:00.000Z',
      },
      {
        id: 'workflow-pack-alpha-same-time-a',
        thesisId: thesisAId,
        name: 'Alpha pack A',
        description: 'Tie break A',
        status: 'completed',
        currentStepId: null,
        createdAt: '2026-03-09T08:40:00.000Z',
        updatedAt: '2026-03-09T08:40:00.000Z',
      },
      {
        id: 'workflow-pack-beta-only',
        thesisId: thesisBId,
        name: 'Beta only pack',
        description: 'Isolation',
        status: 'in_progress',
        currentStepId: null,
        createdAt: '2026-03-09T11:07:00.000Z',
        updatedAt: '2026-03-09T11:07:00.000Z',
      },
    ]);

    await connection.db.insert(workflowSteps).values([
      {
        id: 'workflow-step-alpha-newer',
        thesisId: thesisAId,
        workflowPackId: 'workflow-pack-alpha-newer',
        title: 'Newest alpha step',
        description: 'Newest workflow step',
        status: 'in_progress',
        stepOrder: 1,
        createdAt: '2026-03-09T08:55:00.000Z',
        updatedAt: '2026-03-09T08:55:00.000Z',
      },
      {
        id: 'workflow-step-alpha-older',
        thesisId: thesisAId,
        workflowPackId: 'workflow-pack-alpha-older',
        title: 'Older alpha step',
        description: 'Older workflow step',
        status: 'pending',
        stepOrder: 2,
        createdAt: '2026-03-09T08:52:00.000Z',
        updatedAt: '2026-03-09T08:52:00.000Z',
      },
      {
        id: 'workflow-step-alpha-same-time-b',
        thesisId: thesisAId,
        workflowPackId: 'workflow-pack-alpha-same-time-b',
        title: 'Alpha step B',
        description: 'Tie break B',
        status: 'blocked',
        stepOrder: 3,
        createdAt: '2026-03-09T08:48:00.000Z',
        updatedAt: '2026-03-09T08:48:00.000Z',
      },
      {
        id: 'workflow-step-alpha-same-time-a',
        thesisId: thesisAId,
        workflowPackId: 'workflow-pack-alpha-same-time-a',
        title: 'Alpha step A',
        description: 'Tie break A',
        status: 'completed',
        stepOrder: 4,
        createdAt: '2026-03-09T08:48:00.000Z',
        updatedAt: '2026-03-09T08:48:00.000Z',
      },
      {
        id: 'workflow-step-beta-only',
        thesisId: thesisBId,
        workflowPackId: 'workflow-pack-beta-only',
        title: 'Beta only step',
        description: 'Isolation',
        status: 'in_progress',
        stepOrder: 1,
        createdAt: '2026-03-09T11:08:00.000Z',
        updatedAt: '2026-03-09T11:08:00.000Z',
      },
    ]);

    await connection.db.insert(normalizedNodes).values([
      {
        id: 'node-alpha-newer',
        thesisId: thesisAId,
        intakeJobId: null,
        parentNodeId: null,
        nodeType: 'chapter',
        title: 'Newest alpha node',
        content: null,
        ordinal: 1,
        sourcePath: 'alpha/main.tex',
        sourceStart: '1',
        sourceEnd: '10',
        provenanceKind: 'latex',
        provenanceJson: '{}',
        createdAt: '2026-03-09T08:10:00.000Z',
        updatedAt: '2026-03-09T08:10:00.000Z',
      },
      {
        id: 'node-alpha-older',
        thesisId: thesisAId,
        intakeJobId: null,
        parentNodeId: null,
        nodeType: 'section',
        title: 'Older alpha node',
        content: null,
        ordinal: 2,
        sourcePath: 'alpha/chapter.tex',
        sourceStart: '11',
        sourceEnd: '20',
        provenanceKind: 'latex',
        provenanceJson: '{}',
        createdAt: '2026-03-09T08:05:00.000Z',
        updatedAt: '2026-03-09T08:05:00.000Z',
      },
      {
        id: 'node-alpha-same-time-b',
        thesisId: thesisAId,
        intakeJobId: null,
        parentNodeId: null,
        nodeType: 'paragraph',
        title: 'Alpha node B',
        content: null,
        ordinal: 3,
        sourcePath: 'alpha/notes.tex',
        sourceStart: '21',
        sourceEnd: '30',
        provenanceKind: 'latex',
        provenanceJson: '{}',
        createdAt: '2026-03-09T08:00:00.000Z',
        updatedAt: '2026-03-09T08:00:00.000Z',
      },
      {
        id: 'node-alpha-same-time-a',
        thesisId: thesisAId,
        intakeJobId: null,
        parentNodeId: null,
        nodeType: 'paragraph',
        title: 'Alpha node A',
        content: null,
        ordinal: 4,
        sourcePath: 'alpha/notes.tex',
        sourceStart: '31',
        sourceEnd: '40',
        provenanceKind: 'latex',
        provenanceJson: '{}',
        createdAt: '2026-03-09T08:00:00.000Z',
        updatedAt: '2026-03-09T08:00:00.000Z',
      },
      {
        id: 'node-beta-only',
        thesisId: thesisBId,
        intakeJobId: null,
        parentNodeId: null,
        nodeType: 'chapter',
        title: 'Beta node',
        content: null,
        ordinal: 1,
        sourcePath: 'beta/main.tex',
        sourceStart: '1',
        sourceEnd: '10',
        provenanceKind: 'latex',
        provenanceJson: '{}',
        createdAt: '2026-03-09T11:10:00.000Z',
        updatedAt: '2026-03-09T11:10:00.000Z',
      },
    ]);

    await connection.db.insert(sources).values([
      {
        id: 'source-alpha-newer',
        thesisId: thesisAId,
        sourceType: 'article',
        title: 'Newest alpha source',
        authorsJson: '["Ada"]',
        publicationYear: 2024,
        locator: 'doi:alpha-newer',
        status: 'ready',
        ingestMetadataJson: '{}',
        createdAt: '2026-03-09T07:10:00.000Z',
        updatedAt: '2026-03-09T07:10:00.000Z',
      },
      {
        id: 'source-alpha-older',
        thesisId: thesisAId,
        sourceType: 'book',
        title: 'Older alpha source',
        authorsJson: '["Grace"]',
        publicationYear: 2020,
        locator: 'isbn:alpha-older',
        status: 'registered',
        ingestMetadataJson: '{}',
        createdAt: '2026-03-09T07:05:00.000Z',
        updatedAt: '2026-03-09T07:05:00.000Z',
      },
      {
        id: 'source-alpha-same-time-b',
        thesisId: thesisAId,
        sourceType: 'web',
        title: 'Alpha source B',
        authorsJson: '[]',
        publicationYear: null,
        locator: 'https://example.com/b',
        status: 'degraded',
        ingestMetadataJson: '{}',
        createdAt: '2026-03-09T07:00:00.000Z',
        updatedAt: '2026-03-09T07:00:00.000Z',
      },
      {
        id: 'source-alpha-same-time-a',
        thesisId: thesisAId,
        sourceType: 'pdf',
        title: 'Alpha source A',
        authorsJson: '[]',
        publicationYear: null,
        locator: '/tmp/alpha.pdf',
        status: 'failed',
        ingestMetadataJson: '{}',
        createdAt: '2026-03-09T07:00:00.000Z',
        updatedAt: '2026-03-09T07:00:00.000Z',
      },
      {
        id: 'source-beta-only',
        thesisId: thesisBId,
        sourceType: 'article',
        title: 'Beta source',
        authorsJson: '["Linus"]',
        publicationYear: 2025,
        locator: 'doi:beta',
        status: 'ready',
        ingestMetadataJson: '{}',
        createdAt: '2026-03-09T11:15:00.000Z',
        updatedAt: '2026-03-09T11:15:00.000Z',
      },
    ]);

    await connection.db.insert(claims).values([
      {
        id: 'claim-alpha-newer',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-newer',
        text: 'Newest alpha claim',
        status: 'supported',
        supportSummary: 'Strong support',
        evidenceOrderingJson: '{"evidenceFragmentIdOrder":[]}',
        createdAt: '2026-03-09T06:10:00.000Z',
        updatedAt: '2026-03-09T06:10:00.000Z',
      },
      {
        id: 'claim-alpha-older',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-older',
        text: 'Older alpha claim',
        status: 'draft',
        supportSummary: 'Needs support',
        evidenceOrderingJson: '{"evidenceFragmentIdOrder":[]}',
        createdAt: '2026-03-09T06:05:00.000Z',
        updatedAt: '2026-03-09T06:05:00.000Z',
      },
      {
        id: 'claim-alpha-same-time-b',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-same-time-b',
        text: 'Alpha claim B',
        status: 'contested',
        supportSummary: 'Tie break B',
        evidenceOrderingJson: '{"evidenceFragmentIdOrder":[]}',
        createdAt: '2026-03-09T06:00:00.000Z',
        updatedAt: '2026-03-09T06:00:00.000Z',
      },
      {
        id: 'claim-alpha-same-time-a',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-same-time-a',
        text: 'Alpha claim A',
        status: 'archived',
        supportSummary: 'Tie break A',
        evidenceOrderingJson: '{"evidenceFragmentIdOrder":[]}',
        createdAt: '2026-03-09T06:00:00.000Z',
        updatedAt: '2026-03-09T06:00:00.000Z',
      },
      {
        id: 'claim-beta-only',
        thesisId: thesisBId,
        normalizedNodeId: 'node-beta-only',
        text: 'Beta claim',
        status: 'draft',
        supportSummary: 'Beta only',
        evidenceOrderingJson: '{"evidenceFragmentIdOrder":[]}',
        createdAt: '2026-03-09T11:20:00.000Z',
        updatedAt: '2026-03-09T11:20:00.000Z',
      },
    ]);

    await connection.db.insert(zoteroMappings).values([
      {
        id: 'zotero-alpha-newer',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-newer',
        sourceId: 'source-alpha-newer',
        scope: 'thesis',
        libraryId: 'library-alpha',
        collectionKey: 'collection-newer',
        itemKey: 'item-newer',
        normalizedDataJson: '{}',
        connectorStatus: 'ready',
        lastSyncedAt: '2026-03-09T05:10:00.000Z',
        createdAt: '2026-03-09T05:10:00.000Z',
        updatedAt: '2026-03-09T05:10:00.000Z',
      },
      {
        id: 'zotero-alpha-older',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-older',
        sourceId: 'source-alpha-older',
        scope: 'chapter',
        libraryId: 'library-alpha',
        collectionKey: 'collection-older',
        itemKey: 'item-older',
        normalizedDataJson: '{}',
        connectorStatus: 'degraded',
        lastSyncedAt: '2026-03-09T05:05:00.000Z',
        createdAt: '2026-03-09T05:05:00.000Z',
        updatedAt: '2026-03-09T05:05:00.000Z',
      },
      {
        id: 'zotero-alpha-same-time-b',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-same-time-b',
        sourceId: 'source-alpha-same-time-b',
        scope: 'source',
        libraryId: 'library-alpha',
        collectionKey: 'collection-b',
        itemKey: 'item-b',
        normalizedDataJson: '{}',
        connectorStatus: 'pending',
        lastSyncedAt: '2026-03-09T05:00:00.000Z',
        createdAt: '2026-03-09T05:00:00.000Z',
        updatedAt: '2026-03-09T05:00:00.000Z',
      },
      {
        id: 'zotero-alpha-same-time-a',
        thesisId: thesisAId,
        normalizedNodeId: 'node-alpha-same-time-a',
        sourceId: 'source-alpha-same-time-a',
        scope: 'source',
        libraryId: 'library-alpha',
        collectionKey: 'collection-a',
        itemKey: 'item-a',
        normalizedDataJson: '{}',
        connectorStatus: 'pending',
        lastSyncedAt: '2026-03-09T05:00:00.000Z',
        createdAt: '2026-03-09T05:00:00.000Z',
        updatedAt: '2026-03-09T05:00:00.000Z',
      },
      {
        id: 'zotero-beta-only',
        thesisId: thesisBId,
        normalizedNodeId: 'node-beta-only',
        sourceId: 'source-beta-only',
        scope: 'thesis',
        libraryId: 'library-beta',
        collectionKey: 'collection-beta',
        itemKey: 'item-beta',
        normalizedDataJson: '{}',
        connectorStatus: 'ready',
        lastSyncedAt: '2026-03-09T11:25:00.000Z',
        createdAt: '2026-03-09T11:25:00.000Z',
        updatedAt: '2026-03-09T11:25:00.000Z',
      },
    ]);

    const thesisAFeedbackEntries = await registry.repositories.feedbackEntries.listByThesisId?.(thesisAId);
    const thesisAWorkflowTasks = await registry.repositories.workflowTasks.listByThesisId?.(thesisAId);
    const thesisAWorkflowTaskCheckpoints = await registry.repositories.workflowTaskCheckpoints.listByThesisId?.(thesisAId);
    const thesisAWorkflowPacks = await registry.repositories.workflowPacks.listByThesisId?.(thesisAId);
    const thesisAWorkflowSteps = await registry.repositories.workflowSteps.listByThesisId?.(thesisAId);
    const thesisANormalizedNodes = await registry.repositories.normalizedNodes.listByThesisId?.(thesisAId);
    const thesisASources = await registry.repositories.sources.listByThesisId?.(thesisAId);
    const thesisAClaims = await registry.repositories.claims.listByThesisId?.(thesisAId);
    const thesisAZoteroMappings = await registry.repositories.zoteroMappings.listByThesisId?.(thesisAId);

    const thesisBFeedbackEntries = await registry.repositories.feedbackEntries.listByThesisId?.(thesisBId);
    const thesisBWorkflowTasks = await registry.repositories.workflowTasks.listByThesisId?.(thesisBId);
    const thesisBWorkflowTaskCheckpoints = await registry.repositories.workflowTaskCheckpoints.listByThesisId?.(thesisBId);
    const thesisBWorkflowPacks = await registry.repositories.workflowPacks.listByThesisId?.(thesisBId);
    const thesisBWorkflowSteps = await registry.repositories.workflowSteps.listByThesisId?.(thesisBId);
    const thesisBNormalizedNodes = await registry.repositories.normalizedNodes.listByThesisId?.(thesisBId);
    const thesisBSources = await registry.repositories.sources.listByThesisId?.(thesisBId);
    const thesisBClaims = await registry.repositories.claims.listByThesisId?.(thesisBId);
    const thesisBZoteroMappings = await registry.repositories.zoteroMappings.listByThesisId?.(thesisBId);

    expect(thesisAFeedbackEntries?.map((entry) => entry.id)).toEqual([
      'feedback-alpha-newer',
      'feedback-alpha-older',
      'feedback-alpha-same-time-a',
      'feedback-alpha-same-time-b',
    ]);
    expect(thesisAWorkflowTasks?.map((task) => task.id)).toEqual([
      'task-alpha-newer',
      'task-alpha-older',
      'task-alpha-same-time-a',
      'task-alpha-same-time-b',
    ]);
    expect(thesisAWorkflowTaskCheckpoints?.map((checkpoint) => checkpoint.id)).toEqual([
      'task-checkpoint-alpha-newer',
      'task-checkpoint-alpha-older',
      'task-checkpoint-alpha-same-time-a',
      'task-checkpoint-alpha-same-time-b',
    ]);
    expect(thesisAWorkflowPacks?.map((pack) => pack.id)).toEqual([
      'workflow-pack-alpha-newer',
      'workflow-pack-alpha-older',
      'workflow-pack-alpha-same-time-a',
      'workflow-pack-alpha-same-time-b',
    ]);
    expect(thesisAWorkflowSteps?.map((step) => step.id)).toEqual([
      'workflow-step-alpha-newer',
      'workflow-step-alpha-older',
      'workflow-step-alpha-same-time-a',
      'workflow-step-alpha-same-time-b',
    ]);
    expect(thesisANormalizedNodes?.map((node) => node.id)).toEqual([
      'node-alpha-newer',
      'node-alpha-older',
      'node-alpha-same-time-a',
      'node-alpha-same-time-b',
    ]);
    expect(thesisASources?.map((source) => source.id)).toEqual([
      'source-alpha-newer',
      'source-alpha-older',
      'source-alpha-same-time-a',
      'source-alpha-same-time-b',
    ]);
    expect(thesisAClaims?.map((claim) => claim.id)).toEqual([
      'claim-alpha-newer',
      'claim-alpha-older',
      'claim-alpha-same-time-a',
      'claim-alpha-same-time-b',
    ]);
    expect(thesisAZoteroMappings?.map((mapping) => mapping.id)).toEqual([
      'zotero-alpha-newer',
      'zotero-alpha-older',
      'zotero-alpha-same-time-a',
      'zotero-alpha-same-time-b',
    ]);

    expect(thesisBFeedbackEntries?.map((entry) => entry.id)).toEqual(['feedback-beta-only']);
    expect(thesisBWorkflowTasks?.map((task) => task.id)).toEqual(['task-beta-only']);
    expect(thesisBWorkflowTaskCheckpoints?.map((checkpoint) => checkpoint.id)).toEqual(['task-checkpoint-beta-only']);
    expect(thesisBWorkflowPacks?.map((pack) => pack.id)).toEqual(['workflow-pack-beta-only']);
    expect(thesisBWorkflowSteps?.map((step) => step.id)).toEqual(['workflow-step-beta-only']);
    expect(thesisBNormalizedNodes?.map((node) => node.id)).toEqual(['node-beta-only']);
    expect(thesisBSources?.map((source) => source.id)).toEqual(['source-beta-only']);
    expect(thesisBClaims?.map((claim) => claim.id)).toEqual(['claim-beta-only']);
    expect(thesisBZoteroMappings?.map((mapping) => mapping.id)).toEqual(['zotero-beta-only']);

    connection.sqlite.close();
  });
});
