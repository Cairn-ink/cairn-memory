# Opt-in bounded topic member previews (P1)

Status: **draft contract for non-author audit, 2026-10-26; no implementation or
performance acceptance claimed.** Repository base: `ff6616a1`, branch
`feat/topic-member-previews`. This packet adds only this file, remains
uncommitted, and leaves the frozen [E1-M contract](topic-overview-member-pages.md)
untouched. Normative P1 requirements below describe future behavior; sections
explicitly describing the baseline cite current source locations.

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
        "empty" | "content_limit" | "invalid_text"
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
| `content_limit` | Source exceeds 12,000 UTF-8 bytes or, after bounded decoding, 4,000 UTF-16 code units. No prefix of an over-limit source is returned. |
| `invalid_text` | Source is null/non-TEXT on an otherwise eligible row, invalid UTF-8, ill-formed Unicode, or contains NUL. Do not repair it into a different preview. |
| `grapheme_too_large` | The first normalized grapheme alone exceeds 1,024 UTF-8 bytes. Do not split it or return an empty available preview. |
| `segmenter_unavailable` | The Worker cannot provide the required grapheme segmenter/capability described below. Skip source extraction in this case. |

If several apply, use `segmenter_unavailable` first; otherwise source type,
byte-size, decoding/UTF-16-size, normalization, then grapheme checks determine
the reason in that order. Invalid decoding/NUL is `invalid_text`; valid decoded
text over 4,000 units is `content_limit`.

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
5. If that selected prefix ends in the normalized ASCII space, remove that
   final space by moving back to its grapheme boundary. This is part of choosing
   a trimmed prefix; do not fill the vacated position with a later character.
   The output is a trimmed, single-line prefix with no split surrogate pair,
   combining sequence, ZWJ emoji or CJK character.
6. Return `available` with `text` equal to that prefix and
   **`truncated: text !== normalized`**. Thus a nonempty exactly-N-grapheme
   source fitting the byte cap has `false`; N+1 has `true`. Byte truncation also
   has `true`. Whitespace normalization alone does not mean truncation.
   Unavailable results have neither `text` nor `truncated`; unknown source
   completeness is never represented by `truncated:false`.

There is no API-level ellipsis or synthetic suffix. An enormous combining/ZWJ
cluster is allowed to consume the entire source bound; it is handled by the
byte-cap rule, not split to achieve a nominal character count. The algorithm
needs only the first over-budget cluster after normalization; it need not
allocate an array of every segment.

### Node and ICU support

P1 supports **Node 22.16.0 and 24.15.0 with their full-ICU builds**. Those are
already named in E1-M's runtime acceptance contract
(`docs/plans/topic-overview-member-pages.md:813`). The official builds of both
versions are configured with internationalization and full ICU (their bundled
`include/node/config.gypi`), and both binaries contain V8's `JSSegmenter::New`
implementation; this was static inspection of the reference machine's installed
builds, not execution of a capability test. No runtime support test or timing
claim is made by this document.

Reduced ICU data does not automatically imply unusable grapheme segmentation.
On the opted-in path, initialize the segmenter in the Worker and require its
grapheme mode plus fixed canaries for combining marks, surrogate-pair emoji,
emoji modifier/ZWJ family, flag, CRLF, Japanese combining marks and mixed CJK
text. Canaries compare complete segment strings/boundaries, not locale display
names. If the constructor is missing/throws, mode is wrong, or any canary fails,
use `segmenter_unavailable` for every otherwise eligible ref; never fall back
to code units, code points or English word segmentation. A reduced-data build
that passes uses the same grapheme algorithm, but full runtime acceptance is
still required. Unsupported arbitrary Unicode/ICU versions are not certified
by a few canaries. These future capability checks are specified tests, not
checks run here, and must not run on the E1-M/default-overview paths.

Bind the effective Node/V8/ICU/Unicode segmentation fingerprint and P1 algorithm
identity into P1 traversal configuration. Changing those invalidates traversal
state. Output need not be identical between different ICU releases for newly
introduced Unicode characters; it must be stable within the bound traversal,
and all explicit acceptance cases must pass on both required runtimes.

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
`core/read-database.mjs:24`), not a streaming TEXT reader. Static inspection of
both installed Node binaries' SQLite `substrFunc` shows complete-value text
access/conversion (`valueToText`) before result construction. SQLite's C API
describes text access as a UTF-8 TEXT value, not an incremental prefix
(`sqlite3_value_text` in `sqlite3.h`); its string/BLOB/row limit is a separate
native limit (`SQLITE_MAX_LENGTH`). Accordingly budget an entire approved
content value in SQLite, even for a tiny result. BLOB extraction is used for
strict UTF-8 decoding, not as a claim that SQLite performs streaming I/O.

Offline evidence here is limited to core source, installed build metadata,
the local SQLite header and static binary inspection. In particular, the
guard's metadata-only behavior and lazy extraction must be confirmed against
each bundled SQLite's query bytecode/native source during implementation
review; no SQL probe or measurement was run for this draft. This is a required
acceptance check, not permission to ship an unguarded query. Inspect
`octet_length(content)` as a direct-column operation and ensure an over-limit
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
| Approved source payload materialized/extracted cumulatively | `12000 * L`, at most **1,200,000 bytes**; at most one source being transformed at once. Native copies/cache overhead is additional. |
| Valid decoded source processed | `4000 * L`, at most **400,000 UTF-16 units**; linear normalization/segmentation within that bound. |
| Available preview text before JSON escaping | `1024 * L`, at most **102,400 UTF-8 bytes**. |
| Whole serialized response delivered to the host | At most requested `maxBytes`, never more than **262,144 UTF-8 bytes**, including JSON escaping and every envelope field. |
| Content work at worker/host boundary | Only the bounded result crosses; source bytes/normalized bodies never cross. Host decode, structured clone and UI work remain measurement obligations. |

These payload bounds are not claims about total SQLite I/O, RSS or wall time.
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
normalized preview options, fixed source/byte caps and segmentation fingerprint.
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
for strict decode/normalization of the bounded source, and one for bounded
segmentation/preview construction. Charge extra membership/projection checks
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

No tests, SQL probes, builds or measurements are run for this document.
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
   repaired into a preview. Exercise full ICU on both required Nodes and
   injected missing/reduced/failing segmentation support deterministically.
3. **Normalization:** leading/trailing/multiple spaces, tabs, CRLF/newlines,
   Unicode whitespace, NBSP/U+3000/BOM, whitespace-only content and U+200B.
   Preserve markdown literally. Cover long leading whitespace and a combining
   sequence beyond a tempting short SQL prefix. Verify truncation after
   normalization, trimmed output, and no further NFKC/redaction.
4. **Exact boundaries:** empty, 1, exactly N, N+1 and N−1 graphemes at N=1,
   default 72 and maximum 80; byte cap exactly 1,024 and next whole cluster
   over it; a cut ending at a space; no engine-added ellipsis. Assert
   `truncated` equals inequality with the complete normalized stored source.
5. **Source bounds:** approved 4,000-unit/12,000-byte cases, supplementary
   strings, raw oversized rows, 12,001-byte and valid <=12,000-byte but
   >4,000-unit rows, null/non-TEXT, NUL and malformed UTF-8. Instrument native
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
   and WAL, Node 22.16.0 and 24.15.0; smoke the other accepted schemas. Verify
   no migration, journal-mode/schema/user_version change or engine data writes.
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
reader Worker**. Fixture setup and source generation happen before the timed
window. Measure cold, warm, continuation, replay and revision-change requests
for both product worlds **1,112 and 3,336 Memories**, both journal modes, both
required Node versions, physical v18 and current 33. Include all selection
types, realistic multifiling, defaults and maximum common/P1 bounds, maximal
stored source sizes, zh, ja, mixed strings, whitespace and long clusters.

For every region-page request, start a concurrent writer operation in an
independent connection/process, recording its **actual call start/end and
commit outcome**. Use another namespace for stable traversal performance;
separately exercise same-namespace writes and report their expected stale
outcomes. Require actual writer-call/read-interval overlap in each measurement
cell; lack of overlap is an invalid sample, not a pass. Exclude sleeps, process
lifetime and fixture setup from claimed active overlap. Record failed/busy
attempts and retries, and both processes' actual exits. No silent retries or
writer starvation may turn into an apparent passing latency sample.

| Gate | Definition and decision |
| --- | --- |
| Host main loop | **Maximum request-attributable uninterrupted main-loop blockage <=100ms for every request**, including input validation, dispatch, result structured-clone/deserialization and page delivery. Use a documented heartbeat/event-loop-delay method with bracketing samples and an idle baseline; capture the final delivery stall, not only the wait for SQL. Do not substitute average/p95 or request duration for maximum blockage. Keep the writer off the host loop so its synchronous work cannot mask the reader's attribution. Report scheduling noise separately; never subtract it silently to obtain a pass. |
| Reader p95 | Report nearest-rank p95 (`ceil(0.95*n)`) of public request-to-settlement latency by world/mode/runtime/schema/phase/bounds and separately for actual active overlap, with sample counts, max, busy/stale/timeout counts and retry-inclusive user latency. **Numeric p95 target and minimum sample count require product agreement before measurement acceptance**; no performance acceptance with those blank. Successful partials must also reach exact traversal completion within the pinned origin lifetime in the stable-writer workload; timeout/busy storms do not count as fast successful pages. |
| Bytes per page | Every captured full response <=requested `maxBytes` (absolute ceiling 262,144 bytes); available text <=1,024 bytes/item and <=`maxChars` graphemes; approved source payload <=`12000*L` (absolute ceiling 1,200,000 bytes/request). Report these separately, with work units and extraction count. Numeric counters only; never source/preview text in reports. |
| Writer coexistence | Show active per-request overlap, successful commits and writer latency/error distributions under the selected E1-C policy in DELETE and WAL. Record the policy and all thresholds before the queued run; no guessed inherited acceptance. |

The <=100ms host gate is a product measurement acceptance requirement, not a
hard-real-time guarantee derived from SQL limits. If any gate fails, do not
enable P1: investigate source/segmentation/clone costs and bring a revised
contract or bounded implementation to audit. Do not weaken E1-M, move timing
assertions into ordinary tests or claim this docs packet fixes the incident.
Primary owns queued, supervised execution and reports actual exit codes.

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

The remaining product question is **the numeric reader-p95 acceptance target
and minimum samples per measurement cell**, including how cold opening is
budgeted. The 100ms host maximum, world sizes and byte bounds above are fixed;
reader latency must not be inferred from them. Implementation review must also
close the explicitly recorded SQLite guard-proof obligation on both runtimes.

Follow the primary's dispatch traps list for later implementation/integration.
This docs-only packet does not modify
the artifact manifest; if the primary ships this plan, register it and any
future runtime files in `packaging/artifact-files.json`, independently verify
the installed closure, and mechanically cross-check inventories with counts.
Do not edit the frozen E1-M plan or other sessions' fixtures. Non-author audit,
implementation, tests, opt-in measurements, manifest registration when shipped,
product enablement and commits remain the primary's subsequent work.
