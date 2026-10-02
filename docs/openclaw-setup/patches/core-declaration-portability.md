# Core declaration portability

OpenClaw 2026.9.6 can fail while writing the unified declarations when the
compiler tries to name inferred types from Bash tools, database helpers,
embedded-attempt preparation, and the plugin install schema. The failure
appeared in the private cumulative CI build, even though the same public source
completed a clean local declaration build.

This patch gives the affected exports explicit public types. The types
match the unannotated source, including the nullable retained-window row from
the canonical-session left join, the conditional query result columns, the
embedded runtime resources, and the permissive plugin install record schema.
The regression checks those exact types in both assignability directions. A
dedicated project runs the maintained TypeScript test compiler as a top-level
cumulative gate. The cumulative build remains the declaration emit proof
because the local clean baseline did not reproduce the CI failure.

The private QA prerequisite build also emits the SDK's process-poll test helper.
Its inferred tool schema can expose pnpm-internal TypeBox paths. An explicit
return contract refers to the existing process-tool factory type and preserves
the poll arguments, notification reader and cleanup function. The same type
regression checks the complete helper contract. The approval integration suite
exercises the private QA declaration build in the cumulative gate.

This repair is separate from the older gateway protocol portability patch. That
patch now retains tests for the current protocol registry and does not restore
obsolete source annotations.
