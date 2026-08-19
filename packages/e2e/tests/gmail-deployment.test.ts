import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const deployScript = join(repoRoot, "scripts/mac-mini/deploy-gmail-mcp.py");

describe("Gmail deployment lifecycle", () => {
  let fixture: string;
  let source: string;
  let config: string;
  let releaseRoot: string;
  let backupRoot: string;
  let lockDir: string;
  let calls: string;
  let fakePython: string;
  let fakeOpenClaw: string;
  let revision: string;
  let originalConfig: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "gmail-deploy-"));
    source = join(fixture, "source");
    config = join(fixture, "openclaw.json");
    releaseRoot = join(fixture, "releases");
    backupRoot = join(fixture, "backups");
    lockDir = join(fixture, "deploy.lock");
    calls = join(fixture, "calls");
    const bin = join(fixture, "bin");
    mkdirSync(join(source, "servers/gmail-mcp"), { recursive: true });
    mkdirSync(bin);
    writeFileSync(
      join(source, "servers/gmail-mcp/pyproject.toml"),
      '[project]\nname="fixture-gmail"\nversion="1.0.0"\n',
    );
    spawnSync("git", ["init", "-q"], { cwd: source });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: source });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: source });
    spawnSync("git", ["add", "."], { cwd: source });
    spawnSync("git", ["commit", "-qm", "fixture"], { cwd: source });
    revision = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).stdout.trim();

    originalConfig = `${JSON.stringify({
      plugins: {
        entries: {
          "secure-gmail": {
            enabled: true,
            config: {
              gmailMcpCommand: "/old/.venv/bin/python",
              gmailMcpArgs: ["-m", "gmail_mcp"],
              gmailMcpCwd: "/old",
              unrelatedSecret: "preserved",
            },
          },
        },
      },
      unrelated: { value: true },
    }, null, 2)}\n`;
    writeFileSync(config, originalConfig, { mode: 0o600 });

    fakePython = join(bin, "python");
    writeExecutable(
      fakePython,
      `#!/bin/bash
printf 'python\\t%s\\n' "$*" >> "$MOCK_CALLS"
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  cp "$0" "$3/bin/python"
  chmod +x "$3/bin/python"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ] && [ "$3" = "install" ]; then
  [ "\${MOCK_INSTALL_FAIL:-0}" != "1" ]
  exit
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ] && [ "$3" = "freeze" ]; then
  printf 'mcp==1.29.0\\n'
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "gmail_mcp.scripts.production_smoke" ]; then
  if [ "\${MOCK_SMOKE_SLEEP:-0}" != "0" ]; then
    exec sleep "$MOCK_SMOKE_SLEEP"
  fi
  [ "\${MOCK_SMOKE_FAIL:-0}" != "1" ]
  exit
fi
exit 0
`,
    );

    fakeOpenClaw = join(bin, "openclaw");
    writeExecutable(
      fakeOpenClaw,
      `#!/bin/bash
printf 'openclaw\\t%s\\n' "$*" >> "$MOCK_CALLS"
if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then
  restart_count=0
  if [ -f "$MOCK_RESTARTS" ]; then
    restart_count="$(grep -c '^restart$' "$MOCK_RESTARTS" || true)"
  fi
  printf 'restart\\n' >> "$MOCK_RESTARTS"
  if [ "\${MOCK_RESTART_FAIL_ONCE:-0}" = "1" ] && [ "$restart_count" -eq 0 ]; then
    exit 1
  fi
  exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "health" ]; then
  exit 0
fi
exit 2
`,
    );
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("stages an immutable release, snapshots config, and promotes it", () => {
    const result = runDeploy();

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const deployed = JSON.parse(readFileSync(config, "utf8"));
    const gmail = deployed.plugins.entries["secure-gmail"].config;
    expect(gmail.gmailMcpCommand).toBe(
      join(releaseRoot, "releases", revision, ".venv/bin/python"),
    );
    expect(gmail.gmailMcpCwd).toBe(join(releaseRoot, "releases", revision));
    expect(gmail.gmailMcpArgs).toEqual(["-m", "gmail_mcp"]);
    expect(gmail.unrelatedSecret).toBe("preserved");
    expect(deployed.unrelated).toEqual({ value: true });
    expect(
      existsSync(join(releaseRoot, "releases", revision, ".puddles-release.json")),
    ).toBe(true);
    const backup = onlyChild(backupRoot);
    expect(readFileSync(join(backupRoot, backup, "openclaw.json"), "utf8")).toBe(
      originalConfig,
    );
    expect(readCalls()).toContain(
      "python\t-m gmail_mcp.scripts.production_smoke --deadline-seconds 2.0",
    );
    expect(readCalls()).toContain("openclaw\tgateway restart");
  });

  it("restores the exact config and gateway when the read-only smoke fails", () => {
    const result = runDeploy({ MOCK_SMOKE_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(2);
    expect(existsSync(join(releaseRoot, "releases", revision))).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("does not mutate config when candidate installation fails", () => {
    const result = runDeploy({ MOCK_INSTALL_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
    expect(readCalls()).not.toContain("openclaw\tgateway restart");
    expect(existsSync(lockDir)).toBe(false);
  });

  it("restores config when the candidate gateway restart fails", () => {
    const result = runDeploy({ MOCK_RESTART_FAIL_ONCE: "1" });

    expect(result.status).not.toBe(0);
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(2);
  });

  it("rejects malformed config before creating recovery state", () => {
    writeFileSync(config, "{}\n");
    const result = runDeploy();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("secure-gmail plugin config is missing");
    expect(existsSync(backupRoot)).toBe(true);
    expect(onlyChild(backupRoot)).toBe("");
    expect(readCalls()).not.toContain("openclaw\tgateway restart");
  });

  it("rolls back when interrupted during the read-only smoke", async () => {
    const child = spawn("python3", deployArgs(), {
      env: {
        ...process.env,
        MOCK_CALLS: calls,
        MOCK_RESTARTS: join(fixture, "restarts"),
        MOCK_SMOKE_SLEEP: "10",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    await waitFor(() =>
      readCalls().some((line) =>
        line.includes("gmail_mcp.scripts.production_smoke"),
      ),
    );
    child.kill("SIGTERM");
    const status = await closed;

    expect(status).not.toBe(0);
    expect(stderr).toContain("deployment interrupted by signal");
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(2);
    expect(existsSync(lockDir)).toBe(false);
  }, 10_000);

  it("rejects a concurrent deployment before mutation", () => {
    mkdirSync(lockDir);
    const result = runDeploy();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("another Gmail deployment");
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
  });

  function runDeploy(extraEnv: Record<string, string> = {}) {
    return spawnSync(
      "python3",
      deployArgs(),
      {
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_CALLS: calls,
          MOCK_RESTARTS: join(fixture, "restarts"),
          ...extraEnv,
        },
      },
    );
  }

  function deployArgs(): string[] {
    return [
      deployScript,
      "--source",
      source,
      "--revision",
      revision,
      "--config",
      config,
      "--release-root",
      releaseRoot,
      "--backup-root",
      backupRoot,
      "--lock-dir",
      lockDir,
      "--python",
      fakePython,
      "--openclaw",
      fakeOpenClaw,
      "--health-attempts",
      "2",
      "--health-interval",
      "0.01",
      "--smoke-timeout",
      "2",
    ];
  }

  function readCalls(): string[] {
    if (!existsSync(calls)) {
      return [];
    }
    return readFileSync(calls, "utf8").trim().split("\n");
  }
});

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function onlyChild(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return spawnSync("find", [path, "-mindepth", "1", "-maxdepth", "1", "-type", "d"], {
    encoding: "utf8",
  }).stdout.trim().split("/").at(-1) ?? "";
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for deployment fixture");
}
