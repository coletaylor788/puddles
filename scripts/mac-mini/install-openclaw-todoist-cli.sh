#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKERFILE="$SCRIPT_DIR/todoist-cli/Dockerfile"
SKILL_SOURCE="$REPO_ROOT/openclaw-skills/todoist-cli"
TODOIST_CLI_VERSION="3.0.5"
TARGET_IMAGE_DEFAULT="openclaw-sandbox-todoist:${TODOIST_CLI_VERSION}"
TOKEN_REFERENCE='${TODOIST_API_TOKEN}'
MARKER_NAME=".puddles-managed"

ACTION="install"
AGENT_ID="main"
WORKSPACE_DIR=""
TARGET_IMAGE="$TARGET_IMAGE_DEFAULT"
ALLOW_NON_MAIN=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage:
  install-openclaw-todoist-cli.sh [install] [options]
  install-openclaw-todoist-cli.sh rollback [options]

Options:
  --agent <id>          Agent to configure (default: main).
  --workspace <path>    Override the selected agent workspace.
  --image <tag>         Candidate image tag.
  --allow-non-main      Acknowledge credential exposure to a non-main agent.
  --dry-run             Print mutations without applying them.
  -h, --help            Show this help.

Environment:
  OPENCLAW_STATE_DIR    Defaults to ~/.openclaw.
USAGE
}

if [ "${1:-}" = "install" ] || [ "${1:-}" = "rollback" ]; then
  ACTION="$1"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent)
      [ "$#" -ge 2 ] || { echo "ERROR: --agent requires a value" >&2; exit 2; }
      AGENT_ID="$2"
      shift 2
      ;;
    --workspace)
      [ "$#" -ge 2 ] || { echo "ERROR: --workspace requires a value" >&2; exit 2; }
      WORKSPACE_DIR="$2"
      shift 2
      ;;
    --image)
      [ "$#" -ge 2 ] || { echo "ERROR: --image requires a value" >&2; exit 2; }
      TARGET_IMAGE="$2"
      shift 2
      ;;
    --allow-non-main)
      ALLOW_NON_MAIN=1
      shift
      ;;
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

for command in docker jq openclaw; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $command" >&2
    exit 1
  }
done

[ -f "$DOCKERFILE" ] || { echo "ERROR: missing $DOCKERFILE" >&2; exit 1; }
[ -f "$SKILL_SOURCE/SKILL.md" ] || {
  echo "ERROR: missing $SKILL_SOURCE/SKILL.md" >&2
  exit 1
}

if [ "$AGENT_ID" != "main" ] && [ "$ALLOW_NON_MAIN" -ne 1 ]; then
  echo "ERROR: refusing to expose Todoist credentials to non-main agent '$AGENT_ID'." >&2
  echo "Re-run with --allow-non-main only after reviewing that agent's trust boundary." >&2
  exit 1
fi

STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
RECOVERY_DIR="$STATE_DIR/todoist-cli-install"
RECOVERY_FILE="$RECOVERY_DIR/$AGENT_ID.json"

AGENTS_JSON="$(openclaw config get agents.list --json)"
AGENT_INDEX="$(
  printf '%s' "$AGENTS_JSON" | jq -er --arg id "$AGENT_ID" '
    to_entries
    | map(select(.value.id == $id))
    | if length == 1 then .[0].key else error("agent must match exactly once") end
  '
)" || {
  echo "ERROR: could not resolve one agent named '$AGENT_ID'." >&2
  exit 1
}

if [ -z "$WORKSPACE_DIR" ]; then
  WORKSPACE_DIR="$(
    printf '%s' "$AGENTS_JSON" | jq -r --argjson index "$AGENT_INDEX" \
      '.[$index].workspace // empty'
  )"
fi
if [ -z "$WORKSPACE_DIR" ]; then
  if [ "$AGENT_ID" = "main" ]; then
    WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
  else
    echo "ERROR: agent '$AGENT_ID' has no explicit workspace; pass --workspace." >&2
    exit 1
  fi
fi

SKILL_DEST="$WORKSPACE_DIR/skills/todoist-cli"
SKILL_MARKER="$SKILL_DEST/$MARKER_NAME"
CONFIG_IMAGE_PATH="agents.list[$AGENT_INDEX].sandbox.docker.image"
CONFIG_TOKEN_PATH="agents.list[$AGENT_INDEX].sandbox.docker.env.TODOIST_API_TOKEN"

run_mutation() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

restore_config_from_recovery() {
  local previous_image
  previous_image="$(jq -c '.previousImage' "$RECOVERY_FILE")"

  if [ "$previous_image" = "null" ]; then
    run_mutation openclaw config unset "$CONFIG_IMAGE_PATH"
  else
    run_mutation openclaw config set "$CONFIG_IMAGE_PATH" "$previous_image" --strict-json
  fi
  run_mutation openclaw config unset "$CONFIG_TOKEN_PATH"
}

remove_managed_skill() {
  if [ ! -e "$SKILL_DEST" ]; then
    return 0
  fi
  if [ ! -f "$SKILL_MARKER" ]; then
    echo "ERROR: refusing to remove unmarked skill at $SKILL_DEST" >&2
    return 1
  fi
  run_mutation rm -rf "$SKILL_DEST"
}

rollback_action() {
  [ -f "$RECOVERY_FILE" ] || {
    echo "ERROR: no recovery state at $RECOVERY_FILE" >&2
    exit 1
  }

  local recorded_agent recorded_workspace
  recorded_agent="$(jq -er '.agentId' "$RECOVERY_FILE")"
  recorded_workspace="$(jq -er '.workspace' "$RECOVERY_FILE")"
  [ "$recorded_agent" = "$AGENT_ID" ] || {
    echo "ERROR: recovery state belongs to agent '$recorded_agent'." >&2
    exit 1
  }
  [ "$recorded_workspace" = "$WORKSPACE_DIR" ] || {
    echo "ERROR: recovery workspace is '$recorded_workspace', not '$WORKSPACE_DIR'." >&2
    exit 1
  }

  restore_config_from_recovery
  remove_managed_skill
  run_mutation openclaw sandbox recreate --agent "$AGENT_ID"
  run_mutation rm -f "$RECOVERY_FILE"
  echo "Todoist CLI capability rolled back for agent '$AGENT_ID'."
}

if [ "$ACTION" = "rollback" ]; then
  rollback_action
  exit 0
fi

if [ -e "$SKILL_DEST" ] && [ ! -f "$SKILL_MARKER" ]; then
  echo "ERROR: refusing to overwrite user-authored skill at $SKILL_DEST" >&2
  exit 1
fi

if [ ! -f "$RECOVERY_FILE" ]; then
  ENV_PRESENT="$(
    printf '%s' "$AGENTS_JSON" | jq -r --argjson index "$AGENT_INDEX" \
      '(.[$index].sandbox.docker.env // {}) | has("TODOIST_API_TOKEN")'
  )"
  if [ "$ENV_PRESENT" = "true" ]; then
    echo "ERROR: $CONFIG_TOKEN_PATH is already configured without recovery state." >&2
    exit 1
  fi
fi

if [ ! -f "$STATE_DIR/.env" ] ||
   ! grep -Eq '^[[:space:]]*TODOIST_API_TOKEN=.+$' "$STATE_DIR/.env"; then
  echo "ERROR: TODOIST_API_TOKEN is not configured in $STATE_DIR/.env." >&2
  echo "A shell-only export cannot guarantee that the OpenClaw daemon can resolve it." >&2
  exit 1
fi

BASE_IMAGE="$(
  printf '%s' "$AGENTS_JSON" | jq -r --argjson index "$AGENT_INDEX" \
    '.[$index].sandbox.docker.image // empty'
)"
if [ -f "$RECOVERY_FILE" ]; then
  RECORDED_BASE_IMAGE="$(jq -r '.previousImage // empty' "$RECOVERY_FILE")"
  if [ -n "$RECORDED_BASE_IMAGE" ]; then
    BASE_IMAGE="$RECORDED_BASE_IMAGE"
  else
    BASE_IMAGE=""
  fi
fi
if [ -z "$BASE_IMAGE" ]; then
  BASE_IMAGE="$(
    openclaw config get agents.defaults.sandbox.docker.image --json 2>/dev/null \
      | jq -r '. // empty'
  )"
fi
BASE_IMAGE="${BASE_IMAGE:-openclaw-sandbox:bookworm-slim}"

echo "Building Todoist CLI sandbox image '$TARGET_IMAGE' from '$BASE_IMAGE'..."
run_mutation docker build \
  --build-arg "BASE_IMAGE=$BASE_IMAGE" \
  --build-arg "TODOIST_CLI_VERSION=$TODOIST_CLI_VERSION" \
  --file "$DOCKERFILE" \
  --tag "$TARGET_IMAGE" \
  "$SCRIPT_DIR/todoist-cli"

if [ "$DRY_RUN" -eq 0 ]; then
  CANDIDATE_VERSION="$(
    docker run --rm --entrypoint td "$TARGET_IMAGE" --version
  )"
  [ "$CANDIDATE_VERSION" = "$TODOIST_CLI_VERSION" ] || {
    echo "ERROR: candidate reported '$CANDIDATE_VERSION', expected '$TODOIST_CLI_VERSION'." >&2
    exit 1
  }
else
  run_mutation docker run --rm --entrypoint td "$TARGET_IMAGE" --version
fi

if [ ! -f "$RECOVERY_FILE" ]; then
  PREVIOUS_IMAGE="$(
    printf '%s' "$AGENTS_JSON" | jq -c --argjson index "$AGENT_INDEX" \
      '.[$index].sandbox.docker.image // null'
  )"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] write recovery state to $RECOVERY_FILE"
  else
    mkdir -p "$RECOVERY_DIR"
    RECOVERY_TMP="$(mktemp "$RECOVERY_DIR/$AGENT_ID.XXXXXX")"
    jq -n \
      --arg agentId "$AGENT_ID" \
      --argjson agentIndex "$AGENT_INDEX" \
      --arg workspace "$WORKSPACE_DIR" \
      --argjson previousImage "$PREVIOUS_IMAGE" \
      --arg installedImage "$TARGET_IMAGE" \
      '{
        version: 1,
        agentId: $agentId,
        agentIndex: $agentIndex,
        workspace: $workspace,
        previousImage: $previousImage,
        installedImage: $installedImage
      }' > "$RECOVERY_TMP"
    chmod 600 "$RECOVERY_TMP"
    mv "$RECOVERY_TMP" "$RECOVERY_FILE"
  fi
fi

SKILL_BACKUP=""
CONFIG_MUTATED=0
INSTALL_COMPLETE=0

rollback_failed_install() {
  local original_status=$?
  [ "$INSTALL_COMPLETE" -eq 0 ] || exit "$original_status"
  trap - ERR
  echo "ERROR: installation failed; restoring prior state." >&2
  local rollback_failed=0

  if [ "$CONFIG_MUTATED" -eq 1 ] && [ -f "$RECOVERY_FILE" ]; then
    restore_config_from_recovery || rollback_failed=1
    run_mutation openclaw sandbox recreate --agent "$AGENT_ID" || rollback_failed=1
  fi

  if [ -n "$SKILL_BACKUP" ] && [ -d "$SKILL_BACKUP" ]; then
    run_mutation rm -rf "$SKILL_DEST" || rollback_failed=1
    run_mutation mv "$SKILL_BACKUP" "$SKILL_DEST" || rollback_failed=1
  else
    remove_managed_skill || rollback_failed=1
  fi

  if [ "$rollback_failed" -eq 0 ]; then
    run_mutation rm -f "$RECOVERY_FILE"
  else
    echo "ERROR: rollback was incomplete; recovery state remains at $RECOVERY_FILE" >&2
  fi
  exit "$original_status"
}
trap rollback_failed_install ERR

run_mutation mkdir -p "$WORKSPACE_DIR/skills"

if [ -d "$SKILL_DEST" ]; then
  SKILL_BACKUP="$(mktemp -d "$WORKSPACE_DIR/skills/.todoist-cli-backup.XXXXXX")"
  rmdir "$SKILL_BACKUP"
  run_mutation mv "$SKILL_DEST" "$SKILL_BACKUP"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] install managed skill at $SKILL_DEST"
else
  SKILL_TMP="$(mktemp -d "$WORKSPACE_DIR/skills/.todoist-cli-install.XXXXXX")"
  cp "$SKILL_SOURCE/SKILL.md" "$SKILL_TMP/SKILL.md"
  printf 'source: puddles/openclaw-skills/todoist-cli\nversion: %s\n' \
    "$TODOIST_CLI_VERSION" > "$SKILL_TMP/$MARKER_NAME"
  mv "$SKILL_TMP" "$SKILL_DEST"
fi

run_mutation openclaw config set "$CONFIG_IMAGE_PATH" \
  "$(jq -Rn --arg value "$TARGET_IMAGE" '$value')" --strict-json
CONFIG_MUTATED=1
run_mutation openclaw config set "$CONFIG_TOKEN_PATH" \
  "$(jq -Rn --arg value "$TOKEN_REFERENCE" '$value')" --strict-json
run_mutation openclaw sandbox recreate --agent "$AGENT_ID"

if [ -n "$SKILL_BACKUP" ]; then
  run_mutation rm -rf "$SKILL_BACKUP"
fi
INSTALL_COMPLETE=1
trap - ERR

echo "Todoist CLI $TODOIST_CLI_VERSION installed for agent '$AGENT_ID'."
echo "Recovery state: $RECOVERY_FILE"
