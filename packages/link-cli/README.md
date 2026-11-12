# Link CLI

The official Link CLI supplies payment and financial operations over native
OpenClaw MCP. The main agent has financial tools. The personal browser has
payment tools and works directly with Link approval and the merchant.

The workspace lock pins `@stripe/link-cli` 1.4.1. Its install script is disabled.
`prepareLinkCLI` uses the existing application materializer to copy the frozen
dependency graph into `tools/link-cli`. Deployment never runs npm or updates it.
Official MIT-licensed skills in `upstream/` come from release commit
`1e319681ad4a4747a83b08d95e37375ad75ab83d`.

The package applies a small, checked adaptation to the pinned bundle. It selects
incur's native direct MCP discovery mode and an exact command list for each role.
The default generic dispatchers cannot enforce the required operation split.
It also constrains command schemas to manual one-time approval, bounded polling,
the approved login grants, and no arbitrary credential output files. Link still
owns authentication, refresh, API requests, approval, and credential issuance.
Changed upstream integration points fail the build.

Configure two native MCP server entries with `configureLink`. Both use one
protected `LINK_AUTH_FILE`; each has a fixed `PUDDLES_LINK_CAPABILITY`. Native
agent tool allow/deny policies and sandbox tool policies enforce their respective
namespaces. Other agents receive explicit namespace denials. Do not expose a
general shell or generic dispatcher. Keep all connection paths in host settings.

Install only `link-financial-insights` in main's workspace and `link-payments`
in the personal browser's workspace. Copy their official reference documents
from the built payload. Existing skills remain unchanged. Include the two new
skill directories in the deployment backup before activating them.

First use checks auth status, starts login if needed, and returns a verification
URL and phrase. The owner signs in directly with Link. Account connection does
not authorize a purchase. Payment readiness also requires confirming no automatic
approval policy. The browser requests manual approval and resumes that same
request after an interruption. Credentials stay out of summaries and notes.

Run `corepack pnpm --filter @puddles/link-cli test` with the repository's pinned
Node toolchain. Tests exercise the real CLI against a local recording server,
including forbidden calls, manual approval, login persistence, missing grants,
and relocated packaging. Installed DEV and TEST must additionally verify native
agent permissions with the packaged CLI. Never use live purchases as a test.
