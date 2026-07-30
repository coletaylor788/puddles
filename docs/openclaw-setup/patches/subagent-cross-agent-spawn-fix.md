# OpenClaw — explicit cron targets and cross-agent tool policy

> **2026.7.1:** ported and live-verified at `0790d9f` in the maintained source
> patch `subagent-cross-agent-spawn-fix.patch`.
>
> **2026.6.11:** re-ported to a **source** patch
> (git-diff against the OpenClaw checkout, applied by `apply-and-deploy.sh` + built from
> source). The old `apply-*.mjs` dist chunk-surgery is retired. Verified on 2026.6.11
> (a reader subagent spawned from `main` receives its own full tool set).
>
> **2026-07-29:** scheduled native subagent calls, and ACP calls whose configured
> default resolves to the requester profile, now require an explicit `agentId` by
> default. This prevents unattended jobs from silently spawning a restricted
> same-agent child while preserving distinct `acp.defaultAgent` routing.
>
> **2026-07-30:** cron requesters under explicit-target policy also reject an
> explicit requester-profile target. Denials list allowed non-requester IDs
> directly, so least-privilege jobs can repair the call even when `agents_list`
> is unavailable. `requireAgentId=false` remains the intentional same-agent cron
> opt-in.

**Source diff:** `subagent-cross-agent-spawn-fix.patch` (git-diff against the
OpenClaw source; applied by `apply-and-deploy.sh`, then built from source).
**Retired patcher:** `apply-subagent-cross-agent-spawn-fix.mjs` (dist chunk-surgery).
**Target source (2026.7.1-2):** both spawn sites — the native `sessions_spawn`
path and ACP-runtime spawn (`spawnAcpDirect`). In 5.20 there was only one site.
**Verification:** OpenClaw 2026.7.1 and 2026.6.11 live (also 2026.5.20 and
2026.6.1 under the retired patcher).

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

A second failure mode appears in unattended cron runs. `agentId` is optional in
the `sessions_spawn` schema, while `taskName` is only a stable handle. If a model
calls `sessions_spawn(taskName="email_reader", ...)` without
`agentId="reader"`, OpenClaw silently defaults to a same-agent child. A
least-privilege cron `toolsAllow` then propagates to that child, so it cannot use
the reader profile's tools. Interactive runs that explicitly target `reader`
continue to work.

The initial explicit-target guard still left a repair gap. In the landed Daily
Email Triage run, the model omitted `agentId`, received the expected denial, and
then retried with `agentId="main"` while keeping label `email-reader`. The
explicit same-agent target was accepted and inherited the cron's mutation-only
policy. The denial recommended `agents_list`, but that least-privilege cron does
not expose the tool, so the error did not provide a usable target.

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

Inside `spawnAcpDirect(params, ctx)` the same two-spread bug exists.
`requesterAgentId` is already resolved from either
`requesterAgentIdOverride` or the parsed requester session key, so it also
handles global session scope where the key itself carries no agent ID:

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

Same-agent spawns still get the privilege-inheritance guarantee.
Cross-agent spawns get a clean resolution from the target agent's own
config. Global-scope requests use their explicit requester override for the same
comparison.

ACP command-tool compatibility remains a requester-side security boundary.
The `sessions_spawn` wrapper forwards inherited policy to `spawnAcpDirect`,
which resolves the effective target before rejecting requester allow or deny
rules that would withhold ACP's required host command tools. This applies to
every ACP target because an external harness cannot enforce an OpenClaw target
profile's tool policy. Compatible cross-agent ACP calls still omit inherited
session policy, while native cross-agent children use their target profile.

For native subagents requested from a cron run, omitted `agentId` now fails
before child creation. Explicit requester-profile retries fail under the same
policy. Both denials include configured non-requester target IDs directly and
state that `taskName` and `label` do not select a profile. ACP cron calls apply
the omitted-target default only when `acp.defaultAgent` resolves to the requester
profile; explicit requester IDs are caught before native-profile/runtime mismatch
errors, and suggested ACP targets are filtered through ACP target resolution and
agent policy. Config aliases whose resolved harness is the requester are also
excluded, so every advertised repair target can cross the self-target boundary.
A distinct ACP harness default remains valid. An explicit
`subagents.requireAgentId=false` setting opts into both implicit and explicit
same-agent cron children.

ACP now enforces configured `requireAgentId=true` consistently for top-level and
subagent requesters, regardless of the default harness. ACP-disabled policy
errors still take precedence over target-selection errors.

The source patch includes regressions for both spawn implementations. They
assert that same-agent spawns retain inherited allow/deny policy, compatible
cross-agent ACP spawns omit inherited session policy, incompatible ACP
requester policy is rejected for every target, ambiguous cron spawns fail before
creating a child, explicit requester-profile repair is denied with usable worker
IDs, the explicit false override remains available, an explicit cron `reader`
spawn keeps the reader policy, and the tool schema distinguishes `taskName` from
`agentId`. Native and ACP regressions replay omitted target, explicit requester
retry, and explicit worker success. The patch also carries
the regenerated Codex dynamic-tool JSON and Markdown prompt snapshots affected
by the schema descriptions. The shared patch lifecycle runs every changed test
file and `prompt:snapshots:check` after applying the complete patch stack.

Before promoting on an existing installation, ensure every coordinator that
uses explicit targeting includes itself in `subagents.allowAgents`. For the
documented `main` profile, preserve all current worker targets and add `main`,
then set `requireAgentId: true`. Verify only that subtree before deployment:

```bash
set -euo pipefail
CURRENT_SUBAGENTS="$(openclaw config get 'agents.list[0].subagents' --json)"
printf '%s\n' "$CURRENT_SUBAGENTS"
UPDATED_ALLOW="$(
  printf '%s' "$CURRENT_SUBAGENTS" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);if(!Array.isArray(v.allowAgents)){console.error("agents.list[0].subagents.allowAgents is unset; merge agents.defaults.subagents.allowAgents explicitly before promotion");process.exit(1)}process.stdout.write(JSON.stringify([...new Set(["main",...v.allowAgents])]))})'
)"
openclaw config set 'agents.list[0].subagents.requireAgentId' true --strict-json
openclaw config set 'agents.list[0].subagents.allowAgents' \
  "$UPDATED_ALLOW" \
  --strict-json
openclaw config get 'agents.list[0].subagents'
```

Strict shell error handling prevents a failed read, derivation, or leaf update
from continuing. The restrictive `requireAgentId` setting is written first, so
a later allowlist failure leaves delegation fail-closed rather than newly
permitting implicit self-spawn. The derived array preserves every existing
target and adds `main` idempotently.
If the per-agent allowlist is absent, the command stops before any mutation:
inspect `agents.defaults.subagents.allowAgents`, copy every inherited target into
the explicit per-agent array, add `main`, and rerun the leaf-level commands.
Never replace the whole `subagents` object: it may contain additional targets or
settings. This policy change is separate from the cron definition and does not
alter any scheduled job.

The runtime's automatic default applies to the immediate cron session key. A
same-agent child has a normal subagent key, so downstream delegation still uses
normal subagent policy. With `requireAgentId: true`, the immediate cron requester
cannot create that same-agent child even when its own ID remains in `allowAgents`
for interactive coordinator use.

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
are no in-place `dist/` backups to restore. If promotion also set
`requireAgentId: true`, restore the previously recorded `subagents` object after
installing the prior package.

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
