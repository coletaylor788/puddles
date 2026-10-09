# Configurable untrusted agent results

`tools.agentToAgent.untrustedAgents` optionally selects source agent IDs whose
reports must be presented as evidence. Runtime code resolves the source session,
then uses the existing escaped `<untrusted-text>` formatter before another model
receives its text. The setting does not grant tools or communication access.

The patch covers session sends, delayed agent exchanges, completion events,
descendant gathering, task summaries, and session history, search and list views.
It includes duplicate metadata and attachment descriptions. Runtime IDs, status,
media references and delivery receipts retain their existing roles. Selection,
silence checks and duplicate detection run on raw data before presentation.
Durable source reports are unchanged.

An absent or empty list preserves existing output. An enabled policy with an
unknown source or failed formatter returns an unavailable presentation, without
replaying work. Bounded fields reserve room for the full escaped enclosure.

The cumulative manifest includes source regressions. Native scenarios read a
synthetic reader transcript through the real history tool and check the final
provider request with the setting enabled and disabled. The provider fixture
uses the installed harness and SDK, with external delivery recorded locally.

See [the plan](../../plans/configurable-untrusted-agent-results.md) for acceptance
and rollout. Disable with an empty list. Before rolling back to a binary without
this schema field, remove the leaf through the normal configuration rollback.
