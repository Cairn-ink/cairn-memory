# C0b1: disclosed ordered-history evidence adapter (offline)

Parent PR #54 at `2b7e7bacc971162d2ba7085838721a3fd9b81c44`.
C0b is split into this original-history adapter, then the new positive/negative
currentness corpus and installed-artifact harness. This slice does not run paid
experiments, grant permission, add host capture or claim semantic improvement.

## H1 — original evidence is immutable

Keep the following files byte-identical, with executable SHA256 assertions:

| File | SHA256 |
| --- | --- |
| evaluations/history-cases.mjs | 13c2bc8b0492054869c9aab94de14a3438b08cbc81d2e9140f89f38fe6f4383f |
| evaluations/history-rubric.mjs | c84b060d8b37f10ca9d0511bad254fff922814e796c88835ba878bf0452e9e75 |
| evaluations/history-runner.mjs | 614b67d252611836c3bf9b2f4e6a17d5053cfa60ac70a053af063df90b004429 |
| evaluations/history-score.mjs | 62c5c2ed3b6ef4a713824d6c6fb39fb714071f5dab46846eee46d727739832f7 |
| evaluations/results/conversation-history-v1.json | b3244a104c483f029fc9751c68cf9766798c5cfc54e2cce5e95d6f19e93c14a8 |
| evaluations/results/conversation-history-v1-review.json | 323e2d94ddeb9117c95a825fc73af022408ff0b214691f98d44649bf2a1eb9cd |
| docs/evidence/conversation-history-accounting.json | 8394f3c61f5855dbed585701fb67f206748b6e14e9dce5d73a4aae45f9a53299 |

Do not rewrite original failure documentation, denominators or reviewer labels.
The original runner deliberately remains unordered; a new runner is needed
because its capture calls have no injectable causal seam. Preserving its frozen
implementation justifies some isolated orchestration similarity, not a second
memory engine. Reuse the actual public core and existing v1 receipt validator.

## H2 — exact new runner and trusted ordering

Add `evaluations/ordered-history-runner.mjs` exporting
`runOrderedHistoryAudit({model,directory,onProgress?,readDiagnostics?})`.
Accept only those options; reject custom cases, ordering overrides and unknown
fields before opening a store or model calls. Require a model, optional function
callbacks and a fresh empty private mode0700 canonical nonsymlink directory.
Only fixed imported `historyCases` source messages/queries reach capture/recall.
Never import the rubric/scorer/review into the runner.

Use the original namespace, client `conversation-history-audit`, sessionId and
eventId conventions. Add `causal:{streamId:'conversation-history-v1-'+history.id,
sequence:windowIndex+1}` for each window. This is trusted fixture source order,
not arrival time, timestamp inference or a general host sequencing feature.
Capture sequentially in four isolated synthetic stores; close/reopen between
windows and before final recall. No manual admit, supersede, correct, forget,
cleanup, retries or model fallback may repair a capture result.

Return exactly `{version,sourceVersion,ordering,evidence,v1Projection}`:

- version `conversation-history-ordered-v1`; sourceVersion `conversation-history-v1`.
- ordering `{kind:'trusted-fixture-window-order',client:'conversation-history-audit',
  streamId:'conversation-history-v1-<history.id>',sequence:'windowIndex+1'}`.
- evidence: version `conversation-history-ordered-raw-v1`, kind
  `synthetic-source-ordered-history`, cases/status otherwise following the v1
  runner. Every window additionally records its actual causal object.
- Each raw record is `{memory,receipts,supersession?}` with all current AND
  historical rows, all receipt pages and the complete one-hop history object.
  Raw reopenedRecords retain the same data. Never erase history before retention.
- v1Projection: a DETACHED copy of the exact v1 report shape/version/kind. Remove
  only causal metadata, historical rows and the extra supersession object from
  records/reopenedRecords. Preserve all active rows, admissions, messages,
  diagnostics, errors, statuses, recalls and source/reopen checks. It is explicitly
  a compatibility projection, not the raw evidence or original experiment result.

Export the fixed `ORDERED_HISTORY_VERSION` and `ORDERED_HISTORY_MAPPING` values
and `projectOrderedHistoryAudit(evidence)` for the mechanical projection.
Projection itself makes no semantic judgment and does not grant acceptance.

## H3 — failure and data boundaries

Retain every capture envelope, all raw snapshots/reopened evidence, complete
recall envelopes, diagnostics, errors and not_run windows/queries. Failed
capture, failed classification, unresolved reconciliation, source mismatch,
reopen mismatch, failed diagnostics/progress/close, or incomplete recall cannot
be a completed run. Halt affected later windows; infrastructure callback/close
failure halts remaining work globally, as the original runner does. Do not
silently turn failures into an empty successful snapshot or omit attempted work.
Each completed capture has applied or complete_no_change reconciliation with
null reason and a valid count; unresolved is a retained failure, not repair.

No fixture IDs, causal identifiers or persisted IDs/revisions reach extract or
reconcile inputs; existing classification/recall ports may keep their established
bound references. All model ports exclude rubric/required/forbidden/review labels
and expected outcomes. IDs in retained operator reports remain synthetic.
No environment reads, default HTTP/model, live CLI or real ledger access.

## H4 — separately verify raw history and the unchanged v1 score

Add `evaluations/ordered-history-score.mjs` exporting
`scoreOrderedHistoryAudit(report,{v1Review,historyReview})` and
`orderedHistoryReviewVersion = 'conversation-history-ordered-review-v1'`.
The evaluator may import the frozen rubric/scorer and runner projection helper;
the model-facing runner must never import the evaluator. No model judge.

Validate exact versions/mapping, fixed case/window/query sequence and source
messages, actual causal mappings, raw namespace/state/receipt bindings and
identical complete reopened snapshots. Raw states must be active or historical.
Every admitted ID must remain represented. Prior raw IDs cannot disappear or
change text: this runner never performs deletion/correction. Raw active/historical
evidence cannot be silently replaced by a filtered projection.

Require supplied v1Projection to equal the full named projection of validated raw
evidence. It cannot omit a bad active record, change a recall/status/error or
relabel historical records as active. Then call unchanged `scoreHistoryAudit`
with v1Projection and its fresh v1Review. Fixed denominators remain4 histories,
6 windows,9 required facts and7 queries even on malformed/missing reports.

Validate every historical record's directional supersession: predecessor revision,
non-self replacement in the same raw namespace, replacement bound/current revision
and state matching the raw successor, and nonempty selected receipt IDs bound to
that successor with available evidence. At least one selected receipt is a user
source from the window in which that predecessor first becomes historical.
Preserve original predecessor receipts across retirement; don't fabricate them.
For a newly retired record, the immutable replacement revision binds to that
window's capture admission, not the successor's later post-classification
revision. Filing may legitimately advance the current revision; the relation's
reported current revision/state must still match the raw successor snapshot.
The H2 final explicit-update window must actually report applied with positive
retiredCount and retain a corresponding historical transition, not merely rank
Monday above an unretired Friday. Count transitions against newly historical IDs.

historyReview is exactly `{version,reviewerType:'agent',assertions:[...]}`. Require
one label per DISTINCT raw historical `(historyId,memoryId,revision)` across all
snapshots, including rows absent from final current projection. Each label is
exactly `{historyId,memoryId,revision,supported:boolean,retirementJustified:boolean}`.
Reject missing, duplicate, foreign, malformed or false labels. These are fresh
independent semantic judgments, not derived from the engine's own historical bit.
The v1Review still labels all observed active assertions/recalls and required
facts. A scripted all-true fixture only tests scoring mechanics, not real quality.

Return `{status,errors,v1Score,metrics}` with fixed denominator fields
`histories,windows,requiredFacts,queries` and observed `historicalAssertions,
justifiedHistoricalAssertions,retirements`. Missing evidence/review cannot pass;
still return fixed denominators and collect observed history where safely possible.
status passes only when BOTH raw/history validation and unchanged v1 score pass.
Use finite content-free error codes; never forward raw exceptions or source text.

## H5 — independent executable acceptance

Delegate runner and evaluator implementation separately, with an independent
test worker. Use actual public core and scripted model methods, no manual
supersession. Positive H2 evidence must retain Friday historical/Monday active,
original/bound receipts and relation through reopen; current projection contains
only Monday. Mutating projection must not mutate raw evidence.

Prove frozen file hashes/original failure unchanged, unknown options/order reject,
no oracle leakage, no-causal legacy behavior unchanged, fixed9/7 denominators,
projection tampering/active-row omission/history relabeling rejected, missing or
false historical review rejected, foreign/self/wrong receipt links rejected,
capture/classification/reconciliation failure and callbacks retain attempted and
not_run work. Existing failures must remain inspectable, not cherry-picked away.

Tests live in `adapters/openai/test/ordered-history*.test.mjs`, covered by existing
offline CI. Run full OpenAI suite/demo, generic tests, JSON validation and pinned
Claude validations on Node22.16/24.15, plus unchanged core tests where useful.
No core/provider/guard/artifact runtime changes. Verify before candidate commit;
independent exact-commit Standards+Spec review before push. No self-merge.

## Remaining C0b2 / C1 gates

Next freeze the seven new currentness source scenarios and separate independent
rubric, plus actual installed-artifact ordered capture→fresh MCP inspection/recall
→correction→forget→fresh empty recall. Historical quotation must not require a
physical historical record that never existed or a past answer from current-only
recall. Injection may be retained as attributed evidence but gains no operation
authority. New scenarios are not old-v1 replacements.
C1 then needs explicit missing reconciliation authorization and one stated
request/reservation cap within the original cumulative USD20. No paid execution,
new allowance, publication, release, deployment or private implementation here.

## Offline verification checkpoint

Primary verification on Node22.16.0 and24.15.0:

- `npm run test:openai`:131/131, including18 new ordered-history tests.
- `npm run demo:openai-offline`:passed with scripted HTTP only.
- `npm run test:core`:266/266; no core files changed in this slice.
- `npm test`:31/31; `npm run validate`:passed.
- Pinned Claude2.1.260 `plugin validate .` and
  `plugin validate plugins/cairn-memory --strict`:passed on both runtimes.
- All seven H1 hashes, local documentation links and `git diff --check`:passed.

Primary review additionally required executable regressions for legitimate
active-memory revision growth when a duplicate capture adds receipts, bounded
retirement counts, and malformed review options (including throwing getters).
These tests verify mechanical rejection/acceptance only. No live provider,
credential, real ledger, new semantic result or publication was used.
Independent Spec review caught an overstrict equality between the immutable
replacement revision and the post-classification revision. The repair binds to
the actual admission revision and adds a real MOC-filing regression plus a forged
bound-revision counterexample. The same fixed-base reviews repeat after repair.
Independent Standards and Spec reviews apply to the candidate commit before push;
their final outcomes and the exact candidate SHA belong in the PR handoff.
