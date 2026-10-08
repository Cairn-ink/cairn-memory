# Prospective source-role extraction ablation

Status: offline package authored; focused and primary integration gates pass on
both exact runtimes; independent candidate reviews pending. No default change,
paid launch or benchmark repair. Fixed base
`a1f2354d9ea84220f81dbe59cec1ce83cfbdfcfe`; branch
`test/source-role-ablation`, dependent PR target `feat/model-call-timeout`.

## Decision

The goal remains a lightweight reliable shared memory engine for MCP/Hermes and
other harnesses. The completed thirty-case development comparison is immutable:
Cairn 13 correct, 10 incorrect, 7 unresolved; Mem0 21/8/1. This package neither
reruns those cases nor reports a new benchmark score.

Closed-case inspection found direct user candidate windows absent from receipts
in two cases, while potentially relevant assistant receipts survived. This does
not establish complete information loss or explain empty rank selection. Test
the narrower hypothesis that explicit attribution-aware selection can retain
direct episodic evidence without promoting proposals/quotes or losing useful
assistant-only information. Do not add a vector store, raw archive, new memory
schema or additional extraction call.

Mem0's current extraction prompts distinguish user experiences from assistant
recommendations; LongMemEval reports information loss from fact compression.
These are design motivation, not evidence of benefit in Cairn or proof that the
pinned comparison used those exact prompts:

- https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py
- https://arxiv.org/html/2410.10813v2

## Acceptance frozen before implementation

- N28A: Freeze twelve wholly synthetic model-facing capture cases and a
  separately imported evaluator rubric. No historical questions, answers,
  source text or adaptation to gold. Cases cover: short direct episode with
  verbose assistant; long-user window boundary; two unrelated user episodes;
  five competing episodes; over-capacity omission; uncertainty/negation;
  quotation about another person; hypothetical/conditional; unadopted assistant
  proposal; explicit user adoption; useful assistant-only recommendation;
  assistant explanation followed by user correction. Use declared speaker
  roles as attribution, never authenticated identity. Include Unicode/repeated
  roles without changing sources between arms.
- N28B: Freeze exact current `core/prompts/extract-source-windows.md` bytes as
  baseline plus one experimental candidate under the evaluation package. The
  candidate asks to consider direct user episodes despite verbose elaboration,
  prefer original evidence over assistant echoes, preserve assistant-only useful
  material with attribution, and preserve negation/conditions/uncertainty and
  non-adoption. Five items/four windows/600 units and empty output remain valid.
  Do not edit any production prompt or introduce a public override option.
- N28C: A narrow offline compiler prepares both arms through actual
  `captureSnapshot`, `extractionRequest` and `checkExtractionFits`; any alternate
  system string is chosen BEFORE fit measurement and real `callModel`/adapter
  serialization. Both arms use identical canonical catalogs/input, schema,
  model and caps. Scripted fake HTTP then exercises actual `extractedWindowItems`.
  No downstream prompt rewrite, false claim of durable admission, or claim that
  scripted outputs demonstrate model quality. Avoid a generic experiment runner.
- N28D: Model-facing exports never import evaluator labels. The separate rubric
  names exact source anchors, eligible direct episodes, required assistant
  evidence, attribution/condition constraints and cases intentionally beyond
  capacity. Deterministic coverage counts validated retained source passages,
  NOT semantic correctness of generated claims. A future independent blind
  semantic review must assess unsupported promotion separately. Refusals and
  omitted cases remain denominator slots; do not erase or retry them.
- N28E: Freeze fixture/rubric/baseline/candidate hashes and alternating A/B order
  for 24 prospective arm slots BEFORE paid outputs. Predeclare advancement:
  at least two additional eligible direct episodes retained, zero observed
  unsupported promotions, no required assistant-only evidence loss, no increase
  in structural failures, and unchanged request/item/window caps. Report all
  components and over-capacity omissions separately. A ceiling result without
  improvement is inconclusive, not proof of a repair. One run is developmental,
  not a hidden holdout or statistical parity claim.
- N28F: Actual adapter fake-HTTP tests verify count/generation bodies differ only
  by documented generation fields; prompt fit includes candidate bytes; schema,
  role/window/source binding and output rejection remain authoritative. Include
  wrong/out-of-range/repeated source indices, malformed later item atomic refusal,
  no evaluator labels in HTTP, deterministic fixture/hash/order checks, and owned
  cleanup on success/failure. Expected outputs must be explicit synthetic test
  controls, not a semantic judge that merely searches preferred wording.
- N28G: This packet has no CLI accepting provider keys, paid transport or ledger
  grant. A later separately reviewed narrow indexed-extraction A/B capability
  must bind these hashes and one-shot slots to the existing cumulative ledger;
  do not reuse a completed mixed-comparison grant or bypass its guards. Proposed
  prospective paid ceiling is US$2 inside cumulative US$400 with US$30 protected;
  actual preflight/authorization contract is a subsequent decision after review.
- N28H: Focused tests and required generic/JSON/maintainer plus applicable
  adapter/LongMemEval checks on exact Node 22.16.0 and 24.15.0; actual exits,
  independent two-route file manifest, fixed-candidate Standards/Spec review,
  then dependent PR with latest-head CI. No merge/release/deployment.

## Ownership and allowed scope

Primary owns this contract, evidence interpretation, integration and delivery.
One delegated GPT-6.1 Sol/high worker owns the package, tests and focused proof.
Two separate non-author reviewers inspect the final fixed candidate. The author
must not read historical private artifacts, provider keys or the operational
ledger, and must not make provider calls or commits/pushes.

Allowed: a small `evaluation/source-role-ablation/` package (source cases,
separate rubric, two prompt assets and bounded preparation/measurement helper),
one discoverable test in `evaluation/longmemeval/test/`, this plan and a narrow
`docs/limitations.md` entry. Exclude production core/adapters/guards/schema,
package scripts, dependencies, host integrations, unrelated docs and databases.
Escalate before exceeding this boundary. Existing dependency symlinks are
read-only setup, never deliverable or install/rebuild/cleanup targets.

## Verification record

Prior N27 lineage work is independent; it does not supply missing historical
traces. This package is extraction-only: no DB is opened and a compiled item
is not a durable admission.

### Frozen design and caller map

`cases.mjs` contains only twelve synthetic capture envelopes. `compiler.mjs`
does not import the separately held `rubric.mjs`. It selects baseline/candidate
bytes before `captureSnapshot` → `extractionRequest` → `checkExtractionFits` →
`callModel` → actual OpenAI count/generation serialization →
`extractedWindowItems`. Its transport is always fixed fake HTTP with a synthetic
key; its strict input allows only fixture ordinal, arm and bounded scripted JSON,
never a key, model, prompt, fetch function, CLI or live fallback.

The baseline asset is byte-identical to the pinned production window prompt;
production is unchanged. Candidate wording addresses adoption by the attributed
claimant, not universal user-role authority. Case 12 contains useful tire-pressure
advice plus an incorrect personal assertion corrected by the user; the useful
technical evidence remains a required assistant anchor, alongside case 11.
Case 1/4 assistant passages contain distinct plausible advice rather than repeated
padding. These are fixture judgments before any model outputs, not attempts to
force baseline failure.

The rubric has twelve achievable direct-episode anchors across eleven cases,
two required assistant anchors, and a separate over-capacity case with twenty-one
independent required windows against an aggregate twenty-window ceiling.
Coverage requires canonical span union (including the long-user boundary anchor),
not preferred summary wording. Mismatched cohorts, statuses, forged spans/excerpts,
duplicate passages and invalid own-data records are refused. Every arm remains
one of the fixed 24 slots; refused arms retain zero coverage and their failure.

Advancement also validates fixed denominators, finite statuses and integer ranges;
it derives capacity from the frozen rubric. At least two additional achievable
direct episodes, unchanged caps, no structural regression, no relative assistant
loss AND complete candidate required assistant coverage are necessary. All 24
slots need independent blind semantic review with zero observed **candidate**
unsupported promotions; baseline promotions are reported separately. Review
input is a report assertion, not authenticated proof. Missing review blocks
advancement; even satisfied controls mean only eligibility for separate review,
never automatic prompt promotion. Ceiling/no gain remains inconclusive.

`frozen-manifest.json` pins source/rubric/prompt SHA-256, base/runtime source
commit, the fixed model, caps and exact alternating 24-slot order. The compiler
checks model-facing pins without reading evaluator labels; tests check all pins.
No paid outputs exist. The proposed US$2 ceiling remains prospective and ungranted.

### Author verification (serial, offline)

Exact Node 22.16.0 and 24.15.0, keyless `env -i`, runtime bin plus `/usr/bin:/bin`
PATH, `TMPDIR=/tmp`, `NODE_DISABLE_COMPILE_CACHE=1`:

```sh
node tools/testing/run.mjs --test-concurrency=1 evaluation/longmemeval/test/source-role-ablation.test.mjs
```

Initial Node 22 RED: actual exit 1, compiler module absent before implementation.
Initial seam GREEN: 1/1, actual exit 0. Expanded first focused checks: 9/9 on each
runtime, actual exit 0. Subsequent cohort/span hardening was checked with the
prior rubric pin stale: Node 22 actual exit 1 (8/9); exact-byte pin
failure was retained, then the manifest was refreshed before final freeze.
Final focused bytes/exits are recorded at handoff below.

Actual local counted request inputs: baseline 258–871 tokens, candidate 381–994;
candidate adds 123 tokens in every case. Both fit the unchanged 6,000-token cap.
Provider input-token replies are scripted controls, not measured provider counts
or bills. Tests compare exact count/generation bodies (only documented generation
fields differ), selected prompt bytes, roles, schema bounds, immutable source
catalogs and authoritative output/receipt binding. Bad selections and malformed
later items refuse the whole arm; empty output is valid. Owned workspaces are
removed after successful and deliberately failing operations; the canonical
runner also owns invocation success/failure cleanup. No historical cleanup.

The author inspected the three read-only dependency symlinks and performed no
installation or rebuild. Planned full gates were deferred to primary; a bounded
clean-fixture discovery attempt entered existing generic tests because of option
placement and hit its 60-second bound, as retained below.
Primary owns generic `npm test`, JSON `npm run validate`, maintainer validations,
applicable offline adapter/LongMemEval gates on both Nodes, final two-route file
manifest, fixed-candidate Standards/Spec reviews and latest-head dependent-PR CI.
These are pending here; no TypeScript gate exists. No worker commit or push.

### Initial worker handoff (historical, before CI-placement correction)

Final focused source/test bytes: Node 22.16.0 **9/9, actual exit 0**;
Node 24.15.0 **9/9, actual exit 0**, serial via the command above.
N28A–G offline structural controls are covered; semantic quality and the future
paid capability remain unmeasured/ungranted. N28H full integration gates,
non-author reviews and dependent-PR CI remain primary-owned and pending.
Changed-file discovery by `git diff --name-only` plus untracked-file listing is
cross-checked independently against `git status --porcelain` (nine scoped files).
The three existing dependency symlinks are separately identified setup and are
excluded from delivery; they and their targets remain unchanged. Final hashes
are returned to primary, not a second tracker. No benchmark score or historical
trace is reconstructed by these scripted controls.

### Primary acceptance correction: CI gate placement

Primary found that the initial architecture test is discovered by generic
`npm test`; its CI job runs Node 20/22 without an OpenAI dependency install.
The test statically imports the compiler → adapter/tokenizer and capture →
`node:sqlite`. Local setup symlinks masked the missing-dependency problem.
Only the test location and this integration record were reopened: the test moved
byte-identically to `evaluation/longmemeval/test/source-role-ablation.test.mjs`.
That existing glob's CI job installs locked OpenAI dependencies and runs Node
22.16/24. No skip, workflow, dependency or frozen source/prompt/rubric/pin change.

An owned clean `git archive` fixture with scoped copies and no dependency links
reproduced the original import failure: exact Node 22 inner test **exit 1**,
`ERR_MODULE_NOT_FOUND` for `tiktoken`; the corrected witness harness exited 0
asserting this RED. An earlier harness assertion expected the wrong package name
and exited 1 despite the same valid reproduction; that tooling failure is retained.
Both failure fixtures were removed by owned workspace cleanup. Node 20 is not
installed here and was not tested; its CI/runtime mismatch is source inspection.

The first clean generic-discovery command used npm-appended options after paths,
so it entered existing tests and reached 60 seconds (child exit unknown/null,
probe **exit 1**, not a suite pass). A late attempt to signal its already-finished
owned runner returned exit 1; no live or unrelated process was targeted.
The corrected command uses the existing client wrapper with
`--test-concurrency=1 --test-name-pattern=^N28` BEFORE mechanically enumerated
generic file paths. Clean Node 22 and 24 discovery then exited 0 with no N28 test
or optional-dependency import; this is import/discovery evidence, not full test
coverage. Clean `npm run validate` exited 0 on both runtimes. Each exact fixture
and canonical runner scratch was removed, including the failed bounded probe.

Relocated focused checks: Node 22.16.0 **9/9, actual exit 0** and Node 24.15.0
**9/9, actual exit 0**, serial, using the command above. Test bytes retain SHA-256
`11cd2639a2fb9bfe9461f5571ae01cce2ee2534fad50a0a344409ac83375597b`.
Full primary gates and independent final-candidate reviews remain pending.

### Primary full acceptance checkpoint

Primary inspected the package, rubric, test and documentation and independently
cross-checked nine delivery paths by Git diff plus untracked listing against
porcelain status; three read-only dependency links are excluded setup. Test
discovery lists were separately checked using filesystem enumeration and Git's
tracked/untracked paths. All nine delivery file hashes remained identical across
the fourteen completed commands. Only this plan's status and acceptance record
changed afterward; source cases, prompts, rubric, compiler, tests and pins did not.

Each exact runtime, Node 22.16.0 and 24.15.0, passed these checks with actual
exit 0, no signal or process error:

| Gate | Result on each runtime |
| --- | --- |
| Generic tests, canonical client wrapper | 581/581; zero skipped |
| `npm run validate` | JSON/version checks passed |
| `npm run validate --prefix tools/plugin-validation` | Strict plugin validation passed |
| Full LongMemEval tests, canonical owned runner | 310/310; zero skipped |
| `npm run test:openai` | 332/332; zero skipped |
| Workspace lifecycle, canonical owned runner | 25/25; zero skipped |
| `npm run demo:longmemeval-ingestion` | Synthetic demonstration passed |

The harness also exited 0. Exact command arrays, subprocess statuses and
before/after hashes are in `cairn-n28-primary-gates.9KB9u0Z1/results.json`.
Commands ran one at a time in keyless environments with the exact runtime bin
first, `TMPDIR=/tmp`, disabled compile cache and no install/rebuild. Direct test
invocations put `--test-concurrency=1` before all mechanically enumerated file
paths; the existing OpenAI npm script retained its own concurrency settings.
This is not an isolated-host latency measurement. No provider or operational
ledger was accessed. Both independent fixed-candidate reviews and latest-head
CI remain necessary before delivery; no semantic improvement is claimed.
