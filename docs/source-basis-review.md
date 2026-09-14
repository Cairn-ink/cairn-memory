# Experimental source-bound decision-basis review

This read-only embedded-core view separates a recorded decision, individual
premises and updates. It does not replace the existing memory engine or persist
new interpretations. No database migration, default MCP tool, automatic capture
or adoption authority is added.

```js
const model = createOpenAIModel({ apiKey, basisModel: 'gpt-5.6-luna' });
const core = openMemoryCore({ path, model });
const reviewed = await core.reviewDecisionBasis({ namespace, refs });
```

`refs` contains one to six exact current `{memoryId, revision}` references within
the explicit namespace. Source receipts—not generated summaries or focus—are
sent to the configured provider with local request indices. Private identifiers,
namespace, session/client IDs and stored qualifications do not enter the prompt.
Calling this optional view sends the selected retained source text to that
provider; it is not an offline-only operation when a real adapter is configured.

## What it returns

The result envelope contains `units`, `links`, full `sources` and `indexRevision`,
with `status: 'unassessed'`, `interpretationStatus: 'model-proposed'` and
`persistence: 'not-stored'`. Each unit has a local index, proposed role, memory
revision and receipt identity, and a core-compiled `{start,end,text}` anchor.
Offsets use UTF-16 in the retained canonical receipt. Its exact quote must occur
once in the selected receipt; no normalization, truncation, approximate matching
or model-supplied offsets repair invalid selections.

- `supports-decision`: premise unit → decision unit.
- `challenges-current-basis`: update unit → the particular premise unit affected.

For example, one receipt may say a service was selected for price and storage
location. Distinct premise units can point to each reason. A later price change
can target price without declaring location wrong, the historical price false,
or another service adopted. Source interpretation still determines whether
those links are justified; type checks alone do not prove that interpretation.

The complete source context remains available to inspect omitted qualifications,
negation, reported speakers, uncertainty and scope. A matching quote proves only
provenance. A model can assign a wrong role, choose an insufficient passage or
miss a valid relation; no inferred unit is trusted consent or objective truth.

## Bounds and lifecycle

### Optional source context

Pass `inputMode: 'source-context-v1'` to request source citations alongside each
unit. Omit the property for the unchanged original mode; explicit null, undefined
or other values are invalid. The result echoes the selected mode.

Each unit then has `context: {subject, applies, scope, commitment}`. Values are
null (unresolved) or compiled `{start,end,text}` anchors into that unit's same
receipt, each selected by an exact unique quote of at most 200 UTF-16 units.
Subject means attributed actor; applies concerns applicability/event time rather
than arrival order; scope retains conditions and exceptions; commitment cites
adoption or its absence. These reuse qualification terminology but are **source
citations, not normalized qualification labels or persisted qualifications**.

All four keys are required, but null is valid and does not mean universal scope,
adoption or compatibility. Context is not borrowed from other receipts. The full
sources remain available for cross-receipt interpretation. Incorrect semantic
assignments can still pass exact-quote validation and remain model-proposed.
No date resolver, applicability adjudicator, confidence score, authority or
automatic decision replacement is introduced.

The existing canonical source text plus the mode marker reaches the provider;
no extra captured fields, private metadata or stored qualification labels are
sent. Context output shares the unchanged 1,024-token and 24,000-unit result
bounds: extra citations may reduce proposal coverage or cause rejection. There
is no retry, truncation or hidden budget increase. This is an experimental
representation change; matched-budget fresh-case evidence is still required to
establish semantic improvement. See [acceptance](plans/source-basis-context.md).

### Shared limits

The view permits at most eight units, ten typed links and 200 UTF-16 units per
quote, using existing 24,000-unit source/result bounds, 6,000 local input tokens,
1,024 output tokens and 30-second core timeout. Duplicate units/links, bad
indices, wrong role directions and selflinks fail rather than truncate.
Each challenge must target a premise that also has a support
link to a decision in the same proposal, regardless of link order. Missing chains
reject the whole proposal; the core never invents decisions or repairs links.
Unlinked units and empty proposals remain allowed. A complete chain still does
not prove adoption or shared subject, time and scope. Source,
revision and namespace epoch are checked around the asynchronous model call and
after compilation. Corrupt source storage fails closed under existing errors.

No memory, qualification, rationale edge or index epoch is changed by review.
Cold reopening retains only previously stored data; it does not resurrect this
ephemeral proposal. Keeping a result outside the core does not make it fresh:
callers must recheck underlying revisions before later use. This slice does not
provide persistent unit identities, review history or automatic invalidation of
externally saved reports.

## Model and experiment boundary

The distinct optional `reviewBasis` adapter port has its own `basisModel` setting:
existing pinned baseline by default, or exact `gpt-5.6-luna` / `gpt-5.6-sol` names.
It is independent of `extractionModel` and `rationaleModel`; other ports retain
their routing. Alternate models use reasoning none, unchanged strict framing,
exact response-model validation and no retry/fallback. Current model/cost
limitations follow [model controls](rationale-model-controls.md).

Every existing paid guard rejects `cairn_reviewBasis` on both count and generation
routes, even when a relation-model capability exists. No spending grant or live
run is included here. Synthetic core, fake-HTTP and actual offline-installed
package checks demonstrate provenance, bounds and lifecycle mechanics, not
semantic quality. A separately frozen experiment must assess whether the new
representation actually improves the failures reported in the model control.
