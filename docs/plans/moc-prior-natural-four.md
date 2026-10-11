# Natural MOC-prior paired diagnostic — prospective runtime contract

Fixed implementation base: `2baa91b62cbb02c1187c4d47b780e1f1394ba144`, the unchanged
four source files integrated onto reviewed core `af39a50976c70284f35fb57b2c874b56bf53778f`.
Worktree `/home/chichieh/Github/cairn-memory-worktrees/moc-prior-natural-four`, branch
`experiment/moc-prior-natural-four`. Core PR #396 has both independent reviews and
27/27 latest-head CI PASS. The eventual combined source+runtime PR is based on
`af39a50976c70284f35fb57b2c874b56bf53778f`, not the four-file implementation base.
Worker copies this contract verbatim to `docs/plans/moc-prior-natural-four.md`
before code. Owner: bounded actual GPT-6.1 Sol/high worker; primary integration/
acceptance; two nonauthor independent review axes on the complete final PR diff.
No merge, release, deployment or paid call by the worker.

## Goal and fixed evidence

Test the opt-in core policy under ordinary extraction, natural classification,
selection, ranking and first-answer generation. This is a fresh authored four-case
development diagnostic, not LongMemEval, a held-out result, Mem0 parity, or a fix
for any closed-study case. Source/rubric are already frozen and cannot be changed:
`moc-prior-cases.json` SHA256
`4446a339c252f7b863a80c059048572c8a38f805561b4f898483d0b9ccf97aad`;
`moc-prior-rubric.json` SHA256
`c0238c7755c94be8e849a698697a36524873cf1a7756cc8988c5a72341b9d7cf`.
NF1–NF7 and MP1–MP9 remain authoritative for corpus and core respectively.

## Acceptance

NR1. Add a distinctly named closed profile `moc-prior-natural-four-v1`, roster
P01–P04, two arms `baseline` and `prior`, balanced orders baseline-first for
P01/P03 and prior-first for P02/P04. Strict source-only loader validates the frozen
four-case schema and exactly nineteen unchanged prepared batches per case. Runtime
imports no rubric, anchor indices, proof passages, answer keys or old outputs.
Evaluator/preflight may load separate rubric bytes and bind their hash. Existing
profiles, old manifests/requests/report shapes and closed datasets stay unchanged.

NR2. For each case, capture all nineteen batches once using the real existing
`indexed-evidence-v1` extraction and ordinary classification in one fresh owned
retained SQLite store. No manual admission, classification, target-topic injection,
qualification, rationale pass, causal reconciliation, padding, or retry. Preserve
each capture input/outcome and the admitted sources/placements. At most five new
admissions per batch and at most 95 in a completed store; actual fewer/zero counts
are evidence, not reasons to alter the case. Capture failure retains both planned
arms as unresolved; no half-written history presented as completed capture.

NR3. Cold reopen the same captured store for each arm, with identical ordinary
unwrapped model ports and recall options (`limit:6`, source-evidence mode). Only
constructor policy differs: `bounded-keyset-v1` versus `moc-prior-keyset-v1`.
Both arms independently perform their natural at-most-two select/one rank calls.
No replay coupling, source-diverse/full-label/complementary wrapper, override of
model refs, complete-history answer bypass, extra repair pass or extra answer.
Use existing `verifiedRoleEvidence` and identical `packMixedAnswer`; produce one
first answer per planned arm. Preserve logical-state hash before/after capture
reopen/each arm and stop globally on mutation. These are read-only recall
operations with fences, not SQL-enforced read-only core handles.

NR4. Preserve actual raw extract/classify/select/rank inputs and outputs, selector
page visibility, selected/ranked refs, fetched verified receipts, actual packed
units/final request and first answer or bounded failure. Retain all four cases
and eight slots including unrun; source/currentness/revision checks remain those
of the core and provenance verifier. Analysis after first answers may recompute
bounded source coverage from frozen artifacts, never feed gold into execution.
Record separately: source retained; source actually visible to selection; source
selected; source packed; requested answer correct. A missing stage stays missing.

NR5. Reuse the original guarded transport/ledger, pinned evaluated model
`gpt-4.1-mini-2025-04-14`, input6000/provider7024/coreoutput1024/answeroutput512.
At most 38 capture core calls plus 3 per arm =44 core calls/case; each core call
has count+generation at most two HTTP attempts, plus two answer requests. Across
four cases maximum360 HTTP attempts, each reserving5000microUSD: maximum1,800,000
microUSD reserved, with a separate fixed local ceiling4,000,000microUSD.
Never describe count+generation as retry. Original cumulative limit400,000,000,
protected30,000,000, same original append-only settled checkpoint/history; no
refund/reset/increased cumulative authority. Existing case20min/core logical30s
timeout remains; a fixed four-case run ceiling80min suffices. Auth, redirect,
usage/accounting, credential echo, manifest/runtime/output drift, persistence
and state mutation stop the whole run. Ordinary settled per-case/model failures
remain unresolved and may continue to next pre-frozen case/arm without retries.

NR6. Named prepare/launch entrypoints bind clean committed runtime, all reachable
runtime/control artifacts, corpus/rubric/protocol/limits, exact Node executable,
owned output directory identity and original ledger checkpoint. Existing output
may contain only the explicitly declared preflight artifacts; exclusive started
marker precedes key lookup; callback revalidation precedes dispatch. No implicit
key lookup, new CLI, credential change, resume or second execution. Retain
pre/post request records, case/report and closure durably, and fail closed on
write errors. New-profile persisted errors use closed diagnostic codes, not
arbitrary callback error code/message or secrets. Preserve original failures and
unrun denominator on pre-dispatch failure. Primary alone may later authorize one
fresh execution after exact-head gates and prospective manifest/operator review.

NR7. Separate evaluator-only blind packet with opaque random labels, question,
full original source/rubric and actual packed evidence/answer; no arm labels or
other judge conclusions. Two nonauthor first submissions; keep originals and
missing/disagreed fields unknown. Correctness concerns requested proposition;
support concerns every factual claim against actual packed sources; stale and
severe definitions follow frozen rubric. NF5 abstention applies explicitly:
P04 qualified no-final-choice is correct and abstained=true; known complete answer
false; known refusal true and incorrect; optional uncertainty with complete known
answer false. No retrospective adjudication, fixed4 denominator per arm and8
outcomes, unresolved pairs never become wins/losses. Summarize known usefulness
and unresolved-choice behavior separately, without expecting 100% accuracy.

NR8. Mechanism/precondition is a post-first-answer observation, not an inclusion
filter: retained supported source in the same eligible pool, baseline actual
selector pages omit it, the new policy moves it earlier in the naturally filed
store's derived order, and treatment actually exposes and packs that source.
After all first answers, evaluator-only bounded derivation may use the existing
`createMemoryRuntime(...).queryCandidateRows` with the exact executed query,
literal scorer, four-receipt bound and both policies, fencing unchanged state.
Record exact sets/orders and label them derived, not actual model inputs. Actual
traces establish model visibility/selection; actual packed evidence establishes
packing. A changed order does not itself prove which private topic queue supplied
a member: that internal membership remains unobserved and must not be claimed.
Do not copy the private title-validation algorithm or instrument core for this
diagnostic. Unknown source eligibility/order/state or actual consumption blocks
a claimed opportunity. No gold enters execution and no extra model call occurs.
Smaller stores,
unhelpful/noisy natural topics and baseline ceiling are valid precondition-unmet
outcomes, not reasons for replacement/padding/rerun. Report all cases regardless.

NR9. A positive development signal requires resolved correctness and safety, at
least one actual baseline omission/prior-consumption opportunity, positive paired
first-answer net gain, no previously-correct case lost, no increased unsupported
or stale answers or new severe error, no degraded known-case usefulness, intact
state/runtime/accounting and resources within fixed limits. Otherwise distinguish
precondition-unmet, inconclusive/no-gain and reject/unsafe. All outcomes keep
`productPromotion:false` and `stage3:false`; four authored cases cannot promote
defaults or establish competitive QA gain. First score only, no closed-study rerun.
Resources report actual calls/tokens, conservative reservations and known
profile-price estimates (not invoice), stage elapsed time and DB bytes. Common
capture cost is common, not independently charged twice; paired-run totals are
not a standalone per-arm deployment bill. No unsupported lightweight/latency claim.

NR10. Offline synthetic tests exercise real capture/classification/recall and
both ordinary port paths with fake provider responses, report/slot/source
isolation, arm order and policy-only difference, three-stage resource caps,
failure/unknown/abstention scoring, provenance/state tampering, initial and
after-key drift, key callback errors, actual no-retry dispatch and owned scratch
cleanup on success/intentional failure. Negative controls must fail observably,
not simply assert implementation-generated flags. Preserve first failures and
explain corrections. Both Node22.16.0/24.15.0: focused, full algorithm suite,
generic npm test/validate, Claude marketplace+plugin validation, and affected
longmemeval/core gates based on actual imports/diff. Primary personally reruns,
checks exact committed bytes and independent two-route file inventories. Both
nonauthor Standards+Spec final-head PASS and latest-head applicable CI precede
delivery/execution. No TypeScript gate in this JavaScript repository.

## Scope boundary

Use a small separately named runner/launch/evaluator instead of adding another
boolean combination to the existing multi-profile runner. Reuse existing source
preparation, provenance, answer packer and a closed new mode in existing transport;
no generic scheduler/ledger/guard rewrite or changed old-study semantics. Allowed
implementation files: evaluation/algorithm-development/moc-prior-profile.mjs,
moc-prior-runner.mjs, moc-prior-launch.mjs, moc-prior-evaluator.mjs, transport.mjs,
test/moc-prior.test.mjs, test/moc-prior-runner.test.mjs,
test/moc-prior-launch.test.mjs, evaluation/algorithm-development/README.md;
docs/plans/moc-prior-natural-four.md,
docs/limitations.md and ROADMAP.md. The four inherited fixture files are frozen
and outside this editable list. The fixed implementation and full-review bases are recorded above; any
additional path or old shared-helper change needs primary scope review.
Do not edit core implementation, adapters/providers, package/lock/CI, existing
corpora/rubrics, historical result/runtime/operator directories or real ledger.
Worker stops before commit. At most two failed correction rounds per problem
before primary rescope. Real paid execution requires a later primary gate and
is never performed by this implementation worker.

## Pre-code integration clarifications

The profile's schema/source validation may remain synchronous and pure; existing
preparation may be imported asynchronously to avoid a transport/profile/old-runner
static cycle. Exactly nineteen prepared batches for every case must be verified
in launch preflight before key lookup/paid calls and rechecked in the runner.
Reuse the existing preparation; no copied alternate ingestion algorithm.

The transport's reservation maximum is1,800,000microUSD, implied by360 attempts;
4,000,000microUSD is a separately bound local ceiling, not permission for more
attempts or a larger reserve. Required global affordability includes the protected
30,000,000microUSD and the full1,800,000microUSD maximum, using the original ledger.

The launch closure must cover transitive imports even when their branches are
not used: importing existing preparation reaches the old runner, architecture
helpers and cloud-retrieval candidate. Bind their tracked source, prompts, locks
and relevant protocol/control documents. Do not change those shared helpers.
Trace affected entrypoints/callers and record full actual exits and owned cleanup.
The primary's fresh offline acceptance also runs the existing focused38 MOC
regressions plus full algorithm/LongMemEval/generic/validate/Claude gates on both
Nodes; latest-head CI separately includes the full core suite. Source fixture
bytes and all historical studies remain untouched.

## Implementation ownership and affected entrypoints

The contract above remains an immutable literal prefix. Bounded implementation:
actual GPT-6.1 Sol/high worker; primary owns integration, personally rerunning
acceptance, final combined diff inspection, commits and independent reviews.
Implementation base remains `2baa91b62cbb02c1187c4d47b780e1f1394ba144`;
combined source/runtime review base remains
`af39a50976c70284f35fb57b2c874b56bf53778f`.

| Entrypoint and dependent callers | Boundary and verification owner |
| --- | --- |
| `loadMocNaturalInputs` / `prepareMocNaturalCases`; called by runner and launch preflight | Source-only schema/byte freeze; reused old preparation's nineteen batches. Worker focused/source gates; primary reruns both Nodes. |
| `runMocNaturalComparison`; called only by the new named launch | Ordinary extraction/classification and independent cold recalls; actual core, role verifier, packer and guarded transport. Worker fake-HTTP runner gates; primary pipeline/state/accounting acceptance. |
| `createMocNaturalTransport`; called by new launch and focused synthetic tests | Closed new profile; unchanged old factories and ledger guards. Worker full algorithm regression, source imports' LongMemEval/core checks; primary final-head reruns. |
| `prepareMocNaturalComparison` / `launchMocNaturalComparison`; explicit operator integration only | Complete transitive runtime/control closure, exact Node/tokenizer/output/ledger, start-before-key and revalidation/durable failure boundaries. Worker owned committed synthetic checkout tests; primary prospective operator/execution review later. |
| Evaluator freeze/blind packet/analysis/first-submission aggregate APIs | Never imported by model execution. Post-terminal existing bounded order derivation, provenance/actual packed evidence, fieldwise unknowns and NF5 abstention. Worker scoring/tampering controls; two nonauthor semantic first judges only after any separately authorized real execution. |

There is no CLI, browser flow, old URL/text caller or old launch/profile change.
The only shared runtime mutation is the transport's explicit new closed mode;
old modes retain their guards, requests and report formats. Preparation reaches
the old runner and its architecture/cloud candidate imports even though their
branches are not executed; the launch binds this tracked closure. Installed
dependency binding is limited to the resolved existing tiktoken package,
including executable JS and WASM. Tests copy that package into owned scratch
for drift probes; the shared installation remains untouched.

`allFirstAnswersSettled` describes terminal observations, including unrun slots.
`firstAnswerSlots` separately counts planned/executed/completed/unresolved. All
eight slots survive pretransport failure. When output identity or persistence
itself fails, the runner stops globally and launch reports a closed error; it
cannot promise a durable new report in an unavailable or replaced directory.
Previously persisted original artifacts remain untouched and there is no resume.

The synthetic opportunity control uses deliberately scripted interpretations
to stress bounded selector visibility. It is an offline control, not evidence
that natural extraction produces those cards or that the authored corpus has
an actual prior opportunity. The paid runtime has no control-fixture logic,
manual filing, padding, extraction target count or source/rubric override.

## Bounded synthetic-control rescope evidence

The original evaluator failure and both failed correction logs are retained in
`/tmp/cairn-natural-runtime-evidence.A8oN99l3`. The first correction established
source-carrier matching but revealed that the short synthetic labels gave both
arms the carrier. The second correction's 100-emoji labels violated the actual
unchanged 1,024-output-token bound. Work stopped at the two-correction limit.
The primary explicitly approved one test-only rescope: 40 emojis per label
(20 prefix and 20 suffix), with an actual tokenizer assertion. Before editing,
the serialized five-item proposed output measured 809 tokens, exit 0. This
changes only the fake extraction control, never source/rubric bytes, runtime,
core, prompts or limits. A failed bounded rescope requires another primary
decision, not further fixture tuning.

## Worker offline gate evidence and primary handback

Actual runtimes: Node 22.16.0 and 24.15.0. No real provider/key/operational-ledger
use, dependency install, actual-task commit or push. All test subprocesses use
the existing owned runner and retain actual first failures. Full raw gate logs
are under `/tmp/cairn-natural-runtime-evidence.A8oN99l3`; the table gives each
basename prefix, followed by `-node22.log` / `-node24.log`.

| Gate / raw prefix | Node 22 actual exit | Node 24 actual exit | Result |
| --- | --- | --- | --- |
| `algorithm-full` (first broad snapshot) | 0 | 0 | 149/149 each |
| `algorithm-final` (per-arm integrity precision and controls) | 0 | 0 | 149/149 each; 20 new natural-runtime tests |
| `longmemeval` | 0 | 0 | 212/212 each |
| `generic` | 0 | 0 | 669/669 each |
| `core-focused38` | 0 | 0 | Exact prior/bounded-keyset pair, 38/38 each |
| `core-moc` (extra existing MOC/migration controls) | 0 | 0 | 43/43 each |
| `validate` | 0 | 0 | JSON and version consistency |
| `claude` | 0 | 0 | Marketplace and strict plugin child exits 0/0; owned cleanup |
| `comparison-demo` | 0 | 0 | Existing required synthetic comparison/scoring demo |

First focused gates: `focused-runner-first-node22.log` exit 0 (8 tests);
`focused-launch-first-node22.log` exit 0 (5 tests);
`focused-evaluator-first-node22.log` exit 1 (4 pass / 1 fail). The retained
`focused-evaluator-correction1-node22.log` and
`focused-evaluator-correction2-node22.log` each have actual exit 1. The first
failure exposed metadata/mixed source windows with null direct original offsets;
the fix uses the existing exact prepared origin/window coordinates after shared
role verification. The next failures were the synthetic control's missing
visibility pressure and then invalid 100-emoji extraction output, as documented
in the primary rescope above. The single approved reduced control passed,
`focused-evaluator-rescoped-control-node22.log`, exit 0 (1 test). No further
fixture tuning followed. `focused-launch-persistence-first-node22.log` exit 0
(2 tests) observed actual owned DB-write failure and durable-output corruption:
only two / one HTTP dispatches respectively, with no later case dispatch.
Both final full suites include these controls, actual dispatched-request equality,
failed-capture evidence, fixed four/eight unrun slots, independent settled-arm
continuation and per-arm tamper scoring preserving the untouched first judgment.
The lifecycle control asserts the intentional child assertion exit 1 and removal
of its owned scratch; successful child exit 0 is also asserted.

The comparison demo intentionally retains one synthetic `memory.sqlite` per
runtime, each 561,152 bytes. Owned retained outputs (not unexpected residue):
`/tmp/cairn-natural-comparison-node22.Ne8EBC/cairn-lme-comparison-demo-THEjGQ/memory.sqlite`
and
`/tmp/cairn-natural-comparison-node24.nwhc0E/cairn-lme-comparison-demo-tjugBI/memory.sqlite`.
Other owned test/Claude workspaces are cleaned by their ownership mechanism.
The shared tokenizer target was inspected and never changed or removed; drift
controls modify only copied packages in owned synthetic committed repositories.
Those synthetic fixture commits do not alter the actual task HEAD.

Delivery inventory was independently derived from `git diff --name-only af39`
plus untracked files and from `git ls-tree` blob hashes compared with `rg --files`
filesystem bytes. The routes agree: 16 full-review paths, exactly four inherited
and twelve allowed runtime/test/docs paths. The four inherited SHA-256 values:

| Frozen inherited path | Unchanged SHA-256 |
| --- | --- |
| `evaluation/algorithm-development/moc-prior-cases.json` | `4446a339c252f7b863a80c059048572c8a38f805561b4f898483d0b9ccf97aad` |
| `evaluation/algorithm-development/moc-prior-rubric.json` | `c0238c7755c94be8e849a698697a36524873cf1a7756cc8988c5a72341b9d7cf` |
| `evaluation/algorithm-development/test/moc-prior-corpus.test.mjs` | `3d7cecb924de47b7d006264ffd9e452831ee041af0f1febd3007ff00f163a339` |
| `docs/plans/moc-prior-natural-fixtures.md` | `1c4ce34b76a31d9821158a8dce76a7c8562ef7f8c4b32f6e0fb42b0df9eb239b` |

The original 12,949-byte contract prefix remains exact. The final post-test
changes are documentary evidence/qualification only: a malformed manifest or
unknown preexisting output is rejected before ownership/start; after a valid
owned launch writes its exclusive start marker, failure consumes that run.
Unavailable/replaced output cannot promise a newly durable report or closure,
but execution fails closed and never overwrites its first evidence or retries.
No semantic paid-result, holdout/default/Stage-3 claim is made. Primary owns its
fresh frozen acceptance, final combined diff, local commit and independent
two-axis review; worker stops before those gates.

