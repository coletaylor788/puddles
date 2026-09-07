#!/bin/bash

set -euo pipefail

usage() {
  echo "Usage: openclaw-release.sh --node <absolute-path> --private-pipeline <absolute-path> -- <release-arguments...>" >&2
  exit 64
}

[ "${1:-}" = "--node" ] || usage
NODE_BINARY="${2:-}"
[ "${3:-}" = "--private-pipeline" ] || usage
PUDDLES_PRIVATE_PIPELINE="${4:-}"
[ "${5:-}" = "--" ] || usage
shift 5
[ "$#" -gt 0 ] || usage

case "$NODE_BINARY" in
  /*) ;;
  *) echo "release Node path must be absolute" >&2; exit 64 ;;
esac
case "$PUDDLES_PRIVATE_PIPELINE" in
  /*) ;;
  *) echo "private pipeline path must be absolute" >&2; exit 64 ;;
esac
[ -x "$NODE_BINARY" ] || {
  echo "release Node path is not executable: $NODE_BINARY" >&2
  exit 64
}
[ -x "$PUDDLES_PRIVATE_PIPELINE" ] || {
  echo "private pipeline path is not executable: $PUDDLES_PRIVATE_PIPELINE" >&2
  exit 64
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
export PATH="$(dirname "$NODE_BINARY")${PATH:+:$PATH}"
export PUDDLES_PRIVATE_PIPELINE
exec "$NODE_BINARY" "$SCRIPT_DIR/openclaw-release.mjs" "$@"
