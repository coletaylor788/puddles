#!/usr/bin/env node
// Apply the browser sandbox user-data-dir env override + stale-singleton cleanup
// to OpenClaw's installed sandbox-browser entrypoint.
//
// Background: see ./browser-userdata-dir-fix.md (and the upstream issue once
// filed).
//
// Verified against OpenClaw 2026.5.12. The patcher locates the entrypoint by
// content signature so it survives rebuilds within a release. If any signature
// goes stale after an upstream rev, the patcher fails loudly and you either
// update the FIND/REPLACE to match the new structure, or delete this patch
// because upstream landed the fix.
//
// Two coupled changes (both needed for persistent profiles to be reliable):
//   1. Make --user-data-dir honor OPENCLAW_BROWSER_USER_DATA_DIR env var
//      (marker FIX-BROWSER-USERDATA-DIR).
//   2. Clean stale Chromium Singleton{Lock,Cookie,Socket} symlinks before
//      Chromium starts. These get left behind when a container is force-removed
//      (e.g. `openclaw sandbox recreate`) and block the next Chromium startup
//      with "Singleton lock held by another process" (marker
//      FIX-BROWSER-SINGLETON-CLEAN).
//
// Each change is independently idempotent (skipped if its marker is present).
//
// Usage:
//   node apply-browser-userdata-dir-fix.mjs [sandbox-build-dir]
// Defaults to $OPENCLAW_SANDBOX_BUILD or ~/.openclaw/sandbox-build.
//
// After applying, the sandbox-browser Docker image must be rebuilt and
// browser-agent's container recreated for the change to take effect. The
// wrapper script (apply-and-deploy.sh) does this automatically.

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const sandboxBuild =
  process.argv[2] ||
  process.env.OPENCLAW_SANDBOX_BUILD ||
  join(homedir(), ".openclaw", "sandbox-build");

if (!existsSync(sandboxBuild) || !statSync(sandboxBuild).isDirectory()) {
  console.error(`not a directory: ${sandboxBuild}`);
  process.exit(2);
}

const entrypoint = join(sandboxBuild, "scripts", "sandbox-browser-entrypoint.sh");
if (!existsSync(entrypoint)) {
  console.error(`entrypoint not found: ${entrypoint}`);
  process.exit(2);
}

const bak = entrypoint + ".bak.fix-browser-userdata-dir";
let s = readFileSync(entrypoint, "utf8");
let changed = false;

function require1(text, find, label) {
  const idx = text.indexOf(find);
  if (idx < 0) {
    console.error(`[${label}] pattern not found:\n  ${find.split("\n")[0]}`);
    console.error("Either OpenClaw refactored the entrypoint (update FIND/REPL) or upstream landed the fix (delete this patcher).");
    process.exit(1);
  }
  if (text.indexOf(find, idx + 1) >= 0) {
    console.error(`[${label}] pattern not unique: ${find.split("\n")[0]}`);
    process.exit(1);
  }
}

console.log(`apply-browser-userdata-dir-fix → ${entrypoint}`);

// ---------- Change 1: --user-data-dir env override ----------
{
  const MARKER = "FIX-BROWSER-USERDATA-DIR";
  const FIND = `"--user-data-dir=\${HOME}/.chrome"`;
  const REPL = `"--user-data-dir=\${OPENCLAW_BROWSER_USER_DATA_DIR:-\${HOME}/.chrome}" # ${MARKER}`;
  if (s.includes(MARKER)) {
    console.log(`  Change 1 (${MARKER}): already applied, skipping`);
  } else {
    require1(s, FIND, "C1");
    s = s.replace(FIND, REPL);
    changed = true;
    console.log(`  Change 1 (${MARKER}): applied`);
  }
}

// ---------- Change 2: clean stale Chromium Singleton* locks ----------
{
  const MARKER = "FIX-BROWSER-SINGLETON-CLEAN";
  const FIND = `mkdir -p "\${HOME}" "\${HOME}/.chrome" "\${XDG_CONFIG_HOME}" "\${XDG_CACHE_HOME}"`;
  const REPL =
    FIND +
    "\n\n" +
    `# ${MARKER}: remove stale Chromium Singleton* symlinks left by unclean shutdown.\n` +
    `# Container is fresh at entrypoint-run time, so no live Chromium owns these.\n` +
    `_OPENCLAW_UDD="\${OPENCLAW_BROWSER_USER_DATA_DIR:-\${HOME}/.chrome}"\n` +
    `rm -f "\${_OPENCLAW_UDD}/SingletonLock" "\${_OPENCLAW_UDD}/SingletonCookie" "\${_OPENCLAW_UDD}/SingletonSocket" 2>/dev/null || true`;
  if (s.includes(MARKER)) {
    console.log(`  Change 2 (${MARKER}): already applied, skipping`);
  } else {
    require1(s, FIND, "C2");
    s = s.replace(FIND, REPL);
    changed = true;
    console.log(`  Change 2 (${MARKER}): applied`);
  }
}

if (changed) {
  if (!existsSync(bak)) copyFileSync(entrypoint, bak);
  writeFileSync(entrypoint, s);
  console.log(`  wrote ${entrypoint} (${s.length} bytes)`);
  console.log(`  backup at ${bak}`);
  console.log(`  IMPORTANT: rebuild the sandbox-browser image and recreate browser-agent.`);
  console.log(`    docker build -f ${sandboxBuild}/Dockerfile.sandbox-browser \\`);
  console.log(`      -t openclaw-sandbox-browser:bookworm-slim ${sandboxBuild}`);
  console.log(`    openclaw sandbox recreate --browser --agent browser-agent --force`);
} else {
  console.log("  nothing to do (all changes already applied)");
}
