# Checklist selection: model integration boundary

The [offline checklist](query-evidence-checklist.md) can now be connected to the
optional adapter through an evaluation-only model wrapper. This does not turn
the candidate into the default selector or a supported MCP CLI option.

`createChecklistSelectionModel(model)` wraps the adapter's existing model
interface. Only `select` changes: it prepares a detached question/map request,
calls the explicit `selectChecklist` capability once, checks the complete raw
proposal, and compiles the result to the ordinary `{ refs }` shape. The shared
core still navigates, fetches, ranks and performs authoritative freshness reads.
Other model methods and diagnostics are retained; no second engine or durable
checklist state is introduced.

The adapter's new method reuses its existing bounded request implementation and
the configured `select` profile. It adds no caller-controlled model/schema hook.
Request-scoped structured output bounds four span/reference groups; the compiler
still rejects invalid correlated references, Unicode spans and union overflow.
Schema compliance never proves that selected evidence answers the question.

The wrapper checks the actual replacement instruction/input against the existing
6,000-token input ceiling. Raw output is checked against1,024 tokens before it
can shrink into a compiled reference union. Existing serialization, byte and
adapter transport limits also apply. Signals propagate unchanged; invalid
output, unavailable counters and aborts do not trigger a repair or fallback.
Fake-service tests verify this orchestration, not model selection quality.

## Unfinished gates

- Existing budget guards reject `cairn_selectChecklist`. The subsequent
  [separate capability](checklist-experiment-capability.md) adds a closed guard
  and parent factory; real issuance and a frozen operator remain unfinished.
  Older grants stay unchanged, and the adapter integration alone grants no
  new spending authority or live route.
- Freeze a fresh matched comparison and rehearse malformed output, transport,
  guard denial and cleanup before paid calls. Count failures, required-source
  omissions, unrelated selections and actual context/cost independently.
- An embedded-core comparison is not installed MCP evidence. Ordinary startup
  cannot opt into this wrapper; any experimental installed entry point requires
  its own packaging and boundary verification.
- Faithful handling of changed reasons in answers remains a separate problem.
  Selecting a relevant quote is not proof of its current applicability.

See the [acceptance plan](plans/checklist-model-integration.md). No npm release,
deployment, default promotion or broad reliability claim accompanies this work.
