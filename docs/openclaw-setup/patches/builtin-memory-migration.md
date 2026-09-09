# Builtin memory migration

OpenClaw 2026.9.3 removes the QMD backend. There is no QMD transport caller left
to receive the maintained per-agent mcporter override. This test-only patch
replaces that override with migration and source-isolation regressions. It keeps
the backend configuration test target and adds doctor migration coverage to the
shared pool.

Doctor moves old `memorySearch` configuration to `memory.search`, preserves
per-agent collections as per-agent extra paths, and carries explicit transcript
indexing opt-in forward. The regressions keep disabled search disabled, retain
explicit local embeddings with `fallback: "none"`, and preserve explicit
`rememberAcrossConversations: false`. Migration leaves the original configuration,
canonical files, and retired derived data available for rollback.

Global extra paths are inherited by every enabled agent. Put privileged paths
only on authorized agents. A scoped agent must not gain access to a mixed store
merely because it contributes through trusted consolidation. Configuration tests
do not establish the full access boundary. The release owner must prove allowed
and denied installed search and read routes before activation.

Builtin search has bounded lexical expansion and can use local embeddings.
It does not preserve QMD's model-generated query expansion or learned reranking.
Do not claim ranking equivalence. Select and stage the local embedding model
before activation, and do not permit remote fallback.

Run the managed cumulative gate described in `packages/e2e/README.md`. Keep
retired QMD directories through the rollback window. This upgrade does not opt
into cleanup or production deployment.
