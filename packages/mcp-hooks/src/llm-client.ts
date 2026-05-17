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
 *     thrown errors into fail-open allow decisions.
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

/** Strip a fenced code block (```json ... ``` or plain ```) if the response is wrapped in one. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1]!.trim() : trimmed;
}
