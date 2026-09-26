# Plan 009: Async Gmail bridge resilience and diagnostics

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

Gmail’s synchronous client runs in worker threads so a slow request cannot freeze the bridge’s event loop. Request deadlines return an error to the caller, socket timeouts bound network waits, and structured diagnostics distinguish slow calls from failures. Authentication work has its own bounds because browser consent and credential updates take different amounts of time.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Keep the event loop responsive during blocking API and authentication work.
- Bound ordinary API waits and network socket waits, and emit slow-call diagnostics.
- Keep per-tool and per-request structured stderr logs with credential and body redaction.
- Preserve normal tool results and expose failures without adding automatic API retries.

### Architecture and decisions

`src/gmail_mcp/_async.py::run_blocking` uses `asyncio.to_thread`, a shielded task, and `asyncio.wait_for`. Ordinary Gmail API calls default to a 60-second wait; a background task emits warnings at 10 and 30 seconds. Timing out the coroutine cannot forcibly kill an already running Python thread. The 30-second `httplib2` socket timeout in `auth.py::_build_service` supplies a separate network bound.

Every Gmail API execution in `server.py` goes through this helper, including message metadata, full reads, attachment reads, archive/label writes, and label lookup. Current authentication handling also offloads checks and client construction. It uses operation-specific deadlines and a cancellation event for credential side effects, with a bounded drain of started work.

`logging_setup.py` emits JSON to stderr. It redacts credential fields and attachment data, replaces message body/snippet values with size markers, and summarizes long lists. It does not claim to remove every identifier or address. Diagnostics include tool start/done and API call/done/error/timeout/slow events; the original proposed `auth_check` event is not the current contract.

### Implementation

`src/gmail_mcp/{_async,logging_setup,auth,server}.py` contain the deployed implementation. The old pending-deploy label was stale: the configured immutable bridge release matches these source files. Optional post-deploy observation tasks were removed from this completed plan under the owner’s cleanup instruction.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_async.py` checks values, exceptions, timeout, event-loop responsiveness, warning emission, queued cancellation, and bounded draining. `tests/test_logging_setup.py` checks JSON records and redaction. Server and auth tests exercise the async authentication boundaries.

On 2026-09-26, read-only inspection followed the enabled secure Gmail plugin's configured bridge executable and working directory. SHA-256 checks of the deployed `server.py`, `auth.py`, `config.py`, `keychain.py`, `_async.py`, and `logging_setup.py` exactly matched this checkout. This establishes installed implementation identity, not a new live Gmail transaction.

The focused mocked suite passed: 169 tests across `tests/test_config.py`, `tests/test_auth.py`, `tests/test_server.py`, `tests/test_async.py`, and `tests/test_logging_setup.py`. The command was `python -m pytest -q -p no:cacheprovider` followed by those five files, with `PYTHONPATH` selecting this checkout's `src`. No OAuth flow, mailbox operation, or integration test ran against a live account.

### Rollout and rollback

The implementation is present in the configured Mini bridge. This audit changes documentation only. Future runtime changes use the maintained deployment workflow and a retained prior release for rollback; the old instructions to reinstall a mutable checkout or trigger a live email cron are not an audit procedure.

### Review log

The hygiene audit compared this plan’s original scope with current tool schemas, implementation, existing tests, and the configured bridge’s source identity. Obsolete setup assumptions were replaced with the implemented design. Historical live test counts are not presented as new audit evidence.

### Checklist

- [x] Confirm the feature in source and existing tests.
- [x] Match the configured Mini bridge to the inspected source files.
- [x] Describe later interface and architecture changes accurately.
- [x] Remove follow-up scope and archive the completed plan.
