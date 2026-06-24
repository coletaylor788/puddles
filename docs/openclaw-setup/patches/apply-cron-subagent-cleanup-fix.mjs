#!/usr/bin/env node
// Applies the isolated-cron + subagent wake race fix to an OpenClaw dist directory.
//
// Background: see ./cron-subagent-cleanup-fix.md for full design.
//
// Summary: wraps `cleanupDirectCronSession` so it defers `sessions.delete()` while
// active descendant subagent runs are still in flight for the cron session, with a
// poll-and-backstop loop. This prevents the announce wake path from finding a
// deleted session and silently failing with "announce deferred or direct delivery
// failed" after 3 retries (openclaw/openclaw#46298 — Stephen closed as fixed but
// the underlying race is still present in 2026.6.1).
//
// Idempotent: skip if FIX-CRON-SUBAGENT-CLEANUP-DEFER marker is already present.
// Writes a `.bak.cron-subagent-cleanup` backup on first apply.
//
// Usage:
//   node apply-cron-subagent-cleanup-fix.mjs <openclaw-dist-dir>
//
// Verified against: 2026.6.1 (design; runtime validation pending).
// See ./README.md for the end-to-end mini-deploy procedure.

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = process.argv[2];
if (!distDir) { console.error("usage: node apply-cron-subagent-cleanup-fix.mjs <openclaw-dist-dir>"); process.exit(2); }
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) { console.error(`not a directory: ${distDir}`); process.exit(2); }

// Locate the file by a content signature unique to it in stock OpenClaw.
function findFileBySignature(signature, hint) {
  const matches = [];
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith(".js")) continue;
    const path = join(distDir, name);
    try {
      if (readFileSync(path, "utf8").includes(signature)) matches.push(name);
    } catch {}
  }
  if (matches.length === 0) throw new Error(`no .js file in ${distDir} contains signature: ${signature}\n(hint: stock file is roughly ${hint})`);
  if (matches.length > 1) throw new Error(`signature is ambiguous across files: ${matches.join(", ")}\n  signature: ${signature}`);
  return matches[0];
}

function load(name) { return readFileSync(join(distDir, name), "utf8"); }
function save(name, body) {
  const path = join(distDir, name);
  if (!existsSync(path + ".bak.cron-subagent-cleanup")) copyFileSync(path, path + ".bak.cron-subagent-cleanup");
  writeFileSync(path, body);
  console.log(`  wrote ${name} (${body.length} bytes)`);
}
function require1(s, find, label) {
  const idx = s.indexOf(find);
  if (idx < 0) throw new Error(`[${label}] pattern not found:\n${find.slice(0,200)}`);
  if (s.indexOf(find, idx + 1) >= 0) throw new Error(`[${label}] pattern not unique:\n${find.slice(0,200)}`);
}

const MARKER = "FIX-CRON-SUBAGENT-CLEANUP-DEFER";

// ---------- The fix: wrap cleanupDirectCronSession with a defer guard ----------
{
  // Stable signature: the function declaration line is preserved across patches.
  // run-delivery.runtime-<hash>.js is the host file.
  const f = findFileBySignature(
    "async function cleanupDirectCronSession(params) {",
    "run-delivery.runtime-*.js");
  console.log(`Wrap → ${f}`);
  let s = load(f);

  if (s.includes(MARKER)) {
    console.log("  already applied, skipping");
  } else {
    // The defer guard is inserted AFTER the function's two early-return guards
    //   (`if (!params.job.deleteAfterRun) return;` and `if (!isCronSessionKey(...)) return;`)
    // so it only runs when this call would actually `sessions.delete()` a cron
    // session. It:
    //   - Asks the subagent registry for active descendant runs on this session
    //   - If any, schedules a 2s poll loop with a 150s backstop, and returns early
    //   - The polled re-entry sets `_deferRoot: true` to bypass the guard (no recursion)
    //   - If the registry can't be consulted (e.g. import fails), falls through to
    //     the original cleanup path so we don't worsen behavior on weird states.
    //
    // Why this is safe:
    //   - Zero overhead for non-deleting calls (recurring crons, non-cron sessions
    //     return at the deleteAfterRun / isCronSessionKey guards above the insert)
    //   - Zero behavior change when activeRuns === 0 (the common case)
    //   - `params.agentSessionKey` is guaranteed present here (the guards above use it)
    //   - Deferred branch fires sessions.delete() exactly once on the success path
    //   - Backstop guarantees cleanup eventually runs (avoids session-store leak)
    //   - Covers BOTH the interim-text race (via deliverViaDirectAndCleanup) AND the
    //     silent-yield race (via finishSilentReplyDelivery) — both funnel through this
    //     single function.
    const find =
`async function cleanupDirectCronSession(params) {
	if (!params.job.deleteAfterRun) return;
	if (!isCronSessionKey(params.agentSessionKey)) return;
`;
    const guard =
`async function cleanupDirectCronSession(params) {
	if (!params.job.deleteAfterRun) return;
	if (!isCronSessionKey(params.agentSessionKey)) return;
	/*${MARKER}:start*/
	if (params._deferRoot !== true) {
		try {
			const __c_subagentRegistry = await loadDeliverySubagentRegistryRuntime();
			const __c_activeRuns = typeof __c_subagentRegistry.countActiveDescendantRuns === "function"
				? __c_subagentRegistry.countActiveDescendantRuns(params.agentSessionKey)
				: 0;
			if (__c_activeRuns > 0) {
				const __c_backstopMs = 150000;
				const __c_startedAt = Date.now();
				const __c_pollIntervalMs = 2000;
				const __c_deferredParams = { ...params, _deferRoot: true };
				const __c_tryCleanup = async () => {
					try {
						const __c_stillActive = typeof __c_subagentRegistry.countActiveDescendantRuns === "function"
							? __c_subagentRegistry.countActiveDescendantRuns(params.agentSessionKey)
							: 0;
						if (__c_stillActive === 0 || (Date.now() - __c_startedAt) >= __c_backstopMs) {
							await cleanupDirectCronSession(__c_deferredParams);
							return;
						}
						setTimeout(() => { __c_tryCleanup().catch(() => {}); }, __c_pollIntervalMs);
					} catch {
						if ((Date.now() - __c_startedAt) >= __c_backstopMs) {
							await cleanupDirectCronSession(__c_deferredParams).catch(() => {});
						} else {
							setTimeout(() => { __c_tryCleanup().catch(() => {}); }, __c_pollIntervalMs);
						}
					}
				};
				setTimeout(() => { __c_tryCleanup().catch(() => {}); }, __c_pollIntervalMs);
				return;
			}
		} catch {
			/* fall through to original cleanup on any guard error */
		}
	}
	/*${MARKER}:end*/
`;
    require1(s, find, "cleanup-defer-guard");
    s = s.replace(find, guard);
    save(f, s);
  }
}

console.log("\nPatch applied successfully.");
console.log("Next steps:");
console.log("  1. Mirror patched files into ~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/ if used");
console.log("  2. rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*");
console.log("  3. Restart the gateway (e.g. launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway)");
