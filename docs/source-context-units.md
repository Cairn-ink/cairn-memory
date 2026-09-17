# Pure source-context units

The embedded core exports `prepareSourceContextUnits(input)` and
`compileSourceContextUnits(input, proposed)` as an explicit, provider-independent
structural building block. Neither method opens a store, calls a model, changes
capture/admission, nor persists a result. The caller supplies one source-only
input: `{ sources: [{ receipts: [{ role, excerpt }] }] }`. Roles are `user` or
`assistant`; excerpts remain exact original text, including whitespace and
punctuation. Supplied roles and text are untrusted evidence, not authenticated
identity, instructions, semantic truth, adoption, or permission.

Preparation returns frozen, detached, request-local source/receipt/passage
indices and exact passage text plus a strict response schema. It sends no
relation edges, stored memory, namespace, receipt client/session/event metadata,
system prompt, provider option, or rubric. The core does not send this value
anywhere. Raw and prepared input each have an independent 6,000-UTF-16-unit
serialized bound, with at most six sources, four receipts per source and 800
UTF-16 units per original receipt. The proposal has at most eight units and a
24,000-UTF-16-unit serialized bound; the compiled result has the same separate
24,000-unit bound. Invalid or over-budget input fails rather than trimming or
returning a partial result. Source text that would be changed by existing
secret-redaction rules, including after NFKC compatibility normalization, is
rejected rather than silently modified.

Each proposed unit is either `factual_claim` or `decision_state`. Both carry
source/receipt indices, eight separate `{ value, evidence }` fields (subject,
property, scope, applies, value, attribution, polarity, quantifier), and
`eventTimeContext`/`reporterContext` arrays of original passage indices. Only
decision units carry a state: considered, adopted, rejected, not_approved,
not_withdrawn, pending_reconfirmation, or unknown. There is no model-authored
focus, generated date/reporter quote, relation field, or commitment field.
The compiler validates every reference within its selected original receipt,
then derives a sorted, unique one-to-four-passage focus from exactly those
field/state/context references. It never fills an intervening gap or repairs
an omitted citation.

Existing `qualificationInput` validates the ordinary descriptions and exact
source anchors. Interpretation labels may be NFKC-canonicalized; original
source excerpts never are. Factual units map to qualification commitment
`unknown`. Considered/adopted/rejected decision states map to the matching
commitment; the other four states remain explicit on the unit while commitment
stays `unknown`. Polarity and quantifier retain their own anchors. Each context
contains exact original passage anchors and a `model-proposed-unverified`
status, not an extracted timestamp or authenticated reporter. Output is
`assessment-only` and `not-stored`, and every unit remains
`model-proposed-unverified`.

This representation avoids asking a model to copy literal time/reporter text
and separately maintain the same focus citations. It sacrifices fine quote
precision: a selected passage can mention multiple times or people, and a
wrongly chosen context role may still pass structural validation. Exact anchors
prove source linkage, not field meaning, truthful reporting, temporal
applicability, or downstream answer quality. Source identity/revision fencing,
model transport, cold-session retrieval and consumer integration remain future
separate work. Existing capture, store, rationale, recall, SDK store methods,
MCP, hosted HTTP and adapter prompts are unchanged.
