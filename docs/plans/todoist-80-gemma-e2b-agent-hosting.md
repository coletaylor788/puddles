# Gemma 4 E2B agent hosting

**Status:** Design complete, awaiting approval  
**Issue:** [#80](https://github.com/coletaylor788/puddles/issues/80)  
**Last updated:** 2026-07-31

## Human section

### Design

Gemma 4 E2B is small enough to be a realistic always-on model for the Mac mini. It is the current model named E2B, where the E means effective parameters. It is much newer and more capable than the older Gemma 3n E2B. It supports long conversations, system instructions, thinking, images, audio, and native tool calls. Running it locally would keep household and friends conversations on the mini, remove per-message model cost, and keep those tiers available when an outside model service is down.

The model should run once as a host service and accept requests only from the agent gateway on the same machine. Household and friends agents continue to own separate sessions, workspaces, memories, tools, and message bindings. They share model weights, not agent state. Existing sandboxes and tool guards stay in charge of what each agent can read, change, or send. The model server never receives direct network traffic from people or agent containers.

This should be a staged local-primary design, not an immediate full replacement. Published results show strong basic instruction following, coding, and response speed for its size, but only about one quarter success on a broad multi-step tool benchmark. Very long context is also uneven. The first canary should therefore be the friends chat tier, which has the smallest write surface. Household follows with write tools withheld until task-specific tests pass. Read workers come later, after prompt-injection tests. Multi-step browser workers stay on the existing larger model unless Gemma proves it can handle them safely. The existing model route remains available for hard requests and failures, and no fallback may retry a turn after a tool has already changed state.

### Status

The research and design are complete. The recommendation is to approve a measured Gemma 4 E2B canary, not an all-at-once cutover. No software, model weights, configuration, service, or live agent route has changed.

Cole's approval is required before implementation. The future worker should inventory the target mini, test the exact model build on that hardware, and stop the rollout if safety, quality, latency, or memory gates fail.

## Agent section

### State

- Phase: design checkpoint
- Decision: proceed only as a staged canary after approval
- Exact model: Gemma 4 E2B instruction-tuned, quantized build
- Recommended server: Ollama through OpenClaw's native Ollama provider
- Initial route: friends chat tier only
- Permanent safety path: retain the existing larger model route
- Production impact in this task: none
- Blocking condition: implementation requires Cole's approval in a later task

### Scope and acceptance criteria

This design covers:

- the Gemma 4 E2B capability and limitation research needed to judge fit;
- one shared local inference service on the Mac mini;
- model routing for the household and friends chat tiers and their workers;
- isolation, network exposure, service health, capacity, observability, and
  failure behavior;
- an offline evaluation, load test, canary, promotion, and rollback design;
- the conditions under which a larger model stays in the path.

This design does not authorize:

- downloading model weights;
- installing Ollama, llama.cpp, MLX, or any dependency;
- changing OpenClaw configuration or agent tool lists;
- starting a model service;
- running prompts through live household or friends sessions;
- delivering messages or changing calendar, reminder, workspace, or account
  data;
- replacing the existing multiplayer model route.

The later implementation is acceptable only when:

- the exact quantized model and server version are pinned and recorded;
- the service binds to loopback and local cloud features are disabled;
- one model process serves all approved agents without sharing session state;
- existing per-tier workspaces, memories, sandboxes, bindings, and tool guards
  remain unchanged;
- no safety-critical test produces an unauthorized tool or delivery attempt;
- low-risk task completion is at least 90% and no more than five percentage
  points below the current larger-model baseline;
- required structured tool calls are valid at least 95% of the time in the
  narrow approved tool set;
- prompt-injection resistance does not regress from the current baseline;
- measured p95 queue-to-first-token latency is at most five seconds at the
  approved concurrency;
- the gateway, Docker sandboxes, and other host services keep their normal
  memory and responsiveness during a soak test;
- transport fallback happens only before any external mutation;
- rollback restores the prior model route without changing agent data.

### Architecture and decisions

#### Model identification and fit

- The intended model is Gemma 4 E2B. Google's current Gemma catalog lists it as
  the latest E2B model. Gemma 3n also has an E2B variant, but it is older and is
  not the recommended target for new work.
- E2B means 2.3 billion effective parameters. The model contains about 5.1
  billion parameters when its per-layer embeddings are counted.
- The instruction-tuned model supports text, images, audio, system prompts,
  thinking, and native function calling.
- Its native context window is 128K tokens. The design does not assume that the
  full window is useful or cheap on the target mini.
- Gemma 4 uses the Apache 2.0 license. Hosting it privately for these tiers does
  not require a custom Gemma use agreement.
- The training knowledge cutoff is January 2025. Current facts still require a
  trusted retrieval path.

#### Capability evidence

Google's published instruction-tuned E2B results include:

| Area | Result | Design meaning |
|---|---:|---|
| IFEval | 94.6% | Clear, narrow instructions are a plausible fit. |
| IFBench | 38.0% | Harder instruction combinations remain weak. |
| MMLU Pro | 60.0% | General knowledge is useful but below larger models. |
| GPQA Diamond | 43.4% | Difficult reasoning remains limited. |
| LiveCodeBench v6 | 44.0% | Better than older Gemma at this size, not a coding authority. |
| Tau2 average | 24.5% | Broad multi-step tool autonomy is not reliable enough for a blind cutover. |
| MRCR, eight needles at 128K | 19.1% | Advertising 128K does not mean dependable long-context recall. |
| RULER at 128K | 70.4% | Some long-context tasks work, so local evaluation must match real prompts. |
| GraphWalks below 128K | 4.1% | Long, stateful planning is a serious weakness. |

The Tau2 domain results in the technical report are 31.0% for airline, 34.6%
for retail, and 19.7% for telecom. The exact aggregate varies by report table,
but both views support the same decision: E2B can call tools, but broad
multi-step tool work needs a larger model or a much narrower task.

Google's LiteRT-LM measurements on a MacBook Pro with an M4 report about 901
input tokens per second, 42 generated tokens per second on CPU, and about 7,835
input tokens per second, 160 generated tokens per second on GPU for its
quantized E2B build. These numbers prove Apple Silicon feasibility, not target
mini performance. They use a different host and runtime. The implementation
must measure the exact Mac mini, Ollama build, model quantization, prompt size,
and concurrency.

#### Serving topology

```text
household or friends message
        |
        v
OpenClaw gateway on loopback
        |
        +-- agent identity, transcript, memory, tools, and policy
        |
        v
native Ollama provider
        |
        v
one Gemma 4 E2B process on loopback
        |
        v
Apple Silicon GPU and unified memory
```

- Ollama is the recommended first server because OpenClaw has a native provider
  for it, discovers model capabilities, preserves tool calls, and supports the
  current `gemma4:e2b` model.
- OpenClaw must use Ollama's native API. Its documentation warns that the
  OpenAI-compatible `/v1` path can turn tool calls into plain text.
- The server runs on the macOS host, not in Docker. Docker Desktop on macOS does
  not pass the Apple GPU through to Linux containers.
- The service binds to `127.0.0.1` only. Ollama cloud features stay disabled.
  The gateway uses the non-secret local credential marker expected by the
  provider.
- Agent containers do not call Ollama directly. They call tools through the
  gateway, and the gateway calls the model. This keeps model access inside the
  same control point as provider access today.
- One loaded model serves every approved tier. Separate model copies add memory
  pressure without improving agent isolation. Agent state remains in OpenClaw,
  not the model process.
- The model build, quantization, server version, and content digest are pinned.
  Updates are a separate measured rollout.

#### Capacity and context

- Start with one parallel request. Ollama defaults to one, and its memory use
  scales with parallel request count times context length.
- Start the test matrix at 32K and 64K context. Do not accept Ollama's 4K
  low-memory default for agent use, and do not allocate 128K only because the
  model advertises it.
- Choose 64K only if the mini stays responsive under the real system prompt and
  transcript mix. Otherwise use 32K with earlier compaction and shorter worker
  results.
- Keep the model loaded to avoid cold-start delay, but prove that the gateway
  and Docker workload still have enough unified memory.
- Bound the queue. A small household deployment should fail visibly rather than
  let hundreds of requests wait behind one long turn.
- Raise parallelism to two only if simultaneous household and friends turns
  pass the full memory, latency, and quality gates. Higher parallelism is out of
  scope for the first rollout.
- Cap normal response length. Thinking stays on for tool decisions and off for
  simple classification and short summaries unless evaluation proves another
  setting is better.

#### Agent routing

- Stage 1 routes only the friends chat tier to E2B. The friends tier has no PIM
  write tools in its current design, so it is the lowest-risk real chat canary.
- Stage 2 routes household chat only with calendar and reminder writes withheld.
  Message binding and escalation guards stay active.
- Stage 3 may restore household writes only after the exact action, argument,
  confirmation, duplicate-prevention, and denial cases pass.
- Tier reader workers move only after E2B resists prompt injection and produces
  faithful, bounded summaries from adversarial fixtures.
- Tier browser workers stay on the larger model by default. Their work is
  multi-turn, stateful, and exposed to hostile pages, which matches E2B's weak
  areas.
- The existing larger model remains available for unsupported work, complex
  research, browser tasks, and explicit escalation.
- Provider fallback may retry a request only when no tool or delivery action has
  started. Once an action starts, a retry could duplicate it. The turn must stop
  and surface an error instead.
- Quality fallback is not inferred from a confident-sounding answer. The agent
  either follows an explicit task route, asks for clarification, or relays the
  request to Cole.

#### Safety and privacy

- The local model changes inference location, not trust. All inbound content
  remains adversarial.
- Existing Docker boundaries, workspace mounts, per-tier memories, tool
  allowlists, message target guards, PIM scopes, and one-shot relay rules remain
  authoritative.
- No prompt, completion, tool argument, personal identifier, or message body is
  written to model-service logs. Metrics use agent id, timing, token counts,
  queue depth, result class, and low-cardinality error type only.
- Local inference removes prompt transit to an outside model service. It does
  not make the model more resistant to injection or hallucination.
- The OpenClaw local-model guide warns that small and heavily quantized models
  increase prompt-injection risk and can lose context. This is why reader and
  browser workers move after the chat canary, not before it.
- Health failures deny new local turns or use a pre-action fallback. They never
  bypass tool guards, widen a tool list, or silently select an unknown model.

#### Server alternatives

| Server | Decision |
|---|---|
| Ollama | Preferred first implementation. It has a native OpenClaw provider, model discovery, tool metadata, local-only mode, Apple Silicon support, queue controls, and parallel request controls. |
| llama.cpp server | Good second choice if Ollama cannot meet latency or memory gates. It supports Metal, continuous batching, parallel slots, metrics, schemas, and tool use, but OpenClaw would use a custom compatible route that needs extra parser testing. |
| MLX-LM server | Not recommended for this always-on service. Its own documentation says the HTTP server is not recommended for production and has only basic security checks. |
| LM Studio | Useful for manual experiments, but a GUI-managed loader is a weaker fit for an unattended Mac mini service than Ollama or llama.cpp. |

### Implementation

No implementation is authorized by this task. A later approved task should:

1. Inventory the Mac mini chip, unified memory, free disk, normal memory
   pressure, and peak Docker plus gateway load without recording personal data.
2. Create an isolated test service. Do not touch the live gateway route.
3. Pin the Ollama release and exact `gemma4:e2b` model digest.
4. Disable Ollama cloud behavior, bind loopback, keep one model loaded, set one
   parallel slot, and set a small queue.
5. Test 32K and 64K contexts with the real provider adapter but synthetic
   transcripts and recording tools.
6. Add an explicit local model provider while keeping the current provider
   available.
7. Build a separate test copy of the friends tier with the same prompt and tool
   policy but no live channel binding.
8. Run the focused evaluation and full shared test pool.
9. Start an opt-in friends canary only after every pre-canary gate passes.
10. Consider household, reader, and browser stages in order. Each stage requires
    its own review and rollback point.

Likely repository surfaces for the later task:

- `docs/plans/022-household-and-friends-tiers.md`
- `docs/plans/026-multiplayer-budget-guard.md`
- `docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md`
- `packages/e2e/`
- a new provider-neutral host service guide or script under
  `scripts/mac-mini/`, if existing host-service patterns do not fit

The future worker must inspect the installed OpenClaw and Ollama versions before
writing exact configuration. Current web examples are evidence for the design,
not deployment commands to copy without checking.

### Validation

#### Research evidence

Primary sources:

- Gemma 4 model card:
  https://ai.google.dev/gemma/docs/core/model_card_4
- Gemma 4 technical report:
  https://arxiv.org/html/2607.02770v1
- Gemma model catalog:
  https://ai.google.dev/gemma/docs/get_started
- Gemma 4 Apple and edge performance:
  https://developers.google.com/edge/litert-lm/models/gemma-4
- Ollama Gemma 4 model page:
  https://ollama.com/library/gemma4
- OpenClaw Ollama provider:
  https://docs.openclaw.ai/providers/ollama
- OpenClaw local model guidance:
  https://docs.openclaw.ai/gateway/local-models
- Ollama context and concurrency guidance:
  https://docs.ollama.com/context-length and
  https://docs.ollama.com/faq
- llama.cpp server capabilities:
  https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- MLX-LM server warning:
  https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md

The plan does not use unsourced community speed claims. The only quoted Apple
performance numbers are Google's LiteRT-LM measurements, and the plan labels
them as feasibility evidence rather than a forecast for Ollama on the target
mini.

#### Offline quality suite

Use synthetic fixtures and deny-by-default recording adapters. The suite should
cover at least:

- direct friends questions and correct out-of-scope relay;
- household questions with all write tools unavailable;
- directed-at-agent and `NO_REPLY` group classification;
- exact message target selection and blocked unbound targets;
- valid and malformed tool arguments;
- repeated or interrupted write attempts;
- calendar and reminder create, update, denial, and duplicate-prevention cases;
- web summaries containing direct and indirect prompt injection;
- requests to reveal another tier's memory, files, roster, or transcript;
- requests to widen tools, escape the sandbox, call the local model directly,
  or change model routing;
- stale facts that require retrieval rather than invention;
- ambiguous requests that should ask or relay rather than guess;
- long transcripts at 8K, 16K, 32K, and the selected maximum;
- thinking on and off for chat, tool, classification, and summary work;
- transport timeout, malformed model output, server restart, queue overflow,
  cancellation, and gateway restart;
- fallback before an action and explicit refusal to retry after an action.

Compare E2B with the current larger model on the same fixtures. Record task
success, unauthorized attempts, tool choice, argument validity, hallucination,
injection compliance, clarification behavior, response quality, input tokens,
output tokens, time to first token, total latency, and peak host memory.

#### Capacity suite

- Measure cold load and warm request behavior.
- Run one slot at 32K and 64K.
- Run two slots only after the one-slot run passes.
- Exercise simultaneous friends chat, household chat, reader, and browser-shaped
  prompts even if later stages are not approved.
- Confirm `ollama ps` reports full Apple GPU placement rather than CPU spill.
- Confirm normal gateway and Docker operations remain responsive.
- Run a restart test, cancellation test, queue limit test, and 24-hour synthetic
  soak.
- Confirm no prompt or completion text appears in service logs.

#### Promotion gates

- Zero unauthorized external mutation or delivery attempts.
- Zero cross-tier data disclosures.
- Zero successful prompt-injection attempts that widen capability or reveal
  protected context.
- At least 90% success on approved low-risk tasks.
- At least 95% valid structured calls on the narrow approved tool set.
- At most five percentage points of task-success loss from the larger-model
  baseline.
- p95 queue-to-first-token at most five seconds at approved concurrency.
- No sustained memory pressure, swap growth, model crash, gateway crash, or
  sandbox failure during the soak.
- Clean independent adversarial review.
- The entire shared integration pool passes with:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`

If E2B misses a quality gate, test Gemma 4 E4B on the same fixtures before
inventing prompt workarounds or fine-tuning. If E4B also misses, keep the
existing larger model for that role.

### Rollout and rollback

Rollout remains blocked until approval. The proposed later rollout is:

1. Run all tests against an isolated service and recording tools.
2. Add the local provider without selecting it for any live agent.
3. Create a test-only friends agent with no live channel binding.
4. Canary one explicitly opted-in friends conversation.
5. Hold for seven days with daily metric and transcript-quality review.
6. Expand friends only if the gate stays green.
7. Canary household with write tools withheld.
8. Restore individual household write tools only after their focused gate.
9. Move reader workers after injection and summary gates.
10. Leave browser workers on the larger model unless a separate browser gate
    passes.

Each stage changes one explicit agent route. There is no automatic tier-wide
promotion.

Rollback at any stage:

1. Stop admitting new local turns.
2. Restore that agent's prior model route from the saved configuration snapshot.
3. Restart or reload the gateway through its normal lifecycle.
4. Verify model routing, agent bindings, tool lists, workspaces, and memory paths.
5. Confirm the local service has no active requests, then unload or stop it.
6. Keep agent session and user data. No migration is needed because inference
   state does not become the source of truth.
7. Treat any turn that reached a write or delivery tool as non-retryable. Check
   its recorded result before a human or agent attempts the action again.

Automatic rollback should trigger on repeated model crashes, context failures,
queue overload, p95 latency above the gate, invalid tool-call rate above the
gate, any unauthorized mutation attempt, any cross-tier disclosure, or any
gateway or sandbox regression.

### Review log

- 2026-07-31: The Todoist tracking comment and issue format were verified before
  research.
- 2026-07-31: Repository research confirmed that the household and friends tiers
  already separate model inference from identities, workspaces, memories,
  sandboxes, tools, bindings, and delivery guards.
- 2026-07-31: Current model research resolved "Gemma E2B" to Gemma 4 E2B. Gemma
  3n E2B is an older model with the same effective-size label.
- 2026-07-31: Primary sources confirmed Apple Silicon feasibility, native
  function calling, a 128K advertised context, Apache 2.0 licensing, and strong
  narrow instruction following.
- 2026-07-31: Primary benchmark evidence also showed weak broad tool autonomy
  and uneven long-context planning. The recommendation changed from a shared
  all-agent model to a staged local primary with a larger-model safety path.
- 2026-07-31: Ollama was selected over llama.cpp and MLX-LM for the first
  implementation because OpenClaw has a native Ollama provider and MLX-LM
  explicitly warns against production use of its server.

### Checklist

- [x] Verify the first Copilot-authored Todoist comment is the issue #80
  tracking comment.
- [x] Verify issue #80 has only the plan link, `Summary`, and `Status`.
- [x] Create the plan before substantive research.
- [x] Trace household and friends tier identity, tool, sandbox, memory, worker,
  model, and delivery boundaries.
- [x] Resolve the requested model to Gemma 4 E2B.
- [x] Review primary model, benchmark, license, Apple performance, server, and
  OpenClaw provider sources.
- [x] Compare Ollama, llama.cpp, MLX-LM, and LM Studio.
- [x] Define serving, capacity, context, routing, observability, failure,
  evaluation, rollout, and rollback decisions.
- [x] Keep implementation and deployment unstarted.
- [ ] Complete independent adversarial review of the full design.
- [ ] Address accepted review findings and re-review.
- [ ] Validate plan and issue structure.
- [ ] Commit, push, and land the design artifact.
- [ ] Rewrite issue #80 for Cole's review.
- [ ] Add the Todoist result and move the task from `agent` to
  `ready_for_review` without completing it.
