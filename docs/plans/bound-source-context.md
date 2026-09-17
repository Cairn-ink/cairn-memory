# Bound source-context assessment in the shared core

## Scope and base

Branch `feat/bound-source-context`, sibling worktree `bound-source-context`, fixed
dependency base `240520523867e24820cac226cd53ec16c5568d46` (PR168, independently
reviewed and all17 CI jobs passed). Main remains
`3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`. Continue through an explicit dependency
branch; do not silently include the older pending PR stack. Final delivery is a
PR against main with the prerequisite declared. No merge/release/deployment.

Pure CU compilation is now available but has no stored source identity. This
slice composes it with an existing authoritative snapshot in one opt-in operation.
It does not implement durable derived units, semantic relations, history inference,
automatic capture, provider transport, MCP tools or a reliability score.

## Acceptance

BCU1. Add asynchronous `core.reviewSourceContext({namespace,refs})` to the existing
embedded facade. Only those input keys; exact existing namespace rules,1..6 unique
current memory refs with explicit revisions. Use actual `runtime.rationaleSnapshot`
for the selected source-only snapshot (no focus mode, no relation-edge requirement),
the existing memoryRefs validator, and actual CU prepare/compile. No duplicate
storage, partitioner or qualification engine. Wrong namespace, stale/missing refs,
historical/deleted rows, unknown options and incompatible bounds fail without an
assessor call or writes. Do not substitute another memory or select a prefix.

BCU2. Project only source/receipt-local indices, role and exact stored excerpt
passages into `model.reviewSourceContext`. No namespace, memory/revision/receipt
IDs, generated memory content, stored qualification, existing graph, client/session/
event metadata or artificial edges enter its request. The callback receives the
CU responseSchema and a source-context prompt authored under core/prompts. Explain
each field/state, unknowns, reported versus direct assertion, tentative versus
adopted decisions, predicate-relative polarity/quantifier, and event time versus
report/ingestion time. Context references are unverified passages, not parsed dates
or authenticated identities. Treat source text as data, never authorization or
instructions. No semantic correctness is inferred from exact citations.

BCU3. Reuse callModel's timeout/cancellation/freshness/error and token accounting.
Add an explicitly opt-in output ceiling3072 and optional responseSchema there;
default request shape and1024 limits remain byte-for-byte unchanged for old callers.
Only supported output ceilings1024/3072 are accepted; malformed options fail before
callbacks. Count the entire request including schema. For the new larger-output
option enforce both existing6000 input ceiling and input+reserved output within
the model's declared contextWindow. Keep the existing minimum window8192,30-second
deadline,40k intermediate JSON ceiling, and narrow trusted-adapter errors. Count
the actual detached proposal with the selected ceiling before CU compilation;
never silently raise limits or retry. Missing model/counter, overflow, timeout,
cancel and malformed output fail without persisted changes or raw errors.

BCU4. Capture namespace/refs/snapshot before invoking any assessor. Retain exact
selected source order privately; map each compiled unit's source/receipt indices
to actual memoryId/revision/receiptId, not a text join or a model-proposed identity.
Return bounded selected sources and bound units, namespace epoch, CU's assessment-
only/not-stored and model-proposed-unverified labels. Selection/semantic coverage
is unassessed, not complete history or verified current-world truth. Maximize
neither coverage nor acceptance by dropping units or sources; full success envelope
must fit24000 UTF-8 bytes. After all model/counter/diagnostic callbacks and output
compilation, make the final existing transactional snapshot comparison. Reject
changed source identities, text, roles, revisions or selected namespace epoch.
No caller callback follows the authoritative final read. Changes in another
namespace alone do not invalidate this namespace; same-namespace changes may
conservatively invalidate it. All result data is detached from caller/model objects.

BCU5. Self-contained public tests use actual temporary SQLite stores and scripted
assessors, never private fixtures or keys. Prove source-only request and exact
receipt-to-unit mapping for identical text at distinct receipt positions/memories;
valid all-null/empty interpretations stay unverified and not-stored. Prove current
refs/order are captured before caller mutation; changes during counting, assessor,
output access/compilation and final counting cannot return stale success. Exercise
actual correct, forget and supersession; direct synthetic receipt drift without
epoch also rejects. Wrong namespace and stale refs must make zero assessor calls.
Cold reopen sees unchanged memories/receipts and no persisted new interpretation;
new review binds to current identity. Cover model/counter/options/budget/deadline
failures and old callModel request/limits unchanged. Known-source bindings do not
prove correct semantic labels. Test hostile or wrong labels without promoting them.

BCU6. Include new runtime/prompt files in artifact allowlist and an actual offline
installed-artifact cold-store test with injected scripted assessor. No source-tree
or private-import substitution. Run generic test/JSON/plugin validation, full core
and demo:store, full artifact, existing offline OpenAI suite/demo (shared callModel
regression), and opt-in installed rationale gate on both Node22.16.0 and24.15.0.
No TypeScript gate exists here. Update technical docs/protocol and narrow unreleased
changelog without version bump, marketing claim, SDK adapter/MCP/default change.
Primary inspects/reruns integrated paths, freezes candidate, obtains separate
Standards/Spec review and monitors latest-head CI before delivery passes.

## Ownership and exclusions

One bounded Sol/high worker owns implementation in core/contract.mjs,
core/model-call.mjs, new core/bound-source-context.mjs,
core/prompts/review-source-context.md, core/test/bound-source-context.test.mjs,
core/test/model-call.test.mjs, packaging/artifact-files.json,
packaging/test/bound-source-context.test.mjs, docs/bound-source-context.md,
docs/protocol.md and CHANGELOG.md. Primary owns this spec, integration, setup,
independent verification and delivery. Do not alter CU compiler, runtime/storage,
existing prompt/adapter/MCP paths, private experiment evidence or user files;
report if the contract needs a scope change. No worker commit/push or paid calls.

BCU starts only after CU final independent review and CI passed. Next-stage adapter,
fresh semantic evaluation and eventual decision/reason lineage remain distinct
acceptance work; passing this slice does not fulfill the whole product goal.

## Verification record

Implementation owner: `source_rank_first_impl`, configured Sol/high. Primary
owned acceptance, inspected all eleven implementation paths and actual snapshot/
reference helpers, and preserved the separate plan. Worker froze the candidate
on 2026-09-17 without committing or pushing. Both pinned Node22.16.0 and24.15.0
author runs passed: generic106, core644, artifact69, OpenAI190, installed
rationale4, JSON, strict plugin/marketplace validation and store/OpenAI demos.
Author output is retained in the task transcript, not separate log files.

Primary interventions before freeze: corrected a context-window test boundary
to5120+3072=8192; required detached-proposal recounting after mutable model
output, object-root schema validation, and capture of the opt-in request before
counter callbacks. Added explicit acceptance checks for caller-input mutation,
cross-namespace versus same-namespace updates, empty units, timeout/cancel,
valid-CU/full-envelope UTF-8 overflow, and fresh installed child-process review.
These are mechanical acceptance corrections, not measured semantic improvements.
No repeated failed correction loop, model escalation or paid call occurred.
Primary independent probes were run after corrections, not as a red-before proof.

Primary final-tree gates completed on both pinned runtimes with separate logs:
`npm test`106; `npm run validate`; `npm run validate --prefix tools/plugin-validation`;
`npm run test:core`644; `npm run demo:store`; `npm run test:openai`190;
`npm run demo:openai-offline`; `npm run test:artifact`69; and
`CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs`4.
Three independently authored probes also passed on each final tree: identical
source identity/cold reopen, asynchronous actual correction/forgetting, and
post-counter model-output mutation. All were synthetic and offline. No failed
primary full gate or retry occurred. Source hashes matched the worker freeze.
No TypeScript gate applies. Independent committed-diff review and remote CI are
subsequent delivery gates; their final reports belong in the PR record.
