# Core declaration portability

OpenClaw 2026.9.6 can fail while writing the unified declarations when the
compiler tries to name inferred types from Bash tools, database helpers,
embedded-attempt preparation, and the plugin install schema. The failure
appeared in the private cumulative CI build, even though the same public source
completed a clean local declaration build.

This patch gives the ten affected exports explicit public types. The types
match the unannotated source, including the nullable retained-window row from
the canonical-session left join, the conditional query result columns, the
embedded runtime resources, and the permissive plugin install record schema.
The regression checks those exact types in both assignability directions. A
dedicated project runs the maintained TypeScript test compiler as a top-level
cumulative gate. The cumulative build remains the declaration emit proof
because the local clean baseline did not reproduce the CI failure.

This repair is separate from the older gateway protocol portability patch. That
patch now retains tests for the current protocol registry and does not restore
obsolete source annotations.
