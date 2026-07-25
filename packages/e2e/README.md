# `e2e` — OpenClaw end-to-end integration tests

This package tests that the assistant behaves correctly end to end — the way
you'd test it by texting it yourself — **without ever bothering you or interfering
with your live agent.** It does that with one firm rule:

> **Read operations are tested E2E against the real systems. Write operations
> (creating reminders/events/contacts, sending messages) are only ever tested
> against MOCKS.** The live suite never creates a real reminder, never sends a
> real message, and never texts you.

Designed to run **on the mini** (where the gateway, tools, and accounts live).

---

## Required cumulative pull-request gate

Every behavior change contributes a committed regression to this package and
runs the full accumulated pool:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

The `ci` lifecycle runs the repository build, lint, and offline tests, then
creates a detached worktree from the pinned upstream OpenClaw revision, applies
all maintained source patches in deployment order, and runs every test mapped
in `openclaw-patch-suite.json`. It never edits the configured source checkout
or the running gateway. Set `OPENCLAW_SRC` when the checkout is not at
`~/git/openclaw`.

OpenClaw patch changes must update both the patch's own tests and the cumulative
manifest. Tests embedded in a patch but absent from the manifest are rejected by
the offline suite. The pull-request workflow runs this same lifecycle.

The separate live read-only suite is available through:

```bash
node packages/e2e/bin/openclaw-test-env.mjs live
```

---

## How it works (and why it can't interfere)

**Reads → real E2E, driven by agents that physically can't interfere.**
Each read test injects a real agent turn through the live gateway (`openclaw agent
--json`, never `--deliver`) and asserts on the reply + plugin audit logs. Crucially,
read tests are driven by agents whose toolset has **no `message` and no write
tools** — `reader` (calendar_read + gmail read + web_fetch) and `household-reader`
(web_search). Those agents *cannot* text anyone or change anything, so a read test
can never interfere. (Configurable via `E2E_READ_AGENT` / `E2E_WEB_AGENT`.)

A few reasoning/persona/security tests drive `main`/`household` (which do have a
`message` tool) but only with **benign prompts** ("who are you", "what's my name",
"reply HACKED") that give the agent no reason to message or write. The one earlier
test that made `household` escalate to you by text ("check Cole's calendar") was
removed — that's exactly the interference this rule exists to prevent.

**Writes → mocks only.**
- `mocks/imsg-mock.mjs` — records outbound sends, never delivers (a `message` sink).
- `mocks/apple-pim-mock.mjs` — records reminder/calendar/contact **writes**, returns
  success, touches nothing real; reads return empty.
- `tests/writes.test.ts` — offline test proving those sinks capture writes with zero
  real side effects. Runs under the default `pnpm test` (no gateway/model needed).
- The **wrapped** write tools themselves (calendar_write, gmail label/archive, with
  ingress/egress hooks) are covered by the plugin suites
  (`openclaw-plugins/*/tests`), which mock their MCP bridges.
- To run *full LLM-driven* write E2E with zero real effects, point an isolated
  `--dev` gateway's backends at these mocks (`channels.imessage.cliPath` →
  `imsg-mock.mjs`; apple-pim CLIs → `apple-pim-mock.mjs`) and set `E2E_PROFILE=dev`.
  (That path needs the dev gateway to authenticate, which currently requires a
  GUI-session run on the mini — see "Constraints".)

**Other design notes:**
- **Live gateway, not isolated by default.** A `--dev` gateway started over SSH
  can't reach the LLM credential (GUI-session-only), so the default suite drives the
  already-running live gateway (auth works) — safely, because the tools available to
  the test agents can't interfere.
- **Provider-neutral.** No provider/model names or PII in this package; model IDs and
  the owner number are injected via env (`E2E_MODEL`, `E2E_JUDGE_MODEL`,
  `E2E_OWNER_NUMBER`).
- **Assertions:** reply envelope; **plugin audit logs** (`~/.openclaw/logs/*-audit.jsonl`);
  `openclaw agents bindings`; and a gateway-mediated **LLM judge** (`src/judge.ts`).

---

## Running it

```bash
cd ~/git/puddles/packages/e2e

# Offline mock write-sink tests (no gateway, no model) — part of `pnpm -r test`:
corepack pnpm test

# Live read E2E (needs the live gateway up + your provider/model ids):
export E2E_MODEL="<provider>/<model>"
export E2E_JUDGE_MODEL="<provider>/<model>"      # cheaper is fine
export E2E_OWNER_NUMBER="+1..."                  # optional; enables the owner-identity test
corepack pnpm test:e2e
# a subset:
corepack pnpm exec vitest run --config vitest.e2e.config.ts tests/integration.gmail.test.ts
```

| Env | Default | Purpose |
|---|---|---|
| `E2E_MODEL` | — (**required** for live; suite self-skips if unset) | model for the agent under test |
| `E2E_JUDGE_MODEL` | `E2E_MODEL` | model for the LLM judge |
| `E2E_READ_AGENT` | `reader` | safe read-only agent (no message/write) for read tests |
| `E2E_WEB_AGENT` | `household-reader` | safe read-only agent with web_search |
| `E2E_OWNER_NUMBER` | — | owner E.164 for the owner-identity test (kept out of this repo) |
| `E2E_JUDGE_AGENT` | `debug` | agent used to run the judge |
| `OPENCLAW_BIN` | `~/.npm-global/bin/openclaw` | the CLI |
| `E2E_PROFILE` | — (live) | `dev`/`<name>` for an isolated instance (needs GUI-session auth) |

---

## Non-interference guarantees

- **No real messages.** Read tests use agents with no `message` tool; message/send is
  only exercised against `imsg-mock.mjs`.
- **No real writes.** No live test creates/edits a reminder, event, or contact; PIM
  writes are exercised only against `apple-pim-mock.mjs`.
- **Never delivers.** No `--deliver`, so no reply is pushed to a channel.
- Tool side effects on reads (calendar/gmail/web) are read-only.

---

## Coverage

| File | Group | Covers | Touches real system? |
|---|---|---|---|
| `tests/writes.test.ts` | — | mock write-sinks capture writes, no side effects | no (offline) |
| `integration.smoke.test.ts` | — | toolchain: driver + envelope + judge | read-only |
| `integration.core.test.ts` | A | DM reply + persona, owner identity, routing-config, multi-turn | read-only |
| `integration.security.test.ts` | B | injection-override resistance, secret non-disclosure | read-only |
| `integration.pim.test.ts` | D | calendar **read** (audit-logged) | read-only |
| `integration.gmail.test.ts` | E | ingress-wrapped email **read** (audit), no send tool | read-only |
| `integration.websearch.test.ts` | F | web_search, URL fetch/summarize | read-only |
| `integration.memory.test.ts` | H | in-context recall, memory_search health | read-only |
| `integration.tiers.test.ts` | G | tier persona inheritance, sandbox confinement | read-only |

### Intentionally not covered here (and why)
- **Full write E2E against real systems** — deliberately never done (would create real
  reminders/text real people). Writes = mocks; wrapped write-tool logic = plugin suites.
- **Classifier accuracy** for injection/secret redaction in fetched content — covered by
  the offline eval harness (`packages/mcp-hooks/evals`).
- **Sender-based wire routing / relay round-trip** — needs the channel-transport path
  (and a 2nd Apple ID); the routing *config* is asserted instead.
- **Draft/Paused features** (async injection guard, budget guard, approval channel,
  announce queue, Apple Notes).

---

## Contributing tests

- **Changing behavior?** Add a committed regression and run the `ci` lifecycle,
  not only the new test. Preserve prior regressions in the cumulative pool.
- **Changing an OpenClaw source patch?** Include the focused test change in the
  patch and map its test file in `openclaw-patch-suite.json`.
- **A read test?** Use `runAgent(msg, { agent: CONFIG.readAgent })` (or `webAgent`).
  Those agents can't message/write, so it's automatically safe. Assert on `res.reply`,
  a plugin audit log (`readAuditLog`), or the LLM judge (`expectJudge`).
- **A write test?** Route it at a mock in `mocks/` (extend `apple-pim-mock.mjs` /
  `imsg-mock.mjs`) and assert on the recorded write — never against the real system.
- **Needs the persona / a specific agent?** Only drive `main`/`household` with prompts
  that can't trigger a message or write, and add a comment saying so.
- Name live specs `tests/integration.<group>.test.ts`; offline specs `tests/<name>.test.ts`.
- Keep this package provider-neutral: no model IDs, provider names, or PII — inject via env.

---

## Known findings (real issues the suite surfaced)

- **`memory_search` semantic backend is DOWN** — reports "embedding provider has no API
  key"; the agent falls back to grepping raw memory files. (Active-memory recall injection
  still works.) `H-recall` asserts backend health and **fails on purpose** as a live bug
  flag; it goes green once the embedding provider is fixed.

## Constraints
- Isolated `--dev` gateways can't authenticate over SSH (LLM credential is GUI-session
  only), so full write E2E via an isolated gateway must be run from a GUI terminal on the
  mini. The default suite avoids this by driving the live gateway with non-interfering agents.
