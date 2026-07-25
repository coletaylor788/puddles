# Plan 031 — Coalesce iMessage message parts

**Status:** Deployment in progress
**Started:** 2026-07-23
**Completed:** 2026-07-23
**Reopened for deployment:** 2026-07-24

## Summary

iMessage can expose one user composition as multiple inbound rows: a short text
or caption first, followed shortly by a URL preview or image attachment. The
current native iMessage compatibility mode can merge URL-preview rows, but it
does not reliably combine text-plus-image sends and can delay unrelated direct
messages while waiting for a possible second row.

Add a provider-neutral OpenClaw source patch that classifies direct-message
rows before dispatch:

- Hold only a short, payload-free lead-in that plausibly introduces a URL or
  attachment.
- If a URL or real attachment follows from the same sender in the same direct
  conversation, merge the pair and flush it immediately as one inbound turn.
- Dispatch prose, questions, standalone URLs/media, reactions, outgoing echoes,
  and group messages without the compatibility delay.
- Bound the wait with the existing iMessage split-send debounce window. A lead-in
  that receives no payload still dispatches when the window expires.

## Configuration and behavior

The patch preserves the existing opt-in API:

```json5
{
  channels: {
    imessage: {
      coalesceSameSenderDms: true,
    },
  },
}
```

No provider credentials, model settings, channel identities, or production
state are part of the patch. The coalescing key remains scoped to account,
conversation, and sender.

## Safety model

- Direct messages only; group turn structure is unchanged.
- Same account, conversation, and sender only; cross-chat and cross-sender
  messages cannot merge.
- Only short lead-ins wait. Ordinary prose and questions dispatch immediately.
- Only URLs and non-plugin-payload attachments can complete a lead-in.
- Reactions and from-me echoes bypass coalescing.
- The existing debounce helper preserves per-key ordering and bounded state.
- Automated validation uses a detached OpenClaw fixture and fake inbound
  notifications; it sends no real messages and reads no production data.

## Implementation

1. Add pure lead-in and URL classifiers to the iMessage coalescing module.
2. Classify inbound DMs as `lead-in`, `payload-join`, or `instant`.
3. Flush a joined payload immediately and clear pending state on every terminal
   path.
4. Add focused tests for URL/image joins and genuinely separate messages.
5. Export the isolated OpenClaw diff as a source patch and add it to the
   Puddles patch pipeline.
6. Document the patch, activation, validation, and rollback.

## Testing

- Unit-test lead-in classification boundaries.
- Exercise text-plus-URL and caption-plus-image as one dispatch.
- Verify prose, questions, standalone payloads, groups, reactions, and from-me
  rows remain separate and immediate.
- Verify an unmatched lead-in flushes after the configured window.
- Apply the source patch cleanly to the pinned OpenClaw base.
- Run the focused iMessage test files, then applicable Puddles checks.

## Rollout

Use the existing `docs/openclaw-setup/patches/apply-and-deploy.sh` lifecycle only
after isolated validation. The target Mac mini deploys locally by default;
`MINI_HOST` is reserved for an intentional remote deployment.
Enable `channels.imessage.coalesceSameSenderDms` after deployment.

## Rollback

Remove the patch name from `PATCHES`, rebuild and deploy the prior source stack,
then unset `channels.imessage.coalesceSameSenderDms`. No data migration or
persistent message-state conversion is required.

---

## Checklist

### Implementation
- [x] Add selective lead-in and payload classification
- [x] Add immediate joined-payload flushing
- [x] Add focused regression tests
- [x] Export and register the OpenClaw source patch
- [x] Document activation and rollback

### Testing
- [x] Source patch applies cleanly to the pinned OpenClaw base
- [x] Focused OpenClaw unit tests pass
- [x] Puddles repository checks pass

### Cleanup
- [x] Full diff audited
- [x] Independent code review is clean
- [x] No temporary fixture or process remains

### Documentation
- [x] Patch index and iMessage setup guidance updated
- [x] Plan marked complete with date

### Deployment follow-up
- [x] Correct local-versus-remote deployment guidance
- [x] Validate local and explicit remote wrapper branches
- [ ] Merge the lifecycle correction
- [ ] Deploy on the target Mac mini
- [ ] Validate production and mark the issue ready for review
