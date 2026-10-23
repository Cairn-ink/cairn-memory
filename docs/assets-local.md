# Local standalone assets (assets-local-v1)

The embedded core can retain explicitly submitted opaque binary versions.
SQLite BLOBs are plaintext at rest, under the existing private-file checks. This
preview is opt-in and has no asset CLI or MCP tools. It does not decode media,
run parsers or models, execute content, or read import files itself. The embedded
API also supports user-provided derivatives and exclusive method attachments,
using the same frozen v31 layout. `getAssetCapabilities()` advertises implemented methods and
reports `parser:'unavailable'`.

```js
const core = openMemoryCore({
  path,
  assets: { version: 'assets-local-v1', storage: 'sqlite-blob-v1', authority },
});
```

`authority` implements the synchronous `{authorize,isCurrent}` port used by
private Cards and method packages. Its allowlist must name asset methods
explicitly. Import and deletion require `explicit-user`; every read requires a
fresh exact-namespace `read` grant. `readAssetBytes` and `verifyAssetBytes` are
byte-delivery permissions; metadata access does not authorize either method.
Capture consent, model output and tool flags do not mint grants. Derivative
creation/deletion also require `explicit-user`. Mixed-method import and
`readMethodAttachmentBytes` require grants from both configured authority ports,
binding the same operation and payload commitment. The asset port must explicitly
allow those method names (`ASSET_METHOD_GRANTS`); method metadata/text/purge use
only the method port. Binary authority inputs contain frozen byte-count/commitment
descriptors, never views into the copied bytes.

All methods take `(input, authorityToken)` and return `{ok:true,value}` or a
sanitized `{ok:false,error:{code,retryable}}`. Only `storage_busy` is retryable.
Capabilities contain no private counts and require no token.

| Method | Input |
| --- | --- |
| `getAssetCapabilities` | none |
| `importAssetVersion` | `namespace, actionId, title, filename, mediaType, bytes`, optionally `asset, expectedAssetRevision` |
| `listAssets` | `namespace, limit?, cursor?` |
| `listAssetVersions` | `asset, limit?, cursor?` |
| `getAssetVersion` | `version` |
| `readAssetBytes` | `version, cursor?` |
| `verifyAssetBytes` | `version, bytes` |
| `deleteAsset` / `deleteAssetVersion` | `actionId, ref, expectedRevision` |
| `getAssetUsage` | `namespace` |
| `listAssetEffects` | `namespace, limit?, cursor?` |
| `createAssetDerivative` | `actionId, version, expectedVersionRevision, kind, text, method`, optionally `language, timecodes` |
| `listAssetDerivatives` | `version, limit?, cursor?` |
| `readAssetDerivative` | `ref, cursor?` |
| `deleteAssetDerivative` | `actionId, ref, expectedRevision` |

Namespaces use `{ownerId,scope,projectId}` with `projectId:null` for personal
scope. An asset ref is `{type:'asset',namespace,assetId}`. A version ref adds
`type:'asset-version',versionId,contentIdentity`. IDs are random; names never join
objects. Identities are store-keyed, domain-separated HMACs over canonical
unnormalized UTF-8/bytes. They are not public digests or cross-namespace equality
keys. Equal submissions retain separate objects and each copy consumes quota.

The first import returns `{asset,version,ordinal,assetRevision}`. Later imports
need the asset ref and its expected revision. Imports and version deletions
advance the asset revision; ordinals are allocated atomically. Version revisions
are 1, then 2 on deletion. An asset deletion is terminal. Every mutation has an
action ID: authorized exact replay returns its original content-free receipt,
including after purge; a changed valid payload returns `action_conflict`.

Imported bytes must be a nonempty `Uint8Array` (including Buffer). Verification
accepts an empty candidate and reports a nonmatch. The selected view is
copied privately before host callbacks and locks. Shared and detached backing
stores refuse. The authority request's `input.bytes` is a frozen
`{byteCount,commitment}` descriptor, not a byte view; the payload binding covers
the complete pre-redaction input. No stored backing array escapes. Titles and
filenames use the existing best-effort redactor; binary bytes remain exact.
All signature checks and content/chunk/action MACs precede `BEGIN IMMEDIATE`.

Filename extension, declared media and the bounded leading signature must agree.
Supported types are PNG, JPEG, GIF, WebP, WAV, PDF, MP3, MP4, TTF, OTF, WOFF and
WOFF2, exactly as the contract's signature table specifies. Metadata reports
`signature:'signature-matched'`. This says nothing about validity, safety,
renderability, codecs or font behavior.

`readAssetBytes` returns one base64 chunk with `encoding:'base64',index,byteCount,
totalByteCount,complete,nextCursor` and the exact version ref. Raw chunks are at
most 32,768 bytes; the whole core success envelope is at most 65,536 UTF-8 bytes.
Every page uses a deferred query-only read transaction. It checks lifecycle and
metadata and verifies only the selected chunk, including its authenticated total
and expected final length. Another chunk's corruption is discovered when that
chunk is read. Completion comes from the authenticated total, not from a short
row or a missing following row. Verification compares supplied bytes against one
live authorized version and returns `{matches,candidateLength,canonicalContentIdentity}`; it never returns a
candidate identity.

Cursors authenticate the store, namespace, operation, exact version/identity and
access generation before target lookup. Byte cursors also bind chunk position,
parent/version revisions and namespace epoch. Substitution gives `invalid_cursor`;
mutation gives `cursor_stale`. A valid cursor for a deleted target reports
`status:'unavailable'` before epoch staleness. Missing or foreign targets give
`asset_not_found`. A mismatched identity or corrupt selected chunk gives
`asset_version_unavailable`. List pages default to and cap at 20 items and are
also trimmed by envelope bytes.

Limits: 33,554,432 bytes per version, 64 versions per asset, 1,024 assets per
namespace, title 200 UTF-16 units, single-component filename 512 units. Tombstones
continue to count toward entity limits. The owner-wide binary quota is
200,000,000 bytes, separate from the method text quota. Usage includes retained
asset/attachment bytes and retained derivative UTF-8 text. Namespace usage is authorized independently; no
owner aggregate is implicitly disclosed. Metadata, ledgers, effects, SQLite
page overhead, journals/WAL and backups are outside accounting.

Deletion purges descriptions, names, media labels, binary objects/chunks and
derivatives. Content-free tombstones, opaque identities, ordinals,
revisions and receipts remain. Object-delete triggers alone release object
bytes; derivative-transition triggers alone release derivative text, preventing
double release. Each requested deletion emits one durable target effect;
children produce no extra deletion effects. This is logical active-row purge,
not physical erasure of freed pages, journals or backups.

Only selecting assets on an ordinary writable opener upgrades fresh stores and
supported populated v18 or v20–v30 stores to v31; v19 refuses. This upgrade is
one-way. Unselected stores retain their version. Method-only and default
processes can open v31. Read-only, managed-existing, local setup and local
preflight validate the complete v30/v31 definitions without migration or repair.
Stop older writers before upgrading: actual v30 binaries refuse v31. No asset
facade is enabled merely by reopening an upgraded database.

`npm run measure:assets` is an opt-in synthetic K13 gate on Node 22.16 and 24.15.
It asserts the 32-MiB standalone and 64-MiB mixed import transaction and RSS bounds and the independent
maximum-byte-reader/binding-writer contention bounds, including zero busy,
at least 100 committed transitions, at least 200 reader pages overlapping actual
writer-call intervals, and writer p95 ≤250 ms in the labelled paced scenario.
That writer pauses one tenth of a complete byte-read baseline between transitions
until a complete contended read and the active-overlap threshold are reached.
Writer sleeps and reporting time do not count as active overlap. The labelled
unpaced scenario is a stress observation: its writer stops at reader completion
or after 10 seconds (plus an in-flight bounded SQLite call). Readers retry busy
outcomes on the same page/cursor with 10–250 ms backoff within the shared
600,000 ms overall deadline, then verify an exact-byte complete read. It reports
pages, busy counts/waits, retry delays, maximum page latency and completion;
only corruption, byte mismatch, writer errors or deadline breaches fail stress.
Both child exits are checked. Reader latency is reported for the whole run,
writer lifetime (`duringOverlap`), and actual calls (`duringActiveWrites`),
without a reader latency threshold. See [rollback-journal limitations](limitations.md).
It is not a media parser or product benchmark.

The unreleased v31 layout guards terminal rows and immutable payload keys against
insertion and update replacement (including hidden rowid conflicts), plus method tombstones and stale binding
revisions. They reject replacement inserts even with SQLite's default
`recursive_triggers=0`; normal binding CAS upserts and re-adoption remain valid.
The v30 installer is unchanged. Validation checks the complete owned trigger set
and refuses extra triggers, including additional quota-release writers.

The shallow-CI historical fixtures under `core/testing/fixtures/assets-v30/`
contain the actual install archive captured directly from the clean `e63b24c`
checkout and a populated synthetic v30 store created with its public opt-ins.
The manifest records per-file hashes and archive/store hashes. Unit suites
restore those immutable bytes without git or historical objects. Run
`node tools/testing/run.mjs --experimental-test-isolation=none core/test/assets-migration.test.mjs`
to verify their integrity, complete installed closure, refusal and migrations.
`core/testing/asset-v31-layout.json` freezes every new canonical definition for
all core behaviors; derivatives and mixed attachments add no DDL.

## User-provided derivatives

`createAssetDerivative` accepts `caption`, `transcript`, `description` or
`alt-text`, an exact source version, `expectedVersionRevision:1` and
`method:{kind:'user-provided'}`. Text is valid Unicode without NUL, at most
20,000 UTF-16 units before and after best-effort redaction. Formatting remains
intact. A version has at most 32 derivatives, including deleted tombstones.
An optional BCP 47 language tag has at most 35 units. Audio/video alone can have
up to 256 ordered safe-integer `{startMs,endMs}` intervals. Their explicit
`alignment:'user-supplied-unverified'` describes supplied intervals, without any
text-span alignment or media-understanding claim.

Creation returns `{derivative,source,revision}`. A derivative ref is
`{type:'asset-derivative',namespace,assetId,versionId,derivativeId}`. Lists and reads
report exact versioned provenance, source ordinal, greatest imported ordinal and
`historical` (source ordinal is lower). New versions inherit nothing. Reads
return code-point-safe parts of at most 4,000 units. Deletion purges text, kind,
language, intervals and provenance through the sole quota-release trigger.
Source deletion cascades without descendant effects. Every delivery requires
fresh exact-namespace read authority; a historical reference never grants access.

## Mixed method attachments

Configure both method and asset ports. `importMethodVersion` accepts explicit
`manifestFormat:'mixed-v1'` and ordered tagged `files`: either
`{kind:'text',path,text,mediaType}` or `{kind:'binary',path,bytes,mediaType}`.
At least one entry is binary. There are at most 256 total entries, each binary
at most 33,554,432 bytes and the binary total at most 67,108,864 bytes. Existing
text limits also apply. Binary paths/declarations/signatures must agree. Text-only
imports keep their existing untagged wire format and identities.

Each binary entry owns a separate object and all copies count toward the binary
quota. Text and binary entries share positions. Mixed manifests expose `kind`
and bind kind, path, media, byte count and content identity. Comparisons use kind,
media and identity; no semantic reason is inferred.

`readMethodAttachmentBytes({version,path,intent,context?,snapshot?,cursor?},token)`
delivers one authenticated base64 chunk with the existing method adoption status.
Current intent requires context and the available winning target. Adoption
changes stale current pins/cursors without substituting another version. History
pins and continuations remain exact through adoption/disable, with fresh grants;
parent/version lifecycle changes stale live continuations and deleted targets are
unavailable. The cursor also binds both ports' access generations. Revocation
blocks bytes. Method-only processes retain mixed metadata and text reads;
byte delivery without the asset capability returns `unsupported_media`.
`readMethodFile` on a binary entry also returns `unsupported_media`.

Every attachment page checks lifecycle and manifest metadata plus only its selected
chunk. It does not load method text or hash unrelated chunks. Whole method version,
manifest and comparison reads retain whole-text verification. Purge checks only
canonical identity, lifecycle and CAS, so corrupted payloads can still be removed
with assets disabled. There are no asset references or asset effects for method
attachments; method receipts/effects retain their existing format.
