# Gateway protocol declaration portability

OpenClaw 2026.9.3 lets TypeScript infer the exported types for several large
protocol schema registries. On some fresh pnpm 12 installations, declaration
generation cannot give TypeBox's nested array types a portable name and stops
the package build with TS2883.

This patch adds explicit, exact registry annotations for the five affected
owner fragments. Each property still has the type of its original schema
export, so runtime identity and public schema typing stay unchanged. The patch
does not adopt the broader registry redesign from later OpenClaw releases.

The regression checks representative array-bearing schemas from every affected
fragment by runtime identity and compile-time type equality. The package build
remains the declaration-emission proof.
