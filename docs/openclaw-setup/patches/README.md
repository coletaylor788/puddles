# OpenClaw local patches

Patches we maintain on top of the OpenClaw npm release on the Mac mini. Each
patches a specific bug or capability gap that hasn't been fixed (or isn't
fixable) upstream. They mutate files inside the installed `dist/` bundle,
get clobbered on every `npm install -g openclaw@<ver>` upgrade, and must
be re-applied afterward.

## The patches

| Patch | Doc | Patcher | Status |
|---|---|---|---|
| Cron+subagent announce-delivery | [`cron-announce-fix.md`](./cron-announce-fix.md) | [`apply-cron-announce-fix.mjs`](./apply-cron-announce-fix.mjs) | Verified on 2026.4.20 + 2026.5.12 |

Bug reports (filed/draft upstream) live alongside the patches:

- [`cron-announce-bug-report.md`](./cron-announce-bug-report.md) — full
  architectural rationale for the cron-announce fix, with live trace evidence.

## How to re-apply everything after an OpenClaw upgrade

After `npm install -g openclaw@<ver>` (or whatever upgrade flow you use),
run the wrapper:

```bash
bash /path/to/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

It:
1. Applies each patcher in turn against `~/.npm-global/lib/node_modules/openclaw/dist/`.
2. Mirrors any patched files into the `plugin-runtime-deps` copy (older OpenClaw
   versions; no-op on 2026.5.12+).
3. Clears `~/.openclaw/tmp/node-compile-cache/` so the patched code actually
   runs (the cache is *very* sticky — patches without this step have no
   effect).
4. Restarts the gateway LaunchAgent.
5. Prints per-patch verification markers.

If any patcher exits non-zero (e.g., `pattern not found` because OpenClaw
refactored the surrounding code, or `pattern not unique` because a new line
got added), do one of:

- **Upstream fix landed.** Compare with the relevant bug report; if the bug
  is fixed in the new version, delete that patcher's entry from
  `apply-and-deploy.sh` and remove the patch dir.
- **Code restructured.** Open the patcher's `.mjs` file, find the `FIND` /
  `REPLACE` constants, update them to match the new file's structure,
  preserving the logical change. Re-run.

## Discovering files by signature (not by hashed filename)

OpenClaw's bundled `dist/` files have hash suffixes that change on every
release (e.g. `subagent-announce-D8Kxq2.js` → `subagent-announce-Fp93ab.js`).
Every patcher in this folder discovers its target files by **content
signature** (a stable substring inside the file), not by filename. That
makes them tolerant to rebuilds within a release. If a content signature
ever becomes stale, the patcher fails loudly with the unmatched signature.

## Caveats that apply to every patch in this folder

- **Not signed.** Each apply mutates files inside the upstream bundle.
  You're running locally-modified code with no upstream signature. Only
  appropriate for hosts you control (i.e. your own gateway).
- **Compile cache is sticky.** Always clear
  `~/.openclaw/tmp/node-compile-cache/` after patching — the wrapper does
  this automatically. Without it, patches don't take effect even after a
  gateway restart.
- **Plugin-runtime-deps mirror.** OpenClaw releases prior to 2026.5 keep a
  separate copy of `dist/` under
  `~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/` that some plugin
  code paths load from. The wrapper mirrors patched files there too. Newer
  versions no longer use this path; the wrapper detects and skips.
- **Reverting.** Each patcher writes `.bak.<marker>` backups on first apply.
  To revert a specific patch, restore that patcher's backups; see the
  patch's own doc for the marker suffix and exact files.

## Adding a new patch

1. Write the patcher as `apply-<short-name>-fix.mjs`. Pure node, no deps.
   Take a `dist/` directory as arg, find files by content signature, write
   `.bak.<marker>` backups on first apply, fail loudly on missing/non-unique
   signatures.
2. Write `<short-name>-fix.md` documenting the change (what bug it patches,
   why, what it changes, which file signatures it targets, what verification
   markers look like).
3. Add an entry to `apply-and-deploy.sh` invoking the new patcher.
4. Add a row to the "The patches" table above.
