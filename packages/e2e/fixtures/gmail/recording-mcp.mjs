import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const record = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "recording-gmail", version: "1" } };
  else if (request.method === "tools/call" && request.params.name === "send_email") {
    if (process.env.GMAIL_MCP_ENABLE_SEND !== "1") throw new Error("Missing explicit fixture enablement");
    appendFileSync(record, JSON.stringify(request.params) + "\n");
    result = { content: [{ type: "text", text: JSON.stringify({ status: "sent", id: "fixture-id", threadId: "fixture-thread" }) }] };
  } else throw new Error("Unrecorded MCP operation: " + request.method);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
}
