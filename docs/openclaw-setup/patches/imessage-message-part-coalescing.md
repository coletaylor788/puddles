# Selective iMessage message-part coalescing

**Status:** Verified in an isolated fixture against OpenClaw 2026.6.11.

## Symptom

One iMessage composition can reach OpenClaw as multiple `imsg` notifications:

1. A text prompt or caption row.
2. A URL-preview or image-attachment row shortly afterward.
3. Optional trailing text whose notification can arrive several seconds after
   its source row was created.

Without coalescing, the first row starts an agent turn before the payload
arrives. The reply therefore lacks the link or image, and the payload starts a
second turn after the fact.

OpenClaw's existing `channels.imessage.coalesceSameSenderDms` compatibility mode
solves structurally marked URL previews, but it can hold every direct message
for the full compatibility window and does not reliably join caption-plus-image
rows after `imsg` advertises balloon metadata.

## Fix

The source patch classifies each eligible direct-message row:

- **Lead-in:** either a payload-free unfinished fragment of at most three words,
  or a question of at most eight words that combines a deictic reference with a
  payload noun, or uses the narrow “how/what about this one?” shape. A
  punctuationless final clause must also begin with a narrow interrogative. A
  final comma-delimited `what is/what's the <payload noun>` clause may omit the
  deictic only when preceding setup contains a letter or number and ends in
  comma-plus-whitespace; punctuation-only and sentence-punctuation prefixes do
  not qualify. Comma parsing is isolated to that exception so existing deictic
  questions keep their whole-question match. It waits for a bounded split-send
  window.
- **Payload:** a standalone HTTP(S) URL, a structurally standalone URL-preview
  balloon, or a real attachment. It joins an immediately preceding lead-in from
  the same account, conversation, and sender. A matched pair remains buffered
  only until the lead-in's existing absolute deadline so a delayed continuation
  can join; standalone payloads remain immediate.
- **Continuation:** a same-key row that explicitly replies to the pending payload
  or latest continuation GUID and has a parseable source timestamp zero to one
  second after that row. It joins without extending the first deadline.
  Payload-joined state is retained even when the payload lacks a usable GUID or
  timestamp; that malformed metadata cannot anchor a continuation, but a later
  lead-in or unchained payload still starts a separate composition.
- **Instant:** unrelated questions, prose, complete messages, standalone
  payloads, non-URL balloons, reactions, and outgoing echoes. These do not wait
  for the compatibility window.

If multiple short messages precede a payload, only the immediately preceding
lead-in joins it; earlier messages remain separate turns. Group messages keep
their existing per-message behavior. After one payload joins, an unchained
second payload flushes that pending composition and dispatches as its own
immediate turn. A new eligible lead-in flushes the prior pair and starts a fresh
composition deadline.

The existing merge bounds remain unchanged: 4,000 text characters, 20
attachments, and 10 source rows, with every source GUID retained for replay
deduplication.

## Enable

After deploying the patched OpenClaw build:

```bash
openclaw config set channels.imessage.coalesceSameSenderDms true
```

Image attachment ingestion is off by default. Enable it when caption-plus-image
coalescing is required:

```bash
openclaw config set channels.imessage.includeAttachments true
```

The default local attachment root is
`/Users/*/Library/Messages/Attachments`. Set
`channels.imessage.attachmentRoots` explicitly if Messages stores attachments
elsewhere.

The compatibility window defaults to 7 seconds only when no explicit iMessage
or global inbound debounce is configured. Under that default, classified
payload-referential questions use a 15-second cap to cover slower URL-preview
notifications; short unfinished captions keep the 7-second cap. Later eligible
rows reuse the first row's absolute deadline rather than restarting it. A
matched payload remains buffered to that deadline; standalone payloads remain
immediate. Explicit positive inbound timing supplies that absolute deadline;
explicit zero keeps dispatch immediate. If timer execution is delayed past the
deadline, the overdue bucket flushes before a later row is enqueued.

To set a different upper bound:

```bash
openclaw config set messages.inbound.byChannel.imessage 3000
```

Keep the window long enough to cover the observed gap between Messages.app
parts on the host.

## Verification

The patch adds regression coverage for:

- short lead-in plus URL-preview row;
- bounded payload-referential question plus URL-preview row;
- the observed punctuationless final question and 12.4-second runtime gap;
- the observed comma-delimited `Okay you failed. New test, what’s the link`
  prompt and 669 ms URL-preview row gap;
- punctuation-only prefixes remaining standalone questions;
- period and exclamation prefixes not activating the comma-only exception;
- existing deictic questions retaining payload nouns before an internal comma;
- real debouncer timing across both the 669 ms and 12.4-second gaps;
- the observed text-link-text reply chain, including its 5.348-second
  lead-in-to-link source gap, 114 ms link-to-trailing source gap, and delayed
  trailing notification;
- the same sandwich behavior under an explicit nonzero iMessage debounce;
- an unchained second URL flushing separately without inheriting the pending
  composition deadline;
- first-row standalone URL-preview and image payloads dispatching immediately
  with no prior composition state;
- back-to-back text-link-text compositions retaining independent continuation
  buckets;
- a joined payload without a GUID and with a malformed timestamp still closing
  its composition bucket without qualifying as a continuation anchor;
- quickly reply-chained non-URL balloons remaining structurally instant;
- broken reply chains, malformed timestamps, out-of-order source times, and
  source gaps above one second remaining separate;
- repeated referential lead-ins retaining the first absolute deadline;
- a payload observed after an overdue absolute deadline remaining separate even
  when the timer callback has not run;
- unmatched payload-referential question dispatching alone after the hold;
- common unrelated deictic questions bypassing the hold;
- explicit iMessage debounce timing overriding compatibility defaults;
- short caption plus image attachment;
- two rapid short text messages remaining two turns;
- a following composition retaining its own coalescing window during payload
  flush;
- non-URL balloons and unrelated complete messages bypassing the hold;
- empty-text URL balloons still being treated as payloads;
- embedded scheme-less URLs and control commands bypassing the hold;
- media-bearing control commands bypassing the hold without being merged into
  conversational text;
- invalid conversation anchors failing open instead of sharing a coalescing key;
- the existing merge caps, reply context, cursor, and GUID tracking.

The focused coalescer and monitor suites pass all 88 tests after a clean
reapplication of the exported patch.

Run all message-delivery scenarios through the registered managed test
environment with recording mocks:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Production verification is read-only. Check service health, the installed
version and patch marker, and unchanged configuration. Do not send test
messages or trigger live replies.

## Apply and revert

`apply-and-deploy.sh` applies
`imessage-message-part-coalescing.patch` to a clean OpenClaw source checkout,
builds it, and installs the packed result on the current host. Set `MINI_HOST`
only when intentionally deploying to a different host over SSH.

To apply only the source edit:

```bash
cd <openclaw-checkout>
git apply /path/to/puddles/docs/openclaw-setup/patches/imessage-message-part-coalescing.patch
```

To revert, remove `imessage-message-part-coalescing` from `PATCHES`, rebuild and
deploy the prior stack, then unset the opt-in:

```bash
openclaw config unset channels.imessage.coalesceSameSenderDms
```

No message data or persistent state migration is involved.
