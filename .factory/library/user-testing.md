# User Testing

Testing surface notes for validators and workers.

**What belongs here:** URLs, startup order, validation limitations, test fixtures, and known testing constraints.

---

## Approved current strategy
- Validation is curl/API-first until browser automation becomes available in this environment.
- UI work should still be verified through route fetches and response artifacts proving thesis-scoped persisted data is rendered.

## Planned local URLs
- API: `http://localhost:3100`
- Web: `http://localhost:3101`

## Core manual/API checks
- Create/update thesis
- Create checkpoints and feedback, then fetch resume state
- Run intake jobs for LaTeX/DOCX/PDF fixtures
- Inspect LaTeX discovery/edit/build endpoints
- Register sources, extract evidence, and link claims
- Run policy/compliance and academic QA endpoints
- Fetch dashboard/thesis/intake/research/qa routes from the web app and confirm thesis-scoped content markers

## Limitations accepted by the user
- Browser/TUI automation is not currently available.
- Optional integrations may be unavailable; validators should expect explicit degraded states rather than treating that as silent failure.
