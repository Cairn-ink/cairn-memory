# Controlled Mem0 wire validation before mixed transport

Fixed base `230d7ff5e348ba7e6180d9eac9a46a0a85cfe0fa` (PR #237).
Branch `feat/mem0-wire-contract`. Primary owns these decisions; one bounded
GPT-6 Sol/high author implements after dependency CI acceptance. Independent
nonauthor Standards and Spec review the exact final fixed-base candidate.

## Why this finite packet exists

The next mixed guard must validate native Mem0 chat and embeddings without
pretending that Cairn's generation wire or o200k tokenizer fits both. This is
the pure, locally testable part of the mixed-transport stage. It adds no guard,
claim, key owner, HTTP client, child process, schema migration or paid authority.
The subsequent guard composes it with the accepted bound-v2 ledger and lineage
assertion; the contained AF_UNIX gateway and common runner follow. No new
semantic score, official Mem0 parity or final S3 experiment freeze is claimed.

No credentials, operator ledger, corpus, holdout, consumed experiment or native
engine execution is allowed. Use synthetic strings and JSON only. Existing
ordinary Cairn/core/adapter behavior and all old evaluation grants stay intact.

## Observable acceptance

- W1 Add `evaluation/experiment-budget/mem0-wire.mjs` exporting
  `mem0WireProfile()`, `inspectMem0WireRequest(route, bodyText)`,
  `inspectMem0WireResponse(requestRecord, bodyText)` and `Mem0WireError` only.
  Route is exactly `chat` or `embedding`; body inputs must be primitive strings.
  Return immutable detached records; no filesystem/network/env/ledger writes,
  no payload logging. Errors use fixed safe code/message, never source/paths.
- W2 Profile version `mem0-text-wire-v1` is deeply frozen and specifies the
  following prospective controlled text profile. These are implementation
  limits chosen before holdout access, not tuned on it. A later run manifest
  must bind this exact profile along with native engine/config identity.

| Property | Chat | Embedding |
| --- | --- | --- |
| Model | `gpt-4.1-mini-2025-04-14` | `text-embedding-3-small` |
| Endpoint | `https://api.openai.com/v1/chat/completions` | `https://api.openai.com/v1/embeddings` |
| Encoding | `o200k_base` | `cl100k_base` |
| Input ceiling | 32,768 tokens including framing | 8,192 tokens/item, 300,000/request |
| Output ceiling | 2,000 tokens | 0 text output tokens |
| Input framing | 1,024 tokens | 0 |
| Request bytes | 1 MiB | 4 MiB |
| Response bytes | 256 KiB | 8 MiB |
| Input price, microUSD/token | 2/5 | 1/50 |
| Output price, microUSD/token | 8/5 | 0 |
| Reservation | fixed 16,308 microUSD | ceil(local summed input tokens/50), minimum1 |

  Embedding dimensions1536, float output,1–100 input strings. Chat uses exactly
  two messages, system then user, primitive content strings; native text
  add/search probe observed this wire. Chat output is a JSON object, max256
  `memory` array entries before any dedup, at most8192 cl100k tokens per nonempty
  fact text. No optional NLP, vision, reranker or procedural route is accepted.
  The profile states these caps rather than claiming native Mem0 itself imposes
  them. Integer costs use exact BigInt rational-ceiling math, then safe integers.
  Chat actual cost is ceil(prompt_tokens*2/5)+ceil(completion_tokens*8/5),
  component-wise as in the existing guard (1+1 tokens costs3microUSD, not2).
  Embedding actual cost is ceil(prompt_tokens/50), including0 for known zero
  usage; the minimum1 applies only to reservation, never fabricated actual cost.
- W3 Resolve existing pinned `tiktoken`1.0.22 with `createRequire` anchored to
  `adapters/openai/package.json`, as other evaluation tools resolve isolated
  dependencies. No new dependency/lock or adapter export needed. Use explicit
  encodings, special-looking token strings as ordinary text, no online counting.
  Do not silently reuse o200k for embeddings. Bound bytes before JSON parse and
  tokenize only bounded strings. Reject unpaired Unicode surrogates in strings
  that are counted or forwarded, to avoid differing normalization/accounting.
  Bound parsed JSON traversal to depth32 and1,000,000 visited values, including
  all keys/string values, before canonical serialization; use a bounded walk,
  not unbounded recursion. Request violations are unsupported_request. For a
  response, extract valid model/usage first: malformed/deep payload strings or
  metadata make payloadValidfalse, retaining known usage rather than erasing it.
- W4 Chat body exact keys: `model`, `messages`, `max_tokens`, `temperature`,
  `top_p`, `response_format`, `store`; exact pinned model, max_tokens2000,
  temperature0.1, top_p0.1, response_format exactly `{type:'json_object'}`,
  storefalse. Each message exact role/content keys, roles/order from W2. No
  tool/function/stream/extra fields, alias model or max_completion_tokens.
  Compute input bound as o200k(JSON.stringify(messages))+1024; refuse excess.
  Embedding body exact keys `model`, `input`, `dimensions`, `encoding_format`;
  exact pinned model/1536/float. Dense input array1–100, nonempty well-formed
  Unicode strings. Count each original string separately, including duplicates;
  enforce both per-item and summed-token caps. Never concatenate to count.
- W5 Accepted request record exact fields: `profileVersion`, `route`,
  `bodyText`, `inputTokenUpperBound`, `requestedOutputTokens`,
  `reservedMicroUsd`, `itemCount`. Chat itemCount2; embedding itemCount is input
  cardinality. bodyText is JSON.stringify of the validated parsed object;
  the future guard must forward this canonicalized text, never an unchecked
  alternate body. Thus duplicate source JSON keys follow JSON.parse semantics
  and cannot leave ambiguous duplicates on the outgoing wire. Keep a private
  WeakMap/WeakSet binding of records created by this module. Response inspection
  refuses forged/cloned summaries without invoking accessors. These transient
  records are validation context, NOT a spending capability or durable grant.
- W6 A response must fit the route byte cap and parse to an object with exact
  pinned response model before any usage can be priced. Usage counters must be
  nonnegative safe integers; chat prompt_tokens+completion_tokens=total_tokens,
  embeddings prompt_tokens=total_tokens. Unknown/malformed usage or wrong model
  throws fixed `invalid_usage`/`invalid_model` (no claimed actual cost). Known
  usage outside request bounds is not discarded: return its computed actual
  cost with usageWithinBoundsfalse for the later guard to record and halt.
  Chat compares usage to its validated input bound and requested output2000;
  embeddings compare usage to locally summed input bound. Ignore cache discounts
  conservatively; never refund reservation. Arithmetic overflow refuses safely.
- W7 With valid priced usage, validate payload independently and retain usage
  even when payload is malformed. Embedding: object `list`, one data entry per
  input, each object `embedding`, unique index0..N-1, finite numeric vector of
  exactly1536 values. Accept any data order with complete indices, no loss/dedup.
  Chat: object `chat.completion`, one choice index0, finish_reason`stop`, message
  assistant with string content. Content must parse to a JSON object. Missing
  memory, an empty array, or JSON falsey null/false/0/empty-string represents no
  extracted facts, matching pinned native text handling. A nonempty/truthy memory
  must be an array<=256 of objects. If text exists it
  must be a well-formed Unicode string; empty/missing text is non-embedded native
  data, not a fabricated memory. Check each nonempty text bound including repeats.
  Extra fact metadata may remain unchanged within byte bounds; do not invent
  provenance, truncate facts, rewrite text or repair malformed model output.
  Non-JSON/code-fenced malformed content is a rejected payload in this explicitly
  controlled json_object profile, not silently accepted empty extraction.
- W8 Response result exact fields: `profileVersion`, `route`, `inputTokens`,
  `outputTokens`, `actualMicroUsd`, `usageWithinBounds`, `payloadValid`,
  `failureCode`, `bodyText`. Embedding outputTokens0. payloadValid reports shape
  independently of usage bounds. failureCode null only when both pass, otherwise
  `usage_bound_exceeded` takes precedence over `invalid_payload`; bodyText is
  canonical parsed JSON only when BOTH pass, null otherwise. Future transport
  owns settlement/failure policy; this pure module sends nothing, grants nothing
  and never changes counters. Unsupported request shape/bounds use
  `unsupported_request`/`input_bound_exceeded`; bad route/input types/forged
  context use `invalid_options`; oversize/unparseable responses `invalid_response`.
- W9 Test actual cl100k vs o200k differences with fixed expected Unicode and
  ordinary/special-looking strings; exact boundary and one-over token/item/
  aggregate/byte counts; duplicated facts/inputs count separately; empty/nested
  input, bad models/extra keys/getters0, canonicalized duplicate keys, invalid
  Unicode; exact rational price rounding and no refund; correct/missing/bad/
  over-limit usage; malformed vectors/cardinality/index/model/chat/fact payload
  while known costs survive; frozen detached records, forgery denial; 256facts
  vs257 and per-fact boundary; no source in error code/message. Tests are wholly
  synthetic. No test can pass by skipping tokenizer or substituting a mock.
- W10 Append the focused test to existing `test:experiment-request-guard`
  without dropping others. Run full budget/guard/live-offline, generic, JSON,
  pinned strict plugin/marketplace and budget/guard demos on both Node22.16.0
  and24.15.0 using existing isolated dependencies. Primary actual diff and direct
  independent pure-wire checks, local frozen commit, independent Standards/Spec,
  correction loop, final current-head CI before ready. No TypeScript gate.

## Allowed files

New `evaluation/experiment-budget/mem0-wire.mjs` and one focused
`evaluation/experiment-budget/test/mem0-wire.test.mjs`; this plan; narrow
`docs/limitations.md`; root package.json appending its test. No existing guard,
ledger/core/adapter/runner/quota/host/CI/dependency/lockfile changes. No native
engine source patching or actual child execution. Worker reports mismatches
rather than expanding scope. No release/deploy/merge or operational migration.

## Source and next gate

Main inspected pinned Mem0 extraction/embedding paths and independently repeated
a controlled native fake-wire probe in an isolated disposable store. The current
packet captures only its text wire, not all native branches or provider access.
[Official embedding guide](https://developers.openai.com/api/docs/guides/embeddings)
specifies cl100k_base for3-small;
[API limits](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
and [embedding price](https://developers.openai.com/api/docs/models/text-embedding-3-small)
were checked2026-09-26 Taipei. Numeric ceilings are conservative pre-holdout
engineering choices, not a feasibility forecast or semantic benchmark result.

Preimplementation feasibility review (nonauthor GPT-6 Sol/high) clarified price
rounding, whole-forwarded-graph Unicode checks and native falsey memory handling;
primary incorporated those choices before author dispatch. The native embedding
adapter replaces newlines before sending and emits dimensions only when set;
this validator counts the actual received wire strings, not reconstructed source,
and the later native configuration must explicitly pin dimensions1536.

Next: distinct mixed capability+bound-v2 request guard, then revocable key-owning
AF_UNIX gateway/contained native child and matched renderer/scorer/runner. Joint
S3 source/role/cutoff/context/resource protocol and reserved30 manifest must be
frozen and feasible inside the remaining cumulative budget before any real call.

## W implementation and offline verification

This packet adds one pure wire-validation module and one synthetic focused test
file, appends that test to the existing explicit request-guard command, and
narrows the public limitation. Its only dependency at evaluation time is the
already pinned adapter-local `tiktoken` 1.0.22. The new entrypoints are not yet
called by an existing grant or runner: a future mixed guard must forward only
the validated canonical request body and separately own the one-shot claim,
physical transport and ledger settlement. Existing request guards and their
callers are unchanged.

The focused test first failed on Node 22 because its own nested-metadata fixture
replaced array entries in the wrong order and did not reach depth 33. Rebuilding
the chain deepest-first made the intended control fail closed; no production
logic changed. A second test-only correction made the source-free error check
assert that an error actually occurs and added the embedding 8 MiB/+1 response
boundary, a valid 100-vector response larger than the chat cap, numeric usage
and cost overflow refusals, and a >1,000,000-visited response retaining known
cost. Final focused tests passed 10/10 on each pinned Node. Primary separately
ran an independent pre-freeze pure-wire acceptance on both Nodes, including
hardcoded tokenizer goldens, canonical duplicate keys, known-usage failure
paths, exact fact limits and forged-record denial; both passed. Primary will
repeat that acceptance against the frozen SHA.

Independent review of first candidate `9f04225` found one profile completeness
issue: embedding's minimum-one reservation was enforced in code but absent
from the exported profile a later manifest must bind. The accepted narrow
correction adds frozen `minimumReservedMicroUsd:1`, uses that field in the
reservation calculation and asserts it in the focused test; no wire behavior
or ceilings change. Standards review found no issue. Primary's exact-first-
candidate 18-gate matrix and direct pure-wire acceptance passed on both pinned
Nodes before this correction. After the correction, focused W tests (10/10),
the complete request-guard command (265/265), generic tests (112/112), JSON
validation, and pinned strict plugin/marketplace validation all passed on both
Node 22.16.0 and 24.15.0. Primary final-head acceptance and independent
rereviews remain required.

With existing isolated OpenAI, MCP and pinned Claude validation dependencies,
the sequential offline W10 matrices were:

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm run test:experiment-budget` | 58 pass | 58 pass |
| `npm run test:experiment-request-guard` | 265 pass | 265 pass |
| `npm run test:live-evidence-offline` | 340 pass, 30 expected skips | 340 pass, 30 expected skips |
| `npm test` | 112 pass | 112 pass |
| `npm run validate` | pass | pass |
| `npm run validate --prefix tools/plugin-validation` (pinned Claude 2.1.260, marketplace and strict plugin) | pass | pass |
| `npm run demo:experiment-budget` | pass | pass |
| `npm run demo:experiment-request-guard` | pass | pass |

The Node 22 live-evidence gate preceded the final focused-test-only changes;
the runtime module was unchanged, and the final explicit guard command was
rerun after those test changes. No TypeScript gate exists. All checks were
local and synthetic; none used a provider, native Mem0 child or operational
data. The module grants no spending or transport authority and does not freeze
the S3 experiment.
