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

actual=$(
  PUDDLES_KEYCHAIN_HELPER_TEST_EXPECT_INTERACTION=deny \
    run_helper gmail-oauth-token
)
[ "$actual" = "$synthetic_secret" ] || fail "allowlisted read differed"
unset actual

actual=$(
  PUDDLES_KEYCHAIN_HELPER_TEST_EXPECT_INTERACTION=allow \
    run_helper --approve gmail-oauth-token
)
[ "$actual" = "$synthetic_secret" ] || fail "approval read differed"
unset actual

expect_failure run_helper unknown-alias
expect_failure run_helper
expect_failure run_helper gmail-oauth-token extra
expect_failure run_helper --approve
expect_failure run_helper --approve gmail-oauth-token extra

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

fake_install="$tmp/fake-install.sh"
fake_rollback="$tmp/fake-rollback.sh"
fake_sync="$tmp/fake-sync.sh"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'handoff=$1' \
  'home=$2' \
  'if [ "${PUDDLES_FAKE_EXPECT_OPERATION_LOCK:-0}" = "1" ]; then [ "$(cat "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE:?}/operation.lock")" = "${PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER:?}" ] || exit 73; if /usr/bin/shlock -f "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE}/operation.lock" -p "$$"; then rm -f "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE}/operation.lock"; exit 74; fi; fi' \
  'snapshot="$home/fake-install-snapshot-$$"' \
  'mkdir -p "$snapshot"' \
  'chmod 0700 "$snapshot"' \
  'helper_dir="$home/.local/libexec/puddles-keychain-helper"' \
  'wrapper_dir="$home/.local/bin"' \
  'mkdir -p "$helper_dir" "$wrapper_dir"' \
  'if [ -f "$helper_dir/puddles-keychain-helper" ]; then cp -p "$helper_dir/puddles-keychain-helper" "$snapshot/helper"; else : >"$snapshot/helper.absent"; fi' \
  'if [ -f "$wrapper_dir/puddles-with-keychain-secret" ]; then cp -p "$wrapper_dir/puddles-with-keychain-secret" "$snapshot/wrapper"; else : >"$snapshot/wrapper.absent"; fi' \
  'printf "%s\n" "$snapshot" >"$handoff"' \
  'chmod 0600 "$handoff"' \
  '[ "${PUDDLES_FAKE_INSTALL_MODE:-success}" != "fail" ] || exit 70' \
  'install -m 0500 "${PUDDLES_FAKE_HELPER_SOURCE:?}" "$helper_dir/puddles-keychain-helper.new"' \
  'mv -f "$helper_dir/puddles-keychain-helper.new" "$helper_dir/puddles-keychain-helper"' \
  'printf "%s\n" "#!/bin/sh" "exit 0" >"$wrapper_dir/puddles-with-keychain-secret.new"' \
  'chmod 0500 "$wrapper_dir/puddles-with-keychain-secret.new"' \
  'mv -f "$wrapper_dir/puddles-with-keychain-secret.new" "$wrapper_dir/puddles-with-keychain-secret"' \
  'printf "Rollback snapshot: %s\n" "$snapshot"' \
  >"$fake_install"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'snapshot=$1' \
  'if [ "${PUDDLES_FAKE_EXPECT_OPERATION_LOCK:-0}" = "1" ]; then [ "$(cat "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE:?}/operation.lock")" = "${PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER:?}" ] || exit 73; if /usr/bin/shlock -f "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE}/operation.lock" -p "$$"; then rm -f "${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE}/operation.lock"; exit 74; fi; fi' \
  'printf "%s\n" "$snapshot" >>"${PUDDLES_FAKE_ROLLBACK_LOG:?}"' \
  '[ "${PUDDLES_FAKE_ROLLBACK_FAIL:-0}" != "1" ] || exit 71' \
  'helper="${PUDDLES_FAKE_HOME:?}/.local/libexec/puddles-keychain-helper/puddles-keychain-helper"' \
  'wrapper="${PUDDLES_FAKE_HOME:?}/.local/bin/puddles-with-keychain-secret"' \
  'if [ -f "$snapshot/helper" ]; then cp -p "$snapshot/helper" "$helper.rollback"; mv -f "$helper.rollback" "$helper"; elif [ -f "$snapshot/helper.absent" ]; then rm -f "$helper"; fi' \
  'if [ -f "$snapshot/wrapper" ]; then cp -p "$snapshot/wrapper" "$wrapper.rollback"; mv -f "$wrapper.rollback" "$wrapper"; elif [ -f "$snapshot/wrapper.absent" ]; then rm -f "$wrapper"; fi' \
  >"$fake_rollback"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "sync\n" >>"${PUDDLES_FAKE_SYNC_LOG:?}"' \
  'count=$(wc -l <"${PUDDLES_FAKE_SYNC_LOG}" | tr -d " ")' \
  '[ "${PUDDLES_FAKE_SYNC_FAIL:-0}" != "1" ] || exit 72' \
  '[ -z "${PUDDLES_FAKE_SYNC_FAIL_AT:-}" ] || [ "$count" -ne "$PUDDLES_FAKE_SYNC_FAIL_AT" ] || exit 72' \
  >"$fake_sync"
chmod 0500 "$fake_install" "$fake_rollback" "$fake_sync"

setup_script="$project_dir/scripts/interactive-setup.sh"
setup_home="$tmp/setup-recovery-home"
setup_config="$setup_home/.config/puddles-keychain-helper"
stale_state="$setup_config/.interactive-setup.stale"
stale_snapshot="$setup_home/stale-install-snapshot"
rollback_log="$tmp/setup-rollback.log"
sync_log="$tmp/setup-sync.log"
mkdir -p "$stale_state" "$stale_snapshot"
chmod 0700 "$setup_config" "$stale_state" "$stale_snapshot"
printf 'original-allowlist\n' >"$stale_state/allowlist-backup"
: >"$stale_state/allowlist-present"
printf '%s\n' "$stale_snapshot" >"$stale_state/install-snapshot"
printf '%s\n' "$stale_state" >"$setup_config/pending-interactive-setup"
printf 'interrupted-allowlist\n' >"$setup_config/allowlist.tsv"
chmod 0600 \
  "$stale_state/allowlist-backup" \
  "$stale_state/allowlist-present" \
  "$stale_state/install-snapshot" \
  "$setup_config/pending-interactive-setup" \
  "$setup_config/allowlist.tsv"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$setup_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_INSTALL_MODE=fail \
  PUDDLES_FAKE_ROLLBACK_LOG="$rollback_log" \
  PUDDLES_FAKE_SYNC_LOG="$sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$setup_home" \
  "$setup_script" user-123
[ "$(cat "$setup_config/allowlist.tsv")" = "original-allowlist" ] ||
  fail "stale setup recovery did not restore the original allowlist"
[ ! -e "$setup_config/pending-interactive-setup" ] ||
  fail "stale setup recovery left its pending marker"
[ "$(wc -l <"$rollback_log" | tr -d ' ')" -eq 2 ] ||
  fail "stale and current failed setup snapshots were not rolled back"
[ "$(wc -l <"$sync_log" | tr -d ' ')" -ge 6 ] ||
  fail "stale setup recovery did not sync durable state transitions"

nondurable_home="$tmp/setup-nondurable-home"
nondurable_config="$nondurable_home/.config/puddles-keychain-helper"
nondurable_log="$tmp/nondurable-rollback.log"
nondurable_sync_log="$tmp/nondurable-sync.log"
mkdir -p "$nondurable_config"
chmod 0700 "$nondurable_config"
printf 'prior-allowlist\n' >"$nondurable_config/allowlist.tsv"
chmod 0600 "$nondurable_config/allowlist.tsv"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$nondurable_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_DURABLE=0 \
  PUDDLES_FAKE_ROLLBACK_LOG="$nondurable_log" \
  PUDDLES_FAKE_SYNC_LOG="$nondurable_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$nondurable_home" \
  "$setup_script" user-123
[ "$(cat "$nondurable_config/allowlist.tsv")" = "prior-allowlist" ] ||
  fail "nondurable approval did not restore the prior allowlist"
[ "$(wc -l <"$nondurable_log" | tr -d ' ')" -eq 1 ] ||
  fail "nondurable approval did not roll back the install"
[ "$(wc -l <"$nondurable_sync_log" | tr -d ' ')" -ge 5 ] ||
  fail "nondurable approval rollback did not sync durable state transitions"

rollback_failure_home="$tmp/setup-rollback-failure-home"
rollback_failure_config="$rollback_failure_home/.config/puddles-keychain-helper"
rollback_failure_log="$tmp/rollback-failure.log"
rollback_failure_sync_log="$tmp/rollback-failure-sync.log"
mkdir -p "$rollback_failure_config"
chmod 0700 "$rollback_failure_config"
printf 'prior-allowlist\n' >"$rollback_failure_config/allowlist.tsv"
chmod 0600 "$rollback_failure_config/allowlist.tsv"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$rollback_failure_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_DURABLE=0 \
  PUDDLES_FAKE_ROLLBACK_FAIL=1 \
  PUDDLES_FAKE_ROLLBACK_LOG="$rollback_failure_log" \
  PUDDLES_FAKE_SYNC_LOG="$rollback_failure_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$rollback_failure_home" \
  "$setup_script" user-123
[ -f "$rollback_failure_config/pending-interactive-setup" ] ||
  fail "rollback failure did not preserve the pending setup marker"
rollback_failure_state=$(cat "$rollback_failure_config/pending-interactive-setup")
[ -d "$rollback_failure_state" ] ||
  fail "rollback failure did not preserve setup recovery state"

sync_failure_home="$tmp/setup-sync-failure-home"
sync_failure_config="$sync_failure_home/.config/puddles-keychain-helper"
sync_failure_log="$tmp/sync-failure-rollback.log"
sync_failure_sync_log="$tmp/sync-failure.log"
mkdir -p "$sync_failure_config"
chmod 0700 "$sync_failure_config"
printf 'prior-allowlist\n' >"$sync_failure_config/allowlist.tsv"
chmod 0600 "$sync_failure_config/allowlist.tsv"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$sync_failure_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_SYNC_FAIL=1 \
  PUDDLES_FAKE_ROLLBACK_LOG="$sync_failure_log" \
  PUDDLES_FAKE_SYNC_LOG="$sync_failure_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$sync_failure_home" \
  "$setup_script" user-123
[ -f "$sync_failure_config/pending-interactive-setup" ] ||
  fail "sync failure did not preserve the pending setup marker"
sync_failure_state=$(cat "$sync_failure_config/pending-interactive-setup")
[ -d "$sync_failure_state" ] ||
  fail "sync failure did not preserve setup recovery state"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$sync_failure_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_INSTALL_MODE=fail \
  PUDDLES_FAKE_ROLLBACK_LOG="$sync_failure_log" \
  PUDDLES_FAKE_SYNC_LOG="$sync_failure_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$sync_failure_home" \
  "$setup_script" user-123
[ "$(cat "$sync_failure_config/allowlist.tsv")" = "prior-allowlist" ] ||
  fail "retry recovery did not restore the original allowlist"
[ ! -e "$sync_failure_config/pending-interactive-setup" ] ||
  fail "retry recovery left the pending setup marker"
[ ! -d "$sync_failure_state" ] ||
  fail "retry recovery left stale setup state"

reapproval_home="$tmp/setup-reapproval-home"
reapproval_config="$reapproval_home/.config/puddles-keychain-helper"
reapproval_helper_dir="$reapproval_home/.local/libexec/puddles-keychain-helper"
reapproval_wrapper_dir="$reapproval_home/.local/bin"
reapproval_log="$tmp/reapproval-rollback.log"
reapproval_sync_log="$tmp/reapproval-sync.log"
mkdir -p "$reapproval_config" "$reapproval_helper_dir" "$reapproval_wrapper_dir"
chmod 0700 "$reapproval_config"
printf 'prior-allowlist\n' >"$reapproval_config/allowlist.tsv"
printf '%s\n' '#!/bin/sh' 'printf old-helper' >"$reapproval_helper_dir/puddles-keychain-helper"
printf '%s\n' '#!/bin/sh' 'exit 0' >"$reapproval_wrapper_dir/puddles-with-keychain-secret"
chmod 0600 "$reapproval_config/allowlist.tsv"
chmod 0500 \
  "$reapproval_helper_dir/puddles-keychain-helper" \
  "$reapproval_wrapper_dir/puddles-with-keychain-secret"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$reapproval_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_DURABLE=0 \
  PUDDLES_FAKE_ROLLBACK_LOG="$reapproval_log" \
  PUDDLES_FAKE_SYNC_LOG="$reapproval_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$reapproval_home" \
  "$setup_script" user-123
[ "$("$reapproval_helper_dir/puddles-keychain-helper")" = "old-helper" ] ||
  fail "failed reapproval did not restore the approved helper"
if [ "$(cat "$reapproval_config/allowlist.tsv")" != "prior-allowlist" ]; then
  cat "$tmp/expected.stderr" >&2
  fail "failed reapproval did not restore the prior allowlist"
fi

successful_home="$tmp/setup-success-home"
successful_log="$tmp/successful-rollback.log"
successful_sync_log="$tmp/successful-sync.log"
PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_HOME="$successful_home" \
  PUDDLES_KEYCHAIN_HELPER_TEST_INSTALL_SCRIPT="$fake_install" \
  PUDDLES_KEYCHAIN_HELPER_TEST_ROLLBACK_SCRIPT="$fake_rollback" \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_DURABLE=1 \
  PUDDLES_FAKE_ROLLBACK_LOG="$successful_log" \
  PUDDLES_FAKE_SYNC_LOG="$successful_sync_log" \
  PUDDLES_FAKE_EXPECT_OPERATION_LOCK=1 \
  PUDDLES_FAKE_HELPER_SOURCE="$project_dir/tests/fixtures/fake-helper.sh" \
  PUDDLES_FAKE_HOME="$successful_home" \
  "$setup_script" user-123 >/dev/null
successful_config="$successful_home/.config/puddles-keychain-helper"
[ ! -e "$successful_config/pending-interactive-setup" ] ||
  fail "successful setup left its pending marker"
[ ! -e "$successful_config/interactive-setup.lock" ] ||
  fail "successful setup left its operation lock"
[ ! -s "$successful_log" ] ||
  fail "successful setup unexpectedly rolled back"
grep -q '^todoist-api-token	todoist-cli	user-123$' \
  "$successful_config/allowlist.tsv" ||
  fail "successful setup wrote the wrong allowlist"
[ "$(wc -l <"$successful_sync_log" | tr -d ' ')" -ge 5 ] ||
  fail "successful setup did not sync durable state transitions"

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
current_user=$(id -un)
production_home=$(dscl . -read "/Users/$current_user" NFSHomeDirectory |
  sed -n 's/^NFSHomeDirectory: //p')
[ -n "$production_home" ] || fail "could not resolve production home"
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
  --test-prefix "$production_home/.local" \
  --test-adhoc
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$production_home/.local/" \
  --test-adhoc
expect_failure env PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  "$project_dir/scripts/install.sh" \
  --test-prefix "$production_home/.LOCAL" \
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

rollback_sync_log="$tmp/rollback-transaction-sync.log"
expect_failure env \
  PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_SYNC_LOG="$rollback_sync_log" \
  PUDDLES_FAKE_SYNC_FAIL_AT=2 \
  "$project_dir/scripts/rollback-install.sh" \
  --test-prefix "$prefix" \
  --snapshot "$snapshot_v1"
[ -f "$prefix/state/puddles-keychain-helper/pending-rollback" ] ||
  fail "rollback sync failure did not preserve its transaction marker"
: >"$rollback_sync_log"
PUDDLES_KEYCHAIN_HELPER_TESTING=1 \
  PUDDLES_KEYCHAIN_HELPER_TEST_SYNC_COMMAND="$fake_sync" \
  PUDDLES_FAKE_SYNC_LOG="$rollback_sync_log" \
  "$project_dir/scripts/rollback-install.sh" \
  --test-prefix "$prefix" \
  --snapshot "$snapshot_v1" >/dev/null
[ ! -f "$prefix/state/puddles-keychain-helper/pending-rollback" ] ||
  fail "resumed rollback left its transaction marker"
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
