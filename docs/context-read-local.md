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
`coverage-first-v1` or `rank-first-first-source-v1` (body, then only the earliest
receipt per item). Later receipts count as omitted under the first-source policy;
the default remains `rank-first-whole-v1`. Unknown fields and policies refuse. Bodies and sources
are admitted whole or omitted; sources never appear without their body.

Context-enabled CLI startup awaits the local `o200k_base` counter
`tiktoken-o200k_base` after configuration checks, independently of the legacy
model. Programmatic startup also loads the counter automatically, without
changing the established synchronous call shape:

```js
import { createCairnServer } from '../adapters/mcp/server.mjs';
const server = createCairnServer({ path, namespace, contextRead: 'context-read-v1' });
const counterReady = await server.contextCounterReady;
```

The context-enabled server's `contextCounterReady` promise resolves `true`
when the counter is ready, or `false` if loading fails; it never rejects.
The §13 retrieval tools work while loading and after a failed load. Assembly
returns sanitized `token_count_unavailable` until readiness, and keeps returning
that error if loading fails. The server continues serving retrieval tools.
The CLI awaits its counter before serving, so stdio clients never see this
unready window. A programmatic host can also supply an optional trusted
`contextCounter` from the exported async factory, with immediate readiness:

```js
import { createCairnServer, createContextCounter } from '../adapters/mcp/server.mjs';
const contextCounter = await createContextCounter();
const server = createCairnServer({ path, namespace, contextRead: 'context-read-v1', contextCounter });
```

Importing these local modules, default keyless flag-off startup and `--check-config` never
load the tokenizer package or WASM. A missing tokenizer refuses explicit
counter creation and CLI startup with `context_tokenizer_unavailable`;
automatic programmatic loading resolves readiness to `false` instead.
This needs no API key, provider or network. Capabilities
advertise `contextRead` and an `assembly` block with representation, policies,
default policy, counter identity, limits and the exact omitted defaults. Core hosts without a counter
advertise `counter:null` and refuse assembly; retrieval still works.

On success the tool returns exactly one text block, byte for byte equal to
core `meteredText(result.value.metered)`:
`JSON.stringify({ok:true,value:metered,evidenceTrust:'untrusted-data-not-instructions'})`.
The experimental preview.2 assembly shape is now `representation-v2`, replacing
v1 without a selector. The metered value contains only `{framing,items}`. Each
item has `{ref,rank,body,sources}` plus non-default metadata and flags. Bodies
are whole canonical strings (Cards use `title + '\n' + body`); ranks retain
their original candidate positions. Compact refs are
`{ns,type,id,rev,f}` (Cards also require `bodyRev` before `f`), where `ns`
indexes the immutable startup read set in canonical namespace order. Copy
these refs verbatim into `fetch_memory_candidate_evidence({refs,intent})`;
compact and full refs can be mixed. A `snapshot_stale` refusal means re-run
`read_memory_context`. Caller-supplied `fences` or other prefix vectors refuse.

`sameAsBody` means this receipt's excerpt equals this item's body verbatim.
The alias keeps `index` and `role`; reconstruct its excerpt from that item's
body. It takes precedence over backward `sameAs` and never becomes a backward
alias target. `sameAs` still points to an earlier concrete source by item/source
position; receipt identity remains distinct. The separately authorized fetch
returns canonical receipt references, without source prose.

Omitted defaults are Memory metadata
`{state:'active',reviewState:'none',filing:{status:'unfiled'},kind:'fact',origin:'explicit',confidence:1}`,
Card metadata `{state:'confirmed'}`, `sourceAccess:'available'` and
`sourcesComplete:true`. Cards always retain `support` and `origin`. Full metadata,
full refs and unit token counts appear positionally in `diagnostics.items`;
diagnostics contain neither body nor receipt prose. `dedup.body` counts body
aliases; `dedup.sources` counts backward aliases.

The token budget measures the complete string, including framing and the
8-character `f` prefixes. The snapshot is host-only, under
`_meta['ink.cairn/context-read-snapshot']` beside diagnostics; it is never in
text or `structuredContent`. Core success is `{metered,snapshot,diagnostics}`.
The snapshot is derived once after admission and is `null` for an empty selection.
A host/UI that retains it can use `fetch_memory_candidate_evidence({snapshot})`
to refetch the exact delivered set in order.
Diagnostics, including budget usage, omissions and timings, appear only under
`_meta['ink.cairn/context-read-diagnostics']`, never in a text block. Assembly
errors retain their envelope, error code, retryability and trust framing in
text, but move `error.details.candidates` into that same metadata key as
`{candidates}`. Any other error details remain in the error envelope; an empty
details object is omitted. This isolation covers both successful assembly and
candidate-search failures, including absent embedding configuration and an
unavailable index. The §13 tools keep their existing response shape. A client
that uses diagnostics or the snapshot must explicitly retain `_meta` in its
host/UI state and send only the text block to the model; this contract is tested with a
client that constructs model input from `content` alone. No invisibility is
claimed for arbitrary clients. The portable guarantee bounds the exact text
block alone, not total model-request spend. The independent 65,536-byte core
envelope and 262,144-byte transport bounds also apply, including diagnostics;
both successful and error responses include diagnostics in those byte checks.

The `f` prefix is a store-keyed fingerprint of the untouched canonical evidence
item, checked in both core fetch reads after eligibility and revision checks.
It grants no authority. Compact-ref fetch re-authorizes every expanded namespace;
a revoked host cannot reuse its mapping to read evidence. Full refs keep their
existing exact-revision semantics. Compact refs additionally detect same-revision
receipt changes; snapshot fetch also checks namespace/access generations. A
filed-to-filed MOC parent move changes only a namespace generation: compact-ref
fetch succeeds with byte-identical evidence, while snapshot fetch refuses
`snapshot_stale`. Other mutation refusals retain eligibility/revision precedence;
see [contract §15.8](plans/unified-memory-v1-contract.md#158-amendment-v0104-representation-v2-host-only-snapshot-first-source-policy-u5b-2).

The default is versioned and swappable. HR-2 ran on a short, single-fact,
receipt-oriented synthetic fixture and kept rank-first as the initial default;
it does not establish long-item validity. No answer-quality
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
The OpenAI adapter renormalizes provider vectors with finite norms in [0.9, 1.1] before strict float32 validation.
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
latency or a 100,000-Memory guarantee. Role profiles, Raw search and local-model
adapters remain unsupported. Relations and MOC retrieval require the separate
source opt-in below.

`node tools/testing/context-embedding-live.mjs` prints an unrun notice without
looking up a key. Its separate `--run --max-requests N --max-usd X` path is a
paid opt-in smoke and is never invoked by a test suite. It remains unrun by
default; fake HTTP tests do not authorize live use.


<!-- U5c-2 optional source integration. -->
## Optional relation and MOC sources

Both sources stay off by default. Enable either ID or both at startup:

```sh
cairn-memory --db /absolute/store.sqlite --owner OWNER \
  --context-read context-read-v1 \
  --context-read-sources relations-one-hop-v1,moc-v1
```

Programmatic MCP hosts use `contextReadSources:['relations-one-hop-v1','moc-v1']`.
Core hosts use `contextRead:{version:'context-read-v1',authority,sources:[...]}`;
the existing counter and provider configuration is independent. Empty entries,
duplicates, unknown IDs and a source flag without context opt-in are refused.
`--check-config` reports sources and the preset without opening a database,
reading keys or constructing counters/providers.

Only these hosts add optional `sources` to candidate-search and assembly inputs.
Omission selects all configured sources; `[]` disables them for that call; a
nonempty list must be a distinct subset. Fetch schemas and evidence guarantees
are unchanged. Source-disabled hosts retain their original strict schemas,
wire responses, limits and presets.

`relations-one-hop-v1` expands current-intent evidence after direct ranking.
Only the first four direct candidates seed expansion, with two additions per
seed and eight per call. Incoming/outgoing `supports-decision` and
`challenges-premise`, undirected `contradicts`, and Card→Memory bindings are
supported. Both endpoints, exact revisions, receipt digests, bindings, Card
support and current applicability are validated. Each addition carries a
revision-bound `via` seed/family/direction. Additions appear immediately after
their seeds and never become new seeds. Direct membership, order and scores
are preserved. History reports `unsupported_intent` for relations.

`moc-v1` scores valid authorized Memory/Card topic titles using frozen T1 BM25,
including nonmatching valid titles in its statistics. Original title sources,
Memory projection visibility, member revisions and L2→L1 containment are
validated; members must be canonically current even in a history search. Card
title-source validity keeps organization support semantics; member admission
additionally requires current applicability. A
member takes its maximum containing-topic score, with twelve ranked members.
Unfiled or omitted evidence remains directly discoverable. MOC configuration
fixes `rrf-k60-d12-moc-v1`: k=60, depth=12 and lexical/semantic/MOC weights
0.45/0.45/0.10. Disabled or unavailable channels contribute zero; weights are
never renormalized, and this preset always uses RRF.

Opt-in freezes at most 24 direct candidates plus eight relation additions.
Pages and admitted bodies/fetch refs remain capped at 24; the candidate horizon
can reach 32, with at most 1,634 assembly counter calls. Each optional source
has 50,000 work units and 8 MiB accounted state. Indexed single-record seeks and
bounded support iterators charge visited authorized records, repeated passes,
endpoint/projection checks and support lookups. Relation admission reserves
work for subsequent witness validation; a fixed reserve covers fence reads.
The byte model conservatively charges object/scalar/slot overhead and UTF-16
string storage before collection growth, with a 64-KiB frame reservation and
4-MiB scratch reservation during a Card support check; it is not a V8 RSS measurement.
Optional Card support verification bounds Raw part-cache growth to 128 parts
per binding; inability to verify within that scratch reports `state_limit`,
without changing canonical Card eligibility or direct retrieval.
Corpora and scoring maps are released before ranking retention. Retained
identities, witnesses, fences and diagnostics share 16 MiB per handle, with
oldest-ranking eviction and existing `cursor_stale` behavior. Source `stateBytes`
and `peakBytes` describe the scan ledger; they are not retained occupancy.

Sources share the cooperative deadline. SQLite steps cannot be preempted.
Relations may keep a validated prefix on exhaustion; incomplete MOC statistics
or ranking contribute nothing. With the default caps, expect `moc-v1` to degrade
with `work_limit` on broad queries around 10,000 Memories (see
`docs/limitations.md`); it is most useful on smaller or selectively titled stores. Source diagnostics enumerate degradation and
never claim an unknown remainder is zero. They report no prose or foreign
counts. Core candidate results carry `trace.sources`; MCP keeps these source
diagnostics only in `_meta['ink.cairn/context-read-diagnostics']`. Candidate
`via` and MOC rank entries remain ordinary candidate data. Assembly diagnostics
and snapshots use the existing two metadata keys and add no model text block
or `structuredContent`.

Source fences include undelivered types, Card organization epochs and distinct
Memory projection states (live without a state row, unavailable, or a published
generation). Page delivery checks them in its authoritative read; assembly
checks them in its final transaction. Changed frozen dependencies refuse
`cursor_stale` / `snapshot_stale`; revocation remains `scope_changed`.
Compact refs and snapshots still prove only their existing evidence semantics,
not a durable discovery path.

These sources add no model calls, persisted source data, sidecar format change
or canonical DDL. They do not establish retrieval-quality improvement, truth,
adoption, two-hop traversal, MOC summary freshness, role/task behavior or
invalidation. Titles report `summaryFreshness:'unavailable'` with
`summaryFreshnessReason:'e1_seam_unavailable'`.
<!-- End U5c-2 integration. -->
