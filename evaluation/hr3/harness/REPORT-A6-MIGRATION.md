> Latest: scorer v7 token migration and complete offline recertification PASS.
> Full suites: generator 62, scorer 123, integration 26, harness 377; all exit 0.
> Standalone fake pilot 480/480, complete leak/blinding scans, bound report,
> reconciliation and certificate bundle passed. Ran unlocked; primary freeze
> and non-author acceptance remain pending. See `REPORT-A6.1-SCORER-V7-RECERTIFICATION.md`.
> Earlier status blocks below are historical and superseded.

> Latest focused task: trivia P2-2 fixed. Complete-target no-trivia authority and
> private gold/token bindings reject both bilingual downgrade attacks. Focused
> tests: 20/20 harness checks and 7/7 integration checks, exit 0. Full harness and
> recertification are deferred until the in-flight scorer fix lands.
> See `REPORT-A6.1-UNLICENSED-BINDING.md`; earlier status blocks are historical.

> Latest continuation: both authorized tests pass; harness 371/371 (exit 0).
> Standalone fake pilot completed 480/480 (exit 0), then source validation stopped
> on concurrent changes to scorer support.mjs, scorer.mjs and cli.mjs. Remaining
> gates were not run; current checkout is not certified. Ran unlocked.
> See `REPORT-A6.1-TEST-RESUME.md`; earlier status blocks are historical.

> Latest recertification: placeholder inventory fixed; four new regressions and all
> certificates through accounting pass. Full suites: generator 62/62, scorer 100/100,
> integration 26/26; harness 369 passed / 2 stale-test failures (exit 1). Stopped before
> the standalone fake pilot. Ran unlocked. See `REPORT-A6.1-PLACEHOLDER-RECERTIFICATION.md`.
> Earlier status blocks below are historical and superseded.

> Current attempt: expected-case binding regressions pass 12/12 (exit 0).
> Fresh recertification stopped at context privacy certification (exit 1):
> the public P formatter `record` key collides with a private authoring key.
> See `REPORT-A6.1-CASE-BINDING.md`. The interrupted a6e results are discarded.

> Current status: the full A-6.1 authentication verifier stopped at its first
> failing consumer check (3 passed / 4 failed, exit 1). The protected scorer
> changed concurrently to support/trivia v3 and scorer v5; consumer migration
> is incomplete against that API. See `REPORT-A6.1-AUTH-RECERTIFICATION.md`.

# A-6 runtime/integration migration and non-certifying measurements

**Migration implemented; paid gates remain blocked by the retained numerical
limits.** No network, key, paid call, commit, model change or ceiling change.
Writes are confined to `harness/` and `integration/`. The generator/scorer work
already present at entry is preserved. The first stop is retained separately in
`REPORT-A6-PREFLIGHT.md`; this report supersedes its implementation status.

## Clause mapping

| Authority | Implementation / evidence |
| --- | --- |
| A-6 §2 wire and exact anchors | `preflight-a6-schema.mjs:21`; `schema.mjs:47`, `:122`: own name/current-batch references; exact quote equality, source-turn membership, ASCII complete-token boundaries; raw offsets ignored only under A-3. Bad name assertions leave admitted facts unresolved; malformed structure and invalid core retain their original precedence. |
| A-6 §2 common private identity | `name-registry-a6.mjs:10`, `:27`, `:53`; `event-identity.mjs:5`, `:9`; `runner.mjs:71`: family + authorized namespace + canonical public subject/predicate + case-preserved name; unchanged event/source order, registration after reference checks, collisions before retirement. No gold/AST/question/known-turn pattern enters live resolution. |
| A-6 §2 fail-closed cases | `test/names-a6.test.mjs`: bilingual/mixed cross-batch and same-batch links, absent/invalid/prefix/self/forward/cyclic/duplicate names, canonical/namespace collisions, replay, scopes, non-adopted/retired/forgotten targets, and multi-target all-or-none. Later names never repair past decisions. |
| A-6 §2 no registry retrieval | `research.mjs:7`, `serializeRecord`; `product.mjs:85`, `:96`: one linked stream and matching diagnostics before all branches; explicit serializers omit identity registry/annotations. Only existing source/fact/reason quote collection supplies evidence; name-only snippets are not added. Registry audit stores IDs/names/locations/hashes, not slots, prose or reasons. |
| A-6 §3 extraction | `prompts-a6.mjs:4`; `contract-projection-a6.mjs:12`, `:88`; `schema.mjs:8`: full crosswalk, source coverage, independent slot/reason admission and all twelve bilingual extraction examples. No post-submission defaults, semantic repair, graph fallback or quality retry. |
| A-6 §4 reader | `prompts-a6.mjs:5`: complete inheritance/replacement/expiry/unresolved and serial/conjunctive/alternative causal instructions, actual decoded units and exact occurrences. All bilingual address/recovery/causal examples and both inheritance pairs remain. C/O citation diagnostics and factual negative R are unchanged. |
| A-6 §4 inheritance pairs | `inheritance-a6.mjs`; `integration/test/pipeline-a6.test.mjs`: four preservation/no-preservation variants, identical intended semantics and per-arm behavior; no merging or restoration added to U/O/P. |
| A-6 §7 P operations and losses | `product.mjs:85`, `:96`: actual public calls/outcomes and missing/incompatible name diagnostics logged. All targets checked before writes, including forgotten/absent P targets. Original receipt filters, correction loss, expiry and returned blocks remain. Integration tests prove named identity cannot retrieve O/P lost content. |
| A-6 §7 lossless integration/support | `integration/adapters.mjs`, `field-map.mjs`, `reconcile-a6.mjs`: original source retained behind hash-checked restore; new extraction/name fields admitted independently; generator `optional_trivia` consumed by the scorer's source-authenticating adapter and routed only into private `supportVersion/supportTrivia`. Full field/delivery inventories cross-checked independently. |
| A-6 §7 old/new parity | `integration/test/pipeline-a6.test.mjs`: actual hash-pinned pre-A-6 reducers/serializer versus current reducers on independently authored equivalent fully resolved streams. Fixture SHA-256 `3c665423b7e7a6b96730046e0fc6822ca51668fded92b24856554130664533de`. Historical A-3 graph replay is isolated in `historical-links-a3.mjs`, outside the runtime import closure; old replies are never reinterpreted as A-6 wire. |
| A-6 §7 privacy | `private-field-inventory.mjs`: recursively visits actual registry shape and producer-private support metadata against explicit public schema/path allowances; no subtree exemption. Complete extraction/reader/P measurement bodies use PrivacyGuard. Registry/private-metadata injections and source binding tests pass. |
| A-6 §§6–7 versions/gates | Cache `hr3-extraction-cache-a6-v1`, extraction `hr3-extraction-a6-v1`, requests `hr3-requests-a6-v1`, run/artifact/P/closure versions A-6; closed published schemas under `schemas/*-a6.*.json`. `requests.mjs:3`, `:37` retain all ceilings. |
| A-6 §7 fifth-pilot review/freeze | `paid-preflight.mjs:24`, `:52`, `paid-requirements-a4.mjs`, `runner.mjs:30`, `:50`: A-6 catalog and review amendment list; four-pilot accounting; no primary preparation/supervision/review attestation authored. `freeze-a6.mjs` binds actual module/data/dependency closure and rejects the blocked status. Real freeze remains primary-owned. |

## Measurement table

Inputs are complete provider-body UTF-8 bytes **plus 4,096 framing units**;
output units are actual `o200k_base` tokens in strict schema property order.
Minimum ceilings are `ceil(input/.95)` and `ceil(output/.90)`. They are arithmetic
measurements, not enacted limits or recommendations to lower output caps.

| Request/output kind | Worst complete units | Minimum ceiling for required margin | Worst complete body/output SHA-256 |
| --- | ---: | ---: | --- |
| input/extractor/4.1 | 34,504 | 36,320 | `713f0b5ecc28fba4b232f47f520ae2cea16d20c8ed8db37db9bdef18409f16d0` |
| input/extractor/5.4 | 34,518 | 36,335 | `9750be3b0b183d80f019e1c9f2db059184696b132c1e747d556c243695ff098f` |
| input/reader/T | 43,572 | 45,866 | `1dde559035a79815e484ac065dda66ca7a4d01eac7da92343d051bc679d91d59` |
| input/reader/U | 44,396 | 46,733 | `6de55d3d01c9ec54701ce6fa6357ed06a42198b27c14bc14532923e9a48e2e21` |
| input/reader/O | 42,251 | 44,475 | `9d15254069c151cba1a11479ef96f0e5663662bfcfe4bb64523850467ff130b2` |
| input/reader/P | 49,551 | 52,159 | `3cb86dc5a1fa44169cca2bb8c45a1f70dd93a084f37ad1af792db5ea905dd1a0` |
| output/extraction | 2,276 | 2,529 | `7da3c29866e8f23a6cca1ef4cb6131bf3f81e66ba06bd35773382d4111cd78bd` |
| output/reader | 1,774 | 1,972 | `b011095dfa77a744705979d4d03181683eee45992054f03883d35d2fde0ccd92` |

All six input categories exceed their retained ceilings (E=20,480;
T/U/P=40,960; O=32,768). Output caps remain E=4,352/R=2,176: measured output
margins are **47.7022058824% / 18.4742647059%**, both above 10%.

The full measurement built **5,384 requests and 2,096 output references**:
60 fresh pilot + 180 full Cartesian engineering families, both extractors,
all four readers, English/Traditional Chinese/mixed, two research ranking
fixtures, actual public P operations for every family, all nine context cases
and four inheritance variants. There are **zero privacy hits**, zero provider
dispatches and zero journals created by measurement. It binds 1,519 source/data/
installed-dependency hashes and verifies that they do not change during the run.

A supplementary **32 complete P requests** used eight fresh local stores for
each of the two byte-maximal family IDs. Product IDs, returned blocks, literal
queries and assembly policies were not rewritten; no scores/answers selected
the probes. The P row above uses its retained complete worst body (49,551).
The full run's P maximum was 49,413 (minimum 52,014). An earlier preliminary
measurement, before final source binding, observed **49,553** (minimum
**52,162**), hash `db722afed88d078ec10959ccfcd7562f17f61de509fef671b71b17087bb33f4f`,
retained in `reports/a6-measure.stdout`. Keep that larger observation in the
primary amendment decision; finite fixture/UUID measurements are not universal
bounds over unbounded schema spellings or all possible embedding rankings.

Complete current worst bodies/serializations are retained in
`reports/measurement-a6.json` and `reports/p-tie-measurement-a6.json`.
No prior paid extraction or answer is reused. These files always say
`MEASUREMENT_ONLY_NOT_CERTIFIED` and cannot substitute for paid certificates.
The CLI has no paid-dispatch or ceiling-override option; the runtime import
closure excludes both measurement programs. Runtime validation still rejects
every maximal input. `verify-a6.mjs` reports expected blocking, never paid PASS.

## Projection options and byte effects

Effects below are complete-provider-body bytes, including nested JSON escaping.
Both extractor configurations have the same savings; all four readers have the
same savings. No required rule, example, source evidence or receipt was removed.

| Option | Extraction bytes saved | Reader bytes saved | State |
| --- | ---: | ---: | --- |
| Other-role pruning + relevant alias selection/folding | 22,043 | 29,445 | Applied; operation-relevant content retained. |
| Relevant names versus all unrelated public aliases | 2,250 | 2,250 | Already included in the preceding row; do not add twice. |
| Exact repeated-example definitions and explicit event-default overlays | 8,852 | 1,422 | Applied; every candidate expands exactly to the literal projection. |
| Remove whole identical worked examples | 0 | 0 | No identical whole examples remain. Shared subtrees are already factored. |
| Remove duplicate system-prompt teaching while keeping complete contract/framing | **718** | **1,043** | Available, **not applied**; exact candidate prompts/hashes and rule locations are published for instruction-placement review. |

`reports/projection-options-a6.json` records before/after bytes per request kind.
The final row retains all domain rules/examples in the complete public contract
and the essential untrusted-data/no-tools/no-prior-state/no-retry framing. It
requires prompt review before adoption. Even that saving does not make current
ceilings fit. Omitting the other language, required branches/labels/clauses,
source evidence, or O/P losses is not offered as a valid reduction. No schema
maxLength/maxItems restriction, new archive, raw fallback or limit increase was
introduced to manufacture a fit.

## Accounting and remaining gates

The hash-pinned four-pilot ledger chain remains verified at **$4.145077720**:
settled **$4.110354120**, outstanding **$0.034723600** (five holds). Reserved
embedding units remain research **1,799,591**, product **436,859**, with no reset.
At the retained limits the non-binding cumulative fifth-pilot planning bound is
**$32.219388720 ≤ $50**. A-6.1 must reprice its amended envelope and regenerate
binding budget/continuation/input/embedding/privacy/conformance/allocation
certificates. These measurement values are not paid-usage forecasts or authority.

`accounting-a6.mjs` can consume a primary-supplied completed preparation record
and hash-pinned additional receipts; it never creates that attestation. None
was supplied, so preparation completeness remains false. Review/freeze and all
A-1.1 development/test analysis/resource gates remain required. No confidence
interval, bootstrap estimate or contrast with uncertainty is published for the
blocked pilot; the bound report is solely non-inferential mechanical bounds.

## Final suites and actual command exit codes

| Suite | Pass | Fail | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| generator-tests | 53 | 0 | 0 | 0 |
| scorer-tests | 74 | 0 | 0 | 0 |
| integration-tests | 26 | 0 | 0 | 0 |
| harness-tests | 354 | 0 | 0 | 0 |

`node evaluation/hr3/harness/verify-a6.mjs` exited **0**, with status
`MEASUREMENT_COMPLETE_PAID_GATES_BLOCKED_A6_1`. That status is explicitly not
paid readiness. Its ordered actual/expected command exits are:

| Ordered command | Actual exit | Expected exit in this measurement phase |
| --- | ---: | ---: |
| strict-schema | 0 | 0 |
| published-schemas | 0 | 0 |
| private-field-inventory | 0 | 0 |
| inspected-references | 0 | 0 |
| runtime-closure | 0 | 0 |
| accounting | 0 | 0 |
| output-certificate | 0 | 0 |
| input-gate | 1 | 1 |
| measurement-only | 0 | 0 |
| projection-options | 0 | 0 |
| generator-tests | 0 | 0 |
| scorer-tests | 0 | 0 |
| integration-tests | 0 | 0 |
| harness-tests | 0 | 0 |
| blocked-fake-pilot | 1 | 1 |
| partial-leak-scan | 1 | 1 |
| partial-bound-report | 0 | 0 |

The full 60-family/480-answer fake plan stopped at `request_byte_bound`:
**zero new reservations, zero provider dispatches, zero attempted answers**.
The partial leak scan has zero hits but missing 240 extraction/480 reader
requests and is **not a complete privacy certificate**. The partial bound report
retains 480 unexecuted opportunities and emits no inferential uncertainty.
Supplementary P-tie measurement and full integration reconciliation separately
exit 0; their actual exits/log hashes are appended to the verification record.
Real freeze was not run.

Earlier migration trials failed while old request fixtures hit the retained
input gate before their accounting assertions (108/221 then 193/136 pass/fail).
Those fixtures now use valid reader requests; all ledger/rollback/race/contention/
owner-liveness checks remain green. A subsequent 349/4 trial exposed two stale
source bindings during concurrent edits, a historical carry-stage expectation,
and a failure-summary assertion; final source-stable verification passes all
354 harness tests. Integration setup/import and inheritance-date fixture errors
were corrected before final 26/26. Actual intermediate logs/exits are retained;
expected numerical failures are never relabelled successful certifications.

## Delivery and independent cross-checks

`reports/a6-changes.json` mechanically lists every task change, including test
fixtures, reports, schemas, docs and ignored artifacts, against the original
A-6 entry snapshot. One route uses Git inventory plus byte comparison; the
second independently walks Dirents and hashes contents. Sorted paths, byte
sizes and digests must agree. The manifest records counts and its self-entry
convention. Generator/scorer/protocol/real-runner files are checked unchanged
against their task-entry contents, including the supplied uncommitted work.

Integration `reconciliation-fields.json` covers every producer source path and
closed extraction-schema branch by independent recursive/breadth-first routes,
with hash-checked restoration at all 120 checkpoints and 240 extraction batches;
727 field paths agree with zero differences. `delivery.json` covers 18,926 files in
the complete integration filesystem by recursive Dirent and native recursive
readdir/stat routes. No directory or historical artifact is silently omitted.

Only newly generated diagnostic log paths are made portable; provider bodies,
source text, returned P blocks, output serializations, journals and fixtures are
never rewritten. Scientific hashes and actual exit codes remain intact.

Final readback verifies 1,519 measurement, 44 output-certificate and 14 private-inventory
source bindings, all 19 command outcomes/log digests, and every integration delivery
entry. All 132 pre-existing protected sibling files match the task-entry snapshot.
All 72 changed JavaScript modules pass `node --check` (exit 0); scoped
`git diff --check` exits 0. `reports/a6-postflight.json` records these checks.

## A-6.1 follow-up

A-6.1 ceilings and conservative budget arithmetic are now applied. Recertification
stopped at the output certificate because the protected generator freeze still
binds the preceding errata hash (exit 1). The requested heavy wrapper also could
not acquire its read-only shared lock. No later certificate, suite or full fake
pilot was run. See `REPORT-A6.1-RECERTIFICATION.md` for exact results and blockers.

## A-6.1 resumed certification

After the primary refreshed generator provenance, output and context certificates
pass (exit 0 each). The complete-request certificate exits 1 solely because the
primary preparation-completeness record remains absent; all measured input,
embedding and privacy components pass. Later suites, the full fake pilot and
remaining certificates were not run. This attempt ran directly, unlocked, as
authorized. See `REPORT-A6.1-RESUME.md` and `reports/a61-resume-verification.json`.

After that failed attempt, the primary preparation record arrived during the
manifest readback. Read-only reconciliation now verifies completeness, with no
exposure change. The failed certificate binds the earlier files and is stale;
no certificate was rerun after the failure. See the timing note in
`REPORT-A6.1-RESUME.md`.
