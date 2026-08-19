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
CLONE_HELPER="$HERE/clone-runtime-tree.py"
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

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

validate_tarball_dependencies() {
  tar -xOf "$1" package/package.json | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const manifest = JSON.parse(input);
      const unresolved = [];
      for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
          if (typeof spec === "string" && spec.startsWith("workspace:")) {
            unresolved.push(`${section}.${name}=${spec}`);
          }
        }
      }
      if (unresolved.length > 0) {
        console.error(`unresolved workspace dependencies: ${unresolved.join(", ")}`);
        process.exitCode = 1;
      }
    });
  '
}

case "$GATEWAY_HEALTH_ATTEMPTS" in
  ""|*[!0-9]*|0) echo "GATEWAY_HEALTH_ATTEMPTS must be a positive integer" >&2; exit 1 ;;
esac
case "$GATEWAY_HEALTH_INTERVAL_SECONDS" in
  ""|*[!0-9]*|0) echo "GATEWAY_HEALTH_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
case "$GATEWAY_PORT" in
  ""|*[!0-9]*|0) echo "GATEWAY_PORT must be a positive integer" >&2; exit 1 ;;
esac
[ -f "$CLONE_HELPER" ] || {
  echo "missing runtime clone helper: $CLONE_HELPER" >&2
  exit 1
}

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
CLONE_HELPER="$9"
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
BROWSER_IMAGE_PROMOTION_OWNED=0
CANDIDATE_BROWSER_IMAGE_ID=""

cleanup() {
  if [ "$CLEANUP_CANDIDATE" = "true" ]; then
    rm -f "$CANDIDATE_TARBALL"
    [ -n "$ENTRY_SOURCE" ] && rm -f "$ENTRY_SOURCE"
    rm -f "$CLONE_HELPER"
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

clone_runtime_tree() {
  python3 "$CLONE_HELPER" "$1" "$2"
}

validate_tarball_dependencies() {
  tar -xOf "$1" package/package.json | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const manifest = JSON.parse(input);
      const unresolved = [];
      for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
          if (typeof spec === "string" && spec.startsWith("workspace:")) {
            unresolved.push(`${section}.${name}=${spec}`);
          }
        }
      }
      if (unresolved.length > 0) {
        console.error(`unresolved workspace dependencies: ${unresolved.join(", ")}`);
        process.exitCode = 1;
      }
    });
  '
}

normalize_tarball_workspace_dependencies() {
  tarball="$1"
  package_root="$2"
  repack_dir="$(mktemp -d "$RECOVERY_DIR/package-repack.XXXXXX")"
  if ! tar -xzf "$tarball" -C "$repack_dir"; then
    rm -rf "$repack_dir"
    return 1
  fi
  if ! node - "$repack_dir/package/package.json" "$package_root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [manifestPath, packageRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
    if (typeof spec !== "string" || !spec.startsWith("workspace:")) {
      continue;
    }
    const dependencyManifest = path.join(
      packageRoot,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    const dependencyVersion = JSON.parse(
      fs.readFileSync(dependencyManifest, "utf8"),
    ).version;
    if (typeof dependencyVersion !== "string" || dependencyVersion.length === 0) {
      throw new Error(`missing installed version for workspace dependency ${name}`);
    }
    manifest[section][name] = dependencyVersion;
  }
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  then
    rm -rf "$repack_dir"
    return 1
  fi
  repacked="$repack_dir/repacked.tgz"
  if ! tar -czf "$repacked" -C "$repack_dir" package; then
    rm -rf "$repack_dir"
    return 1
  fi
  mv "$repacked" "$tarball"
  rm -rf "$repack_dir"
}

swap_runtime_trees() {
  python3 - swap "$1" "$2" <<'PY'
import ctypes
import os
import sys

current, restored = map(os.fsencode, sys.argv[2:4])
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
renamex_np = libc.renamex_np
renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
renamex_np.restype = ctypes.c_int
RENAME_SWAP = 0x00000002
if renamex_np(current, restored, RENAME_SWAP) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
PY
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

inspect_image_id() {
  local image="$1"
  local inspect_error_file="$RECOVERY_DIR/.image-inspect-error"
  local inspect_output=""
  local inspect_output_file="$RECOVERY_DIR/.image-inspect-output"
  INSPECTED_IMAGE_ID=""
  INSPECT_IMAGE_STATUS="error"
  rm -f "$inspect_error_file" "$inspect_output_file"
  if docker image inspect --format '{{.Id}}' "$image" \
    >"$inspect_output_file" 2>"$inspect_error_file"; then
    INSPECTED_IMAGE_ID="$(cat "$inspect_output_file")"
    INSPECT_IMAGE_STATUS="found"
    rm -f "$inspect_error_file" "$inspect_output_file"
    return 0
  fi
  inspect_output="$(cat "$inspect_error_file" 2>/dev/null || true)"
  rm -f "$inspect_error_file" "$inspect_output_file"
  case "$inspect_output" in
    *"No such image"*|*"No such object"*)
      INSPECT_IMAGE_STATUS="absent"
      return 0
      ;;
    *)
      echo "    ERROR: failed to inspect browser image $image: $inspect_output" >&2
      return 0
      ;;
  esac
}

rollback_and_exit() {
  original_status="$1"
  shift
  reason="$1"
  rollback_failed=0
  rollback_signal=""
  restart_blocked=0
  trap - ERR
  trap 'rollback_signal="${rollback_signal:+$rollback_signal,}INT"' INT
  trap 'rollback_signal="${rollback_signal:+$rollback_signal,}TERM"' TERM
  trap 'rollback_signal="${rollback_signal:+$rollback_signal,}HUP"' HUP
  set +e
  ROLLBACK_ACTIVE=1
  echo "    ERROR: $reason; rolling back from $RECOVERY_DIR" >&2

  if ! stop_gateway; then
    echo "    ERROR: rollback aborted before mutation because gateway shutdown was not confirmed" >&2
    echo "    ERROR: rollback was incomplete; recovery state remains at $RECOVERY_DIR" >&2
    exit "$original_status"
  fi
  if [ "$SNAPSHOT_READY" -eq 1 ]; then
    RESTORED_STATE="$RECOVERY_DIR/restored-runtime-state"
    rm -rf "$RESTORED_STATE"
    rm -rf "$FAILED_STATE"
    if [ ! -d "$STATE_DIR" ]; then
      echo "    ERROR: current runtime state is missing; refusing non-atomic restore" >&2
      rollback_failed=1
      restart_blocked=1
    elif ! clone_runtime_tree "$STATE_SNAPSHOT" "$RESTORED_STATE"; then
      rollback_failed=1
      restart_blocked=1
    elif ! swap_runtime_trees "$STATE_DIR" "$RESTORED_STATE"; then
      rollback_failed=1
      restart_blocked=1
    else
      mv "$RESTORED_STATE" "$FAILED_STATE" || rollback_failed=1
    fi
    cp -p "$PLIST_SNAPSHOT" "$GATEWAY_PLIST" || {
      rollback_failed=1
      restart_blocked=1
    }
  fi
  if [ "$SANDBOX_ENTRY_CHANGED" -eq 1 ]; then
    if [ "$SANDBOX_ENTRY_EXISTED" -eq 1 ]; then
      cp -p "$SANDBOX_ENTRY_BACKUP" "$SANDBOX_ENTRY_DEST" || {
        rollback_failed=1
        restart_blocked=1
      }
    else
      rm -f "$SANDBOX_ENTRY_DEST" || {
        rollback_failed=1
        restart_blocked=1
      }
    fi
  fi
  if [ "$BROWSER_IMAGE_PROMOTION_OWNED" -eq 1 ]; then
    if [ -n "$PREVIOUS_BROWSER_IMAGE_ID" ]; then
      docker tag "$PREVIOUS_BROWSER_IMAGE_ID" "$BROWSER_IMAGE" || {
        rollback_failed=1
        restart_blocked=1
      }
    else
      current_browser_image_id=""
      inspect_image_id "$BROWSER_IMAGE"
      if [ "$INSPECT_IMAGE_STATUS" = "found" ]; then
        current_browser_image_id="$INSPECTED_IMAGE_ID"
      elif [ "$INSPECT_IMAGE_STATUS" = "error" ]; then
        rollback_failed=1
        restart_blocked=1
      fi
      if [ "$restart_blocked" -eq 0 ] &&
         [ -n "$CANDIDATE_BROWSER_IMAGE_ID" ] &&
         [ "$current_browser_image_id" = "$CANDIDATE_BROWSER_IMAGE_ID" ]; then
        docker image rm "$BROWSER_IMAGE" >/dev/null 2>&1 || {
          rollback_failed=1
          restart_blocked=1
        }
      fi
    fi
    openclaw sandbox recreate --agent browser-agent --force || {
      rollback_failed=1
      restart_blocked=1
    }
    openclaw sandbox recreate --browser --agent browser-agent --force || {
      rollback_failed=1
      restart_blocked=1
    }
  fi
  if [ "$PACKAGE_CHANGED" -eq 1 ]; then
    npm install -g "$PREVIOUS_TARBALL" || {
      rollback_failed=1
      restart_blocked=1
    }
  fi
  if [ "$restart_blocked" -eq 1 ]; then
    echo "    ERROR: gateway restart skipped because critical rollback restoration failed" >&2
  elif ! restart_gateway; then
    echo "    ERROR: rollback gateway restart failed" >&2
    rollback_failed=1
  elif ! wait_for_gateway; then
    echo "    ERROR: rollback gateway health check failed" >&2
    rollback_failed=1
  fi
  if [ "$rollback_failed" -ne 0 ]; then
    echo "    ERROR: rollback was incomplete; recovery state remains at $RECOVERY_DIR" >&2
  fi
  if [ -n "$rollback_signal" ]; then
    echo "    rollback completed to a safe terminal state after deferred signal(s): $rollback_signal" >&2
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
    inspect_image_id "$BROWSER_IMAGE"
    if [ "$INSPECT_IMAGE_STATUS" = "found" ]; then
      PREVIOUS_BROWSER_IMAGE_ID="$INSPECTED_IMAGE_ID"
    elif [ "$INSPECT_IMAGE_STATUS" = "absent" ]; then
      PREVIOUS_BROWSER_IMAGE_ID=""
    else
      return 1
    fi
    BROWSER_IMAGE_OWNED=1
    docker build -f "$SANDBOX_BUILD/Dockerfile.sandbox-browser" \
      -t "$CANDIDATE_BROWSER_IMAGE" "$SANDBOX_BUILD" >/dev/null
    inspect_image_id "$CANDIDATE_BROWSER_IMAGE"
    [ "$INSPECT_IMAGE_STATUS" = "found" ] || return 1
    CANDIDATE_BROWSER_IMAGE_ID="$INSPECTED_IMAGE_ID"
    [ -n "$CANDIDATE_BROWSER_IMAGE_ID" ] || return 1
    BROWSER_IMAGE_PROMOTION_OWNED=1
    docker tag "$CANDIDATE_BROWSER_IMAGE" "$BROWSER_IMAGE"
    openclaw sandbox recreate --agent browser-agent --force
    openclaw sandbox recreate --browser --agent browser-agent --force
    echo "    browser image rebuilt + browser-agent recreated"
  else
    echo "    ERROR: docker and the sandbox-browser Dockerfile are required for the patched entrypoint" >&2
    return 1
  fi
}

[ -d "$STATE_DIR" ] || {
  echo "    ERROR: runtime state directory is missing: $STATE_DIR" >&2
  exit 1
}
[ ! -L "$STATE_DIR" ] || {
  echo "    ERROR: runtime state directory must not be a symlink: $STATE_DIR" >&2
  exit 1
}
[ -r "$GATEWAY_PLIST" ] || {
  echo "    ERROR: readable gateway service definition is missing: $GATEWAY_PLIST" >&2
  exit 1
}
python3 "$CLONE_HELPER" --validate-destination "$STATE_DIR" "$STATE_SNAPSHOT"

install -d -m 700 "$RECOVERY_DIR"
GLOBAL_ROOT="$(npm root -g)"
if [ -d "$GLOBAL_ROOT/openclaw" ]; then
  previous_name="$(npm pack "$GLOBAL_ROOT/openclaw" --ignore-scripts --silent --pack-destination "$RECOVERY_DIR" | tail -1)"
  PREVIOUS_TARBALL="$RECOVERY_DIR/$previous_name"
  [ -f "$PREVIOUS_TARBALL" ] || {
    echo "    ERROR: failed to preserve the currently installed package" >&2
    exit 1
  }
  normalize_tarball_workspace_dependencies "$PREVIOUS_TARBALL" "$GLOBAL_ROOT/openclaw" || {
    echo "    ERROR: failed to normalize the currently installed package snapshot" >&2
    exit 1
  }
  validate_tarball_dependencies "$PREVIOUS_TARBALL" || {
    echo "    ERROR: currently installed package snapshot is not reinstallable" >&2
    exit 1
  }
else
  echo "    ERROR: no existing OpenClaw package is available to snapshot" >&2
  exit 1
fi

GATEWAY_QUIESCED=1
stop_gateway
[ -d "$STATE_DIR" ] || rollback_and_exit 1 "runtime state directory is missing: $STATE_DIR"
[ ! -L "$STATE_DIR" ] || rollback_and_exit 1 "runtime state directory became a symlink: $STATE_DIR"
[ -r "$GATEWAY_PLIST" ] || rollback_and_exit 1 "readable gateway service definition is missing: $GATEWAY_PLIST"
clone_runtime_tree "$STATE_DIR" "$STATE_SNAPSHOT"
cp -p "$GATEWAY_PLIST" "$PLIST_SNAPSHOT"
SNAPSHOT_READY=1
echo "    recovery snapshot: $RECOVERY_DIR"
PACKAGE_CHANGED=1
npm install -g "$CANDIDATE_TARBALL" || rollback_and_exit "$?" "package installation failed"
OPENCLAW_SERVICE_REPAIR_POLICY=external \
  openclaw doctor --fix --yes </dev/null ||
  rollback_and_exit "$?" "required state migration failed"
if launchctl print "gui/$(id -u)/$GATEWAY_LABEL" >/dev/null 2>&1; then
  rollback_and_exit 1 "doctor activated the externally managed gateway"
fi
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
  file-lock-stale-reclaim-guard
  sessions-yield-block-and-gather
  subagent-cross-agent-spawn-fix
  skill-workshop-sandbox-fix
  imessage-message-part-coalescing
  sandbox-discovery-failure-fix
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

echo "==> Materializing patched dependencies"
pnpm install --frozen-lockfile

echo "==> Building from source (pnpm build)"
NODE_OPTIONS=--max-old-space-size=8192 pnpm build

echo "==> Packing"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/puddles-openclaw-deploy.XXXXXX")"
TARBALL="$(pnpm pack --config.ignore-scripts=true --pack-destination "$STAGING_DIR" | tail -1)"
case "$TARBALL" in
  /*) ;;
  *) TARBALL="$STAGING_DIR/$TARBALL" ;;
esac
[ -f "$TARBALL" ] || { echo "    pack produced no tarball" >&2; exit 1; }
validate_tarball_dependencies "$TARBALL" || {
  echo "    ERROR: candidate package contains unresolved workspace dependencies" >&2
  exit 1
}
TARBALL_NAME="$(basename "$TARBALL")"
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
  REMOTE_CLONE_HELPER="${REMOTE_TARBALL%.tgz}-clone-runtime-tree.py"
  scp "$TARBALL" "$MINI_HOST:$REMOTE_TARBALL"
  scp "$CLONE_HELPER" "$MINI_HOST:$REMOTE_CLONE_HELPER"
  if [ -n "$ENTRY_CANDIDATE" ]; then
    REMOTE_ENTRYPOINT="${REMOTE_TARBALL%.tgz}-sandbox-browser-entrypoint.sh"
    scp "$ENTRY_CANDIDATE" "$MINI_HOST:$REMOTE_ENTRYPOINT"
  fi
  REMOTE_COMMAND="/bin/bash -s --"
  for arg in \
    "$REMOTE_TARBALL" \
    "$GATEWAY_LABEL" \
    "$GATEWAY_PORT" \
    "$GATEWAY_HEALTH_ATTEMPTS" \
    "$GATEWAY_HEALTH_INTERVAL_SECONDS" \
    true \
    "$REMOTE_ENTRYPOINT" \
    "$MINI_SANDBOX_BUILD" \
    "$REMOTE_CLONE_HELPER"; do
    REMOTE_COMMAND="$REMOTE_COMMAND $(shell_quote "$arg")"
  done
  target_deploy_script |
    ssh "$MINI_HOST" "$REMOTE_COMMAND"
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
      "$MINI_SANDBOX_BUILD" \
      "$CLONE_HELPER"
fi

echo
echo "==> Deployed. Validate:"
if $REMOTE_DEPLOY; then
  echo "    ssh $MINI_HOST 'openclaw --version && openclaw cron run <id>'"
else
  echo "    openclaw --version && openclaw cron run <id>"
fi
