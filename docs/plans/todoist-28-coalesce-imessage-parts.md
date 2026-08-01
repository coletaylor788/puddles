# Use OpenClaw's built-in iMessage input bucket

- **Status:** Plain-language rewrite complete and landed
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-31
- **Owner:** Cole Taylor

## Human section

### Design

Messages can split one iMessage composition into several rows. A short question
may arrive first. The link, preview, or image may arrive next. A final line of
text may arrive after that.

OpenClaw already has a built-in input bucket and an iMessage merge helper. The
bucket holds nearby direct-message rows from the same person and hands them back
to the iMessage adapter. Our patch picks only the rows that belong to one
composition. The adapter then uses OpenClaw's merge helper and starts one normal
agent turn. We do not add a second queue or change the agent loop.

Our small patch only decides when the built-in bucket should wait. Normal
complete messages go through at once. A short line that looks like the start of
a link or image question waits for a limited time. If the matching link, image,
or final text arrives, it joins the same bucket. The first link or image does
not extend the original wait. The bucket stays open until that fixed deadline
so final text can still join, then it goes to the agent as one user message. A
link or image sent by itself does not wait.

After the bucket is sent, everything works normally. The agent sees one regular
inbound turn, uses the same model and tools, and returns its usual final reply.
We do not make the agent call a special reply tool.

OpenClaw also has steering, but that is a different path. Steering can add text
to some agent runs that are already active. A new visible iMessage currently
waits for the active reply lane before OpenClaw checks whether it can steer.
Changing that would mean changing shared reply ownership and image handling.
We are not doing that. This fix uses OpenClaw's built-in input bucket before the
agent turn starts. If a new message arrives after that turn has started, it
remains a separate turn.

### Status

The input-bucket fix is already merged and running. Tests cover question plus
link, caption plus image, text plus link plus final text, standalone links and
images, and separate messages that must stay separate.

This update changes the plan only. It explains the built-in OpenClaw path and
the steering limit in plain language. The plan contract, independent review,
terminal review, and remote checks are clean. PR #81 is merged, and the update
is ready for Cole's review. Runtime code, configuration, and production stay
unchanged.

## Agent section

### State

OpenClaw already owns the main pieces:

- `channels.imessage.coalesceSameSenderDms` enables direct-message coalescing;
- `createChannelInboundDebouncer` holds rows in a keyed input bucket and returns
  the buffered rows to the iMessage flush callback;
- `combineIMessagePayloads` combines one selected group of text and attachments
  before dispatch;
- the normal dispatch path starts one ordinary agent turn;
- automatic final delivery sends the answer back to iMessage.

The provider-neutral Puddles patch adds only iMessage-specific selection and
ordering:

- `classifyIMessageDmCoalesce` decides whether a row is instant, a lead-in, a
  link or image, or final text;
- `enqueueInboundEntry` feeds the decision into OpenClaw's existing debouncer;
- `dmCoalesceIngestChains` keeps enqueue and send operations ordered per direct
  message;
- the patch calls the debouncer's existing `flushKey` to send a standalone or
  unlinked link or image immediately.

The implementation lives in:

- `docs/openclaw-setup/patches/imessage-message-part-coalescing.patch`;
- `docs/openclaw-setup/patches/imessage-message-part-coalescing.md`;
- `packages/e2e/openclaw-patch-suite.json`.

Production runs OpenClaw `2026.7.1-2` at revision
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`. The retained snapshot is
`~/.openclaw/deploy-snapshots/20260730T104410Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

PR #76 landed the final first-row link and image regressions. PR #77 landed the
previous closeout plan. PR #81 landed this clearer explanation as merge commit
`cd89270`.

### Scope and acceptance criteria

In scope:

- use OpenClaw's existing iMessage input bucket;
- wait only for a narrow short line that likely introduces a link or image;
- join a nearby link, preview, image, or linked final text from the same direct
  message;
- send a completed bucket as one normal inbound turn;
- send standalone links and images immediately;
- keep unrelated messages as separate turns;
- keep source IDs, attachment limits, text limits, replay checks, and direct
  message ordering.

Out of scope:

- changing the agent loop;
- adding another durable queue;
- bypassing visible reply ownership;
- steering fresh iMessage rows into an active reply;
- changing image loading or model support;
- changing automatic final reply delivery;
- combining every rapid message by time alone.

Acceptance is met when:

- a short question followed by a link creates one inbound turn;
- a short caption followed by an image creates one inbound turn;
- text, link, and linked final text create one inbound turn;
- a standalone link or image starts immediately;
- two separate short messages remain separate;
- a second unlinked link does not join the first composition;
- normal text, group messages, reactions, commands, and outgoing echoes keep
  their current behavior.

### Architecture and decisions

#### Use the built-in inbound bucket

The iMessage monitor calls OpenClaw's channel inbound debouncer. The bucket key
uses the iMessage account, conversation, and sender. Rows with different keys
cannot mix.

The debouncer already provides the needed operations:

- enqueue a row;
- wait until a deadline;
- flush one key now;
- hand the buffered rows to the iMessage flush callback.

The patched flush callback divides those rows into separate composition units.
It combines only a classified lead-in, matching link or image, and linked final
text with OpenClaw's existing `combineIMessagePayloads` helper. Unrelated or
unlinked units dispatch separately.

#### Wait only for likely split compositions

The patch uses four simple modes:

- `instant`: complete text and unrelated events go now;
- `lead-in`: a short unfinished line or narrow link or image question waits;
- `payload`: a URL, URL preview, or attachment can join the waiting lead-in;
- `continuation`: linked final text can join the same composition.

A lead-in creates one deadline. Later parts reuse that deadline. They do not
restart it.

#### Keep one fixed wait, but send standalone input promptly

After enqueue, a `payload` with no remaining deadline calls `flushKey`.

That covers:

- a standalone link or image is sent immediately;
- an unlinked second link or image is sent separately instead of joining an
  earlier composition.

A first link or image that matches a waiting lead-in keeps the lead-in's
original deadline. The bucket stays open until that deadline so linked final
text can still join. The link or image does not extend the deadline.

The row stays classified as `payload` so it keeps the same direct-message
ordering chain. Returning no decision would skip that protection.

#### Keep normal agent processing and final replies

The combined bucket goes through the same `dispatchInboundMessage` path as any
other iMessage. It starts one normal agent run. No model, tool, prompt, or reply
mode changes.

Direct iMessage replies use automatic final delivery. The agent can call a
message tool when it chooses, but that is not the normal reply path and is not
part of this fix.

#### Do not use steering for fresh iMessage rows

For a fresh visible channel message, `dispatch-from-config.ts` enters the shared
reply lane. `reply-turn-admission.ts` waits for the active visible reply
operation to finish. Queue policy runs after that wait, so the later iMessage
cannot reach the built-in steer choice while the first visible reply owns the
lane.

Changing that order would touch shared reply ownership. The steer path also
does not carry images through the same initial-turn image checks. Both changes
are outside this task.

The simple boundary is:

- parts that arrive before the input bucket sends become one turn;
- input that arrives after the turn starts remains a later turn.

### Implementation

Runtime work is complete. No new runtime change is proposed.

The landed patch:

1. enables the upstream same-sender direct-message bucket;
2. adds narrow iMessage rules for which rows wait;
3. keeps one fixed deadline per composition;
4. uses the existing key flush to send standalone or unlinked input;
5. keeps per-direct-message enqueue and send ordering;
6. combines text and attachments through OpenClaw's existing helper;
7. dispatches the result through the normal agent and automatic reply path.

The rejected queue-drain and steering designs must not be restored. They would
change shared OpenClaw behavior without evidence that this adapter-level fix
needs it.

If the problem returns, collect the iMessage row IDs, source times, arrival
times, reply links, and agent run boundaries. Update this plan from that trace
before changing runtime code.

### Validation

The focused iMessage suites contain 88 tests. They cover:

- short question plus link;
- caption plus image;
- text, link, and final text;
- first-row standalone link and image;
- a second unlinked link staying separate;
- two short messages staying separate;
- expired deadlines;
- malformed source data;
- reactions, commands, and group messages;
- text, attachment, and source-row limits.

The cumulative OpenClaw patch pool passes:

- 15 test files;
- 471 patch tests;
- the browser candidate test.

Required command:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

The tests use recording mocks. Production checks are read-only. They must not
send test messages or trigger replies.

This plan-only rewrite also runs the repository plan and issue writing contract.

### Rollout and rollback

This rewrite needs no runtime rollout. It changes documentation only.

The existing runtime rollback remains:

1. remove `imessage-message-part-coalescing` from the patch list;
2. rebuild and deploy the prior approved OpenClaw stack;
3. unset `channels.imessage.coalesceSameSenderDms`.

There is no message-data or persistent-state migration.

### Review log

- 2026-07-24 through 2026-07-30: The selective iMessage bucket rules, link and
  preview fixes, final-text support, tests, and production deployment landed.
- 2026-07-31: The proposed queue-drain replacement was rejected as too complex.
- 2026-07-31: Source review proved that fresh visible iMessage rows cannot reach
  steering before shared reply admission finishes.
- 2026-07-31: Source review found that standalone links and images already use
  the built-in key flush and do not wait for the full deadline.
- 2026-07-31: First-row standalone link and image regressions raised the
  cumulative pool to 471 tests.
- 2026-07-31: PR #76 landed the regression and safety guide changes. PR #77
  landed the closeout plan.
- 2026-07-31: Cole asked for plain language and a clearer explanation of the
  built-in OpenClaw bucket, normal reply path, and steering boundary.
- 2026-07-31: The plain-language rewrite passes all 9 plan and issue contract
  tests.
- 2026-07-31: Independent review corrected the timing explanation. A first link
  or image matched to a lead-in stays until the original deadline so final text
  can join. Standalone and unlinked payloads flush immediately.
- 2026-07-31: Independent review clarified the built-in split. The debouncer
  holds rows and returns them to the iMessage callback. The patch groups only
  matching parts, and the existing merge helper combines each selected group.
- 2026-07-31: Independent complete-diff review is clean after the timing and
  responsibility corrections.
- 2026-07-31: Terminal review clarified one last ownership detail. OpenClaw
  provides `flushKey`; the patch only decides when to call it.
- 2026-07-31: Exact commit `66490ee` passed terminal review. All remote checks
  passed, and PR #81 landed the plain-language rewrite as `cd89270`.

### Checklist

#### Plan rewrite

- [x] Explain the built-in iMessage input bucket in plain language.
- [x] Explain which messages wait and which go immediately.
- [x] Explain that combined input starts one normal agent turn.
- [x] Explain automatic final reply delivery.
- [x] Explain why fresh iMessage rows do not use steering.
- [x] Keep the rejected core queue and steering changes out of scope.

#### Validation and publication

- [x] Run the plan and issue writing contract.
- [x] Complete independent review of the full rewrite.
- [x] Complete exact-commit terminal review.
- [x] Land the reviewed rewrite on public `main`.
