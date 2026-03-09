# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** required env vars, Docker/runtime assumptions, local-first constraints, connector modes, and host-environment limitations.
**What does NOT belong here:** service ports and command names managed in `.factory/services.yaml`.

---

- Host environment does not provide Node.js, Pandoc, LaTeX, SQLite CLI, or OCR binaries.
- Docker is the canonical execution layer for installs, tests, API/web services, and thesis tooling.
- Default `.env` values created by `.factory/init.sh`:
  - `PORT_API=3100`
  - `PORT_WEB=3101`
  - `DATABASE_URL=file:./data/thesis-research-os.sqlite`
  - `THESIS_DEFAULT_LANGUAGE=es`
  - `ZOTERO_CONNECTOR_MODE=mock`
- Treat external connectors such as Zotero or OpenClaw-specific runtime adapters as optional integrations with explicit degraded states.
