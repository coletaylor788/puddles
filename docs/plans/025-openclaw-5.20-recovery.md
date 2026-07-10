# Plan 025 — OpenClaw 2026.5.20 recovery: re-bundle browser sandbox + cross-agent subagent fix

**Status:** ⚙️ Partially shipped — sandbox bootstrap deployed; cross-agent spawn patcher applied; announce-scope deferred (task #17)
**Author:** Cole + Puddles
**Related:** [Plan 023](./023-durable-browser-agent-login.md) (browser profile durability — the new upstream entrypoint preserves the seam our patch uses, so 023's config story is unchanged)
**Triggered by:** Live regressions in 5.20 — browser-agent containers failed with "stale or incompatible (contract=missing)"; subagent completion announces 3-retry-fail with "missing scope: operator.write"; and reader/browser-agent subagents came up with stripped-down tool lists when spawned by main.

---

## What broke in 5.20

Four regressions: two patched in this folder, one config/scope diagnosis still open, and one gateway runtime bug that just needs a restart.

### 1. Sandbox browser image contract enforcement (needs patch + rebuild)

5.20 added a hard contract label check in `sandbox-CzpKTR-q.js:103-188`:

```js
const CDP_AUTH_TOKEN_ENV_KEY = "OPENCLAW_BROWSER_CDP_AUTH_TOKEN";
const SANDBOX_BROWSER_IMAGE_CONTRACT_LABEL = "org.openclaw.sandbox-browser.contract";
// ...
throw new Error(`Sandbox browser image ... is stale or incompatible
  (contract=missing, expected=2026-05-12-cdp-relay-auth).
  Rebuild it with scripts/sandbox-browser-setup.sh.`);
```

The mini's current image is built from `~/.openclaw/sandbox-build/Dockerfile.sandbox-browser` (Apr 23 vintage). That Dockerfile has no `LABEL` line, so the resulting image has `Labels: {}`, so 5.20 refuses to instantiate browser-agent containers. **Browser-agent is currently dead.**

The mini's entrypoint at `scripts/sandbox-browser-entrypoint.sh` (May 17 vintage, 6507 bytes) is also a pre-May-12 upstream snapshot — uses plain `socat` for CDP relay, doesn't read `OPENCLAW_BROWSER_CDP_AUTH_TOKEN`. Even if we add the label by hand, the relay won't enforce the new auth contract.

**Root cause of our drift:** `~/.openclaw/sandbox-build/` is *not* shipped in the npm package (confirmed in `docs/gateway/sandboxing.md:382` — "the sandbox build scripts ... are not bundled"). Whatever placed those files originally has been outpaced by upstream.

### 2. `operator.write` scope missing on subagent announce path — symptom real, fix TBD

Verified live in `~/.openclaw/logs/gateway.log` (5.20-era only):
```
[warn] Subagent completion direct announce failed for run ...: missing scope: operator.write
... (×3) ...
[warn] Subagent announce give up (retry-limit) ... deliveryError="missing scope: operator.write; direct-primary: missing scope: operator.write"
```

**Affected population is narrow.** Every failing requester in our logs is `agent:main:bluebubbles:direct:+1XXXXXXXXXX` (the owner's BlueBubbles SMS channel). CLI users hold `ADMIN_SCOPE` via `CLI_DEFAULT_OPERATOR_SCOPES`, and the check short-circuits on admin (`if (scopes.includes("operator.admin")) return { allowed: true }`). Channel-bound operator clients aren't admin-scoped by design — that's the whole point of channel scoping. So this regression is invisible to anyone running subagents only from the CLI.

**My initial proposed patch (`syntheticScopes: ["operator.write"]`) was wrong.** Re-tracing `dispatchGatewayMethodInProcessRaw`:
- It picks `scopedClient ?? syntheticClient` — the requester's real client wins when present.
- The synthetic client already defaults `scopes` to `["operator.write"]` (line 137: `scopes: params?.scopes ?? ["operator.write"]`).
- So adding `syntheticScopes` only re-sets the default on a path that isn't even chosen.

The correct fix is likely `forceSyntheticClient: true` on the announce dispatch — so the trusted gateway-internal client dispatches the in-process `agent` method instead of inheriting the channel-scoped requester's identity. But before patching:
- Confirm the `agent` method's scope hasn't legitimately tightened in 5.20 (i.e. the intent might be that non-admin channels *cannot* dispatch subagents and the fix is config-side: grant `operator.write` to the bluebubbles channel).
- Confirm `direct-primary` (the second failing phase in the error string) is a separate delivery code path with its own client-picking logic.
- Determine whether 5.20 changed channel-client default scopes vs. announce client-picking vs. `agent` method scope registration.

**Tracked as a separate task** (#17). Not folding a patch into this plan until the diagnosis is complete.

### 3. Cross-agent subagent spawn strips child's tool list (patched)

When `main` (or any agent with a restrictive `tools.allow`) spawns a *different* agent as a subagent — e.g. `reader`, `browser-agent` — the child comes up with the *intersection* of the parent's tools and its own, not its own full `tools.allow`.

Live evidence on the mini (`~/.openclaw/agents/{reader,browser-agent}/sessions/sessions.json`):

```
agent:reader:subagent:<uuid>:
  inheritedToolAllow: [read, edit, write, exec, process, cron, message,
                       sessions_*, subagents, session_status, image,
                       archive_email, add_label, calendar_write, web_search,
                       memory_*, apple_pim_*]   ← this is main's allow list
  inheritedToolDeny:  [browser, canvas, nodes, gateway, ...channel tools]

agent:browser-agent:subagent:<uuid>:
  inheritedToolAllow: [same as above — none of these include 'browser']
  inheritedToolDeny:  [browser, ...]   ← explicitly denies 'browser'
```

`reader.tools.allow` configures `[get_email, list_emails, web_fetch, calendar_read, get_attachments, read, write, session_status, sessions_send, sessions_yield]`. Intersection with `main`'s allow leaves only `[read, write, session_status, sessions_send, sessions_yield]` — and observation in the gateway log shows reader-as-subagent actually drops to `[read, write, sessions_yield]` (further filtered by downstream layers). All plugin tools that make reader *reader* are gone. `browser-agent`'s only meaningful tool (`browser`) is stripped likewise.

**Root cause.** 5.20 introduced "inherit effective tool allowlist from parent to subagent" — at spawn time, the parent's resolved tools are captured into `inheritedToolAllowlist`/`inheritedToolDenylist` (see `tool-resolution-WdPNkSy1.js:65`, `pi-tools-Cmpkx4Cr.js:2170` — `shouldInheritEffectiveToolAllowlist` triggers on any restrictive `allow` in the parent's policy stack). The spawn handler (`subagent-spawn-ALADHNnO.js:798-799`) then unconditionally writes those onto the child's session entry as `inheritedToolAllow`/`inheritedToolDeny`. At child-run time, `applyFinalEffectiveToolPolicy` (`effective-tool-policy-CLp8RooR.js`) pipes them through as an extra whitelist/blacklist filter on the child's bundled tools.

For **same-agent** spawn (main → main subagent) the inheritance is a sensible "subagent can't elevate beyond its spawner" guarantee. For **cross-agent** spawn it defeats the specialty-agent abstraction: reader and browser-agent each have their own narrower `tools.allow` listing plugin tools their spawner intentionally lacks.

**Why I'm calling this a bug, not by-design.** The same spawn file already has a precedent for cross-agent-aware inheritance on workspace dir (line ~913):

```js
const inheritedWorkspaceDir = targetAgentId !== requesterAgentId
  ? void 0
  : toolSpawnMetadata.workspaceDir;
```

Workspace inheritance is gated on same-agent. Tool inheritance is not. The asymmetry reads as an oversight in the new 5.20 feature, not an intentional contract. (Verification trail: I also checked `sessions_spawn` parameter schema — no `inherit`/`isolated` knob; `context: fork|isolated` is transcript-context only; `runtime: acp|subagent` ACP path has the same bug; `tools.subagents.tools` would worsen, not bypass, the inheritance; `agents.list[].subagents` config has no tool-inheritance toggle; no `message`/`sessions_send`/`subagents` tool replaces parent-waits-on-child spawn semantics.)

### 4. Hot-reload subagent tool-scoping bug (runtime, no patch)

When `~/.openclaw/openclaw.json` changes during a live gateway, plugin tools don't get re-wired into already-instantiated subagent policies. After last night's hot reload (memory-core toggle + bluebubbles groupAllowFrom edit), the `reader` subagent's toolCount dropped from 8 → 3 (only `read`, `write`, `sessions_yield` survived; the plugin tools `list_emails`, `get_email`, `web_fetch`, etc. all vanished).

This isn't a fork-and-patch situation — it's a gateway bug, and the workaround is just `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`. Worth noting because the user will see two distinct symptoms from the upgrade and shouldn't conflate them.

---

## Proposal — three concrete changes (was four; Change D deferred pending diagnosis)

### Change A: `apply-and-deploy.sh` bootstraps the sandbox-build dir from upstream

Today's flow assumes `~/.openclaw/sandbox-build/` is already populated by some earlier setup step. Make the deploy script fetch upstream on every run, pinned to a SHA we control:

```bash
# Near the top of apply-and-deploy.sh, after the env-var defaults
SANDBOX_BUILD_UPSTREAM_REPO="${OPENCLAW_SANDBOX_REPO:-openclaw/openclaw}"
SANDBOX_BUILD_UPSTREAM_REF="${OPENCLAW_SANDBOX_REF:-main}"  # pin to a SHA in prod
BASE="https://raw.githubusercontent.com/${SANDBOX_BUILD_UPSTREAM_REPO}/${SANDBOX_BUILD_UPSTREAM_REF}"

echo "==> Refreshing sandbox-build from upstream (${SANDBOX_BUILD_UPSTREAM_REPO}@${SANDBOX_BUILD_UPSTREAM_REF})"
mkdir -p "$SANDBOX_BUILD/scripts"
# Fetch to .new, compare, only move if changed — keeps mtime stable for unchanged files
fetch_if_changed() {
  local url="$1" dest="$2" tmp="$2.new"
  curl -sSfL "$url" -o "$tmp"
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
  else
    # Back up any pre-existing version once (so first-run after upgrade is recoverable)
    [ -f "$dest" ] && [ ! -f "$dest.bak.pre-upstream-bootstrap" ] && \
      cp "$dest" "$dest.bak.pre-upstream-bootstrap"
    mv "$tmp" "$dest"
    echo "    updated $dest"
  fi
}
fetch_if_changed "$BASE/scripts/docker/sandbox/Dockerfile.browser" \
  "$SANDBOX_BUILD/Dockerfile.sandbox-browser"
fetch_if_changed "$BASE/scripts/sandbox-browser-entrypoint.sh" \
  "$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
chmod +x "$SANDBOX_BUILD/scripts/sandbox-browser-entrypoint.sh"
```

Critical detail: do this **before** running `SANDBOX_BUILD_PATCHERS`, so the patcher re-applies on top of the fresh upstream file rather than the (possibly already-patched) old one. The patcher's idempotency check (skip if marker present) handles the "fresh file → never patched" vs "no-op upgrade" cases automatically.

Trade-off: this introduces an at-deploy network dependency on raw.githubusercontent.com. We accept that because (a) it's already needed to install openclaw from npm anyway and (b) `OPENCLAW_SANDBOX_REF` can be pinned to a SHA when we want bit-for-bit reproducibility. The README should call out pinning before any production-ish use.

### Change B: existing browser-userdata-dir patcher is unchanged — confirmed working against new upstream

Diffed upstream `main` entrypoint vs the patcher's `FIND` strings — both anchors match byte-for-byte:

| Anchor | Upstream entrypoint line | Match? |
|---|---|---|
| `"--user-data-dir=${HOME}/.chrome"` | line 106 | ✅ exact |
| `mkdir -p "${HOME}" "${HOME}/.chrome" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"` | line 91 | ✅ exact |

So the existing `apply-browser-userdata-dir-fix.mjs` runs cleanly against the new upstream entrypoint without changes. The marker comments (`# FIX-BROWSER-USERDATA-DIR`, `FIX-BROWSER-SINGLETON-CLEAN`) get inserted around the new CDP-auth-relay logic, but don't interfere with it — the Python relay reads `OPENCLAW_BROWSER_CDP_AUTH_TOKEN` from env (auto-injected by gateway), the user-data-dir override flows through Chrome args, fully orthogonal.

**Plan 023 interaction:** Upstream's new entrypoint keeps the same `HOME=/tmp/openclaw-home` default and `${HOME}/.chrome` user-data-dir default. Our `OPENCLAW_BROWSER_USER_DATA_DIR` override still works exactly the same way, and the `agents.list[3].sandbox.docker.env.OPENCLAW_BROWSER_USER_DATA_DIR: "/profile"` config from plan 023 still flows through unchanged. Nothing about plan 023's config + bind mount approach needs revision. *However:* the new entrypoint adds `--password-store=basic --use-mock-keychain` to Chrome args (matches what plan 023 already documented as a caveat), and replaces `socat` with a Python TCP relay enforcing HTTP Basic/Bearer auth — both improvements, neither affects the durable-profile shape.

### Change C: cross-agent subagent spawn tool-inheritance gate (applied)

Patcher: [`apply-subagent-cross-agent-spawn-fix.mjs`](../openclaw-setup/patches/apply-subagent-cross-agent-spawn-fix.mjs). Bug report: [`subagent-cross-agent-spawn-fix.md`](../openclaw-setup/patches/subagent-cross-agent-spawn-fix.md). Marker: `FIX-SUBAGENT-CROSS-AGENT-SCOPE`.

Two-line gate in `subagent-spawn-<hash>.js`. Mirrors the existing same-agent-only inheritance pattern used in the same file for `inheritedWorkspaceDir` (line ~913):

```js
// Before — unconditional inheritance:
...inheritedToolAllowPatch(ctx.inheritedToolAllowlist),
...inheritedToolDenyPatch(ctx.inheritedToolDenylist),

// After — same-agent-only, like inheritedWorkspaceDir on line 913:
...(targetAgentId === requesterAgentId ? inheritedToolAllowPatch(ctx.inheritedToolAllowlist) : {}),
...(targetAgentId === requesterAgentId ? inheritedToolDenyPatch(ctx.inheritedToolDenylist) : {}),
```

Same-agent spawn (main → main subagent) keeps the "no elevation beyond spawner" guarantee. Cross-agent spawn (main → reader, main → browser-agent, …) gets clean resolution from the target agent's own config — the specialty-agent abstraction works again.

**Coverage caveat — `acp-spawn-CrNRwS0r.js:1084` has the same bug pattern.** That path is hit when a parent invokes a subagent via the ACP runtime (instead of the in-process subagent runtime). Same two-spread shape, but `requesterAgentId` isn't in scope at the call site — would need to derive it from `parseAgentSessionKey(parentSessionKey)?.agentId`. Not patched yet; tracking as a follow-up. The in-process (subagent-runtime) path — which is what `agents.list[].subagents` invocations use — is fully covered by Change C.

**Stale session entries on disk are harmless.** 3 ended `reader` subagent sessions and 4 ended `browser-agent` ones still carry `inheritedToolAllow`/`inheritedToolDeny`. They were already constrained when they ran, won't be revisited, and don't affect future spawns. The cleanup snippet in the bug-report doc is documented but unused.

### Change D: DEFERRED — original proposal was based on faulty analysis

~~Added `syntheticScopes: ["operator.write"]` to the announce dispatch.~~ Retracted — the synthetic client default is already `["operator.write"]`, and the dispatch prefers the requester's real client over the synthetic when present, so the patch was a no-op in both branches. See "What broke" §2 above. Tracking as task #17; a corrected patch (likely `forceSyntheticClient: true`, or a config-side fix granting `operator.write` to the bluebubbles channel) will land as a follow-up plan once the diagnosis is done.

<details><summary>Original (retracted) proposed patcher</summary>

```js
#!/usr/bin/env node
// Adds syntheticScopes: ["operator.write"] to the in-process dispatch call in
// the subagent announce delivery path. Without this, subagent completion
// announces 3-retry-fail with "missing scope: operator.write" under 5.20+,
// leaving the parent's sessions_yield permanently parked.
//
// File is bundled as `subagent-announce-delivery-<hash>.js` (hash varies per
// release). Located by content signature on the unique two-line slice of
// runAnnounceAgentCall.
//
// Marker: FIX-SUBAGENT-ANNOUNCE-SCOPE. Idempotent.
//
// Bug report: upstream missed this call site when adding default scope
// enforcement in method-scopes-*.js. The sibling call site at
// server-plugins-*.js:304 correctly passes syntheticScopes (ADMIN_SCOPE);
// runAnnounceAgentCall does not.

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

const MARKER = "FIX-SUBAGENT-ANNOUNCE-SCOPE";
const SIGNATURE = `dispatchGatewayMethodInProcess("agent", params.agentParams, {`;
const FIND = `dispatchGatewayMethodInProcess("agent", params.agentParams, {
    expectFinal: params.expectFinal,
    timeoutMs: params.timeoutMs
  })`;
const REPL = `dispatchGatewayMethodInProcess("agent", params.agentParams, {
    expectFinal: params.expectFinal,
    timeoutMs: params.timeoutMs,
    syntheticScopes: ["operator.write"] // ${MARKER}
  })`;

const matches = readdirSync(dist)
  .filter(f => f.startsWith("subagent-announce-delivery-") && f.endsWith(".js"))
  .map(f => join(dist, f))
  .filter(p => readFileSync(p, "utf8").includes(SIGNATURE));

if (matches.length === 0) {
  console.error(`apply-subagent-announce-scope-fix: no file matching signature found in ${dist}`);
  console.error(`Either OpenClaw refactored runAnnounceAgentCall (update SIGNATURE/FIND/REPL) or upstream landed the fix (delete this patcher).`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`apply-subagent-announce-scope-fix: multiple files match signature:\n  ${matches.join("\n  ")}`);
  process.exit(1);
}

const file = matches[0];
const bak = file + ".bak.fix-subagent-announce-scope";
let s = readFileSync(file, "utf8");

console.log(`apply-subagent-announce-scope-fix → ${file}`);

if (s.includes(MARKER)) {
  console.log(`  (${MARKER}): already applied, skipping`);
  process.exit(0);
}

const idx = s.indexOf(FIND);
if (idx < 0) {
  console.error(`  pattern not found:\n  ${FIND.split("\n")[0]}...`);
  process.exit(1);
}
if (s.indexOf(FIND, idx + 1) >= 0) {
  console.error(`  pattern not unique`);
  process.exit(1);
}

if (!existsSync(bak)) copyFileSync(file, bak);
s = s.replace(FIND, REPL);
writeFileSync(file, s);
console.log(`  (${MARKER}): applied`);
console.log(`  wrote ${file} (${s.length} bytes), backup at ${bak}`);
```

And register it in `apply-and-deploy.sh`:

```diff
 PATCHERS=(
   "$HERE/apply-cron-announce-fix.mjs"
+  "$HERE/apply-subagent-announce-scope-fix.mjs"
 )

 MARKERS=(
   "FIX4"
+  "FIX-SUBAGENT-ANNOUNCE-SCOPE"
   "FIX-BROWSER-USERDATA-DIR"
   "FIX-BROWSER-SINGLETON-CLEAN"
 )
```

…plus a verification block mirroring the FIX4 one (one `grep -l ... | while` loop).

The compile-cache clear + gateway restart already in `apply-and-deploy.sh` will pick this up — no additional steps.

</details>

---

## Sequencing

1. Land Change A (upstream-bootstrap + Dockerfile/entrypoint refresh) — unblocks browser-agent. Run once on the mini; future upgrades become re-run of `apply-and-deploy.sh`.
2. No code edit needed for Change B (existing patcher already works) — just verify after Change A by running `apply-and-deploy.sh` end-to-end.
3. Change C lands via `apply-and-deploy.sh` (the new patcher is registered in the `PATCHERS` array). Same compile-cache-clear + gateway-restart hooks already in the script pick it up; no extra step. Existing subagent session entries with stale `inheritedToolAllow`/`inheritedToolDeny` are left alone — they're harmless on ended sessions, and the bug doc carries a cleanup snippet if a future bug ever requires it.
4. Pin `OPENCLAW_SANDBOX_REF` in the README to whatever upstream SHA we end up running with, so the deploy is reproducible.
5. Restart the gateway one more time after all the above (covers the unrelated hot-reload tool-scoping regression — issue #4 above).
6. Diagnose and patch the announce-scope regression (task #17) as a follow-up — independent of the sandbox and subagent work; a workaround is also possible by dispatching subagents only from the CLI (admin-scoped) until the fix lands.

Each change is independently revertible:
- Change A — `cp ~/.openclaw/sandbox-build/<file>.bak.pre-upstream-bootstrap ~/.openclaw/sandbox-build/<file>; docker build ...; openclaw sandbox recreate --browser --agent browser-agent --force`
- Change C — `cp ~/.npm-global/lib/node_modules/openclaw/dist/subagent-spawn-<hash>.js.bak.fix-subagent-cross-agent-scope ~/.npm-global/lib/node_modules/openclaw/dist/subagent-spawn-<hash>.js; rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*; launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`

---

## Upstream PR plan

| Patch | PR shape | Notes |
|---|---|---|
| Subagent announce scope (deferred) | Awaiting diagnosis (task #17). Likely shape is either a one-line `forceSyntheticClient: true` on the announce dispatch, or a doc/config-clarity PR if the intent is that non-admin channels shouldn't dispatch subagents. Repro is straightforward: any non-admin-scoped operator session dispatching a subagent in 5.20+ hits "missing scope: operator.write". | — |
| Cross-agent subagent spawn tool inheritance (Change C) | Two-line gate on the two `inheritedTool*Patch` spreads in `subagent-spawn-<hash>.js`. Mirrors the existing same-agent-only `inheritedWorkspaceDir` precedent in the same file (~line 913). Repro: any two agents `A`, `B` where `A.tools.allow` excludes a tool in `B.tools.allow`; have `A` spawn `B` as subagent; observe `B`'s subagent missing the tool. | Should also extend to the parallel ACP-runtime site at `acp-spawn-CrNRwS0r.js:1084` for full coverage. |
| Browser sandbox bootstrap docs (Change A meta) | Doc-only PR clarifying that `scripts/sandbox-browser-setup.sh` or equivalent must be run after every openclaw install, with an example script. | Surfaces the gap that landed us here. |

The browser entrypoint patches (FIX-BROWSER-USERDATA-DIR, FIX-BROWSER-SINGLETON-CLEAN) PR is already tracked in plan 023's Option A/B. No change.

---

## Risks

- **Upstream bootstrap drift.** Fetching from `main` means an upstream entrypoint refactor could break our patcher's FIND anchors without warning. Mitigation: pin `OPENCLAW_SANDBOX_REF` to a SHA once we're past acute recovery, and re-run the patcher against the pinned ref before bumping.
- **Network dependency at deploy time.** `apply-and-deploy.sh` becomes non-runnable offline. Mitigation: the `fetch_if_changed` helper is a no-op when content matches — cache the files in git or a local mirror if offline deploys ever matter (they don't today).
- **`.bak.pre-upstream-bootstrap` shadowing manual edits.** If someone edited `~/.openclaw/sandbox-build/` by hand without going through this script, the bootstrap will overwrite their changes (one-time backup, but only the first time). Mitigation: README says "don't hand-edit; use a patcher". The marker-based patchers in this folder are the supported customization seam.
- **ACP-runtime spawn path still has the bug (Change C coverage gap).** Cross-agent spawns via the ACP runtime (rather than the in-process subagent runtime) still hit the same unconditional inheritance at `acp-spawn-CrNRwS0r.js:1084`. Mitigation today: our `agents.list[].subagents` config uses the subagent runtime, which is fully covered by Change C. If we ever flip an agent to the ACP runtime, the bug returns until the parallel patch lands. Tracked as a follow-up extension to the patcher.
- **Same-agent-spawn semantics preserved.** The gate is intentional: when `targetAgentId === requesterAgentId` the inheritance still fires, so the "no elevation beyond spawner" guarantee is intact for main → main subagents. We're not loosening any privilege boundary; we're restoring the cross-agent case to "each agent stands on its own config".

---

## Verification

After running the updated `apply-and-deploy.sh`:

1. **Image has contract label:**
   ```bash
   docker inspect openclaw-sandbox-browser:bookworm-slim --format '{{ index .Config.Labels "org.openclaw.sandbox-browser.contract"}}'
   # → 2026-05-12-cdp-relay-auth
   ```
2. **Browser-agent spawns:**
   ```bash
   openclaw agent --agent browser-agent -m 'tell me the page title of example.com'
   # → returns "Example Domain" (no "stale or incompatible" error)
   ```
3. **Subagent announce works:**
   ```bash
   openclaw agent --agent main -m 'dispatch the reader subagent to summarize the last 3 emails'
   # → parent un-yields, gets reader's response, no 3-retry-fail in gateway log
   ```
4. **Existing entrypoint patches still applied:**
   ```bash
   grep -c FIX-BROWSER-USERDATA-DIR ~/.openclaw/sandbox-build/scripts/sandbox-browser-entrypoint.sh  # → 1
   grep -c FIX-BROWSER-SINGLETON-CLEAN ~/.openclaw/sandbox-build/scripts/sandbox-browser-entrypoint.sh  # → 1
   ```
5. **Cross-agent subagent spawn patch applied (Change C):**
   ```bash
   grep -l FIX-SUBAGENT-CROSS-AGENT-SCOPE ~/.npm-global/lib/node_modules/openclaw/dist/*.js
   # → subagent-spawn-<hash>.js  (exactly one file, two marker occurrences)
   ```
   End-to-end check (the actual reason the patch exists): trigger a cross-agent subagent spawn, then confirm the new session entry doesn't carry inherited-tool keys:
   ```bash
   # On the mini, after main spawns reader as a subagent at least once post-patch:
   python3 -c '
   import json
   from pathlib import Path
   p = Path("/Users/puddles/.openclaw/agents/reader/sessions/sessions.json")
   store = json.loads(p.read_text())
   new = [k for k, v in store.items()
          if "subagent" in k
          and v.get("startedAt", 0) > $(date +%s000)
          and ("inheritedToolAllow" in v or "inheritedToolDeny" in v)]
   print(f"post-patch entries still carrying inherited tool keys: {len(new)} (expected 0)")
   '
   ```
   And functionally: a reader subagent spawned by main should see its full `tools.allow` (`get_email`, `list_emails`, `web_fetch`, `calendar_read`, `get_attachments`, plus the baseline) — not the stripped `[read, write, sessions_yield]` triplet from before.
6. **Scope patch applied (deferred — Change D):**
   ```bash
   grep -l FIX-SUBAGENT-ANNOUNCE-SCOPE ~/.npm-global/lib/node_modules/openclaw/dist/*.js
   # → not yet applied; see task #17
   ```
7. **Plan 023 still works:** if `agents.list[3].sandbox.docker.env.OPENCLAW_BROWSER_USER_DATA_DIR` is set to `/profile` with the bind mount, `docker inspect openclaw-sbx-browser-agent-* | jq '.[0].Mounts'` shows `/profile` and Chromium cookies persist across `openclaw sandbox recreate --agent browser-agent`.

---

## Out of scope

- The hot-reload subagent tool-scoping regression (issue #4) — gateway runtime bug, not a patch target. Just restart the gateway after each config edit until upstream lands a fix. Worth filing as a separate bug report.
- ACP-runtime parallel of the cross-agent spawn fix (`acp-spawn-CrNRwS0r.js:1084`) — same bug pattern, different code path. None of our current agents use the ACP runtime, so deferred. If we ever flip one to ACP, this needs a follow-up patcher.
- Re-bundling the regular (non-browser) sandbox Dockerfile (`Dockerfile.sandbox`) — that one hasn't shown contract drift in 5.20. If it does in a future release, this same upstream-bootstrap pattern applies.
- Migrating off the env-var seam to a first-class `userDataDir` config property (plan 023's Option B). Independent of 5.20 recovery.
