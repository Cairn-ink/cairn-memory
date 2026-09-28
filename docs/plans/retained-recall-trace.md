# Retained-source recall trace: N2

Status: implemented candidate; final primary acceptance and independent review
are in progress. Fixed base:
`88d9556d09d0a7082cae20ea89c2f8fadd64c0d1` (N1, PR #282, with upstream
plugin 0.1.1 integrated).
Branch: `diag/retained-recall-trace`; isolated worktree:
`retained-recall-trace`. This uses the previously authorized dependent-branch
workflow. N1 must pass final CI before N2 implementation begins; no merge is
authorized. Preserve the primary checkout and every historical artifact.

## Goal

Continue toward a lightweight, source-backed memory layer usable by MCP,
Hermes and other harnesses, with demonstrated reliability and comparable
quality evidence. N1 accounts for exact offered windows retained by one fresh
capture. N2 distinguishes why an already retained source did not reach the
answer context. Neither a successful write nor a complete candidate traversal
is a semantic quality score.

The existing long-history gate records source stages through its scripted
model frames; the live collector records aggregate call counts. Do not
duplicate either blindly. Trace these callers and identify the smallest
bounded seam that can distinguish source retention, reference visibility,
model selection, fetched evidence, ranking, final recall and answer packing.
Model-proposed refs are not automatically validated selection. Complete-map
selection can bypass a select callback; absence of that callback alone cannot
mean failure. A label is a routing hint, not authoritative source evidence.

## Acceptance

- **T1 — Red and scope before code.** Run a seconds-scale deterministic
  synthetic public-capture/cold-recall/answer-path test before implementation.
  Preserve exact command and failure. Prove retained evidence and its actual
  downstream loss or a demonstrably wrong stage attribution. An absent new
  helper alone is insufficient evidence of a retrieval defect. Prior PR #280
  is read-only diagnostic context, not proof of a consumed case's cause.
  Share three to five falsifiable hypotheses before one-variable probes.
- **T2 — Bounded observation.** Before implementing, propose the exact API,
  fields, callers and finite resource bounds to the primary. Limit any new
  observer to one recall, at most eight source probes, two selection callbacks,
  one rank callback, one final recall and one actual answer-pack result. Report
  at most 32 KiB of fixed fields, enums, counts and ordinals. Project transient
  metadata rather than retaining full model frames. Extra public reads must be
  explicitly bounded; incomplete evidence remains unavailable.
- **T3 — Honest first loss.** Distinguish a missing reference, a visible ref
  without source text, selection proposal versus validated progression, source
  missing from rank input, rank omission, failed/stale finalization and answer
  packing omission. Handle complete-map bypass, failures, truncated observations
  and never-run stages explicitly; do not convert absence into a zero or a
  semantic root cause. Attribute a first observed gap only when earlier stages
  were positively established. Record text visibility separately from exact
  source identity/role binding and current memory revision.
- **T4 — Public behavior and privacy.** Preserve model receiver, arguments,
  results/errors and call counts. No prompt, limit, deadline, retry, default,
  schema, paid runner or policy change. No source text, question, namespace,
  memory/receipt/source IDs, paths, hashes, raw errors or evaluator labels in
  the report. Do not supply target IDs or expected answers to model callbacks.
  Malformed, getter/proxy-rich, mutated, late and repeated observations cannot
  rebind a trace or alter the actual operation. Correction, forget, namespace
  and revision controls must remain authoritative.
- **T5 — Real consumer and contrasting controls.** Consume the observation in
  the existing fresh offline long-history path, not just a standalone unused
  helper. Keep its existing success/failure denominators and negative controls.
  Exercise public-core cold reads, default and explicit source routes where
  relevant, complete-map and model-selected paths, and a retained-but-missing
  source with a contrasting visible-source positive. Forced empty model output
  can test an observer's negative control, not prove a product retrieval defect.
  Do not manufacture an unreachable packer loss as an observed core defect.
- **T6 — Verification.** Use owned test workspaces and the runner on Node
  22.16 and 24.15; generic test discovery must remain Node 20 compatible.
  Run focused tests, generic/validation and affected contributor gates,
  including the actual long-history consumer and cleanup contract. Record
  exact code SHA, commands, outcomes, unresolved limits and primary reruns.
- **T7 — Delivery and next decision.** Primary inspects the diff and evidence;
  independent Standards and Spec review the same final base-to-head diff.
  Complete latest-head CI and mergeability checks before handoff. No merge,
  release or deployment. A production retrieval correction requires the
  primary to approve demonstrated cause and exact scope first. Quality evidence
  comes from newly frozen prospective cases only after a scoped product change
  and offline proof; never replay/rescore consumed cases or reset a ledger.

## Ownership and exclusions

One bounded GPT-6 Sol/high implementer owns initial test/diagnosis and proposes
the observation seam. Initially allowed edits: this plan and a new focused
test under `evaluation/architecture/test/`. Other implementation files require
the primary's checkpoint approval. Primary owns architecture, shared documents,
package/CI changes if justified, integration, acceptance and delivery. Reviewers
must not implement this candidate.

No downloaded corpus, source answers, evaluators, environment/key files,
operational ledgers or historical paid-run folders. No provider calls, paid
experiments, benchmark-score changes, destructive cleanup or old-case tuning.
Use public aggregate evidence and newly authored synthetic inputs only.

## Evidence log

N1 exact head `88d9556d09d0a7082cae20ea89c2f8fadd64c0d1` passed independent
dual review and 21/21 latest-head CI jobs (run `36474859052`); PR #282 is
mergeable but unmerged. The primary then gave N2 T1 RED-only GO.

T1 uses `evaluation/long-history/retained-recall-trace.test.mjs` with the
owned test workspace and actual public `indexed-evidence-v1` capture, cold
reopened core, `source-evidence` recall and `packMixedAnswer`. An exact retained
fifth receipt is chosen by public `get` receipt-ID order, matching the core's
four-receipt candidate preview; its role, message identity and text are checked.
The 13-card model-selected route has a visible target ref but no target marker
in the label, no rank call, no final memory and no packed source. This is a
synthetic loss control, not evidence that the consumed paid cases share its
cause. The 12-card explicit complete-map route has zero select calls, yet its
same kind of source reaches rank, final recall and the actual answer pack.

Before the attribution test was added, the primary independently reran the
focused Node 22.16 command and observed the 13-card retained-but-missing pack
expectation red: first case passed in 1879.98 ms, second failed in 1551.47 ms,
total 3469.87 ms, exit 1. The deliberately red retrieval expectation was then
changed to an explicit preserved negative control. Only a one-line export of
the existing `observePassage` in `evaluation/long-history/gate.mjs` was added
as the permitted test seam; its body and callers are unchanged.

Current T1 attribution red command, Node 22.16.0:

```text
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/long-history/retained-recall-trace.test.mjs
```

Exit 1 in 4.01 s wall time / TAP 3884.876054 ms. Complete-map case fails only
at the actual gate observer's output: expected `firstDeliveryFailure: null`,
actual `'reference-visible'`, after positive assertions that rank, final recall
and answer pack contain the exact cold-retained source. Its case took
1973.799334 ms. The model-selected retained-source-loss control passed in
1872.389044 ms. TAP: 2 tests, 1 passed, 1 failed, 0 skipped. No provider,
host, historical case or paid runner was invoked.

After relocation to the long-history suite, the same current-path command
reproduced that exact attribution assertion: exit 1, 2.86 s wall time / TAP
2730.023214 ms; complete-map red 1316.473605 ms, retained-source loss control
green 1372.913607 ms. This rerun did not test a causal probe or change the
observer body.

### Ranked, falsifiable hypotheses before probes

1. **Complete-map bypass is misread as missing reference visibility.** The core
   reports `selection.strategy: 'complete-map'` and deliberately skips the
   select callback, while `observePassage` constructs visible refs solely from
   select frames. If this causes the attribution failure, changing only the
   route to model selection on an otherwise equivalent visible source should
   give the old observer a select frame and remove its false
   `reference-visible` failure; it is falsified if the complete-map route
   actually emits a select frame or the gate already accounts for the strategy.
2. **The fifth-receipt preview is the observed model-selected routing loss.**
   The target source is retained but excluded from a label built from at most
   four receipts. If this causes the 13-card synthetic loss, querying a source
   inside those four at the same cardinality, or returning that visible target
   ref from select without changing the retained store, should reach rank and
   pack. Failure of either controlled route would refute this as a sufficient
   explanation. It makes no claim about consumed cases with at most four
   receipts per card.
3. **A raw select proposal can be mistaken for validated progression.** If a
   model returns a non-visible or stale target ref, frame-only accounting may
   report selection even though public core validation rejects the recall.
   One invalid-proposal control should return a public failure and leave later
   stages unavailable; if the gate already distinguishes these, this concern
   is falsified.
4. **A later stage can lose a correctly selected source.** If fetch, ranking,
   final snapshot or packing is independently at fault in this synthetic case,
   a forced valid target selection will still omit the exact source at one of
   those later observed boundaries. If all later boundaries carry it, the
   current 13-card loss is confined to routing/selection. This is lower ranked
   because the current loss control never invokes rank.

Checkpoint: no diagnosis probes or implementation have run after this list.
The primary must evaluate the hypotheses and approve the smallest observation
seam before changes beyond this plan, the focused test, and the one-line export.

The focused test was initially placed under `evaluation/architecture/test/`.
After the red run, the primary's generic-CI audit showed that `npm test` on
Node 22 does not install the isolated `tiktoken` dependency imported by
`gate.mjs`. The test moved to the existing `test:long-history` path, whose
dependency gate already runs the long-history collector. The content and
diagnostic assertion did not change. The red command above names its current
location; the recorded 4.01-second output was from the initial location.

### Approved one-variable probe outcomes

After the primary accepted the actual attribution red and communicated the
ranked hypotheses, it approved only H1–H4 offline probes in this focused test.
The pre-fix red was preserved. Node 22.16.0, same current-path command: exit 1,
8.26 s wall time / TAP 7962.505463 ms; five tests, four passed, one failed
solely on the same complete-map `reference-visible` attribution.

- H1: on one cold 12-card store, the same current source, query and scripted
  model reached the answer in both routes. Only `selectionMode` varied:
  explicit complete-map made zero select calls, while default model selection
  made one and the old observer reported no delivery failure. This supports
  the bypass-attribution hypothesis, not a retrieval improvement.
- H2: on one cold 13-card store, the fifth receipt was retained yet absent
  from the map label and final answer; changing only the query to a receipt
  inside the four-receipt preview reached select, rank, final recall and pack.
  This supports the synthetic preview-routing hypothesis. It still cannot
  explain consumed cases whose cards had at most four receipts.
- H3: on the same source-aware model-selected route, changing only the
  selected proposal's revision to an invalid one caused public core to return
  `invalid_model_output` before rank. The existing gate nevertheless reported
  `selected: true` from the raw frame. The proposal/validation distinction is
  an observed attribution defect; the public core rejected the proposal.
- H4: the valid-selection positive in H2 carried the exact receipt into rank
  input, final recall and the actual answer pack. A later-stage loss was not
  observed in this fixture. No artificial packer omission was manufactured.

### Approved smallest observation seam

N2 remains evaluation-only. The existing `observePassage` and `inspectQuestion`
in `evaluation/long-history/gate.mjs` consume a dependency-free
`evaluation/long-history/recall-observation.mjs` projection. The internal
per-recall API is `createRetainedRecallTrace({ sourceProbe, before, readSet })`,
with bounded
`recordSelect(request, output)`, `recordRank(request, output)` and
`finish({ recall, packed, after })`. `sourceProbe` contains the caller's
expected namespace, memory ID and exact receipt tuple
`(client, sessionId, eventId, role, excerpt)` transiently. It never reaches a
model callback or report. `before` and `after` are actual public `core.get`
results, each requested with `receiptLimit: 100`; the before read establishes
the current memory revision after filing, and the after read checks that same
revision/source binding after recall/packing. A missing, paginated, malformed,
foreign or changed read yields unavailable/stale, not a zero. The caller and
API use exactly one source probe per recall and at most two total public `get`
reads. Each returned page must be exhausted and have a consistent
receipt count of at most 100. No namespace scan or receipt cursor walk.

`scriptedModel` projects select/rank metadata directly into the active
per-recall trace after its existing scripted output is determined, preserving
the model receiver, request, returned object, throw, call count and token
accounting. It no longer clones/stores full select/rank frames for the
long-history consumer. A call-context binding (rather than a global current
target) and a one-shot closed trace prevent late/repeated stage records from
joining another recall. Observation failures are swallowed into an explicit
unavailable status; they never change a core operation. The existing capture
source-window observer stays untouched.

The serialized source-free gate report is capped at 32 KiB; any new trace is
compact and over-budget observation becomes unavailable without changing the
existing denominator. The actual packer may return a body above 64 KiB; that
body is explicitly unavailable to this diagnostic, without changing packing.
The trace contains only version, scope,
closed status, bounded callback counts, selection strategy, stage status
enums, finite callback/count/overflow fields and `firstObservedGap`. For each
probe, separate `retainedText`, `currentSourceBinding`, `currentRevision`,
`referenceVisible`, `routingTextVisible`, `selectionProposal`,
`selectionAccepted`, `rankInputRef`, `rankInputText`,
`rankInputSourceBinding`, `rankProposal`, `rankAccepted`, `finalRef`,
`finalText`, `finalSourceBinding` and `answerTextPresent` statuses. Text
visibility does not imply tuple identity. The flattened answer pack cannot
prove source role/identity, so its binding status is explicitly unavailable.
An actual matching rank input proves selection progression even if a later
stage fails. A successful final target reference proves rank acceptance;
a contradictory earlier proposal alone cannot prove it. Failed validation
remains proposal-only. Complete-map strategy plus a target rank candidate
establishes a bypassed, selected ref without a select callback.
Unavailable, truncated, failed and never-run states remain distinct. The
`firstObservedGap` enum is set only after all earlier necessary stages are
positively established; otherwise it is unavailable or null for delivered
source. The original aggregate keys and version remain, with unavailable stages
represented by their legacy `not-run` value. The new `sourceTrace` distinguishes
unavailable from never-run. Attribution defects are corrected without changing
the gate's seven-passage denominator, existing negative controls or normal-run
results; this is not a retroactive rewrite of historical reports.

The existing fresh `runGate` is the real consumer: `inspectQuestion` supplies
one trace for each of its seven required passages, and existing empty-select,
empty-rank, correction, forgetting and namespace controls stay authoritative.
Focused synthetic tests keep the model-selected retained/missing contrast and
the complete-map false-negative regression. No public core, MCP, Hermes,
plugin, provider, hosted, paid runner, prompt, default, limit or schema changes
were made. This diagnosis does not claim to improve retrieval or a score.

### Implementation verification checkpoint

The initial integrated focused suite passed 10/10 on Node 22.16.0 (TAP
12214.364012 ms) and 10/10 on Node 24.15.0 (11782.241576 ms). The existing
long-history gate passed 5/5 on Node 22.16.0 (29530.200603 ms) and 5/5 on
Node 24.15.0 (25145.839282 ms), preserving its seven passage, 208 batch and
negative-control assertions. The gate test now checks current receipt binding
at rank/final and a 32 KiB byte bound for the whole source-free report.

The primary then requested a direct test of the gate's async call-context
boundary. The focused test now schedules a select output in trace A, closes A,
records another select in active trace B and releases A. The delayed output
remains in A's context and cannot add a B callback. The actual scripted model
still returns its ordinary output and increments exactly two select calls;
the stage hook returns its input object unchanged and a thrown sentinel remains
the same object. A foreign-namespace proposal with the target memory ID is
also not classified as a wrong-revision proposal. A real core counter-mutation
control proves that a raw target rank proposal followed by a successful final
result without that target leaves rank acceptance and first gap unavailable.

The combined long-history suite after those changes passed 17/17 on Node
22.16.0 (TAP 38176.480532 ms) and 17/17 on Node 24.15.0 (46593.390599 ms).
The primary independently reran that same pre-final candidate: 17/17 on Node
22.16.0 (41879.919 ms) and 17/17 on Node 24.15.0 (40430.760 ms). Primary
inspection then found that a malformed public read could supply a matching
receipt ID longer than the core identifier bound. A focused synthetic
malformed-read assertion went red (`observed` instead of `unavailable`, Node
22.16.0 TAP 1740.32681 ms), then green after requiring a well-formed receipt
ID of at most 200 characters. The parsed answer evidence is now also read via
an own data property. Final focused tests passed 12/12 on Node 22.16.0 (TAP
21463.235117 ms) and 12/12 on Node 24.15.0 (20115.092673 ms). The primary's
final exact-candidate gate rerun, independent review and CI are still pending.
No commit, push or PR had been made from the worker worktree when this evidence
was recorded.

### Primary acceptance and ownership

The bounded implementer used actual `gpt-6-sol` at high reasoning effort.
The primary owns architecture, caller audit, shared-document integration and
acceptance, and read the actual helper, caller and tests before accepting the
candidate. Shared integration edits are restricted to this plan, `ROADMAP.md`,
`docs/protocol.md` and `docs/limitations.md`; runtime implementation remained
delegated. Independent reviewers have not implemented this candidate. Agent
token usage and cost telemetry are unavailable and are not inferred.

Worker code candidate `fcf9f7ab0d13e5378a90296d8424e6d52a6d14e8` contains
only the five scoped plan/evaluation files. Primary reran the complete
`npm run test:long-history` on that committed code with
`NODE_DISABLE_COMPILE_CACHE=1` and the named runtime first on `PATH`:
17/17 on Node 22.16.0 (39,670.346 ms), and 17/17 on Node 24.15.0
(38,423.683 ms). This includes the original 208-batch, 1,030-card gate,
seven required passages and eight negative controls. The synthetic fifth-source
loss remains a negative control, not a newly corrected retrieval outcome.

The primary also ran these unchanged compatibility paths in this worktree:

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 143/143, 4.28 s | 143/143, 3.79 s |
| `npm run test:workspace-lifecycle` | 25/25, 14.05 s | 25/25, 14.29 s |
| `npm run validate` | Pass, version 0.1.1 | Pass, version 0.1.1 |

Those commands used `NODE_DISABLE_COMPILE_CACHE=1`. Inspection with
`git diff --exit-code 88d9556 HEAD -- core adapters plugins integrations tools
package.json .github schemas evaluation/architecture evaluation/longmemeval`
confirmed their code and configuration unchanged at the worker candidate.
Strict plugin and marketplace validation uses the identical locked maintainer
binary (2.1.260) already installed in the N1 worktree, resolved through `PATH`
while validating the N2 worktree paths; no second large dependency installation,
lockfile change, publication or real-host session is involved. There is no
TypeScript gate in this JavaScript repository.

Test-only candidate `7e06f1e56a849171ffb342946be08e60553f400b` adds
resource-bound and disclosure controls without changing the helper or gate.
The primary reran `npm run test:long-history` on that exact candidate:
18/18 on Node 22.16.0 (39,182.658 ms) and 18/18 on Node 24.15.0
(38,475.073 ms), with no failures or skips. Strict plugin and marketplace
validation also passed on both runtimes using the arrangement above.

Independent fixed-diff Standards and Spec reviews and latest-head CI remain
delivery gates. No
provider call, paid-case replay, operational ledger access/reset, merge, release,
deployment or historical cleanup occurred. Main and unrelated work are preserved.
