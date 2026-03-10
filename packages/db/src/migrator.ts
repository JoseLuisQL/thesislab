import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';

import { createDatabaseConnection } from './client.js';
import { getMigrationsDirectory } from './config.js';

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

export function runMigrations(databaseUrl = process.env.DATABASE_URL) {
  const migrationsFolder = getMigrationsDirectory();
  fs.mkdirSync(migrationsFolder, { recursive: true });

  const migrationFiles = fs
    .readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No migration files found in ${migrationsFolder}`);
  }

  const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
  const connection = createDatabaseConnection(normalizedDatabaseUrl);
  return migrate(connection.db, { migrationsFolder }).catch(async (error: unknown) => {
    if (!(await shouldFallbackToLegacyBootstrap(connection.filePath, error))) {
      throw error;
    }

    await seedMigrationJournal(connection.filePath, migrationFiles, migrationsFolder);
    await migrate(connection.db, { migrationsFolder });
  }).then(() => {
    connection.sqlite.close();

    return {
      filePath: connection.filePath,
      migrationsFolder,
      migrationFiles: migrationFiles.map((file) => path.join(migrationsFolder, file)),
    };
  });
}

async function shouldFallbackToLegacyBootstrap(
  databaseFilePath: string | undefined,
  error: unknown,
) {
  if (!databaseFilePath) {
    return false;
  }

  if (!isDuplicateTableMigrationError(error)) {
    return false;
  }

  const existingTables = await listExistingTables(databaseFilePath);

  if (!existingTables.has('theses')) {
    return false;
  }

  const migrationJournal = await readMigrationJournalState(databaseFilePath);

  if (migrationJournal.hasEntries) {
    return false;
  }

  if (migrationJournal.exists) {
    return true;
  }

  return existingTables.size > 1;
}

function isDuplicateTableMigrationError(error: unknown) {
  return (
    error instanceof Error
    && /table [`"']?\w+[`"']? already exists/i.test(error.message)
  );
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
      "select name from sqlite_master where type='table' and name='__drizzle_migrations'",
    );

    const exists = table.rows.length > 0;

    if (!exists) {
      return { exists: false, hasEntries: false };
    }

    const count = await connection.sqlite.execute('select count(*) as count from __drizzle_migrations');
    const hasEntries = Number(count.rows[0]?.count ?? 0) > 0;

    return { exists: true, hasEntries };
  } finally {
    connection.sqlite.close();
  }
}

async function seedMigrationJournal(
  databaseFilePath: string,
  migrationFiles: string[],
  migrationsFolder: string,
) {
  const connection = createDatabaseConnection(`file:${databaseFilePath}`);

  try {
    await connection.sqlite.execute(
      'create table if not exists __drizzle_migrations (id integer primary key autoincrement, hash text not null, created_at numeric not null)',
    );

    const existing = await connection.sqlite.execute('select count(*) as count from __drizzle_migrations');
    const existingCount = Number(existing.rows[0]?.count ?? 0);

    if (existingCount > 0) {
      return;
    }

    for (const migrationFile of migrationFiles) {
      const tag = path.basename(migrationFile, '.sql');
      const content = fs.readFileSync(path.join(migrationsFolder, migrationFile), 'utf8');
      const hash = createHash('sha256').update(content).digest('hex');
      const createdAt = Number.parseInt(tag.split('_', 1)[0] ?? '0', 10);

      await connection.db.run(
        sql`insert into __drizzle_migrations (hash, created_at) values (${hash}, ${Number.isNaN(createdAt) ? 0 : createdAt})`,
      );
    }
  } finally {
    connection.sqlite.close();
  }
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
