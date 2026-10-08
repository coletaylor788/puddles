# Plans

Plans directly in this directory are pending. [Completed plans](completed/)
record delivered work and the architecture that actually exists. The
[Gmail server plans](../../servers/gmail-mcp/docs/plans/README.md) follow the
same convention within that component.

Each plan has one Human section for the design and current status, followed
by an Agent section for scope, implementation, evidence, and operational
details. The exact format is defined in the
[development workflow](../../.github/skills/safe-feature-development/SKILL.md).

The Human section is a structured design document. Start with the problem and
outcome, show the overall flow for a multi-stage design, then explain each stage
or component in a brief named subsection. Diagrams, tables, and short lists
belong here when they help readers understand responsibilities and decisions.
Keep implementation pointers and evidence in the Agent section. Apply this
format to new and substantively revised plans without rewriting unrelated
historical records.

The 2026-09-26 hygiene audit compared plans with source and read-only Mini
evidence. Completed scope excludes later follow-ups. An archived plan states
whether its evidence covers implementation, installed artifacts, or production
behavior; a completed source change does not imply that every later release is
deployed. Owner-confirmed abandoned plans are removed rather than archived as
completed.
