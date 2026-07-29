#!/bin/bash
# Build OpenClaw from SOURCE with the puddles patches, then deploy to the target host.
#
# This replaces the old in-place dist chunk-surgery flow. The patches are now
# version-controlled git-diff `.patch` files applied to an OpenClaw source
# checkout; we build from source, pack, and install the package locally by
# default, or on a remote target when MINI_HOST is explicitly set.
#
# Prereqs:
#   - An OpenClaw checkout at the TARGET RELEASE, clean tree, in $OPENCLAW_SRC
#     (e.g. `git -C <src> fetch && git -C <src> checkout <release-tag-or-sha>`).
#   - Build toolchain (pnpm + the Node in package.json `engines`) on THIS host.
#   - Docker on the target host for the browser image.
#   - For remote deploys only, SSH access to $MINI_HOST.
#
# Usage:
#   OPENCLAW_SRC=~/git/openclaw ./apply-and-deploy.sh
#   MINI_HOST=<target-host> OPENCLAW_SRC=~/git/openclaw ./apply-and-deploy.sh

set -euo pipefail

OPENCLAW_SRC="${OPENCLAW_SRC:?set OPENCLAW_SRC to your OpenClaw source checkout at the target release}"
MINI_HOST="${MINI_HOST:-}"
MINI_SANDBOX_BUILD="${MINI_SANDBOX_BUILD:-/Users/puddles/.openclaw/sandbox-build}"
REMOTE_STAGING_DIR="${REMOTE_STAGING_DIR:-/tmp}"
GATEWAY_LABEL="${GATEWAY_LABEL:-ai.openclaw.gateway}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_HEALTH_ATTEMPTS="${GATEWAY_HEALTH_ATTEMPTS:-30}"
GATEWAY_HEALTH_INTERVAL_SECONDS="${GATEWAY_HEALTH_INTERVAL_SECONDS:-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGING_DIR=""
SOURCE_LOCK_DIR=""
SOURCE_LOCK_ACQUIRED=false
REMOTE_DEPLOY=false
if [ -n "$MINI_HOST" ]; then
  REMOTE_DEPLOY=true
fi

cleanup_outer() {
  if [ -n "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
  fi
  if $SOURCE_LOCK_ACQUIRED; then
    rm -f "$SOURCE_LOCK_DIR/pid"
    rmdir "$SOURCE_LOCK_DIR" >/dev/null 2>&1 || true
  fi
}
trap cleanup_outer EXIT

case "$GATEWAY_HEALTH_ATTEMPTS" in
  ""|*[!0-9]*|0) echo "GATEWAY_HEALTH_ATTEMPTS must be a positive integer" >&2; exit 1 ;;
esac
case "$GATEWAY_HEALTH_INTERVAL_SECONDS" in
  ""|*[!0-9]*|0) echo "GATEWAY_HEALTH_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
case "$GATEWAY_PORT" in
  ""|*[!0-9]*|0) echo "GATEWAY_PORT must be a positive integer" >&2; exit 1 ;;
esac

target_deploy_script() {
  cat <<'TARGET_DEPLOY'
set -Eeuo pipefail

CANDIDATE_TARBALL="$1"
GATEWAY_LABEL="$2"
GATEWAY_PORT="$3"
HEALTH_ATTEMPTS="$4"
HEALTH_INTERVAL_SECONDS="$5"
CLEANUP_CANDIDATE="$6"
ENTRY_SOURCE="$7"
SANDBOX_BUILD="$8"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
BACKUP_ROOT="${OPENCLAW_DEPLOY_BACKUP_ROOT:-$HOME/.openclaw-deploy-backups}"
LOCK_DIR="${OPENCLAW_DEPLOY_LOCK_DIR:-$HOME/.openclaw-deploy.lock}"
GATEWAY_PLIST="$HOME/Library/LaunchAgents/$GATEWAY_LABEL.plist"
RECOVERY_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
PREVIOUS_TARBALL=""
STATE_SNAPSHOT="$RECOVERY_DIR/runtime-state"
PLIST_SNAPSHOT="$RECOVERY_DIR/$GATEWAY_LABEL.plist"
FAILED_STATE="$RECOVERY_DIR/failed-runtime-state"
SANDBOX_ENTRY_DEST="$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
SANDBOX_ENTRY_BACKUP="$RECOVERY_DIR/sandbox-browser-entrypoint.sh"
BROWSER_IMAGE="openclaw-sandbox-browser:bookworm-slim"
CANDIDATE_BROWSER_IMAGE="openclaw-sandbox-browser:puddles-deploy-$$"
PREVIOUS_BROWSER_IMAGE_ID=""
GATEWAY_QUIESCED=0
SNAPSHOT_READY=0
PACKAGE_CHANGED=0
ROLLBACK_ACTIVE=0
LOCK_ACQUIRED=0
SANDBOX_ENTRY_CHANGED=0
SANDBOX_ENTRY_EXISTED=0
BROWSER_IMAGE_OWNED=0
BROWSER_IMAGE_PROMOTED=0

cleanup() {
  if [ "$CLEANUP_CANDIDATE" = "true" ]; then
    rm -f "$CANDIDATE_TARBALL"
    [ -n "$ENTRY_SOURCE" ] && rm -f "$ENTRY_SOURCE"
  fi
  if [ "$BROWSER_IMAGE_OWNED" -eq 1 ] && command -v docker >/dev/null 2>&1; then
    docker image rm "$CANDIDATE_BROWSER_IMAGE" >/dev/null 2>&1 || true
  fi
  if [ "$LOCK_ACQUIRED" -eq 1 ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "    ERROR: another deployment holds $LOCK_DIR" >&2
  exit 1
fi
LOCK_ACQUIRED=1
printf '%s\n' "$$" > "$LOCK_DIR/pid"

wait_for_gateway() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if openclaw gateway health --port "$GATEWAY_PORT" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; then
      sleep "$HEALTH_INTERVAL_SECONDS"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

stop_gateway() {
  service="gui/$(id -u)/$GATEWAY_LABEL"
  if ! launchctl bootout "$service" 2>/dev/null; then
    if ! launchctl print "$service" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if ! launchctl print "$service" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; then
      sleep "$HEALTH_INTERVAL_SECONDS"
    fi
    attempt=$((attempt + 1))
  done
  echo "    ERROR: gateway shutdown did not complete after $HEALTH_ATTEMPTS attempts" >&2
  return 1
}

restart_gateway() {
  if launchctl print "gui/$(id -u)/$GATEWAY_LABEL" >/dev/null 2>&1; then
    return 0
  fi
  launchctl bootstrap "gui/$(id -u)" "$GATEWAY_PLIST"
}

rollback_and_exit() {
  original_status="$1"
  shift
  reason="$1"
  rollback_failed=0
  trap - ERR INT TERM HUP
  set +e
  ROLLBACK_ACTIVE=1
  echo "    ERROR: $reason; rolling back from $RECOVERY_DIR" >&2

  if ! stop_gateway; then
    echo "    ERROR: rollback aborted before mutation because gateway shutdown was not confirmed" >&2
    echo "    ERROR: rollback was incomplete; recovery state remains at $RECOVERY_DIR" >&2
    exit "$original_status"
  fi
  if [ "$PACKAGE_CHANGED" -eq 1 ]; then
    npm install -g "$PREVIOUS_TARBALL" || rollback_failed=1
  fi
  if [ "$SNAPSHOT_READY" -eq 1 ]; then
    state_move_failed=0
    rm -rf "$FAILED_STATE"
    if [ -e "$STATE_DIR" ]; then
      mv "$STATE_DIR" "$FAILED_STATE" || {
        rollback_failed=1
        state_move_failed=1
      }
    fi
    if [ "$state_move_failed" -eq 0 ]; then
      cp -cR "$STATE_SNAPSHOT" "$STATE_DIR" || rollback_failed=1
    fi
    cp -p "$PLIST_SNAPSHOT" "$GATEWAY_PLIST" || rollback_failed=1
  fi
  if [ "$SANDBOX_ENTRY_CHANGED" -eq 1 ]; then
    if [ "$SANDBOX_ENTRY_EXISTED" -eq 1 ]; then
      cp -p "$SANDBOX_ENTRY_BACKUP" "$SANDBOX_ENTRY_DEST" || rollback_failed=1
    else
      rm -f "$SANDBOX_ENTRY_DEST" || rollback_failed=1
    fi
  fi
  if [ "$BROWSER_IMAGE_PROMOTED" -eq 1 ]; then
    if [ -n "$PREVIOUS_BROWSER_IMAGE_ID" ]; then
      docker tag "$PREVIOUS_BROWSER_IMAGE_ID" "$BROWSER_IMAGE" || rollback_failed=1
    else
      docker image rm "$BROWSER_IMAGE" >/dev/null 2>&1 || rollback_failed=1
    fi
    openclaw sandbox recreate --agent browser-agent --force || rollback_failed=1
    openclaw sandbox recreate --browser --agent browser-agent --force || rollback_failed=1
  fi
  if ! restart_gateway; then
    echo "    ERROR: rollback gateway restart failed" >&2
    rollback_failed=1
  elif ! wait_for_gateway; then
    echo "    ERROR: rollback gateway health check failed" >&2
    rollback_failed=1
  fi
  if [ "$rollback_failed" -ne 0 ]; then
    echo "    ERROR: rollback was incomplete; recovery state remains at $RECOVERY_DIR" >&2
  fi
  exit "$original_status"
}

on_signal() {
  signal="$1"
  status="$2"
  if [ "$ROLLBACK_ACTIVE" -eq 0 ] && [ "$GATEWAY_QUIESCED" -eq 1 ]; then
    rollback_and_exit "$status" "deployment interrupted by $signal"
  fi
  exit "$status"
}

on_unexpected_error() {
  status="$?"
  line="$1"
  if [ "$ROLLBACK_ACTIVE" -eq 0 ] && [ "$GATEWAY_QUIESCED" -eq 1 ]; then
    rollback_and_exit "$status" "unexpected deployment failure at target-script line $line"
  fi
  exit "$status"
}
trap 'on_unexpected_error "$LINENO"' ERR
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'on_signal HUP 129' HUP

refresh_browser_sandbox() {
  if [ -z "$ENTRY_SOURCE" ] || [ ! -f "$ENTRY_SOURCE" ]; then
    echo "    (browser entrypoint not patched — skipping image rebuild)"
    return 0
  fi

  mkdir -p "$SANDBOX_BUILD/scripts"
  if [ -f "$SANDBOX_ENTRY_DEST" ]; then
    cp -p "$SANDBOX_ENTRY_DEST" "$SANDBOX_ENTRY_BACKUP"
    SANDBOX_ENTRY_EXISTED=1
  fi
  SANDBOX_ENTRY_CHANGED=1
  install -m 0755 "$ENTRY_SOURCE" "$SANDBOX_ENTRY_DEST"

  if command -v docker >/dev/null 2>&1 && [ -f "$SANDBOX_BUILD/Dockerfile.sandbox-browser" ]; then
    PREVIOUS_BROWSER_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BROWSER_IMAGE" 2>/dev/null || true)"
    BROWSER_IMAGE_OWNED=1
    docker build -f "$SANDBOX_BUILD/Dockerfile.sandbox-browser" \
      -t "$CANDIDATE_BROWSER_IMAGE" "$SANDBOX_BUILD" >/dev/null
    BROWSER_IMAGE_PROMOTED=1
    docker tag "$CANDIDATE_BROWSER_IMAGE" "$BROWSER_IMAGE"
    openclaw sandbox recreate --agent browser-agent --force
    openclaw sandbox recreate --browser --agent browser-agent --force
    echo "    browser image rebuilt + browser-agent recreated"
  else
    echo "    ERROR: docker and the sandbox-browser Dockerfile are required for the patched entrypoint" >&2
    return 1
  fi
}

install -d -m 700 "$RECOVERY_DIR"
GLOBAL_ROOT="$(npm root -g)"
if [ -d "$GLOBAL_ROOT/openclaw" ]; then
  previous_name="$(npm pack "$GLOBAL_ROOT/openclaw" --ignore-scripts --silent --pack-destination "$RECOVERY_DIR" | tail -1)"
  PREVIOUS_TARBALL="$RECOVERY_DIR/$previous_name"
  [ -f "$PREVIOUS_TARBALL" ] || {
    echo "    ERROR: failed to preserve the currently installed package" >&2
    exit 1
  }
else
  echo "    ERROR: no existing OpenClaw package is available to snapshot" >&2
  exit 1
fi

GATEWAY_QUIESCED=1
stop_gateway
[ -d "$STATE_DIR" ] || rollback_and_exit 1 "runtime state directory is missing: $STATE_DIR"
[ -f "$GATEWAY_PLIST" ] || rollback_and_exit 1 "gateway service definition is missing: $GATEWAY_PLIST"
cp -cR "$STATE_DIR" "$STATE_SNAPSHOT"
cp -p "$GATEWAY_PLIST" "$PLIST_SNAPSHOT"
SNAPSHOT_READY=1
echo "    recovery snapshot: $RECOVERY_DIR"
PACKAGE_CHANGED=1
npm install -g "$CANDIDATE_TARBALL" || rollback_and_exit "$?" "package installation failed"
openclaw doctor --fix --yes </dev/null || rollback_and_exit "$?" "required state migration failed"
refresh_browser_sandbox
restart_gateway || rollback_and_exit "$?" "gateway restart failed"
wait_for_gateway || rollback_and_exit "$?" "gateway did not become healthy on local port $GATEWAY_PORT after $HEALTH_ATTEMPTS attempts"
GATEWAY_QUIESCED=0
trap - ERR INT TERM HUP
echo "    installed + gateway healthy"
TARGET_DEPLOY
}

# Public source patches, applied in order to a clean checkout of the target release.
PATCHES=(
  sessions-yield-block-and-gather
  subagent-cross-agent-spawn-fix
  skill-workshop-sandbox-fix
  imessage-message-part-coalescing
  browser-userdata-dir-fix
)
# NOTE: apply-cron-announce-fix is intentionally NOT listed — it is under
# validate-then-decide review against this release (see cron-announce-fix.md).

SOURCE_LOCK_DIR="$(git -C "$OPENCLAW_SRC" rev-parse --path-format=absolute --git-path puddles-deploy.lock)"
if ! mkdir "$SOURCE_LOCK_DIR" 2>/dev/null; then
  echo "    ERROR: another deployment is building from $OPENCLAW_SRC" >&2
  exit 1
fi
SOURCE_LOCK_ACQUIRED=true
printf '%s\n' "$$" > "$SOURCE_LOCK_DIR/pid"

echo "==> Applying ${#PATCHES[@]} source patches to $OPENCLAW_SRC"
cd "$OPENCLAW_SRC"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "    ERROR: $OPENCLAW_SRC has uncommitted changes. Check out a clean target release first." >&2
  exit 1
fi
for p in "${PATCHES[@]}"; do
  f="$HERE/$p.patch"
  [ -f "$f" ] || { echo "    missing patch: $f" >&2; exit 1; }
  if git apply --check "$f" 2>/dev/null; then
    git apply "$f"
    echo "    applied $p"
  elif git apply --reverse --check "$f" 2>/dev/null; then
    echo "    already applied: $p (skipping)"
  else
    echo "    ERROR: $p does not apply to this checkout (upstream refactor?)." >&2
    exit 1
  fi
done

echo "==> Building from source (pnpm build)"
NODE_OPTIONS=--max-old-space-size=8192 pnpm build

echo "==> Packing"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/puddles-openclaw-deploy.XXXXXX")"
TARBALL_NAME="$(npm pack --silent --pack-destination "$STAGING_DIR" | tail -1)"
TARBALL="$STAGING_DIR/$TARBALL_NAME"
[ -f "$TARBALL" ] || { echo "    pack produced no tarball" >&2; exit 1; }
echo "    $TARBALL_NAME"

ENTRY_SRC="$OPENCLAW_SRC/scripts/sandbox-browser-entrypoint.sh"
ENTRY_CANDIDATE=""
if [ -f "$ENTRY_SRC" ] && grep -qE "FIX-BROWSER-(USERDATA-DIR|SINGLETON-CLEAN)" "$ENTRY_SRC"; then
  ENTRY_CANDIDATE="$ENTRY_SRC"
fi

if $REMOTE_DEPLOY; then
  echo "==> Installing on $MINI_HOST + migrating state + verifying gateway"
  REMOTE_TARBALL="$REMOTE_STAGING_DIR/puddles-openclaw-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM.tgz"
  REMOTE_ENTRYPOINT=""
  scp "$TARBALL" "$MINI_HOST:$REMOTE_TARBALL"
  if [ -n "$ENTRY_CANDIDATE" ]; then
    REMOTE_ENTRYPOINT="${REMOTE_TARBALL%.tgz}-sandbox-browser-entrypoint.sh"
    scp "$ENTRY_CANDIDATE" "$MINI_HOST:$REMOTE_ENTRYPOINT"
  fi
  target_deploy_script |
    ssh "$MINI_HOST" /bin/bash -s -- \
      "$REMOTE_TARBALL" \
      "$GATEWAY_LABEL" \
      "$GATEWAY_PORT" \
      "$GATEWAY_HEALTH_ATTEMPTS" \
      "$GATEWAY_HEALTH_INTERVAL_SECONDS" \
      true \
      "$REMOTE_ENTRYPOINT" \
      "$MINI_SANDBOX_BUILD"
else
  echo "==> Installing locally + migrating state + verifying gateway"
  target_deploy_script |
    /bin/bash -s -- \
      "$TARBALL" \
      "$GATEWAY_LABEL" \
      "$GATEWAY_PORT" \
      "$GATEWAY_HEALTH_ATTEMPTS" \
      "$GATEWAY_HEALTH_INTERVAL_SECONDS" \
      false \
      "$ENTRY_CANDIDATE" \
      "$MINI_SANDBOX_BUILD"
fi

echo
echo "==> Deployed. Validate:"
if $REMOTE_DEPLOY; then
  echo "    ssh $MINI_HOST 'openclaw --version && openclaw cron run <id>'"
else
  echo "    openclaw --version && openclaw cron run <id>"
fi
