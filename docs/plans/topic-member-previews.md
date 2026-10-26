# Opt-in bounded topic member previews (P1)

Status: **revision 1 for re-check, base `eb3a0675`, 2026-10-26; no implementation
or performance acceptance claimed.** Branch: `feat/topic-member-previews`;
the original repository baseline was `ff6616a1`. This revision changes only
this file and leaves the frozen [E1-M contract](topic-overview-member-pages.md)
untouched. Normative P1 requirements below describe future behavior; sections
explicitly describing the baseline cite current source locations. Audit probe
results and product targets supplied for this revision are attributed below.

## Purpose and compatibility boundary

The product supplied the following motivation, not a measurement made here:
the 2026-10-21 legacy map incident packed all bodies and blocked the main thread
for 33 seconds at 1,112 Memories. Region pages need readable, one-line rows.
These are the signed-in owner's own Memories; expanding a row already displays
its body. The constraint is cost and unbounded size, not a new confidentiality
boundary. Product chose (A) bounded content previews now and (B) stored labels
later; P1 implements only the contract for (A).

E1-M deliberately fixes `label.text` to the full Memory ID and forbids content
prefixes as labels (`docs/plans/topic-overview-member-pages.md:310`). Its work
contract prohibits body scans and its concurrency contract prohibits content
reads (`docs/plans/topic-overview-member-pages.md:632`,
`docs/plans/topic-overview-member-pages.md:704`). Current storage selects Memory
metadata without content, and presentation emits an identifier label
(`core/topic-members-storage.mjs:15`, `core/topic-members-reader.mjs:87`).
P1 is a separate, explicitly selected content-reading contract, not an amendment
to those E1-M promises.

Choose **`topic-member-previews-v1`** as both the opted-in result `version` and
`snapshot.configuration`. A distinct identity makes the content-read policy
visible and leaves `topic-members-v1` frozen. The method remains
`reader.readTopicMembers`; no second call is needed for the page's previews.
The existing ref `label` remains the full identifier even in P1; the UI uses
`preview.text` for a readable row and owns ellipsis/localization.

When the opt-in field is absent, preserve every existing DTO, JSON property
order, paging decision, cursor behavior and error envelope byte-for-byte.
Do not add null preview fields, preview coverage, version changes, capability
probes, content queries or preview-related opening checks to that path.
Default overview, including its error classification, must retain differential
parity with `b2513501`; the existing regression compares serialized errors and
page bytes (`core/test/topic-members-round3-findings.test.mjs:120`,
`core/test/topic-members-round3-findings.test.mjs:176`). Overview's existing
opt-in snapshot issuance also stays unchanged. The current Worker separates
legacy overview, opt-in overview and member dispatch, and selects separate
legacy error classification (`core/topic-overview-worker.mjs:179`).

## Request and result

All E1-M namespace, selection, authorization-fence, kind/order and snapshot
inputs remain required or optional exactly as before. Current validation binds
the handle owner to the exact namespace and accepts only own-data input fields
(`core/topic-members-input.mjs:10`, `core/topic-overview-input.mjs:5`). P1 adds
exactly one top-level field:

```ts
type PreviewOptions = {
  version: "topic-member-previews-v1";
  maxChars?: number; // safe integer 1..80; default 72
};
type PreviewInput = TopicMembersInput & { previews: PreviewOptions };
```

Presence must carry the exact plain own-data object above. Reject null, false,
arrays, accessors, proxies, symbol/unknown keys and unknown versions as
`invalid_input` without executing user code. A present top-level
`previews:undefined` is also invalid: only omission selects the old contract.
Inside a valid opt-in object, omitted/undefined `maxChars` normalizes to 72.
Reject fractions, unsafe integers, nonnumbers, null, zero and values above 80.
The small lower bound supports compact surfaces and deterministic boundary
tests; the product default is within its requested 60–80 characters.

There is a fixed, nonconfigurable **1,024 UTF-8-byte cap on each available
preview's text**, in addition to `maxChars`. These are independent caps; bytes
never substitute for character counting. No new constructor option is added.
Repeat the normalized opt-in configuration with every continuation.

Common request caps are unchanged: `limit` 1–100/default 100, `workLimit`
16–50000/default 5000, `maxBytes` 4096–262144/default 65536, and `deadlineMs`
50–5000/default 1000 (`core/topic-members-input.mjs:29`). No separate preview
time, work or response-byte allowance exists.

```ts
type MemberPreview =
  | { status: "available"; text: string; truncated: boolean }
  | { status: "unavailable"; reason:
        "empty" | "trimmed_prefix_empty" | "content_limit" | "invalid_text"
        | "grapheme_too_large" | "segmenter_unavailable" };

type PreviewRef = MemberRef & { preview: MemberPreview };
// Every other page field has E1-M's type and meaning.
type PreviewPage = Omit<MembersPage, "version" | "snapshot" | "items"> & {
  version: "topic-member-previews-v1";
  snapshot: Omit<MembersSnapshot, "configuration"> & {
    configuration: "topic-member-previews-v1";
  };
  items: PreviewRef[];
};
// {ok:true,value:PreviewPage} | {ok:false,error:{code:MembersErrorCode}}
```

For example, a qualifying ref may contain
`label:{text:"mem-001",source:"identifier"}` alongside
`preview:{status:"available",text:"台北の打ち合わせ notes",truncated:true}`.
No ellipsis is appended. There is no second Memory/body revision: the ref's
`revision` binds the preview.

Every emitted P1 ref has exactly one preview result. Unavailability means:

| Reason | Meaning |
| --- | --- |
| `empty` | The complete, valid source normalizes to an empty string. |
| `trimmed_prefix_empty` | The normalized source is nonempty, but whole-grapheme trailing-whitespace removal empties the bounded prefix. Do not emit an empty available preview or skip ahead to a later grapheme. |
| `content_limit` | Source exceeds 12,000 UTF-8 bytes or, after bounded decoding, 4,000 UTF-16 code units. No prefix of an over-limit source is returned. |
| `invalid_text` | Source is null/non-TEXT on an otherwise eligible row, invalid UTF-8, ill-formed Unicode, or contains NUL. Do not repair it into a different preview. |
| `grapheme_too_large` | The first normalized grapheme alone exceeds 1,024 UTF-8 bytes. Do not split it or return an empty available preview. |
| `segmenter_unavailable` | The Worker cannot provide the required grapheme segmenter/capability described below. Skip source extraction in this case. |

If several apply, use `segmenter_unavailable` first; otherwise source type,
byte-size, decoding/UTF-16-size, normalization, then grapheme and prefix-trimming
checks determine the reason in that order. Invalid decoding/NUL is
`invalid_text`; valid decoded text over 4,000 units is `content_limit`.

Not opting in omits `preview` entirely. Hidden/nonmembers produce no ref and
no unavailability placeholder. A pending budget-limited candidate is not
emitted with a fabricated unavailable reason. Errors, including `cursor_stale`,
have only `{ok:false,error:{code}}`, with no refs or previews. This retains the
existing error shape (`core/topic-overview-input.mjs:44`). Unavailability is a
per-ref content/capability outcome, not an error and not incomplete membership
coverage. There is no new page-level preview-coverage field: every emitted ref
has been resolved to one of the outcomes above.

## Exact normalization and truncation

The algorithm consumes the **complete bounded stored content**, never a raw
prefix whose final grapheme or trailing whitespace is uncertain.

1. Decode the bounded source bytes as strict UTF-8, preserving the input text
   for the whitespace step (a decoder must not silently replace malformed
   sequences or consume a BOM as a separate preprocessing policy). Validate
   well-formed Unicode, absence of NUL, and the 4,000 UTF-16-unit source cap.
   Before that last check, a byte-approved source can decode to **12,000
   UTF-16 units**; for example, 12,000 ASCII bytes decode fully and are then
   rejected as `content_limit`. Account for that temporary string and validation
   work even though it never reaches normalization or segmentation.
2. Normalize whitespace first, equivalently
   `content.replace(/\s+/gu, " ").trim()` under ECMAScript semantics. This
   includes CR/LF, tabs, NBSP, ideographic spaces, line/paragraph separators and
   BOM whitespace. U+200B is not treated as whitespace. Preserve markdown
   punctuation, links, markup, case and all other text literally; do not render,
   strip or interpret markdown. Do not apply NFC/NFKC, secret redaction or any
   additional write-time normalization here. Call the result `normalized`.
3. If empty, return `unavailable/empty`. Otherwise iterate
   `new Intl.Segmenter("und", {granularity:"grapheme"}).segment(normalized)`.
   One extended grapheme cluster is one character, including an ASCII space.
   Neither UTF-16 code units, code points, display columns nor bytes count as
   characters. Do not use `.slice(0,N)`, spread/code-point iteration or a regex
   fallback as the character truncator.
4. Select the longest contiguous grapheme prefix satisfying **both** at most
   `maxChars` graphemes and at most 1,024 encoded UTF-8 bytes. Stop before the
   first grapheme that would exceed either cap; never skip a grapheme and
   resume later. If the first grapheme exceeds the byte cap, return
   `unavailable/grapheme_too_large`.
5. While the selected prefix is nonempty and
   `prefix.trimEnd() !== prefix`, remove its **entire last grapheme**, using
   the boundaries from step 3, then repeat the check. A grapheme may contain a
   non-whitespace Prepend character followed by a space; never remove only that
   space, and never assume one whole-grapheme removal is enough. Do not refill
   from later graphemes. The normalized input has no leading whitespace, so a
   nonempty prefix remaining after this loop equals its own `.trim()`.
   If the loop removes the entire prefix, return
   `unavailable/trimmed_prefix_empty`. This distinct reason preserves `empty`
   for an empty normalized source and keeps every available preview nonempty.
6. Otherwise return `available` with `text` equal to that nonempty prefix and
   **`truncated: text !== normalized`**. Thus a nonempty exactly-N-grapheme
   source fitting the byte cap has `false`; an available prefix of an N+1
   source has `true`. Byte truncation and whole-grapheme whitespace removal also
   give `true` when a nonempty preview remains. Whitespace normalization alone
   does not mean truncation.
   Unavailable results have neither `text` nor `truncated`; unknown source
   completeness is never represented by `truncated:false`.

Exact regression cases (escaped strings denote their literal code points;
both complete sources remain unchanged by step 2):

| Stored/normalized source | Segments from step 3 | `maxChars` | Exact `preview` result |
| --- | --- | --- | --- |
| `"A \u0600 B"` | `["A"," ","\u0600 ","B"]` | 3 | `{status:"available",text:"A",truncated:true}`; remove `"\u0600 "`, then `" "`. |
| `"\u0600 B"` | `["\u0600 ","B"]` | 1 | `{status:"unavailable",reason:"trimmed_prefix_empty"}`; remove `"\u0600 "` entirely. |

There is no API-level ellipsis or synthetic suffix. An enormous combining/ZWJ
cluster is allowed to consume the entire source bound; it is handled by the
byte-cap rule, not split to achieve a nominal character count. The algorithm
needs only the first over-budget cluster after normalization; it need not
allocate an array of every segment.

### Node and ICU support

P1 retains compatibility with **Node 22.16.0 and 24.15.0 with full ICU**. Those are
already named in E1-M's runtime acceptance contract
(`docs/plans/topic-overview-member-pages.md:813`). The official builds of both
versions are configured with internationalization and full ICU (their bundled
`include/node/config.gypi`), and both binaries contain V8's `JSSegmenter::New`
implementation; this was the original author's static inspection of the
reference machine's installed builds. The product additionally requires launch
measurements on production **Node 24.22.1**, reported as not yet installed on
that machine. Passing local compatibility checks on 22.16.0/24.15.0 cannot
substitute for production-runtime acceptance. All three runtimes must satisfy
the same functional/guard obligations before being accepted for P1.

Reduced ICU data does not automatically imply unusable grapheme segmentation.
On the opted-in path, initialize the segmenter in the Worker with locale
`"und"` and require `resolvedOptions().granularity === "grapheme"` plus the
following exact table, identified as
**`topic-member-previews-grapheme-canaries-v1`**. Strings use JavaScript escaped
code points/UTF-16 pairs; no displayed escape is a literal backslash in the
input. Feed these inputs directly to the segmenter, **before any whitespace
normalization** (in particular, preserve the CRLF canary). Compare the complete
ordered segment array exactly, including spaces and absence of extra segments;
do not substitute locale display names or category-equivalent examples.

| Canary | Exact input | Exact expected segment array |
| --- | --- | --- |
| ASCII + combining accent | `"\u0041\u0065\u0301\u0042"` | `["\u0041","\u0065\u0301","\u0042"]` |
| Surrogate-pair emoji | `"\u0041\uD83D\uDE00\u0042"` | `["\u0041","\uD83D\uDE00","\u0042"]` |
| Emoji skin-tone modifier | `"\uD83D\uDC4D\uD83C\uDFFD"` | `["\uD83D\uDC4D\uD83C\uDFFD"]` |
| Emoji variation selector | `"\u2708\uFE0F"` | `["\u2708\uFE0F"]` |
| ZWJ family | `"\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"` | `["\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"]` |
| Regional-indicator flag | `"\uD83C\uDDEF\uD83C\uDDF5"` | `["\uD83C\uDDEF\uD83C\uDDF5"]` |
| CRLF | `"\u0041\u000D\u000A\u0042"` | `["\u0041","\u000D\u000A","\u0042"]` |
| Japanese combining dakuten | `"\u304B\u3099\u306A"` | `["\u304B\u3099","\u306A"]` |
| Mixed CJK/Latin/supplementary CJK/emoji | `"\u4E2D\u65E5\u0041\uD840\uDC00\uD83D\uDE00"` | `["\u4E2D","\u65E5","\u0041","\uD840\uDC00","\uD83D\uDE00"]` |
| Prepend + trailing whitespace, repeated removal | `"\u0041\u0020\u0600\u0020\u0042"` | `["\u0041","\u0020","\u0600\u0020","\u0042"]` |
| Prepend + trailing whitespace, all removed | `"\u0600\u0020\u0042"` | `["\u0600\u0020","\u0042"]` |

If the constructor is missing/throws, mode is wrong, iteration throws, or any
table row fails, use `segmenter_unavailable` for every otherwise eligible ref;
never fall back
to code units, code points or English word segmentation. A reduced-data build
that passes uses the same grapheme algorithm, but full runtime acceptance is
still required. Unsupported arbitrary Unicode/ICU versions are not certified
by a few canaries. These future capability checks are specified tests, not
checks run here, and must not run on the E1-M/default-overview paths.

Bind the effective Node/V8/ICU/Unicode segmentation fingerprint and P1 algorithm
identity **and the exact canary-table version ID** into P1 traversal
configuration, including cursor and replay binding. A table change requires a
new table ID; implementations may not silently vary the table under v1.
Changing any of those identities invalidates traversal state. Output need not
be identical between different ICU releases for newly introduced Unicode
characters; it must be stable within the bound traversal,
and all explicit acceptance cases must pass on each accepted runtime.

## Bounded source access and its actual cost

The current table stores `content` and metadata, with no standalone title or
SQL content-length constraint (`core/database.mjs:48`). Public legacy admission
passes content to `boundedText(...,4000)` (`core/validation.mjs:74`); the public
contract's Memory validator also defaults to 4,000
(`core/contract.mjs:109`), including correction (`core/contract.mjs:409`).
`boundedText` first rejects raw inputs above 20,000 UTF-16 units, then performs
NFKC/redaction/whitespace normalization and enforces the **normalized stored
4,000 UTF-16-unit** limit (`core/validation.mjs:37`). The 20,000 input limit is
not the stored Memory limit. Acceptance oracles must use canonical stored
content, since write normalization can change supplied strings.

For well-formed Unicode, 4,000 UTF-16 units encode to at most **12,000 UTF-8
bytes** (three bytes per BMP unit is the worst case; a supplementary character
uses two units and four bytes). That is a derived bound, not a new schema
constraint. Raw/legacy private SQL can exceed it, so P1 must guard it rather
than assuming every physical row came through public admission.

Perform source access only after eligibility and canonical attribution have
been settled. Use an indexed point read for the exact ID, namespace and
revision, under the transaction/fence rules below. A normative extraction
shape is:

```sql
SELECT typeof(content) AS source_type,
       octet_length(content) AS source_bytes,
       CASE WHEN typeof(content) = 'text'
                  AND octet_length(content) <= 12000
            THEN substr(CAST(content AS BLOB), 1, 12001)
            ELSE NULL END AS source
FROM memories
WHERE id = ? COLLATE BINARY
  AND owner_id = ? COLLATE BINARY AND scope = ? COLLATE BINARY
  AND project_id = ? COLLATE BINARY AND revision = ?
  AND deleted = 0 AND currentness = 'current'
  AND review_state IN ('none', 'confirmed');
```

The type/size guard must precede extraction through lazy `CASE` evaluation.
`octet_length` on the direct TEXT column uses encoded-length metadata; do not
replace it with `length(content)` (Unicode scanning),
`length(CAST(content AS BLOB))` or a JS guard after fetching full content.
Only the size-approved branch may materialize content. The 12,001-byte request
is a defensive sentinel bound; with a correct guard the returned BLOB is at
most 12,000 bytes. A non-null source with inconsistent size/type is
`unsupported_database`, not silently accepted. A missing expected row means
the preview/ref binding cannot be proven: fail the call as `cursor_stale`.
Validate the new consumed content column, direct-size function and indexed
point path on P1 only; unavailable required SQL support is
`unsupported_database`, never a full-scan fallback.

**`substr` limits the result, not SQLite's source-value materialization.** The
current backend is native `DatabaseSync` (`core/read-database.mjs:6`,
`core/read-database.mjs:24`), not a streaming TEXT reader. In the size-approved
branch, SQLite loads the complete `content` value before applying
`CAST(content AS BLOB)`. The query then selects `substrFunc`'s **BLOB path**,
which obtains the complete BLOB via `sqlite3_value_blob` and takes the requested
byte range. The auditor's static inspection of both installed reference Node
binaries distinguishes that path from the TEXT path's `valueToText` conversion;
the latter does **not** describe this query's `substr` argument. Accordingly
budget the full approved content value before the cast and full-value BLOB
access afterward, including potential native copies; the 12,001-byte result
bound is not a physical-I/O bound. SQLite's value accessors are documented in
`sqlite3.h`; its native string/BLOB/row limit is separate
(`SQLITE_LIMIT_LENGTH`, with a build maximum `SQLITE_MAX_LENGTH`). BLOB
extraction enables strict UTF-8 decoding, not streaming I/O.

The original author used core source, installed build metadata, the SQLite
header and static binary inspection. For revision 1 the non-author auditor
supplied in-memory SQL and Unicode probe results: **exit 0 on Node 22.16.0 and
24.15.0**, including successful execution of the proposed guarded BLOB query.
These results establish query execution/functional examples, not bounded
physical I/O or production-runtime acceptance. In particular, the
guard's metadata-only behavior and lazy extraction must be confirmed against
each bundled SQLite's query bytecode/native source during implementation
review, including Node 24.22.1. No new probe or measurement was run by the author
for this revision. This is a required acceptance check, not permission to ship
an unguarded query. Inspect `octet_length(content)` as a direct-column operation
and ensure an over-limit
row never reaches the content-materializing branch. If that cannot be
established on a supported runtime, P1 must not claim the bounded native-read
contract or launch on that runtime.

A K proportional to `maxChars` cannot implement this exact contract: a
grapheme can have arbitrarily many combining characters, and a long leading
whitespace run can collapse to nothing. A raw prefix may end inside a cluster
or conceal all useful normalized characters. P1 instead uses a fixed source
bound derived from the engine's maximum, reads the complete approved source,
then normalizes and truncates. No repeated increasing-prefix queries are used.

Let L be `limit` (at most 100). Per request, including replay, permit at most
**L source extractions**, one per attempted output candidate. Metadata-only
lookahead never reads content. Stop at the first candidate that cannot fit;
do not read previews for later rows. Do not re-extract the same candidate
within one call. A candidate deferred across calls is re-read under that
call's fences; retain its metadata, not its source or preview text.

The resulting conservative bounds for P1's *additional content work* are:

| Resource | Worst case per request |
| --- | --- |
| Byte-approved source payload materialized/extracted cumulatively, including later rejection | `12000 * L`, at most **1,200,000 bytes**; at most one source being transformed at once. Native copies/cache overhead is additional. |
| Decoding/validation output, including later-rejected sources | Up to **12,000 UTF-16 units per candidate**, `12000 * L` or **1,200,000 units** cumulatively. Budget up to **24,000 bytes of UTF-16 payload** for the temporary decoded string per candidate, coexisting with up to 12,000 source bytes, plus object/decoder/native-copy overhead. Actual JS string storage may be more compact; do not rely on that for the budget. Invalid decodes also consume input/validation work. |
| Accepted text entering normalization/segmentation | Up to **4,000 UTF-16 units per candidate**, `4000 * L` or **400,000 units** cumulatively; rejected decoded sources do not enter these stages. Normalized strings/segment metadata are additional temporary allocations within this accepted-text bound. |
| Available preview text before JSON escaping | `1024 * L`, at most **102,400 UTF-8 bytes**. |
| Whole serialized response delivered to the host | At most requested `maxBytes`, never more than **262,144 UTF-8 bytes**, including JSON escaping and every envelope field. |
| Content work at worker/host boundary | Only the bounded result crosses; source bytes/normalized bodies never cross. Host decode, structured clone and UI work remain measurement obligations. |

These payload bounds are not claims about total SQLite I/O, RSS or wall time.
Instrument bytes decoded/attempted, decoded UTF-16 units, validation failures
by reason, accepted normalization units and peak temporary payload separately.
Include the 12,000-ASCII-byte rejection case: it reaches 12,000 decoded units
before `content_limit`, contributes zero normalization/segmentation units, and
must not disappear from work/allocation counters merely because no text is
returned. Keep these counters numeric and release rejected buffers promptly.
Index seeks, overflow pages, metadata validation, native copies, cache misses,
record/header sizes, filesystem and scheduling costs also exist. Native source
work is O(L times the approved row-content size), **not O(L times maxChars)**;
metadata enumeration remains constrained by `workLimit`. Without the guard,
arbitrary private rows would instead cost up to L times SQLite's native
string/row limit, not L times 12,000. A watchdog cannot preempt a synchronous
SQLite instruction into a hard 5ms operation. The existing E1-M contract also
qualifies native quantum/deadline overruns
(`docs/plans/topic-overview-member-pages.md:684`,
`docs/plans/topic-overview-member-pages.md:715`). P1 does not equate fewer
output bytes with a performance proof.

## Snapshot, visibility and replay

Current E1-M filters exact namespace, deleted/currentness/review state and
active-generation revision, then validates revision-bound placements and edges
(`core/topic-members-storage.mjs:39`, `core/topic-members-storage.mjs:53`,
`core/topic-members-storage.mjs:68`). It fences each deferred quantum and the
final delivery, committing between them (`core/topic-members-reader.mjs:124`,
`core/topic-members-reader.mjs:141`, `core/topic-members-session.mjs:69`).
That is a revision-fenced traversal, not one historical SQLite transaction held
through the cursor lifetime (`docs/plans/topic-overview-member-pages.md:595`).

P1 must read a candidate's preview bytes **in the same read transaction as
the decisive revalidation of that ref**, matching ID, namespace, revision,
kind, currentness/review state, membership/attribution and generation authority.
If enumeration was checkpointed across transactions, its earlier metadata
read alone is insufficient: revalidate against the unchanged captured fence
in the extraction transaction. Reuse a proven membership checkpoint only with
that fence and exact revision verified there. Normalization, segmentation and
serialization occur in the Worker after the short transaction commits; retain
the revision-bound local bytes only for this call. Fence again before delivery.

When `expectedSnapshot` is supplied, its exact `indexRevision`, `generation`
and `originToken` must validate and be echoed. The current reader verifies
these fields and target authority before advancing
(`core/topic-members-reader.mjs:28`). Omission captures a new member snapshot;
it cannot promise consistency with an earlier independent overview. For UI
count/list pairing, request the existing overview `snapshotVersion:
"topic-snapshot-v1"` and pass its JSON-transported three-field snapshot, as
documented in `docs/topic-overview.md:213`.

Forgotten, deleted, awaiting, historical, superseded, foreign,
generation-excluded and stale revisions never produce a ref or preview.
Correction may produce a new eligible preview only on a fresh traversal at its
new revision; the old text never survives a stale response. Current correction
updates content/revision and advances the epoch, forget nulls content and
advances the epoch, and supersession makes the predecessor historical and
advances the epoch (`core/runtime.mjs:275`, `core/runtime.mjs:305`,
`core/supersession-storage.mjs:59`). Preserve E1-M's placement-only invalidation
even when the Memory revision is unchanged
(`docs/plans/topic-overview-member-pages.md:581`).

On any failed final fence, discard **the whole provisional page**. A
`cursor_stale` response never contains a preview, including a previously built
or replayed one. A mutation committed after the final fence is a later
snapshot; the engine cannot revoke an already delivered response. The host
must honor authorization at delivery and invalidate displayed paired state
on access changes. E1-M already specifies that final-fence race boundary
(`docs/plans/topic-overview-member-pages.md:599`).

P1 continuations use a distinct authenticated cursor family/purpose
`topic-member-previews-v1/cursor`, at most 256 ASCII bytes, with E1-M's
ephemeral Worker-key and canonical-encoding rules. Bind all existing request,
store/file/schema, access, snapshot, traversal and sequence fences plus
normalized preview options, fixed source/byte caps, segmentation fingerprint
and `topic-member-previews-grapheme-canaries-v1` table identity.
Changing `maxChars` or P1 configuration on an authenticated P1 continuation is
`cursor_stale`; malformed/wrong-family cursors are `invalid_cursor`. E1-M and
P1 cursors cannot be interchanged. Retain one member traversal total across
the two modes; a fresh member request replaces it. Overview remains separate.

Do **not** change the existing overview origin-token domain/binding just to
enable P1: accept the same valid `topic-snapshot-v1` provenance and add the P1
configuration to the member cursor binding. Current origin binding explicitly
names `topic-snapshot-v1/topic-members-v1`
(`core/topic-members-session.mjs:81`); changing it globally would break issued
origins and default parity. Origin lifetime stays absolute 60,000ms with no
renewal, including on replay (`core/topic-snapshot.mjs:25`).

Current E1-M retains the last complete output for byte-identical continuation
replay (`core/topic-members-reader.mjs:77`, `core/topic-members-reader.mjs:143`).
**P1 must not retain preview/source text in that cache.** Retain only a bounded
response recipe: selected refs/revisions, outcome decisions, nontext envelope
fields and exact cursor/token strings. On immediate latest-continuation
replay, revalidate fences and regenerate text from the same revisions using
the bound algorithm; return identical serialized response bytes, without
advancing. Regeneration is charged to this call's work/bytes/deadline and must
reserve sufficient work on the original response recipe. Busy returns the
normal busy envelope; a replay unable to finish within the deadline returns
`read_timeout`, never cached text or a changed partial page. Older sequences
remain stale. Close, idle expiry, restart, file replacement and schema/access
changes retain E1-M invalidation rules
(`docs/plans/topic-overview-member-pages.md:610`).

## Work, paging, errors and privacy

Run all new SQL, byte decoding, whitespace normalization and segmentation in
the existing reader Worker. Native opening is read-only/query-only with
trusted schema disabled (`core/read-database.mjs:24`); the host currently
dispatches to a fixed Worker with one pending request and a request deadline
(`core/memory-reader.mjs:32`, `core/memory-reader.mjs:49`). P1 uses no writer
slot, migration, `BEGIN IMMEDIATE`, host mutex, journal-mode change, model,
tokenizer, map, inspect, receipt/Raw/Card body access or namespace body scan.
Support real schema 18 and the currently accepted topic layouts 20, 21, 22,
23, 29–33, in DELETE and WAL, without widening the allowlist
(`docs/topic-overview.md:233`, `core/database.mjs:39`).

Retain short deferred quanta of at most 64 charged units or 5ms between units;
commit before yielding. Those are the existing reader quantum limits
(`core/topic-members-reader.mjs:127`). Additionally charge each preview
candidate at least one unit for its indexed type/size/source point read, one
for strict decoding/validation of up to 12,000 UTF-16 units and normalization
of at most 4,000 accepted units, and one for bounded segmentation/preview
construction. Charge extra membership/projection checks
as E1-M work; never hide them in those units. For an unavailable capability,
charge the bounded per-ref outcome step and do not read content. Reserve final
fence and envelope work before admitting any source operation. Source bytes
must not survive a yield merely to avoid charging transformation work; reserve
the whole bounded candidate operation or checkpoint metadata before extraction.

`deadlineMs` covers dispatch, opening, lock policy, source reads, all text work,
serialization, replay regeneration and final validation. No preview-specific
retry or wait layer is allowed. Adopt the common E1-C lock policy without
changing legacy DTOs/errors; the frozen E1-M coordination requirements remain
authoritative (`docs/plans/topic-overview-member-pages.md:724`). This document
does not specify or modify the other branch's opt-in WAL diagnostics.

Count `Buffer.byteLength(JSON.stringify(result), "utf8")` for the **complete
envelope**, including preview keys, status/reason strings, text escaping,
identifier labels, snapshot and continuation. Raw text's 1,024-byte cap does
not bound escaped JSON to 1,024 bytes. Reserve the actual continuation envelope
before accepting a ref and recheck the final envelope; do not shrink
`maxChars`, omit a required preview or silently return ID-only rows to make
the page fit. The next page may contain fewer refs than E1-M for identical
common caps. `limit` still counts unique refs, not graphemes or preview outcomes.

Stop before an unresolved/nonfitting candidate and retain its metadata as the
next checkpoint; never skip it. If earlier complete ref/preview pairs fit,
return that ordered prefix as `partial/byte_limit`, `partial/work_limit` or
`partial/deadline` with continuation. Empty partials mean bounded progress,
not zero membership, and must advance an actual metadata checkpoint. If one
complete required ref/preview/envelope cannot fit even on its own under the
existing EOF/continuation fitting rules, return `context_item_too_large`
without consuming the acknowledged cursor. There is no byte-driven
`preview.unavailable` result.

Keep E1-M's exact coverage meanings: proven EOF is `page`, complete true,
reason null, cursor null; proven next eligible member at the item limit is
`page/limit`; resource-stopped prefixes are `partial`; terminal 8MiB logical
state exhaustion is `partial/state_limit` with no items/cursor. These are the
current contract's coverage definitions
(`docs/plans/topic-overview-member-pages.md:670`). Preview absence for a
resolved per-item reason does not change EOF or membership completeness.
The bounded response recipe counts toward that state cap. No text is retained
in metadata checkpoints; the current 64MiB Worker old-generation cap is not a
total-RSS bound (`core/memory-reader.mjs:36`).

Invalidation/errors outrank provisional content. `storage_busy` returns only
the typed error, with no acknowledged cursor consumption or hidden retry;
`read_timeout`/`reader_failed` discard unsafe work. If no safe progressing
partial can be fenced and serialized before the deadline, use `read_timeout`.
Reuse existing `invalid_input`, `invalid_cursor`, target, opening, lifecycle
and storage errors; no native details or preview-related error messages are
added. The current safe classification exposes only codes
(`core/topic-overview-input.mjs:44`).

The preview is the **owner's own text under exactly the same host authorization
and owner/namespace binding as the member ref**. The host authenticates; the
reader enforces the boundary, and `accessRevision` is a fence, not a credential
(`core/memory-reader.mjs:6`, `docs/topic-overview.md:179`). P1 opt-in chooses
additional bounded content work, not an authorization grant.

Never log preview/source text, include it in diagnostics, traces, SQL bind
dumps, exceptions or measurement reports, persist it, or cache it outside the
in-flight/delivered response. Worker-local transformation buffers exist only
for that call and are released on success/failure/cancellation; no zeroization
claim is made for JS/SQLite-managed memory. Do not retain text in traversal,
replay, global caches or diagnostic state. The product may display the response
in its live page, must discard paired state on stale/access changes, and must
not create a separate durable preview cache. Diagnostics may contain numeric
work/bytes/timings and aggregate reason counts only; never content or prefixes.

## Acceptance required after audit

The author runs no tests, SQL probes, builds or measurements for this revision.
The supplied auditor probes (exit 0 on both reference runtimes) are prior
functional evidence only; no performance measurement result has been supplied.
The non-author auditor must review the contract before implementation.
Use owned synthetic fixtures, no network/keys/real user stores. Expected text
is computed from canonical stored content. Functional assertions and
instrumentation belong in deterministic tests; timing/overlap gates belong
only in an opt-in measurement command, scheduled serially by the primary.

### Deterministic functional tests

1. **Compatibility:** absence of opt-in preserves serialized E1-M success,
   partial, error and replay envelopes; legacy overview is differential-tested
   against `b2513501`, including fault phases, budgets/cursors and errors.
   Verify no source/capability query on default paths, before and after a P1
   call on the same handle. Test P1 invalid object/version/numeric bounds,
   default/explicit-default equivalence and unchanged non-preview validation.
2. **Graphemes:** ASCII, zh and supplementary CJK, ja kana plus combining
   dakuten, decomposed accent sequences, astral surrogate pairs, emoji with
   modifiers/variation selectors, regional-indicator flags, ZWJ families and
   mixed zh/ja/Latin/emoji. Place each case across the cut. Validate exact
   cluster strings, not only `isWellFormed()`. Cover a very long single cluster
   and an over-byte-cap first/later cluster. Invalid input Unicode is never
   repaired into a preview. Execute every exact row of
   `topic-member-previews-grapheme-canaries-v1` on all accepted Nodes. Inject a
   wrong segment, missing/extra segment, constructor/iterator throw and wrong
   mode, including a failure isolated to each table row; each must select
   `segmenter_unavailable` without a source extraction. Inject reduced support
   that passes the exact table and verify it uses the normal algorithm.
   Verify the canary-table ID is bound into configuration/cursors/replay.
3. **Normalization:** leading/trailing/multiple spaces, tabs, CRLF/newlines,
   Unicode whitespace, NBSP/U+3000/BOM, whitespace-only content and U+200B.
   Preserve markdown literally. Cover long leading whitespace and a combining
   sequence beyond a tempting short SQL prefix. Verify truncation after
   normalization, trimmed output, and no further NFKC/redaction.
4. **Exact boundaries:** empty, 1, exactly N, N+1 and N−1 graphemes at N=1,
   default 72 and maximum 80; byte cap exactly 1,024 and next whole cluster
   over it; a cut ending at a space; no engine-added ellipsis. Assert the exact
   regression outputs: source `"A \u0600 B"`, `maxChars:3` gives
   `{status:"available",text:"A",truncated:true}` after two whole-grapheme
   removals; source `"\u0600 B"`, `maxChars:1` gives
   `{status:"unavailable",reason:"trimmed_prefix_empty"}`. No available text is
   empty or ends in ECMAScript whitespace. For available results, assert
   `truncated` equals inequality with the complete normalized stored source.
5. **Source bounds:** approved 4,000-unit/12,000-byte cases, supplementary
   strings, raw oversized rows, 12,001-byte and valid <=12,000-byte but
   >4,000-unit rows, null/non-TEXT, NUL and malformed UTF-8. Explicitly inject
   12,000 ASCII bytes through an owned raw fixture: require `content_limit`,
   12,000 decoded units accounted, zero normalization/segmentation units, and
   the larger temporary decoded allocation in counters. Instrument native
   query plan/bytecode or inspect the matching bundled source to establish
   metadata-only size guards/lazy CASE and no materialization of oversize
   content. Fail acceptance if that property cannot be proven. Assert no
   full content reaches JS before size approval; <=L source extractions and no
   extraction for lookahead, foreign/hidden/nonmember/wrong-kind rows or
   unavailable segmenter. Do not assert total physical disk bytes from a SQL
   result-byte counter.
6. **Visibility and revisions:** all L1/L2/unfiled rules, dedup/canonical
   attribution, namespace/owner isolation, generation exclusion, awaiting,
   deleted, forgotten, superseded and historical cases. Correct a Memory and
   assert the fresh new revision/text only; old cursors and cached replay must
   be stale. Include placement-only changes, review changes, rebuild staging
   versus publication, and source deletion with/without surviving support.
7. **Snapshot races:** JSON-round-trip overview origins; mismatched/expired/
   foreign/missing tokens; changes before source read, between quanta, during
   transformation and before delivery. Require snapshot-consistent page before
   mutation or typed stale/busy/timeout; never mixed ref/text revisions. A
   `cursor_stale` envelope must contain no preview sentinel. Changing preview
   options invalidates continuations; wrong-family cursors fail correctly.
8. **Budgets and replay privacy:** force work, deadline, bytes, state cap and
   first-item oversize boundaries with deterministic clocks/hooks. No skipped
   pending ref, false EOF or infinite no-progress cursors; complete envelope
   bytes always fit. Latest replay regenerates identical bytes after fences;
   mutations defeat replay, busy preserves the checkpoint, timeout cancels.
   Inspect retained state and diagnostic/log hooks for absence of text. Cover
   long/maximal identifiers and heavily escaped preview text, plus reads
   interleaved with overview/default member calls and close/idle/restart.
9. **Storage/runtime/install:** real physical schema 18 and current 33, DELETE
   and WAL, Node 22.16.0, 24.15.0 and production 24.22.1; smoke the other
   accepted schemas. Verify no migration, journal-mode/schema/user_version
   change or engine data writes.
   Apply the existing qualified native-control/WAL SHM invariant, not
   impossible concurrent-write file equality
   (`core/test/topic-members-compatibility.test.mjs:31`,
   `core/test/topic-members-compatibility.test.mjs:79`). Deterministic
   rendezvous covers reserved/exclusive writers and E1-C lock outcomes. Test
   the actual installed Worker/import closure offline, preserving SQLite-free
   CLI/local transport imports. Primary records real exit codes; tests do not
   contain elapsed-time p95 or throughput gates.

### Opt-in measurements and launch gates

The current measurement script includes 1,112/3,336 worlds in DELETE/WAL but
reports null thresholds and `performanceAcceptance:false`
(`tools/testing/measure-topic-members.mjs:8`,
`tools/testing/measure-topic-members.mjs:40`). Its worker fixture calls the
internal reader directly (`tools/testing/fixtures/topic-members-measure-worker.mjs:3`).
Neither is evidence that the future P1 public host path passes. No optional
contention-results document is present at this base; no contention result is
adopted by this draft.

An opt-in `measure:topic-member-previews` (or an explicitly identified extension
of the member measurement) must exercise the **public host handle and actual
reader Worker**. The launch criteria below record the supplied product answer
from **cairn-wiki-cd, 2026-10-26 approximately 22:50**, including its writer
clarification; they replace the original draft's unresolved measurement targets.
No measured outcome is implied.

#### Lifecycle, cells and samples

The gated reader lifecycle is a **fresh handle for every request**:
`openMemoryReader -> await readTopicMembers -> await close`. Measure host wall
time from immediately before construction through completion of awaited close,
including Worker startup/opening, input validation, dispatch, result cloning,
deserialization, delivery and cleanup. Close in a finally path on failure and
include that elapsed time. Do not time only the internal reader or SQL call.
Use fixture-ledger selections/revisions; do not warm the handle with an
overview call or copy another handle's origin token into the fresh request.
Retained-handle reads, continuations and replay are **informational latency
measurements only**, while still subject to functional and resource invariants.

Use production **Node 24.22.1** for launch acceptance. The locally available
22.16.0/24.15.0 runs provide compatibility/comparison evidence, not a waiver of
the production run. Product reports 24.22.1 as not yet installed; installing it
and running measurements are outside this docs-only revision. Missing required
production results mean **not yet accepted**, not a pass inferred from another
Node version.

A measurement cell identifies world size (1,112 or 3,336 Memories), journal mode
(DELETE or WAL), schema (physical 18 or current 33), selection (L1, L2 or
unfiled), page limit and load condition. Load conditions are **idle**, concurrent
**same-owner writer**, and concurrent **other-owner writer**. Record the runtime
and fixture/profile as part of each cell; never pool modes, schemas, world sizes
or load conditions into one percentile. Fixtures include realistic multifiling,
zh, ja and mixed strings, plus Memories with ZWJ emoji, combining marks, leading
whitespace and 4,000-unit maximum stored content. Generate fixtures before the
timed window and derive expectations from their canonical stored ledger.

Preview options are on with `maxChars:72`. **`limit:24` is the reader-latency
gate; `limit:100` is a report-only latency worst case.** Use unchanged defaults
for the other common request caps in the main cells; label separate stress
profiles with their actual caps. For every cell, discard exactly **3 warm-up
requests**, each also with a fresh handle, then collect **at least 50 measured
fresh-handle requests**. Report the warm-ups separately; the <=100ms main-loop
invariant also applies to warm-ups and report-only cells. Record actual emitted
ref counts, status/coverage and busy/stale/timeout outcomes with the latencies.

Collect an additional **at least 10 cold runs per cell** from a fresh Node
process, or a fresh Worker with documented equivalence to the public reader's
spawn topology. Do not pre-open or prime that process/Worker with the target
store; do not put warm-ups inside a cold sample. Time the same host
open/read/close lifecycle in the new process/Worker, including the reader's
Worker startup; report outer Node-process launch time separately if collected.
Keep cold distributions separate from the >=50-request series;
warm-ups do not erase the cold obligation. Latency for a fresh handle in an
otherwise warm host is not a substitute for this cold series.

Use nearest-rank percentiles: sort durations and select ranks `ceil(0.50*n)`
and `ceil(0.95*n)` for p50/p95. Report **p50, p95 and maximum**, sample counts,
all error/status counts and the count of main-loop blocks **strictly >100ms**
for each cell/series. Timed attempts include typed failures; also report
successful-page latency separately so fast refusals cannot masquerade as page
performance. An error is not a page; a cell with no successful pages cannot
establish page performance and is inconclusive. Preserve all raw numeric
attempt records. No silent retry, removal of slow samples or pooling of retries
into one fast success is allowed; report any retry-inclusive user latency too.

#### Per-request writers

In each concurrent cell use an independent connection/process with a fresh
`openMemoryCore -> write -> close` lifecycle, scheduled approximately every
**20ms** while a reader request is active. Cover capture and review writes and
report their operation types separately. Exercise the signed-in owner and a
different owner in separate cells. Include same-owner writes in the measured
namespace to exercise snapshot invalidation; same-owner/different-namespace
stable traversals are useful additional observations, not a replacement.

Record lifecycle boundaries and **actual write-call start/end, deadline and
commit/error outcome**. Each concurrent measured request needs actual
write-call/read-call overlap; a live writer process, an overlapping open/close
or a sleep interval does not prove it. Coordinate start where necessary and
mark a missed-overlap attempt invalid for that concurrency claim, retaining its
timings in the report and collecting a replacement without selecting for speed.
Require >=50 valid overlapping requests after the warm-ups for each concurrent
cell and >=10 valid cold overlaps for its cold series. An operation lasting
longer than the approximate cadence is reported; do not queue a saturated
backlog or tune to a throughput ratio. Record both processes' actual exits.

Same-namespace changes may cause the specified `cursor_stale` outcome; record
it explicitly and verify there is no stale preview. The writer runs off the
host reader's event loop so synchronous writer work does not contaminate reader
main-loop attribution. Measure the writer's user-visible latency in its own
host/process, including any waiting/retry exposed to its caller; also report
the complete open/write/close lifecycle distribution separately.

#### Decision table

| Gate / reported metric | Acceptance decision |
| --- | --- |
| Fresh handle, page 24, 1,112 Memories | Host open/read/close wall **p95 <=150ms and maximum <=400ms** in each main-series launch cell. Previews on, `maxChars:72`. |
| Fresh handle, page 24, 3,336 Memories | Host open/read/close wall **p95 <=250ms and maximum <=600ms** in each main-series launch cell. Previews on, `maxChars:72`. |
| Page 100 and retained handles | Reader lifecycle latency **report only**, with p50/p95/max; no page-24 latency thresholds are applied. Main-loop, byte, visibility, concurrency and applicable writer/busy requirements still apply. |
| Cold series | At 1,112 Memories and page 24, **cold p95 <=600ms**, >=10 cold runs per cell. At 3,336, cold latency is report only; page-100 latency is report only at both sizes. The fresh main-series maximum is not an additional cold maximum; report cold max separately. Main-loop <=100ms applies to every cold run. |
| Host main loop, every cell/series/request | **Absolute maximum uninterrupted blockage <=100ms**, including cold startup, construction, dispatch, result clone/deserialization, delivery and close. Use documented heartbeat/event-loop-delay observation with bracketing samples through cleanup and an idle baseline; capture the final stall. Maximum, not average/p95, decides; report count >100ms (must be zero). Report scheduling noise without subtracting it to claim a pass. |
| WAL busy | **`storage_busy` count = 0** for reader and writer operations in every WAL cell/series. Record attempted operations and denominators. |
| DELETE busy | Report reader/writer busy counts and rates, error codes and latency **without a busy-rate pass/fail threshold**. Busy is not a successful page or commit; do not relabel it as successful coverage. Other applicable gates still apply. |
| Writer coexistence and user-visible deadlines | Actual per-request write-call overlap as specified above. Report **per-write p95/max in every reader-load cell**, separately for capture/review, with statuses and commit counts. **Capture and review must stay within their production-configured operation deadlines**, with no deadline overrun/timeout caused by reader load. Record each operation's numeric deadline, its defined start/end interval and observed duration before comparing; use existing production settings unchanged, not a larger benchmark-specific deadline. End-to-end latency includes user-visible wait/retry; retries cannot reset that deadline. No additional writer-p95 numeric ceiling, saturated-throughput target, commit ratio or reader/writer throughput ratio is a gate. |
| Complete response and preview bounds | Every full response <=requested `maxBytes` (absolute ceiling 262,144 UTF-8 bytes); text <=1,024 UTF-8 bytes/item and <=`maxChars` graphemes. Source payload <=`12000*L`, decoded output <=`12000*L` units including rejections, and accepted normalization input <=`4000*L` units. Numeric counters only. |

Also report **per-cell preview-unavailable reason counts** (including
`trimmed_prefix_empty`) and **bytes crossing to the host per page, p95 and max**.
Report serialized envelope bytes and actual transport-byte accounting
separately if structured-clone accounting differs; do not equate source bytes
with host traffic. Include work units, extraction counts, decoding/validation
of rejected sources, accepted normalization units and temporary-payload peaks.
Retained-handle stable traversals must still demonstrate correct exact EOF
within origin lifetime; lifecycle latency distributions remain informational.

These are measurement gates, not hard-real-time guarantees derived from SQL
limits. Record the selected E1-C lock policy and unchanged production writer
deadline settings in the report. If a mandatory cell lacks samples, overlap,
deadline evidence or production-runtime results, acceptance is incomplete.
Unexpected functional errors remain failures even when their latency is small.

If **1,112/page-24 p95 exceeds 150ms because of whole-value reads**, report the
actual measured value and attribution. Do not silently relax the target, change
the default `maxChars`, or lower the gated page size. Product decides whether
to revise those inputs through a new reviewed decision. Any failing launch
gate blocks enablement pending resolution; report-only metrics do not silently
become new gates. Do not weaken E1-M or move timing assertions into ordinary
tests. Primary owns queued, supervised execution and records actual exit codes.

## Later stored labels (B), questions and handoff

A write-time stored label needs a separately audited schema version **after
v33** and write/update/forget/supersession lifecycle rules; it is out of P1
scope. Introduce a new opt-in contract/configuration (for example
`topic-member-labels-v1`) whose field identifies its stored-label source and
revision. New UI callers may prefer it, with explicit fallback policy.
`topic-member-previews-v1` callers must continue receiving this exact
content-normalization/truncation algorithm and result shape on every newly
supported schema; do not silently substitute a stored title, change `label`,
or report `truncated:false` for a different source. Such schemas require an
explicit allowlist/compatibility decision. Existing schema-18 callers retain
P1 without migration. No write-time column or backfill is authorized here.

The supplied product answer resolves the prior p95, sample-count, cold-start
and writer-acceptance questions; **no new product question is opened by this
revision**. Installing the production runtime, verifying the guarded native
path on each accepted runtime, recording existing production writer deadlines
and running the specified cells are outstanding execution/acceptance work,
not missing launch criteria. None is claimed complete here.

Follow the primary's dispatch traps list for later implementation/integration.
This docs-only packet does not modify
the artifact manifest; if the primary ships this plan, register it and any
future runtime files in `packaging/artifact-files.json`, independently verify
the installed closure, and mechanically cross-check inventories with counts.
Do not edit the frozen E1-M plan or other sessions' fixtures. Non-author audit,
implementation, tests, opt-in measurements, manifest registration when shipped,
product enablement and commits remain the primary's subsequent work.
