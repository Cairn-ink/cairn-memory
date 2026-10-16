# Source-selection memory: bounded offline candidate

Status: prospective evaluation-only implementation, not a product default or
demonstrated quality improvement. Fixed base:
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`; branch:
`experiment/source-selection-memory`. Primary recorded this contract before
delegating implementation. No paid operation is part of this packet.

## Decision and alternatives

The closed [role-stratified study](https://github.com/Cairn-ink/cairn-memory/pull/431)
completed both arms: 24/24 supported answers each, and 38/38 positive necessary
source claims retained and packed each. Its answer task had no improvement
opportunity in the observed baseline. Independently judged memory statements
were supported in 86/111 baseline and 76/95 candidate cases. Despite fewer
unsupported statements overall, candidate introduced a new severe/stale
wind-only permission where a latched gate was also required. Another memory
and the attached source retained the gate condition; it was not absent from
the whole memory bank. Source-only answers still preserved both requirements.
The candidate failed its unchanged gate; it is not adopted or tuned on that
closed cohort.

This is a recorded mechanism/opportunity re-scope, not an automatic third quota
variant. Test **source selection without generated factual prose**. The model
selects bounded canonical windows; a compiler builds explicitly labeled source
previews and attaches exact original receipts. It makes no inferred claim about
current state, adoption, claimant identity, event time or relationships.
Existing Raw / Memory / Knowledge Card roles remain unchanged; selected source
receipts are not a new durable raw archive. A source preview is not a promoted
Knowledge Card or a verified semantic memory.

This differs from the earlier joint proposition/qualification builder: that
builder still generated propositions and semantic fields. It also differs from
post-retrieval basis quotation, which cannot recover omitted capture evidence.
Prefer existing core source-window, receipt and source-aware recall mechanisms;
do not add a parallel store, embedding service or inference engine.

Episode/topic segmentation remains an alternative for omitted event/context
evidence, but changes batching and effective per-session capacity. A post-write
verifier adds another interpretation call and can improve apparent precision by
discarding useful information. Neither is bundled into this candidate.
[LeanMem sections 3.2–3.4](https://arxiv.org/html/2608.03463v1) preserve access to
original dialogue for record expansion; [LightMem section 3.2](https://arxiv.org/html/2510.18866v1)
stores turns with its topic summaries. These motivate separating evidence from
interpretation, not a claim that this bounded adaptation reproduces their gains
or grants permission for their retention policies.

## Observable acceptance T1–T8

T1. Add one evaluation-only module, one prompt and one focused test file.
Preparation accepts a JSON-text capture envelope, not arbitrary object graphs.
Reject nonstring, malformed/oversized JSON, unknown fields, noncanonical
identifiers and malformed Unicode before callbacks or persistence. Use the
existing capture envelope with exactly namespace/client/sessionId/eventId/messages
and `indexed-evidence-v1`; no causal, episode, qualification or raw mode.
Reuse `captureSnapshot`, `extractionRequest` and its canonical source catalog.
Existing 24-message / 4,000-unit message / 20,000-unit batch / 64-window bounds
remain authoritative. Return detached frozen data; trusted state belongs to a
private prepared handle. Mutation and forged handles must not change selection.

T2. The single request sees the same complete query-blind canonical catalog as
normal indexed extraction, with index/messageIndex/claimed role/content only.
No namespace, persistent identity, question, rubric, future input or generated
old memory enters. The exact response is JSON text encoding
`{groups:[{sourceIndices:[...]}]}`: zero to five groups; one to four distinct
in-bounds window indices per group. No per-role quota, forced minimum,
free-form content, semantic field, confidence claim or inferred edge. The first
index is the preview source; remaining indices provide potentially necessary
context, not proof of a semantic relationship. Cross-group reuse is allowed;
ordinary core deduplication remains authoritative. Do not silently sort, repair,
truncate or partially accept an invalid proposal.

T3. For each group the compiler constructs ordinary indexed-extraction output:
`content`, `kind:'context'`, `confidence:0`, original `sourceIndices`. Zero is an
explicit conservative placeholder in this experiment, not calibrated truth or
evidence that the source is false. Do not infer stronger metadata. Content is a
deterministic preview of the first selected canonical window, preceded by a
fixed label stating that it is an untrusted source excerpt with a claimed role,
not a verified/current fact. Copy source text, never model prose. Keep the whole
content <=600 UTF-16 units, with code-point-safe clipping and an explicit fixed
incomplete-preview marker when clipped. Account for label and marker within
that bound. Never truncate the attached <=800-unit canonical receipts: bind
all selected indices through the existing compiler. Return observations of
selected indices, preview clipping and copied length separately from normal
output, without persisting a new schema or raw span channel.

T4. A one-shot injected model wrapper accepts only the exact prepared baseline
capture request and substitutes the selection request under the existing
`callModel` input/output/context/deadline/cancellation limits. One invocation,
no repair, retry or fallback; a failed/stale attempt consumes the wrapper.
The injected selection port returns JSON text. Count its actual replacement
wire and the compiled ordinary output; do not relax the 6,000-input / 1,024-output
bound or minimum 8,192 context. Classify delegates unchanged with correct port
binding. There is no SDK, HTTP, credential read, ledger or automatic paid run.
An outer core abort must promptly cancel/settle the replacement invocation,
including an uncooperative provider. Preserve source-free bounded errors.

T5. Tests drive real ordinary core capture, normal successful new-L1 filing,
close/reopen, exact source-evidence reads and the existing source-aware recall
path in owned synthetic stores. Scripted selectors/rankers must choose from
the input they actually receive, not evaluator closure IDs. Demonstrate a
necessary qualifier beyond the preview survives in its attached receipt and
can reach source-only context; do not call this semantic QA or proof of recall
quality. Verify the classification revision transition, shared-source/dedup
behavior, retained metadata, namespace isolation, correction and forgetting.

T6. Cover empty output, all five/four bounds, invalid later-group atomic
rejection, duplicate/foreign indices, nonstring model output/accessors without
execution, forged handle, mutation, exact baseline mismatch, unconfigured
ports, input/compiled-output overflow, cancellation and one-shot behavior.
Include user and assistant sources, reported speech, proposal versus adoption,
an old rule plus later condition, unknown relative dates, long context, CJK,
non-BMP and normalization/redaction. Check exact occurrence and limits only;
never treat a scripted model or literal copying as semantic fidelity proof.

T7. Include explicit limitation controls: a perfectly copied but incomplete
source selection can omit the qualifying context; a labeled preview can clip
the decisive words; neutral/source-derived previews can weaken classification
or later retrieval. Successful byte/receipt identity must not imply semantic
support, temporal validity, adequate coverage or safe actions. This candidate
does not fix unselected source loss, infer links or replace permission checks.

T8. Use `tools/testing/run.mjs` / owned workspace cleanup on success and failure.
Worker runs focused suites on Node 22.16 and 24.15, reports actual exits and
independently cross-checks scoped file inventories. Primary reads actual diff,
reruns integrated paths and contributor gates, and freezes one candidate for
separate nonauthor Standards/Spec reviews and latest-head CI. Only this plan,
the module, prompt and test are worker-owned (four files). No core, adapters,
schemas, existing experiments/results, user data or defaults change. No merge,
release, deployment, old-run retry or historical cleanup.

## Later empirical gate, not executed or authorized by this packet

Do not declare memory fidelity 100% merely because every preview is a copy.
Evaluate adequacy of selected source sets, preservation of qualifiers and
supported downstream answers, including missing information and mistakes.
The first live feasibility must establish valid selection/compiled-output bounds
and actual normal classification/recall with fresh sources. Only after that
review should a separate prospective comparison be frozen. Reuse the common
source-only answer policy and unchanged model/bounds; disclose all representation
and metadata differences and equal per-session capture budgets. Small all-source
diagnostic success still does not establish large-store MOC recall.

One possible design is eight fresh coherent sessions, each with three bounded
capture batches followed by three later questions (24 paired answers). It must
avoid making every answer an explicitly cued repeated statement and must record
cross-batch loss, current versus historical state, assistant information and
unknowns. Source author and rubric reviewer stay independent of implementation
and output. Actual wire budgets and session-store behavior need separate checks;
this sketch is not a frozen corpus or an executable grant.

The original role-study result and all older thresholds remain unchanged.
Any later comparison needs a prospective success rule, no post-result threshold
change, preserved first-attempt failures, independent masked judgment, resource
accounting and an advance/revise/stop decision. Formal LongMemEval/Mem0, separate
reliability challenge, installed Hermes new-session use and resource fit remain
unpassed product gates. Original cumulative US$400 and protected US$30 remain;
there is no new paid call in this offline implementation.

## Ownership and checkpoint

Primary owns mechanism selection, this preimplementation contract, integration,
acceptance and delivery. One bounded actual GPT-6.1 Sol/high worker owns the four
files; independent nonauthors review the final fixed diff. Initial implementation
timebox 60 minutes with checkpoints at contract, integrated behavior and tests;
rescope after two unsuccessful correction rounds. Existing result publication
continues separately in PR #431. The user requested a discussion checkpoint by
2026-10-17 03:09 UTC if work remains ongoing; do not silently extend it.

## Offline implementation evidence

Worker implementation remains uncommitted at the fixed base above. The public
API is evaluation-only `prepareSourceSelectionMemory(captureJSON)`,
`sourceSelectionMemorySchema(prepared)`,
`compileSourceSelectionMemory(prepared, selectionJSON)` and
`createSourceSelectionModel(prepared, injectedPort)`. Preparation fixes the
existing indexed-evidence policy rather than accepting another capture mode.
Both source and selection boundaries require JSON text. The injected port has
`selectSources`, a local `countTokens`, `contextWindow`, and optional unchanged
`classify`; it has no provider client. Ordinary core callers receive the normal
compiled indexed-extraction object. The wrapper measures the substituted input,
raw selection JSON text and compiled output independently, and publishes its
completed observation only after output counting and the final abort check.

T1–T4 checks cover frozen/detached handles and catalogs, strict shapes/identity/
Unicode, forged handles, exact baseline matching through data descriptors,
five groups/four receipts, order and cross-group reuse, duplicate receipt
identity rejection, clipping at surrogate and space boundaries, accessor/proxy
outputs without execution, raw/compiled token and wire limits, missing ports,
unchanged bound classification, cancellation including an uncooperative port,
and one-shot failure/staleness. The actual core deadline check uses a 1,000 ms
budget and a separately bounded readiness race, rather than a fragile 40 ms
startup assumption. Completed observations remain absent on failed output or
late cancellation.

T5–T7 checks use only newly written synthetic Lumen hatch/tag dialogue. They
exercise ordinary capture, successful new-L1 placement, the actual classification
revision (strictly later than admission), cold exact receipt reads and existing
source-evidence recall. Scripts select only indices/refs present in their actual
inputs. Shared-source groups deduplicate through ordinary core behavior; metadata,
namespace isolation, correction and forgetting remain authoritative. A condition
beyond a clipped preview reaches source-only rank/final context when selected.
Controls show that exact copying cannot restore an unselected later condition,
and clipping the subject can leave an otherwise retained source unfiled. An
applied empty placement is explicitly distinguished from successful new-L1 filing.
These assertions verify occurrence, bounds and lifecycle, not semantic QA.

Focused verification (22 tests, no skips/failures on each runtime):

- `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/source-selection-memory.test.mjs`: exit **0**.
- `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/architecture/test/source-selection-memory.test.mjs`: exit **0**.

The owned-workspace test also deliberately throws an assertion inside its own
fixture and verifies cleanup in `finally`. No caller-owned temporary directory
is scanned. Primary contributor gates and independent fixed-diff reviews remain
the primary's delivery work; the worker has made no commit, push or PR.

### Actual-tokenizer capacity probe

An additional offline inline probe used the existing read-only
`countOpenAITokens` export from the unchanged sibling
`role-stratified-extraction/adapters/openai/index.mjs` (`o200k_base`, literal
special tokens treated as text). It did not install dependencies or invoke a
provider. Both pinned Node commands exited **0**, producing identical counts:

| Synthetic source family | Canonical source units | Compiled preview units | Replacement input tokens | Selection JSON tokens | Compiled output tokens | Wrapper result |
| --- | --- | --- | --- | --- | --- | --- |
| English inspection prose | 5 × 800 | 5 × 600 | 1,070 | 34 | 632 | accepted |
| CJK inspection prose with non-BMP emoji | 5 × 800 | 5 × 600 | 4,970 | 34 | 3,072 | `invalid_model_output` |

Probe construction: each message repeats either
`Amber-tag inspections require signed cards before Lumen hatch access; record each completed check. `
or `琥珀標籤尚未簽署，檢查艙門前必須取得許可並核對條件。😀`;
take a code-point-safe 800-unit prefix, use alternating user/assistant roles and
five distinct source IDs. Try zero through seven leading `甲` characters to make
each compiled preview exactly 600 units despite clipping boundaries. Select one
group per actual input catalog index, with no free-form output. Measure with
`modelRequestText` and `JSON.stringify(compiled.output)`, then invoke the wrapper
with the real local counter and context window 8,192. Only fixed counts and closed
outcomes were printed; no store or live call was involved.

Five groups and 600 units per preview are maximum structural bounds, not a
promise of fitting the unchanged 1,024-token compiled-output cap. The CJK case
is a concrete feasibility limit even though its replacement input and selection
text fit. Rejection remains atomic: there is no auto-shortening, partial group
acceptance, repaired selection, quota increase or fallback. Later live feasibility
must assess these failures before any quality comparison; copying alone does not
establish adequate coverage or semantic fidelity.

## Prospective preview-budget amendment (primary, before any live execution)

The real-tokenizer probe above exposed a representation feasibility defect:
valid source selection can overflow the unchanged compiled-output cap. Preserve
that observed failure; it is not a failed paid case and no historical cohort is
reused. Before the first candidate commit, T3/T4 are amended narrowly as T9:

- Keep the pure default 600-unit compiler and all exact selection/schema/source
  checks. Allow only explicitly named preview-size tiers of 600, 400, 256, 160
  and 128 UTF-16 units, counting the existing label and incomplete marker inside
  each tier. The injected wrapper tests tiers in that order using its real local
  counter and selects the first complete compiled output fitting 1,024 tokens.
  Do not assume token counts are monotonic or use binary search. There are at
  most five compiled-output measurements, plus the existing final core check.
- This is query-blind, deterministic **preview** allocation, not proposal repair:
  fully validate all selected groups before allocation; preserve every selected
  index, order, original full receipt, kind and conservative confidence. Do not
  shorten an invalid model response, drop a group, modify an attached source,
  increase a cap, call a model again or hide incomplete previews. Raw selection
  text still independently must fit 1,024 tokens. If no tier fits, reject.
- Observe the selected tier separately from persisted ordinary output. Failed
  output/abort must not publish a completed observation. Cancellation and
  deadlines are checked between bounded compilation/counting operations, and
  invalid/unavailable token counts remain failures, never a fallback tier.
- Add focused controls for default unchanged English output, a smaller fitting
  tier with identical full receipts, a nonmonotonic counter, all tiers exceeding
  the bound, counter failure/abort during allocation, invalid later-group
  rejection and no extra model call. Re-run the actual-tokenizer English/CJK
  probe and report both old and new results without equating fit with quality.
  Shorter previews can worsen filing/recall and remain an explicit limitation.
- Correct the worker's uncommitted promise hardening regression narrowly:
  ordinary native promises may carry Node async-hooks symbols. Refuse an own
  constructor descriptor or nonstandard promise prototype without invoking
  accessors; do not reject runtime symbols merely for existing. Retain a
  constructor-accessor negative control and actual async/cancellation tests.
  Record the explained 19/22, exit 1 intermediate runs; the earlier 22/22 runs
  are stale until final re-verification.

This amendment changes no core, production default, corpus, live-run gate or
retention permission. The same worker owns the same four paths and reports the
bounded correction for primary acceptance and independent fixed-diff reviews.

### T9 implementation and final worker verification

The pure compiler's third argument now accepts only those five explicit numeric
tiers, defaulting to 600. The wrapper first validates the complete selection,
then measures whole compiled outputs in the frozen tier order. It makes no
monotonicity assumption. The inner existing `callModel` bounds the replacement
request and canonical selection response; raw selection text is independently
counted. Allocation adds at most five complete-output measurements, and the
ordinary outer core performs its final compiled-output check. Only a completed
allocation publishes `previewUnits` with its groups/output observation. No
selected index, receipt, kind or confidence is changed by allocation.

Retained intermediate verification failures (both pinned runtimes):

- A promise-hardening attempt rejected every own property on native promises.
  Node test/async-hooks runtime symbols made ordinary async, cancellation and
  deadline cases fail: **19/22, exit 1**. The corrected guard rejects only an own
  constructor descriptor or nonstandard prototype; accessor and real async/
  cancellation controls pass. No getter execution was needed to diagnose it.
- Adding smaller-tier allocation to the real-core integration initially used
  a synthetic counter that assumed every counted string was JSON. Core also
  counts plain navigation labels, so classification failed: **24/25, exit 1**.
  The fixture now accepts those strings and retains its targeted output-budget
  behavior. This was a fixture error, not a changed classification contract.

Final focused runs after both corrections:

- `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/source-selection-memory.test.mjs`: **25/25, no skips, exit 0**.
- `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/architecture/test/source-selection-memory.test.mjs`: **25/25, no skips, exit 0**.

T9 adds exact-tier/Unicode/receipt identity checks, first-fitting sequential
allocation under a nonmonotonic counter, all-tier overflow, counter errors and
abort during allocation, invalid later-group rejection before any compiled-output
measurement, no extra selection call and absent completed observations on
failure. The real-core new-L1/cold source-evidence recall check now deliberately
selects the 400-unit tier and still verifies the later classification revision
and full necessary qualifying receipt.

The same offline actual-tokenizer probe was rerun after T9 on Node 22.16.0 and
24.15.0, with identical observations and command exits **0**. Explicitly naming
tiers in the prompt adds 31 input tokens; the original failing evidence above
is retained unchanged.

| Family | Current replacement input tokens | Raw selection tokens | Output tokens by tier 600 / 400 / 256 / 160 / 128 | Selected tier | Accepted output tokens |
| --- | --- | --- | --- | --- | --- |
| English | 1,101 | 34 | 632 / 462 / 335 / 252 / 222 | 600 | 632 |
| CJK + non-BMP | 5,001 | 34 | 3,072 / 1,932 / 1,114 / 560 / 375 | 160 | 560 |

The compiler still produces five exactly 600-unit previews by default on both
families; only the explicitly amended wrapper selects a smaller tier when
necessary. All full 800-unit original receipts remain unchanged. This establishes
bounded feasibility for these two synthetic inputs, not universal fit or improved
QA. Shorter previews can hide more context and weaken filing/recall.

Entrypoint/caller trace: `rg -l` for the new module and exported prepare/compile/
wrapper names finds only this plan, the new evaluation module and its test. The
module reads its new prompt; there is no browser replay, runtime host consumer,
old URL/text dependency or cross-feature caller to update. The worker owns those
checks; primary owns integration acceptance and contributor/review gates.

Scoped inventory is mechanically cross-checked by two routes: repository-wide
`git diff --name-only` plus `git ls-files --others --exclude-standard`, versus
filesystem traversal of `docs/plans` and `evaluation/architecture` with Git blob
hashes compared against the fixed base's `git ls-tree`. The sorted inventories
match at **4 files**: this plan, the module, its prompt and its test. `git diff
--check` exits **0**. Each untracked addition was also inspected with full
`git diff --no-index --check /dev/null <path>` output: exit **1** for the addition
diff, with no whitespace diagnostics. No commit, index staging, push, PR,
dependency install, user-store write or provider call was performed by the worker.

### Provider-schema compatibility correction

Before candidate freeze, the advertised provider schema omits `uniqueItems`
conservatively. The official OpenAI documentation lists `minItems` and `maxItems`
as supported array constraints but does not document `uniqueItems` in that
supported subset. This is a compatibility inference from the documented subset,
not an observed API rejection or a paid feasibility result. See the
[official Structured Outputs guide, Supported properties](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses#supported-properties).
The OpenAI Docs skill guided source verification; no API request or paid trial
was made. The focused schema assertion checks the supported field subset and
the absence of that keyword. Compiler checks still reject duplicate selected
indices and duplicate receipt identities atomically; their negative controls
remain unchanged. The prompt, core and persisted schema are unchanged.

After this compatibility correction, the same focused command above passed
**25/25 with no skips, exit 0** on both pinned Node 22.16.0 and 24.15.0. This
includes duplicate-index and duplicate-receipt negative controls; removing the
provider keyword has not relaxed local validation.

## Primary acceptance of the offline candidate

Primary inspected the complete module, prompt and test after the compatibility
correction above. Implementation used one actual GPT-6.1 Sol/high worker;
primary separately performed integration acceptance. A bounded GPT-6.1 Sol/high
documentation worker appends this acceptance record and the central limitations
entry. The implementation worker's four-path scope is preserved; primary's
delivery scope is amended to five paths solely to include `docs/limitations.md`,
as required by CONTRIBUTING's evaluation-evidence rule. No implementation,
prompt, core, default, schema or historical worker evidence changes in this
documentation packet. Runtime base remains
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`; a candidate commit, independent
fixed-commit Standards/Spec reviews and latest-head CI remain primary work.

Primary verification on the final uncommitted implementation:

- Node 22.16 full `npm test`: **660/660, no failures/cancellations/skips,
  actual exit 0**.
- Node 24.15 architecture suite: **108/108, no failures/cancellations/skips,
  actual exit 0**.
- Focused `source-selection-memory.test.mjs` through `tools/testing/run.mjs`
  on Node 22.16 and 24.15: **25/25 on each, actual exit 0**.
- `npm run validate`: **actual exit 0**. Pinned Claude 2.1.260 marketplace
  validation and strict plugin validation each exited **0**, using a fresh owned
  configuration directory that was removed afterward.

Primary's separate read-only actual-tokenizer probe uses new synthetic copper
kiln dialogues, not the worker's Lumen/Amber inputs. Both pinned Node commands
exited **0**, with identical observations:

| Family | Replacement input tokens | Raw selection tokens | Output tokens by tier 600 / 400 / 256 / 160 / 128 | Selected tier |
| --- | ---: | ---: | --- | ---: |
| English | 1,106 | 34 | 632 / 467 / 347 / 257 / 237 | 600 |
| CJK + non-BMP | 4,086 | 34 | 2,612 / 1,646 / 949 / 479 / 326 | 256 |

The same primary probe drives real core capture with the actual local counter:
five selected groups produce five admitted and normally filed memories;
classification revisions are later than their admission revisions. Cold reads
preserve exact receipts, and normal source-evidence recall returns all five
memories without memory prose. The countersigned-tag condition lies beyond the
preview yet remains in the full attached receipt and recalled source context.
Selection, classification and recall ranking are scripted: this establishes
bounded integration and occurrence, not semantic QA, autonomous filing quality,
adequate source selection or natural-session reliability. Both runs removed
their owned synthetic store scratch.

The primary probe initially exited **1** on both runtimes: its intended five
800-unit messages used a 750-unit prefix plus a tail, exceeding 800 units in
total and producing ten canonical windows. Primary corrected only that probe
fixture to use `800 - tail.length` prefix units. The repeated probe passed
without changing the public implementation. This fixture failure is separate
from the worker's preserved capacity and intermediate test failures above.

The smaller CJK tier fits these inputs while copying fewer preview characters;
that tradeoff can weaken normal filing or retrieval even when every selected
full receipt survives. No universal fit, memory-fidelity score or downstream
answer gain is established. The separate proposed two-session live feasibility
has **not executed** and has no promised pass. This packet makes no provider
call, publishes no paid result and grants no new spend authority. Agent time and
review cost are not measured here.

The documentation worker rechecked callers: the evaluation module and its
focused test are the only code matches for the new module/export names, with
this plan as documentation; the module reads its dedicated prompt. No runtime
host, browser replay, old URL/text dependency or cross-feature caller requires
an update. The only new documentation entrypoint is the central limitations
link to this existing plan. Final inventory and whitespace checks are recorded
below after the two documentation edits.

The delivery inventory matches independently between Git diff/untracked names
and filesystem traversal/base-blob hashes: **5 paths across 1,635 inspected
files, actual exit 0**. The only additional delivery path is the central
limitations index; module, test and prompt SHA-256s remain unchanged. Worker
`git diff --check` exits **0**; an explicit untracked-plan whitespace check also
reports no whitespace diagnostics. No commit, push, PR or paid execution was
performed by the documentation worker.
