#!/bin/bash
# install-disclaim-wrappers.sh — make the Apple-PIM Swift CLIs their own TCC
# principal so Reminders/Contacts/Calendar access survives Homebrew node upgrades.
#
# See ./README.md for the full rationale. In short: node is ad-hoc signed, so
# every `brew upgrade node@22` changes node's identity and invalidates the TCC
# grants that macOS attributed to node (the "responsible process" for the CLIs
# it spawns). This installs a tiny disclaim launcher in front of each CLI so the
# CLI becomes its own stable TCC principal.
#
# Idempotent. Safe to re-run after a `swift build` rebuild of the plugin.
#
# Usage:
#   ./install-disclaim-wrappers.sh [path-to-Apple-PIM-Agent-Plugin]
# Default repo: ~/git/Apple-PIM-Agent-Plugin (override via arg or APPLE_PIM_REPO).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-${APPLE_PIM_REPO:-$HOME/git/Apple-PIM-Agent-Plugin}}"
SRC="$HERE/pim-disclaim.c"
MARKER="PIM-DISCLAIM-WRAPPER-v1"
CLIS=(calendar-cli reminder-cli contacts-cli mail-cli)
LOCAL_BIN="$HOME/.local/bin"

# The path the third-party server.js and the apple-pim-cli plugin both resolve.
SYMLINK_DIR="$REPO/swift/.build/release"

[ -f "$SRC" ] || { echo "launcher source not found: $SRC" >&2; exit 1; }
[ -d "$SYMLINK_DIR" ] || {
  echo "swift build dir not found: $SYMLINK_DIR" >&2
  echo "(build it first: cd '$REPO/swift' && swift build -c release)" >&2
  exit 1
}

# Resolve the symlink (.build/release -> arch/release) to the real directory the
# binaries actually live in; that's where we rename + drop wrappers.
REL="$(cd "$SYMLINK_DIR" && pwd -P)"
echo "==> release dir: $REL"

# Build the launcher once into a temp file, then copy it per-CLI.
CC="$(xcrun --find cc 2>/dev/null || command -v cc)"
[ -n "$CC" ] || { echo "no C compiler (cc) found" >&2; exit 1; }
SDK_FLAGS=()
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"
[ -n "$SDK" ] && SDK_FLAGS=(-isysroot "$SDK")
LAUNCHER="$(mktemp -t pim-disclaim)"
trap 'rm -f "$LAUNCHER"' EXIT
echo "==> compiling launcher with $CC"
"$CC" -O2 -Wall -Wextra "${SDK_FLAGS[@]}" -o "$LAUNCHER" "$SRC"

is_launcher() { grep -q "$MARKER" "$1" 2>/dev/null; }

wrapped=0 skipped=0
for cli in "${CLIS[@]}"; do
  f="$REL/$cli"
  if [ ! -e "$f" ]; then
    echo "    - $cli: not built, skipping"
    skipped=$((skipped + 1))
    continue
  fi
  if is_launcher "$f"; then
    if [ ! -e "$f.real" ]; then
      echo "    ! $cli is a launcher but $cli.real is missing (broken state)." >&2
      echo "      Restore the real binary: cd '$REPO/swift' && swift build -c release" >&2
      echo "      then re-run this script." >&2
      exit 1
    fi
    cp "$LAUNCHER" "$f"          # refresh launcher in place
    echo "    = $cli: launcher refreshed (already wrapped)"
  else
    mv "$f" "$f.real"           # the real Swift binary becomes the TCC principal
    cp "$LAUNCHER" "$f"
    chmod +x "$f"
    echo "    + $cli: wrapped (real -> $cli.real)"
  fi
  wrapped=$((wrapped + 1))
done

# Refresh ~/.local/bin symlinks to the upstream form (.build/release/<cli>), now
# resolving to the launcher. Matches what `setup.sh --install` creates.
mkdir -p "$LOCAL_BIN"
for cli in "${CLIS[@]}"; do
  [ -e "$REL/$cli" ] || continue
  ln -sf "$SYMLINK_DIR/$cli" "$LOCAL_BIN/$cli"
done

echo
echo "Done: $wrapped wrapped/refreshed, $skipped skipped."
echo
echo "Next — grant TCC once (the prompt must appear in the GUI/Aqua session;"
echo "TCC consent cannot be set over SSH). On the mini, run each in the user's"
echo "GUI session and click Allow:"
echo "    launchctl asuser \$(id -u) $LOCAL_BIN/reminder-cli lists"
echo "    launchctl asuser \$(id -u) $LOCAL_BIN/contacts-cli list"
echo "    launchctl asuser \$(id -u) $LOCAL_BIN/calendar-cli list"
echo "Grants attach to the stable '<cli>.real' binaries and survive node upgrades."
