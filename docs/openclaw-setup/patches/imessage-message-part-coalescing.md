# Selective iMessage message-part coalescing

**Status:** Verified in an isolated fixture against OpenClaw 2026.6.11.

## Symptom

One iMessage composition can reach OpenClaw as multiple `imsg` notifications:

1. A text prompt or caption row.
2. A URL-preview or image-attachment row shortly afterward.

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
  the same account, conversation, and sender, then flushes immediately.
- **Instant:** unrelated questions, prose, complete messages, standalone
  payloads, non-URL balloons, reactions, and outgoing echoes. These do not wait
  for the compatibility window.

If multiple short messages precede a payload, only the immediately preceding
lead-in joins it; earlier messages remain separate turns. Group messages keep
their existing per-message behavior.

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
rows reuse the first row's absolute deadline rather than restarting it. Payload
arrival flushes a matched pair immediately. Explicit inbound timing remains
authoritative.

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
- real debouncer timing across that 12.4-second gap;
- repeated referential lead-ins retaining the first absolute deadline;
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
- invalid conversation anchors failing open instead of sharing a coalescing key;
- the existing merge caps, reply context, cursor, and GUID tracking.

The focused coalescer and monitor suites pass all 73 tests after a clean reverse
and reapplication of the exported patch.

Manual smoke test after deployment:

1. Send a caption and image as one iMessage composition.
2. Send a payload-referential question and link as one composition.
3. Send two short, genuinely separate text messages rapidly.
4. Confirm the first two cases each produce one `embedded run start` and the
   third produces two turns in the gateway log.

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
