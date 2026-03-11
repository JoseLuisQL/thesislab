#!/usr/bin/env bash
set -euo pipefail
ACTION="${1:-}"
shift || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="/workspace"
TEXLIVE_BIN="/opt/texlive/texdir/bin/x86_64-linuxmusl"

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
    LATEX_BUILD_ROOT="${LATEX_BUILD_ROOT:-.}"
    CONTAINER_BUILD_ROOT="$WORKDIR/$LATEX_BUILD_ROOT"
    LATEX_BUILD_COMMAND="${LATEX_BUILD_COMMAND:-pdflatex --version}"
    docker run --rm \
      -e LATEX_BUILD_COMMAND \
      -v "$ROOT:$WORKDIR" \
      -w "$CONTAINER_BUILD_ROOT" \
      ghcr.io/xu-cheng/texlive-small:latest \
      /bin/sh -lc 'PATH="/opt/texlive/texdir/bin/x86_64-linuxmusl:$PATH"; export PATH; eval "$LATEX_BUILD_COMMAND"'
    ;;
  pandoc-probe)
    docker run --rm -t pandoc/core:3.1 --version
    ;;
  *)
    echo "Unsupported document action: $ACTION" >&2
    exit 1
    ;;
esac
