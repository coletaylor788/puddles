#!/bin/bash
# Apply all local OpenClaw patches to this Mac mini host and restart the gateway.
#
# Idempotent: re-running on already-patched dist files is a no-op for each patcher.
# Backups: each patcher writes its own .bak.<marker> sibling on first apply.
#
# Run on the mini directly (or via SSH). No arguments — discovers paths from the
# default Homebrew + npm-global layout.

set -euo pipefail

DIST="${OPENCLAW_DIST:-/Users/puddles/.npm-global/lib/node_modules/openclaw/dist}"
PRD_BASE="${OPENCLAW_PRD_BASE:-/Users/puddles/.openclaw/plugin-runtime-deps}"
NODE_CACHE="${OPENCLAW_NODE_CACHE:-/Users/puddles/.openclaw/tmp/node-compile-cache}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# List of patcher scripts to apply, in order. Each takes the dist dir as its sole arg.
PATCHERS=(
  "$HERE/apply-cron-announce-fix.mjs"
)

# Markers each patcher leaves in patched files (for verification).
# Format: "marker:per-file-expected-count[,filename-glob]". Counts are summed across matches.
MARKERS=(
  "FIX4"
)

[ -d "$DIST" ] || { echo "dist not found: $DIST"; exit 1; }

# Use Homebrew's node (matches the gateway's node) to apply patches.
PATH="/opt/homebrew/bin:$PATH"

for P in "${PATCHERS[@]}"; do
  [ -f "$P" ] || { echo "patcher missing: $P"; exit 1; }
  echo "==> $(basename "$P")"
  node "$P" "$DIST"
  echo
done

echo "==> Mirroring patched files into plugin-runtime-deps copy"
PRD_DIST=""
if [ -d "$PRD_BASE" ]; then
  PRD_DIST=$(find "$PRD_BASE" -type d -name dist -path "*openclaw-*" -mindepth 2 -maxdepth 3 2>/dev/null | head -1 || true)
fi
if [ -n "$PRD_DIST" ] && [ -d "$PRD_DIST" ]; then
  echo "    target: $PRD_DIST"
  for F in $(grep -l "FIX4" "$DIST"/*.js 2>/dev/null); do
    NAME=$(basename "$F")
    if [ -f "$PRD_DIST/$NAME" ]; then
      cp "$F" "$PRD_DIST/$NAME"
      echo "    copied $NAME"
    fi
  done
else
  echo "    (no plugin-runtime-deps dist mirror found under $PRD_BASE — skipping; not needed in OpenClaw 5.12+)"
fi

echo
echo "==> Clearing node compile cache"
if [ -d "$NODE_CACHE" ]; then
  find "$NODE_CACHE" -mindepth 2 -delete 2>/dev/null || true
  echo "    cleared $NODE_CACHE"
else
  echo "    (no compile cache at $NODE_CACHE — skipping)"
fi

echo
echo "==> Restarting OpenClaw gateway (LaunchAgent)"
if launchctl print "gui/$(id -u)/ai.openclaw.gateway" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"
  sleep 5
  PID=$(launchctl print "gui/$(id -u)/ai.openclaw.gateway" 2>&1 | awk -F"= " '/pid =/ {print $2; exit}')
  echo "    gateway restarted, PID=$PID"
else
  echo "    (no LaunchAgent ai.openclaw.gateway found in user domain — restart manually)"
fi

echo
echo "==> Verification: per-patch markers in deployed files"
echo "--- FIX4 (cron-announce) ---"
grep -l "FIX4" "$DIST"/*.js 2>/dev/null | while IFS= read -r F; do
  N=$(grep -c "FIX4" "$F" 2>/dev/null || true)
  echo "    $(basename "$F"): ${N:-0} markers"
done

echo
echo "Done. Run a cron job to validate (e.g. \`openclaw cron run <id>\`)."
