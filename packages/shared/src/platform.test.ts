import { describe, expect, it } from 'vitest';

import { buildHealthPayload, webShellCards } from './index.js';

describe('platform scaffolding contracts', () => {
  it('builds a timestamped health payload for manifest-based checks', () => {
    const payload = buildHealthPayload('foundation-platform');

    expect(payload.mission).toBe('foundation-platform');
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });

  it('exposes stable shell cards for the baseline web workspace', () => {
    expect(webShellCards).toHaveLength(4);
    expect(webShellCards.map((card) => card.title)).toEqual([
      'Memory & resume',
      'Intake & normalization',
      'LaTeX workbench',
      'Evidence & QA',
    ]);
  });
});
