import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG } from "./config.js";
import { parseJsonLoose } from "./util.js";

const execFileP = promisify(execFile);

/**
 * A clean environment for the `openclaw` child process. Vitest workers inject
 * `NODE_OPTIONS` (loader hooks), `VITEST_*`, and `NODE_V8_COVERAGE` into
 * `process.env`; if those leak into the spawned `openclaw` node CLI they corrupt
 * its startup and it emits NOTHING on stdout. Strip them and fix PATH so the
 * gateway CLI + node@22 resolve.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_OPTIONS" || k === "NODE_V8_COVERAGE" || k.startsWith("VITEST")) continue;
    env[k] = v;
  }
  env.PATH = `${process.env.HOME}/.npm-global/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`;
  return env;
}

let seq = 0;
/** A unique, test-scoped session key: `e2e:<runId>:<agent>:<n>[:<label>]`. */
export function freshSessionKey(agent: string, label?: string): string {
  seq += 1;
  const base = `e2e:${CONFIG.runId}:${agent}:${seq}`;
  return label ? `${base}:${label.replace(/[^a-zA-Z0-9_-]+/g, "-")}` : base;
}

export interface Payload {
  text: string | null;
  mediaUrl: string | null;
}

export interface AgentResult {
  /** Gateway status, e.g. "ok". */
  status: string;
  /** Run summary, e.g. "completed". */
  summary: string;
  runId?: string;
  /** The delivered reply text (payloads joined) — what the user would see. */
  reply: string;
  /** meta.finalAssistantVisibleText (falls back to `reply`). */
  visibleText: string;
  payloads: Payload[];
  /** result.meta — executionTrace, completion, stopReason, agentMeta, etc. */
  meta: any;
  /** Winning model id from executionTrace (for provider/model assertions). */
  model?: string;
  /** Winning provider id from executionTrace. */
  provider?: string;
  /** Full parsed --json envelope. */
  raw: any;
  /** The session key used (for trajectory/tool-call reads + cleanup). */
  sessionKey: string;
  /** The agent driven (or "routed" when binding routing decided). */
  agent: string;
  /** The agent that actually handled the turn (from meta.agentMeta) — for routing tests. */
  agentId?: string;
}

export interface RunAgentOpts {
  /** Agent to drive. `null` omits `--agent` so channel+to binding routing decides (routing tests). */
  agent?: string | null;
  model?: string;
  sessionKey?: string;
  /** Simulate an inbound message on a channel (exercises real binding routing). */
  channel?: string;
  /** Sender/recipient E.164 for routing tests (e.g. "+15555550123"). */
  to?: string;
  thinking?: "off" | "low" | "medium" | "high";
  timeoutMs?: number;
  /** Extra raw CLI args appended to `openclaw ... agent ...`. */
  extraArgs?: string[];
}

/**
 * Drive one real agent turn through the (live) gateway and return the parsed
 * result. Never passes `--deliver`, so no message is actually sent to a channel;
 * the turn still runs fully (tools execute), so tests that trigger write-tools
 * must use marked test data + clean up.
 */
export async function runAgent(message: string, opts: RunAgentOpts = {}): Promise<AgentResult> {
  const routing = opts.agent === null;
  const agent = routing ? "routed" : (opts.agent ?? CONFIG.defaultAgent);
  const model = opts.model ?? CONFIG.model;
  const sessionKey = opts.sessionKey ?? freshSessionKey(agent);
  const args = [...CONFIG.profileArgs, "agent"];
  if (!routing) args.push("--agent", agent);
  args.push("--model", model, "--session-key", sessionKey, "--message", message, "--json");
  if (opts.channel) args.push("--channel", opts.channel);
  if (opts.to) args.push("--to", opts.to);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const { stdout } = await execFileP(CONFIG.openclawBin, args, {
    maxBuffer: 128 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 170_000,
    env: childEnv(),
  });

  const raw = parseJsonLoose(stdout);
  if (!raw) {
    throw new Error(`openclaw agent returned unparseable JSON (first 300 chars): ${stdout.slice(0, 300)}`);
  }
  const payloads: Payload[] = raw?.result?.payloads ?? [];
  const reply = payloads
    .map((p) => p?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
  const meta = raw?.result?.meta ?? {};
  return {
    status: raw?.status,
    summary: raw?.summary,
    runId: raw?.runId,
    reply,
    visibleText: (meta?.finalAssistantVisibleText ?? reply) || reply,
    payloads,
    meta,
    agentId: meta?.agentMeta?.agentId ?? meta?.agentMeta?.id,
    model: meta?.executionTrace?.winnerModel,
    provider: meta?.executionTrace?.winnerProvider,
    raw,
    sessionKey,
    agent,
  };
}

export interface ToolCall {
  name: string;
  input?: any;
  output?: any;
  ok?: boolean;
  raw: any;
}

/** Resolve the internal sessionId for a session key from the agent's sessions index. */
export async function findSessionId(agent: string, sessionKey: string): Promise<string | undefined> {
  const p = join(CONFIG.stateDir, "agents", agent, "sessions", "sessions.json");
  let idx: any;
  try {
    idx = JSON.parse(await readFile(p, "utf8"));
  } catch {
    return undefined;
  }
  // openclaw stores keys prefixed as `agent:<agentId>:<sessionKey>`; try that then the raw form.
  const candidates = [`agent:${agent}:${sessionKey}`, sessionKey];
  const container = idx?.sessions ?? idx;
  for (const key of candidates) {
    const direct = container?.[key];
    if (direct) return direct.sessionId ?? direct.id ?? (typeof direct === "string" ? direct : undefined);
  }
  if (container && typeof container === "object") {
    for (const [k, v] of Object.entries<any>(container)) {
      if (candidates.includes(k) || (v && typeof v === "object" && (v.sessionKey === sessionKey || v.key === sessionKey))) {
        return v?.sessionId ?? v?.id;
      }
    }
  }
  return undefined;
}

/**
 * Read the tool calls the agent made in a given session, from its
 * `<sessionId>.trajectory.jsonl`. Shape-tolerant: matches entries that look like
 * tool calls across a few possible field namings. (Verified/tightened against
 * real trajectories in the integration tests.)
 */
export async function readToolCalls(agent: string, sessionKey: string): Promise<ToolCall[]> {
  const sid = await findSessionId(agent, sessionKey);
  if (!sid) return [];
  const p = join(CONFIG.stateDir, "agents", agent, "sessions", `${sid}.trajectory.jsonl`);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch {
    return [];
  }
  const calls: ToolCall[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const name = e.toolName ?? e.tool ?? e?.toolCall?.name ?? (String(e.type ?? "").includes("tool") ? e.name : undefined);
    if (!name) continue;
    calls.push({
      name,
      input: e.input ?? e.args ?? e?.toolCall?.input ?? e?.toolCall?.arguments,
      output: e.output ?? e.result ?? e?.toolResult,
      ok: e.ok ?? e.success,
      raw: e,
    });
  }
  return calls;
}

/** True if the session called a tool whose name matches `name` (string or regex). */
export async function calledTool(agent: string, sessionKey: string, name: string | RegExp): Promise<boolean> {
  const calls = await readToolCalls(agent, sessionKey);
  return calls.some((c) => (typeof name === "string" ? c.name === name : name.test(c.name)));
}

/** Coerce a timestamp (ISO string or epoch ms/number) to epoch ms. */
export function tsMs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    if (!Number.isNaN(n)) return n;
    const asNum = Number(v);
    if (!Number.isNaN(asNum)) return asNum;
  }
  return 0;
}

export interface AuditReadOpts {
  /** Only entries with timestamp >= sinceMs. */
  sinceMs?: number;
  /** Only entries whose toolName matches (string or regex). */
  tool?: string | RegExp;
  /** Keep only the last N (after filtering). */
  tail?: number;
}

/**
 * Read a plugin audit log (JSONL) under the state dir's logs/ dir, optionally
 * filtered by timestamp (correlate to a test call) and/or tool name. Entries look
 * like `{timestamp, toolName, hookName, phase, action, contentLen}`.
 */
export async function readAuditLog(file: string, opts: AuditReadOpts = {}): Promise<any[]> {
  const p = join(CONFIG.stateDir, "logs", file);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch {
    return [];
  }
  let entries = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean) as any[];
  if (opts.sinceMs != null) {
    entries = entries.filter((e) => tsMs(e.timestamp ?? e.ts) >= opts.sinceMs!);
  }
  if (opts.tool != null) {
    const t = opts.tool;
    entries = entries.filter((e) =>
      typeof t === "string" ? e.toolName === t : t.test(String(e.toolName ?? "")),
    );
  }
  if (opts.tail) entries = entries.slice(-opts.tail);
  return entries;
}

/** Current time as epoch ms (capture BEFORE a call to scope audit reads). */
export function now(): number {
  return Date.now();
}

/** Read the gateway's routing bindings (`openclaw agents bindings --json`). */
export async function getBindings(): Promise<any[]> {
  const { stdout } = await execFileP(
    CONFIG.openclawBin,
    [...CONFIG.profileArgs, "agents", "bindings", "--json"],
    { maxBuffer: 16 * 1024 * 1024, timeout: 60_000, env: childEnv() },
  );
  return parseJsonLoose(stdout) ?? [];
}

/** List configured agent ids (`openclaw agents list --json`), best-effort. */
export async function listAgents(): Promise<any[]> {
  try {
    const { stdout } = await execFileP(
      CONFIG.openclawBin,
      [...CONFIG.profileArgs, "agents", "list", "--json"],
      { maxBuffer: 16 * 1024 * 1024, timeout: 60_000, env: childEnv() },
    );
    return parseJsonLoose(stdout) ?? [];
  } catch {
    return [];
  }
}
