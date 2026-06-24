# OpenClaw cron+subagent announce-delivery fix (local patch)

Local patch for the cron+subagent announce-path delivery bug documented in
[`cron-announce-bug-report.md`](./cron-announce-bug-report.md). Apply this
on your gateway host (Mac mini) until the upstream fix lands.

## What the patch does

Four mechanical changes inside the OpenClaw `dist/` bundle. Together they make
isolated cron jobs (especially cron + subagent) deliver their reply once and only
once, without prompts needing to bolt on explicit `message`-tool instructions.

| # | File (signature) | Change |
|---|---|---|
| C1A | `subagent-announce-*.js` | Drop `isCronSessionKey(...)` from `requesterIsInternalSession` predicate |
| C1B | `subagent-announce-delivery-*.js` | Same drop in `isInternalAnnounceRequesterSession` |
| C2 | `run-delivery.runtime-*.js` | `finalizeTextDelivery` early-returns when descendants are still active |
| C3A | `server.impl-*.js` | Persist `cronRunnerDeliveryEnabled` (from `delivery.mode === "announce"`) on the cron session entry |
| C3B | `subagent-announce-delivery-*.js` | Gate `deliveryTarget` and `sessionOnlyOriginChannel` on the new flag — so `mode: "none"` and `mode: "webhook"` keep the runner silent |
| C4 | `delivery.runtime-*.js` | Dedup `deliverAgentCommandResult` against `result.messagingToolSentTargets` (defense in depth) |

See the bug report for the architectural rationale, live trace evidence, and the
verified four-scenario test matrix.

## Tested versions

| OpenClaw version | Status |
|---|---|
| `2026.4.20` | ✓ verified end-to-end on mini |
| `2026.5.12` | ✓ verified end-to-end on mini |
| `2026.5.20` | ✓ verified end-to-end on mini |
| `2026.6.1`  | ✓ verified end-to-end on mini (C4 import anchor broadened to `from "./agent-delivery-` to survive an import-shape change) |

The patcher discovers files by content signatures (not by hash-suffixed
filenames), so it tolerates rebuilds within the same release. If upstream
restructures the surrounding code, the patcher will fail loudly with the exact
unmatched signature — at which point either the upstream fix has landed (skip
the patcher) or you need to update the FIND/REPLACE pairs in
`apply-cron-announce-fix.mjs`.

## Files in this directory

| File | Purpose |
|---|---|
| `apply-cron-announce-fix.mjs` | Pure patcher. Takes a `dist/` directory, applies the four changes idempotently, writes `.bak.fix4` backups |
| `apply-and-deploy.sh` | Mini-specific wrapper: invokes the patcher, mirrors patched files into `plugin-runtime-deps`, clears the node compile cache, restarts the gateway LaunchAgent, prints verification |

## Quick apply (Mac mini)

From the mini (or via your `mini-ts` SSH alias):

```bash
# Copy this directory onto the mini once (e.g. via the puddles repo clone)
# then run:
bash /path/to/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

Expected output:
```
==> Patching dist at /Users/puddles/.npm-global/lib/node_modules/openclaw/dist
Change 1A → subagent-announce-*.js
  wrote subagent-announce-*.js (...bytes)
Change 1B+3B → subagent-announce-delivery-*.js
  wrote subagent-announce-delivery-*.js (...bytes)
Change 2 → run-delivery.runtime-*.js
  wrote run-delivery.runtime-*.js (...bytes)
Change 3A → server.impl-*.js
  wrote server.impl-*.js (...bytes)
Change 4 → delivery.runtime-*.js
  wrote delivery.runtime-*.js (...bytes)

All patches applied successfully.

==> Mirroring patched files into plugin-runtime-deps copy
==> Clearing node compile cache
==> Restarting OpenClaw gateway (LaunchAgent)
    gateway restarted, PID=...

==> Verification: FIX4 markers in deployed files
    subagent-announce-*.js: 1 markers
    subagent-announce-delivery-*.js: 3 markers
    run-delivery.runtime-*.js: 2 markers
    server.impl-*.js: 1 markers
    delivery.runtime-*.js: 3 markers
```

Sanity-check by running a cron with a subagent:
```bash
openclaw cron run <some-mode-announce-cron-id>
# Then inspect the latest run record — you should see `delivered:false fb:true`
# (cron's path deferred to announce-wake) and exactly one delivery in the chat.
```

## Re-applying after an OpenClaw upgrade

1. Upgrade OpenClaw normally (`openclaw upgrade` or `npm install -g openclaw@<ver>` per your setup).
2. Re-run `apply-and-deploy.sh`.
3. If the patcher fails with `pattern not found` or `pattern not unique`, check
   the bug report's status — the upstream fix may have landed (skip the patcher
   entirely) or a code refactor changed the surrounding lines (update the
   FIND/REPLACE pairs in `apply-cron-announce-fix.mjs`, keeping the
   logical changes the same).

## Reverting

Each patched file gets a `.bak.fix4` backup on first apply. To revert:
```bash
DIST=/Users/puddles/.npm-global/lib/node_modules/openclaw/dist
for F in "$DIST"/*.bak.fix4; do
  cp "$F" "${F%.bak.fix4}"
done
rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```
The plugin-runtime-deps mirror will pick up the unpatched files on the next
gateway restart cycle (or you can copy them across the same way `apply-and-deploy.sh`
does).

## Caveats

- **Not signed.** Each apply mutates files inside the upstream bundle; you're
  running locally-modified code with no upstream signature. Recommended only for
  hosts you control (i.e. your own gateway).
- **Compile cache is sticky.** Always clear `~/.openclaw/tmp/node-compile-cache/`
  after patching — the wrapper does this automatically. Without that step the
  patches won't take effect even after a gateway restart.
- **Plugin-runtime-deps mirror.** Some plugins load OpenClaw from a separate
  copy under `~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/`. The wrapper
  syncs patched files there too. If you patch only the npm-global copy, plugin
  code paths will execute the unpatched version.
- **Verify after every restart.** `grep -c FIX4 <dist-dir>/*.js` should report
  the expected marker counts (1, 3, 2, 1, 3 — one per file).
