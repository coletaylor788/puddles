# OpenClaw patch: make `skill_workshop` available to sandboxed agents

**Status:** Verified on OpenClaw 2026.6.1.
**Patcher:** `apply-skill-workshop-sandbox-fix.mjs`
**Backup suffix:** `.bak.skillworkshop` (beside the patched file)
**Idempotency marker:** `FIX-SKILL-WORKSHOP-IN-SANDBOX` (`/* FIX-SKILL-WORKSHOP-IN-SANDBOX */` in patched code)

## What this patches

One file, one mechanical change:

| # | File (signature) | Change |
|---|---|---|
| V1 | `openclaw-tools-*.js` (signature `...options?.sandboxed ? [] : [createSkillWorkshopTool(`) | Drop the `options?.sandboxed` gate so the `skill_workshop` tool is registered for sandboxed agents too. |

## Why this exists

OpenClaw 6.x replaced direct skill editing with a proposal-based flow
backed by a new `skill_workshop` tool. The intended workflow:

1. Agent calls `skill_workshop create` (or `update`/`revise`) with a draft
2. Gateway writes a proposal record to `~/.openclaw/skill-workshop/...`
   (host-side state dir; outside any sandbox bind mount)
3. Owner reviews the proposal (control UI or another agent turn)
4. Agent or owner calls `skill_workshop apply <id>`, which writes the
   approved content into `<workspace>/skills/<id>/SKILL.md`

The same release also made the `<workspace>/skills/` bind mount inside
every sandbox **read-only**, with no user-config opt-out:

```js
function resolveReadOnlyWorkspaceSkillMounts(params) {
  if (params.workspaceAccess !== "rw") return [];
  return [
    { hostPath: join(params.agentWorkspaceDir, "skills"),
      containerPath: containerJoin(params.workdir, "skills") },
    { hostPath: join(params.agentWorkspaceDir, ".agents", "skills"),
      containerPath: containerJoin(params.workdir, ".agents", "skills") },
  ].filter(/* ... */);
}
```

So a sandboxed agent that tries `write /workspace/skills/foo/SKILL.md`
gets `EROFS: read-only file system`. The proposal flow is the only path.

**The bug:** `skill_workshop` itself is gated on `options?.sandboxed`
being falsy. In `createOpenClawTools()`:

```js
...options?.sandboxed ? [] : [createSkillWorkshopTool({
  workspaceDir,
  config: resolvedConfig,
  agentId: sessionAgentId,
  origin: { /* ... */ }
})],
```

So an agent with `sandbox.mode: "all"` — the secure default, and the
only sensible setting for an agent that handles untrusted inbound
messages — never gets the tool registered in its runtime. The agent's
config can list `skill_workshop` under `tools.allow` all day; the tool
literally doesn't exist in that runtime, and the policy pipeline emits:

```
[tools] agents.<id>.tools.allow allowlist contains unknown entries (skill_workshop).
        These entries are shipped core tools but unavailable in the current
        runtime/provider/model/config.
```

Net effect: **the supported skill-authoring path is dead for the only
agent shape that actually receives skill-update-motivating messages**.
Skill files become unmaintainable from inside the assistant — the owner
has to hand-edit them on the host.

## Why removing the gate is safe

`skill_workshop` is a host-side tool: every action runs in the gateway
process via the tool factory, not via shell/FS inside the sandbox.

- **`create`/`update`/`revise`** write proposal files to
  `resolveStateDir(env)` → `~/.openclaw/skill-workshop/...`, which is
  outside any sandbox bind mount.
- **`list`/`inspect`** read from the same state dir.
- **`apply`** invokes `applySkillProposal()` in-process and writes the
  resolved SKILL.md via host-side fs operations.
- **`reject`/`quarantine`** mutate proposal records in the state dir.

None of these operations grant the sandboxed agent any new direct-FS
access. The sandbox FS isolation is enforced by Docker bind-mount
read-only flags, which are unaffected by which tools the agent can call.
The only thing the gate accomplishes is preventing sandboxed agents
from authoring proposals at all — which is the dead-path failure mode
above.

The gate looks like a leftover safety check from before the proposal
flow existed (when "skill editing" meant direct file writes and you'd
want to deny it from sandboxed agents). With proposals replacing
direct writes, the gate is now strictly counterproductive.

## What the patch does

Rewrites the ternary so the spread always includes the tool:

```diff
-        ...options?.sandboxed ? [] : [createSkillWorkshopTool({
+        /* FIX-SKILL-WORKSHOP-IN-SANDBOX */ ...[createSkillWorkshopTool({
           workspaceDir,
           config: resolvedConfig,
           agentId: sessionAgentId,
           origin: { /* ... */ }
         })],
```

All surrounding context (`workspaceDir`, `sessionAgentId`,
`skillWorkshopSessionKey`, etc.) is already computed above the gate
regardless of sandbox state, so the tool factory has everything it
needs.

## Agent allowlist changes (paired requirement)

The patch only makes the tool registrable. The tool then flows through
the agent's tool-policy pipeline, which has **two distinct allowlists**
that both have to include `skill_workshop` for a sandboxed agent to
actually see it:

1. **`tools.allow`** — the agent's general allowlist. Required for any
   tool to be available.
2. **`tools.sandbox.tools.alsoAllow`** — the *additional* allowlist that
   applies when the agent runs sandboxed. Without it, the
   `sandbox tools.allow` pipeline step strips `skill_workshop` even
   after the patch makes the runtime register it (visible in
   `gateway.log` as `tool policy removed 1 tool(s) via sandbox
   tools.allow: skill_workshop`).

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": [
            /* ... existing entries ... */,
            "skill_workshop"
          ],
          "sandbox": {
            "tools": {
              "alsoAllow": [
                /* ... existing entries ... */,
                "skill_workshop"
              ]
            }
          }
        }
      }
    ]
  }
}
```

After the patch plus both allowlist changes, the agent can author
proposals and (since proposal+apply are actions on the same tool) apply
them in the same turn if you trust it to self-apply. If you want a
human-review step between create and apply, use `skill_workshop list`
and `skill_workshop apply <id>` from a separate session.

## Tested versions

| OpenClaw version | Status |
|---|---|
| `2026.6.1` | ✓ verified on mini — sandboxed main agent now lists `skill_workshop` in available tools, can create + apply proposals end-to-end |

The patcher discovers the target file by content signature
(`...options?.sandboxed ? [] : [createSkillWorkshopTool(`), not by
hash-suffixed filename, so it tolerates rebuilds within the same
release. Fails loudly if the signature changes (upstream refactor) or
matches multiple files (ambiguous discovery).

## How to apply

```bash
node /path/to/puddles/docs/openclaw-setup/patches/apply-skill-workshop-sandbox-fix.mjs \
     ~/.npm-global/lib/node_modules/openclaw/dist
```

Then clear the compile cache and restart:

```bash
rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

(Or just run `./apply-and-deploy.sh` for the full pipeline.)

## How to verify

After apply + gateway restart:

```bash
grep -c "FIX-SKILL-WORKSHOP-IN-SANDBOX" \
  /Users/puddles/.npm-global/lib/node_modules/openclaw/dist/openclaw-tools-*.js
# expect: 1
```

The pre-existing `tools.allow allowlist contains unknown entries
(skill_workshop)` warning should disappear from `gateway.err.log` on
subsequent restarts (the tool is now registered, so it's not "unknown"
in the agent's runtime anymore).

Functional test: ask the sandboxed agent (e.g. over its main channel)
to make a trivial update to an existing skill. Expected behavior:

1. Agent calls `skill_workshop create` (or `update`) with revised content
2. Agent calls `skill_workshop apply <id>`
3. Proposal appears at `~/.openclaw/skill-workshop/proposals/<id>/`
4. The real `<workspace>/skills/<id>/SKILL.md` reflects the change

## How to revert

```bash
DIST=/Users/puddles/.npm-global/lib/node_modules/openclaw/dist
for F in "$DIST"/*.bak.skillworkshop; do cp "$F" "${F%.bak.skillworkshop}"; done
rm -rf ~/.openclaw/tmp/node-compile-cache/v*-arm64-*/*
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

You'll probably also want to drop `skill_workshop` from the agent's
`tools.allow` to silence the "unknown entries" warning.

## Upstream fix path

The cleanest upstream fix is to delete the `options?.sandboxed` gate in
`createOpenClawTools()` outright. Every `skill_workshop` action is
gateway-routed and proposal-based; there's no sandbox-escape risk to
gate against. If preserving the gate as a defense-in-depth knob is
desired, it should at minimum be controlled by an explicit config key
(e.g. `agents.<id>.tools.skillWorkshop.allowSandboxed`) defaulting to
`true`, rather than being hardcoded to deny.

Until the upstream change lands, this patch keeps sandboxed agents able
to author skills.
