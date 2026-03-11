import { execFileSync } from 'node:child_process';
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

  it('uses the same ISO-8601 UTC timestamp contract for schema defaults as repository helpers', async () => {
    const databaseUrl = createTempDatabaseUrl('thesis-db-timestamps-');
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../drizzle/0000_domain_core.sql'),
      'utf8',
    );

    const connection = createDatabaseConnection(databaseUrl);
    await connection.sqlite.executeMultiple(migrationSql);

    await connection.sqlite.execute(`
      INSERT INTO policy_profiles (id, institution, faculty, version, title)
      VALUES ('policy-timestamps-1', 'Universidad Demo', 'Ingeniería', '2026.1', 'Perfil principal')
    `);

    const policy = await connection.db.select().from(policyProfiles).where(eq(policyProfiles.id, 'policy-timestamps-1')).get();

    expect(policy).toBeTruthy();
    expect(policy?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(policy?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    connection.sqlite.close();
  });

  it('rejects orphaned cross-entity references through enforced foreign keys', () => {
    const databaseUrl = createTempDatabaseUrl('thesis-db-relations-');
    const databasePath = path.resolve('/root/thesislab', databaseUrl.slice('file:'.length));
    const migrationPaths = [
      path.resolve(import.meta.dirname, '../drizzle/0000_domain_core.sql'),
    ];

    const seedSql = [
      "INSERT INTO theses (id, title, slug, degree_program, institution, workspace_path, default_language, current_state, latest_status_at, next_step_summary) VALUES ('thesis-1', 'Relational Integrity Thesis', 'relational-integrity-thesis', 'MSc Computer Science', 'Universidad Demo', '/tmp/thesis-1', 'es', 'draft', '2026-03-09T00:00:00.000Z', 'Validar relaciones.')",
      "INSERT INTO policy_profiles (id, institution, faculty, version, title, required_sections_json, rule_definitions_json, is_active) VALUES ('policy-1', 'Universidad Demo', 'Ingeniería', '2026.1', 'Perfil principal', '[]', '[]', 1)",
      "INSERT INTO checkpoints (id, thesis_id, label, note, scope, reason, snapshot_path, created_by, checkpointed_at) VALUES ('checkpoint-1', 'thesis-1', 'Base checkpoint', NULL, 'workspace', 'seed', NULL, 'test', '2026-03-09T00:00:00.000Z')",
      "INSERT INTO workflow_tasks (id, thesis_id, parent_task_id, title, intent, status, priority, sort_order, due_at, active_checkpoint_id) VALUES ('task-1', 'thesis-1', NULL, 'Primary task', 'Verify thesis flow', 'active', 1, 1, NULL, NULL)",
      "INSERT INTO workflow_tasks (id, thesis_id, parent_task_id, title, intent, status, priority, sort_order, due_at, active_checkpoint_id) VALUES ('task-2', 'thesis-1', 'task-1', 'Child task', 'Verify nested thesis flow', 'pending', 2, 2, NULL, NULL)",
      "INSERT INTO workflow_packs (id, thesis_id, name, description, status, current_step_id) VALUES ('pack-1', 'thesis-1', 'Pack', 'Workflow pack', 'active', NULL)",
      "INSERT INTO workflow_steps (id, thesis_id, workflow_pack_id, title, description, status, step_order) VALUES ('step-1', 'thesis-1', 'pack-1', 'Draft chapter outline', 'Create the first outline draft', 'active', 1)",
      "INSERT INTO normalized_nodes (id, thesis_id, intake_job_id, parent_node_id, node_type, title, content, ordinal, source_path, source_start, source_end, provenance_kind, provenance_json) VALUES ('node-1', 'thesis-1', NULL, NULL, 'chapter', 'Introducción', 'Contenido', 1, 'main.tex', '1', '10', 'latex', '{}')",
      "INSERT INTO normalized_nodes (id, thesis_id, intake_job_id, parent_node_id, node_type, title, content, ordinal, source_path, source_start, source_end, provenance_kind, provenance_json) VALUES ('node-2', 'thesis-1', NULL, 'node-1', 'section', 'Marco teórico', 'Más contenido', 2, 'chapter1.tex', '11', '20', 'latex', '{}')",
      "INSERT INTO sources (id, thesis_id, source_type, title, authors_json, publication_year, locator, status, ingest_metadata_json) VALUES ('source-1', 'thesis-1', 'article', 'A source', '[\"Ada\"]', 2024, 'doi:demo', 'ready', '{}')",
      "INSERT INTO evidence_fragments (id, thesis_id, source_id, normalized_node_id, task_id, locator, snippet, extraction_method, confidence, status, provenance_json) VALUES ('evidence-1', 'thesis-1', 'source-1', 'node-2', 'task-2', 'p. 4', 'Important evidence', 'manual', 0.9, 'linked', '{}')",
      "INSERT INTO claims (id, thesis_id, normalized_node_id, text, status, support_summary, evidence_ordering_json) VALUES ('claim-1', 'thesis-1', 'node-2', 'A defensible claim', 'draft', 'Needs support', '{\"evidenceFragmentIdOrder\":[]}')",
      "INSERT INTO compliance_runs (id, thesis_id, policy_profile_id, status, summary_json, evaluated_rule_count, warning_rule_count, skipped_rule_count, started_at, completed_at) VALUES ('compliance-run-1', 'thesis-1', 'policy-1', 'completed', '{}', 1, 0, 0, '2026-03-09T00:22:00.000Z', '2026-03-09T00:23:00.000Z')",
      "INSERT INTO compliance_issues (id, thesis_id, compliance_run_id, policy_profile_id, rule_id, normalized_node_id, severity, message, remediation, disposition) VALUES ('compliance-issue-1', 'thesis-1', 'compliance-run-1', 'policy-1', 'rule-1', 'node-2', 'warning', 'Missing section detail', 'Add detail', 'warning')",
      "INSERT INTO academic_qa_runs (id, thesis_id, status, assessed_scope_json, skipped_scope_json, summary_json, started_at, completed_at) VALUES ('qa-run-1', 'thesis-1', 'completed', '{}', '{}', '{}', '2026-03-09T00:24:00.000Z', '2026-03-09T00:25:00.000Z')",
      "INSERT INTO academic_qa_issues (id, thesis_id, academic_qa_run_id, claim_id, normalized_node_id, category, severity, message, rationale, remediation, triggering_condition) VALUES ('qa-issue-1', 'thesis-1', 'qa-run-1', 'claim-1', 'node-2', 'evidence-gap', 'warning', 'Need more evidence', 'Only one source attached', 'Attach more sources', 'low-support')",
      "INSERT INTO zotero_mappings (id, thesis_id, normalized_node_id, source_id, scope, library_id, collection_key, item_key, normalized_data_json, connector_status, last_synced_at) VALUES ('zotero-1', 'thesis-1', 'node-2', 'source-1', 'thesis', 'library-1', 'collection-1', 'item-1', '{}', 'mocked', '2026-03-09T00:15:00.000Z')",
      "INSERT INTO build_runs (id, thesis_id, checkpoint_id, status, engine, artifact_path, diagnostics_json, bibliography_status, started_at, completed_at, is_latest_successful) VALUES ('build-1', 'thesis-1', 'checkpoint-1', 'success', 'latexmk', '/tmp/output.pdf', '{}', 'ok', '2026-03-09T00:20:00.000Z', '2026-03-09T00:21:00.000Z', 1)",
    ];

    const invalidSql = [
      "INSERT INTO evidence_fragments (id, thesis_id, source_id, normalized_node_id, task_id, locator, snippet, extraction_method, confidence, status, provenance_json) VALUES ('evidence-invalid', 'thesis-1', 'source-1', 'missing-node', 'task-2', NULL, 'Broken evidence', 'manual', NULL, 'linked', '{}')",
      "INSERT INTO claims (id, thesis_id, normalized_node_id, text, status, support_summary, evidence_ordering_json) VALUES ('claim-invalid', 'thesis-1', 'missing-node', 'Broken claim', 'draft', '', '{\"evidenceFragmentIdOrder\":[]}')",
      "INSERT INTO zotero_mappings (id, thesis_id, normalized_node_id, source_id, scope, library_id, collection_key, item_key, normalized_data_json, connector_status, last_synced_at) VALUES ('zotero-invalid', 'thesis-1', 'missing-node', 'source-1', 'thesis', 'library-1', NULL, NULL, '{}', 'mocked', NULL)",
      "INSERT INTO compliance_issues (id, thesis_id, compliance_run_id, policy_profile_id, rule_id, normalized_node_id, severity, message, remediation, disposition) VALUES ('compliance-issue-invalid', 'thesis-1', 'compliance-run-1', 'policy-1', 'rule-1', 'missing-node', 'warning', 'Broken issue', NULL, 'warning')",
      "INSERT INTO academic_qa_issues (id, thesis_id, academic_qa_run_id, claim_id, normalized_node_id, category, severity, message, rationale, remediation, triggering_condition) VALUES ('qa-issue-invalid-claim', 'thesis-1', 'qa-run-1', 'missing-claim', 'node-2', 'evidence-gap', 'warning', 'Broken qa issue', 'Missing claim', NULL, 'low-support')",
      "INSERT INTO build_runs (id, thesis_id, checkpoint_id, status, engine, artifact_path, diagnostics_json, bibliography_status, started_at, completed_at, is_latest_successful) VALUES ('build-invalid', 'thesis-1', 'missing-checkpoint', 'failed', 'latexmk', NULL, '{}', 'unknown', '2026-03-09T00:30:00.000Z', NULL, 0)",
      "INSERT INTO workflow_steps (id, thesis_id, workflow_pack_id, title, description, status, step_order) VALUES ('step-invalid-pack', 'thesis-1', 'missing-pack', 'Broken workflow step', 'Should fail because the pack does not exist', 'pending', 2)",
    ];

    const pythonScript = String.raw`
import json
import sqlite3
import sys

migration_sql = ''
for migration_path in json.loads(sys.argv[2]):
    with open(migration_path, 'r', encoding='utf-8') as handle:
        migration_sql += handle.read().replace('--> statement-breakpoint', ';') + '\n'

seed_sql = json.loads(sys.argv[3])
invalid_sql = json.loads(sys.argv[4])

conn = sqlite3.connect(sys.argv[1])
conn.execute('PRAGMA foreign_keys = ON')
conn.executescript(migration_sql)

for statement in seed_sql:
    conn.execute(statement)

for statement in invalid_sql:
    try:
        conn.execute(statement)
    except sqlite3.IntegrityError as exc:
        if 'FOREIGN KEY constraint failed' not in str(exc):
            raise AssertionError(f'Unexpected integrity error: {exc}') from exc
    else:
        raise AssertionError(f'Expected foreign key failure for SQL: {statement}')

conn.close()
`;

    expect(() => {
      execFileSync(
        'python3',
        ['-c', pythonScript, databasePath, JSON.stringify(migrationPaths), JSON.stringify(seedSql), JSON.stringify(invalidSql)],
        { stdio: 'pipe' },
      );
    }).not.toThrow();
  });

  it('keeps the base migration aligned with current schema foreign keys and protects fresh databases without follow-up migrations', async () => {
    const databaseUrl = createTempDatabaseUrl('thesis-db-base-parity-');
    const migrationSql = fs.readFileSync(
      path.resolve(import.meta.dirname, '../drizzle/0000_domain_core.sql'),
      'utf8',
    );

    const connection = createDatabaseConnection(databaseUrl);
    await connection.sqlite.executeMultiple(migrationSql);

    const foreignKeysByTable = new Map<string, string[]>();
    const tableNames = [
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
    ];

    for (const tableName of tableNames) {
      const pragmaResult = await connection.sqlite.execute(`PRAGMA foreign_key_list(${tableName})`);
      const signatures = pragmaResult.rows
        .map((row) => [
          String(row.from),
          String(row.table),
          String(row.to),
          String(row.on_delete).toLowerCase(),
        ].join(' -> '))
        .sort();

      foreignKeysByTable.set(tableName, signatures);
    }

    expect(foreignKeysByTable).toEqual(new Map<string, string[]>([
      ['academic_qa_issues', [
        'academic_qa_run_id -> academic_qa_runs -> id -> cascade',
        'claim_id -> claims -> id -> set null',
        'normalized_node_id -> normalized_nodes -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['academic_qa_runs', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['build_runs', [
        'checkpoint_id -> checkpoints -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['checkpoints', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['claim_evidence_links', [
        'claim_id -> claims -> id -> cascade',
        'evidence_fragment_id -> evidence_fragments -> id -> cascade',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['claims', [
        'normalized_node_id -> normalized_nodes -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['compliance_issues', [
        'compliance_run_id -> compliance_runs -> id -> cascade',
        'normalized_node_id -> normalized_nodes -> id -> set null',
        'policy_profile_id -> policy_profiles -> id -> restrict',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['compliance_runs', [
        'policy_profile_id -> policy_profiles -> id -> restrict',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['evidence_fragments', [
        'normalized_node_id -> normalized_nodes -> id -> set null',
        'source_id -> sources -> id -> cascade',
        'task_id -> workflow_tasks -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['feedback_entries', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['intake_jobs', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['normalized_nodes', [
        'intake_job_id -> intake_jobs -> id -> set null',
        'parent_node_id -> normalized_nodes -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['policy_profiles', []],
      ['sources', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['theses', []],
      ['thesis_states', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['workflow_packs', [
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['workflow_steps', [
        'thesis_id -> theses -> id -> cascade',
        'workflow_pack_id -> workflow_packs -> id -> cascade',
      ]],
      ['workflow_task_checkpoints', [
        'task_id -> workflow_tasks -> id -> cascade',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['workflow_tasks', [
        'parent_task_id -> workflow_tasks -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
      ['zotero_mappings', [
        'normalized_node_id -> normalized_nodes -> id -> set null',
        'source_id -> sources -> id -> set null',
        'thesis_id -> theses -> id -> cascade',
      ]],
    ]));

    await connection.sqlite.executeMultiple(`
      INSERT INTO theses (id, title, slug, degree_program, institution, workspace_path, default_language, current_state, latest_status_at, next_step_summary)
      VALUES ('thesis-base-1', 'Base Parity Thesis', 'base-parity-thesis', 'MSc Computer Science', 'Universidad Demo', '/tmp/base-parity', 'es', 'draft', '2026-03-09T00:00:00.000Z', 'Validar integridad base.');

      INSERT INTO policy_profiles (id, institution, faculty, version, title, required_sections_json, rule_definitions_json, is_active)
      VALUES ('policy-base-1', 'Universidad Demo', 'Ingeniería', '2026.1', 'Perfil principal', '[]', '[]', 1);

      INSERT INTO checkpoints (id, thesis_id, label, note, scope, reason, snapshot_path, created_by, checkpointed_at)
      VALUES ('checkpoint-base-1', 'thesis-base-1', 'Base checkpoint', NULL, 'workspace', 'seed', NULL, 'test', '2026-03-09T00:00:00.000Z');

      INSERT INTO workflow_tasks (id, thesis_id, parent_task_id, title, intent, status, priority, sort_order, due_at, active_checkpoint_id)
      VALUES ('task-base-1', 'thesis-base-1', NULL, 'Primary task', 'Verify thesis flow', 'active', 1, 1, NULL, NULL);

      INSERT INTO workflow_tasks (id, thesis_id, parent_task_id, title, intent, status, priority, sort_order, due_at, active_checkpoint_id)
      VALUES ('task-base-2', 'thesis-base-1', 'task-base-1', 'Child task', 'Verify nested thesis flow', 'pending', 2, 2, NULL, NULL);

      INSERT INTO workflow_packs (id, thesis_id, name, description, status, current_step_id)
      VALUES ('pack-base-1', 'thesis-base-1', 'Pack', 'Workflow pack', 'active', NULL);

      INSERT INTO workflow_steps (id, thesis_id, workflow_pack_id, title, description, status, step_order)
      VALUES ('step-base-1', 'thesis-base-1', 'pack-base-1', 'Draft chapter outline', 'Create the first outline draft', 'active', 1);

      INSERT INTO normalized_nodes (id, thesis_id, intake_job_id, parent_node_id, node_type, title, content, ordinal, source_path, source_start, source_end, provenance_kind, provenance_json)
      VALUES ('node-base-1', 'thesis-base-1', NULL, NULL, 'chapter', 'Introducción', 'Contenido', 1, 'main.tex', '1', '10', 'latex', '{}');

      INSERT INTO normalized_nodes (id, thesis_id, intake_job_id, parent_node_id, node_type, title, content, ordinal, source_path, source_start, source_end, provenance_kind, provenance_json)
      VALUES ('node-base-2', 'thesis-base-1', NULL, 'node-base-1', 'section', 'Marco teórico', 'Más contenido', 2, 'chapter1.tex', '11', '20', 'latex', '{}');

      INSERT INTO sources (id, thesis_id, source_type, title, authors_json, publication_year, locator, status, ingest_metadata_json)
      VALUES ('source-base-1', 'thesis-base-1', 'article', 'A source', '["Ada"]', 2024, 'doi:demo', 'ready', '{}');

      INSERT INTO claims (id, thesis_id, normalized_node_id, text, status, support_summary, evidence_ordering_json)
      VALUES ('claim-base-1', 'thesis-base-1', 'node-base-2', 'A defensible claim', 'draft', 'Needs support', '{"evidenceFragmentIdOrder":[]}');

      INSERT INTO compliance_runs (id, thesis_id, policy_profile_id, status, summary_json, evaluated_rule_count, warning_rule_count, skipped_rule_count, started_at, completed_at)
      VALUES ('compliance-run-base-1', 'thesis-base-1', 'policy-base-1', 'completed', '{}', 1, 0, 0, '2026-03-09T00:22:00.000Z', '2026-03-09T00:23:00.000Z');

      INSERT INTO academic_qa_runs (id, thesis_id, status, assessed_scope_json, skipped_scope_json, summary_json, started_at, completed_at)
      VALUES ('qa-run-base-1', 'thesis-base-1', 'completed', '{}', '{}', '{}', '2026-03-09T00:24:00.000Z', '2026-03-09T00:25:00.000Z');
    `);

    await expect(connection.sqlite.execute(`
      INSERT INTO normalized_nodes (id, thesis_id, intake_job_id, parent_node_id, node_type, title, content, ordinal, source_path, source_start, source_end, provenance_kind, provenance_json)
      VALUES ('node-invalid', 'thesis-base-1', NULL, 'missing-node', 'section', 'Broken node', NULL, 3, 'chapter1.tex', '21', '30', 'latex', '{}')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO evidence_fragments (id, thesis_id, source_id, normalized_node_id, task_id, locator, snippet, extraction_method, confidence, status, provenance_json)
      VALUES ('evidence-invalid', 'thesis-base-1', 'source-base-1', 'missing-node', 'task-base-2', NULL, 'Broken evidence', 'manual', NULL, 'linked', '{}')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO claims (id, thesis_id, normalized_node_id, text, status, support_summary, evidence_ordering_json)
      VALUES ('claim-invalid', 'thesis-base-1', 'missing-node', 'Broken claim', 'draft', '', '{"evidenceFragmentIdOrder":[]}')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO zotero_mappings (id, thesis_id, normalized_node_id, source_id, scope, library_id, collection_key, item_key, normalized_data_json, connector_status, last_synced_at)
      VALUES ('zotero-invalid', 'thesis-base-1', 'missing-node', 'source-base-1', 'thesis', 'library-1', NULL, NULL, '{}', 'mocked', NULL)
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO compliance_issues (id, thesis_id, compliance_run_id, policy_profile_id, rule_id, normalized_node_id, severity, message, remediation, disposition)
      VALUES ('compliance-issue-invalid', 'thesis-base-1', 'compliance-run-base-1', 'policy-base-1', 'rule-1', 'missing-node', 'warning', 'Broken issue', NULL, 'warning')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO academic_qa_issues (id, thesis_id, academic_qa_run_id, claim_id, normalized_node_id, category, severity, message, rationale, remediation, triggering_condition)
      VALUES ('qa-issue-invalid-claim', 'thesis-base-1', 'qa-run-base-1', 'missing-claim', 'node-base-2', 'evidence-gap', 'warning', 'Broken qa issue', 'Missing claim', NULL, 'low-support')
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO build_runs (id, thesis_id, checkpoint_id, status, engine, artifact_path, diagnostics_json, bibliography_status, started_at, completed_at, is_latest_successful)
      VALUES ('build-invalid', 'thesis-base-1', 'missing-checkpoint', 'failed', 'latexmk', NULL, '{}', 'unknown', '2026-03-09T00:30:00.000Z', NULL, 0)
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO workflow_steps (id, thesis_id, workflow_pack_id, title, description, status, step_order)
      VALUES ('step-invalid-pack', 'thesis-base-1', 'missing-pack', 'Broken workflow step', 'Should fail because the pack does not exist', 'pending', 2)
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(connection.sqlite.execute(`
      INSERT INTO workflow_tasks (id, thesis_id, parent_task_id, title, intent, status, priority, sort_order, due_at, active_checkpoint_id)
      VALUES ('task-invalid-parent', 'thesis-base-1', 'missing-task', 'Broken workflow task', 'Should fail because the parent task does not exist', 'pending', 3, 3, NULL, NULL)
    `)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    connection.sqlite.close();
  });

  it('records the claim evidence ordering migration in the Drizzle journal sequence', async () => {
    const journalPath = path.resolve(import.meta.dirname, '../drizzle/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries?: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, tag: '0000_domain_core' }),
      expect.objectContaining({ idx: 1, tag: '0001_unknown_komodo' }),
      expect.objectContaining({ idx: 2, tag: '0002_claim_evidence_ordering_json' }),
    ]);
  });
});
