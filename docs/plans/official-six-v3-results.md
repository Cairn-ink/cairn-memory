# Retain the halted fresh official-six v3 observation

Base: `93e52b7afb298d728cb4831c34bbda6dcf750704`.
Branch: `docs/official-six-v3-results`, in its isolated sibling worktree.
Status: reporting-only delivery; no paid run, settlement or runtime change.

## Acceptance

- R1: Publish a small source-free aggregate artifact and technical evidence page
  for the terminal six-case run on runtime
  `26a7221ec82134306ef2dfeffe11ce46fab3e6be`. Preserve all six scheduled cases,
  twelve arms and their actual statuses: one completed, five failed, six blocked.
  Three Cairn attempts failed ingestion after 10/8/3 completed batches; three
  remaining Cairn cases were not executed. Planned batch counts are
  47/43/51/52/48/54. Mem0's first case completed an answer; the second failed
  with known-priced `invalid_payload`; the third failed with
  `scope_execution_failed` and pending settlement. The remaining three blocked.
- R2: Scoring never ran. There is no `scoring.json`, new correctness score,
  resolved judgment or retrospectively generated scorer output. Do not equate
  unjudged, blocked or mechanical failure with an incorrect answer, or compute
  leaderboard accuracy. The terminal halt is `scope_execution_failed` during
  generation; operator status is `halted`, reason `generation_halted`. Both
  mechanical and paired-scoreability gates failed. No evaluator content was
  needed after the halt; no oracle access or retrospective grading belongs here.
- R3: Cairn finite diagnostics are `qualification_label_canonicality` on the
  first two executed cases and `qualification_slot_mapping` /
  `adapter_output_invalid` on the third. These locate validation boundaries,
  not an exact unretained model response or root-cause proof. Prior prompt and
  repeated-slot fixes and the short 13/24 semantic probe do not establish that
  these failures are resolved. Do not equate them with the prior duplicate-slot
  defect. Diagnosis remains ongoing.
- R4: Retain the original accounting checkpoint and incomplete settlement:
  510 new requests, 2,730,879 micro-USD reservations; final 19,278 requests /
  123,795,493 micro-USD reserved; remaining 76,204,507 under 200,000,000.
  There are 509 settled requests (508 succeeded / one failed), 403 known costs
  totaling 710,086, 106 settled unknown count costs, and one pending embedding
  reserved at 10. Observed cost is 10, input 470, output zero; durable outcome
  and cost are null. Count unknown costs as 107 including pending; reservation
  is not an invoice. The prefix 18,768 / 121,064,614 matches pinned history;
  the exact new tail and all caps were independently checked. State `open`
  does not mean permission to resume while pending. No repair, refund or reset.
- R5: Omit question, source, answer and reference text; provider raw bodies and
  headers; IDs, namespaces, credentials, private paths and native database
  contents. Retain only public versions/hashes, indexed case outcomes, finite
  reasons, counts and integer usage aggregates. Tests check exact closed
  allowlists, arithmetic, fixed denominators and no fabricated score. Primary
  verifies every published scalar against private raw reports. A source hash
  may identify the public dataset, not its contents.
- R6: Evidence, limitations and ROADMAP point to the current failed gate without
  rewriting old cohorts or predicting candidate improvement. Next steps are
  offline settlement diagnosis preserving the pending row; the independent
  opt-in indexed-evidence core slice planned before the terminal observation
  as an experiment, not an adopted remedy; and separately reviewed future
  protocol, resources and cases only after accounting is safe. No paid dispatch,
  replay, replacement, package publication, deployment or old-run resumption.

## Ownership and verification

Primary owns acceptance, raw-to-public equivalence, integration and delivery.
One GPT-6 Sol/high implementation worker owns the report, artifact and tests;
two non-author reviewers check Standards and Spec on the exact committed diff.
Worker runs the focused integrity test and generic, JSON and strict-plugin
gates on Node 22.16 and 24.15; primary reruns key paths. Latest-head remote CI
must pass before any separately authorized merge.

Allowed files: this plan; `evaluation/official-six-v3/results.json`; a new report
integrity test in `evaluation/architecture/test/`;
`docs/evidence/qualification-official-v3.md`; narrow changes to
`docs/limitations.md` and `ROADMAP.md`. No other file or runtime changes.
Read-only private inputs are terminal generation, accounting, status and
preflight reports only, with aggregate-only output. The worker must not access
evaluator, source, key or operational ledger files. Do not infer unknown costs
or causes.

## Checkpoints and caller trace

| Requirement / entrypoint | Owner and evidence | Remaining check |
| --- | --- | --- |
| R1–R5 aggregate artifact | Implementation worker: terminal-report projection confirms fixed outcomes, batch counts, accounting totals and pending nulls; first two diagnostic lists contain canonicality only | Primary raw-to-public scalar verification and independent review |
| R1–R6 evidence page | Implementation worker: linked artifact plus frozen method supplied and verified by primary; no scoring, accuracy or root-cause claim | Primary review of prose equivalence |
| R6 limitations / ROADMAP | Implementation worker: append current failed gate and preserve earlier cohorts; existing README links to these entrypoints | Independent Standards and Spec review |
| Integrity-test discovery | Implementation worker: root `npm test` discovers `evaluation/architecture/test/*.test.mjs`; no runtime imports, UI/browser replay or old URL/text caller is changed | Generic and focused tests on both runtimes |
| Public link callers | Implementation worker: limitations and ROADMAP link to the new evidence page; evidence links to results and earlier retained reports; existing README entrypoints remain valid | Link existence check and primary acceptance |

Implementation milestone: all six allowed files now retain R1–R6. Closed-shape
tests inject forbidden fields at every object boundary and reject fabricated
scores, reordered/truncated rosters and falsely settled pending observations.
No browser/UI, provider transport, scorer or operational script entrypoint is
changed. There is no scripts README in this repository; only documented generic
validation scripts and the new offline integrity test are run.

Worker verification completed on the implementation content before its scoped
candidate commit, based on the recorded base SHA. On both Node 22.16.0 and
24.15.0, these commands passed:

- `node --test evaluation/architecture/test/official-six-v3-report-integrity.test.mjs`
  (two tests, zero failures).
- `npm test` (generic plugin and architecture tests).
- `npm run validate` (JSON and consistent public versions).
- `npm run validate --prefix tools/plugin-validation` (marketplace validation
  and strict plugin validation, using the locked isolated tooling).

Evidence-page relative links resolve and `git diff --check` passes. Public-only
`npm ci --prefix tools/plugin-validation` installed the locked maintainer tools;
no provider call or operational ledger access was made. Primary must inspect
the committed artifact against terminal private inputs, rerun key paths and
obtain both independent review axes before delivery. Candidate SHA is recorded
in the delivery handoff rather than embedded into its own commit.

Worker elapsed time and token/cost measurements are unavailable. No correction
round or primary takeover occurred; primary supplied verified frozen method
facts and confirmed the finite diagnostic lists. Remaining work belongs to
primary acceptance and independent review, then the authorized delivery path.
