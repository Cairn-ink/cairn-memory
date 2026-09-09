# LongMemEval capture ingestion — source maps, not scores

This adapter consumes the answer-blind history from
[preparation](benchmark-preparation.md) and plans calls to the existing public
`core.capture` API. It is programmatic capture, not explicit MCP memory admission
or a second memory engine. No model provider, dataset download or paid runner
is selected automatically.

The operator must verify the prepared history artifact's pinned digest before
parsing it. The in-memory API checks shape and source mapping, not upstream
authenticity. Keep one fixed dataset/preparation per evaluation namespace;
changing source under existing event IDs is not a supported resume strategy.

## What is preserved

Every original turn retains its role, session occurrence, original date and
raw text. Oversized turns are split on Unicode code-point boundaries, with
UTF-16 offsets mapping each derived message back to its original turn interval.
Repeated original session IDs remain separate indexed occurrences. Derived IDs
are deterministic and bounded for the core; dates remain source-map metadata,
not invented extra dialogue fed to the extractor.

**Lossless source reconstruction is not verbatim engine storage.** The existing
core normalizes Unicode, folds whitespace, redacts supported secrets and bounds
receipt excerpts. The source map preserves raw text independently; normalized
capture inputs and shorter receipt excerpts must not be presented as the full
original corpus. Keep source maps private like the original histories. Never
hand evaluator answers/labels or the preparation manifest to the extractor.

Each planned batch is checked against the actual capture input validator:
at most 24 messages, 4,000 normalized UTF-16 units per message and 20,000 total,
while respecting the separate raw-input bound. A blocker prevents the entire
case from executing; no invalid turn is silently dropped to obtain a pass.
These are structural limits, not token counts. The model context check can
still reject a batch, and splitting may lose cross-chunk reasoning context.
The adapter does not raise limits or claim unchanged semantic quality.

A credential split across chunks could evade a per-message redactor. If a turn
needs redaction and cannot fit in one capture message, the conservative policy
is to block the case rather than split that turn. Blocked source remains in the
private plan for inspection/reconstruction; it is not sent to the capture API.

## API

From the repository root on Node >=22.16:

```sh
npm run test:longmemeval
npm run demo:longmemeval-ingestion
```

The suite includes both preparation and ingestion tests. The demo uses scripted
models and a new synthetic SQLite file that it retains for inspection; no key,
provider request or existing user database is involved.

The in-memory entry points in `evaluation/longmemeval/ingestion.mjs` are:

```js
import {
  planLongMemEvalCase, ingestLongMemEvalCase,
} from './evaluation/longmemeval/ingestion.mjs';

// `history` is one validated history.jsonl record, not the whole output folder.
const namespace = { ownerId: 'synthetic-evaluation', scope: 'project', projectId: history.question_id };
const plan = planLongMemEvalCase({ history, namespace });
// Planning is offline and performs no capture/model calls.
console.log({ executable: plan.executable, summary: plan.summary });

// Only in an explicitly authorized runner, with a synthetic/test core here:
// const result = await ingestLongMemEvalCase({
//   history, namespace, capture: input => core.capture(input),
// });
```

The plan exposes ordered `batches`, per-batch `captureInput`, the actual
`normalizedCapture` (messages, total length and payload digest) and `sourceMap`,
plus explicit `blockers`. The private `sourceTurns` snapshot retains even blocked
turns for exact reconstruction. Source-map raw
offsets are UTF-16 positions in the original turn, not token offsets. The runner
returns the plan and one `outcomes` entry per batch. Treat the entire result
as private source-bearing evidence, not safe public telemetry.

## Execution and evidence

Execution requires an explicitly injected capture function and exact namespace.
Keep benchmark cases in distinct namespaces or fresh stores; never reuse a
production/user database. The adapter is sequential and never automatically
retries. A failure, in-progress response, partial classification or unknown
outcome stops later batches, which remain visible as not run. Completed replay
is distinct from extraction performed during the current attempt.

An error does not prove that nothing was written. Inspect persisted source
receipts and the admission state before deciding whether to retry. Forgetting
must remain suppressed on completed event replay. Synthetic integration tests
exercise these properties through the same SQLite-backed public core.

The [acceptance plan](plans/longmemeval-ingestion.md) requires raw reconstruction,
receipt mapping, replay, forgetting and isolation checks. A structural plan or
scripted extraction success is not a LongMemEval score, source-faithfulness
guarantee or evidence that real users save time. The separate
[three-arm comparison runner](longmemeval-comparison.md) now connects retrieval,
answering and evaluator-only scoring with offline tests. Actual-model scoring,
a frozen live judge and separately authorized paid runs remain later steps.
Preserve blocked/failed cases in evaluation denominators.
