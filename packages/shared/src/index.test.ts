import { describe, expect, it } from 'vitest';

import { buildHealthPayload, webShellCards } from './index.js';

describe('shared scaffold helpers', () => {
  it('builds a health payload with mission context', () => {
    const payload = buildHealthPayload('foundation-platform');

    expect(payload.mission).toBe('foundation-platform');
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('provides placeholder cards for the web shell', () => {
    expect(webShellCards).toHaveLength(4);
    expect(webShellCards.map((card) => card.title)).toContain('Evidence & QA');
  });
});
