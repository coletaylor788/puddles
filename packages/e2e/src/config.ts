import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export interface E2EConfig {
  /** Absolute path to the openclaw CLI (mini: ~/.npm-global/bin/openclaw). */
  openclawBin: string;
  /** provider/model id for the system-under-test agent. REQUIRED (never hardcoded here — keeps this package provider-neutral). */
  model: string;
  /** provider/model id for the LLM judge (defaults to `model`). */
  judgeModel: string;
  /** Default agent to drive when a test doesn't specify one. */
  defaultAgent: string;
  /** Agent used to run the gateway-mediated LLM judge. */
  judgeAgent: string;
  /**
   * A read-only agent that has NO message/write/PIM-write tools, so driving it
   * can never text anyone or create/modify anything (guaranteed non-interference).
   * On this deployment `reader` has calendar_read + gmail read + web_fetch.
   */
  readAgent: string;
  /** A read-only agent that additionally has web_search (no message/write). */
  webAgent: string;
  /** OpenClaw state dir to read sessions/trajectories/audit-logs from. */
  stateDir: string;
  /** Extra root CLI args for an isolated profile (e.g. ["--dev"]); [] for the live instance. */
  profileArgs: string[];
  /** Owner E.164 for owner-context tests, injected via E2E_OWNER_NUMBER (no PII in this repo). */
  ownerNumber: string;
  /** Unique-ish id for this test run; used to scope + clean up session keys. */
  runId: string;
}

const profile = env("E2E_PROFILE"); // "" = live gateway; "dev" = isolated --dev; other = --profile <name>
const home = env("OPENCLAW_HOME", homedir());
const stateDir = env(
  "OPENCLAW_STATE_DIR",
  profile ? join(home, `.openclaw-${profile}`) : join(home, ".openclaw"),
);

const profileArgs = profile === "" ? [] : profile === "dev" ? ["--dev"] : ["--profile", profile];

export const CONFIG: E2EConfig = {
  openclawBin: env("OPENCLAW_BIN", join(home, ".npm-global/bin/openclaw")),
  model: env("E2E_MODEL"),
  judgeModel: env("E2E_JUDGE_MODEL", env("E2E_MODEL")),
  defaultAgent: env("E2E_AGENT", "main"),
  judgeAgent: env("E2E_JUDGE_AGENT", "debug"),
  readAgent: env("E2E_READ_AGENT", "reader"),
  webAgent: env("E2E_WEB_AGENT", "household-reader"),
  stateDir,
  profileArgs,
  ownerNumber: env("E2E_OWNER_NUMBER"),
  runId: randomUUID(),
};

/**
 * The live suite is gated on E2E_MODEL being set. This keeps the public package
 * provider-neutral (the runner injects the provider/model id) and mirrors the
 * repo convention of gating live specs on an env var so `pnpm -r test` stays
 * offline. Specs use `describeE2E` (below) which becomes `describe.skip` when unset.
 */
export const E2E_ENABLED = CONFIG.model !== "";
