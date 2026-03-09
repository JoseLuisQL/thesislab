import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../client.js';
import { runMigrations } from '../migrator.js';
import { createDomainRepositories } from './domain.js';

function createTempDatabaseUrl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thesis-db-repos-'));
  return `file:${path.relative('/root/thesislab', path.join(dir, 'repositories.sqlite'))}`;
}

describe('domain repository boundaries', () => {
  let databaseUrl: string;

  beforeEach(() => {
    databaseUrl = createTempDatabaseUrl();
  });

  it('exposes all persistence repositories expected by downstream features', async () => {
    await runMigrations(databaseUrl);

    const connection = createDatabaseConnection(databaseUrl);
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
});
