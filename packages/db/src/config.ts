import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATABASE_RELATIVE_PATH = path.join('data', 'thesis-research-os.sqlite');

export function getWorkspaceRoot() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidateRoots = [
    path.resolve(moduleDirectory, moduleDirectory.includes(`${path.sep}dist${path.sep}`) ? '../../../..' : '../..'),
    path.resolve(moduleDirectory, moduleDirectory.includes(`${path.sep}dist${path.sep}`) ? '../../..' : '..'),
  ];

  for (const candidate of candidateRoots) {
    if (pathExists(path.join(candidate, 'package.json')) && pathExists(path.join(candidate, 'pnpm-workspace.yaml'))) {
      return candidate;
    }
  }

  return candidateRoots[0];
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
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirectories = [
    path.resolve(moduleDirectory, '../drizzle'),
    path.resolve(moduleDirectory, '../../drizzle'),
  ];

  for (const candidate of candidateDirectories) {
    const journalPath = path.join(candidate, 'meta', '_journal.json');

    if (pathExists(journalPath)) {
      return candidate;
    }
  }

  return candidateDirectories[0];
}

function pathExists(targetPath: string) {
  try {
    fs.statSync(targetPath);
    return true;
  } catch {
    return false;
  }
}
