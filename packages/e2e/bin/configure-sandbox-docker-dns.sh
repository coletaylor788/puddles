#!/usr/bin/env bash
set -euo pipefail

endpoint="ports.ubuntu.com"
daemon_config="${PUDDLES_DOCKER_DAEMON_CONFIG:-/etc/docker/daemon.json}"
work_root="${RUNNER_TEMP:?RUNNER_TEMP is required}/sandbox-docker-dns"
mkdir -p "$work_root"

if timeout 10s getent ahostsv4 "$endpoint" >/dev/null 2>&1; then
  echo "Default runner DNS resolves $endpoint; Docker configuration is unchanged."
  exit 0
fi

selected_resolver=""
for resolver in 1.1.1.1 8.8.8.8; do
  answers=$(timeout 5s dig +time=2 +tries=1 +short A "$endpoint" "@$resolver" 2>/dev/null || true)
  if grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' <<<"$answers"; then
    selected_resolver="$resolver"
    break
  fi
done

if [[ -z "$selected_resolver" ]]; then
  echo "No tested public resolver returned an address for $endpoint." >&2
  exit 1
fi

source_config="$work_root/daemon.source.json"
staged_config="$work_root/daemon.staged.json"
if sudo test -f "$daemon_config"; then
  sudo cat "$daemon_config" >"$source_config"
else
  printf '{}\n' >"$source_config"
fi
jq --arg resolver "$selected_resolver" '.dns = [$resolver]' "$source_config" >"$staged_config"
sudo dockerd --validate --config-file "$staged_config" >/dev/null

target_stage="${daemon_config}.puddles-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}.tmp"
trap 'sudo rm -f "$target_stage"' EXIT
sudo install -d -m 0755 "$(dirname "$daemon_config")"
sudo install -m 0644 "$staged_config" "$target_stage"
sudo mv -f "$target_stage" "$daemon_config"
timeout 30s sudo systemctl restart docker
timeout 30s bash -c 'until docker info >/dev/null 2>&1; do sleep 1; done'
echo "Docker is using a tested public resolver for this hosted runner."
