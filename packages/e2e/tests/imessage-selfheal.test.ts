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
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const healthcheck = join(repoRoot, "scripts/mac-mini/imessage-healthcheck.sh");
const selfheal = join(repoRoot, "scripts/mac-mini/imessage-selfheal.sh");

describe("direct iMessage self-heal", () => {
  let fixture: string;
  let binDir: string;
  let stateDir: string;
  let callsFile: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "imessage-selfheal-"));
    binDir = join(fixture, "bin");
    stateDir = join(fixture, "state");
    callsFile = join(fixture, "calls");
    mkdirSync(binDir);
    mkdirSync(stateDir);

    writeExecutable(
      join(binDir, "jq"),
      `#!/bin/bash
exec "${process.execPath}" -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const value = JSON.parse(input);
  process.exit(
    typeof value.service === "string" && value.service.length > 0 &&
    typeof value.login === "string" && value.login.length > 0 ? 0 : 1
  );
});'
`,
    );
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("rejects a shallowly healthy bridge whose account RPC fails", () => {
    writeOpenClawMock();
    writeImsgMock("account-fails");

    const result = run(healthcheck, ["all"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("gateway health probe completed");
    expect(result.stdout).toContain("bridge account probe timed out or failed");
  });

  it("does not mutate healthy services", () => {
    writeOpenClawMock();
    writeImsgMock("healthy");

    const result = run(selfheal);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Gateway and Messages bridge are healthy");
    expect(readCalls()).toEqual(["openclaw gateway health --port 18789", "imsg account --json"]);
  });

  it("clears stale cooldown state after observing full health", () => {
    writeOpenClawMock();
    writeImsgMock("healthy");
    const cooldown = join(stateDir, "last-recovery-at");
    writeFileSync(cooldown, `${Math.floor(Date.now() / 1000)}\n`);

    const result = run(selfheal);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(cooldown)).toBe(false);
  });

  it("relaunches the bridge and restarts the gateway once", () => {
    writeOpenClawMock();
    writeImsgMock("recover-after-launch");

    const result = run(selfheal);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Gateway and Messages bridge recovered");
    expect(readCalls()).toContain("imsg launch --json");
    expect(readCalls()).toContain("openclaw gateway restart");
    expect(readCalls().filter((call) => call === "imsg launch --json")).toHaveLength(1);
    expect(readCalls().filter((call) => call === "openclaw gateway restart")).toHaveLength(1);
  });

  it("keeps a failed recovery in cooldown instead of thrashing", () => {
    writeOpenClawMock();
    writeImsgMock("always-fails");

    const first = run(selfheal);
    const second = run(selfheal);

    expect(first.status).toBe(1);
    expect(second.status).toBe(1);
    expect(second.stdout).toContain("refusing another mutation");
    expect(readCalls().filter((call) => call === "imsg launch --json")).toHaveLength(1);
  });

  it("installs and rolls back every managed file from recorded recovery state", () => {
    const home = join(fixture, "home");
    const installBin = join(fixture, "install-bin");
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    mkdirSync(join(home, ".openclaw/bin"), { recursive: true });
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    mkdirSync(installBin);

    const paths = {
      health: join(home, ".local/bin/imessage-healthcheck.sh"),
      selfheal: join(home, ".local/bin/imessage-selfheal.sh"),
      legacy: join(home, ".openclaw/bin/bb-selfheal.sh"),
      plist: join(home, "Library/LaunchAgents/ai.openclaw.imessage-selfheal.plist"),
    };
    for (const [name, path] of Object.entries(paths)) {
      writeFileSync(path, `original-${name}\n`);
    }

    writeExecutable(
      join(installBin, "launchctl"),
      `#!/bin/bash
printf 'launchctl %s\\n' "$*" >> "$MOCK_CALLS"
exit 0
`,
    );
    writeExecutable(
      join(installBin, "openclaw"),
      `#!/bin/bash
case "$*" in
  "gateway health --port 18789") exit 0 ;;
  *) exit 2 ;;
esac
`,
    );
    writeExecutable(
      join(installBin, "imsg"),
      `#!/bin/bash
if [ "$*" = "account --json" ]; then
  printf '{"service":"iMessage","login":"ready"}\\n'
  exit 0
fi
exit 2
`,
    );

    const installer = join(repoRoot, "scripts/mac-mini/install-imessage-selfheal.sh");
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${installBin}:${process.env.PATH ?? ""}`,
      MOCK_CALLS: callsFile,
    };
    const installed = spawnSync("/bin/bash", [installer], { encoding: "utf8", env });

    expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0);
    expect(readFileSync(paths.health, "utf8")).toContain("check_bridge");
    expect(readFileSync(paths.selfheal, "utf8")).toContain("RECOVERY_COOLDOWN_SECONDS");
    expect(readFileSync(paths.legacy, "utf8")).toContain("BlueBubbles self-heal is retired");
    expect(readFileSync(paths.plist, "utf8")).toContain(paths.selfheal);

    const rolledBack = spawnSync("/bin/bash", [installer, "rollback"], {
      encoding: "utf8",
      env,
    });

    expect(rolledBack.status, `${rolledBack.stdout}\n${rolledBack.stderr}`).toBe(0);
    for (const [name, path] of Object.entries(paths)) {
      expect(readFileSync(path, "utf8")).toBe(`original-${name}\n`);
    }
    expect(
      existsSync(join(home, ".openclaw/imessage-selfheal/install-recovery.json")),
    ).toBe(false);
  });

  it("automatically restores prior files when installation fails", () => {
    const home = join(fixture, "failed-home");
    const installBin = join(fixture, "failed-install-bin");
    const failureMarker = join(fixture, "bootstrap-failed");
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    mkdirSync(join(home, ".openclaw/bin"), { recursive: true });
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    mkdirSync(installBin);

    const paths = {
      health: join(home, ".local/bin/imessage-healthcheck.sh"),
      selfheal: join(home, ".local/bin/imessage-selfheal.sh"),
      legacy: join(home, ".openclaw/bin/bb-selfheal.sh"),
      plist: join(home, "Library/LaunchAgents/ai.openclaw.imessage-selfheal.plist"),
    };
    for (const [name, path] of Object.entries(paths)) {
      writeFileSync(path, `original-${name}\n`);
    }

    writeExecutable(
      join(installBin, "launchctl"),
      `#!/bin/bash
if [ "$1" = "bootstrap" ] && [ ! -f "$MOCK_FAILURE_MARKER" ]; then
  touch "$MOCK_FAILURE_MARKER"
  exit 1
fi
exit 0
`,
    );
    writeExecutable(
      join(installBin, "openclaw"),
      `#!/bin/bash
[ "$*" = "gateway health --port 18789" ]
`,
    );
    writeExecutable(
      join(installBin, "imsg"),
      `#!/bin/bash
if [ "$*" = "account --json" ]; then
  printf '{"service":"iMessage","login":"ready"}\\n'
  exit 0
fi
exit 2
`,
    );

    const installer = join(repoRoot, "scripts/mac-mini/install-imessage-selfheal.sh");
    const failed = spawnSync("/bin/bash", [installer], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${installBin}:${process.env.PATH ?? ""}`,
        MOCK_FAILURE_MARKER: failureMarker,
      },
    });

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("installation failed; restoring prior files");
    for (const [name, path] of Object.entries(paths)) {
      expect(readFileSync(path, "utf8")).toBe(`original-${name}\n`);
    }
    expect(
      existsSync(join(home, ".openclaw/imessage-selfheal/install-recovery.json")),
    ).toBe(false);
  });

  function run(script: string, args: string[] = []) {
    return spawnSync("/bin/bash", [script, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        OPENCLAW_CMD: join(binDir, "openclaw"),
        IMSG_CMD: join(binDir, "imsg"),
        JQ_CMD: join(binDir, "jq"),
        HEALTHCHECK: healthcheck,
        IMESSAGE_SELFHEAL_STATE_DIR: stateDir,
        RECOVERY_COOLDOWN_SECONDS: "3600",
        RECOVERY_TIMEOUT_SECONDS: "5",
        POST_RECOVERY_ATTEMPTS: "2",
        POST_RECOVERY_INTERVAL_SECONDS: "0",
        MOCK_CALLS: callsFile,
        MOCK_STATE: stateDir,
      },
    });
  }

  function writeOpenClawMock() {
    writeExecutable(
      join(binDir, "openclaw"),
      `#!/bin/bash
printf 'openclaw %s\\n' "$*" >> "$MOCK_CALLS"
case "$*" in
  "gateway health --port 18789"|"gateway restart") exit 0 ;;
  *) exit 2 ;;
esac
`,
    );
  }

  function writeImsgMock(mode: string) {
    writeExecutable(
      join(binDir, "imsg"),
      `#!/bin/bash
printf 'imsg %s\\n' "$*" >> "$MOCK_CALLS"
mode="${mode}"
if [ "$1" = "launch" ]; then
  touch "$MOCK_STATE/launched"
  [ "$mode" != "always-fails" ]
  exit
fi
if [ "$1" != "account" ]; then
  exit 2
fi
case "$mode" in
  healthy)
    printf '{"service":"iMessage","login":"ready"}\\n'
    ;;
  recover-after-launch)
    if [ -f "$MOCK_STATE/launched" ]; then
      printf '{"service":"iMessage","login":"ready"}\\n'
    else
      printf '{"error":"Timed out"}\\n'
      exit 1
    fi
    ;;
  account-fails|always-fails)
    printf '{"error":"Timed out"}\\n'
    exit 1
    ;;
esac
`,
    );
  }

  function readCalls() {
    return readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
  }
});

function writeExecutable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}
