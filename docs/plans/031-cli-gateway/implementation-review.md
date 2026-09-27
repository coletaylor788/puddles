# CLI integration implementation review

Reviewed 2026-09-26 by a fresh retained adversarial-review agent. Scope: host
request policy, credential/session handling, subprocess invocation, trusted
identity/grants, journals, extensions, and configuration/skill installation.

| Finding | Resolution and regression |
|---|---|
| P1: Agent mounts could expose private state or host code | Validate effective sandbox/exec settings for every agent; reject overlapping workspace/bind paths for runtime, plugin code, browser cache and Keychain. Deny container-control paths and ancestor mounts, including readonly Docker Desktop/OrbStack directories. Tests cover direct, ancestor, workspace and host-exec cases. |
| P1: In-place skill updates followed agent-controlled symlinks | Build a separate tree through anchored no-follow directory descriptors; replace via directory-relative rename and safe cleanup. Static and concurrent symlink tests preserve an external sentinel. Rules are created exclusively and never overwritten. |
| P2: Extension registration bypassed real CLI parsing in tests | Load trusted installed provider entry points before argument parsing and include registered tools. A synthetic installed distribution executes through the real subprocess CLI and protected grant. |
| Unproven transaction lookup | Use the `node(id: $id)` operation found in the web application's saved TransactionDetails GraphQL source for before/after verification. |

Final reviewer disposition: all actionable findings resolved; independently ran
**86 Python tests**, all passing, with one Authlib deprecation warning. No remaining
concrete material defects found in the reviewed implementation. Nine plugin tests
also pass, including an actual plugin-to-Python CLI invocation. Full workspace
build and type checks pass.

Limits: this is static and synthetic-test evidence. Cumulative CI is not yet a
passed gate. The local broader suite encounters resource measurement and upstream
package-selection failures. Installed OpenClaw isolation must be rechecked after
the upgrade. Managed-browser silent login/restart/reboot, real free-account
contracts, and date changes' budget effects remain unverified. No live financial
write was made, no production configuration changed, and this review does not
authorize merge or deployment.
