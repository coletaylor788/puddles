#!/bin/bash

set -euo pipefail

STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CONFIG_FILE="$STATE_DIR/openclaw.json"
SECRET_POINTER="/providers/todoist/apiKey"

for command in jq openclaw python3 td; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $command" >&2
    exit 1
  }
done

[ -f "$CONFIG_FILE" ] || {
  echo "ERROR: OpenClaw config not found at $CONFIG_FILE" >&2
  exit 1
}

STORE_PATH="$(
  jq -er '
    .secrets.providers.local
    | select(.source == "file")
    | select((.mode // "json") == "json")
    | .path
    | strings
    | select(length > 0)
  ' "$CONFIG_FILE"
)" || {
  echo "ERROR: secrets.providers.local must be a JSON file provider." >&2
  exit 1
}
case "$STORE_PATH" in
  "~/"*) STORE_PATH="$HOME/${STORE_PATH#\~/}" ;;
esac
case "$STORE_PATH" in
  /*) ;;
  *)
    echo "ERROR: shared secret store path must be absolute or home-relative." >&2
    exit 1
    ;;
esac

[ -f "$STORE_PATH" ] || {
  echo "ERROR: shared secret store not found at $STORE_PATH" >&2
  exit 1
}
python3 -c '
import json
import os
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
info = path.stat()
if info.st_uid != os.getuid():
    raise SystemExit(f"ERROR: shared secret store is not owned by uid {os.getuid()}")
if stat.S_IMODE(info.st_mode) != 0o600:
    raise SystemExit("ERROR: shared secret store must have mode 600")
with path.open(encoding="utf-8") as handle:
    data = json.load(handle)
if not isinstance(data, dict):
    raise SystemExit("ERROR: shared secret store must contain a JSON object")
' "$STORE_PATH"

td auth login
TOKEN="$(td auth token view)"
[ -n "$TOKEN" ] || {
  echo "ERROR: Todoist login did not return a token." >&2
  exit 1
}

printf '%s' "$TOKEN" | python3 -c '
import json
import os
import pathlib
import stat
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
token = sys.stdin.read()
if not token or "\n" in token or "\r" in token:
    raise SystemExit("ERROR: Todoist returned an invalid token")

info = path.stat()
if info.st_uid != os.getuid():
    raise SystemExit(f"ERROR: shared secret store is not owned by uid {os.getuid()}")
if stat.S_IMODE(info.st_mode) != 0o600:
    raise SystemExit("ERROR: shared secret store must have mode 600")

with path.open(encoding="utf-8") as handle:
    data = json.load(handle)
if not isinstance(data, dict):
    raise SystemExit("ERROR: shared secret store must contain a JSON object")

providers = data.setdefault("providers", {})
if not isinstance(providers, dict):
    raise SystemExit("ERROR: shared secret store providers must be an object")
todoist = providers.setdefault("todoist", {})
if not isinstance(todoist, dict):
    raise SystemExit("ERROR: providers.todoist must be an object")
todoist["apiKey"] = token

fd, temp_name = tempfile.mkstemp(prefix=".secrets.json.", dir=path.parent, text=True)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_name, path)
except BaseException:
    try:
        os.unlink(temp_name)
    except FileNotFoundError:
        pass
    raise
' "$STORE_PATH"
unset TOKEN

openclaw config set skills.entries.todoist-cli.apiKey \
  --ref-source file \
  --ref-provider local \
  --ref-id "$SECRET_POINTER"
openclaw secrets reload
td auth status --json --no-spinner

echo "Todoist token stored in the shared OpenClaw secret store."
