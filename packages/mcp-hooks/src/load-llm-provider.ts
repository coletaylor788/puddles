import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { LLMClient } from "./llm-client.js";

/**
 * Dynamic-import an LLM provider by module specifier and instantiate it.
 *
 * `mcp-hooks` is provider-agnostic on purpose: consumers (OpenClaw plugins,
 * eval CLIs, scripts) name the module that exports their LLMClient
 * implementation and pass it in via config / CLI flag. This helper centralises
 * the resolution + construction so each call site doesn't reinvent it.
 *
 * The module's **default export** must be a class whose constructor accepts
 * a single options object and returns something satisfying `LLMClient`.
 *
 * Resolution strategy: try to resolve `specifier` relative to the consumer's
 * `process.cwd()` (so workspace package names — e.g. `my-llm-adapter` — find
 * the consumer's `node_modules`, not mcp-hooks's). Falls back to a plain
 * dynamic `import(specifier)` for absolute paths, file URLs, and builtins.
 *
 * @param specifier  Node module specifier (workspace package name, absolute
 *                   path, file URL, or anything Node's resolver understands).
 * @param options    Forwarded verbatim to `new Provider(options)`.
 */
export async function loadLLMProvider(
  specifier: string,
  options: Record<string, unknown> = {},
): Promise<LLMClient> {
  if (!specifier) {
    throw new Error("loadLLMProvider: empty module specifier");
  }
  let importTarget = specifier;
  try {
    // Anchor resolution at the caller's cwd so workspace package names work.
    // The anchor file doesn't have to exist; createRequire just needs a path
    // to root the walk-up at.
    const requireFromCwd = createRequire(`${process.cwd()}/_loader-anchor.js`);
    const resolved = requireFromCwd.resolve(specifier);
    importTarget = pathToFileURL(resolved).href;
  } catch {
    // Not resolvable from cwd; let native import() handle absolute paths,
    // file URLs, builtin specifiers, etc., or throw its own error below.
  }
  let mod: { default?: new (opts: Record<string, unknown>) => LLMClient };
  try {
    mod = await import(importTarget);
  } catch (err) {
    throw new Error(
      `loadLLMProvider: failed to import "${specifier}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const Ctor = mod.default;
  if (typeof Ctor !== "function") {
    throw new Error(
      `loadLLMProvider: "${specifier}" has no default export (expected a class implementing LLMClient)`,
    );
  }
  return new Ctor(options);
}

