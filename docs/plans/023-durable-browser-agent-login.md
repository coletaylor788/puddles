# Plan 023 — Durable, sessionful browser-agent (persistent profile + noVNC)

**Status:** 📝 Drafting (awaiting review)
**Author:** Cole + Puddles
**Related:** docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md §7 ("Docker sandboxing"), docs/openclaw-setup/agent-instructions/browser-agent-AGENTS.md
**Unblocks:** Plan 022 — per-tier `<tier>-browser-agent` containers all want this same shape

---

## Problem

Two coupled gaps in today's `browser-agent` setup:

1. **Login isn't durable.** The sandbox-browser entrypoint hardcodes
   `--user-data-dir=/tmp/openclaw-home/.chrome` (inside the container). Cookies
   persist for the life of the container, but die on
   `openclaw sandbox recreate --agent browser-agent` — needed for image rebuilds,
   config churn, or recovery from a wedged container. With plan 022 landing two
   more browser-agents (`household-browser-agent`, `friends-browser-agent`),
   every recreate = N manual re-logins.

2. **noVNC has never actually started.** Config has `enableNoVnc: true` but also
   `headless: true`. Per `sandbox-DIHI_0fY.js:64`, the gate is `enableNoVnc &&
   !headless` — headless wins, x11vnc/websockify never start, gateway logs
   confirm. No human-driven login path exists today.

We need both fixed in one motion. The agent's "never type creds" rule
(`browser-agent-AGENTS.md` line 11) stays — the model continues to inherit
cookies, not source them. We're enabling *us* to log in, not the agent.

## Goals

- Cookies/localStorage/IndexedDB survive `openclaw sandbox recreate` and
  OpenClaw upgrades.
- Profile dir lives **outside** the iCloud-synced workspace (Chromium's SQLite
  churn is hostile to iCloud) and **outside** the agent's workspace bind mount
  entirely.
- One profile dir per agent — plan 022's per-tier story falls out for free.
- noVNC reachable from a browser on the mini's macOS (over Tailscale-VNC). No
  exposure beyond the mini required.
- No changes to the `browser` tool surface, no changes to
  `browser-agent-AGENTS.md`.
- Minimize fork surface: keep upstream patches one-line and PR-able.

## Non-goals

- Automated logins (1Password etc.) — explicitly out.
- `chrome-mcp` transport / external Chromium sidecar — evaluated and rejected
  for this iteration (loses `pdf`/`trace`/`download` parity, adds sidecar ops).
  See [Alternatives](#alternatives-considered).
- Exposing noVNC beyond the mini.

---

## Open questions — resolved

| Q | Answer | Source |
|---|---|---|
| Can we set env vars on the browser container via config? | **Yes, via `agents.list[].sandbox.docker.env.*`** (NOT `sandbox.browser.env`, which the schema rejects). `resolveSandboxBrowserDockerCreateConfig` spreads the full docker config into the browser create config, so `docker.env` flows to both the regular sandbox and the browser sandbox. | `config-BNHBQmxW.js:20-31`, `docker-ixkwd21t.js:575-577`, `types.sandbox.d.ts` |
| Does setting `browser.binds` drop the workspace mount? | **No — additive.** Source builds base args with `includeBinds: false`, then `appendWorkspaceMountArgs(...)` (always), then iterates `browser.binds` and pushes each as `-v`. Workspace mount is independent. | `sandbox-DIHI_0fY.js:281-288` |
| Does OpenClaw publish the noVNC port? | **Yes, automatically** when `enableNoVnc && !headless`. Container's 6080 → `127.0.0.1:<random>` on the mini. Tokenized URL surfaced via the gateway. | `sandbox-DIHI_0fY.js:64,290,382-391` |
| Does `browser.binds` allow sources outside the workspace? | **No, by default.** `validateSandboxSecurity` requires bind sources under `[workspaceDir, agentWorkspaceDir]`. Out-of-workspace sources require `agents.list[].sandbox.docker.dangerouslyAllowExternalBindSources: true`. Per-agent only; doesn't grant the agent any new capability — only authorizes config edits *you* make. | `validate-sandbox-security-CqbDHTsy.js:176-185`, `docker-ixkwd21t.js:552-555` |

---

## Approach

### 1. Entrypoint patch — folded into `docs/openclaw-setup/patches/`

The patch lives at
[`docs/openclaw-setup/patches/apply-browser-userdata-dir-fix.mjs`](../openclaw-setup/patches/apply-browser-userdata-dir-fix.mjs),
mirroring the `cron-announce-fix` convention so any future
`npm install -g openclaw@<ver>` upgrade can re-apply automatically via the
existing wrapper:

```bash
bash docs/openclaw-setup/patches/apply-and-deploy.sh
```

The wrapper now also rebuilds the sandbox-browser image and recreates
`browser-agent`'s container when it detects the patched entrypoint — so
post-upgrade flow is one command.

The single line being patched in
`~/.openclaw/sandbox-build/scripts/sandbox-browser-entrypoint.sh`:

```diff
- "--user-data-dir=${HOME}/.chrome"
+ "--user-data-dir=${OPENCLAW_BROWSER_USER_DATA_DIR:-${HOME}/.chrome}" # FIX-BROWSER-USERDATA-DIR
```

Backward-compatible (env unset = original path, byte-for-byte). This is
**Option A** — the minimum-viable upstream contribution. The proper upstream
fix is **Option B** below, which we'll PR separately. Either way the local
patch is the bridge.

### 1a. Upstream PR strategy

- **Option A (file first):** PR the one-line entrypoint diff. Tiny review
  surface, surfaces a new env var the entrypoint reads, no schema changes.
  Users wire the path via the existing `sandbox.docker.env` seam.
- **Option B (the correct fix):** Add a first-class
  `agents.defaults.sandbox.browser.userDataDir: string` config property —
  ~20 lines across `types.sandbox.d.ts`, the zod schema,
  `sandbox-DIHI_0fY.js` (push `-e OPENCLAW_BROWSER_USER_DATA_DIR=...` from
  config), plus the same one-line entrypoint patch. Discoverable, type-safe,
  matches how `headless`/`enableNoVnc` are configured.

Land A first to unblock; follow up with B as the proper shape. Track in the
patch doc [`browser-userdata-dir-fix.md`](../openclaw-setup/patches/browser-userdata-dir-fix.md).

### 2. Per-agent config (all `openclaw config set`, no file edits)

```bash
mkdir -p ~/.openclaw/browser-profiles/browser-agent

# Authorize bind sources outside the workspace for browser-agent ONLY.
# Per-agent flag — does not affect main / reader / debug.
openclaw config set 'agents.list[3].sandbox.docker.dangerouslyAllowExternalBindSources' \
  true --strict-json

# Bind the profile dir into the browser sandbox.
openclaw config set 'agents.list[3].sandbox.browser.binds' \
  '["/Users/puddles/.openclaw/browser-profiles/browser-agent:/profile:rw"]' \
  --strict-json

# Tell Chromium where to put its user data dir. Flows via docker.env spread
# into the browser container.
openclaw config set 'agents.list[3].sandbox.docker.env.OPENCLAW_BROWSER_USER_DATA_DIR' \
  '"/profile"' --strict-json

# Flip to headed so noVNC actually starts.
openclaw config set 'agents.defaults.sandbox.browser.headless' false --strict-json
```

(Set `headless: false` per-agent if other agents should remain headless. For
browser-agent specifically: `agents.list[3].sandbox.browser.headless`.)

### 3. Apply patch + rebuild + recreate

```bash
# Applies the entrypoint patch, rebuilds the image, recreates browser-agent.
bash docs/openclaw-setup/patches/apply-and-deploy.sh
```

(For the very first apply, the wrapper does all of: patch + build + recreate +
gateway restart. After OpenClaw upgrades, the same command re-establishes
state.)

### 4. Discover the noVNC URL + log in

`enableNoVnc: true` + `headless: false` causes OpenClaw to auto-publish the
container's port 6080 to `127.0.0.1:<random>` on the mini and generate a fresh
noVNC password (env: `OPENCLAW_BROWSER_NOVNC_PASSWORD`) per container create.

Inspect the published port:

```bash
openclaw sandbox list --browser --json
# .browsers[].noVncPort = <host port>
# .browsers[].cdpPort   = <host port for CDP, separate>
```

#### Recommended: autoconnect URL one-liner (run on the mini)

```bash
C=$(docker ps --filter name=openclaw-sbx-browser-agent --format "{{.Names}}" | head -1); \
PW=$(docker exec "$C" sh -c 'echo "$OPENCLAW_BROWSER_NOVNC_PASSWORD"'); \
PORT=$(openclaw sandbox list --browser --json | jq -r ".browsers[0].noVncPort"); \
echo "http://127.0.0.1:${PORT}/vnc.html?autoconnect=true&resize=scale&password=${PW}"
```

Discovers container name dynamically (survives recreates that pick a different
suffix), fetches the per-container password from the container env, and prints a
ready-to-paste URL. Open it in a browser running on the mini's macOS desktop
(via your existing Tailscale-VNC session). 127.0.0.1 binding means only
processes on the mini can reach it — by design.

#### Alternative: gateway-tokenized URL

OpenClaw also surfaces a tokenized URL at
`${gateway-base-url}/sandbox/novnc?token=<short-lived-token>` after the
browser sandbox starts. Reachable through `controlUi.allowedOrigins` over
Tailscale. Use the one-liner above for day-to-day; this path is here for
completeness.

#### What you'll see + login workflow

1. The noVNC web client shows a Linux Xvfb desktop running Chromium full-screen.
2. Navigate to `mail.google.com` (or whatever) in the Chromium address bar inside
   the noVNC view.
3. Log in normally — credentials, 2FA, the works.
4. **Don't close the Chromium window** — closing the last window terminates the
   Chromium process. Just close the noVNC tab on your viewer when done; Chromium
   keeps running in the container.

Cookies write to `/profile` → bind-mounted to
`~/.openclaw/browser-profiles/browser-agent/` on the mini → survive recreate,
gateway restart, OpenClaw upgrade.

#### Caveats while logging in

- **The noVNC password rotates on every container recreate.** The cookies do not
  (they're on the host bind). Re-fetch with the one-liner whenever you recreate.
- **First Google login from a fresh persistent identity** may trigger a
  "Was this you?" / SMS challenge. Expected; complete once and you're set.
- **Don't use Chromium's built-in "save password"** — `--use-mock-keychain` in
  the entrypoint means saved passwords live in a basic local store in the
  profile, not the macOS keychain. Use 1Password (or similar) and paste at
  login. Cookies/sessions are unaffected — those are the durable wins.

#### Sanity check from the shell

```bash
openclaw agent --agent browser-agent -m 'go to mail.google.com and tell me the title of the page you see'
```

Logged-in inbox returns `"Inbox (N) - cole@... - Gmail"`. Login page returns
just `Gmail`. Either result confirms whether cookie inheritance to the agent
worked.

---

## Verification

1. **Mounts intact:**
   ```bash
   docker inspect openclaw-sbx-browser-agent-browser-agent-<id> | jq '.[0].Mounts'
   ```
   Expect both `/workspace` (workspace bind) AND `/profile` (our new bind).
2. **Env present:**
   ```bash
   docker inspect <container> | jq '.[0].Config.Env' | grep OPENCLAW_BROWSER_USER_DATA_DIR
   ```
   Should show `OPENCLAW_BROWSER_USER_DATA_DIR=/profile`.
3. **Chromium wrote to the profile dir:**
   ```bash
   ls ~/.openclaw/browser-profiles/browser-agent/
   ```
   Expect `Default/`, `Local State`, `Cookies` etc. after first start.
4. **noVNC port mapped:**
   ```bash
   docker port <container> 6080
   # → 127.0.0.1:<random>
   ```
5. **Logged-in session inherits to agent:**
   ```bash
   openclaw agent --agent browser-agent 'go to mail.google.com, tell me the page title'
   ```
   → inbox shell, not login page.
6. **Survives recreate:**
   ```bash
   openclaw sandbox recreate --agent browser-agent
   ```
   Re-run step 5 → still inbox shell.
7. **Survives volume pruning:** `docker volume rm` / `docker system prune` does
   *not* affect the profile (host bind, not a Docker volume).

---

## Risks

### Setup-shape risks
- **Entrypoint patch drift** if upstream rev's the entrypoint. Mitigation: the
  diff is one line and trivial to re-apply; PR upstream to exit the fork. Pin
  the sandbox-browser base image tag and document the rebuild step in the
  guide.
- **`dangerouslyAllowExternalBindSources` audit discipline.** Flag is scoped
  per-agent and doesn't grant the agent any new capability, but future bind
  additions on browser-agent need to be intentional. Mitigation:
  `grep -A2 dangerouslyAllow ~/.openclaw/openclaw.json` in periodic config
  audits; pre-merge checklist for any new `browser.binds` entry.
- **Cross-tier cookie leak via path typo.** Each tier must point at its own
  `~/.openclaw/browser-profiles/<tier>-browser-agent`. Mitigation: pre-merge
  checklist in plan 022 + a `doctor`-style script that asserts each agent's
  bind targets its own subdir.

### Operational risks
- **Chromium SQLite corruption.** Unclean kill of Chrome → cookie DB wedged →
  re-login required. Mitigation: gentle container stop (SIGTERM with grace),
  not SIGKILL. Recovery: `rm -rf ~/.openclaw/browser-profiles/<id>` + relog.
- **2FA re-auth pressure.** Cookies persist; periodic 2FA challenges from
  Google/Apple/etc don't. Each challenge = a manual noVNC session. Acceptable
  and expected.
- **Anti-bot detection.** Persistent identity (stable fingerprint + home IP)
  may be flagged more aggressively over time by sites with strict bot
  detection. Mitigation: don't ask browser-agent to interact with high-risk
  surfaces (banking, X/Twitter automated actions). Mostly applies to write
  flows; passive browsing is fine.
- **noVNC password rotation.** OpenClaw regenerates per container create
  (`sandbox-DIHI_0fY.js:256`). The tokenized URL handles it transparently; if
  you grab the raw port, re-read `OPENCLAW_BROWSER_NOVNC_PASSWORD` from the
  container env after each recreate.
- **Chromium `--use-mock-keychain` flag (set by entrypoint).** Saved passwords
  in Chromium's built-in password manager use a basic store, not OS keychain.
  This doesn't affect cookies/sessions, only "remember password" entries.
  Mitigation: never save passwords in Chromium itself; use 1Password (or
  similar) and copy/paste at login.
- **Profile dir contents are sensitive.** `~/.openclaw/browser-profiles/<id>/`
  contains cookies, localStorage, and cached credentials for every site
  browser-agent has logged into. File perms `puddles:staff 700` (recommended);
  ensure directory perms restrict to the puddles user.

### Security boundary risks
- **Agent FS reach into `/profile`.** SandboxFsPathGuard may or may not allow
  the agent's `read`/`write` tools to touch `/profile` (it's a bind mount, but
  not the workspace). **Verify pre-deploy** (`openclaw agent --agent
  browser-agent 'try to read /profile/Default/Cookies'`); if reachable, either
  forbid in AGENTS.md or add a path guard. Agent already has the live
  session, so this is hardening, not a sealed boundary.
- **`scope: "agent"` means a Chromium exploit persists.** A page-driven
  Chromium compromise can write malicious state into the persistent profile
  that re-loads next session. Recovery is the same as cookie corruption.
  Mitigation: optionally schedule a quarterly `openclaw sandbox recreate
  --agent browser-agent` + relog if you want hygiene.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Status quo (ephemeral, recreate = re-login) | Doesn't scale to plan 022's tiers |
| `--user-data-dir` on workspace bind mount | iCloud is hostile to Chromium SQLite; couples profile to workspace |
| `allowHostControl: true` (host's managed Chrome) | Punctures the container boundary — Chrome runs on macOS as `puddles`. Contradicts the rest of the security model |
| `chrome-mcp` profile + external sidecar | Strong shape but loses `pdf`/Playwright `trace`/`download` round-trip; adds ongoing sidecar ops. Reconsider if upstream rejects the entrypoint PR |

---

## Sequencing

1. Write the patcher + doc under `docs/openclaw-setup/patches/` (done — see
   [`apply-browser-userdata-dir-fix.mjs`](../openclaw-setup/patches/apply-browser-userdata-dir-fix.mjs),
   [`browser-userdata-dir-fix.md`](../openclaw-setup/patches/browser-userdata-dir-fix.md))
   and wire it into `apply-and-deploy.sh` (done).
2. Land config changes on the mini:
   `dangerouslyAllowExternalBindSources`, `browser.binds`,
   `docker.env.OPENCLAW_BROWSER_USER_DATA_DIR`, `browser.headless = false`.
3. Run `bash docs/openclaw-setup/patches/apply-and-deploy.sh` on the mini —
   applies the entrypoint patch, rebuilds the image, recreates browser-agent.
4. Verify steps 1–4 in [Verification](#verification).
5. noVNC into the container from the mini's macOS, log into the services
   browser-agent needs.
6. Verify steps 5–7 in [Verification](#verification).
7. **Verify agent FS reach into `/profile`** (open question in Risks).
8. Open the **Option A** upstream PR for the one-line entrypoint env override.
9. Follow up with the **Option B** PR (first-class `userDataDir` config
   property) once Option A is merged.
10. When Option B lands upstream, delete the patcher + doc and migrate the
    config to use the new key.
11. Update `docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md` with the
    pattern so plan 022's per-tier work picks it up by default.
12. Mark complete.

## Out of scope (track separately)

- Per-tier `binds` overrides for `household-browser-agent` /
  `friends-browser-agent` — those land in plan 022.
- `doctor`-style script to assert no cross-tier bind mistakes — small follow-up;
  could ship with plan 022 or as a one-off PR.
