# HR-3 A-4 scorer

Authority: `../protocol/protocol-v0.3.4.md` and `../protocol/errata.md`,
particularly A-4 §§2, 4–5. Deterministic Node 22.16+ ESM, no dependencies,
network, model calls or adjudication. Tests are independent engineering
examples, not calibration observations. No experiment execution is authorized.

```sh
node evaluation/hr3/scorer/cli.mjs --gold FILE --answers FILE --out FILE
node --test evaluation/hr3/scorer/test/*.test.mjs
```

The CLI scores one attempted answer/checkpoint. Exit 0 means it wrote a score,
including zeros for malformed/exhausted reader output. Exit 1 means an I/O,
usage, private-gold, delivery-map or public-contract error. It never retries.

## Closed answer and private gold

`answer.schema.json` is the A-4 §4 slot answer, with no reader graph or Claim
nodes. `current.rows` and each requested `old.records[].rows` contain scope,
source-claimed half-open validity, three typed slots, and citations. Each old
record names its public `predecessor_turn`. Only state `value` permits non-null
content. `not_specified` asserts absence from the decision; `unavailable` and
`unresolved` do not fill a known value. `reason` contains only `status` and
`support`, an array of delivered citations. All objects are closed, all keys
required. Decimal quantities are strings, booleans are JSON booleans.

The trusted harness submits `{answer, delivered:[DeliveredUnit]}`; readers
supply only Answer. Schemas in JSON exactly match exports from `schema.mjs`.
Unused private definitions are excluded from the answer/provider schema.

`gold.schema.json` has `question`, `current`, `old`, `reason`, `supportSpans`.
C/O use the same slot rows without citations. Private reason nodes retain the
§7 GoldClaim representation and accepted graphs. Every edge's `support` is an
OR of AND arrays of span IDs; every graph is an AND of required edges; graphs
are alternatives. Spans are `{id,origin,start,end,text}` with exact UTF-16
source offsets/text. Invalid/dangling graph endpoints or span IDs stop scoring.
Gold construction must certify that spans express the causal direction,
intermediates, conjunction language and focal change. Licenses are not a
natural-language entailment engine.

## Public contract and canonicalization

`contract.mjs` first defines the three slot types, public labels and legacy
field correspondence directly from A-4 §2. Its alias interface is
`category -> [{canonical,aliases:[string]}]`. The consumer adapts the generator's
language-indexed naming tables and slot array to that interface. It reads
`../generator/public-contract.json` on each scoring call when present,
validates executable slot/alias/unit/status/scope semantics, and reports its
version and exact-byte SHA-256. Mismatch stops scoring with an explicit error;
a missing file is reported as `absent`, using only the text-declared interface.
No sibling implementation module is imported or changed.

Declared naming aliases are applied before slot projection/comparison. Route
identifiers otherwise remain literal after NFKC/whitespace normalization.
Quantities use BigInt rational conversion through declared positive unit ratios.
Unlisted units refer, even when both sides use the same unrecognized spelling.
The published contract currently declares requests/day, requests/hour and
requests/minute. No fuzzy value repair or missing-value completion occurs.
Canonical answer booleans must remain typed; lexical Boolean aliases in the
public contract do not broaden the reader schema.

Scopes expand to the frozen 12 cells. Slots are projected into cell/interval
assertions before matching. Equivalent duplicates and scope partitions collapse;
contradictory extras persist. Unknown scope, time or unit correspondence refers
C or O if it could change that component's result. A representation-dependent
count mismatch cannot force zero; an independent missing cell, wrong status,
wrong predecessor or known contradictory assertion can. C and O referrals
remain visible even when R forces J=0.

`projectFields`, `projectClaimFields` and `fieldRepresentationsEqual` are
compatibility utilities for legacy authoring/import representations. They
normalize public field labels and compare bundled qualifiers with decomposed
fields. Unknown field/type correspondence returns a referral verdict, never a
missing-field zero. They do not accept or repair legacy reader answers, infer
values, or compare complete Claim scope/subject/time semantics.

## Quoted explanation and component validity

Mechanical stated R requires every submitted citation to resolve and its
combined source coverage to satisfy every required edge-support conjunction of
at least one complete accepted graph. Partial paths from different alternatives
cannot substitute for a complete graph. Complete sufficient alternatives,
duplicate citations and supported unions are allowed. Endpoint fragments,
omitted serial links and incomplete known conjunctions fail. Unfamiliar causal
wording, broad selections and over-citation refer; containing a correct clause
inside a larger record is insufficient for automatic credit. Unlicensed
surrounding delivery context also requires the gold-blind support pass.
Other delivered text never supplies an uncited clause.

Negative R is factual status scoring: matching `not_stated` with empty support
can pass with empty delivery, and its support result is `not_applicable`.
`unavailable` does not mean `not_stated`. Non-stated statuses require empty
support. Every attempted observation, including malformed answers, carries
`reasonStratum` with denominator 1 and the deterministic empty-support
`not_stated` baseline R. Aggregate these by gold status; do not label negative
credit as evidence-supported explanation recovery.

Schema-malformed whole answers score C=O=R=J=0. In a structurally valid answer,
invalid reason selection/address semantics affect R independently. The output
reports `componentValidity`; C/O citation diagnostics remain factual-score
independent in `deliveredSupport`. Impossible intervals and empty scopes retain
the existing whole-answer malformed semantics. Scores are 0, 1 or
null (pending). J is their conjunction **per family**, before aggregation.
Unexecuted cases must never be submitted as failed attempts.

## Delivered citations and adjudication boundaries

Delivered units retain `{intent,item,unit,source,aliases,segments,normalize,
truncate}`. Each segment is `{origin,start,text}` from actual delivery, not
from a gold-selected archive. Body uses source null; receipt uses a zero-based
source index; item is zero-based and occurrence one-based. Only explicit
legitimate delivered sameAs/sameAsBody aliases resolve. No unit, source or
occurrence is substituted. Duplicate address/alias maps are harness errors.

Selected slices are joined, optionally normalized, then truncated by UTF-16
units. Quotes must be **verbatim delivered substrings**: raw-source fullwidth
spelling cannot match a normalized ASCII delivery. Provenance survives Unicode
normalization, overlapping clusters, elision and truncation; absent substantive
characters cannot earn coverage. Reader overlap ambiguity retains the existing
referral behavior, distinct from extraction's fixed overlapping-count convention.

Correctness referrals carry the question, original anonymized slot answer
(including selected quotes), and quotation-registry-free `G_correct`: expected
slot rows, historical labels and causal propositions/graph structure, with no
span licenses, origin registry, supporting quotations or delivery verdict.
Support referrals carry question, original answer and actual delivered text,
with no gold, expected graphs or correctness finding. The two bundles require
separate fresh sessions. Neither may repair values, clauses or citations.
Private graph IDs are anonymized; public predecessor turns and submitted
addresses remain intact. The harness must anonymize fictional names in inputs
consistently without altering quotations.

Referral keys use `hr3-a4-slot-explanation-keys-v2`, contract digest, dictionary,
component, question, original slot answer and pass-specific context. Each
component has its own key and parent rule; support keys include actual delivery.
They are conservative contextual dependence identities, not generalized rules.
The analysis/calibration owner must freeze propagation and parent-rule failure
scenarios before using them in judgment-error safeguards.

## Decisions and remaining ambiguities

A-4 fixes answer shapes but not the private gold/file envelope: this directory
uses citation-free slot rows plus the existing private graph/span registry.
It does not read or manufacture gold from concurrent generator artifacts.
Complete-request/cap certification and analysis-adapter acceptance belong to the
harness owners; these focused tests do not certify a paid run or calibration.

Natural-language equivalence, distractors, negation and broader selections
remain semantic referrals. A-4 explicitly retains reader overlapping-occurrence
ambiguity handling; the generator contract also describes overlapping starts.
Where interpretations differ, the scorer retains referral and never chooses a
substitute occurrence. Asia/Taipei nonexistent/ambiguous midnight likewise
refers. The inherited generic Value dictionary remains for private causal
propositions only; slot quantities use exclusively the public contract ratios.
