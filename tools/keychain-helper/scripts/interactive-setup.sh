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

config_dir="$home_dir/.config/puddles-keychain-helper"
allowlist="$config_dir/allowlist.tsv"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ ! -L "$config_dir" ] || {
  echo "Refusing to use a symlinked helper config directory" >&2
  exit 73
}
install -d -m 0700 "$config_dir"
setup_state=$(mktemp -d "$config_dir/.interactive-setup.XXXXXX")
chmod 0700 "$setup_state"

backup="$setup_state/allowlist-backup"
had_allowlist=0
if [ -e "$allowlist" ] || [ -L "$allowlist" ]; then
  [ -f "$allowlist" ] && [ ! -L "$allowlist" ] || {
    echo "Refusing to replace a non-regular or symlinked allowlist" >&2
    exit 73
  }
  cp -p "$allowlist" "$backup"
  had_allowlist=1
fi

temporary="$setup_state/allowlist"
completed=0
install_snapshot=
snapshot_handoff="$setup_state/install-snapshot"
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  rm -f "$temporary"
  if [ -z "$install_snapshot" ] && [ -f "$snapshot_handoff" ]; then
    install_snapshot=$(sed -n '1p' "$snapshot_handoff")
  fi
  if [ "$completed" -ne 1 ] && [ -n "$install_snapshot" ]; then
    if ! "$script_dir/rollback-install.sh" \
      --snapshot "$install_snapshot" >/dev/null; then
      echo "Interactive setup rollback failed; inspect: $install_snapshot" >&2
      status=75
    fi
  fi
  if [ "$completed" -eq 1 ]; then
    rm -f "$backup"
  elif [ "$had_allowlist" -eq 1 ]; then
    mv -f "$backup" "$allowlist"
  else
    rm -f "$allowlist"
  fi
  rm -rf "$setup_state"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
printf '%s\n%s\t%s\t%s\n' \
  'puddles-keychain-helper-v1' \
  'todoist-api-token' 'todoist-cli' "$todoist_account" \
  >"$temporary"
chmod -N "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$allowlist"

install_output=$(
  "$script_dir/install.sh" \
    --signing-identity-sha1 "$identity_sha1" \
    --snapshot-output-file "$snapshot_handoff"
)
install_snapshot=$(sed -n '1p' "$snapshot_handoff")
[ -d "$install_snapshot" ] || {
  echo "Installer did not return a valid rollback snapshot" >&2
  exit 75
}
printf '%s\n' "$install_output"

helper="$home_dir/.local/libexec/puddles-keychain-helper/puddles-keychain-helper"
echo "Approve Always Allow only for the todoist-cli item."
"$helper" todoist-api-token >/dev/null
completed=1
echo "Interactive Keychain approval completed."
