import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App', () => {
  it('renders the workflow dashboard with local-first entry points', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Workflow dashboard');
    expect(html).toContain('Create thesis');
    expect(html).toContain('Import thesis');
    expect(html).toContain('Resume work');
    expect(html).toContain('LaTeX workbench');
    expect(html).toContain('QA review');
  });

  it('renders explicit local-first and degraded integration messaging', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Thesis Research OS');
    expect(html).toContain('Core thesis workflows are available in local-first mode.');
    expect(html).toContain('Optional integrations stay visible as degraded instead of blocking local work.');
    expect(html).toContain('Zotero connector');
    expect(html).toContain('Mock connector only');
    expect(html).toContain('External connector adapters');
    expect(html).toContain('Optional adapters unavailable');
  });
});
