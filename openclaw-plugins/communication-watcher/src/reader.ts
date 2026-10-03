import { BoundaryError, object } from "./guards.js";
/** Return answer text only. Never expose reasoning, tool arguments, or media. */
export function readerAnswer(messages: unknown[]): string {
  const last = [...messages].reverse().find(value => object(value).role === "assistant");
  if (!last) throw new BoundaryError("unavailable");
  const content = object(last).content;
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content) || content.some(value => !["text", "thinking", "redacted_thinking"].includes(String(object(value).type)))) throw new BoundaryError("invalid");
  const parts = content.filter(value => object(value).type === "text").map(value => object(value).text);
  if (!parts.length || parts.some(part => typeof part !== "string")) throw new BoundaryError("invalid");
  return parts.join("\n");
}
