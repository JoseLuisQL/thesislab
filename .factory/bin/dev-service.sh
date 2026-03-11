#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-}"
SERVICE="${2:-}"
PORT="${3:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${NODE_IMAGE:-node:22-bookworm}"
WORKDIR="/workspace"
NAME="thesis-research-os-${SERVICE}-dev"
SCRIPT="dev:${SERVICE}"

if [[ -z "$MODE" || -z "$SERVICE" || -z "$PORT" ]]; then
  echo "Usage: $0 <start|stop> <api|web> <port>" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to manage dev services." >&2
  exit 1
fi

case "$MODE" in
  start)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ENV_NAME="PORT_${SERVICE^^}"
    HOST_REPO_ROOT_VALUE=""

    if [[ -n "${HOST_REPO_ROOT:-}" ]]; then
      HOST_REPO_ROOT_VALUE="$HOST_REPO_ROOT"
    else
      HOST_REPO_ROOT_VALUE="$ROOT"
    fi

    docker run -d \
      --name "$NAME" \
      -p "${PORT}:${PORT}" \
      -v "$ROOT:$WORKDIR" \
      -v "/tmp:/tmp" \
      -w "$WORKDIR" \
      -e "$ENV_NAME=$PORT" \
      -e "HOST_REPO_ROOT=$HOST_REPO_ROOT_VALUE" \
      "$IMAGE" \
      bash -lc "corepack enable && if [ ! -f package.json ]; then echo 'package.json missing' >&2; exit 1; fi; pnpm install --frozen-lockfile=false && pnpm run $SCRIPT"
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac
