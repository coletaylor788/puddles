#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const [modulePath, configPath] = process.argv.slice(2);
if (!modulePath || !configPath) {
  console.error("usage: openclaw-config-lock.mjs <lock-module> <config-path>");
  process.exit(2);
}

let lock;
let releaseRequested;
const releaseSignal = new Promise((resolve) => {
  releaseRequested = resolve;
});

for (const event of ["end", "close"]) {
  process.stdin.once(event, releaseRequested);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, releaseRequested);
}
process.stdin.resume();

try {
  const { acquireFileLock } = await import(pathToFileURL(modulePath).href);
  lock = await acquireFileLock(configPath, {
    retries: {
      retries: 80,
      factor: 1.2,
      minTimeout: 25,
      maxTimeout: 250,
      randomize: true,
    },
    stale: 30_000,
  });
  process.stdout.write(`${JSON.stringify({ ready: true, lockPath: lock.lockPath })}\n`);
  await releaseSignal;
  await lock.release();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
