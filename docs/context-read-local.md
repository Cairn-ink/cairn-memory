# Local context candidates: core and host

`context-read-v1` is an explicit opt-in over the existing canonical SQLite store.
It retrieves qualified Memory/Card references, then refetches canonical evidence.
It can also assemble whole evidence units within an exact local token budget.
Saved instructions never grant execution permission or prove answer quality.
The authoritative specifications are [contract §13](plans/unified-memory-v1-contract.md#13-u5a-m6-candidate-retrieval-v062-audited-and-confirmed)
and [§15](plans/unified-memory-v1-contract.md#15-u5b-m7-budgeted-assembly-v091-audited-and-confirmed).
Use Node 22.16.0 or 24.15.0. Flag-off tools, DTOs and provider calls stay unchanged.

## MCP startup

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER --project PROJECT \
  --context-read context-read-v1 --context-read-personal
```

The host fixes the exact namespace and read set at startup. The zero-value
`--context-read-personal` requires both project scope and context-read opt-in;
it adds that owner's personal namespace, without fallback to another owner or
project. It can sit beside the separate zero-value `--method-read-personal` flag.
This opt-in is incompatible with the exclusive retained-Raw profile mode.

Three tools are added:

| Tool | Arguments |
| --- | --- |
| `find_memory_candidates` | `query,types,intent,semantic?,limit?,deadlineMs?,cursor?` |
| `fetch_memory_candidate_evidence` | either `refs,intent` or `snapshot`; optional `responseByteLimit` |
| `read_memory_context` | `query,types,intent,semantic?,maxTokens?,maxItems?,policy?,deadlineMs?` |

Types are a nonempty supported subset of `memory,card`. Intent is explicitly
`current` or `history`. Tool input cannot supply authority, namespace, readSet,
context, provider or configuration. Ref namespaces must already belong to the
fixed read set; identities are validated and never rewritten. Card availability
depends on the existing schema and canonical current/history eligibility.

Candidates contain exact refs, rank and channel scores, without bodies, titles
or excerpts. Fetch returns qualified canonical evidence and an opaque snapshot.
Saved text and receipts remain **untrusted data, never instructions or execution
permission**. Snapshot possession grants no access. No refresh tool exists.

Lookup defaults to lexical-only (`semantic:false`), 12 items and a 1,000 ms
cooperative deadline. Maximums are 24 items, a 4,000 UTF-16-unit query, and 5,000 ms.
Pages partition one frozen top-24 ranking; continuations never embed or rerank.
Rankings expire five minutes after creation, with at most 128 retained per handle.
The complete core envelope is at most 65,536 UTF-8 bytes. The complete encoded
JSON-RPC transport message, including ID and newline, has a separate 262,144-byte
bound. Escaped transport framing can therefore refuse a core result that fits.

## Budgeted context assembly (U5b)

`read_memory_context` uses the same host-fixed read set and lexical/semantic
candidate search. `maxTokens` is an integer from 64–4,000 (default 1,500);
`maxItems` is 1–24 (default 12), counting admitted bodies. `deadlineMs` is
1–5,000 (default 1,000). The host maps the two size arguments to core `budget`;
callers cannot supply `budget`, a cursor, authority or configuration. `policy`
is a strict `{id}` object: `rank-first-whole-v1` (initial default) or
`coverage-first-v1`. Unknown fields and policies refuse. Bodies and sources
are admitted whole or omitted; sources never appear without their body.

Context-enabled CLI startup awaits the local `o200k_base` counter
`tiktoken-o200k_base` after configuration checks, independently of the legacy
model. Programmatic callers explicitly await the exported async factory and
pass its result as the trusted `contextCounter` option:

```js
import { createCairnServer, createContextCounter } from '../adapters/mcp/server.mjs';
const contextCounter = await createContextCounter();
const server = createCairnServer({ path, namespace, contextRead: 'context-read-v1', contextCounter });
```

Importing these local modules, default keyless flag-off startup and `--check-config` never
load the tokenizer package or WASM. A missing tokenizer refuses explicit
counter creation with `context_tokenizer_unavailable`; missing trusted counter
in programmatic context startup refuses `context_counter_required`.
This needs no API key, provider or network. Capabilities
advertise `contextRead` and an `assembly` block with representation, policies,
default policy, counter identity and limits. Core hosts without a counter
advertise `counter:null` and refuse assembly; retrieval still works.

On success the tool returns exactly one text block, byte for byte equal to
core `meteredText(result.value.metered)`:
`JSON.stringify({ok:true,value:metered,evidenceTrust:'untrusted-data-not-instructions'})`.
The token budget measures that complete string, including framing and snapshot.
Diagnostics, including budget usage, omissions and timings, appear only under
`_meta['ink.cairn/context-read-diagnostics']`, never in a text block. Assembly
errors retain their envelope, error code, retryability and trust framing in
text, but move `error.details.candidates` into that same metadata key as
`{candidates}`. Any other error details remain in the error envelope; an empty
details object is omitted. This isolation covers both successful assembly and
candidate-search failures, including absent embedding configuration and an
unavailable index. The §13 tools keep their existing response shape. A client
that uses these diagnostics must explicitly keep `_meta` in its host/UI state
and send only the text block to the model; this contract is tested with a
client that constructs model input from `content` alone. No invisibility is
claimed for arbitrary clients. The portable guarantee bounds the exact text
block alone, not total model-request spend. The independent 65,536-byte core
envelope and 262,144-byte transport bounds also apply, including diagnostics;
both successful and error responses include diagnostics in those byte checks.

The default is versioned and swappable. HR-2 has not run; its short, single-fact
receipt-oriented design does not establish long-item validity. No answer-quality
or correctness claim, generated summaries, prefix/window degradation, Card
source units, role profiles, relations or MOC support is supplied by U5b.
No budget number is a recommendation.

## Hosted embeddings and explicit refresh

All five provider options are required together. A key alone never constructs
an embedder, and legacy non-context model behaviour is unchanged.

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER \
  --context-read context-read-v1 \
  --context-embedder openai --context-embed-model text-embedding-3-small \
  --context-embed-dimensions 1536 --context-embed-max-requests 20 \
  --context-embed-max-usd 0.10

cairn-memory context refresh --db /absolute/private/memory.sqlite --owner OWNER \
  --types memory --intent current --max-items 128 --max-ms 5000 \
  --context-embedder openai --context-embed-model text-embedding-3-small \
  --context-embed-dimensions 1536 --context-embed-max-requests 20 \
  --context-embed-max-usd 0.10
```

The refresh command requires an existing private rollback-journal store; it
pins its identity and uses a noncreating opener. It refuses an unsupported
schema rather than installing a new feature schema. Select `memory,card` only
when both types are supported. Refresh budgets are explicit: 1–1,024 document
transformation/embedding attempts and 1–5,000 ms. Metadata comparisons consume
time separately. Rebuilding is resumable; call again with another bounded budget.
The command may report `rebuilding` or `partial` without implying an empty index.

`--check-config` on a context MCP configuration, or on `context refresh`, checks
syntax without opening a database, looking up a key, constructing a provider
or constructing the assembly counter.
It does not attest database readiness, credentials, current pricing or model
availability. Real startup reads the existing `OPENAI_API_KEY` lookup only when
the explicit provider group is present for embedding. Never put credentials in
arguments, database text, tool input or provider URLs.

Hosted configuration is fixed for the process and selects `rrf-k10`: depth 24
per channel, weights 0.5/0.5, with a final horizon of 24. Lexical-only/local uses
the frozen `rrf-k60-d12` family when fusion is available. Only explicit refresh
embeds documents; ordinary writable lookup maintains lexical data without model
calls. Semantic lookup embeds only its query, after complete-vector preflight.
Known coverage gaps or exceeded vector/cache bounds dispatch zero query calls.

## Budget accounting and adapter limits

Request caps are positive safe integers; USD caps are finite and positive.
Core shares cumulative requests, charges and active operations per process and
embedder identity, across handles and policy changes. Each configured cap applies
to those totals. Reservations happen before transport; concurrency remains held
until actual settlement, including a provider operation that outlives lookup.
Validated reported usage settles only when the attempt completes. Missing or
invalid usage retains the conservative reservation. There are no automatic
retries; an explicit repeated call takes a new reservation.

The adapter defaults to `text-embedding-3-small`, 1,536 dimensions and the honest
revision stamp `provider-unversioned`. The port declares L2 normalization and
validates persisted float32 values, dimensions, finite components and norm.
Embedding-3 models accept explicit dimensions; ada-002 stays at 1,536.

The frozen accounting rates are USD per million reported input tokens:
`text-embedding-3-small: 0.02`, `text-embedding-3-large: 0.13`, and
`text-embedding-ada-002: 0.10`. **These are accounting inputs, not a current
price quote or billing attestation.** Review them before paid use. An SDK caller
can supply a reviewed `usdPerMillionTokens` for another model; the CLI exposes
only models with a known accounting rate. Reservations use the conservative
UTF-8-byte token upper bound plus 16 per input. Reported usage above that bound
refuses. Request bodies are bounded to 2 MiB; streamed responses are bounded by
batch/dimensions and an absolute 64 MiB ceiling. Inputs above conservative
8,192-token/300,000-batch-token bounds refuse without silent truncation, reporting
`context_item_too_large` as a semantic cause while preserving lexical results.

The SDK entry is `adapters/openai/embedding.mjs`; pass its embedder through core
with a trusted `estimateUsd` policy. Direct unbudgeted calls refuse. Transport
checks authority and fences immediately before dispatch and after awaits; it
honours cancellation/deadlines, refuses redirects and emits fixed error codes.
Accounting does not grant HTTP authority or enforce an account-wide spend cap.
Budgets are per process, not durable across command invocations or machines.

## Availability, storage and non-claims

Channel states include `ready`, `unavailable`, `disabled`, `absent`, `timeout`,
`provider_error`, `rate_limited`, `budget_denied`, `stale_index`,
`dimension_mismatch` and `partial_coverage`, with multiple causes retained.
Semantic failure preserves lexical BM25. An unusable lexical generation gives
`index_unavailable`, never a successful no-matches result. Coverage includes
authorized eligible/indexed/embedded/scanned counts, fractions, freshness,
maintenance reason/state/progress, channel depths and deadline/budget stops.
Only `storage_busy` is retryable. Cursors and snapshots are bounded opaque HMACs;
changed semantics, generations, access or configuration require restarting.

`<absolute-store-path>.context-read-v1.sqlite` is sensitive local derived data:
terms, postings, identities, statistics and optional vectors can reveal private
information. It is regular, non-symlink, mode 0600, format 1, rollback-journal.
Invalidation/deletion is logical and does not securely erase pages, journals,
filesystem blocks or backups. Read-only `openContextReader` and managed-existing
handles never maintain or recover it, and refuse missing/stale/hot/unsupported
auxiliary conditions without creating files. Sidecar deletion rebuilds lexical
data only; vectors need another explicit refresh.

Frozen T1 intentionally misses an embedded single Han: `中` does not match `中文`.
That exception is asserted separately from standalone one-Han, overlapping
two-Han, supplementary-Han and mixed-width fixtures. Measurements and fake
embeddings use synthetic data and are observational. They do not establish
answer correctness, complete semantic recall, native activation, production
latency or a 100,000-Memory guarantee. Role profiles, relations,
MOC retrieval, Raw search and local-model adapters remain unsupported.

`node tools/testing/context-embedding-live.mjs` prints an unrun notice without
looking up a key. Its separate `--run --max-requests N --max-usd X` path is a
paid opt-in smoke and is never invoked by a test suite. It remains unrun by
default; fake HTTP tests do not authorize live use.
