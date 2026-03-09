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
    docker run -d \
      --name "$NAME" \
      -p "${PORT}:${PORT}" \
      -v "$ROOT:$WORKDIR" \
      -w "$WORKDIR" \
      -e "$ENV_NAME=$PORT" \
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
