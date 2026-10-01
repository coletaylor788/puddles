import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, existsSync, writeFileSync, fsyncSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

export const names = ["rocket_money_read", "rocket_money_write", "weather_curl"] as const;
type Name = typeof names[number];
type Config = { cliPath: string; configPath: string; invocationStateDir: string };
const MAX_INPUT = 1024 * 1024;
const MAX_OUTPUT = 48 * 1024 * 1024;
const EXEC_TIMEOUT = 180_000;
const active = new Map<string, number>();

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INVALID_REQUEST");
  return value as Record<string, any>;
}
function exact(value: Record<string, any>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k))) fail("INVALID_REQUEST");
}

function protectedPath(path: string) {
  if (!isAbsolute(path)) fail("UNSAFE_CONFIG");
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || ((stat.mode & 0o022) && !(stat.mode & 0o1000))) fail("UNSAFE_CONFIG");
    if (current === dirname(current)) break;
  }
}

function jsonFile(path: string) {
  protectedPath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536 || ![0, process.getuid?.()].includes(stat.uid)) fail("UNSAFE_CONFIG");
    return record(JSON.parse(readFileSync(fd, "utf8")));
  } finally { closeSync(fd); }
}

function settings(api: OpenClawPluginApi, ctx: OpenClawPluginToolContext): Config {
  const current = ctx.getRuntimeConfig ? ctx.getRuntimeConfig() : ctx.runtimeConfig ?? ctx.config ?? api.config;
  const raw = current?.plugins?.entries?.["cli-gateway"];
  if (raw?.enabled === false) fail("POLICY_DENIED");
  const cfg = record(raw?.config ?? api.pluginConfig);
  exact(cfg, ["cliPath", "configPath", "invocationStateDir"]);
  for (const name of ["cliPath", "configPath", "invocationStateDir"]) {
    if (typeof cfg[name] !== "string" || !isAbsolute(cfg[name])) fail("UNSAFE_CONFIG");
  }
  protectedPath(cfg.cliPath);
  protectedPath(cfg.invocationStateDir);
  const state = lstatSync(cfg.invocationStateDir);
  if (state.mode & 0o077 || state.uid !== process.getuid?.()) fail("UNSAFE_CONFIG");
  return cfg as Config;
}

function granted(config: Config, agent: string, name: Name) {
  const policy = jsonFile(config.configPath);
  if (policy.version !== 1 || !Array.isArray(policy.agents?.[agent]?.tools) || !policy.agents[agent].tools.includes(name)) fail("POLICY_DENIED");
}

function requestId(config: Config, agent: string, session: string, callId: string, input: string) {
  if (!callId) fail("INVALID_CALL_ID");
  const key = createHash("sha256").update(`${agent}\0${session}\0${callId}`).digest("hex");
  const fingerprint = createHash("sha256").update(input).digest("hex");
  const path = join(config.invocationStateDir, `${key}.json`);
  if (!existsSync(path) && readdirSync(config.invocationStateDir).length >= 10000) fail("STATE_CAPACITY_REACHED");
  const id = randomUUID();
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ id, fingerprint })); fsyncSync(fd); }
    finally { closeSync(fd); }
    const parent = openSync(config.invocationStateDir, constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return id;
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    const old = jsonFile(path);
    if (old.fingerprint !== fingerprint || typeof old.id !== "string") fail("REQUEST_ID_CONFLICT");
    return old.id;
  }
}

export function runCli(config: Config, agent: string, name: Name, input: string, id: string | undefined, signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) { reject(new Error("CANCELLED")); return; }
    const args = ["--config", config.configPath, "--agent", agent, "--tool", name];
    if (id) args.push("--request-id", id);
    const child = spawn(config.cliPath, args, {
      shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME, LANG: "en_US.UTF-8" },
      cwd: config.invocationStateDir,
    });
    const output: Buffer[] = []; let size = 0; let stderr = ""; let done = false; let failure: string | undefined;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } } };
    const abort = () => { failure = "CANCELLED"; kill(); };
    const timer = setTimeout(() => { failure = "LIMIT_EXCEEDED"; kill(); }, EXEC_TIMEOUT);
    signal?.addEventListener("abort", abort, { once: true });
    function finish(error?: string, text?: string) {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(new Error(error)); else resolvePromise(text ?? "");
    }
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > MAX_OUTPUT) { failure = "LIMIT_EXCEEDED"; kill(); } else output.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length + data.length > 65536) { failure = "LIMIT_EXCEEDED"; kill(); } else stderr += data.toString("utf8");
    });
    child.on("error", () => { kill(); finish("CLI_UNAVAILABLE"); });
    child.on("close", (code) => {
      kill();
      if (failure) { finish(id ? `OUTCOME_UNKNOWN requestId=${id}` : failure); return; }
      if (code !== 0) {
        // Only known structured codes survive; never return Python/curl exception text.
        let reason = "CLI_FAILED";
        try {
          const value = JSON.parse(stderr).gateway_error;
          if (value && /^[A-Z_]{1,48}$/.test(value.code)) reason = value.code;
        } catch { /* untrusted or malformed stderr */ }
        finish(`${reason}${id ? ` requestId=${id}` : ""}`); return;
      }
      const text = Buffer.concat(output).toString("utf8");
      try { JSON.parse(text); } catch { finish(id ? `OUTCOME_UNKNOWN requestId=${id}` : "INVALID_CLI_RESPONSE"); return; }
      finish(undefined, text);
    });
    child.stdin.on("error", () => { /* close/error handlers own the final outcome */ });
    child.stdin.end(input);
  });
}

const modes: Record<Name, string[]> = {
  rocket_money_read: ["help", "catalog", "graphql", "batch", "paginate", "status", "operation_status"],
  rocket_money_write: ["help", "graphql", "batch"], weather_curl: ["help", "curl"],
};

function parameters(name: Name) {
  const envelope = { type: "object", additionalProperties: false, required: ["query"], properties: {
    query: { type: "string" }, variables: { type: "object" }, operationName: { type: "string" },
  } };
  return { type: "object", additionalProperties: false, required: ["mode"], properties: {
    mode: { type: "string", enum: modes[name] },
    ...(name === "weather_curl" ? { argv: { type: "array", items: { type: "string" } }, stdin: { type: "string" } } : {
      request: envelope, requests: { type: "array", maxItems: 20, items: envelope },
      ...(name === "rocket_money_write" ? { expected: { description: "Current date or transactionCategoryNodeId; array for batch.", anyOf: [{ type: "object" }, { type: "array", items: { type: "object" } }] } } : {
        requestId: { type: "string" }, path: { type: "array", items: { type: "string" } }, cursorVariable: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 20 },
      }),
    }),
  } } as AnyAgentTool["parameters"];
}

export default {
  id: "cli-gateway", name: "Puddles CLI integrations",
  register(api: OpenClawPluginApi) {
    api.registerTool((ctx: OpenClawPluginToolContext) => {
      const agent = ctx.agentId;
      if (!agent) return [];
      const config = settings(api, ctx);
      return names.flatMap(name => {
        try { granted(config, agent, name); } catch { return []; }
        return [{
          name, label: name,
          description: name === "weather_curl" ? "Run native curl HTTP requests to wttr.in/wttr.is. Use mode=help for supported options. Host paths, redirects and arbitrary destinations are denied."
            : `${name === "rocket_money_read" ? "Read native Rocket Money GraphQL, filters, batches, pagination and status." : "Change only a transaction category or date using native GraphQL. Requires expected current values; propagation must be false."} Use mode=help or the Rocket Money skill.`,
          parameters: parameters(name),
          async execute(callId: string, value: unknown, signal?: AbortSignal) {
            const cfg = settings(api, ctx); granted(cfg, agent, name);
            const input = record(value); const schema = parameters(name) as any;
            exact(input, Object.keys(schema.properties));
            if (!modes[name].includes(input.mode)) fail("POLICY_DENIED");
            const serialized = JSON.stringify(input);
            if (Buffer.byteLength(serialized) > MAX_INPUT) fail("LIMIT_EXCEEDED");
            const key = `${agent}:${name}`;
            if ((active.get(key) ?? 0) >= 2) fail("BUSY");
            const id = name === "rocket_money_write" && input.mode !== "help" ? requestId(cfg, agent, ctx.sessionKey ?? "", callId, serialized) : undefined;
            active.set(key, (active.get(key) ?? 0) + 1);
            try {
              const text = await runCli(cfg, agent, name, serialized, id, signal);
              return { content: [{ type: "text" as const, text }], details: id ? { requestId: id } : undefined };
            } finally { active.set(key, (active.get(key) ?? 1) - 1); }
          },
        } satisfies AnyAgentTool];
      });
    }, { names: [...names], optional: true });
  },
};
