import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise installed routing and transcript storage with synthetic identities.
// The runtime is read-only; all writes belong to this disposable fixture.
const runtime = resolve(process.argv[2]);
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "main-conversation-fixture-"));
  try {
    const config = join(root, "openclaw.json");
    writeFileSync(config, "{}");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), runtime, "--child"],
      {
        env: { ...process.env, HOME: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: config },
        encoding: "utf8",
        timeout: 40_000,
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    process.stdout.write(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const root = process.env.OPENCLAW_STATE_DIR;
  assert.ok(root?.includes("main-conversation-fixture-"));
  const deny = () => { throw new Error("Network access is forbidden in the conversation fixture"); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  const sdk = async (name) => import(pathToFileURL(join(runtime, "dist/plugin-sdk", `${name}.js`)));
  const { resolveAgentRoute, buildAgentMainSessionKey } = await sdk("routing");
  const { upsertSessionEntry, getSessionEntry } = await sdk("session-store-runtime");
  const { appendSessionTranscriptMessageByIdentity, readSessionTranscriptEvents } = await sdk("session-transcript-runtime");
  const cfg = {
    agents: { ownership: "explicit", entries: { main: {}, household: {} } },
    session: { dmScope: "per-channel-peer" },
    talk: { agentId: "main" },
    bindings: [
      { agentId: "main", match: { channel: "imessage", accountId: "default" } },
      { agentId: "main", match: { channel: "imessage", accountId: "another-account" } },
      { agentId: "household", match: { channel: "imessage", peer: { kind: "direct", id: "+15555550101" } } },
      { agentId: "main", match: { channel: "imessage", accountId: "default", peer: { kind: "direct", id: "+15555550100" } }, session: { dmScope: "main" } },
    ],
  };
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg));
  const route = (id, accountId = "default", kind = "direct") =>
    resolveAgentRoute({ cfg, channel: "imessage", accountId, peer: { kind, id } });
  const owner = route("+15555550100");
  assert.equal(owner.sessionKey, "agent:main:main");
  assert.notEqual(route("+15555550102").sessionKey, owner.sessionKey);
  assert.equal(route("+15555550101").agentId, "household");
  assert.notEqual(route("+15555550100", "another-account").sessionKey, owner.sessionKey);
  assert.notEqual(route("+15555550100", "default", "group").sessionKey, owner.sessionKey);
  assert.equal(buildAgentMainSessionKey({ agentId: cfg.talk.agentId }), owner.sessionKey);
  const scope = { agentId: "main", sessionKey: owner.sessionKey, storePath: join(root, "sessions.json") };
  const sessionId = "synthetic-main-session";
  await upsertSessionEntry({ ...scope, entry: { sessionId, updatedAt: Date.now() } });
  const append = (eventId, role, text, provenance) => appendSessionTranscriptMessageByIdentity({
    ...scope, sessionId, eventId,
    message: { role, content: [{ type: "text", text }], timestamp: Date.now(), ...(provenance ? { provenance } : {}) },
  });
  await append("text-before-call", "user", "The synthetic appointment is on Tuesday.");
  // These are recorded transcript inputs. Native Talk ingestion and reconnect
  // are qualified through the real Gateway in the separate voice scenario.
  const speech = ["speech-1", "user", "Make that Wednesday instead.", { kind: "realtime_voice", sourceChannel: "talk" }];
  await append(...speech);
  await append(...speech);
  await append("speech-2", "assistant", "We are discussing Wednesday.", speech[3]);
  await append("text-during-call", "user", "Use the afternoon slot.");
  const messages = (await readSessionTranscriptEvents({ ...scope, sessionId }))
    .filter((event) => event.type === "message").map((event) => event.message);
  assert.deepEqual(messages.map((message) => message.content), [
    [{ type: "text", text: "The synthetic appointment is on Tuesday." }],
    [{ type: "text", text: "Make that Wednesday instead." }],
    [{ type: "text", text: "We are discussing Wednesday." }],
    [{ type: "text", text: "Use the afternoon slot." }],
  ]);
  assert.equal(messages[1].provenance.kind, "realtime_voice");
  assert.equal(messages[2].provenance.kind, "realtime_voice");
  assert.equal(getSessionEntry({ ...scope, readConsistency: "latest" }).sessionId, sessionId);
  console.log(JSON.stringify({ status: "passed", checks: ["owner-only-routing", "configured-main-key", "recorded-transcript-order", "recorded-transcript-deduplication", "provenance", "stable-session-identity"], modelCalls: 0, externalWrites: 0 }));
}
