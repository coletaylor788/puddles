# Scoped memory

This plugin provides `scoped_memory_search` and `scoped_memory_get`. They use
OpenClaw's existing memory manager, indexes, and embedding configuration. They
do not call the native memory tools or their shared wiki supplements.

The host supplies the agent identity, session key, and workspace when it creates
the tools. Only explicitly configured agents receive them. Effective disabled
memory stays disabled. Missing identity or configuration gives no tools.

## Configuration

Build the plugin with `pnpm --filter scoped-memory build`. Load its `dist`
directory through `plugins.load.paths`, and configure its entry:

```json
{
  "plugins": {
    "entries": {
      "scoped-memory": {
        "enabled": true,
        "config": { "allowedAgents": ["example-agent"] }
      }
    }
  }
}
```

`allowedAgents` is the only plugin setting. Omitted or empty lists authorize
nobody. Agent IDs must match the host's canonical lowercase IDs exactly.
The tools are optional, so an authorized agent also needs them in its tool
allowlist.

This plugin does not control access to native memory or wiki tools. For agents
that must not read those corpora, permanently deny `memory_search`,
`memory_get`, and all wiki tools through the host's agent policy. Allow only
the distinct scoped tools where appropriate. Keep those native denials when
this plugin is absent, disabled, or fails to load. Agents with memory disabled
must not receive either tool. Validate this combined policy in the deployment's
own tests, including automatic recall and delegated runs.

## Tool contract

`scoped_memory_search` requires a nonempty `query` of at most 2,000 characters.
Optional `maxResults` is an integer from 1 to 10 (default 6).
Optional `minScore` is a finite number from 0 to 1; otherwise the manager's
configured threshold applies. Searches always pass `sources: ["memory"]` and
the host-supplied session key.

`scoped_memory_get` requires a relative `path`. Optional `from` is a positive
safe integer (default 1), and `lines` is an integer from 1 to 100 (default 40).
Excerpts contain at most 100 lines and 12,000 characters. Search results contain
`path`, `startLine`, `endLine`, `snippet`, `source`, and a reconstructed
`citation`. Reads contain `path`, `from`, `lines`, `text`, and `citation`.

Both tools validate the final arguments inside execution, after ordinary
parameter hooks. Unknown keys and aliases are errors. Neither tool accepts
agent, corpus, source, root, session, debug, or partial-result selectors.

## File boundary

Search returns only the owning workspace's `MEMORY.md`, `USER.md`, and `.md`
files below `memory/`. Reads also allow the root `dreams.md` file, including
`DREAMS.md` and other basename capitalization with a lowercase `.md` extension,
matching the native memory reader. The native index does not include this root
file by default; the scoped search does not add it to the index or expose it
through search. Arbitrary workspace files, hidden
path components, absolute paths, traversal, symbolic links below the workspace,
and hard-linked files are rejected. Missing files fail explicitly. The
configured workspace must match the host's trusted workspace and the active
builtin manager's workspace.

Global and agent-specific extra paths remain part of OpenClaw's existing index.
They are not new authorized roots. Search hits outside the file boundary are
discarded before producing output. Authorized hits are reread with the manager's
guarded file reader, so stale indexed snippets and arbitrary index metadata are
never returned. Excluded hits can reduce the number of returned results.
File identity is checked before and after each read. No backend status, debug,
partial results, or raw failure text is exposed.

The trusted host and configured embedding provider remain the processing
boundary. This plugin restricts tool results; it does not prevent the existing
manager from indexing configured extra paths or sending its normal embedding
requests. It does not create a separate engine, index, or cache.

## Validation

Run `pnpm --filter scoped-memory test`, `pnpm --filter scoped-memory lint`,
and `pnpm --filter scoped-memory build`. Unit fixtures use synthetic files and
recording managers. The cumulative e2e pool also exercises the actual pinned
manager with synthetic keyword-only memory, without network inference.
