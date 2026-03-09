#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for this mission but is not available on PATH." >&2
  exit 1
fi

mkdir -p "$ROOT/.factory/tmp" "$ROOT/.factory/logs" "$ROOT/.factory/state" "$ROOT/data" "$ROOT/artifacts"

for port in 3100 3101 3102; do
  if command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -Eq ":${port}$"; then
    echo "Warning: mission port ${port} is already in use; verify it belongs to this workspace before starting services." >&2
  fi
done

if [ ! -f "$ROOT/.env" ]; then
  cat > "$ROOT/.env" <<'EOF'
PORT_API=3100
PORT_WEB=3101
DATABASE_URL=file:./data/thesis-research-os.sqlite
THESIS_DEFAULT_LANGUAGE=es
ZOTERO_CONNECTOR_MODE=mock
EOF
fi

echo "Mission init complete. Docker-first workspace prepared at $ROOT."
