# Role-stratified extraction: one-call development candidate

Status: prospective offline implementation, not a demonstrated repair or product
default. Primary recorded this contract before implementation and any candidate
model output. Base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`; branch:
`experiment/role-stratified-extraction`.

The goal remains one lightweight, source-backed memory engine for Hermes and
other harnesses. This is a write-stage experiment within the existing five-item
and four-receipt bounds, not a new archive, memory kind, semantic graph or MOC
retrieval policy. The agreed Raw / Memory / Knowledge Card roles do not require
three model calls or a new database service.

## Why this intervention, and what the diagnosis does not prove

Read-only inspection of the frozen thirty-question run found 6/15
evaluator-labeled source windows retained and 3/15 packed across its ten
completed-wrong cases. These are exact-passage conservation counts, not semantic
recall or new answer scores. All six labeled user event passages in temporal
cases 14–18 were absent. Other assistant passages preserve partial facts;
bounded direct inspection did not find equivalent complete event-and-time
assertions. Arbitrary paraphrases elsewhere remain unexcluded. Source calendar
dates do occur elsewhere: this is not evidence of missing date metadata or of
ingestion time replacing event time.

The six affected source batches contain 37 user / 139 assistant windows;
retained unique windows are 1 / 106. Receipt bindings are 1 / 107 because one
assistant window is attached more than once. Five batches have five distinct
admitted memories; the sixth has four distinct IDs, so extraction saturation
is unknown there because admission deduplicates IDs. The imbalance is observed,
not proof that capacity, prompt wording or model attention caused the omission.

A separate fixed, unchanged SQLite BM25 diagnostic over four later-six wrong
cases placed all four retained necessary memory occurrences in its top twelve.
They were all already visible historically; two necessary source windows were
absent. The previously hidden related assistant candidate stayed outside its
top twelve. Thus that probe provides no new necessary-source visibility
opportunity. It does not prove BM25 is generally ineffective or choose a MOC
or vector successor. Original scores, stores and closed operations remain intact.

The previous small-message batching experiment improved some source coverage
but failed fidelity/safety. The immediate-predecessor experiment produced zero
paired answer gain and no common-completed necessary-source gain. Do not repeat
either closed cohort or substitute its unfinished cases into this experiment.

Ranked falsifiable alternatives:

1. If shared slot competition contributes, a single call with separate role
   budgets will retain more user event support on fresh long dialogues without
   increasing the aggregate five-item budget. It may instead lose assistant
   information; those losses must count.
2. If the model's interpretation, not allocation, is the limiting factor,
   separate budgets may still omit events or misstate time/commitment. Inspect
   generated claims against their own receipts, not only source presence.
3. If needed facts survive but are not used, increased retained and delivered
   support will fail to improve answers. This blocks advancement even when
   conservation improves.

The selected hypothesis is **role-stratified allocation**. It is not a claim
that user messages are true or assistant messages disposable. A speaker can
quote another person; role is not claimant, subject, adoption or authorization.
The intervention is a grouped extraction policy: both its output shape and
role-specific prompt guidance differ. This comparison cannot attribute an
effect to numeric quotas alone. No other write, retrieval or answer policy
changes between arms.

## Offline helper acceptance (R1–R8)

R1. Add evaluation-only preparation, compilation and an injected model wrapper.
No production core, prompt, adapter, persisted schema, host, public default,
ledger or historical result changes. Input is the existing indexed-evidence
capture envelope, without causal/episode modes, copied as strict JSON data
before callbacks. Reject accessors, custom objects, symbols, sparse arrays,
cycles, malformed Unicode and non-finite values without invoking getters or
`toJSON`. Reuse `captureSnapshot` and `sourceWindowCatalog`; the existing
24-message / 4,000-unit message / 20,000-unit batch / 64-window bounds apply.

R2. One frozen request sees the same complete canonical window catalog as the
baseline, in original order, with only transient index, messageIndex, role and
content. No owner, source ID, session, question, gold, future record, generated
old memory or query-conditioned source choice enters extraction. The prompt
keeps the baseline source and uncertainty cautions and asks for two groups:
`userItems` (0–3) and `assistantItems` (0–2). There is no borrowing unused slots
or repair pass. A group may be empty, including when messages of that role are
present but nothing sufficiently supported is worth retaining. The total cap
remains five; no per-role minimum forces invented claims.

R3. Each item uses the existing exact fields `content`, `kind`, `confidence`,
`sourceIndices`, and existing text/value/1–4 distinct-index bounds. A user-group
item must cite at least one user window; an assistant-group item at least one
assistant window. Either can cite the other role for necessary context.
This mechanical citation check does not prove semantic attribution/support.
Prompt guidance preserves reported personal events, observations, preferences,
plans and explicit choices, while assistant-group items preserve attributed
recommendations or information. Mere advice is not adoption. Preserve stated
event/relative time and its source-date context; never invent dates, convert
unknown dates, or use current ingestion time. Do not force one compound claim
to contain unrelated events to satisfy a quota.

R4. Compile the entire output or reject it. Exact top-level keys are
`userItems` and `assistantItems`; no extra fields, silent dropping, truncation,
rebalancing or salvage. Validate both arrays against the private trusted
catalog using `extractedWindowItems`, then emit ordinary `{items:[...]}` with
user-group order followed by assistant-group order. Preserve original proposal
and group metadata only as detached evaluation observations. No new source
identity, artificial evidence, inferred chronology or semantic link is created.
Caller mutation cannot change trusted preparation or later output; foreign or
forged prepared handles reject. Empty output remains explicitly empty.

R5. The wrapper's `extract` accepts only the exact baseline system/input for
its prepared capture and one invocation. It makes exactly one injected
`extractRoleStratified` call through the existing `callModel` constraints:
minimum 8,192 context, 6,000 local input, 1,024 output, bounded wire and core
deadline/cancellation. Count the actual replacement request; also validate
the compiled ordinary output under the same output budget. Preserve `this`
binding of the injected port. Return strict copied output before any JSON
serialization can invoke a model-returned accessor. No provider implementation,
credential read, network fallback, retry or new spend authority lives here.
The host binds the same deterministic local counter and the exact prepared
capture to ordinary `core.capture`; classify is unchanged. A stale/mismatched
request fails closed, not substituted with a generic input.

R6. Scripted tests exercise actual core capture, admission/classification,
close/reopen and source reads in fresh owned stores. Test a long assistant
reply with a shorter user event; an assistant-only useful answer; a user quote
about someone else; a proposal followed by rejection; cross-role context;
empty groups; three/two exact caps and overflow; mixed duplicate indices;
invalid later-item atomic rejection; Unicode/window boundaries; omitted and
incompatible modes; request/output/counter mutation; timeout/cancellation;
one-call and no-retry behavior; namespace, correction and forgetting fences.
Quota compliance and scripted receipt retention are mechanics, not semantic
accuracy. Keep a baseline control that accepts an assistant-heavy five-item
extraction; candidate rejection of that shape alone does not fix historical
omission. No model/user data is used by offline tests.

R7. Errors are bounded, source-free codes. Explicitly trace the helper's only
caller (new evaluation/tests); no runtime consumer or browser route changes.
Use `tools/testing/run.mjs` and `createTestWorkspace`, verifying success and
failure cleanup. Worker runs focused tests on Node 22.16/24.15. Primary reads
the complete diff and reruns the key integrated tests and contributor gates;
no TypeScript gate exists in this JavaScript repository. Cross-check the
changed-file inventory independently and report a count.

R8. Freeze one candidate commit; independent nonauthor GPT-6.1 Sol Standards
and Spec reviewers inspect the same fixed diff before push/PR and exact-head
CI. No merge, release, deployment, raw archive/search or existing-store edits.
Future paid execution requires separately frozen cases, rubric, runner/operator,
resource limits, independent review and a fresh original-budget check.

## Prospective fresh development cohort and quality gate

One independent author, without candidate implementation or historical answers,
creates exactly 24 new synthetic dialogues/questions in six families of four:
dated personal events; changed observations; intentions versus adoption;
conditions/uncertainty; useful assistant information; mixed attribution.
Sources/questions and evaluator-only minimal claims/quotes stay separate.
Include four genuinely insufficient-information questions, not answers that
merely require caution. Positive claims must be the minimum needed by each
question, not every illustrative reference-answer detail.

Exactly four single-role controls: two user-only and two assistant-only. The
remaining twenty alternate roles, beginning with user, with 6–12 messages.
At least sixteen cases have an assistant message exceeding 800 UTF-16 units;
at least twelve total 6,000–16,000 source units. All messages remain <=4,000,
all batches <=20,000, questions <=300. Exact normalized/canonical bounds and
actual local full-wire token preflight must pass before any paid call; no
post-result shrinking. At least six questions require two or three claims,
four ask necessary assistant information, and four are severe attribution /
proposal-adoption / stale-state negative controls. No source is copied from
an old dataset or experiment. Dates/relative time must be unambiguous when
required, otherwise expected uncertainty remains explicit.
At least four necessary evidence quotes start after UTF-16 offset 800 in
their original message. Long messages must be coherent distinct information,
not repeated padding. An independent pre-execution rubric review checks all
24 questions against the complete sources, including whether unknowns truly
lack enough information and whether required claims are minimal.

The later paired study will execute independent first extractions in both
arms (their extraction requests differ), normal unchanged classification,
separate cold stores and the same bounded source-only answer policy. Do not
reuse one extraction across unlike prompts. No MOC/vector/relationship change
in the same comparison. This write-to-answer diagnostic is not ordinary
long-history retrieval or a LongMemEval score. Record exact original outputs,
admitted claims/receipts, packed and omitted evidence, first answers, failures,
calls/tokens/latency/storage and cleanup. At most six generations/case, each
preceded by input count: <=288 HTTP requests and <=US$1.44 at US$0.005 reserved
per physical request, within the original cumulative US$400 / protected US$30.
Known actual billed cost remains separate; count-route usage is not assumed
free. Frozen model is the existing `gpt-4.1-mini-2025-04-14`; changing the
delegated engineering model does not change this paired measurement model.

Two masked independent nonauthor raters and a masked adjudicator score both
each admitted claim against its attached sources and each answer against the
question, rubric and delivered evidence. Preserve uncertainty/disagreements;
no rejudging after arm unmasking. All 24 cases and both arms remain in the
denominator. Retained/packed necessary-source coverage and supported-answer
accuracy are separate. Also report claims reviewed, unsupported/stale claims,
lost correct decisions, assistant-information losses, completion and resource
differences. Same-family agent review is not human calibration.

Advance only if the unchanged Stage-2 rule passes: >=3 net additional supported
correct answers/24, increased targeted retained and packed necessary support,
no paired completion loss, no lost previously correct decision, no newly
unsupported/stale/severe claim in either admitted memories or answers, no
unresolved safety judgment, and completion within the frozen resource limits.
A failed candidate is closed, not tuned/retried on those cases. Passing merely
permits proposing the next fresh retrieval/paired external pilot; reliability,
genuine installed Hermes use, lifecycle cost and competitive parity remain
separate unpassed gates.

## Paired runner contract (Q1–Q8, recorded before implementation)

Q1. A new evaluation-only runner accepts source JSON text, not evaluator
rubrics or labels. Its source file has exactly `version`, `cases`; version is
`role-stratified-qa-v1`. Each case has exactly `id` (12 lowercase hex digits),
`messages` (exact `role`, `content`), `question`. Parse bounded JSON, reject
duplicate IDs, malformed/noncanonical text and invalid structure before
callbacks or creating stores. The paid operator requires exactly the 24
frozen cases; the offline runner accepts 1–24 for focused controls. Messages
are user/assistant, 1–12, <=4,000 units each and <=20,000 in total; questions
<=300. A mixed-role dialogue must alternate starting with user. Single-role
controls may contain 1–6 messages. Cohort distribution checks stay in fixture
tests, not in model-facing input. The runner preserves order and uses
deterministic synthetic capture IDs; `captureSnapshot` must not change text.
The report also records `fixtureVersion` and `fixtureSha256` over the exact
UTF-8 input JSON bytes, binding later scoring to the executed source file.

Q2. Run baseline first on even zero-based case indices and candidate first on
odd indices. Both arms independently make their first extraction call; no
output replay or cross-arm state. Use separate new stores with only
`captureSourcePolicy: indexed-evidence-v1`. Baseline calls the unchanged core
extractor; candidate uses `prepareRoleStratifiedExtraction` and its exact
prepared capture/options with `createRoleStratifiedModel`. Count the actual
replacement request. The injected candidate port is `extractRoleStratified`;
classification is the unchanged normal core call. No retry, repair call,
reclassification, question during extraction, MOC/vector variation or source
archive. No provider credentials or ledger code in the public runner.

Q3. Retain each arm's original extraction request/proposal, compiled ordinary
output, capture result, classification output, and all actually admitted
memory claims with their own receipts. Deduplicated memory IDs are not assumed
to map one-to-one or in order to proposal items. Close the writer and reopen
without generation methods, then get each actual admitted memory at its
recorded revision with exhausted receipts. Match each receipt by exact
client/session/message-event/role/excerpt to the canonical window catalog;
require an unambiguous match. Recheck cold memory content/kind/revision and
receipt identity against the write-side read, and retain window/message
indices and canonical offsets as audit data. Never manufacture an omitted
receipt from the original fixture or derive a relationship from adjacency.
Source-binding/storage/revision disagreement stops the whole run. When
classification fails after admission, preserve the admitted claims/receipts
for fidelity review even though that arm receives no answer.

Q4. The common answer policy sees only the question and deduplicated exact
retained receipts, ordered by original global window index. Its source fields
are exactly `sourceId` (`window-N`), `speaker`, `text`; no group, arm, rubric,
generated memory prose or full-history fallback enters. Append whole windows
in that order while the complete serialized request fits 4,000 local tokens;
skip an overflowing window and record its omission, never truncate it. Output
cap is 512 tokens. The common instruction is the existing
`PUBLIC_ANSWER_INSTRUCTION` plus: `Each source is an exact quotation attributed
to its speaker. Preserve attribution, conditions, rejection, corrections,
and whether a suggestion was adopted.` Record all retained/included/omitted
window IDs, text bytes and complete-request token counts. Do not select
sources using the question or evaluator labels. This all-admitted cold read
isolates writing/answer use; it is not the production recall algorithm.

Q5. Emit synchronous detached `model-start`, `model-output`, `model-failure`,
`source-bound`, `arm-final`, `case-final`, `run-final` records. Extraction's
phase remains `extract` in both arms, with the actual differing request.
Every model dispatch checks the supplied active guard before and after;
observer/guard failure latches a whole-run stop. Operator accounting or
transport uncertainty is never converted into an ordinary failed answer.
Known fully accounted model/format/time-limit failures may finish as failed
arms and continue the preselected cases, without retry. Incomplete arms stay
in the denominator. Retain received output before a post-call stop. Reject
asynchronous callbacks; no hidden background run. Cleanup is attempted even
after stop; cleanup failure is fatal and visible. Counts separate extraction,
classification and answer, with no replay count interpreted as a request.

Q6. Use the existing core extraction/classification deadlines (30 seconds)
and a bounded 60-second answer call. The separate paid operator's total
deadline is frozen at **60 minutes**, replacing the closed predecessor's
30-minute total only for this new experiment. Its reviewed fast guard must
still attest the original ledger immediately before actual transport
dispatch (no await/callback gap), after settlement and at final audit.
Exactly 288 maximum HTTP requests, US$1.44 maximum reserved spend, US$400
cumulative and US$30 protected remain unchanged. Every count and generation
request is reserved, including failures; no reset, refund or rerun. New
unknown/pending accounting, unexpected request/response, identity/hash drift
or cleanup failure stops the whole operation. Original stopped runs stay
closed. Freeze runtime, source, rubric, instructions, schemas, operator and
limits before the first paid request.

Q7. Runner tests use scripted ports and real temporary core stores: both
first extractions, alternating order, source-only cold read, deduplication,
multiple windows and exact receipt coordinates, no orphan/foreign source,
actual compiled candidate output, assistant-only useful information, exact
answer-packing budget with omission, empty memory/unknown answer, preserved
admission after classification failure, per-arm known failure isolation,
guard/observer stop, cancellation, cleanup on success/failure and retained
not-run rows. Both pinned Nodes must pass via the owned test runner. Public
imports make no network/credential/ledger access. Primary inspects and reruns
integrated tests before fixed-commit dual review and exact-head CI.

Q8. Freeze scoring separately before execution. Source/rubric versions and
SHA-256s must match. Rubric rows contain `id`, `group`, `unknown`,
`assistantInformation`, `expectedAnswer`, `claims`, `forbiddenAssertions`;
each claim has `id`, `text`, `decision`, exact `evidence` messageIndex/quote
pairs. Unknown-case quotes document context, not a positive proof of absence,
and are excluded from positive necessary-source coverage. Mechanical
coverage requires the complete evidence quote be present in the retained
or packed window union at its original message coordinates. Also report
semantic support separately; quote conservation is not semantic recall.
All admitted-memory assertions, including those from failed classified arms,
and all completed answers receive independent masked source-support review.
No arm unmasking until judgment/adjudication files are fixed. No scoring
change after observing output. Report this development cohort separately
from every external thirty/six-question result.

## Scoring details (S1–S5, before any model output)

S1. A separate pure scorer consumes exact source/rubric JSON, runner report,
and supplied judgments; it calls no model, store, provider, environment or
ledger. Validate the full 24-case identity/order, role/source text, rubric
quotes and report integrity before masking or scoring. Check admitted and
cold-read memories agree, each receipt's exact identity/coordinates matches
the canonical source, packed sources come only from these actual receipts,
included/omitted sets partition retained sources, and counts/statuses agree.
Malformed or forged input fails with a source-free code. A missing arm is
not silently dropped. Resource/billing audit remains a separate primary gate.

S2. Use a precommitted random 64-hex seed to create per-case left/right arm
labels and shuffled pair order. A separate key maps these labels to arms;
raters receive no key, arm names, extraction requests/proposals/groups,
historical answers or implementation. Each pair includes full synthetic
dialogue, question, minimal reference claims and forbidden examples. Each
slot includes status, first answer, delivered source passages, and every
admitted memory statement with its own source passages. Give memories only
local IDs `memory-N`, not persistence IDs. Memory/source counts and wording
may reveal the intervention: this is label masking, not proven blindness.

S3. Each of two independent nonauthor raters records, per required answer
claim, `correct` and `supported` (true/false/null), exact delivered source IDs
and a short reason. `supported:true` requires `correct:true`; positive
supported claims need a delivered source. Unknown-case correctness means
recognizing the requested information is unavailable, not answering every
question cautiously. For failed/not-run answers both flags are false.
For every admitted memory statement, separately record `supported`
(true/false/null), its own source IDs and reason: true requires all substantive
claims in that statement be justified by those attached sources, preserving
attribution, time, scope and commitment. This is a statement-level review,
not a claimed count of all atomic facts. No memory is exempt because its arm
failed classification. Missing/wrong required answer claims and unsupported
additional assertions are different fields, not interchangeable scores.

S4. Raters identify issues by semantic proposition with exact output quote(s),
target (`answer` or local `memory-N`), and unsupported/severe/stale flags.
An unsupported memory verdict must have a corresponding cited issue; null
remains unresolved. Match equivalent issues across masked slots, without
using implementation names. A new candidate issue is counted separately in
the answer and memory layers: a baseline answer error cannot excuse a new
stored-memory error, or vice versa. Count newly introduced flags, not just
net error totals; fixing one error does not cancel an unrelated new one.
Independent adjudication happens while still masked, with original judgments
preserved. Any unresolved judgment blocks advancement.

S5. A supported-correct answer requires completion, every minimum required
claim correct and supported, and no unsupported/stale/severe answer issue.
Report first-answer accuracy over all 24, complete-answer accuracy separately,
paired gains/regressions, lost supported decision claims, assistant-information
losses, memory support counts, separate answer/memory issues and unknown
performance. Positive necessary-source coverage excludes the four unknowns.
For each minimum claim, all exact required quote spans must be covered by
actual retained/packed window-coordinate unions in the original message;
check every occurrence when a quote repeats, not merely its first location.
Whitespace omitted at canonical window boundaries is ignored only for this
coverage calculation, never inserted into answer passages or counted as new
evidence. Any missing non-whitespace source unit makes a span incomplete.
No generated paraphrase receives mechanical exact-quote credit. Report both
all-case and common-completed coverage so a stopped arm's partial state cannot
be mistaken for a paired semantic regression. The advancement gate above is
unchanged, including net >=3, both positive coverage gains, no new issues in
either layer, no lost correct decision and complete accountable execution.

The pure scorer exposes `createRoleStratifiedJudgingPacket`,
`validateRoleStratifiedJudgments` and `scoreRoleStratifiedQa`. Packet creation
returns the packet and a separate `mappingKey`. Judgment files bind
`packetSha256` and contain every `pairId`, its `resolved` flag/reason, both
slots' required-claim verdicts and admitted-memory verdicts, plus semantic
issues and exact-quote occurrences. An occurrence names its slot, target
(`answer` or local `memory-N`), and unsupported/severe/stale flags. The scorer's
`semanticGatePassed` includes integrity/completion and the quality conditions,
but resource accounting is explicitly `not-evaluated`; overall advancement is
not authorized by that pure result. Primary must separately verify the original
ledger, execution manifest and frozen operational limits.

## Pre-execution acceptance record

- Helper and runner authors used actual GPT-6.1 Sol/high in bounded disjoint
  files. Primary inspected both implementations and runner tests, then reran
  the combined helper/runner/fixture suite: Node 22.16 and 24.15 each **41/41,
  exit 0**. These are scripted mechanics, not model quality. A subsequent
  additive fixture-hash report field requires its own affected rerun.
- Node 20.19 compatibility run: **exit 0, 4 passed, 37 explicitly skipped**.
  The helper reuses SQLite-bound core modules; actual store integration needs
  Node >=22.16. Pure fixture parsing still runs on Node 20. No runtime support
  is inferred from a skipped test and no core/package/CI requirement changed.
- The source author did not inspect the candidate implementation or historical
  answers. Primary read all 24 full dialogues and caught an initially invalid
  unknown target and redundant evidence requirements before model execution;
  the author corrected them. An independent nonauthor read all sources/rubrics
  and found one further unnecessarily long evidence quote. The author shortened
  only that quote; independent follow-up fairness review passed. Source SHA-256
  is `daee1f92dfc5da44a9a55d944c7612c929069da8759aec9a6ab8189525596c16`;
  rubric SHA-256 is
  `aa142720373f95ad555b3d220d3c39868b69aa2c1899787c88775667321cf58d`.
  Every expected answer has support, and all four remaining unknown targets
  genuinely lack the requested information.
- The cohort is a diagnostic, not a representative natural-conversation sample:
  explicit recordkeeping reminders often reveal the distinction being tested;
  all unknown cases are short; assistant-only and late-evidence controls are
  concentrated in one family. Positive results cannot establish long-history
  recall, full three-role architecture quality or competitive parity.
- The provider schema uses documented array bounds. Duplicate indices remain
  rejected by the compiler; the unlisted `uniqueItems` provider keyword was
  removed conservatively before execution, not after a live API error. See
  [OpenAI's Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
- Primary's actual-source full-wire preflight used a fresh synthetic ledger and
  a transport that throws if called: **exit 0**, all 48 requests ready, zero
  requests reserved and scratch removed. Baseline generation-wire range is
  526–1,951 local tokens; candidate range is 1,025–2,450, below 6,000. This does
  not establish long-history ingestion performance. An initial wrapper command
  incorrectly combined test and eval flags (exit 9, before execution); the
  supported `--script` invocation produced the stated result.
- The pinned model's [published text rates](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
  remain US$0.40 input / US$1.60 output per million tokens; estimates are not
  invoice reconciliation. Its [announced shutdown](https://developers.openai.com/api/docs/deprecations)
  is January 14, 2027. Keep this paired run's model fixed; a newer-model pilot
  requires a fresh, separately frozen comparison, not a mid-run substitution.
- The new private operator preserves the original ledger and separately
  preflights all 48 extraction wires. Its synthetic 59,000-entry ledger probe
  completed 104 physical fake requests in 283,089 ms with accounting/cleanup
  assertions passing, but **exit 1** under an inherited 240-second threshold
  originally used for 56 requests. This failure is retained. The new protocol
  already specified 60 minutes; the revised offline feasibility check measures
  that bound and labels a 288-request overhead projection as a projection,
  never as proof of actual paid completion. No ledger guard is relaxed.
  The final representative check passed (**exit 0**): 104 fake HTTP requests,
  24 rows, 286,231 ms, maximum local boundary 3,821.64 ms; the explicitly
  extrapolated 288-request local overhead is 1,100,632 ms. Actual provider
  latency is excluded and remains subject to the live 60-minute deadline.
- Final private-operator correctness runs on Node 22.16 and 24.15 each passed
  **28/28, exit 0**. Primary separately reran the 288-fake-request happy path,
  unknown-accounting halt and queued-observer dispatch guard: **3/3, exit 0**.
  No real provider request or original-ledger mutation occurred in these tests.
- Primary integration inspection corrected three scorer edge cases before
  execution: compare compiled candidate items with canonicalized group items,
  retain an already-received answer when later cleanup fails without scoring it
  as completed, and reject a supported-memory verdict that also declares an
  unsupported issue on the same memory. The source/rubric and quality gate did
  not change.
- The first final Node 22 full suite failed (**exit 1; 684 passed, 5 failed,
  4 cancelled**). A captured four-file repro reproduced exactly those five
  failures and four cancellations (**exit 1; 49 passed**). The Node 24 full
  architecture invocation hung at the helper's readiness wait and primary
  stopped its owned runner (**exit 143**, not a pass).
  Two independently minimized test defects explain these results. A 40-ms
  whole-capture test deadline could expire before provider dispatch, leaving
  an unconditional readiness wait unresolved. Separately, runner tests counted
  and fault-injected all similarly named stores under the shared invocation
  temporary directory, including the concurrently executing scorer's stores.
  Authors changed only their tests: explicit pre-dispatch coverage plus a
  manually driven default in-flight deadline, and a file-owned temporary
  parent with an ambient-sibling regression. Original cleanup assertions remain;
  no runtime deadline, algorithm, scoring or global concurrency was relaxed.
  The corrected combined four-file suite passed **60/60, exit 0**, on both
  Node 22.16 and 24.15. Primary independently reran every architecture test on
  Node 24.15: **143/143, exit 0**. The final new-test Node 20 compatibility run
  exited **0: 20 passed, 40 explicitly skipped** at the SQLite boundary.
  Primary's full Node 22 contributor rerun then passed **695/695, exit 0**,
  with no failed, cancelled or skipped tests. JSON validation and both pinned
  Claude marketplace/strict-plugin checks exited 0. The existing scripted
  LongMemEval comparison demo exited 0 on both core runtimes; it is not a
  measured model score. Independent Git and filesystem/base-blob inventories
  matched all **12** changed files (1,642 files inspected).

The private resource audit is deliberately separate from semantic scoring. It
cross-checks durable HTTP intent/final records, the frozen manifest and returned
report against a primary-supplied fresh original-ledger snapshot, including
reservations, usage estimates, all 24 denominator rows, cleanup and final-state
consistency. It does not authenticate a provider invoice or independently prove
the freshness of a supplied snapshot. Primary's launcher binds reviewed artifact
hashes and the original checkpoint, uses one exclusive durable cohort-start
claim, then records first outputs without retries. These are acceptance
integration tools, not a new public product or a change to the quality gate.

## Ownership and checkpoints

Primary owns planning, selection, acceptance, original evidence, accounting and
handoff. A bounded actual GPT-6.1 Sol/high worker owns helper/schema/prompt plus
scripted tests. A separate GPT-6.1 Sol/high worker owns source/rubric fixtures
and structural tests; no overlapping files. Primary alone updates this plan
until explicitly delegated. Runner/operator work follows the offline helper
gate and uses separate bounded ownership. Independent reviews are not author
self-review. Preserve unrelated worktrees and all closed run artifacts.

The user requested discussion after 12–18 hours if work is still ongoing;
this turn's first checkpoint is 2026-10-17 03:09 UTC. Stop earlier for a material
choice outside existing scope, not merely to report ordinary progress.
