# Currentness diagnostic — offline preparation

This new diagnostic asks both whether a confirmed change replaces an old fact
and whether proposals, disagreements or quoted text can incorrectly change it.
It is not a broad benchmark or a measured real-model accuracy claim.

The [frozen acceptance plan](plans/currentness-evidence.md) contains seven cases,
15 capture windows, nine queries, 19 required and 15 forbidden propositions.
Sources and the evaluator-only rubric have separate pinned hashes. The original
failed four-history experiment remains untouched; this corpus does not replace
its denominator, labels or evidence.

The scenarios cover an explicit schedule update, rejected/uncertain proposals,
attributed unresolved disagreement, different subjects/properties, separate
namespaces, a historical quotation, and an untrusted quoted instruction.
Recounting a past Friday must not restore Friday as current. A quoted instruction
may remain inspectable as attributed context but cannot authorize a deletion or
turn an invented identifier into a real operation target.

## Evidence and independent review

`runCurrentnessAudit({model,directory,onProgress?,readDiagnostics?})` uses the
actual public core, with an injected model and a fresh private temporary
directory. It captures each source window once, retains complete active and
historical records and source receipts, and verifies a cold reopen after every
window. Final recalls use fresh core instances. The namespace-isolation case
shares one database, so separate stores cannot hide a scoping defect.

Fixture order supplies the causal sequence. This is not a generic host ordering
implementation, an automatic MCP hook or a model inference about chronology.
There is no manual supersession, correction, deletion or retry to repair output.
Failed attempts, partial observations and not-run work remain in the report.

`scoreCurrentnessAudit(report,{review})` checks structure, source/namespace
bindings, real historical transitions, admission versus post-filing revisions,
and authoritative current recall. It also requires complete independent labels
for every observed memory revision, required/forbidden proposition and returned
memory/query. A report digest binds the labels to the report bytes; it does not
prove reviewer independence. Empty evidence or missing labels cannot pass.

Both structure and semantic review must pass. An engine's historical state does
not certify that retirement was justified. Scripted decisions and all-true
labels in tests demonstrate the harness, not actual model quality.

## Offline verification

```sh
npm ci --prefix adapters/openai
npm run test:openai
npm run demo:openai-offline
npm test
npm run validate
```

Run on Node22.16 and24. No provider, key, live CLI or network transport is
discovered by the runner or scorer. Supplying a real model would still require
explicit credential/method authorization and cumulative spending controls.

The installed-artifact ordered lifecycle is the next separate gate: capture,
fresh MCP current recall and history inspection, explicit correction, forgetting,
and complete empty current recall without resurrecting history. Fresh paid
evidence remains unrun here. No public launch or autonomous host-capture claim
follows from the offline tests.
