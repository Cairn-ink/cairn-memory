# Source-context basis proposals

Base: `52a95f2e0d28d2e44953aff9f9d0f1ac6c61417b`.

## Intent

Make attribution, applicability, scope and adoption context inspectable alongside
individual decision/premise/update units before testing whether this improves
source interpretation. Reuse qualification terminology without persisting a
second set of qualifications or treating model-selected citations as truth.

## Acceptance

- `reviewDecisionBasis` accepts optional `inputMode: 'source-context-v1'`.
  Omission preserves existing input/output/schema behavior; every other explicit
  value fails before provider access. This remains embedded, opt-in and read-only.
- In this mode each proposed unit additionally requires `context` with exactly
  `subject`, `applies`, `scope`, `commitment`. Each value is null (unresolved) or
  an exact unique nonblank, well-formed quote of at most 200 UTF-16 units from
  that unit's selected receipt. These are evidence quotes, not normalized labels.
- Compile nonnull context quotes into `{start,end,text}` anchors; preserve null.
  They inherit the unit's receipt, revision and model-proposed status. Reject
  missing/extra keys, malformed/ambiguous/fabricated/cross-receipt context; no
  normalization, truncation or inferred repair. Preserve all prior graph checks.
- Send only the same canonical sources plus the mode marker, not generated
  summaries, stored qualification labels, private identifiers or metadata. Prompt
  distinguishes event/applicability time from report arrival, usual versus
  temporary scope, attributed actors, and adoption versus advice/consideration.
  Missing context remains unresolved; no automatic rejection of valid sparse
  historical evidence, adoption, state replacement or confidence promotion.
- Keep original input/output/result/unit/link/time budgets, detached-output
  counting, freshness checks and nonpersistence. Output identifies the mode.
  Added context can reduce coverage within the same budget: document, don't hide.
- Optional adapter supplies strict mode-specific schema through existing
  reviewBasis routing. Unknown modes reject before transport; no new paid grant,
  retries, default model changes, MCP tool, migrations, release or deployment.
- Verify exact context anchors, nulls, invalid fields/quotes/modes, unchanged
  default, stale sources, oversized output, cold reopening and installed archive.
  Core/adapter/artifact gates on Node 22.16 and 24 plus generic/strict plugin gates;
  independent Standards and Spec reviews before PR delivery.

## Follow-on evidence gate

This delivery does not establish semantic improvement. Freeze fresh disjoint
development/held-out conversations and source-only versus context-mode arms with
matched budgets before real calls. Score applicability and useful source-backed
answers, including omissions/rejections, rather than citation counts. Full
automatic capture/restart/recall and alternative retrieval remain later gates.
