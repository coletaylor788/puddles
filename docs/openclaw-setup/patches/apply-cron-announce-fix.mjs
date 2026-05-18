#!/usr/bin/env node
// Applies the 4-change cron+subagent announce-delivery fix to an OpenClaw dist directory.
//
// Background: see ../_DRAFT_openclaw-bug-report.md (and the upstream issue once filed).
//
// Verified against OpenClaw 2026.4.20. The patcher locates files by content signatures
// (not by hash-suffixed filenames) so it tolerates rebuilds within the same release.
// If signatures stop matching after an upstream version bump, the patcher will fail
// loudly with the unmatched signature, and you can either:
//   - update the FIND/REPLACE pairs below to match the new structure, or
//   - confirm upstream has merged the fix and skip the patcher.
//
// Idempotent: each change embeds a `FIX4-Cn` marker; re-running on already-patched
// files is a no-op.
//
// Usage:
//   node apply-cron-announce-fix.mjs <openclaw-dist-dir>
//
// Recommended on a fresh OpenClaw upgrade:
//   1. Stop or restart-pause the gateway
//   2. Run this against /path/to/openclaw/dist/
//   3. Mirror patched files into ~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/
//   4. Clear ~/.openclaw/tmp/node-compile-cache/
//   5. Restart the gateway
// See ./README.md for the end-to-end procedure on a Mac mini host.

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = process.argv[2];
if (!distDir) { console.error("usage: node apply-cron-announce-fix.mjs <openclaw-dist-dir>"); process.exit(2); }
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) { console.error(`not a directory: ${distDir}`); process.exit(2); }

// Each change locates its target file by a content signature unique to that file in
// stock OpenClaw. If a signature matches multiple files we abort (ambiguous discovery).
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
  if (!existsSync(path + ".bak.fix4")) copyFileSync(path, path + ".bak.fix4");
  writeFileSync(path, body);
  console.log(`  wrote ${name} (${body.length} bytes)`);
}
function require1(s, find, label) {
  const idx = s.indexOf(find);
  if (idx < 0) throw new Error(`[${label}] pattern not found:\n${find.slice(0,200)}`);
  if (s.indexOf(find, idx + 1) >= 0) throw new Error(`[${label}] pattern not unique:\n${find.slice(0,200)}`);
}

// ---------- Change 1A: subagent-announce — drop isCronSessionKey from internal-session predicate ----------
{
  // Stable signature (unique to this file, present in both pre- and post-patch versions).
  const f = findFileBySignature(
    "let requesterIsSubagent = requesterIsInternalSession();",
    "subagent-announce-*.js");
  console.log(`Change 1A → ${f}`);
  let s = load(f);
  const find = "const requesterIsInternalSession = () => requesterDepth >= 1 || isCronSessionKey(targetRequesterSessionKey);";
  const repl = "const requesterIsInternalSession = () => requesterDepth >= 1; /*FIX4-C1A:dropped-isCronSessionKey*/";
  if (s.includes(repl)) console.log("  already applied, skipping");
  else { require1(s, find, "C1A"); s = s.replace(find, repl); save(f, s); }
}

// ---------- Change 1B + 3B: subagent-announce-delivery — drop predicate; gate deliveryTarget on cronRunnerDeliveryEnabled ----------
{
  // Stable signature: function declaration line is preserved across patches (only the body is changed).
  const f = findFileBySignature(
    "function isInternalAnnounceRequesterSession(sessionKey) {",
    "subagent-announce-delivery-*.js");
  console.log(`Change 1B+3B → ${f}`);
  let s = load(f);

  // 1B: drop isCronSessionKey from internal-session predicate
  const find1B = "function isInternalAnnounceRequesterSession(sessionKey) {\n\treturn getSubagentDepthFromSessionStore(sessionKey) >= 1 || isCronSessionKey(sessionKey);\n}";
  const repl1B = "function isInternalAnnounceRequesterSession(sessionKey) {\n\treturn getSubagentDepthFromSessionStore(sessionKey) >= 1; /*FIX4-C1B*/\n}";
  if (s.includes(repl1B)) console.log("  1B already applied");
  else { require1(s, find1B, "C1B"); s = s.replace(find1B, repl1B); }

  // 3B: gate deliveryTarget + sessionOnlyOriginChannel on cronRunnerDeliveryEnabled
  const find3B =
`		const deliveryTarget = !params.requesterIsSubagent ? resolveExternalBestEffortDeliveryTarget({
			channel: effectiveDirectOrigin?.channel,
			to: effectiveDirectOrigin?.to,
			accountId: effectiveDirectOrigin?.accountId,
			threadId: effectiveDirectOrigin?.threadId
		}) : { deliver: false };
		const normalizedSessionOnlyOriginChannel = !params.requesterIsSubagent ? normalizeMessageChannel(sessionOnlyOrigin?.channel) : void 0;`;
  const repl3B =
`		/*FIX4-C3B:gate-on-cronRunnerDeliveryEnabled-start*/
		const __c3b_requesterEntryForGate = loadRequesterSessionEntry(params.targetRequesterSessionKey).entry;
		const __c3b_isCronWithoutRunnerDelivery = isCronSessionKey(params.targetRequesterSessionKey) && __c3b_requesterEntryForGate?.cronRunnerDeliveryEnabled !== true;
		const __c3b_canDeliver = !params.requesterIsSubagent && !__c3b_isCronWithoutRunnerDelivery;
		/*FIX4-C3B:gate-on-cronRunnerDeliveryEnabled-end*/
		const deliveryTarget = __c3b_canDeliver ? resolveExternalBestEffortDeliveryTarget({
			channel: effectiveDirectOrigin?.channel,
			to: effectiveDirectOrigin?.to,
			accountId: effectiveDirectOrigin?.accountId,
			threadId: effectiveDirectOrigin?.threadId
		}) : { deliver: false };
		const normalizedSessionOnlyOriginChannel = __c3b_canDeliver ? normalizeMessageChannel(sessionOnlyOrigin?.channel) : void 0;`;
  if (s.includes("FIX4-C3B")) console.log("  3B already applied");
  else { require1(s, find3B, "C3B"); s = s.replace(find3B, repl3B); }

  save(f, s);
}

// ---------- Change 2: run-delivery.runtime — finalizeTextDelivery defers when descendants are active ----------
{
  // Stable signature: function name is unique to this file.
  const f = findFileBySignature(
    "async function dispatchCronDelivery(params) {",
    "run-delivery.runtime-*.js");
  console.log(`Change 2 → ${f}`);
  let s = load(f);
  const find =
`	const finalizeTextDelivery = async (delivery) => {
		if (!synthesizedText) return null;
		const initialSynthesizedText = synthesizedText.trim();`;
  const repl =
`	const finalizeTextDelivery = async (delivery) => {
		if (!synthesizedText) return null;
		/*FIX4-C2:defer-when-descendants-active-start*/
		const __c2_subagentRegistryRuntime = await loadDeliverySubagentRegistryRuntime();
		if (__c2_subagentRegistryRuntime.countActiveDescendantRuns(params.agentSessionKey) > 0) {
			deliveryAttempted = true;
			return params.withRunSession({
				status: "ok",
				summary,
				outputText,
				delivered: false,
				deliveryAttempted,
				...params.telemetry
			});
		}
		/*FIX4-C2:defer-when-descendants-active-end*/
		const initialSynthesizedText = synthesizedText.trim();`;
  if (s.includes("FIX4-C2")) console.log("  already applied");
  else { require1(s, find, "C2"); s = s.replace(find, repl); save(f, s); }
}

// ---------- Change 3A: server.impl — persist cronRunnerDeliveryEnabled on the cron session entry ----------
{
  // Stable signature: this exact assignment line is preserved across patches (we insert AFTER it).
  const f = findFileBySignature(
    "if (!cronSession.sessionEntry.sessionFile?.trim()) cronSession.sessionEntry.sessionFile = resolveSessionTranscriptPath(runSessionId, agentId);",
    "server.impl-*.js");
  console.log(`Change 3A → ${f}`);
  let s = load(f);
  const find = "if (!cronSession.sessionEntry.sessionFile?.trim()) cronSession.sessionEntry.sessionFile = resolveSessionTranscriptPath(runSessionId, agentId);";
  const repl = find + "\n\t/*FIX4-C3A:persist-cronRunnerDeliveryEnabled*/\n\tcronSession.sessionEntry.cronRunnerDeliveryEnabled = input.job.delivery?.mode === \"announce\";";
  if (s.includes("FIX4-C3A")) console.log("  already applied");
  else { require1(s, find, "C3A"); s = s.replace(find, repl); save(f, s); }
}

// ---------- Change 4: delivery.runtime — dedup deliverAgentCommandResult against messagingToolSentTargets ----------
{
  // Stable signature: function declaration is unique to this file and preserved across patches.
  const f = findFileBySignature(
    "async function deliverAgentCommandResult(params) {",
    "delivery.runtime-*.js");
  console.log(`Change 4 → ${f}`);
  let s = load(f);

  // Add a lazy import helper for matchesMessagingToolDeliveryTarget (avoids any
  // static circular import risk between delivery.runtime and run-delivery.runtime).
  // Discover the run-delivery.runtime file by the same signature used in Change 2.
  const runDeliveryFile = findFileBySignature(
    "async function dispatchCronDelivery(params) {",
    "run-delivery.runtime-*.js");
  const importBlockEndAnchor = `import { n as resolveAgentOutboundTarget, t as resolveAgentDeliveryPlan } from "./agent-delivery-`;
  const lazyHelperMarker = "/*FIX4-C4:lazy-matches-helper*/";
  if (!s.includes(lazyHelperMarker)) {
    const idx = s.indexOf(importBlockEndAnchor);
    if (idx < 0) throw new Error("[C4] could not find import anchor for lazy-helper insertion");
    const lineEnd = s.indexOf("\n", idx);
    if (lineEnd < 0) throw new Error("[C4] truncated import line");
    const before = s.slice(0, lineEnd + 1);
    const after = s.slice(lineEnd + 1);
    const helper = `${lazyHelperMarker}\nlet __c4_matchesMessagingToolDeliveryTarget;\nasync function __c4_loadMatcher() {\n\tif (__c4_matchesMessagingToolDeliveryTarget) return __c4_matchesMessagingToolDeliveryTarget;\n\tconst mod = await import("./${runDeliveryFile}");\n\t__c4_matchesMessagingToolDeliveryTarget = mod.matchesMessagingToolDeliveryTarget;\n\treturn __c4_matchesMessagingToolDeliveryTarget;\n}\n`;
    s = before + helper + after;
  }

  // Wrap delivery branch with dedup guard
  // Note: the inner call has historically been either deliverOutboundPayloads or sendDurableMessageBatch
  // depending on OpenClaw version. The outer guard line is the stable anchor.
  const find =
`	if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel)) {
		if (deliveryTarget`;
  const repl =
`	/*FIX4-C4:messaging-tool-dedup-start*/
	let __c4_messagingToolMatched = false;
	if (deliver && deliveryChannel && deliveryTarget && !isInternalMessageChannel(deliveryChannel) && result?.didSendViaMessagingTool === true && Array.isArray(result?.messagingToolSentTargets) && result.messagingToolSentTargets.length > 0) {
		const __c4_match = await __c4_loadMatcher();
		__c4_messagingToolMatched = result.messagingToolSentTargets.some((t) => __c4_match(t, { channel: deliveryChannel, to: deliveryTarget, accountId: resolvedAccountId }));
	}
	/*FIX4-C4:messaging-tool-dedup-end*/
	if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel) && !__c4_messagingToolMatched) {
		if (deliveryTarget`;
  if (s.includes("FIX4-C4:messaging-tool-dedup-start")) console.log("  already applied");
  else { require1(s, find, "C4"); s = s.replace(find, repl); }
  save(f, s);
}

console.log("\nAll patches applied successfully.");
console.log("Next steps:");
console.log("  1. Mirror patched files into ~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/");
console.log("  2. rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*");
console.log("  3. Restart the gateway (e.g. launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway)");
