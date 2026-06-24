#!/usr/bin/env node
// Patches an installed OpenClaw `dist/` so the `skill_workshop` tool is
// registered for sandboxed agents, not only un-sandboxed ones.
//
// Why this is needed:
//   OpenClaw 6.x's createOpenClawTools() gates skill_workshop on
//   `options?.sandboxed === false`:
//
//       ...options?.sandboxed ? [] : [createSkillWorkshopTool({...})]
//
//   So any agent with `sandbox.mode: "all"` (the secure default, and the
//   only sensible setting for an agent that handles untrusted inbound
//   messages) never sees the tool. Meanwhile, the same release made the
//   `skills/` directory a hardcoded read-only bind mount inside the
//   sandbox, with no user-config opt-out:
//
//       resolveReadOnlyWorkspaceSkillMounts(params)  →  always RO
//
//   Net effect: a sandboxed agent can neither directly edit a skill file
//   (RO mount) NOR author a proposal via skill_workshop (tool unavailable).
//   The "supported" skill-authoring path is dead for the only agent shape
//   that actually receives the messages that motivate skill updates.
//
//   `skill_workshop` itself does NOT bypass the sandbox FS. Its proposals
//   land in the gateway-side state dir (`~/.openclaw/skill-workshop/...`),
//   and `apply` writes through the gateway rather than via the sandbox
//   bind mount. So removing the gate is safe — it doesn't grant the
//   sandboxed agent any new direct-FS access. The whole tool is a
//   gateway-routed API.
//
// Mechanism: rewrite the conditional to always include the tool.
//
//   Before:  ...options?.sandboxed ? [] : [createSkillWorkshopTool({...})]
//   After:   .../* FIX-SKILL-WORKSHOP-IN-SANDBOX */ [createSkillWorkshopTool({...})]
//
//   The ternary is removed; the spread now unconditionally spreads the
//   single-tool array. All surrounding option wiring (workspaceDir,
//   sessionAgentId, skillWorkshopSessionKey, etc.) is already computed
//   above the gate regardless of sandbox state, so the tool factory has
//   everything it needs.
//
// Discovers the target file by content signature
// (`...options?.sandboxed ? [] : [createSkillWorkshopTool(`), not by
// hash-suffixed filename, so it tolerates rebuilds within the same release.
//
// Idempotent via the `FIX-SKILL-WORKSHOP-IN-SANDBOX` marker. Re-running
// on an already-patched dist is a no-op.
//
// Verified against OpenClaw 2026.6.1 (`dist/openclaw-tools-ChLzmhJi.js`).
//
// Usage:
//   node apply-skill-workshop-sandbox-fix.mjs <openclaw-dist-dir>
//
// See ./skill-workshop-sandbox-fix.md for the end-to-end procedure and
// the agent allowlist change required to actually surface the tool.

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = process.argv[2];
if (!distDir) {
  console.error("usage: node apply-skill-workshop-sandbox-fix.mjs <openclaw-dist-dir>");
  process.exit(2);
}
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`not a directory: ${distDir}`);
  process.exit(2);
}

const SIGNATURE = "...options?.sandboxed ? [] : [createSkillWorkshopTool(";
const FIND = "...options?.sandboxed ? [] : [createSkillWorkshopTool({";
const REPLACE = "/* FIX-SKILL-WORKSHOP-IN-SANDBOX */ ...[createSkillWorkshopTool({";
const MARKER = "FIX-SKILL-WORKSHOP-IN-SANDBOX";

function findFileBySignature(signature, hint) {
  const matches = [];
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith(".js")) continue;
    const path = join(distDir, name);
    try {
      if (readFileSync(path, "utf8").includes(signature)) matches.push(name);
    } catch {}
  }
  if (matches.length === 0) {
    throw new Error(
      `no .js file in ${distDir} contains signature: ${signature}\n(hint: stock file is roughly ${hint})`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `signature is ambiguous across files: ${matches.join(", ")}\n  signature: ${signature}`,
    );
  }
  return matches[0];
}

function alreadyPatched(name) {
  return readFileSync(join(distDir, name), "utf8").includes(MARKER);
}

function apply(name) {
  const path = join(distDir, name);
  const body = readFileSync(path, "utf8");
  const idx = body.indexOf(FIND);
  if (idx < 0) throw new Error(`pattern not found in ${name}:\n${FIND}`);
  if (body.indexOf(FIND, idx + 1) >= 0) throw new Error(`pattern not unique in ${name}:\n${FIND}`);
  const patched = body.replace(FIND, REPLACE);
  if (!existsSync(path + ".bak.skillworkshop")) copyFileSync(path, path + ".bak.skillworkshop");
  writeFileSync(path, patched);
  console.log(`  wrote ${name} (${patched.length} bytes)`);
}

const targetFile = findFileBySignature(SIGNATURE, "openclaw-tools-*.js");
console.log(`target: ${targetFile}`);

if (alreadyPatched(targetFile)) {
  console.log(`  already patched (marker ${MARKER} present); no-op`);
  process.exit(0);
}

apply(targetFile);
console.log(`done. patched ${targetFile} with marker ${MARKER}.`);
