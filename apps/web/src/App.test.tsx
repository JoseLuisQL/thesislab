import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App', () => {
  it('renders the thesis workspace shell placeholder', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Local-first thesis workspace');
    expect(html).toContain('Memory &amp; resume');
    expect(html).toContain('LaTeX workbench');
  });

  it('renders copy that matches the Docker-first platform contract', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Thesis Research OS');
    expect(html).toContain('Baseline shell for the modular monorepo');
    expect(html).toContain('Future workers will extend these routes');
  });
});
