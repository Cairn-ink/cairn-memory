# Direct candidate citation experiment

Status: offline decision experiment, not production wire adoption. Fixed base:
`0752c95c8fe7069a958bf115c1537f34a402a08f` (bounded partitions, PR #253).

## Objective and boundary

Determine whether direct original candidate IDs can remove the provider-only
pool/slot lookup while preserving the exact core qualification contract. This
cannot establish semantic improvement or explain the two official slot failures:
their malformed response payloads were not retained. Do not replay those cases.

Owner: one GPT-6 Sol/high worker; primary owns design, acceptance and decision.
Separate Standards and Spec reviewers inspect the same final committed diff.
Scope: new files under `evaluation/qualification-wire/`, one automatically
discovered `adapters/openai/test/direct-candidate-wire-experiment.test.mjs`, this
plan and bounded evidence notes in `docs/limitations.md` / `ROADMAP.md`.
Do not edit production core, adapter, shared interpretation prompt, profiles,
guard, grant, package, workflow or installed-harness configuration.

## W1 — Freeze the alternate wire

Implement an explicitly experimental `direct-candidates-v1` wire with an object
of named `item_N` entries, matching itemIndex and the seven existing fields. Each
field retains `{value,evidenceIndices}` with original candidate IDs, not positions
in a chosen pool. Reuse per-item `$defs` and nested known/unknown `anyOf` schemas;
known fields still require at least one citation in the provider schema. All
objects require every property and reject additional properties. Candidate enum
membership is per item. Do not rely on undocumented `uniqueItems` support.

Use the unchanged shared interpretation guide with a separately frozen alternate
wire wrapper. Freeze reproducible prompt and schema digests. Preserve baseline
model, reasoning and 6,000 local/full-count-body, 7,024 provider-count, 1,024
output ceilings. No changes to production/default settings or model choices.

## W2 — Compiler equivalence, not response repair

Decode a detached plain-data experimental response to the unchanged core DTO,
then invoke the actual `compileQualificationCandidates` with the actual source
snapshot. Compare complete compiled results with the current pool decoder plus
compiler for valid one/five-item, reordered-key, noncontiguous candidate-ID and
rebased-singleton fixtures. Exact receipt/anchor offsets, text and fields must
match, including Unicode and multi-window support.

Reject duplicate/foreign candidate IDs, known value without evidence, zero
evidence overall, over four distinct anchors, wrong/missing/extra/repeated items,
wrong versions, invalid value types, malformed objects/accessors/sparse arrays.
Do not deduplicate, guess, repair, retry or silently drop evidence. Prove duplicate
rejection still exists: eliminating pool range errors does not eliminate every
citation error or prove live-model improvement.

## W3 — Reproducible request and output capacity

Create receipts through the actual core snapshot, never fabricated source bounds.
Measure 1 and 5 items for short, four 200-unit ASCII receipts, four
800-UTF-16-unit ASCII receipts, and four
codepoint-boundary Unicode receipts per item. Assert actual candidate counts;
Unicode can produce 20 candidates, not the ASCII case's 16. Include escaping in
the serialized count and generation body. No evidence omission/truncation.

Capture the current adapter's actual fake-HTTP bodies for fitting fixtures and
prove byte equality with the baseline measurement serializer. For oversized
fixtures, record zero current-adapter dispatch and label reconstructed baseline
bodies as modeled. Prototype bodies are from the experimental serializer, not
production adapter dispatch. No claim of actual provider schema acceptance.

Report baseline/prototype prompt, schema, logical input, full count body,
generation body, compact output and maximal legal label output token counts.
Separate prompt savings from schema savings. Include a schema-only comparison
using the same baseline instructions as a measurement control (not an executable
prompt/wire pairing). Any bound excess is reported as refusal, never repaired.
Also compare the whole-inline/whole-catalog/fully-preflighted-singleton decision
for baseline and alternate wire on these same fixtures. A smaller output that
forces a previously fitting whole batch into five requests is a cost/latency
regression, not a free improvement. Report the planned qualifier-pair count
(one, five, or refusal), without treating synthetic cases as workload frequency.

## W4 — Safety and reproducibility

Use synthetic receipts and injected fake HTTP only. No provider keys, network
model calls, source corpus, evaluator, operational ledger or paid requests. Tests
must never default to global fetch or read environment credentials. Existing
default adapter schemas/prompt/transport remain unchanged and regression-tested.
Run the experiment tests and a deterministic report twice on Node 22.16 and
24.15, generic tests/validation and complete OpenAI fake-HTTP suite on both.
Primary independently runs the experiment and checks numerical claims against
raw output; independent dual review precedes any PR push. Monitor all remote CI.

## W5 — Decision gate

Record adopt-for-separate-integration, revise or reject with exact evidence and
limitations. An engineering pass does not repair the retained official result or
certify source entailment, semantic reliability, installed Hermes usability or
MOC recall quality. Production adoption needs a separate scoped adapter/guard/
artifact/mixed-protocol contract, followed by newly frozen paid feasibility only
after resource/grant review. No merge, release, deployment or paid run here.

## Offline decision record

Decision: **revise, do not adopt wholesale or change the default wire**. This is
an engineering comparison, not a provider-acceptance or semantic-quality test.
The frozen deterministic eight-fixture report has SHA-256
`1a122f3b5b37c8f7c5a6a072543db38288ba2ef5c574e836ec47c1a5b7da2772`.
For one short item, the direct wire's modeled full count body is 2,020 tokens
versus 2,102 baseline (prompt 1,094 versus 1,112; schema 744 versus 805).
For five distinct four-receipt, 200-unit ASCII items, the current adapter's
actual fake-HTTP baseline fits as one whole-inline qualifier pair at 5,519
count-body tokens. The alternate whole-inline body is modeled at 7,487
tokens (prompt 1,130 versus 1,148; schema 3,544 versus 1,555), so its
bounded plan takes five singleton pairs. The same five-item compact output
saves only 21 tokens (519 to 498); a structurally valid maximal-label output
exceeds the unchanged 1,024-token output cap for either wire. This specific
synthetic scheduling/cost regression outweighs the small one-item saving.
The four 800-unit ASCII and selected Unicode-boundary fixtures are examples,
not worst-case token bounds or workload frequencies. The report labels
reconstructed oversized whole bodies as modeled and confirms zero current-
adapter fake-HTTP dispatch on those refused whole requests. A separate fitting
repeated-text catalog control checks actual adapter body bytes. Direct bodies
remain experimental modeled serializations and have not been accepted by a
provider. Any later design must preserve the existing batch schedule or
justify extra requests using fresh semantic evidence; that is another packet.

Implementation owner: GPT-6 Sol/high on fixed base
`0752c95c8fe7069a958bf115c1537f34a402a08f`. Only the new experiment
modules, one discovered adapter test, and these technical notes changed. The
six focused experiment tests and report command each passed twice on Node
22.16 and 24.15; all four report files were byte-identical (including the
trailing newline) at SHA-256
`d668d6871d1c268a723f2d9d3d90f88d8acf3c9e3f96637a2516d0cf7aa0b030`.
The complete OpenAI fake-HTTP suite passed 245/245, generic tests 112/112,
validation, and the OpenAI offline demo on each Node version. Commands:
`node --test adapters/openai/test/direct-candidate-wire-experiment.test.mjs`,
`node evaluation/qualification-wire/report.mjs`, `npm run test:openai`,
`npm test`, `npm run validate`, and `npm run demo:openai-offline`; Node 24
used the pinned v24.15.0 binary with equivalent direct entrypoints. Raw logs
are retained in `/tmp/cairn-direct-wire-gates.W6ciev/`. No live transport,
credential, corpus, evaluator, operational ledger or paid request was used.

## References

The official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
documents nested unions, reusable definitions and array length constraints. It
does not make source entailment a schema property. This experiment uses that
documented subset; fake HTTP is not a provider-acceptance test.
