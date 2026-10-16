# Fresh dialogue-context QA diagnostic

Primary-owned experiment contract, recorded before any candidate output. This
is the next bounded study if the predecessor-binding offline gate passes; it
does not authorize production retention changes or reopen a closed experiment.
Fixed repository base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`. Worktree branch:
`experiment/neighbor-source-qa`. The reviewed predecessor helper will be a
declared dependency, not silently copied or changed here.

## Decision and hypothesis

Two earlier semantic-writing approaches failed their no-harm gates. This is
not another prompt revision: the sole intervention changes which already
submitted, redacted source passages survive the write boundary. A selected
window may retain its immediate predecessor in spare existing receipt slots.
It does not assert a semantic relationship, adopt a recommendation, rewrite a
generated memory, create a Raw archive, or change MOC/vector retrieval.

The question is whether this bounded retention change improves supported
answers by retaining and delivering necessary dialogue context. Source presence
alone is not an answer-quality success. A failed study is retained and stops
this candidate; no repair, replacement question, or repetition on the same cases.

## Frozen acceptance requirements

- Q1 — Independent cohort: exactly 24 previously unused synthetic dialogues,
  one subsequent question each, six groups of four (consideration, explicit
  adoption, rejection, factual correction, observation, insufficient
  information). Exactly four single-user-message controls; the other 20 have
  two to six messages. At least six include unrelated dialogue and at least six
  require multiple supported claims. Messages are at most 600 UTF-16 units,
  conversation plus question at most 2,200, question at most 300. Each canonical
  normalized/redacted message must also fit one 600-unit window before any
  model call; raw length alone does not imply that after Unicode normalization.
  Sources/questions and
  rubric are separate files. Author sees neither candidate code nor old outputs.
- Q2 — One shared first extraction: both arms execute normal `core.capture`
  with `indexed-evidence-v1`, no automatic qualification, rationale, episode or
  relation mode. The first arm's real extraction output is saved before its
  binding transform; the second arm receives exactly that detached output for
  an identical extraction request, once. There is one physical extraction, not
  two independently sampled extractions. Both arms independently execute the
  existing real classification call when capture requires it. Alternating arm
  order is fixed before execution. Any extraction/capture/classification failure
  stays in the denominator; no partial capture is presented as complete.
- Q3 — Actual persistence: use separate fresh synthetic SQLite stores, perform
  real admission/classification, bind the integrity-pinned provenance sidecar,
  close and reopen, and resolve only authoritative current source evidence.
  Counter-only cold readers perform no model generation. No direct-admission
  substitute and no read from input dialogue after capture. A single writer and
  no concurrent mutations bound this diagnostic; the helper is not an atomic
  multi-memory read contract. Owned workspaces must clean up on success/failure.
- Q4 — Common read/answer policy: resolve every admitted memory in this tiny
  capture, without oracle selection. Deduplicate canonical source windows,
  preferring extractor-selected provenance when a window has both roles. Pack
  original selections first in original item/selection order, then optional
  context in that same deterministic order. Append only whole passages; never
  evict an original selection to fit an optional passage. Both arms expose the
  same source-ID/speaker/retention-role/text schema, not generated memory prose.
  Retention role is not truth, support or adoption. Freeze one common answer
  instruction and use at most 4,000 locally counted request tokens and 512
  output tokens. Retain included and omitted source IDs, counts and bytes.
  This is a bounded write-to-answer diagnostic, not ordinary MOC recall quality.
- Q5 — Same fixed model and accounting: use the existing pinned
  `gpt-4.1-mini-2025-04-14` for extraction, classification and answering in both
  arms. Maximum five generations per case (one shared extraction, two
  classifications, two answers), each with a preceding provider input count:
  at most 240 physical requests. Preserve 6,000 local / 7,024 provider input
  and 1,024 output caps for existing core calls. Every physical request reserves
  US$0.005 before dispatch: this study's conservative maximum is US$1.20.
  Use the existing cumulative US$400 ledger, preserve US$30 and all historical
  reservations/outcomes; no reset, refund, hidden retry or replacement model.
  Known fully accounted case failure may isolate; new unknown usage, ledger
  drift, authentication/transport integrity or persistence failure stops all.
  Freeze exact runtime, fixture, rubric, policy and ledger checkpoint before
  launch, after independent review and an affordability check. Credential access
  occurs only after a durable one-shot launch claim. No credentials in artifacts.
- Q6 — Visible outcomes: retain all 24 first attempts and both arms, including
  not-run/failed outcomes; exact original extraction, transformed indices,
  capture status, cold evidence, packed context, answer, physical calls, usage,
  latency and cleanup status are inspectable. The scoring process, not the
  runner, reads gold. Mechanically count complete necessary quote sets retained
  and packed, separately from answer correctness. Do not infer model-internal
  causes from an answer or confuse exact quote coverage with semantic adequacy.
  The four insufficient-information cases are excluded from positive necessary-
  quote coverage: retaining an arbitrary utterance cannot establish absence of
  a fact. Their source quotes remain audit context, and their answers still
  count in the 24-case denominator and all uncertainty/no-harm judgments.
- Q7 — Independent semantic judgment: two non-author masked raters judge each
  source/question/answer against the frozen rubric and exact delivered context.
  Preserve original judgments and reconcile disagreements independently before
  unmasking. Correctness requires required claims with attribution, conditional
  and commitment status intact, plus support in supplied evidence (or an
  appropriately limited uncertainty answer). Record required-decision accuracy,
  unsupported assertions, severe adoption/action/reversal errors and stale use
  separately. Same-family agent judgments are not independent human calibration.
  Required claims are the minimum needed to answer the actual question;
  illustrative expected answers may contain optional context. Omitting unasked
  details is not an error. Require correct attribution/conditions when relevant
  to the answer or when the answer chooses to mention those details.
- Q8 — Promotion decision: require at least three net supported-answer gains
  out of 24, increased retained AND packed necessary evidence, no first-attempt
  completion regression, no newly unsupported/severe/stale assertion, and no
  loss of a previously correct required decision in the paired answers. Report
  gains and regressions, not just totals. No opportunity or a failed gate means
  do not adopt; do not tune the candidate using this closed cohort. Passing is
  only a reason for a later fresh retrieval/LongMemEval comparison and retention
  contract review, not production readiness or parity with Mem0/Supermemory.
- Q9 — Delivery: owned offline tests on Node 22.16 and 24.15, actual exit codes,
  primary full contributor gates, independently cross-checked file inventories
  with counts, and non-author Standards plus Spec reviews at the exact frozen
  commit. No provider execution until all prerequisite gates pass. Preserve
  failed results publicly without secrets; update limitations/roadmap when
  results change a gate. No merge, release or deployment.

## Scope and ownership

The primary owns design, integration, acceptance and the final decision. A fresh
GPT-6.1 Sol/high worker owns only source/rubric fixture files and their structural
tests. A separately bounded worker will implement the runner and fake-provider
tests after the prerequisite helper is accepted. Reviewers are independent of
implementation; judging raters are independent of source author and runner.
No user or product database, old question, UI, host default, privacy contract or
production credential configuration changes. Public artifacts must not contain
local operational paths or HTTP authorization records.

Current status: predecessor helper PR #429 passed independent dual review and
all 31 latest-head checks at `fdeaa8f0af966293b5110c566503fe01af6f9915`.
The content-identical dependency here is `90b384a6a8dbd934353406a4dec3408ce17aec56`.
Cohort and runner are offline only. Combined review, budget freeze and paid
execution are pending; nothing has been merged, released or deployed.

## Frozen semantic scoring contract

This contract is fixed before generating either arm's answers. Scoring is pure
supplied-judgment aggregation, not a claim that a program verifies semantics.
The same source, question and minimal rubric apply to both answers.

- Produce 24 masked pairs. A frozen random seed independently permutes pair
  order and the two answer slots (`left`, `right`) in each pair. A separate key
  maps slots to baseline/candidate. Raters receive no key, runtime, old results,
  costs or hypothesis. Exact delivered source context is visible, including
  speaker and retention role; differences in context can make arm inference
  possible, so this is label masking, not guaranteed intervention blindness.
- Each packet pair contains its opaque ID, original dialogue, question,
  required claims, illustrative answer, forbidden examples and two slots with
  execution status, actual answer and actual delivered sources. A failed or
  not-run arm is never silently replaced by an empty successful answer.
- A judgment has `packetSha256` and `pairs`. Each pair has `pairId`, `slots`,
  `issues`, `resolved`, and `reason`. `resolved` is a boolean covering all
  semantic judgments, including optional assertion issues and their paired
  equivalence; false prevents promotion even if all required claims have boolean
  ratings. Each slot has `slot` and `claims`; each claim has
  `claimId`, `correct`, `supported`, `sourceIds`, and `reason`. Both booleans
  permit `null` for unresolved judgment. Support cannot be true when correctness
  is not true. `sourceIds` must reference that slot's actual delivered context.
  Correct positive claims require semantic evidence in that context; the four
  insufficient-information cases may correctly give bounded uncertainty even
  with no delivered evidence. An invented definite negative does not qualify.
  Failed/not-run slots have false correctness/support for every claim.
- `issues` identify distinct material false/unsupported assertions, including
  optional details the answer volunteered. Each issue has `issueId`, `meaning`,
  and `occurrences`; each occurrence has `slot`, exact nonempty `answerQuote`,
  `unsupported`, `severe`, `stale`, and `reason`. Flags are booleans, at least
  one true. Each slot occurs at most once per issue. Group occurrences from
  both slots only when they assert the same erroneous proposition; an unrelated
  error in the other answer is not an equivalent. Separate issues distinguish
  separate errors. Omitted claims are scored as missing claims, not fabricated
  assertion issues. Correctly attributed quotation of an old/rejected idea is
  not itself an assertion of its present truth.
- `unsupported` means a material assertion is contradicted by the full source
  or not supported by the delivered evidence. `severe` marks false adoption,
  performed action, commitment/rejection reversal, or similarly consequential
  factual reversal. `stale` marks presenting an explicitly corrected old value
  as current. Any issue prevents that slot passing the whole-answer metric.
  A candidate occurrence is new for a flag when the equivalent baseline
  occurrence does not have that flag. Baseline errors do not excuse different
  new errors. Same-error equivalence is judged while labels remain masked.
- Two independent non-author raters return complete original judgments; a
  fresh adjudicator reconciles them while still masked. Preserve all originals
  and adjudication reasons, including issue-equivalence disagreements. `null`
  cannot pass the promotion gate. No semantic regrading after unmasking.
- A supported answer passes only if its arm completed, every required claim is
  correct and supported, and there are no assertion issues for that slot.
  Count all 24 first attempts. A decision is preserved only when a baseline
  correct-and-supported decision claim remains correct-and-supported in the
  candidate; a failed candidate cannot preserve it. Completion is paired:
  no baseline-completed case may become candidate-incomplete, even if another
  case improves. Known execution failures remain failures, not wrong answers.
- Positive evidence coverage counts a claim only when **all** its exact quote
  spans are present in corresponding current source messages, respectively in
  cold retained receipts and packed sources. Use bound receipt message IDs,
  not a guessed window-index/message-index equality. Exclude the four unknown
  cases from both positive-coverage numerators and denominator. Report retained
  and packed claim coverage, full-case coverage, and bytes separately from
  semantic judgment; quote match alone does not establish answer support.
- Q8 requires at least three net supported-answer gains, strictly more covered
  positive claims in both retained and packed evidence, no paired completion
  loss, no new unsupported/severe/stale issue occurrence, no lost supported
  decision, no unresolved judgments, and a completed run. Report every gate;
  a stopped run or zero opportunity cannot pass. A pass does not authorize
  changing a product default or claiming normal retrieval/benchmark parity.

## Pre-execution cohort review

An independent GPT-6.1 Sol/high reviewer inspected all 24 questions and the
initial 41 claims without candidate or prior-output access. All reference quotes
were verbatim and grounded, but 14 cases bundled optional context into required
claims. Before any candidate execution, the source author was assigned to trim
these claims and their positive evidence sets without changing source/question
bytes. Examples include purchase timing when only purchase status was asked,
and repeating an assistant suggestion when only the user's choice was asked.
The four unknown cases retain a bounded-uncertainty requirement, never a
fabricated negative fact. This is pre-freeze rubric correction, not post-result
regrading. Final hashes and primary verification are recorded at freeze.

A second fresh audit found one remaining overrequired quote set: answering
whether either cooking course would be taken did not require repeating both
course descriptions. Before execution, only those two optional quote entries
were removed. The independent re-audit passed: 24 cases, 38 minimum claims,
19 decision claims, 37 positive evidence spans and six unknown-case audit spans.
Source SHA-256 remains
`2de0cf0f1821ac0f008ba221130d217872db640deee1fcaf228d98271223048a`;
final rubric SHA-256 is
`23eddd3f75e25548cfe1b3940822ba7d7d3572f04c6b6c47c26a03cbcca1b2a4`.

## Integration decisions and ownership record

All implementation workers and independent reviewers use actual GPT-6.1 Sol
with high reasoning. The cohort author did not inspect implementation or prior
outputs. A separate runner worker owns orchestration, then pure scoring tools;
a private operator worker owns guarded transport and structural audit tests.
The primary owns the plan, launcher, independent acceptance and final decision.
These are test-only files; there is no new product UI/route, host default,
production data migration or production engine change.

The primary identified a scoring integration gap before freeze: source-only
fetch deliberately returns receipt ID, speaker and excerpt, but omits its
message identity. The runner worker was assigned to enrich the **report only**
from authoritative cold `get` receipts, matching ID, role, excerpt and current
memory revision. Model-facing context remains unchanged. This avoids guessing
that a source-window number is a message number; the accepted helper is not
modified. No additional generation or source-dialogue reread is introduced.

Initial offline runner failures exposed answer-error fallback and cleanup-error
precedence defects; both were corrected. The private transport tests exposed a
deadline/late-settlement race and a malformed-toy observer assertion; settlement
is now awaited before ledger close, and the toy assertion handles malformed
outputs. An interrupted exploratory private test command exited 130 and is not
counted as a pass. Final combined gates will be recorded against frozen bytes.

The scoring integration also rejected impossible source-window remapping even
when a sidecar digest was recomputed. A separate unresolved-pair flag prevents
promotion when raters cannot settle an optional assertion or cross-answer error
equivalence; boolean required-claim ratings alone cannot hide that uncertainty.
Exploratory scoring-test failures involved a toy reference that no longer
existed in the packed context; those assertions were corrected, not bypassed.

### Primary offline acceptance before freeze

These are personally rerun gates on the combined candidate, not model-quality
scores. All commands below returned actual exit code **0**; test counts include
no skipped or cancelled cases. The committed runtime is subsequently bound by
the one-shot manifest, and both independent review axes must still pass before
provider execution.

| Gate | Runtime | Result |
| --- | --- | --- |
| Full `npm test` | Node 22.16.0 | 686/686 |
| Complete architecture suite | Node 24.15.0 | 134/134 |
| Public runner focused tests | Node 22.16.0 and 24.15.0 | 15/15 each |
| Fresh source/rubric structural tests | Node 22.16.0 and 24.15.0 | 8/8 each |
| Private transport/failure tests | Node 22.16.0 and 24.15.0 | 17/17 each |
| Independent structural-audit toy tests | Node 22.16.0 and 24.15.0 | 6/6 each |
| `npm run validate` | Node 22.16.0 | pass |
| Pinned Claude Code 2.1.260 marketplace and strict plugin validation | Isolated configuration | both pass; owned configuration removed |
| Private launcher syntax check | Node 22.16.0 | pass |

The complete architecture runs include the 12 supplied-judgment scorer tests.
They exercise a real scripted 24-case capture/cold-read report, but do not
establish that a real model answers correctly. Neither the product engine nor
its prompts, public schema, adapters or defaults changed in this diagnostic.
The combined inventory contains 12 paths, including the declared helper
dependency: Git diff plus untracked files and a separate filesystem/base-blob
hash comparison agreed after inspecting 1,642 files. `git diff --check` also
returned 0. This branch does not include private operating artifacts or secrets.

## Provider documentation checked for this plan

The [GPT-4.1 Mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
still lists the pinned snapshot and US$0.40/US$1.60 per million input/output
tokens, but labels it deprecated. This study intentionally keeps its fixed
comparison model; it does not recommend it as a new product default or assume
future availability. No automatic model fallback is allowed.

The [official token-counting guide](https://developers.openai.com/api/docs/guides/token-counting)
explains that provider counts include request framing absent from local text
tokenization. Local checks therefore do not replace the existing provider
preflight. Usage estimates, conservative reservations and invoices remain
distinct; count-endpoint and agent-judging costs are not silently treated as zero.
