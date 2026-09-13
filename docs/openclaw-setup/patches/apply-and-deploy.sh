#!/bin/bash
# Activate an already rehearsed native artifact. Build and integration happen first.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
: "${OPENCLAW_CANDIDATE_RECEIPT:?set the exact cumulative candidate receipt path}"
: "${OPENCLAW_DEPLOY_TARGET:?set the local target JSON path}"
case "${OPENCLAW_DEPLOY_ACTION:-activate}" in
  activate) ;;
  rollback) : "${OPENCLAW_RECOVERY_DIR:?explicit rollback requires the completed activation recovery directory}" ;;
  *) echo "OPENCLAW_DEPLOY_ACTION must be activate or rollback" >&2; exit 1 ;;
esac

# Public patch order remains visible to the cumulative manifest regression.
PATCHES=(
  managed-local-service-lifecycle
  gateway-memory-warmup
  file-lock-stale-reclaim-guard
  sessions-yield-block-and-gather
  sessions-yield-durable-handoff
  subagent-cross-agent-spawn-fix
  skill-workshop-sandbox-fix
  imessage-message-part-coalescing
  sandbox-discovery-failure-fix
  browser-userdata-dir-fix
  builtin-memory-migration
  silent-reply-completion-evidence
  stopped-state-migration-sdk
  scoped-container-temp-root
  active-memory-cold-recall
  active-memory-fixture-cleanup
)

if [ -n "${MINI_HOST:-}" ]; then
  : "${PUDDLES_REMOTE_ROOT:?set the reviewed Puddles tooling path on the approved remote host}"
  remote_node="${PUDDLES_REMOTE_NODE:-node}"
  if [ -n "${PUDDLES_REMOTE_NODE:-}" ] && [[ "$remote_node" != /* ]]; then
    echo "PUDDLES_REMOTE_NODE must be an absolute executable path" >&2
    exit 1
  fi
  remote_args=()
  if [ -n "${PUDDLES_REMOTE_PATH:-}" ]; then remote_args+=(env "PATH=$PUDDLES_REMOTE_PATH"); fi
  remote_args+=("$remote_node" "$PUDDLES_REMOTE_ROOT/packages/e2e/bin/openclaw-activate.mjs" \
    "$OPENCLAW_CANDIDATE_RECEIPT" "$OPENCLAW_DEPLOY_TARGET")
  if [ -n "${OPENCLAW_RECOVERY_DIR:-}" ]; then
    remote_args+=("$OPENCLAW_RECOVERY_DIR")
  fi
  if [ "${OPENCLAW_DEPLOY_ACTION:-activate}" = rollback ]; then remote_args+=(--rollback); fi
  printf -v command '%q ' "${remote_args[@]}"
  exec ssh "$MINI_HOST" "$command"
fi
args=("$OPENCLAW_CANDIDATE_RECEIPT" "$OPENCLAW_DEPLOY_TARGET")
if [ -n "${OPENCLAW_RECOVERY_DIR:-}" ]; then args+=("$OPENCLAW_RECOVERY_DIR"); fi
if [ "${OPENCLAW_DEPLOY_ACTION:-activate}" = rollback ]; then args+=(--rollback); fi
exec node "$ROOT/packages/e2e/bin/openclaw-activate.mjs" "${args[@]}"
