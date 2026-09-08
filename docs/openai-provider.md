# Optional OpenAI adapter — source preview

This source adapter connects the same core's extract/classify/select/rank ports
to pinned `gpt-4.1-mini-2025-04-14`. One synthetic real-provider lifecycle has
passed; see the [run evidence](plans/live-provider.md). Neither that smoke test
nor offline fixtures establish general semantic quality, client support or launch readiness.
The hosted plugin is unchanged; core gains no provider dependency.

## Experimental extraction-only profile

The default remains `gpt-4.1-mini-2025-04-14` for every method. An explicit
`extractionModel: 'gpt-5.4-mini-2026-03-17'` option on `createOpenAIModel` selects
that snapshot for extraction only, with `reasoning: { effort: 'none' }` on both
count and generation. Classification, selection and ranking keep the existing
model and request shape. Unknown models/options fail before network I/O; there
is no automatic fallback or default promotion.

This is an unmeasured experimental profile, not a quality claim. The
[official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
documents the 400,000-token window, snapshot, structured outputs and reasoning
`none`. The [count API](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens)
also accepts reasoning configuration (confirmed from its Markdown reference).
Local 6,000 input /1,024 output limits and the 1,024 framing allowance remain
unchanged. The smaller profile context window is reported conservatively;
server counting still checks each method's selected window.

`createBudgetedFetch` needs the same explicit `extractionModel` option to allow
experimental requests. It verifies method/model/reasoning, then reserves integer
millionths of a dollar before each HTTP call: 4,448 for the default model or
9,876 for candidate extraction. At the documented US$0.75 input /US$4.50 output
per million tokens, the candidate ceiling is 7,024 input +1,024 output tokens.
Count calls and failed/ambiguous outcomes are reserved too, never refunded.
Per-request model identity and reservation units are recorded; observed generation
usage estimates use that model's rate and are not invoices/account-wide caps.
Rates were checked 2026-09-09; recheck before later paid runs.

See [measured-profile acceptance](plans/extraction-model-profile.md). No existing
corpus, rubric or historical report is rewritten by this option.

Extraction instructions require source-faithful relationships, negation, modality,
attribution and uncertainty, without invented entity types or stronger claims.
This is a prompt policy, not an entailment validator: valid source indices and
high confidence do not establish that a captured claim is supported. The failed
frozen evaluation and subsequent verification are retained in
[source-faithful extraction](plans/source-faithful-extraction.md).

## Offline checks

With Node >=22.16, from a source checkout:

```sh
npm ci --prefix adapters/openai
npm run test:openai
npm run demo:openai-offline
```

The demo uses the real tokenizer/adapter, fake HTTP, a synthetic key and temporary
SQLite. No environment key is read and no request leaves the process. Scripted
server counts are not evidence of actual provider framing.

## Host and data boundary

`adapters/openai/index.mjs` exports `createOpenAIModel({apiKey,fetchImpl?})`.
A trusted host supplies an explicit key and injects the result into
`openMemoryCore({path,model})`. Construction/local counting makes no HTTP calls.
Calling a model method without fake transport sends selected input to OpenAI
and can incur charges. The adapter never reads environment or logs credentials.

The HTTPS endpoint and model snapshot are fixed. Redirects, retries, tools,
conversation state and fallback models are disabled. Both HTTP phases share the
core's single 30-second AbortSignal deadline. Errors omit raw provider bodies.
Each model-port invocation makes at most two HTTP calls (count, then generation);
the core's three-call recall ceiling can therefore entail six HTTP operations.
`store:false` disables response storage for later retrieval; it is **not** a
zero-retention guarantee. Counting also transmits input externally. Hosts need
appropriate consent and provider data-policy review before using conversations.
Local redaction does not guarantee removal of all sensitive content.

## Counting and output

The synchronous `o200k_base` counter measures exact serialized text, treating
special-token-looking strings as ordinary text. Core retains 6000 input /1024
output limits. Server preflight counts the same input-bearing fields as generation,
including strict output schemas. It must fit local count +1024 framing reserve
and leave room for output. Oversize fails before generation, without truncation.

Classify/select/rank response schemas constrain references to the request's
snapshot: classification uses visible L1/L2 group IDs and supplied memory IDs;
recall uses the supplied namespace indices, memory IDs and revisions. An empty
group or candidate set permits only an empty reference array, never fabricated
IDs. Both count and generation use the same derived schema, and the live budget
guard verifies that schema against the serialized input. The core still checks
correlated namespace/memory/revision tuples and current authority; independent
enums do not replace those checks. Larger candidate schemas consume the same
1024-token framing reserve and can fail explicitly before generation; no budget
is enlarged to accommodate them.

Classification instructions distinguish an empty complete map from uncertainty:
a clear subject without a suitable visible L1 group should propose a precise
new topic. Existing-parent arrays remain empty when no such groups exist.
Unclear memories can remain unfiled, and incomplete maps cannot propose new
topics. A schema-only two-fact probe produced valid output but left both facts
unfiled; the subsequent instruction experiment filed both into a shared precise
topic. This is a narrow integration result, not general semantic-quality
evidence. See [reference-constraint acceptance](plans/provider-reference-constraints.md)
for retained failures and the separate frozen-evaluation gate.

Completed response status, pinned model, assistant text, JSON object, consistent
usage and output limits are checked. Core still validates source indices, refs,
namespaces and revisions; schemas do not prove relevance or entailment.
[Official counting guide](https://developers.openai.com/api/docs/guides/token-counting),
[Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).

## Dependencies and remaining gate

The isolated private package pins `tiktoken@1.0.22` (WASM) with registry integrity
and no transitive dependencies. It is MIT licensed; the installed package retains
its license notice. This package comes from third-party `dqbd/tiktoken`,
not an OpenAI-maintained JavaScript tokenizer. Ranks are bundled, not downloaded
at runtime. No provenance attestation has been verified.
[Dependency metadata](https://registry.npmjs.org/tiktoken/1.0.22).
One encoder is retained for the module lifetime. A pure-JS alternative was
rejected after a maximum-length whitespace fixture blocked counting; the same
fixture and independent encoding vectors remain regression gates.

Roadmap 2a needs a real synthetic lifecycle and count/usage agreement under
authorized test credentials and a paid-run ceiling. The opt-in runner below
records that evidence; it is not run by ordinary tests or CI. Frozen
semantic/resource evaluation remains separate 2b.
See [offline acceptance](plans/openai-provider.md) and
[roadmap](plans/delivery-roadmap.md).

## Opt-in live lifecycle

After installing the optional adapter, supply only `OPENAI_API_KEY` through your
process environment or secret manager. Do not source a whole application env or
put a key in the command line. On Node >=22.16:

```sh
npm run test:openai-live -- --live --budget-usd 0.25
```

This performs paid requests with a fixed synthetic fixture and a new temporary
SQLite database, never a supplied database path. It exercises capture,
classification, recall across reopening the store, correction and forgetting.
Reports omit raw requests/responses and keys. The synthetic database is retained
for inspection. The CLI exits nonzero for failed acceptance.

The guard reserves a conservative per-request cost before I/O, retaining the
reservation even on unknown/failed outcomes. Both count and generation requests
consume the allowance; no assumption of free counting is required. At most 40
HTTP requests are allowed per invocation. A budget is required and cannot exceed
US$5. Reported usage cost is an estimate under the documented model rates, not
an invoice; the guard is not an account-wide provider spending cap. The CLI
budget resets per process: callers must subtract previous reservations before
rerunning under a shared total authorization. Never run simultaneous live tests
against a shared allowance without an external coordinator.

The small fixture tests integration, not representative relevance, competition
with other products, or real-human benefit. See [live acceptance and run
evidence](plans/live-provider.md) for actual outcomes and outstanding gates.
