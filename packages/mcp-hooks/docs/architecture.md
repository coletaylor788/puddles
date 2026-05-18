# mcp-hooks Architecture

Reference for working in this package. The high-level design rationale lives in
[`docs/plans/009-mcp-security-hooks.md`](../../../docs/plans/009-mcp-security-hooks.md);
this document is the living "what's actually here" companion.

---

## Purpose

`mcp-hooks` is a standalone TypeScript library of security hooks for MCP tool
pipelines. Consumers (OpenClaw plugins, container-side network proxies, ad-hoc
scripts) instantiate the hook classes they need and call `check()` directly —
the library is intentionally consumer-agnostic and ships no runner, registry, or
host integration.

It does two things:

1. **Egress checks** — inspect outbound tool inputs (URLs, queries, message
   bodies, command args) before the tool runs.
2. **Ingress checks** — inspect inbound tool outputs (email bodies, web pages,
   API responses) before they reach the model.

All semantic decisions are LLM-powered, classified through any backend that
implements the `LLMClient` interface. The package ships no concrete adapter
— consumers BYO provider and point at the implementing module via config
(`llmProvider` on OpenClaw plugins) or CLI flag (`--llm-provider` on the
eval harness). See the README for the interface contract and a sample
implementation.

---

## Package layout

```
packages/mcp-hooks/
├── src/
│   ├── index.ts              # Public API surface
│   ├── types.ts              # HookResult, HookAction, ContentClassification
│   ├── llm-client.ts         # LLMClient interface + stripCodeFences helper
│   ├── load-llm-provider.ts  # loadLLMProvider() — dynamic-import + construct an adapter
│   ├── contacts/
│   │   └── contacts-trust.ts # ContactsTrustResolver — iCloud Contacts membership lookup
│   ├── egress/
│   │   ├── leak-guard.ts            # LeakGuard — universal egress blocker
│   │   └── contacts-egress-guard.ts # ContactsEgressGuard — destination-aware send check
│   └── ingress/
│       ├── injection-guard.ts # InjectionGuard — prompt-injection detector
│       └── secret-redactor.ts # SecretRedactor — regex + LLM redaction
├── tests/
│   ├── contacts-trust.test.ts
│   ├── leak-guard.test.ts
│   ├── contacts-egress-guard.test.ts
│   ├── injection-guard.test.ts
│   ├── secret-redactor.test.ts
│   └── wiring.test.ts          # End-to-end wiring with mocked LLM
└── docs/
    └── architecture.md         # this file
```

Everything in `index.ts` is part of the public API; everything else is internal.

---

## Public API surface

```ts
// Shared types
type HookAction = "allow" | "block" | "modify";
interface HookResult { action: HookAction; content?: string; reason?: string; }
interface ContentClassification {
  has_secrets: boolean;
  has_sensitive: boolean;
  has_personal: boolean;
}
interface EgressHook  { check(toolName, content, params?): Promise<HookResult>; }
interface IngressHook { check(toolName, content): Promise<HookResult>; }

// Implementations
interface LLMClient {
  classify(content: string, systemPrompt: string, options?: { temperature?: number; maxTokens?: number; label?: string }): Promise<string>;
  destroy?(): void;
}
function loadLLMProvider(spec: string, opts: Record<string, unknown>): Promise<LLMClient>;
class ContactsTrustResolver { /* …iCloud Contacts membership lookup via contacts-cli */ }

class LeakGuard           implements EgressHook  { constructor({ llm }) }
class ContactsEgressGuard implements EgressHook  { constructor({ contacts, trustedDomains?, llm?, extractDestinations? }) }
class InjectionGuard      implements IngressHook { constructor({ llm }) }
class SecretRedactor      implements IngressHook { constructor({ llm }) }
```

---

## Hook responsibilities

| Hook | Direction | Runs on | Decisions |
|---|---|---|---|
| **LeakGuard** | egress | non-send tools (web_search, web_fetch, exec…) | secrets/sensitive/PII → **block**; otherwise allow |
| **ContactsEgressGuard** | egress | send-type tools (email, message, calendar w/ attendees…) | secrets/sensitive → **block**; recipient not in iCloud Contacts (and not a trusted domain) → **block**; otherwise allow |
| **InjectionGuard** | ingress | any tool returning external content | injection detected → **block**; otherwise allow |
| **SecretRedactor** | ingress | tools returning authenticated content | regex + LLM pass → **modify** (redacted) or allow |

Important behavioral details:

- **LeakGuard fires three classification calls in parallel** (secrets, sensitive,
  PII) — separate single-purpose prompts are more reliable than asking one
  prompt to classify three categories. Latency is the same; cost is 3× but
  Haiku is cheap.
- **ContactsEgressGuard reuses LeakGuard's secrets/sensitive prompts** but
  drops PII (since trust is membership-driven, not classifier-driven). The two
  hooks intentionally duplicate the prompt text rather than sharing a module —
  keeps each hook self-contained and lets the prompts diverge later if needed.
- **SecretRedactor is regex-first, LLM-second.** Regex catches the
  well-formatted majority (API keys, JWTs, private keys, connection strings,
  bearer tokens, reset links, 2FA codes, SSNs, credit cards). The LLM pass runs
  on the *already-regex-redacted* content to catch context-dependent leaks the
  regex missed. The LLM returns `{secret: "exact string", type: "category"}`
  pairs and we do deterministic `replaceAll` — no position math, no off-by-one.
  Hallucination guard: if the returned string isn't found in the content, it's
  silently dropped.
- **All four hooks fail closed on LLM error.** A network blip, malformed JSON,
  or any other classifier failure (`api_error` / `parse_error`) returns
  `action: "block"` with `details.degraded = true` and a `reason` naming the
  failure mode. The thinking: when the watchdog can't run, the safer default
  is to refuse the action rather than let untrusted content through (ingress)
  or potentially-sensitive content out (egress). Operators see `degraded`
  blocks in the audit log as a real alert signal — they're different from
  content-driven blocks. Plugins that need to escalate or alert humans on a
  degraded block can branch on `result.details?.degraded`.

---

## LLM client

The hooks consume any object that implements `LLMClient`. One instance per
process is the expected pattern; share it across hooks.

```ts
interface LLMClient {
  classify(content: string, systemPrompt: string, options?: ClassifyOptions): Promise<string>;
  destroy?(): void;
}
```

### `loadLLMProvider(specifier, options)`

The package does not ship a concrete adapter. Use `loadLLMProvider()` to
dynamic-import a module whose **default export** is a class that constructs
to something satisfying `LLMClient`:

```ts
import { loadLLMProvider } from "mcp-hooks";
const llm = await loadLLMProvider("my-llm-adapter", { model: "haiku-4-5" });
```

Failure modes (all `throw` with a descriptive message):

- empty specifier
- module fails to resolve / import
- module has no default export

### Adapter contract

Implementers must:

- Implement `classify(content, systemPrompt, options?) => Promise<string>` —
  send one user turn under one system prompt, return the assistant text.
- Strip markdown code fences via `stripCodeFences()` before returning.
- Throw on errors (network, parse, auth). Hooks catch and convert thrown
  errors into fail-closed `block` decisions with `details.degraded = true`.
- Honor `options.label`, `options.maxTokens`, `options.temperature` where
  applicable.
- Optionally implement `destroy()` for cleanup of timers/sockets.

A reference implementation skeleton lives in
[`packages/mcp-hooks/README.md`](../README.md#llm-client).

---

## ContactsTrustResolver

Reads iCloud Contacts membership via the `contacts-cli` Swift binary.
No persistence, no cache — every `isTrustedEmail()` call shells out
fresh (~50–100ms; invisible at our call frequency).

### Configuration

```ts
new ContactsTrustResolver({
  // optional:
  cliPath: "contacts-cli",   // PATH lookup, or absolute path
  timeoutMs: 5_000,
  logger: { warn: (msg) => /* … */ },
});
```

### Resolution

`isTrustedEmail(email)` returns `boolean`:

- `true` if any AddressBook entry has an `emails[]` value matching
  `email` case-insensitively.
- `false` on any failure (CLI missing, TCC denied, JSON parse error,
  timeout). Fail-closed; no email is implicitly trusted.

The first failure emits a single `warn` log; subsequent failures are
silent until a successful call resets the warning latch.

`healthCheck()` performs the same shellout and surfaces the failure
mode to consumers without being routed through a check decision.

---

## ContactsEgressGuard

Plugin-injected egress hook that combines content classification with
contacts-backed destination trust.

### Configuration

```ts
new ContactsEgressGuard({
  contacts: new ContactsTrustResolver(),
  // optional:
  trustedDomains: ["mycompany.com"],   // case-insensitive; "@" prefix tolerated
  llm: myProviderInstance,              // enables secrets/sensitive classifiers
  runContentClassifiers: true,          // explicit override (default: !!llm)
  extractDestinations: (toolName, params) => /* string[] */,
});
```

The plugin teaches the guard **how to extract destinations from
arbitrary tool params** (defaults to common shapes: `to`, `recipient`,
`recipients`, `email`, `address`).

### Decision flow

1. If `content` contains secrets → **block**.
2. If `content` contains sensitive data → **block**.
3. For every destination from `extractDestinations`:
   - email domain in `trustedDomains` → trusted
   - email in resolver's AddressBook → trusted
   - else → **untrusted**
4. If any destination is untrusted → **block** with an action-oriented
   reason naming the offender(s).
5. Otherwise → **allow**.

Block reason wording is deliberate: it names *who* and that approval is
human-gated, but never names the trust mechanism (no "contacts", no
"address book", no "add them" instructions). The agent learns *who* to
flag and *that* approval is human-gated — not *how*. When the user says
"yes, add them," the agent reaches for `contact create` because that's
the natural tool.

### Granting trust

- Add the recipient to iCloud Contacts (the agent can do this via
  apple-pim's `contact create` once the user authorizes), or
- Add the recipient's domain to `trustedDomains` in the consuming
  plugin's config (e.g. for company-internal addresses).

There is **no runtime trust mutation**: no allow-once / allow-always
ladder, no on-disk approval store. Trust is whatever Contacts says it
is, evaluated fresh on every check.

---

## Trust + classification matrix

The two egress hooks share the secrets/sensitive classifiers but
diverge on what comes after:

| Finding | LeakGuard (non-send) | ContactsEgressGuard / untrusted dest | ContactsEgressGuard / trusted dest |
|---|---|---|---|
| Secrets | **block** | **block** | **block** |
| Sensitive | **block** | **block** | **block** |
| PII | **block** | trust-driven (block if dest untrusted, otherwise allow) | trust-driven (block if dest untrusted, otherwise allow) |
| Clean | allow | **block** | allow |

ContactsEgressGuard does not classify PII separately — `trustedDomains`
+ Contacts membership is the gate. Send-style tools that need a PII
classifier should re-introduce one in their plugin layer.

---

## LLM prompt strategy

Prompts live as module-level constants beside each hook (not in a shared
prompts module — see "shared prompt text" note below). Each prompt:

- States the classifier's role.
- Enumerates positive examples ("flag if…").
- Enumerates negative examples ("do NOT flag…") to combat over-blocking.
- Demands JSON-only output: `{"detected": bool, "evidence": "…"}` for
  classifiers; `{"findings": [{"secret": "…", "type": "…"}]}` for the
  redactor's LLM pass.

The classifier prompts are deliberately verbose because Haiku-class models
respond well to enumerated do/don't lists. Iteration on these prompts is a
core part of Plan 015 (hook evals).

**Shared prompt text:** LeakGuard and ContactsEgressGuard currently duplicate
the secrets/sensitive prompt strings verbatim. This is intentional — the two
hooks are tested independently and may evolve different examples. If they
drift, that's fine. If they don't, dedup later when a third consumer appears.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit (mocked LLM) | `npm test` | tests across all modules; deterministic |
| Type check / lint | `npm run lint` (`tsc --noEmit`) | Strict TS, no implicit any |

Unit tests stub `LLMClient.classify` directly — no network, no real adapter.
Adapter-specific integration tests live in the adapter's own package.

---

## Extension points

To add a new hook:

1. Implement `EgressHook` or `IngressHook` in `src/egress/` or `src/ingress/`.
2. Define its classification prompt(s) as module-level constants.
3. Fail open on LLM errors (catch JSON.parse and request failures, return
   `{ action: "allow" }`).
4. Export from `src/index.ts`.
5. Add a unit test file alongside, stubbing `LLMClient.classify`.
6. Add adapter-specific integration coverage in the adapter's own package
   (e.g. `puddles/packages/mcp-hooks/tests/anthropic.integration.test.ts`,
   not this list).

To support a new tool destination shape in ContactsEgressGuard, pass a custom
`extractDestinations` function in the constructor. The default extractor reads
common param keys (`to`, `recipient`, `recipients`, `email`, `address`).

---

## Operational notes

- **Auth bootstrap:** the LLM auth model is whatever your `LLMClient`
  implementation requires. The hooks pass `LLMClient.classify()` opaquely
  — they don't care if your adapter reads an env var, a keychain entry, a
  config file, or hits a local model.
- **Trust source of truth:** iCloud Contacts. To revoke trust for a
  recipient, delete or edit them in Contacts.app. To inspect what
  ContactsEgressGuard sees, run
  `contacts-cli list --format json --limit 5000`.
- **Cost:** A single LeakGuard or ContactsEgressGuard check is ~2–3 Haiku
  calls (secrets + sensitive, plus PII for LeakGuard); InjectionGuard and
  SecretRedactor are 1 each. Contacts lookups are local (~50–100ms shellout)
  and incur no LLM cost.
- **Logging:** The library emits no logs aside from a single warn-once per
  process when the contacts CLI degrades. Consumers should log
  `HookResult.reason` on block decisions for audit trails — the library is
  intentionally quiet so consumers control PII in logs.
