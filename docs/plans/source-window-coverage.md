# Indexed source-window coverage: N1

Status: offline implementation accepted; final independent review and CI pending. Base:
`304ac6fcb9b71ec2eade579bfb0877e409167e10`. Worktree:
`source-window-coverage`; branch: `feat/source-window-coverage`.

## Goal and boundaries

Cairn's goal remains a lightweight, source-backed memory layer usable through
MCP and agent harnesses, with measured reliability rather than storage-success
claims. The preceding diagnosis (PR #280) distinguished exact source windows
not retained during successful capture from retained sources not recalled.
Selective admission is not a transcript archive; omission counts alone cannot
establish relevance, truth, semantic loss or benchmark accuracy.

This checkpoint provides a bounded, source-free observation of fresh indexed
capture. It does not silently retain more data, repair a historical score or
change default MOC behavior. The timeout diagnostic PR #281 is independent.
Both prior PRs are currently open; this branch starts from main, not either PR.

The staged plan is:

1. **N1, this scope:** establish an observable source-window accounting seam
   and verify offered/selected/retained/unmatched/ambiguous distinctions on
   synthetic public capture and cold reads, including failures and duplicates.
2. **N2:** localize retained-source losses at candidate visibility, selection,
   fetch, ranking and answer packing using fresh synthetic inputs and bounded
   traces. Choose a scoped product correction only from demonstrated causes.
3. **Product correction and N3:** prove a change improves the intended source
   or retrieval behavior, pass offline and independent gates, then prospectively
   freeze new quality cases against comparable baselines within the existing
   cumulative budget. Keep consumed cases, judgments and ledgers immutable.

## Acceptance contract

- **W1 — Real seam and red first.** Build a seconds-scale deterministic
  synthetic public-capture/cold-read check showing completed admission with a
  submitted window absent from retained receipts. Require the proposed
  observation to distinguish that gap from complete retention. Record the
  command and actual failure before implementing the observation. Do not use
  hidden expected IDs, evaluator labels or source answers in model callbacks.
- **W2 — Bounded accounting.** Define explicit, finite limits and exact
  canonical matching for offered, model-selected (only when observable),
  durably retained, unmatched and ambiguous windows. Match source identity,
  attributed role and exact canonical text, not substring similarity or only
  card content. Duplicated sources/receipts must not inflate unique coverage.
  Preserve processing, failed, suppressed, unavailable and truncated states;
  unavailable evidence must not become a zero or a complete-success claim.
- **W3 — Read-only observation.** Prefer a maintainer-only evaluation helper
  around existing public APIs, with no production schema or storage change.
  Do not modify capture/admission/recall/model behavior, input/output payloads,
  defaults, prompts, deadlines, retries, budgets or request counts. An enabled
  versus disabled differential test must prove identical underlying calls and
  outcomes. Any added reads must be explicitly bounded and side-effect-free.
- **W4 — Safety and lifecycle.** Output only fixed fields, bounded ordinals,
  counts and enumerated reasons. No raw text, namespace/source/memory/receipt
  IDs, paths, arbitrary errors, hashes of source text, credentials or oracle
  labels. Respect namespaces, correction, forgetting and revision fences;
  conflicting or incomplete reads fail closed as unavailable, not retained.
  Callback throws, malformed/accessor-rich metadata, mutation and late events
  must not alter capture behavior or contaminate another capture's report.
- **W5 — Honest selection.** Do not infer model selection merely from a
  receipt's presence or from capture completion. If validated extraction
  selection cannot be observed without changing the product contract, record
  it explicitly as unavailable and propose a separate seam to the primary.
  A duplicate must not fabricate a new extraction or its historic selection.
- **W6 — Regression and isolation.** Cover complete, partial, empty, duplicate,
  suppressed, failed and ambiguous/unavailable cases, long split windows,
  Unicode boundaries, repeated text with distinct identities, and late source
  correction/forget. Use synthetic data and `createTestWorkspace` with the
  owned runner on Node 22.16.0 and 24.15.0. Verify success/failure cleanup and
  run current contributor gates. No historical temporary-directory cleanup.
- **W7 — Delivery.** Preserve the red result and ranked falsifiable hypotheses,
  resolved API/limits, code-path trace, commands/outcomes, tested SHA and
  limitations here. Primary inspects the actual diff and reruns key paths;
  independent Standards and Spec reviews must pass the same final commit,
  followed by all applicable CI and remote-head/mergeability checks. No merge,
  publication or deployment is authorized by this delivery workflow.

## Implementation checkpoint and ownership

Implementation: one bounded GPT-6 Sol/high worker. Primary owns architecture,
shared-file changes, acceptance and PR delivery. The worker may first edit
this plan and a focused synthetic test, then propose exact module/API,
selection-observation semantics, limits and affected callers after its red
loop and ranked hypotheses. Primary approval is required before production or
evaluation implementation changes. A final integration must actually consume
the observation at an identified fresh-case path; an unused helper alone does
not satisfy N1. No CLI or public core/MCP option without a separate decision.

Workers must not access downloaded corpora, source answers/evaluators, provider
keys or environment files, operational ledgers, or historical paid-run folders.
No paid requests, replay/rescore of consumed cases, inferred spend figures or
truth/completeness claims. New execution evidence is synthetic and offline.

## Evidence log

### W1 red checkpoint, fixed base `304ac6fcb9b71ec2eade579bfb0877e409167e10`

`evaluation/architecture/test/source-window-coverage.test.mjs` uses the real
`openMemoryCore` indexed-evidence capture, a two-window canonical synthetic
message, scripted extraction selecting only ordinal 1, one admitted memory,
and a new cold core instance. Before the failing assertion, it verifies that
the extractor saw both exact windows, capture reported two offered windows,
the model calls were exactly `extract,classify`, and the cold receipt contained
only ordinal 1. It asks for an observer report identifying ordinal 2 as
unmatched; there is no observer yet. This is a missing-observation failure,
not evidence of a semantic model failure or a product correction.

Command (run three times on Node 22.16.0, once on Node 24.15.0;
latest Node 22 result below):

```text
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/source-window-coverage.test.mjs
exit 1; tests 1; pass 0; fail 1; duration 176.923262ms
AssertionError: expected report?.status === 'completed'; actual undefined
evaluation/architecture/test/source-window-coverage.test.mjs:54
```

The Node 24.15.0 invocation used the corresponding binary, also exited 1
with the same `undefined` versus `completed` assertion after 175ms. The
runner created and removed only its fresh owned test workspace.

### Ranked falsifiable hypotheses before implementation

1. The public `sourceWindowCatalog` reports only counts, so complete and
   partial retained-source outcomes are indistinguishable from capture success.
   Prediction: the two-window fixture returns `windowCount:2` while a cold
   exact receipt join finds one matching window. The red fixture confirms this.
2. The existing synthetic lineage diagnostic maps one chunk per turn in the
   default capture lane. Prediction: feeding two windows from one source to
   that one-to-one map cannot produce separate ordinal retention outcomes.
3. The long-history gate checks named required passages and a single-source
   omission control, but has no complete offered-window accounting. Prediction:
   its `omittedSource` control stays green while a partial two-window capture
   lacks an unmatched-window row. This still needs a differential gate check.
4. A naive post-capture `get` can mistake pagination or later revision for
   source omission. Prediction: with more than one receipt page, correction or
   forgetting, the naive comparison gives a false retained/unmatched verdict;
   bounded exhausted-page and revision checks must instead mark unavailable.
5. A duplicate or processing response gives only requested-view catalog
   counts, not its original extraction selection. Prediction: replay produces
   no new `extract` callback even though the same catalog count is returned;
   model selection must remain unavailable for that response.

### Approved scoped observation seam

Add `evaluation/architecture/source-window-coverage.mjs` exporting
`createIndexedSourceWindowObserver()`. Its
`observer.capture(core, input)` snapshots only own, non-accessor input fields
through the existing `captureSnapshot` and `sourceWindowCatalog`
canonicalization immediately before forwarding the same input to
`core.capture`; it returns the unchanged public response or throws the same
exception. It copies bounded result metadata before returning the original
result, so later caller mutation cannot rebind the report. It binds the
offered view to that actual call.
`observer.finish({ inspectAdmission, get })` then synchronously returns a new
fixed-field, source-free report. The consumer calls it after capture on a
newly opened cold core. There is no model callback wrapper or core change:
`selection` is always `unavailable` in N1, including when a receipt matches
or capture is a replay. The public response never exposes the validated
extraction indices; model output before core validation would not prove a
selection. A separate product seam would require a new decision.

The report has version 1, `scope:'capture-members-only/current-read'`, closed
capture and coverage statuses, fixed counts,
`selection:'unavailable'`, and at most 64 `{ordinal,retention}` rows. The
retention enum is `retained|unmatched|ambiguous|unavailable`;
unknown counts are null, never zero. Internally match the exact canonical
`[client,sessionId,eventId,role,excerpt]` tuple. Collapse equal receipt tuples
and count distinct offered tuples once. If two offered windows share a tuple,
mark their ordinals ambiguous rather than assigning a single receipt to one.
No tuple, text, identifiers, errors or source-derived hashes enter the report.
`offeredCount` counts ordinal windows, `uniqueOfferedCount` counts distinct
tuples, and unique retained/unmatched/ambiguous counts partition only the
distinct tuples. A repeated tuple with any matching receipt contributes one
ambiguous group and zero uniquely retained windows. A repeated tuple without
a receipt is unmatched. The `coverage` enum is
`complete|partial|none|ambiguous|unavailable`, separate from the capture
`status:'observed'`; neither means semantic completeness.

Limits: existing maximum 24 source messages, 20,000 UTF-16 units and 64
catalog windows; at most five fresh admission members; one cold
`inspectAdmission` before and after at most five `get` calls; each `get` asks
for at most 100 receipts, so at most 500 receipts are inspected. Require the
same exact namespace, client, event and member set across admission inspection,
`get` revisions matching the current inspected members and the capture's
post-classification revision where available (a validated subset of admission
members may be classified), plus returned memory ID and namespace. Require
`exhausted:true` and complete `receiptCount` on every
receipt page. Any conflict, changed/closed member, incomplete page, malformed
or accessor-rich metadata, or read callback error yields unavailable, not a
retained claim. Fresh empty extraction can report unmatched windows; duplicate,
processing and failed capture preserve their distinct status with unknown
retention. Suppression cannot be allocated to individual windows without
selection evidence, so a suppressed capture has `status:'suppressed'` and
unavailable window rows.
`finish` is one-shot and ignores late calls, so no later capture can inherit
its state. Every output field is fixed; the maximum serialized report is
16 KiB. Differential enabled/disabled tests assert identical model method
sequence, unchanged capture outcome and persisted receipts.

Fresh consumer: add the observer to `evaluation/long-history/gate.mjs` at the
existing `longWindows` and `faultControls.omittedSource` capture points, using
that gate's cold reopen and current synthetic source. Surface only the bounded
source-free report in its local offline report; assert 3/3 retained for the
long-window positive and unmatched for the omission control. The gate already
uses the real indexed-evidence lane and scripted callbacks. This is a synthetic
offline diagnostic, not a revision of paid comparisons, public APIs or a
measured quality result.

### Implementation and offline verification, pre-freeze

The W1 test now expects the approved `scope` and `status:'observed'` contract;
its original `completed` red output above remains the before-implementation
record. During implementation, two fixture assertions were corrected: a
two-window differential case correctly has partial rather than complete
coverage, and a 24-message byte-cap fixture needed uniformly 801-unit
messages to make 48 windows. A mixed filing test initially made a second
conflicting L1 proposal, then reused the exact prior receipt identity so the
already-filed member stayed filed; the final real-core test proves the
classifier returns only the new member revision. No core code changed.

At the latest pre-freeze working diff, both Node 22.16.0 and 24.15.0 passed:

| Command (run with that Node binary / npm on PATH) | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node tools/testing/run.mjs evaluation/architecture/test/source-window-coverage.test.mjs` | 11/11, 2.34s | 11/11, 3.74s |
| `node tools/testing/run.mjs evaluation/long-history/gate.test.mjs` | 5/5, 34.76s | 5/5, 34.25s |
| `npm test` | 132/132 | 132/132 |
| `npm run validate` | pass, consistent 0.1.0 | pass, consistent 0.1.0 |
| `npm run test:longmemeval` (primary-run) | 193/193, 10.02s | 193/193, 9.42s |
| `npm run test:workspace-lifecycle` (primary-run) | 25/25, 14.71s | 25/25, 14.76s |
| plugin and marketplace strict validation (primary-run) | pass | pass |

The new architecture test has the existing supported-SQLite guard and dynamic
core import, so Node 20 test discovery skips it explicitly. Node 22.16.0
and 24.15.0 run it. The fixed serialized-report bound was checked against a
48-window synthetic input; no source text, IDs, path, error or hash appeared.
These are scripted offline checks, not a measured improvement in real-model
retention or answer quality. Final exact-head gates, primary acceptance and
independent review are still pending.

### Primary acceptance and first independent review

The primary inspected the seven-file candidate
`3a6eaea334c8f526dfdbaa4775d81bdd7169ecfd` against the fixed base and personally
ran these commands with `NODE_DISABLE_COMPILE_CACHE=1` and the named Node
runtime first on `PATH`:

| Exact-candidate command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 132/132, 4.37s | 132/132, 4.14s |
| `npm run test:long-history` | 5/5, 34.55s | 5/5, 32.80s |

The latter exercises actual indexed capture, cold reopen and answer packing,
with the unchanged 208 planned batches, 1,030 admitted cards, seven required
passages and eight expected negative controls. The observer adds accounting
for only the three-window positive capture and one-window omission control;
it does not claim coverage of all 208 captures.

Independent Standards review found one documentation gap: `CONTRIBUTING.md`
requires `ROADMAP.md` to reflect an evidence-gate change. Independent Spec
review passed W1–W6 and found the W7 record lacked the exact tested SHA and
primary results. The Spec reviewer also reran the focused 11/11 suite on both
runtimes. This record and the scoped roadmap note address those gaps; a
successor candidate still requires both complete-diff reviews and latest-head
CI. No review of the earlier candidate is represented as a review of a later
commit.

The primary also requested a bounded proxy-input negative control before
final acceptance: snapshotting must not execute an extra descriptor trap and
thereby change the input sent to the underlying public capture. The worker
must first record a failing test, then make only the smallest observer-side
correction and rerun the affected gates. This does not authorize a core change.

| Responsibility | Owner and routing | Evidence and supervision |
| --- | --- | --- |
| W1–W6 implementation | `source_window_coverage6`, GPT-6 Sol/high | Fixed-base red loop; primary inspection corrected classification-subset, metadata snapshot, read identity and cleanup assumptions before freeze. |
| Architecture and acceptance | Primary | Owns shared protocol/limitations/roadmap integration; directly inspected the diff and reran both final consumer paths above. |
| Standards review | `reliability_diag_standards6`, independent reviewer | Exact `3a6eaea` diff; one roadmap-record finding, no other actionable finding. |
| Spec review | `reliability_diag_spec6`, independent reviewer | Exact `3a6eaea` diff; W1–W6 pass, one W7 evidence-record finding. |

One post-freeze correction round completed as recorded below. Agent token/cost
and total elapsed time are not exposed and are not inferred from model labels. All new tests
use synthetic local data; no provider call, paid-case replay or operational
ledger access was made.

### Proxy correction and exact-code acceptance

The worker ran this negative control before changing the helper:

```text
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs --test-name-pattern='proxied input adds no observer property traps' evaluation/architecture/test/source-window-coverage.test.mjs
exit 1; tests 1; pass 0; fail 1; duration 43.79ms
AssertionError: extra descriptor trap calls: actual 3, expected 0
```

The forwarding test received the original input/result, but observing a
proxied namespace invoked three additional user descriptor traps. Rejecting
proxies from diagnostic snapshots before descriptor access prevents that
side effect; the public call still receives the original input and the report
is unavailable. The same test now covers a proxied message too. Array length
is read once through the own-data-property guard. The targeted command then
passed 1/1 in 41.23ms. No public-core validation or behavior was changed.

The two-file code correction is
`4f3a282a90795004b113d06dadd45dd6ee966967`. After inspecting its exact diff,
the primary personally reran the affected gates with that code SHA:

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `NODE_DISABLE_COMPILE_CACHE=1 npm test` | 133/133, 4.55s | 133/133, 4.25s |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:long-history` | 5/5, 33.80s | 5/5, 32.10s |

The final integration adds only the roadmap and this evidence record to that
tested code. Its final commit must receive both full-diff review axes and
latest-head CI before delivery; the PR records that exact delivery SHA.
N1 supplies trustworthy bounded accounting, not improved semantic retention,
retrieval accuracy, a repaired historical score or completed N2/N3.
