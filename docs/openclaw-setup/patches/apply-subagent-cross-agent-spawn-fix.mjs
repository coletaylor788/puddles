#!/usr/bin/env node
// Apply the cross-agent subagent spawn tool-inheritance fix to an OpenClaw dist
// directory.
//
// Background: see ./subagent-cross-agent-spawn-fix.md.
//
// Verified against OpenClaw 2026.5.20 and 2026.6.1. The patcher locates target
// files by content signatures so it tolerates rebuilds within a release.
//
// What the bug is, briefly:
// 5.20 introduced "inherit effective tool allowlist from parent to subagent" —
// at spawn time the parent's resolved tools get captured into
// `inheritedToolAllowlist`/`inheritedToolDenylist` and written to the child's
// session entry. The child's tool pipeline then uses those as an additional
// whitelist/blacklist filter on its own bundled tools.
//
// For same-agent spawn (main → main subagent) this is a sensible "subagent
// can't elevate beyond its spawner" guarantee. For cross-agent spawn
// (main → reader, main → browser-agent) it strips the child's specialty
// plugin tools (list_emails, browser, …) because the spawning parent's
// allowlist doesn't contain them — the specialty-agent abstraction collapses.
//
// The fix gates each inheritance spread on `targetAgentId === requesterAgentId`.
//
// 6.x note: the vulnerable two-spread pattern now exists in two files because
// 6.x added a new ACP runtime spawn path alongside the legacy `sessions_spawn`:
//   - Legacy: openclaw-tools-*.js, inside the function that resolves
//     subagent role/control scope. Both `targetAgentId` and `requesterAgentId`
//     are in scope (the existing `inheritedWorkspaceDir` gate uses them).
//   - ACP: acp-spawn-*.js inside `spawnAcpDirect(params, ctx)`. `targetAgentId`
//     is in scope; `requesterAgentId` is not, so we derive it on the fly via
//     `parseAgentSessionKey(requesterInternalKey)?.agentId` (the helper is
//     already imported at the top of that file).
//
// Marker: FIX-SUBAGENT-CROSS-AGENT-SCOPE. Idempotent — each site skips if
// the marker is already present.
//
// Usage:
//   node apply-subagent-cross-agent-spawn-fix.mjs [openclaw-dist-dir]
// Defaults to $OPENCLAW_DIST or ~/.npm-global/lib/node_modules/openclaw/dist.

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dist =
  process.argv[2] ||
  process.env.OPENCLAW_DIST ||
  join(homedir(), ".npm-global", "lib", "node_modules", "openclaw", "dist");

if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error(`not a directory: ${dist}`);
  process.exit(2);
}

const MARKER = "FIX-SUBAGENT-CROSS-AGENT-SCOPE";

// Per-site descriptors. Each describes how to discover its file, how to verify
// the file is the right one (precondition), the byte-level FIND for the two
// unconditional spreads, and the gated REPL.
const SITES = [
  {
    name: "legacy sessions_spawn (openclaw-tools)",
    fileContainsAll: [
      "inheritedToolAllowPatch(ctx.inheritedToolAllowlist)",
      // Existing same-agent-only inheritance precedent (workspaceDir gate)
      // lives in the same file. Use it as a precondition.
      "targetAgentId !== requesterAgentId ? void 0 : toolSpawnMetadata.workspaceDir",
    ],
    find:
`\t\t...inheritedToolAllowPatch(ctx.inheritedToolAllowlist),
\t\t...inheritedToolDenyPatch(ctx.inheritedToolDenylist),`,
    repl:
`\t\t...(targetAgentId === requesterAgentId ? inheritedToolAllowPatch(ctx.inheritedToolAllowlist) : {}), // ${MARKER}
\t\t...(targetAgentId === requesterAgentId ? inheritedToolDenyPatch(ctx.inheritedToolDenylist) : {}), // ${MARKER}`,
  },
  {
    name: "ACP spawnAcpDirect (acp-spawn)",
    fileContainsAll: [
      "inheritedToolAllowPatch(ctx.inheritedToolAllowlist)",
      "async function spawnAcpDirect(",
      // parseAgentSessionKey is imported at the top of acp-spawn-*.js
      // (`import { ..., c as parseAgentSessionKey } from "./session-key-utils-*.js"`)
      // — we use it in the REPL to derive requesterAgentId at the site.
      "parseAgentSessionKey",
    ],
    find:
`\t\t\t\t...inheritedToolAllowPatch(ctx.inheritedToolAllowlist),
\t\t\t\t...inheritedToolDenyPatch(ctx.inheritedToolDenylist),`,
    repl:
`\t\t\t\t...(targetAgentId === parseAgentSessionKey(requesterInternalKey)?.agentId ? inheritedToolAllowPatch(ctx.inheritedToolAllowlist) : {}), // ${MARKER}
\t\t\t\t...(targetAgentId === parseAgentSessionKey(requesterInternalKey)?.agentId ? inheritedToolDenyPatch(ctx.inheritedToolDenylist) : {}), // ${MARKER}`,
  },
];

function discoverSiteFile(site, allJsFiles) {
  const matches = allJsFiles.filter(p => {
    const txt = readFileSync(p, "utf8");
    return site.fileContainsAll.every(sig => txt.includes(sig));
  });
  return matches;
}

const allJsFiles = readdirSync(dist)
  .filter(f => f.endsWith(".js"))
  .map(f => join(dist, f));

let anyFailure = false;
let anyApplied = false;

for (const site of SITES) {
  console.log(`\n[site] ${site.name}`);
  const matches = discoverSiteFile(site, allJsFiles);
  if (matches.length === 0) {
    console.log(`  no file matches all signatures — site appears absent in this build.`);
    console.log(`  signatures required (all): ${site.fileContainsAll.map(s => `"${s.slice(0, 60)}…"`).join(", ")}`);
    console.log(`  this could mean: (a) upstream landed the fix and refactored the site away, or`);
    console.log(`  (b) the file moved and needs a new signature. Skipping this site; not failing.`);
    continue;
  }
  if (matches.length > 1) {
    console.error(`  multiple files match all signatures:`);
    for (const m of matches) console.error(`    ${m}`);
    console.error(`  tighten the signatures or split this into multiple sites.`);
    anyFailure = true;
    continue;
  }
  const file = matches[0];
  let s = readFileSync(file, "utf8");

  console.log(`  file: ${file}`);

  if (s.includes(MARKER)) {
    // Marker may already be in the file from a prior site's apply — make sure
    // it's present specifically at THIS site's REPL location.
    if (s.includes(site.repl.split("\n")[0])) {
      console.log(`  already applied — skipping`);
      continue;
    }
    // Marker is in the file but this site's REPL isn't there yet. Fall through
    // and try to apply normally.
  }

  const idx = s.indexOf(site.find);
  if (idx < 0) {
    console.error(`  FIND pattern not found in ${file}`);
    console.error(`  Either the indentation/structure of the two spreads changed, or this site has`);
    console.error(`  been fixed upstream (look for a same-agent-only gate already present).`);
    anyFailure = true;
    continue;
  }
  if (s.indexOf(site.find, idx + 1) >= 0) {
    console.error(`  FIND pattern is not unique within ${file} — multiple positions match.`);
    console.error(`  This means the bug may exist at multiple call sites inside one file. Tighten`);
    console.error(`  the FIND to include surrounding distinguishing context.`);
    anyFailure = true;
    continue;
  }

  const bak = file + ".bak.fix-subagent-cross-agent-scope";
  if (!existsSync(bak)) copyFileSync(file, bak);
  s = s.replace(site.find, site.repl);
  writeFileSync(file, s);
  anyApplied = true;
  console.log(`  applied (${MARKER}). wrote ${s.length} bytes; backup at ${bak}`);
}

if (anyFailure) {
  console.error(`\nOne or more sites failed to apply cleanly. See messages above.`);
  process.exit(1);
}
if (!anyApplied) {
  console.log(`\nNo changes (all sites already applied or absent).`);
}
