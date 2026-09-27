#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  coordinate, coordinationPath, initializeCoordination, processIdentity,
  readCoordination, recoverMetadataLock,
} from "../src/deploy-coordination.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (value) => console.log(JSON.stringify(value, null, 2));

export async function retryCoordinate(path, operation, input, update = coordinate, wait = delay) {
  for (let attempt = 0; ; attempt++) {
    try { return update(path, operation, input); }
    catch (error) {
      if (error.code !== "COORDINATION_BUSY" || attempt >= 19) throw error;
      await wait(100);
    }
  }
}

export async function runWithSlot(path, lease, command, args) {
  await retryCoordinate(path, "bind-process", { ...lease, process: processIdentity() });
  const child = spawn(command, args, { detached: true, stdio: "inherit", env: {
    ...process.env, PUDDLES_DEPLOY_REQUEST_ID: lease.requestId, PUDDLES_DEPLOY_TOKEN: lease.token,
    PUDDLES_DEPLOY_COORDINATION: path,
  } });
  let failure;
  const signal = (name) => {
    try { if (child.pid) process.kill(-child.pid, name); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  let termination;
  const stop = () => {
    signal("SIGTERM");
    termination ??= setTimeout(() => signal("SIGKILL"), 10_000);
  };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => { failure ??= new Error(`Deployment interrupted by ${name}`); stop(); }]);
  for (const [name, handler] of handlers) process.on(name, handler);
  let busySince;
  const heartbeat = setInterval(async () => {
    try { await retryCoordinate(path, "heartbeat", lease); busySince = undefined; }
    catch (error) {
      if (error.code === "COORDINATION_BUSY") {
        busySince ??= Date.now();
        if (Date.now() - busySince < 120_000) return;
      }
      failure = error; stop();
    }
  }, 30_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    // A child may leave helpers behind. The environment cannot be handed off
    // until the controller has joined or stopped its whole process group.
    signal("SIGTERM");
    for (let attempt = 0; attempt < 40 && child.pid; attempt++) {
      try { process.kill(-child.pid, 0); }
      catch (error) { if (error.code === "ESRCH") break; throw error; }
      if (attempt === 20) signal("SIGKILL");
      if (attempt === 39) throw new Error("Deployment children remain; retain slot for recovery");
      await delay(250);
    }
    if (failure) throw failure;
    if (code !== 0) throw new Error(`Deployment command failed (${code}); retain slot and inspect recovery`);
  } finally {
    clearInterval(heartbeat); clearTimeout(termination);
    for (const [name, handler] of handlers) process.removeListener(name, handler);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [operation, inputPath, path = coordinationPath(), ...args] = argv;
  if (operation === "status" && !inputPath) return write(readCoordination());
  if (operation === "status") return write(readCoordination(inputPath));
  if (!inputPath) throw new Error("Usage: openclaw-deployment-slot.mjs status [STATE] | OPERATION INPUT_JSON [STATE] | run LEASE_JSON STATE COMMAND [ARGS...]");
  const input = read(inputPath);
  if (operation === "init") return write(initializeCoordination(path, input));
  if (operation === "recover-metadata") return recoverMetadataLock(path, input);
  if (operation === "run") {
    if (!args.length) throw new Error("A command is required");
    return runWithSlot(path, input, args[0], args.slice(1));
  }
  write(await retryCoordinate(path, operation, input));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
