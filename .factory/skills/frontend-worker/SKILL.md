---
name: frontend-worker
description: Builds the React/Vite thesis workspace UI with persisted-data rendering and route-specific empty/error states.
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for dashboard, thesis workspace, intake report, source/evidence, QA/compliance, and other user-facing web routes in `apps/web`.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and the user-testing guidance before changing UI routes or state management.
2. Write failing route/component tests first. Cover rendered persisted data, thesis scoping, and empty/error states.
3. Implement UI data loading through typed API clients or shared schemas; do not hardcode placeholder content that is not backed by persisted records.
4. Ensure route states differentiate populated, empty, loading, and failing cases with route-appropriate messaging.
5. Run tests plus typecheck and lint for the web app.
6. Start the web service when needed and verify routes by fetching HTML or app payloads after creating backend data through the API.
7. In the handoff, describe which persisted records were created to prove the route is not a placeholder and how empty/error states differ by route.

## Example Handoff

```json
{
  "salientSummary": "Built the thesis dashboard and thesis detail routes, then verified the rendered HTML reflects persisted thesis records and updates after backend state changes.",
  "whatWasImplemented": "Added dashboard and thesis workspace routes with API-backed loaders, thesis-scoped rendering, persisted status markers, and refresh behavior that surfaces newly created checkpoints and next-step context instead of static placeholders.",
  "whatWasLeftUndone": "Source/evidence and QA/compliance views are still pending the next UI feature.",
  "verification": {
    "commandsRun": [
      {
        "command": "./.factory/bin/node-toolchain.sh test",
        "exitCode": 0,
        "observation": "Route/component tests passed for dashboard rendering and thesis detail refresh behavior."
      },
      {
        "command": "./.factory/bin/node-toolchain.sh typecheck",
        "exitCode": 0,
        "observation": "Web app types are clean after adding route loaders and shared schemas."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Created a thesis and checkpoint through the API, fetched the dashboard and thesis routes, then fetched them again after a second checkpoint",
        "observed": "The HTML reflected the persisted thesis title and updated checkpoint-related markers on refresh, demonstrating real data binding rather than static route text."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "apps/web/src/routes/thesis-detail.test.tsx",
        "cases": [
          {
            "name": "renders persisted thesis-scoped data on the detail route",
            "verifies": "The route displays real thesis data and not route-only placeholders."
          },
          {
            "name": "shows route-specific empty state when no thesis exists",
            "verifies": "Empty-state messaging remains actionable and distinct for the route."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The required route depends on backend contracts or persisted data that do not exist yet.
- Validation cannot prove the route is data-backed because the relevant API or fixture data is missing.
- The requested UI behavior conflicts with the approved curl-first validation strategy or mission boundaries.
