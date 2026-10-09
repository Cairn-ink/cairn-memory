# Source-diverse linked evidence: paired algorithm comparison

Status: prospective contract; source-role projection passed independent
Standards/Spec review and is integrated. No new model run or result yet.
Planning base: `05c6227265925592467737cee98bb0223afc6729` (#385 results).
Branch: `feat/evidence-bundle-qa24`. Integrated implementation base:
`00bf59f44a978831aae2d706cb7a0c98af56fe53` (results #385 plus the exact reviewed
source-role change from #386). Preserve both preceding scopes.

## Question and decision

Does the combined source-diverse selection plus bounded source-linked ranking
candidate improve requested-answer quality over ordinary selection/ranking,
when both arms preserve the same recorded source-role information?

The previous source-diverse trial improved 20 to 23 correct answers out of 24,
but failed its unchanged advancement gate because one safety judgment was
unknown. That report and all judgments remain sealed. Offline diagnosis found
role projection loss and selected bridge evidence discarded by ranking. Existing
source-linked assembly restores two bridges on that recorded trace. None of
these offline observations demonstrates a new semantic answer result.

This comparison tests a **combined algorithm candidate**, not an attribution of
all effects to ranking alone. The prior source-diverse-only experiment remains
separate. Role-aware evidence is a common representation in both new arms, not
a treatment-only prompt advantage. The ordinary answer instruction stays fixed.

## Acceptance B1–B12

- B1: Use all 24 existing authored development cases, six families and the
  already frozen requested-answer v2 rubric/calibration/safety criteria. These
  are previously seen development data, not fresh/holdout or LongMemEval. Do not
  change questions, sources, gold, examples, model or verdict thresholds.
- B2: Add an explicit `source-diverse-linked-v1` runner treatment and separately
  versioned report/launch/coverage/judgment identities. Preserve old full-label
  and source-diverse paths, manifests and public entrypoint behavior. Existing
  reports cannot be reinterpreted as this trial.
- B3: Capture each case once through normal extraction/classification. Both arms
  cold-open the same captured database, with identical model, initial state,
  token/resource ceilings, answer instruction and recorded-role projection.
  Alternate first arm by ordinal; retain all failed/unrun slots and original
  state hashes. No recapture, retry, question replacement or old-run continuation.
- B4: Baseline uses ordinary select/rank. Treatment composes the already reviewed
  source-diverse selection and source-linked rank wrappers, with their existing
  limits and authoritative core freshness checks. No new heuristic, prompt,
  semantic edge type, all-source backfill, larger top-k or extra provider call.
- B5: Both use `verifiedRoleEvidence` and unchanged `packMixedAnswer`; exact
  validated roles and receipt excerpts, not summaries or inferred authors,
  reach actual serialized answer requests. Preserve the metadata cost and
  whole-unit omissions. No role metadata becomes a real chat instruction.
- B6: Record raw select/rank requests and responses separately from effective
  core-bound selection and ranking. Treatment diagnostics identify added and
  displaced refs. Reconstruct assembly from actual visible inputs and raw
  responses; no evaluator/gold reaches model execution. Old trace shapes stay
  compatible; new reports never silently substitute raw for effective refs.
- B7: Independently verify retained/reachable/selected/recalled/actually-packed
  coverage over the same 42 source-bound anchors. Validate role-aware units
  against authoritative receipts and actual packed requests. Recalled presence,
  selected novelty and answer correctness remain distinct metrics.
- B8: Blind nonauthor judges use the same requested-answer rules, full histories
  for correctness and actual packed evidence for support. Keep disagreements
  unknown, count every slot, separate claim counts and six-family outcomes.
  The unchanged advancement gate is net at least +3 correct answers against
  this new paired baseline, positive packed-anchor gain, no increased known
  unsupported/stale question counts, no new severe failure, no safety unknown
  and all original resource ceilings. Never compare correctness across rubrics.
- B9: Preserve the original US$400 campaign, US$30 protection, US$10 per-run
  conservative ceiling and 1,968-request ceiling. No refunds/resets, continuation
  of a closed run, credential-scope change or transport/accounting modification.
  Fresh clean reviewed runtime/current settled affordable ledger preflight,
  prospectively retained manifest and independent preflight review precede a
  one-shot paid run. Bind runtime, both wrappers, projection, source/rubric/
  protocol, resource ceilings and Node binary. No launch is authorized merely
  by finishing offline code.
- B10: Actual-core/fake-HTTP integrated tests must prove both common role-aware
  paths, effective selection/rank traces, full chain restoration and unchanged
  raw provider requests/call counts. Include empty/irrelevant seed, capacity,
  corrected/forgotten evidence, failure retention, mismatched identities and
  all old-profile compatibility controls. A deliberate ordinary-chain negative
  must exit 1 while removing only its owned scratch. No fake model QA gains.
- B11: Worker owns runner, launch, requested-answer evaluator plumbing, coverage,
  narrowly scoped tests, algorithm README, a narrow limitations note and this plan's implementation section;
  exact file assignment follows integrated-base freeze. No core, adapter, wrapper
  algorithm, source-role verifier, transport, corpus or rubric edits. Primary
  owns combined acceptance, manifest/ledger audit, independent review, live run
  and score audit. Separate nonauthor Standards/Spec reviewers inspect final SHA.
- B12: Run supported Node 22.16/24.15 focused/algorithm/longmemeval and generic
  contributor gates, demos and isolated plugin validation with actual exits;
  audit files by two independent routes. Freeze, double-review, PR and verify
  latest-head CI/mergeability before live execution. No merge, package release,
  deployment, historical cleanup, default promotion or competitive-parity claim.

## Assignment and evidence

Implementation: one bounded GPT-6.1 Sol/high worker, starting at the integrated
base above. Allowed files: `evaluation/algorithm-development/{runner,launch,
requested-answer,coverage}.mjs`, that directory's `README.md`, new
`test/evidence-bundle.test.mjs` and `test/evidence-bundle-runner.test.mjs`,
this plan's implementation/evidence sections and a scoped note in
`docs/limitations.md`. Existing tests are read-only compatibility controls.
The primary owns the contract, integration, final acceptance and paid operation;
two nonauthor reviewers independently inspect the final fixed diff. No measured
worker elapsed time or cost is available yet.

## Implementation

Worker `role_projection61` implements the bounded packet on the fixed
`00bf59f44a978831aae2d706cb7a0c98af56fe53` base, assigned GPT-6.1 Sol/high.
`runEvidenceBundleComparison` selects the explicit combined treatment; the
old runner entrypoint also accepts its named treatment without changing its
default or the two old report shapes. Both new arms use `verifiedRoleEvidence`
and the unchanged packer. Only treatment ranking composes the reviewed linked
wrapper with reviewed source-diverse selection. Capture, classification,
provider calls, core freshness, six-unit limit and transport remain unchanged.

The new report/launch/coverage/judgment identities are respectively
`source-diverse-linked-requested-answer-{comparison,launch,coverage,judgments}-v1`.
New prepare/launch, freeze/blind/aggregation and coverage entrypoints explicitly
select those identities. `effectiveRanks` records actual core-bound requests,
returned outputs or failures separately from raw `modelCalls`. Successful
ranking reconstructs the pure existing compiler and records its diagnostics
and added/displaced refs; pre-delegation failure never invents a raw call.
Existing effective-selection semantics remain unchanged.

Coverage requires real effective traces, reconstructs both compilers, binds
rank candidates and final role evidence to authoritative captured receipts,
checks effective rank order against recalled order and compares the complete
packed request with real-tokenizer packing. The existing linked compiler also
validates baseline raw rank refs against the visible candidates; its assembled
links are discarded for baseline, whose effective output remains raw. Missing successful traces reject;
unverified packed evidence receives no credit. The new judging protocol changes
only its version. `originalHashes` retains the exact requested-v2 freeze; new
protocol/freeze hashes explicitly bind it, excluding the old freeze value from
the new hash fields. Blind packet calibration and advancement criteria do not
change. The launcher binds both wrappers, role verifier/packer, tests and plan
in addition to the existing source/protocol/runtime/Node/resource identity.

## Worker evidence

Before implementation, the new actual-core/fake-HTTP profile regression exited
1 because the old runner rejected the new treatment. The original ordinary
chain negative then ran all 24/48 slots and exited 1: only 1 of the 3 chain
sources reached the actual packed request. Its `finally` removed its owned
synthetic workspace. This failure is deliberately retained as a control, not a
quality result or an altered historical answer.

The initial crowded fixture also failed its overstrong full-chain expectation
under the unchanged four-addition selector budget: the observed rank input
omitted the signed-agreement source and linked assembly added only one bridge.
The capacity fixture initially hit the same upstream competition. These were
fixture assumptions, not evidence of a compiler defect. The positive chain
fixture now fits the existing novelty budget; a separate crowded control
retains all 6 distinct sources, selects 5 with exactly 4 additions and proves
the missing source cannot be manufactured by later ranking. It does not promise
which equally novel source survives. No budget or wrapper algorithm changed.

Primary initially inferred that empty capture would skip selection. Actual-core
fake-HTTP integration refuted that assumption: an empty map still reaches one
successful selector call returning empty refs, with no public-get or rank call
and empty answer evidence. The evaluator fixture now follows those observed
semantics; completed reports with fabricated/missing selection traces reject.
Failed pre-delegation traces remain legal and retain all unresolved slots.

Self-audit reproduced an evaluator visibility gap with a forged baseline trace:
a captured but rank-invisible source substituted consistently into raw/effective
rank, recall and packed evidence incorrectly passed coverage. The negative
regression exited 1 before the fix. Reusing the existing compiler's rank input
and raw-ref validation closes the gap without assembling treatment links into
baseline or changing production core behavior.

After that fix, the new evaluator/launch test file passed 7 tests, 0 skipped,
actual exit 0 on both Node 22.16.0 and 24.15.0, including positive coverage,
forged visibility, zero-memory, identity and one-shot controls. The integrated
positive chain/capacity subset previously passed 2 tests, 0 skipped, actual
exit 0. Earlier complete focused invocations on both versions ended with 19
passed, 1 failed, 0 skipped, actual exit 1: they had loaded the initial incorrect
zero-memory expectation before its correction. Their logs are retained, not
reported as final gates. Worker full algorithm runs passed the corrected actual
zero-memory case on both versions, then were deliberately interrupted with
actual exit 130 after the visibility fix to avoid duplicate heavy final runs.
The primary owns final focused/full algorithm and broader contributor gates;
those gates, committed-diff reviews and latest-head CI remain pending at this
checkpoint. All worker runs use sanitized
`env -i` with supported Node PATH/HOME, locked isolated OpenAI dependencies,
synthetic temporary ledgers and fake HTTP; no provider key, operational ledger,
paid request or original evaluation artifact is used. Worker has not committed
or pushed the branch. Two independent inventories (diff plus untracked paths;
porcelain status) agree on 10 files: the 9 assigned worker files and the
primary-owned reliability plan. `git diff --check` exited 0.

## Primary final acceptance before candidate freeze

The primary directly inspected the combined runtime, evaluator, tests and
documentation, then reran the final frozen implementation on Node 22.16.0 and
24.15.0. Each command below returned actual exit 0 on both versions:

- `node tools/testing/run.mjs evaluation/algorithm-development/test/evidence-bundle.test.mjs`: 7 passed, 0 skipped.
- `npm run test:algorithm-development`: 73 passed, 0 skipped.
- `npm run test:longmemeval`: 210 passed, 0 skipped.
- `npm test`: 653 passed, 0 skipped.
- `node tools/testing/run.mjs --script evaluation/longmemeval/demo.mjs`.
- `npm run demo:longmemeval-comparison` and `npm run demo:longmemeval-public`.
- `npm run validate` and `npm run validate --prefix tools/plugin-validation`.

The supervisor compared SHA-256 hashes of all four changed runtime/evaluator
modules and both new test files before and after those gates; all six remained
identical on both versions. The separate contract audit preserved the original
24 cases, 42 anchors, requested-answer rubric and safety calibration, and
confirmed that only the judging-protocol version changed. The two final gate
supervisors themselves exited 0. `git diff --check` also exited 0.

The earlier primary gate invocations were deliberately terminated after the
baseline visibility finding; their owned child runners exited 143 and their
supervisors exited 1. They are retained as interrupted evidence, not counted as
passes. Only the complete final runs above establish the pre-freeze gate.
No provider key or operational ledger was used by these tests. Clean-candidate
launcher smoke, fixed-diff independent reviews, latest-head CI, prospective
manifest review and any real-model execution remain subsequent gates.

## Following this checkpoint

If the candidate clears the fixed development gate, freeze an unseen/broader
evaluation under a documented resource budget, including a fair native Mem0
comparison. A 24-case development gain is not the official score or evidence
that long-history/installed-host reliability has been achieved. If it fails,
keep all failures and diagnose the first observed data-flow boundary before
choosing another bounded algorithm change. Do not soften this trial's gate.
