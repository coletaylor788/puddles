# Shared conversation context

The native transcript includes finalized Talk speech, but a persistent harness
can resume its own model session without reading those new entries. A recorded
SDK test reproduced this: a spoken detail existed in main history but never
reached the next text request.

This patch exposes a bounded conversation reader through the transcript SDK and
uses it in the bundled Copilot harness before ordinary turns. It reuses Talk's
model-context projection, including its session binding, cold-storage handling,
active branch, and hidden-input exclusion. Recent user and assistant text stays
in chronological order. The quoted context has a 16 KB UTF-8 limit and is added
to the existing developer instructions on both session creation and resume.

The current user request and transcript recorder stay unchanged. No extra model
turn runs, and old requests are not resubmitted. Raw model calls and settled
tool finalization retain their existing behavior. This adds recent context; it
does not import the full historical conversation or refresh an open voice
connection.

The cumulative patch manifest includes transcript and harness integration
regressions. `candidate.main-conversation.test.ts` checks installed native
routing and speech persistence using synthetic state and blocked network access.
Plan [053](../../plans/053-unified-owner-conversation.md) tracks routing, the
history handoff, and release acceptance. Roll back through the normal matching
runtime and configuration transaction.
