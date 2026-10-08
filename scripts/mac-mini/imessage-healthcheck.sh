#!/bin/bash

set -u

COMPONENT="${1:-all}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_TIMEOUT_SECONDS="${GATEWAY_TIMEOUT_SECONDS:-10}"
BRIDGE_TIMEOUT_SECONDS="${BRIDGE_TIMEOUT_SECONDS:-10}"
OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"
IMSG_CMD="${IMSG_CMD:-imsg}"
JQ_CMD="${JQ_CMD:-jq}"

case "$COMPONENT" in
  all|gateway|bridge) ;;
  *)
    echo "ERROR: component must be all, gateway, or bridge" >&2
    exit 2
    ;;
esac

for value in "$GATEWAY_PORT" "$GATEWAY_TIMEOUT_SECONDS" "$BRIDGE_TIMEOUT_SECONDS"; do
  case "$value" in
    ''|*[!0-9]*|0)
      echo "ERROR: ports and timeouts must be positive integers" >&2
      exit 2
      ;;
  esac
done

run_bounded() {
  local timeout_seconds="$1"
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" "$@"
}

problems=0

check_gateway() {
  if run_bounded "$GATEWAY_TIMEOUT_SECONDS" \
    "$OPENCLAW_CMD" gateway health --port "$GATEWAY_PORT" >/dev/null 2>&1; then
    echo "OK: gateway health probe completed"
  else
    echo "FAIL: gateway health probe failed"
    problems=$((problems + 1))
  fi
}

check_bridge() {
  local account
  if ! account="$(
    run_bounded "$BRIDGE_TIMEOUT_SECONDS" "$IMSG_CMD" account --json 2>/dev/null
  )"; then
    echo "FAIL: Messages bridge account probe timed out or failed"
    problems=$((problems + 1))
    return
  fi

  if printf '%s' "$account" | "$JQ_CMD" -e '
    (.service? | type == "string" and length > 0)
    and (.login? | type == "string" and length > 0)
  ' >/dev/null 2>&1; then
    echo "OK: Messages bridge account probe completed"
  else
    echo "FAIL: Messages bridge account probe returned an incomplete response"
    problems=$((problems + 1))
  fi
}

if [ "$COMPONENT" = "all" ] || [ "$COMPONENT" = "gateway" ]; then
  check_gateway
fi
if [ "$COMPONENT" = "all" ] || [ "$COMPONENT" = "bridge" ]; then
  check_bridge
fi

if [ "$problems" -eq 0 ]; then
  echo "RESULT: HEALTHY"
  exit 0
fi

echo "RESULT: $problems problem(s) detected"
exit 1
