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

## Explicit version 2 source stance

`{ version: 2, sources }` opts into the same preparation and compiler with a
separate strict response schema. The prepared model input retains `version: 2`;
the model proposal still has only `{ units }`, and the compiled result derives
its own `version: 2` from the caller's input. Versionless inputs and results are
unchanged; other explicit versions and cross-version fields reject. Existing
source, receipt, passage, unit-count and serialization limits do not expand.

Every version 2 factual or decision unit additionally has three required
`{ value, evidence }` fields. `epistemicState` is `tentative`, `asserted`, or
`unknown`: it describes how the attributed source presents this particular
proposition, not model confidence or verified truth. `claimant` is a nullable
source-attributed holder of the proposition; `reporter` is a nullable relayer.
These roles differ from the proposition's subject but one person may fill more
than one role; none is an authenticated identity. Unknown/null
values do not become known from a role or namespace. Known values require
same-receipt evidence, and claimant/reporter labels have the same canonical,
secret-safe 160-character limit. Their references join the existing derived
one-to-four-passage focus. Each compiled field carries its exact original
anchors and `model-proposed-unverified` status; the existing qualification
fields and decision-state mapping are unchanged.

The schema and compiler can reject malformed labels and foreign passages, but
cannot decide whether a cited passage really makes a claim tentative, whether
the named claimant is correct, or whether a statement is true. This version
does not assess selection coverage: the global eight-unit cap can still leave
relevant receipts without an interpreted unit. It adds no persistence or
automatic provider call.

## Explicit version 3 source-local reasons

`{ version: 3, sources }` keeps every version 2 unit field, input limit and
eight-unit cap. Its separate closed proposal root is `{ units, reasonLinks }`;
the versionless and version 2 roots remain `{ units }`. Each of at most eight
links has `{ from, to, relation: 'stated-reason-for', evidence }`, where `from`
indexes a factual-claim unit, `to` a decision-state unit, and `evidence` cites
one to four distinct original passages. Both units and link evidence must refer
to the same source receipt. Duplicate endpoint pairs and foreign references
reject. Empty links are allowed; the compiler does not infer them.

The compiler derives each link's source/receipt indices and sorted exact
anchors, and marks it `model-proposed-unverified`. It does not verify that the
words actually state a reason or that the reason is true or causal. A reason
can be stated for consideration, rejection, or re-examination without implying
adoption or retroactively becoming the reason for an earlier choice.
Neither a never-finalized choice nor an unselected replacement is evidence of
pending reconfirmation or withheld approval. The same 24,000-unit proposal and
compiled-result bounds apply to units **and** links; nothing is trimmed.
This is an opt-in source interpretation, not a stored rationale edge, semantic
coverage guarantee, or permission.
