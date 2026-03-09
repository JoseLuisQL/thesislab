---
name: platform-worker
description: Builds and maintains repo scaffolding, Docker-first tooling, and cross-cutting platform infrastructure.
---

# Platform Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for repository scaffolding, workspace configuration, Docker-first tooling, service scripts, shared infrastructure, cross-cutting resilience, and other platform-level features that unblock the rest of the mission.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and relevant `.factory/library/*` notes before changing repo infrastructure.
2. Write tests or executable smoke checks first for the behavior you are adding. For platform features, this can be a shell-level smoke test, config validation test, or minimal API/web startup assertion if classic unit tests are not yet meaningful.
3. Implement in small slices. Keep the monorepo layout explicit and avoid magical scripts that depend on host-installed Node.js.
4. Update only the platform files required by the feature. Preserve Docker-first execution and approved port boundaries.
5. Run the relevant validation commands from `.factory/services.yaml`. At minimum, run install/test plus any lint/typecheck commands that exist.
6. If the feature touches startup/runtime behavior, start the affected service and verify the healthcheck or expected route manually.
7. In the handoff, be explicit about what infrastructure changed, what commands were run, and what future workers can rely on now.

## Example Handoff

```json
{
  "salientSummary": "Scaffolded the monorepo root plus containerized workspace scripts, then verified the API health endpoint comes up on port 3100 through the Docker-first workflow.",
  "whatWasImplemented": "Added the root workspace configuration, API/web app shells, package scripts expected by services.yaml, and Docker-first startup tooling so later workers can run install, test, lint, typecheck, and local services without host Node.js.",
  "whatWasLeftUndone": "The web shell still contains placeholder content and no domain routes yet.",
  "verification": {
    "commandsRun": [
      {
        "command": "./.factory/init.sh",
        "exitCode": 0,
        "observation": "Prepared the Docker-first workspace and confirmed required ports were free."
      },
      {
        "command": "./.factory/bin/node-toolchain.sh install",
        "exitCode": 0,
        "observation": "Installed workspace dependencies inside the Node 22 container."
      },
      {
        "command": "./.factory/bin/node-toolchain.sh test",
        "exitCode": 0,
        "observation": "Platform smoke tests passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Started the API service and requested http://localhost:3100/health",
        "observed": "Received 200 with the expected health payload from the containerized API service."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "apps/api/src/app.test.ts",
        "cases": [
          {
            "name": "GET /health returns the baseline readiness payload",
            "verifies": "The scaffolded API starts and exposes a deterministic health route for future validation."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Docker is unavailable or cannot start containers in this environment.
- The feature requires changing mission boundaries such as ports or off-limits resources.
- A platform decision would force workers to depend on unavailable host tooling.
