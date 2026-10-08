import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenClawPluginApi, OpenClawPluginToolContext, AnyAgentTool } from "openclaw/plugin-sdk/core";
import { InjectionGuard, SecretRedactor, loadLLMProvider, type LLMClient } from "mcp-hooks";
import tools from "./tools.json" with { type: "json" };

export const TOOLS = tools;
type Config = { command: string; stateDir: string; chromeExecutable?: string; writesEnabled?: boolean;
  llmProvider: string; llmProviderOptions?: Record<string, unknown>; model?: string };
type Caller = { callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>; close(): Promise<void> };

export async function connect(config: Config): Promise<Caller> {
  const args = ["-I", fileURLToPath(new URL("./python/run.py", import.meta.url)), "--state-dir", config.stateDir];
  if (config.chromeExecutable) args.push("--chrome-executable", config.chromeExecutable);
  const transport = new StdioClientTransport({ command: config.command, args, stderr: "pipe",
    env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", HOME: process.env.HOME ?? "", PYTHONNOUSERSITE: "1" } });
  // Never relay process diagnostics, which may include browser/provider data.
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name: "puddles-rocket-money", version: "0.1.0" });
  try { await client.connect(transport); }
  catch { await transport.close(); throw new Error("MCP_UNAVAILABLE"); }
  return {
    async callTool(name, args) {
      return await client.callTool({ name, arguments: args }, undefined, { timeout: 150_000 }) as CallToolResult;
    },
    async close() { await client.close(); await transport.close(); },
  };
}

function configuration(api: OpenClawPluginApi, ctx: OpenClawPluginToolContext): Config | null {
  if (ctx.agentId !== "main" || !ctx.sessionKey || !ctx.workspaceDir) return null;
  const runtime = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config;
  const entry = runtime?.plugins?.entries?.["rocket-money"];
  if (!entry || entry.enabled === false) return null;
  const cfg = entry.config as Config | undefined;
  if (!cfg || !isAbsolute(cfg.command ?? "") || !isAbsolute(cfg.stateDir ?? "") || !cfg.llmProvider) return null;
  if (cfg.chromeExecutable && !isAbsolute(cfg.chromeExecutable)) return null;
  return cfg;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: { source: "rocket-money" } };
}

export function createPlugin(connector: typeof connect = connect) {
  return {
    id: "rocket-money", name: "Rocket Money",
    register(api: OpenClawPluginApi) {
      let bridge: Promise<Caller> | null = null;
      let bound: string | null = null;
      let provider: Promise<LLMClient> | null = null;
      let providerKey: string | null = null;
      const close = async () => {
        const pending = bridge; bridge = null; bound = null;
        if (pending) await (await pending.catch(() => null))?.close().catch(() => undefined);
      };
      api.registerTool((ctx: OpenClawPluginToolContext): AnyAgentTool[] => {
        const initial = configuration(api, ctx);
        if (!initial) return [];
        return TOOLS.filter(t => initial.writesEnabled || !t.name.startsWith("rocket_money_set_")).map(t => ({
          name: t.name, label: t.name, description: t.description, parameters: t.inputSchema as never,
          async execute(_id: string, params: unknown) {
            const cfg = configuration(api, ctx);
            if (!cfg || (t.name.startsWith("rocket_money_set_") && !cfg.writesEnabled)) return result({ status: "error", error: { code: "ACCESS_DENIED" } });
            // Recheck grants for existing sessions. No account, process or credential
            // configuration can come from tool arguments.
            const key = JSON.stringify([cfg.command, cfg.stateDir, cfg.chromeExecutable]);
            try {
              if (bound && bound !== key) await close();
              if (!bridge) { bound = key; bridge = connector(cfg); }
              const raw = await (await bridge).callTool(t.name, (params ?? {}) as Record<string, unknown>);
              const text = raw.content.filter(c => c.type === "text").map(c => c.text).join("\n");
              if (text.length > 16 * 1024 * 1024) throw new Error("LIMIT_EXCEEDED");
              const classifierKey = JSON.stringify([cfg.llmProvider, cfg.llmProviderOptions, cfg.model]);
              if (!provider || classifierKey !== providerKey) {
                providerKey = classifierKey;
                provider = loadLLMProvider(cfg.llmProvider, { ...cfg.llmProviderOptions, ...(cfg.model ? { model: cfg.model } : {}) });
              }
              const llm = await provider;
              const guards = [new InjectionGuard({ llm }), new SecretRedactor({ llm })];
              let checked = text;
              for (const guard of guards) {
                const verdict = await guard.check(t.name, checked);
                if (verdict.action === "block") return result({ status: "error", error: { code: "CONTENT_BLOCKED" }, ...(typeof (params as any)?.requestId === "string" ? { requestId: (params as any).requestId } : {}) });
                if (verdict.action === "modify") checked = verdict.content ?? "";
              }
              // Do not leak unfiltered structuredContent or original payload in details.
              const current = configuration(api, ctx);
              if (!current || JSON.stringify([current.command, current.stateDir, current.chromeExecutable]) !== key) {
                return result({ status: "error", error: { code: "ACCESS_DENIED" } });
              }
              return { content: [{ type: "text" as const, text: checked }], details: { source: "rocket-money", isError: raw.isError === true } };
            } catch {
              await close();
              // A lost write response is uncertain. Keep its ID available for reconciliation.
              return result({ status: "error", error: { code: t.name.startsWith("rocket_money_set_") ? "OUTCOME_UNKNOWN" : "MCP_UNAVAILABLE" },
                ...(typeof (params as any)?.requestId === "string" ? { requestId: (params as any).requestId } : {}) });
            }
          },
        }));
      }, { names: TOOLS.map(t => t.name) });
      api.registerService({ id: "rocket-money-mcp", start() {}, stop: close });
    },
  };
}

export default createPlugin();
