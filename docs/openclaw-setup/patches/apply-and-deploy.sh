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
GATEWAY_LABEL="${GATEWAY_LABEL:-ai.openclaw.gateway}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REMOTE_DEPLOY=false
if [ -n "$MINI_HOST" ]; then
  REMOTE_DEPLOY=true
fi

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
rm -f openclaw-*.tgz
TARBALL="$(npm pack --silent | tail -1)"
[ -f "$TARBALL" ] || { echo "    pack produced no tarball" >&2; exit 1; }
echo "    $TARBALL"

if $REMOTE_DEPLOY; then
  echo "==> Installing on $MINI_HOST + migrating auth + restarting gateway"
  scp "$TARBALL" "$MINI_HOST:/tmp/$TARBALL"
  ssh "$MINI_HOST" "
    set -e
    npm install -g '/tmp/$TARBALL'
    # 2026.6.x moved provider auth JSON->SQLite with no auto-migration; doctor --fix
    # imports the legacy auth-profiles.json into the per-agent SQLite store (backs up
    # + removes the old files). Idempotent once migrated.
    openclaw doctor --fix --yes </dev/null || true
    launchctl kickstart -k gui/\$(id -u)/$GATEWAY_LABEL
    echo '    installed + gateway restarted'
  "
else
  echo "==> Installing locally + migrating auth + restarting gateway"
  npm install -g "$OPENCLAW_SRC/$TARBALL"
  openclaw doctor --fix --yes </dev/null || true
  launchctl kickstart -k "gui/$(id -u)/$GATEWAY_LABEL"
  echo "    installed + gateway restarted"
fi

echo "==> Refreshing sandbox-browser entrypoint + image (patched entrypoint is NOT in the npm package)"
# The browser patch lives in scripts/sandbox-browser-entrypoint.sh, which the npm
# package does not ship, so copy the built/patched source file to the mini's
# sandbox-build and rebuild the image if the FIX-BROWSER markers are present.
ENTRY_SRC="$OPENCLAW_SRC/scripts/sandbox-browser-entrypoint.sh"
if [ -f "$ENTRY_SRC" ] && grep -qE "FIX-BROWSER-(USERDATA-DIR|SINGLETON-CLEAN)" "$ENTRY_SRC"; then
  if $REMOTE_DEPLOY; then
    scp "$ENTRY_SRC" "$MINI_HOST:$MINI_SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
    ssh "$MINI_HOST" "
      set -e
      chmod +x '$MINI_SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh'
      if command -v docker >/dev/null 2>&1 && [ -f '$MINI_SANDBOX_BUILD/Dockerfile.sandbox-browser' ]; then
        docker build -f '$MINI_SANDBOX_BUILD/Dockerfile.sandbox-browser' \
          -t openclaw-sandbox-browser:bookworm-slim '$MINI_SANDBOX_BUILD' >/dev/null
        openclaw sandbox recreate --agent browser-agent --force || true
        openclaw sandbox recreate --browser --agent browser-agent --force || true
        echo '    browser image rebuilt + browser-agent recreated'
      else
        echo '    (docker or Dockerfile missing on target — rebuild the browser image manually)'
      fi
    "
  else
    mkdir -p "$MINI_SANDBOX_BUILD/scripts"
    install -m 0755 "$ENTRY_SRC" "$MINI_SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
    if command -v docker >/dev/null 2>&1 && [ -f "$MINI_SANDBOX_BUILD/Dockerfile.sandbox-browser" ]; then
      docker build -f "$MINI_SANDBOX_BUILD/Dockerfile.sandbox-browser" \
        -t openclaw-sandbox-browser:bookworm-slim "$MINI_SANDBOX_BUILD" >/dev/null
      openclaw sandbox recreate --agent browser-agent --force || true
      openclaw sandbox recreate --browser --agent browser-agent --force || true
      echo "    browser image rebuilt + browser-agent recreated"
    else
      echo "    (docker or Dockerfile missing on target — rebuild the browser image manually)"
    fi
  fi
else
  echo "    (browser entrypoint not patched — skipping image rebuild)"
fi

echo
echo "==> Deployed. Validate:"
if $REMOTE_DEPLOY; then
  echo "    ssh $MINI_HOST 'openclaw --version && openclaw cron run <id>'"
else
  echo "    openclaw --version && openclaw cron run <id>"
fi
