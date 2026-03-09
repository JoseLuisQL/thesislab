import fs from 'node:fs';
import path from 'node:path';

import { migrate } from 'drizzle-orm/libsql/migrator';

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
  return migrate(connection.db, { migrationsFolder }).then(() => {
    connection.sqlite.close();

    return {
      filePath: connection.filePath,
      migrationsFolder,
      migrationFiles: migrationFiles.map((file) => path.join(migrationsFolder, file)),
    };
  });
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
