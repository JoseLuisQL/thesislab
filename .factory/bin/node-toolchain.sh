#!/usr/bin/env bash
set -euo pipefail
ACTION="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${NODE_IMAGE:-node:22-bookworm}"
WORKDIR="/workspace"

if [[ -z "$ACTION" ]]; then
  echo "Usage: $0 <install|test|lint|typecheck|build|db:migrate|script>" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run workspace commands." >&2
  exit 1
fi

run_container() {
  docker run --rm -t     -v "$ROOT:$WORKDIR"     -w "$WORKDIR"     -e CI=1     "$IMAGE"     bash -lc "$1"
}

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "package.json not present yet; skipping $ACTION"
  exit 0
fi

case "$ACTION" in
  install)
    run_container 'corepack enable && pnpm install --frozen-lockfile=false'
    ;;
  test)
    run_container 'corepack enable && if node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"test:ci\"]?0:1)"; then pnpm run test:ci; elif node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"test\"]?0:1)"; then pnpm run test -- --runInBand; else echo "No test script configured yet; skipping"; fi'
    ;;
  lint)
    run_container 'corepack enable && if node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"lint\"]?0:1)"; then pnpm run lint; else echo "No lint script configured yet; skipping"; fi'
    ;;
  typecheck)
    run_container 'corepack enable && if node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"typecheck\"]?0:1)"; then pnpm run typecheck; else echo "No typecheck script configured yet; skipping"; fi'
    ;;
  build)
    run_container 'corepack enable && if node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"build\"]?0:1)"; then pnpm run build; else echo "No build script configured yet; skipping"; fi'
    ;;
  db:migrate)
    run_container 'corepack enable && if node -e "const fs=require(\"node:fs\"); const p=JSON.parse(fs.readFileSync(\"package.json\", \"utf8\")); process.exit(p.scripts&&p.scripts[\"db:migrate\"]?0:1)"; then pnpm run db:migrate; else echo "No db:migrate script configured yet; skipping"; fi'
    ;;
  *)
    run_container "corepack enable && pnpm run $ACTION"
    ;;
esac
