# OpenClaw — cross-agent subagent spawn strips child's tools

> **2026.6.11:** re-ported to a **source** patch — `subagent-cross-agent-spawn-fix.patch`
> (git-diff against the OpenClaw checkout, applied by `apply-and-deploy.sh` + built from
> source). The old `apply-*.mjs` dist chunk-surgery is retired. Verified on 2026.6.11
> (a reader subagent spawned from `main` receives its own full tool set).

**Source diff:** `subagent-cross-agent-spawn-fix.patch` (git-diff against the
OpenClaw source; applied by `apply-and-deploy.sh`, then built from source).
**Retired patcher:** `apply-subagent-cross-agent-spawn-fix.mjs` (dist chunk-surgery).
**Target source (6.x):** both spawn sites — the legacy `sessions_spawn` path and
the new ACP-runtime spawn (`spawnAcpDirect`). In 5.20 there was only the one site.
**Verified against:** OpenClaw 2026.6.11 (also 2026.5.20, 2026.6.1 under the retired patcher).

## Symptom

When a parent agent (`main`) spawns a different agent as a subagent
(e.g. `reader`, `browser-agent`), the subagent comes up with a tool list
that is the *intersection* of the parent's `tools.allow` and the child's
`tools.allow` — not the child's full `tools.allow`. In practice this
strips every plugin tool the parent doesn't already have:

- `reader` configured with `[get_email, list_emails, web_fetch, ...]`
  appears at runtime with just `[read, write, sessions_yield]` because
  `main.tools.allow` contains none of those plugin tools.
- `browser-agent` configured with `[browser, ...]` loses `browser`
  entirely, because `main` never had `browser` and the
  `inheritedToolDeny` list even explicitly denies it.

The same agents invoked directly via the CLI (`openclaw agent --agent
reader …`) come up with their full configured tool list. The bug only
manifests on the spawn path.

## Root cause

5.20 introduced "inherit effective tool allowlist from parent to
subagent". When the parent's tools resolve and any policy layer in its
stack has a restrictive `allow` (which `main.tools.allow` does), the
gateway captures the parent's effective tools into
`inheritedToolAllowlist`/`inheritedToolDenylist` and passes them through
to the spawn tool. The spawn handler then writes them onto the child's
session entry as `inheritedToolAllow` / `inheritedToolDeny`. At
child-run time, `applyFinalEffectiveToolPolicy` (in
`effective-tool-policy-*.js`) pipes them in as an extra
whitelist+blacklist filter on top of the child's own bundled tools.

For **same-agent spawn** (`main → main` subagent), the inheritance is a
sensible "subagent can't elevate beyond its spawner" guarantee.

For **cross-agent spawn** (`main → reader`), it's wrong: the child has
its own explicit `tools.allow` that intentionally exposes specialty
tools the parent doesn't have. Filtering against the parent's allowlist
defeats the specialty-agent abstraction.

## Fix

Gate each `inherited*Patch` spread on `targetAgentId === requesterAgentId`,
mirroring the same-agent-only inheritance pattern used in the legacy file
for `inheritedWorkspaceDir`:

```js
// Existing precedent (legacy openclaw-tools-<hash>.js, near the patch site):
const inheritedWorkspaceDir = targetAgentId !== requesterAgentId
  ? void 0
  : toolSpawnMetadata.workspaceDir;
```

### Site 1 — legacy `sessions_spawn` path

`requesterAgentId` and `targetAgentId` are both directly in scope.

```js
// Before:
...inheritedToolAllowPatch(ctx.inheritedToolAllowlist),
...inheritedToolDenyPatch(ctx.inheritedToolDenylist),

// After:
...(targetAgentId === requesterAgentId
  ? inheritedToolAllowPatch(ctx.inheritedToolAllowlist) : {}),
...(targetAgentId === requesterAgentId
  ? inheritedToolDenyPatch(ctx.inheritedToolDenylist) : {}),
```

### Site 2 — new ACP runtime spawn (`spawnAcpDirect`, added in 6.x)

Inside `spawnAcpDirect(params, ctx)` the same two-spread bug exists, but
only `targetAgentId` is directly in scope. `requesterAgentId` is derived
on the fly from `requesterInternalKey` using the `parseAgentSessionKey`
helper already imported at the top of the file:

```js
// Before:
...inheritedToolAllowPatch(ctx.inheritedToolAllowlist),
...inheritedToolDenyPatch(ctx.inheritedToolDenylist),

// After:
...(targetAgentId === parseAgentSessionKey(requesterInternalKey)?.agentId
  ? inheritedToolAllowPatch(ctx.inheritedToolAllowlist) : {}),
...(targetAgentId === parseAgentSessionKey(requesterInternalKey)?.agentId
  ? inheritedToolDenyPatch(ctx.inheritedToolDenylist) : {}),
```

If `requesterInternalKey` is missing the derived `agentId` is `undefined`,
the equality fails, and inheritance is skipped — the conservative
"don't inherit on uncertainty" outcome, which matches the goal.

Same-agent spawns still get the privilege-inheritance guarantee.
Cross-agent spawns get a clean resolution from the target agent's own
config.

The source patch includes regressions for both spawn implementations. Each
asserts that same-agent spawns retain inherited allow/deny policy while
cross-agent spawns omit it. The shared patch lifecycle runs both files on every
change.

## How to apply / revert

Applied from source as part of the from-source deploy — `apply-and-deploy.sh`
runs `git apply subagent-cross-agent-spawn-fix.patch` against the clean OpenClaw
checkout, then builds + installs (see the patches
[`README.md`](./README.md)). To apply standalone against a checkout:

```bash
cd <openclaw-checkout>            # clean, at the target release
git apply /path/to/puddles/docs/openclaw-setup/patches/subagent-cross-agent-spawn-fix.patch
```

**Revert:** don't include the patch in the deploy (drop it from the `PATCHES`
list), or `git checkout .` the source checkout before building. Because the fix
ships in the built package, reverting is just building without the patch — there
are no in-place `dist/` backups to restore.

## Stale session entries

The fix prevents *new* subagent sessions from being constrained, but
existing session entries already on disk still have `inheritedToolAllow`
/ `inheritedToolDeny` populated. Two options:

1. **Wait it out.** Most subagent sessions are short-lived and the parent
   re-spawns a fresh one for each new task. Stale entries are harmless
   in their own session (they were already restricted) and won't affect
   future spawns.
2. **Clear them manually** (only if the stripped-down sessions are
   actively in use):
   ```bash
   # On the mini, for each affected agent:
   python3 - <<'EOF'
   import json, sys
   from pathlib import Path
   for agent in ("reader", "browser-agent"):
       p = Path(f"/Users/puddles/.openclaw/agents/{agent}/sessions/sessions.json")
       if not p.exists(): continue
       store = json.loads(p.read_text())
       changed = 0
       for k, v in store.items():
           if v.pop("inheritedToolAllow", None) is not None: changed += 1
           if v.pop("inheritedToolDeny", None) is not None: changed += 1
       if changed:
           p.write_text(json.dumps(store, indent=2))
           print(f"{agent}: cleared {changed} keys")
   EOF
   ```

## Upstream

Still worth filing — confirmed unfixed in 2026.6.1. The bug is reproducible
against any post-5.20 install where a parent agent has any restrictive
`tools.allow` and spawns a different agent as subagent. In 6.1 it now lives
in two places (the new ACP runtime duplicated the same ungated-spread
pattern), so an upstream fix needs to land at both sites.
