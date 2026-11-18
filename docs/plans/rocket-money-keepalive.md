# Keep Rocket Money sessions active through the MCP service

Status: Implemented locally; release validation pending
Issue: [#366](https://github.com/coletaylor788/puddles/issues/366)
Last updated: 2026-11-18

## Human section

### Design

A Rocket Money session expired during a gap between scheduled agent reads.
Move the keepalive into the existing MCP service so it runs without an agent
turn or a separate cron job. A successful request may extend an idle session,
but the provider can still expire or revoke it. Its session lifetime is not
established by this change.

The OpenClaw plugin starts its existing MCP subprocess at gateway startup and
reconnects if that subprocess exits. Inside the MCP, one authenticated identity
read runs at startup and every 30 minutes after the preceding check completes.
It uses the same worker and account locks as tool calls. No financial mutation
or login submission runs in the background.

When Chrome is already owned by the service, the read shares its cookie jar.
Otherwise a host HTTP client loads the private saved session without launching
Chrome. Cookie rotation is saved through the existing private state writer.
The check closes its authentication handles afterward, allowing manual login.

An expired session or account mismatch marks login required and stops requests
until the owner signs in again. Temporary transport failures retry on the next
interval. Status reports the last check, last success, and a fixed outcome.
No cookie, token, account identifier, or upstream error text enters that record.
The dedicated Chrome login and existing MCP remain separate from Vercel.

### Status

**Approval:** Production approved. **Approval reference:** The requester asked
on 2026-11-17 to bake a 30-minute ping into the MCP, following the explicit
decision to retain Rocket Money's dedicated Chrome and API integration.
**Scope:** Read-only session keepalive, persistence, lifecycle and status.
No financial scheduling, new tool grants, Vercel changes, or core patches.

Implementation and focused tests are complete. Retained review and installed CI
validation precede release. A new manual login and observation beyond the prior
idle interval are needed to measure effectiveness on a real account.

## Agent section

### State

The feature was rebased onto the landed OpenClaw 2026.11.4 upgrade. Source,
prepared runtime, dependencies and build inputs live in a durable task workspace.
The first DEV run passed. Production qualification stopped before deployment on
a Node toolchain mismatch. The shared upgrade has now aligned the application
contract with installed CI: Node 26.13.1 and pnpm 12.15.0. Fresh build and DEV
proof are required. No production keepalive is installed.

### Scope and acceptance criteria

- One identity-only request every 1800 seconds, independent of model activity.
- Same single worker and account locks as the existing MCP operations.
- No interactive login or Chrome launch from an idle keepalive.
- Persist rotated cookies; retain account binding and sanitized last-success data.
- Wait for manual login after expiry or mismatch; retry transient failures.
- Restart a lost MCP process and join pending work on shutdown.
- Verify exact installed artifacts through CI and report real-account limits.

### Architecture and decisions

`BrowserAuth.start_http` selects Playwright's existing API request client when
there is no live Chrome context. It shares the same private session format,
driver lifecycle and lock. The ordinary browser path is unchanged.

`RocketMoney.keep_alive` calls only the existing pinned identity query. The
async timer submits it to the MCP's single executor. Cancellation queues close
after the in-flight worker, even during initial service construction.

The plugin manifest selects native gateway startup, and its supported service hook starts MCP. A serialized liveness check
reconnects closed transports every 30 seconds; it does not call an API or model.
Stop cancels liveness checks before joining and closing the shared subprocess.
The supported startup selection and service hook are present in the upgraded
OpenClaw 2026.11.3 SDK and 2026.11.4 runtime. No feature-specific OpenClaw source
patch or additional upgrade is required.

### Implementation

Changed components are `packages/browser-auth`, `servers/rocket-money-mcp`, and
`openclaw-plugins/rocket-money`. The status tool includes a private keepalive
receipt. Existing model-facing tool names and permissions are unchanged.

### Validation

The focused Python suite passes 87 tests. This includes local HTTPS rotation
and HTTP-only restart, expiry without login, absent pin, account mismatch,
transient failure, timer scheduling and shutdown while the first worker starts.
The plugin suite passes 23 tests and TypeScript checking, including eager startup,
transport failure recovery without another tool call, idle exit and shutdown.
The 87 Python tests and 23 plugin tests pass again after the upgrade rebase.
The native startup-selector regression and type check pass with the new SDK.
No fixture accesses a real account. The existing runtime check script has
pre-existing Ruff E402 imports; changed Python source and tests are checked separately.

### Rollout and rollback

Use installed build, ci-dev and ci-prod. Preserve the current manual login
shortcut and private account state. CI owns deployment, merge and recovery.
No promise of an unlimited session follows from successful synthetic checks.

### Review log

The retained reviewer identified loss of the background timer after a tool
transport failure. The plugin now reconnects through its serialized service
lifecycle, with regressions for recovery without subsequent tool use.
The reviewer also identified missing native startup selection. The manifest now
sets `activation.onStartup`, with a regression using the pinned native selector.
The retained full-current-diff recheck is clear. The packaged smoke confirms one
MCP process and a startup keepalive receipt without a tool call or Chrome launch.

### Checklist

- [x] Implement the identity-only timer and HTTP-only saved-session path.
- [x] Preserve account binding and add sanitized check status.
- [x] Test rotation, expiry, failure, reconnection and shutdown.
- [ ] Complete retained review and installed DEV validation.
- [ ] Complete production CI, merge and eligible cleanup.
- [ ] Observe a newly authenticated account beyond the prior idle interval.
