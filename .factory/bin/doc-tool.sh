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
    RESOLVED_TMP_ROOT="$(python3 -c 'import os; print(os.path.realpath("/tmp"))')"
    if [[ "$LATEX_BUILD_ROOT" = /* ]]; then
      HOST_BUILD_ROOT="$LATEX_BUILD_ROOT"

      if [[ -n "${HOST_REPO_ROOT:-}" ]]; then
        RESOLVED_HOST_REPO_ROOT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$HOST_REPO_ROOT")"
        RESOLVED_HOST_BUILD_ROOT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$HOST_BUILD_ROOT")"
        if [[ "$RESOLVED_HOST_BUILD_ROOT" == "$RESOLVED_HOST_REPO_ROOT" ]]; then
          CONTAINER_BUILD_ROOT="$WORKDIR"
        elif [[ "$RESOLVED_HOST_BUILD_ROOT" == "$RESOLVED_HOST_REPO_ROOT/"* ]]; then
          CONTAINER_BUILD_ROOT="$WORKDIR/${RESOLVED_HOST_BUILD_ROOT#"$RESOLVED_HOST_REPO_ROOT"/}"
        elif [[ "$RESOLVED_HOST_BUILD_ROOT" == "$RESOLVED_TMP_ROOT" ]]; then
          CONTAINER_BUILD_ROOT="/tmp"
        elif [[ "$RESOLVED_HOST_BUILD_ROOT" == "$RESOLVED_TMP_ROOT/"* ]]; then
          CONTAINER_BUILD_ROOT="/tmp/${RESOLVED_HOST_BUILD_ROOT#"$RESOLVED_TMP_ROOT"/}"
        else
          CONTAINER_BUILD_ROOT="$RESOLVED_HOST_BUILD_ROOT"
        fi
      else
        CONTAINER_BUILD_ROOT="$HOST_BUILD_ROOT"
      fi
    else
      CONTAINER_BUILD_ROOT="$WORKDIR/$LATEX_BUILD_ROOT"
      HOST_BUILD_ROOT="$ROOT/$LATEX_BUILD_ROOT"
    fi
    LATEX_BUILD_COMMAND="${LATEX_BUILD_COMMAND:-pdflatex --version}"
    docker run --rm \
      -e LATEX_BUILD_COMMAND \
      -v "$ROOT:$WORKDIR" \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v /tmp:/tmp \
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
