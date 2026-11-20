# Claude child sandbox prototype

Status: DEV prototype passed; no production release
Issue: Local prototype; no release submission
Last updated: 2026-11-20

## Human section

### Design

Keep the existing CLI sandbox handoff patch and remove the child rejection for the bundled Claude CLI path. The Gateway and Claude CLI stay on the host. File and shell tools use the existing native Docker sandbox and MCP permission grants. Native child orchestration, tool policy, process handling and cleanup remain unchanged.

This prototype changes the same maintained patch at hidden child creation, visible child creation and execution-time admission. Other CLI backends remain rejected. It tests whether the existing preparation and tool restrictions suffice; it does not add a new sandbox system or delegation layer.

### Status

**Approval:** DEV approved. **Approval reference:** The requester asked on November 20 to prototype the existing PR-based patch with just the child check removed, as a narrow expansion of the same patch. This authorizes isolated local/DEV implementation and testing. Production changes and release qualification are outside this prototype.

The prototype passes on the existing composed 11.5 source. The unchanged candidate reproduced the refusal. With only three Claude-specific admission exceptions, real Claude spawned hidden and visible children, executed their tools in Docker, returned their results to the parent and resumed a child with containment intact. No production service or configuration changed.

## Agent section

### State

- Isolated public branch: `codex/claude-child-sandbox-poc`.
- Assigned public base: `16dd812c3400138100b7c1c65550d4ec1fe472e0`.
- Composed baseline is captured before prototype changes. Operational paths and receipts remain local.

### Scope and acceptance criteria

- Reproduce the baseline child rejection.
- Admit Claude hidden and visible children through existing native orchestration.
- Prove inside writes and shell execution, outside read/write and symlink refusal, no host exec override, network-none Docker policy, child completion/resume and process behavior where supported.
- Prove missing required Docker fails without a host effect.
- Retain non-Claude rejection and native permission/grant checks.
- Distinguish deterministic protocol tests from real provider qualification.

### Architecture and decisions

- Existing `cli-sandbox-handoff.patch` owns the expansion; no additional patch or production protocol.
- Exact provider exemption is experimental. The prototype must not be interpreted as general third-party CLI approval.
- Child and current sandbox/tool authority remain owned by existing runtime code.

### Implementation

- Narrow Claude exception in hidden/visible creation and execution-time guard.
- Update affected admission regressions and register them with the existing patch.
- Test fixtures drive real installed Gateway, MCP and Docker paths with synthetic data.

### Validation

- Unchanged installed baseline: three native child refusals reproduced.
- Modified runtime: build completed; final formatted source passed 106 focused tests across admission, execution and sandbox preparation. Patch manifest passed six checks; formatting and diff checks passed.
- Same-patch integration: reverse the original handoff patch from the composed baseline, apply the expanded handoff patch, and compare the resulting index with the prototype working tree: exact match.
- Real Gateway/MCP/Docker, deterministic CLI protocol: hidden worker, visible worker and file-only reader complete. In-workspace files and Docker shell commands succeed. Outside reads/writes, symlink access and gateway-host exec override are rejected. Native tools are disabled. Background process polling and same-native-session resume pass. Missing image fails before CLI tool execution, with no host fallback or marker effect.
- Real Claude CLI with the existing Mini native subscription: distinct hidden and visible children run exact container checks and write markers; outside reads fail without content disclosure; native Bash/file tools are absent from actual tool traces. Child results appear in the parent's native final answer. A resumed hidden child repeats the container check and outside-read refusal. The completed delivery rerun also verifies its fresh result marker in a later parent native reply and parent chat history. All three registry records reach delivered status/disposition, cleanup completion and no pending requester wake before shutdown.
- Selected containers have network disabled and a read-only root. Mount inspection shows only test workspaces and native skill projections, with no Gateway home, credentials or Docker socket.
- Test Gateways and containers are gone and the temporary GUI launch job is unloaded. Compact local receipts retain exact patch hashes and synthetic native transcripts.

Limits: this proves the selected Docker/Claude configuration, not all backend or runtime-switch permutations. The full composed release suite, grant-revocation race matrix and production lifecycle remain unqualified. The deterministic mock does not implement all continuation behavior; real Claude supplies parent-result evidence. The earlier teardown gap is closed: the unchanged runtime was rerun with explicit delivery waits, all announcements completed, no announcement errors occurred through shutdown, and the test exited 0.

### Rollout and rollback

Local prototype only. No production service, configuration or credential changes. Dispose only test-owned processes, containers and scratch state; retain candidate patch and compact evidence.

### Review log

Retained independent reviewer found no concrete containment escape in the narrow exceptions. Review corrected missing-image and resumed-tool assertions, confirmed visible-child inherited tool caps, and required native hidden/visible topology plus matched tool-result evidence. Final evidence review is retained with the local receipts. The delivery rerun matches the original runtime and dependency hashes; no additional runtime patch was needed.

### Checklist

- [x] Specific patch expansion approved for prototype.
- [x] Baseline and positive runtime proof, including real Claude.
- [x] Negative sandbox checks.
- [x] Retained review and cleanup.
