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
SANDBOX_BUILD="${OPENCLAW_SANDBOX_BUILD:-/Users/puddles/.openclaw/sandbox-build}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Upstream source for sandbox-build files (not shipped in the npm package, per
# docs/gateway/sandboxing.md). Pinned to a SHA for reproducibility; override
# OPENCLAW_SANDBOX_REF to test a newer revision. Bump deliberately.
SANDBOX_BUILD_UPSTREAM_REPO="${OPENCLAW_SANDBOX_REPO:-openclaw/openclaw}"
SANDBOX_BUILD_UPSTREAM_REF="${OPENCLAW_SANDBOX_REF:-229490a4892460fd439fcde3b94265ae68b5e779}"

# Patchers that mutate files under DIST. Each takes the dist dir as arg.
PATCHERS=(
  "$HERE/apply-cron-announce-fix.mjs"
  "$HERE/apply-subagent-cross-agent-spawn-fix.mjs"
  "$HERE/apply-skill-workshop-sandbox-fix.mjs"
)

# Patchers that mutate files under SANDBOX_BUILD. Each takes the sandbox-build
# dir as arg. Trigger a rebuild + recreate phase below.
SANDBOX_BUILD_PATCHERS=(
  "$HERE/apply-browser-userdata-dir-fix.mjs"
)

# Markers each patcher leaves in patched files (for verification).
# Format: "marker:per-file-expected-count[,filename-glob]". Counts are summed across matches.
MARKERS=(
  "FIX4"
  "FIX-SUBAGENT-CROSS-AGENT-SCOPE"
  "FIX-SKILL-WORKSHOP-IN-SANDBOX"
  "FIX-BROWSER-USERDATA-DIR"
  "FIX-BROWSER-SINGLETON-CLEAN"
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

# Refresh sandbox-build/{Dockerfile.sandbox-browser,scripts/sandbox-browser-entrypoint.sh}
# from upstream BEFORE running patchers. These files aren't shipped in the npm
# package, so without this we end up with whatever ancient snapshot first
# populated the dir, and miss upstream-required changes (e.g., the
# 2026-05-12-cdp-relay-auth contract label that 5.20+ enforces).
#
# fetch_if_changed: writes the upstream file only if content differs from local;
# backs up any pre-existing local file once (.bak.pre-upstream-bootstrap) so
# manual edits survive the first auto-fetch. Subsequent runs with the same SHA
# are no-ops.
fetch_if_changed() {
  local url="$1" dest="$2" tmp
  tmp="$(mktemp "${dest}.new.XXXXXX")"
  if ! curl -sSfL "$url" -o "$tmp"; then
    rm -f "$tmp"
    echo "    FAILED to fetch $url"
    return 1
  fi
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
  else
    if [ -f "$dest" ] && [ ! -f "$dest.bak.pre-upstream-bootstrap" ]; then
      cp "$dest" "$dest.bak.pre-upstream-bootstrap"
    fi
    mv "$tmp" "$dest"
    echo "    updated $dest"
  fi
}

echo "==> Refreshing sandbox-build from upstream (${SANDBOX_BUILD_UPSTREAM_REPO}@${SANDBOX_BUILD_UPSTREAM_REF:0:12})"
mkdir -p "$SANDBOX_BUILD/scripts"
BASE_URL="https://raw.githubusercontent.com/${SANDBOX_BUILD_UPSTREAM_REPO}/${SANDBOX_BUILD_UPSTREAM_REF}"
fetch_if_changed "$BASE_URL/scripts/docker/sandbox/Dockerfile.browser" \
  "$SANDBOX_BUILD/Dockerfile.sandbox-browser"
fetch_if_changed "$BASE_URL/scripts/sandbox-browser-entrypoint.sh" \
  "$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
chmod +x "$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
echo

for P in "${SANDBOX_BUILD_PATCHERS[@]}"; do
  [ -f "$P" ] || { echo "patcher missing: $P"; exit 1; }
  echo "==> $(basename "$P")"
  node "$P" "$SANDBOX_BUILD"
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

# Rebuild the sandbox-browser image + recreate browser-agent if the entrypoint
# patch is in place. Docker build is layer-cached, so this is cheap on no-op runs.
echo
echo "==> Sandbox-browser image refresh (if entrypoint is patched)"
ENTRYPOINT="$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
if [ -f "$ENTRYPOINT" ] && grep -qE "FIX-BROWSER-(USERDATA-DIR|SINGLETON-CLEAN)" "$ENTRYPOINT" 2>/dev/null; then
  if command -v docker >/dev/null 2>&1; then
    echo "    rebuilding openclaw-sandbox-browser:bookworm-slim..."
    docker build -f "$SANDBOX_BUILD/Dockerfile.sandbox-browser" \
      -t openclaw-sandbox-browser:bookworm-slim "$SANDBOX_BUILD" >/dev/null
    echo "    image rebuilt"
    if command -v openclaw >/dev/null 2>&1; then
      echo "    recreating browser-agent sandboxes (regular + browser)..."
      # --agent only removes the regular sandbox. Need a second call with
      # --browser to also remove the browser-sandbox container so it picks up
      # the new image + bind + env on next use.
      openclaw sandbox recreate --agent browser-agent --force || true
      openclaw sandbox recreate --browser --agent browser-agent --force || true
      echo "    browser-agent recreated"
    else
      echo "    (openclaw CLI not on PATH — recreate manually:"
      echo "       openclaw sandbox recreate --agent browser-agent --force"
      echo "       openclaw sandbox recreate --browser --agent browser-agent --force)"
    fi
  else
    echo "    (docker not on PATH — rebuild manually)"
  fi
else
  echo "    (entrypoint not patched or not found — skipping rebuild)"
fi

echo
echo "==> Verification: per-patch markers in deployed files"
echo "--- FIX4 (cron-announce) ---"
grep -l "FIX4" "$DIST"/*.js 2>/dev/null | while IFS= read -r F; do
  N=$(grep -c "FIX4" "$F" 2>/dev/null || true)
  echo "    $(basename "$F"): ${N:-0} markers"
done

echo "--- FIX-SUBAGENT-CROSS-AGENT-SCOPE (subagent-spawn) ---"
if grep -l "FIX-SUBAGENT-CROSS-AGENT-SCOPE" "$DIST"/*.js 2>/dev/null | grep -q .; then
  grep -l "FIX-SUBAGENT-CROSS-AGENT-SCOPE" "$DIST"/*.js 2>/dev/null | while IFS= read -r F; do
    N=$(grep -c "FIX-SUBAGENT-CROSS-AGENT-SCOPE" "$F" 2>/dev/null || true)
    echo "    $(basename "$F"): ${N:-0} markers"
  done
else
  echo "    FIX-SUBAGENT-CROSS-AGENT-SCOPE: NOT APPLIED"
fi

echo "--- FIX-SKILL-WORKSHOP-IN-SANDBOX (skill-workshop sandboxed-agent gate) ---"
if grep -l "FIX-SKILL-WORKSHOP-IN-SANDBOX" "$DIST"/*.js 2>/dev/null | grep -q .; then
  grep -l "FIX-SKILL-WORKSHOP-IN-SANDBOX" "$DIST"/*.js 2>/dev/null | while IFS= read -r F; do
    N=$(grep -c "FIX-SKILL-WORKSHOP-IN-SANDBOX" "$F" 2>/dev/null || true)
    echo "    $(basename "$F"): ${N:-0} markers"
  done
else
  echo "    FIX-SKILL-WORKSHOP-IN-SANDBOX: NOT APPLIED"
fi

echo "--- FIX-BROWSER-USERDATA-DIR / FIX-BROWSER-SINGLETON-CLEAN (sandbox-browser entrypoint) ---"
if [ -f "$ENTRYPOINT" ]; then
  for M in FIX-BROWSER-USERDATA-DIR FIX-BROWSER-SINGLETON-CLEAN; do
    if grep -q "$M" "$ENTRYPOINT" 2>/dev/null; then
      N=$(grep -c "$M" "$ENTRYPOINT" 2>/dev/null || true)
      echo "    $M: $(basename "$ENTRYPOINT") ${N:-0} markers"
    else
      echo "    $M: NOT APPLIED"
    fi
  done
else
  echo "    (entrypoint not patched)"
fi

echo
echo "Done. Run a cron job to validate (e.g. \`openclaw cron run <id>\`)."
