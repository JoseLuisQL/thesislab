const workflowCards = [
  {
    title: 'Create thesis',
    state: 'Available now',
    description: 'Start a new local-first thesis workspace with durable identity and metadata.',
  },
  {
    title: 'Import thesis',
    state: 'Available now',
    description: 'Bring existing LaTeX, DOCX, or PDF work into the workflow without optional connectors.',
  },
  {
    title: 'Resume work',
    state: 'Available now',
    description: 'Continue from persisted local state, checkpoints, and next-step guidance.',
  },
  {
    title: 'LaTeX workbench',
    state: 'Available now',
    description: 'Inspect, edit, and compile thesis files while keeping checkpointed workspace safety.',
  },
  {
    title: 'QA review',
    state: 'Available now',
    description: 'Run academic quality and policy review flows even when optional integrations are degraded.',
  },
] as const;

const integrationStatuses = [
  {
    title: 'Zotero connector',
    state: 'Degraded',
    summary: 'Mock connector only',
    detail:
      'Bibliography sync is intentionally degraded, but local thesis workflows remain usable from the first load.',
  },
  {
    title: 'External connector adapters',
    state: 'Degraded',
    summary: 'Optional adapters unavailable',
    detail:
      'Optional integrations stay visible as degraded instead of blocking local work.',
  },
] as const;

export function App() {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Thesis Research OS</p>
        <h1>Workflow dashboard</h1>
        <p className="lede">
          Core thesis workflows are available in local-first mode.
        </p>
        <p className="sublede">
          Replace optional connector assumptions with a usable starting surface
          for thesis creation, intake, continuation, LaTeX work, and QA review.
        </p>
      </header>

      <section className="status-banner" aria-label="Local-first posture">
        <strong>Local-first posture: ready</strong>
        <p>
          Core thesis workflows are available in local-first mode. Optional
          integrations stay visible as degraded instead of blocking local work.
        </p>
      </section>

      <section className="grid" aria-label="Core workflow entry points">
        {workflowCards.map((card) => (
          <article className="card" key={card.title}>
            <h2>{card.title}</h2>
            <p className="badge">{card.state}</p>
            <p>{card.description}</p>
          </article>
        ))}
      </section>

      <section className="integration-panel" aria-label="Degraded integrations">
        <div className="section-heading">
          <p className="eyebrow">Capability contract</p>
          <h2>Explicit degraded integration status</h2>
        </div>

        <div className="grid integration-grid">
          {integrationStatuses.map((integration) => (
            <article className="card integration-card" key={integration.title}>
              <div className="integration-header">
                <h3>{integration.title}</h3>
                <span className="status-pill degraded">{integration.state}</span>
              </div>
              <p className="badge">{integration.summary}</p>
              <p>{integration.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
