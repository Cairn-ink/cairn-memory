# Explicit disposition adapter, offline preparation

Base: `f9c91d4e8ba2515d61bb5def0ac4d1813f69d69d` (dependent core slice).
The core proposal contract needs a real provider transport before a later
fresh semantic comparison can test it. This slice prepares and verifies that
transport with fake HTTP only; it authorizes no provider call or paid guard
extension and does not promote a prompt, write path or production default.

- DA1: Add an explicit `reviewRationaleDispositions` method to the existing
  optional OpenAI adapter, reusing its pinned host, bounded count/generate
  transport, cancellation, immutable request serialization, framing checks
  and no-retry behavior. Select the existing `rationaleModel` profile without
  changing any model/default/rate/profile or existing method request bytes.
  Core, capture, MCP and normal recall never call it automatically.
- DA2: Add a dynamic-only request-scoped schema for the exact core input:
  one to six indexed source memories with valid retained receipt indices,
  roles/excerpts, plus zero to ten unique old edge tuples, sequential local
  old-edge indices and explicit `unverified` markers. Reject extra metadata,
  sparse/custom/getter input, invalid indices/correlations or repeated tuples
  before any HTTP; validate before serialization can erase offending fields.
  Preserve the current 6000-input/1024-output and response-body limits.
- DA3: Strict output remains exactly `{dispositions, additions}`, with
  request-scoped old-edge and memory/receipt indices and bounded arrays.
  Adapter parses but never repairs, supplies missing dispositions or upgrades
  uncertainty. Core remains authoritative for complete coverage, duplicate
  checks, withdrawal citations, overlap, projected bound and freshness.
  No new quote extraction, truth classification or semantic success claim.
- DA4: Keep the exported static `schemas` allowlist and every existing paid
  capability closed to this method. Use fake HTTP to prove existing guard
  refusal happens before transport/reservation. No experimental run factory,
  live launcher, key loading, shared/paid-budget write or paid run in this
  slice. A temporary synthetic ledger is permitted only for guard-denial tests.
- DA5: Exercise exact two-phase fake transport via the real core: mixed
  keep/withdraw/unknown/additions, malformed output, missing dispositions,
  wrong receipt association, empty old graph, bounds, cancellation and
  mutation during count. Assert stored records/graph/epoch unchanged and
  cold-readable; malformed inputs send zero HTTP. No user data or keys.
- DA6: Update provider/protocol/feature docs and changelog to say the explicit
  method exists but automatic use and paid experiments remain disabled.
  Include a real installed-artifact import and fake-HTTP core exercise on both
  runtime versions, so testing is not limited to a source-checkout adapter.
  No new dependency, schema migration, CLI flag, MCP tool or model selection.
- DA7: Run adapter tests and offline demo, relevant guard controls, core/generic,
  JSON/strict plugin and installed-artifact gates on Node22.16 and24.15.
  Primary independently reruns key paths and audits changed entrypoint/callers;
  independent fixed-candidate Spec/Standards review and exact-head CI precede
  ready PR delivery. No merge, release, deployment or paid requests.

One Sol/high worker owns this coherent adapter slice. Primary owns the
architecture, acceptance and later fresh experiment design. The frozen DR
prompt and earlier scored cases/results must not change. If the dependency
review changes core behavior, integrate that specific correction and rerun
the affected gates before final freeze. Do not conflate fake transport success
with improved memory reliability.

## Implementation and verification record

- Owner: delegated Sol/high worker; fixed base `f9c91d4e8ba2515d61bb5def0ac4d1813f69d69d`.
  The new entrypoint is only `createOpenAIModel().reviewRationaleDispositions`.
  Its caller is explicit embedded `core.reviewRationaleDispositions`; automatic
  capture, ordinary `relate`, basis review, MCP, guards and static `schemas`
  remain unchanged. The primary independently compares existing request bytes
  and owns final integrated reruns, fixed-diff reviews and delivery.
- Worker evidence on Node 22.16: targeted adapter 8/8 and installed artifact
  1/1, full OpenAI adapter 198/198, guard 90/90, core 697/697, artifact
  69/69, generic 121/121; JSON validation, store demo, OpenAI offline demo
  and `git diff --check` passed. Full adapter 198/198 also passed on Node
  24.15. Primary independently passed artifact 69/69, guard 90/90 and the
  offline adapter demo on both runtimes; its old/new extract, relate and
  reviewBasis count/generate request bodies were byte-identical on both.
  Primary full core (697 tests), store, generic (121 tests) and
  JSON/strict-plugin gates on both runtimes subsequently passed before freeze.
- The primary's first concurrent adapter-plus-artifact run reached 197/198
  adapter tests on each runtime: only the pre-existing tokenizer-performance
  child exceeded its five-second wall timeout. The old DR and DA copies use
  identical tiktoken WASM bytes. In isolated Node 24 runs, DA took 1504.8 ms
  and DR took 1511.5 ms; controlled 8/16-way old+new runs all passed, while
  48-way contention on 16 CPUs timed out all 24 old and all 24 new cases.
  This supports a load-sensitive existing wall gate, not a DA tokenizer
  regression. Serial old-DR full adapter on Node 24 and DA full adapter
  198/198 on Node 24 then 22 passed, as did both offline demos. The initial
  failures remain recorded; no tokenizer code, threshold, test, debug file,
  paid call or provider credential was changed to obtain the serial passes.
- Primary inspection prompted two bounded corrections: compact provider
  addition enums to stay within Structured Outputs schema limits, with
  endpoint/receipt correlation left to core; and reject custom array
  prototypes before JSON serialization. Targeted tests now cover both plus
  wrong-memory citation/addition rejection. No frozen DR prompt or core
  implementation changed. A temporary synthetic ledger is used only to prove
  old-guard denial without reservation or transport; no shared campaign
  ledger, credential, real provider request or paid budget is touched.
- Candidate SHA, independent review, CI and actual token/cost/elapsed-time
  accounting are pending; none is inferred from these fake-HTTP passes.
