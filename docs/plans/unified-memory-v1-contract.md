# Unified memory integration V1: P0 contract and first packet (method packages)

Status:
- U2 (§§2–9, v0.3.1) is implemented and accepted.
- U3 (§11, v0.4.5) is implemented and in acceptance; fix round 2 implements the store fence.
- U4 (§12) v0.5.2 is confirmed by the auditor as ready for U4a implementation after U2c.
- U5a (§13) v0.6.2 is confirmed by the auditor as ready for implementation.
- U2c (§14) v0.7.1 is confirmed by the auditor as ready for implementation. It precedes U4a and U5a's wiring.

History:
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

## 11. U3: method packages on the local host (v0.4.5; v0.4.1 audited)

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
- **Store fence (v0.4.3, from the U4 audit).** Checking existence is not a
  fence: the file can be removed or replaced during review, and the ordinary
  opener would then create or upgrade a different store. The commands therefore
  work as follows.
  - **Before review**, they freeze the store's file identity (`dev`, `ino`),
    `application_id`, `user_version` and `store_metadata.store_id`, through a
    plain read-only open that creates nothing. A store without these refuses.
  - **After approval**, they recheck `dev`/`ino`, then open the store through
    the ordinary writable opener in a new **noncreating** mode that receives
    the expected identities.
  - The opener validates those identities inside its own transaction, before
    any migration. A missing, replaced or mismatched store refuses without
    creating, migrating or mutating anything.
  - The opener option is a host seam: default construction is unchanged. U4
    reuses the same fence.
- **Store fence semantics (v0.4.4, from the U4 re-check).** A read-only SQLite
  connection can still create WAL/SHM files, and today's ordinary opener creates
  parent directories and the file before it checks identity
  (`core/database.mjs:299-320`). The rules are therefore:
  - Review supports rollback-journal stores only. Before opening SQLite at all,
    inspect the pinned file header. Refuse WAL-format stores, existing
    rollback-journal files and any other auxiliary or recovery condition.
    Never use an immutable open on a live store. Supported participants must
    keep rollback-journal mode throughout review; changing the journal mode
    meanwhile is unsupported. This v0.4.4 refusal promise supersedes the older
    absolute "mutating anything" wording above.
  - Read the SQLite identity tuple in one consistent read transaction.
  - After approval, the ordinary opener's new noncreating mode skips `mkdir`
    and `open(ax)`. It opens without creation. **Noncreating behaviour is mandatory on
    both supported runtimes (v0.4.5).** Probe SQLite `mode=rw` support and
    verify that a store's disappearance cannot recreate it. If `mode=rw`, or an
    equally strong noncreating mechanism, is unavailable, the command refuses.
    Reporting a residual race never authorizes a fallback that can create a
    file. Inside its transaction, before
    initialization or migration, it checks the expected filesystem and SQLite
    identities.
  - The managed existing-store opener remains validation-only. Neither today's
    ordinary branch nor the managed branch is sufficient by itself.
  - Promise: SQLite crash recovery may occur after approval. A refusal
    guarantees **no application data or schema writes**. It does not promise
    the absence of every filesystem effect.
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

## 12. U4: assets, derivatives and binary method attachments (v0.5.2, audited and confirmed)

Revised by `u4_contract_author` after the `umv1_contract_audit` audit of v0.5 (`d148a34`).
Independently checked by the primary: both known-answer vectors in §12.2 reproduce exactly.

This applies every finding from the independent U4 audit. **U2c precedes U4a**: it replaces method read write-locks with short consistent deferred read transactions and requested-file/manifest-metadata verification. U4a reuses that helper.

U4a delivers v31, migration/openers, assets, derivatives, attachment core, usage, deletion, replay and effects. U4b delivers CLI, MCP and installed tests after U4a acceptance. Hosted storage, media understanding, ASR/OCR, physical erasure and U5 retrieval are excluded.

### 12.1 Capability and migration

- Opt-in: `assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}`. Reuse §2.3's synchronous grants with asset-specific allowlists. Mutations are `explicit-user`; reads are `read`. Capture consent/hooks never import or derive.

| v31 operation | Required capability/authority |
| --- | --- |
| Method metadata, resolution, text reads, deletion | Method only |
| Method binary import/delivery | Both configured ports; separate grants binding operation, scopes and payload commitment |
| Standalone assets/derivatives | Assets |

- Missing binary capability never hides entries or causes fallback. Deletion validates reference/lifecycle/CAS without requiring readable or uncorrupted payloads.
- Only ordinary writable opening with assets selected migrates fresh/supported populated v18, v20–v30 stores atomically to v31; v19 refuses. Unselected stores retain their version. Extend schema-only migration (`core/method-package-migration.mjs:15`) without enabling prerequisite features.
- Read-only/managed openers validate only. Every v31 opener validates complete v30/v31 definitions, including purge triggers regardless of selected capabilities. Premature asset artifacts in pre-v31 stores refuse without repair.
- Update every version gate: `core/database.mjs:291`, `core/existing-store.mjs:11`, `core/existing-store.mjs:85`, `core/read-database.mjs:27`, `adapters/local/configuration.mjs:79`, `integrations/client/raw/local-setup.mjs:61`, `integrations/client/raw/local-host-permission.mjs:26`, and method-only constructor paths. Freeze the actual pre-change v30 opener/installed closure; no git-history reconstruction.
- Capabilities disclose implemented methods, refs, media, limits, storage/accounting and `parser:'unavailable'`, without authority or private counts. Defaults/old DTOs remain unchanged.

### 12.2 Identity, ownership and limits

- Core mints random IDs. Assets have exactly one namespace; attachments belong exclusively to one method version, never a standalone asset. No sharing/deduplication across owners, namespaces, packages, assets or versions; charge every copy.

| Ref | Shape |
| --- | --- |
| AssetRef | `{type:'asset',namespace,assetId}` |
| AssetVersionRef | `{type:'asset-version',namespace,assetId,versionId,contentIdentity}` |
| AssetDerivativeRef | `{type:'asset-derivative',namespace,assetId,versionId,derivativeId}` |

- Asset lifecycle/CAS follows §3; imports/version deletions advance asset revision. Deletion is terminal. Titles ≤200 units; single-component filenames ≤512.
- New HMACs use SHA-256, existing UTF-8 cursor-secret key (`core/method-package-storage.mjs:17`), unpadded base64url, and `E([domain,storeId,...fields])`.
- Canonical `E`: one-byte tags 0=null, 1=false, 2=true, 3=finite number, 4=string, 5=bytes, 6=array, 7=object. Number/string/bytes carry unsigned 64-bit big-endian byte length then payload: JSON number spelling, exact unnormalized UTF-8, or selected view bytes. Arrays/objects carry 64-bit element/property counts; arrays preserve order; object properties sort by UTF-8 key bytes and encode key/value pairs. Undefined/accessors/proxies refuse. Domain namespace fields use `[ownerId,scope,projectId]`. Before encoding or authority commitment, reject ill-formed Unicode in every string and property key. Objects have only own string data properties: reject symbol keys and unsupported prototypes. Arrays must be dense with no extra properties. JSON number spelling is ECMAScript `JSON.stringify`, which canonicalizes negative zero to zero. Freeze rejection and ordering vectors.
- Domains/ordered fields: `binary-content-v1:[namespace,mediaType,bytes]`; `binary-chunk-v1:[namespace,objectId,contentIdentity,mediaType,totalByteCount,index,chunkByteCount,bytes]`; `method-mixed-manifest-v1:[namespace,orderedEntries]`; `binary-action-v1:[method,completePreRedactionInput]`; `asset-derivative-v1:[source,derivativeId,kind,text,provenance,language,timecodes]` (absent optionals become null).
- Tagged entries are exactly `{kind:'text',path,text,mediaType}` or `{kind:'binary',path,bytes,mediaType}`; mixed manifest tuples are `[kind,path,mediaType,byteCount,contentIdentity]`. `mixed-v1` requires a binary entry. Text-only imports retain legacy wire, manifest and action bindings byte-for-byte (`core/method-package-storage.mjs:37`). Mixed comparison uses kind/media/content identity.
- Known answers: `E(bytes[1,2])=0500000000000000020102`. With secret ASCII `0` repeated 64 times, storeId `00000000-0000-0000-0000-000000000000`, namespace `["owner","personal",null]`, media `application/pdf` and ASCII bytes `%PDF-1.7`, binary-content identity is `qvUt2CJYzxoVvrN-yax7kWA8AqUJwyOr6JyTVXWWd4o`.
- Freeze known-answer encoding/HMAC vectors for every domain, metadata ordering, Unicode and offset views; action encoding includes every byte exactly once. No public digest; cross-namespace equal bytes never compare equal.

**Unmeasured defaults**; U4a gates apply below; U4b additionally measures as §11.1.

| Limit | Value |
| --- | --- |
| Asset version / attachment | 33,554,432 bytes each |
| Versions/asset; assets/namespace; derivatives/version | 64; 1,024; 32, including tombstones |
| Derivative text | 20,000 UTF-16 units before/after redaction |
| Method version | 256 total entries; 67,108,864 binary bytes; §11.1 text limits |
| Owner binary / method-text quota | Separate 200,000,000 / unchanged 50,000,000 bytes |
| Raw chunk / serialized success envelope | 32,768 / 65,536 bytes |

- Binary usage counts retained asset/attachment bytes and redacted derivative UTF-8 bytes owner-wide. Exclude metadata, ledger/effects, SQLite overhead, WAL/backups. Deliver namespace totals; owner aggregates need separate authority.
- Extension/declaration/signature must agree; inspect ≤4,096 prefix bytes. Signatures start at offset 0 unless specified; require the complete bounded ftyp box with big-endian size. Publish rules/fixtures below; report `signature-matched`, never validated/decoded. No parsing, rendering or inferred descriptions; labels are untrusted.

| Extensions → media | Signature rule |
| --- | --- |
| png → image/png | Hex 89504e470d0a1a0a |
| jpg/jpeg → image/jpeg | Hex ffd8ff |
| gif → image/gif | GIF87a/GIF89a |
| webp → image/webp; wav → audio/wav | RIFF at 0; respectively WEBP/WAVE at 8 |
| pdf → application/pdf | %PDF-1.0…1.7 or %PDF-2.0 at 0 |
| mp3 → audio/mpeg | ID3 major 2–4, or MPEG header: 11 sync bits, nonreserved version, Layer III, bitrate index 1–14, sample-rate index 0–2 |
| mp4 → video/mp4 | Leading ftyp box, size 16+4n ≤4,096; major brand isom/iso2…iso6/mp41/mp42/avc1; major or compatible brand mp41/mp42/avc1 |
| ttf → font/ttf; otf → font/otf | Hex 00010000 / OTTO |
| woff → font/woff; woff2 → font/woff2 | wOFF / wOF2 |

### 12.3 Canonical v31 schema

Preserve v30 definitions/rows. Add 11 STRICT tables; ns has §2 namespace CHECKs; revisions/generations positive, counts nonnegative.

| Table | Keys/constraints |
| --- | --- |
| `assets` | id PK; ns, available/deleted state, revision, next ordinal, timestamps |
| `asset_versions` | id PK; asset FK; unique asset/ordinal, id/content-identity; lifecycle, title, filename, media, count, timestamp |
| `asset_derivatives` | id PK; exact version/content-identity FK; lifecycle, allowed kind, text/identity, provenance/language/timecodes, count, timestamp; JSON CHECKs |
| `binary_objects` | id PK; ns/media/identity; count CHECK 1–33,554,432; XOR unique asset-version FK or method-version/position owner |
| `binary_chunks` | PK object/index; cascading object FK; chunk MAC; BLOB length 1–32,768; index ≥0; nonfinal chunks exactly 32,768 |
| `method_manifest_formats` | version PK/FK; mixed-v1 CHECK; absence means text-v30 |
| `method_mixed_entries` | PK version/position; unique version/folded-path; text/binary CHECK; metadata; exclusive binary object FK; exact text-row match |
| `binary_owner_usage` | owner PK; count CHECK 0–200,000,000 |
| `asset_operations` | PK ns/actionId; method, payload binding, target, content-free result, timestamp |
| `asset_effects` | effectId PK; ns/kind/entity/revision/actionId; unique positive ordinal |
| `asset_epochs` | ns PK; generation |

- Composite keys/triggers match owner namespace, version, position, identity, media and count. Each available asset version has exactly one object; every binary entry references its own object, never a standalone asset. Text entries match exact `method_files` rows. Validate contiguous unified positions/complete chunks before commit; index reverse dependencies; test invalid ownership DML.
- Versions/derivatives have revision 1, then 2 on deletion. State CHECK available/deleted; available content required; deleted descriptive/payload fields NULL and retained count zero.
- Imports and derivative creation reserve each quota once. Object DELETE triggers alone release object bytes; derivative available→deleted triggers alone release derivative bytes. Parent cascades tombstone descendants, purge content and advance epochs without subtracting again.
- Terminal tombstones reject resurrection/late children. Feature-off purge needs no callback, UDF or asset facade. Replay changes no counters/effects. Validate exact CHECKs/indexes/FKs/trigger bodies (`core/method-package-schema.mjs:116`).

### 12.4 Transactions, replay and deletion

- Versioned internal `sqlite-blob-v1` stores chunks, metadata, both quota reservations, ledger/effects in one `BEGIN IMMEDIATE` (`core/database.mjs:261`); no committed staging/filesystem objects.
- Before callbacks and mutation locks, copy bounded `Uint8Array` views privately and prepare all signatures/HMACs. Reject shared/detached backing stores; preserve offsets; freeze wrappers, never nonempty typed arrays or expose backing storage.
- Byte leaves use raw-byte budgets above, not per-byte JSON nodes/string units; metadata keeps U3 snapshot budgets (`core/method-package-input.mjs:37`). Never stringify/base64 entire imports.
- Streaming action HMAC binds complete pre-redaction input. Authorized replay precedes mutable existence checks (`core/private-operation-helpers.mjs:9`); changed payload is `action_conflict`. Replay after purge returns original receipt without insertion. Kill before commit leaves no import rows.
- Import receipt `{asset,version,ordinal,assetRevision}` emits `asset_version_imported`; derive `{derivative,source,revision}` emits `asset_derivative_created`; deletion uses §7 receipt and one target `asset_deleted|asset_version_deleted|asset_derivative_deleted` effect. No descendant effects; methods retain U2 receipts/effects, without asset refs. Reads emit none.
- Purge descriptive metadata/bytes/derivatives; retain only opaque refs/identities, lifecycle, revisions, timestamps, ordinals/counts. Canonical non-resurrection and exact usage release survive restart/replay/rebuild. No physical freelist/WAL/journal/backup erasure or `secure_delete` change (`docs/local-store.md:196`).

### 12.5 Derivatives and reads

- Immutable standalone-version derivatives only; kinds `caption|transcript|description|alt-text`. Versioned provenance includes exact source and `method:{kind:'user-provided'}`.
- Optional BCP 47 language ≤35 units; ≤256 ordered safe-integer `{startMs,endMs}` intervals, 0≤start≤end, audio/video only, marked `alignment:'user-supplied-unverified'`. These describe supplied intervals, not text-span alignment.
- Validate Unicode/NUL; redact without reformatting. New versions inherit nothing. Report source ordinal and greatest imported ordinal; historical means source ordinal is lower, never semantic currentness. Deletion purges; revocation blocks delivery.
- U5 sidecars key exact derivative/source identities and canonically revalidate without schema changes. U4 provides reads; M5 searchable retrieval requires a later U5 derivative candidate packet.

Calls take `(input,authority)`; A=actionId, P=limit/cursor; lists default/cap 20, byte-paginated.

| Method | Class; input → value |
| --- | --- |
| `getAssetCapabilities` | public; none → capabilities |
| `importAssetVersion` | explicit-user; namespace,A,title,filename,mediaType,bytes,asset?,expectedAssetRevision? → receipt |
| `createAssetDerivative` | explicit-user; A,version,expectedVersionRevision,kind,text,method,language?,timecodes? → receipt |
| `deleteAsset` / `deleteAssetVersion` / `deleteAssetDerivative` | explicit-user; A,ref,expectedRevision → receipt |
| `listAssets` / `listAssetVersions` / `getAssetVersion` | read; namespace,P / asset,P / version → metadata |
| `listAssetDerivatives` / `readAssetDerivative` | read; version,P / ref,cursor? → provenance/metadata or ≤4,000-unit parts |
| `readAssetBytes` / `verifyAssetBytes` | read; version,cursor? / version,bytes → chunk / matches,candidateLength,canonicalContentIdentity |
| `getAssetUsage` / `listAssetEffects` | read; namespace / namespace,P → projection/effects |
| `readMethodAttachmentBytes` | read; version,path,intent,context?,snapshot?,cursor? → chunk/adoptionStatus |

- Reuse U2c's short consistent deferred `BEGIN` per page, never `BEGIN IMMEDIATE`. Verify selected chunk MAC and immutable manifest metadata only; no whole-object/version hashing per page. Each page verifies the `binary-chunk-v1` MAC against canonical metadata, validates the expected chunk length and index from the authenticated `totalByteCount`, and derives completion only from that total. Tests cover reduced and increased totals, premature completion, missing final chunks and metadata substitution.
- Authorize exact target and authenticate cursor bindings before lookup. Cursor binds store, exact version/content identity, index, access generation and parent/version lifecycle revisions; contains no supplied bytes/echoed pins. Malformed/substituted cursors give `invalid_cursor`; valid deleted-target cursors give `unavailable` before epoch staleness.
- Revalidate authority/lifecycle each page; one base64 chunk ≤32,768 raw bytes; final page gives completion/total count. Verification needs byte-delivery permission and a live exact version; return only canonical target identity, never candidate-derived HMAC.
- Reuse §5 pins/statuses (`core/method-binding-storage.mjs:99`): adoption switch stales current, never mixes versions; history remains exact, disable marks withdrawn, deletion/revocation blocks pins. Binary `readMethodFile` gives `unsupported_media`.
- Reuse §7 errors; add `asset_not_found` (foreign/missing identical), `asset_version_unavailable`, `asset_limit_reached`. Oversize/malformed gives `invalid_input`, media mismatch `unsupported_media`; only `storage_busy` retries, never unlimited retries.

### 12.6 U4b host

Inherit §11 database/scope flags:

```sh
cairn-memory assets import --file ABS --title T [--asset ID --expected-asset-revision N]
cairn-memory assets derive --version REF_JSON --kind K --text-file ABS [--language L] [--timecodes ABS]
cairn-memory assets delete --ref REF_JSON --expected-revision N
cairn-memory assets export --version REF_JSON --out ABS
```

- Mutations reuse §11.2 descriptor confinement, bounded escaped review, frozen payload, real-TTY phrase/CAS. Derive obtains source revision and supplies user-provided provenance.
- Reuse §11.2 **Store fence (v0.4.3) and its semantics (v0.4.4)** exactly, including the rollback-journal-only review and the no-application-write refusal promise: noncreating read-only opening freezes `dev`/`ino`, `application_id`, `user_version`, `store_id`; display `storeUpgrade:{from,to:31}`. After mutation approval recheck `dev`/`ino`; a noncreating ordinary writable opener validates expected identities inside its transaction before migration. Missing/replaced/mismatched stores refuse without recreation/mutation. Commands never create stores; derive/delete/export refuse pre-v31 with `asset_not_found`. Managed openers remain validation-only.
- Read-authorized, pure-Node create-only export: pin operator-owned, non-group/other-writable destination parent; validate final basename; exclusively create random 0600 temporary file with no-follow. Prevent untrusted source-name replacement until publication.
- Write pages; verify readback count/identity through `verifyAssetBytes`; fsync completed file before link. Both link arguments use pinned directory prefixes; never use `/proc/self/fd/<filefd>` directly as source. Existing paths/symlinks fail EEXIST.
- Successful link is publication. Reopen O_RDONLY|O_DIRECTORY on pinned parent for fsync; O_PATH is insufficient. Fsync publication, unlink temporary name, fsync cleanup. Never remove/overwrite final as rollback; subsequent cleanup/fsync failure reports `published-but-durability-uncertain`. Recovery may find complete final, private partial, both/neither, never partial final. Cleanup identifies owned leftovers, never matching names blindly.
- `methods import --attachments local-v1` reviews exclusive binaries and enables .svg→text/plain. Flag-off U3 rules remain unchanged.
- MCP `--assets local-v1` adds only `list_assets,list_asset_versions,get_asset_version,list_asset_derivatives,read_asset_derivative`; method manifests show attachment metadata. Fixed scopes/strict grammars follow §11.4; never bytes/mutations. Transport ≤262,144 bytes (`adapters/mcp/method-package-transport.mjs:3`).

### 12.7 Acceptance (real processes, Node 22.16 and 24.15)

Record actual exit codes, finite deadlines and independently verified output bytes.

| ID | Observable |
| --- | --- |
| K01 | Populated migrations/openers/method-only/default compatibility; rollback; altered CHECKs/triggers refuse |
| K02 | Actual frozen v30 binary/installed closure rejects v31 unchanged, without history; premature asset artifacts refuse |
| K03 | Every allowlisted media round-trips exact bytes after restart; mismatch/brand/signature, incomplete chunks and corruption refuse |
| K04 | Bounds/one-over, ownership violations, known-answer vectors, namespace separation, legacy identities/replay, retained-copy accounting; offset/shared/detached views and callback mutation |
| K05 | Kill before commit leaves no partial rows/reservations/receipt/effects |
| K06 | Separate-process CAS race; quota contenders individually fit but jointly exceed quota: one winner; deletion-release/late-child races, no leaks/double release |
| K07 | Cursor authentication/deletion/epoch precedence, substitution, exact scopes and binary-permission revocation |
| K08 | Redaction/formatting, non-inheritance, historical provenance and unverified supplied intervals |
| K09 | All purges, including corrupted attachments with assets disabled; exact usage/effects; no replay/restart/stale-rebuild resurrection |
| K10 | Adoption mid-read, text/attachment consistency, history/disable/pin fences and binary revocation |
| K11 | Feature-off corrupted-attachment deletion; conversation-deletion/invalidation regressions |
| K12 | Worst-case envelopes; parser unavailable with metadata readable; no execution/network/model calls |
| K13 | Every U4a measurement gate below passes with actual numbers |
| L01 | Installed defaults/capability/tool matrix unchanged without flags |
| L02 | H02/H03 confinement/PTY attacks across input channels; store disappearance/replacement/schema change during review refuses |
| L03 | Fresh MCP returns historical provenance/attachment metadata, never bytes |
| L04 | Export exact bytes; existing files/symlinks, parent swaps, source replacement/stale cleanup; failure/termination around link, unlink and every fsync; complete-final versus private-partial recovery and uncertain-publication reporting |
| L05 | Installed complete-read/transport measurements; preserve U4a gates |
| L06 | Independently cross-check installed manifest/archive/closure, helpers/docs/config; print counts/differences; shallow CI without historical git objects |

**U4a measurement gates:** AMD Ryzen 9 9950X, WSL2, both runtimes; acceptance thresholds, not product guarantees. Report actual numbers, run counts, deadlines and RSS baseline including byte preparation; any failure fails U4a. Workloads:
- Measure both 32-MiB standalone imports and 64-MiB mixed attachment imports.
- Record caller allocation, the pre-core-call RSS baseline, the preparation peak and the absolute process peak. The 128-MiB growth gate applies from that baseline.
- Contention uses the maximum reader and the existing small independent binding writer, with at least 100 committed transitions.
- Use finite deadlines. Any busy outcome fails the gate, even if it was retried. Assert the thresholds and both processes' exit codes.

| Measurement | Gate |
| --- | --- |
| One 33,554,432-byte import | Write transaction ≤2,000 ms; all copy/signature/HMAC preparation before lock |
| Continuous maximum-size byte reader plus concurrent writer | Zero busy timeouts on either side; writer p95 ≤250 ms |
| Maximum-import peak RSS growth | ≤134,217,728 bytes |

## 13. U5a: M6 candidate retrieval (v0.6.2, audited and confirmed)

Revised by `u5_contract_author` after the `u5_contract_audit` audit of v0.6 (`2669a3c`). The
primary resolved the author's covering-index objection (§13.4).

Applies all four P1 and three P2 findings from `u5_contract_audit` and the primary’s incremental-reconciliation, hosted-configuration and read-only decisions. This remains a contract draft.

U5a adds a separate opt-in path. Without opt-in, DTOs, defaults, ordering, prompts, tools, capabilities, errors and provider-call counts remain byte-identical, including `selectEvidence`, recall, session context and MOC reads. `HR-1/` denotes the research checkout.

### 13.1 Facade, authority and transactions

- Writable construction: `openMemoryCore({path,contextRead:{version:'context-read-v1',authority,embedder?,policy?}})`. `policy` is trusted constructor configuration, never method/tool input; supplying an embedder fixes its family/preset before use.
- Read-only construction: `openContextReader({path,contextRead})`, with the same configuration and read methods. Refresh refuses `invalid_input`. Canonical and sidecar connections are read-only; neither this constructor nor managed-existing context operations invokes ordinary opening, recovery or sidecar maintenance. Existing `openMemoryReader` stays unchanged (`core/topic-overview-input.mjs:17`).
- Refuse hot rollback journals and unsupported auxiliary-file conditions, including WAL/SHM requiring creation or recovery. Never use an immutable-open shortcut on a live store. Missing/mismatched sidecars and hot/unsupported journal conditions report `index_unavailable`; no repair or transient file creation. Reuse path/schema identity checks (`core/read-database.mjs:18`; `core/existing-store.mjs:82`); canonical path/schema failures retain existing opener codes. This hot-journal and auxiliary-file refusal, without recovery, applies to read-only and managed-existing context connections. Authorized ordinary writable maintenance may perform SQLite rollback-journal recovery on the protected sidecar. It then validates store, format and fences, and resumes from the last committed checkpoint. Recovery never publishes incomplete work.
- All canonical reads and sidecar reads use §14’s shared deferred `BEGIN` helper: `query_only` throughout, restored on every exit, existing busy timeout, no `BEGIN IMMEDIATE`. Sidecar maintenance writes use separate bounded transactions. No host callback or await occurs inside a transaction.
- Authority follows §2.3: synchronous `{authorize,isCurrent}`, method-specific allowlists, `actionClass:'read'`, `actionId:null`, payload binding and access generations (`core/private-card-facade.mjs:7`; `core/method-package-facade.mjs:20`). Capture consent grants nothing.
- Authorize every namespace before index access, statistics, vectors, scoring, top-k or transmission. Read sets contain one namespace or personal plus one project of the same owner; no implicit fallback. Recheck grants and canonical/index fences after every await and before dispatch, publication and delivery; discard revoked/stale results and late completions. Transport guards recheck after budget reservation.

Data methods take `(input,token)` and return envelopes; lookup/refresh are asynchronous. Unknown fields refuse.

| Method | Input | Success value |
| --- | --- | --- |
| `getContextReadCapabilities()` | None; no authority | Version, methods/types/intents, channel/embedder configuration, preset, limits, maintenance availability and unsupported features; no private counts |
| `findCandidates` | `readSet,query,types,intent,semantic?,limit?,deadlineMs?,cursor?` | `{version,items,channels,coverage,trace,nextCursor}` |
| `refreshContextIndex` | `readSet,types,intent,budget:{maxItems,maxMs}` | `{status,progress,coverage,channels}` |
| `fetchCandidateEvidence` | `readSet`, either `{refs,intent}` or `{snapshot}`, `responseByteLimit?` | `{items,snapshot}`; canonical fetch/refetch |

- `types` is a nonempty Memory/Card subset; intent is explicit `current|history`. Unsupported types refuse `invalid_input`. Memory-only schemas never query absent Card tables, including `card_epochs` (`core/private-evidence-storage.mjs:20`). No implicit schema installation.
- `semantic` defaults to false. True requires an explicitly configured embedder, fixed preset and request/spend budget; otherwise `invalid_input` with channel diagnostics.
- Assembly, role profiles, relations and MOC retrieval remain unsupported; `contextRead()` is reserved for U5b.

### 13.2 Limits and continuation

| Limit | Value |
| --- | --- |
| Items / ranked horizon | Default 12; maximum 24 |
| Query | Nonblank, valid Unicode, ≤4,000 UTF-16 units; no NUL |
| Query deadline | Default 1,000 ms; maximum 5,000 ms, including reconciliation/embedding |
| Complete envelope | ≤65,536 UTF-8 bytes, including trace, snapshot and cursor |
| Cursor / snapshot | ≤8,192 / 16,384 characters |
| Refresh budget | Required; 1–1,024 items, 1–5,000 ms |
| Synchronous batch | ≤128 rows and ≤2,000,000 text units; deadline checks between batches |
| Exact cosine | ≤20,000 authorized vectors/query; per-handle float32 cache ≤134,217,728 bytes |
| Embedder metadata | ID/revision 1–200 units; dimensions positive integral, ≤32,768, validated before allocation |

- Deadlines are cooperative, without preemption guarantees. Refresh `maxItems` caps document transformation/embedding attempts, including refusals; projection comparisons consume deadline/batch budgets and are counted separately.
- Freeze the first ranking; pages partition its top 24. HMAC cursors bind store, query, types/intent, read set, access/canonical/index generations, preset, ranking identity, horizon and position. Also bind normalized `semantic`, effective channel mode, embedder ID/revision/dimensions/normalization and representation version.
- Changed request semantics give `invalid_cursor`; changed effective configuration gives `cursor_stale` and invalidates rankings. Continuation performs no embedding/reranking. Retain ≤128 rankings/handle; five-minute expiry starts at initial creation and paging never renews it. Expiry, eviction or restart gives `cursor_stale`. Indivisible oversized items refuse.

### 13.3 Channels and fusion

- Lexical is always on. Port frozen T1 into product code: NFKC, lowercase, fixed stopwords/Unicode boundaries; overlapping Han bigrams, isolated single-Han tokens, no stemming (`HR-1/evaluation/retrieval-research/lib/tokenize.mjs:86`).
- **Known miss:** `中` misses `中文`; legacy substring search can match it. Assert/document this intentional exception separately. HR-1b measures a one-character Han-unigram fallback on the frozen fixture before any tokenizer change.
- `candidate-text-v1` indexes Memory content and Card `title + '\n' + body`. No receipts, Raw, methods, derivatives or MOC text; U4 derivatives await another U5 packet.
- BM25: `k1=1.2`, `b=0.75`, distinct query terms, `idf=ln(1+(N-df+0.5)/(df+0.5))`; matching documents only (`HR-1/evaluation/retrieval-research/lib/bm25.mjs:32`). Statistics cover exactly the authorized eligible type/intent projection.
- Exact cosine and frozen RRF follow HR-1 protocol §5.3 (`HR-1/docs/plans/hybrid-retrieval-hr1.md:255`):

| Preset/family | k | Depth/channel | Lexical/semantic weights |
| --- | --- | --- | --- |
| `rrf-k60-d12`, local | 60 | 12 | 0.45 / 0.45 |
| `rrf-k10`, hosted | 10 | 24 | 0.5 / 0.5 |

- `score=Σ weight/(k+rank)`; ranks start at 1, missing membership contributes zero. Union maxima 24/48; final horizon ≤24. Ties use binary canonical `(owner,scope,project,type,id)` ordering. No arbitrary weights.
- Disabled/absent/degraded semantic means lexical-only BM25; never fuse incomplete semantic coverage. Determine coverage and scan/cache capacity before paid dispatch, accounting for dimensions and resident capacity. Known gaps or exceeded bounds produce `partial_coverage` and **zero query embedding calls**. Embedded and scanned coverage are distinct. Partial semantic diagnostics would require a separate explicit operation, unsupported here. Capacity eligibility is computed over the requested authorized projection alone, against the fixed vector and byte bounds. Unrelated cache entries are evicted as needed. Their residency never changes coverage, channel availability or ranking. The required compatible vectors are validated before paid dispatch.

### 13.4 Sidecar and maintenance

- `<absolute-store-path>.context-read-v1.sqlite`, format 1, independently versioned. Regular non-symlink file, same protection as store (POSIX 0600); temporary/journal files equally protected (`core/database.mjs:299`). `:memory:` reports unavailable. Rollback-journal mode; read-only consumers never recover.
- No canonical DDL, tables, triggers or writer callbacks. Bind generations to store, namespace, intent/types, tokenizer/representation and canonical epochs.

| Table | Invariant |
| --- | --- |
| `generations` | Store/format/fences, persisted scan/delta progress, incomplete/published state |
| `documents` | Typed identity, exact revision/bodyRevision, eligibility, representation, token length |
| `postings` | Generation/document/term frequencies; positive frequencies, consistent published-generation joins |
| `statistics` | Complete eligible-projection N, total length and df, consistent with documents/postings |
| `vectors` | Store/namespace/type/ID/revision/bodyRevision/representation/embedder ID+revision/dimensions/normalization key; validated float32 |

- Reconcile epochs on every read (`core/private-evidence-storage.mjs:20`); existing membership rebuilding is not lexical reconciliation (`core/index-storage.mjs:61`). Mutations invalidate logically at canonical commit, including feature-off writers/restarts.
- On an epoch change, compare canonical `(type,id,revision,bodyRevision,eligibility)` against `documents` through a **metadata projection scan**: indexed lookups of those columns, plus Card support checks where eligibility requires them. Text columns of unchanged rows are never read or tokenized. **Primary decision:** U5a adds no canonical index. Existing indexes do not cover revision or eligibility (`core/index-schema.mjs:15`, `core/private-card-schema.mjs:24`). If the 10⁵ measurements show the scan is too slow, a covering index needs its own schema decision. The no-text-read guarantee covers unchanged candidate Memory content and Card title/body. Card eligibility must match the canonical current/history predicate (`core/private-evidence-storage.mjs:54`). Support verification may read the source payloads it requires, and those bytes and lookups count against maintenance work and measurements. Use projected Card rows rather than detail reads. Detect insertions, removals and eligibility transitions. Retokenize only changed eligible rows, remove invalid postings/vectors and adjust N, lengths and df incrementally; unchanged texts are not read/tokenized.
- Persist bounded scan/delta progress and resume across calls/restarts while canonical/access fences match. Changed fences reject affected staged work. Publish a new complete generation only after reconciliation and full-projection statistics finish against unchanged fences. An unrelated epoch change with no document delta advances fences without retokenizing. Each sidecar transaction atomically commits its document, postings, statistics and vector changes together with the matching checkpoint. Resume binds the base generation, projection, canonical/access fences and scan phase. An interrupted batch is either wholly replayable or wholly committed.
- **Incomplete generations are never searchable.** Until publication return `index_unavailable`, `buildState:'rebuilding'`; unverified counts are null. Partial lexical search coverage describes only a matching published generation.
- Full rebuilds occur only for missing, corrupt, wrong-store or incompatible sidecars. Report reason plus `rebuilding|rebuilt`; late embeddings cannot publish changed revisions. Sidecar deletion never reconstructs vectors implicitly.
- Writable ordinary `findCandidates` performs automatic bounded lexical maintenance within its deadline, without model/money. Only explicit host refresh produces document vectors; MCP/capture never trigger it. Read-only/managed-existing context refresh refuses `invalid_input`.
- A dirty 10⁵-Memory projection requires O(Ncanonical+Nsidecar) comparisons: 100,000 canonical tuples plus the corresponding sidecar scan, even after one mutation; Card support checks add cost. This is not O(changes). Measure scan rows, bytes, lookups and time; no 10⁵ latency promise.

### 13.5 Embedding and host configuration

- Port: `{id,revision,dimensions,normalization,embed(texts,{signal})}`, one ordered vector/input. Normalization `none|l2`, norm tolerance 1e-5. Convert to persisted float32 **before** validating dimensions, finite components, finite positive norm and normalization; repeat validation on load. Invalid vectors never publish/score; preserve lexical with semantic degradation.
- No embedder by default. Lookup embeds only its query, after preflight; refresh alone embeds canonical documents. Never embed during capture or inside canonical/sidecar transactions. Report oversized inputs without silent truncation.
- Ship deterministic fake and OpenAI adapter; adapter default `text-embedding-3-small`, 1,536 dimensions; configurable model/dimensions. Configuration changes invalidate vectors and rankings; `provider-unversioned` is an honest hosted revision stamp.
- Embedding reads existing `OPENAI_API_KEY` only with explicit `--context-embedder openai`; a key alone never constructs an embedder. Existing non-context model behavior remains unchanged.
- Require explicit per-process request/spend caps. Reserve before dispatch; retain concurrency until actual settlement and conservative charges for unknown usage; each retry reserves separately (`adapters/local/guarded-model.mjs:35`). Accounting is not HTTP authority (`evaluation/experiment-budget/index.mjs:1018`). Bound transport bytes; honor cancellation/deadlines.

**MCP startup grammar:**

```text
--context-read context-read-v1 [--context-read-personal]
  [--context-embedder openai --context-embed-model MODEL
   --context-embed-dimensions N --context-embed-max-requests N
   --context-embed-max-usd X]
```

**Explicit hosted refresh grammar:**

```text
cairn-memory context refresh --db ABS --owner ID [--project ID]
  --types memory,card --intent current|history --max-items N --max-ms T
  --context-embedder openai --context-embed-model MODEL
  --context-embed-dimensions N --context-embed-max-requests N
  --context-embed-max-usd X
```

- Require the entire provider group together; request caps are positive integers, USD cap positive finite, dimensions obey advertised bounds. CLI requires explicit model/dimensions despite adapter defaults. Types select a nonempty supported subset; no inferred intent. `--context-read-personal` consumes zero values, and every provider option consumes exactly one. Parsing is extended without changing legacy argument behaviour. `--check-config` performs no database opening, key lookup or provider construction.
- MCP fixes provider/configuration/preset at startup; hosted is `rrf-k10`. Tools cannot override them. `--context-read-personal` requires project scope plus context-read opt-in.

### 13.6 Delivery and diagnostics

- Items: `{ref,rank,fusionScore,channels:{lexical,semantic}}`; channel entries `{rank,rawScore}|null`; fusionScore null for lexical-only. Exact revisions/Card bodyRevision; no bodies/titles/excerpts.
- Reuse canonical current/history eligibility (`core/private-evidence-storage.mjs:54`). `fetchCandidateEvidence` wraps existing exact-namespace/private-Card-gated readers across the authorized read set using §14’s transaction helper. HMAC snapshots bind store/read set, refs, intent, access/canonical generations and item fences (`core/private-evidence-storage.mjs:91`). Refetch canonically immediately before delivery; no external callback/await follows final reading (`core/recall.mjs:195`).
- Channels distinguish `ready`, `unavailable`, `disabled`, `absent`, `timeout`, `provider_error`, `rate_limited`, `budget_denied`, `stale_index`, `dimension_mismatch`, `partial_coverage`; retain multiple causes. Unusable lexical generation gives `index_unavailable`.
- Coverage: authorized eligible/indexed/embedded/scanned counts by type, embedded/scanned fractions, freshness, maintenance state/progress, depths, omitted counts/null, deadline/budget stops. Trace: requested/effective modes/preset, tokenizer/representation/embedder metadata and channel timings. No text, vectors, credentials, paths or foreign aggregates.
- Reuse `invalid_input`, `invalid_read_set`, `authority_required`, `scope_changed`, `invalid_cursor`, `cursor_stale`, `revision_conflict`, `evidence_unavailable`, `invalid_snapshot`, `snapshot_stale`, `context_item_too_large`, `index_unavailable`, `storage_busy`, `storage_error`, `store_closed`, plus existing opener refusals. Only `storage_busy` retryable. New errors may include sanitized `details:{channels,coverage,trace}`. Total failure never means no matches; complete-empty requires fresh exhausted lexical search.
- MCP exposes `find_memory_candidates` and `fetch_memory_candidate_evidence`, no refresh tool. Follow §11.4 host-fixed namespace/read set; reject supplied authority/namespace/readSet/context/configuration and unknown fields, validate ref namespaces without rewriting identities. Preserve trust framing; test 262,144-byte transport bound separately.

### 13.7 Acceptance (installed, Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| R01 | Flag-off bytes, DTOs, defaults, schemas, prompts, ordering, errors and call counts unchanged across legacy reads |
| R02 | Direct retrieval finds unfiled/MOC-omitted Memories and eligible Cards; current/history qualification preserved |
| R03 | Copy T1/BM25 goldens (`HR-1/evaluation/retrieval-research/test/arms-lexical.test.mjs:10`); replay frozen exact-term/CJK retrieval fixtures through installed lexical scores and both fused rankings: standalone one-Han, embedded two-Han, supplementary Han, mixed width. Record embedded single-Han exception separately |
| R04 | Fake embedder/HTTP verify paraphrases, presets, float32 overflow/underflow/load validation, cache bounds and zero paid dispatch for predictable partial coverage. Approved primary-run real API smoke **unrun by default** |
| R05 | All degraded states; semantic false/default makes zero calls; absent/incomplete hosted configuration refuses; lexical survives; total failure never complete-empty. CLI/MCP parsing: flag ordering, adjacent boolean flags, duplicates, missing/extra values, provider-group dependencies, project requirements, retained-profile exclusivity, and `--check-config` side-effect freedom |
| R06 | Foreign fixtures influence no visible names/counts/scores/ranks; index/transport spies see no foreign data; revoke at each await; identical requests repeated after populating another scope's cache return identical coverage, channels and rankings |
| R07 | Second-process correction/supersession/forget/deletion between retrieval/fetch/refetch blocks stale delivery |
| R08 | Feature-off capture, Memory confirmation/rejection, Card/source/conversation mutation and Raw source exclusion invalidate through restart/reconciliation; no resurrection |
| R09 | Real-process kills during incremental/full build/publication, before and after checkpoint commits; resumable matching progress; recoverable interrupted transactions distinguished from corruption; final documents, N, total length, df and rankings equal a clean rebuild; rejected stale/incomplete/corrupt/wrong-store/format generations; deletion recovery; detect transient auxiliary files. Card eligibility equivalence across note, receipt and Raw bindings |
| R10 | Separate canonical writer progresses during embedding and reconciliation; no model calls under locks/capture; paid settlement and §14 query_only restoration verified |
| R11 | Request-semantic changes invalidate cursors; configuration changes stale rankings; continuation makes zero calls, never renews expiry; tamper/scope/generation/size boundaries |
| R12 | Ordinary/read-only/managed matrix, Memory-only schemas and hot/auxiliary-journal refusals; real-process monitoring detects any transient file creation on read-only/managed paths; unchanged canonical DDL |
| R13 | Independently derive/diff installed closure and archive/manifest lists; print counts/differences and actual build/test exit codes |

At 10³/10⁴/10⁵ Memories on both runtimes measure full build/rebuild, incremental refresh, projection-scan cost, unchanged reads, **first read after one mutation**, repeated deadline-limited reconciliation and sustained writes. Record cold/warm query p50/p95, event-loop delay, concurrent-writer latency, sidecar/journal bytes, peak RSS, hardware, Card mix, coverage and failures. These are observations. Label fake-provider timing; paid timing remains unrun absent approval. A07 remains partially unmet until approved live embedding and explicit regression disposition are recorded.

**Non-claims:** answer correctness, complete semantic recall, M7 assembly/U5b, role profiles/relations/U5c, MOC channel, local-model adapter, Raw search, secure physical erasure or 10⁵ latency guarantees. HR-1 remains synthetic directional evidence (`HR-1/docs/plans/hybrid-retrieval-hr1-results.md:161`).

## 14. U2c: method reads without the write lock (v0.7.1, primary-authored, audited and confirmed)

The primary's U3 acceptance (§11.1 v0.4.2) found the cause of the contention.
Every method read runs inside `BEGIN IMMEDIATE` (`core/database.mjs:261`,
`core/method-package-storage.mjs:256`). On every page, `target()` also recomputes
every file's content identity (`core/method-package-storage.mjs:41`). At the
maximum version size (12 MB, 1,246 pages) each `readMethodFile` page held the
write lock for about 49 ms, and a tight reader starved concurrent writers. U2c
fixes this before U4a, which reuses its read helper. U2c makes no DDL, API or
capability change.

- **Read transactions.** Add one core helper for consistent read transactions:
  - It opens with deferred `BEGIN`, never `BEGIN IMMEDIATE`.
  - It exclusively owns the synchronous connection for its duration: no
    await, host callbacks, escaping iterators or nested transactions.
  - It saves the previous `query_only` value and enables it before `BEGIN`. It
    restores that saved value on every exit, including a `BEGIN` failure.
  - It rolls back only a transaction this invocation started. A connection
    whose cleanup fails is discarded.
  - It preserves the existing 5,000 ms busy timeout and error mapping. That
    timeout is not a guaranteed minimum delay.

  All method-package and binding read paths use it, including resolution,
  manifests, files, compare, lists, effects, usage and
  `checkMethodReasonRefs`. Mutations keep `transaction()`.
- **Verification by read type.**
  - `readMethodFile` verifies the package and version rows and lifecycle. It
    recomputes `manifestIdentity` from the stored `(path, content_identity,
    media_type)` rows, and checks only the requested file's text against its
    `content_identity` and `byte_count`. Other files' texts are not hashed.
  - `getMethodVersion`, `listMethodManifest` and `compareMethodVersions` keep
    whole-version verification, unchanged in meaning
    (`core/test/method-packages-reads.test.mjs:34-36` stays as is).
  - Manifest-only verification selects metadata columns, never text. Today's
    `SELECT *` (`core/method-package-storage.mjs:36`) loads every text, so it
    must change. A requested-file read fetches and verifies only that file's
    text.
  - Binding resolution and adoption-status checks use the metadata verifier.
    That includes `stateFor`'s target lookup, `resolveMethod`,
    `resolveMethodsForRole` and current-intent checks. Content is verified when
    a file is read.
- **Semantics change, documented.** Out-of-band corruption of one file's text
  makes reads of that file `method_version_unavailable`. Reads of other files
  stay available. `getMethodVersion` and manifest listing still report the
  whole version unavailable. In-band writers cannot modify `method_files`;
  only import and purge write it.
- **Acceptance (Node 22.16 and 24.15, real processes)**:

  | ID | Observable |
  | --- | --- |
  | C01 | Every existing core, MCP, packaging and installed suite passes with no edited assertions |
  | C02 | A forced write inside each read path fails under `query_only`, and the connection's state is restored afterwards |
  | C03 | Corrupting file A's text refuses reads of A, `getMethodVersion` and manifest listing, while reads of file B succeed. Corrupting a stored `content_identity` or manifest row refuses the reads and resolutions that verify the affected version. Unrelated package lists, usage, effects and reason checks are unaffected |
  | C04 | Gate: a continuous maximum-size `readMethodFile` reader and the existing small independent binding writer run in separate processes, with at least 100 committed transitions and finite deadlines. Any busy outcome fails the gate, even if it was retried. Writer p95 must be ≤250 ms on the reference machine. `npm run measure:method-packages` asserts these thresholds and both processes' exit codes on both runtimes, and reports reader page p50/p95. This is plausibly achievable, not yet established: rollback-mode PENDING locks let short deferred reads coexist with writer progress |
  | C05 | A concurrent deletion permits complete pages linearized before the deletion. A later continuation returns `cursor_stale` under the existing U2 epoch precedence (`core/test/method-packages-deletion.test.mjs:72`), and a fresh read returns `unavailable`. No page mixes snapshots or versions. Existing §5 behaviour and assertions are preserved. U4's separately specified deleted-target precedence does not change U2c |

## 16. Amendment: contention gates under rollback-journal mode (v0.7.2, primary, 2026-10-24)

The U4a-1 review asked for an **unpaced** writer scenario, so that the overlap
is real and not counted across writer sleeps. The primary measured it outside
the sandbox on Node 22.16.0 and 24.15.0:

- An unpaced binding writer committed continuously: 6,408 commits, zero busy
  outcomes, p95 about 21 ms.
- It **starved concurrent readers**. The asset reader read 157 pages in 94 s
  before a `storage_busy`. The method reader read 6 pages, with a 2.9 s
  maximum page.
- The paced scenarios passed every gate on both runtimes: zero busy on both
  sides, writer p95 25–40 ms.

This is inherent to SQLite rollback-journal locking. A writer that never
pauses keeps re-acquiring the lock before readers can.

Therefore, for §14 C04 and §12.7 K13:

- **Gates (unchanged)** apply to the **paced** scenario:
  - at least 100 commits;
  - at least 200 actively overlapping pages, counted against actual writer-call
    intervals;
  - zero busy outcomes on either side;
  - writer p95 ≤250 ms;
  - both process exits checked.
- The **unpaced** scenario is a labelled **stress observation**, not a gate. It
  reports:
  - reader pages;
  - busy outcomes;
  - waits;
  - whether retried reads eventually complete.

  The run fails only on corruption, a wrong byte comparison, a writer error or
  a deadline breach.
- **Limitation** (`docs/limitations.md`): a process that writes continuously,
  without pauses, can starve readers. Readers then receive retryable
  `storage_busy`. Normal capture and imports are sporadic and meet the paced
  gates.
- **WAL mode** is a separate, store-wide follow-up decision. It would remove
  this starvation, but it touches every V1 opener and the §11.2 store fence,
  whose review currently requires rollback-journal mode.
