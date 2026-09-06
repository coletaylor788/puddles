import { spawn } from "node:child_process";

let activeCommand;
let handlingSignal = false;

function signalChildGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
    child.kill(signal);
    return;
  }
  child.kill(signal);
}

export async function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  console.log(`+ ${command} ${args.join(" ")}`);
  const capture = options.capture === true;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let stdout = "";
  let stderr = "";
  let timeout;
  let killTimeout;
  let timedOut = false;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const done = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  activeCommand = { child, done };

  try {
    return await new Promise((resolve, reject) => {
      if (options.timeoutMs) {
        timeout = setTimeout(() => {
          timedOut = true;
          signalChildGroup(child, "SIGTERM");
          killTimeout = setTimeout(
            () => {
              signalChildGroup(child, "SIGKILL");
              child.stdout?.destroy();
              child.stderr?.destroy();
            },
            options.killGraceMs ?? 10_000,
          );
        }, options.timeoutMs);
      }
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (timedOut) {
          reject(
            new Error(
              `${command} exceeded ${options.timeoutMs}ms and was terminated`,
            ),
          );
          return;
        }
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const detail = signal ? `signal ${signal}` : `status ${code}`;
        const suffix = capture && stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`${command} exited with ${detail}${suffix}`));
      });
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimeout);
    console.log(
      `  completed in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
    if (activeCommand?.child === child) {
      activeCommand = undefined;
    }
  }
}

export async function stopActiveCommand(signal, graceMs = 10_000) {
  const active = activeCommand;
  if (!active) {
    return;
  }
  signalChildGroup(active.child, signal);
  const completed = await Promise.race([
    active.done.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (!completed) {
    signalChildGroup(active.child, "SIGKILL");
    await active.done;
  }
}

export function installSignalHandlers(params) {
  for (const [signal, exitCode] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.once(signal, () => {
      if (handlingSignal) {
        return;
      }
      handlingSignal = true;
      void (async () => {
        const errors = [];
        try {
          await stopActiveCommand(signal, params.graceMs);
        } catch (error) {
          errors.push(error);
        }
        try {
          errors.push(...(await params.cleanup()));
        } catch (error) {
          errors.push(error);
        }
        for (const error of errors) {
          console.error(`Signal cleanup failed: ${error.message}`);
        }
        process.exit(exitCode);
      })();
    });
  }
}

export function isHandlingSignal() {
  return handlingSignal;
}
