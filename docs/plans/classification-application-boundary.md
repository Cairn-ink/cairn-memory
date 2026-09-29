# M1d classification application boundary diagnosis

Status: bounded offline diagnosis plus a committed classification-error reporting
candidate; no core/adapter behavior change, paid run, production operation or
historical-cause claim in this packet.
Worktree: `classification-application-boundary` on
`diag/classification-application-boundary`. The work began at
`9f3fcc8825adf6588196685ff9e13a49cc5d9d85`, dependent on PR #299; the
starting merge base with `origin/main` was
`c2212ce12fa0f31d4847bfc3838f11db377fa51f`. Implementation owner:
GPT-6 Sol/high as configured by the primary dispatch (runtime model ID is not
independently exposed here). Primary owns accounting, acceptance and delivery.

## D01–D05 acceptance contract

- D01: the real adapter, indexed-evidence core and canonical ingestion fixture
  first goes red when a trusted `moc_title_conflict` is projected as generic,
  then green when the exact safe code is retained.
- D02: the mixed failure summary retains the same nonretryable code; admission,
  receipt and failed initial journal persist, and later planned batches stay
  `not_run`.
- D03: unknown error codes and any associated private text remain generic and
  nonretryable at both reporting boundaries.
- D04: the same history completes when the classifier references the visible
  existing topic, with completed adapter phases and zero model diagnostics.
- D05: the fix changes only LongMemEval reporting. Core classification,
  adapter behavior, historical paid outputs, scoring and recovery are outside
  scope.

## Contract and limits

The user wants a lightweight, reliable memory layer. The particular observed
paid installed run at `506eed0` completed five capture batches and returned a
sixth partial result with nonretryable `classification_failed`, while six
admission claims completed, 28 distinct memories and 31 receipts remained,
and initial classification was five applied, one failed. The last 64 adapter
phase events were completed; its final classify count transport, generation
transport and output validation took 1790.54 ms, 2639.01 ms and 0.168 ms.
The mixed observer retained zero model diagnostics at any layer, and all 24 physical requests
succeeded and settled. This does not establish a model timeout. The rejected
classification plan and underlying exception were not retained. A separate
case completed all 32 batches, so this is not a universal failure.

Acceptance for this bounded packet: a deterministic, fast, fake-HTTP test must
run the real OpenAI adapter through real indexed-evidence `core.capture` and
canonical LongMemEval ingestion, prove that adapter completion and zero model
diagnostics can precede a durable partial capture, preserve a specific trusted
classification error through both reporting projections, check admission,
receipt and first-attempt journal state, and include a positive existing-topic
control. An untrusted error code must remain generic and nonretryable. The fixture must
use owned scratch through `createTestWorkspace`; no live HTTP, key, ledger,
corpus, paid-output read, production access or unsafe automatic filing.

## Feedback loop and evidence

Fixture: `adapters/openai/test/classification-application-boundary.test.mjs`.
Run with:

```sh
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs adapters/openai/test/classification-application-boundary.test.mjs
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs adapters/openai/test/classification-application-boundary.test.mjs
```

The red check before the reporting fix was:

```sh
node tools/testing/run.mjs --test-name-pattern='canonical indexed ingestion preserves' adapters/openai/test/classification-application-boundary.test.mjs
```

It failed `0/1` in 386 ms: raw core returned `moc_title_conflict`, while
canonical ingestion returned `classification_failed`. Adding the one trusted
code to `SAFE_CAPTURE_ERROR_CODES` made that same command pass `1/1` in 682 ms.
The earlier fixture also corrected a timing assertion from `status` to the
actual `outcome` field. A synthetic SQLite placement abort returned typed
`storage_error`; a deliberately injected untyped model-bridge rejection
returned `classification_failed` but emitted `core_call/provider_failure`.
Neither matches the paid run's empty model-diagnostic observer.

Minimal load-bearing states and outcomes:

| Synthetic variant | Adapter classify output validation | Core result | Canonical ingestion and diagnostic signal |
| --- | --- | --- | --- |
| Valid new topic, then existing L1 reference | completed | applied | all three indexed batches completed; empty model diagnostics |
| 121-character new topic title | completed | `invalid_model_output` | memory and receipt retained; core diagnostic `invalid_classification` |
| Valid topic with SQLite placement abort | completed | `storage_error` | admitted and unfiled; initial journal failed |
| Deliberately injected untyped bridge rejection after adapter return | completed | `classification_failed` | `core_call/provider_failure`; **not** the full observed fingerprint |
| Duplicate new topic title after an existing filed topic | completed | `moc_title_conflict` | second batch partial; formerly projected `classification_failed`, now retains `moc_title_conflict`; third not run; empty diagnostics |
| Unknown wire alias | failed | `invalid_model_output` | adapter `output_shape`, core `adapter_output_invalid` |

The real two-batch collision takes this path:
`core.capture` returns `moc_title_conflict`; the indexed-evidence ingestion
response normalizer called `safeError`, whose finite allowlist omitted that
code, replacing it with `classification_failed`; `projectIngestionFailure`
then retained the replacement. The old public code therefore did not identify
the core rejection. A third planned batch remained `not_run`. All source
receipts and the failed first-attempt journal persisted, and the actual mixed
observer contained zero events. The second classifier's wire input included
the already filed topic; proposing a new topic with its title is a fail-closed
application refusal. The existing-topic reference control completes all three
batches. This reproduces the paid run's *reported* fingerprint with synthetic
data; it does not prove that the missing paid plan made the same proposal.

The separate 121-character title is accepted by the adapter schema and
rejected by the core's 120-code-point limit, an independent fail-closed
contract mismatch. The injected bridge rejection emits a core diagnostic, so
it does not reproduce the paid observer's empty event list. Wire alias decoding
runs inside adapter `output_validation` before its completed event. The current
core/adapter files examined have no source diff between the paid installed
commit `506eed0` and this branch's starting HEAD; this check does not recover
the missing historical plan or exception.

## Ranked falsifiable hypotheses and results

1. A valid plan proposes a new topic whose canonical title already exists;
   the ingestion allowlist loses core's specific refusal. Prediction: using an
   existing-topic reference for the same second batch completes, and adding
   only the finite `moc_title_conflict` code preserves it in the partial result
   and mixed summary. Both predictions hold in the synthetic real-chain test.
   Historical occurrence remains unknown without the paid plan.
2. Provider schema permits a value the core refuses. Prediction: changing
   only a 121-character title to a valid one applies. Confirmed as an
   independent mismatch; it gives core `invalid_model_output` and a core
   diagnostic, so cannot alone explain the empty-diagnostic paid fingerprint.
3. Classification races an admission, map or member revision. Prediction:
   changing only the intervening write would remove a revision or index
   conflict. Existing core classification tests cover the fail-closed CAS and
   predict typed conflict codes that the ingestion allowlist already preserves.
   No concurrent write or stale state is observed in the paid trace.
4. An untyped exception occurs after valid adapter output. Prediction: an
   injected post-adapter rejection yields `classification_failed`, but it must
   also emit `core_call/provider_failure` through the wired mixed observer.
   The control confirms that diagnostic, unlike the paid observer. A SQLite
   placement abort yields typed `storage_error`. An unknown wire alias fails
   adapter output validation. These variants do not match the full fingerprint.

## Atomicity, replay and corrective direction

Capture commits admitted memories, receipts and the first-attempt journal
before classification. The fixture observes those records after each partial
case; classification failures do not roll back admission. The failed initial
attempt is retained as failed, and a duplicate event returns without another
adapter call. Current filing and the first-attempt journal are distinct. No
automatic retry, broadened namespace, relaxed reference check or reconstructed
source is implied. Explicit recovery would need fresh current refs and the
existing revision and namespace guards; it cannot rewrite the initial attempt.

The scoped fix adds only `moc_title_conflict` to ingestion's trusted finite
error allowlist. It preserves an existing source-free core error through both
normalization and `projectIngestionFailure`; it does not make a colliding plan
apply, retry a batch, reopen a claim, or change the MOC trust boundary. A
synthetic unknown error code, even with `retryable: true`, still becomes
nonretryable `classification_failed`, and its private text does not appear in
the outcome. The installed paid artifact and its recorded output stay
immutable: the new code cannot reclassify or rescore that historical result.

Caller trace: the one `safeError` allowlist is shared by legacy,
indexed-window, indexed-evidence and qualified-prefix LongMemEval ingestion.
Their capture-result normalization calls it before any downstream consumer;
`projectIngestionFailure` uses it again for classification and capture failures.
The mixed runner's `summarizeMixedIngestionStop`, comparison/public-comparison
outcomes, and live pilot failure projections consume that shared projection.
Only the finite code mapping changes; response fields, stage and status,
namespace and revision checks, batch-stop behavior and scorer implementation do not.

Potential future prevention is to guide classification toward the existing
visible L1 topic when a proposed new title canonically collides, while keeping
core's `moc_title_conflict` refusal as the authority. A source-free diagnostic
category for core apply refusal could help future offline repeats distinguish
it from other completed-adapter failures. The independent title-length mismatch
could be narrowed at the adapter schema/prompt, with normalization and Unicode
tests; a length-only schema rule may not match core normalization. None of
those classification changes is included here. No deadline extension, retry,
swallowed error, weaker allowlist, changed MOC scope, raw retention or scorer
change is proposed.

A zero-call deterministic rewrite from duplicate `newL1` to an existing L1
reference is **not** authorized by this reporting fix. The classification
catalog shows same-namespace MOC title, level and ID, but omits L2 edges. Even
when the proposed `newL1` has empty `parentL2Ids` and no `newL2Title`, reuse
could place a memory under unseen L2 parents and silently change topology or
semantic intent. Same-level canonical-title uniqueness proves a second group
cannot be created; it does not prove equivalent placement. Any later compiler
proposal must decide this explicitly and still refuse nonempty parentL2 or
newL2 requests, missing/hidden or unshown catalog titles, stale map/member
revisions, wrong-level or foreign IDs, incomplete maps and parent-limit
violations. Direct `applyPlacement` must continue to reject collisions. The
current prompt already prefers suitable existing groups, so prompt guidance
alone is a possible bounded experiment but no completion guarantee.

Unresolved: the exact paid-run classification plan and underlying core error.
The synthetic collision is a concrete sufficient explanation for the retained
fingerprint, but not evidence that it occurred in the paid run.

## Ownership and verification record

The checks below are a pre-commit worker/primary checkpoint on the scoped
candidate that began at `9f3fcc8`; they are not a claim about later commits.

The primary dispatched this bounded D01–D05 worker packet to GPT-6 Sol/high
on the fixed `9f3fcc8` starting HEAD and retained accounting, result adjudication,
actual-diff review and final delivery. The initial candidate made four scoped file changes:
the adapter-to-core-to-ingestion fixture, the finite ingestion error mapping,
this plan, and the Unreleased changelog entry. No ownership escalation was
needed after the red fixture identified the reporting boundary.
Elapsed time and token cost are not measured by the repository; do not infer
them from the model label. The primary independently reran the focused six-test
fixture on Node 22.16.0 and 24.15.0 at an intermediate candidate. The primary
also ran full `npm test` (131/131) and `npm run test:longmemeval` (199/199)
on both Node versions, plus `npm run validate` on both. Pinned Claude 2.1.260
strict marketplace and plugin checks passed on Node 22. After this checkpoint,
the primary fast-forwarded to PR #299's reviewed head `588e430` without overlap
in the four owned files and created local candidate `fb4c4e5`. On that
candidate, the primary reran the focused fixture (6/6), full `npm test`
(131/131), and `npm run validate` on Node 22.16.0 and 24.15.0. Final fixed-diff
review and CI evidence belong in the PR record. Standards review correction
round 1 added the required `docs/limitations.md` note, removed an unused
fixture option, and clarified this plan's historical checkpoint. The focused
fixture passed 6/6 again on Node 22.16.0 and 24.15.0; `npm run validate` and
`git diff --check` passed. This correction changed no runtime behavior. The DRI
defers any automatic same-title topic reuse; no product decision or behavior
change beyond error reporting is part of this packet.

| Check | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Focused real adapter/core/ingestion fixture | 6/6 pass, 2244 ms | 6/6 pass, 2204 ms |
| `npm run test:longmemeval` | 199/199 pass, 11079 ms | 199/199 pass, 10873 ms |
| `npm run test:openai` | 330/330 pass, 132615 ms | 330/330 pass, 129060 ms |
| Ingestion, comparison, public and mixed LongMemEval demos via `tools/testing/run.mjs --script` | 4/4 exit 0 | 4/4 exit 0 |

`npm run validate` passed once on Node 22.16.0 (JSON and version validation).
All fixtures and demos used synthetic data and the owned test runner; the
OpenAI suites used fake HTTP. The red and green focused commands and their
specific assertion outcomes are recorded above. These pre-commit checks
establish the source reporting change; they do not establish installed-artifact
parity or the missing paid-plan cause.
