/**
 * LLMClient is the minimal interface mcp-hooks needs from an LLM provider:
 * a single `classify(content, systemPrompt, options) → string` call that
 * sends one user turn under one system prompt and returns the assistant
 * text (with code-fence wrapping stripped).
 *
 * `mcp-hooks` does NOT ship a concrete adapter. Consumers wire up the
 * provider of their choice (Anthropic, OpenAI, a local model, etc.) by
 * implementing this interface and passing an instance to the hook
 * constructors.
 *
 * Minimum implementation contract:
 *   - `classify()` returns the assistant message text. Strip markdown code
 *     fences before returning — `stripCodeFences()` (exported from this
 *     module) is the canonical helper.
 *   - Errors (network, parse, auth) MUST throw. Hooks catch and convert
 *     thrown errors into fail-closed block decisions (details.degraded=true).
 *   - Honor `options.label` in log lines if you log; honor `options.maxTokens`
 *     and `options.temperature` if your backend supports them.
 */
export interface LLMClient {
  classify(
    content: string,
    systemPrompt: string,
    options?: ClassifyOptions,
  ): Promise<string>;

  /** Release timers, sockets, etc. Optional — adapters with no resources to free can omit. */
  destroy?(): void;
}

export interface ClassifyOptions {
  temperature?: number;
  maxTokens?: number;
  /** Short label appended to llm_call_start / llm_call_done log lines for debugging. */
  label?: string;
}

/**
 * Strip a fenced code block (```json ... ``` or plain ```) if the response is
 * wrapped in one, then trim. Handles common variants:
 *   - plain text (no fences)
 *   - fenced at the very start/end: ```json\n{...}\n```
 *   - leading prose then a fence: "Here's the JSON:\n```{...}```"
 *   - trailing prose after a fence
 *   - leading/trailing whitespace
 *
 * Idempotent: passing already-unwrapped text returns it unchanged.
 *
 * Regex shape note: only one ambiguous quantifier (`[\s\S]*?`). The opening
 * language tag is a closed alternation, no `\s*\n?` chains around the inner
 * capture — that prevents the polynomial backtracking pattern CodeQL flags
 * (ReDoS via overlapping `\n?` + `\s*` against newline-heavy input).
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json|JSON)?([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  return trimmed;
}

/**
 * Parse `raw` as JSON, defensively. Tolerates:
 *   - plain JSON ({...})
 *   - markdown-fenced JSON (```json {...} ``` or plain ``` {...} ```)
 *   - JSON with leading or trailing prose
 *   - leading/trailing whitespace
 *
 * Returns the parsed value, or throws if no valid JSON can be extracted.
 *
 * Adapters generally call this on the assistant response and surface the
 * resulting object/array. Hooks consume the parsed shape directly.
 */
export function parseJsonLoose(raw: string): unknown {
  const stripped = stripCodeFences(raw);
  // 1. Try direct parse on stripped content.
  try {
    return JSON.parse(stripped);
  } catch {}
  // 2. Walk to the first `{` / `[` and try parsing successive trailing slices
  //    from the matching closer. Handles "Here is the JSON: {...} thanks!".
  for (const open of ["{", "["] as const) {
    const close = open === "{" ? "}" : "]";
    const start = stripped.indexOf(open);
    if (start === -1) continue;
    const end = stripped.lastIndexOf(close);
    if (end <= start) continue;
    const candidate = stripped.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new SyntaxError(
    `parseJsonLoose: could not extract JSON from response (len=${raw.length})`,
  );
}
