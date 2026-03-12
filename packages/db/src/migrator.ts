import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createDatabaseConnection } from './client.js';
import { getMigrationsDirectory } from './config.js';

const DRIZZLE_JOURNAL_TABLE = '__drizzle_migrations';
const DRIZZLE_JOURNAL_PATH = path.join(getMigrationsDirectory(), 'meta', '_journal.json');
const DRIZZLE_MIGRATION_TABLE_SQL =
  `create table if not exists ${DRIZZLE_JOURNAL_TABLE} (id integer primary key autoincrement, hash text not null, created_at numeric not null)`;

type MigrationRecord = {
  tag: string;
  hash: string;
  createdAt: number;
  journalIdx: number;
};

type MigrationJournalState = {
  exists: boolean;
  hasEntries: boolean;
  hashes: Set<string>;
};

type LegacyBootstrapPlan = {
  journalState: MigrationJournalState;
  baseRepairMigrationSql: string | null;
  recordsToSeed: MigrationRecord[];
};

function normalizeDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl || databaseUrl.trim() === '') {
    return databaseUrl;
  }

  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const filePath = databaseUrl.slice('file:'.length);

  if (path.isAbsolute(filePath)) {
    return databaseUrl;
  }

  return `file:${path.resolve(process.cwd(), filePath)}`;
}

export async function runMigrations(databaseUrl = process.env.DATABASE_URL) {
  const migrationsFolder = getMigrationsDirectory();
  fs.mkdirSync(migrationsFolder, { recursive: true });

  const journalTags = readMigrationJournalTags();
  const migrationFiles = journalTags.map((tag) => `${tag}.sql`);
  const migrationRecords = migrationFiles.map((file, journalIdx) => buildMigrationRecord(file, migrationsFolder, journalIdx));

  migrationFilesByTag.clear();
  for (const file of migrationFiles) {
    migrationFilesByTag.set(path.basename(file, '.sql'), file);
  }

  if (migrationFiles.length === 0) {
    throw new Error(`No migration files found in ${migrationsFolder}`);
  }

  const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
  const bootstrapConnection = createDatabaseConnection(normalizedDatabaseUrl);
  const databaseFilePath = bootstrapConnection.filePath;
  bootstrapConnection.sqlite.close();

  await applyMigrations(databaseFilePath, migrationsFolder, migrationRecords);

  return {
    filePath: databaseFilePath,
    migrationsFolder,
    migrationFiles: migrationFiles.map((file) => path.join(migrationsFolder, file)),
  };
}

async function applyMigrations(
  databaseFilePath: string,
  migrationsFolder: string,
  migrationRecords: MigrationRecord[],
) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    await connection.sqlite.execute(DRIZZLE_MIGRATION_TABLE_SQL);

    const appliedRows = await connection.sqlite.execute(
      `select hash from ${DRIZZLE_JOURNAL_TABLE} order by created_at asc, id asc`,
    );
    const appliedHashes = new Set(appliedRows.rows.map((row) => String(row.hash)));
    for (const record of migrationRecords) {
      if (appliedHashes.has(record.hash)) {
        continue;
      }

      const migrationFile = migrationFilesByTag.get(record.tag);

      if (!migrationFile) {
        throw new Error(`Missing migration SQL file for tag ${record.tag}`);
      }

      const migrationPath = path.join(migrationsFolder, migrationFile);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');

      try {
        await connection.sqlite.executeMultiple(migrationSql);
        await connection.db.run(sql.raw(buildInsertJournalSql(record)));
      } catch (error) {
        if (appliedHashes.size === 0 && isRecoverableLegacyMigrationError(error)) {
          await seedDrizzleJournal(connection, migrationRecords);
          appliedHashes.clear();
          for (const seededRecord of migrationRecords) {
            appliedHashes.add(seededRecord.hash);
          }
          continue;
        }

        const fallbackPlan = await planLegacyBootstrapFallback(
          databaseFilePath,
          migrationRecords,
          error,
          record,
          migrationPath,
        );

        if (!fallbackPlan) {
          throw error;
        }

        await repairLegacyBootstrap(databaseFilePath, fallbackPlan);
        appliedHashes.add(record.hash);
        continue;
      }

      appliedHashes.add(record.hash);
    }
  } finally {
    connection.sqlite.close();
  }
}

const migrationFilesByTag = new Map<string, string>();

async function planLegacyBootstrapFallback(
  databaseFilePath: string | undefined,
  migrationRecords: MigrationRecord[],
  error: unknown,
  failingRecord?: MigrationRecord,
  failingMigrationPath?: string,
): Promise<LegacyBootstrapPlan | null> {
  if (!databaseFilePath) {
    return null;
  }

  if (!isRecoverableLegacyMigrationError(error)) {
    return null;
  }

  const existingTables = await listExistingTables(databaseFilePath);

  if (!existingTables.has('theses')) {
    return null;
  }

  const migrationJournal = await readMigrationJournalState(databaseFilePath);

  const [baseRecord] = migrationRecords;

  if (!baseRecord) {
    return null;
  }

  const baseDatabaseCoverage = classifyBaseMigrationCoverage(existingTables, baseRecord.tag);

  if (!baseDatabaseCoverage.isRecoverable) {
    return null;
  }

  if (
    failingRecord
    && failingMigrationPath
    && failingRecord.tag !== baseRecord.tag
    && !(await isRecoverableFollowupMigration(databaseFilePath, failingRecord, failingMigrationPath))
  ) {
    return null;
  }

  return {
    journalState: migrationJournal,
    baseRepairMigrationSql: await buildMissingBaseSchemaRepairSql(databaseFilePath, migrationRecords),
    recordsToSeed: failingRecord?.hash === baseRecord.hash
      ? migrationRecords
      : migrationRecords.filter((record) => {
        if (!failingRecord) {
          return false;
        }

        return record.createdAt >= failingRecord.createdAt;
      }),
  };
}

async function seedDrizzleJournal(connection: ReturnType<typeof createDatabaseConnection>, migrationRecords: MigrationRecord[]) {
  for (const record of migrationRecords) {
    await connection.db.run(sql.raw(buildInsertJournalSql(record)));
  }
}
async function isRecoverableFollowupMigration(
  databaseFilePath: string,
  record: MigrationRecord,
  migrationPath: string,
) {
  if (record.tag === '0002_claim_evidence_ordering_json') {
    const claimsColumns = await listTableColumns(databaseFilePath, 'claims');
    return claimsColumns.has('evidence_ordering_json');
  }

  if (record.tag === '0003_policy_workspace_and_citations') {
    const thesisColumns = await listTableColumns(databaseFilePath, 'theses');
    const existingTables = await listExistingTables(databaseFilePath);
    const existingIndexes = await listIndexes(databaseFilePath);

    return thesisColumns.has('policy_profile_id')
      && thesisColumns.has('official_workspace_path')
      && thesisColumns.has('official_entrypoint')
      && existingTables.has('citations')
      && existingIndexes.has('citations_thesis_key_idx');
  }

  if (record.tag === '0004_openclaw_assignments') {
    const thesisColumns = await listTableColumns(databaseFilePath, 'theses');
    const workflowPackColumns = await listTableColumns(databaseFilePath, 'workflow_packs');

    return thesisColumns.has('openclaw_agent_id')
      && thesisColumns.has('openclaw_session_key')
      && workflowPackColumns.has('openclaw_agent_id')
      && workflowPackColumns.has('openclaw_session_key');
  }

  const migrationStatements = fs
    .readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of migrationStatements) {
    if (statement.startsWith('PRAGMA ')) {
      continue;
    }

    if (statement.startsWith('CREATE TABLE `')) {
      const tableName = statement.match(/CREATE TABLE `([^`]+)`/i)?.[1];

      if (!tableName) {
        return false;
      }

      const existingTables = await listExistingTables(databaseFilePath);
      if (!existingTables.has(tableName)) {
        return false;
      }

      continue;
    }

    if (statement.startsWith('CREATE UNIQUE INDEX `') || statement.startsWith('CREATE INDEX `')) {
      const indexName = statement.match(/CREATE(?: UNIQUE)? INDEX `([^`]+)`/i)?.[1];

      if (!indexName) {
        return false;
      }

      const existingIndexes = await listIndexes(databaseFilePath);
      if (!existingIndexes.has(indexName)) {
        return false;
      }

      continue;
    }

    if (statement.startsWith('ALTER TABLE `')) {
      return false;
    }
  }

  return true;
}

async function listTableColumns(databaseFilePath: string, tableName: string) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    const rows = await connection.sqlite.execute(`pragma table_info('${tableName}')`);
    return new Set(rows.rows.map((row) => String(row.name)));
  } finally {
    connection.sqlite.close();
  }
}

async function listIndexes(databaseFilePath: string) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    const rows = await connection.sqlite.execute(
      "select name from sqlite_master where type='index' and name not like 'sqlite_%'",
    );
    return new Set(rows.rows.map((row) => String(row.name)));
  } finally {
    connection.sqlite.close();
  }
}


function isRecoverableLegacyMigrationError(error: unknown) {
  return (
    error instanceof Error
    && (
      /table [`"']?\w+[`"']? already exists/i.test(error.message)
      || /duplicate column name/i.test(error.message)
    )
  );
}

function buildMigrationRecord(migrationFile: string, migrationsFolder: string, journalIdx: number): MigrationRecord {
  const tag = path.basename(migrationFile, '.sql');
  const content = fs.readFileSync(path.join(migrationsFolder, migrationFile), 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  const createdAt = Number.parseInt(tag.split('_', 1)[0] ?? '0', 10);

  return {
    tag,
    hash,
    createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
    journalIdx,
  };
}

function readMigrationJournalTags() {
  const journal = JSON.parse(fs.readFileSync(DRIZZLE_JOURNAL_PATH, 'utf8')) as {
    entries?: Array<{ tag?: string }>;
  };

  const tags = journal.entries
    ?.map((entry) => entry.tag)
    .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);

  if (!tags || tags.length === 0) {
    throw new Error(`No migration entries found in ${DRIZZLE_JOURNAL_PATH}`);
  }

  return tags;
}

function classifyBaseMigrationCoverage(existingTables: Set<string>, baseTag?: string) {
  if (baseTag !== '0000_domain_core') {
    return { isRecoverable: false, isComplete: false };
  }

  const expectedTables = [
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

  const hasCoreTables = ['theses', 'claims'].every((table) => existingTables.has(table));
  const hasAllTables = expectedTables.every((table) => existingTables.has(table));

  return {
    isRecoverable: hasCoreTables,
    isComplete: hasAllTables,
  };
}


async function listExistingTables(databaseFilePath: string) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    const rows = await connection.db
      .get<{ tables: string }>(
        "select json_group_array(name) as tables from sqlite_master where type = 'table' and name not like 'sqlite_%'",
      );

    const parsed = rows?.tables ? JSON.parse(rows.tables) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } finally {
    connection.sqlite.close();
  }
}

async function readMigrationJournalState(databaseFilePath: string) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    const table = await connection.sqlite.execute(
      `select name from sqlite_master where type='table' and name='${DRIZZLE_JOURNAL_TABLE}'`,
    );

    const exists = table.rows.length > 0;

    if (!exists) {
      return { exists: false, hasEntries: false, hashes: new Set<string>() };
    }

    const count = await connection.sqlite.execute(`select count(*) as count from ${DRIZZLE_JOURNAL_TABLE}`);
    const hasEntries = Number(count.rows[0]?.count ?? 0) > 0;

    const rows = await connection.sqlite.execute(`select hash from ${DRIZZLE_JOURNAL_TABLE} order by created_at asc, id asc`);
    const hashes = new Set(rows.rows.map((row) => String(row.hash)));

    return {
      exists: true,
      hasEntries,
      hashes,
    };
  } finally {
    connection.sqlite.close();
  }
}

async function repairLegacyBootstrap(databaseFilePath: string, plan: LegacyBootstrapPlan) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    await connection.sqlite.execute(DRIZZLE_MIGRATION_TABLE_SQL);

    if (plan.baseRepairMigrationSql) {
      await connection.sqlite.executeMultiple(plan.baseRepairMigrationSql);
    }

    const existingRows = await connection.sqlite.execute(
      `select hash from ${DRIZZLE_JOURNAL_TABLE} order by created_at asc, id asc`,
    );
    const existingHashes = new Set(existingRows.rows.map((row) => String(row.hash)));

    const missingRecords = plan.recordsToSeed.filter(
      (record) => !plan.journalState.hashes.has(record.hash) && !existingHashes.has(record.hash),
    );

    for (const record of missingRecords) {
      await connection.db.run(sql.raw(buildInsertJournalSql(record)));
    }
  } finally {
    connection.sqlite.close();
  }
}

async function buildMissingBaseSchemaRepairSql(databaseFilePath: string, migrationRecords: MigrationRecord[]) {
  const [baseRecord] = migrationRecords;

  if (!baseRecord || baseRecord.tag !== '0000_domain_core') {
    return null;
  }

  const existingTables = await listExistingTables(databaseFilePath);
  const migrationFile = migrationFilesByTag.get(baseRecord.tag);

  if (!migrationFile) {
    return null;
  }

  const migrationPath = path.join(getMigrationsDirectory(), migrationFile);
  const migrationStatements = fs
    .readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  const missingStatements = migrationStatements.filter((statement) => {
    if (statement.startsWith('CREATE TABLE `')) {
      const tableName = statement.match(/CREATE TABLE `([^`]+)`/i)?.[1];
      return Boolean(tableName) && !existingTables.has(tableName as string);
    }

    if (statement.startsWith('CREATE UNIQUE INDEX `') || statement.startsWith('CREATE INDEX `')) {
      const tableName = statement.match(/ON `([^`]+)`/i)?.[1];
      return Boolean(tableName) && existingTables.has(tableName as string);
    }

    return false;
  });

  if (missingStatements.length === 0) {
    return null;
  }

  return `${missingStatements.join('\n--> statement-breakpoint\n')}\n`;
}

export async function inspectMigrationJournal(databaseUrl = process.env.DATABASE_URL) {
  const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
  const connection = createDatabaseConnection(normalizedDatabaseUrl);

  try {
    const table = await connection.sqlite.execute(
      `select name from sqlite_master where type='table' and name='${DRIZZLE_JOURNAL_TABLE}'`,
    );

    if (table.rows.length === 0) {
      return [] as Array<{ hash: string; createdAt: number }>;
    }

    const rows = await connection.sqlite.execute(
      `select hash, created_at from ${DRIZZLE_JOURNAL_TABLE} order by created_at asc, id asc`,
    );

    return rows.rows.map((row) => ({
      hash: String(row.hash),
      createdAt: Number(row.created_at ?? 0),
    }));
  } finally {
    connection.sqlite.close();
  }
}

function buildInsertJournalSql(record: MigrationRecord) {
  return `insert into ${DRIZZLE_JOURNAL_TABLE} (hash, created_at) values ('${record.hash}', ${record.journalIdx})`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            ok: true,
            databaseFile: result.filePath,
            migrationsFolder: result.migrationsFolder,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
