import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATABASE_RELATIVE_PATH = path.join('data', 'thesis-research-os.sqlite');

export function getWorkspaceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function getDatabaseFilePath(databaseUrl = process.env.DATABASE_URL) {
  const workspaceRoot = getWorkspaceRoot();

  if (!databaseUrl || databaseUrl.trim() === '') {
    return path.resolve(workspaceRoot, DEFAULT_DATABASE_RELATIVE_PATH);
  }

  if (databaseUrl.startsWith('file:')) {
    const filePath = databaseUrl.slice('file:'.length);

    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    return path.resolve(workspaceRoot, filePath);
  }

  return path.resolve(workspaceRoot, databaseUrl);
}

export function getMigrationsDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
}
