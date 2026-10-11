# MOC-prior candidate mixing — prospective offline contract

Fixed base: `f136f121966c8cffd6f789e26127502b7a866a65`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/moc-prior-candidates`.
Branch: `experiment/moc-prior-candidates`, eventual dependent PR on #395.
Owner: primary planning/integration; bounded implementation worker actual GPT-6.1 Sol/high; two independent nonauthor final reviews. No merge, release, deployment or paid call in this packet.

## Problem and evidence boundaries

A retained, explicitly supported answer card in a synthetic 96-card store is outside both actual selector input pages while question-only noise has higher literal overlap (target6/noise9). Exact-query control reaches and packs it. This was independently reproduced on Node22.16 and24.15. Smaller visibility crossings vary with UUID/token serialization: author75/76 on both Nodes, primary74/75 and76/77. Those are not universal thresholds. Short labels can recover visibility without selection. Correct manual filing and scripted ports do not prove natural classification or QA improvement. The fixed96 case is a pressure regression, not an official benchmark or a real-model result.

The existing top is1024/physical scan20000;36 is the chosen-reference limit. Existing recall does not route through topic catalogs. This packet adds a bounded topic prior, not hierarchical model traversal and not a claim of source truth.

## Acceptance

MP1. Add exactly one explicit constructor policy `sourceCandidatePolicy: 'moc-prior-keyset-v1'`. It affects only explicit source-evidence/rationale-evidence recall. Omitted option and `bounded-keyset-v1` retain byte-equivalent candidate order/payload/limits under equivalent stores; ordinary body recall, public maps, classification, auto-rationale discovery, MCP/Hermes settings and defaults remain unchanged. Accessors, unknown policies and malformed inputs reject without executing getters. No new captured fields/schema/dependencies.

MP2. Reuse the existing keyset scan20000/page256/top1024/first4source-receipts and current projection selection. Reorder ONLY that already eligible retained pool: no memory outside it, no new receipts/raw archive/history, no extra model call. All existing scan-exhaustion and top-pruning semantics survive. Keep row payloads/previews/source text unmodified. Cursor binding includes distinct policy and fixed mixing bounds.

MP3. Use each retained candidate's existing first valid current L1 placement (the same placement/ref it already exposes). Inspect at most64 distinct such topics, ordered by opaque topic ID. Positive literal query-title overlap ranks topics (score desc, opaque topic-ID tie); keep at most2. Per topic keep first3 members by existing lexical order, deduplicate to at most6 prior members. Consider title only if its original source bindings AND published projection are valid for the exact namespace/current revisions, nondeleted/nonawaiting; inspect at most64 bindings plus one overflow sentinel per topic and skip over-cap/empty/invalid titles. No title text or excluded source text may reach scoring before validity checks. Titles are untrusted filing hints, not factual evidence. Additional local reads/work bounded by existing1024pool,64topics,65binding rows/topic; no graph walk.

MP4. Stable mix: emit up to2 unseen lexical candidates then1 unseen prior candidate, repeating while the at-most6 prior queue has unseen entries; then append all remaining lexical candidates in original order. Skip duplicate IDs and preserve exact set/row objects. If there are no usable title matches, return exact legacy order. First2 lexical candidates stay first2. Misfiled/unfiled candidates remain in the lexical backstop; priority is not a guarantee every candidate is selected.

MP5. Preserve exact namespace, published generation, epoch, revision, receipt validation, review/currentness/deletion and final snapshot fences. Scoring/label/token callback mutation must not make stale content usable. A stale, orphaned, awaiting, wrong-namespace or unpublished title/binding cannot supply a prior. Reuse authoritative checks; do not weaken existing public title rules to implement this feature. No DB writes on recall/cold reads.

MP6. Regression: real public admission/placement/recall with retained source receipts, actual tiktoken and fixed96-card supported fixture from the diagnostic. Request-only scripted selectors/rankers must not receive evaluator IDs/gold; target identity used only in post-call assertions. Legacy policy target absent; new prior exposes/selects/packs target with unchanged source. Disabling the candidate must fail that expectation. This establishes plumbing/visibility only, not natural QA. Fixed source/query before first run, no adaptive case tuning after results.

MP7. Focused tests also cover: no-topic/no-match exact parity; unfiled/misleading topic retains lexical fallback; shared noisy topic has no promised gain; more than2 topics/3members and64topics/64bindings bounds; deterministic ties/duplicates; exact-query useful result preservation; CJK literal semantics unchanged; invalid/stale/deleted/review-awaiting/cross-namespace/projection-excluded title sources; generation publication and callback mutation; two selector rounds/one rank and existing token/output caps. Use direct storage tests only to establish adversarial corruption/bounds, not to seed the main public recall positive fixture. Test owned scratch cleanup on success and intentional failure. No real keys/API/operational ledger.

MP8. Required both Node22.16.0 and24.15.0 gates: focused tests, `npm run test:core`, `npm test`, `npm run validate`, Claude marketplace/plugin validators, and core demos store/history/moc/recall/rebuild/continuation. Primary personally reruns final combined key paths and full core regression, verifies no untracked source changes, actual exits and scoped scratch cleanup; inventories via independent Git and filesystem routes/count. Additional affected caller checks identified from actual diff. No TS gate exists here. Use owned test runner; demos intentionally retained/accounted synthetic DBs.

MP9. Deliver only after fixed-candidate Standards and Spec independent PASS and latest-head applicable CI. Changelog/protocol/limitations must say opt-in, same-pool only, manual-filing/scripted evidence, no QA improvement yet. Closed paid diagnostic and all historical data stay untouched. A later fresh, pre-frozen real-model test must first exercise natural filing/candidate consumption, measure paired first-answer correctness/support/stale use/abstention plus cost/latency under same resources, and not reuse closed datasets or silently pool scores. This packet does not authorize executing it.

## Allowed files and excluded work

Worker may edit `core/query-candidates.mjs`, `core/moc-storage.mjs`, `core/contract.mjs`, new `core/test/moc-prior-candidates.test.mjs`, existing `core/test/bounded-keyset-candidates.test.mjs` only if unavoidable compatibility tests, `docs/plans/moc-prior-candidates.md` (copy this contract verbatim before implementation, append evidence without changing MP1–MP9), `docs/protocol.md`, `docs/source-evidence-context.md`, `docs/limitations.md`, `ROADMAP.md`, `CHANGELOG.md`. A focused pure helper under `core/` may be proposed first if required; no broad refactor. Do not modify dependencies/package/CI/evaluation runtime or frozen source/rubric/operator/ledger. Ask primary for an implementation-boundary decision, not user, if contract conflicts with actual safe architecture. Stop before commit for primary inspection. At most two failed correction rounds per problem before rescope/takeover.

## Next gates

Offline candidate is accepted only as opt-in engineering experiment. Visibility is not selection, packed source is not correct answer, and authored correctness is not official competitive score. If it cannot pass bounded authority/regression tests, stop this candidate rather than weaken them. If offline passes, primary decides a fresh model study within remaining original US$400 cumulative budget and protected US$30, with no old-study retry or score overwrite.

## Pre-test scope clarification — isolated tokenizer tooling in core CI

Worker inspection found that the existing core CI job does not install the already locked isolated OpenAI tokenizer dependency. MP6 requires its actual tokenizer, not a skipped or substituted regression. Before the first new test run, primary authorizes `.github/workflows/ci.yml` solely to add `npm ci --prefix adapters/openai` to the existing two-runtime core job before `npm run test:core`, and `CONTRIBUTING.md` solely to document this core-test prerequisite and distinguish it from the dependency-free engine. No new dependency, lockfile, public core import, runtime model call, workflow permission or other job changes. This is maintainer test tooling already installed by other jobs, not a product dependency or relaxation of MP1–MP9. Worker copies this clarification to the tracked plan before tests and owns these narrow changes; full final review includes them.

## Author pre-test freeze

Actual implementation owner is GPT-6.1 Sol/high. Contract was copied verbatim before code/tests (`cmp` actual0); MP1–MP9 are immutable. Only the existing three core modules contain implementation; candidate rows and public payload shapes are unchanged. Additional title work uses at most65 original binding metadata rows followed by exact projected point reads for at most64 valid bindings, not joins that could materialize entire UNION views.

The first regression uses exactly96 public admissions: the explicit Northstar identity/location source, its manually created Northstar L1, and95 original question-only CJK-pressure sources from the sealed diagnostic. Both queries, all source text, count, request-only first12 selector/first6 ranker and real tokenizer were fixed in the new test file before execution. No target ID or gold is supplied to model ports. No private diagnostic rerun, provider call, semantic answer or historical-score change. File/source identities and actual outcomes are appended below after execution; observed small-count thresholds are not used in this regression.

Before the first run, SHA256 of the exact fixed `[target,...95noise]` UTF-8 JSON source array was `b7fb4302d5ef6ea22f0bda66f7fe2598983b67949ab0bfeee5753f662a6bebcc`; the test compares against that literal. Original pre-test file identity before this assertion/ablation correction was `16641f40dc78f90c14a5b173c1fab54e7a2afa37daf82325c1a940480dbf58fd`. No source/query/callback changes. The closed test-only `CAIRN_MOC_PRIOR_DISABLED_NEGATIVE=1` changes solely the declared treatment's constructor policy to the unchanged baseline, retaining the treatment expectation to prove a real red control without modifying core bytes.

First actual test-file SHA was `619ee1dbe8ea7f7b24614e6bcd652455858573f56332217fd61f940463f2f434`. Both first focused suites exited1 with27/28 passing. The fixed96 regression, exact control, title bounds and indexed projection lookup checks passed. The direct-storage callback mutation setup attempted public correction through a second SQLite connection while `BEGIN IMMEDIATE` held the write lock; correction correctly returned `storage_busy`, not the test's expected epoch conflict. Setup correction1 uses a same-connection `createMocStorage` adversarial fixture and real stored epoch/receipt identity checks solely for this private callback fence test; no runtime export, candidate code, source/query/model-port change. The separate actual public count/select/rank mutation controls passed before correction.

## Author verification record — 2026-10-11

Fixed base remains `f136f121966c8cffd6f789e26127502b7a866a65`, branch `experiment/moc-prior-candidates`. No commit, push, provider call or paid operation. Before primary acceptance, author stops all writes. Required primary reruns and two nonauthor reviews are pending; these author checks do not substitute for either.

Commands used exact `/home/chichieh/.nvm/versions/node/v{22.16.0,24.15.0}/bin` on PATH, `NODE_DISABLE_COMPILE_CACHE=1`, and removed `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CAIRN_API_KEY`. Test commands use the owned runner; demos retain their explicit synthetic databases. Read-only Claude CLI came from the primary-provided `complementary-qa24/tools/plugin-validation/node_modules/.bin/claude`. Primary supplied the locked tokenizer through an ignored dependency link, without network/install/package/lock changes.

| Gate | Node 22.16.0 actual exit | Node 24.15.0 actual exit | Result |
| --- | --- | --- | --- |
| First new focused suite | 1 | 1 | 27/28; explained test-connection setup failure above |
| Corrected targeted same-connection fence | 0 | 0 | 1/1 |
| Disabled-treatment MP6 expectation | 1 (expected) | 1 (expected) | Actual supported-target visibility `false !== true`; same evidence/ports |
| `node tools/testing/run.mjs core/test/moc-prior-candidates.test.mjs` | 0 | 0 | 29/29, no skips |
| `npm run test:core` | 0 | 0 | 1,165/1,165, no skips |
| `npm test` | 0 | 0 | 669/669, no skips |
| `npm run validate` | 0 | 0 | JSON/version validation |
| `claude plugin validate .` | 0 | 0 | Marketplace |
| `claude plugin validate ./plugins/cairn-memory --strict` | 0 | 0 | Plugin |
| `npm run demo:store` | 0 | 0 | Synthetic storage lifecycle |
| `npm run demo:history` | 0 | 0 | Synthetic retained historical/current sources |
| `npm run demo:moc` | 0 | 0 | Scripted placement |
| `npm run demo:recall` | 0 | 0 | Scripted select/fetch/rank |
| `npm run demo:rebuild` | 0 | 0 | Atomic generation publication |
| `npm run demo:continuation` | 0 | 0 | Bounded pages/incomplete coverage |

Disabled control command: `CAIRN_MOC_PRIOR_DISABLED_NEGATIVE=1 node tools/testing/run.mjs --test-name-pattern='MP6 fixed96' core/test/moc-prior-candidates.test.mjs`. It executes the actual core path with the legacy policy in the declared treatment arm and retains the positive expectation; it is not a sealed-output replay. Owned invocation/fixture cleanup also covers intentional assertion failure. The positive fixture cold-read databases were byte-identical before/after recall; exact-query controls remain visible and packed in both policies. Broader-query target is absent under legacy and visible, selected, ranked and source-packed with the prior. There are two select calls and one rank per recall, all existing 6,000-input/1,024-output caps respected. Scripted broad-query answer-input counts were 2,440 baseline versus 2,126 prior (exact controls2,123); these are fixture observations, not latency/cost or QA gains.

Original-title validity controls exclude stale, deleted, historical, awaiting, foreign, orphaned, empty/over-cap and projection-excluded bindings before title scoring. Exactly64 versus65 bindings and65 distinct topics test both caps; top2 topics/first3 members, opaque-ID ties/duplicates, no-match/unfiled/misleading/shared-noise fallback, first4 receipt identity validation and top1,024 pruning are checked. `EXPLAIN QUERY PLAN` on published and pre-publication stores shows indexed SEARCHes and no SCAN/MATERIALIZE for additional original-binding and exact projected lookups. The public count/select/rank correction controls and same-connection storage score/label/title controls reject stale final use.

Affected callers were traced through `openMemoryCore` constructor → explicit-source recall navigation → `mapPage` → runtime/storage candidate rows → unchanged select/fetch/rank/final snapshot. Body recall, public map/classification, automatic rationale discovery (its direct body-only candidate call), capture, MCP/Hermes configuration and published schema are not changed. Existing full-core byte/currentness/generation/rationale/capture regressions and generic real-core architecture callers pass. There is no TypeScript gate. The only CI change is the prospectively authorized existing locked adapter-tooling install before core tests; no public core import/dependency was added.

Command records and retained demo paths are under `/tmp/cairn-moc-prior-verification.dVxKP3wQ`. Large suite records explicitly retain truncated poll excerpts plus actual exits/final totals, not a claim of complete stdout; earlier output and the first failure are in the tool transcript. The history example omits its paths; the two newly timestamped simultaneous history directories are inventoried without claiming a per-Node mapping or cleanup authority. No historical scratch was swept.

Pre-handoff inventory was derived by Git diff/untracked listing and independently by filesystem bytes versus base plus untracked file walk/ignore checks: exact match12 scoped files. `git diff --check` exited0. Final plan/hash inventory is rechecked after this evidence append. The frozen contract plus pre-test clarification remain an exact prefix; MP1–MP9 are unchanged. Natural classification, usefulness, QA/support/stale/abstention, local latency/memory and any later paid comparison remain unmeasured/open.
