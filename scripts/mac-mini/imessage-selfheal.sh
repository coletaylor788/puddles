#!/bin/bash

set -Eeuo pipefail

HEALTHCHECK="${HEALTHCHECK:-$HOME/.local/bin/imessage-healthcheck.sh}"
OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"
IMSG_CMD="${IMSG_CMD:-imsg}"
STATE_DIR="${IMESSAGE_SELFHEAL_STATE_DIR:-$HOME/.openclaw/imessage-selfheal}"
RECOVERY_COOLDOWN_SECONDS="${RECOVERY_COOLDOWN_SECONDS:-3600}"
RECOVERY_TIMEOUT_SECONDS="${RECOVERY_TIMEOUT_SECONDS:-60}"
POST_RECOVERY_ATTEMPTS="${POST_RECOVERY_ATTEMPTS:-15}"
POST_RECOVERY_INTERVAL_SECONDS="${POST_RECOVERY_INTERVAL_SECONDS:-1}"
LAST_ATTEMPT_FILE="$STATE_DIR/last-recovery-at"
LOCK_DIR="$STATE_DIR/run.lock"

for value in \
  "$RECOVERY_COOLDOWN_SECONDS" \
  "$RECOVERY_TIMEOUT_SECONDS" \
  "$POST_RECOVERY_ATTEMPTS" \
  "$POST_RECOVERY_INTERVAL_SECONDS"; do
  case "$value" in
    ''|*[!0-9]*)
      echo "ERROR: recovery settings must be non-negative integers" >&2
      exit 2
      ;;
  esac
done
[ "$RECOVERY_TIMEOUT_SECONDS" -gt 0 ] || {
  echo "ERROR: recovery timeout must be positive" >&2
  exit 2
}
[ "$POST_RECOVERY_ATTEMPTS" -gt 0 ] || {
  echo "ERROR: post-recovery attempts must be positive" >&2
  exit 2
}

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(ts)] $*"
}

run_bounded() {
  local timeout_seconds="$1"
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" "$@"
}

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -r "$LOCK_DIR/pid" ]; then
    running_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$running_pid" ] && kill -0 "$running_pid" 2>/dev/null; then
      log "Another self-heal run is active"
      exit 0
    fi
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "ERROR: could not clear stale lock at $LOCK_DIR" >&2
    exit 1
  }
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
cleanup_lock() {
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_lock EXIT

gateway_ok=0
bridge_ok=0
"$HEALTHCHECK" gateway >/dev/null 2>&1 && gateway_ok=1
"$HEALTHCHECK" bridge >/dev/null 2>&1 && bridge_ok=1

if [ "$gateway_ok" -eq 1 ] && [ "$bridge_ok" -eq 1 ]; then
  rm -f "$LAST_ATTEMPT_FILE"
  log "Gateway and Messages bridge are healthy"
  exit 0
fi

now="$(date +%s)"
if [ -r "$LAST_ATTEMPT_FILE" ]; then
  last_attempt="$(cat "$LAST_ATTEMPT_FILE" 2>/dev/null || true)"
  case "$last_attempt" in
    ''|*[!0-9]*) last_attempt=0 ;;
  esac
  elapsed=$((now - last_attempt))
  if [ "$elapsed" -lt "$RECOVERY_COOLDOWN_SECONDS" ]; then
    remaining=$((RECOVERY_COOLDOWN_SECONDS - elapsed))
    log "Recovery remains degraded; refusing another mutation for ${remaining}s"
    "$HEALTHCHECK" || true
    exit 1
  fi
fi

attempt_tmp="$(mktemp "$STATE_DIR/last-recovery-at.XXXXXX")"
printf '%s\n' "$now" > "$attempt_tmp"
chmod 600 "$attempt_tmp"
mv "$attempt_tmp" "$LAST_ATTEMPT_FILE"

if [ "$bridge_ok" -eq 0 ]; then
  log "Messages bridge is unresponsive; relaunching Messages.app through imsg"
  run_bounded "$RECOVERY_TIMEOUT_SECONDS" \
    "$IMSG_CMD" launch --json >/dev/null 2>&1 || {
      log "Messages bridge relaunch failed"
      "$HEALTHCHECK" || true
      exit 1
    }
fi

if [ "$gateway_ok" -eq 0 ] || [ "$bridge_ok" -eq 0 ]; then
  log "Restarting the managed gateway service"
  run_bounded "$RECOVERY_TIMEOUT_SECONDS" \
    "$OPENCLAW_CMD" gateway restart >/dev/null 2>&1 || {
      log "Gateway restart failed"
      "$HEALTHCHECK" || true
      exit 1
    }
fi

for _attempt in $(seq 1 "$POST_RECOVERY_ATTEMPTS"); do
  if "$HEALTHCHECK" >/dev/null 2>&1; then
    rm -f "$LAST_ATTEMPT_FILE"
    log "Gateway and Messages bridge recovered"
    exit 0
  fi
  sleep "$POST_RECOVERY_INTERVAL_SECONDS"
done

log "Recovery finished but the service remains degraded"
"$HEALTHCHECK" || true
exit 1
