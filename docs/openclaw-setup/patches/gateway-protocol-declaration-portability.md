# Gateway protocol declaration portability

OpenClaw 2026.9.3 lets TypeScript infer the exported types for several large
protocol schema registries and five root exports. On some fresh pnpm 12
installations, declaration generation cannot give the nested TypeBox and
Kysely types portable names and stops the root build with TS2883.

This patch adds explicit, exact registry annotations for all 16 owner
fragments. Each property still has the type of its original schema export, so
runtime identity and public schema typing stay unchanged. Covering the complete
fragment set avoids depending on the declaration builder's diagnostic cap. The
patch does not adopt the broader registry redesign from later OpenClaw
releases.

The five root exports use their existing factory return types explicitly.
These annotations keep the exact public interfaces while avoiding dependency
layout names in unified declarations.

The regression checks a representative schema from every fragment by runtime
identity and compile-time type equality. A fresh pinned pnpm 12 root build is
the declaration-emission proof.
