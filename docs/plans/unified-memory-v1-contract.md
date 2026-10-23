# Unified memory integration V1: P0 contract and first packet (method packages)

Status: **v0.3.1, audited and confirmed for U2a implementation. Nothing is
implemented yet.**
- v0.1 (`81e0f21`) was audited by Codex `umv1_contract_audit` (gpt-6.1-sol/xhigh,
  read-only), which found seven P0, four P1 and one P2 issue.
- v0.2 (`91a7825`) adopted them.
- v0.3 (`2b2e3cf`) applied the re-check's three P0 and three P1 replacements.
- v0.3.1 adds the auditor's two confirmation clarifications: one invalidation
  rule, and the U2a/U2b schema boundary.

Branch `integration/unified-memory-v1`, based on PR #469 head
`b8fa224d5ba6fe8007e6d80fe64fae74d89aa78b` (the tip of the unmerged Raw/local
stack). The research charter and decisions live on branch
`experiment/hybrid-retrieval-hr1` (`docs/plans/memory-next-stage-charter.md`).
This is the public-engine part of a private integration draft (v0.2).

## 1. Scope and sequencing

| Packet | Content | Waits for |
| --- | --- | --- |
| **U2 (§§2–9)** | M4 method packages in core, **text-only subset**: immutable versions, adoption bindings, change records, history, pins and deletion fences. Includes the schema-only prerequisite migrator and opener updates for v30. Delivered as U2a (schema, migrator, import, reads, compare, deletion) then U2b (bindings, resolution, pins, binding events) | Audited contract (v0.3) |
| U3 | M4 host side: safe local directory importer (real symlink/path-swap confinement, strict UTF-8), explicit-user approval through the existing local authority path, read-only MCP tools, installed tests | U2 accepted |
| U4 | M5 assets and derivatives: binary storage port, immutable asset versions, derivative provenance, binary method attachments | U2's typed-ref/schema rules |
| U5 | M6/M7/M8: `context-read-v1` common read; candidate channels; budgeted assembly; role profiles; current-dependent Card/cache/MOC invalidation driven by U2 binding generations | HR-1/HR-2 evidence for defaults; interfaces and degraded modes may be specified earlier |

**U2a/U2b boundary**:
- U2a installs the **complete v30 canonical schema**, including the initially
  empty binding and event tables that U2b needs.
- U2b adds behaviour without silently changing the v30 layout; any later
  canonical schema change needs a newly allocated version.
- U2a's capabilities advertise only implemented operations.
- Under U2a, version, manifest and file reads accept only context-free
  `intent:'history'`. Current intent, context and pin snapshots are rejected
  with `invalid_input` until U2b.

U2 and U3 certify only the **text-only M4 subset**. Completing the draft's A10,
A17, A18 and A19 additionally requires installed cross-agent workflows and U5's
dependency validation.

The [three-layer contract](three-layer-engine-contract.md) boundaries carry over:
- one SQLite engine;
- strict envelopes and authority from the host;
- no model calls in write locks;
- old DTOs and tools unchanged;
- explicit opt-in.

## 2. Cross-cutting decisions (P0)

### 2.1 Schema allocation and migration

- The current maximum is v29 (`LOCAL_AUTHORITY_SCHEMA_VERSION`). U2 takes
  **v30**; U4 reserves **v31**. U5 indexes are rebuildable sidecars with their own
  format version. One integration owner allocates versions; numbers are never
  reused.
- **Prerequisite migrator.** U2 adds a schema-only prerequisite migrator for
  fresh stores and supported v18 and v20–v29 layouts. v19 is unsupported.
  - It installs missing schemas exactly once inside `BEGIN IMMEDIATE`,
    preserving existing rows, with no capture, grants or backfill.
  - It validates prerequisites before committing v30.
  - Method packages remain opt-in: unselected stores never upgrade.
  - On failure, schema, data and `user_version` roll back.
  - Today, feature-off flags skip installers (`core/database.mjs:33`). The
    migrator must call the schema installers deliberately, without enabling
    their features.
- **Only the writable ordinary opener performs prerequisite migration.**
  Read-only and managed-existing openers validate and reopen an
  already-upgraded v30 store without creating or migrating it.
- **Openers.** Update the ordinary, read-only and managed openers, plus local
  setup and preflight, so that v30 is recognized:
  - `core/database.mjs:361`
  - `core/existing-store.mjs:83`
  - `adapters/local/configuration.mjs:80`

  Old binaries reject v30. Writers on mixed versions must stop before an upgrade.

### 2.2 Typed references

Refs follow the existing `MemoryRef` / `CardRef` style: exact namespace, positive
revisions, and core-keyed HMAC identities bound to store, scope and purpose. There
are no public content digests.

| Ref | Shape |
| --- | --- |
| `MethodPackageRef` | `{type:'method-package', namespace, packageId}`. This is the **canonical, cross-scope identity** of a method; it is never null in resolution. |
| `MethodVersionRef` | `{type:'method-version', namespace, packageId, versionId, manifestIdentity}`. Immutable; deletion makes it unavailable, never different. |
| `MethodBindingRef` | `{type:'method-binding', bindingNamespace, package: MethodPackageRef, roleKey, revision}` |

- `roleKey` is the host-supplied stable role identifier (1–200 units,
  `[A-Za-z0-9._-]`), or the reserved key `*` meaning any role. Callers pass
  `roleId: null` for `*`.
- Role identifiers grant no access and no execution authority. Role profiles are
  later U5 work, as versioned Memory/Card references.

### 2.3 Capability and authority

- **Opt-in**:
  `openMemoryCore({ path, methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } })`.
  Default construction exposes nothing new. `getMethodPackageCapabilities()`
  lists the methods; it holds no private data and needs no authority.
- **Authority port.** It reuses the synchronous `{authorize, isCurrent}`
  semantics of `private-cards-local-v1`, but with **method-specific allowlists**:
  - existing host authority objects whitelist Card methods
    (`adapters/mcp/private-card-access.mjs:19`), and they must add method names
    explicitly;
  - capture consent never authorizes method operations.
- **Namespaces and read sets**:
  - A `readSet` contains one exact namespace, or personal plus one project of
    the same owner.
  - The import namespace must equal `package.namespace` and
    `basedOn.namespace`.
  - The only cross-namespace binding target allowed is a project binding to the
    same owner's personal package.
  - Import `reasonRefs` use the import namespace; adoption and disable
    `reasonRefs` use `bindingNamespace`.
  - Each reason namespace is authorized before canonical validation or
    delivery. Package access alone never authorizes adoption reasons.
- **Action classes**:
  - import, adoption, disable and delete are `explicit-user`;
  - reads need read authority for **every namespace consulted**;
  - a cross-scope binding needs read authority on the package's namespace and
    mutation authority on the binding namespace, with the authorized read set
    carried in the adoption action;
  - a model, tool argument or file text never mints authority. A method file
    saying "adopt this" is data.
- **Reuse is architectural, not drop-in.**
  - Extract parameterized ledger, effect and cursor helpers from the private-Card
    closures, keeping Card behaviour byte-for-byte.
  - Supply separate import validation, because the Card input limits would
    reject legal method imports.
  - The ledger HMAC binds the complete **pre-redaction** input. Content
    identities and byte counts bind the persisted **post-redaction** bytes.

## 3. Method package model (U2)

- **Package**:
  - created by the first import in its namespace, with a core-issued
    `packageId`, a lifecycle `state` (`available` | `deleted`) and a `revision`;
  - version imports and deletions increment the package revision;
  - package deletion is terminal;
  - titles, file names and paths never identify or join packages.
- **Version**: immutable content, with:
  - `versionId` and `ordinal` (a display label 1, 2, …, allocated atomically);
  - `basedOn`: null for the first version, otherwise one available earlier
    version of the same package;
  - the manifest, `manifestIdentity`, `title` (≤200 units) and `submittedBy` (an
    untrusted label, ≤200 units);
  - `importedAt`, plus lifecycle `state` and `revision` (1, then 2 on deletion).
- **Import into an existing package** requires `expectedPackageRevision` (CAS),
  and cannot commit against a deleted package or a deleted `basedOn`.
- **Manifest**: 1–64 files `{path, byteCount, contentIdentity, mediaType}`.
  - **Paths** are mechanical relative POSIX paths:
    - no leading `/`, drive letter or URI scheme prefix;
    - no empty, `.` or `..` segments;
    - no backslash or NUL, and never percent-decoded;
    - ≤512 units;
    - unique, including under locale-independent Unicode lowercase.
  - Filesystem confinement and strict UTF-8 decoding are U3's job. Core
    revalidates Unicode, paths and media.
  - `mediaType` allowlist: `text/markdown`, `text/plain`, `application/json`,
    `application/yaml`, `text/csv`. Anything else fails `unsupported_media`
    until U4.
  - Files are ≤100,000 UTF-16 units each and ≤1,000,000 per version: valid
    Unicode, no NUL, redacted with the existing best-effort redactor before
    persistence, formatting preserved.
  - `manifestIdentity` is an HMAC over the ordered `(path, contentIdentity,
    mediaType)` list.
- **Core never reads the filesystem or executes package content.**
- **Published limits** (proposed defaults to measure in U3):

  | Limit | Value |
  | --- | --- |
  | Packages per namespace | 256 |
  | Versions per package | 128 |
  | Bindings per namespace | 1,024 |
  | `reasonRefs` per action | 16 |
  | Change items per version | 32, each ≤500 units |

  These are text-only defaults and depart from the draft's 256-file / 64 MiB
  expectation, which belongs to U4 binary assets.
- **Usage** (`method-package-usage-v1`):
  - counts retained redacted UTF-8 bytes of method file text, per version,
    across all namespaces of an owner, with a 50,000,000-byte cap;
  - reserves atomically at import and decrements when deletion purges;
  - excludes metadata, ledger, effects, SQLite overhead, WAL and backups.

## 4. Adoption bindings and resolution (U2)

- **Key**: `(bindingNamespace, packageRef, roleKey)`, with at most one binding per
  key.
  - States: `active` (with a full `MethodVersionRef` of that package) or
    `disabled`.
  - Every transition increments the binding revision under CAS. `expectedRevision`
    is null only when creating; `disable` may create a disabled barrier.
  - A same-owner project binding may target a personal package.
- **Transitions**:
  - `adopt(version)` requires an available version and an available package;
  - `disable()`;
  - re-adopt after disable;
  - importing a version **never** changes a binding.
- **Effects and generations**:
  - Binding transitions atomically advance the binding generation for
    (bindingNamespace, packageRef) and emit `binding_changed`.
  - Package or version deletion advances the package's lifecycle state and
    revision and emits the matching deletion effect, without enumerating or
    updating any binding that references it.
  - Resolvers derive a binding's unavailability through canonical target
    checks.
  - Snapshot revalidation checks both binding and lifecycle revisions.
  - U2 supplies bounded binding-event reads (`listMethodBindingEvents`); U5
    consumes the generations to invalidate current-dependent Cards, caches and
    MOC representations.
- **Resolution**: `resolveMethod({readSet, package: MethodPackageRef, roleId})`
  uses four-level precedence over the authorized read set:
  1. project + role;
  2. project + `*`;
  3. personal + role;
  4. personal + `*`.

  The **first existing binding decides**, and disabled or unavailable bindings
  are barriers:
  - `active` with an available target → `current`;
  - `active` whose target version or package is deleted, or whose target scope is
    no longer readable → `unavailable`;
  - `disabled` → `disabled`.

  No binding at any level gives `no-active-version`. Upload time, ordinal,
  similarity and text never choose a version.
- **Listing**: `resolveMethodsForRole({readSet, roleId, limit, cursor})` applies
  the same rules to every package with a binding in the read set. Default and
  maximum page size is 20.
- **Snapshots** are opaque. They bind:
  - the role, the read set and the consulted binding revisions;
  - the **absence** of higher-level bindings;
  - the version refs;
  - the package and version **lifecycle revisions**;
  - access generations.

  Any binding change stales current snapshots; historical pins are never
  retargeted.
- **Deletion and invalidation**: deletion advances the package lifecycle
  generation and emits a package/version effect, with no per-binding fanout.
  Every delivery checks the target's lifecycle directly, whether or not effects
  were consumed.

## 5. Reads, pins, change records and history (U2)

- **Version and file reads**:
  - `getMethodVersion`, `listMethodManifest` and `readMethodFile` accept
    `intent` (`current`|`history`), a role/read-set `context`, and an optional
    authenticated pin `snapshot`.
  - **`intent:'current'` requires context**; otherwise `invalid_input`. Content
    is delivered only when the requested version equals the **available winning
    target**; otherwise `method_version_unavailable`. A stale current snapshot
    returns `cursor_stale`.
  - Only available winners establish `current` or `newer-version-available`.
  - **Context-free reads require `intent:'history'`** and report
    `adoptionStatus: 'unassessed'`.
  - Historical snapshots preserve identity but still require fresh access
    authorization.
- **`adoptionStatus` precedence** within the given context:
  1. the winning binding targets this version → `current`;
  2. it was never adopted in this context → `never-adopted`;
  3. it was previously adopted, but the winner is now `disabled` → `withdrawn`;
  4. a different active winner → `newer-version-available`, regardless of
     ordinal, so rollback to an older version is legal and shown;
  5. otherwise → `historical`.

  A deleted pinned version, or revoked target access, gives `unavailable` for
  both current and history reads.
- **File reads** return half-open UTF-16 parts of ≤4,000 units at code-point
  boundaries. Every read rechecks `manifestIdentity`, so a file can never come
  from a different version.
- **Envelopes and paging**: every success envelope is ≤65,536 UTF-8 bytes.
  Manifests, history and comparison metadata are paginated by serialized
  envelope bytes, and an indivisible oversized item fails
  `context_item_too_large`. History pages default to and cap at 20. Cursors are
  HMAC-bound and stale on mutation.
- **Change records** are persisted with explicit `from` (= `basedOn`) and `to`
  refs:
  - `{from, to, items:[{summary, paths}], reasonRefs}`, with paths existing in
    either version;
  - `compareMethodVersions(from, to)` compares any two available versions of one
    package **mechanically** (path-level `added`/`removed`/`changed`/`unchanged`
    by content identity);
  - recorded items and reasons are attributed **only to their stored edge**.
    Other edges, or a missing record, give `reason: 'not-recorded'`;
  - a matching change record with **zero** `reasonRefs` returns
    `reason: 'not-recorded'` and keeps its change items;
  - `recorded-unavailable` requires recorded refs that are **all** currently
    unavailable. Availability is also returned separately for each ref;
  - core never generates or infers reasons.
- **Reason refs**:
  - At most 16 refs (MemoryRef, CardRef, NoteSourceRef, RawSourceRef,
    ReceiptSourceRef), all in the import namespace or the binding namespace
    (§2.3), authorized and then canonically validated within the import or
    adoption transaction.
  - Delivery rechecks exact revisions, eligibility and Raw exclusions, and
    exposes only `available` or `unavailable`. Forgotten, missing, foreign and
    denied sources all collapse to `unavailable`.
  - No source text is copied.
  - Reason prose a person writes at import is first submitted through the
    existing `submitSourceNote`, then referenced. `MethodVersionRef` reasons are
    deferred.
- **Retention boundary**:
  - Explicitly imported method text is an independent, explicitly submitted
    artifact with its own retention.
  - Source-derived copies and generated summaries are **unsupported** until
    typed dependencies enforce canonical forget/deletion fences (U5).
  - Hosts must not route fenced or forgotten source output through import.

## 6. Deletion, tombstones and effects (U2)

- **`deleteMethodVersion(versionRef, expectedRevision)`**:
  - purges the version's file text, **paths, title, attribution label and change
    prose**;
  - CASes the version's lifecycle revision and increments the package revision.
- **`deleteMethodPackage(packageRef, expectedRevision)`**: terminal; purges the
  same fields for every version.
- **Tombstones, receipts and effects** keep only opaque refs and identities,
  revisions, ordinals, timestamps and numeric counts.
- **Reads of deleted objects**: manifest, file and diff delivery for deleted
  objects returns `unavailable`. Change prose depending on a deleted endpoint
  becomes unavailable. History can never reconstruct purged prose.
- **Bindings survive deletion as barriers**, resolving `unavailable` until a
  person adopts another version or disables the binding. Package deletion keeps
  them as barriers too, so lower-level defaults cannot reappear.
- **Effects** (`method_version_deleted`, `method_package_deleted`,
  `binding_changed`, `binding_unavailable`) are durable, content-free and listed
  by a paged `listMethodEffects`. Consumers revalidate; effects grant nothing.
- Deletion means active logical-row purge only, not secure physical erasure,
  matching existing private-Card wording.

## 7. Operations, replay and errors (U2)

- **Mutation discipline**:
  - Every mutation needs an `actionId`, and every existing-object mutation its
    expected revision.
  - After authorization, **exact replay is checked before mutable existence
    checks**, so a replay after deletion returns the original content-free
    receipt.
  - A changed payload under the same ID fails `action_conflict`.
  - Each mutation atomically validates its targets, allocates ordinals, checks
    CAS and quota, writes events and effects, and commits its receipt.
- **Receipts**:
  - import → `{package: MethodPackageRef, version: MethodVersionRef, ordinal, packageRevision}`;
  - binding transitions → `{binding: MethodBindingRef, state, version|null}`;
  - deletes → `{id, revision, state, effectCount}`.
- **Errors**:
  - existing: `invalid_input`, `authority_required`, `scope_changed`,
    `storage_busy` (the only retryable one), `storage_error`,
    `revision_conflict`, `action_conflict`, `cursor_stale`, `invalid_cursor`,
    `context_item_too_large`, `quota_reached`;
  - new: `method_not_found` (foreign and missing look identical),
    `method_version_unavailable`, `invalid_path`, `unsupported_media`,
    `package_limit_reached`.
- **Unexpected exceptions** become a sanitized `storage_error`, never file text.

## 8. Facade methods (U2)

All take `(input, authority)` and return existing envelopes. `A` = actionId.

| Method | Input | Success value |
| --- | --- | --- |
| `importMethodVersion` | `namespace, A, package?: MethodPackageRef, expectedPackageRevision?, basedOn?: MethodVersionRef, title, submittedBy?, files:[{path,text,mediaType}], change?: {items, reasonRefs}` (first import omits `package`) | import receipt |
| `getMethodVersion` | `version, intent, context?: {readSet, roleId}, snapshot?` | `{version}` metadata only, with `adoptionStatus`; or `{version:null}` |
| `listMethodManifest` | `version, intent, context?, snapshot?, cursor?` | manifest page; owns the complete manifest pagination stream |
| `readMethodFile` | `version, path, intent, context?, snapshot?, cursor?` | `{parts, coverage, nextCursor, adoptionStatus}` |
| `listMethodPackages` | `namespace, limit?, cursor?` | metadata pages |
| `listMethodVersions` | `package, context?, limit?, cursor?` | metadata pages |
| `compareMethodVersions` | `from, to, cursor?` | §5 result |
| `adoptMethodVersion` | `bindingNamespace, A, package, roleId, version, expectedRevision\|null, readSet, reasonRefs?` | binding receipt |
| `disableMethodBinding` | `bindingNamespace, A, package, roleId, expectedRevision\|null, readSet, reasonRefs?` | binding receipt |
| `resolveMethod` | `readSet, package, roleId` | `{status, binding, version, snapshot}` |
| `resolveMethodsForRole` | `readSet, roleId, limit?, cursor?` | `{methods, coverage, nextCursor, snapshot}` |
| `listMethodBindingEvents` | `bindingNamespace, package?, limit?, cursor?` | content-free event pages |
| `deleteMethodVersion` / `deleteMethodPackage` | `A, ref, expectedRevision` | delete receipt |
| `listMethodEffects` | `namespace, limit?, cursor?` | effect pages |
| `getMethodPackageUsage` | `namespace` | usage projection; owner-wide cross-namespace totals only if authority explicitly permits the aggregate |

## 9. U2 acceptance (synthetic stores; Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| M01 | Default construction is unchanged, and old DTOs and tools are unchanged. v30 opt-in migrates through the **writable ordinary opener** from fresh and from every supported **populated** layout (v18, v20–v29). Every applicable opener (read-only, managed-existing, local setup/preflight) then accesses the upgraded store without migrating. Rollback on injected failure. The **actual** old binary refuses v30. v19 is refused |
| M02 | Import stores exact redacted text, paths and identities, with aggregate limits and the maximum manifest. Refusals are atomic for invalid or colliding paths, prefixes and segments, unsupported media, oversize, invalid Unicode or NUL. Redaction identities are post-redaction. A second import with `basedOn` gives ordinal 2 with v1 bytes and identity unchanged; existing-package CAS is enforced |
| M03 | Reads deliver only from the requested immutable version. Identity mismatch, cursor substitution across versions and paths, and bounded parts, pages and envelopes are all exercised |
| M04 | In **separate processes**: adopt/adopt races (exactly one winner), import/delete, adopt/delete, and owner-quota races. Replay returns original receipts, including after deletion; changed payload fails `action_conflict` |
| M05 | Resolution precedence in all four levels: higher-level insertion; a `disabled` barrier created with a null expected revision blocks the default; package-deletion barriers; a cross-scope project binding to a personal package with the correct authority (and refusal without it); foreign namespaces invisible; `no-active-version` |
| M06 | Pins and statuses: `current`, `never-adopted`, `withdrawn`, `newer-version-available` (including rollback adoption of an older version), `historical`, `unassessed` without context, and `unavailable` after deletion or revoked access. Snapshots stale on binding change while history pins hold |
| M07 | Comparison of adjacent and **non-adjacent** versions. Recorded reasons sit on their edge only; `not-recorded` elsewhere; `recorded-unavailable` after forgetting a Memory or deleting a note; foreign or denied reason refs refused at import |
| M08 | In **fresh processes**: deletion purges text, paths, titles, labels and change prose; tombstones are content-free; deleted objects return `unavailable`; bindings act as barriers; effects are durable exactly once; no resurrection after restart or replay; usage decrements |
| M09 | Authority: missing, forged, wrong-scope, stale-generation, revoked and capture-consent-only grants refuse with no leak. Model or tool flags never authorize |
| M10 | Exact bounds and numeric limits, atomic refusals, exact error codes, and no network or model calls, package-filesystem access or execution from core. SQLite persistence and database opening are excluded from that last check |

## 10. Resolved design questions

1. **Roles** stay host-supplied identifiers. M8 role profiles are later
   versioned Memory/Card references (U5).
2. **Older stores** are supported through the explicit schema-only prerequisite
   migrator (§2.1).
3. **`MethodVersionRef` as a reason** is deferred. A later version may allow
   same-scope, reference-only, non-recursive use.
4. **Limits** are provisional text-only defaults. U3 measures real SKILL.md and
   template packages (sizes only) before freezing them.

## 11. U3: method packages on the local host (v0.4.2; v0.4.1 audited)

The draft (`fc5b9ea`) was audited by the same non-author auditor, who found
four P0, five P1 and one P2 issue. This section incorporates all of them.

U3 makes U2 usable on the installed local host without widening authority. It
reuses the private-Card terminal-review pattern
([private-card-terminal-review.md](../private-card-terminal-review.md)): MCP
tools inspect, and only a separate real-TTY command approves mutations. U3 does
not change v30 and does not add binary assets (those belong to U4).

### 11.1 Limits recalibrated from measured packages

Statistics only (no contents) from 21 real local skill packages on the
development machine, 2026-10-23. These figures are unverified by the auditor:
- files per package: 1–122;
- bytes per package: up to 1.85 MB;
- largest single file: 321 KB;
- 5 of 21 packages contain binaries (images, fonts, PDFs).

U2's text limits (64 files; 100,000 units per file; 1,000,000 units per
version) would refuse 3 of 21 packages on text grounds alone. U3 raises the
limits without DDL; v30 imposes no file-count or text-length CHECK:
- files: 256 per version;
- `fileUnits`: 400,000;
- `versionUnits`: 4,000,000.

The owner cap stays at 50,000,000 bytes, and the media allowlist is unchanged.

Raise the semantic validators and the snapshot string, array and aggregate
budgets together (`core/method-package-input.mjs` hard-codes 64, 100,000 and
1,000,000, and snapshots cap arrays at 128 and strings at 3,300,000 units).
Derive them from the advertised file bounds plus maximum legal metadata.
Update capabilities and the boundary tests. Preserve pre/post-redaction
checks, owner quota, identities, replay and pagination. Verify 256 files, a
400,000-unit file and a 4,000,000-unit version through the public facade.

**Resource bounds**:
- Bound streamed package bytes before allocation, including files that grow
  during reading.
- Cap raw bytes at four times the matching UTF-16 limits.
- Publish traversal depth and entry bounds, and change-file bounds.
- Every file page currently re-verifies the whole version. Measure complete
  maximum-version reading and concurrent-writer contention on both runtimes;
  4,000-unit pages alone are not a latency guarantee.
- **Contention found (v0.4.2).** The primary's first acceptance run measured
  this: every read page holds the write transaction while it re-verifies the
  whole version.
  - A tight maximum-version reader starved a concurrent binding writer. Ten of
    its 14 attempts waited out the busy timeout, at p50 about 5 s.
  - On Node 24 the reader itself received retryable `storage_busy`.

  U3 keeps the limits, and its measurement treats `storage_busy` on either side
  as data: retry the same page and count it, never abort. A follow-up packet,
  **U2c**, removes whole-version verification under the write lock from reads.
  U2c needs its own contract text.

### 11.2 Importer (`cairn-memory methods import`)

```sh
cairn-memory methods import --db /abs/store.sqlite --owner OWNER [--project PROJECT] \
  --dir /abs/package-dir --title TITLE [--submitted-by LABEL] \
  [--package PACKAGE_ID --expected-package-revision N --based-on VERSION_REF_JSON] \
  [--change /abs/change.json] [--exclude GLOB]...
```

The importer is a separate CLI process. The MCP process never imports.

- **Confinement** (Linux/WSL only; other platforms refuse). This follows the
  auditor's descriptor-capability rules in v0.4.1:
  - Pin the selected root directory descriptor, and keep every referenced fd
    open throughout its use.
  - **Names**: reject empty names, `.`, `..`, and names containing `/` or NUL.
    Never normalize or decode a component into a different name. Do not rely on
    `readdir` provenance alone.
  - **Opening a child**: open it relative to its pinned parent through
    `/proc/self/fd/<dirfd>/<name>` with ABI-correct `O_PATH | O_NOFOLLOW`, adding
    `O_DIRECTORY` when a directory is expected. Use numeric Linux flags where
    Node lacks constants. `O_PATH | O_NOFOLLOW` can return a symlink
    descriptor; reject it explicitly.
  - **Before any data access or directory enumeration**: validate the type, the
    mount ID (`mnt_id` from `/proc/self/fdinfo/<fd>`, refusing missing or
    malformed metadata, and requiring equality with the root's) and, for
    regular files, `nlink = 1`. Refuse devices, FIFOs and sockets without ever
    opening them for reading.
  - **Reading**: reopen an approved regular file through
    `/proc/self/fd/<filefd>` for reading, following that trusted magic link.
    Never reopen its directory-entry name. Verify the descriptor identity and
    mount. Check identity, size, link count, mtime and ctime before and after
    each bounded read; any change refuses the whole import. Post-read
    `realpath` checks are supplementary only.
  - **Environment**: probe the required flags and `/proc` semantics at start, and
    refuse unsupported environments. Never use a pathname-only fallback.
  - **Semantics**: confinement follows pinned directory capabilities. A pinned
    directory remains usable after being renamed outside the root. H02 permits
    refusal or safe continuation on the pinned original, never redirection to a
    replacement. Continuous pathname ancestry and an atomic directory snapshot
    are not promised. If strict root-relative lookup after ancestor
    relocation is ever required, use a packaged `openat2` helper instead;
    pathname rechecks are not equivalent.
  - Read nothing outside the pinned tree through the package-tree channel.
    Execute nothing.
- **Content**:
  - Decode with `TextDecoder('utf-8', {fatal: true, ignoreBOM: true})`, so a
    leading BOM is preserved as content.
  - Media type comes from the extension allowlist mapped to U2's media types.
  - Any non-text file refuses the whole import unless the person passes an
    explicit `--exclude` that matches it. Exclusions are displayed in the
    review. Core receives only the included files, so the version records only
    what was imported.
  - Every `.git` entry (file or directory) is pruned without being opened.
  - Explicit `--exclude` patterns use anchored POSIX glob semantics and prune
    matching entries before traversal. Confinement claims apply to the
    included tree. No implicit `.gitignore` rules are applied.
  - Display all exclusions, and describe the import as filtered when any
    apply.
  - Root confinement covers package-tree reads. The database, the terminal and
    the explicitly named, bounded `--change` file are separate channels.
  - Paths are relative POSIX, built from directory entries (never from file
    contents), and sorted deterministically.
- **Review and approval**:
  - Reuse the terminal mechanics only, not capture consent or Card method
    allowlists.
  - Before review, freeze the file bytes, parsed change data, actionId,
    revisions and the complete mutation input. Commit exactly that payload
    through the same pinned store handle; never reread files into the
    approved payload.
  - The explicit-user grant covers only the approved method and input, and only
    the mutation namespace.
  - Supplemental read grants cover only independently authorized target,
    read-set and reason namespaces, using core's `actionClass:'read'`,
    `actionId:null` requests. Foreign JSON refs never expand grants.
  - Post-prompt canonical checks and CAS remain mandatory.
  - The command builds the exact `importMethodVersion` input. It shows a bounded,
    escaped review on the controlling `/dev/tty`: the namespace, package and
    `basedOn`, title, every path with its byte count and media type, exclusions,
    change items and reason refs. The display is capped at 512 KiB; larger
    reviews refuse.
  - The person must type the exact displayed phrase. The approval reviews
    metadata (paths, sizes, media types, change items), not every file's prose,
    and it commits the frozen bytes.
  - Unsupported: `--yes`, piped or environment approval, and any non-TTY stdin
    or stdout. These refuse with `approval_required`.
  - The grant binds the exact payload (`payloadBinding`), namespace, action ID
    and expected revisions through the existing local authority path.
  - Any store change that makes a CAS stale refuses; re-run the command. There is
    no automatic retry.
- **No irreversible store effect before approval (v0.4.2).** The primary's
  smoke test showed a mistyped phrase still left a newly created v30 store
  behind. The commands now follow these rules:
  - They never create a store; a missing `--db` refuses.
  - They read `user_version` with a plain read-only open, which creates no
    files.
  - If the store is below v30, the import review shows the one-way upgrade as
    `storeUpgrade: {from, to: 30}`. The core opens, and so migrates, only after
    the exact phrase. Reason availability is then checked before the mutation,
    and a failed check refuses.
  - Adopt and disable refuse a pre-v30 store before opening it, with
    `method_not_found`, because it cannot hold a package.
  - The MCP server's `--method-packages local-v1` keeps §2.1's opt-in
    migration at startup. The documentation states that it is one-way.
- **Output**: the content-free import receipt, plus a JSON line on stdout.

### 11.3 Adoption commands

```sh
cairn-memory methods adopt   --db ... --owner ... [--project ...] --binding-namespace personal|project \
  --package PACKAGE_REF_JSON --role ROLE|'*' --version VERSION_REF_JSON --expected-revision N|null \
  [--reason-ref REF_JSON]...
cairn-memory methods disable --db ... --owner ... [--project ...] --binding-namespace ... \
  --package ... --role ... --expected-revision N|null [--reason-ref ...]...
```

Shell-safe examples quote the role and revision: `--role '*'` and
`--expected-revision null`.

**Reason availability** for the review comes from a new read-authorized
preparation operation (`checkMethodReasonRefs`):
- It accepts a namespace and at most 16 `reasonRefs`, and returns canonical
  availability only.
- It reuses U2's eligibility and exclusion checks.
- It never probes through mutations, copies source prose or infers
  availability from existence alone.
- It is not exposed through MCP.

Same TTY approval as §11.2. The review shows:
- the binding key;
- the current resolution for that role;
- the target version's manifest summary;
- the cross-scope relation, if any (project binding to a personal package);
- reason refs, with availability only.

### 11.4 MCP read tools

Opt-in at server start with `--method-packages local-v1`. Without it, nothing
changes. Namespace and read set are fixed by host flags at startup, never by
tool arguments.

- The default method `readSet` is exactly the startup namespace.
- A project-scoped server may also read the same owner's personal packages
  only with an explicit flag (`--method-read-personal`). Never infer that
  grant.
- Inject namespace, `readSet` and context according to each core method's
  grammar; several methods accept no `intent` or context at all.
- Reject tool-supplied authority, top-level `namespace`/`readSet`/`context`,
  and unknown fields.
- Validate reference namespaces against the host-authorized scopes without
  rewriting immutable identities.
- Version, manifest and file reads require `intent`. Context is derived from
  the host `readSet` plus the tool's `roleId`.
- The method opt-in adds only method read tools. It does not enable Card
  drafting, organization, capture or model work.

| Tool | Core method |
| --- | --- |
| `resolve_method` | `resolveMethod` |
| `resolve_methods_for_role` | `resolveMethodsForRole` |
| `get_method_version` | `getMethodVersion` |
| `list_method_manifest` | `listMethodManifest` |
| `read_method_file` | `readMethodFile` |
| `list_method_packages` | `listMethodPackages` |
| `list_method_versions` | `listMethodVersions` |
| `compare_method_versions` | `compareMethodVersions` |
| `list_method_binding_events` | `listMethodBindingEvents` |

- Each tool passes `intent` and context exactly as in §5. `intent:'current'`
  requires a `roleId`.
- **No MCP mutation tools** exist for methods.
- Tool descriptions state that method text is untrusted data, not instructions
  or permission.
- The serialized core envelope stays ≤65,536 bytes. MCP framing and the
  existing trust marker (server transport bound 262,144 encoded bytes) are
  measured separately, and that transport bound is documented and tested.
- Untrusted-data framing never modifies identities, snapshots or cursors.
- Snapshots returned to agents are opaque. A later `read_method_file` with a pin
  follows §5.

### 11.5 Acceptance (installed, Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| H01 | The installed artifact without the flag is unchanged (tool list, DTOs, defaults), and the method flag adds no Card, capture, organization or model authority |
| H02 | The importer refuses, each before any core call: symlinks, hardlinks and link-count changes; FIFO replacement (without hanging); special files; root escape; **ancestor swaps**; **same-filesystem bind mounts**; path swaps between `stat` and read; growing files; invalid UTF-8; binaries without `--exclude`. Excluded subtrees and `.git` files are pruned unopened. Valid packages import exactly, including a 120-file, ~1.8 MB fixture and the new maximum boundaries (256 files, a 400,000-unit file, a 4,000,000-unit version) |
| H03 | Real-PTY approval: the exact phrase commits. A wrong phrase, EOF, no TTY, piped input, a stale CAS, **payload or change-file replacement after review**, or **terminal-control injection** in displayed text refuses with no partial rows |
| H04 | Adopt and disable through real-PTY approval. Resolution changes as §4 specifies, including a project override of a personal default and a disable barrier. Foreign reasons, denied supplemental reads, concurrent adoption and unavailable targets all refuse |
| H05 | A fresh MCP process in a new session: `resolve_methods_for_role` → `read_method_file` delivers the adopted version. Current reads are distinguished from pinned history: after adopting v2, the old pin reads `newer-version-available` and still does after a restart. Disable, scope revocation and stale snapshots/cursors behave as §5 specifies, with no fallback |
| H06 | Deleting a version through the core host API makes MCP reads `unavailable` with no stale text, including through pins |
| H07 | Packaging manifest, closure and installed-import tests pass on the shallow CI layout; no historical git objects are needed. Every new helper is in the installed closure |
