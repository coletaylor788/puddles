#!/bin/bash

set -Eeuo pipefail

ACTION="install"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage:
  install-imessage-selfheal.sh [install] [--dry-run]
  install-imessage-selfheal.sh rollback [--dry-run]

Installs the direct iMessage health check and bounded recovery LaunchAgent.
Rollback restores the files that existed before the first managed install.
USAGE
}

if [ "${1:-}" = "install" ] || [ "${1:-}" = "rollback" ]; then
  ACTION="$1"
  shift
fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command in jq launchctl plutil; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $command" >&2
    exit 1
  }
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEALTH_SRC="$SCRIPT_DIR/imessage-healthcheck.sh"
SELFHEAL_SRC="$SCRIPT_DIR/imessage-selfheal.sh"
RETIRED_SRC="$SCRIPT_DIR/bluebubbles-selfheal-retired.sh"
PLIST_SRC="$SCRIPT_DIR/ai.openclaw.imessage-selfheal.plist"

BIN_DIR="$HOME/.local/bin"
HEALTH_DEST="$BIN_DIR/imessage-healthcheck.sh"
SELFHEAL_DEST="$BIN_DIR/imessage-selfheal.sh"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS_DIR/ai.openclaw.imessage-selfheal.plist"
LEGACY_DEST="$HOME/.openclaw/bin/bb-selfheal.sh"
LOG_DIR="$HOME/.openclaw/logs/imessage-health"
STATE_DIR="$HOME/.openclaw/imessage-selfheal"
RECOVERY_DIR="$STATE_DIR/install-recovery"
RECOVERY_FILE="$STATE_DIR/install-recovery.json"
LABEL="ai.openclaw.imessage-selfheal"
DOMAIN="gui/$(id -u)"

for source in "$HEALTH_SRC" "$SELFHEAL_SRC" "$RETIRED_SRC" "$PLIST_SRC"; do
  [ -f "$source" ] || {
    echo "ERROR: missing source file: $source" >&2
    exit 1
  }
done
/bin/bash -n "$HEALTH_SRC"
/bin/bash -n "$SELFHEAL_SRC"
/bin/bash -n "$RETIRED_SRC"
plutil -lint "$PLIST_SRC" >/dev/null

run_mutation() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

atomic_install() {
  local mode="$1"
  local source="$2"
  local destination="$3"
  local destination_dir temporary
  destination_dir="$(dirname "$destination")"
  run_mutation mkdir -p "$destination_dir"
  if [ "$DRY_RUN" -eq 1 ]; then
    run_mutation install -m "$mode" "$source" "$destination"
    return
  fi
  temporary="$(mktemp "$destination_dir/.imessage-selfheal.XXXXXX")"
  install -m "$mode" "$source" "$temporary"
  mv "$temporary" "$destination"
}

restore_path() {
  local present="$1"
  local backup="$2"
  local destination="$3"
  if [ "$present" = "true" ]; then
    atomic_install "$(stat -f '%Lp' "$backup")" "$backup" "$destination"
  else
    run_mutation rm -f "$destination"
  fi
}

rollback_action() {
  [ -f "$RECOVERY_FILE" ] || {
    echo "ERROR: no recovery state at $RECOVERY_FILE" >&2
    return 1
  }

  local health_present selfheal_present plist_present legacy_present
  health_present="$(jq -er '.healthPresent' "$RECOVERY_FILE")"
  selfheal_present="$(jq -er '.selfhealPresent' "$RECOVERY_FILE")"
  plist_present="$(jq -er '.plistPresent' "$RECOVERY_FILE")"
  legacy_present="$(jq -er '.legacyPresent' "$RECOVERY_FILE")"

  run_mutation launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  restore_path "$health_present" "$RECOVERY_DIR/imessage-healthcheck.sh" "$HEALTH_DEST"
  restore_path "$selfheal_present" "$RECOVERY_DIR/imessage-selfheal.sh" "$SELFHEAL_DEST"
  restore_path "$plist_present" "$RECOVERY_DIR/ai.openclaw.imessage-selfheal.plist" "$PLIST_DEST"
  restore_path "$legacy_present" "$RECOVERY_DIR/bb-selfheal.sh" "$LEGACY_DEST"

  if [ "$plist_present" = "true" ]; then
    run_mutation launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
  fi
  run_mutation rm -f "$RECOVERY_FILE"
  echo "Direct iMessage self-heal rolled back."
}

if [ "$ACTION" = "rollback" ]; then
  rollback_action
  exit 0
fi

PLIST_TMP="$(mktemp "${TMPDIR:-/tmp}/ai.openclaw.imessage-selfheal.XXXXXX")"
trap 'rm -f "$PLIST_TMP"' EXIT
cp "$PLIST_SRC" "$PLIST_TMP"
plutil -replace ProgramArguments.1 -string "$SELFHEAL_DEST" "$PLIST_TMP"
plutil -replace StandardOutPath -string "$LOG_DIR/selfheal.log" "$PLIST_TMP"
plutil -replace StandardErrorPath -string "$LOG_DIR/selfheal.err.log" "$PLIST_TMP"
plutil -replace EnvironmentVariables.HOME -string "$HOME" "$PLIST_TMP"
plutil -lint "$PLIST_TMP" >/dev/null

if [ ! -f "$RECOVERY_FILE" ] && [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$RECOVERY_DIR"
  chmod 700 "$STATE_DIR" "$RECOVERY_DIR"

  health_present=false
  selfheal_present=false
  plist_present=false
  legacy_present=false
  if [ -f "$HEALTH_DEST" ]; then
    cp -p "$HEALTH_DEST" "$RECOVERY_DIR/imessage-healthcheck.sh"
    health_present=true
  fi
  if [ -f "$SELFHEAL_DEST" ]; then
    cp -p "$SELFHEAL_DEST" "$RECOVERY_DIR/imessage-selfheal.sh"
    selfheal_present=true
  fi
  if [ -f "$PLIST_DEST" ]; then
    cp -p "$PLIST_DEST" "$RECOVERY_DIR/ai.openclaw.imessage-selfheal.plist"
    plist_present=true
  fi
  if [ -f "$LEGACY_DEST" ]; then
    cp -p "$LEGACY_DEST" "$RECOVERY_DIR/bb-selfheal.sh"
    legacy_present=true
  fi

  recovery_tmp="$(mktemp "$STATE_DIR/install-recovery.XXXXXX")"
  jq -n \
    --argjson healthPresent "$health_present" \
    --argjson selfhealPresent "$selfheal_present" \
    --argjson plistPresent "$plist_present" \
    --argjson legacyPresent "$legacy_present" \
    '{
      version: 1,
      healthPresent: $healthPresent,
      selfhealPresent: $selfhealPresent,
      plistPresent: $plistPresent,
      legacyPresent: $legacyPresent
    }' > "$recovery_tmp"
  chmod 600 "$recovery_tmp"
  mv "$recovery_tmp" "$RECOVERY_FILE"
fi

INSTALL_COMPLETE=0
rollback_failed_install() {
  local original_status=$?
  [ "$INSTALL_COMPLETE" -eq 0 ] || exit "$original_status"
  trap - ERR
  echo "ERROR: installation failed; restoring prior files." >&2
  if ! rollback_action; then
    echo "ERROR: rollback was incomplete; recovery state remains at $RECOVERY_FILE" >&2
  fi
  exit "$original_status"
}
trap rollback_failed_install ERR

run_mutation mkdir -p "$BIN_DIR" "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
atomic_install 0755 "$HEALTH_SRC" "$HEALTH_DEST"
atomic_install 0755 "$SELFHEAL_SRC" "$SELFHEAL_DEST"
atomic_install 0755 "$RETIRED_SRC" "$LEGACY_DEST"
atomic_install 0644 "$PLIST_TMP" "$PLIST_DEST"

run_mutation launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
run_mutation launchctl bootstrap "$DOMAIN" "$PLIST_DEST"

if [ "$DRY_RUN" -eq 0 ]; then
  "$HEALTH_DEST"
  launchctl print "$DOMAIN/$LABEL" >/dev/null
fi

INSTALL_COMPLETE=1
trap - ERR
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Direct iMessage self-heal install preview complete."
else
  echo "Direct iMessage self-heal installed."
  echo "Recovery state: $RECOVERY_FILE"
fi
