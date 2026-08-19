import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
    writeFileSync(join(source, ".gitignore"), "credentials.json\n");
    spawnSync("git", ["init", "-q"], { cwd: source });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: source });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: source });
    spawnSync("git", ["add", "."], { cwd: source });
    spawnSync("git", ["commit", "-qm", "fixture"], { cwd: source });
    writeFileSync(
      join(source, "servers/gmail-mcp/credentials.json"),
      '{"ignored":"must-not-deploy"}\n',
    );
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
  candidate="\${@: -1}"
  mkdir -p "$candidate/fixture/__pycache__"
  printf 'generated-bytecode\\n' > "$candidate/fixture/__pycache__/fixture.pyc"
  [ "\${MOCK_INSTALL_FAIL:-0}" != "1" ]
  exit
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ] && [ "$3" = "freeze" ]; then
  printf 'mcp==1.29.0\\n'
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "gmail_mcp.scripts.production_smoke" ]; then
  if [ -n "\${MOCK_CONCURRENT_CONFIG:-}" ]; then
    /usr/bin/python3 - "$MOCK_CONCURRENT_CONFIG" "\${MOCK_CONCURRENT_MODE:-unrelated}" <<'PY'
import json
import os
from pathlib import Path
import sys

path = Path(sys.argv[1])
mode = sys.argv[2]
data = json.loads(path.read_text())
if mode == "gmail":
    data["plugins"]["entries"]["secure-gmail"]["config"]["gmailMcpCommand"] = "/operator/python"
else:
    data["unrelated"]["duringDeployment"] = "preserved"
temporary = path.with_name(f".{path.name}.concurrent")
temporary.write_text(json.dumps(data, indent=2) + "\\n")
os.replace(temporary, path)
PY
  fi
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
      join(releaseRoot, "releases", revision, "bin/gmail-mcp-python"),
    );
    expect(gmail.gmailMcpCwd).toBe(join(releaseRoot, "releases", revision));
    expect(gmail.gmailMcpArgs).toEqual(["-m", "gmail_mcp"]);
    expect(gmail.unrelatedSecret).toBe("preserved");
    expect(deployed.unrelated).toEqual({ value: true });
    expect(
      existsSync(join(releaseRoot, "releases", revision, ".puddles-release.json")),
    ).toBe(true);
    expect(
      existsSync(join(releaseRoot, "releases", revision, "credentials.json")),
    ).toBe(false);
    expect(
      existsSync(
        join(
          releaseRoot,
          "releases",
          revision,
          "fixture/__pycache__/fixture.pyc",
        ),
      ),
    ).toBe(false);
    expect(
      readFileSync(
        join(releaseRoot, "releases", revision, "bin/gmail-mcp-python"),
        "utf8",
      ),
    ).toContain("PYTHONDONTWRITEBYTECODE=1");
    const backup = onlyChild(backupRoot);
    expect(readFileSync(join(backupRoot, backup, "openclaw.json"), "utf8")).toBe(
      originalConfig,
    );
    expect(
      existsSync(join(backupRoot, backup, "promoted-openclaw.json")),
    ).toBe(true);
    expect(
      JSON.parse(
        readFileSync(join(backupRoot, backup, "deployment-state.json"), "utf8"),
      ).phase,
    ).toBe("complete");
    expect(readCalls()).toContain(
      "python\t-m gmail_mcp.scripts.production_smoke --deadline-seconds 2.0",
    );
    expect(readCalls()).toContain("openclaw\tgateway restart");
    expect(existsSync(`${config}.lock`)).toBe(false);
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
    const backup = onlyChild(backupRoot);
    expect(
      JSON.parse(
        readFileSync(join(backupRoot, backup, "deployment-state.json"), "utf8"),
      ).phase,
    ).toBe("rolled-back");
  });

  it("preserves unrelated config changes made before rollback", () => {
    const result = runDeploy({
      MOCK_CONCURRENT_CONFIG: config,
      MOCK_SMOKE_FAIL: "1",
    });

    expect(result.status).not.toBe(0);
    const restored = JSON.parse(readFileSync(config, "utf8"));
    expect(restored.unrelated.duringDeployment).toBe("preserved");
    expect(
      restored.plugins.entries["secure-gmail"].config.gmailMcpCommand,
    ).toBe("/old/.venv/bin/python");
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(2);
  });

  it("refuses to overwrite concurrent Gmail changes during rollback", () => {
    const result = runDeploy({
      MOCK_CONCURRENT_CONFIG: config,
      MOCK_CONCURRENT_MODE: "gmail",
      MOCK_SMOKE_FAIL: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rollback also failed");
    const current = JSON.parse(readFileSync(config, "utf8"));
    expect(
      current.plugins.entries["secure-gmail"].config.gmailMcpCommand,
    ).toBe("/operator/python");
  });

  it("reconciles and fails when Gmail config changes during successful smoke", () => {
    const result = runDeploy({
      MOCK_CONCURRENT_CONFIG: config,
      MOCK_CONCURRENT_MODE: "gmail",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("config changed during validation");
    const current = JSON.parse(readFileSync(config, "utf8"));
    expect(
      current.plugins.entries["secure-gmail"].config.gmailMcpCommand,
    ).toBe("/operator/python");
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(2);
    const backup = onlyChild(backupRoot);
    expect(
      JSON.parse(
        readFileSync(join(backupRoot, backup, "deployment-state.json"), "utf8"),
      ).phase,
    ).toBe("superseded");
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

  it("recovers a promoted config after uncatchable process death", async () => {
    const child = spawn("python3", deployArgs(), {
      env: {
        ...process.env,
        MOCK_CALLS: calls,
        MOCK_RESTARTS: join(fixture, "restarts"),
        MOCK_SMOKE_SLEEP: "3",
      },
      stdio: "ignore",
    });
    const closed = new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    await waitFor(() =>
      readCalls().some((line) =>
        line.includes("gmail_mcp.scripts.production_smoke"),
      ),
    );
    child.kill("SIGKILL");
    await closed;

    expect(existsSync(lockDir)).toBe(true);
    expect(
      JSON.parse(readFileSync(config, "utf8")).plugins.entries["secure-gmail"].config
        .gmailMcpCwd,
    ).toBe(join(releaseRoot, "releases", revision));

    const resumed = runDeploy();

    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(3);
    const phases = readdirSync(backupRoot)
      .map((entry) =>
        JSON.parse(
          readFileSync(join(backupRoot, entry, "deployment-state.json"), "utf8"),
        ).phase,
      )
      .sort();
    expect(phases).toEqual(["complete", "recovered"]);
    expect(existsSync(lockDir)).toBe(false);
  }, 10_000);

  it("rejects a concurrent deployment before mutation", () => {
    mkdirSync(lockDir);
    const result = runDeploy();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("another Gmail deployment");
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
  });

  it("joins the OpenClaw config lock before promotion", () => {
    writeFileSync(
      `${config}.lock`,
      `${JSON.stringify({ pid: process.pid, createdAt: "2099-01-01T00:00:00Z" })}\n`,
    );

    const result = runDeploy();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OpenClaw config lock is busy");
    expect(readFileSync(config, "utf8")).toBe(originalConfig);
  });

  it("reclaims a dead OpenClaw config lock", () => {
    writeFileSync(
      `${config}.lock`,
      '{"pid":999999,"createdAt":"2020-01-01T00:00:00Z"}\n',
    );

    const result = runDeploy();

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(`${config}.lock`)).toBe(false);
  });

  it("publishes a complete config lock owner record atomically", () => {
    const probe = `
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("gmail_deploy", ${JSON.stringify(deployScript)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
args = argparse.Namespace(
    source=Path(${JSON.stringify(source)}),
    revision=${JSON.stringify(revision)},
    config=Path(${JSON.stringify(config)}),
    release_root=Path(${JSON.stringify(releaseRoot)}),
    backup_root=Path(${JSON.stringify(backupRoot)}),
    lock_dir=Path(${JSON.stringify(lockDir)}),
    python=${JSON.stringify(fakePython)},
    openclaw=${JSON.stringify(fakeOpenClaw)},
    gateway_port=18789,
    health_attempts=2,
    health_interval=0.01,
    smoke_timeout=2.0,
    config_lock_timeout=0.1,
)
deployment = module.GmailDeployment(args)
with deployment.config_lock():
    payload = json.loads(Path(${JSON.stringify(`${config}.lock`)}).read_text())
    assert payload["pid"] > 0
    assert len(payload["nonce"]) == 32
assert not Path(${JSON.stringify(`${config}.lock`)}).exists()
`;
    const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("rejects a changed config in the conditional promotion guard", () => {
    const probe = `
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("gmail_deploy", ${JSON.stringify(deployScript)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
path = Path(${JSON.stringify(config)})
path.write_bytes(b"new")
try:
    module.conditional_atomic_write(
        path,
        expected=b"old",
        replacement=b"candidate",
        mode=0o600,
    )
except module.DeploymentError:
    pass
else:
    raise AssertionError("expected concurrent config rejection")
assert path.read_bytes() == b"new"
`;
    const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("fsyncs each new recovery directory entry and parent", () => {
    const target = join(fixture, "durable", "nested", "recovery");
    const probe = `
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("gmail_deploy", ${JSON.stringify(deployScript)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
calls = []
module.fsync_directory = lambda path: calls.append(str(path))
module.durable_mkdir(Path(${JSON.stringify(target)}))
print(json.dumps(calls))
`;
    const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const calls = JSON.parse(result.stdout) as string[];
    expect(calls).toContain(fixture);
    expect(calls).toContain(join(fixture, "durable"));
    expect(calls).toContain(join(fixture, "durable", "nested"));
    expect(calls).toContain(target);
  });

  it("fsyncs release files and directories before publication", () => {
    const target = join(fixture, "release-tree");
    mkdirSync(join(target, "nested"), { recursive: true });
    writeFileSync(join(target, "root.txt"), "root\n");
    writeFileSync(join(target, "nested", "child.txt"), "child\n");
    const probe = `
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("gmail_deploy", ${JSON.stringify(deployScript)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
files = []
directories = []
module.fsync_file = lambda path: files.append(str(path))
module.fsync_directory = lambda path: directories.append(str(path))
module.fsync_tree(Path(${JSON.stringify(target)}))
print(json.dumps({"files": files, "directories": directories}))
`;
    const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const calls = JSON.parse(result.stdout) as {
      files: string[];
      directories: string[];
    };
    expect(calls.files.sort()).toEqual(
      [join(target, "nested", "child.txt"), join(target, "root.txt")].sort(),
    );
    expect(calls.directories).toContain(join(target, "nested"));
    expect(calls.directories).toContain(target);
  });

  it("recovers and rebuilds a damaged active completed release", () => {
    const deployed = runDeploy();
    expect(deployed.status, `${deployed.stdout}\n${deployed.stderr}`).toBe(0);
    writeFileSync(
      join(releaseRoot, "releases", revision, "pyproject.toml"),
      "tampered\n",
    );

    const repeated = runDeploy();

    expect(repeated.status, `${repeated.stdout}\n${repeated.stderr}`).toBe(0);
    expect(
      readFileSync(join(releaseRoot, "releases", revision, "pyproject.toml"), "utf8"),
    ).not.toBe("tampered\n");
    expect(
      readCalls().filter((line) => line === "openclaw\tgateway restart"),
    ).toHaveLength(3);
    expect(
      readdirSync(join(releaseRoot, "releases")).some((entry) =>
        entry.startsWith(`${revision}.damaged-`),
      ),
    ).toBe(true);
    const phases = readdirSync(backupRoot)
      .map((entry) =>
        JSON.parse(
          readFileSync(join(backupRoot, entry, "deployment-state.json"), "utf8"),
        ).phase,
      )
      .sort();
    expect(phases).toEqual(["complete", "recovered"]);
  });

  it("recovers when untracked executable bytecode appears after completion", () => {
    const deployed = runDeploy();
    expect(deployed.status, `${deployed.stdout}\n${deployed.stderr}`).toBe(0);
    const bytecode = join(
      releaseRoot,
      "releases",
      revision,
      "gmail_mcp/__pycache__/injected.pyc",
    );
    mkdirSync(resolve(bytecode, ".."), { recursive: true });
    writeFileSync(bytecode, "injected\n");

    const repeated = runDeploy();

    expect(repeated.status, `${repeated.stdout}\n${repeated.stderr}`).toBe(0);
    expect(existsSync(bytecode)).toBe(false);
    expect(
      readdirSync(join(releaseRoot, "releases")).some((entry) =>
        entry.startsWith(`${revision}.damaged-`),
      ),
    ).toBe(true);
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
      "--config-lock-timeout",
      "0.1",
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
