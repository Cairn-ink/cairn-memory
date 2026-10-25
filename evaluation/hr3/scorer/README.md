# HR-3 A-6 support scorer

Authority: `../protocol/protocol-v0.3.4.md` and `../protocol/errata.md`,
particularly A-6 §§5, 7 and the retained A-4 §§2, 4–5. Deterministic Node 22.16+ ESM, no dependencies,
network, model calls or adjudication. Tests are independent engineering
examples, not calibration observations. No experiment execution is authorized.

```sh
node evaluation/hr3/scorer/cli.mjs --gold FILE --answers FILE --out FILE \
  --trivia-binding BINDING --trivia-freeze FREEZE --trivia-freeze-sha256 PIN
node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs
```

The CLI scores one attempted answer/checkpoint. Exit 0 means it wrote a score,
including zeros for malformed/exhausted reader output. Exit 1 means an I/O,
usage, private-gold, delivery-map or public-contract error. It never retries.
Every A-6 gold requires authenticated, independently supplied target binding,
regardless of empty or absent trivia metadata. Missing or invalid authentication
exits 1 without writing a score.
The exported `score()` enforces this same rule and throws a TypeError with
`code: "ERR_HR3_TRIVIA_BINDING"` before reader-response validation. Invalid
authentication is not a malformed reader answer or a zero observation.

For serialized gold, supply three separate trusted inputs:

```sh
node evaluation/hr3/scorer/cli.mjs --gold GOLD --answers ANSWERS --out OUTPUT \
  --trivia-binding BINDING --trivia-freeze FREEZE --trivia-freeze-sha256 PIN
```

`BINDING` is a JSON object with exactly `{family,caseId,question,registry}`.
The complete expected family, case ID and question come from trusted dispatch;
`registry` is the generator's original private emission registry, before the
scorer adapter. `FREEZE` contains the freeze-bound family handles; `PIN` is its
SHA-256 supplied independently by the primary, not derived from either input
file. All three options are required together. These inputs are private trusted
configuration, separate from both gold and submission. Neither may supply or
override them. The CLI reads the exact generator trivia rule file, recreates
the proof and target token, verifies them against the actual gold question and
source spans, and requires exact equality with gold's serialized normalized
trivia metadata before scoring. It never repairs mismatched or stripped metadata.
Authentication errors, including malformed binding JSON, leave output untouched.
An empty candidate registry does not authorize an exemption. Deliberately
unlicensed worlds require the independently frozen no-trivia authority described
below. Neither empty metadata nor an absent binding selects another scoring mode.

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

`gold.schema.json` has `supportVersion`, `supportTrivia`, `question`,
`current`, `old`, `reason`, `supportSpans`. Old gold without the new private
version/registry is rejected; no old run is silently reinterpreted.
The executable schema admits only the explicit `hr3-support-a6-v3` support
version. No legacy support-version string is registered in this scorer; the
historical pre-A-6 envelope was unversioned and is already unsupported. Missing,
unknown or downgraded version strings remain authoring errors, including legacy
strings combined with A-6 fields. No shape-based legacy inference or fallback
is performed. Missing `supportTrivia` remains a structural gold error even with
a binding; it can never score in unlicensed mode.
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
The public-contract adapter reads data only. Authenticated support separately
imports the generator verifier described below; no sibling files are changed.

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

## A-6 authenticated private trivia interface

The independent non-author review rejected the former offset/role adapter:
declared `edge`/`fact` boundaries could license punctuation inside an
interpolated decimal. The scorer now requires the generator's authenticated
emission replay and an independently pinned per-family handle. No declared
boundary, producer hash, parse, or normalized license is authentication.

The producer registry is `hr3-optional-trivia-a6-v2`. It includes the original
`emission_inputs` tape captured before rendering, in addition to the rule digest,
UTF-16 origins, positions, segments and literal/interpolated parts. The generator
exports `verifyFamilyTrivia({family,registry}, trustedHandle)`, which checks the
freeze-bound digests, replays the original templates/variables, and returns a
deeply frozen detached copy. The scorer imports and uses that verifier rather
than duplicating a provenance parser. See the generator README for the complete
producer wire contract.

Only the trusted caller configures the authority. The freeze bytes and expected
SHA-256 must come from the primary's independent artifact pin; never take the
freeze, expected digest, authority, or handle from a reader submission or a
candidate support registry. The caller must verify the frozen artifact set as
required by the generator's interface. SHA-256 binds integrity; it is not a
secret signature or permission to trust a candidate's self-declared hash.

```js
import { createTriviaAuthority, createTriviaCase, adaptGeneratorTrivia, SUPPORT_VERSION }
  from './support.mjs';

// Trusted configuration, independently of candidate provenance and answers:
const authority = createTriviaAuthority(freezeBytes, primaryPinnedFreezeSha256);

// Independent target dispatch, never inferred from gold.supportTrivia:
const caseId = `${family.family_id}/batch/${checkpoint.batch}`;
const question = checkpoint.question;
const binding = {family, authority, caseId, question};
const triviaCase = createTriviaCase(binding);

// Private authoring family and complete ordered original source turns:
const turns = family.batches.flatMap(batch => batch.turns)
  .map(({turn_id, text}) => ({turn_id, text}));
gold.supportVersion = SUPPORT_VERSION;
gold.supportTrivia = adaptGeneratorTrivia(
  supportRow.optional_trivia, exactRulesBytes, turns, binding,
);

// score is imported from ./scorer.mjs; the target is a separate trusted option.
const result = score(gold, {answer, delivered}, {triviaCase});
```

`createTriviaAuthority` validates the external freeze digest, registry/auth
versions, rule digest, and canonical family-handle-table digest. It keeps a
frozen detached handle map in private process state. The adapter looks up the
family handle there and calls the generator verifier before deriving any
normalized positions. Missing/mismatched authority, handle, source, rule digest,
registry, original emission tape or literal boundaries grants **no licenses**.
The obsolete three-argument adapter deliberately grants none. The earlier
four-argument form containing only family/authority now also grants none: it
must supply caseId and question.

The normalized registry remains scoring-private, version `hr3-trivia-a6-v3`:

```text
{
  version: "hr3-trivia-a6-v3",
  producer: {version, rules_sha256, freeze_sha256, handle_sha256} | null,
  rules: [{id, production, language, literal, optional_offsets}],
  positions: [{origin, position, char, rule, literal_offset}]
}
```

The re-review also found that an authentic proof for another family could
previously be reused when text and local origin offsets matched. Authenticity
alone is no longer sufficient: every compilation requires an independently
supplied target-case token.

`createTriviaCase({family,authority,caseId,question})` snapshots the **expected**
complete family, resolves its exact handle from the expected pinned authority,
and validates the handle's family/lineage/seed/namespace/source bindings. It
returns an opaque immutable token. Call it from the trusted dispatch/checkpoint;
never derive its family, handle or case identity from the candidate proof.
`caseId` must distinguish checkpoints/queries, while being identical across arms
for the same observation. The example uses family/batch; add a query discriminator
when one checkpoint contains more than one question. The token must be passed
separately as `score(gold, submission, {triviaCase})`, not embedded in the answer,
gold metadata or delivery envelope.

The compiler checks exact family, handle, freeze pin, case ID and question
agreement with the registered proof, and compares the expected question with
`gold.question`. It invokes the generator verifier against the independently
expected family and handle. Source keys include family ID; license keys include
family, handle hash, case hash, local origin and UTF-16 position. Local origin
wire strings do not change. Identical source bytes cannot authorize cross-family,
cross-handle or cross-case reuse. A missing, cloned or forged target token grants
none; no expected case is inferred from the proof. Direct compiler callers must
use `compileTrivia(registry, spanMap, triviaCase, actualQuestion)`.

Licensed harness/integration calls keep the existing `{triviaCase}` interface.
They must preserve the normalized proof and the independent target token through
the runner, alongside options such as `contractPath`. Missing target data is an
error. The no-trivia callers require the separate interface below. No harness or
integration code is changed by this scorer-only repair.

Its authentication proof is opaque process state, not any of those fields.
The adapter returns immutable metadata; compiling it checks the independent target and re-runs the verifier
against that expected frozen handle and uses only the verifier's returned source
positions. Normalized declarations, booleans, copied producer hashes and
lookalike authorities cannot grant licenses. Serialization or structured cloning
of the normalized registry removes its proof: **authenticate again after loading
JSON and immediately before scoring**. Preserve the authenticated object
identity through the scoring call; do not clone it as part of gold afterwards.
Independent challenge authors must likewise use authenticated emissions; there
is no direct normalized-rule exemption.

`compileTrivia` also checks every support span against the authenticated
family's exact source bytes. This low-level diagnostic returns a fully protected
predicate on failure. It does not produce a score. Both public scoring entry
points (`score()` and the CLI) reject every A-6 gold unless licensed or unlicensed
authentication succeeds. This includes empty registries, failed in-process
adapters and any explicitly supplied invalid target token. No production fallback
clears trivia metadata or converts authentication failure to R=0. Unknown
semantic/context correspondence retains its existing referral behavior after
authentication.

## Frozen no-trivia targets

For an intentionally unlicensed world, the primary must separately freeze and
pin an exact-target catalog. The accepted format matches the harness's reviewed
independent-source authority:

```text
{
  version: "hr3-independent-slot-no-trivia-a6-v1",
  cases: [{family, caseId, question, sourceSHA256, goldSHA256, trivia: "none"}]
}
```

These are closed records. Hash objects with SHA-256 of canonical JSON (recursively
sorted object keys, ordered arrays). `sourceSHA256` hashes the complete trusted
original source target, including its `id` and `question`; `caseId` is exactly
`target.id + "/source/" + sourceSHA256`. `goldSHA256` hashes the complete expected
scoring gold, including its empty registry and support version. The whole catalog
has an independent exact-byte pin. Never create records or derive that pin from
the candidate gold during evaluation; adding a source world is an explicit
authority/freeze change.

```js
import { createUnlicensedTriviaAuthority, createUnlicensedTriviaCase }
  from './support.mjs';

const authority = createUnlicensedTriviaAuthority(catalogBytes, primaryPinnedSha256);
// expectedSourceTarget comes from trusted dispatch, independently of gold.
const unlicensedCase = createUnlicensedTriviaCase({
  authority, target: expectedSourceTarget, gold,
});
const result = score(gold, {answer, delivered}, {unlicensedCase});
```

The factory requires an exact catalog record and registers the exact gold object.
Every score rechecks its hash, question, object identity and token identity.
Cloning tokens/gold, modifying gold, changing source/case identity or substituting
another family's token fails. After JSON loading, independently register the new
gold object again. Passing both `triviaCase` and `unlicensedCase` is an error.
The existing harness-created exemption token is not a scorer capability: its
helper must create/retain this scorer token from the same fixed catalog and
trusted target, then pass it through the existing `unlicensedCase` option.

The CLI uses the same three flags for this path: `BINDING` has exactly
`{mode:"unlicensed",target:expectedSourceTarget}`, `FREEZE` contains the catalog
above, and `PIN` is its independently supplied exact-byte digest. No extra CLI
flag or field in gold/submission grants an exemption. A generator freeze cannot
act as a no-trivia catalog. Successful output reports
`supportAuthentication.status:"authenticated_unlicensed"`, the authority digest
and opaque expected-case hash. No trivia positions are optional in this mode;
all protected coverage, C/O, negative-R and referral behavior remains intact.

Versions: `hr3-support-a6-v3` in `support.schema.json` and private gold;
`hr3-scorer-a6-v7` for scorer/seed;
`hr3-a6-slot-explanation-keys-v7` for dependence keys. Authentication status, expected case hash and
freeze/handle bindings participate in key provenance. Actual source text,
emission tapes, handles and license choices stay out of reader delivery and
both adjudication bundles. Only opaque hashes/status appear in scorer output.
No source text is fetched as missing model evidence.

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

After exact resolution, `covers(span,ranges,optionalTrivia)` requires the union
of resolved ranges to cover every non-trivia UTF-16 source position, with exact
origin and text. Only whitespace and `.,;:，。；：、` at licensed literal
positions may be absent. Edge whitespace has no implicit exemption. Decimal or
identifier dots, words/digits/connectors/intermediates/conjunctions/change names,
operators/signs/arrows, parentheses and quote/question/exclamation marks remain
protected. Whitelist membership only rejects invalid licenses; it never creates
one. A punctuation/whitespace-only span cannot establish a cause.

Exactly the same predicate decides edge completeness and the fully covered spans
used for extra-selection checks. Selecting exact source text without a licensed
final stop can pass; altering a submitted quotation to erase punctuation cannot
resolve. Source substitutions are rejected even at optional positions. An extra
citation or selected punctuation outside accepted support is never discarded,
even if it has a valid template license elsewhere. Unknown context still refers;
complete word coverage alone cannot bypass the gold-blind support pass.

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

Referral keys use `hr3-a6-slot-explanation-keys-v7`, contract digest, dictionary,
component, question, original slot answer and pass-specific context. Each
component has its own key and parent rule; support keys include actual delivery
and privately hash the support spans, accepted graphs, authentication status
and trivia provenance.
No private registry is added to either referral bundle.
They are conservative contextual dependence identities, not generalized rules.
The analysis/calibration owner must freeze propagation and parent-rule failure
scenarios before using them in judgment-error safeguards.

## Decisions and remaining obligations

A-4 fixes answer shapes but not the private gold/file envelope: this directory
uses citation-free slot rows plus the existing private graph/span registry.
It does not manufacture gold answers or fetch source text as replacement evidence.
Complete-request/cap certification and analysis-adapter acceptance belong to the
harness owners; these focused tests do not certify a paid run or calibration.

Natural-language equivalence, distractors, negation and broader selections
remain semantic referrals. A-4 explicitly retains reader overlapping-occurrence
ambiguity handling; the generator contract also describes overlapping starts.
Where interpretations differ, the scorer retains referral and never chooses a
substitute occurrence. Asia/Taipei nonexistent/ambiguous midnight likewise
refers. The inherited generic Value dictionary remains for private causal
propositions only; slot quantities use exclusively the public contract ratios.
