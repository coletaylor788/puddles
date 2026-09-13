#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [phase, runtime, value, identity] = process.argv.slice(2);
if (!["capture", "join"].includes(phase) || !runtime || !value) {
  throw new Error("Expected capture <runtime> <pid> or join <runtime> <state> <identity>");
}
const require = createRequire(join(resolve(runtime), "package.json"));
const api = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/process-runtime")).href);
if (phase === "capture") {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid gateway PID");
  process.stdout.write(JSON.stringify(api.requireServiceProcessIdentity(pid)));
} else {
  const owner = JSON.parse(identity ?? "null");
  if (owner !== null && (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      !Number.isFinite(owner.startTime))) throw new Error("Invalid gateway process identity");
  await api.stopGatewayAndJoinLocalServices(resolve(value), owner, 30_000);
}
