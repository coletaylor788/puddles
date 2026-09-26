# Plan 018: Contacts-based egress trust

**Status:** Pending
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

Calendar invitations may leave the account, so every recipient must be in local Contacts or an approved domain. Unknown recipients are blocked with a request to ask the user. The owner manages trust outside the send operation; the guard does not grow a trust list from repeated approvals.

### Status

Contacts-based egress code is installed, but deployment is incomplete: the calendar service cannot find the Contacts helper through its configured executable search path. Contact-dependent invitations therefore fail closed. Completing the helper configuration and validating the service context remain pending. The read-only mail wrapper has no outbound-mail tool requiring this guard.

## Agent section

### State

Pending deployment completion. The 2026-09-26 audit confirms installed guard code but finds no configured `contactsCliPath` and no executable `contacts-cli` on the gateway service PATH. The helper exists outside that PATH. No production repair was performed.

### Scope and acceptance criteria

- Configure a resolvable Contacts helper in the gateway context and validate its authorization and trust lookup before declaring deployment complete.
- Replace persisted unknown/approved/trusted escalation with contacts/domain membership.
- All attendee addresses must be trusted; content checks still block secrets and sensitive information.
- Read fresh contact data for each trust lookup; normalize email casing and fail closed on resolver errors.
- Only the owner-facing main agent receives contact mutation tools; reader and household workers do not.
- Block messages identify the unapproved recipient and ask for user approval without teaching the trust-management mechanism.

### Architecture and decisions

- `ContactsTrustResolver` reads email addresses through `contacts-cli`; phone-number trust is outside delivered scope.
- No cache, persistent trust JSON, or runtime approval ladder is used. Stale contacts remain trusted until the owner removes them.
- `ContactsEgressGuard` exposes allow/block decisions with optional model classification. The calendar plugin supplies its classifier.
- The mail plugin has no send/forward/reply tools; it does not instantiate a speculative outbound guard.
- Contact editing is a main-agent capability. Tool access boundaries, not the wording of block messages, enforce worker restrictions.

### Implementation

- `packages/mcp-hooks/src/contacts/contacts-trust.ts` and `src/egress/contacts-egress-guard.ts` implement trust and egress decisions.
- `send-approval.ts` and `trust-store.ts` are absent from the maintained library.
- The calendar plugin wires the resolver/guard; component READMEs explain out-of-band trust changes.

### Validation

- Mini calendar bundle contains `ContactsEgressGuard`; `contacts-cli` exists, but `contactsCliPath` is unset and the configured gateway PATH has no executable with that name.
- Resolver defaults to bare `contacts-cli`; failed lookup returns untrusted. Approved domains bypass contact lookup and still receive content checks.
- Selected main tool allowlist contains `apple_pim_contact`; reader, browser, and household roles do not.
- Repository has contacts resolver and egress guard tests.
- Original implementation record reports 82 library, 38 calendar, and 36 Gmail tests passing at the time.

The audit confirms source, installed code and the missing service-context executable resolution. It does not establish current Contacts authorization or successful lookup. No personal contacts, invitations or authorization prompts were accessed.

### Rollout and rollback

Complete the helper configuration through the maintained deployment workflow, then verify the gateway context with controlled acceptance evidence. Preserve fail-closed behavior and a recoverable prior configuration. This hygiene audit changes only documentation.

### Review log

Independent review caught the difference between installed code and a usable deployed resolver. The plan remains pending until helper resolution and gateway-context validation are complete.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [ ] Configure the gateway to resolve the Contacts helper.
- [ ] Validate authorization and trust lookup in the gateway context.
- [ ] Archive only after deployed acceptance is established.
