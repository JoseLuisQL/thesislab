import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

const workflowEntryPoints = [
  'Create thesis',
  'Import thesis',
  'Resume work',
  'LaTeX workbench',
  'QA review',
] as const;

describe('App', () => {
  it('renders the workflow dashboard with local-first entry points', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Workflow dashboard');

    for (const title of workflowEntryPoints) {
      expect(html).toContain(title);
      expect(html).toContain('Available now');
    }
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
    expect(html).toContain('Local-first posture: ready');
    expect(html).toContain('Explicit degraded integration status');
  });

  it('renders route-useful workflow copy instead of a bare placeholder shell', () => {
    const html = renderToString(<App />);

    expect(html).toContain(
      'Replace optional connector assumptions with a usable starting surface',
    );
    expect(html).not.toContain('Baseline shell for the modular monorepo');
    expect(html).not.toContain('Future workers will extend these routes');
  });

  it('hydrates the dashboard content into the browser root for service smoke checks', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);

    root.render(<App />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Workflow dashboard');
    expect(container.textContent).toContain('Create thesis');
    expect(container.textContent).toContain('Local-first posture: ready');

    root.unmount();
    container.remove();
  });
});
