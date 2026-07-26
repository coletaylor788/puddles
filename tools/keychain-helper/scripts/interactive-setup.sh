#!/bin/sh
set -eu
umask 077

usage() {
  echo "usage: interactive-setup.sh user-TODOIST_USER_ID" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
todoist_account=$1
case "$todoist_account" in
  user-*) ;;
  *) usage ;;
esac
todoist_user_id=${todoist_account#user-}
case "$todoist_user_id" in
  ''|*[!0-9]*) usage ;;
esac

testing=${PUDDLES_KEYCHAIN_HELPER_TESTING:-0}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_script=${PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT:-"$script_dir/install.sh"}
rollback_script=${PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT:-"$script_dir/rollback-install.sh"}
sync_command=${PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND:-/bin/sync}

if [ "$testing" = "1" ]; then
  identity_sha1=0000000000000000000000000000000000000000
  home_dir=${PUDDLES_KEYCHAIN_HELPER_TEST_HOME:?test home must be set}
else
  identity_name="Puddles Keychain Helper Signing"
  identity_sha1=$(
    security find-identity -v -p codesigning |
      awk -v name="\"$identity_name\"" '
        index($0, name) { identity = $2; count += 1 }
        END {
          if (count != 1) exit 1
          print identity
        }
      '
  ) || {
    echo "Expected exactly one valid Code Signing identity named: $identity_name" >&2
    exit 69
  }
  case "$identity_sha1" in
    *[!0-9A-Fa-f]*|'') usage ;;
  esac
  [ "${#identity_sha1}" -eq 40 ] || {
    echo "The signing identity did not have a 40-character SHA-1 hash" >&2
    exit 69
  }

  current_user=$(id -un)
  home_dir=$(dscl . -read "/Users/$current_user" NFSHomeDirectory |
    sed -n 's/^NFSHomeDirectory: //p')
  [ -n "$home_dir" ] || {
    echo "Could not resolve the current user's home directory" >&2
    exit 69
  }
fi

config_dir="$home_dir/.config/puddles-keychain-helper"
allowlist="$config_dir/allowlist.tsv"
pending_setup="$config_dir/pending-interactive-setup"
setup_lock="$config_dir/interactive-setup.lock"
prefix="$home_dir/.local"
operation_state_dir="$prefix/state/puddles-keychain-helper"
operation_lock="$operation_state_dir/operation.lock"
lock_owned=0
operation_lock_owned=0
completed=0
setup_state=
install_snapshot=

assert_secure_dir() {
  path=$1
  [ -d "$path" ] && [ ! -L "$path" ] || {
    echo "setup directory is missing, not a directory, or a symlink: $path" >&2
    exit 73
  }
  metadata=$(stat -f '%u %Lp' "$path")
  owner=${metadata%% *}
  mode=${metadata#* }
  [ "$owner" = "$(id -u)" ] || {
    echo "setup directory is not owned by the current user: $path" >&2
    exit 73
  }
  [ $((0$mode & 0077)) -eq 0 ] || {
    echo "setup directory grants group or other access: $path" >&2
    exit 73
  }
  if ls -lde "$path" | sed -n '2,$p' | grep -v ' deny ' | grep -q .; then
    echo "setup directory has an ACL that can grant access: $path" >&2
    exit 73
  fi
}

assert_secure_file() {
  path=$1
  [ -f "$path" ] && [ ! -L "$path" ] || {
    echo "setup state is missing, not a regular file, or a symlink: $path" >&2
    exit 73
  }
  metadata=$(stat -f '%u %Lp' "$path")
  owner=${metadata%% *}
  mode=${metadata#* }
  [ "$owner" = "$(id -u)" ] || {
    echo "setup state is not owned by the current user: $path" >&2
    exit 73
  }
  [ $((0$mode & 0077)) -eq 0 ] || {
    echo "setup state grants group or other access: $path" >&2
    exit 73
  }
  if ls -le "$path" | sed -n '2,$p' | grep -v ' deny ' | grep -q .; then
    echo "setup state has an ACL that can grant access: $path" >&2
    exit 73
  fi
}

assert_operation_dir() {
  path=$1
  [ -d "$path" ] && [ ! -L "$path" ] || {
    echo "operation directory is missing, not a directory, or a symlink: $path" >&2
    exit 73
  }
  metadata=$(stat -f '%u %Lp' "$path")
  owner=${metadata%% *}
  mode=${metadata#* }
  [ "$owner" = "$(id -u)" ] || {
    echo "operation directory is not owned by the current user: $path" >&2
    exit 73
  }
  [ $((0$mode & 0022)) -eq 0 ] || {
    echo "operation directory is group- or other-writable: $path" >&2
    exit 73
  }
  if ls -lde "$path" | sed -n '2,$p' | grep -v ' deny ' | grep -q .; then
    echo "operation directory has an ACL that can grant access: $path" >&2
    exit 73
  fi
}

ensure_operation_dir() {
  path=$1
  if [ -e "$path" ] || [ -L "$path" ]; then
    assert_operation_dir "$path"
    return
  fi
  mkdir "$path"
  chmod 0700 "$path"
  assert_operation_dir "$path"
}

validate_setup_state() {
  state=$1
  case "$state" in
    "$config_dir"/.interactive-setup.*) ;;
    *)
      echo "pending setup state is outside the config directory" >&2
      exit 73
      ;;
  esac
  assert_secure_dir "$state"
}

release_lock() {
  if [ "$operation_lock_owned" -eq 1 ]; then
    current_pid=$(sed -n '1p' "$operation_lock" 2>/dev/null || true)
    if [ "$current_pid" = "$$" ]; then
      rm -f "$operation_lock"
    fi
    operation_lock_owned=0
  fi
  if [ "$lock_owned" -eq 1 ]; then
    current_pid=$(sed -n '1p' "$setup_lock" 2>/dev/null || true)
    if [ "$current_pid" = "$$" ]; then
      rm -f "$setup_lock"
    fi
    lock_owned=0
  fi
}

recover_state() {
  state=$1
  validate_setup_state "$state" || return 1
  snapshot_file="$state/install-snapshot"
  if [ -f "$snapshot_file" ]; then
    assert_secure_file "$snapshot_file" || return 1
    snapshot=$(sed -n '1p' "$snapshot_file")
    [ -n "$snapshot" ] || {
      echo "pending setup snapshot is empty" >&2
      return 1
    }
    if [ "$testing" = "1" ]; then
      PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
        "$rollback_script" "$snapshot" ||
        return 1
    else
      "$rollback_script" --snapshot "$snapshot" ||
        return 1
    fi
  fi

  if [ -f "$state/allowlist-present" ]; then
    assert_secure_file "$state/allowlist-present" || return 1
    assert_secure_file "$state/allowlist-backup" || return 1
    restore_candidate="$state/allowlist-restore"
    rm -f "$restore_candidate" || return 1
    cp -p "$state/allowlist-backup" "$restore_candidate" || return 1
    mv -f "$restore_candidate" "$allowlist" || return 1
  else
    rm -f "$allowlist" || return 1
  fi
  return 0
}

sync_state() {
  "$sync_command"
}

finalize_state() {
  state=$1
  sync_state || return 1
  rm -f "$pending_setup" || return 1
  sync_state || return 1
  rm -rf "$state" || return 1
  sync_state || return 1
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$setup_state" ] && [ -d "$setup_state" ]; then
    if [ "$completed" -eq 1 ]; then
      if ! finalize_state "$setup_state"; then
        echo "Interactive setup finalization failed; inspect: $setup_state" >&2
        status=75
      fi
    elif recover_state "$setup_state"; then
      if ! finalize_state "$setup_state"; then
        echo "Interactive setup finalization failed; inspect: $setup_state" >&2
        status=75
      fi
    else
      echo "Interactive setup recovery failed; state preserved at: $setup_state" >&2
      status=75
    fi
  fi
  release_lock
  exit "$status"
}

[ ! -L "$config_dir" ] || {
  echo "Refusing to use a symlinked helper config directory" >&2
  exit 73
}
install -d -m 0700 "$config_dir"
assert_secure_dir "$config_dir"
ensure_operation_dir "$prefix"
ensure_operation_dir "$prefix/state"
ensure_operation_dir "$operation_state_dir"

if /usr/bin/shlock -f "$setup_lock" -p "$$"; then
  lock_owned=1
else
  echo "another interactive helper setup is running" >&2
  exit 75
fi
if /usr/bin/shlock -f "$operation_lock" -p "$$"; then
  operation_lock_owned=1
  PUDDLES_KEYCHAIN_HELPER_LOCK_STATE=$operation_state_dir
  PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER=$$
  export PUDDLES_KEYCHAIN_HELPER_LOCK_STATE
  export PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER
else
  release_lock
  echo "another helper install or rollback is running" >&2
  exit 75
fi
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if [ -e "$pending_setup" ] || [ -L "$pending_setup" ]; then
  assert_secure_file "$pending_setup"
  [ "$(wc -l <"$pending_setup" | tr -d ' ')" -eq 1 ] || {
    echo "pending setup marker is malformed" >&2
    exit 73
  }
  stale_state=$(sed -n '1p' "$pending_setup")
  recover_state "$stale_state" || exit 75
  finalize_state "$stale_state" || exit 75
fi

setup_state=$(mktemp -d "$config_dir/.interactive-setup.XXXXXX")
chmod 0700 "$setup_state"
assert_secure_dir "$setup_state"

if [ -e "$allowlist" ] || [ -L "$allowlist" ]; then
  assert_secure_file "$allowlist"
  cp -p "$allowlist" "$setup_state/allowlist-backup"
  : >"$setup_state/allowlist-present"
  chmod 0600 "$setup_state/allowlist-present"
fi

temporary="$setup_state/allowlist"
printf '%s\n%s\t%s\t%s\n' \
  'puddles-keychain-helper-v1' \
  'todoist-api-token' 'todoist-cli' "$todoist_account" \
  >"$temporary"
chmod -N "$temporary"
chmod 0600 "$temporary"

pending_new="$pending_setup.new.$$"
printf '%s\n' "$setup_state" >"$pending_new"
chmod 0600 "$pending_new"
mv -f "$pending_new" "$pending_setup"
sync_state || exit 75
mv -f "$temporary" "$allowlist"
sync_state || exit 75

snapshot_handoff="$setup_state/install-snapshot"
if [ "$testing" = "1" ]; then
  install_output=$(
    PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
      "$install_script" "$snapshot_handoff" "$home_dir"
  )
else
  helper="$home_dir/.local/libexec/puddles-keychain-helper/puddles-keychain-helper"
  if [ -e "$helper" ]; then
    install_output=$(
      PUDDLES_KEYCHAIN_HELPER_REAPPROVAL=1 \
        "$install_script" \
        --signing-identity-sha1 "$identity_sha1" \
        --snapshot-output-file "$snapshot_handoff" \
        --replace-approved-helper
    )
  else
    install_output=$(
      "$install_script" \
        --signing-identity-sha1 "$identity_sha1" \
        --snapshot-output-file "$snapshot_handoff"
    )
  fi
fi
install_snapshot=$(sed -n '1p' "$snapshot_handoff")
[ -d "$install_snapshot" ] || {
  echo "Installer did not return a valid rollback snapshot" >&2
  exit 75
}
sync_state || exit 75

helper="$home_dir/.local/libexec/puddles-keychain-helper/puddles-keychain-helper"
echo "Approve Always Allow only for the todoist-cli item." >&2
"$helper" --approve todoist-api-token >/dev/null
if ! "$helper" todoist-api-token >/dev/null; then
  echo "Approval was not durable; choose Always Allow and retry setup." >&2
  exit 69
fi
completed=1
printf '%s\n' "$install_output"
echo "Interactive Keychain approval completed and verified noninteractively."
