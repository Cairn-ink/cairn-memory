# Extraction candidate evidence: Luna and GPT-5.4 mini

This is a bounded synthetic experiment, not a competitor benchmark or human
usefulness study. Neither a source receipt nor a relevant return proves that
the stored assertion is supported. Product defaults remain unchanged.

## Luna outcome: not accepted

The actual API compatibility probe passed: two source statements were stored
literally with receipts. Four guarded requests reserved USD0.020.
The complete planned 12-case x3 batch then attempted all36 runs but completed
only34: C12 repetitions2 and3 stored no memory from a source containing the
required Friday fact and a quoted attack string. Their HTTP count/generation
calls succeeded; the missing fact is not a transport outage or a scorer-only
failure. No replacement Luna run was made.

Independent agent review and primary source inspection agree:

- All16 stored capture claims are supported; merged claims can cover multiple
  required facts. They preserve22 of24 required facts, not all24.
- All10 returned capture memories are relevant. The unchanged score is43/45
  recall and43/43 relevance, both provisional because two runs failed.
- All3 reviewed topic groupings are coherent; discoverability12/12, expected
  empty queries6/6, no reported namespace/current-revision/source safety violation.
- The optional quoted-attack atom is not a required memory; omitting it alone
  does not fail the fixture. Losing the Friday fact in two runs does.
- Original scorer remains `incomplete`, `semanticReviewPending:true`,
  `captureRecovery.recovered:null`, `reviewedRecovered:22`, no review errors.
  Failed runs have no query observations to label, so no fabricated reviews are
  inserted to make pending disappear. Do not advertise16/16 support as reliability.
- Peak RSS208056320bytes, retained DB/WAL/SHM233472bytes, recallp95 5300ms. Resource
  gate is false because of two failed queries; these are small Linux fixtures,
  not large-history evidence or a controlled latency benchmark.

The Luna suite used210 guarded requests and USD1.050 cumulative reservations.
Its local adapter estimate reserves USD0.898968; the shared ledger is authoritative
and never refunds the difference. Observed generation usage estimates total
USD0.0324449; extraction alone accounts for12 generation calls,5418input tokens,
602output tokens and USD0.0020769 using conservative cache-write-inclusive input
pricing. Count/unknown costs are not invoices or zero-cost requests.

## Failure diagnosis

Both failed synthetic databases were independently inspected read-only. Each
has a completed admission claim with no memory IDs, zero suppressed items and
zero memory, receipt or suppression rows. Extraction validation/admission preserve
item cardinality except suppression, which these stores exclude. The normalized
extractor output was empty; there is no evidence of downstream storage loss.
Exact raw provider JSON and the model's reason for omission were not retained
and are not reconstructed from token counts.

The [offline replay](../../evaluations/diagnostics/luna-empty-replay.mjs) exercises
the real adapter/core with scripted HTTP in fresh SQLite stores. Empty output
reproduces skipped/empty classification and two extraction HTTP operations; one
supported Friday item persists and reaches classification with four operations.
It passes on Node22.16 and24.15. This isolates behavior, not model quality.

```sh
npm ci --prefix adapters/openai
node evaluations/diagnostics/luna-empty-replay.mjs
```

## Comparator gate and provenance

The same-source GPT-5.4 mini comparator is governed by the disclosed
[execution-gate clarification](../plans/luna-quality-evidence.md#comparison-gate-clarification-frozen-before-comparator-calls).
The original operator stopped after Luna's incomplete result. Primary diagnosis
established a fully attempted batch with two quality failures and no HTTP/budget
interruption. Two independent reviewers approved one comparator without Luna
retry or relaxed quality thresholds. Operator hashes differ only because of that
documented control amendment; implementation, prompts, corpus, scorer, extraction
plan and original policy/token remain frozen. This is not identical-operator evidence.

## Same-source comparator result

The independent agent and primary source inspection agree that GPT-5.4 mini's
24 captured claims are all supported and all24 required capture facts are retained.
All12 returned capture memories are relevant; all3 MOC sets are coherent. The
unchanged scorer passes36/36 runs,45/45 recall,45/45 relevance,6/6 expected-empty
queries and12/12 discoverable placements, with0 unsupported/forbidden/safety
violations, no pending review and no review errors. Peak RSS210776064bytes,
retained233472bytes and recallp95 5731ms pass this small-fixture resource gate.

| Observed fixed-corpus result | Luna, reasoning none | GPT-5.4 mini, reasoning none |
| --- | --- | --- |
| Completed runs | 34/36 | 36/36 |
| Supported existing capture claims | 16/16 | 24/24 |
| Required facts retained | 22/24 reviewed; final score pending | 24/24 |
| Recall | 43/45 provisional | 45/45 |
| Frozen acceptance | Incomplete, not accepted | Passed |
| Extraction generation input/output tokens | 5418 /602 | 5418 /808 |
| Extraction generation usage estimate, USD | 0.0020769 | 0.0076995 |
| Entire-suite generation usage estimate, USD | 0.0324449 | 0.0415259 |
| Shared-ledger reserved USD | 1.050000 | 1.171728 |

The comparator made222 guarded requests. Prices and model outputs both affect
costs. Luna's cheaper run omitted work after two empty captures; these are not
equal-quality costs and do not support a claimed savings percentage. Measurements
were sequential on one Linux environment, not randomized latency benchmarking.
This comparison tests only these explicit reasoning-none profiles, not every
possible Luna configuration or an entire model family's capability.

DRI decision: do not promote Luna or change any default. Keep its profile opt-in
and its failed result visible. GPT-5.4 mini remains the evidence-backed candidate
for the next installed capture-to-MCP check, not a general reliability guarantee.
That check must preserve original source receipts through paraphrases; the old
explicit-remember Hermes equality predicate is not a capture acceptance rule.

## Budget, artifact and verification

The [accounting record](luna-extraction-accounting.json) retains source/intent hashes,
guarded request metadata and both operator hashes. Provisioning verified byte-for-byte
original binding preservation and unchanged entire prior ledger state.
Probe plus both suites added436 requests/USD2.241728 reservations. The original
USD20 campaign now has1651requests/USD14.211728reserved,USD0.936803known conservative
usage estimates,762unknown-cost requests,0unsettled; USD5.788272 remains. These
figures are not an invoice, new allowance, refund or completed product claim.

Primary verified both retained scores on Node22.16.0 and24.15.0, including Luna's
incomplete result. Deep comparison confirmed raw reports differ only by removal
of private DB paths and every recorded runtime/corpus/scorer hash still matches.
Generic `npm test`31/31 and `npm run validate` pass on both runtimes; pinned
Claude2.1.260 marketplace and strict plugin validations pass. The diagnostic
replay passes both runtimes. There is no TypeScript gate in this JavaScript repo.

On the unchanged PR47 implementation, primary also ran `node packaging/prepare-cache.mjs`
then `npm run test:artifact`:14/14 each runtime, producing the same inspected
archive SHA256 `8d4b0178381d88a34673b7435e15c3f10ea18aff97dec8040ff4b82e234b2ee9`.
This verifies packaging and existing installed scripted lifecycle, not paid
capture through a real installed client. PR47's17 remote CI checks passed.
No merge, release, registry publication, deployment or production use occurred.

## Reproduce the retained Luna score without network

```sh
node --input-type=module -e 'import fs from "node:fs"; import {cases} from "./evaluations/semantic-cases.mjs"; import {summarizeEvaluation} from "./evaluations/score.mjs"; const read = name => JSON.parse(fs.readFileSync("./evaluations/results/" + name, "utf8")); console.log(summarizeEvaluation(cases, read("luna-suite-v1.json").results, read("luna-suite-v1-review.json")));'
```

Replace both `luna-suite` names with `mini54-suite` to reproduce the comparator.

Raw reports retain their original pending summaries; source-support labels are
separate agent judgments, not human review. Public copies remove only private
database paths. No key, full environment, provider error body or user conversation
is included. The original default-model source-support failure remains retained.
