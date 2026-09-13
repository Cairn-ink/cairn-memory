# Automatic source-backed rationale and MCP evidence — R2/R3

Base `fd9786326fbbc666a00da76ff02c6af3956b0a57` after authorized merges #70/#71.
Goal: a submitted conversation can create proposed rationale links without
hand-wired memory IDs, and recall can carry linked evidence into ranking and
the final MCP response. No semantic-quality pass is implied by offline tests.

## Acceptance

1. Optional core/MCP configuration `captureRationale: 'source-bound-v1'` requires
   `captureQualification: 'source-bound-v2'`. Absent preserves existing behavior,
   payloads and call counts. Unknown/null/unsupported combinations reject before DB access.
2. After successful admission AND the attempted classification, one automatic
   rationale pass uses final guarded admitted revisions plus other current MOC
   query candidates in the same namespace. The existing bounded 1024-current-row
   query/index authority is reused, not a second retrieval engine. At most 6 refs
   enter one `relate` call. All newly admitted refs are retained; other candidates
   fill remaining slots in deterministic overlap order. Query uses up to 4000
   UTF-16 units of canonical retained source, with truncation reported. Candidate
   coverage is explicitly bounded/unassessed, never universal semantic coverage.
3. One-memory review is valid for a source containing both choice and reason.
   No model call for empty admission. Rationale failure does not undo or disguise
   an already committed capture: return a separate failed status. Duplicate/busy
   captures never rerun inference, and report that this pass was not run rather
   than claiming replay of an unavailable previous rationale outcome. No retries,
   pending queue, hidden hook or passive capture. Crash recovery of an omitted
   post-admission pass remains unsupported and must be documented.
4. The actual OpenAI adapter supports request-scoped `relate` schema using the
   existing pinned baseline/profile, framing counter, output validation, abort,
   redaction and no-retry transport. Do not add it to any paid experiment allowlist
   or grant old ledgers the new method. Offline fake HTTP first; live capability
   and frozen experiment are a following stage under existing cumulative budget.
5. Opt-in `contextMode: 'rationale-evidence'` for core fetch/recall and MCP carries
   source-only root + bounded linked rationale into ranking AND final read, even
   when only the decision was selected. Edges remain model-proposed and neither
   challenge nor recency changes the choice. Qualification true conflicts; only
   current view supported. Existing source/legacy modes remain unchanged.
6. No token-budget widening: full graph counts inside existing 4000 fetch and
   6000 rank input bounds; overflow fails rather than dropping reasons. Cursors
   bind the mode. Final atomic read revalidates all candidate graphs after the
   last callback, including unselected memories and mutation of linked evidence.
7. CLI `--capture-rationale source-bound-v1` follows constructor requirements.
   Syntax check remains DB/provider-free. Configured MCP adds keyless
   `inspect_rationale(memoryId, revision)` and the existing capture tool runs the
   new pass; default tools stay unchanged. Hosts should allow >=180 seconds for
   opted-in capture's four bounded model stages. No Hermes profile schema or
   default timeout change in this slice.
8. Scripted core tests exercise capture → discovery → relationship → recall →
   cold inspect → forget, including single-receipt reasons and unrelated/foreign
   candidates, stale guards, failure/duplicate and budgets. Actual adapter fake
   HTTP tests plus real SDK stdio/installed artifact tests cover opt-in use and
   compatibility. Run required generic/core/OpenAI/MCP/artifact gates on Node
   22.16 and24, independent dual review, CI before authorized merge.

## Boundaries and next experiment

Candidate selection still consults model-generated memory content through the
existing MOC candidate policy. It can miss paraphrases and conflate scope; linked
evidence is not proof. No answer-generation benchmark, validated claim-slot graph,
historical-rationale reconstruction or confidence-based authorization.
Next freeze fresh affirmative and negative conversation cases, compare baseline
and enabled behavior with the same model, and count false links, missed reasons,
invented adoption/replacement, evidence fidelity, cost/latency and abstention.
Do not tune on or rerun failed scored cases and call them held-out improvement.

## Verification record

All tests use synthetic temporary data. Root ran generic JSON/version/plugin
checks and core/OpenAI/MCP/live-offline/budget suites on Node 22.16.0 and24.15.0,
plus installed artifact tests (55 per runtime). New targeted automatic-capture
tests additionally exercise actual filing revision changes and query truncation.

The first combined dual-runtime run was over-parallelized: each runtime's
existing tokenizer process-timeout test exceeded 5 seconds; every other test
passed (27 pre-existing live skips). No tokenizer or timeout change was made.
The exact test run alone on base and candidate passed on both runtimes in
1.67–1.75 seconds. The complete adapter suite then passed separately with bounded
test concurrency (165/165 on each runtime); retain the original failure rather than counting it as a
semantic result. This performance observation concerns test scheduling, not
a measured speedup or a promise under arbitrary CPU contention.

Commands (repeat with each runtime):

```sh
npm test
npm run validate
npm run test:core
node --test --test-concurrency=2 adapters/openai/test/*.test.mjs
npm run test:mcp
npm run test:live-evidence-offline
npm run test:experiment-budget
npm run test:experiment-request-guard
npm run demo:store
npm run demo:moc
npm run demo:recall
npm run demo:capture
npm run demo:openai-offline
npm run test:artifact
npm run validate --prefix tools/plugin-validation
```

Use CONTRIBUTING.md dependency/cache preparation first. No user key, paid model
request, npm publication, deployment, hosted migration or production data repair.
