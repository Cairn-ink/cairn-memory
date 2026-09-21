# Public pilot rejection diagnostics

## Purpose and fixed boundary

The completed public pilot retained `invalid_model_output` but did not retain
the existing trusted adapter/core diagnostic callback, and it discarded the
accepted answer completion distinction between `stop` and `length`. This
delivery adds bounded private observation only. It does not explain the
historical failure, authorize another paid call, prove a score cause, or change
validation, retry, provider payloads, models, limits, policy, accounting or
scoring.

Implementation was delegated to the Sol worker at high reasoning effort on
branch `fix/pilot-rejection-diagnostics`, fixed base
`8132c552bcf88df5d0f539475ef13b683baf480c`. The primary owns final acceptance,
dual-runtime verification, independent review, commit and delivery.

## Acceptance contract

- PO1: Actual public-pilot adapter/core callbacks retain only existing
  allowlisted stage/layer/reason categories in the correct case. Success and
  failure behavior stays unchanged. Unknown custom sessions and missing old
  artifacts are explicitly unavailable; no event is not proof of no error.
- PO2: Each answer attempt privately distinguishes `stop` from `length` while
  the ordinary answer callback remains exactly `{text,usage}`. Text, score
  input/resolution, models, limits, payloads, arm order, costs and policy stay
  fixed. A length completion is diagnostic, not an incorrectness label.
- PO3: Artifacts contain fixed categorical metadata only. Model records are
  capped at 64 per case, answer rows at three, and overflow is counted. Case and
  session contexts do not leak; hostile accessors and arbitrary extra fields
  cannot enter the projection; observer delivery cannot alter an operation.
- PO4: Synthetic fake-HTTP tests traverse the real runner, adapter and core;
  distinguish adapter JSON rejection from core extraction rejection; retain
  strict failure and no later memory generation; cover finish reasons,
  unavailable legacy observation, immutable snapshots, bounds, redaction,
  late/concurrent isolation, resume and aggregate/score invariance.
- PO5: Final delivery requires Node 22.16 and 24.15 live-offline and OpenAI
  suites, relevant LongMemEval and generic/plugin validation, independent
  Standards and Spec review of one fixed diff, and all CI green. It authorizes
  no release, deploy, merge, corpus read or paid run.

## Implemented design

`createBenchmarkLiveSession` owns one `AsyncLocalStorage` instance. A
module-private `WeakMap` associates only real benchmark sessions with an
internal scope runner; no public session key or callback surface was added.
Every generated case runs once inside a fresh async context containing its
bounded collector. Adapter/core callbacks and answer completions look up that
immutable invocation context, rather than a mutable current observer. Async
work created by case A therefore keeps A's collector even while case B runs.
Collectors close before their detached snapshot is written, so late A events
are ignored and never attributed to B.

The model projection snapshots its four candidate fields once, validates the
local primitive values against the copied existing allowlists, and creates a
new fixed-shape record. This prevents stateful getters, coercible objects and
extra fields from changing the value after validation. Answer send retains the
validated finish reason internally, emits it to the scoped collector, then
returns the unchanged public `{text,usage}` object.

This is a deliberate benchmark-local copy of the existing allowlist, not a new
shared core observability API. Unknown or future categories fail closed until
an explicit taxonomy review updates this boundary; the copy makes no claim of
automatic alignment with later core taxonomy changes.

Fresh cases write `diagnostics.json` last, after the existing generation,
request, truncation, accounting and timing artifacts. A diagnostic write
refusal uses the existing `output_exists`/`output_write_failed` policy without
rerunning work or losing durable accounting. Diagnostic files are deliberately
not required on resume: legacy, blocked and repaired interrupted runs remain
compatible, and absence is unavailable rather than a fabricated empty result.

## Red/green evidence

All commands used synthetic prepared data, fresh temporary SQLite stores and
ledgers, and fake HTTP. They read no environment key, pilot corpus or frozen
paid artifact.

- Initial RED:
  `node --test --test-name-pattern='PO1-PO4: case artifacts distinguish' evaluation/live/test/public-pilot.test.mjs`
  failed 0/1 with `ENOENT` for the missing per-case `diagnostics.json`.
  After implementation, the same command passed 1/1.
- Stateful-getter RED:
  `node --test --test-name-pattern='observation is bounded and late' evaluation/live/test/public-pilot.test.mjs`
  failed because a second getter read entered the secret sentinel into the
  artifact. After one-read primitive snapshotting, it passed 1/1.
- Coercible-layer RED: the same focused command failed because a non-string
  object occupied a record through property-key coercion. Requiring a string
  layer before lookup made it pass 1/1.
- Final focused Node 22.16.0 run:
  `node --test evaluation/live/test/public-pilot.test.mjs` passed 22/22.
- Adapter regression Node 22.16.0 run: `npm run test:openai` passed 200/200.
- Primary broad verification on the final runtime/test hashes passed: the
  live-offline suite on Node 22.16 and 24.15 (267 passed and 30 intentional
  skips of 297), OpenAI 200/200, LongMemEval 65/65, the public demo, generic
  Node 22 tests 106/106, JSON validation, and marketplace/plugin validation.

The primary records the final dual-runtime, repository validation, independent
review and CI evidence against the eventual fixed candidate SHA.

## Checkpoints and boundaries

| Requirement | Owner | Evidence and status |
| --- | --- | --- |
| PO1/PO2 runtime observation | Sol worker | Real session/core/adapter synthetic cases green; no public answer/report/aggregate widening |
| PO3 isolation and threat boundary | Sol worker | 64-record cap/drop count, accessor/object attacks, late case callback, concurrent sessions, 0600 artifact and redaction green |
| PO4 regression and resume | Sol worker | Adapter versus core, strict unknown finish, no later memory generation, custom session, immutable artifact, accounting-safe resume green |
| PO5 broad gates and review | Primary | Dual-runtime and generic broad gates pass; candidate SHA, independent fixed-diff reviews and CI remain pending |

Core, adapter, guard ledger and public-comparison contracts were not changed.
There were no provider calls, keys, retries, corpus reads, production writes,
commits, pushes, releases or merges in the implementation packet.
