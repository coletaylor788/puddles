# OpenClaw local patches

Patches we maintain on top of OpenClaw for the Mac mini gateway. Each closes a
specific bug or capability gap that hasn't been fixed (or isn't fixable)
upstream.

## Strategy: source patches, not dist chunk-surgery

These are **git-diff `.patch` files applied to an OpenClaw source checkout**,
which is then **built from source, packed, and installed as a package**. This
replaced the old approach of surgically editing the installed `dist/` bundle in
place.

Why the switch:

- **Reproducible.** Each `.patch` applies cleanly to the stock release and
  exactly reconstructs the intended build. No discovering hash-suffixed
  `dist/` chunks by content signature, no `pattern not unique` guesswork.
- **Survives rebuilds cleanly.** The patch is against readable source, so an
  upstream refactor produces an honest `git apply` reject you can re-port,
  rather than a silently-stale chunk signature.
- **No sticky-cache / mirror footguns.** The retired dist-surgery flow had to
  clear `~/.openclaw/tmp/node-compile-cache/` and mirror patched files into
  `plugin-runtime-deps` or the edits wouldn't take effect. A from-source build
  sidesteps all of that.
- **Preserves sandboxed-subagent tool-bridging.** A from-source build keeps the
  reader / browser-agent subagents wired to their full plugin tool sets — the
  earlier worry that source builds would break tool-bridging was disproven
  (live source build verified on 2026.7.1 at `0790d9f`).

The retired `apply-*.mjs` dist patchers no longer describe the deploy; each
patch doc keeps a short "retired — see `.patch`" note pointing at its source
diff.

## The patches

| Patch | Doc | Source diff | Status |
|---|---|---|---|
| `sessions_yield` block-at-yield + gather (cron + interactive) | [`sessions-yield-subagent-leak-fix.md`](./sessions-yield-subagent-leak-fix.md) | [`sessions-yield-block-and-gather.patch`](./sessions-yield-block-and-gather.patch) | Live source build verified on 2026.7.1 (`0790d9f`) |
| Explicit cron subagent targeting + cross-agent tool inheritance | [`subagent-cross-agent-spawn-fix.md`](./subagent-cross-agent-spawn-fix.md) | [`subagent-cross-agent-spawn-fix.patch`](./subagent-cross-agent-spawn-fix.patch) | Live source build verified on 2026.7.1 (`0790d9f`). Pending upstream PR (see plan 025). |
| `skill_workshop` for sandboxed agents | [`skill-workshop-sandbox-fix.md`](./skill-workshop-sandbox-fix.md) | [`skill-workshop-sandbox-fix.patch`](./skill-workshop-sandbox-fix.patch) | Live source build verified on 2026.7.1 (`0790d9f`) |
| Selective iMessage text/link/image part coalescing | [`imessage-message-part-coalescing.md`](./imessage-message-part-coalescing.md) | [`imessage-message-part-coalescing.patch`](./imessage-message-part-coalescing.patch) | Live source build verified on 2026.7.1 (`0790d9f`) |
| Browser sandbox user-data-dir env override + stale-singleton cleanup | [`browser-userdata-dir-fix.md`](./browser-userdata-dir-fix.md) | [`browser-userdata-dir-fix.patch`](./browser-userdata-dir-fix.patch) | Live source build and browser image refresh verified on 2026.7.1 (`0790d9f`). Pending upstream PR (see plan 023). |

> **Retired:** a former cron+subagent announce-delivery fix (`cron-announce`) was
> retired on 2026.6.11 — superseded by block-at-yield, and its external
> announce-delivery path verified clean (a test cron delivered its main synthesis
> to imessage, no raw-subagent leak). The patcher + its docs are removed; see git
> history (commit `ccb2d56`) for the original patch and bug report.

## How to deploy after an OpenClaw upgrade

Run the pipeline wrapper on the target Mac mini. It builds and installs locally,
without requiring SSH:

```bash
OPENCLAW_SRC=~/git/openclaw \
  bash /path/to/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

**Decision rule:** first identify the current host with `hostname` or
`scutil --get LocalHostName`. If it is the target Mac mini, leave `MINI_HOST`
unset. Do not SSH back into the same machine and do not wait for a separate build
host.

`$OPENCLAW_SRC` must be a **clean** OpenClaw checkout at the **target release**
(`git -C <src> fetch && git -C <src> checkout <release-tag-or-sha>`). The
wrapper:

1. **Applies** each source `.patch` (in list order) to the clean checkout with
   `git apply`. Already-applied patches are detected (reverse-check) and
   skipped; a patch that no longer applies fails loudly (upstream refactor →
   re-port it).
2. **Builds** from source (`pnpm build`).
3. **Packs patched runtime workspaces** — currently `packages/ai` — into a
   durable deployment-artifact directory, temporarily binds the root manifest to
   that exact tarball, then packs the root package. The wrapper disables pnpm's
   dependency auto-install during prepack and restores both `package.json` and
   `pnpm-lock.yaml` on exit.
4. **Installs** the root tarball on the current host. Local deployments retain
   both artifacts under `~/.openclaw/deploy-artifacts`; explicit remote
   deployments transfer both to the target's corresponding durable directory.
   This keeps the installed root package's `file:` dependency resolvable and
   prevents npm from substituting unpatched registry code.
5. **Migrates auth** — runs `openclaw doctor --fix --yes`. 2026.6.x moved
   provider auth from the legacy `auth-profiles.json` into a per-agent SQLite
   store, and **bare upgrades don't auto-migrate** (you'd get "No API key
   found"). `doctor --fix` imports the legacy JSON into SQLite (backs up +
   removes the old files); it's idempotent once migrated. **Required** on
   2026.6.x upgrades.
6. **Restarts** the gateway LaunchAgent (`launchctl kickstart -k`).
7. **Refreshes the sandbox-browser image** — the browser patch edits
   `scripts/sandbox-browser-entrypoint.sh`, which the npm package does **not**
   ship, so the wrapper copies the patched entrypoint to the mini's
   `sandbox-build`, rebuilds the `openclaw-sandbox-browser:bookworm-slim` image,
   and recreates the `browser-agent` container. (Skipped if the entrypoint
   carries no `FIX-BROWSER-*` marker.)

To build on one host and deploy to another, set `MINI_HOST` explicitly:

```bash
MINI_HOST=<target-host> OPENCLAW_SRC=~/git/openclaw \
  bash /path/to/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

Only explicit remote deploys use `scp` and `ssh`; the script has no remote-host
default.

Use a disposable clean source worktree for each deployment. `EXIT`, `INT`,
`TERM`, and `HUP` restore packaging inputs, but an uncatchable process kill can
interrupt cleanup; if that happens, inspect `package.json` and `pnpm-lock.yaml`
and restore them from the worktree before retrying. Source patches intentionally
remain applied, so discard the deployment worktree after the run rather than
reusing it.

Validate afterward (`openclaw --version`, run a cron with a subagent).

## Adding a new patch

1. Make the change in an OpenClaw **source checkout** (clean, at the target
   release).
2. `git diff > <short-name>.patch` in this directory.
3. Add `<short-name>` to the `PATCHES` array in `apply-and-deploy.sh` (in the
   order it should apply).
4. Write `<short-name>.md` documenting the change: what bug it patches, why, the
   actual code change, and how it was verified.
5. Add a row to the "The patches" table above.
6. Add or update focused tests in the source patch, register their paths under
   the patch in `packages/e2e/openclaw-patch-suite.json`, and run the full
   cumulative lifecycle:

   ```bash
   node packages/e2e/bin/openclaw-test-env.mjs ci
   ```

   Embedded patch tests that are not registered and executed by this shared
   pool do not satisfy the integration requirement.

## Caveat

- **Not signed.** You're building and running a locally-modified OpenClaw with
  no upstream signature. Only appropriate for hosts you control (i.e. your own
  gateway).
