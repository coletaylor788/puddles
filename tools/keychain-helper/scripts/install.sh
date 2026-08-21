#!/bin/sh
set -eu
umask 077

usage() {
  echo "usage: install.sh (--signing-identity-sha1 HASH | --test-adhoc --test-prefix PATH) [--snapshot-output-file PATH] [--replace-approved-helper] [--test-variant-two]" >&2
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
identity_sha1=
test_adhoc=0
test_variant_two=0
test_prefix=
snapshot_output_file=
replace_approved_helper=0
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
    --signing-identity-sha1)
      [ "$#" -ge 2 ] || usage
      identity_sha1=$2
      shift 2
      ;;
    --snapshot-output-file)
      [ "$#" -ge 2 ] || usage
      snapshot_output_file=$2
      shift 2
      ;;
    --replace-approved-helper)
      replace_approved_helper=1
      shift
      ;;
    --test-adhoc)
      test_adhoc=1
      shift
      ;;
    --test-variant-two)
      test_variant_two=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

case "$test_adhoc:$identity_sha1" in
  1:)
    [ -n "$test_prefix" ] ||
      [ "${PUDDLES_KEYCHAIN_HELPER_TESTING:-}" = "1" ] ||
      usage
    prefix=$test_prefix
    [ "$prefix" != "$home_dir/.local" ] || usage
    ;;
  0:????????????????????????????????????????) ;;
  *) usage ;;
esac
case "$prefix" in
  /*) ;;
  *) usage ;;
esac
if [ "$replace_approved_helper" -eq 1 ] && [ "$test_adhoc" -eq 0 ]; then
  [ "${PUDDLES_KEYCHAIN_HELPER_REAPPROVAL:-}" = "1" ] || {
    echo "helper replacement is allowed only during explicit interactive reapproval" >&2
    exit 77
  }
  [ -n "$snapshot_output_file" ] || {
    echo "helper replacement requires a durable rollback snapshot handoff" >&2
    exit 77
  }
fi
production_prefix=$(canonicalize_prefix "$home_dir/.local")
prefix=$(canonicalize_prefix "$prefix")
if [ "$test_adhoc" -eq 1 ]; then
  ! same_target "$prefix" "$production_prefix" || usage
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")
prefix_parent=$(dirname -- "$prefix")
helper_dir="$prefix/libexec/puddles-keychain-helper"
helper_path="$helper_dir/puddles-keychain-helper"
wrapper_dir="$prefix/bin"
wrapper_path="$wrapper_dir/puddles-with-keychain-secret"
state_dir="$prefix/state/puddles-keychain-helper"
snapshot="$state_dir/rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
stage="$state_dir/stage-$$"
transaction="$state_dir/pending-install"
committed_transaction="$state_dir/last-install"
rollback_transaction="$state_dir/pending-rollback"
operation_lock="$state_dir/operation.lock"
lock_owned=0
lock_owner_pid=

assert_secure_dir() {
  path=$1
  [ -d "$path" ] && [ ! -L "$path" ] || {
    echo "installation directory is missing, not a directory, or a symlink: $path" >&2
    exit 73
  }

  sync_state() {
    "$sync_command"
  }
  metadata=$(stat -f '%u %Lp' "$path")
  owner=${metadata%% *}
  mode=${metadata#* }
  [ "$owner" = "$(id -u)" ] || {
    echo "installation directory is not owned by the current user: $path" >&2
    exit 73
  }
  [ $((0$mode & 0022)) -eq 0 ] || {
    echo "installation directory is group- or other-writable: $path" >&2
    exit 73
  }
  if ls -lde "$path" | sed -n '2,$p' | grep -v ' deny ' | grep -q .; then
    echo "installation directory has an ACL that can grant access: $path" >&2
    exit 73
  fi
}

ensure_secure_dir() {
  path=$1
  if [ -e "$path" ] || [ -L "$path" ]; then
    assert_secure_dir "$path"
    return
  fi
  mkdir "$path"
  chmod 0700 "$path"
  assert_secure_dir "$path"
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

assert_secure_dir "$prefix_parent"
ensure_secure_dir "$prefix"
ensure_secure_dir "$prefix/libexec"
ensure_secure_dir "$helper_dir"
ensure_secure_dir "$wrapper_dir"
ensure_secure_dir "$prefix/state"
ensure_secure_dir "$state_dir"
if [ -n "$snapshot_output_file" ]; then
  case "$snapshot_output_file" in
    /*) ;;
    *) usage ;;
  esac
  [ ! -e "$snapshot_output_file" ] && [ ! -L "$snapshot_output_file" ] || {
    echo "snapshot output file already exists" >&2
    exit 73
  }
  assert_secure_dir "$(dirname -- "$snapshot_output_file")"
fi

[ ! -L "$helper_path" ] && [ ! -L "$wrapper_path" ] || {
  echo "refusing to replace a symlinked installation" >&2
  exit 73
}

acquire_lock

run_rollback() {
  rollback_snapshot=$1
  if [ "$test_adhoc" -eq 1 ]; then
    PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
      PUDDLES_KEYCHAIN_HELPER_LOCK_STATE="$state_dir" \
      PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER="$lock_owner_pid" \
      "$script_dir/rollback-install.sh" \
      --test-prefix "$prefix" \
      --snapshot "$rollback_snapshot"
  else
    PUDDLES_KEYCHAIN_HELPER_LOCK_STATE="$state_dir" \
      PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER="$lock_owner_pid" \
      "$script_dir/rollback-install.sh" \
      --snapshot "$rollback_snapshot"
  fi
}

rollback_on_error() {
  if [ "$promotion_started" -eq 1 ] && [ -f "$transaction" ]; then
    run_rollback "$snapshot" >/dev/null || return 1
    rm -f "$transaction"
  fi
  rm -rf "$stage"
}
completed=0
promotion_started=0
finish() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$completed" -ne 1 ]; then
    if ! rollback_on_error; then
      echo "automatic rollback failed; recovery markers were preserved" >&2
      [ "$status" -ne 0 ] || status=75
    fi
  fi
  release_lock
  exit "$status"
}
trap finish EXIT
trap 'exit 130' HUP INT TERM

if [ -f "$rollback_transaction" ]; then
  pending_snapshot=$(sed -n '1p' "$rollback_transaction")
  run_rollback "$pending_snapshot" >/dev/null
fi

if [ -f "$transaction" ]; then
  pending_snapshot=$(sed -n '1p' "$transaction")
  run_rollback "$pending_snapshot" >/dev/null
  rm -f "$transaction"
  sync_state
fi

if [ "$test_adhoc" -eq 0 ] &&
  [ "$replace_approved_helper" -ne 1 ] &&
  [ -e "$helper_path" ]; then
  echo "The Keychain-approved helper is already installed; refusing to replace it." >&2
  echo "Helper updates require a deliberate rollback/removal and new interactive approval." >&2
  exit 65
fi

mkdir "$snapshot"
mkdir "$stage"
chmod 0700 "$snapshot" "$stage"
assert_secure_dir "$snapshot"
assert_secure_dir "$stage"

if [ -e "$helper_path" ]; then
  cp -p "$helper_path" "$snapshot/helper"
else
  : >"$snapshot/helper.absent"
fi
if [ -e "$wrapper_path" ]; then
  cp -p "$wrapper_path" "$snapshot/wrapper"
else
  : >"$snapshot/wrapper.absent"
fi
if [ -n "$snapshot_output_file" ]; then
  snapshot_output_new="$snapshot_output_file.new.$$"
  printf '%s\n' "$snapshot" >"$snapshot_output_new"
  chmod 0600 "$snapshot_output_new"
  mv -f "$snapshot_output_new" "$snapshot_output_file"
fi
sync_state

set -- --output "$stage/puddles-keychain-helper"
if [ "$test_adhoc" -eq 1 ]; then
  set -- "$@" --test-adhoc
else
  set -- "$@" --signing-identity-sha1 "$identity_sha1"
fi
if [ "$test_variant_two" -eq 1 ]; then
  set -- "$@" --test-variant-two
fi
"$script_dir/build.sh" "$@"
install -m 0500 "$project_dir/scripts/puddles-with-keychain-secret" "$stage/puddles-with-keychain-secret"
sync_state

transaction_new="$transaction.new.$$"
promotion_started=1
printf '%s\n' "$snapshot" >"$transaction_new"
chmod 0600 "$transaction_new"
mv -f "$transaction_new" "$transaction"
sync_state
mv -f "$stage/puddles-keychain-helper" "$helper_path"
mv -f "$stage/puddles-with-keychain-secret" "$wrapper_path"
rmdir "$stage"
sync_state
mv -f "$transaction" "$committed_transaction"
sync_state
completed=1

printf 'Installed helper: %s\n' "$helper_path"
printf 'Installed wrapper: %s\n' "$wrapper_path"
printf 'Rollback snapshot: %s\n' "$snapshot"
