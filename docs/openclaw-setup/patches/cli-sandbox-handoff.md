# CLI tools in the native OpenClaw sandbox

Managed CLI turns call OpenClaw file and shell tools through its MCP bridge.
Stable v2026.11.5 lacks the prepared sandbox at this boundary. This patch binds
the existing native workspace/sandbox owner to the host-only MCP grant and coding
tool factory. The Gateway and CLI remain on the host; native Docker supplies
file and shell containment. Existing exec/process handles, background completion,
policy and MCP integrations remain. No additional node or delivery layer.

Prepare only for effective coding selections. Fail closed on missing required
sandbox or unmarked mutation bridges. Retain full native projected roots and
owner disposal. Preserve delegated admission restrictions for other CLI providers
and all existing cron restrictions.

Adapted from upstream PR #163238 head
3033c7d66ef3f2b500abe406e0e4ca4666eb15ff. All 13 accessible review-comment versions
were assessed on 2026-11-15. The following ledger records each concrete finding.

## All technical findings

Repeated labels, security summaries and checklist entries in the edited comment are grouped with their underlying finding below. Dates identify the earliest accessible detailed feedback.

| Feedback | Disposition against stable and the local port | Required proof |
| --- | --- | --- |
| Initial guard-only patch removes restricted CLI coding tools (Oct 2) | Incorporate the proposed functional repair, not merely the interim denial. Prepare and retain the actual sandbox and supply it to coding-tool construction. Missing required context must still refuse host fallback. | An admitted CLI turn has usable sandbox file/shell tools; missing context cannot construct host coding tools. |
| P1 revalidate the MCP grant at the sandbox mutation boundary (Oct 4 06:58) | Accept. Session/backend ownership is not the exact invocation's grant authority. Capture the existing invocation guard and pass it through every awaited bridge operation. A post-write wrapper check is too late. | Revoke/replace the grant while path checks wait. Reject before any filesystem effect, with the broader session owner still live. |
| P2 avoid provisioning for empty/non-coding selections (Oct 4 06:58) | Accept. Do not use the existence of a finite cap as the provisioning condition. Use the native coding-tool selection semantics, including aliases/groups/wildcards. Empty and message-only turns must survive an unavailable Docker backend. | Empty cap, non-coding cap and disabled-tools cases do not call provisioning and retain their prior behavior. |
| P1 carry the fence through backend preparation to final launch (Oct 4 07:32) | Accept and preserve the PR fix. Checking before `runCommand` is insufficient if engine validation, SSH setup or session creation later awaits. Pass the same callback to the actual launch immediately after those awaits. | Docker engine-target wait and remote SSH/session wait can be held, authority revoked, then released with no command dispatched. Cleanup joins created sessions. |
| P1 bundled custom bridges must enforce the callback (Oct 4 07:32) | Accept. OpenShell mirror and MXC cannot simply accept a new optional argument and ignore it. Every advertised mutator must check after awaited root/setup work and at its actual effect. | Real bridge methods exercise write, exclusive create, mkdir, remove, rename and copy where supported. False capability declarations must not pass tests. |
| P1 OpenShell mirror backend operations lose the fence (Oct 4 16:56) | Accept and preserve the PR fix. The mirror wrapper must retain `enforcesMutationFence`, forward the callback to remote sync/mkdir/remove/rename, and check before upload after provisioning/seeding/remote mkdir. Preserve the existing lease spanning local mutation and remote publication. | Revoke before local write: neither side changes. Revoke after local write but before upload: remote remains unchanged; report the existing local effect honestly. No replay or claimed rollback of a completed write. |
| P1 every sandbox apply_patch mutation needs the captured fence (Oct 4 16:56) | Accept. `src/agents/apply-patch-file-ops.ts` must forward its existing captured assertion on write, exclusive create, remove and mkdir. An entry check alone does not cover bridge awaits. | Hold each mutation's awaited preparation, revoke, release, and prove no new effect. Preserve atomic/exclusive creation and partial-patch failure behavior. |
| P2 host test bridge advertises but does not honor fencing (Oct 4 16:56) | Accept if that helper is used or declares the capability. `src/agents/test-helpers/host-sandbox-fs-bridge.ts` must check after optional mkdir and immediately before write/copy/create/rename, including `mkdir:false`. | Regression proves a retained helper tool cannot write after revocation. This is necessary fixture fidelity, not a substitute for real Docker proof. |
| P1 prepare every effective mediated coding selection (Oct 4 17:18) | Accept together with the empty-selection optimization. Cover runtime caps, explicit `cliToolAvailability.openClaw`, default backend `hostOwnedTools`, and trusted completion selections. The ordinary default Claude shell case is a required positive case. | Actual preparation plus native projection produces the intended tools for each selection. Finite caps remain exact and non-coding cases remain unprovisioned. |
| P1 default bridge cannot vouch for an unmarked backend (Oct 4 22:09) | Accept and preserve the final PR getter. If a plugin supplies `runShellCommand` but no custom bridge, the default bridge must derive capability from that backend. Only its built-in runner can make its own declaration. | An unmarked backend using the default bridge loses mediated mutation tools, while read access stays confined. A marked backend actually consults the callback at launch. |
| P2 preserve literal tilde MXC removal (Oct 8) | Accept, but do not copy the flawed upstream replacement. Stable `removePathWithinRoot` already accepts `assertBeforeMutation`. Keep that existing helper and pass the callback. It preserves canonical `./` handling instead of allowing `Root.remove` to interpret `~/note.txt` as home-relative. | Delete a literal workspace `~/note.txt`; leave an outside sentinel intact; revoke before deletion and retain the workspace file. |
| P2 preserve MXC recursive traversal semantics (Oct 8) | Accept with the same minimal helper retention. Do not replace stable's walker with dependency defaults of depth 64 / 100,000 entries. Keep `recursive`, `force`, symlink and authority behavior. | Existing removal suite plus a subtree deeper than 64. Missing-path force/non-force and mid-removal authority refusal retain their established behavior. |
| Restore original intent of MXC removal / PR 97086 | Resolved by retaining `removePathWithinRoot`, not by arguing the feature is unused on the current host. Public bundled backend behavior still matters. | Verify exact existing helper and tests remain selected; no custom parallel remover. |

## Decisions, proof requests and non-code feedback

| Feedback | Disposition |
| --- | --- |
| Owner decision on immediate fail-closed bridge cutover | Preserve the documented contract in the approved handoff patch. Unmarked third-party bridges cannot receive mediated write/edit/apply_patch merely to keep compatibility. Keep additive optional type fields so older plugins still load; reads remain confined, mutation availability changes explicitly. Document this before release, inventory the selected backend, and test an unmarked plugin/default bridge. No claim that all third-party bridges have been upgraded. |
| Preparation-time provisioning failures / recovery of existing jobs | Required behavior: selected sandbox coding work fails if its required sandbox cannot start, without host fallback. Empty/non-coding turns must not acquire this failure. Prove missing-image failure, retry after fixing the fixture image, existing-session reuse and cleanup. No new persistent migration follows from this alone. |
| Real authority-chain proof, including revocation during backend awaits | Still required for our exact integrated artifact. Upstream body reports useful real Docker, real SSH with a stubbed control plane, and MXC bridge-on-Linux results. These do not qualify our port. Include fresh/existing workspaces, outside roots, exact invocation replacement, final dispatch and cleanup. |
| CLI/cron end-to-end proof gap | Keep open until locally qualified. Upstream explicitly did not run live CLI or cron. Use an actual prepared Gateway and CLI protocol route for direct/nested tool execution, then real configured Claude qualification where required. For cron/delegated paths, first check stable admission: a deliberate native sandbox-CLI rejection must remain a refusal unless changing it is explicitly within scope. Do not claim this patch makes a rejected path work. |
| OpenShell service and Windows MXC process-container proof absent | Disclose as platform validation limits, not proof of a Docker failure. Test shared changed backend/bridge contracts. Do not advertise those platforms as installed-qualified from a Linux filesystem or stubbed OpenShell control-plane run. |
| Automated stored-data/model migration warning in intermediate review | Dismiss as a false positive for this patch's transient callback/capability fields. No changed on-disk format is present in the reviewed upstream diff. Preserve existing jobs/configuration through behavior tests; do not invent a schema migration. If the actual port adds persisted fields, reassess. |
| Current-main merge conflict / fresh integrated review | Translate to our actual target: port against exact stable plus the accepted patch composition, not an unrelated current-main merge. Preserve stable ownership APIs and all prior overlay behavior. Strict full composition, source/export review, relevant runtime/test types and installed proofs remain mandatory. |
| Upstream security-sensitive approval and review bot commands | Informational upstream workflow only. Do not post commands, request upstream merges, or use upstream bot status as local authorization. Current requester approval applies to the one handoff patch. |
| Labels, numeric review ratings and earlier `needs proof` status | Historical summaries, not extra requirements. Their concrete defect/proof content is covered above. The latest review accepts scoped production-boundary evidence but still rejects the two removal regressions. |

## Stable-specific integration obligations

These are derived from the exact target APIs, not new upstream feature requests.

1. **Retain the complete workspace owner.** Stable has no `src/agents/rooted-run-params.ts`. Its `src/agents/workspace-sandbox.ts:125` returns effective workspace/cwd, session permission root, sandbox and `[Symbol.dispose]` (around line 203). The PR helper extracts only `.sandbox`. A direct transplant into stable would drop owner disposal and projected-root data. Retain the native result, supply the correct effective roots, register disposal before subsequent fallible work, and release exactly once on preparation failure, normal completion, cancellation and late errors. Do not dispose a shared backend/container outright when the native owner only releases a lease.
2. **Keep sandbox capabilities host-only.** Store the prepared owner/reference outside `McpLoopbackRequestContext`, serialized child settings, prompts and tool JSON. Pass it from the real minting producer through the grant store to `mcp-http` and native tool resolution. A caller-supplied object is not authority. Preserve run/grant identity and current assertions through cached tools and Code Mode.
3. **Reuse current mutation authority.** Stable `src/gateway/tool-resolution-authority.ts` distinguishes preparation cancellation from invocation lifetime. Carry the exact invocation assertion rather than a one-time config/owner check or captured request abort alone. Stable `src/infra/fs-safe-remove.ts:106` already supports the required removal callback and its own path pinning.
4. **Preserve the current grant/Code Mode path.** The existing Claude Code Mode patch adds host skill readers, exact grant fields and single before-tool-hook preparation. New sandbox plumbing must not spread away tool metadata, bypass the native preparer, add a second hook, resurrect a stale cached tool, or widen `toolsAllow`. Direct and nested calls must reach the same sandbox-bound tools and current authority.
5. **Preserve backend preparation cleanup.** `src/agents/cli-runner/prepare.ts` uses `sequenceCliCleanups`, `cleanupPreparedResources`, and a preparation-failure cleanup catch. Integrate the owner into that existing chain, including failures before grant minting or backend preparation finishes. Do not let a later cleanup assignment overwrite sandbox disposal.
6. **Keep admission changes scoped.** The November 20 requester authorization permits production rollout of the tested three Claude child exceptions described below. Only bundled Claude is exempted at hidden spawn, visible spawn and execution-time admission. Other CLI backends and cron retain their existing refusal. Existing sandbox preparation, native-tool restriction and MCP authority checks remain required.
7. **Keep builtin compatibility while failing closed for unmarked bridges.** Changes to shared bridge interfaces touch Docker/Podman, remote shell, OpenShell and MXC even though the configured backend is Docker. Preserve existing root/path/rename/removal semantics and wrapper capability propagation. A minimal adapter is preferable to replacing native implementations.

## Native 11.5 adaptation

The port follows the native combined write/create operation, which now creates
parent directories itself. It passes the same captured assertion through that
operation rather than restoring a separate mkdir stage. The remote shell handle
type now lives with its bridge. Prepared sandbox custody still stays on the
host and is released through the native CLI resource stack.

The test-only host bridge now checks the callback after parent preparation and
immediately before each filesystem effect. Its dedicated regression is registered
with the native agents-support project. This fixture behavior does not establish
installed Docker containment.

## Qualification and retirement

Register patch regressions in the cumulative suite. Qualify real CLI/Gateway
Docker execution, workspace files, direct/nested MCP, background exec/process,
read-only and unavailable sandbox, authority revocation and native cleanup.
Upstream test reports do not qualify this local artifact. Shared bridge tests
do not constitute deployed Windows or OpenShell service qualification.

Use installed build, ci-dev and ci-prod. CI owns tests, deployment, recovery,
source merge and cleanup. Retire the patch when a stable release supplies the
same guarantees and passes the retained behavior tests.

## Approved Claude child expansion

The requester authorized the isolated prototype on November 20 and then
approved adding the tested three exceptions to this patch and rolling it out.
See the [prototype evidence](../../plans/claude-child-sandbox-poc.md) and
[Phase 2 release plan](../../plans/realtime-cli-steering-and-results.md).
Production approval covers the narrow expansion; combined CI qualification
remains required.

The only new production conditions exempt `claude-cli` from the hidden-child,
visible-child and execution-time refusal. Existing delegated tool policy,
prepared sandbox custody, MCP grants and native cleanup perform the work.
Other CLI providers and cron retain their guards. No node execution mode,
new tool bridge or child-specific sandbox implementation is added.

The deterministic Gateway/Docker prototype passes hidden and visible child
work, constrained file-only child tools, resume, background process polling,
outside read/write and symlink refusal, host-exec override refusal, and missing
sandbox-image failure without a host fallback. The selected containers have
network disabled and a read-only root. The final focused suite passes 106
checks across three test files. Real Claude also passes hidden/visible child execution, parent-result delivery
and resumed tool containment with the existing native subscription. The full
composed release suite remains a separate release gate. See the prototype
plan for the exact limits. The follow-on announcement teardown gap is now
closed by a rerun that waits for durable delivery and the parent-visible
resumed result before shutdown.

Visible children inherit the requester's tool cap. A spawn-only requester
correctly yields a visible child with no coding tools; sandbox admission must
not bypass that policy. The positive fixture explicitly permits those tools
on the parent and child.
