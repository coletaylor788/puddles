# Stable upgrade and native CLI voice controls

Status: Two-phase release approved; revised upgrade compatibility scope proposed
Issue: https://github.com/coletaylor788/puddles/issues/359
Last updated: 2026-11-15

## Human section

### Design

Upgrade to **OpenClaw v2026.11.3**, use native CLI execution and remove redundant
integration patches. Preserve current integrations, sessions, permissions and
sandboxing. Finish that production release before implementing and releasing
the remaining realtime delegation and steering repair.

The release API still identifies v2026.11.3 as latest stable. Newer main contains
additional fixes, but moving main is not the proposed deployment target.

```mermaid
flowchart LR
  U[Phase 1: stable upgrade and remove redundant integration] --> D[Build and DEV]
  D --> P[Full suite, TEST, PROD, merge and cleanup]
  P --> V[Phase 2: native realtime coordination repair]
  V --> D2[Separate build and DEV]
  D2 --> P2[Separate full suite, TEST, PROD, merge and cleanup]
```

#### Phase 1: use native behavior

The registered CLI backend runs the selected local CLI using its native login.
Model configuration selects the runtime. This route is distinct from ACP and
does not require replacing native subscription authentication with API billing.
Include the approved native CLI update in the immutable application artifact;
each environment uses its own copy. Preserve the user's normal launcher and
existing sign-in profile.

| Capability | Native behavior to adopt |
| --- | --- |
| Model execution | Registered backend, model runtime selection, native authentication and session binding. |
| Tools and configured MCP | Policy-filtered OpenClaw catalog, exact run grants, server instructions and native cleanup. |
| Managed Claude file and shell tools | OpenClaw file controls and execution tools through MCP; native file/Bash tools are disabled on ordinary managed turns. |
| Steering and cancellation | CLI text injection with current-authority checks, consumption receipts and native cancellation. |
| Long shell commands | Managed exec/process handles and originating-conversation completion notifications. |
| Compaction | CLI-owned compaction and supported native manual control. Additional memory snapshot behavior remains separate. |
| Workshop | Immediate skill saves, version history, undo and native pending-draft export, preserving existing access limits. |

Stable also contains fixes for private child-completion streaming and replacement
work after a cancelled child's handoff. It does not contain newer main's unified
session controller or injected child-result context fix. Do not count those as
stable benefits or claim the complete realtime scenario is already repaired.

#### Sandbox contract and discovered gap

```mermaid
flowchart LR
  A[Admitted conversation or agent turn] --> C[Configured CLI backend]
  C --> M[Native OpenClaw MCP grant and tool policy]
  M --> F[Workspace-scoped file tools]
  M --> X[Native exec to paired container node]
  M --> I[Existing scoped integration tools]
```

Use existing features and configuration to provide sandboxed shell commands,
workspace-restricted file tools and the remaining MCP integrations. The requester
accepts either native sandbox and either shell owner. No new backend plugin,
custom routing or source patch may be added to satisfy this requirement.

Native `tools.fs.workspaceOnly: true` passed a Gateway file test: inside writes
succeed and outside writes fail. This does not contain arbitrary shell commands.
A required shell sandbox must fail closed if unavailable.

The normal bundled local CLI route replaces native Bash with mediated OpenClaw
exec. The tested stable route refuses `host=sandbox` because its coding-tool
factory lacks the prepared sandbox. This does not establish that every native
route fails. A stock configuration-only alternative passed an isolated end-to-end test:
keep the CLI and MCP on the Gateway, bind native exec to a real OpenClaw node
inside Docker, and enable workspace-only file tools. Commands ran inside the
container, outside host paths stayed inaccessible, file reads/writes stayed in
the workspace, and a configured MCP server remained usable. Other host/node
requests and a disconnected node were refused without host fallback.
Keep subscription access and native messaging/steering intact. The node mounts only its permitted workspace at the same absolute path used by
the Gateway and sets that working directory. Separate access boundaries require
separate mounts/nodes. Deny Gateway-local process and terminal controls; preserve
role allowlists and disable elevation. Remote node exec is synchronous and has no
background process handle. This tradeoff needs review before adopting the
topology. No production configuration changed. A plugin API or an upstream patch
proposal is not a configuration-only solution.

#### Native history and permission compatibility

Stable can launch Claude with a dedicated `CLAUDE_CONFIG_DIR`, but some history
readers still assume the default directory. Upstream merged
[PR #175549](https://github.com/openclaw/openclaw/pull/175549) fixes that recovery
path. The harness/history follow-up category will evaluate this native replacement
after both phases, with cold resume, history and compaction proofs. Bind the existing login root in
the Gateway environment. The upstream fix uses it only without an explicit
offline `homeDir`; check Doctor, TUI and cold/history callers before retiring
profile plumbing. It is not part of v2026.11.3. Keep credentials in their existing
native profile.

Workspace-only policy is a hard boundary. It does not reproduce our old
allow-once outside-file approval sequence. Prefer native confinement and explicit
resources over rebuilding that mechanism just to satisfy an implementation-shaped
test. Record any resulting access change before implementation. Existing
unsandboxed diagnostic access needs an explicit equivalent policy; do not
silently remove protected-path restrictions, widen it, or call it sandboxed.

#### Phase 1 patch retirement

The requester approved removing seven public test-only overlays:
`native-parent-continuation`, `sandbox-discovery-failure-fix`,
`builtin-memory-migration`, `silent-reply-completion-evidence`,
`active-memory-cold-recall`, `active-memory-fixture-cleanup`, and
`gateway-protocol-declaration-portability`.

Also remove `imessage-group-inbound-policy` (unselected behavior) and
`scoped-container-temp-root` (used only by test helpers). Native regressions stay
selected independently of patch records. Tests use native secure temporary
staging. No replacement test overlay or new runtime patch is introduced.

`talk-agent-parity` and obsolete Workshop proposal compatibility were already
retired in this candidate; do not count them again. Other audit reductions are
reserved for independent work after both phases, unless separately required and
approved for the realtime repair. Preserve their existing behavior meanwhile.

#### Deferred behavior categories

- Deployment and process lifecycle.
- Talk, realtime and FaceTime.
- Memory and compaction.
- Messaging and delegation.
- Tools, MCP and sandbox policy.
- Harness sessions, credentials and request ownership.
- Model configuration, skills and accounting.

A category is assigned only when the requester asks. Each gets its own design,
qualification and development lifecycle. A broad patch may span categories;
coordinate its consumed hunks before changing it. “Reduce” or “unproven” in the
audit does not mean unconditional removal in Phase 1.

#### CI and upgrade acceptance

Adapt CI to the new native lifecycle. DEV and TEST use normal isolated Gateway
startup and recording fixtures. Held PROD uses native startup canary behavior.
Installed plugin metadata does not establish runtime loading or authentication;
the same artifact must pass full authenticated TEST acceptance first.

Qualify the complete application: integrations, subscription login, exact tool
policy, files and shell, unavailable-sandbox refusal, session/cold continuation,
steering and cancellation, memory, compaction, migrations and cleanup. Include
ordinary, restricted and delegated execution. Test observable behavior rather
than a required Claude-native tool name. Keep unresolved permissions as failing
acceptance gates until the reviewed behavior has a durable regression.

Preserve and rebase both source branches on current main. Use installed `build`,
`ci-dev` and `ci-prod`, with retained independent review and required checks.
Yield after dispatch; CI owns deployment, full tests, TEST, backup, PROD, merge,
recovery and cleanup. A passed workflow is not a terminal deployment receipt.
Recovery keeps the current CLI baseline and never overwrites new live writes
or restores an older runtime over migrated state.

#### Phase 2: realtime coordination

After Phase 1 production, merge and cleanup close, start from that landed
baseline with a separate candidate. The repair will:

1. Route Talk through the agent's configured runtime while retaining its caller,
   session and asynchronous result ownership.
2. Connect Talk steering, coordinator guidance and child completion to the same
   native CLI execution and guarded controls. Keep one result claim and native
   continuation after yield.
3. Preserve each injected input's context and provenance so a child result is
   consumed as a completion, including while the parent is busy.

Use native sessions, controls and delivery. Do not retain the first repair's
CLI-ready switches or steering refusal, add a second message queue, or replace
steering with cancellation/restart.

Prove one continuous scenario: delegate research, keep talking, steer the same
task, and receive the corrected result proactively after completion, whether
the parent is busy or yielded. Require real native CLI execution, permissions,
no duplicate work and one result through browser and FaceTime. Repeat the full
build, DEV, TEST, PROD, merge and cleanup lifecycle independently.

### Status

**Existing approval:** Production approved in two independent phases. The
requester's 2026-11-13 instruction approved implementation and shipping within
that design, with upgrade preservation first. Native Workshop adoption and the
configured CLI update were subsequently approved. The requester also requires
sandboxing at the execution owner and retirement of redundant patches.

**Current scope:** The requester approved the test-only and confirmed redundant
patch removals on 2026-11-15. Remaining category redesigns are deferred until
after Phase 1 and Phase 2 and future requester assignment. The shell/files/MCP
investigation must use only existing features and configuration. No new sandbox
patch or backend plugin is authorized for it.

**Progress:** Public removals are implemented in source. Native regressions remain
selected, patch-suite checks pass, and the reduced paired stack composes against
the pinned stable revision. This is not a built or deployed successor candidate.
The previous installed integration group passed. The configuration-only Docker
node route passed isolated stock execution, file, MCP and failure-boundary tests.
Native policy/routing checks passed 127 tests. The reduced candidate still needs
its own build and installed qualification after configuration review. Phase 2
has not begun.

## Agent section

### Sources and findings

Stable target: `847611dcaa3bf0e2783335f961dd1fd0580e4d9f` (v2026.11.3).
The GitHub latest-release API was reconfirmed 2026-11-15. The earlier source pin
was `eb377ac59e6c9fd6c7705028034812becf00271b`. Read the pinned native
`docs/gateway/cli-backends.md`; the website fetch failed in this environment.
Newer main was inspected at `5370661901a61a4aa5c7e9f76174e50eb1ee597b`.

| Source | Use and limitation |
| --- | --- |
| [CLI backend guide](https://docs.openclaw.ai/gateway/cli-backends) | Runtime selection, managed MCP tools, isolation, sessions and compaction. Use the pinned-source copy for stable behavior. |
| [Sandbox PR #163238](https://github.com/openclaw/openclaw/pull/163238) | Open proposal for prepared sandbox capability and grant binding. Inspected head `3033c7d66ef3f2b500abe406e0e4ca4666eb15ff`; not shipped stable. |
| [History PR #175549](https://github.com/openclaw/openclaw/pull/175549) | Merged commit `08d89a8bdf54785bb869994203f43985abc7efa1`; honors config root in transcript recovery. Not shipped stable. |
| [Sandbox hooks PR #191205](https://github.com/openclaw/openclaw/pull/191205) | Embedded attempt hook metadata; distinct from the CLI coding-tool handoff. |
| [Native CLI steering #159816](https://github.com/openclaw/openclaw/pull/159816) | Stable native steering; existing focused transport and receipt tests passed. |
| [Input context #185945](https://github.com/openclaw/openclaw/pull/185945) | Newer-main context/provenance evidence for Phase 2, not an upgrade benefit. |
| [Coordinator steering #178865](https://github.com/openclaw/openclaw/pull/178865) | Main ownership/control evidence; not permission to bypass stable admission. |
| [Talk routing #164229](https://github.com/openclaw/openclaw/pull/164229) and [phone routing #191683](https://github.com/openclaw/openclaw/pull/191683) | Routing and lifetime cases; neither proves the complete approved scenario. |

The sandbox runtime reproduction used composed output. Stock causality was
checked separately: `prepare-tool-policy.ts` is unchanged at the controlling
ordinary mediation logic; `gateway/tool-resolution.ts` resolves sandbox status
without handing `SandboxContext` to `createOpenClawCodingToolsInternalAsync`;
exec rejects the absent sandbox. Native managed tool configuration accepts only
Agent/Workflow, not Bash. Do not describe the reproduction as a clean stock build.

The native delegated child-plan sandbox/CLI tests pass by denying those children.
This is a safe refusal, not successful delegated CLI execution. Do not expand
admission without a reviewed containment and authority contract.

### Patch and configuration implementation

Keep the removal list, patch order, digests and direct native regression targets
synchronized. Preserve the existing profile, configured-MCP and additive scripting
patches while their category work is deferred. Do not implement earlier proposed
shrinks or history substitutions merely because the old audit suggested them.
Keep credentials in the existing profile and protect retained recovery state.

Workshop uses native edits, version history and Doctor export. Preserve agent
access and the existing sandbox construction bridge. Retire obsolete approval
settings through the declared stopped-state migration. Talk setting retirement
is a separate exact-value migration. Keep recovery captures and bounded Doctor
execution; no manual deletion of recovery data.

### Validation and release sequence

Retain earlier successful evidence only for unchanged inputs. Local composition,
runtime/test types, plugin suites and focused native tests have passed in this
workstream. The last installed integration group passed 9/9; it did not qualify
all subscription-tool behavior. Native workspace confinement passed the real
Gateway fixture in 16.46 seconds. Docker exec was refused for lack of runtime
context. The separate configured-node route passed actual stock Gateway/MCP to
Docker-node execution, workspace file confinement, configured MCP coexistence,
host/node override rejection and disconnected-node refusal. This is isolated
route qualification, not acceptance of the rebuilt upgrade artifact.

1. Prove a documented configuration-only shell/files/MCP recipe and resolve
   delegated admission and diagnostic/workspace semantics. Do not add a plugin
   or source patch to make the recipe pass.
2. Implement approved reductions and replacements. Keep cumulative tests,
   patch order and digests coherent. Do not patch prepared distribution chunks.
3. Update fixtures for native MCP names and parameter shapes. Use Docker-visible
   paths and test-owned sentinels; verify execution location, read-only access,
   unavailable backend, revocation and absence of host fallback.
4. Requalify login, cold/warm history, policy intersections, compaction,
   continuation, integrations and existing-state migration. Keep external
   mutations and message delivery on explicit recording adapters.
5. Preserve/rebase source on fresh main, complete retained independent review,
   required checks and sealed build. Dispatch DEV and yield. Inspect actual
   terminal deployment and source cleanup before production submission.
6. CI runs full application tests, TEST, backup, PROD, exact source merge and
   cleanup. Phase 2 may start only after those Phase 1 receipts close.

CI startup adaptation remains application qualification work. Normal DEV/TEST
and held PROD canary must preserve exact artifact/configuration bindings and
read-only production checks. Never equate plugin metadata with active runtime.
The requester rejected the proposed canary profile-initialization patch; it
was not implemented. Current lifecycle details are in
[triggered CI](../../packages/release/CI.md).

### Review and approval record

The retained reviewer previously cleared composition ports, packaging, CI
startup compatibility and fixture repairs. Its newer three-patch audit found
removable profile/MCP code, a remaining history gap and no native Code Mode
replacement. Those findings inform this redraft; earlier clearance does not
approve its new sandbox backport or policy changes.

The requester's two-phase instruction remains controlling. The earlier custom
protection either/or question was withdrawn and is not an outstanding gate.
This revised proposal separates existing approval from new compatibility choices.
No phase completion or production qualification is claimed by this document.
