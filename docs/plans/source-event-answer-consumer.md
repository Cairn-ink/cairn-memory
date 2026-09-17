# Evaluation-only source-event answer consumer

Fixed stacked base: `ff30ac05e3d91d259dca71348b0cf770bf220109` (PR164).
Branch `test/source-event-answer-consumer`. This is the next receiving boundary,
not a default host integration, production answer generator or paid experiment.

## Acceptance

- EAC1: Add an explicitly named evaluation-only prepare/deliver consumer for
  the new `neighborhood-source-events-v1` MCP output. Require explicit requested
  RN context, event projection and source-first ranking markers, one complete
  namespace, exact envelope/value/event/association shapes and trust/unassessed
  markers. Reject legacy/mixed/malformed/incomplete shapes before completion.
  Existing answer consumers and core/MCP behavior remain unchanged.
- EAC2: Preserve event order, full retained text, submitted role, collision flag
  and every distinct memory/revision/currentness/receipt association. Never
  flatten events into representative cards, silently regroup, drop associations
  or infer an event identity from equal text. Enforce six events, 36 nonduplicate
  associations, valid identifiers/revisions/currentness, nonempty bounded source
  text and arrays. Reject conflicting receipt bindings and inconsistent copies
  of one memory revision/currentness. Empty complete evidence is explicit.
- EAC3: Build an answer request using the existing source-answer model and
  source-only instruction unchanged. The new user payload carries question and
  sourceEvents, not legacy memories or fake source cards. No namespaces, raw
  private provenance keys, graph proposals or generated summaries reach it.
  Retain current no-tools, one output, nonstreaming, no-store, 1024 completion
  cap and 24,000-UTF8-byte complete-body limit. This is an input-only comparison
  protocol, not a prompt/model experiment. Reject secrets/malformed Unicode,
  oversized envelopes, values or bodies; no truncation/fallback.
- EAC4: Completion remains injected and at most once. Invalid source calls zero
  times; failed transport and invalid output remain visible; successful plain
  text is only `generated-unassessed`, not verified citation/entailment. Preserve
  exact association inventory in the outgoing context so later source-grounded
  review is possible. This step does not validate an answer's semantic citations.
  No provider client, key, budget ledger, grant, retry, graph write or live call.
- EAC5: Offline tests exercise all boundaries and prove full six-event/seven-card
  context reaches a fake completion once. Include equal-text distinct events,
  collisions, duplicates/conflicts, bad markers/namespace, wrong legacy shape,
  UTF8 caps, currentness and malformed output. Add a receiving integration test
  using the actual installed artifact and stdio recall into this consumer, with
  a fresh synthetic SQLite fixture; expected text/bindings come from original
  receipts, not reconstructed hand-authored output. Snapshot store before/after.
  A scripted answer is mechanical evidence, not a quality score.
- EAC6: Run full live-evidence-offline suite on PATH-pinned Node22.16/24.15 after
  isolated MCP/OpenAI dependencies, plus generic, JSON and strict plugin gates.
  Run installed receiving gate on both versions after packaging cache preparation.
  Generic Node20 must remain supported without static SQLite imports. Primary
  inspects actual diff and reruns focused ordinary/installed entrypoints on the
  final candidate. Separate independent Standards/Spec review then PR latest-head
  CI. No merge, registry publication or deployment.

## Ownership and scope

One Sol/high worker owns a new evaluation/live source-event consumer, targeted
ordinary/installed tests and fixture, this plan and a concise usage/boundary doc.
It may extract a small shared response-validation/delivery helper from the
existing installed source-answer consumer if behavior is exactly preserved and
legacy tests rerun. Do not change old prompts, experiment operators/policies,
real fixtures/ledger, core storage/capture or production entrypoints. Main owns
contract, review of actual evidence and delivery. No public quality claim.

## Implementation and entrypoint record

`evaluation/live/source-event-answer-delivery.mjs` is a new opt-in evaluation
entrypoint. It reuses the unchanged source-answer model and instruction from
the existing installed consumer, but does not call or modify that consumer's
legacy prepare/deliver path. The duplicate small completion-result validation
is intentional: extracting it would change a shipped evaluation entrypoint for
no necessary behavior gain. The only new model-facing payload is the question
and the exact source-event array. `currentness: 'current'` validates SEP's
stored-card state, not the time described by an excerpt.

The ordinary receiving tests are discovered by the existing
`test:live-evidence-offline` glob. The installed receiving test is discovered
unconditionally by the existing `test:artifact` glob and CI MCP/artifact job
after its cache-preparation step; there is no new workflow switch whose skipped
state could masquerade as installed coverage. The existing legacy source
answer and neighborhood answer entrypoints remain unchanged and are rerun in
the full live-evidence suite. No actual answer host is integrated.

## Offline verification record

The worker installed isolated dependencies with `npm ci --prefix adapters/mcp`,
`npm ci --prefix adapters/openai` and `npm ci --prefix tools/plugin-validation`
under Node 22.16.0, then ran `node packaging/prepare-cache.mjs` before artifact
tests. Every Node 22/24 command below used
`PATH=/home/chichieh/.nvm/versions/node/<version>/bin:$PATH` for npm and its
children, not only a direct node binary.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm run test:live-evidence-offline` | 274 passed, 30 existing opt-in skips, 0 failed | 274 passed, 30 existing opt-in skips, 0 failed |
| `npm run test:artifact` | 74 passed | 74 passed |
| `node --test evaluation/live/test/source-event-answer-delivery.test.mjs packaging/test/source-event-answer-delivery.test.mjs` | 6 passed | 6 passed |
| `npm test` | 143 passed | 143 passed |
| `npm run validate` | passed | passed |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin passed | marketplace and strict plugin passed |

Actual Node 20.20.2 ran through `npm exec --yes --package=node@20.20.2 -- sh
-c 'node -v; npm test; npm run validate'`: generic tests had 136 passes and
seven expected SQLite-only skips, no failures; JSON validation passed. No
provider call, real budget ledger, scored evaluation or live result is implied
by these checks.
