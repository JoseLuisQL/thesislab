---
name: document-worker
description: Implements import pipelines, LaTeX workspace operations, PDF extraction, and document-safety features.
---

# Document Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for intake/normalization, LaTeX discovery and editing, build/bibliography diagnostics, PDF extraction, and other document-centric features with path-safety or artifact requirements.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and the document/integration notes in `.factory/library/` before touching document flows.
2. Create failing tests first using fixtures. Prefer fixture-based parser tests, path-boundary tests, and artifact/history tests before implementation.
3. Canonicalize file paths before trust decisions. Explicitly test path traversal and symlink-escape cases where relevant.
4. For mutation features, verify checkpoint-before-mutation behavior and prove failure cases do not partially modify workspace files.
5. For build features, capture normalized diagnostics and preserve successful artifact history across later failures.
6. Run targeted tests, then run typecheck and any document-specific smoke commands that apply.
7. Exercise representative curl flows and, for file mutation features, compare file hashes or artifact metadata before and after operations.
8. In the handoff, cite the fixtures used, the exact safety checks performed, and any degraded toolchain behavior encountered.

## Example Handoff

```json
{
  "salientSummary": "Implemented LaTeX section editing with pre-mutation checkpoints and safe stale-target rejection, then verified failed edits leave workspace files unchanged.",
  "whatWasImplemented": "Added LaTeX section-target resolution, checkpoint creation before mutation, edit application with changed-range reporting, and restore-safe failure handling for ambiguous or stale targets.",
  "whatWasLeftUndone": "Compile/build diagnostics are still pending the next LaTeX build milestone feature.",
  "verification": {
    "commandsRun": [
      {
        "command": "./.factory/bin/node-toolchain.sh test",
        "exitCode": 0,
        "observation": "Fixture-based edit and restore tests passed, including path-boundary checks."
      },
      {
        "command": "./.factory/bin/node-toolchain.sh typecheck",
        "exitCode": 0,
        "observation": "Document service and route types are clean."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Computed fixture hashes, attempted a stale-target edit via curl, then recomputed hashes",
        "observed": "The API returned a safe conflict response and all intended target files remained byte-for-byte unchanged."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/latex-engine/src/editing.spec.ts",
        "cases": [
          {
            "name": "stale edit targets fail without mutating files",
            "verifies": "Failed mutation attempts preserve workspace file contents."
          },
          {
            "name": "path traversal references are blocked during discovery",
            "verifies": "LaTeX operations stay inside the thesis workspace boundary."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required fixture samples or containerized tool images are unavailable and cannot be replaced within the feature scope.
- The requested behavior would require reading or mutating files outside the allowed thesis workspace.
- The feature needs a policy decision about destructive import or restore semantics not already captured in the mission artifacts.
