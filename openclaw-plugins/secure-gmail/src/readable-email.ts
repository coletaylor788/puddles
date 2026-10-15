import type { McpCaller } from "./wrap-tool.js";

const failure = () => ({
  isError: true,
  content: [{ type: "text" as const, text: "Email read failed. Only readable text is available." }],
});
const strings = ["from", "to", "subject", "date", "body_text"] as const;
const fields = new Set<string>([...strings, "cc", "format", "attachments"]);

/** A fresh text-only envelope is the only email result admitted to either guard. */
export function wrapReadableEmailCaller(inner: McpCaller): McpCaller {
  return {
    async callTool(name, args, signal) {
      if (typeof args.email_id !== "string" || !args.email_id ||
          (args.format !== undefined && args.format !== "readable" && args.format !== "text_only")) {
        return failure();
      }
      try {
        const raw = await inner.callTool(name, { email_id: args.email_id, format: "readable" }, signal);
        if (raw.isError || raw.content.length !== 1 || raw.content[0].type !== "text") return failure();
        const data = JSON.parse(raw.content[0].text);
        if (!data || typeof data !== "object" || Array.isArray(data) ||
            data.format !== "readable" || Object.keys(data).some(key => !fields.has(key)) ||
            strings.some(key => typeof data[key] !== "string") ||
            (data.cc !== undefined && typeof data.cc !== "string")) return failure();
        const clean: Record<string, unknown> = { format: "readable" };
        for (const key of strings) clean[key] = data[key];
        if (data.cc !== undefined) clean.cc = data.cc;
        if (data.attachments !== undefined) {
          if (!Array.isArray(data.attachments) || data.attachments.some((a: any) =>
            !a || typeof a !== "object" || Array.isArray(a) ||
            Object.keys(a).some(k => !["filename", "mime_type", "size_bytes"].includes(k)) ||
            typeof a.filename !== "string" || typeof a.mime_type !== "string" ||
            typeof a.size_bytes !== "number" || !Number.isFinite(a.size_bytes) || a.size_bytes < 0)) {
            return failure();
          }
          clean.attachments = data.attachments.map((a: any) => ({
            filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes,
          }));
        }
        // Do not spread the MCP result: details, resources, and annotations may
        // contain source that was never text-extracted or scanned.
        return { content: [{ type: "text", text: JSON.stringify(clean) }] };
      } catch {
        return failure();
      }
    },
  };
}
