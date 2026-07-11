#!/usr/bin/env node
// Mock `imsg` CLI — a drop-in stand-in for the real iMessage bridge used by the
// isolated test gateway so that message/send operations NEVER reach a real
// device. It RECORDS outbound sends to $E2E_MOCK_STATE/imsg-sends.jsonl and
// returns success; it performs no real send. `watch` emits nothing (no inbound).
//
// Wire it in an isolated (--dev) config as channels.imessage.cliPath so the
// `message` tool can be exercised end-to-end with zero real texts.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const stateDir = process.env.E2E_MOCK_STATE || "/tmp/e2e-mock-state";
mkdirSync(stateDir, { recursive: true });

function record(file, obj) {
  appendFileSync(join(stateDir, file), JSON.stringify(obj) + "\n");
}

if (cmd === "send") {
  // Record the send instead of delivering it. Real interference = 0.
  record("imsg-sends.jsonl", { ts: Date.now(), argv });
  process.stdout.write(JSON.stringify({ ok: true, id: `mock-msg-${Date.now()}`, mock: true }) + "\n");
  process.exit(0);
}
if (cmd === "watch") {
  // No inbound events from the mock; stay quiet until killed.
  process.stdout.write(JSON.stringify({ ok: true, watching: true, mock: true }) + "\n");
  setInterval(() => {}, 1 << 30);
} else {
  // Any other subcommand (info/health/etc.): benign success.
  process.stdout.write(JSON.stringify({ ok: true, mock: true, cmd }) + "\n");
  process.exit(0);
}
