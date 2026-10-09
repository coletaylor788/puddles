# Wiki metadata reads before maintenance

`wiki_get` previously returned the page body and a small provenance projection.
An agent updating a synthesis could not recover its complete citations or claims.
Synthesis writes replace the citation list and any supplied claims, making a
body-only read insufficient for a preserving update.

The patch adds known mutation metadata to successful wiki page reads. The tool's
optional `includeMetadata` flag includes that metadata, the body and pagination
in its model-visible JSON text. Ordinary tool calls retain their body-only text.
Memory fallback has no wiki metadata. Existing page visibility and filesystem
controls apply before metadata is returned.

The regression reads rich claim evidence and citations through the actual tool,
updates the summary with that snapshot, and checks preservation. It also checks
pagination, ordinary reads and denied bridge sources. The accumulated pool runs
these tests and the existing query and filesystem-read regressions.

Remove this patch when upstream offers the same supported read contract. A
maintainer prompt using the flag must be rolled back before reverting the runtime.
