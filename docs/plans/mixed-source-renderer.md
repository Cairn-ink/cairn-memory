# P — Pure common-source renderer acceptance contract

Fixed base f85322724eb91e4900d49cf1a400e8ce2f98ea4a (accepted X/#239).
Branch feat/mixed-source-renderer, isolated worktree. One GPT-6 Sol/high author;
primary owns decisions/independent acceptance, two nonauthor final reviews.
Copy verbatim to docs/plans/mixed-source-renderer.md before implementation.

This slice only prepares identical source information for a FUTURE controlled
Cairn/Mem0 comparison. No runner, scorer, provider, native process, corpus,
holdout opening, ledger/migration, launch or new score. Existing historical
preparation/pair behavior is unchanged. No core changes or dependencies.

## P1 API and bounded strict data

Add evaluation/longmemeval/mixed-source.mjs exporting mixedSourcePolicy() and
prepareMixedSourceCase({history,question,namespace}). Output is deeply frozen
JSON data. Use prepared-v2 history/question/namespace shapes exactly; question
ID must agree and project namespace projectId must equal it. Use current opaque
case/session/turn ID formats, unique session/turn IDs, contiguous source session
indices, user/assistant roles only. Snapshot own enumerable data, reject getters
without invoking, symbols, holes, extra fields, cycles/prototypes/nonfinite values,
ill-formed Unicode/NUL. Bound input traversal to depth16/nodes200000 and aggregate
string UTF-8 bytes8MiB BEFORE cloning/stringifying full trees; dense sessions<=2500
and total original turns<=60000. Nonempty text/date/query; invalid inputs throw
bounded error codes without echoing values/paths. Pure function, no filesystem,
clock, process, environment, network, models or database.

## P2 Explicit date/cutoff policy

Versioned policy accepts ONLY exact YYYY/MM/DD (Ddd) HH:mm, four-digit years
1900..9999, English Mon/Tue/Wed/Thu/Fri/Sat/Sun. Validate real Gregorian calendar,
hour/minute and weekday (not rollover acceptance). Compare calendar minute tuples
in declared dataset-local floating clock; do not infer UTC/local timezone or use
host Date.parse. Date.UTC calendar arithmetic is permissible when years are
validated and no timezone meaning is assigned. Canonical label YYYY-MM-DD HH:mm.
Unknown/ambiguous/date-only/mismatched-weekday formats fail before either engine.
Keep original source order, exclude sessions strictly after question time from
BOTH arms, include exactly equal timestamps; do not sort by dates. Preserve a
private original-session-index crosswalk and reindex included sessions contiguously
for the unchanged planner. All-future/no eligible sessions returns a typed
no_eligible_history preflight error (later fixed-N unresolved, not silent removal).
Malformed dates in excluded-looking sessions still fail; never guess chronology.

## P3 Shared normalization and chunk rendering

Normalize each full original turn with the EXACT existing ingestion capture
normalization: NFKC, existing redactSecrets, collapse Unicode whitespace to ASCII
space, trim. Use a bounded private helper; duplicating this short expression is
permitted with parity tests, not a new core export. Empty/fully [REDACTED]/NUL
normalization fails; don't turn it into useful content by attaching metadata.
Retain a flag whether normalized text equals original text. Preserve original
role and ordering. Split normalized text on Unicode code-point boundaries into
maximal chunks fitting a decorated message of <=4000 UTF-16 units, including:

prefix = `[session-date: ${canonicalDate}; clock: dataset-local] source{`
suffix = `}`

These exact ASCII delimiters make metadata explicit, keep boundary spaces stable
under capture normalization, and are not an authenticated speaker assertion.
No chunk omission/overlap; concatenated chunk bodies equal complete normalized
turn. Derive opaque rendered turn IDs from domain/version, original turn ID,
normalized start/end offsets and date; do not use expected-answer labels.
Session IDs remain original opaque IDs. Both engines see identical rendered
role/content bytes; no fabricated system-role transcript or native timestamps.

## P4 Existing planner and Mem0 input parity

Feed rendered history to planIndexedWindowLongMemEvalCase with trusted namespace.
Require executable, every pre-bounded rendered turn corresponds to exactly one
planner sourceMap chunk, and raw rendered content equals normalized capture
content. Existing 24-message/20000-UTF16 batch and <=64 indexed-window rules
remain; unexpected planner blocking throws an explicit error, no larger bounds.
Mem0 batches derive solely from those actual planner captureInput.messages,
stripping IDs, retaining exact role/content and batch/order. Max2500 batches,
max24 messages, Y input JSON <=8MiB; no silent trimming/rebatching for one arm.
Common recall query is JSON.stringify({question: question.text,date:canonicalDate})
then the same existing text normalization; require <=4000 UTF16 and <=16KiB UTF8.
No question/reference answer content enters ingestion. The original question
text/date is retained separately for a future answer renderer, not changed here.

## P5 Honest origin map and private output

Output version, policy+digest, original question, renderedHistory, cairnPlan,
mem0Input:{batches,query}, counts, original-history digest and a private origin
crosswalk. Choose a documented exact output field schema before tests. Every
rendered turn crosswalk includes original session/turn index and ID, normalized
start/end, body start/end in rendered text, and normalizationChanged. Map every
planner indexed window using its exact start/end; classify as:
- metadata-or-mixed if not wholly inside body boundaries;
- normalized-source if wholly inside body but original turn changed;
- original-source only if wholly inside unchanged body and the mapped original
  substring exactly equals the window text.
Original-source entries carry exact original UTF16 offsets. Others carry null
original offsets; never reconstruct or guess raw-source positions. Duplicate
source text is okay when IDs/coordinates disambiguate it; do not use substring
search to invent identity. This mapping describes submitted windows, not proof
they were retrieved or used. All content/IDs/crosswalk is PRIVATE; counts-only
public evidence. Mem0 results remain generated memories with unavailable original
provenance; this module does not map them to source IDs or answers.

## P6 Digests and policy

Freeze versioned canonical JSON hashing domains and static policy constants,
including date grammar/cutoff, clock, normalization, renderer, chunk/batch/input
bounds, mapping classifications and query format. mixedSourcePolicy returns a
deeply frozen descriptor and policy digest stable across object-key order and
Node versions. Per-case digest binds exact input history/question/namespace and
rendered batches/query/origin map; IDs and order are significant. Distinct inputs
cannot alias because an excluded session or normalization change was discarded.
Keep protocol digest distinct from eventual full experiment manifest. No claim
that a source digest freezes answer/scorer/resources or authorizes the holdout.

## P7 Positive tests

New focused synthetic tests: both roles, multiple sessions in out-of-date-order
source order, same-minute cutoff, future exclusion, leap days, nonlocal TZ
independence; short/multiple/long turns, exact4k decorated boundaries, astral/CJK,
combining/fullwidth text, whitespace/secret redaction parity, delimiter-looking
source text, repeated equal text with distinct IDs, sparse/windows/tie identity.
Assert actual unchanged planner capture bytes equal Mem0 batches; all bodies
reconstruct normalized originals, all windows map honestly, no answer text or
fabricated role added; stable deep-freeze/digests under key reordering.

## P8 Negative tests and no expansion

Getters0/no mutations; extra/symbol/prototype/sparse/cyclic/malformedUnicode,
invalidIDs/duplicateIDs/namespaces, malformed dates/weekday/calendar/date-only,
all-future, fullyredacted, cap overflow and normalization inflation cases.
No truncation/fallback; errors normalized and source-free. Test source payload
containing prompt/answer-looking text is retained only as untrusted source, never
promoted into policy/expected answers. Existing pair/ingestion tests untouched.

## P9 Evidence and scope

Allowed: new mixed-source.mjs and one focused test file under evaluation/longmemeval,
this plan and narrow docs/longmemeval-comparison.md and docs/limitations.md append.
No old preparation/ingestion/pair edits, core/adapter/native/ledger/scorer changes,
CI/deps/locks/newCLI, corpus/keys/provider tests, public raw examples from real
data, product/default claims or changes to held-out cohort. If source-planner
constraints cannot preserve this contract, report concrete conflict before edits.

## P10 Verification and delivery

Both Node22.16/24.15 focused tests/full test:longmemeval, existing public demo,
generic tests/JSON/pinned strict plugin+marketplace. Required further gates only
if actual callsites change (none expected). Serial heavy gates coordinated with
Y/Z. Record failures honestly; no network model calls. Freeze local scoped commit,
primary personally checks actual diff and independent synthetic mapping cases,
two nonauthor exact-base reviews; correct/retest/rereview; scoped PRmain and all
latesthead CIgreen/mergeable before READY. No merge/release/deploy. This is pure
preparation mechanics, not semantic accuracy, parity, resource feasibility or S3.

## P3/P6 amendment — v2 stable greedy partition

The original P3 size-maximal chunk and bare `}` suffix conflict with P4 capture
parity for some fully normalized sources. A chunk can create a new redaction
boundary; the bare suffix can be consumed by assignment redaction. This
amendment supersedes only those P3/P6 rules before a renderer is used for a
comparison. The wrapper prefix remains exact; the suffix is the ASCII string
` }` (one space then `}`). The space is synthetic metadata outside the body.
The version and all four hash domains advance to v2.

For each normalized turn position, choose the longest code-point-aligned,
nonempty next body whose decorated message fits 4000 UTF-16 units and whose
exact capture normalization leaves the entire decorated message unchanged.
Try candidate ends in descending order, starting at the largest fitting end.
Before each normalization probe, charge the candidate rendered UTF-16 length
against a per-case 32 × 2^20 UTF-16 code-unit aggregate probe budget. This is
a work bound, not a byte or memory-usage measure. Exceeding it throws
`render_probe_limit_exceeded`; finding no stable prefix throws
`render_normalization_mismatch`. No chunk is omitted, overlapped, rewritten or
silently trimmed. The concatenated bodies must equal the complete normalized
turn, and the unchanged planner must still accept each as one raw/normalized
capture message before either prospective arm can run. This greedy bounded
policy does not guarantee that every otherwise valid normalized string is
partitionable. Its explicit preflight failure leaves a future fixed-N case
unresolved; it is not evidence of corrupt source text. The static policy and
digest describe the new suffix, algorithm and probe budget.

## Implementation record (after frozen contract)

The source audit found that JavaScript negative zero passed the contiguous
session-index equality check while serializing identically to zero. The renderer
now rejects it. Chunk traversal reads code points by index so long normalized
turns do not copy the entire remaining suffix for every chunk. The focused
synthetic test checks reconstruction of every eligible original turn and maps
every submitted planner window against its original source coordinates and
classification. It also exercises malformed opaque IDs, discontinuous indices,
negative zero, and the session cap.

The superseded v1 candidate `e06bec4` passed P10 pre-commit verification on
both Node 22.16.0 and 24.15.0:

- `node --test evaluation/longmemeval/test/mixed-source.test.mjs`: 10/10 each.
- `npm run test:longmemeval`: 138/138 each.
- `npm run demo:longmemeval-ingestion`, `npm run demo:longmemeval-comparison`
  and `npm run demo:longmemeval-public`: all passed on each runtime.
- `npm test`: 112/112 each; `npm run validate`: all declared JSON and version
  checks passed on each runtime.
- Pinned `npm ci --prefix tools/plugin-validation` succeeded, then `npm run
  validate --prefix tools/plugin-validation` passed strict plugin and marketplace
  validation on each runtime.

These tests used synthetic local data and no provider key, paid request, corpus
or holdout. Full logs remain in the private verification archive. They do not
verify v2. The superseded v2 candidate `c34bfca` passed the P10 pre-commit
matrix on both Node 22.16.0 and 24.15.0 after the amendment:

- Focused `node --test evaluation/longmemeval/test/mixed-source.test.mjs`:
  15/15 each; full `npm run test:longmemeval`: 143/143 each.
- Synthetic ingestion, comparison and public LongMemEval demos: all passed on
  each runtime.
- `npm test`: 112/112 each; `npm run validate`: JSON and version checks passed
  on each runtime.
- Pinned `npm ci --prefix tools/plugin-validation` succeeded; strict plugin and
  marketplace validation passed on each runtime with `npm run validate --prefix
  tools/plugin-validation`.

Full v2 logs remain in the private verification archive. Those runs do not
verify the later P1 width correction; its separate final matrix is recorded
below.

Before the v2 implementation, the minimal P3 boundary regression failed twice
with `render_normalization_mismatch`. The first v2 focused run passed 14/15:
its one failed assertion expected global backtracking and two chunks, while
the approved greedy policy correctly produced three lossless chunks. The
expectation was corrected, with no further renderer change, before the final
15/15 runs on both runtimes.

The later P1 width review found that materializing all own property descriptors
could allocate past the declared node budget before rejection. Snapshot now
checks own-key width against the remaining node budget before descriptor reads,
and reads each descriptor after its key-byte charge. Array own-key count is
checked before any element descriptor read. Synthetic proxy tests first failed
with 200001 object descriptor reads and four array descriptor reads, then
passed with zero descriptor reads on those rejection paths. `Reflect.ownKeys`
still allocates a key list and invokes proxy traps; these limits bound traversal
and cloning work, not total JavaScript process memory or proxy side effects.
The P1-focused Node 22.16.0 test passed 2/2 after this correction, and the
full focused suite passed 17/17 on both Node 22.16.0 and 24.15.0.

Final P10 pre-commit verification after the P1 correction passed on both Node
22.16.0 and 24.15.0:

- Focused `node --test evaluation/longmemeval/test/mixed-source.test.mjs`:
  17/17 each; full `npm run test:longmemeval`: 145/145 each.
- Synthetic ingestion, comparison and public LongMemEval demos: all passed on
  each runtime.
- `npm test`: 112/112 each; `npm run validate`: JSON and version checks passed
  on each runtime.
- Pinned `npm ci --prefix tools/plugin-validation` succeeded; strict plugin and
  marketplace validation passed on each runtime with `npm run validate --prefix
  tools/plugin-validation`.

The private verification archive retains exact command logs. Candidate SHA and
independent review evidence belong to the delivery handoff.
