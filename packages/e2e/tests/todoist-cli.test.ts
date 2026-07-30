import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installer = join(repoRoot, "scripts", "mac-mini", "install-openclaw-todoist-cli.sh");
const dockerfile = join(repoRoot, "scripts", "mac-mini", "todoist-cli", "Dockerfile");
const imagePackage = join(repoRoot, "scripts", "mac-mini", "todoist-cli", "package.json");
const imageLock = join(repoRoot, "scripts", "mac-mini", "todoist-cli", "package-lock.json");
const skill = join(repoRoot, "openclaw-skills", "todoist-cli", "SKILL.md");
const roots: string[] = [];

interface Fixture {
  root: string;
  home: string;
  workspace: string;
  log: string;
  env: NodeJS.ProcessEnv;
}

function fixture(options: { previousImage?: string; failFirstRecreate?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "puddles-todoist-cli-"));
  roots.push(root);
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  const recreateCount = join(root, "recreate-count");
  mkdirSync(join(home, ".openclaw"), { recursive: true });
  mkdirSync(join(workspace, "skills"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(home, ".openclaw", ".env"), "TODOIST_API_TOKEN=test-token-not-real\n", {
    mode: 0o600,
  });

  const image = options.previousImage
    ? `"sandbox":{"docker":{"image":${JSON.stringify(options.previousImage)}}}`
    : '"sandbox":{"docker":{}}';
  const openclaw = `#!/bin/bash
set -e
printf 'openclaw' >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
if [ "$1 $2 $3" = "config get agents.list" ]; then
  printf '[{"id":"main",${image}}]\\n'
elif [ "$1 $2 $3" = "config get agents.defaults.sandbox.docker.image" ]; then
  printf '"openclaw-sandbox:bookworm-slim"\\n'
elif [ "$1 $2" = "sandbox recreate" ]; then
  count=0
  [ ! -f "$RECREATE_COUNT" ] || count="$(cat "$RECREATE_COUNT")"
  count=$((count + 1))
  printf '%s' "$count" > "$RECREATE_COUNT"
  if [ "\${FAIL_FIRST_RECREATE:-0}" = 1 ] && [ "$count" -eq 1 ]; then
    exit 9
  fi
fi
`;
  const docker = `#!/bin/bash
set -e
printf 'docker' >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
if [ "$1" = run ]; then
  printf '3.0.5\\n'
fi
`;
  for (const [name, content] of [
    ["openclaw", openclaw],
    ["docker", docker],
  ] as const) {
    const path = join(bin, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
  }

  return {
    root,
    home,
    workspace,
    log,
    env: {
      ...process.env,
      HOME: home,
      OPENCLAW_STATE_DIR: join(home, ".openclaw"),
      COMMAND_LOG: log,
      RECREATE_COUNT: recreateCount,
      FAIL_FIRST_RECREATE: options.failFirstRecreate ? "1" : "0",
      PATH: `${bin}:${process.env.PATH}`,
    },
  };
}

function run(f: Fixture, ...args: string[]) {
  return spawnSync("/bin/bash", [installer, ...args, "--workspace", f.workspace], {
    env: f.env,
    encoding: "utf8",
  });
}

function commandLines(f: Fixture): string[] {
  if (!existsSync(f.log)) {
    return [];
  }
  return readFileSync(f.log, "utf8").trim().split("\n");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Todoist CLI sandbox capability", () => {
  it("pins the runtime and teaches the issue-worker handoff boundary", () => {
    const image = readFileSync(dockerfile, "utf8");
    const imageManifest = JSON.parse(readFileSync(imagePackage, "utf8"));
    const imageLockfile = JSON.parse(readFileSync(imageLock, "utf8"));
    const instructions = readFileSync(skill, "utf8");

    expect(image).toContain(
      "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
    );
    expect(image).toContain("TODOIST_CLI_VERSION=3.0.5");
    expect(image).toContain("npm ci --omit=dev --ignore-scripts");
    expect(imageManifest.dependencies["@doist/todoist-cli"]).toBe("3.0.5");
    expect(imageLockfile.packages["node_modules/@doist/todoist-cli"].version).toBe("3.0.5");
    expect(
      imageLockfile.packages["node_modules/@doist/todoist-cli"].integrity,
    ).toBe(
      "sha512-NrhuMqvYDYAvEFCcMQVWGF9FVyIPfGIsWs+OrfVfo7qTsEeyjlKal4tM4Xsn4/BsrJTP9q+Ad8K1uGfVaOMFUw==",
    );
    expect(instructions).toMatch(/untrusted data/i);
    expect(instructions).toContain('--labels "agent"');
    expect(instructions).toMatch(/Do not\s+also create a GitHub issue/i);
    expect(instructions).toMatch(/explicitly asks/i);
  });

  it("builds and smoke-tests the candidate before mutating config", () => {
    const f = fixture();
    const result = run(f);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const lines = commandLines(f);
    const build = lines.findIndex((line) => line.startsWith("docker\tbuild"));
    const smoke = lines.findIndex((line) => line.startsWith("docker\trun"));
    const firstSet = lines.findIndex((line) => line.startsWith("openclaw\tconfig\tset"));
    expect(build).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(build);
    expect(firstSet).toBeGreaterThan(smoke);
    expect(lines).toContainEqual(
      expect.stringContaining(
        "agents.list[0].sandbox.docker.env.TODOIST_API_TOKEN\t\"${TODOIST_API_TOKEN}\"",
      ),
    );
    expect(
      existsSync(join(f.workspace, "skills", "todoist-cli", ".puddles-managed")),
    ).toBe(true);
  });

  it("fails closed rather than overwriting an unmarked skill", () => {
    const f = fixture();
    const existing = join(f.workspace, "skills", "todoist-cli");
    mkdirSync(existing);
    writeFileSync(join(existing, "SKILL.md"), "user-authored\n");

    const result = run(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to overwrite user-authored skill");
    expect(readFileSync(join(existing, "SKILL.md"), "utf8")).toBe("user-authored\n");
    expect(commandLines(f).some((line) => line.startsWith("docker\tbuild"))).toBe(false);
  });

  it("requires daemon-readable trusted token configuration before building", () => {
    const f = fixture();
    rmSync(join(f.home, ".openclaw", ".env"));
    f.env.TODOIST_API_TOKEN = "shell-only-test-token";

    const result = run(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "TODOIST_API_TOKEN is not configured in",
    );
    expect(result.stderr).toContain("shell-only export cannot guarantee");
    expect(commandLines(f).some((line) => line.startsWith("docker\tbuild"))).toBe(false);
  });

  it("restores config and skill state when sandbox recreation fails", () => {
    const f = fixture({ failFirstRecreate: true });
    const result = run(f);
    expect(result.status).toBe(9);
    expect(result.stderr).toContain("restoring prior state");

    const lines = commandLines(f);
    expect(lines).toContain(
      "openclaw\tconfig\tunset\tagents.list[0].sandbox.docker.image",
    );
    expect(lines).toContain(
      "openclaw\tconfig\tunset\tagents.list[0].sandbox.docker.env.TODOIST_API_TOKEN",
    );
    expect(existsSync(join(f.workspace, "skills", "todoist-cli"))).toBe(false);
    expect(
      existsSync(join(f.home, ".openclaw", "todoist-cli-install", "main.json")),
    ).toBe(false);
  });

  it("uses durable recovery state to restore a previous image", () => {
    const f = fixture({ previousImage: "custom-sandbox:before" });
    const installed = run(f);
    expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0);

    const rolledBack = run(f, "rollback");
    expect(rolledBack.status, `${rolledBack.stdout}\n${rolledBack.stderr}`).toBe(0);
    const lines = commandLines(f);
    expect(lines).toContain(
      'openclaw\tconfig\tset\tagents.list[0].sandbox.docker.image\t"custom-sandbox:before"\t--strict-json',
    );
    expect(existsSync(join(f.workspace, "skills", "todoist-cli"))).toBe(false);
    expect(
      existsSync(join(f.home, ".openclaw", "todoist-cli-install", "main.json")),
    ).toBe(false);
  });
});
