# Local standalone assets (assets-local-v1)

The embedded core can retain explicitly submitted opaque binary versions.
SQLite BLOBs are plaintext at rest, under the existing private-file checks. This
preview is opt-in and has no asset CLI or MCP tools. It does not decode media,
run parsers or models, execute content, or read import files itself. Derivatives
and binary method attachments have reserved v31 storage but no public methods
in this packet. `getAssetCapabilities()` advertises only implemented methods and
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
Capture consent, model output and tool flags do not mint grants.

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
asset/attachment bytes and retained derivative UTF-8 text; this packet only
creates standalone assets. Namespace usage is authorized independently; no
owner aggregate is implicitly disclosed. Metadata, ledgers, effects, SQLite
page overhead, journals/WAL and backups are outside accounting.

Deletion purges descriptions, names, media labels, binary objects/chunks and
future derivatives. Content-free tombstones, opaque identities, ordinals,
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
It asserts the 32-MiB import transaction and RSS bounds and the independent
maximum-byte-reader/binding-writer contention bounds, including zero busy,
at least 100 committed transitions, at least 200 overlapping reader pages and
writer p95 ≤250 ms. Its fixed writer pause is one tenth of a complete byte-read baseline, spreading
the minimum 100 transitions across ten baseline passes. It has a finite overall
deadline and reports reader latency
during overlap separately. It is not a media parser or product benchmark.

The shallow-CI historical fixtures under `core/testing/fixtures/assets-v30/`
contain the actual install archive captured directly from the clean `e63b24c`
checkout and a populated synthetic v30 store created with its public opt-ins.
The manifest records per-file hashes and archive/store hashes. Unit suites
restore those immutable bytes without git or historical objects. Run
`node tools/testing/run.mjs --experimental-test-isolation=none core/test/assets-migration.test.mjs`
to verify their integrity, complete installed closure, refusal and migrations.
`core/testing/asset-v31-layout.json` freezes every new canonical definition for
the next packet, which must add behavior without DDL changes.
