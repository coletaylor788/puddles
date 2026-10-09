# Claude Code harness with subscription authentication

Status: Proposed
Issue: Not created
Last updated: 2026-10-08

## Human section

### Design

Use the official Claude Code harness for eligible OpenClaw agents, authenticated
with a Claude subscription. Claude owns reasoning, its model/tool loop and native
compaction. OpenClaw keeps agent identity, conversations, tools, scheduling,
delegation and delivery. Use the existing integration and defer Claude's native
action tools so the migration preserves the current execution boundaries.

```mermaid
flowchart TB
    User["Messages and scheduled work"] --> OC["OpenClaw agent and conversation"]
    OC <-->|"Prompts and replies"| CC["Claude Code harness on trusted host"]
    CC <-->|"Subscription authentication"| Claude["Claude service"]
    CC <-->|"Allowed tool calls and results"| MCP["OpenClaw MCP bridge"]
    MCP -->|"Shell and file operations"| Docker["Existing agent Docker sandbox"]
    MCP -->|"Scoped service operations"| Services["Existing service tools"]
    MCP <-->|"Session tools and child results"| Agents["Other OpenClaw agents"]
```

#### Subscription authentication

The gateway launches official Claude Code using its programmatic interface.
This remains the Claude Code harness even though no interactive terminal is
shown. Authentication must select the signed-in Claude subscription, rather
than a Console account, API key or separately metered credit balance. Claude
owns login and credential refresh. Credentials stay outside agent workspaces.

Use a dedicated Claude configuration for the gateway. Disable extra usage and
remove conflicting authentication overrides from that runtime. Verify the
effective account and subscription route with the installed executable before
activation. This proposal includes no automatic Anthropic API backup.

#### Tools and sandboxing

Use OpenClaw's existing restricted-tool integration. It disables Claude's native
action tools and ambient customizations, then exposes the current agent's
authorized OpenClaw tools through MCP. Apply that restriction to ordinary and
resumed messages as well as scheduled and delegated turns. Merely approving
an MCP tool list does not establish that native tools are unavailable.

Claude Code runs on the trusted host. Shell and file operations still execute
through OpenClaw's configured Docker sandbox. Browser, mail and other service
tools retain their existing service boundaries; MCP does not place those
services inside Docker. Existing host-authorized roles are outside the initial
migration. No new host authority or native-tool replacement is proposed.

#### Agents and conversations

Keep existing OpenClaw agents, instructions, workspaces and session tools.
Delegation stays between OpenClaw agents, including waiting for child results.
It does not become Claude-native subagent delegation. Preserve independently
delivered reader improvements; this migration does not change reader policy or
reimplement result framing.

Select an explicit supported Claude model for each migrated role. Use Opus for
high-tier reasoning and preserve the reader's independently selected model.
Move sessions at idle boundaries and retain their conversation records. Native
session reuse and history recovery must be verified; keeping a conversation ID
alone does not prove that the model received its prior context.

#### Quality and failure behavior

OpenClaw tools have different names and behavior from Claude's native tools.
Validate tool selection, image interpretation, delegation and completion claims.
Restricted customization loading also means OpenClaw must supply the role
instructions and skills the agent needs. Check recall after compaction and
restart, including authorization details and unfinished work.

A subscription limit may interrupt a turn. Preserve the conversation and report
the interruption using existing behavior. A later message can continue work
once an eligible route is available. This proposal does not require automatic
replay of unfinished actions or uninterrupted execution.

### Status

**Approval:** Proposed. **Approval reference:** The requester asked for this
repository proposal on 2026-10-08. Scope is design documentation; implementation
and activation are not part of this change.

The upstream integration supports the proposed architecture. The exact installed
combination still needs authentication, tool-boundary and conversation tests.
No account, runtime configuration or service has been changed.

## Agent section

### State

Documentation-only proposal on `codex/claude-subscription-proposal`, based on
public revision `baad973f3c718e317925b12d38dc854baccb1975`. No implementation
or runtime validation is claimed.

### Scope and acceptance criteria

- Official Claude Code, native subscription login and stock OpenClaw integration.
- Same OpenClaw agent identity and conversation, with useful retained context.
- Exact allowed tools, sandbox execution and service permissions across all turn types.
- No harness patches, custom transport, native action tools or API-account backup.
- Account details, personal usage, capacity estimates and cost analysis remain outside this repository.

### Architecture and decisions

Use canonical `anthropic/<model>` references with model-scoped
`agentRuntime.id: "claude-cli"`. Keep executable and OpenClaw versions explicit
in the eventual release inputs. Do not use a global runtime override that
unintentionally changes other providers or auxiliary workloads.

The repository pins OpenClaw to `eb377ac59e6c9fd6c7705028034812becf00271b`.
Its [CLI backend contract](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/docs/gateway/cli-backends.md)
documents native login, restricted MCP tools, compaction and bounded history
recovery. Use its existing restriction mechanism; qualification must establish
how it applies to every migrated agent turn, not just cron examples.

Current [Claude authentication](https://code.claude.com/docs/en/authentication)
and [programmatic usage](https://code.claude.com/docs/en/headless) documentation
were checked on 2026-10-08. `claude -p` selects a programmatic interface, not a
billing route. `--bare` ignores subscription credentials and is ineligible for
this design. Recheck this contract on executable upgrades. Do not substitute
API authentication if subscription operation becomes unsupported.

Follow the existing [security architecture](../openclaw-setup/security-architecture.md)
and [agent sandbox guide](../openclaw-setup/03-openclaw-and-agent-sandboxing.md).

### Implementation

After approval, qualify one restricted role first. Configure the supported
runtime, native login and exact tool selection. Preserve independent agent
changes and existing patches. Keep roles that fail qualification on their
current route; report a stock-integration gap before proposing custom code.

### Validation

Check effective subscription authentication, fresh/resumed turns, restart and
compaction; prove native tools are absent and permitted shell/file calls use
Docker. Exercise reads, images, process handles, delegation, yield and one
recorded external action. Check denied calls and source-result protections.
Use synthetic content and recording adapters for external writes. Rehearse a
limit without repeatedly consuming real quota. The current change requires
only document, source-reference and diagram review.

### Rollout and rollback

Use the existing reviewed configuration and release lifecycle after approval.
Qualify one role before broader rollout. Preserve predecessor settings and
conversation state. Rollback restores routing and compatible runtime state
without deleting conversations. Follow the maintained release process for any
runtime artifact change; this documentation change starts no environments.

### Review log

The design separates supported upstream capability from installed proof, keeps
tool execution within existing boundaries and excludes account-specific analysis.

### Checklist

- [x] Write the proposal and verify upstream contracts.
- [ ] Approve implementation scope.
- [ ] Qualify subscription authentication and every migrated tool path.
- [ ] Validate conversation continuity, quality and recovery.
- [ ] Release eligible roles through the existing lifecycle.
