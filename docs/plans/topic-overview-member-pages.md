# Bounded topic member pages (E1-M)

Status: implementation contract; no implementation or runtime acceptance is
claimed by this document. Product may develop against the shapes below.
Base: `b2513501a6747a163ab1cefb7d37a16744c9621a` (main, #468).
Branch: `feat/e1m-member-pages`. Contract date: 2026-10-25.
This packet changes only this plan; no commit, migration or product pin change.

## Report, scope and decisions

The product's 2026-10-22 requirement is retained verbatim:

> E1-M: bounded member paging. Exact owner/namespace + MOC id/revision (L1 / L2 descendants / unfiled), snapshot-bound opaque cursor, limit/work/bytes/deadline, typed stale/partial; valid refs carry the Memory revision, de-duplicated across L1, with ordering/kind filter specified; does not return all bodies, does no token packing; read-only async; does not take the writer slot.

Product reports a synthetic world of 1,112 Memories, four namespaces and 71
MOCs, and refuses to read engine private tables. These are supplied product
facts, not measurements performed for this document. Engine's committed
restatement is one bounded interface in the same engine, covering L1, L2
descendants and unfiled, fixed order/kind filtering, revision/snapshot cursors,
deduplication/invalidation, and refs only with no body scans.

E1-M adds `reader.readTopicMembers(...)` to the existing reader. It enumerates
Memory members only, one exact namespace and one selection per traversal.
An L2 traversal returns the union of its child L1 members, once per Memory.
Unfiled is a namespace-wide selection, never an L2-local leftover bucket.
The UI can use the identifier label immediately; semantic previews need a
separate decision because E1-M neither reads bodies nor migrates v18.

The normative decisions below apply to the new method and an explicit opt-in
snapshot issuance seam on the overview method. Legacy overview defaults remain
unchanged. The cited baseline is evidence, not a claim that the new DTO is
already implemented.
See [the overview plan](topic-overview-read.md) and
[the overview reader guide](../topic-overview.md) for the preceding port.

## Studied baseline: current behavior and storage authority

Every current-behavior assertion in this section cites its source at this base.

| Area | Evidence and consequence for E1-M |
| --- | --- |
| Public seam | `openMemoryReader` is exported by `core/index.mjs:8`. It validates options before lazily creating a fixed Worker; SQLite work is dispatched asynchronously, with one pending call, a 5,000ms watchdog, 60,000ms idle expiry and asynchronous close (`core/memory-reader.mjs:5`, `core/memory-reader.mjs:30`, `core/memory-reader.mjs:44`, `core/memory-reader.mjs:59`). Concurrency/close and mock-clock expiry tests exist (`core/test/topic-overview.test.mjs:52`, `core/test/topic-overview-lifecycle.test.mjs:48`, `core/test/topic-overview-lifecycle.test.mjs:58`). |
| Input | Own-data validation rejects proxies, accessors, symbols and unknown fields. Exact personal/project namespace validation normalizes personal `null` to internal `''`; bounds and the `e1.` token syntax are explicit (`core/topic-overview-input.mjs:5`, `core/topic-overview-input.mjs:16`, `core/topic-overview-input.mjs:23`). Identifier and positive safe-integer revision rules are in `core/validation.mjs:31` and `core/validation.mjs:87`. |
| Overview DTO | Nodes contain ID/revision/level, guarded nullable title, parents, direct/descendant counts, latest creation time, and explicit unavailable placement time (`core/topic-overview-storage.mjs:149`). Optional refs contain only `{memoryId,revision}` and stop at `memberLimit`; aggregation visits Memories in ascending ID (`core/topic-overview-storage.mjs:61`, `core/topic-overview-storage.mjs:113`). The guide calls this a first-K sample, not pagination (`docs/topic-overview.md:96`); tests assert sample contents, absent default refs and no body sentinel (`core/test/topic-overview.test.mjs:7`). |
| Memory declarations | `memories` stores namespace, `content`, kind, revision and creation/update times, without a standalone title column (`core/database.mjs:48`). Review states are `none`, `awaiting`, `confirmed` (`core/confirmation-schema.mjs:8`). Metadata DTOs have kind/revision/state/times but no semantic label (`core/runtime.mjs:152`). Legacy map's default label slices content, and map selects content (`core/moc-storage.mjs:17`, `core/moc-storage.mjs:555`, `core/moc-storage.mjs:649`). Reusing that path would violate E1-M's no-body-read rule. |
| Memory organization | `mocs` has namespace, level 1/2, title, revision and times; `moc_title_sources` binds Memory revisions; `moc_memory_refs` binds both endpoint revisions; `moc_edges` binds parent/child MOC revisions (`core/database.mjs:159`, `core/database.mjs:177`, `core/database.mjs:184`, `core/database.mjs:192`). These relationship tables have no placement timestamp (`core/database.mjs:184`, `core/database.mjs:192`). |
| Placement validation | Public placement checks exact-namespace current/nondeleted/non-awaiting Memories and revision guards, L1 membership parents and L2 containment parents (`core/moc-storage.mjs:135`). It replaces a Memory's filing set, refreshes affected MOC/edge revisions and advances the namespace epoch (`core/moc-storage.mjs:189`, `core/moc-storage.mjs:245`, `core/moc-storage.mjs:292`). Moving an already-filed Memory can change membership without changing its Memory revision; no-op placement keeps the epoch (`core/test/moc.test.mjs:88`). MOC linking validates L2→L1 and endpoint revisions (`core/moc-storage.mjs:304`); foreign and wrong-level placement rejection is tested (`core/test/moc.test.mjs:121`). |
| Visibility and dedup | Overview requires exact namespace, current/nondeleted/non-awaiting revisions and active projection membership. L1 refs and L2 edges must match both endpoint revisions. It counts a Memory once per L2 even if several child L1s contain it; no valid projected L1 placement means unfiled regardless of the filing flag (`core/topic-overview-storage.mjs:7`, `core/topic-overview-storage.mjs:52`, `core/topic-overview-storage.mjs:97`, `core/topic-overview-storage.mjs:118`). Every original title source must validate before any title is released (`core/topic-overview-storage.mjs:84`, `core/topic-overview-storage.mjs:152`). Foreign, awaiting, forgotten, stale, superseded and generation-excluded cases are tested (`core/test/topic-overview-visibility.test.mjs:14`, `core/test/topic-overview-visibility.test.mjs:31`, `core/test/topic-overview-visibility.test.mjs:46`, `core/test/topic-overview-visibility.test.mjs:74`). |
| Generation authority | Namespace-keyset indexes and revision-bound projection tables exist before v18 (`core/index-schema.mjs:3`). Projection views/triggers distinguish live declarations from active generation authority and validate namespace, levels and revisions (`core/index-schema.mjs:36`, `core/index-schema.mjs:74`, `core/index-schema.mjs:89`). Overview snapshots contain internal store ID, namespace epoch (default 1), and active generation (nullable only for no declared index state). Declared null/missing/foreign/unpublished generations are unavailable (`core/topic-overview-storage.mjs:38`); tests distinguish that from empty namespaces (`core/test/topic-overview-visibility.test.mjs:66`, `core/test/topic-overview-visibility.test.mjs:88`). |
| Rebuild and snapshot provenance | Starting a rebuild inserts unavailable namespace authority only when no namespace index state already exists; replacement staging preserves the existing active generation (`core/index-storage.mjs:80`). Publication switches active generation and advances the namespace epoch (`core/index-storage.mjs:102`). The public overview snapshot exposes only epoch/generation, omitting the internally captured store ID (`core/topic-overview-storage.mjs:43`, `core/topic-overview-worker.mjs:65`); equal public fields alone cannot establish same-store provenance. |
| Lifecycle invalidation | Correction removes placement, changes the Memory revision/kind and advances the epoch; forget removes placement, nulls content, marks deleted and advances the epoch (`core/runtime.mjs:253`, `core/runtime.mjs:291`). Supersession removes predecessor placement, marks it historical, increments revision and advances the epoch (`core/supersession-storage.mjs:59`). MOC invalidation also bumps affected title-source groups (`core/moc-storage.mjs:106`). Public correction/forget and source-deletion cursor/visibility cases exist (`core/test/topic-overview-raw29.test.mjs:67`, `core/test/topic-overview-raw29.test.mjs:79`). |
| Cards are separate | Card MOCs, title sources, revision/body-revision refs, edges and navigation-only evidence mappings live in separate tables (`core/private-organization-schema.mjs:4`). Card eligibility additionally checks confirmed state, support and current dependencies (`core/private-organization-storage.mjs:11`, `core/private-organization-storage.mjs:42`). Card membership/title validation, separate epochs and access-generation cursor checks are distinct from Memory organization (`core/private-organization-storage.mjs:16`, `core/private-organization-storage.mjs:31`, `core/private-organization-storage.mjs:48`, `core/private-organization-storage.mjs:244`). Tests require typed separation and reject Card IDs leaking into old Memory maps (`core/test/private-organization.test.mjs:67`). E1-M must not union these graphs or traverse evidence mappings. |
| Cursor conventions | Overview uses random server-held `e1.` tokens, not HMAC payloads. It binds normalized request/snapshot, caches the last continuation result, rejects older sequences, and revalidates snapshots before emission (`core/topic-overview-worker.mjs:10`, `core/topic-overview-worker.mjs:30`, `core/topic-overview-worker.mjs:81`). Core cursors use HMAC-SHA256, canonical base64url and timing-safe verification (`core/contract.mjs:279`); context cursors add purpose/store/configuration binding (`core/context-read-facade.mjs:114`, `core/context-read-facade.mjs:124`). Organization cursors distinguish bad integrity/binding from changed generation/access (`core/private-organization-storage.mjs:25`). E1-M uses a separate HMAC domain; it does not reinterpret overview tokens. |
| Read-only opening | The native opener uses `readOnly`, `query_only`, `trusted_schema=OFF`, safe regular-file/inode checks and exact consumed-index validation (`core/read-database.mjs:10`, `core/read-database.mjs:21`, `core/read-database.mjs:37`). The topic path currently sets `busy_timeout=0`; the context path sets 5,000ms (`core/read-database.mjs:26`). The reader rejects rather than creates/migrates missing/unsupported files (`core/test/topic-overview-lifecycle.test.mjs:30`). |
| Busy and bounds | SQLite primary error codes 5/6 map to `{ok:false,error:{code:'storage_busy'}}`, never success with empty items (`core/topic-overview-input.mjs:43`); shared busy classification uses the same codes (`core/database.mjs:32`). Work steps account physical visits/EOF and bounded validations or ancestor updates, with an 8MiB logical metadata cap (`core/topic-overview-storage.mjs:3`, `core/topic-overview-storage.mjs:14`, `core/topic-overview-storage.mjs:49`). Deferred transactions stop after 64 steps or 5ms between steps; byte checks include the complete serialized success envelope and cursor (`core/topic-overview-worker.mjs:19`, `core/topic-overview-worker.mjs:45`, `core/topic-overview-worker.mjs:65`). Work/byte/replay/state-limit behavior is tested (`core/test/topic-overview.test.mjs:32`, `core/test/topic-overview.test.mjs:68`, `core/test/topic-overview-lifecycle.test.mjs:95`). |
| Compatibility and artifact | At this base the topic read allowlist resolves to 18, 20, 21, 22, 23, 29, 30, 31, 32, 33 (`core/database.mjs:37`, `core/confirmation-schema.mjs:3`, `core/private-card-schema.mjs:2`, `core/private-evidence-schema.mjs:1`, `core/private-organization-schema.mjs:1`, `core/local-authority-schema.mjs:3`). Physical v18/20/21/22/23 compatibility and 24–28 rejection are tested without migration (`core/test/topic-overview-raw29.test.mjs:11`, `core/test/topic-overview-raw29.test.mjs:26`). The installed test checks archive/import/Worker closure and actual child exit (`packaging/test/topic-overview.test.mjs:13`); its fixture imports installed core and exercises the public reader (`packaging/test/fixtures/topic-overview.mjs:22`). |

## Public API and normalization (normative)

```ts
type Identifier = string;
type Revision = number; // positive safe integer, <= Number.MAX_SAFE_INTEGER
type Namespace =
  | { ownerId: Identifier; scope: "personal"; projectId: null }
  | { ownerId: Identifier; scope: "project"; projectId: Identifier };
type MemoryKind = "fact" | "preference" | "decision" | "instruction" | "context";
type MemberSelection =
  | { type: "moc"; mocId: Identifier; revision: Revision; level: "L1" | "L2" }
  | { type: "unfiled" };
// topic-snapshot-v1; selected explicitly on the overview issuance request.
type TopicSnapshotV1 = {
  indexRevision: Revision;
  generation: string | null;
  originToken: string;
};
type TopicMembersInput = {
  namespace: Namespace;
  selection: MemberSelection;
  accessRevision: Identifier;
  kind?: MemoryKind | null;
  order?: "id_asc";
  limit?: number;
  workLimit?: number;
  maxBytes?: number;
  deadlineMs?: number;
  expectedSnapshot?: TopicSnapshotV1;
  cursor?: string;
};

// Added method on the handle returned by openMemoryReader({ path, ownerId }):
interface TopicMemberReader {
  readTopicMembers(input: TopicMembersInput): Promise<TopicMembersResult>;
  close(): Promise<void>;
}
```

`Identifier` is a well-formed nonempty Unicode string of at most 200 UTF-16
code units, with no leading/trailing whitespace, U+0000–001F or U+007F.
IDs are opaque, not restricted to UUIDs. All objects, including nested input,
must be plain own-data objects (Object prototype or null); reject proxies,
getters/setters, symbol keys and unknown names without executing user code.
Reject sparse/non-data containers; arrays are not accepted anywhere in input.
All numeric bounds must be safe integers. Omission or `undefined` selects an
optional field's default; `null` is accepted only where the type admits it.
Invalid new-method inputs settle `invalid_input`, except malformed member
cursors settle `invalid_cursor` and unusable snapshot origin tokens settle
`cursor_stale` as specified below. Constructor validation remains synchronous.
The existing constructor takes exactly `{path:string,ownerId:Identifier}`;
path is nonempty well-formed text up to 4096 UTF-16 units, without NUL,
must not equal `:memory:` or start with `file:`, and is resolved against the working directory
(`core/topic-overview-input.mjs:16`). It is validated without opening a file;
actual safe-file validation happens asynchronously on first use
(`core/memory-reader.mjs:5`, `core/memory-reader.mjs:30`).

| Field | Required/default | Range and meaning |
| --- | --- | --- |
| `namespace` | Required | Exact personal or project shape above; `ownerId` must equal the handle owner. No wildcard, all-project, inferred project, read-set expansion or implicit personal fallback. Echo personal project ID as JSON `null`. |
| `selection` | Required | L1 means direct Memory members; L2 means unique descendants through valid L2→L1 edges. Require exact MOC ID, positive revision and matching level. Unfiled has exactly `{type:'unfiled'}` and accepts no MOC fields. |
| `accessRevision` | Required | Host-supplied identifier version of its effective authorization/configuration for this exact owner/namespace. The host changes it whenever access changes and closes the reader immediately on revocation. It is a fence, not a credential or engine authentication. |
| `kind` | `null` | `null` includes all five Memory kinds; otherwise exactly one named kind. No Card kind, array, inference or alternate spelling. Filter before emitting/counting toward `limit`, after charging physical visits. |
| `order` | `"id_asc"` | Only supported ordering. No relevance/title/time/placement sort. |
| `limit` | 100 | 1–100 returned unique refs per call. |
| `workLimit` | 5000 | 16–50000 physical work units per call, defined below. |
| `maxBytes` | 65536 | 4096–262144 UTF-8 bytes of the complete result envelope. |
| `deadlineMs` | 1000 | 50–5000ms elapsed budget per call, including dispatch, opening/validation, E1-C lock wait, work, serialization and final validation. |
| `expectedSnapshot` | Omitted | Optional `TopicSnapshotV1` `{indexRevision,generation,originToken}` fence for UI count/list consistency. `generation` is null or a nonempty well-formed string of at most 200 UTF-16 units; `indexRevision` is a positive safe integer. The opaque `originToken` is nonempty printable ASCII, at most 256 bytes. Mismatch or missing/foreign/expired/otherwise invalid token is `cursor_stale`, including on the first call. Omission of the entire field captures a new snapshot without asserting overview consistency. Repeat all three supplied values unchanged with continuations; JSON copies remain valid. |
| `cursor` | Omitted | Omission starts a new member traversal. A present token is a nonempty opaque ASCII string, at most 256 bytes; no `null`/empty reset shorthand. All other normalized inputs must be repeated unchanged. |

`originToken` is the complete public provenance hand-off. A snapshot remains
valid after `JSON.parse(JSON.stringify(snapshot))`, structured cloning or
transport through the UI, provided its token and bound values remain current
on the issuing reader Worker/store incarnation. Validation depends on the
published values and the token, never JavaScript object identity, WeakMap
branding, hidden properties or a host-invented protocol.

If `expectedSnapshot` is supplied with valid epoch/generation fields but no
token (including a legacy overview snapshot), return `cursor_stale`, not
`invalid_input`. A nonstring, empty, oversized, malformed, tampered, wrong-version,
foreign or expired origin token has the same `cursor_stale` outcome. Malformed
epoch/generation or unknown snapshot fields remain `invalid_input`. Recover
by obtaining a fresh opt-in overview on the live reader. The host discards
paired overview/member caches after token expiry, idle expiry, restart, close,
reopen, store replacement or other binding invalidation.

Only the existing Memory personal/project namespaces are covered. No Card,
Raw, episode, receipt, asset or method-package refs may appear. A Card MOC ID
is not a Memory MOC ID and resolves as `moc_not_found` here. Missing, foreign
or generation-excluded MOCs have the same `moc_not_found` outcome on a fresh
request; do not reveal foreign existence. A visible MOC with wrong revision
returns `revision_conflict`; wrong requested level returns `invalid_ref`.
Its guarded title may be null without preventing enumeration. If a matching
authenticated continuation's target disappears or changes, use `cursor_stale`
instead of these fresh-request outcomes.

No new constructor option, model, token counter or writer handle is required.
The host authenticates before opening/calling, never treats `accessRevision`
as proof of permission, and never hands a revoked principal an in-flight
result. Engine cannot detect an external access change that the host neither
reports nor enforces by closing the handle.

### Opt-in overview snapshot issuance (normative)

Extend the public `reader.readTopicOverview(input)` input with exactly one
optional field, `snapshotVersion?: "topic-snapshot-v1"`. Omitted or `undefined`
retains the legacy input defaults and exact legacy output shape, including
`snapshot:{indexRevision,generation}` with **no `originToken` field**. Any other
supplied version, including null, is `invalid_input`. No constructor opt-in,
new store, schema change or private-table access is needed.

The full opt-in request shape is:

```ts
type TopicOverviewV1Input = {
  namespace: Namespace;
  snapshotVersion: "topic-snapshot-v1";
  nodeLimit?: number;
  maxBytes?: number;
  workLimit?: number;
  memberLimit?: number;
  cursor?: string;
};
```

Its signature is `reader.readTopicOverview(input: TopicOverviewV1Input)` and
returns a Promise of the existing `ok/value` or `ok:false/error` envelope. On
success, `value` retains exactly the existing `items`, `totals`, `coverage`
and `nextCursor` fields; only `value.snapshot` becomes `TopicSnapshotV1`.
The request literal versions this three-field snapshot; the opaque token also
carries an authenticated v1 discriminator. It is not a new field on legacy
overview snapshots. All overview node/count/ref DTOs remain unchanged.

Other overview inputs retain their existing bounds: nodeLimit 1–100/default
100, maxBytes 4096–262144/default 65536, workLimit 16–50000/default 5000,
memberLimit 0–10/default 0, with the existing 5,000ms watchdog and short
deferred snapshots (`core/topic-overview-input.mjs:23`,
`core/memory-reader.mjs:44`, `core/topic-overview-worker.mjs:45`). The opt-in
has no new deadline option. Its byte budget includes the complete opt-in
envelope and token; the added bytes may change opt-in page boundaries only.
Issuance is charged bounded work within those budgets, never a second scan.
The version choice binds the overview continuation: repeat it with each
cursor; changing between legacy/opt-in modes yields `invalid_cursor` under
the existing overview binding rule (`core/topic-overview-worker.mjs:30`).

The first successful opt-in page issues one token for the overview traversal's
captured snapshot, even if it is a work-only page with unknown counts. Every
subsequent success/replay in that traversal returns that same token, after
revalidation. Unknown counts cannot be used as exact counts. No token is
issued on a failure. Expiry during an opt-in continuation/replay returns
`cursor_stale`; do not silently renew the token or mix snapshot origins.
Fresh opt-in requests issue fresh tokens without revoking other current
origin tokens; the existing overview cursor replacement behavior is unchanged.

### Origin token bindings, bounds and lifetime (normative)

Origin tokens are opaque, nonempty printable ASCII strings of at most **256
bytes**, including version/authentication overhead. Use CSPRNG nonces and
HMAC-SHA256 in a separate purpose domain, `topic-snapshot-v1/origin`, with an
ephemeral 32-byte Worker key. A purpose-separated key may be shared with the
member cursor signer. Never use environment/caller/persisted keys. Authenticate
the token version, nonce, issuance/expiry times, reader/Worker incarnation,
store ID and file identity, exact owner/namespace, indexRevision, generation,
and schema/snapshot-configuration identity. Bind digests rather than exposing
namespace or store identifiers in plaintext. Verify canonical encoding and
MAC with timing-safe comparison. The token's layout is not a client API.

The token expires **60,000ms after issuance**, measured by the issuing Worker's
monotonic clock; at the expiry instant it is invalid. This absolute lifetime
does not slide on read, replay, continuation or JSON serialization. It also
ends immediately when the Worker/handle closes, fails, idles out or restarts,
the store/file or bound namespace snapshot/configuration changes, or active
authority becomes unavailable. Replacement rebuild staging with unchanged
published authority does not invalidate it; publication does. Unrelated
namespace changes do not invalidate it. The existing idle timeout remains
60,000ms; activity may keep the Worker alive but cannot extend token age.

No per-token unbounded issuance registry is permitted. An authenticated
expiry/binding digest permits bounded verification after JSON transport.
Retain only bounded traversal/replay state; a fresh overview/member traversal
does not by itself revoke other unexpired origin tokens. Every use, including
cached replay, checks token expiry and bindings before releasing output.
An origin token fences metadata consistency and grants no authorization,
body access or right to resume an obsolete member cursor.

Every successful member page contains an origin token. If `expectedSnapshot`
is supplied, validate it before starting/advancing and echo its exact three
fields in the member snapshot throughout the traversal. If omitted on a fresh
member request, capture and issue a fresh `TopicSnapshotV1` under the same
rules; keep that token across all member continuations/replays. It can fence
later member requests, but it cannot establish consistency with an earlier
legacy overview that had no token. To pair counts with members, pass the
snapshot from an opt-in overview. There is no renewal inside a traversal:
after expiry discard paired caches, obtain a new opt-in overview, and restart.

## Output DTO, labels, ordering and set semantics (normative)

The following is the complete v1 JSON data model. No omitted success fields,
`undefined`, body field, hidden array of all placements, provisional total or
untyped native error is part of this contract. Future shape changes require a
new contract version; clients discriminate by `ok`, then `status`/`reason`.

```ts
type MembersSnapshot = {
  indexRevision: Revision;
  generation: string | null;
  originToken: string; // topic-snapshot-v1 provenance; <=256 ASCII bytes
  accessRevision: Identifier;
  configuration: "topic-members-v1";
};
type MemberRef = {
  type: "memory";
  namespace: Namespace;
  id: Identifier;
  revision: Revision;
  kind: MemoryKind;
  label: { text: string; source: "identifier" };
  reportedUnder: { type: "l1"; mocId: Identifier; revision: Revision } | null;
};
type MembersPage = {
  version: "topic-members-v1";
  status: "page" | "partial";
  namespace: Namespace;
  selection: MemberSelection;
  snapshot: MembersSnapshot;
  kind: MemoryKind | null;
  order: "id_asc";
  items: MemberRef[];
  coverage: {
    complete: boolean;
    reason: null | "limit" | "work_limit" | "byte_limit" | "deadline" | "state_limit";
  };
  nextCursor: string | null;
};
type MembersErrorCode =
  | "invalid_input" | "invalid_cursor" | "cursor_stale"
  | "moc_not_found" | "revision_conflict" | "invalid_ref"
  | "index_unavailable" | "storage_busy" | "context_item_too_large"
  | "database_not_found" | "unsafe_database_file" | "unsupported_database"
  | "read_in_progress" | "read_timeout" | "reader_failed" | "store_closed";
type TopicMembersResult =
  | { ok: true; value: MembersPage }
  | { ok: false; error: { code: MembersErrorCode } };
```

The three common `TopicSnapshotV1` fields are required in every member success;
`accessRevision` and `configuration` remain member-only metadata. When using a
member snapshot as a later `expectedSnapshot`, pass only its indexRevision,
generation and originToken, not the member-only fields. JSON serialization
of this three-field value preserves its validity under the token rules.

`id` is the Memory ID (not a MOC, membership row or receipt ID); `revision` is
the current Memory revision at the captured snapshot, never a MOC/index/body
revision. The namespace on every ref equals the page namespace. `kind` is the
stored kind at that revision. `label.text` equals the full `id` exactly and
`label.source` is always `identifier` in v1. The UI may localize kind and show
the identifier, but must not interpret it as a source-derived summary. No
truncation, content prefix, receipt excerpt, MOC title or stale cached title
is used as a member label. This label exposes only an already-visible ID.
No semantic-label availability varies by schema version.

A ref is emitted only after checking exact namespace, nondeleted/current and
review state `none` or `confirmed`, exact revision and projection eligibility.
Historical, awaiting, forgotten, foreign and stale revisions produce no refs,
labels or invalid-ref placeholders. Every emitted L1 membership must validate
the L1 level, namespace, MOC revision, Memory revision and projection. Every
L2 path must also validate L2→L1 levels, namespaces, endpoint revisions and
projection. No revision guessing or fallback to a stale declaration is allowed.
With no declared index state, `generation:null` means the live validated
projection; a declared unavailable generation is `index_unavailable`, never
the live fallback or a successful empty list.
Malformed consumed metadata (including an unknown eligible Memory kind,
nonpositive/unsafe revision or invalid identifier) fails `unsupported_database`;
do not silently drop a row that would otherwise be eligible.

Set, order and attribution rules are exact:

1. L1 selection returns each eligible Memory with a valid direct placement in
   that L1 once. `reportedUnder` identifies that selected L1 and its revision.
2. L2 selection returns the union of eligible Memories in all valid child L1s,
   never L1/MOC rows. A Memory filed into multiple children appears once across
   the entire cursor chain. Report it under the valid containing child with
   the smallest ID in unsigned UTF-8 byte order, with that child's revision.
   Canonical attribution depends on all valid children, not which path was
   scanned first; no ref is emitted before its attribution is settled.
3. Unfiled selection returns eligible Memories with **no valid projected L1
   placement anywhere in the exact namespace**, even if `filing_status` says
   filed. A placement in an L1 with no L2 parent still makes a Memory filed.
   A Memory filed only outside the selected L2 is not unfiled. Stale, missing,
   wrong-level, foreign or generation-excluded refs do not make it filed.
   Apply `kind` to eligible Memories, not to the definition of a valid filing.
   `reportedUnder` is always null for unfiled.
4. Deduplication identity is `(namespace,type,id)` within the traversal;
   revision is pinned and cannot change mid-chain. Order the result by `id`
   ascending using unsigned UTF-8 bytes, with no locale/case/normalization
   transform. The general tie-break is type then revision ascending; in v1
   all types are Memory and there is only one eligible revision per ID, so
   ties cannot occur. Continue strictly after the last emitted unique key.
5. Deduplication is across paths/categories **within an L2 traversal**, not a
   global suppression of legitimate membership. Independent L1 requests may
   each return a multi-filed Memory; independent overlapping L2 requests may
   too. Merge by the identity above when constructing a namespace union.
   Within one snapshot, union(all L1 members) and unfiled are disjoint and
   their union is all eligible namespace Memories. Do not sum overlapping L1
   or L2 page lengths as a namespace unique count.

There is no total on member pages: an exact total must not hide an unbounded
scan behind `LIMIT`. UI can use an overview's corresponding kind count only
when counts are complete and an opt-in overview's entire `TopicSnapshotV1`
is passed as `expectedSnapshot`, validated and echoed by the member page for
that exact namespace. Token validation establishes the live reader/store
origin; matching epoch/generation alone across stores or divergent replacements,
especially `generation:null`, is insufficient. JSON copying all three fields
preserves this fence. A kind-filtered L2 list matches that L2's
`descendantCounts.byKind[kind]`; an L1 list matches its direct count;
unfiled matches namespace unfiled count. Null kind uses `total`.
The same unexpired snapshot/token is required across separately fetched
pages/regions too; discard paired caches on expiry or other invalidation.

### Full JSON examples

Tokens below are illustrative opaque placeholders, not usable signed tokens.
Examples use short valid identifiers to keep complete envelopes readable.

Opt-in overview issuance: call `readTopicOverview` with project `atlas`,
`snapshotVersion:"topic-snapshot-v1"` and `nodeLimit:1`. The first node page has
exact counts and a transportable snapshot. Later node pages in this traversal
keep the same origin token. An otherwise identical legacy call omits the
`originToken` field; its snapshot still has only indexRevision and generation.

```json
{
  "ok": true,
  "value": {
    "snapshot": { "indexRevision": 42, "generation": null, "originToken": "opaque-origin-atlas-1" },
    "items": [
      {
        "id": "region", "revision": 7, "level": "L2", "title": null, "parentIds": [],
        "directCounts": { "total": 0, "byKind": { "fact": 0, "preference": 0, "decision": 0, "instruction": 0, "context": 0 } },
        "descendantCounts": { "total": 2, "byKind": { "fact": 1, "preference": 0, "decision": 1, "instruction": 0, "context": 0 } },
        "latestMemberCreatedAt": "2026-10-22T10:00:00.000Z",
        "lastMemberAddedAt": null, "addedAtCoverage": "not_recorded"
      }
    ],
    "totals": {
      "unique": { "total": 2, "byKind": { "fact": 1, "preference": 0, "decision": 1, "instruction": 0, "context": 0 } },
      "unfiled": { "total": 0, "byKind": { "fact": 0, "preference": 0, "decision": 0, "instruction": 0, "context": 0 } }
    },
    "coverage": { "complete": false, "countsComplete": true, "reason": "node_limit" },
    "nextCursor": "opaque-overview-page-1"
  }
}
```

First member request after a JSON round-trip of the issued snapshot:

```json
{
  "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
  "selection": { "type": "moc", "mocId": "region", "revision": 7, "level": "L2" },
  "accessRevision": "grant-4",
  "limit": 1,
  "expectedSnapshot": { "indexRevision": 42, "generation": null, "originToken": "opaque-origin-atlas-1" }
}
```

First page: request selection is `{type:"moc",mocId:"region",revision:7,level:"L2"}`,
namespace is project `atlas`, `accessRevision:"grant-4"`, and `limit:1`.
Two eligible Memories exist; `mem-001` belongs to `topic-a` and `topic-b`.

```json
{
  "ok": true,
  "value": {
    "version": "topic-members-v1",
    "status": "page",
    "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
    "selection": { "type": "moc", "mocId": "region", "revision": 7, "level": "L2" },
    "snapshot": { "indexRevision": 42, "generation": null, "originToken": "opaque-origin-atlas-1", "accessRevision": "grant-4", "configuration": "topic-members-v1" },
    "kind": null,
    "order": "id_asc",
    "items": [
      {
        "type": "memory",
        "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
        "id": "mem-001",
        "revision": 3,
        "kind": "fact",
        "label": { "text": "mem-001", "source": "identifier" },
        "reportedUnder": { "type": "l1", "mocId": "topic-a", "revision": 5 }
      }
    ],
    "coverage": { "complete": false, "reason": "limit" },
    "nextCursor": "opaque-members-page-1"
  }
}
```

Continuation: repeat normalized inputs with `cursor:"opaque-members-page-1"`.
Include the same JSON-serializable `expectedSnapshot` and origin token.
This final nonempty page exhausts the selection; do not require an extra probe.

```json
{
  "ok": true,
  "value": {
    "version": "topic-members-v1",
    "status": "page",
    "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
    "selection": { "type": "moc", "mocId": "region", "revision": 7, "level": "L2" },
    "snapshot": { "indexRevision": 42, "generation": null, "originToken": "opaque-origin-atlas-1", "accessRevision": "grant-4", "configuration": "topic-members-v1" },
    "kind": null,
    "order": "id_asc",
    "items": [
      {
        "type": "memory",
        "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
        "id": "mem-009",
        "revision": 2,
        "kind": "decision",
        "label": { "text": "mem-009", "source": "identifier" },
        "reportedUnder": { "type": "l1", "mocId": "topic-b", "revision": 8 }
      }
    ],
    "coverage": { "complete": true, "reason": null },
    "nextCursor": null
  }
}
```

End with no members: an independently selected empty personal unfiled set,
filtered to facts. The same envelope represents a continuation that reaches
EOF without another eligible match; preserve its own selection/snapshot.

```json
{
  "ok": true,
  "value": {
    "version": "topic-members-v1",
    "status": "page",
    "namespace": { "ownerId": "owner-a", "scope": "personal", "projectId": null },
    "selection": { "type": "unfiled" },
    "snapshot": { "indexRevision": 9, "generation": "generation-published-1", "originToken": "opaque-origin-personal-1", "accessRevision": "grant-2", "configuration": "topic-members-v1" },
    "kind": "fact",
    "order": "id_asc",
    "items": [],
    "coverage": { "complete": true, "reason": null },
    "nextCursor": null
  }
}
```

Stale: same cursor after correction/forget, changed membership/snapshot,
access revision, a missing/foreign/expired snapshot origin token, or any other
invalidation listed below. No items or new
snapshot are attached; discard the assembled old traversal before restarting.

```json
{ "ok": false, "error": { "code": "cursor_stale" } }
```

Partial: work ends while validating an L1 selection before its next member is
safe to emit. Zero items is progress/unknown remainder, not an empty result.

```json
{
  "ok": true,
  "value": {
    "version": "topic-members-v1",
    "status": "partial",
    "namespace": { "ownerId": "owner-a", "scope": "project", "projectId": "atlas" },
    "selection": { "type": "moc", "mocId": "topic-a", "revision": 5, "level": "L1" },
    "snapshot": { "indexRevision": 42, "generation": null, "originToken": "opaque-origin-atlas-1", "accessRevision": "grant-4", "configuration": "topic-members-v1" },
    "kind": null,
    "order": "id_asc",
    "items": [],
    "coverage": { "complete": false, "reason": "work_limit" },
    "nextCursor": "opaque-members-work-1"
  }
}
```

An emitted L1 ref uses the same complete `MemberRef` shape as above, with
`reportedUnder` equal to the selected L1. An emitted unfiled ref uses that
shape with `reportedUnder:null`. A resumable byte/deadline partial uses the
same full envelope, `status:"partial"`, reason `byte_limit`/`deadline`, a
validated prefix (possibly empty), and a nonnull continuation. Terminal state
exhaustion has `status:"partial"`, `items:[]`, reason `state_limit` and
`nextCursor:null`; it never asserts completion.

Storage temporarily unavailable, including lock acquisition failure within
E1-C's bounded wait:

```json
{ "ok": false, "error": { "code": "storage_busy" } }
```

All other failures have exactly that error envelope with their specified code;
no message, path, SQL, lock owner, source text or revision detail is exposed.
`storage_busy` does not mean empty, stale, deleted or unsupported. Retain the
UI's previously displayed state and offer a bounded caller-controlled retry.

## Cursor, snapshot, integrity and invalidation (normative)

The cursor is an opaque capability to continue one retained member traversal
on the same reader handle. It is not a body-read capability, an authorization
grant, a durable export job or an overview token. E1-M has its own version and
HMAC-SHA256 purpose domain (`topic-members-v1/cursor`), independent of `e1.`
overview and other engine cursors. Use an ephemeral CSPRNG 32-byte signing key
inside the Worker, never a caller key, environment secret or persisted key.
Sign a random continuation identity and a canonical binding digest; keep the
binding/state private rather than exposing namespaces/IDs in encoded JSON.
Verify canonical encoding, token size and MAC with timing-safe comparison
before using state. The token representation is not a public parseable DTO.

The authenticated binding includes store ID and file identity, handle/Worker
incarnation, traversal ID/sequence, owner/exact namespace, selection including
MOC revision/level, namespace epoch (`indexRevision`), active membership
`generation`, `accessRevision`, schema/configuration identity, kind/order,
all four bounds, the exact `snapshot.originToken`, and optional
`expectedSnapshot` including its exact `originToken` string. An origin token
is bound even when the traversal captured its snapshot without an expected
snapshot input. Replacing it with a different otherwise valid token does not
continue the same member cursor. Canonicalize object fields
and defaults; key insertion order or omitted versus explicit default does not
change binding. No new persisted membership counter is required: namespace
epoch plus active generation is the membership fence. A placement-only change
must invalidate even when the Memory revision and selected L2 revision stay
unchanged. Unrelated namespaces' epoch changes alone do not invalidate it.

Invalidate when the committed namespace epoch or active generation changes,
active authority becomes unavailable, or the selected MOC changes/disappears.
Staging a replacement while a published generation remains active permits
continuation against that generation until publication. An initial rebuild
that declares unavailable authority makes existing continuations `cursor_stale`
and fresh requests `index_unavailable`.

Capture a snapshot inside a short deferred transaction; recheck file/store
identity, epoch, generation, selected MOC, schema/configuration and access
binding, plus origin token MAC/bindings/expiry, in every work quantum and
immediately before emission/replay. Commit
between quanta/calls; an SQLite transaction is not held open by the cursor.
This is a revision-fenced traversal, not a historical SQLite snapshot retained
across calls. It refuses change rather than mixing revisions. A mutation
after the final validation belongs to a later snapshot; the host must still
honor its authorization at delivery.

| Condition | Exact outcome and action |
| --- | --- |
| Malformed, noncanonical, oversized, unknown-version or wrong-method member cursor; bad member-cursor MAC in a matching live incarnation | `invalid_cursor`; no usable continuation, no state advance. An unknown incarnation follows the explicit stale rule below. Origin token failures instead follow the explicit stale rule below. |
| Authenticated token with changed namespace/selection/MOC revision, kind/order, bounds or expected-snapshot input | `cursor_stale`; do not silently start a different traversal. Owner mismatch still fails input validation as `invalid_input` before cursor processing. |
| Correction, effective forget/deletion, supersede, review/visibility change, title-source change, placement/containment change, or any other committed epoch change in the namespace | `cursor_stale`, even if unrelated to the current member or excluded by kind. No-op mutations that leave the fences unchanged do not invalidate. |
| Committed namespace epoch or active generation changes, active authority becomes unavailable, or selected MOC changes/disappears | Existing cursor: `cursor_stale`. Fresh traversal while the index is unavailable: `index_unavailable`. Initial rebuild that declares unavailable authority follows these outcomes; replacement staging with an unchanged published active generation permits continuation and cached replay until publication. |
| Supplied `expectedSnapshot` has a missing/invalid/foreign/expired `originToken`, mismatched bound fields, or a member traversal's issued origin token expires/is invalidated | `cursor_stale`, including on a fresh request with an unusable expected snapshot and on cached replay. Equal epoch/generation fields alone are insufficient. A JSON copy carrying all three unchanged values is valid while the token bindings remain current. Host discards paired overview/member caches and obtains a new opt-in overview on the live reader. |
| Host changes `accessRevision` or effective configuration; schema version, policy/order/filter/label algorithm, or store/file identity changes | `cursor_stale`. Revocation closes the handle: outstanding/future requests settle `store_closed`. No stale refs are released through replay. |
| Fresh member request without cursor | Replaces only the member traversal, invalidating its older tokens; it does not silently continue it. Overview and member traversal states are separate. |
| Expired/lost traversal, new handle, Worker restart, or cursor from another store/handle | `cursor_stale` for a well-formed same-family token whose state/incarnation is absent; no automatic rebuild. Bad MAC in the live matching incarnation is `invalid_cursor`. |
| Immediate replay of the most recently completed continuation request | Revalidate all fences, then return byte-identical cached envelope; no advancement. This includes a final page and a work-only partial. Changed fences override cached success. |
| Replay of an older consumed sequence | `cursor_stale`. At most the latest input/output pair is replayable; multiple independent consumers of one cursor chain are unsupported. |

To distinguish lost incarnation from tampering, the opaque authenticated format
must carry a nonsecret random incarnation selector. Unknown incarnation returns
`cursor_stale` without attempting to resume; a matching live incarnation must
verify its MAC. This distinction grants no read access. Cross-handle/store
replay must never succeed even if file contents or namespace names match.

A first request has no replay token. If its response is lost, a fresh request
starts over. For `storage_busy`, stage progress provisionally and roll it back
to the last externally acknowledged checkpoint; retain the input continuation
so it can be retried on an unchanged snapshot. Never consume a cursor on busy
or replay a cached success without revalidation. `read_timeout`/`reader_failed`
discard the Worker and its member traversal; old cursors become stale.

## Work, bytes, deadlines and partial coverage (normative)

`limit` counts emitted unique Memory refs only. It does not bound scan work.
Charge physical work before filtering invalid, foreign, hidden, stale or
wrong-kind candidates. One work unit is an indexed physical row/EOF visit
with at most three indexed point validations, or one bounded in-memory
deduplication/attribution or snapshot-token encode/verify step over bounded
metadata fields/digests. Any additional visits/validations are new
units. Every membership/edge/title-source/projection visit and EOF probe is
charged, including dedup losers and final snapshot validation. Retained
initialization/validation progress is bounded and accounted too; metadata
opening checks cannot conceal data-dependent scans outside the budget.
Reserve work units for final fence validation before scanning; if remaining
work cannot validate a candidate and the final fence, checkpoint the candidate
and emit `partial/work_limit`. Final validation may not exceed `workLimit`.

Use namespace keyset traversal of Memory metadata and indexed membership/edge
point seeks, or an equivalent bounded keyset algorithm. All candidate paths
for the current Memory must be settled before emission; save the current
Memory's validation checkpoint if work stops mid-candidate. Retain bounded
per-Memory attribution state rather than an unbounded set of every seen ID.
Seek strictly forward, with bounded lookahead retained for the next page.
Do not skip a pending member when a page fills. No `OFFSET`, unconstrained
`COUNT`/`DISTINCT`, whole-body `SELECT *`, hidden sort/join materialization or
repeated prefix rescan may bypass work accounting. Validate required seek
index columns/order/collation; missing/malformed paths fail
`unsupported_database`, never an unnoticed full-scan fallback.

`maxBytes` means `Buffer.byteLength(JSON.stringify(result), 'utf8')` for the
whole success or failure envelope, including cursor, originToken, namespaces
and labels. Token issuance and verification are bounded work under the same
request limits, not separate unmetered scans or waits.
No out-of-band token packing or truncation of IDs/revisions is permitted.
Reserve space for continuation before appending a ref. If a single required
ref/envelope cannot fit this byte budget, return `context_item_too_large`
without consuming that input cursor. A fixed failure envelope must also fit.
Avoid an endless empty `byte_limit` continuation for an unrepresentable ref.

| Status/coverage | Meaning |
| --- | --- |
| `page`, complete true, reason null, next cursor null | EOF proven for this selection/kind at the pinned snapshot. Items may be empty. This alone establishes a complete enumeration. |
| `page`, complete false, reason `limit`, next cursor nonnull | A normal full page, with another eligible member proven by charged lookahead. |
| `partial`, complete false, reason `work_limit`, `byte_limit` or `deadline`, next cursor nonnull | A fully validated ordered prefix; remaining membership is unknown/unemitted. Empty items is allowed. Cursor retains all necessary progress. No provisional refs or exact-zero implication. |
| `partial`, complete false, reason `state_limit`, next cursor null | Terminal 8MiB logical member-state cap; this attempted page contributes no items. Prior pages remain an incomplete prefix. Do not retry the same traversal indefinitely or call it complete. |

If the item limit is reached but lookahead/EOF validation cannot finish within
remaining work/time, return a partial with that resource reason, not an invented
`limit` or complete result. If byte/work/time budgets intersect, stop at the
first observed blocker. Precedence at emission is invalidation/error, terminal
state cap, proven EOF, then the recorded bound. No state cap or budget becomes
a false successful empty namespace.

Deadline is elapsed monotonic time, reset per call, never extended by retry or
continuation. Stop ordinary scan work early enough to finish final fence
validation/serialization within `deadlineMs`; emit `partial/deadline` only if
that can be done safely. If no valid snapshot/continuation can be produced in
time, the outer watchdog terminates/discards work and settles `read_timeout`
instead. No partly validated result is delivered after an unverifiable fence.
Native operation/Worker termination/OS scheduling may delay Promise settlement;
the deadline is an execution/cancellation budget, not a real-time OS guarantee.

An unchanged finite supported store must make monotonic bounded progress and
eventually reach EOF when callers follow continuations with sufficient
budgets while the origin token remains valid. Expiry is a typed stale outcome,
not completion or a performance guarantee. Work-only partials must advance a
physical/checkpoint position; signed
tokens alone are not progress. Persistent inability to make even one safe step
must settle a typed refusal/timeout instead of minting infinite continuations.
The 8MiB logical member-state budget and 64MiB Worker old-generation limit
bound metadata retention, not total process RSS or host-wide capacity. The
host owns handle count. Idle expiry is 60,000ms; close releases all snapshots,
checkpoints, cached pages and Workers, including failure/cancellation paths.

## Concurrency and E1-C coordination (normative)

Run native SQLite in the fixed asynchronous reader Worker, using native
read-only/query-only access and short **deferred** snapshots. No writer slot,
writer/admission queue, `BEGIN IMMEDIATE`, host-wide mutex, write opener,
schema/index installation, retention sweep or journal-mode change is allowed.
Do not invoke map, inspect, content/receipt/Raw/Card reads, models or counters.
Metadata enumeration may scan a namespace over multiple bounded calls; there
is no claim of sublinear lookup or a persisted member index.

At most 64 work units or 5ms between units per transaction; commit before
yielding to the Worker event loop and before returning a page. Native indexed
operations may overrun a quantum under OS contention. Keep serialization and
bounded presentation work outside the transaction. One call may be pending
across either reader method; another returns `read_in_progress` without a
queue. It never serializes independent handles, owners or writers. Keep one
member traversal plus the overview's separate traversal; neither method's
fresh traversal replaces the other's state. Legacy overview cursors and budgets
remain unchanged; the only opt-in output extension is the specified originToken.

E1-C owns investigation and selection of the read lock-wait policy. E1-M
requires only a finite bounded wait **inside the caller's remaining deadline**,
including during opening and fence checks. It does not prescribe a particular
`busy_timeout`, polling interval, retry count, or assume that today's zero
timeout survives E1-C. Adopt E1-C's selected policy without a second hidden
retry/wait layer and without changing this DTO.

If SQLite cannot supply the required snapshot within that bounded lock wait,
return `storage_busy`, not empty items, `index_unavailable`, or `partial`.
If the overall watchdog expires first, return `read_timeout`. Busy is a
temporarily unavailable storage outcome; timeout is deadline cancellation.
Snapshots must be released before waiting again; never hold a transaction
through application sleep, user think time or a retry backoff.

Functional concurrency tests synchronize actual transaction/writer-call
boundaries. Permit the snapshot-consistent race outcomes (page before mutation,
or typed stale/busy/timeout after it); never accept a mixed page. Actual
writer-call overlap and latency gates belong only in opt-in measurements,
not ordinary tests or assumptions about a writer's PID/lifetime.

## Compatibility and implementation boundary (normative)

E1-M must read existing schema **18** and the base's current accepted topic
layouts **20, 21, 22, 23, 29, 30, 31, 32, 33** (`core/database.mjs:37`), with exact application/layout
and consumed-index validation. Physical v18 is mandatory, not a new schema
whose `user_version` was merely changed to 18. Reject 19, 24–28, below-18 and
unknown future layouts as `unsupported_database`; do not widen support by
guessing adjacent version numbers. Cards/Raw being absent is not an E1-M
failure on v18. No E1-M metadata column, stored label, persistent cursor,
new epoch table or index migration is required or permitted on read.

The v18 tables/indexes already carry all required IDs, revisions, kinds,
namespace epochs, generation membership and revision-bound paths
(`core/database.mjs:48`, `core/database.mjs:90`, `core/database.mjs:159`,
`core/index-schema.mjs:3`, `core/confirmation-schema.mjs:3`). Identifier labels
require no new storage. Consequently
v18/current no-migration support is part of acceptance, not deferred behind
a schema upgrade. Later schema additions need an explicit compatibility check.
Maintain safe-file validation and reject missing/symlinked/unsafe files without
creating them. Do not open the ordinary migration-capable core to serve reads.

Default `readTopicOverview` output, sampling behavior, title guard, count,
cursor format and defaults remain unchanged. Only callers explicitly selecting
`snapshotVersion:"topic-snapshot-v1"` receive the added snapshot originToken;
all other overview fields retain their existing shapes and semantics. Member
refs deliberately use `id` plus
`type/namespace/kind/label/reportedUnder`; overview samples retain
`{memoryId,revision}` (`core/topic-overview-storage.mjs:61`). Product must not
substitute one DTO for the other.
Coordinate only the common lock-wait behavior with E1-C; this plan does not
claim completion or choose the outcome of that branch.

Quiescent reads must preserve database/schema/data, `user_version` and journal
mode. For WAL, distinguish engine mutation from SQLite SHM read marks: existing
tests compare a native control, constrain cold differences to offsets 100–119,
and demand warmed equality (`core/test/topic-overview-raw29.test.mjs:110`).
Apply that same qualified invariant to E1-M; never use `immutable` on a live
store, restore SHM bytes or promise byte equality during concurrent writes.

Implementation must preserve SQLite-free static local transport/host/CLI
closures, use dynamic SQLite-reaching imports at the established boundary,
never `createRequire` to hide reachability, and keep schema validators compatible
with in-memory comparison databases. Include any new runtime modules and any
shipped docs in `packaging/artifact-files.json`; independently compare archive
contents with installed import/Worker reachability. This docs-only packet does
not edit that manifest: the primary registers this plan if it will be shipped.
Do not edit other sessions' tests/fixtures. Any future terminal-state guards
must cover INSERT OR REPLACE as well as UPDATE/DELETE; E1-M itself adds none.

## Observable acceptance and handoff

These are implementation obligations, not checks executed for this docs-only
packet. Each functional case uses owned synthetic stores, actual public API
calls, deterministic rendezvous where needed, immediate teardown on failure,
and canonical stored refs/revisions rather than pre-normalized input text.
No credentials, real user stores, network or provider/model requests.

| ID | Observable pass condition |
| --- | --- |
| E1M-01 Public validation and DTO | Drive the new method and opt-in overview issuance through `openMemoryReader` and assert every field/type/default above. Check both namespace scopes, every kind plus null, all selections, boundary integers, unknown names, proxies/getters/symbols/nested malformed objects and owner mismatch. Getters execute zero times. Card MOC/foreign MOC input never reveals private existence. Default/undefined-version overview requests retain the exact legacy snapshot keys and existing DTO; only `snapshotVersion:'topic-snapshot-v1'` adds originToken, with other overview metadata semantics unchanged. Unsupported versions fail invalid_input. Opt-in overview continuation requests repeat the version, and their responses retain the issued token; switching modes fails invalid_cursor. Full JSON fixtures cover issuance, JSON-transported expected snapshot, first/continuation/final empty and nonempty/stale/each partial reason/busy. No bodies, source text or extra error fields. |
| E1M-02 Complete product-scale enumeration | Build exactly **1,112 current visible Memories in four exact namespaces and 71 Memory MOCs (60 L1 + 11 L2)** with all kinds, unfiled entries, multi-filing and shared L1 children. Keep a fixture ledger from public mutation results, recording canonical IDs, revisions and placement/edge effects. Enumerate all L1s, every L2 union and unfiled through the public reader, at limits 1, 7 and 100 with unchanged snapshots. Compare every selection's sorted `(type,namespace,id,revision,kind,reportedUnder)` against an independently computed ledger set; assert no within-traversal duplicate, omission, incorrect attribution or order inversion. Cross-check a second way using exact opt-in overview direct/unique-descendant/unfiled/by-kind counts by passing the full issued snapshot/token as expectedSnapshot. Union(L1) plus unfiled per namespace must equal that namespace's ledger count; sum the four disjoint namespace unions and independently overview unique totals to **1,112**. Re-derive MOC count from public overview nodes and ledger to **71**, namespace count to **4**, diff both derivations and print counts/set differences (zero expected). Never sum overlapping L1 counts. Repeat with a larger 3,336-Memory multifiling fixture; functional completion, no elapsed timing gate. Control the origin-expiry clock in functional enumeration so token lifetime does not become a hidden throughput gate; test expiry separately below. |
| E1M-03 Visibility and isolation | Two owners with personal and multiple project namespaces, identical labels and overlapping ID prefixes. Foreign refs/edges/title sources, stale revisions, historical/deleted/awaiting and generation-excluded rows contribute no members/labels/attribution. Fixtures may inject malformed private rows for negative validation; product consumers never read private tables. Eligible unfiled with a stale filed flag appears; valid filing under an orphan L1 or outside the requested L2 stays filed. Verify fresh empty versus unavailable index, unpublished/missing/foreign generation, wrong-level edges, and label sentinels absent. |
| E1M-04 Correction, forget, supersede, placement, deletion and rebuild | Obtain both emitting and work-only cursors, mutate through public APIs, then require `cursor_stale` before cached replay or more refs. Cover correction (including kind change), effective forget, supersede, source deletion where available, review-state transition, placement filed→filed **without a Memory revision change**, filed↔unfiled and L2 edge changes. Fresh enumeration matches the new public ledger/overview: corrected current Memory may move to unfiled, forgotten/predecessor disappears, successor follows its own valid placement. No-op placement preserves a valid cursor. Mutating a different namespace alone does not stale this traversal. Add deterministic public rebuild cases: initial rebuild declaring unavailable authority makes existing continuation and cached replay `cursor_stale`, fresh requests `index_unavailable`; replacement staging with a published active generation and unchanged epoch permits continuation and byte-identical cached replay against that generation; replacement publication changes epoch/generation and makes both continuation and cached replay `cursor_stale`. Rendezvous also mutates between quanta and before emission; no mixed revisions. |
| E1M-05 Cursor integrity, binding, provenance and replay | Tamper member-cursor components/signature, truncate, oversize, use noncanonical encoding, overview/other-method tokens; expect invalid_cursor in a matching live incarnation. Origin-token failures uniformly return cursor_stale. Obtain an opt-in overview and pass `JSON.parse(JSON.stringify(snapshot))` to a fresh member request on the issuing live reader; require success and an exact three-field echo, with the same success after JSON-copying continuation inputs. Reordered fields/defaults and structured cloning also preserve validity. Create two stores with identical owner/namespace/epoch and generation:null but different members; using A's originToken on B must return cursor_stale even if B issued an equal epoch/generation itself. Stripping the token, supplying a legacy two-field snapshot, tampering/truncating/oversizing it, changing bound epoch/generation/namespace, or substituting another valid origin token into an existing member cursor also returns cursor_stale. Cross-store/handle/reopen/restart/idle-expiry replay never succeeds. Cover divergent replacement and origin loss: old tokens fail, caches are discarded, and a fresh opt-in overview restores pairing. Change access revision, bounds, kind, selection, MOC revision and effective configuration; expect cursor_stale except owner-mismatch input rejection. Immediate latest continuation replay is byte-identical only after revalidating the origin token and all fences; older consumed sequence is stale. New traversals do not revoke otherwise current origin tokens, but replace only their own traversal cursors. Test overview/member interleaving and final-page replay. |
| E1M-06 Work, bytes and finite progress | Instrument physical row/EOF visits, bounded validations, token issuance/verification and in-memory steps: per-call units never exceed workLimit, including invalid-row fanout/lookahead. With tiny caps, concatenation exactly matches a high-budget traversal. Assert complete UTF-8 envelope bytes including originToken and cursor for opt-in overview/member pages and multibyte/max-length IDs; no skipped pending member at byte/limit boundary. Issued origin tokens are nonempty printable ASCII and <=256 bytes, with no unbounded issuance registry. Test a single overlarge ref returns context_item_too_large with no consumed input, and 8MiB overflow is terminal partial/state_limit with no cursor or false zero. Forced work-only partials advance a checkpoint. No COUNT/DISTINCT/OFFSET/body-query fallback or unbounded all-member set. Use deterministic instrumentation, not throughput assertions. |
| E1M-07 Deadlines, busy and races | Controlled clocks/Worker hooks exercise partial/deadline, hard read_timeout, read_in_progress, close during read, Worker failure and idle expiry. With a controlled monotonic clock, an origin token is valid at age 59,999ms and stale at 60,000ms even on an active Worker; JSON copies, reads and replay do not extend that lifetime. Expiry during opt-in overview/member continuation or cached replay is stale, never a silently renewed token. A fresh opt-in request issues a fresh valid token; failure/busy issues none. Under E1-C's selected policy test lock release within the permitted wait and lock persistence through it, opener/final-validation contention, storage_busy checkpoint retry, and watchdog-wins timeout. A busy result is exactly the error envelope and never a zero list; previous success is never replayed across a changed fence. Other-owner writes and already-admitted capture still publish correctly. No wall-clock p95/minimum overlap/commit count in ordinary tests. |
| E1M-08 Read-only compatibility and both journal modes | Run semantic, invalidation, busy/race and lifecycle cases in **DELETE and WAL**, on real physical v18 and supported current layouts; smoke every listed intermediate accepted version. Before/after schema, user_version, journal mode and quiescent data/hash comparison prove no migration/mutation; compare cold WAL SHM with native control and warm equality as above. Reserved-writer reads succeed when SQLite permits, exclusive contention follows E1-C; snapshots release at each quantum and close. Unsupported/malformed/missing/symlink/unsafe files refuse untouched. Do not require impossible concurrent-write byte equality. |
| E1M-09 Actual installed package | Build/install the private archive offline into isolated scratch, import its installed core/index.mjs, and exercise legacy-default and opt-in overview issuance plus a JSON-serialized issued snapshot passed into first/continuation/end member reads, unfiled/L2 dedup, mutation-stale and busy via its installed reader and actual Worker. Test v18 and current, DELETE and WAL; no source-tree fallback or symlink to repository modules. Mechanically derive module/doc inventory from archive and independently installed import/Worker/asset closure, diff lists and print count; require manifest coverage and exact shipped bytes. Check real child exit, signal, cleanup and absence of source/body sentinels. |
| E1M-10 Runtime and integration matrix | Primary runs focused new core/installed cases and then the CI-equivalent regression matrix on **Node 22.16.0 and 24.15.0**, recording actual versions and exit codes; retain existing job platform coverage too. Mirror every job at this base: windows-preview, live-evidence-offline, test, pairing, codex, core, longmemeval, openai-offline, mcp (including artifact/clean-cache gates), experiment-budget, experiment-request-guard and plugin-validation (`.github/workflows/ci.yml:11`). Re-derive job/step inventory from the final workflow rather than freezing today's list. Explicitly include `test:local-transport-import` and `test:local-host-import` (`.github/workflows/ci.yml:52`), and installed CLI lifecycle reachability. Do not weaken or move another session's tests. This author runs doc/link checks only; the primary owns full queued acceptance. |
| E1M-11 Opt-in measurements only | Add an opt-in `measure:topic-members` script for cold/warm/revision-change product-scale and larger multifiling measurements: per-call work/bytes, total traversal latency, host main-loop maximum, writer-call intervals and actual overlapping reads/commits, with DELETE/WAL and both required runtimes. Timing/overlap gates belong only here, serially scheduled by primary; wire to a future CI `extra` measurement job if required, not ordinary test:core/test:mcp/test:artifact. E1-C's final wait parameters and measurement thresholds must be recorded by primary before claiming performance acceptance; no guessed outcome or existing <1s contention test copied as a new gate. |

TRAPS 1–12 apply to implementation/integration: preserve import boundaries,
actual installed reachability, manifest completeness, other-session ownership,
canonical stored-text expectations, raw fixture `STORAGE_BUSY_TIMEOUT_MS`,
actual writer-call overlap, complete terminal guards, untracked whitespace and
two-way inventories, no broad sandbox suites, and opt-in timing gates. Primary
must record actual command exits (pipefail or explicit captured status), not
infer success from a log tail. Do not remove shared/symlinked node_modules.
No user tmux pane is used; any interactive test needs a dedicated session.

Before handing off long-running implementation acceptance, primary must verify
an actual supervised continuation/notification mechanism and inspect process
progress, errors and exits. A PID/log alone is not supervision; if no monitor
is available, state that limitation rather than promising unattended checks.
Delivery remains uncommitted until primary integration/review; no UI enablement
or claim that production performance is fixed follows from this contract.

## Non-claims and out of scope

- E1-A's overview delivery is a prerequisite, not a new completion claim here.
  E1-S, E1-L and E7 remain separate packets; E1-M does not deliver selected-ref
  location APIs, broader overview features beyond opt-in snapshot issuance,
  retained-source navigation or episode
  headers. Naming adjacent packets here does not expand their contracts.
- No Memory/Card bodies, previews/excerpts, receipt/Raw text, token packing,
  tokenizer, model, semantic relevance/validation or global body export.
- No Card organization, evidence-mapping traversal, access-grant service,
  writer changes, persistent cursor jobs, schema migration, placement-added
  timestamp reconstruction, product UI implementation, deployment or pin bump.
- No guarantee that independent traversals on different snapshots combine into
  one exact list; no continuation across close/restart/expiry. No host-wide
  capacity, RSS or hard real-time scheduling claim.

## Questions the primary can paste to the product team

The API/DTO above is complete for Memory-only identifier-labeled pages; these
questions concern additional product expectations, not unspecified v1 fields:

1. Can E1-M region/member rows launch with the Memory kind and full identifier
   label specified here? If rows need a semantic title/preview without fetching
   a body, can we scope a separate stored-label/write-path contract, since E1-M
   must preserve v18 without migration and must not read body prefixes?
2. Can you provide the synthetic-world recipe (or an owned synthetic fixture)
   and expected per-namespace/L1/L2/unfiled counts for your 1,112 Memories,
   four namespaces and 71 MOCs, so primary can replay the same distribution in
   addition to the fully specified engine acceptance fixture?
