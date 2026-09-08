#!/bin/bash
# Activate an already rehearsed native artifact. Build and integration happen first.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
: "${OPENCLAW_CANDIDATE_RECEIPT:?set the exact cumulative candidate receipt path}"
: "${OPENCLAW_DEPLOY_TARGET:?set the local target JSON path}"

# Public patch order remains visible to the cumulative manifest regression.
PATCHES=(
  file-lock-stale-reclaim-guard
  sessions-yield-block-and-gather
  subagent-cross-agent-spawn-fix
  skill-workshop-sandbox-fix
  imessage-message-part-coalescing
  sandbox-discovery-failure-fix
  browser-userdata-dir-fix
  qmd-mcporter-per-agent
)

if [ -n "${MINI_HOST:-}" ]; then
  : "${PUDDLES_REMOTE_ROOT:?set the reviewed Puddles tooling path on the approved remote host}"
  printf -v command '%q ' node "$PUDDLES_REMOTE_ROOT/packages/e2e/bin/openclaw-activate.mjs" \
    "$OPENCLAW_CANDIDATE_RECEIPT" "$OPENCLAW_DEPLOY_TARGET"
  if [ -n "${OPENCLAW_RECOVERY_DIR:-}" ]; then
    printf -v recovery '%q' "$OPENCLAW_RECOVERY_DIR"
    command="$command $recovery"
  fi
  exec ssh "$MINI_HOST" "$command"
fi
args=("$OPENCLAW_CANDIDATE_RECEIPT" "$OPENCLAW_DEPLOY_TARGET")
if [ -n "${OPENCLAW_RECOVERY_DIR:-}" ]; then args+=("$OPENCLAW_RECOVERY_DIR"); fi
exec node "$ROOT/packages/e2e/bin/openclaw-activate.mjs" "${args[@]}"
