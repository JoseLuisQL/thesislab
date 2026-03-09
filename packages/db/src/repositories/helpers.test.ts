import { describe, expect, it, vi } from 'vitest';

import { createEntityId, createPersistenceHelpers, createTimestamp } from './helpers.js';

describe('persistence helpers', () => {
  it('creates durable UUID ids for repository callers', () => {
    const first = createEntityId();
    const second = createEntityId();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(second).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first).not.toBe(second);
  });

  it('normalizes timestamps to ISO-8601 strings', () => {
    expect(createTimestamp(new Date('2026-03-09T10:11:12.130Z'))).toBe('2026-03-09T10:11:12.130Z');
  });

  it('exposes stable helper functions through the shared factory', () => {
    const helpers = createPersistenceHelpers();
    const nowSpy = vi.spyOn(helpers, 'now');

    const id = helpers.createId();
    const now = helpers.now();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });
});
