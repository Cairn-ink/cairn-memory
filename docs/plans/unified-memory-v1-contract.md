# Unified memory integration V1: P0 contract and first packet (method packages)

Status: **DRAFT for non-author design audit; nothing here is implemented.**
Branch `integration/unified-memory-v1`, based on PR #469 head
`b8fa224d5ba6fe8007e6d80fe64fae74d89aa78b` (the tip of the unmerged Raw/local
stack). The research charter and its decisions live on branch
`experiment/hybrid-retrieval-hr1` (`docs/plans/memory-next-stage-charter.md`).
This contract is the public-engine part of a private integration draft (v0.2).
It covers only what the engine must own.

## 1. Scope and sequencing

The integration adds four engine capabilities around the existing Raw / Memory /
private Card engine. Each ships as its own packet:

| Packet | Content | Waits for |
| --- | --- | --- |
| **U2 (this contract, §§3–9)** | M4 method packages in core: immutable versions, adoption bindings, change records, history, deletion fences | Nothing |
| U3 | M4 host side: safe local directory importer, explicit-user approval through the existing local authority path, read-only MCP tools | U2 accepted |
| U4 | M5 assets and derivatives: binary storage port, immutable asset versions, derivative provenance | U2's typed-ref and schema rules |
| U5 | M6/M7/M8: `context-read-v1` common read over Memory, Card, method and derivative refs, plus candidate channels and budgeted assembly | HR-1 (embedding default) and HR-2 (assembly) evidence; interfaces and degraded modes may be specified earlier |

Engine boundaries carry over unchanged from the
[three-layer contract](three-layer-engine-contract.md):
- one SQLite engine, no parallel store;
- strict envelopes and the authority taken from the host;
- no model calls inside write locks;
- old DTOs and tools unchanged;
- new capabilities are explicit opt-in.

## 2. Cross-cutting decisions (P0)

### 2.1 Schema allocation

- The current maximum is v29 (`LOCAL_AUTHORITY_SCHEMA_VERSION`). U2 takes
  **v30**. U4 reserves **v31**. U5 indexes are rebuildable sidecars with their
  own format version and no canonical schema bump, unless a later contract says
  otherwise.
- One integration owner allocates versions; numbers are never reused.
- v30 assumes the v29 baseline. Opting into method packages on an older store
  applies the existing additive migrations with their own features **off** (empty
  tables, no backfill), then v30, in one transaction. Old binaries reject v30.
  Writers on mixed versions must stop before upgrading, as in existing practice.

### 2.2 Typed references

New refs follow the existing `MemoryRef` / `CardRef` / source-ref style. They
use an exact `namespace` and positive revisions. Opaque identities are
core-keyed HMACs bound to store, scope and purpose; no public content digests.

| Ref | Shape |
| --- | --- |
| `MethodPackageRef` | `{type:'method-package', namespace, packageId}` |
| `MethodVersionRef` | `{type:'method-version', namespace, packageId, versionId, manifestIdentity}`. Versions are immutable: the ref pins content forever, and deletion makes it unavailable, never different |
| `MethodBindingRef` | `{type:'method-binding', namespace, packageId, roleId, revision}` |

`roleId` is a host-supplied stable identifier (1–200 units, `[A-Za-z0-9._-]`) or
`null`, meaning "any role in this scope". Role names grant no access or execution
authority.

### 2.3 Capability and authority

- Opt-in uses
  `openMemoryCore({ path, methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } })`.
  `authority` has the same `{authorize, isCurrent}` port and semantics as
  `private-cards-local-v1`, so a host may pass the same object.
- Default construction exposes none of the new methods. A capability descriptor
  `getMethodPackageCapabilities()` lists them; it holds no private data and needs
  no authority.
- Action classes:
  - every import, adoption, disable and delete is `explicit-user`, because each
    retains content or changes what agents treat as current;
  - reads need exact-scope read authority;
  - a model, tool argument or file text can never mint authority. A method file
    saying "adopt this version" is data.

## 3. Method package model (U2)

- **Package**: a stable identity created by the first import in a namespace.
  - `packageId` is core-issued.
  - Display title, file names and paths are not identity.
  - The same title in another namespace or owner never merges.
- **Version**: an immutable snapshot, with:
  - `versionId` (core-issued) and `ordinal` (1, 2, … per package; only a display
    label);
  - `basedOn` (null for the first version, otherwise one earlier available
    version of the same package);
  - the manifest, `manifestIdentity`, `title` and `submittedBy` (an untrusted
    attribution label, ≤200 units);
  - `importedAt`, plus a lifecycle `state` (`available` | `deleted`) with its own
    revision.
  - Content never changes after commit.
- **Manifest**: 1–64 files `{path, byteCount, contentIdentity, mediaType}`.
  - `path` is a normalized relative POSIX path: no leading `/`, no `.` or `..`
    segments, no empty segments, no backslash or NUL, ≤512 units, unique, and
    unique ignoring case.
  - `mediaType` is a text type only (`text/markdown`, `text/plain`,
    `application/json`, `application/yaml`, `text/csv`). Binary attachments are
    refused with `unsupported_media` until U4's asset port exists.
  - Each file ≤100,000 UTF-16 units; ≤1,000,000 units per version.
  - Text is valid Unicode without NUL, redacted with the existing best-effort
    redactor before persistence, and formatting is preserved.
  - `manifestIdentity` is an HMAC over the ordered `(path, contentIdentity,
    mediaType)` list.
- **Core never reads the filesystem.** The host's importer (U3) walks a
  directory, rejects symlinks and escapes, and passes `{path, text, mediaType}`.
  Core validates everything again. Nothing in a package is executed.
- **Owner usage**: method text counts toward a separate `method-package-usage-v1`
  projection, capped at 50,000,000 UTF-8 bytes per owner across namespaces.
  Limits are proposed engineering defaults, not measured results.

## 4. Adoption bindings (U2)

- **Key**: `(namespace, packageId, roleId)`, with at most one binding per key.
  - States: `active` (with `versionId`) or `disabled`. Absent means unbound.
  - Every transition increments the binding revision under CAS on
    `expectedRevision` (null when creating).
- **Transitions**:
  - `adopt(versionId)` requires an available version of that package;
  - `disable()` is an explicit stop;
  - re-adopting after `disable` is allowed;
  - importing a version **never** changes a binding, even when the same action
    imports.
- **Adoption events**: each transition appends a content-free event with the
  binding key, new revision, action ID, transition, version and time, plus
  optional `reasonRefs`.
- **Resolution** (`resolveMethod`) takes a trusted read set (one exact namespace,
  or personal plus one project of the same owner, as today), a `packageId` or
  `null`, and a `roleId`. It checks bindings in this order:
  1. project + roleId;
  2. project + null;
  3. personal + roleId;
  4. personal + null.

  The first existing binding decides:
  - `active` with an available version → that version;
  - `active` with a deleted version → `unavailable`, never a silent fallback;
  - `disabled` → `disabled`; it **blocks** lower levels, so a default cannot
    reappear.

  No binding at any level gives `no-active-version`. Upload time, ordinal,
  similarity and file text never choose a version.
- `resolveMethodsForRole({readSet, roleId})` lists every package resolved for a
  role with the same rules. It is paged (default 20, max 50) and gives each
  package's status.
- **Snapshots**: every resolution returns an opaque snapshot binding the binding
  revisions, version refs and access generation. Hosts keep task pins as version
  refs plus that snapshot.
  - Reading a pinned version later returns its content with
    `adoptionStatus ∈ {current, newer-version-available, withdrawn, never-adopted}`
    relative to the given role context.
  - `withdrawn` means the binding is now `disabled`. Such a pin must not be
    presented as applicable guidance, but it stays readable as qualified history.
  - Deleted versions and revoked scope read as `unavailable` for pins and for
    history.

## 5. Change records and history (U2)

- **At import** a version may carry
  `change: {items:[{summary, paths:[...]}], reasonRefs:[...]}`.
  - Items are untrusted text: ≤32 items, each summary ≤500 units, and paths must
    exist in either version.
  - `reasonRefs` are 0–16 existing core refs: MemoryRef, CardRef, NoteSourceRef,
    RawSourceRef or ReceiptSourceRef. They are validated at import, and core
    stores refs only, no copied text. Reason prose a person writes at import time
    is first submitted with the existing `submitSourceNote`, then referenced.
- **`compareMethodVersions(from, to)`** (same package) returns:
  - a mechanical path-level diff (`added`, `removed`, `changed`, `unchanged`, by
    content identity);
  - `to`'s change record;
  - each reason ref with its **current** availability (`available` /
    `unavailable` / `forgotten`, through canonical rereads);
  - `reason: 'not-recorded'` when there is no change record or no reason ref.

  Core never generates or infers reasons. Line-level diffs are left to clients
  reading both versions.
- **History**: `listMethodVersions(packageRef)` returns versions in ordinal order
  with `basedOn`, state, manifest metadata and current binding status per role
  context. It is paged and holds no file text.
- **Reads**: `getMethodVersion(versionRef, context?)` returns metadata, manifest
  and `adoptionStatus`. `readMethodFile(versionRef, path, cursor?)` returns
  half-open UTF-16 parts of ≤4,000 units at code-point boundaries.
  - Every read rechecks `manifestIdentity`, so a file can never come from another
    version.
  - Every success envelope is ≤65,536 UTF-8 bytes, and cursors are HMAC-bound
    and stale on mutation, as in private Cards.

## 6. Deletion, invalidation and effects (U2)

- **`deleteMethodVersion(versionRef, expectedRevision)`** (`explicit-user`):
  - purges every file text of that version and marks the version `deleted`
    (revision + 1);
  - keeps content-free metadata: path list, counts, ordinal and identities;
  - leaves bindings that point to it in place, but they resolve `unavailable`
    until a person adopts another version or disables them;
  - lets later versions keep `basedOn` pointing to the deleted predecessor, which
    is reported `unavailable` in diffs and history;
  - emits effects `method_version_deleted` and `binding_unavailable`.
- **`deleteMethodPackage(packageRef, expectedRevision)`** deletes all versions
  and removes every binding of the package in the namespace, emitting effects.
- **Deletion scope**: active logical-row purge only, not secure physical erasure,
  matching existing private-Card wording.
- **Effects** are content-free and durable, with a paged `listMethodEffects`
  like `listCardEffects`. Consumers revalidate; effects grant nothing.
- **Reason refs need no triggers.** They are rechecked at read time, so
  forgetting or deleting a reason source turns it `unavailable` immediately
  without copying text.

## 7. Operations, replay and errors (U2)

- **Action ledger.** Every mutation needs an `actionId` and every existing-object
  mutation an `expectedRevision`, using the same namespace ledger semantics as
  private Cards.
  - Payload binding is a core HMAC over method, scope, target, revision and the
    complete input, including file texts.
  - Exact replay returns the original content-free receipt, even after later
    deletion and restart.
  - A changed payload under the same ID fails `action_conflict`.
  - Implementations should reuse the private-Card ledger helpers without changing
    their behaviour.
- **Receipts**:
  - import → `{packageId, versionId, ordinal, manifestIdentity, revision:1}`;
  - binding transitions → `{bindingRevision, state, versionId}`;
  - deletes → `{id, revision, state, effectCount}`.
- **Errors**:
  - existing: `invalid_input`, `authority_required`, `scope_changed`,
    `storage_busy` (the only retryable one), `storage_error`,
    `revision_conflict`, `action_conflict`, `cursor_stale`, `invalid_cursor`,
    `context_item_too_large`;
  - new: `method_not_found` (foreign and missing look identical),
    `method_version_unavailable`, `invalid_path`, `unsupported_media`,
    `package_limit_reached`, `quota_reached`.
- **Exceptions** become a sanitized `storage_error`, never file text.

## 8. Facade methods (U2)

All take `(input, authority)` and return existing envelopes. `N` = namespace and
`A` = actionId.

| Method | Input beyond `namespace` | Success value |
| --- | --- | --- |
| `importMethodVersion` | `A, packageId?\|null, basedOn?: MethodVersionRef\|null, title, submittedBy?, files:[{path,text,mediaType}], change?` | import receipt |
| `getMethodVersion` | `version: MethodVersionRef, context?: {readSet?, roleId}` | `{version}` or `{version:null}` |
| `readMethodFile` | `version, path, cursor?` | `{parts, coverage, nextCursor}` |
| `listMethodPackages` | `limit?, cursor?` | metadata pages |
| `listMethodVersions` | `package: MethodPackageRef, context?, limit?, cursor?` | metadata pages |
| `compareMethodVersions` | `from, to` | §5 result |
| `adoptMethodVersion` | `A, packageId, roleId, version, expectedRevision\|null, reasonRefs?` | binding receipt |
| `disableMethodBinding` | `A, packageId, roleId, expectedRevision, reasonRefs?` | binding receipt |
| `resolveMethod` | `readSet, packageId, roleId` | `{status, binding, version, snapshot}` |
| `resolveMethodsForRole` | `readSet, roleId, limit?, cursor?` | `{methods, coverage, nextCursor, snapshot}` |
| `deleteMethodVersion` / `deleteMethodPackage` | `A, ref, expectedRevision` | delete receipt |
| `listMethodEffects` | `limit?, cursor?` | effect pages |
| `getMethodPackageUsage` | none | usage projection |

Resolution methods take a read set and are authorized like existing evidence
reads. Every other method uses one exact namespace.

## 9. U2 acceptance (all mechanical, synthetic stores, Node 22.16 and 24.15)

| ID | Observable |
| --- | --- |
| M01 | Default construction unchanged; capability off → no methods; old DTOs and tools unchanged; v30 opt-in from fresh, v18, v23 and v29 stores; reopen with the feature off keeps data; old opener rejects v30; injected migration failure rolls back |
| M02 | Import stores exact redacted text and paths; refuses invalid paths, case collisions, symlink-like or escape segments, binary or unknown media, oversize, invalid Unicode or NUL, without partial rows; a second import with `basedOn` gives ordinal 2 and keeps v1 bytes and identity unchanged |
| M03 | Reads return files only from the requested immutable version; a manifest-identity mismatch refuses; parts and cursors are bounded; the whole-envelope ceiling holds |
| M04 | Importing v2 does not change resolution (v1 stays current, v2 reads as `never-adopted`); adopt v2 under CAS; a concurrent adopt with the same expected revision has exactly one winner; replay returns the original receipt; a changed payload fails `action_conflict` |
| M05 | Resolution order: a project role binding beats the personal default; project `disabled` blocks the personal default; no binding → `no-active-version`; a later-imported old version never displaces the adopted one; foreign namespaces are invisible |
| M06 | Pins: after adopting v2, a v1 pin reads `newer-version-available`; after disable, `withdrawn`; after deleting v1, `unavailable`; snapshots stale on binding change |
| M07 | Compare: path-level diff, change items, and reason refs with live availability. Forgetting a reason Memory or deleting a reason note flips it to `unavailable`; no change record → `not-recorded` |
| M08 | Delete version and delete package: texts purged, tombstones content-free, bindings `unavailable` or removed, effects durable once, no resurrection after restart or replay |
| M09 | Authority: missing, forged, wrong-scope, stale-generation and revoked grants refuse with no leak; model- or tool-supplied flags never authorize |
| M10 | Bounds, usage cap and atomic refusals; error codes exact; no network or model calls in any method |

## 10. Open questions for the design audit

1. Should roles be a canonical engine record now, or stay host-supplied
   identifiers until the M8 role-profile work?
2. Is applying intervening migrations with features off acceptable for stores
   below v29, or should method opt-in require v29?
3. Should `reasonRefs` allow `MethodVersionRef` (e.g. a review recorded as an
   earlier version)?
4. Are the text-only limits reasonable for real method packages (SKILL.md plus
   templates)?
