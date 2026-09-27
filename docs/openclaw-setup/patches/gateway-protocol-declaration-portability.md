# Gateway protocol declaration portability

OpenClaw 2026.9.6 replaces the old protocol fragments with one derived schema
registry and an explicitly typed composer. This patch keeps the regression
against that maintained registry. It checks runtime schema identity and exact
public types for all sixteen previously covered groups.

The deleted fragment annotations and old factory annotations are not carried
forward. The pinned root build checks declaration emission against the current
source and dependency graph. Add a narrow annotation only if that build
reproduces a portability failure.
