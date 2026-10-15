# Event/state opportunity packet

Status: frozen synthetic offline instrumentation; semantic accuracy not measured.
Base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`. This implements only the
missing-coverage packet selected by the [loss-boundary plan][loss] under the
[architecture agreement][alignment], neither of which is merged in this base.

## Contract before implementation

E1 freezes exactly six new opaque-ID source scenarios and a separate rubric.
Slots are an over-budget update with B only proposed; an in-budget update;
a late-imported older quote; a wrong-entity update; a separately authorized
foreign-namespace near duplicate; and explicit sourced adoption of B. Questions
ask only what these statements establish under their explicit conditions. Source
event dates stay in receipt text, distinct from import order/receipt createdAt.
Unknown timing or commitment is never inferred from arrival order. Known-answer
controls reject blanket unknown/reconfirmation. No old RQ/CQ/BQ content is reused.

E2 uses actual shared `core.capture` with `source-bound-v2` qualification and
`source-bound-v1` rationale, never indexed-evidence or hand admission. Every case
has a fresh owned workspace/store. Foreign setup is a distinct authorized phase.
The store closes and reopens before query with a new model session. Factories
receive only opaque case ID/phase. Runtime never reads rubric bytes.

E3 snapshots extraction, qualification, classification and relation callback
requests/outputs independently from admission and guarded keyless reads. It
retains failures/empty relationships, cold getRationale, selection/ranking,
returned evidence and first-answer delivery. All six cases remain counted.
Detailed traces stay in memory; public summaries contain counts/status only and
`semanticAccuracy: not-measured`. No callback is treated as semantic truth.

E4 passes whole returned rationale graphs/linked receipts with unverified status
intact to one answer callback, using the existing SOURCE_ANSWER_INSTRUCTION
verbatim. It does not use the older answer packer's model/transport. Qualification
is inspected separately; rationale recall never sets includeQualification. Empty
or overflowing evidence causes zero answer calls; errors never trigger retry.
Recency, proposed edges and storage state convey no adoption/execution authority.

E5 bounds fixture input, callback snapshots, all case/session/message counts and
serialized answer input/output. Existing core caps are six memories/ten edges
per rationale. No environment/provider/credential/ledger access or top-level
execution. Test token counting is deterministic mechanics, never provider usage
or affordability. Only actual callback counts/elapsed milliseconds are measured.

E6 tests six-case retention, cold persistence, exact graph/receipt propagation,
foreign canary exclusion from every target callback, source/gold separation,
extraction/qualification/relation/answer failures, empty selection, packing
overflow, stale-ref/namespace guards, no-edge and dropped-evidence red controls,
and owned-workspace removal after success/failure. Scripted proposals and answers
prove plumbing only. Node 20 runs fixture checks and dynamically skips SQLite.

E7 leaves real-model baseline, prompt artifacts, exact models, affordability,
input/output/call/time/storage/cost ceilings and independent review pending before
any paid run. Baseline comes first; select at most one factor only after a real
opportunity is observed. Unchanged gates: 24-case paired net correct >=3 plus
targeted gain, no increased unsupported/stale use, no new severe regression;
fresh 30-case completion >=29 and correct >= same-batch Mem0 with uncertainty.
Independent reliability, installed Hermes and lifecycle resources remain separate.
Original cumulative $400/protected $30 remain unchanged; no ledger is read.

E8 cross-checks the changed inventory through Git and filesystem/blob hashes,
checks append-only limitations and diff whitespace, and runs focused tests through
the owned runner on Node 22.16/24.15 plus Node 20 fixture compatibility. Primary
owns generic npm test/validate/strict plugin, final inspection, two independent
reviews, scoped commit/push/PR. No browser/public runtime flow changes.

## Frozen artifacts and execution

The frozen source [fixture](../../evaluation/architecture/fixtures/event-state-opportunity-v1.json)
has SHA-256 `e6c4e42c55d2c4ded53f4698c6bf26eb35e3873b9541dcbfc602d07da7e7e0a0`.
The independent [rubric](../../evaluation/architecture/fixtures/event-state-opportunity-v1-rubric.json)
has SHA-256 `a644e0cadea32ee9e0e2e13ee4dd0b603cff6fbf8af70fbf8ad162395171e206`.
Both have exactly the ordered IDs `es-7c2a`, `es-19df`, `es-a603`, `es-5be8`,
`es-d094`, `es-e731`. The source loader checks the raw bytes and an exact-key
schema; no alternate dataset is accepted. Gold stays outside the helper's imports,
factory metadata, core calls and answer requests. Gold criteria are interpretation
requirements, not an executable semantic scorer or six measured correct answers.

The source is at most 16000 bytes: exactly six cases, each at most three sessions,
one or two messages per session, 600 UTF-16 units/message and 500/question.
Session keys are phase/eventTime/messages; case keys are id/question/sessions.
The separate gold has required/forbidden arrays of one to four clauses, each at
most 160 units. Case es-a603 asks about applicability as of August 12 after an
August 13 archival import; knowledge/import order and historical applicability
are deliberately distinct. Case es-d094's August 12 statement recalls August 1
adoption; it does not assert future knowledge at an August 1 event.

The [helper](../../evaluation/architecture/event-state-opportunity.mjs) exports
`runEventStateOpportunity({createModel, answer, createWorkspace?, answerInputBytes?})`.
Factories receive only `{caseId, phase}` (`foreign-setup`, `target`, `read`).
They supply the existing model ports/counter/context capacity. Tests alone use
the [scripted model](../../evaluation/architecture/testing/event-state-scripted-model.mjs).
The default workspace is newly owned by createTestWorkspace; every opened core
is deferred for close before cleanup. There is no top-level run or environment
inspection. A factory failure remains a case failure; there is no fallback.

Each case allows 32 model callbacks, 64000 serialized input bytes/callback,
24000 output bytes/callback and 512000 retained snapshot bytes. Answer input
is atomic and at most 24000 bytes (a caller may lower this cap); answer output
is a strict `{text}` object of at most 4000 bytes. Returned evidence keeps the
full core rationale shape, sources, unverified statuses and readback coverage/
truncation. Core still bounds each graph to six memories/ten edges/24000 UTF-16
units. Delivery lists identify exact returned refs included or omitted by packing;
earlier selection/packing omissions are separately observed in model callbacks
and core truncation counts, not invented source IDs. Empty/no-safe evidence or
packing overflow makes zero answer calls; valid evidence makes exactly one.

The return contains a content-free `summary` and content-bearing local `traces`.
Only summary is intended for public reporting. Callback status `returned` is a
snapshot of a proposal, never validated interpretation; core admission,
qualification, classification, relation results and cold reads are distinct.
`observed-unassessed` means no wiring-stage failure was observed, not semantic
success. Callback elapsed milliseconds and counts are measured; the fake
byte/4 counter provides only deterministic budget mechanics. No provider token,
cost, affordability, host relevance or real-model quality claim follows.

Run the [focused offline suite](../../evaluation/architecture/test/event-state-opportunity.test.mjs)
using the selected Node version:

```sh
node tools/testing/run.mjs evaluation/architecture/test/event-state-opportunity.test.mjs
```

Observed exits are recorded in the verification note below. The first draft run
after the timing correction rejected the stale source digest (exit 1); the source
pin was then updated before the successful full runs. The digest guard was not
disabled. Tests include no-edge and stripped-rationale forwarding faults: the
former fails the cold challenge assertion, while the latter reaches the actual
answer callback's endpoint and records answer-failed, with delivery equality
also failing. These are red-capable wiring controls, not model quality scores.

The helper is evaluation-only, not a new runner, permission framework, scorer,
live grant or algorithm improvement. Future normal model adapters, exact prompt
artifact digests, baseline completion and independent interpretation review
remain pending. If the future first baseline has no relevant error/opportunity,
stop/re-scope; these offline mocks do not establish an opportunity or choose a
candidate. Independent Standards/Spec and generic repository gates are primary
acceptance work, not worker claims.

## Worker verification

The exact focused command above passed on Node **22.16.0**, actual exit **0**,
six tests passed, zero failed/skipped; and Node **24.15.0**, actual exit **0**,
six passed, zero failed/skipped. Each suite covers six retained cases per run,
including failures, and checks every newly owned case directory is gone after
success and injected failure. No historical directory is scanned or removed.
The Node 20 executable is not present in the installed nvm versions on this
worker's host; its fixture-only compatibility gate remains primary/CI-owned.

Two independent inventories agreed on **7 changed files**: Git diff plus untracked
names versus a recursive filesystem walk comparing actual Git blob hashes with
the complete base tree (new files discovered from the filesystem, not copied
from Git's untracked list). The same read-only check verified the full base bytes
of limitations remain an unchanged prefix and resolved **93 relative links**
across the plan/limitations, actual exit **0**. A separate `git diff --check`
returned actual exit **0**. The seven files are the source fixture, rubric,
helper, focused test, test-only scripted model, this plan and appended limitations;
no core/prompt/adapter/package/CI/old-result changes. No commits or delivery
operations are performed by the worker.

Owner: bounded actual GPT-6.1 Sol/high worker; no subdelegation. Primary owns
architecture decisions and acceptance. Existing sparse-parent/NULL-title MOC
foundation candidates are not pulled into this packet.

[loss]: https://github.com/Cairn-ink/cairn-memory/blob/8c46bf87d9e5b69b4a89c1e8e896d5d620ba7aa0/docs/plans/architecture-loss-boundaries.md
[alignment]: https://github.com/Cairn-ink/cairn-memory/blob/e6b564b496ba38daed2fca6359fded36905b621c/docs/plans/memory-architecture-alignment.md
