# Optional OpenAI adapter — source preview

This source adapter connects the same core's extract/classify/select/rank ports
to pinned `gpt-4.1-mini-2025-04-14`. One synthetic real-provider lifecycle has
passed; see the [run evidence](plans/live-provider.md). Neither that smoke test
nor offline fixtures establish general semantic quality, client support or launch readiness.
The hosted plugin and dependency-free core are unchanged.

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

Completed response status, pinned model, assistant text, JSON object, consistent
usage and output limits are checked. Core still validates source indices, refs,
namespaces and revisions; schemas do not prove relevance or entailment.
[Official counting guide](https://developers.openai.com/api/docs/guides/token-counting),
[Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).

## Dependencies and remaining gate

The isolated private package pins `tiktoken@1.0.22` (WASM) with registry integrity
and no transitive dependencies. Its package metadata declares MIT, but the
1.0.22 npm archive omits a standalone license notice. The local install artifact
includes the upstream notice under `licenses/tiktoken-LICENSE`; its source is
recorded in `packaging/THIRD_PARTY_NOTICES.md`. This package comes from third-party `dqbd/tiktoken`,
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
