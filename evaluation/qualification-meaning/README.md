# Fresh qualification meaning diagnostic

This prospective, single-arm diagnostic implements [Q1–Q8](../../docs/plans/qualification-meaning-probe.md).
It has no CLI, provider-key lookup, ledger creation, model invocation on import,
or production/default change. Offline plumbing results are not semantic scores
or authorization for paid calls. The twelve new sources, separate rubric and
pre-score calibration must be frozen and independently reviewed before execution.

`runQualificationMeaningProbe({ fixtures, transport, onArm? })` runs exactly two
repetitions of twelve supplied deeply frozen, plain source-only fixtures. It
validates the entire cohort before entering the guard; duplicate IDs, invalid
source input, evaluator fields and truncated retained messages are rejected.
The baseline uses the actual `captureSnapshot`, `retainedSourceView`, `callModel`,
`extractedItems` and `qualifyCandidateItems`, with the current OpenAI adapter's
adaptive text catalog and bounded singleton partitioning. Extraction receives
only indexed source roles and text; qualification receives actual extracted
content and source candidates. The runner imports no fixtures, rubric or oracle
and cannot select the combined arm.

Supply the unchanged reviewed
[`createIngestionSemanticTransport`](../ingestion-semantic/transport.mjs), which
reconstructs exact request bodies with the adapter's serializer, binds sources
and qualification candidates, reserves before HTTP, and enforces provider and
accounting authority. Its pinned model remains `gpt-4.1-mini-2025-04-14`, with
6,000 local / 7,024 provider / 1,024 output token bounds, four-source/five-item
limits and the existing 800-unit retained source window. The transport remains
limited to fixed POST count/generation endpoints, with no tools, background,
streaming, storage, persistence, classification or retrieval.

The existing cumulative US$200 ledger must be supplied with its exact fresh
checkpoint and history hash. No reset, refund, ledger creation or concurrent
writer is allowed. The inherited transport subcap is US$3 reserved and 576 HTTP
requests; this baseline-only runner starts 24 attempts and can perform at most
six count/generation pairs per attempt, so its maximum is 288 HTTP requests
(US$1.281024 reserved at 4,448 microUSD per HTTP request). Known generation
usage and reservations remain separate; count or missing usage remains unknown.
The unchanged bounds are 30 seconds per HTTP call, 180 seconds per attempt and
90 minutes for the probe. Transport byte limits and cancellation guards apply.

Every started attempt retains its status, failure stage, compiled items, original
sanitized HTTP bodies/usage and latency. Ordinary malformed/refused output,
failed counts or generations and timeouts remain failed without retries or
replacement. Empty valid extraction mechanically completes with zero cards;
it still occupies one of the 24 planned attempts and does not establish useful
coverage. No partial compiled cards survive a failed qualification. Fatal
authentication, network, authority, credential, accounting and transport-record
persistence failures stop the probe after the started row is offered to
`onArm`; an `onArm` exception itself is fatal. Core error laundering cannot
erase the transport's independent fatal latch. The result has
`attemptDenominator: 24`, complete attempt rows, all probe records, final ledger
aggregate/hash fields and total latency; it does not expose historical ledger
attempts or calculate semantic scores.

Before any explicitly authorized paid execution, independently freeze/review
the private operator manifest and fresh ledger audit. The launcher must create
its one-shot start marker before reading credentials or dispatching, durably
persist every reservation and settled record through the transport's synchronous
`onRecord` callback (returning `undefined`), persist each `onArm` row, and close
the transport in `finally`. On terminal error, retain all unfinished planned
rows as not run so the denominator never shrinks. This runner does not supply an
operator launcher or inspect any real ledger or provider credential.

Grade source/card projections with two independent agent raters without
repetition IDs or cost. This is a single-arm cohort, with no arm-blinding or
causal-comparison claim. Retain raw ratings/disagreements and adjudicate before
aggregating the six rubric dimensions. Failed attempts have null semantic
dimensions and false full-six success. Report dimension counts, mechanical
completion, full-six success, unsupported assertions/omissions, original outputs,
reservation versus known usage and both end-to-end and guarded HTTP latency.
The repeated-scenario and agent-family judge limits remain; there is no arbitrary
pass label, statistical superiority, causal comparison to the old cohort or
retroactive rescoring. The next priority remains fresh long-history six-type
feasibility unless a concrete source-fidelity or mechanical defect blocks it.

With locked isolated dependencies installed, run:

```sh
node --test adapters/openai/test/qualification-meaning-probe.test.mjs
npm test --prefix adapters/openai
npm test
npm run validate
npm run validate --prefix tools/plugin-validation
```

Run these offline gates on Node22.16 and24.15. Focused fake-HTTP tests use only
fresh temporary synthetic ledgers and source fixtures. They establish fixed
attempts, source containment, partition handling, preserved failures and fatal
guard propagation; they do not read provider keys, external corpora or the
operational ledger, and do not measure model meaning quality.
