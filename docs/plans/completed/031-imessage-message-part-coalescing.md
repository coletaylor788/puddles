# Coalesce iMessage message parts

**Status:** Complete
**Issue:** None recorded
**Last updated:** 2026-09-26

## Human section

### Design

Messages can split one composition into a short lead-in, link or image, and final text. The channel adapter uses the existing inbound bucket to combine only related direct-message parts from the same account, conversation and sender. It then starts one ordinary agent turn with normal automatic reply delivery.

A likely lead-in starts one bounded deadline. A matching payload and linked final text may join until that deadline; neither extends it. Standalone payloads and unrelated complete messages go through promptly. Groups, reactions and outgoing echoes do not enter this direct-message composition path.

### Status

The coalescing behavior is implemented and enabled on the Mini. The original immediate flush after the first matching payload evolved into a fixed deadline so trailing text can join. This record describes that delivered behavior. The maintained stable-release patch preserves it as well.

## Agent section

### State

Completed channel behavior. The 2026-09-26 audit found the installed classifier and per-conversation ingestion chain, and `channels.imessage.coalesceSameSenderDms` is true.

### Scope and acceptance criteria

- Coalesce lead-in, related URL/image and linked trailing text into one turn.
- Keep account, conversation and sender isolation, row replay protection, source IDs, attachment and text limits.
- Do not combine unrelated rapid messages or steer a new visible message into an already active reply.
- Preserve immediate standalone payload dispatch and normal reply delivery.

### Architecture and decisions

- `docs/openclaw-setup/patches/imessage-message-part-coalescing.patch` adapts the existing channel debouncer and merge helper.
- `classifyIMessageDmCoalesce` classifies instant input, lead-ins, payloads and continuation text.
- `dmCoalesceIngestChains` preserves direct-message ordering. The original deadline remains authoritative after payload arrival.
- Later stable source retains durable ingress claims, GUID reply context and receive-time deadlines.

### Implementation

- Maintained source patch and companion explanation are in `docs/openclaw-setup/patches/`.
- `packages/e2e/openclaw-patch-suite.json` registers source regressions.
- `packages/e2e/scenarios/imessage.mjs` exercises the installed channel with recording adapters.

### Validation

- Audit: installed OpenClaw `2026.7.1` contains `classifyIMessageDmCoalesce` and `dmCoalesceIngestChains`; the opt-in is enabled and the gateway listens on loopback.
- The original delivery record reports focused, cumulative, independent-review and production checks complete. Those historical suites were not rerun for this documentation audit.
- Current companion documentation records 99 coalescer/monitor cases plus channel and durable-ingress coverage. No test message was sent during the audit.

### Rollout and rollback

The behavior is already active. Managed release activation and rollback use `docs/openclaw-setup/patches/apply-and-deploy.sh`. Disabling the opt-in restores uncoalesced channel behavior; reverting source uses a previously validated release. No message-data migration belongs to this feature.

### Review log

The audit corrected the obsolete immediate-joined-payload claim. A matched payload remains until the first deadline so trailing text can join; only standalone or unlinked payloads flush immediately.

### Checklist

- [x] Implement and register selective coalescing and isolation regressions.
- [x] Document the delivered fixed-deadline behavior.
- [x] Confirm installed implementation and enabled Mini configuration.
- [x] Preserve ordinary agent processing and reply delivery.
