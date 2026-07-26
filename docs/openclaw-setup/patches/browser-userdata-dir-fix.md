# Browser sandbox user-data-dir env override + stale-singleton cleanup

**Status:** ✅ Re-ported to source + verified on OpenClaw 2026.6.11 (still pending upstream PR).

> **2026.6.11:** now a **source** patch — `browser-userdata-dir-fix.patch` (edits
> `scripts/sandbox-browser-entrypoint.sh`). `apply-and-deploy.sh` copies the patched
> entrypoint to the mini's sandbox-build + rebuilds the browser image. The old
> `apply-browser-userdata-dir-fix.mjs` is retired.

## What this patches

`scripts/sandbox-browser-entrypoint.sh` (in the OpenClaw source checkout — the
same file the built image copies in), two coupled changes:

**Change 1 — `FIX-BROWSER-USERDATA-DIR`** (one line in the Chromium args array):

```diff
- "--user-data-dir=${HOME}/.chrome"
+ "--user-data-dir=${OPENCLAW_BROWSER_USER_DATA_DIR:-${HOME}/.chrome}" # FIX-BROWSER-USERDATA-DIR
```

After the patch, the entrypoint honors a new env var,
`OPENCLAW_BROWSER_USER_DATA_DIR`, when starting Chromium. If unset (or empty),
the original `${HOME}/.chrome` path is used — zero behavior change for anyone
not opting in.

**Change 2 — `FIX-BROWSER-SINGLETON-CLEAN`** (new block inserted after the
mkdir for HOME):

```diff
  mkdir -p "${HOME}" "${HOME}/.chrome" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"
+
+ # FIX-BROWSER-SINGLETON-CLEAN: remove stale Chromium Singleton* symlinks left by unclean shutdown.
+ # Container is fresh at entrypoint-run time, so no live Chromium owns these.
+ _OPENCLAW_UDD="${OPENCLAW_BROWSER_USER_DATA_DIR:-${HOME}/.chrome}"
+ rm -f "${_OPENCLAW_UDD}/SingletonLock" "${_OPENCLAW_UDD}/SingletonCookie" "${_OPENCLAW_UDD}/SingletonSocket" 2>/dev/null || true
```

Chromium writes `SingletonLock/Cookie/Socket` symlinks in its user-data-dir to
prevent multiple instances against the same profile. With an ephemeral
user-data-dir (the original `/tmp/openclaw-home/.chrome`), the symlinks die
with the container. With a **persistent** user-data-dir on a host bind mount,
the symlinks survive container removal — and if the prior container exited
uncleanly (e.g. `docker rm -f`, which is what `openclaw sandbox recreate
--browser --force` does), the next Chromium startup sees them, thinks another
process owns the profile, and refuses to start. The container exits, CDP never
comes up, and `browser-agent` reports "browser failed to come up." Cleaning
them on each entrypoint run is safe because the container is freshly created —
no Chromium owns the lock yet.

Both changes carry markers (`FIX-BROWSER-USERDATA-DIR`,
`FIX-BROWSER-SINGLETON-CLEAN`) that also let `apply-and-deploy.sh` detect a
patched entrypoint and trigger the image rebuild.

The shared candidate-source integration test executes the patched entrypoint
with fake Xvfb, Chromium, and CDP probes. It verifies the configured
`--user-data-dir`, removes all three stale singleton files, and cannot touch a
real browser or profile.

## Why this is needed

`browser-agent`'s Chromium profile (cookies, localStorage, IndexedDB) needs to
survive `openclaw sandbox recreate --agent browser-agent`. Today the
hardcoded `--user-data-dir=${HOME}/.chrome` points inside the container's
ephemeral `/tmp/openclaw-home/`, so every recreate wipes login state.

OpenClaw's `agents.list[].sandbox.docker.env.*` config seam already
propagates env vars into the browser sandbox container
(`config-BNHBQmxW.js:20-31` spreads `docker.env` into the browser docker
config; `docker-ixkwd21t.js:575-577` pushes them as `--env` to docker run).
So once the entrypoint reads an env var, we can drive the path entirely
from config:

```bash
openclaw config set 'agents.list[N].sandbox.docker.env.OPENCLAW_BROWSER_USER_DATA_DIR' \
  '"/profile"' --strict-json
openclaw config set 'agents.list[N].sandbox.browser.binds' \
  '["/host/path/to/profile:/profile:rw"]' --strict-json
```

See [`docs/plans/023-durable-browser-agent-login.md`](../../plans/023-durable-browser-agent-login.md)
for the end-to-end setup that uses this.

## The proper upstream fix (Option B)

This patch is the minimum-viable change: surface an env var, let users wire
it via the existing `sandbox.docker.env` seam, and harden persistent-profile
behavior. The cleaner upstream fix — the one to land if we have appetite —
adds a first-class config property:

1. Add `userDataDir?: string` to `SandboxBrowserSettings` in
   `plugin-sdk/src/config/types.sandbox.d.ts` and the zod schema.
2. In `sandbox-DIHI_0fY.js` around line 292 (where other browser env vars
   get pushed via `args.push("-e", ...)`), add:
   ```js
   if (params.cfg.browser.userDataDir) {
     args.push("-e", `OPENCLAW_BROWSER_USER_DATA_DIR=${params.cfg.browser.userDataDir}`);
   }
   ```
3. Include both entrypoint patches (env override + singleton cleanup).
4. Update docs.

That gives users `agents.defaults.sandbox.browser.userDataDir: "/profile"` as
a discoverable, type-validated config key (matches the shape of
`headless`, `enableNoVnc`, etc.). Until landed, the env-var seam is the
workaround.

## Patch target

The `.patch` edits `scripts/sandbox-browser-entrypoint.sh` in the OpenClaw
source checkout:

- Change 1 targets the unique line `"--user-data-dir=${HOME}/.chrome"`.
- Change 2 targets the unique `mkdir -p ...` line that creates the
  `${HOME}/.chrome` dir; the cleanup block is inserted immediately after it.

This entrypoint is **not shipped in the npm package**, so unlike the other
patches it isn't picked up by installing the built tarball. Instead
`apply-and-deploy.sh` copies the patched entrypoint to the mini's
`~/.openclaw/sandbox-build/scripts/` and rebuilds the browser image (see below).

## How to apply

Applied from source as part of the from-source deploy. `apply-and-deploy.sh`:
1. `git apply browser-userdata-dir-fix.patch` against the clean OpenClaw checkout.
2. Detects the `FIX-BROWSER-*` markers in the built entrypoint and **copies it to
   the mini's `~/.openclaw/sandbox-build/scripts/`**.
3. **Rebuilds the `openclaw-sandbox-browser:bookworm-slim` Docker image** (the
   entrypoint is `COPY`ed in at build time).
4. **Recreates the browser-agent's sandbox container** so it picks up the new
   image.

To apply the source edit standalone against a checkout:

```bash
cd <openclaw-checkout>            # clean, at the target release
git apply /path/to/puddles/docs/openclaw-setup/patches/browser-userdata-dir-fix.patch
```

The profile dir (cookies/login state) is on a host bind mount outside the
container, so it survives recreate.

## Reverting

Don't include the patch in the deploy (drop it from the `PATCHES` list in
`apply-and-deploy.sh`), or `git checkout .` the source checkout before building.
Then rebuild the browser image + recreate the container from the unpatched
entrypoint:

```bash
docker build -f ~/.openclaw/sandbox-build/Dockerfile.sandbox-browser \
  -t openclaw-sandbox-browser:bookworm-slim ~/.openclaw/sandbox-build
openclaw sandbox recreate --browser --agent browser-agent --force
```

Note that reverting also strands any logged-in profile at `/profile` — the
container will once again use the ephemeral `${HOME}/.chrome`.
