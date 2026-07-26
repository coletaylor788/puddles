import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) {
  throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
}

const tempRoots: string[] = [];
const children: ChildProcess[] = [];

async function waitForFile(
  path: string,
  child: ChildProcess,
  output: { stderr: string; stdout: string },
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(
        `browser entrypoint exited before invoking Chromium: ${child.exitCode}\n` +
          `${output.stdout}\n${output.stderr}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the browser entrypoint to invoke Chromium");
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.pid) {
      const running = child.exitCode === null && child.signalCode === null;
      const exited = running
        ? new Promise((resolve) => child.once("exit", resolve))
        : Promise.resolve();
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          throw error;
        }
      }
      if (running) {
        await Promise.race([
          exited,
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("patched browser sandbox entrypoint", () => {
  it("uses the configured profile and removes stale Chromium singleton files", async () => {
    const root = mkdtempSync(join(tmpdir(), "puddles-browser-entrypoint-"));
    tempRoots.push(root);
    const bin = join(root, "bin");
    const home = join(root, "home");
    const profile = join(root, "profile");
    const argsLog = join(root, "chromium-args.log");
    const script = join(root, "sandbox-browser-entrypoint.sh");
    mkdirSync(bin);
    mkdirSync(profile);

    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      writeFileSync(join(profile, name), "stale");
    }

    copyFileSync(join(candidate, "scripts", "sandbox-browser-entrypoint.sh"), script);
    const isolated = readFileSync(script, "utf8")
      .replace("export HOME=/tmp/openclaw-home", `export HOME=${JSON.stringify(home)}`)
      .replace("${DISABLE_GRAPHICS_FLAGS,,}", "${DISABLE_GRAPHICS_FLAGS}")
      .replace("${DISABLE_EXTENSIONS,,}", "${DISABLE_EXTENSIONS}");
    writeFileSync(script, isolated);
    chmodSync(script, 0o755);

    const sleeper = `#!/bin/sh
if [ "$(basename "$0")" = chromium ]; then
  printf '%s\\n' "$*" > "$BROWSER_ARGS_LOG"
fi
trap 'exit 0' TERM INT
while :; do /bin/sleep 1; done
`;
    for (const command of ["Xvfb", "chromium"]) {
      const path = join(bin, command);
      writeFileSync(path, sleeper);
      chmodSync(path, 0o755);
    }
    for (const [command, body] of [
      ["curl", "#!/bin/sh\nexit 0\n"],
      ["date", "#!/bin/sh\nprintf '1000\\n'\n"],
    ] as const) {
      const path = join(bin, command);
      writeFileSync(path, body);
      chmodSync(path, 0o755);
    }

    const child = spawn("/bin/bash", [script], {
      detached: true,
      env: {
        ...process.env,
        AUTO_START_TIMEOUT_MS: "1000",
        BROWSER_ARGS_LOG: argsLog,
        OPENCLAW_BROWSER_ENABLE_NOVNC: "0",
        OPENCLAW_BROWSER_HEADLESS: "1",
        OPENCLAW_BROWSER_USER_DATA_DIR: profile,
        PATH: `${bin}:/usr/bin:/bin`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const output = { stderr: "", stdout: "" };
    child.stdout?.on("data", (chunk) => {
      output.stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output.stderr += String(chunk);
    });

    await waitForFile(argsLog, child, output);
    const args = readFileSync(argsLog, "utf8");
    expect(args).toContain(`--user-data-dir=${profile}`);
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      expect(existsSync(join(profile, name)), name).toBe(false);
    }
  });
});
