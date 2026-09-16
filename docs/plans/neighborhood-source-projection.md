# Opt-in neighborhood source projection

Fixed base: `964e4e5879956adb816c4920f2cda7a01015a6e3`.
This is a read-path contract, not a semantic correction or answer-quality claim.

## Acceptance

- NSP1. `core.recall` and local MCP `recall_memory` accept optional
  `sourceProjection: 'neighborhood-sources-v1'` only with
  `contextMode: 'rationale-neighborhood-evidence'`, one read-set namespace,
  `includeQualification: false`, and ordinary selection (no `selectionMode`).
  Unknown values and incompatible combinations fail `invalid_input` before
  select/rank calls. Omission preserves byte-identical default, source-evidence,
  and rationale-neighborhood results and prompts.
- NSP2. A shared pure core projector runs only after recall's authoritative
  final reread. It performs no callback, model call, fetch, or write. It checks
  exact root/source identity, current revisions, receipt completeness and
  order, same index epoch, anchored relationship shape, and exact duplicate
  agreement, then unions selected roots and their returned neighborhood
  sources in stable root-first order. The projected result contains canonical
  source DTOs and mechanical `coverage`, `namespaces`, and
  `sourceProjection` markers, including on an empty complete result. It
  contains no relationship graph/status, generated summary, decision basis,
  or qualification interpretation. Existing namespace metadata outside source
  DTOs remains unchanged.
- NSP3. Require complete map/fetch traversal and at most six unique current
  source memories. Bound `JSON.stringify(projectedValue).length` to 24,000
  JavaScript UTF-16 code units; retain existing per-receipt, per-neighborhood,
  fetch-token, rank-token, and model-output limits. Partial traversal,
  overflow, and conflicting duplicates fail closed: never truncate, infer a
  missing source, retry, or fall back to the unprojected graph result.
- NSP4. Move the reusable RN DTO projection/validation from the evaluation NC
  wrapper into core. The evaluation wrapper imports that pure core projector
  and keeps its MCP-envelope, caller-declared mode, answer-consumer, and
  completion validation. Production code must not import evaluation code or
  maintain a second validator fork. Existing NC public behavior and tests
  remain unchanged.
- NSP5. Add only the optional MCP recall parameter and description, SDK/MCP
  protocol and feature documentation, changelog entry, and package allowlist
  if a new core file is added. No new tool, default, model call, prompt,
  timeout, retry, paid request, persisted field, deployment, or merge.
- NSP6. Scripted core tests compare ordinary RN and projected recall select/
  rank input and call counts; prove old-root selection yields outgoing later
  decision and challenge-to-separate-support original sources but no graph
  interpretations in projected output. Exercise complete empty marker,
  partial/oversized/conflicting data, stale or mutated rank/read source,
  namespace and invalid option combinations. Source presence does not prove
  relevance, truth, adoption, or answer quality.
- NSP7. An actual installed, cold stdio MCP fake-HTTP test requests the new
  option, proves the installed shared projector is packaged, and compares
  complete original source bytes, prior RN rank input, model call count, and
  before/after keyless stored sources and graph. It sends no credential or
  real provider request.
- NSP8. Worker runs focused, full core/MCP/NC/artifact, contributor demos,
  generic/JSON/strict validation on Node 22.16 and 24.15. Record exact
  commands, caller/entrypoint impact, scope and candidate SHA; freeze a scoped
  local commit without push. Primary reruns affected paths and obtains
  independent Standards and Spec reviews before delivery.

## Error mapping and trust boundary

Invalid request value, wrong mode, multiple namespaces, qualification or
selection conflict → `invalid_input` before model calls. More than six unique
sources or 24,000 serialized projected-value UTF-16 units →
`context_item_too_large`. Noncomplete map/fetch coverage →
`context_budget_exceeded`. A malformed internal source/edge DTO or corrupt
receipt association → `storage_error`; revision/epoch mismatch or conflicting
copies of the same source → `revision_conflict`, following existing read-path
conventions. The ranker still receives unverified RN relationship proposals;
only the final opt-in output removes them. A complete transport marker does
not certify semantic source completeness or continuing truth. The present
natural comparison ended with six answer arms and two unrun; it establishes
no general answer utility of this projection.

## Entrypoints and dependent checks

`core.recall` → MOC select → RN fetch/expand → unchanged RN rank → authoritative
final reread → pure projection; local MCP `recall_memory` forwards the strict
option to that same core entrypoint. `core.fetch`, public rationale inspection,
capture, storage and existing source-answer preparation remain unchanged.
The NC evaluation MCP-envelope adapter reuses the pure projector. Dependent
checks: existing core recall/RN/source-context tests, MCP recall schema and
cold stdio tests, NC pure and installed tests, artifact allowlist/integrity,
store/MOC/recall demos, generic validation and JSON/strict plugin checks.

## Implementation and verification record

Implementation owner: Sol/high. The change is confined to the shared pure
projector, the opt-in `core.recall` return path, the MCP recall option, the NC
evaluation adapter, package manifest, focused tests, and adjacent documents.
The default recall return and all selection/rank prompts remain unchanged.
The NC adapter retains its existing answer-body bound independently of the
new projected-value bound. No fixture, scorer, grant, ledger, or provider
transport was changed, and no paid request was made.

Worker verification on Node 22.16 and 24.15: focused core/NC/MCP/installed
fake-HTTP tests; full core and MCP suites; installed artifact suite; generic
suite; live-evidence offline suite; store, MOC, and recall demos; JSON and
strict plugin validation. The installed test closes the first MCP process and
opens a fresh cold process before requesting the projection. An initial
negative test used a read set already rejected by ordinary recall, so it was
replaced with a legal personal-plus-project control that ordinary RN accepts.
Another test fixture exceeded the existing four-receipt source limit; it was
corrected without changing production limits. Neither was a runtime defect.
Commands in each runtime were `npm run test:core`, `npm run test:mcp`,
`npm run test:artifact`, `npm run test:live-evidence-offline`, `npm test`,
`npm run demo:store`, `npm run demo:moc`, `npm run demo:recall`,
`npm run validate`, and `npm run validate --prefix tools/plugin-validation`;
focused runs used `node --test` on the affected test files. Node 24 was
selected by prepending its installation's `bin` to `PATH`.
Final full core passed 711/711 and full MCP 73/73 on each runtime. The
installed artifact suite passed 71/71, generic suite 141/141, and live
offline suite 269 passed with 30 intentional skips on each runtime; all
listed demos and validations passed. The final core and MCP reruns followed
the last test-only edits. Artifact and live-offline suites ran with the same
runtime but before those test-only additions; the installed projected-call
test itself passed on both runtimes.

The primary owns independent affected-path reruns and dual reviews after the
scoped candidate is frozen. These checks establish protocol and data-boundary
behavior, not semantic source relevance or answer improvement.
