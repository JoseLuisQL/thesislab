# Integrations

Connector and tool-boundary notes.

**What belongs here:** OpenClaw/Zotero/Pandoc/LaTeX/PDF integration seams, degraded behavior expectations, and connector-mode assumptions.

---

## OpenClaw-first runtime boundary
- Design adapters so filesystem, shell, browser, and long-running task operations can be routed through an OpenClaw-aware layer later.
- Core local-first workflows must still work when optional external adapters are not configured.

## Zotero
- v1 uses a connector-neutral abstraction with mock/test/live-compatible normalized schemas.
- Failures must surface as explicit degraded states with preserved local mapping records.

## Document tooling
- DOCX/PDF normalization and LaTeX build flows are containerized.
- Path canonicalization and workspace-boundary checks are mandatory for intake and LaTeX operations.
