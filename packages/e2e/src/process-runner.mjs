import { execFileSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { startCommandResourceMonitor } from "./native-resources.mjs";

import { closeProcessScope, createProcessScope, prepareOwnedProcess, inspectProcessScope, retireProcessScope } from "../../release/src/owned-process.mjs";

const activeCommands = new Set();
let handlingSignal = false;

function signalChildGroup(active, signal) {
  const { child } = active;
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); }
    catch (error) {
      // macOS can report EPERM when a group exits between ps and kill.
      // A permission failure for a surviving owned group remains an error.
      if (error.code !== "ESRCH" && (error.code !== "EPERM" ||
        ownedProcesses(active).some(row => row.group === child.pid))) throw error;
    }
    return;
  }
  child.kill(signal);
}

function ownedProcesses(active) {
  if (!active.child.pid) return [];
  if (process.platform === "win32") return active.child.exitCode === null && active.child.signalCode === null
    ? [{ pid: active.child.pid }] : [];
  const registration = inspectProcessScope(active.scope);
  active.incompleteRegistration = registration.incomplete;
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { encoding: "utf8", timeout: 5000 })
    .split("\n").flatMap(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]),
        zombie: match[4].startsWith("Z"), start: match[5] }] : [];
    });
  for (const row of rows) if (registration.records.some(record => record.pid === row.pid && record.start === row.start)) active.descendants.set(row.pid, row.start);
  const parents = new Set(rows.filter(row => row.group === active.child.pid ||
    active.descendants.get(row.pid) === row.start).map(row => row.pid));
  let changed;
  do {
    changed = false;
    for (const row of rows) if (parents.has(row.parent) && !parents.has(row.pid)) {
      parents.add(row.pid); changed = true;
    }
  } while (changed);
  for (const row of rows) if (parents.has(row.pid) && !active.descendants.has(row.pid)) active.descendants.set(row.pid, row.start);
  return rows.filter(row => !row.zombie && active.descendants.get(row.pid) === row.start);
}

function signalOwnedProcesses(active, signal) {
  // Read ancestry before signaling can orphan detached fixtures. Retain exact
  // identities so a reused PID cannot acquire the old command's ownership.
  const owned = ownedProcesses(active);
  signalChildGroup(active, signal);
  for (const row of owned) if (row.group !== active.child.pid) {
    try { process.kill(row.pid, signal); }
    catch (error) {
      if (error.code !== "ESRCH" && (error.code !== "EPERM" ||
        ownedProcesses(active).some(current => current.pid === row.pid && current.start === row.start))) throw error;
    }
  }
}

function joinCommandGroup(active, signal, graceMs) {
  // runCommand's finally and the signal handler share ownership until the whole
  // group has stopped. The leader's close event alone cannot release it.
  return active.stopping ??= (async () => {
    closeProcessScope(active.scope);
    const verifyRegistration = () => {
      if (active.incompleteRegistration) throw new Error("Process launch registration is incomplete; retain ownership scope");
    };
    if (!ownedProcesses(active).length) { await active.done; verifyRegistration(); return; }
    signalOwnedProcesses(active, signal);
    const waitUntil = async milliseconds => {
      const deadline = Date.now() + milliseconds;
      while (ownedProcesses(active).length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      return !ownedProcesses(active).length;
    };
    if (!await waitUntil(graceMs)) {
      signalOwnedProcesses(active, "SIGKILL");
      if (!await waitUntil(5000)) throw new Error("Command descendants did not stop");
    }
    await active.done;
    verifyRegistration();
  })();
}

export async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Command timeout must be a positive integer");
  if (!options.quiet) console.log(`+ ${command} ${args.join(" ")}`);
  const capture = options.capture === true;
  const piped = capture || options.logPath || options.quiet;
  const log = options.logPath ? openSync(options.logPath, "a", 0o600) : undefined;
  const scope = createProcessScope();
  let prepared;
  try { prepared = prepareOwnedProcess(command, args, {
    cwd: options.cwd, env: options.env,
    stdio: piped ? ["ignore", "pipe", "pipe"] : "inherit",
  }, [scope]); } catch (error) {
    if (log !== undefined) closeSync(log);
    error.message += `; retained process scope: ${scope}`;
    throw error;
  }
  const { child } = prepared;
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let outputExceeded = false;
  let killTimer;
  let rejectSignal;
  const signalFailure = new Promise((_, reject) => { rejectSignal = reject; });
  const signal = kind => {
    try { signalOwnedProcesses(tracked, kind); }
    catch (error) { rejectSignal(error); }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    signal("SIGTERM");
    killTimer = setTimeout(() => {
      signal("SIGKILL");
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
        signal("SIGKILL");
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
        signal("SIGKILL");
      }
    }
  });

  const done = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  const tracked = { child, done, scope, interrupted: false, descendants: new Map() };
  activeCommands.add(tracked);
  const stopResourceMonitor = options.resourcePath && child.pid
    ? startCommandResourceMonitor({
        path: options.resourcePath,
        rootPid: child.pid,
        diskPath: options.resourceDiskPath ?? options.cwd ?? process.cwd(),
        profile: options.resourceProfile,
        label: options.resourceLabel ?? command,
      })
    : undefined;

  let result;
  let commandError;
  let resourceError;
  let cleanupError;
  try {
    result = await Promise.race([signalFailure, new Promise((resolve, reject) => {
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
      try { prepared.release(); } catch (error) { prepared.abort(); reject(error); }
    })]);
  } catch (error) {
    commandError = error;
  } finally {
    try { await joinCommandGroup(tracked, "SIGTERM", options.killGraceMs ?? 5_000); }
    catch (error) { cleanupError = error; }
    clearTimeout(timer);
    clearTimeout(killTimer);
    try { stopResourceMonitor?.(); }
    catch (error) { resourceError = error; }
    if (log !== undefined) closeSync(log);
    if (!cleanupError) { retireProcessScope(scope); activeCommands.delete(tracked); }
  }
  // Opt-in callers can redact captured failures before persisting diagnostics.
  // Keep raw output out of the message, stack and ordinary serialization.
  if (commandError && capture && options.captureErrorOutput === true) {
    Object.defineProperty(commandError, "capturedOutput", {
      value: { stdout, stderr, exitCode: child.exitCode, signal: child.signalCode },
    });
  }
  // Let callers finish their own finally blocks. CLI wrappers suppress their
  // top-level rejection while signal cleanup owns process exit.
  const errors = [commandError, resourceError, cleanupError].filter(Boolean);
  if (errors.length > 1) {
    throw new AggregateError(errors, "Command and resource measurement or cleanup failed");
  }
  if (commandError) throw commandError;
  if (resourceError) throw resourceError;
  if (cleanupError) throw cleanupError;
  return result;
}

export async function stopActiveCommand(signal, graceMs = 10_000) {
  const stop = async active => {
  active.interrupted = true;
  await joinCommandGroup(active, signal, graceMs);
  };
  const results = await Promise.allSettled([...activeCommands].map(stop));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Interrupted commands did not stop");
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
          errors.push(...(await params.cleanup({ joinSucceeded: errors.length === 0 })));
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
