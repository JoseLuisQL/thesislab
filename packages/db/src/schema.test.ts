import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabaseConnection } from './client.js';
import { policyProfiles, theses } from './schema.js';

function createTempDatabaseUrl(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return `file:${path.relative('/root/thesislab', path.join(dir, 'db.sqlite'))}`;
}

describe('schema migrations', () => {
  it('creates the durable tables required by the domain core', async () => {
    const databaseUrl = createTempDatabaseUrl('thesis-db-schema-');
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../drizzle/0000_domain_core.sql'),
      'utf8',
    );

    const connection = createDatabaseConnection(databaseUrl);
    await connection.sqlite.executeMultiple(migrationSql);
    const tables = await connection.sqlite.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

    expect(tables.rows.map((table) => String(table.name))).toEqual(
      expect.arrayContaining([
        'academic_qa_issues',
        'academic_qa_runs',
        'build_runs',
        'checkpoints',
        'claim_evidence_links',
        'claims',
        'compliance_issues',
        'compliance_runs',
        'evidence_fragments',
        'feedback_entries',
        'intake_jobs',
        'normalized_nodes',
        'policy_profiles',
        'sources',
        'theses',
        'thesis_states',
        'workflow_packs',
        'workflow_steps',
        'workflow_task_checkpoints',
        'workflow_tasks',
        'zotero_mappings',
      ]),
    );
    connection.sqlite.close();
  });

  it('supports durable reads through the migrated schema', async () => {
    const databaseUrl = createTempDatabaseUrl('thesis-db-records-');
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../drizzle/0000_domain_core.sql'),
      'utf8',
    );

    const connection = createDatabaseConnection(databaseUrl);
    await connection.sqlite.executeMultiple(migrationSql);

    await connection.db.insert(policyProfiles).values({
      id: 'policy-1',
      institution: 'Universidad Demo',
      faculty: 'Ingeniería',
      version: '2026.1',
      title: 'Perfil principal',
      requiredSectionsJson: '["introduccion"]',
      ruleDefinitionsJson: '[{"id":"rule-1"}]',
      isActive: true,
    });

    await connection.db.insert(theses).values({
      id: 'thesis-1',
      title: 'Core Schema Thesis',
      slug: 'core-schema-thesis',
      degreeProgram: 'MSc Computer Science',
      institution: 'Universidad Demo',
      workspacePath: '/tmp/thesis-1',
      defaultLanguage: 'es',
      currentState: 'draft',
      latestStatusAt: '2026-03-09T00:00:00.000Z',
      nextStepSummary: 'Registrar el estado inicial.',
      activeImportId: null,
      activeBuildRunId: null,
    });

    const thesis = await connection.db.select().from(theses).where(eq(theses.id, 'thesis-1')).get();
    const policy = await connection.db.select().from(policyProfiles).where(eq(policyProfiles.id, 'policy-1')).get();

    expect(thesis?.title).toBe('Core Schema Thesis');
    expect(policy?.isActive).toBe(true);

    connection.sqlite.close();
  });
});
