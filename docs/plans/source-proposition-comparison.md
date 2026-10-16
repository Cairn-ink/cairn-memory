# Source to proposition comparison: frozen acceptance contract

## Question and boundary

Does a single generation that extracts propositions together with the existing
seven qualification fields improve faithful persistence over the current real
extraction followed by qualification, under the same pinned model, exact source
evidence and a 1,024 output-token bound per generation? This is a diagnostic
comparison, not an additional refinement stage or a production default change.
The baseline uses two generations per source; the candidate uses one. Candidate
role/claimant sidecars are exploratory only. Neither arm receives credit for
fields outside the identical persisted shape: content, kind, confidence,
receipts and the seven existing qualification fields. The baseline need not
produce the sidecars.

## Observable acceptance criteria (declared before fixture authorship)

1. Freeze exactly 24 newly authored ordinary synthetic conversations: six pure
   observations, six observations mixed with a choice, four adopted choices,
   four considered choices and four rejected choices. Use opaque source IDs,
   1–3 user/assistant messages each, and 1–800 well-formed UTF-16 code units per
   message. At least four cases have a message longer than 200 units and at
   least four have multiple messages. Length comes from meaningful context,
   never padding. Include diverse everyday domains, uncertainty, a conditional
   adoption, a negated option, a reported chooser, an unadopted recommendation,
   and a measured quantity distinguished from a chosen limit.
2. The source fixture has only version and cases; each case has only id and
   messages; each message has only role and content. Keep expectations, groups,
   answers, hints, model metadata and evaluator language in a separate rubric.
   Predeclare approximately 30–36 semantic required claims with material
   conditions, attribution and permissible tuple polarity interpretations.
3. Score source cases, not a fixed card count or exact wording. A source passes
   only when all required claims are covered, every material emitted claim is
   supported, and the actual tuple selected for each claim correctly expresses
   its commitment, conditions and attribution. A decision elsewhere in the
   source does not make an observation's tuple a decision. Accept faithful
   paraphrases and different card segmentation, including several claims in
   one card or a claim represented across cards, when their selected tuples
   are jointly unambiguous. Omission of an unrequired incidental detail is not
   itself a failure; unsupported material additions are.
4. Keep failures, empty outputs, malformed outputs and overflows in N=24.
   Inspect every baseline-correct required decision for loss under the
   candidate, even when the baseline's whole source failed for another claim.
   The semantic gate requires net source gains of at least three, zero lost
   correct decisions, and zero new severe unsupported, stale or authorization
   claims. Report each gate separately, including inconclusive judgments.
5. Predeclare a same-family masked independent two-rater procedure. Each rater
   sees randomized arm labels, exact evidence, the frozen rubric and only the
   common persisted projection. Preserve both raw judgments, disagreements and
   adjudication without rewriting earlier ratings. This is independent model
   rating, not human calibration. Report agreement and unresolved judgments;
   adjudication cannot erase source failures or silently change the rubric.
6. Give both arms identical source evidence. Use the first attempt exactly
   once; no retries, replacement sources, substitutions or hidden failures.
   Record the pinned model/provider and generation settings before running.
   Record all HTTP requests, token usage and reported invoice amounts for all
   three expected generations per source (two baseline, one candidate); never
   guess spend or treat a missing usage field as zero. Record failed attempts
   and any additional rating/adjudication resources separately. Execution and
   any new provider/budget authority belong to the primary operator; fixture
   preparation does not authorize calls or access to keys, profiles or ledgers.
7. Keep mechanical cold-gate results separate from semantic gains. Strict
   offline tests cover shapes, exact groups/denominator, claim maps, source
   oracle exclusion, UTF-16 bounds, mutation rejection and non-BMP handling.
   They import neither candidate code nor SQLite. Run through the owned runner
   on Node 22.16 and 24.15 and report actual process exit codes. Cross-check the
   four-file delivery inventory by two independent mechanical routes and print
   its count. Freeze source/rubric hashes before future outputs are observed.

## Implementation and evidence ownership

The fixture worker owns only the two source/rubric JSON files, their standalone
offline test, and this plan. It does not inspect historical fixture contents,
candidate prompts/implementation or future model outputs, and cannot alter the
cohort after freeze. The primary owns candidate integration, executable scoring,
resource accounting, independent review, final verification, commits and PR
delivery. No user-flow entrypoint, browser replay or product caller changes in
this packet; those checks remain the primary's responsibility if its wider
implementation affects them.

Requested and actual fixture author: GPT-6.1-Sol, high reasoning. Fixed base:
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`. Fixture branch:
`experiment/source-proposition-cohort`. No commit or push by the fixture worker.

## Frozen semantic judging procedure

Before any generations, retain source/rubric SHA-256 hashes, the exact pinned
model identifier, generation settings and the randomization seed. Prepare each
arm from the same source bytes; evaluator rubric content must not enter either
generation request. Expected extraction/qualification work is 72 generations:
24 baseline extractions, 24 baseline qualifications and 24 candidate joint
generations, each bounded to 1,024 output tokens. Actual attempted generations
and HTTP requests remain authoritative when early failures prevent a later
baseline stage; record the missing stage and reason rather than invent a call.
Execute independent arms in a fixed alternating order by zero-based source
index: baseline first for even indices, candidate first for odd indices. Failure
of either arm does not prevent the other arm's first attempt; both stay in N=24.
The source version is `source-proposition-v1`; the evaluator-only rubric version
is `source-proposition-rubric-v1`.

Two independent raters from the same declared model family receive the frozen
rubric and exact source evidence, with arm labels independently shuffled from a
retained seed and no candidate sidecars, prompt, implementation or arm identity.
Each produces a raw per-arm record containing source status, per-required-claim
coverage, selected card/tuple references, commitment and attribution correctness,
material support for emitted claims, severe additions, source pass and reasons.
Neither rater sees the other's ratings. A distinct masked adjudication pass
resolves disagreements with reasons, retaining both raw records and the raw
adjudication response. Missing or unresolved judgments remain visible and block
a definitive pass. This design offers model-based independence; it provides no
human calibration or evidence of independent model-family error distributions.

After unmasking, compute source gains as baseline-fail/candidate-pass cases,
source losses as baseline-pass/candidate-fail cases, and net gains as gains
minus losses. Independently enumerate every required decision that is correct
under the baseline's persisted projection, regardless of that source's overall
pass. Check each against the candidate for faithful coverage, commitment,
conditions, attribution and polarity. Report those losses and new severe claims
beside the source totals. Freeze and preserve all failures, incomplete records
and attempted resources. Passing the mechanical cold gate is a prerequisite to
running; it cannot satisfy any semantic gate. Neither a positive result nor a
lower generation count by itself authorizes changing production defaults.

## Verification record

Frozen source SHA-256:
`2018e0502c9e4533114855c2e336cc9414a0006f53b5aa2afec1f0ca577970eb`.
Frozen evaluator rubric SHA-256:
`39f2e1eef57d59d5a93c000dbceaae9b0a2077bc024c337ddf6cc7a5e9532f26`.
Freeze occurred after both offline runtime gates and before any future model
output was seen by the fixture author. Do not alter these cases in response to
outputs; any revised cohort needs a distinct version and fresh diagnostic.

The source-only inventory contains 24 cases and 31 messages, with message
lengths from 41 to 320 UTF-16 code units. Eight cases contain a message longer
than 200 units; six cases have multiple messages. The rubric independently
contains 34 required claims, including 21 required decisions. Actual groups
match the declared 6/6/4/4/4 split. None of these counts is a semantic score.
This cohort uses explicit authored statements. It is not an official QA
benchmark and does not represent real-conversation quality or distributions.

Commands run from the isolated worktree:

- `node tools/testing/run.mjs evaluation/architecture/test/source-proposition-fixtures.test.mjs`
  with Node `v22.16.0` — final exit **0**, seven tests passed, none skipped.
- The same command with Node `v24.15.0` — final exit **0**, seven tests passed,
  none skipped.

The first Node 22 run exited **1** because the test's message-count assertion
incorrectly said 33; the source inventory was actually 31. Correcting that
assertion required no source or gold change. The final passing runs above used
the corrected test and exact version strings agreed with the operator. Explicit
version probes reported `v22.16.0` and `v24.15.0`.
The seventh test pins the exact frozen source/rubric bytes by SHA-256 so that
CI rejects edits even when their IDs and structural counts are unchanged.

Delivery inventory was derived from `git ls-files --others --exclude-standard`
and independently from `find` traversing the fixtures, tests and plans
directories for `source-proposition-*`; sorted lists matched, count **4**:

- `docs/plans/source-proposition-comparison.md`
- `evaluation/architecture/fixtures/source-proposition-rubric-v1.json`
- `evaluation/architecture/fixtures/source-proposition-v1.json`
- `evaluation/architecture/test/source-proposition-fixtures.test.mjs`

The inventory assertion command exited **0**. The primary owns full repository
checks, final committed-diff review and integration checks. No semantic model
result, provider resource measurement or paid experiment is claimed here.
