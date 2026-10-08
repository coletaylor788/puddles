import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export default function register(api) {
  const state = process.env.E2E_MOCK_STATE;
  if (!state) throw new Error("Recording tools require isolated E2E_MOCK_STATE");
  const adapters = JSON.parse(readFileSync(join(state, "adapters.json"), "utf8"));
  for (const [name, adapter] of Object.entries(adapters)) {
    api.registerTool({
      name,
      label: name,
      description: "Deterministic recording fixture. Use only for the scripted scenario.",
      parameters: {
        type: "object",
        properties: { operation: { type: "string" }, value: { type: "string" } },
        required: ["operation"],
        additionalProperties: false,
      },
      async execute(_id, args) {
        if (!adapter.operations.includes(args.operation)) {
          appendFileSync(join(state, "tool-denied.jsonl"), JSON.stringify({ name, args }) + "\n");
          throw new Error("Unsupported fixture operation");
        }
        appendFileSync(join(state, "tool-calls.jsonl"), JSON.stringify({ name, args, kind: adapter.kind }) + "\n");
        const result = adapter.kind === "write"
          ? { recorded: true }
          : adapter.responses[args.operation];
        if (result === undefined) throw new Error("Missing deterministic read fixture");
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    });
  }
}
