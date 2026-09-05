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
  (verified on 2026.7.1 at `0790d9f`).

The retired `apply-*.mjs` dist patchers no longer describe the deploy; each
patch doc keeps a short "retired — see `.patch`" note pointing at its source
diff.

## The patches

| Patch | Doc | Source diff | Status |
|---|---|---|---|
| macOS kernel guard for stale sidecar-lock reclaim | [`file-lock-stale-reclaim-guard.md`](./file-lock-stale-reclaim-guard.md) | [`file-lock-stale-reclaim-guard.patch`](./file-lock-stale-reclaim-guard.patch) | Verified in the managed patch pool |
| `sessions_yield` block-at-yield + gather (cron + interactive) | [`sessions-yield-subagent-leak-fix.md`](./sessions-yield-subagent-leak-fix.md) | [`sessions-yield-block-and-gather.patch`](./sessions-yield-block-and-gather.patch) | Verified on 2026.7.1 (`0790d9f`) |
| Explicit cron subagent targeting + cross-agent tool inheritance | [`subagent-cross-agent-spawn-fix.md`](./subagent-cross-agent-spawn-fix.md) | [`subagent-cross-agent-spawn-fix.patch`](./subagent-cross-agent-spawn-fix.patch) | Verified on 2026.7.1 (`0790d9f`). Pending upstream PR (see plan 025). |
| `skill_workshop` for sandboxed agents | [`skill-workshop-sandbox-fix.md`](./skill-workshop-sandbox-fix.md) | [`skill-workshop-sandbox-fix.patch`](./skill-workshop-sandbox-fix.patch) | Verified on 2026.7.1 (`0790d9f`) |
| Selective iMessage text/link/image part coalescing | [`imessage-message-part-coalescing.md`](./imessage-message-part-coalescing.md) | [`imessage-message-part-coalescing.patch`](./imessage-message-part-coalescing.patch) | Verified on 2026.7.1 (`0790d9f`) |
| Sandbox recreate discovery failure propagation | [`sandbox-discovery-failure-fix.md`](./sandbox-discovery-failure-fix.md) | [`sandbox-discovery-failure-fix.patch`](./sandbox-discovery-failure-fix.patch) | Verified in the managed patch pool on 2026.7.29 |
| Browser sandbox user-data-dir env override + singleton cleanup | [`browser-userdata-dir-fix.md`](./browser-userdata-dir-fix.md) | [`browser-userdata-dir-fix.patch`](./browser-userdata-dir-fix.patch) | Verified on 2026.7.1 (`0790d9f`). Pending upstream PR (see plan 023). |
| Per-agent QMD mcporter config | [`qmd-mcporter-per-agent.md`](./qmd-mcporter-per-agent.md) | [`qmd-mcporter-per-agent.patch`](./qmd-mcporter-per-agent.patch) | Verified on 2026.7.1 source; deployed on 2026.7.1. |

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
2. **Materializes patched dependencies** with
   `pnpm install --frozen-lockfile`. This runs after source patches so changes
   to pnpm dependency patches and lock hashes are present in `node_modules`.
3. **Builds** from source (`pnpm build`).
4. **Serializes and packs the source build** — acquires a lock in the source
   checkout's Git administrative directory before patch application, build, or
   pack, and holds it through deployment. `pnpm pack` writes to a per-invocation
   temporary directory and rewrites workspace dependency protocols to concrete
   release versions. The wrapper rejects unresolved `workspace:` dependencies
   before deployment, so concurrent invocations neither mutate shared build
   output nor delete or consume one another's candidate.
5. **Serializes deployment** — acquires a target-host lock so global package,
   state migration, restart, and rollback operations cannot overlap. Remote
   deployments use a unique staging filename.
6. **Quiesces and snapshots recovery state** — first packs the currently
   installed OpenClaw package with lifecycle scripts disabled, replaces any
   workspace dependency protocols with the installed dependency versions, and
   verifies that rollback tarball is reinstallable. It then stops the gateway,
   boundedly waits until launchd no longer reports the service, clones the
   complete `~/.openclaw` runtime tree with APFS copy-on-write semantics, and
   preserves the gateway
   service definition under `~/.openclaw-deploy-backups/`. Failure to make the
   complete clone aborts before package replacement and restarts the prior
   gateway.
7. **Installs** the tarball on the current host (`npm install -g <tarball>`).
8. **Migrates state** — runs `openclaw doctor --fix --yes` with
   `OPENCLAW_SERVICE_REPAIR_POLICY=external` while the gateway is stopped, then
   verifies the service remains unloaded. Migration failure or unexpected
   activation
   is fatal; the deploy no longer restarts the gateway and reports success after
   a failed repair.
9. **Refreshes the sandbox-browser image while the gateway remains stopped and
   the target lock remains held** — the browser patch edits
   `scripts/sandbox-browser-entrypoint.sh`, which the npm package does **not**
   ship, so the wrapper copies the patched entrypoint to the mini's
   `sandbox-build`, builds a uniquely tagged candidate image, promotes it only
   after a successful build, and recreates the `browser-agent` container. The
   previous entrypoint and production image identity are restored if recreation,
   interruption, gateway restart, or readiness fails. The gateway starts only
   after this rollback-capable work finishes. (Skipped if the entrypoint carries
   no `FIX-BROWSER-*` marker.)
10. **Restarts and probes** the gateway LaunchAgent. The deploy waits for the
   payload-free `openclaw gateway health --port <local-port>` probe and fails if
   readiness does not arrive within the configured bound. An environment-
   selected remote gateway cannot satisfy this probe.
11. **Rolls back automatically** on package, migration, interruption, browser,
    restart, or readiness failure. After confirmed shutdown it restores runtime,
    plist, entrypoint, and image state, then recreates sandboxes with the patched
    candidate CLI so discovery errors remain visible. Only after recreation does
    it reinstall the previous package, restart the prior gateway, and check the
    same local port. State created by a failed migration is retained separately
    for diagnosis. Shutdown, reverse-clone, atomic-swap, browser restoration,
    previous-package, or plist failure is restart-blocking. Signals are deferred
    until rollback reaches a safe terminal state.

Do not use `openclaw update` for this patched production install. The built-in
updater bypasses this patch stack, recovery snapshot, migration gate, readiness
probe, and rollback. Move the source checkout to the intended release only when
that upgrade is explicitly approved, then rerun `apply-and-deploy.sh`.

The readiness bound defaults to 30 one-second attempts on local port `18789`.
Tests and controlled deployments can override it with `GATEWAY_PORT`,
`GATEWAY_HEALTH_ATTEMPTS`, and `GATEWAY_HEALTH_INTERVAL_SECONDS`; all must be
positive integers.

Recovery traverses the runtime tree in userspace and calls macOS `clonefile(2)`
only for regular files. It recreates directories, symlinks, and hard links and
uses non-recursive, no-follow `copyfile(3)` metadata operations to preserve
POSIX attributes, ACLs, and extended attributes without invoking the strongly
discouraged recursive directory clone. Unlike `cp -cR`, regular-file cloning
never falls back to a physical copy. `ENOTSUP`, `EXDEV`, unsupported entry
types, and other failures abort before package replacement and restart the
prior gateway.
The helper enables `COPYFILE_STATE_PRESERVE_SUID` and explicitly reapplies
source modes after native copy operations so setuid/setgid bits survive even
when the platform clone path clears them.
Before creating output, the helper rejects destinations inside the source by
both lexical ancestry and existing-ancestor filesystem identity, covering
case-insensitive APFS aliases and symlinked path components.
The configured runtime root itself must be a real directory; deployment rejects
a symlinked root before stopping the gateway so rollback never replaces root
topology.

To build on one host and deploy to another, set `MINI_HOST` explicitly:

```bash
MINI_HOST=<target-host> OPENCLAW_SRC=~/git/openclaw \
  bash /path/to/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

Only explicit remote deploys use `scp` and `ssh`; the script has no remote-host
default.

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
