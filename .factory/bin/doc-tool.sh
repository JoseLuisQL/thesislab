#!/usr/bin/env bash
set -euo pipefail
ACTION="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="/workspace"

if [[ -z "$ACTION" ]]; then
  echo "Usage: $0 <latex-build|pandoc-probe>" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run document tooling." >&2
  exit 1
fi

case "$ACTION" in
  latex-build)
    docker run --rm -t -v "$ROOT:$WORKDIR" -w "$WORKDIR" ghcr.io/xu-cheng/texlive-small:latest bash -lc '${LATEX_BUILD_COMMAND:-latexmk -pdf -interaction=nonstopmode main.tex}'
    ;;
  pandoc-probe)
    docker run --rm -t pandoc/core:3.1 --version
    ;;
  *)
    echo "Unsupported document action: $ACTION" >&2
    exit 1
    ;;
esac
