import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
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
const cloneHelper = join(
  repoRoot,
  "docs",
  "openclaw-setup",
  "patches",
  "clone-runtime-tree.py",
);
const tempRoots: string[] = [];

interface DeploymentOptions {
  backupRootInsideState?: boolean;
  candidateWorkspaceDependency?: boolean;
  corepackOnly?: boolean;
  miniHost?: string;
  doctorFails?: boolean;
  doctorInterrupts?: boolean;
  doctorMutates?: boolean;
  dockerTagFails?: boolean;
  healthFailures?: number;
  healthAttempts?: number;
  imageInspectFailureCall?: number;
  immutableArtifact?: boolean;
  lockHeld?: boolean;
  missingPreviousWorkspaceDependency?: boolean;
  missingPlist?: boolean;
  noPreviousBrowserImage?: boolean;
  previousInstallFails?: boolean;
  previousCliSwallowsDiscovery?: boolean;
  remotePathsWithSpaces?: boolean;
  remoteGatewayHealthy?: boolean;
  remoteReceiptMisses?: number;
  reverseCloneFails?: boolean;
  rollbackShutdownNeverCompletes?: boolean;
  rollbackHealthInterrupts?: boolean;
  browserBuildInterrupts?: boolean;
  cloneFails?: boolean;
  sandboxRecreateFails?: boolean;
  sandboxRecreateFailsPersistently?: boolean;
  shutdownDelayChecks?: number;
  sourceLockHeld?: boolean;
  sshDisconnectsAfterCompletion?: boolean;
  symlinkStateRoot?: boolean;
  stopInterrupts?: boolean;
  postCheckFails?: boolean;
  preexistingRemoteReceipt?: boolean;
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
  const remoteStaging = options.remotePathsWithSpaces
    ? join(root, "remote staging")
    : join(root, "remote-staging");
  const sandboxBuild = options.remotePathsWithSpaces
    ? join(root, "sandbox build")
    : join(root, "sandbox");
  const tempDir = join(root, "tmp");
  const sourceLock = join(root, "source-build.lock");
  mkdirSync(source);
  mkdirSync(bin);
  mkdirSync(join(npmRoot, "openclaw"), { recursive: true });
  mkdirSync(join(npmRoot, "openclaw", "node_modules", "@openclaw", "ai"), {
    recursive: true,
  });
  writeFileSync(
    join(npmRoot, "openclaw", "package.json"),
    JSON.stringify({
      name: "openclaw",
      version: "2026.7.1-2",
      dependencies: { "@openclaw/ai": "workspace:*" },
    }),
  );
  if (!options.missingPreviousWorkspaceDependency) {
    writeFileSync(
      join(npmRoot, "openclaw", "node_modules", "@openclaw", "ai", "package.json"),
      JSON.stringify({ name: "@openclaw/ai", version: "2026.7.1" }),
    );
  }
  mkdirSync(join(source, "scripts"), { recursive: true });
  mkdirSync(join(sandboxBuild, "scripts"), { recursive: true });
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
  writeFileSync(join(sandboxBuild, "Dockerfile.sandbox-browser"), "FROM scratch");
  writeFileSync(
    join(sandboxBuild, "scripts", "sandbox-browser-entrypoint.sh"),
    "original-entrypoint",
  );
  writeFileSync(join(root, "gateway-loaded"), "loaded");
  if (options.symlinkStateRoot) {
    const stateTarget = join(root, "state-target");
    renameSync(join(root, ".openclaw"), stateTarget);
    symlinkSync(stateTarget, join(root, ".openclaw"));
  }
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
  const immutableArtifact = join(root, "immutable-openclaw.tgz");
  if (options.immutableArtifact) {
    const packageRoot = join(root, "immutable-package", "package");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "openclaw",
        version: "2026.7.1",
        dependencies: { "@openclaw/ai": "2026.7.1" },
      }),
    );
    spawnSync("/usr/bin/tar", [
      "-czf",
      immutableArtifact,
      "-C",
      dirname(packageRoot),
      "package",
    ]);
  }
  const postCheck = join(root, "post-check");
  writeFileSync(
    postCheck,
    `#!/bin/sh\nprintf passed > "$HOME/post-check-ran"\nexit ${options.postCheckFails ? 1 : 0}\n`,
  );
  chmodSync(postCheck, 0o755);

  const mock = `#!/bin/sh
name="$(basename "$0")"
printf '%s' "$name" >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
  if [ "$name" = corepack ] && [ "\${1:-}" = pnpm ]; then
    shift
    name=pnpm
  fi
  if [ "$name" = pnpm ]; then
  if [ "\${1:-}" = pack ]; then
    destination=
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --pack-destination ]; then
        destination="$2"
        shift 2
      else
        shift
      fi
    done
    pack_root="$TMPDIR/mock-candidate-package-$$"
    mkdir -p "$pack_root/package"
    candidate_dependency=2026.7.1
    if [ "\${MOCK_CANDIDATE_WORKSPACE_DEPENDENCY:-0}" = 1 ]; then
      candidate_dependency='workspace:*'
    fi
    printf '%s' '{"name":"openclaw","version":"2026.7.1","dependencies":{"@openclaw/ai":"'"$candidate_dependency"'"}}' > "$pack_root/package/package.json"
    /usr/bin/tar -czf "$destination/openclaw-test.tgz" -C "$pack_root" package
    rm -rf "$pack_root"
    printf '%s\\n' "$destination/openclaw-test.tgz"
  fi
elif [ "$name" = npm ]; then
  if [ "\${1:-}" = root ]; then
    printf '%s\\n' "$MOCK_NPM_ROOT"
  elif [ "\${1:-}" = install ]; then
    [ -f "\${3:-}" ] || exit 66
    if /usr/bin/tar -xOf "\${3:-}" package/package.json | grep -q 'workspace:'; then
      exit 68
    fi
    if [ "\${MOCK_PREVIOUS_INSTALL_FAILS:-0}" = 1 ] && printf '%s' "\${3:-}" | grep -q 'openclaw-previous\\.tgz$'; then
      exit 67
    fi
    if printf '%s' "\${3:-}" | grep -q 'openclaw-previous\\.tgz$'; then
      printf '%s' previous > "$MOCK_PACKAGE_STATE"
    else
      printf '%s' candidate > "$MOCK_PACKAGE_STATE"
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
      pack_root="$TMPDIR/mock-previous-package-$$"
      mkdir -p "$pack_root/package"
      printf '%s' '{"name":"openclaw","version":"2026.7.1-2","dependencies":{"@openclaw/ai":"workspace:*"}}' > "$pack_root/package/package.json"
      /usr/bin/tar -czf "$destination/openclaw-previous.tgz" -C "$pack_root" package
      rm -rf "$pack_root"
      printf '%s\\n' openclaw-previous.tgz
    else
      exit 64
    fi
  fi
elif [ "$name" = python3 ]; then
  if printf '%s' "\${1:-}" | grep -q 'clone-runtime-tree\\.py$'; then
    if [ "\${2:-}" = --validate-destination ]; then
      case "\${4:-}" in
        "\${3:-}"|"\${3:-}"/*) exit 95 ;;
      esac
      exit 0
    fi
    clone_count=0
    [ -f "$MOCK_CLONE_COUNT" ] && clone_count="$(cat "$MOCK_CLONE_COUNT")"
    clone_count=$((clone_count + 1))
    printf '%s\\n' "$clone_count" > "$MOCK_CLONE_COUNT"
    if [ "$clone_count" -eq "\${MOCK_CLONE_FAIL_ON_CALL:-0}" ]; then
      exit 95
    fi
    cp -cR "$2" "$3"
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
    if [ "\${MOCK_ROLLBACK_HEALTH_INTERRUPTS:-0}" = 1 ] && [ "$(cat "$MOCK_PACKAGE_STATE" 2>/dev/null)" = previous ] && [ ! -f "$MOCK_ROLLBACK_SIGNAL_SENT" ]; then
      : > "$MOCK_ROLLBACK_SIGNAL_SENT"
      kill -TERM "$PPID"
    fi
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
  if [ "\${1:-}" = sandbox ] && [ "\${2:-}" = recreate ] && [ "\${MOCK_SANDBOX_FAILS_PERSISTENTLY:-0}" = 1 ]; then
    if [ "\${MOCK_PREVIOUS_CLI_SWALLOWS_DISCOVERY:-0}" = 1 ] && [ "$(cat "$MOCK_PACKAGE_STATE" 2>/dev/null)" = previous ]; then
      exit 0
    fi
    exit 48
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
    inspect_count=0
    [ -f "$MOCK_IMAGE_INSPECT_COUNT" ] && inspect_count="$(cat "$MOCK_IMAGE_INSPECT_COUNT")"
    inspect_count=$((inspect_count + 1))
    printf '%s\\n' "$inspect_count" > "$MOCK_IMAGE_INSPECT_COUNT"
    if [ "$inspect_count" -eq "\${MOCK_IMAGE_INSPECT_FAILURE_CALL:-0}" ]; then
      echo 'Error response from daemon: registry state unavailable' >&2
      exit 50
    fi
    image=
    for image in "$@"; do :; done
    if printf '%s' "$image" | grep -q 'puddles-deploy-'; then
      printf '%s\\n' sha256:candidate-browser
    elif [ "\${MOCK_NO_PREVIOUS_BROWSER_IMAGE:-0}" = 1 ]; then
      echo "Error response from daemon: No such image: $image" >&2
      exit 1
    else
      printf '%s\\n' sha256:previous-browser
    fi
  elif [ "\${1:-}" = build ] && [ "\${MOCK_BROWSER_BUILD_INTERRUPTS:-0}" = 1 ]; then
      kill -TERM "$PPID"
      exit 143
  elif [ "\${1:-}" = tag ] && [ "\${MOCK_DOCKER_TAG_FAILS:-0}" = 1 ] && printf '%s' "\${2:-}" | grep -q 'puddles-deploy-'; then
    exit 49
  fi
elif [ "$name" = scp ]; then
  while [ "\${1:-}" = -o ]; do shift 2; done
  source_path="$1"
  target_path="$2"
  case "$source_path" in
    *:*) source_path="\${source_path#*:}" ;;
    *) target_path="\${target_path#*:}" ;;
  esac
  if printf '%s' "$source_path" | grep -q -- '-result\\.json$'; then
    receipt_fetches=0
    [ -f "$MOCK_RECEIPT_FETCH_COUNT" ] &&
      receipt_fetches="$(cat "$MOCK_RECEIPT_FETCH_COUNT")"
    receipt_fetches=$((receipt_fetches + 1))
    printf '%s\\n' "$receipt_fetches" > "$MOCK_RECEIPT_FETCH_COUNT"
    if [ "$receipt_fetches" -le "\${MOCK_REMOTE_RECEIPT_MISSES:-0}" ]; then
      exit 1
    fi
    [ -f "$source_path" ] || /bin/sleep 0.2
  fi
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
  while [ "\${1:-}" = -o ]; do shift 2; done
  shift
  command="$1"
  /bin/bash -c "$command"
  status="$?"
  if [ "\${MOCK_SSH_DISCONNECTS_AFTER_COMPLETION:-0}" = 1 ] &&
     printf '%s' "$command" | grep -q 'nohup /bin/bash'; then
    exit 255
  fi
  exit "$status"
fi
`;
  for (const command of [
    "git",
    options.corepackOnly ? "corepack" : "pnpm",
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
  symlinkSync(process.execPath, join(bin, "node"));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMMAND_LOG: log,
    GATEWAY_HEALTH_ATTEMPTS: String(options.healthAttempts ?? 5),
    GATEWAY_HEALTH_INTERVAL_SECONDS: "1",
    HOME: root,
    MOCK_DOCTOR_FAILS: options.doctorFails ? "1" : "0",
    MOCK_CANDIDATE_WORKSPACE_DEPENDENCY: options.candidateWorkspaceDependency
      ? "1"
      : "0",
    MOCK_DOCTOR_INTERRUPTS: options.doctorInterrupts ? "1" : "0",
    MOCK_DOCTOR_MUTATES: options.doctorMutates ? "1" : "0",
    MOCK_DOCKER_TAG_FAILS: options.dockerTagFails ? "1" : "0",
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
    MOCK_IMAGE_INSPECT_COUNT: join(root, "image-inspect-count"),
    MOCK_IMAGE_INSPECT_FAILURE_CALL: String(options.imageInspectFailureCall ?? 0),
    MOCK_LAUNCH_STATE: join(root, "gateway-loaded"),
    MOCK_NPM_ROOT: npmRoot,
    MOCK_NO_PREVIOUS_BROWSER_IMAGE: options.noPreviousBrowserImage ? "1" : "0",
    MOCK_PREVIOUS_INSTALL_FAILS: options.previousInstallFails ? "1" : "0",
    MOCK_PREVIOUS_CLI_SWALLOWS_DISCOVERY:
      options.previousCliSwallowsDiscovery ? "1" : "0",
    MOCK_REMOTE_GATEWAY_HEALTHY: options.remoteGatewayHealthy ? "1" : "0",
    MOCK_REMOTE_RECEIPT_MISSES: String(options.remoteReceiptMisses ?? 0),
    MOCK_RECEIPT_FETCH_COUNT: join(root, "receipt-fetch-count"),
    MOCK_ROLLBACK_SHUTDOWN_NEVER_COMPLETES:
      options.rollbackShutdownNeverCompletes ? "1" : "0",
    MOCK_ROLLBACK_HEALTH_INTERRUPTS: options.rollbackHealthInterrupts ? "1" : "0",
    MOCK_ROLLBACK_SIGNAL_SENT: join(root, "rollback-signal-sent"),
    MOCK_PACKAGE_STATE: join(root, "package-state"),
    MOCK_SANDBOX_FAILED: join(root, "sandbox-failed"),
    MOCK_SANDBOX_FAIL_ONCE: options.sandboxRecreateFails ? "1" : "0",
    MOCK_SANDBOX_FAILS_PERSISTENTLY: options.sandboxRecreateFailsPersistently
      ? "1"
      : "0",
    MOCK_SHUTDOWN_DELAY: join(root, "shutdown-delay"),
    MOCK_SHUTDOWN_DELAY_CHECKS: String(options.shutdownDelayChecks ?? 0),
    MOCK_SOURCE_LOCK: sourceLock,
    MOCK_SSH_DISCONNECTS_AFTER_COMPLETION:
      options.sshDisconnectsAfterCompletion ? "1" : "0",
    MOCK_STOP_INTERRUPTS: options.stopInterrupts ? "1" : "0",
    OPENCLAW_SRC: source,
    OPENCLAW_DEPLOY_PATH: `${bin}:/usr/bin:/bin`,
    MINI_SANDBOX_BUILD: sandboxBuild,
    PATH: `${bin}:/usr/bin:/bin`,
    REMOTE_STAGING_DIR: remoteStaging,
    REMOTE_RESULT_ATTEMPTS: "3",
    REMOTE_RESULT_INTERVAL_SECONDS: "1",
    TMPDIR: tempDir,
  };
  if (options.backupRootInsideState) {
    env.OPENCLAW_DEPLOY_BACKUP_ROOT = join(
      root,
      ".openclaw",
      "deploy-backups",
    );
  } else {
    delete env.OPENCLAW_DEPLOY_BACKUP_ROOT;
  }
  if (options.miniHost) {
    env.MINI_HOST = options.miniHost;
  } else {
    delete env.MINI_HOST;
  }
  if (options.immutableArtifact) {
    env.OPENCLAW_ARTIFACT = immutableArtifact;
    env.OPENCLAW_ARTIFACT_SHA256 = createHash("sha256")
      .update(readFileSync(immutableArtifact))
      .digest("hex");
    env.OPENCLAW_BROWSER_ENTRYPOINT = join(
      source,
      "scripts",
      "sandbox-browser-entrypoint.sh",
    );
    env.OPENCLAW_POST_DEPLOY_CHECK = postCheck;
    env.OPENCLAW_TARGET_RESULT = join(root, "deployment-result.json");
    if (options.preexistingRemoteReceipt && options.miniHost) {
      const runToken = createHash("sha256")
        .update(env.OPENCLAW_TARGET_RESULT)
        .digest("hex")
        .slice(0, 20);
      writeFileSync(
        join(remoteStaging, `puddles-openclaw-${runToken}-result.json`),
        JSON.stringify({
          schemaVersion: 1,
          stage: "deployment",
          status: "passed",
          detail: "deployment completed",
          recoveryDir: join(root, "prior-recovery"),
          artifactSha256: env.OPENCLAW_ARTIFACT_SHA256,
          completedAt: new Date().toISOString(),
        }),
      );
    }
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

describe("runtime clone helper", () => {
  it("clones files individually while preserving links and directory metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "puddles-clone-test-"));
    tempRoots.push(root);
    const source = join(root, "source");
    const destination = join(root, "destination");
    const nested = join(source, "nested");
    mkdirSync(nested, { recursive: true });
    chmodSync(nested, 0o750);
    writeFileSync(join(nested, "state.json"), "state");
    linkSync(join(nested, "state.json"), join(source, "state-hardlink.json"));
    symlinkSync("nested/state.json", join(source, "state-link.json"));
    chmodSync(nested, 0o2750);
    chmodSync(join(nested, "state.json"), 0o6750);
    expect(
      spawnSync(
        "xattr",
        ["-w", "com.apple.puddles-test", "directory", nested],
        { encoding: "utf8" },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        "xattr",
        [
          "-s",
          "-w",
          "com.apple.puddles-test",
          "symlink",
          join(source, "state-link.json"),
        ],
        { encoding: "utf8" },
      ).status,
    ).toBe(0);
    expect(
      spawnSync("chmod", ["+a", "everyone allow readattr", nested], {
        encoding: "utf8",
      }).status,
    ).toBe(0);
    expect(
      spawnSync(
        "chmod",
        [
          "-h",
          "+a",
          "everyone allow readattr",
          join(source, "state-link.json"),
        ],
        { encoding: "utf8" },
      ).status,
    ).toBe(0);

    const result = spawnSync("python3", [cloneHelper, source, destination], {
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(join(destination, "nested", "state.json"), "utf8")).toBe(
      "state",
    );
    expect(readlinkSync(join(destination, "state-link.json"))).toBe(
      "nested/state.json",
    );
    expect(statSync(join(destination, "nested", "state.json")).ino).toBe(
      statSync(join(destination, "state-hardlink.json")).ino,
    );
    expect(lstatSync(join(destination, "nested")).mode & 0o7777).toBe(0o2750);
    expect(
      lstatSync(join(destination, "nested", "state.json")).mode & 0o7777,
    ).toBe(0o6750);
    expect(
      spawnSync(
        "xattr",
        ["-p", "com.apple.puddles-test", join(destination, "nested")],
        { encoding: "utf8" },
      ).stdout.trim(),
    ).toBe("directory");
    expect(
      spawnSync(
        "xattr",
        [
          "-s",
          "-p",
          "com.apple.puddles-test",
          join(destination, "state-link.json"),
        ],
        { encoding: "utf8" },
      ).stdout.trim(),
    ).toBe("symlink");
    expect(
      spawnSync("ls", ["-lde", join(destination, "nested")], {
        encoding: "utf8",
      }).stdout,
    ).toContain("group:everyone allow readattr");
    expect(
      spawnSync("ls", ["-lde", join(destination, "state-link.json")], {
        encoding: "utf8",
      }).stdout,
    ).toContain("group:everyone allow readattr");
  });

  it("rejects a clone destination inside the source tree", () => {
    const root = mkdtempSync(join(tmpdir(), "puddles-clone-path-test-"));
    tempRoots.push(root);
    const source = join(root, "source");
    const destination = join(source, "backup", "runtime");
    mkdirSync(source);
    writeFileSync(join(source, "state.json"), "state");

    const result = spawnSync("python3", [cloneHelper, source, destination], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "runtime clone destination must be outside the source",
    );
    expect(existsSync(destination)).toBe(false);
  });

  it("rejects a differently-cased APFS alias inside the source tree", () => {
    const root = mkdtempSync(join(repoRoot, ".puddles-clone-case-test-"));
    tempRoots.push(root);
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(join(source, "state.json"), "state");
    const caseVariantSource = source.replace(/^\/Users\//, "/users/");
    expect(caseVariantSource).not.toBe(source);
    expect(existsSync(caseVariantSource)).toBe(true);
    const destination = join(caseVariantSource, "backup", "runtime");

    const result = spawnSync("python3", [cloneHelper, source, destination], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "runtime clone destination must be outside the source",
    );
    expect(existsSync(destination)).toBe(false);
  });
});

describe("OpenClaw deployment topology", () => {
  it("rejects an unresolvable rollback workspace dependency before deployment", () => {
    const result = runDeployment({ missingPreviousWorkspaceDependency: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "failed to normalize the currently installed package snapshot",
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootout\t/),
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t/),
    );
  });

  it("rejects unresolved candidate workspace dependencies before deployment", () => {
    const result = runDeployment({ candidateWorkspaceDependency: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "candidate package contains unresolved workspace dependencies",
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootout\t/),
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t/),
    );
  });

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
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^pnpm\tpack\t--config\.ignore-scripts=true\t--pack-destination\t/,
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

  it("deploys an immutable artifact without rebuilding it", () => {
    const result = runDeployment({ immutableArtifact: true });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.lines).not.toContain("pnpm\tinstall\t--frozen-lockfile");
    expect(result.lines).not.toContain("pnpm\tbuild");
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^pnpm\tpack\t/),
    );
    expect(result.lines).toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t.*immutable-openclaw\.tgz$/),
    );
    expect(readFileSync(join(result.root, "post-check-ran"), "utf8")).toBe(
      "passed",
    );
    expect(
      JSON.parse(
        readFileSync(join(result.root, "deployment-result.json"), "utf8"),
      ).status,
    ).toBe("passed");
  });

  it("rolls back when post-deploy validation fails", () => {
    const result = runDeployment({
      immutableArtifact: true,
      postCheckFails: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "post-deploy validation or landing check failed",
    );
    expect(result.lines).toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t.*openclaw-previous\.tgz$/),
    );
    expect(
      JSON.parse(
        readFileSync(join(result.root, "deployment-result.json"), "utf8"),
      ).status,
    ).toBe("failed");
  });

  it("uses the durable target receipt after an SSH disconnect", () => {
    const result = runDeployment({
      immutableArtifact: true,
      miniHost: "approved-mini",
      sshDisconnectsAfterCompletion: true,
      remoteReceiptMisses: 2,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const receipt = JSON.parse(
      readFileSync(join(result.root, "deployment-result.json"), "utf8"),
    );
    expect(receipt.status).toBe("passed");
    expect(receipt.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      Number(readFileSync(join(result.root, "receipt-fetch-count"), "utf8")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("reconciles a completed remote receipt without redeploying", () => {
    const result = runDeployment({
      immutableArtifact: true,
      miniHost: "approved-mini",
      preexistingRemoteReceipt: true,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Reconciled completed remote deployment");
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t/),
    );
  });

  it("fails clearly when remote receipt polling expires", () => {
    const result = runDeployment({
      immutableArtifact: true,
      miniHost: "approved-mini",
      remoteReceiptMisses: 10,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "remote deployment completion remains ambiguous after bounded receipt polling",
    );
  });

  it("records a durable remote failure before gateway quiesce", () => {
    const result = runDeployment({
      immutableArtifact: true,
      miniHost: "approved-mini",
      missingPlist: true,
    });

    expect(result.status).not.toBe(0);
    const receipt = JSON.parse(
      readFileSync(join(result.root, "deployment-result.json"), "utf8"),
    );
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("gateway service definition is missing");
  });

  it("uses Corepack when pnpm is not directly available", () => {
    const result = runDeployment({ corepackOnly: true });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.lines).toContain("corepack\tpnpm\tinstall\t--frozen-lockfile");
    expect(result.lines).toContain("corepack\tpnpm\tbuild");
    expect(result.lines).toContainEqual(
      expect.stringMatching(
        /^corepack\tpnpm\tpack\t--config\.ignore-scripts=true\t--pack-destination\t/,
      ),
    );
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

  it("preserves remote argument boundaries when paths contain spaces", () => {
    const result = runDeployment({
      miniHost: "approved-mini",
      remotePathsWithSpaces: true,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.lines).toContainEqual(
      expect.stringMatching(
        /^ssh\t(?:-o\t[^\t]+\t)+approved-mini\tnohup \/bin\/bash '.*remote staging\/puddles-openclaw-.*-deploy\.sh' '.*\.tgz'.*'.*sandbox build'.*$/,
      ),
    );
    expect(result.lines).toContainEqual(
      expect.stringMatching(/^docker\tbuild\t-f\t.*sandbox build\/Dockerfile/),
    );
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
      expect.stringMatching(
        /^python3\t.*clone-runtime-tree\.py\t.*\.openclaw\t.*runtime-state$/,
      ),
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

  it("does not stop or replace a symlinked runtime root", () => {
    const result = runDeployment({ symlinkStateRoot: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "runtime state directory must not be a symlink",
    );
    expect(lstatSync(join(result.root, ".openclaw")).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(join(result.root, ".openclaw", "openclaw.json"), "utf8"),
    ).toBe("original-config");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootout\t/),
    );
  });

  it("rejects an in-tree backup root before creating artifacts or stopping", () => {
    const result = runDeployment({ backupRootInsideState: true });
    expect(result.status).not.toBe(0);
    expect(
      existsSync(join(result.root, ".openclaw", "deploy-backups")),
    ).toBe(false);
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootout\t/),
    );
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(
        /^npm\tpack\t.*npm-root\/openclaw\t--ignore-scripts/,
      ),
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

  it("recovers when first-time browser image tagging fails", () => {
    const result = runDeployment({
      dockerTagFails: true,
      noPreviousBrowserImage: true,
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.stderr).not.toContain(
      "gateway restart skipped because critical rollback restoration failed",
    );
    expect(result.lines).not.toContain(
      "docker\timage\trm\topenclaw-sandbox-browser:bookworm-slim",
    );
  });

  it("aborts promotion when prior image inspection fails", () => {
    const result = runDeployment({ imageInspectFailureCall: 1 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to inspect browser image");
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^docker\tbuild\t/),
    );
  });

  it("rolls back exactly once when candidate image inspection fails", () => {
    const result = runDeployment({ imageInspectFailureCall: 2 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to inspect browser image");
    expect(
      result.stderr.match(/rolling back from/g),
    ).toHaveLength(1);
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
  });

  it("does not restart when rollback image inspection fails", () => {
    const result = runDeployment({
      imageInspectFailureCall: 3,
      noPreviousBrowserImage: true,
      sandboxRecreateFails: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to inspect browser image");
    expect(result.stderr).toContain(
      "gateway restart skipped because critical rollback restoration failed",
    );
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(false);
  });

  it("does not restart when browser rollback recreation keeps failing", () => {
    const result = runDeployment({
      previousCliSwallowsDiscovery: true,
      sandboxRecreateFailsPersistently: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "gateway restart skipped because critical rollback restoration failed",
    );
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(false);
    expect(result.lines).not.toContainEqual(
      expect.stringMatching(/^launchctl\tbootstrap\t/),
    );
    const rollbackRecreateIndex = result.lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) =>
        line.startsWith("openclaw\tsandbox\trecreate\t"),
      )
      .at(-1)?.index;
    const previousInstallIndex = result.lines.findIndex((line) =>
      line.match(/^npm\tinstall\t-g\t.*openclaw-previous\.tgz$/),
    );
    expect(rollbackRecreateIndex).toBeDefined();
    expect(previousInstallIndex).toBeGreaterThan(rollbackRecreateIndex!);
  });

  it("defers rollback signals through restart health validation", () => {
    const result = runDeployment({
      rollbackHealthInterrupts: true,
      sandboxRecreateFails: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "rollback completed to a safe terminal state after deferred signal(s): TERM",
    );
    expect(existsSync(join(result.root, "gateway-loaded"))).toBe(true);
    expect(existsSync(join(result.root, "rollback-signal-sent"))).toBe(true);
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
