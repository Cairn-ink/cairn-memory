# HR-3 executable scorer

Authority: `../protocol/protocol-v0.3.4.md`, especially §§2, 6–8. Plain Node
22.16+ ESM; no dependencies, network, API, model invocation or adjudication.
These are synthetic engineering tests, **not** the independently authored §8
bilingual challenge set. Do not use them as calibration observations.

```sh
node evaluation/hr3/scorer/cli.mjs --gold FILE --answers FILE --out FILE
node --test evaluation/hr3/scorer/test/*.test.mjs
```

The CLI scores **one attempted answer at one checkpoint**. It does not aggregate
families, perform bootstrap inference, generate worlds or execute §8 sessions.
Exit 0 means an output artifact was written, including for malformed reader
answers. Exit 1 means usage, input I/O, gold authoring or delivery-map errors.
An unexecuted observation must not be submitted as a reader failure.

## Interchange contract

Validate reader output against `answer.schema.json`, author gold against
`gold.schema.json`, and the harness envelope against `submission.schema.json`.
`schema.mjs` exports the identical schemas and their dependency-free validator.
All object shapes are closed; all fields are required. There is no extension
metadata field into which arm names or delivery labels can be placed.

`--answers` contains `{ "answer": Answer, "delivered": [DeliveredUnit] }`.
The **trusted harness**, not the reader, supplies `delivered`. The reader
supplies only `Answer`. A null/missing/malformed attempted answer, including
reader exhaustion, produces C=O=R=J=0. Invalid JSON in the answer file also
produces zeros. Missing files are I/O errors, not scored attempts.

Value variants use `type: "Text" | "Boolean" | "Quantity" | "Instant" |
"Range"`. Decimal values and finite Range bounds are decimal **strings**, not
IEEE-754 numbers. Unbounded Range bounds are null. `Interval.from/to` are
instant strings or null; the interval is always half-open. Instant Value uses
`iso`. See the JSON schemas for every field.

Gold has exactly `question`, `current`, `old`, `reason`, `supportSpans`.
Its current/old structures match Answer without citations. Reason contains
`status`, `nodes` (claims without citations) and `acceptedGraphs`:

```json
{
  "acceptedGraphs": [
    { "edges": [
      { "from": "cause", "to": "mediator", "support": [["span-a", "span-b"], ["span-c"]] },
      { "from": "mediator", "to": "decision", "support": [["span-d"]] }
    ] }
  ]
}
```

The outer graph array is OR; each edge array is AND. Each edge's support is
OR of AND arrays of span IDs. Nodes are matched by their canonical claims,
not by the author's node names. A support span is
`{id, origin, start, end, text}`. Its UTF-16 `[start,end)` length must equal
`text.length`. It identifies a source quotation, **outside** `G_correct`.
Spans must express the submitted direction/conjunction; merely naming
endpoints cannot author a causal support license. The scorer checks source
identity and coverage, not the author's natural-language entailment labels.
Gold authoring/semantic audit remains mandatory under §§7, 9 and 16.

Gold's requested predecessor records are authoritative; no predecessor is
inferred by looking backward. Historical labels distinguish previously adopted,
erroneous and expired records. No record is inferred as active after expiry.

## Delivered units and citation maps

Each DeliveredUnit contains:

```json
{
  "intent": "current", "item": 0, "unit": "receipt", "source": 0,
  "aliases": [],
  "segments": [{"origin": "source-turn-1", "start": 0, "text": "A caused B."}],
  "normalize": true,
  "truncate": 800
}
```

An alias has exactly `{intent,item,unit,source}`. Only aliases explicitly
attached to an actually delivered unit resolve; missing or ambiguous addresses
are never guessed. Body/receipt source numbering is supplied by the harness.
No convention for numbering, including a zero/one base, is inferred.

Segments are the selected slices in delivered order, with pre-normalization
source UTF-16 start offsets. Elision is represented by gaps or different
origins, without supplying the omitted text. Source identities and offsets
must come from the actual delivery pipeline, not from gold-guided selection.
If an ellipsis is actually displayed, it must be a segment too, under its own
origin; do not silently insert one into a map. An intact surrogate pair or
normalization cluster can cross segment boundaries.

Processing is: join selected slices, optionally NFKC/collapse whitespace/trim,
then truncate by UTF-16 code units. The producer must specify actual delivery
behavior: for P's receipt path, `truncate:800`; use null for an untruncated
unit. No cap is silently imposed on other arms or on body text. A citation is
located in the delivered string, never at a reused raw offset. Expansions such
as `ﬃ`→`ffi` remain indivisible for source-coverage credit. Source whitespace
trimmed from a supporting span's boundaries does not require absent trivia.
Truncation or elision cannot supply missing substantive source characters.

The map checks supporting text against the gold source span as well as its
origin/offsets. Changing words while retaining the same source address does
not acquire the original support license. A truthful map is still a trusted
input: this scorer cannot authenticate a caller's raw-source archive.

## Full credit, uncertainty and isolation

C compares exact current status and claims, including qualifications and
source-claimed validity. O compares the exact requested predecessor set and
labels. Their factual scores do not depend on delivery or citation success.
`deliveredSupport` reports citation availability/resolution separately and is
explicitly **not** a semantic support verdict for C/O.

R requires a complete accepted directed graph, support for every edge, and no
extra incorrect/unsupported edge. Supported unions of alternative graphs are
allowed. A transitive shortcut is accepted only when explicitly in an accepted
graph. Duplicate edges combine their submitted citations before support is
checked. Endpoint/node citations do not substitute for edge citations.
`not_stated` has no edges. Malformed answers score all zero.

Mechanical support accepts only fully covered, text-verified source span
alternatives within recognized delivered context. Every submitted edge citation
must resolve. A missing citation, absent/truncated quotation or incomplete known
span conjunction cannot earn support. A different delivered passage is never
searched for as a substitute. Unknown support/context is referred, including
surrounding text that might disambiguate or negate the citation. Thus a source
license does not silently override a new negation. This conservative referral
policy is **not** a completed semantic support adjudicator.

Component scores are `0`, `1` or `null` (pending). Unknown equivalences are
neither false rejections nor full credit. J is computed here per observation:
zero if any component is zero, one if all are one, otherwise null. The output
retains unresolved components/referrals even when J is mechanically forced to
zero. Do not treat pending scores as finalized labels for aggregation.

Each referral contains a deterministic seed-prefixed SHA-256 bundle key, pass,
components, question, anonymized original answer and rubric. Correctness gets
only `G_correct`: expected claims/statuses/intervals/scopes and graph structure,
with **no support spans, support quotations, origins or delivery metadata**.
Support gets only the original anonymized answer and actual delivered text
with legitimate aliases: **no gold, expected graph or correctness result**.
Arbitrary reason node IDs are replaced with local IDs. Synthetic identities in
question/claim prose must already be anonymized by the harness without altering
evidence. The result file holds both bundles; §8 must distribute each bundle to
its own fresh isolated sessions, never send the whole result file to a judge.

No mapping is inferred or applied from an unresolved referral. Bundle keys are
conservative context-specific identities, not generalized semantic rules. The
§8 owner must freeze contextual key propagation/provenance, run the two
independent non-author passes and any third review, and retain unresolved cases.

## Canonicalization and protocol ambiguities

The following choices are exposed for integration/audit; the protocol supplies
the semantics but does not specify their complete wire representation:

1. **Value discriminator and numeric wire types.** `type`, decimal strings,
   nullable decimal Range endpoints and instant strings avoid guessing variant
   identity or losing rational precision. These are interchange choices, not
   changes to the five §6 Value variants.
2. **Gold/graph/span wire format.** The format above is derived solely from
   §§6–7, not from the concurrent generator. Supporting span text is separated
   from the correctness projection. Current/old statuses must be authored from
   the question/source semantics; the scorer never chooses expected statuses
   from delivery losses or treats `unavailable` as a wildcard.
3. **Unspecified dictionaries.** `canonical.mjs` freezes a small inspectable
   dictionary (`hr3-scorer-dictionary-v1`): country/plan/channel bilingual names
   and aliases, plus exact length/duration/ratio/currency units. It does not
   claim a complete synonym dictionary. Unrecognized paraphrases, bilingual
   values, scope labels or units are referred. Known typed numeric, boolean,
   interval and audience-cell differences remain errors. No contextual
   equivalence is adjudicated or added here. Extending this frozen dictionary
   requires the protocol's review/calibration process.
4. **Scope representations and duplicates.** Typed DNF scopes denote sets of
   the 12 §2 cells; conjunction/disjunction order, repetitions, bilingual domain
   aliases and equivalent partitions collapse. Empty scopes are invalid.
   C/O compare cell-expanded assertions so equivalent grouping does not create
   false negatives; contradictory/extra cell assertions remain distinct errors.
   Free-form scope wording is not a new schema alternative: unknown labels in
   typed values refer; an untyped prose Scope is malformed.
5. **Time representations.** Explicit ISO offsets normalize to UTC with exact
   fractional precision. Bare dates use actual `Asia/Taipei` local midnight,
   including historical offsets. A timezone-less datetime or unfamiliar date
   wording refers. Ambiguous/nonexistent local midnight also refers; the
   protocol gives no daylight-saving gap/fold convention. “Through D” must be
   authored as the following local midnight, as §2 requires; the scorer never
   silently changes a supplied upper endpoint. Null interval endpoints remain
   unbounded; finite intervals remain `[from,to)`. Null Range endpoint closure
   flags are immaterial; finite open/closed flags remain distinct.
6. **Occurrence overlap remains unresolved by the protocol.** If overlapping
   and nonoverlapping occurrence counting locate different delivered matches,
   the citation produces a support referral rather than choosing a convention.
   Unambiguous occurrences resolve normally. Integration must freeze that
   convention before such cases can receive mechanical credit; a model must
   not invent a protocol rule.
7. **Delivery-map and failure envelope.** The protocol does not define a file
   envelope, map wire format or failed-reader sentinel. `submission.schema.json`
   defines the harness envelope; invalid/null attempted answers are failures,
   while missing files and bad maps stop execution. Delivery maps and aliases
   are trusted harness observations. No raw offsets or labels become visible
   to the correctness adjudicator.
8. **Unrecognized causal support/context.** Natural-language entailment and
   negation beyond frozen source licenses cannot be resolved by a no-model
   mechanical scorer. These remain §8 referrals, not invented semantic rules
   or zero-filled final judgments. This implementation does not replace §8's
   independent challenge construction, calibration, isolated adjudicators or
   unresolved-case handling.

Canonical claim sets and qualifier sets ignore order and collapse equivalent
duplicates; contradictions are retained. Exact rational arithmetic never uses
floating-point unit conversion. The fixed seed is `hr3-scorer-v1`; no random
choices are made. Repeated runs with identical files produce identical output.
Timezone/Unicode behavior is that of the supported Node/ICU runtime and should
be frozen with the runtime during executable artifact freeze.
