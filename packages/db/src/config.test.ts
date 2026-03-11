import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDatabaseFilePath, getMigrationsDirectory, getWorkspaceRoot } from './config.js';

describe('database config helpers', () => {
  it('defaults the SQLite file into the workspace data directory', () => {
    expect(getDatabaseFilePath(undefined)).toBe(
      path.resolve(getWorkspaceRoot(), 'data/thesis-research-os.sqlite'),
    );
  });

  it('resolves the source workspace root to the monorepo root', () => {
    expect(getWorkspaceRoot()).toBe(path.resolve(import.meta.dirname, '../..'));
  });

  it('resolves the built workspace root to the monorepo root instead of the packages directory', async () => {
    const { getWorkspaceRoot: getBuiltWorkspaceRoot } = await import('../dist/src/config.js');

    expect(getBuiltWorkspaceRoot()).toBe(path.resolve(import.meta.dirname, '../../..'));
  });

  it('resolves file: DATABASE_URL values against the workspace root', () => {
    expect(getDatabaseFilePath('file:./tmp/test.sqlite')).toBe(
      path.resolve(getWorkspaceRoot(), 'tmp/test.sqlite'),
    );
  });

  it('preserves absolute file: DATABASE_URL values for temp and persistent sqlite files', () => {
    expect(getDatabaseFilePath('file:/tmp/test.sqlite')).toBe('/tmp/test.sqlite');
  });

  it('exposes the package-local drizzle migrations folder', () => {
    expect(getMigrationsDirectory()).toBe(
      path.resolve(getWorkspaceRoot(), 'db/drizzle'),
    );
  });
});
