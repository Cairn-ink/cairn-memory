# Unified memory integration V1: P0 contract and first packet (method packages)

Status:
- U2 (§§2–9, v0.3.1) is implemented and accepted.
- U3 (§11, v0.4.3) is implemented and in acceptance.
- U4 (§12) is draft v0.5, not yet audited.
- U5a (§13) is draft v0.6, not yet audited.
- U2c (§14) is draft v0.7, not yet audited; it precedes U4a.

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

## 11. U3: method packages on the local host (v0.4.3; v0.4.1 audited)

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

## 12. U4: assets, derivatives and binary method attachments (draft v0.5, not yet audited)

Drafted by Codex `u4_contract_author` (gpt-6.1-sol/xhigh, read-only) from the
primary's decisions and the `u4_inventory` report. The primary then edited three
points: create-only export in pure Node, the pre-approval store rule, and the
U5 dependency for searchable derivatives.

U4a delivers v31, migration/openers, the asset facade, derivatives, attachment core, usage, deletion, replay and effects. U4b delivers CLI, MCP and installed tests, and waits for U4a acceptance.

Hosted storage, media understanding, ASR/OCR, physical erasure and U5 retrieval are not claimed.

### 12.1 Capability and migration

- Opt-in: `assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}`. Reuse §2.3's synchronous grants with asset-specific allowlists. Mutations are `explicit-user`; reads are `read`. Capture consent and hooks never import or derive.
- Method-attachment imports/reads require both method-package and asset capabilities and grants. Method deletion cascades under method authority even with assets disabled.
- Extend §2.1: only the ordinary writable opener migrates fresh or supported populated v18, v20–v30 stores to v31, atomically, when assets are selected. v19 refuses. Unselected stores retain their version.
- Read-only and managed openers validate only. New method-only processes work on v31; old binaries reject it. Update:
  - `core/database.mjs:291`;
  - `core/existing-store.mjs:85`;
  - `core/read-database.mjs:27`;
  - `adapters/local/configuration.mjs:79`;
  - `integrations/client/raw/local-setup.mjs:61`.
- Extend the schema-only migrator (`core/method-package-migration.mjs:15`), without enabling prerequisite features.
- Capabilities advertise implemented methods, refs, media, storage, limits, quota accounting and `parser:'unavailable'`. Capability inspection needs no authority. Defaults and old DTOs stay unchanged.

### 12.2 Identity, ownership and limits

- IDs are core-minted random IDs. One asset belongs to exactly one namespace. Each attachment belongs exclusively to one method version; it is never a standalone asset. No sharing or deduplication across owners, namespaces, packages, assets or versions; every retained copy is charged.

| Ref | Shape |
| --- | --- |
| `AssetRef` | `{type:'asset',namespace,assetId}` |
| `AssetVersionRef` | `{type:'asset-version',namespace,assetId,versionId,contentIdentity}` |
| `AssetDerivativeRef` | `{type:'asset-derivative',namespace,assetId,versionId,derivativeId}` |

- Content identity uses the existing store secret and store binding (`core/method-package-storage.mjs:17`), a separate binary-content purpose, and length-framed exact namespace, media type and bytes. Equal bytes in different namespaces never compare equal. No public digest.
- Asset lifecycle/CAS follows §3; version imports/deletions advance asset revision. Deletion is terminal. Titles are ≤200 units; filenames are single components ≤512 units.
- Mixed imports explicitly select `manifestFormat:'mixed-v1'`, with `files` containing tagged text/byte entries. Mixed manifests add `kind:'text'|'binary'`. Their domain-separated identity covers every ordered entry's kind, path, media type and content identity.
- Text-only identities remain byte-for-byte v30. Replace text-only canonical verification (`core/method-package-storage.mjs:41`) with format-specific verification, including byte identities. Compare mixed entries mechanically by kind, media and content identity.

**Unmeasured defaults**; U4b measures them as §11.1.

| Limit | Value |
| --- | --- |
| Asset version / attachment | 33,554,432 bytes each |
| Versions per asset / assets per namespace | 64 / 1,024, including tombstones |
| Derivatives per version | 32, including tombstones |
| Derivative text | 20,000 UTF-16 units, before and after redaction |
| Method version | 256 total entries; 67,108,864 attachment bytes; §11.1 text limits |
| Owner binary quota | 200,000,000 bytes |
| Method-text quota | Separate, unchanged 50,000,000 bytes |
| Chunk / success envelope | 32,768 raw bytes / 65,536 serialized UTF-8 bytes |

- Binary quota counts retained asset bytes, attachment bytes and redacted derivative UTF-8 bytes across the owner's namespaces. Metadata, ledger, effects, SQLite overhead, WAL and backups are excluded.
- Usage delivery is namespace-scoped; owner aggregates require separate authority.
- Extension, declaration and bounded signature must agree: `.png→image/png`, `.jpg/.jpeg→image/jpeg`, `.gif→image/gif`, `.webp→image/webp`, `.pdf→application/pdf`, `.wav→audio/wav`, `.mp3→audio/mpeg`, `.mp4→video/mp4`, `.ttf→font/ttf`, `.otf→font/otf`, `.woff→font/woff`, `.woff2→font/woff2`.
- Check at most 4,096 prefix bytes; reject ambiguity or mismatch. No decoding, rendering, parsing or inferred description. Only derivatives supply descriptions/transcripts; filenames and titles are untrusted labels.

### 12.3 Canonical v31 schema

Keep v30 definitions and rows unchanged; add these 11 STRICT tables. `ns` means owner/scope/project, with §2's namespace CHECKs. Positive revisions/generations, nonnegative counts and exact foreign keys are mandatory.

| Table | Keys and constraints |
| --- | --- |
| `assets` | `id` PK; ns, state, revision, next ordinal, timestamps; state CHECK available/deleted |
| `asset_versions` | `id` PK; asset FK; unique asset/ordinal and id/content-identity; lifecycle, title, filename, media, byte count, timestamp; deleted ⇒ descriptive fields NULL, retained count zero |
| `asset_derivatives` | `id` PK; exact version/content-identity FK; lifecycle, kind, text, text identity, provenance, language, timecodes, byte count, timestamp; kind allowlist; provenance/timecodes JSON CHECKs; deleted ⇒ descriptive content NULL, count zero |
| `binary_objects` | `id` PK; ns, media, identity, byte count; exactly one exclusive owner: unique asset-version FK, or method-version FK with unique version/entry-position |
| `binary_chunks` | PK object/index; object FK with cascade; BLOB length CHECK 1–32,768; index ≥0; non-final chunks exactly 32,768 |
| `method_manifest_formats` | version PK/FK; format CHECK mixed-v1; absence means text-v30 |
| `method_mixed_entries` | PK version/position; unique version/case-folded-path; kind CHECK text/binary; metadata; unique object FK required only for binary; text joins exact `method_files` position |
| `binary_owner_usage` | owner PK; count CHECK 0–200,000,000 |
| `asset_operations` | PK ns/actionId; method, payload binding, target, content-free result, timestamp |
| `asset_effects` | effectId PK; ns, kind, entity, revision, actionId; unique positive ordinal |
| `asset_epochs` | ns PK; positive generation |

- Versions/derivatives have revision 1, then 2 on deletion; state CHECK available/deleted. Available records require their content fields.
- Triggers reject ownership/namespace changes, mixed path/position collisions, invalid chunk size/position and insertion beneath deleted parents. Transaction validation requires contiguous complete chunks and matching byte counts/identities.
- Lifecycle triggers purge owned objects/chunks and derivative content, release usage exactly once and advance epochs, including method/package deletion by feature-off writers. Tombstones cannot return to available.
- Validate tables, CHECKs, indexes, foreign keys and trigger bodies exactly, following `core/method-package-schema.mjs:116`.

### 12.4 Transactions, replay and deletion

- `sqlite-blob-v1` is a versioned internal port. Chunks, metadata, both quota reservations, ledger and effects commit in one `BEGIN IMMEDIATE` (`core/database.mjs:261`). No separately committed staging or filesystem objects.
- APIs accept `Uint8Array` bytes. Before callbacks, copy bounded non-shared views into private backing storage; freeze wrappers and expose only descriptors/bindings to authority. Never freeze a nonempty typed array or expose its mutable backing.
- Extend snapshots separately from `core/method-package-input.mjs:37`: byte leaves consume raw-byte budgets above, not per-byte JSON nodes/string units; metadata keeps U3 budgets. Never stringify/base64 the complete import. Response envelopes retain their independent bound.
- Streaming HMAC binds the complete length-framed pre-redaction input, including bytes. Preserve legacy text-only action bindings.
- Reuse ledger replay-before-existence (`core/private-operation-helpers.mjs:9`). Changed payload gives `action_conflict`; authorized replay after deletion returns the original receipt without reinsertion. Kill before commit leaves no import rows.
- Import → `{asset,version,ordinal,assetRevision}`, effect `asset_version_imported`.
- Derive → `{derivative,source,revision}`, effect `asset_derivative_created`.
- Delete → §7 delete receipt, one target effect `asset_deleted|asset_version_deleted|asset_derivative_deleted`. Cascades need no descendant effects. Mixed method operations retain U2 receipts/effects, without asset refs.
- Purge bytes, derivatives and descriptive metadata. Receipts/effects/tombstones retain only opaque refs/identities, lifecycle state, revisions, timestamps, ordinals and counts.
- Promise canonical non-resurrection and exact usage release across replay, rebuild and restart. Physical erasure from freelist, WAL, journal or backups is excluded (`docs/local-store.md:196`). No `secure_delete` change.

### 12.5 Derivatives and reads

- Immutable derivatives bind exactly one standalone `AssetVersionRef`; attachments receive none. Kinds: `caption|transcript|description|alt-text`.
- Versioned provenance records exact source and `method:{kind:'user-provided'}` only.
- Optional BCP 47 language ≤35 units. Optional `timecodes:[{startMs,endMs}]` contains ≤256 ordered safe-integer intervals, 0≤start≤end, only for audio/video; mark `alignment:'user-supplied-unverified'`.
- Validate Unicode/NUL and redact before persistence, preserving formatting. New versions inherit nothing. Earlier derivatives remain readable, marked historical with exact provenance. Derivative/version/asset deletion purges; namespace revocation blocks delivery.
- U5 may index text in disposable sidecars keyed by exact derivative/source identities, canonically revalidating before delivery; no canonical schema change. U4 itself makes derivatives readable, not searchable. Draft M5's "retrievable" requirement is met only when a U5 packet adds derivatives as a candidate type.

Facade calls take `(input,authority)`; `A` = actionId, `P` = limit/cursor. Lists default/cap at 20 and paginate by envelope bytes.

| Method | Class; input → value |
| --- | --- |
| `getAssetCapabilities` | public; none → capabilities |
| `importAssetVersion` | explicit-user; namespace,A,title,filename,mediaType,bytes,asset?,expectedAssetRevision? → receipt |
| `createAssetDerivative` | explicit-user; A,version,expectedVersionRevision,kind,text,method,language?,timecodes? → receipt |
| `deleteAsset` / `deleteAssetVersion` / `deleteAssetDerivative` | explicit-user; A,ref,expectedRevision → receipt |
| `listAssets` / `listAssetVersions` | read; namespace,P / asset,P → metadata pages |
| `getAssetVersion` | read; version → metadata |
| `listAssetDerivatives` / `readAssetDerivative` | read; version,P / ref,cursor? → provenance/metadata or ≤4,000-unit text parts |
| `readAssetBytes` | read; version,cursor? → chunk page |
| `verifyAssetBytes` | read; version,bytes → matches,byteCount,contentIdentity |
| `getAssetUsage` / `listAssetEffects` | read; namespace / namespace,P → projection / effects |
| `readMethodAttachmentBytes` | read; version,path,intent,context?,snapshot?,cursor? → chunk page and adoptionStatus |

- Each byte page contains one base64 chunk ≤32,768 raw bytes. HMAC cursor binds store, exact version/content identity, chunk index, access generation and parent/version lifecycle revisions.
- Revalidate authority and lifecycle every page; deletion mid-read returns `unavailable`, before generic epoch staleness, with no bytes. Final page reports completion and total byte count.
- Attachment reads reuse §5's current/history, pins and `adoptionStatus` (`core/method-binding-storage.mjs:99`); switching adoption stales current reads, never substitutes attachments. Historical pins retain exact versions; disable marks withdrawn; deletion/revocation blocks delivery.
- Binary `readMethodFile` requests fail `unsupported_media`.
- Reuse §7 errors. Add `asset_not_found` (foreign/missing identical), `asset_version_unavailable`, `asset_limit_reached`; malformed/oversized input is `invalid_input`, media mismatch `unsupported_media`. Unavailable canonical reads deliver no content. Only `storage_busy` retries.

### 12.6 U4b host

Commands inherit §11's database/scope flags:

```sh
cairn-memory assets import --file ABS --title T [--asset ID --expected-asset-revision N]
cairn-memory assets derive --version REF_JSON --kind K --text-file ABS [--language L] [--timecodes ABS]
cairn-memory assets delete --ref REF_JSON --expected-revision N
cairn-memory assets export --version REF_JSON --out ABS
```

- Mutations reuse descriptor confinement (`adapters/mcp/method-package-files.mjs:104`), bounded escaped review, frozen payload, real-TTY exact approval and post-review CAS (`adapters/mcp/method-package-command.mjs:125`). Derive supplies user-provided provenance and reads the source revision for approval.
- Export is read-authorized and create-only, in pure Node with no native helper:
  - Pin the `--out` parent directory with U3's descriptor rules, and reject a final name that is empty, `.`, `..` or contains `/` or NUL.
  - Create a private temporary file through `/proc/self/fd/<dirfd>/<random>.partial` with `O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY` and mode 0600.
  - Write every page, `fsync`, then verify the byte count and content identity through `verifyAssetBytes`.
  - Publish with `link()` from the temporary name to `/proc/self/fd/<dirfd>/<final>`. `link()` never replaces, so an existing path or symlink fails with `EEXIST`.
  - Unlink the temporary name, and `fsync` the directory.
  - Any failure unlinks the temporary file and leaves the final name absent. A crash may leave only a `.partial` name, never a partial final file.
- `methods import --attachments local-v1` includes allowlisted binaries, reviewed as exclusive attachments. Without it U3 behaviour stays unchanged. Add `.svg` as `text/plain` to U3's text map.
- No irreversible store effect before approval, as in §11.2 v0.4.2:
  - Commands never create a store.
  - `user_version` is read through a plain read-only open.
  - Below v31, the import review shows `storeUpgrade:{from,to:31}`, and the core opens (and migrates) only after the exact phrase.
  - Derive, delete and export refuse a store below v31 before opening it, with `asset_not_found`.
- MCP `--assets local-v1` adds only `list_assets`, `list_asset_versions`, `get_asset_version`, `list_asset_derivatives`, `read_asset_derivative`. Method manifests show attachment metadata.
- Fixed host scopes and strict grammars follow §11.4. MCP never returns bytes or mutation tools. Preserve the 262,144-byte transport bound (`adapters/mcp/method-package-transport.mjs:3`).

### 12.7 Acceptance (real processes, Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| K01 | Populated supported migrations preserve rows; injected failure rolls back. All openers validate v31; method-only and feature-off processes work; unselected stores stay unchanged |
| K02 | Frozen actual v30 binary and installed closure reject v31 unchanged, without git-history dependence |
| K03 | Every allowlisted media type round-trips exact bytes/identity after restart; signature/extension/declaration mismatch refuses atomically |
| K04 | Maximum boundaries and one-over refusals; namespace identities differ; retained copies charge fully; text-only identities/replays remain unchanged |
| K05 | Kill before commit leaves no new chunks, metadata, quota, receipt or effects |
| K06 | Separate-process quota/CAS contenders yield exactly one winner; neither quota leaks |
| K07 | Tampered/substituted cursors, wrong scopes and revoked generations leak nothing; deletion between byte pages yields unavailable |
| K08 | Derivatives redact without reformatting, never inherit, preserve historical provenance and unverified alignment |
| K09 | Derivative/version/asset/package purges release exact usage; restart, replay and stale-sidecar rebuild cannot resurrect; effects occur once |
| K10 | Adoption switch never mixes text/attachments; current stales, history remains exact, disable/delete/revoke fence pins |
| K11 | Feature-off method deletion purges attachments; existing conversation-deletion/invalidation regressions pass |
| K12 | Envelopes remain bounded at worst escaping; absent parser is unavailable while metadata remains readable; no media execution/network/model calls |
| L01 | Installed defaults unchanged; flags advertise exactly authorized tools/capabilities |
| L02 | Real-PTY approval/refusal and every H02/H03 confinement/replacement attack exercise assets, derivative input files and attachments atomically |
| L03 | Fresh MCP process reads historical derivative provenance and attachment metadata; no tool/path returns binary bytes |
| L04 | Create-only export verifies exact bytes after restart; existing files/symlinks, parent swaps, corruption and failed publication never overwrite or expose partial output |
| L05 | Maximum complete reads and concurrent writers measured on both runtimes, including memory, transaction time and transport size |
| L06 | Installed manifest/closure checked independently with counts, including helpers, docs and config; shallow CI needs no historical git objects |

## 13. U5a: M6 candidate retrieval (draft v0.6, not yet audited)

Drafted by Codex `u5_contract_author` (gpt-6.1-sol/xhigh, read-only) from the
primary's decisions and the `u5_inventory` report. The primary resolved the
author's single-Han objection, raised the exact-cosine bound, and added the
maintenance policy.

U5a adds a separate, opt-in candidate path. Without opt-in, DTOs, defaults, ordering, prompts, tools, capabilities, errors and provider-call counts remain byte-identical, including `selectEvidence`, recall, session context and MOC reads. `HR-1/` anchors below refer to the research checkout.

### 13.1 Facade and authority

- Construction: `openMemoryCore({path, contextRead:{version:'context-read-v1', authority, embedder?}})`.
- Authority follows §2.3: synchronous `{authorize,isCurrent}`, separate method allowlists, `actionClass:'read'`, `actionId:null`, exact payload binding and access generations (`core/private-card-facade.mjs:7`; `core/method-package-facade.mjs:20`). Capture consent grants nothing here.
- Authorize every namespace before index access, statistics, vector loading, scoring, top-k or transmission. A read set is one namespace, or personal plus one project of the same owner. No implicit personal fallback.
- Recheck all grants after every await and immediately before dispatch/publication/final canonical reads. Revocation discards results and late completions. Host transport guards recheck after asynchronous budget reservation.

All data methods take `(input, token)` and return success/error envelopes; `findCandidates` and refresh are asynchronous. Unknown fields refuse.

| Method | Input | Success value |
| --- | --- | --- |
| `getContextReadCapabilities()` | None; no authority | Version, implemented methods/types/intents, channel availability, embedder metadata, presets, limits, writable-index status and unsupported features; no private counts |
| `findCandidates` | `readSet,query,types,intent,policy?,semantic?,limit?,deadlineMs?,cursor?` | `{version,items,channels,coverage,trace,nextCursor}` |
| `refreshContextIndex` | `readSet,types,intent,budget:{maxItems,maxMs}` | `{status,progress,coverage,channels}`; bounded lexical build and explicit document embedding |
| `fetchCandidateEvidence` | `readSet`, either `{refs,intent}` or `{snapshot}`, `responseByteLimit?` | `{items,snapshot}`; initial canonical fetch or final canonical refetch |

- `types` is a nonempty Memory/Card subset; `intent` is explicit `current` or `history`. Older supported schemas advertise Card unavailable without installing schemas. Unsupported types refuse `invalid_input`.
- Capabilities advertise assembly, role profiles, relations and MOC retrieval as unsupported. `contextRead()` is reserved for U5b.

### 13.2 Limits and continuation

| Limit | Value |
| --- | --- |
| Returned items / final ranked horizon | Default 12; maximum 24 |
| Query | Nonblank, valid Unicode, ≤4,000 UTF-16 units; no NUL |
| Query deadline | Default 1,000 ms; maximum 5,000 ms, including reconciliation and embedding |
| Complete envelope | ≤65,536 UTF-8 bytes, including trace, snapshot/cursor and framing fields |
| Cursor / delivery snapshot | ≤8,192 / 16,384 characters |
| Refresh budget | Required; 1–1,024 items, 1–5,000 ms |
| Synchronous build/scoring batch | ≤128 rows and ≤2,000,000 text units; check remaining deadline between batches |
| Exact-cosine scan | Maximum 20,000 authorized vectors per query, served from a per-handle float32 cache bounded at 134,217,728 bytes. Beyond either bound, scan the most recently updated canonical items first (ties by canonical tuple) and report partial coverage with the omitted count |

- Deadlines are cooperative; they do not promise preemption of blocking host code.
- Freeze the ranked union on the first page; pagination only partitions its top 24. HMAC cursors bind store identity, query, types/intent, exact read set, access generations, canonical/index generations, policy, ranking identity and position.
- A per-handle cache retains at most 128 frozen rankings for five minutes. Eviction or restart returns `cursor_stale`. Changed bindings refuse continuation. Byte limits never silently truncate indivisible items.

### 13.3 Lexical, semantic and fusion

- Lexical is always enabled under opt-in. Port T1 into product code, without importing evaluation modules: NFKC, lowercase, frozen stopwords and Unicode boundaries. Han runs emit overlapping bigrams; a one-character run emits itself. No stemming (`HR-1/evaluation/retrieval-research/lib/tokenize.mjs:86`).
- Index Memory `content` and Card `title + '\n' + body` as versioned `candidate-text-v1`; no receipts, Raw, methods, derivatives or MOC text. U4 asset derivatives become a candidate type only in a later U5 packet.
- **Known miss (primary decision).** T1 stays frozen exactly as HR-1 validated it. A one-Han query term embedded in a longer Han run is therefore not found: `中` does not match `中文`, although the legacy substring search does. R03 asserts this as an explicit known miss, so any change is visible. The limitation is documented. A follow-up research item, HR-1b, measures a Han-unigram fallback for one-character query terms on the frozen HR-1 fixture before any tokenizer change.
- BM25 uses `k1=1.2`, `b=0.75`, distinct query terms and `idf=ln(1+(N-df+0.5)/(df+0.5))`. Only matching documents enter lexical ranking (`HR-1/evaluation/retrieval-research/lib/bm25.mjs:32`). Compute N, df and average length over exactly the authorized, eligible type/intent projection, combining only explicitly authorized namespaces.
- Semantic uses exact cosine over validated finite, nonzero vectors. `policy` is required when semantic is requested with a configured embedder. Frozen presets follow HR-1 protocol §5.3 (`HR-1/docs/plans/hybrid-retrieval-hr1.md:255`):

| Versioned preset | k | Each channel’s depth | Lexical/semantic weights |
| --- | --- | --- | --- |
| `rrf-k60-d12` | 60 | 12 | 0.45 / 0.45 |
| `rrf-k10` | 10 | 24 | 0.5 / 0.5 |

- `score(x)=Σ weight/(k+rank)`, ranks start at 1; missing membership contributes zero. Union maxima are 24/48 respectively; final output stays ≤24. All ties use binary ordering of canonical `(owner,scope,project,type,id)` tuples.
- The host selects the preset: local family uses `rrf-k60-d12`; hosted family uses `rrf-k10`. No arbitrary weights. With absent, disabled or degraded semantic retrieval, use lexical-only BM25 ordering; do not fuse incomplete semantic coverage.

### 13.4 Rebuildable sidecar

- File: `<absolute-store-path>.context-read-v1.sqlite`; format version 1, independently versioned. Same protection as the store: regular, non-symlink file, mode 0600 on POSIX; temporary/journal files receive equivalent protection (`core/database.mjs:299`). Memory-only `:memory:` stores report indexing unavailable.
- Use rollback-journal mode; readers reject hot/incomplete generations without recovery. No canonical schema change, tables, triggers or writer callbacks. Bind generations to store identity, namespace, intent/types, tokenizer/representation versions and canonical Memory/Card epochs.

| Table | Invariant |
| --- | --- |
| `generations` | Format/store binding, captured canonical fences, progress and incomplete/published state; only completely fenced generations are readable |
| `documents` | Generation, namespace, typed ID, exact revision, Card bodyRevision, representation and token length; no bodies |
| `postings` | Generation/document/term frequency; positive frequencies; no cross-generation joins |
| `statistics` | Projection-local N, total length and per-term df; consistent with published documents/postings |
| `vectors` | Store/namespace/type/ID/revision/bodyRevision/representation/embedder ID+revision/dimensions/normalization key; exact vector shape |

- Every read reconciles canonical epochs before using sidecar data. Reuse epoch sources (`core/private-evidence-storage.mjs:20`), not the existing membership-index implementation (`core/index-storage.mjs:61`).
- Admission, correction, supersession, forget, Card changes and source/conversation deletion invalidate logically at canonical commit, including feature-off writers and restarts. Recheck canonical/index fences after awaits and before scoring or returning refs; changed fences discard the ranking.
- Build in bounded batches; publish atomically only against unchanged canonical and access fences. Incomplete, wrong-store, incompatible or corrupt generations are rejected. Late embeddings cannot publish against changed revisions. Purge invalid derivatives during authorized writable reconciliation.
- Writable ordinary handles create/rebuild missing or corrupt sidecars and report `missing`, `corrupt`, `rebuilding` or `rebuilt`. Until publication, report unavailable. Document vectors require explicit refresh again.
- **Maintenance policy (primary decision).**
  - Lexical reconciliation needs no model and no money. On writable handles it runs automatically inside `findCandidates`, in bounded batches within the call's deadline. When it cannot finish, it reports `rebuilding` or partial coverage, never stale items.
  - Document embedding may cost money, so it runs only through an explicit `refreshContextIndex` call. The host exposes that call as `cairn-memory context refresh --db ABS --owner ID [--project ID] --max-items N --max-ms T`, with the embedder, model and spend budget given explicitly. Neither MCP nor capture ever triggers it.
- Read-only and managed-existing handles never create, repair or clean sidecars, journals or directories. They consume a matching published generation or report lexical unavailable. Preserve existing opener/schema validation (`core/read-database.mjs:18`; `core/existing-store.mjs:82`).

### 13.5 Embedder and paid calls

- Port: `{id,revision,dimensions,normalization,embed(texts,{signal})}`; returns one vector per input in order. Normalization is `none` or `l2` (norm tolerance 1e-5). Validate counts, dimensions, finite/nonzero values and declared normalization.
- Model/configuration changes invalidate cached vectors; hosted provider revision may be explicitly `provider-unversioned`.
- No embedder by default. `semantic:false` disables a configured port. Only host-invoked refresh embeds canonical documents; `findCandidates` embeds only its query. Neither capture nor canonical write locks invoke embedding (`core/database.mjs:261`). Oversized inputs are reported in coverage, never silently truncated.
- Ship a deterministic fake and a separate OpenAI adapter: default `text-embedding-3-small` (1,536 dimensions), configurable model with declared dimensions, existing host key lookup (`adapters/local/guarded-model.mjs:24`; MCP `OPENAI_API_KEY`, `adapters/mcp/cli.mjs:257`). A key alone enables nothing.
- Require explicit per-process request/spend budgets. The host reserves before dispatch and releases concurrency only after actual settlement, including caller timeout (`adapters/local/guarded-model.mjs:35`). Preserve conservative accounting for unknown usage; accounting grants no HTTP authority (`evaluation/experiment-budget/index.mjs:1018`). Each retry requires its own reservation. Bound HTTP request/response bytes; honor cancellation and remaining deadlines.

### 13.6 Delivery, diagnostics and MCP

- Candidate items are `{ref,rank,fusionScore,channels:{lexical,semantic}}`; each channel is `{rank,rawScore}` or null. Refs carry exact revision and Card bodyRevision. `fusionScore` is null for lexical-only results. No bodies, titles or excerpts.
- Reuse current/history eligibility and canonical evidence readers (`core/private-evidence-storage.mjs:54`). Superseded Memories cannot be current evidence; history remains explicitly qualified.
- Existing `fetchEvidence`/`revalidateEvidence` are exact-namespace, private-Card-gated APIs. The minimal new `fetchCandidateEvidence` wrapper reuses their readers and content fences across the authorized read set in one canonical read transaction.
- Its HMAC snapshot binds store, read set, refs, intent, access/canonical generations and item fences (`core/private-evidence-storage.mjs:91`). Initial fetch validates exact refs; snapshot mode refetches canonically. No external callback or await follows the final read (`core/recall.mjs:195`). Hosts use this refetch immediately before delivery.
- `channels` distinguishes `ready`, `unavailable`, `disabled`, `absent`, `timeout`, `provider_error`, `rate_limited`, `budget_denied`, `stale_index`, `dimension_mismatch`, `partial_coverage`; retain multiple causes. Semantic failure preserves lexical results. An unusable lexical generation returns `index_unavailable`.
- Coverage reports authorized eligible/indexed/embedded/scanned counts by type, active-embedder coverage numerator/denominator, freshness, build state, selected depths, omitted counts or unknown, and deadline/budget stops. Trace records effective/requested policy, tokenizer/representation/embedder versions and channel timings. No text, vectors, credentials, paths or foreign aggregates.
- Reuse `invalid_input`, `invalid_read_set`, `authority_required`, `scope_changed`, `invalid_cursor`, `cursor_stale`, `revision_conflict`, `evidence_unavailable`, `invalid_snapshot`, `snapshot_stale`, `context_item_too_large`, `index_unavailable`, `storage_busy`, `storage_error`, `store_closed`. Only `storage_busy` is retryable.
- New facade errors may carry `details:{channels,coverage,trace}`; existing error DTOs stay unchanged. Total failure never becomes complete-empty. Empty results require a fresh, exhausted lexical search.
- MCP: `--context-read context-read-v1` enables `find_memory_candidates` and `fetch_memory_candidate_evidence`. No refresh tool. Follow §11.4: startup namespace only; project plus personal requires explicit `--context-read-personal`. Reject supplied authority, namespace/readSet/context and unknown fields; validate embedded ref namespaces without rewriting identities. Preserve trust framing; separately test the 262,144-byte transport bound.

### 13.7 Acceptance (installed, Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| R01 | Flag-off core/stdio bytes, schemas, prompts, errors, ordering and provider-call counts unchanged, including every legacy read path |
| R02 | Unfiled/MOC-omitted Memories and eligible Cards retrieved directly; current/history eligibility preserved |
| R03 | Copy T1/BM25 goldens from `HR-1/evaluation/retrieval-research/test/arms-lexical.test.mjs:10`; exact-term guard includes standalone one-Han, embedded two-Han, supplementary Han and mixed-width terms. Embedded one-Han is asserted as the documented known miss (§13.3), not as a pass |
| R04 | Fake embedder/fake HTTP validate paraphrase fixtures, vector keys, both preset depths/weights and deterministic ties; real API smoke separately approved and primary-run, **unrun by default**; no completed A07 live claim |
| R05 | Every degraded state exercised; lexical survives; total failure cannot claim no matches |
| R06 | Foreign owner/project insertion changes no visible names, counts, scores or ranks; index-access and transport spies observe no foreign data; revoke during each await |
| R07 | Second-process correction/supersession/forget/deletion between retrieval, fetch and final refetch blocks stale delivery |
| R08 | Feature-off capture/Card/source/conversation mutations invalidate across restart; rebuild/replay/late embeddings cannot resurrect forgotten evidence |
| R09 | Kill during build/publication; reject incomplete, corrupt, wrong-store/version and stale generations; recover safely after sidecar deletion |
| R10 | Concurrent canonical writer succeeds while embedding is paused; no calls during capture/write locks; budgets and timeout settlement verified |
| R11 | Tampered, cross-scope, evicted and generation-stale cursors/snapshots refuse; maximum complete envelopes fit |
| R12 | Ordinary/read-only/managed opener matrix preserves canonical DDL; read-only/managed execution creates no files, including journals |
| R13 | Installed import closure independently cross-checked against archive/manifest; print file count and differences; report actual build/test exit codes |

Measure at 10³, 10⁴ and 10⁵ Memories on both runtimes: full build/rebuild, incremental refresh throughput/time, cold/warm query p50/p95, sidecar plus journal bytes and peak RSS. Record hardware, corpus/Card mix, budgets, coverage and failures. Fake-provider timing is labelled; paid timing remains unrun absent approval. These are observations, not latency guarantees.

**Non-claims:** answer correctness, complete semantic recall, M7 assembly (U5b), role profiles/relations (U5c), MOC channel, local-model adapter, Raw search, secure physical erasure and 10⁵ latency guarantees. HR-1 is synthetic directional evidence, not product acceptance (`HR-1/docs/plans/hybrid-retrieval-hr1-results.md:161`).

## 14. U2c: method reads without the write lock (draft v0.7, primary-authored, not yet audited)

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
  - `PRAGMA query_only` is on for its duration and restored on every exit
    path, so an accidental write fails.
  - It returns `storage_busy` only after the existing busy timeout.

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
  - Resolution paths (`resolveMethod`, `resolveMethodsForRole`, current-intent
    checks) must not hash file texts for every bound package. They verify
    lifecycle and stored manifest identity; content is verified when a file is
    read. The worker inventories the current behaviour and reports it.
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
  | C03 | Corrupting file A's text refuses reads of A, `getMethodVersion` and manifest listing, while reads of file B succeed. Corrupting a stored `content_identity` or manifest row refuses every read |
  | C04 | Gate: a continuous maximum-size `readMethodFile` reader and a concurrent binding writer in separate processes produce zero busy timeouts on either side. Writer p95 is ≤250 ms on the reference machine. `npm run measure:method-packages` reports reader page p50/p95 and writer statistics, and exits 0 on both runtimes |
  | C05 | A deletion in another process during paging yields whole pages of the available version or `unavailable`, never mixed content. Cursors and snapshots behave as §5 |
