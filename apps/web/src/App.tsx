import { webShellCards } from '@thesis-research-os/shared';

export function App() {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Thesis Research OS</p>
        <h1>Local-first thesis workspace</h1>
        <p className="lede">
          Baseline shell for the modular monorepo. Future workers will extend
          these routes with thesis memory, intake, LaTeX, and QA workflows.
        </p>
      </header>

      <section className="grid" aria-label="Workspace foundations">
        {webShellCards.map((card) => (
          <article className="card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
