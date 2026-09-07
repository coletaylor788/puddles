#!/bin/sh
set -eu

if [ "${PUDDLES_FAKE_EXPECT_OPERATION_LOCK:-0}" = "1" ]; then
  lock="${PUDDLES_KEYCHAIN_HELPER_LOCK_STATE:?}/operation.lock"
  owner=${PUDDLES_KEYCHAIN_HELPER_LOCK_OWNER:?}
  [ "$(sed -n '1p' "$lock")" = "$owner" ] || exit 73
  if /usr/bin/shlock -f "$lock" -p "$$"; then
    rm -f "$lock"
    exit 74
  fi
fi

if [ "${1:-}" = "--approve" ]; then
  exit 0
fi
if [ "${PUDDLES_FAKE_DURABLE:-1}" = "1" ]; then
  printf synthetic-secret-value
  exit 0
fi
exit 69
