---
name: backend-worker
description: Implements Fastify APIs, persistence-backed domain logic, workflow orchestration, Zotero mappings, and policy/QA behavior.
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for thesis lifecycle, memory, workflow tasks, evidence graph, Zotero abstraction/mappings, policy compliance, academic QA, and other backend/domain features built on Fastify + SQLite/Drizzle.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and relevant domain notes in `.factory/library/`.
2. Write failing tests first. Prefer repository/service tests plus API route tests that prove the validation-contract behavior for the feature.
3. Implement persistence changes before route wiring when schema updates are required. Add or update migrations deterministically.
4. Keep route handlers thin. Push business rules into service/use-case modules and use Zod validation at the API boundary.
5. Verify thesis scoping and deterministic ordering explicitly whenever the feature touches stored records.
6. Run tests, typecheck, and any targeted lint/build commands relevant to the changed area.
7. Start the API service if needed and execute representative curl flows for success, failure, and scoping cases.
8. Record the exact commands, observed payloads, and any unresolved gaps in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented thesis checkpoint and resume aggregation APIs backed by SQLite, then verified newest-first memory ordering and strict thesis scoping with curl.",
  "whatWasImplemented": "Added checkpoint persistence, feedback storage, and resume aggregation services plus Fastify endpoints that combine thesis state, latest checkpoint, recent feedback, blockers, and next-step summaries without cross-thesis leakage.",
  "whatWasLeftUndone": "Workflow-task context is not surfaced yet because the workflow-orchestration milestone has not started.",
  "verification": {
    "commandsRun": [
      {
        "command": "./.factory/bin/node-toolchain.sh test",
        "exitCode": 0,
        "observation": "Checkpoint, feedback, and resume route tests all passed."
      },
      {
        "command": "./.factory/bin/node-toolchain.sh typecheck",
        "exitCode": 0,
        "observation": "No type errors remained after wiring the new services and schemas."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Created two theses, added distinct checkpoints/feedback, then fetched each resume payload with curl",
        "observed": "Each payload showed only its own thesis records in newest-first order and returned the correct latest checkpoint reference."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "apps/api/src/modules/thesis/resume.routes.test.ts",
        "cases": [
          {
            "name": "resume payload includes latest checkpoint and recent feedback",
            "verifies": "Resume aggregation references persisted thesis-linked records instead of synthetic placeholders."
          },
          {
            "name": "resume endpoint rejects unknown thesis IDs",
            "verifies": "Unknown theses fail safely and do not fabricate continuation state."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature depends on unresolved platform scaffolding or missing schema entities outside the feature scope.
- The required behavior is ambiguous across thesis, task, evidence, or QA domains.
- The change would require violating thesis scoping, local-first guarantees, or mission boundaries.
