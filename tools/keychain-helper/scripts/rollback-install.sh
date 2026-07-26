#!/bin/sh
set -eu
umask 077

usage() {
  echo "usage: rollback-install.sh --snapshot PATH [--test-prefix PATH]" >&2
  exit 64
}

current_user=$(id -un)
home_dir=$(dscl . -read "/Users/$current_user" NFSHomeDirectory |
  sed -n 's/^NFSHomeDirectory: //p')
[ -n "$home_dir" ] || {
  echo "could not resolve the current user's home directory" >&2
  exit 69
}
prefix="$home_dir/.local"
snapshot=
test_prefix=
sync_command=${PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND:-/bin/sync}

canonicalize_prefix() {
  path=$1
  while [ "$path" != "/" ] && [ "${path%/}" != "$path" ]; do
    path=${path%/}
  done
  parent=$(dirname -- "$path")
  base=$(basename -- "$path")
  case "$base" in
    .|..) usage ;;
  esac
  canonical_parent=$(CDPATH= cd -- "$parent" 2>/dev/null && pwd -P) || usage
  printf '%s/%s\n' "$canonical_parent" "$base"
}

same_target() {
  left=$1
  right=$2
  if [ -e "$left" ] && [ -e "$right" ]; then
    [ "$(stat -f '%d:%i' "$left")" = "$(stat -f '%d:%i' "$right")" ]
    return
  fi
  left_base=$(basename -- "$left" | tr '[:upper:]' '[:lower:]')
  right_base=$(basename -- "$right" | tr '[:upper:]' '[:lower:]')
  [ "$left_base" = "$right_base" ] &&
    [ "$(stat -f '%d:%i' "$(dirname -- "$left")")" = \
      "$(stat -f '%d:%i' "$(dirname -- "$right")")" ]
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --test-prefix)
      [ "$#" -ge 2 ] || usage
      test_prefix=$2
      shift 2
      ;;
    --snapshot)
      [ "$#" -ge 2 ] || usage
      snapshot=$2
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$snapshot" ] || usage
[ -z "$test_prefix" ] || {
  [ "${PUDDLES_KEYCHAIN_HELPER_TESTING:-}" = "1" ] || usage
  prefix=$test_prefix
}
case "$prefix" in
  /*) ;;
  *) usage ;;
esac
production_prefix=$(canonicalize_prefix "$home_dir/.local")
prefix=$(canonicalize_prefix "$prefix")
if [ -n "$test_prefix" ]; then
  ! same_target "$prefix" "$production_prefix" || usage
fi
[ -d "$snapshot" ] || {
  echo "rollback snapshot does not exist" >&2
  exit 66
}

helper_path="$prefix/libexec/puddles-keychain-helper/puddles-keychain-helper"
wrapper_path="$prefix/bin/puddles-with-keychain-secret"
state_dir="$prefix/state/puddles-keychain-helper"
transaction="$state_dir/pending-rollback"
operation_lock="$state_dir/operation.lock"
lock_owned=0
lock_owner_pid=
resolved_snapshot=$(realpath "$snapshot")
resolved_state=$(realpath "$state_dir")
case "$resolved_snapshot" in
  "$resolved_state"/rollback-*) ;;
  *)
    echo "rollback snapshot is outside the helper state directory" >&2
    exit 65
    ;;
esac

assert_secure_dir() {
  path=$1
  [ -d "$path" ] && [ ! -L "$path" ] || {
    echo "rollback directory is missing, not a directory, or a symlink: $path" >&2
    exit 73
  }

  sync_state() {
    "$sync_command"
  }
  metadata=$(stat -f '%u %Lp' "$path")
  owner=${metadata%% *}
  mode=${metadata#* }
  [ "$owner" = "$(id -u)" ] || {
    echo "rollback directory is not owned by the current user: $path" >&2
    exit 73
  }
  [ $((0$mode & 0022)) -eq 0 ] || {
    echo "rollback directory is group- or other-writable: $path" >&2
    exit 73
  }
  if ls -lde "$path" | sed -n '2,$p' | grep -v ' deny ' | grep -q .; then
    echo "rollback directory has an ACL that can grant access: $path" >&2
    exit 73
  fi
}

acquire_lock() {
  inherited_state=${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE:-}
  inherited_owner=${PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER:-}
  if [ -n "$inherited_state" ] || [ -n "$inherited_owner" ]; then
    [ "$inherited_state" = "$state_dir" ] || {
      echo "invalid inherited helper operation lock state" >&2
      exit 75
    }
    case "$inherited_owner" in
      ''|*[!0-9]*)
        echo "invalid inherited helper operation lock owner" >&2
        exit 75
        ;;
    esac
    [ "$(sed -n '1p' "$operation_lock" 2>/dev/null || true)" = "$inherited_owner" ] &&
      kill -0 "$inherited_owner" 2>/dev/null || {
      echo "inherited helper operation lock is not active" >&2
      exit 75
    }
    lock_owner_pid=$inherited_owner
    return
  fi
  if /usr/bin/shlock -f "$operation_lock" -p "$$"; then
    lock_owned=1
    lock_owner_pid=$$
    return
  fi
  echo "another helper install or rollback is running" >&2
  exit 75
}

release_lock() {
  if [ "$lock_owned" -eq 1 ]; then
    current_pid=$(sed -n '1p' "$operation_lock" 2>/dev/null || true)
    if [ "$current_pid" = "$$" ]; then
      rm -f "$operation_lock"
    fi
    lock_owned=0
  fi
}

assert_secure_dir "$(dirname -- "$prefix")"
assert_secure_dir "$prefix"
assert_secure_dir "$prefix/libexec"
assert_secure_dir "$(dirname -- "$helper_path")"
assert_secure_dir "$(dirname -- "$wrapper_path")"
assert_secure_dir "$state_dir"
assert_secure_dir "$resolved_snapshot"
[ ! -L "$helper_path" ] && [ ! -L "$wrapper_path" ] || {
  echo "refusing to restore over a symlinked installation" >&2
  exit 73
}

acquire_lock
helper_stage="$helper_path.rollback.$$"
wrapper_stage="$wrapper_path.rollback.$$"
cleanup() {
  rm -f "$helper_stage" "$wrapper_stage"
  release_lock
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if [ -f "$transaction" ]; then
  pending_snapshot=$(sed -n '1p' "$transaction")
  pending_resolved_snapshot=$(realpath "$pending_snapshot")
  [ "$pending_resolved_snapshot" = "$resolved_snapshot" ] || {
    echo "a different rollback transaction is pending: $pending_snapshot" >&2
    release_lock
    exit 75
  }
fi

helper_restore=0
wrapper_restore=0
if [ -f "$resolved_snapshot/helper" ] && [ ! -L "$resolved_snapshot/helper" ]; then
  helper_restore=1
elif [ ! -L "$resolved_snapshot/helper.absent" ] &&
  [ -f "$resolved_snapshot/helper.absent" ]; then
  helper_restore=2
else
  echo "rollback snapshot has no helper state" >&2
  exit 65
fi

if [ -f "$resolved_snapshot/wrapper" ] && [ ! -L "$resolved_snapshot/wrapper" ]; then
  wrapper_restore=1
elif [ ! -L "$resolved_snapshot/wrapper.absent" ] &&
  [ -f "$resolved_snapshot/wrapper.absent" ]; then
  wrapper_restore=2
else
  echo "rollback snapshot has no wrapper state" >&2
  exit 65
fi

if [ "$helper_restore" -eq 1 ]; then
  install -m 0500 "$resolved_snapshot/helper" "$helper_stage"
fi
if [ "$wrapper_restore" -eq 1 ]; then
  install -m 0500 "$resolved_snapshot/wrapper" "$wrapper_stage"
fi
sync_state

if [ ! -f "$transaction" ]; then
  transaction_new="$transaction.new.$$"
  printf '%s\n' "$resolved_snapshot" >"$transaction_new"
  chmod 0600 "$transaction_new"
  mv -f "$transaction_new" "$transaction"
fi
sync_state
if [ "$helper_restore" -eq 1 ]; then
  mv -f "$helper_stage" "$helper_path"
else
  rm -f "$helper_path"
fi
if [ "$wrapper_restore" -eq 1 ]; then
  mv -f "$wrapper_stage" "$wrapper_path"
else
  rm -f "$wrapper_path"
fi
sync_state
rm -f "$transaction"
sync_state
release_lock
trap - EXIT HUP INT TERM

echo "Restored helper installation from $resolved_snapshot"
