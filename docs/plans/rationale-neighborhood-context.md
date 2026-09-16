# Explicit bounded rationale-neighborhood evidence

Fixed base: `35f2c56f0df725b8959e7b088cbd8c247f6c3c8a`.
This independent read-path improvement does not require accepting or persisting
any disposition projection. A graph can be correctly stored yet omitted from
the context delivered to a caller. Test that boundary with explicit synthetic
links; do not use it to claim the model inferred those links correctly.

## Acceptance

- RN1: Add an explicit `rationale-neighborhood-evidence` context mode to the
  embedded source-evidence fetch/recall paths and MCP recall schema. Omission,
  `source-evidence` and existing `rationale-evidence` remain unchanged. Existing
  qualification conflicts, current-only rationale restriction, cursor binding,
  source-only projection, limits and freshness checks also cover the new mode.
  Do not enable it by default or automatically change host configuration.
- RN2: Define the bounded view as the union of existing decision-context edges
  (incoming support, incoming direct challenge, challenges to those supports)
  and the selected root's incoming/outgoing incident proposals. Deduplicate
  exact source/receipt/relation tuples. Do not replace decision-context with
  incident-only, which would lose challenges to separate support cards. There
  is no arbitrary recursive graph walk, inferred edge, chronological heuristic
  or commitment of model output. Reuse the existing six-source/ten-edge and
  total serialized/token bounds; fail closed rather than silently truncate.
- RN3: All edges remain model-proposed; explicitly label coverage as this
  bounded root neighborhood, not complete memory or current truth. Return
  retained source receipts and versions. A challenge may suggest reconfirmation
  but cannot cancel a decision, adopt a replacement or grant execution authority.
  Source, graph, qualification, MOC and namespace epoch remain unchanged.
- RN4: Carry the same neighborhood through actual ranking input and the final
  authoritative source reread, then into actual MCP tool JSON. Reuse the existing
  rationale ranking instructions, without tuning any frozen disposition/control
  prompt, fixture or rubric. Root selection is still a separate limitation;
  this change must not claim to fix missing-root retrieval or semantic accuracy.
- RN5: Add a synthetic installed-MCP cold-reopen test. Seed a current old
  decision receipt explicitly containing its price premise; another receipt
  supplies its distinct historical reason. Add later evidence challenging that
  reason and a later adopted decision explicitly grounded in the old receipt's
  price premise. Seed source-grounded incoming support, challenge-to-support,
  and outgoing support-to-later-decision using a scripted model. Force selection
  and ranking of only the old root. Assert old modes unchanged, new mode carries
  both the support-chain challenge and outgoing later-decision evidence in rank
  input and final MCP result, with precise receipts and unverified labels. Verify
  persistence unchanged after keyless cold reopen. No real provider is used.
- RN6: Tests cover shared self-support deduplication, empty neighborhoods,
  six-source/ten-edge/byte/token ceilings, unsupported historical fetch,
  qualification conflict, wrong namespace, changed revision/receipt or graph
  during selection/ranking/counter callbacks, and cursor mode mismatch. Any
  invalid/stale evidence rejects instead of leaking partial trusted context.
  Preserve default API and existing installed/core/MCP tests.
- RN7: One Sol/high worker owns implementation and tests in this worktree.
  Allowed scope: core source-evidence mode classification, rationale read
  storage, runtime/fetch/recall/contract wiring as necessary; MCP recall schema;
  focused core/MCP/installed tests; one feature doc, this plan and changelog.
  Do not alter model/provider profiles, prompts, DB schema, write paths,
  experiment guards/budgets/operators, fixtures, public plugin hooks, private
  product, deployment or publication. A public inspect view is not needed for
  this slice; keep existing inspect modes unchanged. Record affected entrypoints
  and checks. Run full core/MCP/artifact/adapter/generic/JSON/strict gates and
  store/recall/adapter demos on Node22.16/24.15, serializing heavy suites.
  Freeze scoped candidate; primary acceptance plus independent Standards/Spec
  reviews and latest-head PR CI are required. No merge or paid calls.

## Nonclaims

This delivers already-stored, unverified evidence through a bounded opt-in
read path. It does not establish relationship correctness, automatic update,
answer quality, general reliability or complete decision history. The separate
fresh disposition experiment remains read-only and independently gated.

## Implementation and verification record

The Sol/high worker used this isolated worktree at the fixed base above. The
entrypoint chain is `core.fetch`/`core.recall` and local MCP `recall_memory` →
closed source-mode validation and cursor binding → transactional
`readUsageEvidence` → private `root-neighborhood` union in rationale storage →
existing source-aware rank input and final authoritative reread. The existing
public `getRationale` inspect view list remains closed. The helper uses no new
table, write mode, provider method or model prompt. The union keeps the
decision-context support-chain challenge even when the root incident scan
would omit it, while adding root outgoing proposals. `unassessed` is deliberate:
an outgoing challenge may concern another decision, so a generic selected-root
reconfirmation label would misattribute it.

Affected callers/check owners: new core test covers fetch/recall, cursor,
current-only and qualification validation, source/edge/byte/token limits,
callback mutation, outgoing-only challenge status and old-mode compatibility. New installed-artifact test
covers real MCP stdio, forced old-root selection/ranking, final JSON, prompt
reuse and keyless cold graph equality. Existing core, MCP, adapter, artifact,
generic and store/recall/adapter demos are regression owners. The ordinary
MCP tool description now makes the explicit mode discoverable; no host default
configuration is changed.

Worker gates before the final description/test-only edit: full core 705/705,
MCP 73/73, OpenAI adapter 198/198, artifact 71/71, generic 139/139, JSON
validation and strict plugin/marketplace validation all passed on Node 22.16
and 24.15, run serially. Store, recall and offline-adapter demos passed on both
runtimes. The final focused core tests passed 9/9 and the installed test 1/1 on
both; the outgoing-only challenge check was added after the full core suites,
then passed in both focused runs. Full MCP and artifact were rerun after the
MCP description edit; the final added core-only assertion does not affect
those suites. These tests use
synthetic data, installed local artifacts and fake HTTP only; no provider key,
shared campaign ledger or paid call was used. They establish propagation and
boundaries, not semantic correctness or answer quality.
