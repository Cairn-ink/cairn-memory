# Unified memory integration V1: P0 contract and first packet (method packages)

Status:
- U2 (§§2–9, v0.3.1) is implemented and accepted.
- U3 (§11, v0.4.5) is implemented and in acceptance; fix round 2 implements the store fence.
- U4 (§12) v0.5.2 is confirmed by the auditor as ready for U4a implementation after U2c.
- U5a (§13) v0.6.2 is confirmed by the auditor as ready for implementation.
- U2c (§14) v0.7.1 is confirmed by the auditor as ready for implementation. It precedes U4a and U5a's wiring.
- U5b (§15) v0.9.1 is confirmed by the auditor as ready for implementation (`0e92245d`, two re-checks). It builds only on U5a's facade and does not change §13.
- U5b-2 (§15.8) v0.10.3 is confirmed by the auditor as ready for implementation (`ccc9602a`, one audit and three re-checks). It amends §15 after the preview.2 smoke test: `representation-v2`, host-only snapshot with fence-prefixed compact refs, first-source policy.

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

## 15. U5b: M7 budgeted assembly (v0.9.1, audited and confirmed)

Authored by the U5b coordinator on 2026-10-23 on branch
`integration/unified-memory-v1-u5b` (base: U5a `389512d`). v0.8 (`f5ee8133`)
was audited by an independent, non-author, read-only Codex
(`u5b_contract_audit`, gpt-6.1-sol/xhigh), which found eight P0, four P1 and
one P2; v0.9 applies all thirteen, and v0.9.1 applies the re-check's two new
P0 (per-trial snapshot derivation; no hidden-channel claim for diagnostics)
and one P1 (omission and race boundaries). It specifies the `contextRead()` facade
reserved in §13.1 and nothing else. Every §13 method, default, DTO, cursor,
snapshot, sidecar, channel and error stays byte-identical. Without
`contextRead` opt-in nothing changes. `HR-2/` denotes the research checkout on
`experiment/hr2-assembly`.

**Evidence status.** HR-2 (`HR-2/docs/plans/budgeted-assembly-hr2.md`, frozen
v1.1 at `c863e9d6`) ran on 2026-10-24
(`HR-2/docs/plans/budgeted-assembly-hr2-results.md`, harness `241fad89`,
dual non-author review). The preregistered contrast, coverage-first minus
rank-first whole units on bge-m3 + A3 at 512 tokens, came out −2.5 points with
a 95% family-bootstrap CI of [−6.6, +1.5], so **`rank-first-whole-v1` stays
the initial default** under the protocol's rule. The primary had approved that
default on 2026-10-23, with the policy versioned and swappable so that later
evidence can flip it without changing this interface. HR-2 answers only for
short, single-fact items whose evidence often sits in receipts; long-item
validity is a non-claim. HR-2 also found that deepening with the earliest
receipt only never lost and gained 3–4 points at the tightest budgets; that
variant is not part of this packet and would need its own clause.

### 15.1 Facade, authority and transactions

- `contextRead` becomes the fourth method of `context-read-v1`. It exists on
  the writable facade (`openMemoryCore({path, contextRead})`) and on the
  read-only `openContextReader`. `CONTEXT_METHODS` gains `'contextRead'`;
  authority allowlists must add the name explicitly (§2.3, §13.1). Existing host
  authority objects that list only §13's methods refuse it with
  `authority_required`.
- Construction gains one optional trusted field,
  `contextRead.counter: {id, countTokens}`: a synchronous exact token counter
  with the same shape and validation as the existing model counter
  (`core/model-budget.mjs:4`; a non-function, throwing, non-integer or negative
  result is `token_count_unavailable`). `id` is 1–200 units. The counter stays
  optional so that §13-only hosts are unaffected; only `contextRead` refuses
  its absence, with `invalid_input` and `details:{counter:'absent'}`. No
  estimator and no heuristic fallback: budgets are exact in the host's counter
  or refused.
- **Internal search seam.** `contextRead` does not call the public
  `findCandidates`. It reuses an internal search function under the outer
  `contextRead` authorization (one method name, one complete payload binding,
  one absolute deadline) that returns the complete frozen horizon (≤24 items)
  before public paging, with no ranking retention and no cursor creation.
  Public §13 behaviour, retention and paging are unchanged.
- Authority: `actionClass:'read'`, `actionId:null`, payload binding, every
  namespace of the read set authorized before candidate search; outer grants
  and search fences rechecked after every await, including the await that
  receives search results and the semantic embedding await inside the search,
  and again before the final canonical read. Capture consent grants nothing.
  Tool text, saved bodies and receipts never mint authority.
- Transactions: all canonical reads use §14's deferred read helper. Counter
  calls are host callbacks and happen **outside** any transaction, between the
  preparatory read and the final authoritative read. No host callback, counter
  call or await follows the final read (`core/session-context.mjs:113`).
- Deadline: one cooperative deadline covers candidate search, preparatory
  read, counting and the final read. Default 1,000 ms, maximum 5,000 ms. It is
  checked before and after every counter call and before each read phase.
  Expiry stops further admissions (`stops.deadline`); the bounded final
  metering and the final revalidation still run.

| Method | Input | Success value |
| --- | --- | --- |
| `contextRead` | `readSet, query, types, intent, semantic?, budget?:{maxTokens?, maxItems?}, policy?:{id}, deadlineMs?` | §15.5 `{metered, diagnostics}` |

- Unknown fields refuse `invalid_input`. `query`, `types`, `intent`, `semantic`
  follow §13 exactly and are validated by the same input module. `policy` is a
  strict `{id}` object. `cursor` is not accepted: assembly consumes a whole
  frozen horizon.

### 15.2 Limits

| Limit | Value |
| --- | --- |
| `budget.maxTokens` | Default 1,500; minimum 64; maximum 4,000. Counted on the metered text (§15.4) |
| `budget.maxItems` | Default 12; maximum 24. Caps admitted **bodies** only |
| Candidates consumed | The complete frozen horizon of one internal search, ≤24 items |
| Sources per item | The first 16 receipts in `(created_at, id)` order, the same cap and order as §13.6's `provenance.sources` |
| Complete core envelope | `success({metered, diagnostics})` ≤65,536 UTF-8 bytes (§13.2), enforced independently of the token budget |
| Deadline | Default 1,000 ms; maximum 5,000 ms |
| Counter calls | With `U ≤ 408` attempted units and `R ≤ U` rejected trials needing an oversized check: one initial, `U` unit-text, `U` trial-envelope, `R` minimal-envelope and one final count, `2 + 2U + R ≤ 1,226` per call; the actual number is reported |

The defaults are the existing session-context numbers (`core/session-context.mjs:15`).
The 4,000 maximum is the new contract from the integration draft; it is a cap,
not a recommendation, and HR-2 does not choose it.

### 15.3 Candidates, units and representations (`representation-v1`)

- **Candidates.** The internal search runs the §13 lexical or hybrid search
  with the same request binding, preset, channels, coverage and degraded
  modes. The §13 `channels`, `coverage` and `trace` of that search are returned
  unchanged under `diagnostics.candidates`. A failed search returns the §13
  error unchanged, with its diagnostics; total failure never means "no
  matches".
- **Items.** One candidate is one item: a Memory or a Card ref with exact
  revisions. During the preparatory read each item is refetched canonically
  through the §13.6 evidence reader; an item that is `evidence_unavailable` or
  in `revision_conflict` **at preparation** is omitted with
  `omitted.unavailable++` rather than failing the call. The prepared, capped
  set of items and units is the **universe** over which every counter in
  §15.5 is defined.
- **Units.** Each item has one **body unit** and zero or more **source
  units**:
  - Memory body: `content` as stored (canonical, already normalized).
  - Card body: `title + '\n' + body`, the §13.3 indexed text.
  - Memory source: one receipt `{role, excerpt}` validated by the existing
    `validateSourceReceipt` (`core/source-evidence.mjs:6`), in `(created_at,
    id)` order, at most 16. Source units exist only when the canonical item
    reports `sourceAccess:'available'` (`core/private-evidence-storage.mjs:77`);
    that value is used unchanged for every intent, so `history` reads can
    carry sources for items that are canonically current. Items with
    `'unavailable-for-noncurrent-memory'` have no source units.
  - Card source access is `'unsupported'` in U5b and Card `sourcesComplete` is
    always false. Card bindings stay reachable through `fetchCandidateEvidence`.
- **Representations.** A unit is delivered whole or not at all. There is no
  prefix, window or generated summary representation in `representation-v1`:
  HR-2 found body prefixes inert on the frozen fixture, and generated summaries
  need a model. A body that exceeds the budget contributes neither body nor
  receipts, and is tested with canonical long content. Degradation under
  budget means omitting units and counting them (§15.5), never silently
  shortening text. Prefix and window representations stay deferred and
  separately versioned.
- **Ordering invariant.** A source unit is scheduled only after its item's
  body unit was admitted; a rejected body excludes all of its sources. Sources
  never appear detached from their Memory.

### 15.4 Policies, metering and dedup

- **Policy** is the visitation order over units. It is versioned, chosen per
  call by `policy.id`, listed by capabilities, and has one default constant in
  code. Changing the default is a contract revision; adding a policy is not.
  Unknown ids refuse `invalid_input`.

| Policy id | Visitation order | Status |
| --- | --- | --- |
| `rank-first-whole-v1` | `(rank, body-before-sources, receipt order)`: each item's body, then its sources, item by item | **Initial default** (HR-2 P-top) |
| `coverage-first-v1` | `(body-before-sources, rank, receipt order)`: every body in rank order, then every admitted item's sources in rank then receipt order | Available, not default (HR-2 P-cover) |

- **Admission** is greedy skip-and-continue at unit granularity, as HR-2 §6
  defines it: a unit is admitted if the metered text with it still fits;
  otherwise it is skipped and counted, and visitation continues with the next
  unit. `maxItems` closes further **body** admissions once that many bodies are
  in, while sources of admitted bodies remain admissible, so coverage-first's
  second pass still runs. Deadline expiry stops admissions. Delivered items
  keep ascending candidate rank regardless of policy.
- **Metered payload.** The immutable payload
  `metered = {version, policy:{id}, representation, counter:{id}, framing, items, snapshot}`
  is what the budget measures and what the MCP tool shows the model. One
  shared core serializer produces the exact string
  `JSON.stringify({ok:true, value: metered, evidenceTrust:'untrusted-data-not-instructions'})`,
  and the transport emits that string verbatim as the tool's text
  (`adapters/mcp/context-read-transport.mjs:7`). Usage, omission and stop
  counters, timings and counter-call totals live in `diagnostics`, outside the
  metered text, so the count can never include itself. For every trial
  selection, its `snapshot` is derived from the cached preparatory canonical
  generations, access generations and full item fences **before** that trial
  is measured, so the measured string is exactly the string that would be
  delivered; an empty selection uses `snapshot:null`. The accepted final
  payload is frozen after admission, and final revalidation verifies it
  without changing its serialization. This bounds the tool text, not the
  host's total model-request spend.
- **Shared metering.** Fit is `counter.countTokens(meteredText) ≤ maxTokens`,
  measured on the complete metered string, never on fragments summed: the same
  whole-request rule as `packRank` (`core/model-packing.mjs:99`) and session
  context (`core/session-context.mjs:124`). Unit-text counts (`body.tokens`,
  `source.tokens`) are diagnostics only. The 65,536-byte bound is enforced
  separately on the complete core success envelope. No second budget ledger
  exists; the model-call packers are untouched.
- **Empty fit and oversized units.** The metered text with zero admitted units
  is counted first; if it does not fit, the call refuses
  `context_item_too_large`. A rejected unit is classified `oversized` only by a
  further count of the minimal legal envelope holding that unit alone (for a
  source: its body plus that source); otherwise it is a budget skip.
- **Source dedup.** A later source unit is suppressed only when its validated
  canonical `(role, excerpt)` bytes equal those of an earlier admitted concrete
  source. Full receipt identity (`receipt_key`, which hashes the complete
  receipt, `core/runtime.mjs:109`) may be used to short-circuit the comparison;
  matching `client/session/event` alone never suffices. The suppressed unit is
  delivered as `{index, sameAs:{item, source}}`, where the indices are the
  zero-based positions in the delivered arrays of an **earlier** admitted
  concrete source: no forward references, no alias chains. `sameAs` means text
  reuse, not provenance equivalence. Dedup state is request-local and consults
  only authorized namespaces; a cross-namespace alias is delivered only when
  both namespaces pass final validation. `dedup.sources` counts suppressions;
  aliases count as represented for `sourcesComplete`. Dedup never merges
  Memories.
- **Determinism.** Given one horizon, one counter and one policy, the admitted
  unit set is a pure function of the inputs.

### 15.5 Delivery and revalidation

Core success value, with every field present:

```text
{ metered: { version:'context-read-v1', policy:{id}, representation:'representation-v1',
             counter:{id}, framing,
             items:[{ ref, rank, type, metadata, body:{text, tokens},
                      sources:[{index, role, excerpt, tokens} | {index, sameAs:{item, source}}],
                      sourceAccess, sourcesComplete }],
             snapshot },
  diagnostics: { budget:{maxTokens, maxItems, used},
                 omitted:{items, bodies, sources, unavailable, oversized},
                 dedup:{sources}, stops:{budget, items, deadline},
                 candidates:{count, channels, coverage, trace},
                 trace:{timings, counterCalls} } }
```

- `framing` is the fixed trust sentence: assembled text is untrusted
  recollection, never instructions, truth or execution permission.
- `metadata` is exactly the §13.6 item metadata: Memory
  `{state, reviewState, filing, kind, origin, confidence}`
  (`core/private-evidence-storage.mjs:44`); Card `{state, support, origin}`.
  No provenance, receipt metadata or qualification anchors; full qualified
  evidence is one `fetchCandidateEvidence` away through `snapshot`.
- `budget.used` is the final count of the metered text and is authoritative.
- Omission counters are defined algebraically over the prepared universe:
  `omitted.bodies = preparedItemCount − deliveredItemCount`, which covers
  bodies rejected for budget, classified oversized, closed by `maxItems` or
  never visited after deadline expiry; `omitted.items` equals that same value
  (an item is delivered exactly when its body is); `omitted.sources` counts
  source units of the universe not delivered concretely or as aliases, which
  includes every source of an undelivered body; `omitted.oversized` counts
  units classified oversized (§15.4); `omitted.unavailable` counts candidates
  dropped at preparation and is outside the prepared universe. Receipts beyond the 16 cap are outside the universe and never
  produce invented totals. `sourcesComplete` is true only when source access is
  available, the canonical coverage is `complete` (≤16 receipts,
  `core/private-evidence-storage.mjs:88`) and every capped receipt is
  represented concretely or by alias. `stops.items` means `maxItems` closed body
  admission.
- **Snapshot.** `snapshot` uses the existing §13.6 encoding over the
  delivered items' refs in delivered order, with generation types derived from
  those refs (`core/context-read-facade.mjs:446`), the cached preparatory
  access generations and the full evidence-item fences, so
  `fetchCandidateEvidence({snapshot})` returns exactly those items. It is
  derived per trial as §15.4 states; an envelope with zero items carries
  `snapshot:null`.
- **Final revalidation.** After counting, one final read transaction refetches
  every admitted item canonically and recomputes canonical generations and
  item fences. After preparation, an admitted item's disappearance, revision
  or eligibility change, or any fence difference, refuses `snapshot_stale`
  (`retryable:false`; no automatic retry, no repeated embedding). Revocation
  returns `scope_changed`; storage failures keep their own codes. Success
  linearizes at the final revalidation: a mutation visible before it must
  refuse, while a write after it invalidates subsequent snapshot fetches, not
  the delivered text. No callback or await follows this read.
- Errors: §13.6's codes plus `token_count_unavailable`. Diagnostics follow
  §13.6: sanitized `details:{candidates}` on candidate failures; no text,
  vectors, credentials, paths or foreign aggregates.

### 15.6 Host wiring

- **Capabilities.** `getContextReadCapabilities()` lists `contextRead`, adds
  `assembly:{representation:'representation-v1', policies:['rank-first-whole-v1','coverage-first-v1'],
  defaultPolicy:'rank-first-whole-v1', counter:{id}|null, limits}` and removes
  `'assembly'` from `unsupported`. Hosts that construct without a counter see
  `counter:null`.
- **MCP.** After the configuration check has returned, context-enabled MCP
  startup (keyless or keyed, CLI or programmatic `createCairnServer`) injects a
  separate trusted counter built from the keyless local tokenizer already
  shipped for recall (`adapters/mcp/cli.mjs:327`, `o200k_base`, id
  `tiktoken-o200k_base`), independently of the legacy `model` construction, with
  no key, provider or network. One tool is added, `read_memory_context`, with
  arguments `query, types, intent, semantic?, maxTokens?, maxItems?, policy?,
  deadlineMs?`; the host flattens `maxTokens`/`maxItems` into core `budget`,
  passes `policy` as strict `{id}`, fixes the read set, applies the §11.4
  refusals of supplied authority, namespace, readSet or configuration, sets
  `readOnlyHint:true` and `openWorldHint:true`, and emits the metered string
  as the tool's only text block. Diagnostics stay in the core result; the MCP
  result carries them only under a namespaced `_meta` key, and only under an
  explicit, tested client contract that excludes that field from model input.
  No invisibility is claimed for arbitrary clients: the portable token
  guarantee covers the exact text block alone. The 65,536-byte core envelope
  and the separate 262,144-byte transport bound stay. The tool is added to the context tool
  allowlist (`adapters/mcp/context-read-access.mjs:4`). No CLI subcommand is
  added.
- **Existing exact-list assertions.** Two U5a tests assert exactly seven tools
  and exactly two context additions (`adapters/mcp/test/context-read.test.mjs:76`,
  `packaging/test/context-read.test.mjs:51`). Additive assembly tool and
  capability announcements are exempt from the byte-identical expectation of
  A01; those assertions are updated by their test owner (the primary, U5a
  part 3) through coordinator integration. U5b workers never edit them.
- **OpenAI adapter.** Unchanged; the counter is the adapter's existing export.
- **Packaging.** New runtime modules and the shipped doc update
  (`docs/context-read-local.md`) go in `packaging/artifact-files.json`,
  cross-checked mechanically against the static import graph. New CLI-reachable
  modules are imported statically and stay SQLite-free at link time (TRAPS 2–4).
- Shared files (`core/contract.mjs`, `core/database.mjs`, `adapters/mcp/cli.mjs`,
  `adapters/mcp/server.mjs`, `packaging/artifact-files.json`, `CHANGELOG.md`,
  `docs/limitations.md`) receive minimal additive edits only, coordinated through
  the user before the worker touches them.

### 15.7 Acceptance (installed, Node 22.16 and 24.15, under the machine-wide queue)

| ID | Observable |
| --- | --- |
| A01 | Flag-off bytes, DTOs, defaults, prompts, tools, capabilities, errors and provider-call counts unchanged; every §13 retrieval observable (R01–R13) still passes with no edited assertions, except the two exact-list assertions named in §15.6, which the test owner updates |
| A02 | **Research equivalence**: policy visitation orders are verified against the pinned HR-2 protocol (`c863e9d6`, hashes recorded), and product admissions are verified against an independent oracle that uses the identical product serialization, body prerequisites, dedup and caps, on a **U5b-owned fixture** with receipts, canonical normalized text, fixed orderings, fixed horizons and binding budgets. The existing `hr1-sample.json` is not modified. Equal admissions across the two cost models are not required |
| A03 | Every success has `budget.used ≤ maxTokens`, `used` recomputed independently from the delivered metered string equals the reported value, and the core envelope is ≤65,536 bytes, across budgets 64, 256, 1,500, 4,000, both policies, Memory-only and Card stores; the empty-fit refusal is expected separately when the framing cannot fit |
| A04 | Omission accounting over the prepared universe: oversized classification by minimal envelope, rejected bodies with their sources, `maxItems` closing bodies but not sources, deadline stops, >16 receipts, canonical long content; no text is shortened anywhere |
| A05 | Dedup: equal canonical `(role, excerpt)` across two Memories is delivered once with a backward `sameAs`; equal `client/session/event` with different text is not merged; cross-namespace aliases in a two-namespace read set; counts match |
| A06 | Second-process correction, supersession, forget, deletion, refiling, Card revision or source invalidation that is visible before final revalidation produces `snapshot_stale`; a write after that linearization point leaves the delivered text intact and makes the subsequent snapshot fetch refuse; revocation produces `scope_changed`; pre-preparation unavailability produces omission; an instrumented counter proves no counter call or await follows the final read |
| A07 | Authority: allowlists without `contextRead` refuse; every namespace authorized; revoke at each await; foreign fixtures influence no text, counts, ranks or `used`; identical requests after populating another scope return identical stable fields (timing and work telemetry excluded) after equivalent warm-up |
| A08 | Degraded channels and `semantic:false` behave as §13 (zero embedding calls); lexical-only assembly succeeds; candidate-search failures propagate with diagnostics; `history` intent delivers sources for canonically current items |
| A09 | Counter contract: absent counter refuses; throwing, non-integer or negative counters give `token_count_unavailable`; counter calls ≤ `2 + 2U + R`; deadline checks before and after every count; `counterCalls` reported |
| A10 | Read-only reader and managed-existing matrix; real-process monitoring sees no transient files; unchanged canonical DDL |
| A11 | MCP: argument parsing and refusals, strict `policy`, flattened budget, annotations, the single text block equals the core serializer's string byte for byte, diagnostics absent from every text block and present only under the namespaced `_meta` key when the tested client contract applies, capability defaults, secret sanitization, 65,536/262,144 bounds; `--check-config` opens nothing and constructs no counter |
| A12 | Independently derive and diff the installed closure and the manifest; print counts, differences and actual build/test exit codes |

Measurements (observations, not gates): at 10³ and 10⁴ Memories with 1–16
receipts each, `contextRead` p50/p95 at 1,500 and 4,000 tokens under both
policies with the real `o200k_base` counter, counter calls per request, and
event-loop delay. Label fake-counter timings separately.

**Non-claims:** answer quality or correctness; generated summaries; prefix or
window degradation; Card source units; role profiles, relations and MOC (U5c);
long-item validity of the default (HR-2 §3); total model-request spend; any
budget number as a recommendation.

### 15.8 Amendment v0.10.4: `representation-v2`, host-only snapshot, first-source policy (U5b-2)

Authored by the U5b coordinator on 2026-10-24 after the primary's installed
smoke test of `0a38a991` (charter §5, `ec806085`) and the primary's decision
(`docs/plans/primary-to-u5b.md` on `experiment/hybrid-retrieval-hr1`). v0.10
(`fa94af58`) was audited by an independent, non-author, read-only Codex
(`u5b2_contract_audit`, gpt-6.1-sol/xhigh): three P0, five P1, one P2. v0.10.1
applies all of them; the consistency finding (P0) is resolved by the
primary's decision of 2026-10-24: a per-item fence prefix in the compact ref
(§15.8.3). The re-check of v0.10.1 (`165d7f99`) found three blocking items
(verification must live in core; the item fence does not cover MOC parent
moves; the host-v2 cost equation double-counted) and one new P1 (Card
mutation codes); v0.10.2 applies them with the primary's second decision
(parent-only moves are a documented path difference; the fence vector on
core fetch input is approved under three conditions). The second re-check
(`22a017f5`) resolved all of them and found one P1: A15's blanket
`snapshot_stale` expectation for the snapshot path ignored the existing
error precedence when the canonical refetch itself fails; v0.10.3 narrows
it. The third re-check (`ccc9602a`) found no blocking items. v0.10.4
changes only the three numeric A13 bounds to the measured values with
headroom (see A13); no rule changes. Status: **v0.10.3 confirmed by the
auditor for implementation; v0.10.4 bounds adjustment under review with
the implementation.** Where this subsection contradicts §§15.1–15.7, including their
return-value and envelope descriptions, this subsection wins; every other U5b
rule stays in force. `read_memory_context` ships in `v1-preview.2` as
**experimental**, outside the versioning promise; experimental labelling and
any later stability designation are owned by the primary's release
documentation, not by this amendment. `find_memory_candidates` and
`fetch_memory_candidate_evidence` keep their existing output shapes; the only
change to them is the additive input form in §15.8.3.

#### 15.8.1 Measured problem

Measured on `0a38a991` with the real `tiktoken-o200k_base` counter, core
fixture, one Memory whose body is 15 tokens and whose single receipt equals
the body, budget 4,000:

| Component of the metered text | Tokens |
| --- | ---: |
| Envelope without items and snapshot (`ok`, `version`, `policy`, `representation`, `counter`, `framing`, `evidenceTrust`) | 84 |
| Item: `ref` (type, full namespace object, UUID, revision) | 55 |
| Item: `metadata` | 32 |
| Item: `sources` (one receipt equal to the body) | 30 |
| Item: `body` (`{text, tokens}`) | 21 |
| Item: remaining keys (`rank`, `type`, `sourceAccess`, `sourcesComplete`) | ~24 |
| `snapshot` (base64url JSON with one fence per item) | 236–251, then +90 per item |
| **Total** (1 / 2 / 3 items) | **488 / 739 / 989** |

Each added item costs about 250 tokens, of which the body is 15. The snapshot
alone costs more than ref, metadata and duplicated excerpt together, because
base64url tokenizes at about 0.65 token per character and the snapshot
carries one 43-character base64url HMAC fence per item
(`core/context-read-facade.mjs:108`). HR-2 measured budgets at `O = 0`;
the host today behaves like `O ≈ 250` per item, so HR-2's 128–512 curves do
not carry over to the host as published (results §4; addendum in §15.8.8).

#### 15.8.2 `representation-v2`: the metered payload

`representation-v2` **replaces** `representation-v1`; both are never
selectable. Capabilities announce `assembly.representation:'representation-v2'`
and `assembly.defaults` (§15.8.6). The metered string is produced by the same
single core serializer as §15.4 and remains exactly the tool's only text
block:

```text
JSON.stringify({ ok:true,
  value:{ framing, items:[ item... ] },
  evidenceTrust:'untrusted-data-not-instructions' })
```

Fields that §15.4 put in the metered text and that do not inform the model
(`version`, `policy`, `representation`, `counter`, `snapshot`, unit token
counts) move out of it; §15.8.4 says where. `framing` is unchanged.

One delivered item, with **default-valued fields omitted**:

```text
{ ref:{ ns, type:'memory', id, rev, f }                   // or { ns, type:'card', id, rev, bodyRev, f }
  rank,                                                   // original one-based candidate rank, ascending across items
  body:'<canonical text>',                                // string, whole unit, never shortened
  metadata:{ ...only fields that differ from assembly.defaults.metadata[type] },
  sources:[ { index, role, excerpt }                      // concrete receipt
          | { index, role, sameAsBody:true }              // excerpt bytes equal this item's body
          | { index, sameAs:{ item, source } } ],         // §15.4 backward alias, unchanged
  sourceAccess, sourcesComplete }                         // present only when not default
```

- **Compact ref.** `ns` is the zero-based index of the item's namespace in the
  **canonical read set order**: the order `contextReadSet()` produces
  (`core/context-read-input.mjs:71`, sorted by namespace key), which is the
  order the §13.6 snapshot encoding already indexes and the order the MCP
  host's immutable startup read set is stored in. Core callers that pass a
  read set in another order get indices into the canonical order, not into
  their input. `id` is the Memory or Card id, `rev` the revision, `bodyRev`
  the Card body revision (mandatory for Cards, forbidden for Memories).
  `type` moves from the item into the ref. `f` is the **item fence prefix**:
  the first 8 base64url characters (48 bits) of the existing per-item HMAC
  `bind('snapshot-item', item)` (`core/context-read-facade.mjs:108`),
  computed over the **untouched canonical evidence DTO** exactly as the
  snapshot path hashes it, never over the sorted wire projection, with no
  new key material. It is a detection token only, never an authority: it
  proves nothing to the host about who holds it. What it reveals: a stable
  keyed fingerprint of the item and therefore equality/change information
  across calls, not plaintext and not key material (the HMAC key is
  store-local and the prefix cannot be inverted or extended). Assuming
  pseudorandom HMAC output, a changed item escapes detection with
  probability 2⁻⁴⁸ per comparison, union bound `M/2⁴⁸` over `M` comparisons:
  bounded accidental-change detection, not adversarial integrity.
  Full refs with namespace objects stay available in diagnostics (§15.8.4)
  and are what `fetchCandidateEvidence` returns; the host never rewrites
  identities.
- **Normative serialization.** One core serializer builds the metered object
  and `JSON.stringify` emits it; the byte sequence is fixed by these rules,
  so two implementations agree byte for byte:
  - Key order is the displayed order: envelope `ok, value, evidenceTrust`;
    value `framing, items`; item `ref, rank, body, metadata, sources,
    sourceAccess, sourcesComplete`; ref `ns, type, id, rev, bodyRev, f`;
    concrete source `index, role, excerpt`; body alias `index, role,
    sameAsBody`; backward alias `index, sameAs` with `sameAs` as `item,
    source`.
  - Memory metadata keys, when present, keep the order `state, reviewState,
    filing, kind, origin, confidence`; Card metadata `state, support, origin`.
    Nested metadata objects (`filing`, `support`) are serialized with their
    keys sorted by UTF-8 bytes, recursively; arrays keep their order. Default
    comparison uses the same canonical form.
  - `rank`, `body` and `sources` are always emitted, `sources` as `[]` when
    the item has no delivered source unit. `rank` is the original one-based
    candidate rank, not the delivered position.
  - `metadata` is omitted exactly when no field differs from the announced
    default; `sourceAccess` exactly when it is `'available'`;
    `sourcesComplete` exactly when it is `true`.
  - Card body is `title + '\n' + body` (§15.3), as a string.
  - `sameAsBody` is decided before `sameAs`; a `sameAsBody` unit is never
    the target of a later `sameAs`; a `sameAs` targets the earliest earlier
    concrete source with equal canonical `(role, excerpt)` bytes.
- **Body** is the canonical text as a string. The body token count is
  diagnostics (§15.4 already made unit counts diagnostics only).
- **Metadata** carries only fields whose canonical value differs from the
  announced defaults; when nothing differs, the `metadata` key is omitted.
  Defaults are a frozen constant announced in capabilities:
  Memory `{state:'active', reviewState:'none', filing:{status:'unfiled'},
  kind:'fact', origin:'explicit', confidence:1}`; Card `{state:'confirmed'}`
  (`support` and `origin` are always delivered for Cards). Comparison is
  canonical JSON equality per field (`filing` compares the whole object).
  Omission is lossless: full §13.6 metadata for every delivered item stays in
  diagnostics.
- **Sources.** Receipt order, the 16 cap, the §15.4 body-before-sources
  invariant and backward `sameAs` are unchanged. A source whose validated
  canonical `(role, excerpt)` has excerpt bytes equal to the item's own
  canonical body bytes is delivered as `{index, role, sameAsBody:true}`; its
  role is kept so the reader still learns who said it. `sameAsBody` is checked
  before `sameAs`, so an excerpt equal to the body of an earlier item and to
  this item's body aliases the body, not the earlier source. Receipts are
  never dropped: a `sameAsBody` unit still costs its representation, is
  visited by the policy, counts as represented for `sourcesComplete`, and is
  counted under `dedup.body` (§15.8.4). Its excerpt is reconstructed by the
  reader from the item's own body and the delivered `role`; the snapshot and
  compact-ref fetch return the item's canonical receipt references exactly as
  §13.6 already does (`core/private-evidence-storage.mjs:78`), and full source
  prose stays with the separately authorized source reader. Neither
  diagnostics nor the fetch path carries receipt excerpt text.
  `source.tokens` moves to diagnostics.
- **Flags.** `sourceAccess` is delivered only when it is not `'available'`;
  `sourcesComplete` only when it is `false`. The §15.5 definitions of both are
  unchanged.
- **Determinism and metering** are unchanged (§15.4): fit is measured on the
  complete metered string, per trial, with the same counter-call bound
  `2 + 2U + R`, the same empty-fit refusal and the same oversized
  classification. A trial's measured string depends on the per-item fence
  only through the 8-character `f`, which is known from preparation; no
  snapshot is encoded per trial.
- **Final-validation seam.** The facade carries the selected prepared
  identities (full refs and fences) independently of the wire refs; the
  existing final validation (`core/context-read-facade.mjs:511`), which
  matched `metered.items[].ref` against prepared full refs, is rewritten to
  use those carried identities. Order after admission: derive the snapshot
  **once** from the accepted final selection using the cached preparatory
  generations, access generations and full item fences (`null` without any
  encoding for an empty selection); enforce the 16,384-character bound
  (`context_item_too_large`); construct and freeze the complete core success
  envelope `{metered, snapshot, diagnostics}` and apply the 65,536-byte bound
  to it; then run the single authoritative read that revalidates every
  selected full identity (generations, eligibility, fence) and refuses
  `snapshot_stale` on any difference. No host callback, count or await
  follows that read (A06 unchanged).

Expected cost after this subsection, same probe as §15.8.1: envelope ≈ 30,
first item ≈ 70–80, each further item ≈ 60–75 (body 15, of which `f` costs
about 7); a 15-token Memory goes from 3% body share to about 20%. These are
estimates; A13 measures and publishes the actual constants.

#### 15.8.3 Snapshot: host-only, and the model's refetch path

- **Where it goes.** The core success value becomes
  `{metered, snapshot, diagnostics}`: `snapshot` is a sibling of `metered`,
  never inside it. The MCP result carries it only under
  `_meta['ink.cairn/context-read-snapshot']` (a string, or `null` for an empty
  selection), beside the existing diagnostics key, under the same explicit,
  tested client contract (§15.6): a client that forwards `_meta` to the model
  gets no guarantee from this contract. No second content block and no
  `structuredContent` are emitted, because many clients forward every content
  block to the model. The 65,536-byte core envelope, the 262,144-byte
  transport bound and the 16,384-character snapshot bound are unchanged.
- **Who uses it.** Today the only flow that needs the model to echo the
  snapshot is `read_memory_context` → model → `fetch_memory_candidate_evidence({snapshot})`
  (§15.5). Under this amendment that flow is host-side: a host or UI that kept
  `_meta` may pass the snapshot to the fetch tool and receives exactly the
  delivered items with the same `snapshot_stale` linearization (§15.5, A06),
  unchanged. The **model's** refetch path is `refs`.
- **Compact refs in `fetch_memory_candidate_evidence`.** The tool accepts, in
  its existing `refs` array and in addition to the existing full forms, the
  compact forms `{ns, type:'memory', id, rev, f}` and
  `{ns, type:'card', id, rev, bodyRev, f}` exactly as delivered in the metered
  text. `f` is mandatory: a compact ref without `f` is `invalid_input`, so
  the fence-less path is never reachable by omission. Because the SDK
  validates the registered input schema before the action runs
  (`adapters/mcp/server.mjs:226`), the registered `refs` element schema
  becomes a union whose **legacy arm is the original full-ref schema,
  unchanged**, and whose compact arm is a strict object validated on the raw
  descriptor before any normalization: own-data descriptors only, no
  prototype keys, no hybrid objects mixing compact and full keys; `ns` a safe
  non-negative integer, `rev`/`bodyRev` safe positive integers, `f` exactly
  8 base64url characters. Mixed arrays of compact and full refs are allowed.
  Valid existing inputs produce byte-identical outputs; invalid existing
  inputs keep the same refusal class (SDK parameter refusal versus tool
  error) and the same `invalid_input` code, and the worker reports any
  change in validation message text together with the assertion, if any,
  that depends on it (no other owner's test is edited).
  The MCP tool layer (`adapters/mcp/context-read-tools.mjs`, U5b-owned)
  expands each compact ref purely against the host's **immutable startup
  read-set mapping** (`adapters/mcp/context-read-access.mjs:8`, never
  replaced or reordered in a live host; compact refs are scoped to that
  host's lifetime), then authorizes every expanded namespace through the
  existing `access.call` grant before any evidence read, so core
  `fetchCandidateEvidence` and its §13.6 validation are untouched and the
  existing full-ref parser, foreign-namespace refusals and error bytes are
  preserved for existing inputs (A01). Malformed or out-of-range compact refs
  refuse `invalid_input` with zero core calls; a host revoked before the
  call refuses `authority_required`; revocation during a granted call
  refuses `scope_changed`, as for every §13 call. The tool description says
  that refs copied from `read_memory_context` are accepted verbatim and that
  `snapshot_stale` means "re-run `read_memory_context`". This is the only
  change to a §13 tool: additive input, output byte-identical for existing
  inputs.
- **Which path guarantees what.** Expansion yields the full §13.6 ref, so the
  existing exact-revision and intent-eligibility semantics apply unchanged
  (traced at `0a38a991`: a changed revision or filing status refuses
  `revision_conflict` under both intents; supersession refuses
  `evidence_unavailable` for `current` and `revision_conflict` for `history`
  because retirement bumps the revision; forget or deletion refuses
  `evidence_unavailable`; Card eligibility is checked before revision, so
  support or applicability loss refuses `evidence_unavailable` and an edit
  `revision_conflict`; a successful fetch never substitutes another revision;
  there is no item-level failure, the whole call refuses). Two mutations do
  not bump a revision and are invisible to full refs: same-revision receipt
  deletion, and moving an already-filed Memory between MOC parents
  (`core/moc-storage.mjs:200,292`). The item fence covers the first: the
  canonical evidence DTO includes the receipt references. It does **not**
  cover the second: the DTO carries `filing.status` only, never MOC
  memberships, and a filed→filed parent move advances only the namespace
  epoch. By the primary's decision of 2026-10-24 this is a **documented
  difference between the two paths**: a parent-only move leaves the
  compact-ref fetch succeeding with byte-identical evidence (nothing the
  model was shown changed, nothing newer or lesser is served), while the
  snapshot fetch refuses `snapshot_stale` through its generation fence.
  `docs/limitations.md` records it.
  **Verification of `f`** lives in core, because `bind`, `read` and the
  fetch transaction are private facade closures: `fetchCandidateEvidence`
  input gains an optional `fences` array, aligned index by index with
  `refs`, each entry an 8-character base64url prefix or `null`. The facade
  compares every non-null prefix against the full fence it computes over
  the canonically refetched item, inside **both** `fetchInside` executions
  (the prepared read and the authoritative final read), after the existing
  eligibility and revision validation, and refuses the whole call
  `snapshot_stale` (`retryable:false`, the snapshot path's code and
  retryability) on any mismatch. There is no partial result and no
  fence-less fallback. `fences` is part of the authorized input (the
  authority token binds it like every other field). Calls without `fences`
  are byte-identical to today. Through MCP, `fences` is reachable **only**
  by compact-ref expansion: the tool layer fills it from each compact ref's
  `f` and `null` for full refs; a caller that supplies `fences` itself, or
  any raw prefix vector beside full refs or a `snapshot`, is refused
  `invalid_input` before any core call.
  - **Snapshot fetch** (host-side, from `_meta`) guarantees canonical
    generations, access generations and full fences over the exact delivered
    set, in delivered order.
  - **Compact-ref fetch** (the model's path) guarantees exact revision, intent
    eligibility and the item fence for each ref, plus re-authorization of
    `ns` against the immutable startup mapping; it does not check store
    generations, so namespace-only changes such as a parent move pass. A
    full ref without `f` keeps today's semantics.
- **Core hosts** (`contextRead()` callers without MCP) receive the full
  `snapshot` string in the success value and may pass it to
  `fetchCandidateEvidence` as before.

#### 15.8.4 Diagnostics

`diagnostics` (unmetered, `_meta['ink.cairn/context-read-diagnostics']` in
MCP) gains the fields that left the metered text and keeps every §15.5 field:

```text
{ version:'context-read-v1', policy:{id}, representation:'representation-v2', counter:{id},
  budget:{maxTokens, maxItems, used}, omitted:{...}, dedup:{sources, body}, stops:{...},
  items:[{ ref:<full §13.6 ref>, metadata:<full §13.6 metadata>, body:{tokens},
           sources:[{index, kind:'concrete', tokens} | {index, kind:'sameAs', item, source}
                   | {index, kind:'sameAsBody', tokens}] }],
  candidates:{...}, trace:{timings, counterCalls} }
```

`diagnostics.items[i]` corresponds positionally to `metered.items[i]`, and
`diagnostics.items[i].sources[j]` to `metered.items[i].sources[j]`: every
delivered receipt, including aliases, has exactly one entry. Diagnostics
carry **no receipt or body text**, no paths and no foreign aggregates: only
the full ref, the full §13.6 metadata, unit token counts and representation
markers. `dedup.body` counts `sameAsBody` units; `dedup.sources` keeps its
§15.4 meaning. Omission algebra (§15.5) is unchanged: `sameAsBody` units are
represented, not omitted. `budget.used` stays the final count of the metered
string.

#### 15.8.5 Policy `rank-first-first-source-v1` (packet B, non-default)

| Policy id | Visitation order | Status |
| --- | --- | --- |
| `rank-first-first-source-v1` | `(rank, body, earliest receipt only)`: each item's body, then only its first source unit in `(created_at, id)` order; later receipts are never visited | Available, not default (HR-2 P-top-s1, results §5.2) |

Unvisited receipts count under `omitted.sources` like any never-visited unit;
`sourcesComplete` is therefore `false` for any delivered item with more than
one capped receipt. `maxItems`, deadline, dedup and `sameAsBody` apply as for
`rank-first-whole-v1`. The default stays `rank-first-whole-v1` until a
long-item fixture exists (HR-2 results §5.4). Adding this policy is not a
default change (§15.4).

#### 15.8.6 Host wiring changes

- Capabilities: `assembly.representation:'representation-v2'`,
  `assembly.policies` gains `'rank-first-first-source-v1'`, and
  `assembly.defaults:{metadata:{memory:{...}, card:{...}}, sourceAccess:'available', sourcesComplete:true}`
  announces the omitted defaults verbatim.
- `read_memory_context`: same arguments; the text block is the v2 metered
  string; `_meta` carries diagnostics and the snapshot under two keys. Because
  core capabilities are not an exposed context tool, the **tool description**
  itself states, verbatim: "`sameAsBody` means this receipt's excerpt equals
  this item's body verbatim"; that `ref` values are accepted by
  `fetch_memory_candidate_evidence` as copied, and that `snapshot_stale` from
  that tool means re-run `read_memory_context`; and the omitted defaults
  (metadata defaults per type, `sourceAccess:'available'`,
  `sourcesComplete:true`). The description is bounded and contains no secrets
  or store identifiers.
- `docs/context-read-local.md`, `CHANGELOG.md` and `docs/limitations.md`
  record the representation change, the `_meta` snapshot, the experimental
  status of the preview.2 shape, and the documented path difference of
  §15.8.3 (parent-only MOC moves pass the compact-ref fetch and fail the
  snapshot fetch). Shared-file rules of §15.6 apply.
- Nothing else in §15.6 changes: counter construction, `--check-config`,
  allowlist, packaging and SQLite-free linking stay as specified.

#### 15.8.7 Acceptance additions (same conditions as §15.7)

| ID | Observable |
| --- | --- |
| A13 | **Known-answer serialization and constants.** A fixed fixture item (Memory and Card, with a concrete receipt, a `sameAsBody` receipt and a `sameAs` alias) serializes to a byte-exact expected v2 string constructed in the test without the production serializer. Constants: the test freezes the exact probe bytes (fixed ids, fixed namespace, fixed `f`, fixed 15-token body, one `sameAsBody` receipt per item) and builds three complete independent expected strings for 0, 1 and 2 items; the real `o200k_base` counter gives `T0`, `T1`, `T2`; the published constants are `envelope = T0`, `firstItem = T1 − T0`, `furtherItem = T2 − T1`, plus separately measured `bodyOnlyItem` (no sources), `concreteSource` (one 15-token concrete receipt delta) and `aliasSource` (one `sameAsBody` delta); bounds `T0 ≤ 48`, `T1 − T0 ≤ 96`, `T2 − T1 ≤ 90` (v0.10.4: the v0.10.3 bounds 40/90/80 were pre-implementation estimates; the worker measured 43/83/82 with the normative serialization and the unchanged framing, and the serialization wins over the estimate, so the bounds are the measured values with about 10% headroom; a later change that exceeds them is a contract change); the constants, the probe strings, the counter id and the implementation commit are written to `evaluation/retrieval-research/assembly/overhead-host-v2.json`, labelled an approximate model (UUID and text tokenization vary), never a guarantee. The test skips with a printed reason when the tokenizer package is absent, and the coordinator runs it where it is present |
| A14 | **Snapshot out of text.** For every assembly response (success and assembly error), no text block contains the snapshot string or any full fence, and the only fence-derived bytes in text are the 8-character `f` values; `_meta['ink.cairn/context-read-snapshot']` carries the snapshot beside the diagnostics key; the §13 tools' responses are unchanged; a host fetch with that snapshot returns exactly the delivered items in order; after a second-process mutation it refuses `snapshot_stale` (A06 unchanged); an empty selection carries `null` with no encoding call; the 16,384 bound is enforced once on the final snapshot and the 65,536 bound on the complete `{metered, snapshot, diagnostics}` envelope; the core success value carries the same snapshot string |
| A15 | **Compact refs round-trip with fence verification.** Every `ref` in a delivered v2 text, passed verbatim to `fetch_memory_candidate_evidence`, returns the same item at the same revision with full namespace and canonical receipt references, under both intents, in a one- and a two-namespace read set, for Memories and Cards; mixed compact and full refs in one call succeed; valid existing U5a fetch inputs produce byte-identical outputs, invalid ones the same refusal class and code (§15.8.3); every existing U5a test passes unmodified. **Staleness is visible, never silent**, asserted per mutation kind × intent with the exact codes of §15.8.3, each case pinning the resulting eligibility and revisions in the test: Memory correction and filing-status change → `revision_conflict` (both intents); supersession → `evidence_unavailable` (`current`), `revision_conflict` (`history`); forget and deletion → `evidence_unavailable` (both); Card support or applicability loss → `evidence_unavailable` (`current`), and under `history` `revision_conflict` if a revision changed, otherwise `snapshot_stale` from the fence if the canonical item changed; Card edit → `revision_conflict` under `history`, and under `current` `revision_conflict` while still eligible, otherwise `evidence_unavailable`; same-revision receipt deletion → `snapshot_stale`; in every case the whole call refuses and no text carries post-mutation content. **Snapshot fetch for the same state** (snapshot processing itself unchanged): `snapshot_stale` when the generations differ or a successful canonical refetch yields different full fences; when the canonical refetch itself fails, the existing §13.6 error is preserved (A06 unchanged). Example pinned in the test: same-revision Card support loss with unchanged generations → `current`: `evidence_unavailable` (eligibility fails before the fence comparison, facade:552), `history`: `snapshot_stale`. Mutation fixtures pin generations alongside eligibility and revisions, and the fetch's existing generation comparison between its own two reads is preserved. **Documented path difference:** a filed→filed MOC parent move of a delivered Memory leaves the compact-ref fetch succeeding with byte-identical evidence while the snapshot fetch refuses `snapshot_stale`; A15 asserts exactly that pair. **`f` is mandatory and verified in core:** a one-character change in `f` → `snapshot_stale`; a missing, short, long or non-base64url `f` → `invalid_input`; a caller-supplied `fences` argument, or a prefix vector beside full refs or a `snapshot` → `invalid_input` with zero core calls; a core call with a `fences` entry whose prefix mismatches → `snapshot_stale` from both the prepared and the final read; a full ref without `f` keeps today's semantics. **Authorization is re-derived, never trusted from the index:** expansion uses the immutable startup mapping and authorizes through `access.call` before any evidence read; a core caller passing the read set in reversed order gets canonical indices; out-of-range, negative, non-integer or non-own-data `ns`, hybrid compact/full objects, a Card ref without `bodyRev`, a Memory ref with one → `invalid_input` with zero core evidence reads; a host revoked before the call → `authority_required`; revocation during a granted call → `scope_changed`; a foreign fixture at the indexed position in another host's read set is never returned |
| A16 | **`sameAsBody` is legible and lossless.** For a receipt equal to the body, the metered text contains `"sameAsBody":true` with the receipt's `role` and does not contain a second copy of the body; the exposed `read_memory_context` tool description contains the sentence "`sameAsBody` means this receipt's excerpt equals this item's body verbatim" (asserted on the listed tool, not on a constant); `diagnostics.items[i].sources[j]` carries `kind:'sameAsBody'` with its token count and no text; the snapshot fetch and the compact-ref fetch return the item's canonical receipt references including that receipt (§13.6 shape, no excerpt text); a receipt that differs from the body by one byte is delivered concretely; a receipt equal to another item's body but not its own is delivered via `sameAs` or concretely, never `sameAsBody`; a `sameAsBody` unit is never a `sameAs` target; `dedup.body` and `sourcesComplete` are exact |
| A17 | **Default omission is lossless.** Items with every default value carry no `metadata`, `sourceAccess` or `sourcesComplete` key; each non-default value appears in the text: `historical` Memories under `history`, `awaiting` review under `history` (ineligible under `current`), a confirmed review state, a filed status, a non-fact kind, an agent-inferred origin as the store actually records it, confidence < 1, Cards' always-present `support` and `origin`, `sourceAccess` unsupported or unavailable-for-noncurrent, `sourcesComplete:false`; `diagnostics.items[i].metadata` equals the §13.6 metadata for every item; the announced `assembly.defaults` equal the constant the serializer uses. The U5b-owned synthetic fixture's `reviewState:'not-required'` (`core/testing/context-read-assembly-fixture.mjs:50`) is wrong against the store and is corrected to the canonical value in this packet |
| A18 | **First-source policy.** Visitation order verified against the pinned HR-2 P-top-s1 schedule on the A02 fixture; an item admits at most its earliest capped receipt, and only when it fits; a rejected first receipt never causes the second to be tried; later receipts are counted omitted; `sourcesComplete:false` whenever more than one capped receipt exists; default policy unchanged |
| A19 | **A01–A12 re-run** against v2. Assertions that may change, each justified in the worker report in one line: v2 serialization shape, admission and empty-fit outcomes that follow from the smaller envelope, dedup `sameAsBody` outcomes, snapshot location, diagnostics shape, the independent A02 oracle's serialization, and the capability block. Assertions that must not change: authority, races and linearization, omission accounting algebra, counter-call and deadline bounds, byte limits, read-only refusals. Files the worker may edit for this: `core/test/context-read-assembly.test.mjs`, `core/test/context-read-assembly-races.test.mjs`, `core/test/context-read-assembly-readonly.test.mjs`, `core/testing/context-read-assembly-*.mjs`, `core/test/fixtures/context-read/u5b-assembly.json`, `adapters/mcp/test/context-read-assembly.test.mjs`, `packaging/test/context-read-assembly.test.mjs`, `docs/context-read-local.md`. The U5a exact-list tests, `assets-host` L01 and every other owner's test are unchanged |

#### 15.8.8 Research addendum (HR-2, packet B, not a contract gate)

After A13 publishes the constants, the HR-2 harness gains
`--overhead-model host-v2`, read from `overhead-host-v2.json` with its
commit. The existing scalar `O` (`assembly/arms.mjs:23`, one surcharge per
unit) cannot express it, so the model is a separate cost function with its
own cell identity (`O=host-v2@<commit>` in file names and provenance).
Constants, all from A13's frozen probe with 15-token bodies: `E` = envelope
(`T0`); `B_n` = tokens of the `n`-item body-only probe minus `E`;
`h1 = B_1 − 15` (first-item representation without its body text);
`hN = B_2 − B_1 − 15` (each further item); `C` = delta of one concrete
15-token receipt; `A` = delta of one `sameAsBody` receipt. For `n > 0`
delivered items:
`cost = E + h1 + (n − 1)·hN + Σ_items tokens(body) + Σ_concrete_sources (C − 15 + tokens(excerpt)) + Σ_body_aliases A`,
and `cost(empty) = E`; a receipt whose excerpt equals its body is charged as
an alias and its text is never charged twice; every other receipt is charged
as concrete in this approximate model. The raw `firstItem`/`furtherItem`
constants stay published solely for the A13 bounds. The harness validates
`host-v2` cells explicitly: `score.mjs` (which today accepts only overhead
0/8 and scalar costs, `assembly/score.mjs:40,67,75`) gains a `host-v2`
replay that recomputes each cell's cost from the constants and refuses a
cell that does not match. The addendum re-runs the exploratory grid of results §2 on the frozen
inputs under protocol v1.1 without any model or spend, and publishes
`docs/plans/budgeted-assembly-hr2-results.md` v1.1 with the host-overhead
curves beside the `O = 0` curves, as a separately versioned exploratory
extension. The frozen protocol, the frozen results and `report.mjs`'s
confirmatory selector (`O = 0`) are untouched: `host-v2` cells are excluded
from the confirmatory comparison by identity, and the decision of results
§1 is not re-opened. The constants are an approximate model, labelled so.

**Non-claims added:** that `_meta` is invisible to any particular client;
answer quality of compact refs; any budget number; the P-top-s1 policy as a
default.

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

## 17. U5c-2: one-hop relations and MOC channel (v0.11.1, audited and confirmed)

U5c-2 adds two independently selectable candidate sources to §13: `relations-one-hop-v1` and `moc-v1`. Their candidates enter §15 assembly through its existing internal search seam. Assembly policies, canonical evidence, metering and compact refs are unchanged.

No canonical schema change, table, trigger or relation-creation operation is added. Role/task reads and receipts belong to U5c-1; current-dependent invalidation belongs to U5c-3. MOC compilation and pending-change lifecycle require E1.

### 17.1 Opt-in and compatibility

- Host grammar:

  ```text
  --context-read context-read-v1
    --context-read-sources relations-one-hop-v1,moc-v1
  ```

- The new flag consumes one comma-separated value containing either or both IDs. Empty entries, duplicates, unknown IDs or use without `--context-read` refuse `invalid_mcp_configuration`. Programmatic MCP construction gains matching `contextReadSources`; core construction gains `contextRead.sources`, a nonempty array of distinct supported IDs.
- Only source-enabled construction advertises source capabilities, effective preset and additional limits. Without it, preserve bytes, ordering, presets, compact refs, errors, provider-call counts and `tools/list`, including under `--context-read context-read-v1`.
- Only source-enabled `findCandidates` and `contextRead` inputs gain optional `sources`; their MCP equivalents gain the same field. Omission selects every host-enabled source; `[]` disables them; other values must be a distinct subset of the host-enabled IDs. Source-disabled hosts retain their original strict schemas and refusals (`adapters/mcp/context-read-tools.mjs:42`).
- This extends §13’s host-fixed pattern by permitting narrowing only. The host fixes availability, preset, weights, caps, provider and read set. A call cannot enable an unconfigured source or change ranking parameters.
- `--check-config` reports the selected sources and preset only when opted in. It opens no database and constructs no provider or counter.
- Sources add no model calls. Existing semantic authorization, coverage preflight, transmission and spending rules remain unchanged.

### 17.2 Placement, bounds and continuation

- Form the pre-expansion list from lexical/semantic fusion, including MOC ranks when configured. Keep its top 24 as the **direct horizon**.
- Run relation expansion after fusion and before freezing or paging (`core/context-read-facade.mjs:333`). Seeds come only from this direct horizon. Additions never become seeds.
- Deduplicate against the entire direct horizon and earlier additions. Relations preserve every direct candidate’s membership, relative order and fusion score.
- Place each seed’s additions immediately after that seed, in seed order; append remaining direct candidates in their existing order. Assign consecutive candidate ranks. This exposes additions within the early positions that existing U5b policies visit, without changing a policy (`core/context-read-assembly.mjs:91`).

| Limit | Source-enabled value |
| --- | --- |
| Relation seeds | First ≤4 direct candidates |
| Additions per seed / call | ≤2 / ≤8 |
| Frozen horizon | ≤24 direct + ≤8 additions = ≤32 |
| Public page size | Default 12; maximum 24 |
| Assembly admitted bodies / fetch refs | Existing maximum 24 |
| Assembly candidate universe | ≤32; conservative `U≤544`, counter calls `2+2U+R≤1,634`, `R≤U` |
| Work per optional source | ≤50,000 charged work units; ≤8 MiB accounted state (charging model below) |
| Synchronous batch | Existing ≤128 rows / ≤2,000,000 text units |

- The 4/2/8 limits are constants of `relations-one-hop-v1`, never request knobs. Legacy horizon and counter-call announcements remain unchanged without source opt-in.
- Sources share the existing cooperative deadline. Check it between bounded batches. Relation work may retain a validated prefix; MOC contributes nothing unless its statistics and member ranking complete.
- Freeze once. Bind configured and requested source IDs, source versions, effective preset, source fences and resulting horizon into ranking/configuration bindings. Source-enabled cursor positions support 32; continuation never reranks or embeds. Existing page, retention, expiry and refusal rules remain.
- New source state and witnesses are request-local or retained with the existing in-memory ranking. This draft adds no persisted source data; sidecar format 1 remains (`core/context-read-sidecar.mjs:15`). Any later persistence requires a sidecar format bump, never canonical DDL.
- **Charging model (audit P1).** Use bounded indexed scan plans; never reuse organization pagination whose union sorts scope-wide records before `LIMIT … OFFSET` (`core/private-organization-storage.mjs:218`). Charge one work unit per authorized record visited, per repeated pass, per endpoint/projection check and per source-support lookup. Bound each materialized batch and account retained structures **before** growth (term maps and document entries included; `createBM25` materializes documents, `core/context-read-bm25.mjs:36`); document the byte-accounting model in code. Deadline checks occur between these bounded operations; a blocking SQLite call remains non-preemptible. On exhaustion, retain only a validated relation prefix and discard incomplete MOC scoring, with explicit incomplete coverage.
- **Retained state across rankings (audit P2).** Release scan corpora and temporary scoring state before retaining a ranking. Retain only bounded candidate identities, relation witnesses, source fences and diagnostics. An aggregate per-handle source-state budget of 16 MiB applies across retained rankings; when exceeded, evict the oldest rankings, producing existing `cursor_stale` behavior.

### 17.3 One-hop typed relations

`relations-one-hop-v1` runs only for `intent:'current'`; history reports `unavailable`, reason `unsupported_intent`.

| Priority / family | Traversal and reused mechanism |
| --- | --- |
| 1. `supports-decision` | Incoming and outgoing; revision- and receipt-bound rationale rows (`core/rationale-schema.mjs:3`) |
| 2. `challenges-premise` | Incoming and outgoing; same binding validation |
| 3. `contradicts` | Undirected, exact endpoint revisions (`core/conflict-storage.mjs:55`) |
| 4. `card-memory` | Card→bound Memory and reverse, through existing Memory bindings (`core/private-card-schema.mjs:58`) |

- Within each seed, order by family priority, then binary canonical `(owner,scope,project,type,id)` identity (`core/context-read-bm25.mjs:6`). Resolve remaining witness ties by direction, then stored edge/binding key. The first valid path wins.
- Deduplicate typed logical identity after validating exact revisions; a changed revision never becomes a substitute endpoint. Repeated receipts or paths do not create additional candidates.
- Every addition carries `via:{seed:<full revision-bound ref>,family,direction}`. Direction is `incoming|outgoing`, relative to the seed; contradictions use `undirected`; Card bindings are canonically Card→Memory. Relation-only candidates have null fusion score and null rank-channel entries.
- Check both endpoints for authorized namespace, requested type, exact revision, current eligibility and availability. Validate rationale receipt bindings/digests and Card Memory/receipt bindings; edge existence alone is insufficient (`core/rationale-storage.mjs:133`; `core/private-card-storage.mjs:125`).
- Reuse canonical eligibility, including Card support **and current applicability** (`core/private-evidence-storage.mjs:54`).
- Implement a bounded incident-edge reader. Do not call the decision-context walker: it follows challenges to supporting Memories, a second hop (`core/rationale-storage.mjs:127`).
- Exclude supersession, qualification, Raw/receipt provenance traversal, episodes, operational lineage and MOC siblings. Supersession retires its predecessor (`core/supersession-storage.mjs:60`). Receipt validation does not make receipts candidate endpoints.
- Preserve interpretation as proposed/unassessed. Relation existence does not confirm truth, applicability or adoption.

### 17.4 MOC rank channel

- Implement `core/context-read-moc.mjs` as a read-only adapter over existing Memory MOC and Card organization storage. Do not edit `topic-overview-*` or `memory-reader` files.
- Search valid titles of authorized Memory/Card topics for the requested types. Validate every original title-source binding; an omitted or stale binding cannot make a title valid (`core/moc-storage.mjs:32`; `core/private-organization-storage.mjs:47`).
- Respect Memory active-generation visibility and exact projected revisions; never bypass an unavailable projection (`core/index-schema.mjs:38`). Card organization tables are optional; never query absent tables.
- Include L1 members and L2 descendants through valid, revision-bound L2→L1 containment. Do not traverse reviewed cross-map mappings.
- Members must be current eligible Memory/Card evidence, even during a history search. Require exact topic, containment and member revisions, including Card body revision. Apply §13’s canonical current predicate rather than the organization reader’s weaker support-only predicate.
- Each valid typed topic is one title document. Compute T1 BM25 with §13 parameters over the complete authorized title corpus, including nonmatching titles (`core/context-read-tokenize.mjs:15`; `core/context-read-bm25.mjs:22`). Foreign topics enter no statistics.
- A member’s MOC raw score is the maximum score of its matching containing topics. Deduplicate members, sort descending score then canonical typed identity, and retain 12. Multiple memberships never multiply a member’s contribution.

| New preset | k | Depth per channel | Lexical / semantic / MOC |
| --- | --- | --- | --- |
| `rrf-k60-d12-moc-v1` | 60 | 12 | 0.45 / 0.45 / 0.10 |

- Configuring `moc-v1` fixes this preset at startup, for either provider family. Otherwise retain the existing preset selection.
- `score(x)=Σ weight/(60+rank)`; ranks start at 1. Union ≤36, direct horizon ≤24; ties use canonical typed identity.
- Disabled or unavailable channels contribute zero; weights never renormalize. The new preset still uses RRF when semantic or MOC is disabled. It does not take the existing lexical-only fallback (`core/context-read-fusion.mjs:25`). Existing presets and fallback behavior remain unchanged.
- Incomplete statistics, work/state limits, deadline expiry or unavailable required storage discard that MOC channel’s contribution and report degradation. Existing lexical failure remains `index_unavailable`.
- MOC membership never filters direct retrieval. Unfiled and MOC-omitted evidence remains eligible for lexical and semantic discovery.

### 17.5 Revalidation and diagnostics

- Authorize every namespace before source access, statistics or scoring. Use §14 deferred, `query_only` reads. No host callback or await occurs inside a transaction.
- **Source fences (audit P1).** Capture source fences for the complete consulted projection, including undelivered types and title-corpus dependencies: relevant namespace/Card epochs, Card MOC epochs, and Memory projection state represented distinctly as live-without-state-row, unavailable, or published generation ID (a first staged rebuild inserts `active_generation=NULL` without advancing the namespace epoch, `core/index-storage.mjs:78`). Compare these captured fences inside candidate-page delivery’s authoritative read and assembly’s final transaction; changes refuse `cursor_stale` or `snapshot_stale` respectively, and revocation remains `scope_changed`.
- Observe Card MOC epochs explicitly as organization dependencies. Public Card organization mutations also advance the ordinary Card epoch through the outer storage call (`core/private-card-storage.mjs:298`, `:302`). No new canonical writer hook is required for those operations.
- Recheck grants and fences after every await and before publication. Candidate-page delivery revalidates addition endpoints, seeds and witnessing bindings, including seeds absent from that page. Changed frozen dependencies refuse `cursor_stale`.
- Assembly preparation validates those same dependencies; unavailable additions count under `omitted.unavailable`. Its final transaction revalidates both endpoints and witnesses for admitted additions, including undelivered seeds. Changes after preparation refuse `snapshot_stale`; revocation remains `scope_changed`. No callback, count or await follows final reading (`core/context-read-facade.mjs:509`).
- Independent full-ref, compact-ref and snapshot fetches retain §§13/15.8 evidence semantics. Neither compact refs nor snapshots become durable discovery-path proofs.

Only opted-in calls add:

| Location | Diagnostics |
| --- | --- |
| `find_memory_candidates` | `value.trace.sources`, keyed by configured source ID; additions also carry item `via`; MOC ranks appear under item `channels.moc` |
| `read_memory_context` | Same source trace under `diagnostics.candidates.trace.sources`, carried only in `_meta['ink.cairn/context-read-diagnostics']` |
| Assembly snapshot | Existing `_meta['ink.cairn/context-read-snapshot']`; unchanged format and bounds |

- Each source reports `status:'ok'|'degraded'|'unavailable'` and bounded, enumerated reason codes: `disabled`, `unsupported_intent`, `unsupported_schema`, `index_unavailable`, `stale_source`, `deadline`, `work_limit`, `state_limit`, `capped`.
- Relations report `examined`, `rejected` by `revision|ineligible|unavailable|invalid_binding|type_excluded|duplicate`, `capped`, `added`, and at most eight `{ref,via}` records. Counters describe visited authorized records; unknown remaining work is `null`, never an invented total.
- MOC reports `topicsMatched`, `membersRanked`, completeness and `summaryFreshness:'unavailable'`, with `summaryFreshnessReason:'e1_seam_unavailable'`. Unknown totals are null. Valid titles establish no summary freshness.
- Filter foreign endpoints/topics before statistics, public counters and source work allowances. Foreign rejection counts are not exposed. Adding foreign fixtures changes no visible name, count, score or rank.
- An unavailable source never masquerades as exhausted empty search. Diagnostics contain no body/title/receipt prose, paths or credentials.
- §15.8’s metered text, serializer, compact refs and omission algebra remain unchanged. Diagnostics and snapshots add no text block or `structuredContent` (`adapters/mcp/context-read-transport.mjs:9`). Existing envelope bounds and client-contract limitations remain.

### 17.6 Ownership

- Worker-owned new runtime modules: `core/context-read-relations.mjs`, `core/context-read-moc.mjs`, `adapters/mcp/context-read-sources-configuration.mjs`, `adapters/mcp/context-read-sources-tools.mjs`.
- Worker-owned existing modules: `core/context-read-facade.mjs`, `core/context-read-input.mjs`, `core/context-read-fusion.mjs`, `core/context-read-sidecar.mjs`.
- Add dedicated tests/fixtures. Existing other-owner tests remain owner-managed. New MCP registration composes existing context tools; source-disabled registration stays unchanged.

Coordinator-owned paths, exactly:

| Path | Allowed integration |
| --- | --- |
| `core/index.mjs` | Exports |
| `adapters/mcp/cli.mjs` | Flag/configuration wiring |
| `adapters/mcp/server.mjs` | Configuration and registration |
| `packaging/artifact-files.json` | Shipped closure |
| `CHANGELOG.md` | Change record |
| `docs/plans/unified-memory-v1-contract.md` | This section |
| `docs/context-read-local.md` | Configuration and behavior |
| `docs/limitations.md` | Limits and non-claims |

The **12 existing ownership paths** were independently matched through `rg --files` and filesystem enumeration: **zero differences**. New CLI-reachable modules remain SQLite-free at link time.

### 17.7 Acceptance

Requirements below are not executed results. Use synthetic fixtures, real child processes, Node **22.16.0 and 24.15.0**, under the machine-wide queue.

| ID | Observable |
| --- | --- |
| C04 | A graph authored through public operations retrieves an endpoint missed by direct retrieval. Assert every family/direction, no second-hop expansion, 4/2/8 caps, ordering, dedup, stale endpoints, foreign exclusion and exact observed coverage/unknown remainder |
| C05 | Unfiled/MOC-omitted Memory and Card evidence remains directly discoverable. Independent T1/BM25/member-ranking/RRF oracle verifies scores, ties, channel toggles, zero contributions, no renormalization and degraded channels |
| C06 | Compare against pinned pre-U5c-2 wire fixtures or a frozen legacy control (not merely a same-commit control host). Use identical canonical store identity, clock, entropy and maintenance state for byte comparisons; list explicitly any separately compared telemetry fields (timings, ranking IDs, expiry). Cover default construction and `--context-read context-read-v1` without sources: `tools/list`, refusals, presets, limits, cursor encoding and compact-ref fetches. Existing §13/§15.8 assertions remain unmodified |
| C07 | Second-process correction, forget, deletion, Card support/applicability loss and witness removal between expansion and delivery never deliver stale additions. Include undelivered seeds, paged delivery, Card MOC epoch races and active-projection changes. Include races during counting: a first staged rebuild and an undelivered Card-topic dependency. Writers run with sources disabled (A16) |
| C08 | Foreign relations/topics change no visible names, counts, scores or ranks. Revoke at every await; spies observe no foreign scoring, title transmission or evidence access |
| C09 | Installed tgz exercises both sources. Independently derive import closure versus manifest and actual archive entries; diff both routes and print counts. Verify SQLite-free CLI linking, read-only no-file-creation behavior and unchanged canonical DDL |
| C10 | Re-run applicable §13/§15 gates; independent metering verifies expanded candidate bounds and unchanged admitted-item/snapshot limits. Report actual process/build/test exit codes; pipelines preserve producer status. Independently instrument work and state boundaries, large membership/title corpora through 10⁵ Memories, retained-state occupancy through the ranking-retention limit, and deadline stops, verifying available direct channels continue |

Measurements are observations: `findCandidates` p50/p95 at 10³ and 10⁴ Memories, sources off, each source alone and both; cold/warm, coverage, source work, state size and failures. Label fake-provider timings. Contention follows §16.

**Non-claims:** retrieval-quality improvement from either source; two-hop typed relation expansion; MOC summary freshness/A14; role profiles; invalidation. No HR evidence selects these sources as defaults; both remain off by default.

## 18. U5c-1: role profiles, role/task read and task receipts (v0.12.2, audited and confirmed)

**Status:** contract draft. Applies all eight findings from the audit of `3eedb920`, with the primary’s compact-receipt/file-continuation decisions. Implementation and acceptance remain outstanding; §18.7 reports serialization probes only. This packet depends on U2/U5b, independently of §17.

### 18.1 Representation and authority

Profiles are immutable versioned canonical records, parallel to U2 versions. This supersedes the Memory/Card representation in §2.2/§10: Card confirmation requires `explicit-user` authority (`core/private-card-facade.mjs:33`), while Memory correction overwrites content (`core/runtime.mjs:270`). Neither supplies direct agent enactment with historical profile reads. Related Memory/Card content remains canonical; narratives stay there. Profiles hold short structured duties and outputs.

- Core opt-in: `roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId,agentId}}`.
- MCP flag: `--role-profiles local-v1`, requiring existing method/context opt-ins with identical authorized read sets. Never union grants.
- Agents publish directly; publication immediately makes the release current. No confirmation/TTY step exists.
- Namespace, read set and attribution are host-supplied. Role names, profiles, methods and receipts grant no access or execution authority.
- Reuse §2.3’s synchronous `{authorize,isCurrent}` protocol. Exactly the three profile mutations use new `write` grants; the role read uses `read`. Existing U2 classes remain unchanged. `correct_memory` has no authority-port class (`adapters/mcp/server.mjs:495`).
- The complete pre-redaction mutation commitment binds both head expectations, all input and frozen host attribution. Supplemental namespace grants use `read`, `actionId:null`, `targetId:null`, `expectedRevision:null`, and the same commitment.
- Without the flag, existing tools/list, DTOs, defaults and supported-store behavior remain byte-identical; no U5c migration occurs. Validation of an already-upgraded v32 store is capability-independent.

### 18.2 Types and limits

All schemas below are closed; omitted optional fields alone are accepted. `N` means positive safe integer, `Z` nonnegative safe integer, `Id` the existing identifier grammar, and `MAC` exactly 43 base64url characters. Namespaces, MethodPackageRefs, MethodVersionRefs, Memory/Card refs and U2 reason refs retain their existing closed schemas.

```text
ProfileRef = {type:'role-profile',namespace,profileId:Id,roleKey}
ReleaseRef = {type:'role-profile-release',profile:ProfileRef,
              releaseId:Id,contentIdentity:MAC}

FieldsInput = {duties:[Text],requiredOutputs:[Text],
               methods?:[MethodPackageRef],related?:[MemoryRef|CardRef],
               appliesTo?:Text}
ReasonInput = {text:Text,reasonRefs?:[U2ReasonRef]}

Registry = {namespace,roleKey,ref:ProfileRef|null,
            state:'absent'|'active'|'disabled',
            currentRelease:ReleaseRef|null,revision:N|null}
```

Normalized `Fields` always contains all five fields; optional lists default to `[]`, `appliesTo` to null. Absent registries have null ref/current/revision. Existing disabled barriers may have null current release and a **positive** revision.

| Limit | Value |
| --- | --- |
| Role key | 1–200 ASCII units, U2 grammar without `*`/null |
| Host actor/agent identifiers | Each 1–200 UTF-16 units |
| Duties / required outputs | Each 1–8 entries; each entry ≤300 UTF-16 units |
| Methods / related refs | Each ≤16 distinct refs |
| `appliesTo` / reason text | Each ≤500 UTF-16 units |
| Reason refs | ≤16; obey §2.3 reason-namespace rules |
| Release input / retained payload | Each ≤32,768 UTF-8 bytes |
| Profiles per namespace / releases per profile | 256 / 128, including tombstones |
| Retained payload per owner | 50,000,000 UTF-8 bytes |
| History page | ≤20 releases, additionally budget-bounded |

Text is nonblank, valid Unicode and NUL-free. Enforce pre/post-redaction bounds; identities cover persisted bytes. Methods name packages, never versions. Related refs never expand scope or copy bodies. Limits follow U2’s counts (`core/method-package-input.mjs:13`); storage capacity does not guarantee deliverability.

### 18.3 Writes, CAS and resolution

Let `W` be the closed common input:

```text
W = {namespace,roleKey,actionId:Id,
     expectedCurrentRelease:ReleaseRef|null,
     expectedRegistryRevision:N|null}
```

| Core method / MCP tool | Closed input; success value |
| --- | --- |
| `publishRoleProfileRelease` / `publish_role_profile_release` | `W + {fields:FieldsInput,changeReason?:ReasonInput}` → `{registry:Registry,release:ReleaseRef,ordinal:N,createdAt:UTC}` |
| `disableRoleProfile` / `disable_role_profile` | `W` → `{registry:Registry}` |
| `deleteRoleProfileRelease` / `delete_role_profile_release` | `W + {release:ReleaseRef,expectedRevision:N}` → `{registry:Registry,release:ReleaseRef,state:'deleted',revision:2,purgedBytes:Z,eventCount:1}` |

Refs must match the input namespace/role/profile. A null expected registry revision means absence and requires null expected current. Existing disabled/no-release barriers use their exposed positive revision plus null current.

Grant bindings:

| Operation | `targetId` | Grant `expectedRevision` |
| --- | --- | --- |
| Publish / disable | Input `roleKey` | `expectedRegistryRevision` |
| Delete | `release.releaseId` | Release `expectedRevision` |
| Role read, including file | null | null |

Both head expectations remain bound in the complete input regardless of the scalar grant field (`core/private-card-facade.mjs:7`).

- Authorization precedes replay lookup; exact replay precedes mutable existence checks. Changed payload under one action ID gives `action_conflict`.
- Every committed publish, disable **or release deletion** increments the registry revision and namespace generation once and records its transition atomically. Exact replay changes neither events nor quota.
- Publication appends immutable content with host actor/agent attribution and core timestamp. Restore publishes a new release with earlier content. Disable is explicit withdrawal and may create a barrier without a release.
- Deleting any release advances registry CAS, even for a historical release. Deleting current retains its pointer as an unavailable barrier, paralleling package revision changes (`core/method-package-storage.mjs:169`).
- Project precedes personal for the same role key; first existing state decides. Disabled/deleted-target states block fallback (`core/method-binding-storage.mjs:46`).
- `no-profile` means all authorized levels are absent. `unresolved` is reserved for a future explicit conflict representation and cannot occur in valid v32 stores. Malformed canonical state fails validation.
- Each referenced package uses unchanged U2 resolution. Import never adopts; no upload-time winner or wildcard profile exists.

### 18.4 Canonical v32 and migration

Allocate v32; no task-receipt table exists.

- `role_profiles`: opaque PK, unique namespace/role, active/disabled head, positive revision/next ordinal, timestamps and composite current-release FK.
- `role_profile_releases`: opaque PK, parent FK, unique profile/ordinal and composite release identity, predecessor ref, available/deleted lifecycle revision 1/2, canonical payload and byte charge. Composite/deferred FKs preserve profile membership and atomic first publication.
- `role_profile_changes`: unique destination, exact from/to refs, canonical reason payload and charge; reasons belong only to their recorded edge.
- `role_profile_operations`: namespace/action PK, method, commitment and content-free mutation outcome. This §7 ledger cannot recover task receipts.
- `role_profile_events`, `role_profile_epochs`, `role_profile_owner_usage`: content-free ordered transitions, generations and atomic quota. Index profile history and namespace events by ordinal.
- All tables are STRICT. CHECKs/guards enforce namespace/state shapes, bounds, immutable keys and monotonic revisions. Available content is immutable; only terminal purge is permitted.
- BEFORE INSERT guards cover every unique key and hidden rowid, including ledger/events, alongside UPDATE/DELETE guards. Test `INSERT OR REPLACE` with `recursive_triggers=0` (`core/asset-schema.mjs:194`).
- Charge UTF-8 bytes of canonical persisted release payload `{fields,actorId,agentId,createdAt}` and each separate reason payload `{text,reasonRefs}` **once**. Exclude identity/index/ledger/SQLite overhead. Deletion decrements exactly the purged charges atomically.
- Purge duties, outputs, scope note, reference lists, attribution labels and change prose at **either** deleted endpoint. Tombstones retain only opaque identities/refs, revisions, ordinals, timestamps and counts. They cannot disappear or resurrect.
- Related-source eligibility, revisions and forget/exclusion fences are checked on delivery. Source-derived copies are unsupported; receipts/comparisons cannot reconstruct purged content.

Follow §12.1: explicit ordinary-writer migration, prerequisites → v30 → v31 → v32, in one rollback-safe transaction (`core/method-package-migration.mjs:13`; `core/database.mjs:398`, `:671`). Install schemas without granting capabilities/capture. Support fresh and supported populated v18/v20–v31 stores; refuse v19. Roll back data, identity, DDL and `user_version` on failure.

Readers/managed openers validate only. Add `schema32-existing-v1`, preserving older option semantics. Validate complete prerequisites/v30/v31/v32 irrespective of flags; reject premature role artifacts and partial/altered layouts without repair.

Update ordinary/managed/read gates, asset-selected managed checks, local preflight/setup/permission and setup wording (`core/database.mjs:37`, `:367`; `core/existing-store.mjs:12`, `:83`; `core/read-database.mjs:29`; `adapters/local/configuration.mjs:80`; `integrations/client/raw/local-setup.mjs:62`; `local-host-permission.mjs:28`; `local-setup-cli.mjs:15`). Preserve exact asset-trigger validation (`core/asset-schema.mjs:314`); added triggers on U2/U4 tables require explicit version-aware expected sets. Freeze the old installed closure and stop mixed-version writers before upgrade.

### 18.5 Closed read contract and applicability

`readRoleTaskContext(input,authority)` / `read_role_task_context` is the single read interface. Common core fields are `readSet`, optional `budget:{maxTokens?,maxItems?}` and `deadlineMs?`. MCP injects readSet and rejects authority/configuration overrides.

| Mode | Additional closed fields |
| --- | --- |
| `now` | `{mode:'now',roleKey,task?,history?}` |
| `then` | `{mode:'then',receipt,history?}` |
| `refresh` | `{mode:'refresh',receipt,task?}` |
| `compare` | `{mode:'compare',roleKey,from:ReleaseRef|MethodVersionRef,to:same-family-ref,cursor?}` |
| `file` | `{mode:'file',receipt,package:MethodPackageRef,path,range?:{start:Z,end:Z}}` |

`task` follows U5b’s ≤4,000-unit query grammar; semantic search remains disabled by default. `history={profile:ProfileRef,limit?:N≤20,cursor?}` is allowed on now/then, including disabled registries. Cursors are ≤8,192 units and bind request/profile/generations.

Core success is `{ok:true,value:{metered,diagnostics}}`. Diagnostics reuse §15.8.4, with candidate diagnostics null when no search occurs. The metered object always contains:

```text
{framing,mode,registries:[Registry],profile:{applicability,release:Release|null},
 methods:[MethodView],evidence:[§15.8-v2-item],history:History|null,
 comparison:Comparison|null,file:File|null,receipt:string|null}

Release = {ref:ReleaseRef,ordinal:N,basedOn:ReleaseRef|null,
 state:'available'|'deleted',revision:1|2,createdAt:UTC,
 actorId:Id|null,agentId:Id|null,fields:Fields|null,changeReason:Reason|null}

MethodView = {package:MethodPackageRef,status:U2ResolutionStatus,
 version:MethodVersionRef|null,adoptionStatus:U2AdoptionStatus|null,
 manifest:{format:'text-v30'|'mixed-v1',fileCount:N,textBytes:Z,binaryBytes:Z}|null}

History = {profile:ProfileRef,rows:[Release],nextCursor:string|null}
Reason = {status:'not-recorded'|'available'|'recorded-unavailable',
 text:Text|null,refs:[{ref:U2ReasonRef,status:'available'|'unavailable'}]}
Comparison = {kind:'profile'|'method',from,to,status:'available'|'unavailable',
 changes:[{key,status:'added'|'removed'|'changed'|'unchanged'}],
 items:[{summary,paths}],reason:Reason|null,nextCursor:string|null}
File = {version:MethodVersionRef,path,kind:'text'|'binary',mediaType,
 contentIdentity:MAC,totalBytes:Z,totalUnits:Z|null,
 parts:[{start:Z,end:Z,text}],nextRange:{start:Z,end:Z}|null}
```

Method comparisons retain U2 item/reason bounds and semantics; profile keys are the five Fields names. Comparisons require a stored predecessor edge. Missing reasons display “reason not recorded”; none are inferred. Deleted releases have null fields/attribution/reason; unavailable file/comparison projections deliver no content.

- `now` resolves current content; `refresh` re-resolves the **whole** set and issues a new receipt ID. `then` preserves original identities. Then/file return the original receipt unchanged; it describes original issuance, not later optional projections.
- Profile applicability is separate: `current` for the available winning release, `newer-release-available` for a different available winner, `withdrawn` for a disabled winner, `unavailable` for unavailable selection/target. Absence is `no-profile`; `unresolved` remains reserved. Historical bytes are never presented as applicable current guidance.
- Each method independently retains U2’s adoption statuses. Receipt role/read-set context is always supplied; then/file cannot silently return `unassessed` (`core/method-binding-storage.mjs:99`).
- File mode selects only the receipt’s exact package/version. Internally reuse U2 history verification with that context, without calling separately budgeted public reads. It may omit profile body and unrelated method views.
- Text ranges are half-open, code-point aligned and ≤4,000 UTF-16 units; default is the first U2-sized page. Explicit out-of-bounds ranges refuse; `nextRange` advances within the same immutable version.
- Binary file mode returns metadata, empty parts and null nextRange; it additionally requires configured U4 read authority bound to this file request. No binary bytes are inlined.
- Direct U2/U3 reads remain available independently; embedded pins and the former pin/snapshot continuation recipe are removed.

Failures use `{ok:false,error:{code,retryable,details?}}`, existing §7/U5b codes plus `invalid_receipt` and `budget_insufficient`; only `storage_busy` is retryable. Budget details are closed `{partial:true,maxTokens,requiredTokens,requiredBytes:{receipt,core,transport}}`. Other failures omit details.

### 18.6 Normative receipt grammar

The receipt is a **canonical JSON string**, not base64 or a U2 pin:

```text
receipt = C({v:'task-receipt-v1',p:Payload,mac:MAC})
Payload = {id:Id,readSet:[Namespace],roleKey,
           profiles:[P],heads:[H],methods:[M],evidence:[E]}
P = [namespaceIndex,profileId,releaseId,contentIdentity,lifecycleRevision]
H = [namespaceIndex,profileId|null,registryRevision|null,
     'active'|'disabled'|null,profileReleaseIndex|null]
M = [namespaceIndex|Namespace,packageId,U2ResolutionStatus,
     [versionId,manifestIdentity]|null,winningLevel|null,[B],L|null]
B = [level,bindingRevision|null,'active'|'disabled'|null]
L = [packageRevision,'available'|'deleted',
     versionRevision|null,'available'|'deleted'|null]
E = [EvidenceRefTuple,itemFence:MAC,[S]]
EvidenceRefTuple = [namespaceIndex,0,memoryId,revision]
                 | [namespaceIndex,1,cardId,revision,bodyRevision]
S = [canonicalSourceIndex,receiptId,contentIdentity,
     null|'body'|[earlierItemIndex,earlierSourceIndex]]
```

- `C` recursively sorts object keys by UTF-8 bytes, preserves array order and uses compact `JSON.stringify`; encoding is UTF-8 without BOM. MAC excludes `mac` and covers the canonical payload through `keyed(secret,'task-receipt-v1',[storeId,canonicalPayload])` (`core/private-card-input.mjs:90`). `secret` is the existing store’s `cursorSecret`. `canonicalPayload` is the recursively key-sorted **object**, not its serialized string; the helper serializes it. Serialize the outer receipt with `C`. Freeze one expected MAC/receipt byte vector in tests.
- **Inaccessible package (audit round 2, P1).** When unchanged U2 resolution returns `unavailable` for a package whose namespace is outside the authorized read set (for example a project binding to an owner-personal package read by a project-only host; `core/method-binding-storage.mjs:62`), `M` carries that package’s closed `Namespace` object instead of a read-set index, and `L` is null. Preserve the original package identity and return `unavailable` without target lookup. Such reference namespaces never join the authorized read set, and `file` continuation delivers no content for that entry.
- Parse receipt bytes ≤32,768 before JSON parsing; use nonrecursive lexical preflight to reject duplicates, excessive depth/nodes, then closed-shape validation before canonical recursion. Bounds: depth 12, nodes 8,192, decoded scalar strings ≤200 UTF-16 units; integers are safe, nonnegative, with positive revisions.
- Read set has one/two canonical §15.8 namespaces. Profiles are distinct, ≤21: primary first, then delivered history order. Heads are the consulted project→personal prefix, ≤2; absence has four null fields.
- Methods are distinct, ≤16, in profile method order. Compact refs expand using their package namespace/IDs. Levels 0–3 mean project-role, project-wildcard, personal-role, personal-wildcard. B is the exact applicable consulted prefix, ≤4; logical binding identity derives from level/package/role. Absence has null revision/state; winner is the first existing level, or null.
- Status, target and lifecycle must agree. Current requires an available target; disabled/no-active have null target. Unavailable may retain the exact unavailable target identity.
- Evidence is delivered order, ≤24. Sources are actually delivered canonical receipt refs, ≤16 per Memory, ordered by canonical source index 0–15; Cards have none. Parent Memory supplies namespace/id/revision/completeness. Alias targets must be earlier concrete sources; no chains or body-alias targets.
- Full fences reuse canonical item fencing, not 48-bit compact prefixes. Authenticate with constant-time full-MAC comparison, validate canonical encoding and all index/ref agreements. Foreign/malformed/tampered receipts refuse before canonical lookup. Scope mismatch refuses authority.
- Fresh authorization is mandatory. No obsolete issuance generation must match across calls; between-call changes affect applicability/availability, not identity. Lost receipts cannot be recovered; no lookup/revocation table exists.

### 18.7 Budget, measurements and final validation

One outward call, one authorization commitment and one cooperative deadline cover preparation, counting and delivery: default 1,000 ms, maximum 5,000 ms. Recheck grants after awaits and before final reading.

Reserve framing, complete required profile fields, scope note, identities, every package/status/manifest summary and receipt first. Then admit optional history/evidence through U5b internals, one task horizon, ≤24 evidence items and 16 sources/item. Never compose independently budgeted public calls.

The exact counter measures `C({ok:true,value:metered,evidenceTrust:'untrusted-data-not-instructions'})`, including the escaped receipt string. Rebuild receipt per trial. Token range is 64–4,000; **role default is 4,000**. Mandatory overflow returns measured `budget_insufficient`, no guidance/new receipt, never omitted packages. File ranges must fit whole. Independently enforce 32,768 receipt bytes, 65,536 core bytes and 262,144 transport bytes.

`2+2U+R` counts all optional units, including history/comparison; `R≤U`. Context/history U≤428; comparison U≤560; maximum 1,682 counter calls. Counters run outside transactions.

Real `o200k_base` wire probes on Node 22.16.0 and 24.15.0 agreed; both exited **0**:

| Packages | Receipt bytes | Tokens of `C({receipt})` | Receipt token delta¹ | Mandatory tokens² |
| --- | ---: | ---: | ---: | ---: |
| 1 | 763 | 378 | 373 | 1,950 |
| 4 | 1,456 | 726 | 721 | 3,033 |
| 16 | 4,228 | 2,132 | 2,127 | 7,395 |

¹ Complete-text difference replacing receipt null with the string.
² Eight 300-unit duties plus eight 300-unit outputs, no optional evidence.

Reproduction recipe, using the schemas above:

- `H(n)=SHA256(String(n)).base64url`; `I(n)` uses its hex digest `h`: `h[0:8]-h[8:12]-4h[13:16]-8h[17:20]-h[20:32]`.
- Namespaces: owner `"owner"`, personal then project `"project"`; role `"finance"`. Profile/release IDs I(1)/I(2), release identity H(2), receipt ID I(3).
- Package i=0…n−1: package I(10+i), version I(100+i), identity H(100+i), personal wildcard winner 3; B=`[[0,null,null],[1,null,null],[2,null,null],[3,1,'active']]`; L=`[2,'available',1,'available']`.
- P=`[0,I(1),I(2),H(2),1]`; heads=`[[1,null,null,null,null],[0,I(1),1,'active',0]]`; evidence empty. MAC secret is `"0".repeat(64)`, store ID `"store"`.
- Field text j=0…15 is `("Item "+j+": "+"Review records and report decisions with source references. ".repeat(8)).slice(0,300)`. First eight are duties; remainder outputs. Related is empty; appliesTo null.
- Release ordinal/revision 1, predecessor/reason null, actor/agent `"actor"`/`"agent"`, creation `2026-10-24T00:00:00.000Z`. Registries reflect those heads; method views are current with manifest `{format:'text-v30',fileCount:1,textBytes:1,binaryBytes:0}`. Mode now; history/comparison/file null; framing is §15’s fixed sentence.

**Objection to unconditional maximum-field fit:** unchanged UTF-16 limits (`docs/plans/unified-memory-v1-contract.md:2040`) cannot guarantee a tokenizer bound. Replacing each probe text with `"\uE000".repeat(300)` gives **11,865 tokens** for four packages. Thus 4,000 fits the frozen maximum-length English fixture, not every legal Unicode payload. Sixteen-package and Unicode overflows must refuse as measured.

Freeze the complete result before one authoritative deferred/query-only transaction. Revalidate selection/absence, releases/lifecycles, bindings/targets/status observations, evidence/fences, **all history rows, comparison endpoints, exact change edges and reason availability/exclusions**. File mode additionally revalidates exact version lifecycle, manifest/file identity and selected bytes; binary metadata checks ownership/identity.

Any preparation-to-final difference gives `snapshot_stale`; revoked grants give `scope_changed`. No automatic retry/repeated embedding. No counter, callback or await follows final reading (§15.5/§15.8; `core/context-read-facade.mjs:509`).

### 18.8 Ownership and acceptance

Worker-owned: `core/role-profile-*.mjs`, `core/role-context-*.mjs`, `core/task-receipt.mjs`, `adapters/mcp/role-profile-*.mjs`, packet tests/fixtures.

Coordinator-owned, with minimal integration edits:

- `core/{database,existing-store,read-database,index,contract}.mjs`: options, migration, validation, exports.
- `adapters/local/configuration.mjs`, `integrations/client/raw/local-{setup,setup-cli,host-permission}.mjs`: v32 checks/wording.
- `adapters/mcp/{cli,server}.mjs`: flag, attribution, registration, transport.
- `packaging/artifact-files.json`, `CHANGELOG.md`, `docs/*`: closure/documentation.
- `core/runtime.mjs`, `core/method-{package,binding}-storage.mjs`, `core/context-read-{facade,assembly}.mjs`: internal shared-read seams. `core/asset-schema.mjs` and `adapters/mcp/asset-access.mjs` only for required validation/metadata grants.

Keep CLI links SQLite-free; imports reaching SQLite occur inside functions. No `createRequire` concealment or edits to other owners’ tests.

Acceptance uses synthetic fixtures, real child processes and installed tgz entries on **Node 22.16.0/24.15.0**, under the machine-wide queue.

| ID | Observable |
| --- | --- |
| C01 | COO/CTO/finance direct publication survives restart with exact fields/attribution. CAS exposes disabled/no-release revisions. Restore, barriers and history work; foreign owner/project fixtures confer no access |
| C02 | Offline §6.2 steps 1/4/5/6/7: unadopted finance v2 leaves v1; adoption/restart yields v2; then retains v1 with labels; project-v1/default-v2 coexist; COO/CTO unchanged; refresh replaces the whole receipt. Sourced comparisons and missing reasons are correct |
| C03 | Independent serialization/token/byte recount, byte-exact MAC fixtures, parser boundaries, alias/index substitution, foreign/tampered/revoked receipts and measured overflow; no receipt recovery |
| C04 | v29–v31/prerequisite/fresh migration and rollback; partial-state rejection. Publish/disable/delete/current-delete and owner-quota races. Exact replay after deletion preserves quota/events; changed input conflicts. Every unique-key/rowid replacement attack runs with recursive_triggers=0 |
| C05 | Legacy flag-off bytes; validation-only readers; frozen old installed binary rejects v32. Feature-off writers preserve guards/source fences. Race every final-validation phase, including reasons/history/comparison; prove no subsequent callback/count/await |
| C06 | Mechanically derive manifest/import closure and independently enumerate tgz contents; diff, print counts. Cross-check changed paths by git diff and independent tree comparison. Report actual process/build/test exit codes |
| C07 | Receipt file continuation preserves exact text/manifest/attachment bytes and independent hashes **while available** across adoption, withdrawal and restart; after deletion or revoked access it delivers no content, including authorized U4 continuation attempts. Binary bytes are checked through authorized U4 reads of the returned exact version. A second-process switch between then/file never mixes versions. A project-only host reading a project profile that references an owner-personal package receives that entry as `unavailable`, with no target lookup and no read-set widening |

Observe now/then p50/p95, receipt sizes, counter calls and event-loop delay; use §16 paced contention gates, labelled unpaced stress.

**Non-claims:** U5c-3 current-dependent Card/representation invalidation; U5c-2 relations/MOC; live sessions/cross-agent smoke; authoring UI; engine receipt lookup; any quality claim.

**Primary note (author objection accepted):** existing agent-writable MCP tools such as `correct_memory` call core directly and have no authority-port action class (`adapters/mcp/server.mjs:495`). §18 therefore introduces role-specific `write` grants on the §2.3 authority port; agent publication stays direct, with no user confirmation (product decision, 2026-10-24). The 4,000-token role default fits the maximum-length English fixture with four packages; larger or non-Latin payloads refuse with measured `budget_insufficient` (§18.7).

## 19. U5c-3: current-dependent invalidation (v0.13.1, audit round 1 applied)

**Status:** applies all three P1 and two P2 findings from the audit of `ac85f144`, plus the primary’s accepted compatibility decisions. Implementation and acceptance remain outstanding. §§17/18 remain frozen.

A confirmed Card may declare that its authored content describes the current method for a role and authorized read-set context. Changed adoption makes that Card `needs-review` for current use until explicit revalidation. Existing Card retention rules govern its authored body.

### 19.1 Opt-in and authority

- Core gains `privateCards.currentDependencies:{version:'card-current-dependencies-v1'}`. Authoring requires configured method packages. This belongs under private Cards because declaration/revalidation follow Card confirmation authority; role profiles are unnecessary.
- MCP gains `--private-card-current-dependencies local-v1` and corresponding programmatic configuration, requiring existing Card/method opt-ins. The host fixes the permitted read set. `--check-config` opens nothing.
- Without opt-in, add no migration, authoring methods, tools or capability fields. Preserve legacy bytes, defaults, ordering, errors, prompts and provider-call counts on stores **without declarations**, including across method mutations.
- When declarations exist, every current read applies their canonical comparison regardless of the reader’s opt-in. Disabling authoring never disables existing fences.
- Declaration/revalidation require **`explicit-user`**, following `core/private-card-facade.mjs:33–36`. Authorize every consulted namespace separately and bind the complete payload. Profiles, role names, method text and snapshots grant nothing.
- §18’s direct agent enactment applies only to role profiles, not Card confirmation, declaration or revalidation.

### 19.2 Declaration and recorded dependency

One Card declares one normalized U2 context `{readSet,roleId}` and **1–16 distinct package dependencies**. Its namespace and every package namespace must belong to that authorized context.

Opted-in `confirmCardDraft` gains optional `currentDependencies`: context and package entries with authenticated, reviewed U2 resolution snapshots. Persist against the resulting confirmed Card revision atomically.

| Core operation | Input beyond common fields |
| --- | --- |
| `declareCardCurrentDependencies` | Context and complete package/snapshot list; creates or explicitly replaces a confirmed Card’s declaration |
| `revalidateCardCurrentDependencies` | Fresh reviewed snapshots for exactly the declared context/packages |

Common fields: `namespace,cardId,actionId,expectedRevision,expectedDependencyRevision`. The dependency expectation is null only for initial declaration; otherwise positive CAS. Unknown fields refuse.

The reference-only record contains dependency revision; observed Card/body revisions; role/read-set context; package refs; the exact consulted U2 prefix; and resolved immutable version refs with required availability observations.

Each consulted level records logical identity, revision, state and target, **including null revision/state for absence**. Identity includes binding namespace, package and role/wildcard key. Declaration requires an available `current` winner. Core derives observations canonically and verifies reviewed snapshots; caller assertions are insufficient. Bound the stored vector to 32,768 UTF-8 bytes.

Store no Card, method, source or reason prose. Generations schedule reconciliation; they do not alone invalidate a declaration. Importing unadopted v2 leaves adopted-v1 currentness intact.

### 19.3 Detection, predicates and diagnostics

Every consumer treating a declared Card as current compares its record with fresh U2 resolution **inside its existing transaction**. Use an internal synchronous seam, without nested transactions or public facade calls.

Compare Card/body revisions, consulted identities/revisions/absence, winning target, immutable version identity and availability. Any mismatch fails currentness. Same-version re-adoption and v1→v2→v1 remain mismatches because binding revisions advance.

Cover Card detail/list support; exact-namespace evidence; sidecar eligibility and candidate pages; assembly and all fetch forms; relation seeds/endpoints/witnesses; MOC members/title sources; organization; and role guidance/evidence. Disabled/unavailable winners remain barriers. Existing support and revision-bound applicability remain independent requirements.

**Distinct intents:** related Cards supporting **current role guidance** receive the dependency gate in addition to existing role-related checks. Recorded historical adoption/change reason refs retain exact-revision/source-availability semantics: adoption alone does not erase provenance availability. Use separate internal predicates or an explicit intent; do not globally tighten `reasonAvailable` (`core/method-package-storage.mjs:86`, `core/role-context-facade.mjs:86`, `core/role-profile-storage.mjs:27`).

For fully authorized declarations, add bounded `support.currentDependency` metadata: dependency revision, declaration context, `status:'current'|'needs-review'`, reasons, described versions and readable current versions. Include it in canonical item fences and existing metering. `needs-review` is an effective currentness result, not a Card lifecycle state.

| Reason | Meaning |
| --- | --- |
| `binding_changed` | Consulted identity/revision, winner, target or observed Card/body revision differs |
| `binding_absent_now` | Required resolution now has no binding |
| `binding_disabled` | Winner is disabled |
| `version_deleted` | Described or required version/package is deleted |
| `access_revoked` | Required access cannot be established |

When the **complete declaration context is not authorized**, the dependency projection contains **only** Card-local dependency revision, `needs-review` and `access_revoked`. Omit context, package/version identities, per-dependency entries and counts. Historical labels obey the same filtering. Never widen the caller’s read set or probe denied namespaces to produce diagnostics.

Return authorized reasons deterministically. Mid-operation revocation retains `scope_changed` precedence. Preparation-to-final changes retain existing stale-result errors. Independent evidence fetches preserve frozen generation formats and eligibility/fence error precedence.

**No writer callback, event consumption or cleanup establishes correctness.** Reads derive currentness and never persist `needs-review`.

### 19.4 Freshness, deadlines and bounds

Method adoption does not advance Card epochs. Dependency-aware sidecar publication, rankings and organization continuations must additionally observe authorized method/binding/lifecycle fences and dependency revisions. Legacy freshness stamps cannot authenticate dependency-aware projections.

Reconcile before statistics, ranking or publication; post-ranking filtering alone is insufficient. Incomplete reconciliation retains existing rebuilding/unavailable behavior. Restart/rebuild consult canonical dependencies. With no declarations, method mutations must not introduce dependency-related wire or continuation changes.

- Per examined Card/pass: one indexed dependency-record lookup, ≤16 U2 resolutions and **≤64 binding probes**.
- Across `C` Cards and `P` passes, dependency-record/binding probes total ≤`65PC`. Lifecycle, identity, manifest and existing source-support work are additional and explicitly charged.
- Retain U2 metadata verification: ≤256 manifest entries per resolution plus applicable U4 ownership checks. No method-body reads merely for currentness.
- Memoization is transaction-local. Charge repeated passes, metadata bytes and every support/target lookup under §§13/15/17/18 budgets. Preserve §17’s 32-candidate horizon and 24-item admission cap.

Deadline expiry stops further **optional** search, comparison and admission work. Reserve and account for complete bounded final dependency validation before admitting an item. The required final metering and authoritative read still run after expiry under frozen §§15/18. An incomplete comparison never establishes currentness; expiry alone does not invalidate a comparison completed by that final read. Report `stops.deadline` as existing contracts require.

Preserve transaction ownership and §14 discipline. No host callback/await occurs inside canonical transactions; no counter, callback or await follows authoritative final validation. Read-only/managed paths perform no migration or cleanup.

### 19.5 Revalidation and history

Explicit review covers the exact Card and fresh resolutions. In one write transaction, verify Card CAS, dependency CAS, reviewed snapshots, confirmed state and source fences; replace observations and increment dependency revision.

Standalone declaration/revalidation changes **neither Card revision, body revision nor text**. It advances the Card epoch and records a content-free operation outcome. Successful revalidation removes only the dependency gate.

Edits never silently clear or refresh declarations. Correct the finance Card through existing explicit Card editing/confirmation, then revalidate that revision. Explicit review may also attest unchanged content; core judges no semantic accuracy.

Apply §7 replay-before-mutable-checks and `action_conflict` rules. Changed Card, dependency or reviewed resolution refuses atomically with `revision_conflict`.

Stale Cards remain qualified history with authorization-filtered version labels. Undeclared historical-fact Cards pinned to old versions are unaffected by adoption. Source invalidation retains authored bodies where existing rules permit, while blocking unsupported current use.

Card editing adds no archive: overwritten revisions remain unrecoverable. §18 receipts preserve existing identity/fence rules and may omit changed evidence. Deleted versions/revoked sources remain unavailable under §§6/18; dependencies, receipts, caches and rebuilds cannot reconstruct purged content.

### 19.6 Canonical v33 and migration

Allocate **v33** without changing frozen v32 definitions.

Install STRICT `card_current_dependencies`. Declare **`card_id` PRIMARY KEY and FOREIGN KEY REFERENCES `private_cards(id)`**. Store namespace, positive dependency/Card/body revisions, normalized context and bounded canonical vector; index namespace/Card lookup.

Guards require a confirmed parent and **exact parent namespace agreement** on admission and replacement/update. Persisted-row validation verifies that agreement. Captured Card/body revisions are observations, not foreign keys to mutable revisions; legitimate stale observations remain valid stored state.

CHECKs/guards enforce closed shapes, package/version agreement, distinct dependencies, limits and consulted prefixes. UPDATE preserves identity/rowid and advances dependency revision exactly once. BEFORE INSERT guards cover every unique key and hidden rowid, including `INSERT OR REPLACE` with `recursive_triggers=0`. DELETE is allowed only through terminal purge. Parent mutation/replacement cannot strand or resurrect dependencies.

Card deletion/cancellation atomically purges dependency rows, including feature-off deletion; parent tombstones remain. Preserve existing source/forget fences.

Follow §12.1: explicit ordinary-writer prerequisites → v30 → v31 → frozen v32 → v33 in one rollback-safe transaction. Support fresh and supported populated v18/v20–v32 stores; refuse v19. Install prerequisite schemas without enabling features. Roll back identity, data, DDL and `user_version` together.

Add `schema33-existing-v1`. Every opener validates FK definitions/checks, indexes, guards, persisted parent agreement and complete prerequisites independently of capability flags. Readers/managed openers validate only; reject premature, partial, orphaned, mismatched or altered layouts without repair. Update every v32 gate, asset-selected managed check, preflight/setup/permission check and wording; preserve older option semantics, frozen role definitions and exact asset-trigger validation.

Frozen pre-v33 binaries **refuse v33** (`core/database.mjs:410`, `core/existing-store.mjs:87`). Stop mixed-version writers before upgrading. Compatibility acceptance tests old-binary refusal and **new-binary feature-off adoption** separately.

### 19.7 MCP and ownership

Opted-in declaration/revalidation MCP entries always refuse `approval_required`, like Card confirmation. Extend independent local `review-card` terminal review to confirmed Cards, complete authorized dependency details and both CAS expectations. Re-read after interaction and verify reviewed resolutions during commit. No tool claim, `--yes`, environment switch or protocol stdin grants approval.

Worker-owned new modules: `core/card-current-{input,schema,storage,facade}.mjs`, `adapters/mcp/card-current-{configuration,tools}.mjs`, and dedicated tests/fixtures.

Coordinator-owned candidates, **38 existing paths**, cross-checked through `rg --files` and filesystem enumeration, zero differences:

- `core/{database,existing-store,read-database,runtime,contract,index,context-reader,asset-schema}.mjs`
- `core/private-card-{input,facade,schema,storage}.mjs`
- `core/private-evidence-{schema,storage}.mjs`, `core/private-organization-storage.mjs`
- `core/method-{package,binding}-storage.mjs`
- `core/role-context-{facade,evidence}.mjs`, `core/context-read-{facade,sidecar}.mjs`
- `adapters/local/configuration.mjs`, `adapters/mcp/{cli,server,private-card-access,review-card}.mjs`
- `integrations/client/raw/local-{setup,setup-cli,host-permission}.mjs`
- `docs/{architecture,context-read-local,install-artifact,limitations,local-store}.md`, this contract
- `package.json`, `packaging/artifact-files.json`, `CHANGELOG.md`

Keep accepted Card/evidence edits minimal and delimited. Coordinate §17 seams. Preserve SQLite-free CLI linking, shipped closure and other owners’ tests.

### 19.8 Acceptance

Requirements, not results. Use synthetic fixtures, real child processes, installed tgz entries and **Node 22.16.0/24.15.0**, under the machine-wide queue.

For the adoption-only rows below, freeze valid v1 Card refs/snapshots before adoption; assert that Card/body revisions and Memory/Card epochs do not change merely because adoption changes.

| ID | Observable and expected result |
| --- | --- |
| C11 | Finance fixture: declare “finance monthly report uses v1.” Importing unadopted v2 preserves currentness. Adopt v2: the following paths exclude stale current evidence; fresh qualified history describes v1/current v2. Explicit edited-Card confirmation followed by revalidation restores eligible current use |
| C12 | Frozen old installed binary refuses v33 without canonical writes. New-binary dependency-authoring-off writers adopt/disable through ordinary core, managed-existing core and U3 terminal commands: all yield the same derived `needs-review`, without draining effects. Also test higher project-binding insertion, same-version adoption and v1→v2→v1 |
| C13 | `getCard` retains exact authored title/body with `needs-review`; `listCards` metadata reports the same status. Source eligibility alone never establishes current applicability |
| C14 | `selectEvidence(current)` excludes the Card. `fetchEvidence(current)` and `revalidateEvidence` of its old current snapshot refuse `evidence_unavailable` in the adoption-only fixture. Fresh history refs return qualified retained content; an old history snapshot refuses `snapshot_stale` |
| C15 | Fresh current candidate search excludes the Card after reconciliation; unreconciled storage reports rebuilding/unavailable. A warmed candidate-page continuation refuses `cursor_stale`, including an empty affected page |
| C16 | Full-ref, compact-ref and snapshot `fetchCandidateEvidence(current)` refuse `evidence_unavailable` in the adoption-only fixture. Fresh full-ref history fetch succeeds with labels; old compact/history fences and history snapshots refuse `snapshot_stale` |
| C17 | Assembly omits a Card already stale at preparation. Adoption during counting causes final `snapshot_stale`. Crossing the deadline without mutation still completes bounded final validation and may deliver admitted unchanged evidence with `stops.deadline` |
| C18 | Relations exclude stale seeds/endpoints and additions requiring stale witnesses. Adoption after freezing causes paged delivery `cursor_stale` or assembly `snapshot_stale`; include undelivered seeds |
| C19 | Fresh MOC-channel and organization reads exclude stale current members and suppress titles requiring them. Warmed organization continuations refuse `cursor_stale`; MOC source changes before final delivery refuse stale results. Direct eligible evidence remains discoverable |
| C20 | Role `now`/`refresh` exclude stale Card evidence and fence current guidance requiring that related Card under §18’s unavailable-guidance projection. Mid-read adoption causes `snapshot_stale`; receipt `then` preserves existing fence/omission rules. After the **same adoption**, unchanged exact-revision Card refs remain available as historical method/profile change reasons |
| C21 | Repeat applicable read rows with dependency opt-in off, ordinary/read-only/managed readers, warm sidecars, retained rankings, snapshots and organization cursors; repeat across adoption, process restart, reconciliation and full rebuild. No stale-current resurrection |
| C22 | Required-source correction/forget/exclusion retains authored bodies where permitted; fresh history reads return qualified content, never unsupported current evidence. Undeclared historical-v1 negative control is unaffected by adoption. Deleted method/source content is unavailable and unreconstructable |
| C23 | Revalidation independently preserves title/body bytes, Card revision and body revision while advancing dependency revision. Two rendezvoused revalidations produce one winner. Race binding changes, edits, replacement and deletion; stale commits refuse atomically. Exact replay remains content-free/idempotent |
| C24 | Card deletion purges dependencies with authoring off. Exercise unique-key/rowid replacement, terminal resurrection, rollback, missing-parent and wrong-namespace fixtures. Every opener rejects malformed persisted relationships with opt-in both on and off; legitimate stale revision observations remain openable |
| C25 | Fresh/prerequisite/populated migration and failure-injection matrix; untouched v32 definitions, validation-only readers, no transient read-only files and exact existing-store semantics. Personal-only access to a personal-plus-project declaration returns only minimal dependency diagnostics, with zero project lookup, identity or dependency-count disclosure |
| C26 | Frozen controls verify no-declaration bytes/defaults/capabilities/continuations across import, adoption, disable and deletion. Exercise MCP refusal and terminal approval. Independently instrument bounds and recount metering; derive import closure/manifest and independently enumerate tgz contents, diff lists and print counts. Cross-check changed paths by git diff/tree comparison; run the primary’s CI-equivalent matrix and report actual exit codes |

Timing/contention gates belong in `measure:card-current-dependencies`, run by CI `extra`, never ordinary test suites (TRAPS 12). Follow §16 paced gates and labelled unpaced stress. Report lookup/rescan cost, p50/p95 and event-loop delay.

C11 proves synthetic invalidation mechanics. **A17’s installed, fresh-session cross-agent workflow is separately owned and is not claimed here.** C21 covers A16 compatibility boundaries; C22 supplies A05 retained-body/history assertions.

**Non-claims:** Memory dependencies; generated summaries; E1/MOC summary compilation/freshness; profile-release binding dependencies; automatic rewriting; semantic accuracy, answer quality or retrieval-quality improvement.

**Decisions for the auditor:** verify authorization-filtered projections, deadline-safe final validation, v33 referential/namespace integrity, intent-specific predicates, the enumerated read matrix and accepted compatibility boundaries before implementation.
