# Explicit cron targets and cross-agent tool policy

OpenClaw 2026.11.3 already supports `subagents.requireAgentId` in configuration
and native request admission. This patch uses that support. It does not restore
the older schema or duplicate upstream's native explicit-target check.

Two maintained differences remain. Scheduled native requests require an explicit
non-requester agent by default, and a child assigned to another agent uses that
agent's configured tool policy without inheriting the requester's allow and deny
lists. Unpatched 2026.11.3 still passes both inherited lists unconditionally to child creation in
`src/agents/subagents/spawn/subagent-spawn.ts`. Same-agent children continue to
inherit the requester's restrictions.

## Target selection

A cron request that omits `agentId`, or explicitly selects the requester under
this policy, fails before creating a child. The error lists allowed worker IDs
so a restricted caller can repair the request without access to `agents_list`.
`taskName` and `label` name a run; they do not select an agent profile. Setting
`subagents.requireAgentId=false` explicitly opts into same-agent cron children.
Normal interactive request defaults remain unchanged.

ACP starts an external coding harness instead of a native OpenClaw child.
A distinct configured ACP default remains a valid cron target. If the default
resolves to the requester, cron requires a distinct explicit target. Explicit
`requireAgentId=true` is enforced for top-level and subagent ACP requesters.
Suggested targets pass the same ACP resolution and policy checks as the eventual
request, including aliases that resolve to the requester.

## Tool policy

Native and compatible ACP cross-agent sessions omit inherited session tool
allow and deny lists. Same-agent sessions retain them. ACP also keeps its
separate requester-side command capability boundary: an external harness cannot
enforce OpenClaw's per-tool restrictions. Target resolution happens first so
invalid targets receive useful errors, but every target must still satisfy that
command capability check before ACP can start.

Stable sender restrictions remain intact: a sender-restricted requester may only
start a hidden helper of the same agent. The native delegated-policy grants,
revocation assertions, source authority, and lifecycle checks also remain intact.
Execution identity records carry the same inherited lists as child creation.

The patch does not rewrite existing sessions. Sessions created before the
upgrade can retain their previously stored restrictions until replaced by a
new child. No session-store migration is required for new spawns.

## Validation and delivery

The source regressions exercise native and ACP same-agent inheritance,
cross-agent policy, omitted and explicit requester targets, usable repair IDs,
the explicit false opt-in, configured explicit-target policy, and ACP command
restrictions. The cumulative manifest follows the stable test owners. Updated tool
descriptions also require `pnpm prompt:snapshots:gen` and the corresponding
snapshot check. The patch adapts the stable prompt snapshots and recomputes
their content hashes; the full generator must verify them on the composed source.

Run `node packages/e2e/bin/openclaw-test-env.mjs ci` against the final candidate.
The [managed patch lifecycle](./README.md) builds, validates, deploys, and rolls
back the complete artifact. This upgrade does not require changing agent
configuration or editing existing session files.
