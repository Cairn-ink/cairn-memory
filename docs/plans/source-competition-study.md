# Source competition: bounded extraction study

Status: implemented offline; final primary gates and independent delivery reviews
remain pending. No paid execution or product fix.
Base56d383cdfafa371c2bbe05ef695dc4c099507cc2, branch
feat/source-competition-study, dependent targetfeat/source-role-ablation-guard.
This reuses the accepted extraction-only accounting engine; generic guards
continue to deny indexed extraction. It is not a new benchmark framework.

## Motivation and frozen hypothesis

The closed six-case comparison completed all pairs but Cairn answered2/6 and
Mem04/6. In two Cairn failures the critical source window was absent from
accepted extraction evidence; other failures occurred later. This study asks
only whether smaller whole-message batches preserve important source details
more faithfully. It cannot establish MOC navigation quality or competitive parity.

N36 private preparation, accepted by primary and two independent reviewers,
has eight fresh synthetic cases, sixteen achievable anchors including two
assistant anchors. The five-window boundary is separate. Corpus SHA256
a5169b632c8a986fea37e6fec0d6def3e50b3c096d1b2ca2c5813c277ef83daa.
Keep case text/roles/order and thresholds unchanged. Control8batches versus
candidate16, maximum10canonicalwindows per candidate batch. Same baseline
extraction prompt/model6000input/1024output/5items/4windows. Extra aggregate
item capacity is a disclosed treatment cost, not equal-budget accuracy.

## Acceptance fixed before code

- C1 Assets/separation: publish separate source-only fixture and evaluator
  fixture/contract from the already-frozen corpus, plus the finite preparation
  and compiler/operator. Exactly eight cases, original IDs/roles/order/text
  reconstruct unchanged; anchors/gold never imported into model preparation.
  Actual canonical snapshots/catalog/planner/local tokenizer only. Require all
  twelve relevant frozen runtime modules to have identical source content to
  the N36 runtime; report any mismatch before coding around it. No source
  padding, input truncation, prompt change or cap widening.
- C2 Compilation: actual control planner and ten-window whole-message candidate
  produce8+16slots and48count/generation maximum. Alternate logical arm order
  oddcontrol-first/even candidate-first, preserve sub-batch order. Bind exact
  sources, prompt/schema/model/request bodies and case/arm/subbatch/message
  indices before outputs. Same gpt-4.1-mini-2025-04-14. Existing24-slot N28
  roster is not interchangeable merely because counts coincide.
- C3 Capability: add a distinct fixed study profile on the existing shared
  guard and v4 bound-ledger reserve/send/parse/settle path, not a parallel engine.
  Fresh create-only capability and exclusive durable once-only claim must bind
  assets, evaluator contract hash, runtime/operator, roster, exact bodies and
  original policy/checkpoint. No old grant reuse or generic indexed allowance.
  Exactly1,000,000microUSD round ceiling and48physicalrequests maximum; original
  cumulative400,000,000 and protected30,000,000 remain. Full conservative ceiling
  preflight, complete ancestry/owned-history checks, no pending/foreign rows.
  Consume claim before live guard return even for zero-send constructor failure.
  Only next slot, count then generation, at most one active scope/request,
  immutable rechecks, sealed completion/refusal and no retry/restart/reorder.
- C4 Operator/evidence: programmatic explicitly supplied trusted key/transport/
  config/capability only; no environment discovery or auto grant creation.
  Use actual guarded adapter, checkExtractionFits/callModel/extractedWindowItems.
  Preserve bounded unmodified parsed extractor output BEFORE source binding,
  including when binding refuses, and separately retain bound items/receipts.
  Exact raw HTTP bytes are not required; clearly distinguish parsed observation
  from raw provider response. Guarded malformed-response handling remains
  fail-closed; never log raw errors, headers or credentials. All24slots/16logical
  arms visible as completed/refused/not-run. Durable persistence callback is
  inside scope advancement; failed persistence halts and never permits replay.
  No capture/admission/classification/recall/Mem0/answer/judge calls allowed.
- C5 Semantic protocol: freeze before real outputs the primary prospective
  review rules, not an automatic quality claim. Anchor credit requires claim
  AND same-item receipts to support complete material meaning, one credit per
  logical arm. Four-window relationship needs one fully supported item; five-
  window complete-chain claim is not eligible and must not be fabricated.
  Distinguish earlier batch-local historical fidelity from a later corrected
  current state; no invented reconciliation. Both independent reviewers see
  every item, no treatment labels/hypothesis direction/other review. Structure
  may reveal partitioning: call this label-blinded, not guaranteed blinding.
  Agreement required; unknown/disagreement blocks advancement. Gate: gain>=2of16,
  lose no control-retained anchor, retain both assistant anchors, no increased
  logical-arm structural refusals, zero observed candidate unsupported promotion,
  citation insufficiency or chronology errors. Refusal counts also reported per
  batch. Empty valid extraction is zero coverage, not structural refusal.
  No post-output tuning, retry or hidden case replacement.
  Pre-output adjudication clarification: source coverage is union-of-receipts
  coverage of all frozen support passages, distinct from same-item semantic
  credit. Each reviewer first freezes all-item fidelity judgments without
  anchors, then independently maps anchors without labels/scores/other review.
  Unsupported attribution counts as citation insufficiency; advice-to-adoption
  as promotion. Zero-error gate applies to valid canonically bound claims;
  rejected parsed proposals remain reviewable diagnostics, no credit. A logical
  arm with any refused sub-batch counts as refused; valid bound items from its
  other completed batches remain credit-eligible, without relabeling the arm
  completed. Earlier local18:00 extraction cannot establish later current
  state; control seeing the correction must frame18:00historically.
- C6 Safety/observable tests: real adapter→guard→synthetic ledger, 24slots/48sends,
  unchanged generic indexed denial and old N28/mixed behavior. Cover asset/body/
  prompt/model/roster drift, order/overlap/late callbacks, duplicate/replay/claim
  race, stale/pending/foreign ledger, caps/reserve checks, no send before reserve,
  malformed and structural refusal, unmodified parsed observation on binding
  failure, settlement/persistence failure, all terminal/not-run denominator,
  zero secret-canary leakage and owned success/failure cleanup. Actual Node
  22.16.0/24.15.0 exits; no live data/key/ledger or install/rebuild. Retain honest
  preimplementation missing-authority RED and generic-denial control.
- C7 Delivery: all affected contributor gates and primary direct acceptance,
  independently cross-checked file inventories, final committed diff reviewed
  by separate nonauthor Standards/Spec reviewers, latest-headCI+mergeability.
  No merge/release/deploy; no paid invocation before separate exact operational
  freeze and immediate existing-ledger/budget validation. Offline green is not
  a semantic score or permission to replay any closed experiment.

## Ownership and scope

Implementation: n21_timeout_diagnosis61, actualGPT-6.1Sol/high. Primary owns
design, direct integrated verification, delivery and any later live decision.
Read-only nonauthor reviewers own independent final axes.

Allowed additions: evaluation/source-competition/{sources.json,evaluator.json,
protocol.md,index.mjs,operator.mjs}; two focused tests under existing
evaluation/longmemeval/test and evaluation/experiment-budget/test; optional
test-only fixture helper only if existing helper cannot be reused unchanged.
Allowed modifications: evaluation/experiment-budget/request-guard.mjs,
package.json and integrations/client/test/pairing-guards.test.mjs only matching
test-list additions, this plan, docs/experiment-request-guard.md and
docs/limitations.md. Stop and report before other changes. Core/adapter/ledger
schema/dependencies/old assets and authentic private artifacts stay unchanged.
New fixture JSON may be a mechanical split of frozen data, but must be verified
back to its exact original semantics by two independent comparisons.

Primary prospective detail lives at
/tmp/cairn-source-competition-primary.AIuqzeQc/PROSPECTIVE.md; copy its semantic
rules into protocol.md while removing machine-local paths. Clarification before
implementation: C4 requires bounded parsed extractor observation, not exact
HTTP byte retention; do not add a transport recorder merely for this study.
Use the canonical owned test runner and existing trusted fake-transport seams.
Follow the two-failed-correction escalation policy. No commits/push by worker;
primary freezes after verification. Read-only named dependency symlinks are
setup only; never mutate their shared targets.

## Implementation boundary and caller trace

Actual GPT-6.1 Sol/high authored this packet. All twelve extraction source pins
were verified against both fixed base56d383c and N36 runtimecce0c551 before code:
byte-identical, no compatibility workaround. Core, adapter, ledger, schemas,
prompts, accepted caps and old N28 assets remain unchanged.

Source-only `evaluation/source-competition/index.mjs` uses actual
`planCaptureMessageBatches`, `captureSnapshot`, `sourceWindowCatalog`,
`extractionRequest`, `checkExtractionFits`, the real local OpenAI tokenizer
and `callModel`. Its compiler has only a fixed fake HTTP transport. The
evaluator is never parsed by model preparation. The split source/evaluator/gate
reconstruct the original corpus via deep equality and a second per-case
serialized comparison: eight cases, 96 unchanged messages, original SHA matched.
The focused test independently reconstructs the full original JSON hash.

`prepareSourceCompetitionExecution` lazily compiles all frozen bodies;
`authorizeSourceCompetitionCapability` creates a separate fixed capability;
`createSourceCompetitionRequestGuard` consumes its separate claim before
returning the guard. The two closed extraction profiles share only their
existing capability/constructor boundary helpers and the same
`constructBenchmarkGuard` reserve/send/settle/history engine. There is no
public arbitrary-profile factory, duplicate ledger or ledger-schema change.
Old N28 still has its original version, shape, roster and 2M ceiling; this
profile is separately versioned and exactly 1M/48. Generic denial remains.
The filesystem/SQLite threat boundary is unchanged: immutable grant files are
rechecked before reserve, and the complete bound-ledger witness is checked in
the existing transaction, not an atomic cross-filesystem transaction.

`runSourceCompetition` uses actual guarded HTTP, snapshots parsed proposals
before `extractedWindowItems`, then persists inside the scope. Whole binding
refusal is never partially repaired. Valid claims remain separate from parsed
diagnostics. Malformed or unavailable observations stop remaining work, while
ordinary observed structural refusals may continue to the next frozen batch.
All 24 batch and 16 logical-arm positions remain explicit. Any refused batch
marks its logical arm refused; valid items from other batches remain reviewable.
The callback's pending record and actual post-callback returned persistence
status are distinct. Post-persist accounting failure is not mislabeled IO failure.

## Scoped files and discovery

Exactly 13 delivery paths; the three authorized read-only dependency symlinks
are setup only and excluded. No optional helper was needed: existing
`source-role-ablation-fixture.mjs` is reused unchanged for synthetic ancestry.

- evaluation/source-competition/sources.json
- evaluation/source-competition/evaluator.json
- evaluation/source-competition/protocol.md
- evaluation/source-competition/index.mjs
- evaluation/source-competition/operator.mjs
- evaluation/longmemeval/test/source-competition.test.mjs
- evaluation/experiment-budget/test/source-competition-guard.test.mjs
- evaluation/experiment-budget/request-guard.mjs
- package.json
- integrations/client/test/pairing-guards.test.mjs
- docs/plans/source-competition-study.md
- docs/experiment-request-guard.md
- docs/limitations.md

The guard CI script and its exact historical expectation append only the new
guard test. The existing LongMemEval glob discovers the new compiler/operator
test. Final two-route inventory and hash evidence is recorded at handoff.

## Verification and retained observations

Keyless canonical commands use the exact Node22.16.0 or Node24.15.0 executable
under `env -i PATH=<exact-node-directory>:/usr/bin:/bin TMPDIR=/tmp
NODE_DISABLE_COMPILE_CACHE=1`. Flags precede file paths. Main focused command:

```sh
node tools/testing/run.mjs --test-concurrency=1 evaluation/experiment-budget/test/source-competition-guard.test.mjs evaluation/longmemeval/test/source-competition.test.mjs
```

Preimplementation API-absence RED: Node22 actual exit1, because the new
`prepareSourceCompetitionExecution` export was undefined. This reproduces
missing authority, not a retention or semantic bug. The initial duplicate
generic-denial draft had two setup mistakes (wrong factory name; legacy
non-embedding factory given a v4 ledger). Primary directed reuse of unchanged
W10 instead and independently ran it: actual exit0, 1/1. The redundant draft
was removed; generic denial was not relaxed.

Initial guarded drafts exited1 because tests tried to continue after fatal
body drift, invoked a late callback outside its retained ALS context, expected
the nonexistent closed-scope error, or inserted foreign rows on every getter
read. Primary accepted bounded corrections: separate fresh drift fixtures,
late promise descendant released in the next active scope, once-only foreign
insertion and actual fixed errors. A later successful 48-send run still exited1
on the final replay assertion: evolved history fails `policy_mismatch` before
claim inspection. Replay denial is the contract, not a universal consumed-error
promise; the zero-send concurrent claim separately proves exclusivity.

Further expanded drafts exited1 on fixture setup: pending history is rejected
by the ledger as `budget_blocked`; the missing-assets archive initially omitted
the existing redaction module; a child-eval newline literal was escaped
incorrectly. These were corrected without product or validation changes.
Owned subprocess faults prove postclaim failure, a real foreign row between
outer verification and reserve, and durable settlement failure; failure-path
workspace cleanup is asserted with zero residue.

Oversized observation fixtures also exited1: the unchanged adapter and core
both enforce actual locally tokenized output at most1024tokens (and text at
most40,000units) before returning parsed output. They correctly never reached
the observer, so `not_observed` was not a product defect. After two failed
fixture rounds, primary took narrow test-only ownership of the reachable
depth-bound control: malformed JSON, actual upstream token rejection and
reachable depth12 output below1024actualtokens are now distinct controls.
Primary independently reproduced the prior failed expectation (actual exit1),
then observed the narrow final control pass on both Nodes (actual exit0, 1/1
each). No production code, cap, fake counter or new export was introduced.
The defensive64,000serialized-UTF8-byte limit remains
implemented; no unreachable live-path byte-overflow proof is claimed.

Historical operator checkpoint: Node22 actual exit0, 7/7 before expanded
controls. Narrow unchanged N29 regression selection is recorded separately
from the final focused runs. Primary owns required full generic/JSON/maintainer,
guard/budget, LongMemEval/ingestion, adapter/native/demos, final snapshot,
independent Standards/Spec review and CI. Offline synthetic green is not
semantic review, a quality result or paid-run permission.

Final author verification (all keyless, serial, no provider):

| Check | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| Two new focused files, command above | exit0, 21/21, no skips | exit0, 21/21, no skips |
| Unchanged N29 four selected authority/scope/history/envelope controls | exit0, 4/4, no skips | exit0, 4/4, no skips |
| Unchanged W10 generic indexed denial | primary exit0, 1/1, no skips | author exit0, 1/1, no skips |

Narrow legacy commands (same canonical environment and flags-before-files):

```sh
node tools/testing/run.mjs --test-concurrency=1 '--test-name-pattern=N29A actual adapter serialization|N29B next slot|N29C grant recheck|N29C full reservation' evaluation/experiment-budget/test/source-role-ablation-guard.test.mjs
node tools/testing/run.mjs --test-concurrency=1 '--test-name-pattern=W10: existing grant factories deny' evaluation/experiment-budget/test/request-guard.test.mjs
```

Independent final discovery compares `git diff --name-only` plus
`git ls-files --others --exclude-standard` against
`git status --porcelain=v1 -z --untracked-files=all`: equal13deliverypaths,
excluding exactly3known setup links. JSON parse/source reconstruction, matching
three locked dependency sets and `git diff --check` all exited0. Explicit
success/failure workspace assertions plus a separate check of the two known
earlier failure runner roots establish zero remaining owned residue; no
historical temp sweep was performed. Final full hashes are supplied with the
author freeze, including the plan; no self-referential manifest was added.
Required integrated gates, candidate commit/reviews and CI remain primary-owned
and pending, not inferred from these focused runs. No commit, push, authentic
ledger access, credential lookup or paid invocation was performed by the author.

## Post-freeze logical-arm aggregation correction

Primary's 24 integrated commands all exited0 on the first frozen13files, but
missed refusal followed by not-run within the same candidate arm. Direct
inspection found that the logical-arm aggregation tested not-run first,
contrary to C5's any-refused-sub-batch contract. A temporary owned actual
operator regression exited1 on Node22 (author72358e; independent primary45c5eb):
slot1completed, slot2malformed/refused, slot3not_run,4sends, counts1/1/22,
but the candidate logical arm incorrectly reported not_run. A separate
completed-plus-not-run post-persist foreign-history control passed and retained
valid evidence. This is a deterministic reporting defect, not semantic evidence.

After the original full gates closed, primary authorized only operator, this
plan and the existing focused operator test to change. Refusal now takes
precedence; completed-plus-not-run remains not_run. Both regressions are in the
normal LongMemEval test discovery path. All raw rows, bound evidence, transport,
caps, fixtures and advancement thresholds remain unchanged. Corrected focused
verification and integrated/review acceptance are recorded separately below.

Corrected author verification used the same keyless canonical environment and
flags-before-files commands above. The isolated selection
`--test-name-pattern=C5 regression` against the operator test exited0, 2/2 with
zero skips on Node22.16.0 and24.15.0. The complete two focused files then
exited0 on both exact Nodes, 23/23 with zero failures or skips. Owned success
and failure fixture cleanup remained enforced by the canonical runner.
`git diff --check` exited0; independent diff-plus-untracked versus porcelain
discovery still finds13deliverypaths, excluding exactly3known setup links.
Only the three authorized correction paths differ from the preceding freeze.
At author handoff the primary's corrected whole-suite gates remained pending;
the preceding24command success was historical, not proof of corrected bytes.

## Primary integrated acceptance

Primary independently reran the original two-case reproducer: exit1 before the
fix (one pass/one failure), exit0 after (2/2). The deterministic cause was
not-run-first aggregation, not missing raw evidence or an execution success.
The normal discovered tests now distinguish both mixed outcomes.

Primary's original24commands completed with actual exit0 each on exact
Node22.16.0 and24.15.0, including generic581, budget67, guard356,
native-gateway85, LongMemEval328, OpenAI332 and workspace25tests per version,
plus JSON/maintainer validation and budget/guard/ingestion demos. These ran
against the first frozen13files; all before/after hashes matched. Direct
inspection then found the aggregation gap; those green commands did not
override the later failing regression.

After the three-path correction, primary ran the complete guard and
LongMemEval suites plus JSON validation again on both exact Node versions.
All six commands exited0: guard356/356 and LongMemEval330/330 each, zero
failures/cancellations/skips. Node versions ran concurrently in independent
owned workspaces, with each version's suites serialized. Final13file hashes
stayed unchanged throughout; only this acceptance record was appended after.
The unchanged ten paths retain their original full-gate evidence. The two
complete command/result manifests and raw logs are retained privately under
/tmp/cairn-source-competition-gates.UENqjcqu/{results,revision-results}.json.
There is no TypeScript gate in this JavaScript repository; no core/adapter
implementation or dependency changed and no production build was required.

Primary independently compared diff-plus-untracked discovery with porcelain
status:13deliverypaths, exactly3separate setup links. Original source/evaluator
reconstruction preserves8cases/96messages and the accepted corpus hash;
12runtime source pins and all24prepared requests match accepted N36 preparation.
Local input totals5114control/6706candidate are preparation observations, not
paid costs, measured semantic quality or product latency. No provider request,
authentic ledger mutation, credential lookup, merge, release or deployment
was part of this acceptance. Fixed-commit independent review and latest-head
CI remain separate delivery gates.
