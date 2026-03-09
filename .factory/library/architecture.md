# Architecture

System-wide architectural notes for Thesis Research OS.

**What belongs here:** package boundaries, service ownership, domain rules, persistence conventions, and cross-cutting constraints.

---

## Target layout
- `apps/api` — Fastify API and orchestrating service layer
- `apps/web` — React/Vite UI shell and thesis workflow views
- `packages/db` — Drizzle schema, migrations, persistence helpers
- `packages/shared` — shared types, Zod schemas, utility helpers
- Domain packages for registry, memory, intake, LaTeX, research, Zotero, policy/QA, workflow orchestration, and evidence graph

## Core architectural constraints
- Local-first, single-user v1
- LaTeX is the official editable/compilable thesis output
- Evidence-first traceability is mandatory across claims, evidence, sources, citations, checkpoints, and findings
- Long-running flows use explicit status fields and durable run/job records
- Optional integrations must degrade explicitly rather than break core thesis workflows
