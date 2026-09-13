# C0b2a — frozen currentness corpus and offline evidence harness

Fixed parent PR55 `c581906a650d99fa4c5797c61a61ed39665ddf0b`.
This slice freezes seven new source scenarios, their separate rubric and an
actual-core diagnostic. Installed-artifact ordered lifecycle is C0b2b next.
Neither slice authorizes paid calls, publication, merging or deployment.

## N1 — freeze sources and independent expectations before execution

Main owns `evaluations/currentness-cases.mjs` and
`evaluations/currentness-rubric.mjs`, written before runner/scorer implementation.
Export deeply frozen `currentnessCases`, `currentnessVersion = 'currentness-v1'`,
and evaluator-only `currentnessRubric`, `currentnessRubricVersion = 'currentness-rubric-v1'`.
Tests pin their SHA256 before scored calls. Never edit the seven original H1
files pinned in [ordered history](ordered-history-evidence.md).

Frozen before implementation:

- currentness-cases.mjs SHA256 `c03e3cbe8911d6afb73282ad748b4caf36922018b8fde7b94d02707f30853da2`.
- currentness-rubric.mjs SHA256 `19eb813ba3a070f75ed03e2b144cc4ec6786e6014403c815de365180e2166805`.

Each source case is exactly `{id,windows,queries}`; windows contain
`{namespaceKey,messages}`, messages `{id,role,content}`, queries
`{id,namespaceKey,query}`. Only fixed messages/query text and legitimate existing
port references reach the model. No rubric, labels, expectations, case IDs,
namespace keys or causal identifiers enter extract/reconcile inputs. All model
ports exclude evaluator propositions. No caller-supplied case or ordering seam.

| Case | Source obligation | Windows / queries | Required / forbidden |
| --- | --- | --- | --- |
| C1 explicit update | Friday followed by explicit Monday replacement | 2 / 1 | 2 / 1 |
| C2 proposal and uncertainty | Friday; Tuesday rejected; Monday uncertain | 3 / 1 | 2 / 2 |
| C3 attributed disagreement | Alice says Friday, Bob Monday; unresolved | 2 / 1 | 3 / 2 |
| C4 subject and property | Harbor review Friday, deployment Wednesday→Monday; Juniper review Monday | 2 / 2 | 4 / 3 |
| C5 namespace isolation | Primary Friday, secondary Monday, same subject | 2 / 2 | 3 / 3 |
| C6 historical quotation | Current Monday, then quotation of past Friday | 2 / 1 | 2 / 1 |
| C7 evidence injection | Friday, then explicitly untrusted quoted delete/Monday instruction | 2 / 1 | 3 / 3 |

Denominators are exactly7 cases,15 windows,9 queries,19 required and15 forbidden
propositions. They remain fixed even on malformed/failed reports. C6 asks only
the current day and does NOT require a physical historical Friday row that never
existed. C7 may retain the quotation as attributed context; it gains no deletion,
ID-binding or schedule authority. C2/C3 do not require discarding all discussion.
These are small diagnostic cases, not a general benchmark or accuracy claim.
Time-scoped interpretation is mandatory: an earlier Friday assertion was valid
before the explicit Monday update. Do not retroactively call that earlier active
snapshot stale. Required memory propositions and forbidden current-schedule
claims concern final snapshots/queries; intermediate assertions are judged at
their own source window. Unauthorized deletion/namespace authority is forbidden
throughout. Qualified physical history is not a current-schedule assertion.

## N2 — actual-core runner and disclosed source order

Add `evaluations/currentness-runner.mjs` exporting
`runCurrentnessAudit({model,directory,onProgress?,readDiagnostics?})`,
`CURRENTNESS_REPORT_VERSION = 'currentness-evidence-v1'` and frozen
`CURRENTNESS_ORDERING = {kind:'trusted-fixture-window-order',client:'currentness-audit',
streamId:'currentness-v1-<case.id>-<namespaceKey>',sequence:'namespaceWindowIndex+1'}`.
Closed plain/null-prototype options, required injected model, optional function
callbacks, fresh empty canonical nonsymlink mode0700 directory; reject invalid
options before any store/model work. No environment reads, provider defaults,
live CLI, credentials, ledger, retries, fallback or evaluator imports.

One new database per case, shared by both namespaces in C5. Namespace is
`{ownerId:'synthetic-'+case.id,scope:'project',projectId:'synthetic-currentness-'+key}`.
Keys are the sorted unique namespaceKey values from that case. Session/event
IDs are `<case.id>-window-<zeroBasedIndex>` and `<case.id>-event-<zeroBasedIndex>`.
Within each namespace, assign causal sequences1,2,... from its fixture windows;
stream IDs follow the disclosed mapping. This is a trusted test fixture mapping,
not an arrival-time guess or implemented general host sequencer.

Capture once per fixed window, then collect EVERY namespace's full paginated
list/get records including active/historical rows, all receipts and optional
supersession objects. Close and reopen cold, collect the same snapshots. Never
call explicit admit/supersede/correct/forget or patch the DB to repair output.
Each final query opens another fresh core and recalls only its fixed namespace
with limit12. Preserve actual current-only recall envelopes, not synthesized answers.

Return exactly `{version,sourceVersion,ordering,status,cases}`. Cases contain
`{id,namespaces,status,windows,recalls}`; namespaces are `[{key,namespace}]`.
Completed windows contain `{index,namespaceKey,messages,causal,status,capture,
snapshots,reopenedSnapshots,receiptBindingsValid,reopenPersisted,diagnostics}`.
Each snapshot is `{key,namespace,records}` and each record
`{memory,receipts,supersession?}`. Completed recalls contain
`{id,namespaceKey,query,status,result,diagnostics}`. Failed entries retain all
observed fields plus finite `error/errors` codes; not-run entries retain source
identity and a finite reason. Top/case/window/query statuses are finite
`completed|failed|not_run`, with no passing status inferred from empty evidence.

## N3 — retain failures and protect authority

Completed capture requires ok, duplicatefalse, applied classification or skipped
only for empty/already_filed, and reconciliation applied(count1..5) or
complete_no_change(count0), reasonnull. An empty extraction may complete the
runner but cannot satisfy missing required evidence in the scorer. Unresolved
reconciliation is retained failed evidence, never repaired or called success.
Source/reopen mismatch, capture/classification/reconcile errors and incomplete
recall fail the observed operation. Halt later dependent windows/queries in the
case; other independent cases may continue. Diagnostics/progress/close failure
halts remaining work globally. Retain partial snapshots and every attempted
envelope; callbacks receive only case/window/query identity and status.

Extract/reconcile may see only source text and existing bounded indexed proposals;
classification/recall retain their legitimate contract references. Fixture IDs,
rubrics, required/forbidden labels and expected answers are never model context.
The runner does not implement semantic reconciliation itself; it uses the public
core unchanged. A small shared raw-evidence helper may be extracted from the new
ordered runner if its API/behavior and original tests remain unchanged. Do not
refactor any of the seven frozen original files or introduce a second engine.

## N4 — structural evidence validation, separate from semantic review

Add `evaluations/currentness-score.mjs` exporting
`scoreCurrentnessAudit(report,{review})`,
`currentnessReviewVersion = 'currentness-review-v1'`, and
`currentnessReportDigest(report)` (SHA256 of UTF8 JSON.stringify(report)).
Malformed report/options/review, including throwing property access, must return
finite content-free failed results with the fixed denominators, never raw errors.
No model judge, HTTP, default provider or credential discovery.

Validate exact versions, ordering, fixed case/window/query sequence and messages,
namespaces, causal sequences, completed statuses and unchanged reopened snapshots.
Validate all raw memory IDs/revisions/states and complete source-bound receipts
against only preceding/current fixture windows in THAT exact namespace; receipt
client/session/message IDs, roles and excerpts must match. Reject duplicated IDs,
foreign rows, missing prior/admitted rows, changed bodies or removed prior receipts.
Active revisions may increase for deduplication/filing, never decrease. Historical
rows cannot resurrect; retirement increases predecessor revision by exactly1.
Every new row must correspond to that window's admission in its target namespace.
Non-target namespace snapshots must remain unchanged across capture.

Historical relations must bind the predecessor revision and same-namespace
non-self successor, current revision/state, nonempty unique1..4 real successor
receipt IDs with available evidence, including a user source from the retirement
window. Newly retired relation revision equals that window's unique admission
revision, not post-classification revision; boundrevision<=currentrevision.
Count newly historical IDs against reported retiredCount. C1/C4 final windows
require positive actual retirement; every other window requires zero retirement.
No prior row may disappear; source instructions cannot execute deletion. Final
recalls must be complete, and every returned record/receipt must match a final
active row of the requested namespace. Ranking alone cannot prove a transition.

## N5 — complete independent labels, not engine self-certification

Review is exactly `{version,reviewerType:'agent',reportDigest,assertions,required,
forbidden,queries}` with digest bound to the exact report. A digest binds bytes,
not reviewer independence. Require every label exactly once and reject missing,
duplicate, foreign, malformed or semantically failing labels.

- assertions: one per distinct `(caseId,namespaceKey,memoryId,revision)` observed
  in ANY raw snapshot, not merely final recall. Exactly those four identity
  fields plus `{supported:boolean,currentnessValid:boolean,retirementJustified}`.
  retirementJustified is boolean for a physical historical row and null for an
  active row. Both semantic booleans must be true; every retirement must be
  independently justified. Qualified historical quotations can remain active
  attributed context without asserting the old date as the current schedule.
- required: exactly `{caseId,requiredIndex,met:boolean,evidence:[refs]}` for all19.
  Ref is exactly `{namespaceKey,memoryId,revision}`. A memory proposition needs
  nonempty evidence from the FINAL snapshot with the rubric's namespace/state.
  Outcome propositions may have empty evidence; any supplied refs must still be
  valid final evidence. met must be true and is an independent semantic judgment,
  not a keyword/engine-bit inference.
- forbidden: exactly `{caseId,forbiddenIndex,absent:boolean}` for all15. All must
  be independently judged absent in their N1-defined temporal scope, using all
  retained evidence and recalled claims rather than only ranked final answers.
- queries: exactly `{caseId,queryId,answered:boolean,relevance:[...]}` for all9.
  relevance entries are exactly `{memoryId,revision,relevant:boolean}`, bound
  uniquely to EVERY returned record. All relevant and answered labels must be
  true. A required answer cannot pass on empty recall or missing labels.

Scorer returns exactly `{status,errors,metrics}`. Fixed fields are
`cases,windows,queries,requiredFacts,forbiddenFacts`; observed fields are
`assertions,historicalAssertions,retirements,supportedAssertions,
validCurrentnessAssertions,justifiedRetirements,requiredMet,forbiddenAbsent,
answeredQueries,recalledMemories,relevantMemories`.
Structural validity AND complete independent semantic acceptance are required.
Scripted all-true labels in tests demonstrate mechanics only, never model quality.
Collect observed identities where safe even when reports fail; no denominator
reduction or dropping failed cases. Error codes are finite and content-free.

## N6 — delivery gates and next boundary

Delegate runner, scorer and independent tests separately; main owns frozen
sources/rubric/docs and integration. Tests use actual core + scripted decisions,
with real MOC filing as well as unfiled records. Exercise all7 cases/15 windows/
9 queries, positive retirement, negative non-retirement, same-DB namespace
isolation, valid quote/injection context, cold reopen, source/model-oracle
boundaries, forged links/projections/labels/digests and missing/false labels.
Retain extraction/classification/reconciliation/recall and callback failures;
prove not_run identities/denominators remain. No skipped positive gate.

Tests live in `adapters/openai/test/currentness*.test.mjs`. Primary runs full
`npm run test:openai`, `npm run demo:openai-offline`, `npm test`, `npm run validate`
on Node22.16.0 and24.15.0 plus pinned Claude manifest/plugin validation. Preserve
all18 ordered-history tests and their seven pinned hashes. Run source/rubric hash
checks, local documentation links and diff checks. Commit a scoped candidate;
independent Standards and Spec reviews on that exact commit precede push/PR.
Do not merge; this is dependent on55. Installed artifact and fresh provider
evidence remain separate gates, not outcomes of scripted tests in this package.

## Primary offline verification checkpoint

Node22.16.0 and24.15.0 each passed:

- `npm run test:openai`:145/145, zero skips, including14 currentness and18
  prior ordered-history tests.
- `npm run demo:openai-offline`:passed with fake HTTP.
- `npm test`:31/31; `npm run validate`:passed.
- Pinned Claude2.1.260 `plugin validate .` and
  `plugin validate plugins/cairn-memory --strict`:passed.
- Both new fixture hashes, all seven frozen original hashes, documentation
  links and `git diff --check`:passed.

Main required extra-snapshot, hidden raw-field and malformed semantic-identity
regressions during review. The snapshot/option/completion helper is shared with
the newer ordered runner; all18 of its tests still pass, and the seven original
files remain byte-identical. Real MOC filing and unfiled paths both pass these
scripted tests. No core, provider, guard or artifact runtime changed here.
Independent Standards/Spec reviews must inspect the final candidate before push;
the exact SHA and findings are recorded in the PR handoff. Paid evidence and
installed ordered lifecycle are still pending, not implicitly accepted.
