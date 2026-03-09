import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDatabaseFilePath, getMigrationsDirectory, getWorkspaceRoot } from './config.js';

describe('database config helpers', () => {
  it('defaults the SQLite file into the workspace data directory', () => {
    expect(getDatabaseFilePath(undefined)).toBe(
      path.resolve(getWorkspaceRoot(), 'data/thesis-research-os.sqlite'),
    );
  });

  it('resolves file: DATABASE_URL values against the workspace root', () => {
    expect(getDatabaseFilePath('file:./tmp/test.sqlite')).toBe(
      path.resolve(getWorkspaceRoot(), 'tmp/test.sqlite'),
    );
  });

  it('exposes the package-local drizzle migrations folder', () => {
    expect(getMigrationsDirectory()).toBe(
      path.resolve(getWorkspaceRoot(), 'packages/db/drizzle'),
    );
  });
});
