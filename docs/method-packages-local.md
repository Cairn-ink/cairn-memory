# Local method packages: U2a

`method-packages-local-v1` is an explicit text-only engine opt-in in the existing
SQLite store. U2a provides immutable imports, context-free history reads,
mechanical comparisons, logical deletion, content-free replay and durable effects.
It installs the complete v30 canonical schema, including initially empty binding,
binding-generation and binding-event tables. It does not adopt, resolve, execute
or select a current method. Binding behaviour, role contexts, snapshots and
current-intent delivery are U2b work; U2b will not change the v30 layout. The authoritative
specification is [contract v0.3.1](plans/unified-memory-v1-contract.md).

Run `npm run demo:method-packages` on Node 22.16 or 24.15. It uses scripted
synthetic approvals, retains its printed synthetic database, and makes no network
or model calls. It is not a production confirmation adapter.

## Construction and authority

```js
const core = openMemoryCore({ path, methodPackages: {
  version: 'method-packages-local-v1', storage: 'local-plain-v1',
  authority: { authorize(request, token), isCurrent(grant, request) },
} });
```

Default construction exposes no method-package methods and never upgrades for
this feature. Selecting method packages does not enable Cards, Raw capture,
local consent controls or backfill. Capabilities require no authority:
`core.getMethodPackageCapabilities()` lists the implemented methods and limits.

Every data method takes `(input, token)` and returns `{ok:true,value}` or
`{ok:false,error:{code,retryable}}`. Only `storage_busy` is retryable. `token` is
an opaque host object, separate from serialized input. Host authentication,
exact namespace access, generation/revocation and independent explicit user
approval are required. Capture consent, tool flags, file instructions, role
names, model output and ordinary Card-method allowlists confer no method access.

The synchronous port follows [private Cards](private-cards-local.md): core sends
`{method,namespace,actionClass,actionId,targetId,expectedRevision,payloadBinding,input}`.
The deeply frozen `input` is the full pre-redaction snapshot. `authorize` returns
an opaque grant; `isCurrent` returns exactly the request fields except `input`,
plus positive `accessGeneration`. Core checks it twice outside the transaction,
then performs canonical checks without callbacks, awaits or model work under the
lock. Imports and deletes require `explicit-user`; reads require `read`.
When an import cites reasons, core separately requests `read` for each exact
reason namespace using the same method/input/binding and `actionId:null`.
The host must explicitly authorize that read as well as the mutation. A rejected
initial grant returns `authority_required`; final revocation or generation change
returns `scope_changed`. Exceptions are sanitized; input text is never returned
in an error. Successful replay still needs current authorization.

The optional MCP host authority configuration may explicitly select method
reads using `createScopedCardAccess(namespace,{methodPackages:true})` and its
`methodPackageConfiguration`. It grants no method import/deletion authority and
adds no MCP tools. Directory importing, filesystem confinement, strict byte-to-UTF8
decoding and installed method workflows are U3 work.

## References and API

An exact namespace is `{ownerId,scope:'personal',projectId:null}` or
`{ownerId,scope:'project',projectId}`. Package identity is always the core-issued
`{type:'method-package',namespace,packageId}`. Version identity is
`{type:'method-version',namespace,packageId,versionId,manifestIdentity}`.
HMAC identities bind store, scope and purpose; they are not public hashes.
Titles and paths never identify or join packages.

| Method | Input fields | Value |
| --- | --- | --- |
| `importMethodVersion` | `namespace,actionId,title,submittedBy?,files,package?,expectedPackageRevision?,basedOn?,change?` | `{package,version,ordinal,packageRevision}` |
| `getMethodVersion` | `version,intent:'history'` | `{version}` metadata with `adoptionStatus:'unassessed'`; deleted returns `{version:null,status:'unavailable',adoptionStatus:'unavailable'}` |
| `listMethodManifest` | `version,intent:'history',cursor?` | `{files,adoptionStatus,coverage,nextCursor}` |
| `readMethodFile` | `version,path,intent:'history',cursor?` | `{parts,adoptionStatus,coverage,nextCursor}` |
| `listMethodPackages` | `namespace,limit?,cursor?` | `{packages,coverage,nextCursor}` |
| `listMethodVersions` | `package,limit?,cursor?` | `{versions,coverage,nextCursor}` |
| `compareMethodVersions` | `from,to,cursor?` | `{from,to,status,changes,items,reason,reasonRefs,coverage,nextCursor}` |
| `deleteMethodVersion`, `deleteMethodPackage` | `actionId,ref,expectedRevision` | `{id,revision,state,effectCount}` |
| `listMethodEffects` | `namespace,limit?,cursor?` | `{effects,coverage,nextCursor}` |
| `getMethodPackageUsage` | `namespace` | `method-package-usage-v1`, `retainedFileBytes`, owner `limitBytes` |

Any supplied `context` or `snapshot`, including null, and any current-intent
read returns `invalid_input` in U2a. Context-free content reads must explicitly
supply `intent:'history'`. No import establishes currentness or adoption.

The first import omits `package` and has null `basedOn`. Later imports require
that package, its exact positive `expectedPackageRevision`, and an available
earlier `basedOn` version of the same package and namespace. Ordinals allocate
atomically. A new import never alters prior bytes, identities or bindings.

Files are `{path,text,mediaType}`. A change is
`{items:[{summary,paths}],reasonRefs}` with paths in either endpoint's manifest.
Reason refs may be exact Memory, Card, submitted-note, retained-receipt or Raw
source refs in the import namespace. Core validates availability and revisions
inside the transaction, including Raw exclusions, and copies no source text.
Foreign, missing or unavailable reasons refuse import; method-version reasons
are deferred. Reason prose must first be explicitly submitted as a source note.

Comparison is path-level `added`, `removed`, `changed` or `unchanged` by content
identity, for any two available versions of one package. Authored items and
reason refs appear only on their stored directed `basedOn` edge. Other edges
and zero-ref records report `reason:'not-recorded'`; zero-ref records still
retain their items. Individual ref status is `available` or `unavailable`.
At least one available ref yields `reason:'available'`; all recorded refs
unavailable yields `recorded-unavailable`. No reason is inferred. Comparison
pages share one cursor stream: collect `changes`, `items` and `reasonRefs`
from every page. Deleted endpoints return `{status:'unavailable'}` with no diff
or change prose. Deleted manifest/file reads likewise report `unavailable`.

## Limits, paging and usage

Paths are relative POSIX strings of at most 512 UTF16 units: no leading slash,
drive/scheme prefix, backslash, NUL, empty/dot/parent segments, or duplicate paths
under locale-independent Unicode lowercase. Percent escapes remain literal.
The allowlist is `text/markdown`, `text/plain`, `application/json`,
`application/yaml`, `text/csv`; other media returns `unsupported_media`.

Each version has 1–64 files, each at most 100,000 UTF16 units and at most
1,000,000 units in aggregate. Core rejects malformed Unicode and NUL. Empty
file text is allowed. Best-effort secret redaction precedes persistence, byte
accounting and content/ordered-manifest identities; formatting is preserved.
The action ledger HMAC covers the complete original pre-redaction input.
Titles and attribution labels are at most 200 units. There are at most 256
packages per namespace, 128 versions per package, 16 unique reason refs per
action and 32 change items per version, each summary at most 500 units. Package
and version limits include tombstones. Each change item has at most 128 unique
paths (the union of both possible 64-file endpoint manifests).

File parts are half-open UTF16 offsets, at most 4,000 units and always at code
point boundaries. A call returns one part; an empty file returns no parts.
Every delivery rechecks the requested immutable manifest and persisted content.
History defaults to and caps at 20 items. Manifest and comparison pages use the
same 20-item bound and shrink by serialized whole-envelope size. Every success
envelope is at most 65,536 UTF8 bytes. An indivisible item that cannot fit gives
`context_item_too_large`. Cursors bind store, namespace, method, full stream
arguments and access generation; mutations stale them. Changed stream arguments
return `invalid_cursor`; stale generations within the stream return
`cursor_stale` (changed access-generation binding returns `invalid_cursor`).

`method-package-usage-v1` counts retained redacted file UTF8 bytes. Imports
reserve against an atomic 50,000,000-byte owner-wide cap across namespaces;
purges decrement in the same transaction. U2a exposes only the authorized exact
namespace's projection, not an owner-wide aggregate. Metadata, ledgers, effects,
SQLite overhead, WAL, backups and other memory kinds are excluded.

## Retention and non-claims

Explicit method text is an independently submitted artifact with its own
retention. Source-derived copies and generated summaries are unsupported until
U5 typed dependencies enforce forget/deletion fences. Hosts must not import
fenced or forgotten source output. Referenced reasons do not transfer source
retention or execution authority.

Version deletion purges file text, paths, title, attribution and change prose;
package deletion purges all versions and is terminal. Change records touching a
deleted endpoint are removed. Tombstones, ledger receipts and durable effects
retain only opaque refs/identities, revisions, ordinals, timestamps and numeric
counts. Import and deletion receipts replay before mutable existence checks,
including after deletion/restart; changed input under the same namespace action
ID yields `action_conflict`. Purged content never returns through replay.
Effects `method_version_deleted` and `method_package_deleted` are content-free;
consumers deduplicate by `effectId` and revalidate canonical state. Deletion
updates only package/version lifecycle state and revisions and emits its matching
deletion effect. It never enumerates or updates bindings, binding generations or
binding events, and never fans out `binding_unavailable` effects. Binding
generations advance only on binding transitions in U2b. Resolvers will derive
unavailability through canonical target checks, and snapshot revalidation will
check both binding and lifecycle revisions. The separate `method_epochs` counter
is a namespace pagination fence, not a binding generation. Effects grant no access. Deletion is active logical-row purge, not secure physical erasure from
free pages, WAL, snapshots or backups.

The writable ordinary opener alone upgrades selected fresh, v18 and v20–v29
stores to v30 inside one `BEGIN IMMEDIATE`. The schema-only prerequisite
migrator deliberately invokes missing installers without capture, grants or
backfill, validates prerequisites and rolls back schema/data/version on failure.
v19 and other unsupported starting layouts refuse. Read-only, managed-existing,
local setup/preflight and permission openers recognize an already-upgraded v30
without migration. `schema29-existing-v1` remains compatible; explicit
`schema30-existing-v1` requires v30. Old binaries refuse v30. Stop mixed-version
writers before upgrading; operators own inventory, backups and restore policy.

The complete method allocation is frozen in
[`method-package-v30-layout.json`](../core/testing/method-package-v30-layout.json).
U2b must use these existing tables, columns, constraints and indexes; a later
canonical layout change requires a newly allocated schema version. Incomplete
pre-acceptance v30 layouts are refused by all openers rather than silently repaired.

The binding storage is normalized and initially empty:

| Table | Canonical fields and constraints |
| --- | --- |
| `method_binding_generations` | Binding namespace plus `package_id` is the primary key; positive per-key `generation`. Scope guards permit an exact namespace or a same-owner project binding to a personal package. |
| `method_bindings` | Unique binding namespace, `package_id`, `role_key`; positive `revision` and last-transition `generation`; `created_at`, `updated_at`. `role_key` is `*` for a null role, or 1–200 ASCII letters/digits/dot/underscore/hyphen. State is `active` or `disabled`. |
| `method_binding_events` | Opaque `event_id`, unique positive global `ordinal`, binding key, `kind:'binding_changed'`, resulting state and target ref, positive revision/generation, action ID, timestamp and up to 16 serialized reason refs. No paths, titles, labels, file text or change prose. A binding revision and a per-package binding generation each identify exactly one event. |

An active target is stored as `version_id` plus `manifest_identity`, with a
composite foreign key to that exact version of `package_id`; its namespace comes
from the canonical package row. Together these reconstruct the full immutable
`MethodVersionRef`. Disabled targets require both columns to be null. Bindings
reference their canonical generation key; events reference their binding key.
Foreign keys retain opaque targets through logical deletion. No deletion cascade
or package/version mutation trigger changes binding storage. Reason refs remain
reference metadata; U2b must authorize and canonically validate them in its
transition transaction, without copying source text.

## Synthetic verification and historical fixtures

Ordinary unit suites use committed immutable fixtures and need neither Git nor
historical objects. `core/testing/method-package-history.json` contains populated
synthetic v18 and v20–v29 stores plus the actual pre-v30 default API/DTO baseline.
It deduplicates shared schema definitions and records full source revisions and
binary values. Restore checks schema-object hashes, SQLite integrity and foreign
keys before migration. Every old row is compared after migration. These fixtures
were produced through each historical version's public opt-ins; v24 predates the
capture facade and uses its original journal opt-in.

`core/testing/method-package-v29-database.mjs` freezes the actual `b8fa224`
ordinary database opener, with only a provenance header and relative import
relocation. A separate process first proves it opens a populated v29 fixture,
then proves it refuses a genuine v30 store without changing the file. The default
API/DTO comparison uses frozen output from the full historical implementation,
not output produced by the new implementation.

Maintainers with full history can regenerate or independently verify these two
artifacts on Node 22.16 or 24.15:

```sh
npm run fixtures:method-packages -- --verify
npm run fixtures:method-packages -- --write
```

The opt-in recipe archives the pinned historical sources, creates fresh stores
through their original APIs, captures populated layouts and compatibility output,
and extracts the old opener. Only the synthetic clock and entropy inputs are
fixed, so `--verify` compares regenerated artifacts byte for byte on either Node.
It fails if required history is unavailable. Neither command is part of ordinary
unit execution or CI; shallow CI requires no checkout-depth change.

Existing-store validation compares every required method table, index and trigger
SQL definition against SQLite's rendering of the canonical installer, as well as
checking column, primary-key, index and foreign-key metadata. This includes CHECK
constraints, implicit uniqueness and complete namespace-guard trigger bodies.
Same-named weakened definitions are refused across ordinary, read-only,
managed-existing and local preflight openers without repair. The frozen v30 layout
is unchanged by this validation hardening.

`method-packages-races.test.mjs` starts independent concurrent SQLite writers.
File-based ready/start barriers synchronize calls; a third connection holds the
write lock until both children pass their final authority fence and attempt their
transactions. The tests race owner quota across namespaces, import against package
and version deletion, and two imports under the same package CAS. The quota
baseline contains real retained bytes created through public imports. Assertions
cover committed usage against file sums, CAS outcomes, ordinal allocation,
partial-row absence, effects and fresh-process replay. No stdio pipe or sequential
`spawnSync` call is used to create competing writers.

Rollback, replay and purge checks also use separate processes. These tests
establish local mechanics, not semantic quality, safe code execution, host
filesystem confinement, hosted encryption or product readiness.
