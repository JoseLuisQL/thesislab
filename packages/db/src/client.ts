import fs from 'node:fs';
import path from 'node:path';

import { createClient, type Client as LibsqlClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';

import { getDatabaseFilePath } from './config.js';
import { schema } from './schema.js';

export type ThesisDbClient = LibSQLDatabase<typeof schema>;

export type DatabaseConnection = {
  sqlite: LibsqlClient;
  db: ThesisDbClient;
  filePath: string;
};

export function createDatabaseConnection(databaseUrl = process.env.DATABASE_URL): DatabaseConnection {
  const filePath = getDatabaseFilePath(databaseUrl);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const sqlite = createClient({
    url: `file:${filePath}`,
    intMode: 'number',
  });

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    filePath,
  };
}
