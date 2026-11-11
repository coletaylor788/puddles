import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(repoRoot, "packages/e2e/bin/configure-sandbox-docker-dns.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}`);
  chmodSync(path, 0o755);
}

function runScenario(scenario: "healthy" | "alternate" | "unavailable") {
  const root = mkdtempSync(join(tmpdir(), "puddles-docker-dns-"));
  roots.push(root);
  const bin = join(root, "bin");
  const calls = join(root, "calls.log");
  const daemonConfig = join(root, "etc/docker/daemon.json");
  mkdirSync(bin, { recursive: true });
  writeFileSync(calls, "");
  mkdirSync(resolve(daemonConfig, ".."), { recursive: true });
  writeFileSync(daemonConfig, JSON.stringify({ "log-driver": "json-file", dns: ["192.0.2.1"] }));

  executable(join(bin, "getent"), `
printf 'getent %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"
[[ "$DNS_FIXTURE_SCENARIO" == healthy ]] && { echo '203.0.113.1 STREAM ports.ubuntu.com'; exit 0; }
exit 2
`);
  executable(join(bin, "timeout"), `
printf 'timeout %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"
shift
exec "$@"
`);
  executable(join(bin, "dig"), `
printf 'dig %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"
if [[ "$DNS_FIXTURE_SCENARIO" == alternate && "$*" == *'@1.1.1.1'* ]]; then
  echo '91.189.91.103'
elif [[ "$DNS_FIXTURE_SCENARIO" == unavailable ]]; then
  echo 'not-an-address'
fi
`);
  executable(join(bin, "sudo"), `
printf 'sudo %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"
exec "$@"
`);
  executable(join(bin, "dockerd"), `printf 'dockerd %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"`);
  executable(join(bin, "systemctl"), `printf 'systemctl %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"`);
  executable(join(bin, "docker"), `printf 'docker %s\\n' "$*" >>"$DNS_FIXTURE_CALLS"`);

  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      PUDDLES_DOCKER_DAEMON_CONFIG: daemonConfig,
      DNS_FIXTURE_SCENARIO: scenario,
      DNS_FIXTURE_CALLS: calls,
      GITHUB_RUN_ID: "fixture",
      GITHUB_RUN_ATTEMPT: "1",
    },
  });
  return {
    result,
    calls: readFileSync(calls, "utf8"),
    config: JSON.parse(readFileSync(daemonConfig, "utf8")),
  };
}

describe("hosted sandbox Docker DNS selection", () => {
  it("leaves Docker unchanged when the runner resolver works", () => {
    const outcome = runScenario("healthy");
    expect(outcome.result.status).toBe(0);
    expect(outcome.config).toEqual({ "log-driver": "json-file", dns: ["192.0.2.1"] });
    expect(outcome.calls).toContain("getent ahostsv4 ports.ubuntu.com");
    expect(outcome.calls).not.toContain("dig ");
    expect(outcome.calls).not.toContain("dockerd ");
  });

  it("uses a proven resolver while preserving unrelated daemon settings", () => {
    const outcome = runScenario("alternate");
    expect(outcome.result.status).toBe(0);
    expect(outcome.config).toEqual({ "log-driver": "json-file", dns: ["1.1.1.1"] });
    expect(outcome.calls).toContain("dig +time=2 +tries=1 +short A ports.ubuntu.com @1.1.1.1");
    expect(outcome.calls).toMatch(/dockerd --validate --config-file /);
    expect(outcome.calls.indexOf("dockerd ")).toBeLessThan(outcome.calls.indexOf("sudo install -m 0644"));
    expect(outcome.calls).toContain("systemctl restart docker");
    expect(outcome.calls).toContain("docker info");
  });

  it("fails without changing Docker when no resolver returns an address", () => {
    const outcome = runScenario("unavailable");
    expect(outcome.result.status).not.toBe(0);
    expect(outcome.config).toEqual({ "log-driver": "json-file", dns: ["192.0.2.1"] });
    expect(outcome.calls).toContain("dig +time=2 +tries=1 +short A ports.ubuntu.com @8.8.8.8");
    expect(outcome.calls).not.toContain("dockerd ");
    expect(outcome.calls).not.toContain("systemctl ");
  });
});
