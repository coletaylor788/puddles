# Gateway protocol declaration portability

OpenClaw 2026.9.3 lets TypeScript infer the exported types for several large
protocol schema registries. On some fresh pnpm 12 installations, declaration
generation cannot give TypeBox's nested array types a portable name and stops
the package build with TS2883.

This patch adds explicit, exact registry annotations for all 16 owner
fragments. Each property still has the type of its original schema export, so
runtime identity and public schema typing stay unchanged. Covering the complete
fragment set avoids depending on the declaration builder's diagnostic cap. The
patch does not adopt the broader registry redesign from later OpenClaw
releases.

The regression checks a representative schema from every fragment by runtime
identity and compile-time type equality. A fresh pinned pnpm 12 root build is
the declaration-emission proof.
