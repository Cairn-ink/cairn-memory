# Synthetic evidence-gap reproduction

Status: offline diagnostic mechanisms verified; no runtime fix. Fixed base
`bc0156a08cfa2e5840d459153ab292c2c37f31ce`, worktree
`evidence-gap-reproduction`, branch `test/evidence-gap-reproduction`.
Bounded author: actual GPT-6.1 Sol/high. Primary owns integration, fixed-candidate
independent review, commits/PR and any later fix or comparison.

## Acceptance before implementation

- G1: Two synthetic turns (short user aside, verbose assistant) traverse actual
  `prepareMixedSourceCase` → `ingestIndexedEvidenceLongMemEvalCase` → core →
  OpenAI adapter fake HTTP. Both markers reach extraction wire. Assistant-only
  scripted extraction completes capture but cold `sourceSnapshot` lacks the
  user marker; identical input with include-user output retains it. Ingestion
  receives history/namespace/capture only, never question/reference.
- G2: Actual `core.recall`, approximately 217 publicly admitted synthetic
  candidates and the local token counter distinguish target beyond two scan
  pages, visible but select-omitted, rank-dropped, and positive control. Preserve
  separate stored/enumerated/select-input IDs and marker visibility,
  select-output/rank-input/rank-output/final-context observations. Combined
  `shownRefs` is not unique visibility. No SQL seeding or actual data.
- G3: A narrowly opt-in diagnostic coverage assertion exits 1 for loss controls
  and 0 for matched positives; ordinary CI verifies the mechanisms without a
  permanently red test. Record actual red/green commands and exits on exact
  Node 22.16/24.15. These scripted mechanisms do not prove actual N12 model cause.
- G4: All SQLite fixtures use newly owned `createTestWorkspace` roots and
  cleanup after success and intentional assertion failure; no historical sweep.
- G5: Preserve N12 Cairn 3/6 versus Mem0 4/6 and all accounting. Indexed evidence
  retains selected admitted receipts, not a transcript archive; successful
  capture is not complete coverage. The separate #352 raw-layer contract is
  future work, not authority to change retention defaults here.

Allowed changes are this plan, one new LongMemEval test, one narrowly named
synthetic helper, and a limitations append. Runtime/prompt/schema/config,
operational files, actual corpus/ledger/key/old databases and paid calls are out
of scope. Adapter dependencies are installed only into the absent checked local
directory with its existing lock. No commit/push by the author.

## Verification scope

First run the focused synthetic test through `tools/testing/run.mjs` on both
exact runtimes, with keyless environment. The LongMemEval glob registers the new
test automatically. Contributor gates are LongMemEval and ingestion demo,
generic tests, validation, workspace lifecycle and maintainer validation on both
runtimes; unrun gates are not passes. No TypeScript gate exists. Establish the
red-capable loop before proposing causes or fixes (`diagnosing-bugs`).

## Next-comparison metadata precondition (not a selection)

Primary's metadata-only availability audit returned actual exit 0 (`e27c98`):
232 of 500 IDs are prepared/exposed, not necessarily completed; 268 are
unexposed, including 262 structurally eligible. Available counts are user 28,
multi-session 91, temporal 91, knowledge-update 34, assistant 18; preference
has zero fresh IDs (all 30 were previously exposed). A proposed later 30-case
roster could use six of each of the five available types, without claiming fresh
preference coverage. Existing-seed deterministic metadata selection must wait
until runtime/profile is fixed; then source/resource fit must be frozen before
paid dispatch. This audit selected, froze and executed no 30-case cohort.

## Initial feedback evidence

The first focused Node24 command exited 1 (`362599`): three fixture setup
failures, not the intended symptom. The cold source read lacked a token counter;
the beyond-page target marker contained a query token and could sort among
distractors. Cold reads now use only the local tokenizer (interpretation getters
fail), and distinct query words deterministically give the beyond-page target
score 0 versus distractors' score 1; visible controls give it score 2. Primary's
early command `b90360` used the earlier counter-less bytes and is likewise a
setup failure, not a symptom RED. No runtime change was made.

Exact Node24 `CAIRN_EVIDENCE_GAP_ASSERT=write-omit node tools/testing/run.mjs
--test-name-pattern='G3 opt-in'
evaluation/longmemeval/test/evidence-gap-reproduction.test.mjs` then returned
intentional exit 1 (`69e193`), 0 pass / 1 fail / 0 skip, 536.909 ms. The actual
assertion was missing user source in a cold admitted-source read, not a token or
setup error. Identical-input `write-include` returned actual exit 0 (`505bff`),
1 pass / 0 fail / 0 skip, 593.296 ms. Both use fake HTTP and cleanup in `finally`.

Public stored-set enumeration is independently recorded and checked against
admission IDs; it is not private recall ordering. `mapPackingTrials` contains
actual token-measured map envelopes, including oversized rejected trials, not
the entire physical query scan or necessarily delivered pages. Actual select
and rank request/output IDs and marker bits are separate. These distinctions
prevent a combined observation count from being labelled unique visibility.

## Frozen mechanism evidence and limits

The later focused runs initially passed G1 and all four G2 controls but exited
1 on G4 (`97c776` / `bb16c1`; primary `48f53c`): Node appends assertion details
to the supplied message. The fixture now checks its exact first line together
with `actual=false`, `expected=true`, `operator=strictEqual` and `ERR_ASSERTION`.
This assertion-format setup failure is not symptom RED evidence.

G1 freezes identical prepared history and extraction-input bytes between its
controls. Both markers reach the real OpenAI adapter's fake-HTTP extraction
request, without question/reference ingestion. Scripted assistant-only extraction
completes and retains assistant receipts, but the cold source read lacks the user
marker. Changing only extraction output to include the user retains it. This
proves a selected-receipt retention mechanism, not the actual N12 extractor's
behavior or a defect against an archive contract.

G2 independently verifies 217 publicly admitted/stored memories and their public
enumeration as a set, not private query order. Query overlap deterministically
places the target after distractors or ahead of them. Real token-aware recall
then distinguishes these stage observations:

| Control | Select input ID + marker | Select output / rank input | Rank output / final context |
| --- | --- | --- | --- |
| Beyond two rounds | Absent | Absent | Absent |
| Visible, select omitted | Present | Absent | Absent |
| Rank dropped | Present | Present | Absent |
| Include | Present | Present | Present |

The beyond control reports `budget_exhausted`; its target is absent from observed
map-packing trials, not proven absent from the entire physical query scan.
All controls have zero answer-packer omissions. IDs and marker bits are recorded
separately at each observed stage; combined `shownRefs` is never used as a unique
visibility count. Each owned fixture removes its root after both success and the
specific intentional coverage assertion failure.

### Exact commands and actual exits

Commands run from this worktree with `env -i`, the selected exact Node bin plus
`/usr/bin:/bin` as `PATH`, `TMPDIR=/tmp`, and `NODE_DISABLE_COMPILE_CACHE=1`:

```sh
node tools/testing/run.mjs evaluation/longmemeval/test/evidence-gap-reproduction.test.mjs
CAIRN_EVIDENCE_GAP_ASSERT=write-omit node tools/testing/run.mjs --test-name-pattern='G3 opt-in' evaluation/longmemeval/test/evidence-gap-reproduction.test.mjs
npm run test:longmemeval
npm run demo:longmemeval-ingestion
```

Repeat the opt-in command with `write-include`, `beyond`, `select-omit`,
`rank-drop`, and `include`. On both exact runtimes, `write-omit`, `beyond`,
`select-omit` and `rank-drop` each returned intentional exit 1 containing the
expected coverage assertion; `write-include` and `include` each returned exit 0.
The serial checking drivers returned actual exit 0 (`47cc18` / `f71b86`).
Primary separately observed matching Node24 RED/positive pairs
(`0b4940` / `d10a16`, `073416` / `d1e318`). Ordinary CI has no permanently red
test and no skipped diagnostic placeholder.

| Gate | Node 22.16 | Node 24.15 |
| --- | --- | --- |
| Author focused | 6/6, no skips, exit 0 (`6611b2`) | 6/6, no skips, exit 0 (`e62d4d`) |
| Primary focused | 6/6, no skips, exit 0 (`d11dd9`) | 6/6, no skips, exit 0 (`a1150a`) |
| Full LongMemEval | 287/287, no skips, exit 0 (`c3a847`) | 287/287, no skips, exit 0 (`da29ec`) |
| Ingestion demo | exit 0 (`ba5900`) | exit 0 (`ce11d9`) |
| Primary generic tests | 581/581, no skips, exit 0 (`491ef1`) | 581/581, no skips, exit 0 (`171bad`) |
| Primary validation | exit 0 (`9474a8`) | exit 0 (`d86e59`) |
| Primary maintainer validation | exit 0 (`c2b107`) | exit 0 (`acfbde`) |
| Primary workspace lifecycle | 25/25, exit 0 (`d31756`) | 25/25, exit 0 (`87b429`) |

The unchanged ingestion demo explicitly retains its newly created synthetic
database; no historical cleanup was performed. The new fixtures themselves
clean up immediately. Locked local adapter installation exited 0 (`e69e67`)
after confirming its dependency directory was absent, not a shared symlink.
Packages, locks, pricing, runtime, prompts, schemas and configuration are unchanged.

Primary's additional preparation-only postscore probe exited 0 (`30956e`):
the necessary markers fit inside individual indexed windows, with counts 2/1/1
for the three wrong cases. This rules out marker splitting for those probes,
not missing actual provider input/output or an extraction/admission cause.
Only primary-supplied finite metadata is recorded here; the author read no
authentic source, evaluator, ledger, key or old database.

Primary's later read-only SQL probe exited 0 (`6bee2d`) after a query-literal
setup error exited 1 (`b53b21`); the database hash remained unchanged. In wrong
cases 1/2/3, each matching capture batch completed, with five distinct admitted
memories and zero suppressed items. All 45/47/43 batches completed, with zero
suppressed items and zero deleted memories. Alongside the individual-window
check, this weakens suppression/deletion and marker-splitting explanations, but
the original extraction output was not stored. Five-item saturation is a
hypothesis, not a proved capacity bottleneck or provider rationale.

The next bounded diagnostic should compare question-blind extraction coverage
on identical synthetic source while distinguishing the existing five-item
capacity from prioritization: vary only the number of independently relevant
source facts, and compare coverage and selected source indices below/at/above
five items. Preserve the input/wire/output/admission boundaries and matched
positive controls. Do not increase a cap, alter prompts/defaults or build a new
operator before that prediction is validated. No paid run or score changes
follow from these read-only observations.

Initial verified helper SHA256 (before the teardown correction below):
`6c799b727b28c4e00ea3586b6b9c909d7d7a54319af8529008fdb4e8dcb1f688`.
Frozen test SHA256:
`661aeb536d0cb8b023d3b70817ef49e7ed76f215e9e1212efb913fe7aa572f0f`.
These are synthetic reproduction tests, not a core fix, retention-default change
or actual N12 causal finding. N12 remains Cairn 3/6 versus Mem0 4/6, with prior
accounting unchanged. Fixed-candidate independent review, commit/PR and CI remain
primary-owned delivery steps; any repair or larger comparison is separate work.

## Independent-review teardown correction

Standards review of candidate `953daf64101ffde78ae71b1248180f93e793429f`
identified workspace allocation before pure write-fixture preparation, outside
the cleanup `try`. Both helpers now allocate only after their pure preparation
and immediately enter `try`; teardown registration, path construction and core
setup all occur inside it. A pure setup failure therefore allocates no workspace,
and a failure after allocation reaches `finally`. No production flag or extra
setup-injection API was added; existing G4 exercises the specific post-allocation
coverage-failure cleanup as well as success cleanup.

Affected focused reruns on final helper bytes passed 6/6 with no skips and actual
exit 0: exact Node22 `24dda3` (33,225.862 ms), exact Node24 `fce964`
(32,976.730 ms). The test remains byte-identical. Final corrected helper SHA256:
`1e9c60b2006c33ff84c5b4c38e8ef0cea533f13ac2fb53e9eb1f3b89ecbf69dd`.
Earlier full-suite and RED/positive evidence above is historical to the initial
helper; the correction changes resource ownership timing only, not data,
extraction, recall or assertions. Primary will commit and rerun both independent
review axes on the corrected candidate; no author commit or push occurred.

## Primary stored-input presentation boundary (diagnostic only)

Primary's owned-copy case-3 probe preserved the original store hashes and
completed cleanup. It used unchanged runtime `7de`, the same query/budgets and
local counter, but scripted oracle-target-only select/rank, not an original-model
replay. An initial question-whitelist setup failure returned exit 1 (`aa8617`,
`invalid_answer_question`) with cleanup intact; the corrected probe returned
actual exit 0 (`733ff1`). Two select rounds each showed 32 candidates. The target
ID was visible in the first round, absent in the second; its first-round label
contained neither the necessary name anchor nor the relative-time token.
The body score was 2; retained receipt scores were 2/9/8/2, with the necessary
marker receipt scoring 8. Although the body retained the name anchor, its
120-character navigation label and every receipt navigation label omitted it.
Force-selecting the known ID delivered one rank candidate containing the full
necessary marker and final context with that marker, with zero packer omissions.

This localizes a concrete presentation loss on unchanged stored input. Oracle
forced selection does not establish that the original model would select a
better label or reproduce its original rank behavior. The generic beyond-page
synthetic remains a possible mechanism, not the actual case-3 cause. No names,
query/source text or IDs are published. Primary's post-cleanup G1/G4 acceptance
also passed 2/2 with actual exit 0 on exact Node24 (`5283b3`) and Node22
(`cf60e3`). Scope remains diagnostic; no score or runtime changes follow.
