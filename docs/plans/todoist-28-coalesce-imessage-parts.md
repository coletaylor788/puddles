# Complete selective iMessage message-part coalescing

- **Status:** Complete and landed
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-31
- **Owner:** Cole Taylor

## Human section

### Design

iMessage can publish one composition as several nearby rows: a short caption,
a link or image, and sometimes trailing text. The deployed fix waits only for
text that narrowly looks like the start of such a composition. A matching
payload or continuation joins that wait, while ordinary prose and unrelated
messages start separate turns.

Standalone links, previews, and images do not wait for the compatibility
window. They enter the same per-conversation ordering gate as composed
messages, then force their bucket to dispatch immediately. The same force-flush
dispatches a completed lead-in plus payload composition. This keeps the
ordering protection without adding latency.

The reported missing-context behavior is therefore covered by the current
implementation. Direct regressions now cover a first standalone link and image
so this immediate path cannot regress unnoticed. Folding arbitrary input into a
reply after agent processing has started would require changing shared reply
ownership and media handling. That larger change is not justified by this task.
A future recurrence should be investigated from a timestamped message and
gateway trace before changing the runtime again.

### Status

The selective coalescer is merged and running in production. Final source review
confirmed that standalone payloads already dispatch immediately and that the
proposed follow-up classifier change would have removed required ordering
protection without improving latency.

No runtime, configuration, or deployment change is planned. Focused first-row
standalone link and image regressions pass in the existing registered monitor
suite, the full shared lifecycle passes, and independent complete-diff review is
clean. Cron-reader PR #56 is merged, the candidate is rebased onto that new
`main`, and the full lifecycle passes again. Exact-commit terminal review and
remote checks are clean, and PR #76 is merged. The work is ready for Cole's
review. Production remains unchanged.

## Agent section

### State

The provider-neutral implementation is already present on `main` in:

- `docs/openclaw-setup/patches/imessage-message-part-coalescing.patch`;
- `docs/openclaw-setup/patches/imessage-message-part-coalescing.md`;
- `packages/e2e/openclaw-patch-suite.json`.

The implementation was merged through the earlier task pull requests, including
PRs #16, #34, #36, #38, and #51. Production runs OpenClaw `2026.7.1-2` at
revision `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` with the selective iMessage
patch enabled. The retained deployment snapshot is
`~/.openclaw/deploy-snapshots/20260730T104410Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

PR #76 landed the focused regressions and this plan on public `main` as merge
commit `03cda26`. No runtime source, configuration, dependency, or production
state changed.

### Scope and acceptance criteria

The completed scope is:

- coalesce a narrow short lead-in with its nearby URL, URL preview, or image;
- preserve a qualifying trailing text row in the same logical turn;
- dispatch standalone links, previews, and images immediately;
- keep genuinely separate messages as separate turns;
- retain source GUIDs, replay deduplication, merge caps, reply context, and
  per-conversation arrival ordering;
- keep the behavior opt-in through
  `channels.imessage.coalesceSameSenderDms`.

Acceptance is satisfied when:

- a caption followed by an image produces one inbound turn and one reply;
- a payload-referential question followed by a link produces one inbound turn
  and one reply;
- text, link, and qualifying trailing text produce one inbound turn and one
  reply;
- a standalone link or image starts without a seven-second hold;
- two rapid but genuinely separate short messages remain separate;
- an unchained second payload does not inherit the first composition deadline;
- group messages, reactions, control commands, outgoing echoes, and unrelated
  complete text retain their existing behavior.
- the registered monitor suite directly covers a first eligible standalone URL
  carrying preview metadata and an image with no prior composition state.

Out of scope:

- changing shared reply-operation admission or visible-reply ownership;
- steering fresh channel input into an active visible reply;
- changing image forwarding, sanitization, or model capability handling;
- durable queues, replay generations, ingress ordinals, or new orchestration;
- broad time-window batching of every message from the same sender.

### Architecture and decisions

OpenClaw provides the opt-in same-sender direct-message coalescing surface. The
Puddles patch adds selective classification and per-DM ingest ordering on top of
that surface.

`classifyIMessageDmCoalesce` assigns eligible rows one of four modes:

- `instant` for ordinary text and unrelated events;
- `lead-in` for a narrow short fragment or payload-referential question;
- `payload` for a standalone URL, standalone preview balloon, or attachment;
- `continuation` for eligible trailing text explicitly chained to the payload.

A lead-in creates one absolute deadline. A matching payload and continuation
reuse it rather than extending it. Expired state flushes before later input is
enqueued.

`enqueueInboundEntry` serializes classified rows through
`dmCoalesceIngestChains`. After enqueue, a payload decision with no remaining
deadline immediately calls the debouncer's key flush. For a standalone payload,
this dispatches the payload without waiting for the generic compatibility
timer. For a matching payload, it dispatches the completed lead-in plus payload
bucket. Keeping the payload classified preserves the ingest chain and
`flushPendingBeforeEnqueue`; returning no classifier decision would bypass both
protections.

Fresh visible channel input cannot use built-in queue steering while another
visible reply owns the same session. Dispatch-phase admission waits for that
reply operation before queue policy runs. Changing that gate would affect shared
reply serialization and is rejected for this task.

Normal direct iMessage replies use automatic final delivery. Explicit message
tool sends are possible but are not the normal source-reply path and do not
explain the reported behavior.

### Implementation

No runtime implementation remains. The patch adds one focused monitor
regression where the first eligible inbound rows on separate DM keys are:

1. a standalone URL or URL-preview payload;
2. a standalone image attachment.

Each case enables same-sender DM coalescing, starts with empty composition
state, exercises the existing payload decision and force-flush, and asserts one
dispatch without an explicit test flush. The image case uses an isolated
temporary attachment root. The existing cumulative suite registration is
unchanged because the test file is already registered.

The deployed patch already contains:

1. selective lead-in, payload, continuation, and instant classification;
2. absolute bounded composition deadlines;
3. immediate force-flush for standalone payloads;
4. per-DM atomic enqueue and flush ordering;
5. source GUID and replay bookkeeping across merged rows;
6. merge limits for text, attachments, and source rows;
7. cumulative focused and integration regressions.

The withdrawn follow-up designs must not be implemented:

- the durable queue-drain design added source replay and lifecycle machinery
  disproportionate to the problem;
- the steer-admission design changed core visible-reply ownership;
- direct image steering would have bypassed the initial-turn sanitization and
  model capability path;
- the standalone-payload classifier change duplicated an existing immediate
  force-flush and would have removed ingest ordering.

If Cole reproduces a remaining failure, capture the source row timestamps,
GUIDs, reply-chain fields, payload metadata, notification arrival times, and
gateway run boundaries. Update this plan from that evidence before editing
source.

### Validation

The patch documentation records 88 focused coalescer and monitor tests passing
after clean patch application. The registered cumulative targets are:

- `extensions/imessage/src/monitor.last-route.test.ts`;
- `extensions/imessage/src/monitor/coalesce.test.ts`.

The existing monitor regression named
`flushes an unchained second payload as a separate immediate turn` exercises a
payload with no pending lead-in through the policy-aware mock debouncer. It
proves that the immediate force-flush branch is invoked and required for
dispatch. Source inspection confirms that the real debouncer's `flushKey`
directly flushes the buffer instead of waiting for its pending timer.

The new regression closes the remaining coverage gap by starting from empty
composition state. It covers a first standalone URL or preview and a first
standalone image, proving both reach the immediate force-flush without depending
on prior payload state.

Required cumulative command:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Managed test-environment scenarios:

1. Send a short caption and image as one composition.
2. Send a payload-referential question and link as one composition.
3. Send text, a link, and qualifying trailing text as one composition.
4. Send a standalone link and a standalone image.
5. Send two short, genuinely separate messages rapidly.
6. Assert one recorded run and one recorded inbound turn for the first three,
   immediate starts for the standalone payloads, and separate runs for the
   final pair.

All scenarios run through deny-by-default recording mocks. Production
verification remains read-only and must not send inbound messages or deliver
replies.

### Rollout and rollback

No rollout is needed for this documentation correction. Production stays on the
current deployed patch and configuration.

The existing implementation rollback is unchanged:

1. remove `imessage-message-part-coalescing` from the deployment patch list;
2. rebuild and deploy the prior approved stack;
3. unset `channels.imessage.coalesceSameSenderDms`.

There is no persistent state or message-data migration. The retained deployment
snapshot remains available for automatic wrapper rollback if a future
deployment fails.

### Review log

- 2026-07-24 through 2026-07-30: The selective coalescer, link and preview
  corrections, text-link-text continuation support, cumulative tests, and
  deployment records were merged and deployed.
- 2026-07-30: A larger immediate queue-drain replacement passed several design
  reviews but Cole rejected it as excessive runtime surgery.
- 2026-07-31: Source tracing confirmed that fresh visible channel input cannot
  reach built-in steering before dispatch admission releases the active reply.
- 2026-07-31: A proposed standalone-payload classifier change entered retained
  review.
- 2026-07-31: Retained review found the existing post-enqueue force-flush and
  its committed regression. The classifier proposal was withdrawn because it
  added no latency benefit and bypassed the per-DM ordering chain.
- 2026-07-31: The plan now records the completed implementation and recommends
  no further source change without a timestamped reproduction.
- 2026-07-31: The shared integration lifecycle passed all 15 patch-suite files
  and 470 tests, plus the candidate browser-entrypoint regression.
- 2026-07-31: Fresh review removed the remaining live message smoke step.
  Behavioral review now runs only in the managed recording-mock environment;
  production verification stays read-only.
- 2026-07-31: Fresh review identified that the existing immediate-payload test
  starts after a completed composition. Focused first-row standalone URL and
  image regressions are now the only remaining implementation work.
- 2026-07-31: The first-row URL-preview and image regression passed in the
  cumulative patch environment. The pool now passes 15 files and 471 tests,
  plus the candidate browser-entrypoint regression.
- 2026-07-31: The full managed lifecycle passed with the same 15 files and 471
  patch tests plus the candidate browser-entrypoint regression.
- 2026-07-31: Terminal review found a stale live-send smoke checklist in the
  patch guide. The guide now routes behavior checks through the managed
  recording-mock suite and limits production checks to read-only evidence.
- 2026-07-31: Exact-candidate review found one stale focused-test count in this
  plan. The plan now matches the patch guide's 88 focused tests and the managed
  lifecycle's 471 cumulative tests.
- 2026-07-31: Independent complete-diff review is clean after the regression,
  production-safety, and validation-count remediations. All in-diff bookkeeping
  is final for the landing candidate.
- 2026-07-31: Terminal commit review restored the existing publication freeze.
  Landing waits for cron-reader PR #56, which remains open, clean, mergeable,
  and green.
- 2026-07-31: Cron-reader PR #56 merged as `937b2af`. The publication freeze is
  cleared, and this branch can rebase onto the new public `main`.
- 2026-07-31: The branch rebased cleanly onto `937b2af`. The full managed
  lifecycle passed again with 15 files and 471 patch tests plus the candidate
  browser-entrypoint regression.
- 2026-07-31: Exact commit `c33afcf` passed fresh terminal review with no
  actionable findings. All remote CodeQL and cumulative integration checks
  passed, and PR #76 landed as merge commit `03cda26`.

### Checklist

#### Research

- [x] Trace the selective classifier and effective debounce resolution.
- [x] Trace standalone payload enqueue, force-flush, and ingest ordering.
- [x] Trace fresh visible reply admission and built-in steering.
- [x] Trace automatic final delivery and explicit message-tool behavior.
- [x] Trace image reference, sanitization, and model capability handling.
- [x] Confirm current production revision and retained snapshot.

#### Implementation

- [x] Coalesce narrow lead-in plus payload compositions.
- [x] Coalesce eligible text-link-text continuations.
- [x] Dispatch standalone payloads immediately.
- [x] Preserve per-DM atomic enqueue and flush ordering.
- [x] Keep genuinely separate messages separate.
- [x] Reject unsupported follow-up runtime changes.

#### Validation

- [x] Keep focused monitor and coalescer regressions cumulative.
- [x] Register the iMessage targets in the shared patch suite.
- [x] Add first-row standalone URL or preview coverage.
- [x] Add first-row standalone image coverage.
- [x] Run the focused patched monitor suite.
- [x] Run the current shared cumulative integration pool after the test change.
- [x] Complete fresh independent review of the complete current diff.

#### Publication

- [x] Synchronize issue #28 with this plan.
- [x] Remove live-message smoke instructions from the patch guide.
- [x] Finalize the plan and checklist for the immutable landing candidate.
- [x] Confirm cron-reader PR #56 is merged before moving public `main`.
- [x] Pass exact-commit terminal review and required remote checks.
- [x] Land the reviewed candidate on public `main`.
