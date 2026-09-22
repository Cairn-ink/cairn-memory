# Public pilot runner — private, guarded, offline-tested

`evaluation/live/public-pilot.mjs` executes the separately versioned public
comparison (`runPublicComparison`, arms `cairn`, `full-history`, `no-memory`)
and the official-style scorer (`scorePublicComparison`) against real providers
**only** through the benchmark request guard. It never discovers keys, ledgers
or datasets: every input is explicit, every paid request is reserved on the
existing campaign ledger before it is sent, one attempt is made per request,
and, by default, an unknown outcome halts all further paid work. Results are private
artifacts of a small plumbing pilot; nothing here is a leaderboard result.

## Inputs the operator supplies

| Input | How | Notes |
| --- | --- | --- |
| Provider key | `OPENAI_API_KEY` in the launcher process environment | Read once inside `main()`, used only in the `Authorization` header, never written, printed or returned |
| Campaign ledger | `--ledger /private/ledger.json` (mode 0600) with exactly `{directory, runId, limitMicroUsd, requestCap}` | Must describe the existing ledger; the runner never creates, resets or replaces one |
| Benchmark authorization | `--authorization-id <id>` | Provisions or re-verifies `experiment-benchmark-extension.json` beside the ledger (P1) |
| Existing request allowance | `--request-allowance-authorization-id <id>` | Explicitly loads an already-issued derived benchmark allowance whose original benchmark ID must match `--authorization-id`; the CLI never increases the ledger cap |
| Prepared v2 pilot | `--prepared /private/prepared` | Four-file directory from `prepareLongMemEval`; digest-checked by `loadPreparedPilot`; never written |
| Prepared cohort bound | `--max-prepared-cases N` | Optional loader-only ceiling from 1 through 500; omission remains 7. It grants no budget, request, retry, resume, replacement, or resource-limit authority |
| Optional reference sidecar | `--sidecar /private/reference-sidecar.json --sidecar-sha256 <hex>` | From `render-reference-sidecar.py`; needed only for non-string references |
| Output | `--output /private/run-dir` (new, or a previous legacy/default run directory to resume) | Created 0700; every file 0600 |
| Case subset | `--cases id1,id2` (source or opaque ids; roster order is kept) | Omit to run every prepared case |
| Batch caps | `--batch-cap-micro-usd N --batch-request-cap N` | This run's own reservations and requests, checked before every case against that case's projected reservation. Size the cap at or above the `totals` that `--dry-run` prints for the selected cases, not at a single case's figure: every case generates before any case scores, so a later generation can consume the headroom an earlier case needs for its three judge calls |
| Provenance | `--run-commit <sha>`, `--exclusions-file <json array>` | Recorded in `manifest.json` and `report.json` |
| Answer boundary | `--answer-template-version cairn-longmemeval-public-answer-v2` | Experimental opt-in; omission is v1, and v1/v2 runs and scores are not comparable |
| Case deadlines | `--case-timeout-policy case-deadline-v1` plus `--case-authorization-id`, `--execution-id`, `--expected-request-count`, and `--expected-reserved-micro-usd` | All five are required. The capability and live session are one-shot: output must be new and the run cannot be resumed, retried or moved to another directory |
| Merge | `--merge /private/run-a,/private/run-b --output /private/merged` | Offline; no key, no ledger; only `--output` may accompany it |

Safe launch (no request is sent until the ledger, the extension and the
prepared input all verify; the first paid call is the first Cairn capture
count of the first case):

```sh
OPENAI_API_KEY='<operator secret>' node evaluation/live/public-pilot-cli.mjs \
  --prepared /private/prepared --ledger /private/ledger.json \
  --authorization-id benchmark-pilot-v1 --output /private/run-2026-09-18-batch1 \
  --cases 86b68151,bc8a6e93_abs --batch-cap-micro-usd 3000000 --batch-request-cap 600 \
  --run-commit <sha> --exclusions-file /private/exclusions.json
```

`--dry-run` performs every check (ledger reopen, extension authorization or
re-verification, prepared-pilot digests, case selection) and prints, as one
JSON line, the projected reservation and request count per case, the totals,
whether they fit the caps and the ledger's remaining allowance, and the ledger
state. It also prints the effective `maxPreparedCases`; a prepared manifest
above that bound refuses before provider-key access or a case claim. It
reserves nothing and does not read the key. Exit codes: 0 done, 1
refused or failed (a fixed code on stderr, never data), 2 missing key.
In case-deadline mode it also verifies the complete generation-then-scoring
schedule, checkpoint, optional sidecar and durable capability binding without
consuming the execution claim. It reports the policy/execution identity and
the live-process-only restriction; repeated dry-runs are safe.

When `--request-allowance-authorization-id` is present, dry-run and live mode
use only the read-only allowance loader. The deterministic private grant must
already exist and the supplied ledger must contain its effective finite cap.
The bounded allowance identity contains only its version and authorization ID,
prior and effective caps, checkpoint and historical digest. Dry-run prints it;
live mode also records it in the durable manifest/report operator metadata and
the final run summary so later audits can bind the execution to the same grant.
A missing, malformed, foreign or mismatched grant refuses before the provider
key, any reservation or a case claim. Omitting the flag preserves the original
benchmark authorization path and adds none of these fields; the runner never
discovers or silently opts into an allowance.

## What is fixed by the runner

- Models: answer `gpt-4.1-mini-2025-04-14`, judge `gpt-4o-2024-08-06`, Cairn
  capture and recall on the adapter default. All are pinned in the benchmark
  extension (`benchmarkStagePolicy()`) and re-verified before every
  reservation. There is no fallback model.
- Stage bounds: answer 125,000 input tokens (1,024 framing), 512 output
  tokens, 50,820 µUSD reserved per request, 180 s timeout; judge 4,096 input
  tokens (256 framing), 16 output tokens, 10,400 µUSD reserved, 60 s timeout.
  Cairn count and generation calls reserve 5,000 µUSD each on the baseline
  policy. Reservations are upper bounds, not invoices.
- Comparison limits (`PUBLIC_PILOT_LIMITS`): `contextWindow` 123,000,
  `outputTokens` 512, `answerTimeoutMs` 200,000, `recallLimit` 6; judge
  timeout 90,000 ms. The comparison itself fixes source-evidence recall
  (`contextMode: 'source-evidence'`). These are policy bounds, not the
  provider's window.
- Request bodies: exactly what `runPublicComparison` and
  `officialJudgeRequest` produce, plus `store:false` and `stream:false` added
  by the session (a documented deviation from upstream judge kwargs; no other
  translation). The guard allowlist rejects anything else.
- Answer template: v1 remains the default with its original artifact and CLI
  shapes. V2 records its identity in every run, case, scoring, aggregate and
  report layer, including blocked and zero-score runs.
- Projection per case, checked before the case starts: reservation
  `(batches × 4 + 6) × 5,000 + 3 × 50,820 + 3 × 10,400` µUSD and
  `batches × 4 + 12` requests, where `batches` comes from the case's real
  `planLongMemEvalCase` plan. A case whose projection would exceed the caps is
  recorded `blocked: cap_exhausted_projected`; one the ledger cannot cover is
  `blocked: ledger_allowance_insufficient`. Neither sends a request.
- Legacy/default halt: once the guard halts (unknown outcome, overrun, foreign unsettled
  attempt), the current case keeps whatever stage it reached and every
  remaining generation or scoring step is `blocked: paid_work_halted`.
- Explicit `case-deadline-v1` mode isolates only a deadline proven by the
  guard's own transport timer or genuine core timer to the active case. Every
  other unknown outcome remains a sticky global halt. Generation and scoring
  callbacks include their durable artifacts and checkpoint boundary; a timed-
  out generation receives no judge calls, while a scoring timeout can retain
  earlier valid arm judgments without removing the case from fixed denominators.
  `summary.scored` counts only completed scoring wrappers; separate opt-in
  counts are `summary.generationTimeouts` (failed generation timeout wrappers),
  `summary.scoringTimeouts` (failed scoring timeout wrappers), and
  `summary.partialScoreRecords` (failed scoring-timeout wrappers that retain a
  valid three-arm score payload, including one whose judgments are all
  unresolved). Those partial score records contribute genuine per-arm
  observations even though they are excluded from `summary.scored`, so the
  official score-record count can exceed that completed-wrapper count.
  Unresolved or no-score values remain null and the common bucket still
  requires all three arms resolved.

## Private artifacts (per run directory)

- `manifest.json`: pilot identity hashes, roster, stage policy, limits, caps,
  the receipt bound, the limitations text and the operator fields (run commit,
  authorization id and checkpoint, ledger run id, sidecar digest, exclusion
  registry, projections).
- `checkpoint.json`: per-case stage (`pending`, `generating`, `generated`,
  `scoring`, `scored`, `blocked` with reason and phase) and the guard attempt
  ids seen; rewritten atomically after every durable step.
- `cases/<opaque-id>/`: `memory.sqlite` (fresh per case), `generation.json`
  (the frozen comparison run), `answer-requests.json` (the exact request bodies
  in send order including packed evidence, each with the arm that sent it in
  `armGuess`, how that label was decided in `armLabelMethod`, timings and the
  guard outcome), `diagnostics.json` (bounded content-free model diagnostics,
  per-answer `stop`/`length` completion diagnostics, capture-admission
  observations and content-free recall-stage observations), `truncation.json`,
  `accounting.json` (guard attempts for the case plus ledger state before and
  after), `timings.json`, `scoring.json` (the official-style record plus its own
  judge accounting, or a blocked or failed marker).
- `aggregate.json`: `aggregateOfficialScores` output including the `common`
  bucket, per-stage cost and request totals, latency, truncation totals and
  blocked reasons.
- `report.json`: the redacted summary intended for sharing after review. It
  contains no evidence text, no answer text, no key, no header and no raw
  turn; raw evidence stays only in the per-case files. Failed and blocked cases
  stay in every denominator; no case is rerun or substituted.

`truncation.json` reports, from the actual chunking: capture turns and chunks,
those longer than the 800-UTF-16-unit receipt bound and the omitted units; the
Cairn arm's retrieval counts and omissions; the packed receipts whose source
chunk exceeded the bound and their omitted units; and each arm's status.

Each stored answer request is labelled with the arm that sent it, in
`armGuess`, and the label's provenance is recorded beside it in
`armLabelMethod`. The label is positional: the runner walks the run's arms in
their own order and gives each arm that reached the answer stage the next
request in send order, recording `run-arm-order`. It falls back to the evidence
shape, recorded as `evidence-shape-fallback`, whenever the run's answering arms
do not account for exactly the captured requests, which includes a generation
that produced no run record at all. The fallback exists because an empty
evidence array cannot distinguish the no-memory arm from a Cairn arm that
retrieved nothing. A Cairn arm that answered with zero receipts therefore
records an all-zero packed row rather than no row at all, so the run totals
count it as a measured zero.

`diagnostics.json` is a private observation artifact, not part of the ordinary
answer callback, comparison run, aggregate or report. `memoryModel.records`
retains at most 64 existing version/stage/layer/reason events from the adapter
and core allowlists and explicitly counts records dropped beyond that bound.
`answerCompletions.records` has one row per answer attempt (at most the three
fixed arms), labelled after the run by its runner-owned order and arm; each row
records only `finishReason: stop|length` or `availability: unavailable`.
The ordinary answer callback remains exactly `{text,usage}`, and neither
diagnostic changes answer text, score input, request bodies, limits, arm order,
guard accounting or retry policy.

Fresh generated cases also contain `recallStages`, versioned as
`cairn-recall-stage-observation-v1`. Its selection section retains at most the
core's two selection invocations. Each row contains only its ordinal; a closed
`completed|failed|unavailable` status; visible map, item, filed-ref and unfiled
counts; per-map exhaustion booleans; model-returned ref count; and cumulative
unique model-returned ref count. The ranking and final-recall sections retain at
most one invocation. Ranking records input and model-returned ref counts; recall
records the existing per-namespace `mapExhausted` and `fetchExhausted` booleans.
Every section reports its record limit, invocation/drop counts and an overflow
flag. If the bounded invocation counter itself overflows, exact invocation/drop
counts become `null` rather than silently capped.

These are observations at different boundaries. A completed selection or rank
row means its adapter-returned shape supplied observable bounded refs; it is
recorded before core validates membership, uniqueness, freshness, namespace
limits or output budgets. It is not a count of core-accepted, correct or relevant
memories. The existing retrieval `candidateCount` remains the number of memories
returned after final core ranking and authoritative reread, while
`selectedCount` remains the number packed into the Cairn answer request. A false
traversal-exhaustion flag means the bounded traversal did not prove completion;
`budget_exhausted` does not mean experiment money, requests or provider tokens
were exhausted.

The observer reads only own data properties needed for the numeric projection;
it does not invoke request/result getters or `toJSON`. Memory/source identifiers
are compared only transiently to count unique returned refs and are never
retained or hashed. Malformed or inaccessible shapes yield `unavailable` and
`null`, not zero. Closing changes any still-pending retained row to unavailable,
and later settlement cannot mutate the frozen artifact or another case.

Fresh generated cases also contain the separately versioned optional
`captureAdmission` subsection:

```json
{
  "schemaVersion": "cairn-capture-admission-observation-v1",
  "availability": "available",
  "recordLimit": 64,
  "droppedRecords": 0,
  "records": [{
    "batchOrdinal": 0,
    "status": "completed",
    "admittedReferenceCount": 0,
    "suppressedCount": 0,
    "duplicateEvent": false,
    "classificationStatus": "skipped"
  }]
}
```

Each row is the runner's projection of one actual core capture call. `status`
is `completed`, `partial`, `failed` or `unavailable`; the three counts/flags
and `classificationStatus` (`skipped`, `applied` or `failed`) are `null` when
the core response cannot support them. `partial` means admission completed but
classification failed. A failed or thrown capture has no admission counts, and
a malformed response projection is unavailable rather than an observed zero.
At most 64 rows are retained per case and later rows only increment
`droppedRecords`. The subsection is available even when a custom session has no
memory-model diagnostic callback, because it observes the runner's actual core.

`admittedReferenceCount` counts accepted memory references returned by the
core. It is neither a newly created memory count nor proof that every submitted
message was retained: content deduplication can return an existing memory, and
partial extraction can omit messages. Likewise, stage `admitted` does not mean
the reference count is nonzero. A qualified content duplicate attaches only
when its resolved source anchors are identical; a changed source identity is
an intentional qualification conflict, not a missing observation.

For model and answer diagnostics, `availability: available` means the real
benchmark session installed the observation hook; an empty record list does not
prove that no model failure occurred or that every callback was delivered.
Legacy/custom sessions report those sections as `unavailable`. Old run
directories and blocked cases may have no diagnostic file or no
`captureAdmission` or `recallStages` subsection at all, which is also unavailable
rather than an observed zero. Collection is scoped to the asynchronous case
invocation and to its session. Work created in an older case remains bound to
that closed collector, so a late model event, model result, recall result or
capture settlement is ignored rather than attached to the next case. Closing
and snapshotting do not claim completeness.

## Legacy/default resume

Running again on the same directory with the same pilot and the same case
selection re-reads finished cases from disk, never re-sends a request for
them, turns a case left `generating` or `scoring` into `blocked: interrupted`,
and refuses to overwrite any existing artifact (`output_exists`). A completed
directory returns its existing `report.json` unchanged. A non-empty directory
without a checkpoint is refused (`output_not_empty`). A resume must also use
the configuration the directory recorded: when the pilot identity, the case
list, `limits`, the judge timeout, `caps` (absent versus present, compared as
canonical JSON) or the stage policy differ from `manifest.json` and
`checkpoint.json`, the run is refused with `run_directory_mismatch` before
any request is sent.

For resume, answer-template identity is also checked across the manifest,
checkpoint, every selected case artifact, aggregate and report before any
write, callback or reservation. Missing identity denotes only legacy v1;
unknown, mixed, or missing-v2 identity fails closed.

For a fresh generated case, the runner writes `diagnostics.json` only after the
existing generation, request, truncation, accounting and timing companions.
A diagnostic-file collision therefore raises the existing `output_exists`
artifact-delivery refusal after accounting is durable. Removing that colliding
file and resuming does not repeat generation; because diagnostic files remain
optional for old-run compatibility, the resumed case has unavailable
diagnostics rather than a reconstructed or fabricated record.

## Batches and merge

The pilot runs as separate batches, each in its own directory under its own
cap, and the paired report is assembled afterwards without any paid call:

1. Batch 1 (for example the two-case smoke batch) runs into one directory
   with `--batch-cap-micro-usd`/`--batch-request-cap` set to that batch's
   reservation cap. Its `report.json` is reviewed on its own.
2. Batch 2 runs the remaining cases into a **new** directory with a cap equal
   to the remaining allowance. Resuming batch 1's directory with a different
   cap or case list is refused, so a second batch is always a second directory.
3. `--merge dirA,dirB --output merged` reads the completed directories,
   checks that they share one answer-template version, pilot manifest digest, stage policy, models,
   limits, judge timeout and receipt bound (`merge_mismatch` otherwise) and
   that their case lists are disjoint (`merge_overlap`), re-reads every
   case's generation and scoring wrappers, recomputes `aggregateOfficialScores` over
   the union roster (including the common bucket), sums cost, request,
   latency and truncation totals, and writes one `report.json` (0600) into the
   new empty 0700 output directory. The merged report has the runner's
   redacted shape plus `kind: 'merged'`, `caps: null` at the top level and a
   `sources` list (directory basename only, generated-at, case list, caps and
   operator fields per source). A source missing any of `manifest.json`,
   `checkpoint.json`, `aggregate.json` or `report.json` is `run_incomplete`.

Legacy/default recovery note: if the process dies between writing `aggregate.json` and
`report.json`, resuming fails with `aggregate_without_report`, which is
distinct from the `output_exists` a genuine overwrite attempt raises.
`aggregate.json` is derived entirely from the per-case files, so the operator
may remove that one file and resume; every case is then re-read from its
checkpointed artifacts and nothing is re-sent. A case whose `generation.json`
says `completed` or `failed` but whose `accounting.json`,
`answer-requests.json` or `truncation.json` is missing was interrupted
mid-write; the resume refuses it with `invalid_checkpoint` rather than
reporting a cost it cannot substantiate. A failed generation is the one that
most needs this, because ingestion and answer calls can have been paid for
before the failure. Only a blocked case legitimately has its generation record
alone.

That recovery/resume behavior is legacy/default behavior only. A
`case-deadline-v1` run is never resumable, even if an operator edits or removes
its checkpoint or report. Its claim file is authoritative and is not repaired,
refunded or reset. The bounded identity (policy version, execution and
authorization IDs, and full-capability digest) is validated through run, case,
accounting, diagnostics, scoring and merge artifacts. Offline merge may combine
disjoint executions only when their effective policy versions match; it keeps
each source identity and places only the effective policy version at merged top
level.

## Limitations disclosed with every result

Cairn evidence is bounded to the 800-unit receipt prefix of each capture chunk
(`truncation.json` counts what was cut); paired blocking drops cases whose full
history exceeds the policy window; the two evidence-bearing arms use different
JSON schemas; arm order is fixed cairn → full-history → no-memory and an
answer timeout blocks the later arms; Cairn evidence is normalized and
redacted while full history is raw; Cairn's effective budget is further capped
by `recallLimit` and core recall budgets; the no-memory arm trivially passes
abstention cases; counted context and usage are local estimates or
provider-reported usage, not invoices; `overall.coverage` is the resolved
fraction of the fixed roster, not retrieval coverage. Seven selected cases are
a plumbing pilot, not a population estimate.

## Verification

`npm run test:live-evidence-offline` on Node 22.16 and 24 covers the session,
the runner, the merge, the CLI and the common bucket with fake HTTP only (both
adapters installed, no network, no environment key). `npm run test:longmemeval`
covers the additive `common` bucket of `aggregateOfficialScores`.
