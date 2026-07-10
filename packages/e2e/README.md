# `e2e` — OpenClaw end-to-end integration tests

This package drives the **real OpenClaw pipeline** and asserts that the assistant
behaves correctly end to end — the way you'd test it by texting it yourself. Each
test injects a real agent turn through the gateway (real routing → agent loop →
tools → hooks → model → reply) and asserts on the result with **deterministic
checks** (reply content, plugin audit logs, config) and an **LLM judge** for
semantic behavior.

It is designed to run **on the mini** (where the gateway, tools, and accounts
live).

---

## How it works (and why)

**Driver: `openclaw agent … --json` against the live gateway.**
`openclaw agent` injects one turn and returns the reply envelope as JSON. The
harness (`src/openclaw.ts`) shells out to it, never passing `--deliver`, so **no
message is actually sent** to any channel — but the turn runs fully (tools
execute), which is what makes it a real E2E.

Three design decisions worth knowing:

1. **Live gateway, not an isolated `--dev` instance.** OpenClaw *does* support a
   fully isolated gateway (`--dev` / `--profile`), and that would be the cleanest
   way to avoid touching real state. But provider auth (the LLM API credential) is
   only available to the gateway process that runs inside the GUI login session
   (the launchd gateway); a second gateway spawned over SSH can't authenticate. So
   the suite drives the **already-running live gateway**, which authenticates fine.
   The harness still supports an isolated profile via `E2E_PROFILE` for anyone
   running it locally in a GUI terminal (see below).

2. **No literal iMessage/transport mock.** The live iMessage channel is the
   `imsg` CLI, and sender-based binding routing happens in the channel-transport
   ingress path, which `openclaw agent` cannot simulate. Rather than mock a
   transport that isn't even the production one, the suite exercises the pipeline
   *from the agent inward* (which is where all the behavior lives) and asserts the
   routing **configuration** deterministically (`openclaw agents bindings`).

3. **Provider-neutral.** This package never names a specific LLM provider or
   model. The model IDs are injected via `E2E_MODEL` / `E2E_JUDGE_MODEL` at run
   time, so the suite works against any provider. Assertions that are specific to a
   particular provider (context-window size, exact model IDs) belong in a separate,
   provider-specific package outside this public repo — not here.

**Assertions come from three deterministic sources plus a judge:**
- the reply envelope (`result.payloads[].text`, `result.meta.executionTrace`),
- **plugin audit logs** (`~/.openclaw/logs/*-audit.jsonl`) — the deterministic
  record of wrapped-tool calls and allow/block decisions,
- CLI state (`openclaw agents bindings`, sessions),
- an **LLM judge** run *through the gateway* (`src/judge.ts`) for semantic checks
  — provider-neutral, reuses the working gateway auth, returns strict JSON.

---

## Running it

Prereqs: run **on the mini**, with the live gateway up. `pnpm` is via corepack.

```bash
cd ~/git/puddles/packages/e2e

# Required: your provider/model ids (injected — keeps this package provider-neutral).
export E2E_MODEL="<provider>/<model>"          # system-under-test model
export E2E_JUDGE_MODEL="<provider>/<model>"    # judge model (cheaper is fine)

corepack pnpm test:e2e            # the whole live suite
# a subset:
corepack pnpm exec vitest run --config vitest.e2e.config.ts tests/integration.gmail.test.ts
```

Environment knobs (all optional except `E2E_MODEL`):

| Env | Default | Purpose |
|---|---|---|
| `E2E_MODEL` | — (**required**; suite self-skips if unset) | model for the agent under test |
| `E2E_JUDGE_MODEL` | `E2E_MODEL` | model for the LLM judge |
| `E2E_AGENT` | `main` | default agent when a test doesn't name one |
| `E2E_JUDGE_AGENT` | `debug` | agent used to run the judge |
| `OPENCLAW_BIN` | `~/.npm-global/bin/openclaw` | the CLI |
| `E2E_PROFILE` | — (live) | `dev`/`<name>` to target an isolated instance (needs GUI-session auth) |

`pnpm test` (the default script) runs **nothing live** — the suite is entirely
`tests/integration.*.test.ts`, which the default vitest config excludes, so the
root `pnpm -r test` stays fast and offline. The live run is `test:e2e`. If
`E2E_MODEL` is unset, every live spec `describe.skip`s.

---

## Safety

- **Never delivers.** No `--deliver`, so nothing is texted to anyone.
- **Read-mostly.** Most tests are read-only. Tests that must exercise a write tool
  (e.g. the reminder lifecycle) use a **unique per-run marker** (`E2E-TEST-<runId>`)
  and delete what they create, with an `afterAll` cleanup backstop. Any stray
  marked item is trivially findable.
- Tool side effects hit **real** backends (Reminders/Calendar/Gmail/web) — that's
  inherent to a live E2E; it's why writes are marked + cleaned.

---

## Coverage

Tests are grouped to match the capability matrix. Each file is
`tests/integration.<group>.test.ts`:

| File | Group | Covers |
|---|---|---|
| `integration.smoke.test.ts` | — | toolchain: driver + envelope + judge |
| `integration.core.test.ts` | A | DM reply + persona, owner identity, routing-config |
| `integration.security.test.ts` | B | injection-override resistance, secret non-disclosure |
| `integration.pim.test.ts` | D | calendar read, reminder create→read→delete lifecycle |
| `integration.gmail.test.ts` | E | ingress-wrapped email read (audit), no send tool |
| `integration.websearch.test.ts` | F | web_search (audit), reader URL-delegation |
| `integration.memory.test.ts` | H | in-context recall, memory_search backend health |
| `integration.tiers.test.ts` | G | tier persona inheritance, sandbox confinement, scope |

Provider-specific assertions (exact model IDs, context-window size) are kept in a
separate provider-specific package outside this repo.

### What's intentionally *not* covered here (and why)

- **Classifier accuracy** for injection/secret-redaction inside fetched content —
  covered deterministically by the **offline eval harness** in
  `packages/mcp-hooks/evals` (that's its job; this suite asserts live wiring/behavior).
- **Sender-based wire routing / self-DM filters / relay round-trip** (needs the
  channel-transport ingress path and, for the relay, a second Apple ID) — the
  routing *config* is asserted instead.
- **Draft/Paused features** — async injection guard (011), budget guard (026),
  approval channel (027), announce queue (028), Apple Notes (030): tests will be
  added as those land.
- **Cron-only flows** (email-triage, daily-consolidation, dreaming, wiki-maintainer)
  run on a schedule, not per-message.

---

## Known findings

- `memory_search` once reported itself **down** ("embedding provider has no API
  key") during harness development, but recovered on a later run — so it appears
  **intermittent**. The `H-recall` test asserts backend health and will surface a
  regression if it degrades again (worth watching, per the gateway-PATH / qmd
  embedding gotcha).
