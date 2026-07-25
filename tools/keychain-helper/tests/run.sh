#!/bin/sh
set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")
tmp=$(mktemp -d)
synthetic_secret='synthetic-secret-value'
allowlist="$tmp/allowlist.tsv"
helper="$tmp/puddles-keychain-helper"
wrapper="$project_dir/scripts/puddles-with-keychain-secret"

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_failure() {
  if "$@" >"$tmp/unexpected.stdout" 2>"$tmp/expected.stderr"; then
    fail "command unexpectedly succeeded: $*"
  fi
  [ ! -s "$tmp/unexpected.stdout" ] || fail "failure wrote to stdout"
}

printf 'puddles-keychain-helper-v1\ngmail-oauth-token\tgmail-mcp\ttoken\ntodoist-api-token\ttodoist-cli\tuser-123\n' >"$allowlist"
chmod 0600 "$allowlist"

"$project_dir/scripts/build.sh" --output "$helper" --test-adhoc

run_helper() {
  PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST="$allowlist" \
    PUDDLES_KEYCHAIN_HELPER_TEST_RESULT="${PUDDLES_KEYCHAIN_HELPER_TEST_RESULT:-success}" \
    "$helper" "$@"
}

actual=$(run_helper gmail-oauth-token)
[ "$actual" = "$synthetic_secret" ] || fail "allowlisted read differed"
unset actual

expect_failure run_helper unknown-alias
expect_failure run_helper
expect_failure run_helper gmail-oauth-token extra

cp "$allowlist" "$tmp/allowlist.good"
printf 'wrong-version\ngmail-oauth-token\tgmail-mcp\ttoken\n' >"$allowlist"
expect_failure run_helper gmail-oauth-token
printf 'puddles-keychain-helper-v1\ngmail-oauth-token\tgmail-mcp\ttoken\ngmail-oauth-token\tother\titem\n' >"$allowlist"
expect_failure run_helper gmail-oauth-token
dd if=/dev/zero of="$allowlist" bs=65537 count=1 2>/dev/null
expect_failure run_helper gmail-oauth-token
cp "$tmp/allowlist.good" "$allowlist"
chmod 0644 "$allowlist"
expect_failure run_helper gmail-oauth-token
chmod 0600 "$allowlist"
chmod +a "everyone deny write" "$allowlist"
expect_failure run_helper gmail-oauth-token
chmod -N "$allowlist"
mv "$allowlist" "$tmp/allowlist.real"
ln -s "$tmp/allowlist.real" "$allowlist"
expect_failure run_helper gmail-oauth-token
rm "$allowlist"
mv "$tmp/allowlist.real" "$allowlist"

printf 'puddles-keychain-helper-v1\nmissing\tmissing-service\tmissing-account\n' >"$allowlist"
PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=missing expect_failure run_helper missing
cp "$tmp/allowlist.good" "$allowlist"

PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=denied \
  expect_failure run_helper gmail-oauth-token
PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=interaction \
  expect_failure run_helper gmail-oauth-token
PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=empty \
  expect_failure run_helper gmail-oauth-token
unset PUDDLES_KEYCHAIN_HELPER_TEST_RESULT

i=1
while [ "$i" -le 8 ]; do
  run_helper gmail-oauth-token >"$tmp/concurrent.$i" &
  i=$((i + 1))
done
wait
i=1
while [ "$i" -le 8 ]; do
  value=$(cat "$tmp/concurrent.$i")
  [ "$value" = "$synthetic_secret" ] || fail "concurrent read differed"
  rm "$tmp/concurrent.$i"
  i=$((i + 1))
done
unset value

PUDDLES_KEYCHAIN_HELPER_BIN="$helper" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST="$allowlist" \
  PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=success \
  "$wrapper" TEST_SECRET gmail-oauth-token -- \
  /usr/bin/python3 -c \
  'import os,sys; sys.exit(0 if os.environ.get("TEST_SECRET") == "synthetic-secret-value" else 1)'

PUDDLES_KEYCHAIN_HELPER_BIN="$helper" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST="$allowlist" \
  PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=success \
  "$wrapper" TEST_SECRET gmail-oauth-token -- \
  node -e \
  'process.exit(process.env.TEST_SECRET === "synthetic-secret-value" ? 0 : 1)'

run_wrapper() {
  PUDDLES_KEYCHAIN_HELPER_BIN="$helper" \
    PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST="$allowlist" \
    PUDDLES_KEYCHAIN_HELPER_TEST_RESULT="${PUDDLES_KEYCHAIN_HELPER_TEST_RESULT:-success}" \
    "$wrapper" "$@"
}
expect_failure run_wrapper 'INVALID-NAME' gmail-oauth-token -- /usr/bin/true
rm -f "$tmp/child-ran"
expect_failure run_wrapper TEST_SECRET unknown-alias -- \
  /usr/bin/touch "$tmp/child-ran"
[ ! -e "$tmp/child-ran" ] || fail "wrapper ran child after helper failure"
printf 'puddles-keychain-helper-v1\ngmail-oauth-token\tgmail-mcp\ttoken\nbinary-secret\tsynthetic-binary\tbinary\n' >"$allowlist"
PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=binary \
  expect_failure run_wrapper TEST_SECRET binary-secret -- \
  /usr/bin/touch "$tmp/child-ran"
unset PUDDLES_KEYCHAIN_HELPER_TEST_RESULT
[ ! -e "$tmp/child-ran" ] || fail "wrapper exported a binary secret"
cp "$tmp/allowlist.good" "$allowlist"

consumer_home="$tmp/consumer-home"
mkdir -p \
  "$consumer_home/.local/bin" \
  "$consumer_home/.local/libexec/puddles-keychain-helper" \
  "$consumer_home/.npm-global/lib/node_modules/@doist/todoist-cli/dist"
install -m 0500 "$helper" \
  "$consumer_home/.local/libexec/puddles-keychain-helper/puddles-keychain-helper"
install -m 0500 "$wrapper" \
  "$consumer_home/.local/bin/puddles-with-keychain-secret"
printf '%s\n' \
  'const ok = process.env.TODOIST_API_TOKEN === "synthetic-secret-value" && process.argv[2] === "expected-argument";' \
  'process.exit(ok ? 0 : 1);' \
  >"$consumer_home/.npm-global/lib/node_modules/@doist/todoist-cli/dist/index.js"
HOME="$consumer_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST="$allowlist" \
  PUDDLES_KEYCHAIN_HELPER_TEST_RESULT=success \
  "$project_dir/consumers/td" expected-argument

requirement_before=$(codesign -d -r- "$helper" 2>&1 | sed -n 's/^designated => //p')
cdhash_before=$(codesign -d -vvv "$helper" 2>&1 | sed -n 's/^CDHash=//p')
"$project_dir/scripts/build.sh" \
  --output "$helper" \
  --test-adhoc \
  --test-variant-two
requirement_after=$(codesign -d -r- "$helper" 2>&1 | sed -n 's/^designated => //p')
cdhash_after=$(codesign -d -vvv "$helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$requirement_before" = "$requirement_after" ] || fail "designated requirement changed"
[ "$cdhash_before" != "$cdhash_after" ] || fail "rebuild did not change CDHash"

prefix="$tmp/prefix"
snapshot_handoff="$tmp/install-snapshot"
install_output=$(PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  --snapshot-output-file "$snapshot_handoff")
snapshot_absent=$(printf '%s\n' "$install_output" | sed -n 's/^Rollback snapshot: //p')
[ "$(cat "$snapshot_handoff")" = "$snapshot_absent" ] ||
  fail "snapshot handoff differed from installer output"
[ -x "$prefix/libexec/puddles-keychain-helper/puddles-keychain-helper" ] ||
  fail "helper was not installed"
[ -x "$prefix/bin/puddles-with-keychain-secret" ] ||
  fail "wrapper was not installed"
installed_helper="$prefix/libexec/puddles-keychain-helper/puddles-keychain-helper"
installed_v1=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')

if PUDDLES_KEYCHAIN_HELPER_TESTING=1 DEVELOPER_DIR=/nonexistent \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  >"$tmp/failed-install.stdout" 2>"$tmp/failed-install.stderr"; then
  fail "install unexpectedly accepted a missing signing identity"
fi
installed_after_failure=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$installed_after_failure" = "$installed_v1" ] ||
  fail "failed promotion changed the installed helper"

expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$HOME/.local" \
  --test-adhoc
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$HOME/.local/" \
  --test-adhoc
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$HOME/.LOCAL" \
  --test-adhoc
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "/System/Volumes/Data/Users/$(id -un)/.local" \
  --test-adhoc

printf '%s\n' "$$" >"$prefix/state/puddles-keychain-helper/operation.lock"
chmod 0600 "$prefix/state/puddles-keychain-helper/operation.lock"
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc
rm -f "$prefix/state/puddles-keychain-helper/operation.lock"
installed_after_lock=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$installed_after_lock" = "$installed_v1" ] ||
  fail "concurrent-operation rejection changed the installed helper"

install_output=$(PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  --test-variant-two)
snapshot_v1=$(printf '%s\n' "$install_output" | sed -n 's/^Rollback snapshot: //p')
installed_v2=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$installed_v2" != "$installed_v1" ] ||
  fail "second promotion did not replace the helper"

printf '%s\n' "$snapshot_v1" >"$prefix/state/puddles-keychain-helper/pending-install"
chmod 0600 "$prefix/state/puddles-keychain-helper/pending-install"
if PUDDLES_KEYCHAIN_HELPER_TESTING=1 DEVELOPER_DIR=/nonexistent \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  >"$tmp/recovery.stdout" 2>"$tmp/recovery.stderr"; then
  fail "recovery probe unexpectedly accepted a missing signing identity"
fi
recovered_v1=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$recovered_v1" = "$installed_v1" ] ||
  fail "pending transaction recovery hash differed from the saved helper"

install_output=$(PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  --test-variant-two)
snapshot_v1_again=$(printf '%s\n' "$install_output" | sed -n 's/^Rollback snapshot: //p')
printf '%s\n' "$snapshot_v1_again" >"$prefix/state/puddles-keychain-helper/pending-rollback"
chmod 0600 "$prefix/state/puddles-keychain-helper/pending-rollback"
if PUDDLES_KEYCHAIN_HELPER_TESTING=1 DEVELOPER_DIR=/nonexistent \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$prefix" \
  --test-adhoc \
  >"$tmp/rollback-recovery.stdout" 2>"$tmp/rollback-recovery.stderr"; then
  fail "rollback recovery probe unexpectedly built a helper"
fi
rollback_recovered_v1=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$rollback_recovered_v1" = "$installed_v1" ] ||
  fail "pending rollback was not completed before the next install"
[ ! -f "$prefix/state/puddles-keychain-helper/pending-rollback" ] ||
  fail "completed rollback left its transaction marker"

PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/rollback-install.sh" \
  --test-prefix "$prefix" \
  --snapshot "$snapshot_v1" >/dev/null
[ ! -e "$prefix/state/puddles-keychain-helper/operation.lock" ] ||
  fail "successful rollback left its operation lock"
restored_v1=$(codesign -d -vvv "$installed_helper" 2>&1 | sed -n 's/^CDHash=//p')
[ "$restored_v1" = "$installed_v1" ] ||
  fail "rollback did not restore the previous helper"
PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/rollback-install.sh" \
  --test-prefix "$prefix" \
  --snapshot "$snapshot_absent" >/dev/null
[ ! -e "$prefix/libexec/puddles-keychain-helper/puddles-keychain-helper" ] ||
  fail "rollback did not remove newly installed helper"
[ ! -e "$prefix/bin/puddles-with-keychain-secret" ] ||
  fail "rollback did not remove newly installed wrapper"

if grep -F "$synthetic_secret" "$tmp/expected.stderr" "$tmp/unexpected.stdout" >/dev/null 2>&1; then
  fail "secret appeared in failure output"
fi

echo "keychain-helper synthetic lifecycle: PASS"
