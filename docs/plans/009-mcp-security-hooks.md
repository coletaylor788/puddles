# Plan 009: MCP Security Hooks Library

**Status:** Complete (2026-04-24)  
**Created:** 2026-04-12  
**Updated:** 2026-04-24

## Summary

Build a reusable TypeScript security hooks library (`packages/mcp-hooks/`) that provides egress and ingress security checks for MCP tool pipelines. OpenClaw plugins import this library and wrap tool execution with it (see Plan 010 for plugin implementation).

Three hooks:

1. **LeakGuard** (egress, non-send tools) — LLM-powered check for secrets, sensitive info, and PII on non-communication tools (web_search, web_fetch, exec, etc.). Always blocks — no approval flow. Does not run on send-type tools (those use SendApproval).
2. **SendApproval** (egress, send-type tools) — Destination-aware trust check for deliberate communication (email, messages). Uses TrustStore for two-tier trust + approval flow. PII allowed to trusted destinations.
3. **InjectionGuard** (ingress) — LLM-powered prompt injection detection on incoming data
4. **SecretRedactor** (ingress) — Regex + LLM secret redaction on incoming data

LeakGuard and SendApproval share the same LLM classification prompt (secrets/sensitive/PII) but differ in what they do with PII findings:

| Content type | LeakGuard (all egress) | SendApproval (sends only) |
|---|---|---|
| Secrets | **BLOCK** | **BLOCK** |
| Sensitive | **BLOCK** | **BLOCK** |
| PII | **BLOCK** | Trust-dependent (approval flow) |
| Clean content | ALLOW | Destination-dependent (approval flow) |

All hooks use a configurable LLM (default: `claude-haiku-4-5`) via your `LLMClient` adapter.

## Context: How This Fits Together

This library is a **standalone TypeScript package** providing hook logic that can be consumed by multiple integration surfaces:

1. **OpenClaw MCP plugins** (Plan 010) — wraps MCP tool `execute()` with egress/ingress hooks
2. **OpenClaw web provider plugins** (Plan 010) — replaces built-in `web_fetch`/`web_search` providers with hook-wrapped versions via `api.registerWebFetchProvider()` / `api.registerWebSearchProvider()`
3. **Container network proxy** (Plan 011) — intercepts HTTP responses at the Docker bridge level for sandboxed tool execution

```
packages/
└── mcp-hooks/          ← This plan: pure hook logic + LLM client
      │
      ├── consumed by → OpenClaw plugins (Plan 010)
      └── consumed by → Container proxy (Plan 011)
```

The library is consumer-agnostic. It exports hook classes; consumers call them directly.

## LLM Client Design

### Provider-agnostic LLMClient interface

The library defines a minimal `LLMClient` interface plus a `loadLLMProvider(specifier, opts)` helper that dynamic-imports a default-exported adapter class. Adapters live outside this package — consumers wire up whichever provider they use (OpenAI-compatible endpoint, Anthropic SDK, a local model, a corporate proxy, etc.).

**Contract:**

```typescript
interface LLMClient {
  // Single method — given content and a classification prompt, return a
  // structured result. Throws on transport / auth / parse errors so callers
  // fail closed rather than silently allowing traffic through.
  classify(content: string, systemPrompt: string): Promise<ClassificationResult>;
}
```

Implementations must:

1. **Throw on errors** — network failures, auth failures, malformed responses all surface as exceptions. The hooks fail closed (block) on classifier errors; they never assume "no response means clean."
2. **Strip code fences** — models routinely wrap JSON in ```` ```json ```` fences even when told not to. The adapter normalizes these out before parsing so hook code sees raw JSON.
3. **Be stateless from the hook's perspective** — any token caching, refresh, or connection pooling is the adapter's concern. Hooks just call `classify()` per request.

### Loading a provider

```typescript
import { loadLLMProvider } from "mcp-hooks";

// Specifier is a module path; the default export is an LLMClient class.
const llm = await loadLLMProvider("./my-provider-adapter.js", {
  model: "claude-haiku-4-5",
  // ...any other opts your adapter accepts (endpoint, credentials resolver, etc.)
});

const guard = new LeakGuard({ llm });
```

The `opts` bag is passed straight through to the adapter's constructor. mcp-hooks doesn't care what's in it — credential plumbing, base URLs, headers, retry policy are all the adapter's job.

### Credential handling

mcp-hooks itself reads no credentials. Adapters are free to source secrets however they like (OS keychain, env var, file, in-memory injection). The recommended pattern for long-running agents is:

- Adapter constructor takes an optional `credentialResolver: () => Promise<string>` callback
- Defaults to keychain lookup if not provided
- Sensitive material stays in memory; never persisted by mcp-hooks

### Model Configuration

- Default: `claude-haiku-4-5`
- Configurable at adapter construction
- Can be overridden per-hook if needed

## Hook Architecture

Each hook is a standalone class. Consumers (plugins) call `check()` directly and handle the results:

```typescript
// Egress: before sending
const result = await contentGuard.check("send_email", JSON.stringify(params));
// result.action: "allow" | "block"
// result.classification: { has_secrets, has_sensitive, has_personal }
// result.trustLevel: "unknown" | "approved" | "trusted"

// Ingress: after receiving (run in parallel)
const [injection, redaction] = await Promise.all([
  injectionGuard.check("get_email", emailBody),
  secretRedactor.check("get_email", emailBody),
]);
// injection.action: "allow" | "block"
// redaction.action: "allow" | "modify" (with redaction.content)
```

### Hook Interfaces

Each hook is a standalone class with a `check()` method. Consumers call them directly — no runner or registry needed.

```typescript
type HookAction = "allow" | "block" | "modify";

interface HookResult {
  action: HookAction;
  content?: string;    // modified content (for "modify")
  reason?: string;     // explanation (for "block")
}
```

```typescript
// Usage in a plugin:
const result = await contentGuard.check("send_email", JSON.stringify(params));
if (result.action === "block") { /* handle */ }

const [injection, redaction] = await Promise.all([
  injectionGuard.check("get_email", emailBody),
  secretRedactor.check("get_email", emailBody),
]);
```

## Hook Specifications

### LeakGuard (Egress — All Tools)

**Purpose**: Universal blocker for secrets, sensitive data, and PII on all outbound tool calls (web_search queries, web_fetch URLs, exec commands, etc.).

**Configuration**: `llm: LLMClient`

**LLM Classification** (three parallel calls, each focused on one category):

```typescript
const [secrets, sensitive, personal] = await Promise.all([
  llm.classify(content, SECRETS_PROMPT),    // API keys, passwords, tokens, private keys, credentials
  llm.classify(content, SENSITIVE_PROMPT),  // Specific personal financial/medical data tied to a person
  llm.classify(content, PII_PROMPT),        // Names, emails, phone numbers, addresses, SSNs, DOBs
]);
```

Each prompt is simple and single-purpose — "does this content contain X? yes/no + evidence." More reliable than asking one prompt to classify three things. Latency is the same (parallel). Cost is 3x but Haiku is cheap and accuracy matters here.

**Sensitive data prompt** distinguishes specific personal data from general topics:
- ✅ Flag: "My A1C is 7.2 and I take metformin" (specific diagnosis tied to a person)
- ❌ Don't flag: "What are symptoms of type 2 diabetes?" (general health inquiry)
- ✅ Flag: "I owe $47,382 in taxes" (specific financial data)
- ❌ Don't flag: "Tax implications for someone making $150K?" (general question)

**Decision**: Any finding → **BLOCK**. No approval, no trust model. This is a universal guardrail.

**Returns**: `{ action: "block", reason: "Content contains API key" }` or `{ action: "allow" }`.

### SendApproval (Egress — Send-Type Tools)

**Purpose**: Destination-aware trust check for deliberate communication (email, iMessage, Slack, etc.). Manages two-tier trust and approval flow.

**Configuration**:
- `llm: LLMClient` — LLM client for classification
- `trustStore: TrustStore` — manages destination trust resolution

**Trust Levels:**

```typescript
type TrustLevel = "unknown" | "approved" | "trusted";
// unknown  = never seen, needs approval for any send
// approved = can message, but PII blocked
// trusted  = can message + PII allowed
```

**Decision Matrix:**
| Finding | Unknown | Approved | Trusted |
|---------|---------|----------|---------|
| Secrets | **BLOCK** | **BLOCK** | **BLOCK** |
| Sensitive | **BLOCK** | **BLOCK** | **BLOCK** |
| PII | **BLOCK** | **BLOCK** | ALLOW |
| Clean content | **APPROVAL** | ALLOW | ALLOW |

**Returns**: `SendApprovalResult` extending `HookResult`:
```typescript
interface SendApprovalResult extends HookResult {
  classification?: {
    has_secrets: boolean;
    has_sensitive: boolean;
    has_personal: boolean;
  };
  trustLevel: TrustLevel;
  destination?: string;
  approval?: {
    title: string;
    description: string;
    severity: "info" | "warning" | "critical";
  };
}
```

**Shared LLM Prompt**: LeakGuard and SendApproval use the same classification prompt and can share a single LLM call when both run on the same content. The difference is only in decision logic — PII is always blocked in LeakGuard but trust-dependent in SendApproval.

### TrustStore (in hooks library)

Centralized trust management that plugins configure with minimal injection. Handles persistence, resolution, domain matching, and tier upgrades.

```typescript
class TrustStore {
  constructor(options: {
    pluginId: string;
    // Plugin provides: how to extract the destination key from tool params
    extractDestination: (toolName: string, params: Record<string, unknown>) => string | null;
    // Optional: how to extract domain from a destination (default: split on @)
    extractDomain?: (destination: string) => string | null;
    // Optional: override storage directory (default: ~/.openclaw/trust/)
    storageDir?: string;
  });

  // Core API
  resolve(toolName: string, params: Record<string, unknown>): TrustLevel;
  approve(destination: string): void;    // unknown → approved
  trust(destination: string): void;      // approved/unknown → trusted
  seedDomains(domains: string[], level?: TrustLevel): void;

  // Approval handler — call from plugin's onResolution callback
  handleApprovalDecision(destination: string, decision: "allow-once" | "allow-always" | "deny"): void;
  // allow-once  → no change to trust store
  // allow-always on unknown → approve (can message)
  // allow-always on approved + PII flagged → trust (can message + PII)
  // deny → no change
}
```

**Storage:** `~/.openclaw/trust/{pluginId}.json`
```json
{
  "contacts": {
    "cole@company.com": "trusted",
    "vendor@partner.org": "approved"
  },
  "domains": {
    "mycompany.com": "trusted"
  }
}
```

**Plugin usage is minimal — just provide the key extraction:**
```typescript
// Gmail plugin (Plan 010) — entire trust setup
const trustStore = new TrustStore({
  pluginId: "secure-gmail",
  extractDestination: (toolName, params) => params.to as string,
});
trustStore.seedDomains(config.trustedDomains ?? []);

const guard = new SendApproval({ llm, trustStore });
```

**Domain matching:** If destination is `cole@mycompany.com` and `mycompany.com` is in domains, the domain trust level applies. Contact-level trust overrides domain-level.

**LLM Prompt**: System prompt asks the model to classify content and respond with JSON:
- `has_secrets` — API keys, passwords, tokens, private keys, connection strings, credentials
- `has_sensitive` — Financial data, health records, internal business data, proprietary info
- `has_personal` — Names, email addresses, phone numbers, physical addresses, SSNs, DOBs

**Decision Matrix**:
| Finding | Trusted Destination | Untrusted Destination |
|---------|--------------------|-----------------------|
| Secrets | **BLOCK** | **BLOCK** |
| Sensitive | **BLOCK** | **BLOCK** |
| Personal Info | ALLOW | **BLOCK** |

**Returns**: `{ action: "block", reason: "Content contains API key (secret)" }` or `{ action: "allow" }`.

### InjectionGuard (Ingress)

**Purpose**: Detect prompt injection attacks in content received from external services.

**LLM Prompt**: System prompt focused on detecting:
- System prompt overrides ("ignore previous instructions", "you are now...")
- Role-playing / persona manipulation
- Data exfiltration attempts ("repeat everything above")
- Hidden instructions in HTML/markdown/encoding
- Instruction injection via delimiter abuse

**Returns**: `{ action: "block", reason: "..." }` if injection detected, `{ action: "allow" }` otherwise.

### SecretRedactor (Ingress)

**Purpose**: Find and redact secrets in content received from external services (e.g., email bodies with 2FA codes, password reset links).

**Phase 1 — Regex** (fast, runs first):
| Pattern | Example | Redaction |
|---------|---------|-----------|
| 2FA/TOTP codes | `Your code is: 789012` | `[REDACTED:2fa_code]` |
| Password reset links | `https://example.com/reset?token=abc123` | `[REDACTED:reset_link]` |
| API keys | `sk-proj-...`, `ghp_...`, `AKIA...`, `xoxb-...` | `[REDACTED:api_key]` |
| JWT tokens | `eyJhbG...` | `[REDACTED:jwt]` |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----` | `[REDACTED:private_key]` |
| Connection strings | `postgresql://user:pass@host/db` | `[REDACTED:connection_string]` |
| Bearer tokens | `Authorization: Bearer ...` | `[REDACTED:bearer_token]` |

**Phase 2 — LLM** (catches what regex misses):
- Send (already regex-redacted) content to model
- Model returns a list of `{ secret: "exact string", type: "category" }` findings — the literal secret text + what kind it is
- Code does deterministic `replaceAll()` for each finding — no position math, no off-by-one errors
- Hallucination protection: if a returned string isn't found in content, skip it

```typescript
// LLM returns:
[
  { secret: "sk-proj-abc123def456", type: "api_key" },
  { secret: "eyJhbGciOiJIUzI1NiJ9...", type: "jwt" },
]

// Deterministic replacement:
for (const finding of findings) {
  content = content.replaceAll(finding.secret, `[REDACTED:${finding.type}]`);
}
```

**Returns**: `{ action: "modify", content: redactedContent }` or `{ action: "allow" }` if nothing found.

## Package Structure

```
packages/
└── mcp-hooks/
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                # Public API exports
    │   ├── types.ts                # HookResult, HookAction, TrustLevel
    │   ├── llm-client.ts          # LLMClient interface + loadLLMProvider helper
    │   ├── trust-store.ts          # TrustStore (persistence, resolution, approval handling)
    │   ├── egress/
    │   │   ├── leak-guard.ts       # LeakGuard — universal egress blocker
    │   │   └── send-approval.ts    # SendApproval — destination-aware trust + approval
    │   └── ingress/
    │       ├── injection-guard.ts  # InjectionGuard hook
    │       └── secret-redactor.ts  # SecretRedactor (regex + LLM)
    ├── tests/
    │   ├── types.test.ts
    │   ├── llm-client.test.ts
    │   ├── trust-store.test.ts
    │   ├── leak-guard.test.ts
    │   ├── send-approval.test.ts
    │   ├── injection-guard.test.ts
    │   └── secret-redactor.test.ts
    └── docs/
        └── architecture.md
```

## Dependencies

```json
{
  "name": "mcp-hooks",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

Note: mcp-hooks itself has no runtime dependencies on any LLM SDK or credential store. Provider adapters (loaded via `loadLLMProvider`) bring their own dependencies — an OpenAI-compatible adapter pulls in `openai`, a keychain-backed adapter pulls in `keytar`, etc.

## Testing Approach

### Unit Tests (mocked LLM, fast, isolated)

- **LLMClient interface + loadLLMProvider** — Test dynamic-import resolution, default-export validation, opts pass-through. Mock adapter for unit-test coverage of error propagation (throws on transport/auth/parse failures), code-fence stripping, and the fail-closed contract.
- **LeakGuard** — Mock LLM responses. Test each category independently: secrets detected → block, sensitive detected → block, PII detected → block, clean content → allow. Test the sensitive/general distinction (specific health data vs general inquiry).
- **SendApproval** — Mock LLM + TrustStore. Test all cells of the decision matrix: secrets always block, PII to unknown → block, PII to approved → block, PII to trusted → allow, clean to unknown → approval needed, clean to approved → allow.
- **InjectionGuard** — Mock LLM. Test: injection detected → block, clean content → allow. Test various injection patterns (system prompt override, role-play, exfiltration, delimiter abuse).
- **SecretRedactor** — No LLM mock needed for regex phase. Test each regex pattern (2FA codes, reset links, API keys, JWTs, private keys, connection strings, bearer tokens) with positive and negative cases. For LLM phase: mock responses, test deterministic replacement, test hallucination protection (returned string not in content → skip).
- **TrustStore** — No LLM. Test: resolve unknown/approved/trusted, approve() tier upgrade, trust() tier upgrade, domain matching, contact overrides domain, handleApprovalDecision() logic, file persistence (write + reload), seed domains.
- **Edge cases** — Empty content, unicode, very long content, malformed LLM responses (invalid JSON, missing fields), content with mixed categories (secrets + PII in same text).

### Integration Tests (real LLM provider, requires configured adapter)

Integration tests hit a real LLM via whichever adapter the caller wires up. They require the adapter's credentials to be available and run separately from unit tests (`pnpm test:integration`).

- **LLMClient round-trip** — Real `classify()` call via the configured adapter, verify a parseable response is returned.
- **LeakGuard end-to-end** — Real LLM classifies content containing an API key → verify block. Real LLM classifies clean content → verify allow. Real LLM classifies "what are symptoms of diabetes?" → verify allow (not sensitive).
- **SendApproval end-to-end** — Real LLM classification with TrustStore backed by temp file. Verify full trust lifecycle: unknown → approval → approve → re-check → allowed.
- **InjectionGuard end-to-end** — Real LLM detects "ignore previous instructions" → block. Real LLM allows "please ignore the previous email, here's the correction" → allow.
- **SecretRedactor end-to-end** — Content with a 2FA code and an API key → regex catches the key, LLM catches context-dependent secrets, final output fully redacted.
- **Combined flow** — InjectionGuard + SecretRedactor in parallel on real content, verify correct behavior.

---

## Checklist

### Implementation
- [x] Scaffold package structure (`packages/mcp-hooks/`, package.json, tsconfig, src layout)
- [x] Implement `types.ts` (HookResult, interfaces)
- [x] Implement `llm-client.ts` (LLMClient interface + `loadLLMProvider` dynamic-import helper)
- [x] Implement `egress/leak-guard.ts` (LLM classification, blocks secrets/sensitive/PII on non-send tools)
- [x] Implement `egress/send-approval.ts` + `trust-store.ts` (destination-aware trust + approval flow)
- [x] Implement `ingress/injection-guard.ts` (system prompt + classification)
- [x] Implement `ingress/secret-redactor.ts` (regex patterns + LLM fallback)

### Testing
- [x] All unit tests written (92 tests, mocked LLM)
- [x] All unit tests passing
- [x] Integration tests written (real LLM via configured adapter — `tests/integration.test.ts`)
- [x] Integration tests passing (requires adapter credentials available; verified in commit 66cb14f)

### Cleanup
- [x] Code linting passes (`npm run lint`)
- [x] No unused imports or dead code

### Documentation
- [x] README.md written
- [x] docs/architecture.md written
- [x] Plan marked as complete with date

> **Scope note (2026-04-24):** Plan originally specified a single `ContentGuard` egress hook. During
> implementation it was split into two complementary hooks — `LeakGuard` (non-send tools, always blocks)
> and `SendApproval` (send-type tools, destination-aware trust + approval) — to cleanly separate the
> "never leak" case from the "deliberate communication" case. Plan body and diagrams reflect the new
> shape; this checklist has been updated to match.
