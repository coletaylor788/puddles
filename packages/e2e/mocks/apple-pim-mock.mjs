#!/usr/bin/env node
// Mock Apple-PIM CLI — a drop-in stand-in for the Swift reminder/calendar/
// contacts CLIs used by the apple-pim MCP bridge. WRITE commands (create/add/
// update/delete/new) are RECORDED to $E2E_MOCK_STATE/apple-pim-writes.jsonl and
// return success WITHOUT touching the real Reminders/Calendar/Contacts. READ
// commands (list/query/items/get/show/search) return an empty (or fixture) set.
//
// Point the isolated test gateway's apple-pim CLIs at this so calendar_write /
// apple_pim_reminder / apple_pim_contact can be exercised with zero real writes.
import { appendFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { join } from "node:path";

const argv = process.argv.slice(2);
const tool = basename(process.argv[1] || "apple-pim").replace(/\.mjs$/, "");
const sub = (argv[0] || "").toLowerCase();
const stateDir = process.env.E2E_MOCK_STATE || "/tmp/e2e-mock-state";
mkdirSync(stateDir, { recursive: true });

const WRITE = /^(create|add|new|update|edit|set|delete|remove|complete|rm)/;
const READ = /^(list|items|query|get|show|search|find|read|calendars|lists)/;

function ok(obj) {
  process.stdout.write(JSON.stringify({ ok: true, mock: true, ...obj }) + "\n");
  process.exit(0);
}

if (WRITE.test(sub)) {
  appendFileSync(
    join(stateDir, "apple-pim-writes.jsonl"),
    JSON.stringify({ ts: Date.now(), tool, sub, argv }) + "\n",
  );
  ok({ id: `mock-${tool}-${Date.now()}`, recorded: true });
} else if (READ.test(sub)) {
  // Reads are exercised E2E against the REAL system elsewhere; the mock returns empty.
  ok({ items: [] });
} else {
  ok({ sub });
}
