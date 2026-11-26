# Configurable untrusted agent results

`tools.agentToAgent.untrustedAgents` optionally selects source agent IDs whose
reports must be presented as evidence. Runtime code resolves the source session,
then uses the existing escaped `<untrusted-text>` formatter before another model
receives its text. The setting does not grant tools or communication access.

The patch covers session sends, delayed agent exchanges, completion events,
descendant gathering, native run observations, and session history, search and list views.
It includes duplicate metadata and attachment descriptions. Runtime IDs, status,
media references and delivery receipts retain their existing roles. Selection,
silence checks and duplicate detection run on raw data before presentation.
Durable source reports are unchanged. Native image, video and music completion
events retain their own producer semantics. Their task IDs are not unknown agent
sessions and do not enter the agent-source classifier.

An absent or empty list preserves existing output. An enabled policy with an
unknown source or failed formatter returns an unavailable presentation, without
replaying work. Bounded fields reserve room for the full escaped enclosure.

On stable `v2026.11.5`, the port follows the native session-send executor,
reply-flow owner and typed completion disposition. The old token-classification
module and its production producers are gone. Do not revive `REPLY_SKIP` or
`ANNOUNCE_SKIP` handling; native visible, silent and empty dispositions decide
whether a result is delivered before presentation. Tests preserve silent
completions even when stale raw reply text remains.

Child findings keep the native stable-prefix and fair-size allocation. The
selected renderer budgets the entire escaped enclosure. Empty event lists stay
pure. Agent events use the prepared policy snapshot, and production owners pass
their captured configuration explicitly. Native run observations preserve
paused durations, ownership and delivery state while enclosing source labels.

The cumulative manifest includes source regressions. Native scenarios read a
synthetic reader transcript through the real history tool and check the final
provider request with the setting enabled and disabled. The provider fixture
uses the installed harness and SDK, with external delivery recorded locally.

See [the plan](../../plans/configurable-untrusted-agent-results.md) for acceptance
and rollout. Disable with an empty list. Before rolling back to a binary without
this schema field, remove the leaf through the normal configuration rollback.
