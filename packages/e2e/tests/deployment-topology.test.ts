import { afterEach, describe, expect, it } from "vitest";
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const deployScript = join(
  repoRoot,
  "docs",
  "openclaw-setup",
  "patches",
  "apply-and-deploy.sh",
);
const tempRoots: string[] = [];

interface DeploymentOptions {
  miniHost?: string;
  doctorFails?: boolean;
  doctorInterrupts?: boolean;
  doctorMutates?: boolean;
  healthFailures?: number;
  healthAttempts?: number;
  lockHeld?: boolean;
  missingPlist?: boolean;
  previousInstallFails?: boolean;
  remoteGatewayHealthy?: boolean;
  reverseCloneFails?: boolean;
  rollbackShutdownNeverCompletes?: boolean;
  browserBuildInterrupts?: boolean;
  cloneFails?: boolean;
  sandboxRecreateFails?: boolean;
  shutdownDelayChecks?: number;
  sourceLockHeld?: boolean;
  stopInterrupts?: boolean;
}

interface DeploymentResult {
  lines: string[];
  root: string;
  status: number | null;
  stderr: string;
  stdout: string;
}

function runDeployment(options: DeploymentOptions = {}): DeploymentResult {
  const root = mkdtempSync(join(tmpdir(), "puddles-deploy-test-"));
  tempRoots.push(root);
  const source = join(root, "openclaw");
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  const npmRoot = join(root, "npm-root");
  const remoteStaging = join(root, "remote-staging");
  const tempDir = join(root, "tmp");
  const sourceLock = join(root, "source-build.lock");
  mkdirSync(source);
  mkdirSync(bin);
  mkdirSync(join(npmRoot, "openclaw"), { recursive: true });
  mkdirSync(join(source, "scripts"), { recursive: true });
  mkdirSync(join(root, "sandbox", "scripts"), { recursive: true });
  mkdirSync(remoteStaging);
  mkdirSync(tempDir);
  mkdirSync(join(root, ".openclaw", "state"), { recursive: true });
  mkdirSync(join(root, ".openclaw", "tasks"), { recursive: true });
  mkdirSync(join(root, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(join(root, ".openclaw", "openclaw.json"), "original-config");
  writeFileSync(join(root, ".openclaw", "tasks", "existing"), "original-task");
  writeFileSync(join(root, ".openclaw", "state", "openclaw.sqlite"), "");
  writeFileSync(
    join(source, "scripts", "sandbox-browser-entrypoint.sh"),
    "# FIX-BROWSER-USERDATA-DIR\n",
  );
  writeFileSync(join(source, "openclaw-stale.tgz"), "unrelated");
  writeFileSync(join(root, "sandbox", "Dockerfile.sandbox-browser"), "FROM scratch");
  writeFileSync(
    join(root, "sandbox", "scripts", "sandbox-browser-entrypoint.sh"),
    "original-entrypoint",
  );
  writeFileSync(join(root, "gateway-loaded"), "loaded");
  if (!options.missingPlist) {
    writeFileSync(
      join(root, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
      "original-plist",
    );
  }
  if (options.lockHeld) {
    mkdirSync(join(root, ".openclaw-deploy.lock"));
    writeFileSync(join(root, ".openclaw-deploy.lock", "pid"), "other");
  }
  if (options.sourceLockHeld) {
    mkdirSync(sourceLock);
    writeFileSync(join(sourceLock, "pid"), "other-build");
  }

  const mock = `#!/bin/sh
name="$(basename "$0")"
printf '%s' "$name" >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
if [ "$name" = npm ]; then
  if [ "\${1:-}" = root ]; then
    printf '%s\\n' "$MOCK_NPM_ROOT"
  elif [ "\${1:-}" = install ]; then
    [ -f "\${3:-}" ] || exit 66
    if [ "\${MOCK_PREVIOUS_INSTALL_FAILS:-0}" = 1 ] && printf '%s' "\${3:-}" | grep -q 'openclaw-previous\\.tgz$'; then
      exit 67
    fi
  elif [ "\${1:-}" = pack ]; then
    destination=
    ignore_scripts=
    previous=
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --pack-destination ]; then
        destination="$2"
        shift 2
      elif [ "$1" = --ignore-scripts ]; then
        ignore_scripts=1
        shift
      elif [ -d "$1" ]; then
        previous=1
        shift
      else
        shift
      fi
    done
    if [ -n "$previous" ]; then
      [ -n "$ignore_scripts" ] || exit 65
      : > "$destination/openclaw-previous.tgz"
      printf '%s\\n' openclaw-previous.tgz
    else
      : > "$destination/openclaw-test.tgz"
      printf '%s\\n' openclaw-test.tgz
    fi
  fi
elif [ "$name" = python3 ]; then
  if [ "\${2:-}" = clone ]; then
    clone_count=0
    [ -f "$MOCK_CLONE_COUNT" ] && clone_count="$(cat "$MOCK_CLONE_COUNT")"
    clone_count=$((clone_count + 1))
    printf '%s\\n' "$clone_count" > "$MOCK_CLONE_COUNT"
    if [ "$clone_count" -eq "\${MOCK_CLONE_FAIL_ON_CALL:-0}" ]; then
      exit 95
    fi
    cp -cR "$3" "$4"
  elif [ "\${2:-}" = swap ]; then
    swap_tmp="$3.swap"
    mv "$3" "$swap_tmp"
    mv "$4" "$3"
    mv "$swap_tmp" "$4"
  fi
elif [ "$name" = git ]; then
  for arg in "$@"; do
    if [ "$arg" = puddles-deploy.lock ]; then
      printf '%s\\n' "$MOCK_SOURCE_LOCK"
      exit 0
    fi
  done
elif [ "$name" = openclaw ]; then
  if [ "\${1:-}" = doctor ]; then
    printf '%s' "\${OPENCLAW_SERVICE_REPAIR_POLICY:-auto}" > "$MOCK_DOCTOR_POLICY"
    if [ "\${OPENCLAW_SERVICE_REPAIR_POLICY:-auto}" != external ]; then
      : > "$MOCK_LAUNCH_STATE"
    fi
  fi
  if [ "\${1:-}" = doctor ] && [ "\${MOCK_DOCTOR_MUTATES:-0}" = 1 ]; then
    printf '%s' mutated-config > "$HOME/.openclaw/openclaw.json"
    rm -f "$HOME/.openclaw/tasks/existing"
    mkdir -p "$HOME/.openclaw/agents"
    printf '%s' created-by-migration > "$HOME/.openclaw/agents/created"
  fi
  if [ "\${1:-}" = doctor ] && [ "\${MOCK_DOCTOR_INTERRUPTS:-0}" = 1 ]; then
    kill -TERM "$PPID"
    exit 143
  fi
  if [ "\${1:-}" = doctor ] && [ "\${MOCK_DOCTOR_FAILS:-0}" = 1 ]; then
    exit 42
  fi
  if [ "\${1:-}" = gateway ] && [ "\${2:-}" = health ]; then
    has_local_port=0
    for arg in "$@"; do
      [ "$arg" = --port ] && has_local_port=1
    done
    if [ "\${MOCK_REMOTE_GATEWAY_HEALTHY:-0}" = 1 ] && [ "$has_local_port" -eq 0 ]; then
      exit 0
    fi
    count=0
    [ -f "$MOCK_HEALTH_COUNT" ] && count="$(cat "$MOCK_HEALTH_COUNT")"
    count=$((count + 1))
    printf '%s\\n' "$count" > "$MOCK_HEALTH_COUNT"
    if [ "$count" -le "\${MOCK_HEALTH_FAILURES:-0}" ]; then
      exit 1
    fi
  fi
  if [ "\${1:-}" = sandbox ] && [ "\${2:-}" = recreate ] && [ "\${MOCK_SANDBOX_FAIL_ONCE:-0}" = 1 ]; then
    if [ ! -f "$MOCK_SANDBOX_FAILED" ]; then
      : > "$MOCK_SANDBOX_FAILED"
      exit 47
    fi
  fi
elif [ "$name" = sqlite3 ]; then
  case "\${2:-}" in
    ".backup "*)
      backup="$(printf '%s' "$2" | sed -e "s/^\\\\.backup '//" -e "s/'$//")"
      : > "$backup"
      ;;
  esac
elif [ "$name" = docker ]; then
  [ -d "$HOME/.openclaw-deploy.lock" ] || exit 88
  [ ! -f "$MOCK_LAUNCH_STATE" ] || exit 89
  : > "$MOCK_DOCKER_LOCK_SEEN"
  if [ "\${1:-}" = image ] && [ "\${2:-}" = inspect ]; then
    printf '%s\\n' sha256:previous-browser
  elif [ "\${1:-}" = build ] && [ "\${MOCK_BROWSER_BUILD_INTERRUPTS:-0}" = 1 ]; then
      kill -TERM "$PPID"
      exit 143
  fi
elif [ "$name" = scp ]; then
  source_path="$1"
  target_path="\${2#*:}"
  mkdir -p "$(dirname "$target_path")"
  cp "$source_path" "$target_path"
elif [ "$name" = launchctl ]; then
  if [ "\${1:-}" = bootout ]; then
    bootout_count=0
    [ -f "$MOCK_BOOTOUT_COUNT" ] && bootout_count="$(cat "$MOCK_BOOTOUT_COUNT")"
    bootout_count=$((bootout_count + 1))
    printf '%s\\n' "$bootout_count" > "$MOCK_BOOTOUT_COUNT"
    if [ "\${MOCK_ROLLBACK_SHUTDOWN_NEVER_COMPLETES:-0}" = 1 ] && [ "$bootout_count" -gt 1 ]; then
      printf '%s\\n' 999 > "$MOCK_SHUTDOWN_DELAY"
    elif [ "\${MOCK_SHUTDOWN_DELAY_CHECKS:-0}" -gt 0 ]; then
      printf '%s\\n' "$MOCK_SHUTDOWN_DELAY_CHECKS" > "$MOCK_SHUTDOWN_DELAY"
    else
      rm -f "$MOCK_LAUNCH_STATE"
    fi
    if [ "\${MOCK_STOP_INTERRUPTS:-0}" = 1 ]; then
      kill -TERM "$PPID"
      exit 143
    fi
  elif [ "\${1:-}" = print ]; then
    if [ -f "$MOCK_SHUTDOWN_DELAY" ]; then
      remaining="$(cat "$MOCK_SHUTDOWN_DELAY")"
      if [ "$remaining" -gt 0 ]; then
        printf '%s\\n' "$((remaining - 1))" > "$MOCK_SHUTDOWN_DELAY"
        exit 0
      fi
      rm -f "$MOCK_SHUTDOWN_DELAY" "$MOCK_LAUNCH_STATE"
      exit 1
    fi
    [ -f "$MOCK_LAUNCH_STATE" ]
  elif [ "\${1:-}" = bootstrap ]; then
    : > "$MOCK_LAUNCH_STATE"
  fi
elif [ "$name" = ssh ]; then
  shift
  exec "$@"
fi
`;
  for (const command of [
    "git",
    "pnpm",
    "python3",
    "npm",
    "openclaw",
    "docker",
    "launchctl",
    "scp",
    "sleep",
    "sqlite3",
    "ssh",
  ]) {
    const path = join(bin, command);
    writeFileSync(path, mock);
    chmodSync(path, 0o755);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMMAND_LOG: log,
    GATEWAY_HEALTH_ATTEMPTS: String(options.healthAttempts ?? 5),
    GATEWAY_HEALTH_INTERVAL_SECONDS: "1",
    HOME: root,
    MOCK_DOCTOR_FAILS: options.doctorFails ? "1" : "0",
    MOCK_DOCTOR_INTERRUPTS: options.doctorInterrupts ? "1" : "0",
    MOCK_DOCTOR_MUTATES: options.doctorMutates ? "1" : "0",
    MOCK_DOCTOR_POLICY: join(root, "doctor-policy"),
    MOCK_BROWSER_BUILD_INTERRUPTS: options.browserBuildInterrupts ? "1" : "0",
    MOCK_CLONE_COUNT: join(root, "clone-count"),
    MOCK_CLONE_FAIL_ON_CALL: options.cloneFails
      ? "1"
      : options.reverseCloneFails
        ? "2"
        : "0",
    MOCK_BOOTOUT_COUNT: join(root, "bootout-count"),
    MOCK_DOCKER_LOCK_SEEN: join(root, "docker-lock-seen"),
    MOCK_HEALTH_COUNT: join(root, "health-count"),
    MOCK_HEALTH_FAILURES: String(options.healthFailures ?? 0),
    MOCK_LAUNCH_STATE: join(root, "gateway-loaded"),
    MOCK_NPM_ROOT: npmRoot,
    MOCK_PREVIOUS_INSTALL_FAILS: options.previousInstallFails ? "1" : "0",
    MOCK_REMOTE_GATEWAY_HEALTHY: options.remoteGatewayHealthy ? "1" : "0",
    MOCK_ROLLBACK_SHUTDOWN_NEVER_COMPLETES:
      options.rollbackShutdownNeverCompletes ? "1" : "0",
    MOCK_SANDBOX_FAILED: join(root, "sandbox-failed"),
    MOCK_SANDBOX_FAIL_ONCE: options.sandboxRecreateFails ? "1" : "0",
    MOCK_SHUTDOWN_DELAY: join(root, "shutdown-delay"),
    MOCK_SHUTDOWN_DELAY_CHECKS: String(options.shutdownDelayChecks ?? 0),
    MOCK_SOURCE_LOCK: sourceLock,
    MOCK_STOP_INTERRUPTS: options.stopInterrupts ? "1" : "0",
    OPENCLAW_SRC: source,
    MINI_SANDBOX_BUILD: join(root, "sandbox"),
    PATH: `${bin}:/usr/bin:/bin`,
    REMOTE_STAGING_DIR: remoteStaging,
    TMPDIR: tempDir,
  };
  if (options.miniHost) {
    env.MINI_HOST = options.miniHost;
  } else {
    delete env.MINI_HOST;
  }

  const result = spawnSync("/bin/bash", [deployScript], {
    env,
    encoding: "utf8",
  });
  return {
    lines: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
    root,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
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
    const result = runDeployment();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const { lines } = result;
    const invoked = commands(lines);

    expect(invoked).toContain("openclaw");
    expect(invoked).toContain("launchctl");
    expect(invoked).not.toContain("ssh");
    expect(invoked).not.toContain("scp");
    expect(lines).toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t.*\/openclaw-test\.tgz$/),
    );
    expect(lines).toContain("openclaw\tdoctor\t--fix\t--yes");
    expect(lines).toContain("openclaw\tgateway\thealth\t--port\t18789");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^npm\tpack\t.*npm-root\/openclaw\t--ignore-scripts\t--silent\t--pack-destination\t/,
      ),
    );
    expect(existsSync(join(result.root, ".openclaw-deploy.lock"))).toBe(false);
    expect(existsSync(join(result.root, "source-build.lock"))).toBe(false);
    expect(existsSync(join(result.root, "docker-lock-seen"))).toBe(true);
    expect(readFileSync(join(result.root, "doctor-policy"), "utf8")).toBe(
      "external",
    );
    const dockerBuildIndex = lines.findIndex((line) =>
      line.startsWith("docker\tbuild\t"),
    );
    const explicitStartIndex = lines.findIndex((line) =>
      line.startsWith("launchctl\tbootstrap\t"),
    );
    expect(dockerBuildIndex).toBeGreaterThan(-1);
    expect(explicitStartIndex).toBeGreaterThan(dockerBuildIndex);
    expect(
      existsSync(join(result.root, "openclaw", "openclaw-stale.tgz")),
    ).toBe(true);
  });

  it("uses SSH and SCP only when a remote target is explicit", () => {
    const result = runDeployment({ miniHost: "approved-mini" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const { lines } = result;
    const invoked = commands(lines);

    expect(invoked).toContain("ssh");
    expect(invoked).toContain("scp");
    expect(invoked).toContain("openclaw");
    expect(invoked).toContain("launchctl");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^scp\t.*openclaw-test\.tgz\tapproved-mini:.*\/puddles-openclaw-.*\.tgz$/,
      ),
    );
    expect(lines).toContain("openclaw\tdoctor\t--fix\t--yes");
    expect(lines).toContain("openclaw\tgateway\thealth\t--port\t18789");
  });

  for (const miniHost of [undefined, "approved-mini"]) {
    const target = miniHost ? "remote" : "local";

    it(`fails and rolls back when ${target} state migration fails`, () => {
      const result = runDeployment({
        doctorFails: true,
        doctorMutates: true,
        miniHost,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("required state migration failed");
      expect(result.lines).toContainEqual(
        expect.stringMatching(/^npm\tinstall\t-g\t.*\/openclaw-previous\.tgz$/),
      );
      expect(
        readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
      ).toBe("original-config");
      expect(
        readFileSync(
          join(result.root, ".openclaw", "tasks", "existing"),
          "utf8",
        ),
      ).toBe("original-task");
      expect(
        existsSync(join(result.root, ".openclaw", "agents", "created")),
      ).toBe(false);
      expect(
        readFileSync(
          join(
            result.root,
            "Library",
            "LaunchAgents",
            "ai.openclaw.gateway.plist",
          ),
          "utf8",
        ),
      ).toBe("original-plist");
    });

    it(`waits for delayed ${target} gateway readiness`, () => {
      const result = runDeployment({ healthFailures: 2, miniHost });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(
        result.lines.filter(
          (line) => line === "openclaw\tgateway\thealth\t--port\t18789",
        ),
      ).toHaveLength(3);
    });

    it(`fails and rolls back when ${target} gateway readiness times out`, () => {
      const result = runDeployment({
        healthAttempts: 3,
        healthFailures: 20,
        miniHost,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "gateway did not become healthy on local port 18789 after 3 attempts",
      );
      expect(result.lines).toContainEqual(
        expect.stringMatching(/^npm\tinstall\t-g\t.*\/openclaw-previous\.tgz$/),
      );
    });
  }

  it("does not accept a healthy remote gateway when local readiness fails", () => {
    const result = runDeployment({
      healthAttempts: 3,
      healthFailures: 20,
      remoteGatewayHealthy: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "gateway did not become healthy on local port 18789",
    );
    expect(result.lines).not.toContain("openclaw\tgateway\thealth");
    expect(result.lines).toContain("openclaw\tgateway\thealth\t--port\t18789");
  });

  it("restores exact runtime state when migration is interrupted", () => {
    const result = runDeployment({
      doctorInterrupts: true,
      doctorMutates: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /deployment interrupted by TERM|required state migration failed/,
    );
    expect(
      readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
    ).toBe("original-config");
    expect(
      readFileSync(
        join(result.root, ".openclaw", "tasks", "existing"),
        "utf8",
      ),
    ).toBe("original-task");
    expect(
      existsSync(join(result.root, ".openclaw", "agents", "created")),
    ).toBe(false);
  });

  it("restarts the gateway when interrupted during stop", () => {
    const result = runDeployment({ stopInterrupts: true });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.lines).toContainEqual(
      expect.stringMatching(/^launchctl\tbootstrap\tgui\//),
    );
  });

  it("waits for gateway shutdown before snapshotting", () => {
    const result = runDeployment({ shutdownDelayChecks: 3 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const bootoutIndex = result.lines.findIndex((line) =>
      line.startsWith("launchctl\tbootout\t"),
    );
    const installIndex = result.lines.findIndex((line) =>
      line.match(/^npm\tinstall\t-g/),
    );
    const shutdownPrints = result.lines
      .slice(bootoutIndex + 1, installIndex)
      .filter((line) => line.startsWith("launchctl\tprint\t"));
    expect(shutdownPrints.length).toBeGreaterThanOrEqual(4);
  });

  it("fails closed when runtime cloning is unsupported", () => {
    const result = runDeployment({ cloneFails: true });
    expect(result.status).not.toBe(0);
    expect(result.lines).toContainEqual(
      expect.stringMatching(/^python3\t-\tclone\t.*\.openclaw\t.*runtime-state$/),
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g/),
    );
    expect(
      readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
    ).toBe("original-config");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
  });

  it("does not stop the gateway when the service plist is missing", () => {
    const result = runDeployment({ missingPlist: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "readable gateway service definition is missing",
    );
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootout\t/),
    );
  });

  it("does not restart the gateway when reverse cloning fails", () => {
    const result = runDeployment({
      doctorFails: true,
      doctorMutates: true,
      reverseCloneFails: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "gateway restart skipped because critical rollback restoration failed",
    );
    expect(
      readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
    ).toBe("mutated-config");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(false);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootstrap\t/),
    );
  });

  it("does not restart when previous-package installation fails", () => {
    const result = runDeployment({
      doctorFails: true,
      previousInstallFails: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "gateway restart skipped because critical rollback restoration failed",
    );
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(false);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootstrap\t/),
    );
  });

  it("restores the browser entrypoint when interrupted after installation", () => {
    const result = runDeployment({ browserBuildInterrupts: true });
    expect(result.status).not.toBe(0);
    expect(
      readFileSync(
        join(
          result.root,
          "sandbox",
          "scripts",
          "sandbox-browser-entrypoint.sh",
        ),
        "utf8",
      ),
    ).toBe("original-entrypoint");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
  });

  it("restores the browser entrypoint and image when recreation fails", () => {
    const result = runDeployment({ sandboxRecreateFails: true });
    expect(result.status).not.toBe(0);
    expect(
      readFileSync(
        join(
          result.root,
          "sandbox",
          "scripts",
          "sandbox-browser-entrypoint.sh",
        ),
        "utf8",
      ),
    ).toBe("original-entrypoint");
    expect(result.lines).toContain(
      "docker\ttag\tsha256:previous-browser\topenclaw-sandbox-browser:bookworm-slim",
    );
    expect(
      result.lines.filter(
        (line) =>
          line ===
          "openclaw\tsandbox\trecreate\t--agent\tbrowser-agent\t--force",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate package or state when rollback shutdown times out", () => {
    const result = runDeployment({
      doctorMutates: true,
      healthAttempts: 3,
      healthFailures: 20,
      rollbackShutdownNeverCompletes: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "rollback aborted before mutation because gateway shutdown was not confirmed",
    );
    expect(
      result.lines.filter((line) =>
        line.match(/^npm\tinstall\t-g\t.*openclaw-previous\.tgz$/),
      ),
    ).toHaveLength(0);
    expect(
      readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
    ).toBe("mutated-config");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
  });

  it("rejects a concurrent deployment without removing its lock", () => {
    const result = runDeployment({ lockHeld: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("another deployment holds");
    expect(
      readFileSync(
        join(result.root, ".openclaw-deploy.lock", "pid"),
        "utf8",
      ),
    ).toBe("other");
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g/),
    );
  });

  it("rejects a concurrent build without removing its source lock", () => {
    const result = runDeployment({ sourceLockHeld: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("another deployment is building from");
    expect(
      readFileSync(join(result.root, "source-build.lock", "pid"), "utf8"),
    ).toBe("other-build");
    expect(result.lines).not.toContain("pnpm\tbuild");
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tpack/),
    );
  });
});
