# Qualification evidence-pool wire repair

Fixed base: `b781a3c5bde421fa200a8d39aff53f54760ba50e` (accepted PR231).
Branch: `fix/qualification-evidence-pool`. Primary DRI owns this contract and
acceptance; one GPT-6 Sol/high worker owns implementation. This is a bounded
product repair, not a new memory engine, scoring result or competitor claim.

## Observed failure and decision

The latest frozen six-case source-pair development run retained six generation
and six scoring records but resolved zero cases in either arm. All12 case/arm
slots failed ingestion: eight at qualification request bounds, four at the
qualification compiler's generic invalid-result boundary. All56 physical
requests completed; US$0.280000 was conservatively reserved, US$0.038510 known
actual cost, 28 count costs unknown, zero pending. The cumulative reservation
was US$86.516460 under US$200. The exact earlier ledger prefix was unchanged.
No actual answer or judge request occurred. Wrapper completion is not QA.

A deterministic synthetic control on the real qualifier/core/adapter path
rejects five items with one323-unit receipt each before HTTP: partial request
2263 tokens, full wire6003. Changing only323 to322 produces full6000 and reaches
the fake count callback. This reproduces an analogous budget boundary, not the
unretained composition of any live failed request. Separately, a schema-accepted
five-candidate citation union reaches the core and is rejected with the same
generic compiler event; that does not identify the live compiler subreason.

Two pure prototypes were measured. Deeper identical-schema factoring reduces
the first fixture to5614 tokens. A per-item evidence pool plus shared field
schemas reduces it to3991 while a sample decodes through the unchanged core
compiler. Choose the pool format for its larger bounded margin and structural
four-citation ceiling. This changes provider output format and instructions,
so it needs explicit wire versioning, decode/validation tests and later real
provider compatibility. It is not an equivalent-schema-only refactor.

The maximum five items × four800-unit unique receipts still exceeds the core
budget (partial11348; pool prototype full13356). Do not hide this limitation,
truncate evidence, silently split/retry, or claim complete maximum-size capture
support. A future bounded partitioning policy would need its own contract,
call projections and acceptance. This packet preserves one qualifier call.

## Frozen acceptance

- E1 Source semantics: keep the core qualification input/output contract,
  source snapshots, item/candidate identities, receipt order/text/offsets,
  canonical label rules, seven fields, trust/attribution/commitment meaning,
  admission atomicity and source-bound-v2 policy unchanged. No truth inference,
  discarded evidence, role authentication, invented citation or automatic
  adoption. No MOC, recall, supersession, storage schema or public config change.
- E2 Explicit wire: define and document a named `evidence-pool-v1` transport
  representation for qualifyCandidates only. Each item has one pool of1–4
  distinct candidate IDs belonging to that item, and its seven fields refer to
  pool slots. Share structurally identical field schemas across items. Preserve
  exact required item coverage and existing adapter model/endpoint/schema-name
  allowlists; do not grant a previously unauthorized method or route.
- E3 Decode and validate: detach and validate model output before mapping.
  Reject duplicate/foreign pool IDs even if unused, bad/duplicate/out-of-range
  slots, missing/extra/duplicate/wrong items, malformed values and unknown keys.
  Known values still need actual supporting field citations. Decode only to
  original candidate indices, then apply the existing authoritative inline
  response schema and unchanged semantic/source compiler. Unused pool members
  create no anchors; all-unknown with zero actual field citations still fails.
  Do not rescue invalid output by dropping elements, selecting evidence for the
  model, broadening source spans, filling fields or changing canonicalization.
- E4 Bounded dispatch: preserve core6000 and full-wire6000 local checks,
  provider7024 input/1024 output gates, signal/deadline behavior, one count plus
  one generation per qualifier invocation, no retries/fallback and unchanged
  prices/reservations/projections. The actual repaired serializer must put the
  fixed323-unit fixture below6000, reach fake HTTP and compile a valid response.
  The maximum unique-source negative must remain explicitly refused with no
  HTTP or partial admission; do not declare broad capacity or semantic success.
- E5 Compiler observability: refine only the generic qualification rejection
  boundary with finite static, source-free categories distinguishing citation
  budget, citation integrity, label canonicality and downstream qualification
  binding; retain invalid_qualification as fallback/compatibility signal.
  No field values, source IDs/indices, text, raw exceptions or model outputs in
  events. Diagnosis must not change validation, public error codes, model
  requests, admission outcomes, deadlines or callbacks' failure isolation.
  If a particular invariant cannot safely be distinguished without changing
  behavior, preserve fallback and document it rather than guess.
- E6 Red/green evidence: retain the original budget red and the compiler-union
  ambiguity control. On the new wire, exercise actual core+adapter+fake guard
  with a schema-valid response, source-exact compilation and stored receipt
  inspection. Differential/property-style tests encode representative valid
  original qualifications into pools and decode back identically (including
  null/unknown, Unicode, multi-source, sparse/nontrivial candidate IDs, five
  items and four citations). Negative controls cover E3, all four diagnostic
  categories, observer throws/rejections, no callback, no source leakage and
  non-qualification methods unchanged. Test input/body mutation cannot change
  trusted mapping after request snapshot. No real corpus, old case rerun,
  provider key, actual ledger, reference answer, user database or network call.
- E7 Installed and guard integration: trace every affected caller, strict
  schema fixture, decoder, request guard snapshot and installed-artifact fake
  provider. Update affected fake wire responders to the new representation;
  do not weaken assertions or teach the fake to bypass the real decoder.
  Preserve old guard factories' refusal of ungranted qualification methods.
  Pin new artifact inputs when later testing it; never modify the old installed
  artifact, frozen plans, ledger or results to make a test pass.
- E8 Delivery: primary inspects the complete diff and personally reruns the
  key red/green integrated paths. Worker and primary run required core, OpenAI,
  installed qualification/rationale, artifact, live-evidence-offline, request
  guard, budget, LongMemEval and affected MCP tests/demos plus generic, JSON and
  pinned strict plugin validation on Node22.16 and24.15. Avoid overlapping
  heavyweight timeout-sensitive matrices. Freeze a clean candidate; independent
  Standards and Spec review the same full fixed-base diff; correct/reverify/
  rereview, then dependent PR and all exact-head CI. No merge/release/deploy.

## Allowed files and exclusions

Adapter implementation/tests: `adapters/openai/index.mjs`,
`adapters/openai/schemas.mjs`, one focused qualification-wire helper and related
tests. Core diagnostics only: `core/qualification-candidates.mjs`,
`core/claim-qualification-input.mjs` only if necessary to observe the existing
label/binding failure, `core/model-diagnostics.mjs`, focused core tests.
Existing fake-wire fixtures under `packaging/test/` and `evaluation/live/test/`
may be updated only for this new output representation and E7 coverage.
Docs: this plan, one technical wire note, a limitation/checkpoint entry,
`CHANGELOG.md`, and narrowly affected existing technical descriptions.

Do not change product/root dependency versions, worker or evaluation models,
provider credentials, permission policy, ledger/guard runtime, scorer, cohort
selection, request caps, pricing, core semantic validation or source retention.
If an existing shared fixture outside this list is affected, identify its
caller and ask primary to extend the bounded contract before editing it.

### Pre-edit traced fixture extension

Primary inspected the real-adapter stdio call site in
`adapters/mcp/test/fixtures/candidate-server.mjs` and its caller
`adapters/mcp/test/candidate-capture.test.mjs` (fcd786). The fixture currently
manufactures the old provider representation. Add these two exact test files
to the allowance, only to emit/assert the new pool wire while preserving its
foreign-candidate negative, replay/no-HTTP, source-exactness, namespace and
whole-capture rejection assertions. No MCP server/CLI/configuration change.
`staged-server.mjs` uses a scripted core model and is not affected; leave it alone.
The existing full MCP matrix is a required integration gate, not waived by
adapter-only tests. This extension is frozen before those fixture edits.

Primary also traced `packaging/build.mjs` to its explicit
`packaging/artifact-files.json` runtime allowlist (453253/2b4722). Permit that
one manifest to add only `adapters/openai/qualification-evidence-pool.mjs`, the
new production import, before building a new artifact. Test-only encoders must
not enter the package. Existing artifact tests must verify the exact manifest,
installed import and source hashes; do not edit prior artifacts or receipts.

Primary traced three existing actual-adapter fake responders in experiment-
budget tests (8aa2dd/0f516c). Permit exactly
`evaluation/experiment-budget/test/candidate-qualification-guard.test.mjs`,
`evaluation/experiment-budget/test/chained-budget-extension.test.mjs` and
`evaluation/experiment-budget/test/qualified-source-pair-guard.test.mjs` to
emit the new candidate pool representation (including a test-only encoder
import). Preserve every existing route/grant/denial, reservation, unknown-cost,
prior-attempt and immutable-capability assertion. Do not change any guard or
ledger runtime, capability format, old v1 qualification response or budget.
This extension precedes their edits; rerun the full affected guard matrix.

## Stop and resume

The completed six-case roster is closed and excluded from future development;
the original reserved30 remains untouched. No additional paid run follows from
this plan alone. First obtain offline and independent acceptance, then freeze
a small synthetic provider compatibility plan within the same cumulative
budget; only afterward consider new development cases. Retain every failure.
This contract and later exact-SHA evidence are the resumption source of truth.
Do not confuse transport compilation, wrapper completion and semantic quality.

## Implementation trace and offline evidence (candidate, not acceptance)

| Boundary | Changed owner and focused observation |
| --- | --- |
| Provider request/response | `adapters/openai/schemas.mjs` defines only the `qualifyCandidates` versioned pool schema; `adapters/openai/index.mjs` counts and generates with that same schema, decodes through `qualification-evidence-pool.mjs`, then checks the unchanged inline candidate-ID schema. OpenAI focused tests cover 1–5 item mapping, sparse IDs, four citations, malformed pools/slots, all-unknown field citation and request mutation. |
| Core compiler/diagnostics | `core/qualification-candidates.mjs` keeps public `invalid_model_output` and exact anchored receipts while classifying the pre-existing rejection boundaries. `core/model-diagnostics.mjs` permits only four added finite reasons; focused tests check categories, Unicode/canonical/enum boundaries, observer throws/rejections and no callback. The primary also compared the old and new compiler on 1,943 synthetic variants with identical output/error codes, including NFKC expansion, whitespace, redaction and citation unions. |
| Guarded real core | `evaluation/live/test/qualified-source-budget-boundary.test.mjs` exercises the actual adapter, core and fake request guard: the formerly over-budget five-item/323-unit fixture reaches one count and one generation, four selected candidates cold-store exact receipt slices, a unique-source 2×4×800 request with core partial below 6,000 refuses at the full-wire adapter check before HTTP, and unique-source 5×4×800 also refuses before HTTP. The separate oversized capture leaves zero failed-case admission and a later case can proceed. `qualified-source-pair-guard.test.mjs` and `source-pair-preparation-adapter.test.mjs` retain two-arm scope and projection assertions. No guard runtime was edited. |
| Installed callers | `packaging/artifact-files.json` adds only the new production decoder. The source-tree test-only `qualification-pool-wire.mjs` is explicitly excluded from the artifact; `packaging/test/install.test.mjs` checks its installed source hash and an independent inline installed-v2 probe. Other affected `packaging/test/` fake providers, the opt-in rationale fixture, and `adapters/mcp/test/fixtures/candidate-server.mjs` emit the new wire; the latter retains source, replay, namespace and malformed-later-candidate checks. Scripted core-model fixtures and MCP runtime are unchanged. |
| Old/new guard test callers | `evaluation/experiment-budget/test/candidate-qualification-guard.test.mjs`, `chained-budget-extension.test.mjs` and `qualified-source-pair-guard.test.mjs` had actual adapter fake providers still emitting the old response. Their only production-facing change is the test response wire; legacy denial, full-history, monetary and request-cap assertions remain. The root guard script and full guard directory both pass; no ledger or guard implementation was changed. |

The exact original old-wire synthetic 323-unit fixture remained RED at 6,003
complete-wire tokens and 322 units passed at 6,000. The new actual serializer
places the 323-unit fixture below 6,000 and compiles five exact anchors through
fake HTTP. The original five-candidate union still rejects in the unchanged
compiler; the new pool structurally prevents more than four distinct selected
candidates per item. These are synthetic transport observations, not paid
provider compatibility or semantic repair of the closed six-case run.

Worker verification before candidate freeze, on both Node 22.16.0 and
24.15.0 with synthetic temporary stores and fake HTTP only:

| Gate | Result on each runtime |
| --- | --- |
| `npm run test:core` | 706 passed |
| `npm run test:openai` | 216 passed |
| `npm run test:mcp` | 91 passed |
| `npm run test:artifact` | 82 passed, including installed decoder and source hash |
| `npm run test:live-evidence-offline` | 338 passed, 30 pre-existing opt-in skips |
| `npm run test:experiment-budget` | 25 passed |
| `npm run test:experiment-request-guard` | 227 passed |
| `node --test evaluation/experiment-budget/test/*.test.mjs` | 252 passed |
| `npm run test:longmemeval`; `npm test` | 128 and 112 passed |
| Installed rationale opt-in | Four passed, no skips |
| Applicable synthetic demos | Store, capture, OpenAI offline, experiment budget, experiment request guard, LongMemEval ingestion and public comparison passed |
| `npm run validate`; isolated pinned Claude 2.1.260 strict validation | Passed |

The first focused installed matrix retained two red inline-script probes caused
by an implementation patch touching the separate v1 fixture; v1 bytes were
restored and the v2 pool probe fixed before the final full artifact pass on
both runtimes. The first full guard run retained four old fake-response failures;
the primary froze the exact three-file test-only allowance before those
responses were updated, then the root and full-directory guard suites passed.
Neither red was a paid request or a product behavior exception. Primary
reverification and independent review remain required before any PR or
provider compatibility plan.
