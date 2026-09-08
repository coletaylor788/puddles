#!/usr/bin/env node
// Mock `imsg` CLI — a drop-in stand-in for the real iMessage bridge used by the
// isolated test gateway so that message/send operations NEVER reach a real
// device. It RECORDS outbound sends to $E2E_MOCK_STATE/imsg-sends.jsonl and
// returns success; it performs no real send. RPC watch receives fixture events.
//
// Wire it in an isolated (--dev) config as channels.imessage.cliPath so the
// `message` tool can be exercised end-to-end with zero real texts.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const stateDir = process.env.E2E_MOCK_STATE;
if (!stateDir) {
  process.stderr.write("E2E_MOCK_STATE is required\n");
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });

function record(file, obj) {
  appendFileSync(join(stateDir, file), JSON.stringify(obj) + "\n");
}

if (argv.includes("--help")) {
  process.stdout.write("fixture imsg rpc send send-rich --file\n");
} else if (cmd === "rpc") {
  let subscribed = false;
  let cursor = 0;
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    let request;
    try { request = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ error: { code: -32700, message: "Invalid JSON" } }) + "\n"); return; }
    const { id, method, params } = request;
    record("imsg-rpc.jsonl", { method, params });
    let result;
    if (method === "watch.subscribe") {
      subscribed = true;
      result = { subscription: 1 };
      record("imsg-ready.jsonl", { subscribed: true });
    } else if (method === "watch.unsubscribe") {
      subscribed = false;
      result = { ok: true };
    } else if (method === "chats.list" || method === "messages.list" || method === "history") {
      result = [];
    } else if (["send", "send-rich", "typing", "read", "react"].includes(method)) {
      record(method.startsWith("send") ? "imsg-sends.jsonl" : "imsg-effects.jsonl", { method, params });
      result = { ok: true, id: "fixture-send", guid: "fixture-send", messageId: "fixture-send" };
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported fixture method" } }) + "\n");
      record("imsg-denied.jsonl", { method });
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  });
  const timer = setInterval(() => {
    const path = join(stateDir, "imsg-incoming.jsonl");
    if (!subscribed || !existsSync(path)) return;
    const lines = readFileSync(path, "utf8").split("\n");
    // Only consume complete records. The producer may be appending a line.
    for (; cursor < lines.length - 1; cursor++) {
      const message = JSON.parse(lines[cursor]);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "message", params: { message } }) + "\n");
    }
  }, 20);
  input.on("close", () => { clearInterval(timer); });
} else if (cmd === "send") {
  // Record the send instead of delivering it. Real interference = 0.
  record("imsg-sends.jsonl", { ts: Date.now(), argv });
  process.stdout.write(JSON.stringify({ ok: true, id: `mock-msg-${Date.now()}`, mock: true }) + "\n");
  process.exit(0);
} else if (cmd === "watch") {
  process.stderr.write("Use rpc watch.subscribe for fixture inbound delivery\n");
  process.exitCode = 2;
} else if (cmd === "status") {
  process.stdout.write(JSON.stringify({ advanced_features: true, v2_ready: true, rpc_methods: ["watch.subscribe", "send", "typing", "read"] }) + "\n");
} else if (["chats", "health", "history", "info", "status", "version"].includes(cmd)) {
  process.stdout.write(JSON.stringify({ ok: true, mock: true, cmd }) + "\n");
  process.exit(0);
} else {
  process.stderr.write(`Unsupported mock imsg command: ${cmd || "<empty>"}\n`);
  process.exit(2);
}
