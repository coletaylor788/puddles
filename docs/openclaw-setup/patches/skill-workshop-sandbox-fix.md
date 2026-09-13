# Skill authoring from sandboxed agents

OpenClaw's `skill_workshop` tool writes proposed skill changes through the
gateway. It does not write through a sandbox's filesystem mount. Sandboxed
agents still need this tool because their direct skill mounts are read-only.

The patch removes only the sandbox-specific registration gate in
`createOpenClawTools()`. It keeps the required configuration check, normal
tool policy, proposal review rules, and the configured workshop factory.
Agents still need permission to use `skill_workshop` in their general and
sandbox tool policies.

## Stable release ownership

OpenClaw 2026.9.3 stores Workshop skills in one persistent collection per agent,
not under each workspace. The configured factory carries the agent identity,
session origin, review mode, and mutation budget into the tool. This patch
does not restore workspace ownership or the retired
`skills.workshop.allowSymlinkTargetWrites` setting. Upstream startup and Doctor
own migration of proven legacy skills. Ambiguous ownership remains for review.

The maintained regression creates a pending proposal from a sandboxed tool
set. It checks that the proposal is not automatically applied and that no
workspace skill directory is created. The existing suite also covers review
restrictions, apply/reject behavior, and proposal discovery across workspace
changes for the same agent.

## Validation and delivery

`src/agents/tools/skill-workshop-tool.test.ts` remains registered in the
cumulative patch manifest. Run
`node packages/e2e/bin/openclaw-test-env.mjs ci` for the final candidate.
All automated authoring and application use isolated fixture state, never
the live assistant or a real message delivery channel.

The managed pipeline applies this source patch to a detached worktree and
rehearses the installed artifact. Deploy through `apply-and-deploy.sh` with
the reviewed receipt and explicit target. Recovery restores the prior runtime,
state, and service snapshots. Do not remove the patch from a running
installation or edit generated distribution chunks.
