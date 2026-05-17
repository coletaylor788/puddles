# mcp-hooks

Security hooks for MCP tool pipelines. Provides egress and ingress content
scanning powered by LLM classification.

The LLM backend is pluggable. `mcp-hooks` ships no concrete provider — it
defines the `LLMClient` interface and a `loadLLMProvider()` helper for
dynamic-importing your implementation by module specifier. You bring (or
write) a class that implements `LLMClient`, point a config field or
`--llm-provider` CLI flag at the module that exports it as default, and the
hooks consume it.

## Hooks

### Egress (outbound content)

| Hook | Purpose | Runs on |
|------|---------|---------|
| **LeakGuard** | Blocks secrets, sensitive data, and PII from leaking via non-send tools | web_search, web_fetch, exec, etc. |
| **ContactsEgressGuard** | Destination-aware trust check backed by iCloud Contacts | send_email, message, calendar create/update with attendees, etc. |

### Ingress (inbound content)

| Hook | Purpose | Runs on |
|------|---------|---------|
| **InjectionGuard** | Detects prompt injection attacks in external content | All tools returning external data |
| **SecretRedactor** | Redacts secrets (2FA codes, API keys, reset links, etc.) via regex + LLM | MCP tools returning authenticated data |

## LLM client

The hooks consume any object that implements the `LLMClient` interface:

```ts
export interface LLMClient {
  classify(content: string, systemPrompt: string, options?: ClassifyOptions): Promise<string>;
  destroy?(): void;
}
```

Contract for implementers:

- `classify()` sends one user turn under one system prompt and returns the
  assistant text. Strip markdown code fences before returning —
  `stripCodeFences()` (exported from this package) is the canonical helper.
- Errors (network, parse, auth) MUST throw. Hooks catch and convert thrown
  errors into fail-open `allow` decisions.
- Honor `options.label` in log lines if you log; honor `options.maxTokens`
  and `options.temperature` if your backend supports them.

A minimal Anthropic adapter (for illustration; not shipped here):

```ts
import Anthropic from "@anthropic-ai/sdk";
import { stripCodeFences, type LLMClient, type ClassifyOptions } from "mcp-hooks";

export default class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  constructor(opts: { model: string; apiKey?: string }) {
    this.model = opts.model;
    this.client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  }
  async classify(content: string, systemPrompt: string, options: ClassifyOptions = {}) {
    const r = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    });
    return stripCodeFences(
      r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""),
    );
  }
}
```

Export it as the default from a Node-resolvable module (workspace package or
absolute path) and consumers point at that specifier.

### Loading a provider dynamically

`loadLLMProvider(specifier, options)` resolves the module via Node's
`import()`, picks `default`, and constructs `new Default(options)`:

```ts
import { loadLLMProvider } from "mcp-hooks";

const llm = await loadLLMProvider("my-llm-adapter", { model: "haiku-4-5" });
```

OpenClaw plugins in this repo accept `llmProvider` (module specifier) +
`llmProviderOptions` + `model` in their config; the eval CLI takes
`--llm-provider=<spec>` and `--model=<id>`.

## Usage

```typescript
import {
  loadLLMProvider,
  LeakGuard,
  ContactsEgressGuard,
  ContactsTrustResolver,
  InjectionGuard,
  SecretRedactor,
} from "mcp-hooks";

const llm = await loadLLMProvider("my-llm-adapter", { model: "haiku-4-5" });

// Egress: block leaks on non-send tools
const leakGuard = new LeakGuard({ llm });
const result = await leakGuard.check("web_search", queryText);
// result.action: "allow" | "block"

// Egress: destination-aware approval for send tools, backed by iCloud Contacts
const contacts = new ContactsTrustResolver({
  // optional: cliPath defaults to "contacts-cli" on PATH
});

const sendGuard = new ContactsEgressGuard({
  contacts,
  trustedDomains: ["mycompany.com"], // domain short-circuit (case-insensitive)
  llm,                                 // optional: enable secrets/sensitive classifiers
  extractDestinations: (toolName, params) =>
    Array.isArray(params.to) ? (params.to as string[]) : [params.to as string],
});

const sendResult = await sendGuard.check(
  "send_email",
  emailBody,
  { to: "someone@random.com" },
);
// sendResult.action: "allow" | "block"
// sendResult.reason (if blocked): action-oriented string naming the offending recipient(s)

// Ingress: detect prompt injection
const injectionGuard = new InjectionGuard({ llm });
const ingressResult = await injectionGuard.check("get_email", emailContent);

// Ingress: redact secrets
const secretRedactor = new SecretRedactor({ llm });
const redactResult = await secretRedactor.check("get_email", emailContent);
// redactResult.action: "allow" | "modify"
// redactResult.content: redacted text (if "modify")
```

### Scoping ingress LLM scans with a prefilter

Both `InjectionGuard` and `SecretRedactor` accept an optional `prefilter`
that decides which slice of the tool response is sent to the LLM. The
plugin owns the schema of its tool output (envelope vs untrusted free
text), so it's the right layer to pick that slice. Scoping focuses LLM
attention on the actual attack surface and reduces false positives on
benign envelope fields (opaque IDs, etags, dates).

The shared helper `makeUntrustedKeysPrefilter` walks JSON tool responses
and emits only values whose key is in a configured set:

```typescript
import {
  InjectionGuard,
  SecretRedactor,
  makeUntrustedKeysPrefilter,
} from "mcp-hooks";

// Sender-controlled JSON keys for a Gmail-like response.
// Keys NOT listed here are treated as trusted envelope and are not
// sent to the LLM scans.
const gmailPrefilter = makeUntrustedKeysPrefilter({
  untrustedKeys: new Set([
    "from", "to", "cc", "subject", "snippet",
    "body_text", "body_html", "filename", "error",
  ]),
});

const injectionGuard = new InjectionGuard({ llm, prefilter: gmailPrefilter });
const secretRedactor = new SecretRedactor({ llm, prefilter: gmailPrefilter });
```

Behavior:

- The prefilter parses the tool response as JSON. If parsing fails it
  returns the **full** content unchanged (defence in depth — never
  silently skip a scan because we couldn't parse).
- It walks the parsed tree recursively and emits `key: value` lines
  for every value whose key is in `untrustedKeys`. Nested matches are
  found regardless of depth.
- An empty result skips the LLM call (the hook returns `allow`).
- For `SecretRedactor`, the prefilter only scopes Phase-2 (LLM). Phase-1
  (regex sweep for `sk-…`, JWTs, AWS keys, SSNs, credit cards, etc.)
  always runs on the full content.
- When the LLM identifies a secret in a scanned slice, `SecretRedactor`
  replaces every occurrence of that string anywhere in the full
  response — detection is scoped, replacement is not.

> **Security boundary:** the prefilter is a *scoping* knob, not an
> *authorization* knob. Anything excluded from the returned slice is
> NOT scanned by the LLM. Plugin authors must only exclude content they
> trust to be structural envelope (opaque IDs from a verified upstream,
> server-set status fields), never user/attacker-controlled payload.
> When in doubt, include the key.

For a custom shape, write your own `SimplePrefilter`:

```typescript
import type { SimplePrefilter } from "mcp-hooks";

const myPrefilter: SimplePrefilter = (toolName, content) => {
  // Return the substring(s) you want the LLM to scan.
  // Empty string => skip the LLM call.
  // Anything you don't return is NOT scanned.
  return extractAttackerControlledFields(content);
};
```

## Trust Model

`ContactsEgressGuard` treats **membership in iCloud Contacts** as the
sole source of egress trust. There are no persisted approvals, no
runtime-mutable trust ladder, no on-disk store. To grant trust, the user
adds the recipient to Contacts (the agent can do this via apple-pim's
`contact create` once the user authorizes).

Decision flow per call:

1. Content has secrets → **block** (always).
2. Content has sensitive data → **block** (always).
3. For each destination (email):
   - email domain matches `trustedDomains` → trusted
   - email matches a Contact → trusted
   - else → untrusted
4. If any destination is untrusted → **block** with an action-oriented
   reason naming the offending recipient(s).
5. Otherwise → **allow**.

Fail-closed: if `contacts-cli` can't read AddressBook (e.g. TCC
permission revoked), every destination is untrusted until repaired.

## Logging

Every classify call goes through `classifyBoolean()` which emits structured
JSON to stderr (lands in `~/.openclaw/logs/gateway.err.log` for openclaw
deployments). Adapter implementations should also emit their own
`llm_call_*` events using the `log()` helper exported from this package, so
operators can diagnose wedges/hangs uniformly:

| Event | Fields |
|---|---|
| `classify_start` / `classify_done` | `label`, `elapsed_ms`, `outcome`, `detected` |

`label` identifies the caller (e.g. `leak.secrets`, `injection`, `secret-redact`,
`contacts-egress.sensitive`).

## Development

```bash
npm install
npm test          # Run tests (LLM is stubbed; no provider required)
npm run build     # Compile TypeScript
npm run lint      # Type check
```
