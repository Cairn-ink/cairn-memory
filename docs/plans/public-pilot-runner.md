# Public pilot runner and paired report (P2)

Base: `94813207af6212e7fc1477ad5e1aa2d9483781c7` (P1 round-3 candidate on
branch feat/benchmark-live-transport, itself on #184 `53eb631`); the branch
was developed on the P1 round-1 head `1f0dbdd` and rebased onto the round-3
head before review. Handoff: issue #180,
comment of 2026-09-18T11:00:32Z, stage P2. Scope: new
`evaluation/live/public-pilot.mjs`, `evaluation/live/public-pilot-cli.mjs`,
`evaluation/live/public-pilot-merge.mjs`, their tests under
`evaluation/live/test/`, one additive export in `evaluation/live/pilot.mjs`
(private evaluator accessor), an additive common bucket in
`evaluation/longmemeval/official-scoring.mjs` with tests, docs
(`docs/public-pilot-runner.md`, this plan, changelog, contributor gate). No
core change, no legacy comparator/scorer/pilot behaviour change, no default
network or key discovery.

## Acceptance PP1–PP10

- **PP1 Session.** `createBenchmarkLiveSession({ledger, apiKey, fetchImpl,
  benchmarkExtension})` builds the P1 benchmark guard, the real OpenAI adapter
  on `guard.cairnFetch`, and stateless `answer({request, signal})` /
  `judge({request, signal})` callbacks that send the caller's request with
  `store:false` and `stream:false` added explicitly (documented deviation from
  upstream kwargs), through `answerFetch`/`judgeFetch`, one attempt each, and
  return `{text, usage}` / `{text}` from `choices[0].message.content`. The key
  is used only for the Authorization header and is never stored, logged or
  returned. Guard refusals propagate unchanged. The stage policy numbers live
  in one exported `benchmarkStagePolicy()`.
- **PP2 Runner.** `runPublicPilot({pilot, session, directory, limits?,
  judgeTimeoutMs?, referenceRenderings?, caps?, manifest?, onCase?, caseIds?})`
  consumes the digest-checked v2 pilot from `loadPreparedPilot`, creates one
  private case directory and one fresh SQLite store per case (0700/0600), runs
  `runPublicComparison` with the #183 arm order and formats, then, only after
  every generation checkpoint is durable, scores each generated case with
  `scorePublicComparison` (binding the #184 rendering token when provided).
  Serial cases, serial arms, one attempt per call. `caseIds` selects a subset
  of the roster in roster order; `manifest` carries operator provenance fields
  verbatim into `manifest.json` and `report.json`.
- **PP3 Private artifacts.** Per case, mode 0600 under the run directory:
  `generation.json` (frozen run record), `answer-requests.json` (exact request
  bodies sent per arm in send order, including packed evidence, each labelled
  positionally from the run's arm order with the method recorded as
  `armLabelMethod`), `truncation.json`,
  `accounting.json` (guard attempts for the case plus ledger state before and
  after), `timings.json`, `scoring.json`; run-level `manifest.json` (version
  hashes, models, stage policy, limits, caps, roster, operator fields),
  `checkpoint.json`, `aggregate.json` and `report.json`. No Authorization
  header, key, answer text, evidence text or raw corpus turn appears in
  `report.json`; raw evidence stays only in per-case files. The prepared
  directory is never written.
- **PP4 Truncation and evidence accounting.** `truncation.json` reports, from
  the actual `planLongMemEvalCase` chunking: capture turn and chunk counts,
  those longer than the 800-unit receipt bound, omitted UTF-16 units; for the
  Cairn arm the retrieval counts and omissions from the run diagnostics, and
  for the packed evidence (from the stored answer request) the receipts whose
  source chunk exceeded the bound and their omitted units; and each arm's
  status, so capture truncation, retrieval, packing and answer failure are
  separately visible. Each captured request is labelled positionally from the
  run's own arm order (each arm that reached the answer stage takes the next
  request in send order, recorded as `armLabelMethod: 'run-arm-order'`). The
  evidence shape labels them instead whenever the run's answering arms do not
  account for exactly the captured requests, including when the comparison
  produced no arm record at all, because an empty evidence array is ambiguous
  between the no-memory arm and a Cairn arm that retrieved nothing. A Cairn arm
  that answered with no receipts records an all-zero packed row (`receipts` 0)
  rather than a null row, so the run-level truncation totals include the case
  as a measured zero.
- **PP5 Common bucket.** `aggregateOfficialScores` additionally reports
  `common`: the number of roster cases in which all three arms resolved
  (`commonN`), per-arm `correct`/`incorrect`/`accuracy` over those cases, the
  same by question type, and an abstention overlay; accuracy is `null` (never
  0) when `commonN` is 0. Existing per-arm buckets are unchanged.
- **PP6 Caps and halt.** Before each case the runner projects the case's
  reservation `(batches × 4 + 6) × 5,000 + 3 × answer + 3 × judge` µUSD and
  `batches × 4 + 12` requests from the real ingestion plan, and checks this
  run's own reservations and request count (measured from the ledger baseline
  recorded at checkpoint creation) against optional `caps` (`reservedMicroUsd`,
  `requests`) and the ledger's remaining allowance. A case that would exceed
  the caps is not started and is recorded `blocked: cap_exhausted_projected`;
  one the ledger cannot cover is `blocked: ledger_allowance_insufficient`.
  Neither sends a request. Before scoring a case, the three judge reservations
  are checked the same way. If the guard halts (`isHalted()`), the current case
  is recorded with the stage reached and every remaining generation or scoring
  step is `blocked: paid_work_halted`; no further paid call is made and the
  halt is checkpointed.
- **PP7 Checkpoint and no replay.** `checkpoint.json` records the ledger
  baseline, the case list, each case's stage (`pending`, `generating`,
  `generated`, `scoring`, `scored`, `blocked` with reason and phase) and the
  attempt ids seen; it is rewritten atomically after every durable step.
  Resuming on the same directory re-reads finished cases from disk, never
  re-sends for a case left `generating`/`scoring` (it becomes
  `blocked: interrupted`), treats every `blocked` case as terminal, never
  overwrites an existing artifact (`output_exists`), returns the existing
  `report.json` unchanged for a completed directory, and refuses
  (`run_directory_mismatch`) when the pilot identity, case list, limits,
  judge timeout, caps or stage policy differ from what `manifest.json` and
  `checkpoint.json` recorded. A non-empty directory without a checkpoint is
  refused (`output_not_empty`). There is no failed-case rerun or substitution.
- **PP8 Report.** `aggregate.json`/`report.json` contain: per arm correct/N
  over resolved, fixed N, unresolved counts by stage and reason, blocked
  reasons counted once per case (the generation reason when generation was
  blocked or failed, otherwise the scoring reason), per-type figures, the
  abstention overlay, the common bucket, input tokens per arm, latency per
  stage, reserved and known actual cost per stage from `accounting.json`, the
  receipt bound label, the operator's exclusion registry, and the F3–F8
  limitations text. No "official benchmark score" wording.
- **PP9 Offline acceptance tests** under `evaluation/live/test/` (Node 22.16
  and 24, fake HTTP only): end-to-end scripted provider through the real
  runner, real P1 guard, real OpenAI adapter and real core on prepared v2
  synthetic data; a truncation example (long turn) with nonzero counts;
  asymmetric failure → common bucket excludes the case; oversized full history
  → all arms blocked with zero paid calls; numeric reference: unresolved without
  the #184 sidecar, `verified-python-rendered` with it; interrupted checkpoint
  → resume skips and never re-sends; resume with different caps or limits →
  refused; halt after an unknown outcome; artifact permissions and redaction;
  stored answer request equals the body the fake upstream received; merge
  (PP10) of two disjoint runs equals the sums, overlap and mismatch refused.
- **PP10 Merge across batches.** `mergePublicPilotRuns({directories, output})`
  in `evaluation/live/public-pilot-merge.mjs` builds one paired report from
  several completed run directories with no paid call and no key: it requires
  every source to hold `manifest.json`, `checkpoint.json`, `aggregate.json`
  and `report.json` (`run_incomplete` otherwise), the same pilot manifest
  digest, stage policy, models, limits, judge timeout and receipt bound
  (`merge_mismatch` otherwise) and pairwise disjoint case lists
  (`merge_overlap` otherwise); it re-reads each completed case's
  `scoring.json` record, recomputes `aggregateOfficialScores` over the union
  roster, sums cost, request, latency and truncation totals, and writes
  `report.json` (0600) into a new empty 0700 output directory with the same
  redacted shape plus `sources` (source directory basename, generated-at, case
  list, caps and operator fields per source). The CLI exposes it as
  `--merge <dir,dir,...> --output <dir>` with no other flags.
