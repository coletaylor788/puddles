import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const deployScript = join(
  repoRoot,
  "docs",
  "openclaw-setup",
  "patches",
  "apply-and-deploy.sh",
);
const tempRoots: string[] = [];

function runDeployment(miniHost?: string): string[] {
  const root = mkdtempSync(join(tmpdir(), "puddles-deploy-test-"));
  tempRoots.push(root);
  const source = join(root, "openclaw");
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  mkdirSync(source);
  mkdirSync(bin);

  const mock = `#!/bin/sh
name="$(basename "$0")"
printf '%s' "$name" >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
if [ "$name" = npm ] && [ "\${1:-}" = pack ]; then
  : > openclaw-test.tgz
  printf '%s\\n' openclaw-test.tgz
fi
`;
  for (const command of ["git", "pnpm", "npm", "openclaw", "launchctl", "scp", "ssh"]) {
    const path = join(bin, command);
    writeFileSync(path, mock);
    chmodSync(path, 0o755);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMMAND_LOG: log,
    OPENCLAW_SRC: source,
    MINI_SANDBOX_BUILD: join(root, "sandbox"),
    PATH: `${bin}:/usr/bin:/bin`,
  };
  if (miniHost) {
    env.MINI_HOST = miniHost;
  } else {
    delete env.MINI_HOST;
  }

  const result = spawnSync("/bin/bash", [deployScript], {
    env,
    encoding: "utf8",
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return readFileSync(log, "utf8").trim().split("\n");
}

function commands(lines: string[]): string[] {
  return lines.map((line) => line.split("\t", 1)[0]);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenClaw deployment topology", () => {
  it("deploys locally by default without SSH or SCP", () => {
    const lines = runDeployment();
    const invoked = commands(lines);

    expect(invoked).toContain("openclaw");
    expect(invoked).toContain("launchctl");
    expect(invoked).not.toContain("ssh");
    expect(invoked).not.toContain("scp");
    expect(lines).toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t.*\/openclaw-test\.tgz$/),
    );
  });

  it("uses SSH and SCP only when a remote target is explicit", () => {
    const lines = runDeployment("approved-mini");
    const invoked = commands(lines);

    expect(invoked).toContain("ssh");
    expect(invoked).toContain("scp");
    expect(invoked).not.toContain("openclaw");
    expect(invoked).not.toContain("launchctl");
    expect(lines).toContainEqual(
      expect.stringMatching(/^scp\topenclaw-test\.tgz\tapproved-mini:\/tmp\/openclaw-test\.tgz$/),
    );
  });
});
