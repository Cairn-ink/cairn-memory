# Longer captured source history diagnostic

Base: `7e6b38d375d97b4f5d86486c3febec7efb525037` (installed answer delivery PR).

## Contract

1. A synthetic evaluation driver accepts injected `openClient({databasePath})`
   and `complete(body)`, no keys, global fetch, user databases or automatic paid
   authorization. It creates a fresh temporary database path, captures eight
   four-message windows, closes/reopens after each, and snapshots through actual
   MCP inspect tools. It never admits manual source records or supplies model
   routing labels. Caller owns installed runtime, guarded transport and budget.
2. Run four frozen queries over the same captured store, actual MOC source recall
   versus deterministic lexical-over-captured-receipt top-six. Preserve recall
   errors and partial successful results; source scoring happens before deciding
   whether an answer can be attempted. No oracle-rescue arm.
3. Score capture retention and per-arm required/irrelevant source IDs separately
   from answer quality. Evaluation IDs map to MCP-generated event hashes only
   for scoring. Never send scorer labels/expected answers/source IDs to model
   calls. Source-only contexts keep original role/text and memory provenance.
4. For each query alternate MOC/lexical answer order. MOC uses the exact tool
   result; lexical is explicitly marked a constructed control, not an MCP recall.
   Use the existing bounded answer consumer after scoring. Partial coverage
   yields explicit `answer_not_run_partial_coverage`; rejected source/overflow
   and failed completion stay visible with no retry. Empty successful evidence
   may yield appropriate ignorance. No semantic-success boolean from completion.
5. Enforce driver fixture limits of eight windows × four messages (800 units
   each), four queries (4,000 units each), unique IDs and valid disjoint scorer
   labels before opening any store. Paginate inventory and receipts under a
   finite snapshot cap; capture/cold-read errors must preserve partial outcomes
   and all query slots. Capture failures do not cause reruns. Client closes on
   errors. Transport failures remain caller's permanent-halt responsibility.
6. Offline tests exercise actual core/MCP-compatible envelopes with scripted
   models: source survival, deliberate capture/select/rank omissions, different
   actors and nonadoption, lexical control, partial coverage and error retention.
   They prove orchestration, not semantic quality. Full Node22.16/24 offline
   suites plus generic/JSON/strict-plugin gates and independent exact-candidate
   Standards/Spec review precede PR delivery.

## Separately gated live follow-up

Freeze source/runtime, fixture and independent semantic rubric before a once-only
installed MCP run. Expected ~80 HTTP requests, ceiling128 and US$1.50 conservative
reservations inside the unchanged US$50 ledger. No retry, model switch, failed
case replacement, tuning after outcomes, publication or deployment. Rehearse
success/malformed/transport paths and independently review exact operator before
any provider call. This plan and offline driver alone do not claim a live result.
