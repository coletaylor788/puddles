#!/bin/sh
set -eu

usage() {
  echo "usage: build.sh --output PATH (--signing-identity-sha1 HASH | --test-adhoc) [--test-variant-two]" >&2
  exit 64
}

output=
identity_sha1=
test_adhoc=0
test_variant_two=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      [ "$#" -ge 2 ] || usage
      output=$2
      shift 2
      ;;
    --signing-identity-sha1)
      [ "$#" -ge 2 ] || usage
      identity_sha1=$2
      shift 2
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

[ -n "$output" ] || usage
case "$test_adhoc:$identity_sha1" in
  1:) ;;
  0:????????????????????????????????????????) ;;
  *) usage ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")
source_file="$project_dir/Sources/main.swift"
output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"

temporary=$(mktemp "$output_dir/.puddles-keychain-helper.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

if [ "$test_adhoc" -eq 1 ]; then
  swift_flags="-warnings-as-errors -framework Security -framework LocalAuthentication -D TESTING"
else
  swift_flags="-warnings-as-errors -framework Security -framework LocalAuthentication -O"
fi
if [ "$test_variant_two" -eq 1 ]; then
  swift_flags="$swift_flags -D REBUILD_VARIANT_TWO"
fi

# shellcheck disable=SC2086
xcrun swiftc $swift_flags "$source_file" -o "$temporary"

identifier=com.coletaylor788.puddles.keychain-helper
if [ "$test_adhoc" -eq 1 ]; then
  requirement="designated => identifier \"$identifier\""
  codesign --force --sign - \
    --identifier "$identifier" \
    --requirements "=$requirement" \
    --timestamp=none \
    "$temporary"
  verification_requirement="identifier \"$identifier\""
else
  case "$identity_sha1" in
    *[!0-9A-Fa-f]*|'') usage ;;
  esac
  identities=$(security find-identity -v -p codesigning)
  printf '%s\n' "$identities" |
    awk -v identity="$identity_sha1" '$2 == identity { found = 1 } END { exit !found }' || {
    echo "signing identity is not available or trusted for code signing" >&2
    exit 69
  }
  requirement="designated => identifier \"$identifier\" and anchor = H\"$identity_sha1\""
  codesign --force --sign "$identity_sha1" \
    --identifier "$identifier" \
    --requirements "=$requirement" \
    --timestamp=none \
    "$temporary"
  verification_requirement="identifier \"$identifier\" and anchor = H\"$identity_sha1\""
fi

codesign --verify --strict --requirement "$verification_requirement" "$temporary"
chmod 0500 "$temporary"
mv -f "$temporary" "$output"
trap - EXIT HUP INT TERM
