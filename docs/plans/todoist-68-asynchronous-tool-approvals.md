# Native tool approvals and guarded Gmail sending

**Status:** Implemented and reviewed, release pending
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-10-08

## Human section

### Design

Add `send_email` to the existing Gmail integration. A small pre-call hook asks
for approval through OpenClaw. OpenClaw holds the proposed arguments, shows its
built-in summary in the owner's direct iMessage chat, and waits for a decision.
Only then does the Gmail tool execute: validate the input, check its content,
and send through the existing Gmail MCP bridge.

```mermaid
flowchart TD
    Start(["START: Owner asks the agent to send an email"])
    Start --> Hook["1. Agent requests send_email<br/>Gmail hook supplies the approval summary"]
    Hook --> Approval["2. OpenClaw snapshots the arguments<br/>and sends the approval summary to iMessage"]
    Approval --> Wait{"3. OpenClaw waits for the owner's reaction"}
    Wait -->|"👍 Approve once"| Checks{"4. Gmail tool runs<br/>Input validation and content guard pass?"}
    Checks -->|"Yes"| Send["5. Send through Gmail"]
    Checks -->|"No"| NoSend
    Wait -->|"👎 Deny or timeout"| NoSend["No email sent"]
    Wait -->|"Run cancelled or gateway restarts"| Cancelled(["END: Pending send cancelled"])
    Send --> Result(["END: Agent receives the tool result"])
    NoSend --> Result
```

#### What OpenClaw handles

The Gmail integration requests native approval through the documented
`before_tool_call.requireApproval` hook. It supplies the title and summary
after the model requests the tool; email validation and content checks run
inside the tool after approval. OpenClaw already:

- Snapshots the call arguments and any overrides supplied by the hook. Later
  hooks may block the call but cannot rewrite the approved parameters.
- Creates the approval, delivers the summary, authenticates the decision, and
  consumes an allow-once decision once.
- Binds iMessage reactions to the actual approval message and authorized owner.
- Waits within the current call, handles timeout and cancellation, and resumes
  the normal tool pipeline after approval.

There is no custom payload store, freezing layer, approval service, executor,
result queue, or OpenClaw core patch in this design.

#### What we add to Gmail

| Component | Responsibility |
|---|---|
| `send_email` tool | After approval, validate the input, run the content guard, call Gmail through the existing MCP bridge, and return a safe result. |
| Shared content guard | Inside the tool, after approval and before dispatch, check the full email for secrets and disallowed sensitive content. A content block or classifier failure prevents sending even if approved. Reuse existing checks without contact lookup; other tools keep their recipient checks. |

The owner approves the displayed recipients, so this tool requires no known-contact
or trusted-domain lookup. The [security architecture](../openclaw-setup/security-architecture.md)
records this exception.

Version one sends a new plain-text email from the existing authenticated Gmail account. Inputs
are `to`, optional `cc` and `bcc`, `subject`, and `body_text`. Validate addresses,
require at least one recipient, bound input sizes, and reject header injection
and unknown fields. Attachments, HTML, aliases, arbitrary headers, raw MIME,
and replies are outside this version. Python constructs MIME with its standard
email library without changing the approved recipients or message content.

Only the authorized main agent gets the send tool. The reader retains its
existing guarded read access. Credentials and the raw MCP connection stay on
the trusted host; a model-supplied approval ID grants no authority.

#### Approving and sending follow-ups in iMessage

Use OpenClaw's existing summary to show the sender as "connected Gmail account", every To/Cc/Bcc
recipient, subject, and a short body preview. Reject an envelope that cannot fit
in the summary; the body preview can be shortened. This preview appears before
the tool runs its content guard. No custom full-email review is needed.

Forward native plugin approvals to the owner's fixed direct iMessage chat,
with an explicit authorized owner and only `allow-once` and `deny` decisions.
Press and hold the approval message, then choose **👍 to approve** or **👎 to
deny**. OpenClaw uses the message GUID and sender to resolve the correct request.
`/approve <approval-id> allow-once|deny` is the fallback, not the normal phone flow.

Use the native live wait with a requested ten-minute timeout. Timeout, run
cancellation, or gateway restart prevents the pending send. Sending later needs
a fresh request and approval.

An unrelated message does not approve, cancel, or edit the email. With default
`steer` queue handling, it may wait until the current tool finishes. To discuss
or change the email first, deny with 👎 and then ask the follow-up. Existing
queue settings still apply; `interrupt` or `/stop` can abort the active run.
Cancellation after Gmail dispatch cannot recall an email.

### Status

The original implementation is merged after focused tests, native integration,
CI, and independent review. The follow-up uses the existing authenticated Gmail
account as the sender and passes focused tests and native integration.

The owner clarified that sending uses the existing authenticated Gmail account.
The redundant sender setting is removed; Gmail resolves its own profile after
approval. Deployment configuration, installed gateway forwarding, and physical
phone acceptance remain. Production has not changed.

## Agent section

### State

This proposal updates PR #71 and issue #68. The repository OpenClaw pin is
`eb377ac59e6c9fd6c7705028034812becf00271b` (2026.9.6). The earlier comparison also
inspected stable 2026.9.8 at `fc23bc864e4553c2d215e479eeec47b67a0bf943` and upstream
main at `3b4ba3abb5e33a59ab79e2002f1c7e79c932e8ac`. No upstream upgrade is required
by this design. The native wrapper has now been exercised with the Gmail plugin
and a recording MCP bridge. Deployment and physical phone acceptance remain.

### Scope and acceptance criteria

- Expose sending only to the authorized main caller; reader, lower-trust, and
  unattended calls fail closed in version one.
- Use the closed schema and authenticated mailbox described above. Every destination
  must appear in the summary. No contact lookup is required for this tool.
- Preserve the native approved arguments through dispatch. No custom preparation,
  finalization, fingerprint, or approval-binding state is needed.
- Content checks run only inside the tool after approval and fail closed before
  dispatch. Approval cannot bypass them; a blocked email is not sent.
- Only an authenticated allow-once decision permits execution. Timeout, restart,
  and run abort do not leave detached work to execute later.
- Attempt Gmail dispatch once per approved call. Never automatically replay an
  uncertain send. Use recording doubles for every test write and notification.

### Architecture and decisions

#### Native contracts

All links below refer to the repository pin.

| Contract | Source |
|---|---|
| Normal pre-call approval API, argument snapshots, two-minute default and ten-minute maximum, summary bounds | [Plugin permission requests](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/docs/plugins/plugin-permission-requests.md) |
| Snapshot arguments and overrides before waiting | [Approval helper](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/agents/agent-tools.before-tool-call.approval.ts) |
| Later hooks can block but cannot rewrite approved arguments | [Hook merger](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/plugins/hooks.ts), [regression tests](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/plugins/hooks.before-tool-call.test.ts) |
| Structured forwarded iMessage prompts get reaction hints and delivered-GUID binding | [Channel delivery](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/imessage/src/channel.ts), [native approval tests](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/imessage/src/approval-native.test.ts) |
| Reactions authenticate the actor and target the correct pending request | [Reaction handling](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/imessage/src/approval-reactions.ts), [regression tests](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/imessage/src/approval-reactions.test.ts) |
| Follow-up messages respect existing queue and steering boundaries | [Queue behavior](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/docs/concepts/queue.md) |

Use a normal registered `before_tool_call` hook scoped to `send_email`. Supply
the summary from the proposed arguments; leave email validation and content
checks to the tool after approval. Return those same arguments through the
hook's `params` field: native hooks receive isolated original events, so this
keeps the summary and snapshot consistent even after an earlier parameter hook.
Request `timeoutMs: 600000` and allow only
`allow-once` and `deny`. Do not send from `onResolution`.

Configure `approvals.plugin.enabled: true`, `mode: "targets"`, and an exact owner
account/destination with explicit channel `allowFrom`. Preserve native typed
approval metadata through delivery; an ordinary text imitation does not get the
same reaction binding. Real routes and identities belong in local configuration.

#### Existing Gmail work

- [secure-gmail registration](../../openclaw-plugins/secure-gmail/src/plugin.ts)
  adds an optional, main-only send tool and its native approval hook. Sending is
  disabled unless the host config enables it.
- [ContactsEgressGuard](../../packages/mcp-hooks/src/egress/contacts-egress-guard.ts)
  delegates its content checks to the reusable `ContentEgressGuard` while
  preserving other callers' contact checks. Do not substitute LeakGuard's broader
  PII policy or bypass contact checks using a fake resolver.
- [gmail-mcp](../../servers/gmail-mcp/src/gmail_mcp/server.py) owns MIME and provider
  access. Enable its send handler only for the trusted bridge. Existing auth
  requests Gmail scopes accepted by [messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send);
  verify the actual grant during implementation setup.
- [The result wrapper](../../openclaw-plugins/secure-gmail/src/wrap-tool.ts)
  no longer retains raw `details.original` after modification. Send logs and
  external errors omit message content and classifier evidence.
- Cancellation of the Python async wait does not prove its underlying send
  stopped. A lost response or crash after dispatch returns an unknown outcome,
  never an automatic retry. A successful result means Gmail accepted the email.

### Implementation

Approved implementation work:

1. Add the schema and content-only guard, preserving existing contact-guard use.
2. Add the pre-call approval hook using the documented native API.
3. Add the tool and Python send handler: validate, guard, send once, return a safe
   receipt. No post-approval recipient or content rewrites.
4. Configure tool access and native approval forwarding. Update component docs
   and add the focused and cross-component regressions below.

### Validation

Focused Gmail tests cover the plugin, Python handler, and shared content guard.
The native integration fixture runs the real OpenClaw approval wrapper with the
built Gmail plugin and a recording stdio bridge. It verifies approval before
classification, matching summaries after earlier hooks, native snapshots,
rejected later-hook rewrites, allow-once,
denial, content blocks, abort, runtime stop, and Python/TypeScript schema parity.
Bridge startup cancellation has a separate regression. All sends are recorded;
no test sends a real email or approval message.

Focused results: 71 Gmail plugin tests, 118 shared-hook tests, 199 Python tests,
and 56 release-runner tests pass. The pinned OpenClaw source passes 54 iMessage,
29 hook, and 26 approval regressions. Its draft build and the final native
wrapper/stdio integration pass. These are development checks, not release proof.

Implementation tests must cover:

- Schema parity, header injection, Unicode, all recipients visible, sender derived from the existing login,
  and unsupported fields rejected.
- Approval completes before the Gmail content guard runs; content blocks and
  classifier failure then prevent dispatch. Unfamiliar recipients are allowed
  with approval; other tools' contact policy stays unchanged.
- Native argument snapshots, later hook rewrites rejected, and no execution
  before approval or after denial, timeout, restart, or pre-dispatch abort.
- Actual structured forwarding and authenticated 👍/👎 resolution using recorded
  delivery and inbound events; wrong actor/chat/GUID and duplicate reactions.
- Unrelated follow-up and interrupt behavior, plus normal tool-result continuation.
- Lost responses, cancellation races, one dispatch, no automatic retries, and
  safe result/log output.

Use [secure-gmail](../../openclaw-plugins/secure-gmail/README.md),
[gmail-mcp](../../servers/gmail-mcp/README.md), and [e2e](../../packages/e2e/README.md)
checks. Release validation follows the repository's accumulated pool and
DEV/TEST/PROD lifecycle. Physical iPhone acceptance remains owner validation.

### Rollout and rollback

Keep the send tool disabled until release validation. Rollback disables sending
and cancels pending calls; retain unknown-send receipts for
reconciliation. An accepted email cannot be recalled by rollback.

### Review log

- Owner selected native summary, iMessage reactions, and the built-in live wait.
- Owner removed recipient trust checks while retaining content guards.
- Owner selected approval first, then validation and content checks inside the
  Gmail tool. The approval preview is not gated by a separate Gmail content scan.
- Native argument snapshots replace the earlier custom freeze/finalizer design.
- Detached execution, restart recovery, and custom result delivery are removed.
- Independent review found that the Google client's underlying HTTP transport
  can repeat a POST after a lost response despite `num_retries=0`. Gmail sending
  now uses a per-call authenticated Requests session with transport retries,
  response-triggered credential retries, and redirects disabled. Local HTTP
  regressions verify one POST for acceptance, lost responses, 401, and redirects.
  Existing read transport is unchanged. The retained reviewer cleared the full
  behavior diff at `629529e` and independently passed all 19 send tests. The follow-up removes
  redundant mailbox configuration as requested by the owner. No
  material findings remain. Installed gateway routing and phone acceptance are
  release validation gaps.

### Checklist

- [x] Verify native approval and iMessage contracts in pinned source.
- [x] Keep Human and Agent sections and Plan 027 consistent.
- [x] Owner approved the revised design and shipping it on 2026-10-07.
- [x] Implement and validate with recording transports and providers.
- [x] Complete independent review and resolve its transport retry finding.
- [ ] Complete the approved release lifecycle and owner validation.
