# 2a-offline — pinned OpenAI adapter, not real-model acceptance

Parent: `2a97af2b4fb1fe8e4277954143a840c6c7135e0b`,
`feat/recall-continuation`, [PR #15](https://github.com/Cairn-ink/cairn-memory/pull/15).
This bounded subpackage implements the offline portion of roadmap 2a. The real
provider lifecycle and semantic/resource evaluation remain unpassed. No model
requests, credential discovery, publication, merge or deployment are authorized.

## Contract frozen before implementation

- Isolate optional dependencies under `adapters/openai/`: private package,
  `tiktoken` exactly 1.0.22 (WASM), lockfile including integrity. Use bundled
  `o200k_base` ranks, no runtime download or heuristic counter. Count ordinary
  text synchronously, including literal special-token strings as ordinary text.
  This is third-party MIT software, not an OpenAI-maintained JavaScript SDK.
- Export `createOpenAIModel({apiKey,fetchImpl?})` from `adapters/openai/index.mjs`.
  Require an explicit nonempty key; do not read environment or log it. Injected
  fetch is a trusted host/test seam. Native fetch is the default. Fixed HTTPS
  origin `https://api.openai.com/v1`, redirects rejected, no configurable URL,
  retries, tools, conversation IDs, telemetry, fallback or model substitution.
- Pin `gpt-4.1-mini-2025-04-14`; expose `contextWindow:1047576`, synchronous
  `countTokens(text)` and extract/classify/select/rank methods matching the core.
  No second memory engine; existing source/ref/namespace validation remains final.
- Build one immutable input-bearing payload per method: model, instructions,
  one user message containing serialized input, strict method-specific JSON
  schema in text.format, and truncation disabled. Nested anyOf variants preserve
  optional classification fields without inventing null-to-omission semantics.
  All schema objects reject extra properties and require all declared fields.
- Before generation, POST that payload to `/responses/input_tokens`; accept only
  object=response.input_tokens and a safe nonnegative integer input_tokens.
  The local serialized core request must still count <=6000. Require actual
  provider count <= local count +1024 framing reserve, and provider count +1024
  output <= contextWindow. Fail explicitly before generation on overrun.
- Generate via `/responses` with exactly the same input-bearing fields plus
  max_output_tokens=1024, store=false and stream=false. Generation-only fields
  are excluded from counting. At most two HTTP calls per adapter invocation.
  Both use the supplied AbortSignal under the core's single 30-second deadline.
  Pre-aborted requests make no HTTP call; abort during preflight never generates.
- Bound decoded response bytes while reading: counting <=65536, generation
  <=262144. Reject malformed JSON, invalid envelopes, HTTP failures and redirects
  without including provider body, input, key or raw transport exception in errors.
  Require completed response and assistant message status, no error/incomplete
  details, only output_text parts, and valid JSON object output. Reject refusals,
  tools, unexpected output types, missing text and output exceeding 1024 local
  tokens or 40000 characters. Check returned usage counts are safe nonnegative
  integers, input matches preflight, output <=1024 and total=input+output.
- Keep existing core failure envelopes. Narrowly allow trusted MemoryStoreError
  codes context_budget_exceeded, token_count_unavailable and invalid_model_output
  through callModel; arbitrary adapter error codes remain operation failures.
  Timeout/cancellation retain existing precedence and no callbacks enter the final
  authoritative SQLite transaction. No schema/storage/MCP/plugin wire changes.

## Observable acceptance

- A01: frozen independent tokenizer vectors cover ASCII, Chinese, emoji,
  combining characters, JSON escapes and literal special tokens. No fixed/byte
  heuristic substitutes for the pinned tokenizer in adapter integration tests.
  A separate process must count 40000 contiguous spaces within a 5-second guard;
  an in-process timer cannot interrupt a blocked synchronous tokenizer. Retain
  the original exact 40000-character output acceptance without trimming input.
- A02: fake fetch records exact endpoints, headers, input-field equality,
  strict schemas, disabled storage/truncation, shared signal and two-call cap.
- A03: request and framing boundaries, malformed count, HTTP/body/JSON errors,
  refusal/incomplete/tool output, usage mismatch and output ceilings fail closed;
  no retries or generation after failed count. Errors contain no secret/body.
- A04: cancellation before/during both HTTP phases and shared core timeout are
  exercised offline. Core preserves only the narrow trusted budget/error codes.
- A05: real adapter + pinned tokenizer + mocked HTTP run synthetic SQLite
  capture → classify → recall → correct → forget; real core binds receipts and
  validates current revisions. The example is explicitly not a live model run.
- A06: adapter tests and example on Node22.16/24; existing 174 core tests, eight
  demos, plugin/JSON/isolated plugin gates remain green; independent Standards
  and Spec review inspect the same frozen candidate. Optional adapter install
  does not add provider dependencies to core/plugin runtime.
- A07: document dependency/license provenance, exact local vs provider counting,
  external transmission of count requests, store=false not a zero-retention
  guarantee, and the remaining live acceptance gate. No compatibility/quality
  claim or scored evaluation from transport fixtures. Do not provide an automatic
  live-test command before credential scope and paid-run ceiling are approved.

## Sources and choices

The fixed nonreasoning snapshot supports Responses and structured output;
this choice prioritizes reproducible bounded transport, not best-model claims.
[Model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Local text counting excludes provider framing; server counting covers it.
[Counting guide](https://developers.openai.com/api/docs/guides/token-counting),
[count schema](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens/methods/count),
[Responses schema](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create),
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
[Pinned dependency metadata](https://registry.npmjs.org/tiktoken/1.0.22).
Registry integrity is recorded; a provenance attestation has not been verified.

### Pre-candidate correction: repetitive-text tokenizer performance

Initial js-tiktoken 1.0.21 choice failed before delivery: the 40000-character
whitespace output fixture occupied a CPU for over 60s. The minimal counter-only
child-process test timed out at 5s twice. Separate ~40000-character words counted
in 3.8ms; 1000/2000 contiguous spaces took 60.8/212.5ms, isolating a repetitive-text
merge cost rather than general input size or initialization. Replace the pure-JS
port with pinned WASM tiktoken 1.0.22 and verify the same exact encoding vectors
and original boundary fixture. This change preserves semantics and budgets;
it does not establish general resource benchmarks or a hard real-time guarantee.
One module-scoped encoder is retained for the adapter module lifetime, not
allocated per request. Model dependency choice remains isolated from core.

Adapter worker owns adapters/openai implementation/package/lockfile only. Test
worker owns adapters/openai/test only. Primary owns shared error seam/tests,
example, CI, documentation, integration and final verification. Workers freeze
without commits or pushes. Live 2a and dependent quality/MCP delivery must not be
marked complete until their real acceptance evidence exists.
