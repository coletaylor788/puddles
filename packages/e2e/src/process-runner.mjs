import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

let activeCommand;
let handlingSignal = false;

function signalChildGroup(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    return;
  }
  child.kill(signal);
}

export async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Command timeout must be a positive integer");
  if (!options.quiet) console.log(`+ ${command} ${args.join(" ")}`);
  const capture = options.capture === true;
  const piped = capture || options.logPath || options.quiet;
  const log = options.logPath ? openSync(options.logPath, "a", 0o600) : undefined;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: piped ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let outputExceeded = false;
  let killTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    signalChildGroup(child, "SIGTERM");
    killTimer = setTimeout(() => {
      signalChildGroup(child, "SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, options.killGraceMs ?? 5_000);
  }, timeoutMs);
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    if (log !== undefined) writeSync(log, chunk);
    if (capture && !outputExceeded) {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > (options.maxOutputBytes ?? 4 * 1024 * 1024)) {
        outputExceeded = true;
        signalChildGroup(child, "SIGKILL");
      }
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    if (log !== undefined) writeSync(log, chunk);
    if (capture && !outputExceeded) {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > (options.maxOutputBytes ?? 4 * 1024 * 1024)) {
        outputExceeded = true;
        signalChildGroup(child, "SIGKILL");
      }
    }
  });

  const done = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  activeCommand = { child, done };

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", (error) => reject(options.quiet ? new Error("Command could not start", { cause: error }) : error));
      child.once("close", (code, signal) => {
        if (outputExceeded) {
          reject(new Error("Command output exceeded its capture bound"));
          return;
        }
        if (timedOut) {
          reject(new Error(`Command exceeded ${timeoutMs}ms and was terminated`));
          return;
        }
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const detail = signal ? `signal ${signal}` : `status ${code}`;
        const suffix = capture && !options.quiet && stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`${options.quiet ? "Command" : command} exited with ${detail}${suffix}`));
      });
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    if (log !== undefined) closeSync(log);
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
  let timer;
  const completed = await Promise.race([
    active.done.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), graceMs); }),
  ]);
  clearTimeout(timer);
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
    process.on(signal, () => {
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
