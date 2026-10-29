# Fix B S2: frozen canonical safety layout and S3 classifier

Design freeze: 2026-10-29; code references: `4db9893d`. This is an implementation specification, not an implemented capability or rollout approval.
It narrows [the catch-up design](context-read-incremental-catchup.md), §§2.2–2.3,
3.4–3.5 and 8.1, using the subsequent owner decisions.
S1 supplies the purpose-aware predicate and current-binding contributor seam. S2
replaces that seam; S3 supplies the read-only report command. No pump, quantum, publication format or reader lifecycle change is required.

## 1. Frozen contract and present gaps

Each Card body revision has one cumulative, append-only source set. Removing a
binding never removes an edge. A suppressed contributor hides the entire current
body, including its title, on every read purpose and AI path. Only a complete new
body revision can discard old contributors. Supersession alone is not suppression:
`history` keeps intact superseded sources; `current` retains its eligibility checks.
Unknown lineage denies retrieval, draft inspection, confirmed review and AI use. An empty binding list never proves authorship. Purpose remains trusted core dispatch.

The three logical entities remain `card_body_provenance`, `card_body_sources` and
`content_suppressions`. Physical support adds permanent identity reservations,
a migration control row and content-free authorization records. Nothing stores
source text. Old source sets and suppression facts survive deletion and rebuilding.

| Current fact, with evidence | Required change |
| --- | --- |
| Draft insert has null `body_revision`; confirmation assigns 1 (`core/private-card-storage.mjs:170`, `:208`). | Allocate positive revisions from creation; confirmation preserves them. |
| `putRefs` deletes both binding tables; edit increments body revision only for changed confirmed title/body (`core/private-card-storage.mjs:99`, `:214`–`:219`). | Bindings remain presentation/support state; durable contributors union independently. |
| `authoredInput` inserts a note and binds it (`core/private-card-storage.mjs:166`–`:172`). | Record explicit authorship with zero external edges; that synthetic input note is not a contributor. |
| Card purge clears bytes and bindings (`core/private-card-storage.mjs:148`–`:154`); Memory receipt ancestry cascades (`core/raw-lineage-schema.mjs:11`–`:20`). | Preserve identity, contributor and suppression records outside these children. |
| Ledger records method, keyed payload binding, target and result, not input (`core/private-operation-helpers.mjs:18`–`:20`); binding is HMAC (`core/private-card-input.mjs:92`–`:93`). | A commitment alone cannot recover sources or certify completeness. |
| Product layouts use numeric introduction thresholds (`core/context-product-schema.mjs:172`–`:181`); method attachments use `>=31` (`core/method-package-storage.mjs:46`). | Resolve physical version to base features before testing any threshold. |

Deferred: external erasure ledger/watermark/restore admission; fourth-purpose
recovery inspection/restricted metadata; suppression pulls.
No S2 API implements these. No backup may be restored to serving in the interim. This narrows the older §3.5/§9 aggregate. Leave typed denial and evidence-import seams.

## 2. Identity, versions and commitments

### 2.1 Durable identity and refusal of ambiguous refs

The internal address is `(storeId, owner, scope, project, kind, key, incarnation, version)`. Personal project is the empty string in SQL and null at public boundaries.
All string keys use BINARY comparison; no Unicode folding or delimiter concatenation.
Kinds are `memory`, `receipt`, `submitted-note`, `raw`, `card`; `owner` is only a suppression target. Namespace access is checked independently of identity.

| Kind | Existing allocation and deletion evidence | S2 identity |
| --- | --- | --- |
| Memory | UUID at `core/runtime.mjs:239`–`:243`; forget retains a deleted row at `:305`–`:307`. PK only at `core/database.mjs:49`–`:66`. | Key = Memory id. New incarnation = fresh id under permanent reservation; legacy = newly allocated migration incarnation. |
| Receipt | UUID at `core/runtime.mjs:118`–`:122`; correction/removal delete it at `:278`, `:325`; old migration also generates UUIDs (`core/database.mjs:124`–`:129`). | Key = receipt id, with its parent Memory edge recorded separately. |
| Submitted note | UUID at `core/private-card-storage.mjs:85`–`:87`; state/revision tombstone at `:180`. | Key = note id, independent of its mutable revision. |
| Raw | Conversation UUID at `core/raw-journal.mjs:123`; message id supplied in a conversation (`core/raw-schema.mjs:36`–`:45`); conversation hard deletion at `core/raw-deletion-storage.mjs:139`–`:142`. | Key = conversation id; incarnation belongs to the conversation. Message/span belongs in version, never a globally reusable bare message id. |
| Card | UUID at `core/private-card-storage.mjs:169`; PK at `core/private-card-schema.mjs:15`–`:23`. v33 guards protect only particular parent states (`core/card-current-schema.mjs:53`–`:55`). | Key = Card id; body identity adds positive body revision. |

These are collision-resistant generators, not durable never-reused allocation
proofs. None of the cited allocators reserves a deleted id forever. Do not assert
that UUID syntax alone supplies such proof. S2 permanently reserves every observed
key, including keys recovered only from edges or tombstones. Recreation uses a new
key and incarnation; reusing an old key is forbidden even with a new incarnation. A registry conflict is never repaired by replacing the row.
Install canonical BEFORE INSERT guards that reject an existing reservation or live
row, including explicit rowid collisions, and AFTER INSERT reservation triggers in
the same transaction. Receipts derive namespace from their parent. Raw message/part
inserts must retain their original conversation and immutable message/span identity;
content changes fail identity checks. Registry triggers install after legacy seeding.
Do not reserve a losing `INSERT OR IGNORE` receipt candidate: reserve the actual
inserted receipt only (`core/runtime.mjs:119`–`:128`). Id generation retries a fresh
UUID on collision; caller-supplied reuse refuses. Guard UPDATE of canonical ids,
rowids and namespaces, and reject resurrection of terminal states. Hard deletion may remove canonical rows, but cannot remove their reservations.

Legacy reservations have `bare_ref_safe=0`. Migration observation is not evidence
of lifetime no reuse. Set it to 1 only when an independently verified lifetime
allocation record establishes exactly one original incarnation; otherwise it stays
0 forever. For new S2 allocations the guarded birth is that evidence. A bare ref resolves only to that one reservation, never to a replacement or guessed legacy incarnation. Exact revision/content checks still apply. Existing ref DTOs contain
no incarnation (`core/private-evidence-input.mjs:12`–`:23`), so unsafe legacy bare
refs must refuse. S2 adds a versioned internal typed-ref envelope, including
incarnation, to canonical prepared read/refetch records; it does not silently
add a public purpose flag. Hosts needing explicit legacy identities use a separately
versioned exact-ref input; ordinary old ref syntax receives no migration exception.

### 2.2 Source version and ancestry encoding

`source_version` is canonical JSON, an array, encoded as UTF-8 without whitespace.
Integer revisions are positive safe integers. No source text enters these arrays.

| Kind | Version tuple and content check |
| --- | --- |
| Memory | `["memory-content-v1", eraToken]`; eraToken is the reserved revision at the last content write, including an identical-byte correction. Registry kind `memory-era` stores `[memoryId,eraToken]` and the exact content/fingerprint HMAC. Metadata/currentness changes do not allocate an era. Bound API revision remains separate. |
| Receipt | `["receipt-v1", boundMemoryRevision]`; content identity recomputes the existing receipt commitment using that bound revision and current receipt fields (`core/card-receipt-sources.mjs:13`–`:17`). Add a Memory-era ancestor edge, so unchanged receipts cannot conceal a Memory text change. |
| Submitted note | `["note-v1", revision]`; recompute the note content identity (`core/private-card-storage.mjs:38`–`:40`). |
| Raw | `["raw-span-v1", messageId, start, end]`; identity binds retained bytes, role and exact span, plus conversation incarnation. Conversation's changing metadata revision is not a text incarnation. |
| Unresolved legacy association | `["legacy-unresolved-v1", evidenceDigest]`; content identity is empty. Positive association remains useful for suppression, never for completeness. |

Memory-era reservations share the Memory incarnation and persist forever. An indexed
maximum token identifies its current era; readers require that token and recompute
its content HMAC: `HMAC("memory-era-s2-v1",[storeId,namespace,memoryIncarnation,eraToken,content,fingerprint])`. Migration allocates the current revision as a boundary token,
without claiming it was the last legacy content-write revision. Unknown old-era
associations remain unresolved. Correction allocates a new token even for equal bytes.
A receipt contributes itself, its parent Memory era and all resolved Raw ancestors.
A direct Raw source contributes its exact span and conversation erasure identity. Raw whole-conversation suppression matches every span; span suppression matches
interval overlap in the same message/incarnation, not JSON string equality.
Current ancestry originates in `core/raw-lineage-storage.mjs:26`–`:41`, `:100`–`:113`
and source-root resolution in `core/raw-lineage-storage.mjs:68`–`:96`.
An unresolved ancestor makes lineage unknown. A verified independent receipt has no invented Raw ancestor. Derived Cards are not an accepted input today
(`core/private-card-input.mjs:95`–`:116`, `:191`–`:192`); keep a flatten-complete-
transitive-set seam, with cycle/unresolved ancestry refusal, before adding that kind.

Commitments use HMAC-SHA256 with the canonical store secret and distinct domains;
hex output is 64 lower-case characters. Wrap existing 43-character source commitments
in a domain-separated S2 HMAC stored as hex; never merely reinterpret their text. Never publish these or unhashed body bytes.
`bodyDigest = HMAC("card-body-s2-v1", [storeId, namespace, cardIncarnation,
bodyRevision, canonicalTitle, canonicalBody])`. It includes title and body after `cardText` normalization (`core/private-card-input.mjs:77`–`:82`).
`provenanceDigest = HMAC("card-provenance-s2-v1", [storeId, namespace,
cardIncarnation, bodyRevision, provenanceRevision, bodyDigest, completeness, origin,
authorizationActionOrNull, sortedSourceTuples])`. Sort canonical source tuples by
UTF-8 byte order; include kind/key/incarnation/version/content identity. Deduplicate
exact tuples, never truncate. Evidence origin is audit metadata, not source content.

## 3. Physical versions and opener contract

Keep application id `0x43414952` (`core/database.mjs:37`). Allocate safety versions
disjoint from existing versions through 33. They encode base layout,
not feature growth. Safety revision is 1; control state is `staged` or `ready`.
Only `ready` with matching metadata and verification seal permits serving.

| Physical | Base layout | Safety revision | Migration state accepted for serving |
| --- | --- | --- | --- |
| 34 | 18 | 1 | ready |
| 35 | 20 | 1 | ready |
| 36 | 21 | 1 | ready |
| 37 | 22 | 1 | ready |
| 38 | 23 | 1 | ready |
| 39 | 24 | 1 | ready |
| 40 | 25 | 1 | ready |
| 41 | 26 | 1 | ready |
| 42 | 27 | 1 | ready |
| 43 | 28 | 1 | ready |
| 44 | 29 | 1 | ready |
| 45 | 30 | 1 | ready |
| 46 | 31 | 1 | ready |
| 47 | 32 | 1 | ready |
| 48 | 33 | 1 | ready |

The same pairs with `staged` are maintenance-only; they refuse all owner reads
and ordinary writes. Any other pair/state, missing marker, extra safety objects
under a legacy version, wrong DDL, partial body inventory or failed consistency
check refuses. A partially committed migration is never interpreted as legacy.
The default migrator enables only 18, 23, 33 and the deployed layout after host
attestation. Other rows reserve an unambiguous mapping, not wider rollout support.
Selecting the deployed cell requires host attestation. No v19 mapping exists (`core/private-card-schema.mjs:1`).
Base 18 installs only control, reservations and suppressions plus applicable
Memory/receipt guards. It never gets Card provenance, authorization or source tables.
Base 20 has notes/Cards but no receipt binding table; base 21 adds it, 22 reviews,
23 organization (`core/private-card-schema.mjs:1`–`:2`, `:56`–`:65`;
`core/private-evidence-schema.mjs:1`; `core/private-organization-schema.mjs:1`). Raw bases 24–28 and control 29 retain their respective features
(`core/raw-schema.mjs:2`–`:3`; `core/raw-lineage-schema.mjs:1`; `core/raw-deletion-schema.mjs:1`; `core/raw-source-schema.mjs:3`;
`core/local-authority-schema.mjs:3`). Optional features never follow physical magnitude.

One SQLite-free `core/content-safety-layout.mjs` owns the mapping and capability
resolver. Do not temporarily rewrite `user_version` to run a validator. Existing
feature upgrades must dispatch on the resolved base, atomically choose another
listed safety version, and retain safety rows/guards; unsupported upgrades refuse.
New stores finish their selected base installation then install ready S2 in the
same initialization transaction. No option-off path bypasses installed safety.

| Opener / consumer at this base | S2 change |
| --- | --- |
| Write initialization and existing-store branch, `core/database.mjs:355`–`:375`, `:413`–`:425`, `:683`–`:695` | Dispatch safety before legacy initialization; validate exact mapped base and ready control. Never run old threshold upgrades on physical 34–48. Explicit maintenance entry alone migrates existing stores. |
| `READ_SCHEMA_VERSIONS`, `CONTEXT_READ_SCHEMA_VERSIONS`, `core/database.mjs:40`–`:45` | Add mapped ready versions corresponding to each list's existing bases. READ remains narrower; context additionally admits mapped 24–28. Lists alone never attest readiness. |
| Read open, `core/read-database.mjs:26`–`:32`, `:54`–`:77` | Read-only handle, map version, validate safety metadata/control, then base feature checks. No DDL or repair. |
| Topic deferred/opening, `core/topic-members-session.mjs:41`–`:54`, `core/topic-members-opening.mjs:18`–`:22`, `:94`; overview Worker `core/topic-overview-worker.mjs:43` | Pass resolved base into feature-marker checks and attest ready safety before any response; preserve bounded traversal and lifecycle. Reader-open implementation can call the shared resolver at its current validation seam. |
| Product validator, `core/context-product-schema.mjs:170`–`:190` | Keep metadata-only validation; check base shapes plus exact safety tables/indexes/guards/control. Never read body inventory on unauthenticated bootstrap. Runtime checks verify body headers per item. |
| Existing-store options/validation, `core/existing-store.mjs:14`, `:85`–`:103` | Add `safety1-existing-v1` with exact expected base/store identity; old schema pins refuse migrated stores until explicitly upgraded. Validate base-specific optional modules, not `physical>=31`. |
| Method attachments, `core/method-package-storage.mjs:46`; upgrades `core/method-package-migration.mjs:15`–`:30` | Use mapped `assets` capability; refuse method migration on an unmapped or staged store, preserve safety on supported upgrades. |
| Context facade feature selection, `core/context-read-facade.mjs:123` | Resolve Card feature support from base, preserving product's base-23 Card floor. Shared predicate fetches current body/digests even when callers pass metadata-only rows. |
| Installed permission probe/setup, `integrations/client/raw/local-host-permission.mjs:18`–`:35`, `integrations/client/raw/local-setup.mjs:61`–`:79` | Replace local numeric lists/thresholds with shared attestation and explicit safety pin. Raw/control still require base 29+. |
| Local capture preflight, `adapters/local/configuration.mjs:75`–`:90` | Use shared ready/base attestation before transport startup; retain lazy SQLite import and inode checks. This preflight is not S3. |
| CLI identity probes, `adapters/mcp/context-read-command.mjs:18`–`:25`, `adapters/mcp/method-package-command.mjs:65`–`:74`, `adapters/mcp/asset-command.mjs:52`–`:69` | Validate safety before returning identity/secret metadata; replace asset numeric thresholds with base capability. `core/store-fence.mjs:59`–`:71` continues comparing the real physical version without relabeling. |
| Installed Worker, `integrations/client/raw/local-worker.mjs:8`, `:28`; retained CLI `adapters/mcp/retained-raw.mjs:17`–`:25`, `:65`; CLI dispatch `adapters/mcp/cli.mjs:292`–`:313` | Worker inherits permission probe; CLI uses safety-aware existing-store pin and never falls back to old writers. No worker supervision redesign. |
| Backup/restore | Canonical facade exports have no backup/restore API (`core/contract.mjs:1181`–`:1194`); qualification uses `tools/testing/fixtures/context-product/storage-child.mjs:72`–`:74`. Maintenance backup must preserve all safety/identity/accounting state and verify it offline. Restore to serving refuses operationally; no new admission protocol. |
| Derived sidecar reset, `core/context-product-sidecar.mjs:758`–`:765` | Its comment calls it a restore gate, but it only clears sidecar state. It is not canonical restore admission; no change to reset/publication required. |

Old binaries refuse via product's finite list (`core/context-product-schema.mjs:172`),
read's finite lists (`core/read-database.mjs:56`–`:57`), existing-store's 29–33 list
(`core/existing-store.mjs:87`–`:91`), and ordinary initialize's rejection of nonempty
unknown layouts (`core/database.mjs:620`–`:621`; feature path also `:416`–`:417`).
Installed permission/setup have their own finite lists cited above. Quiescence must
close already-open old handles; a new version cannot revoke an existing connection.
Never lower `user_version`; S2 also rejects safety objects under a legacy number.

Keep all modules statically reachable from CLI/transport/host SQLite-free. The
layout, classifier, schema and command router take handles or use no SQLite.
Dynamically import `node:sqlite` inside execution functions, as installed setup
already does (`integrations/client/raw/local-setup.mjs:61`). Relative dynamic module
imports must also load in installed lifecycle checks. No `createRequire` hiding. Schema reference databases use `new db.constructor(':memory:')`, as at
`core/card-current-schema.mjs:65`–`:68`; no new native static import is needed.

## 4. Exact tables and safety guards

The SQL below is normative. Run with foreign keys ON. Tables use STRICT and
WITHOUT ROWID so REPLACE cannot exploit a separate rowid conflict. Suppressions
also use a content-free fact id; no mutable source-row FK exists. All omitted
ON DELETE actions are NO ACTION, never CASCADE. No custom SQL hash function is
required under `trusted_schema=OFF` (`core/database.mjs:406`). HMAC verification
belongs in the shared helper on every writer/read and in migration verification.

```sql
CREATE TABLE content_safety_control (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 base_layout INTEGER NOT NULL CHECK(base_layout IN (18,20,21,22,23,24,25,26,27,28,29,30,31,32,33)),
 safety_revision INTEGER NOT NULL CHECK(safety_revision=1),
 migration_state TEXT NOT NULL CHECK(migration_state IN ('staged','ready')),
 migration_id TEXT NOT NULL CHECK(length(migration_id)>0),
 classifier_revision TEXT NOT NULL CHECK(classifier_revision='legacy-s2-v1'),
 inventory_digest TEXT NOT NULL CHECK(length(inventory_digest)=64 AND inventory_digest NOT GLOB '*[^0-9a-f]*'),
 verification_seal TEXT CHECK(verification_seal IS NULL OR (length(verification_seal)=64 AND verification_seal NOT GLOB '*[^0-9a-f]*')),
 CHECK((migration_state='staged' AND verification_seal IS NULL) OR (migration_state='ready' AND verification_seal IS NOT NULL))
) STRICT, WITHOUT ROWID; CREATE TABLE content_identity_reservations (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND
   ((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0))),
 kind TEXT NOT NULL CHECK(kind IN ('memory','receipt','submitted-note','raw','card','raw-message','raw-part','memory-era')),
 stable_key TEXT NOT NULL CHECK(length(stable_key) BETWEEN 1 AND 1024),
 incarnation TEXT NOT NULL CHECK(length(incarnation) BETWEEN 1 AND 200),
 birth TEXT NOT NULL CHECK(birth IN ('s2','legacy','verified-legacy')),
 bare_ref_safe INTEGER NOT NULL CHECK(bare_ref_safe IN (0,1)),
 evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(owner_id,scope,project_id,kind,stable_key),
 UNIQUE(owner_id,scope,project_id,kind,stable_key,incarnation),
 CHECK((birth='legacy' AND bare_ref_safe=0) OR
       (birth IN ('s2','verified-legacy') AND bare_ref_safe=1)),
 CHECK(kind!='memory-era' OR (json_valid(stable_key) AND json_type(stable_key)='array' AND json_array_length(stable_key)=2 AND json_type(stable_key,'$[0]')='text' AND json_type(stable_key,'$[1]')='integer' AND json_extract(stable_key,'$[1]') BETWEEN 1 AND 9007199254740991))
) STRICT, WITHOUT ROWID; CREATE INDEX content_memory_era ON content_identity_reservations
 (owner_id,scope,project_id,json_extract(stable_key,'$[0]'),CAST(json_extract(stable_key,'$[1]') AS INTEGER) DESC) WHERE kind='memory-era';
CREATE TABLE content_suppressions (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('owner','personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND
   ((scope IN ('owner','personal') AND project_id='') OR (scope='project' AND length(project_id)>0))),
 fact_id TEXT NOT NULL CHECK(length(fact_id) BETWEEN 1 AND 200),
 kind TEXT NOT NULL CHECK(kind IN ('owner','memory','receipt','submitted-note','raw','card')),
 stable_key TEXT NOT NULL, incarnation TEXT NOT NULL,
 match_mode TEXT NOT NULL CHECK(match_mode IN ('owner','incarnation','version','span')),
 source_version TEXT NOT NULL CHECK(source_version='*' OR (json_valid(source_version) AND json_type(source_version)='array')),
 message_key TEXT NOT NULL DEFAULT '', span_start INTEGER NOT NULL DEFAULT 0,
 span_end INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL CHECK(reason IN ('user_forget','correction_supersession','purge','privacy_erase','account_erasure')),
 action_id TEXT NOT NULL CHECK(length(action_id) BETWEEN 1 AND 200),
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)>0),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','canonical-tombstone','verified-operation','verified-trace')),
 evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
 cleanup_status TEXT NOT NULL CHECK(cleanup_status IN ('pending','failed','complete')),
 cleanup_attempt INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_attempt BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(owner_id,fact_id),
 CHECK((match_mode='owner' AND scope='owner' AND kind='owner' AND stable_key='' AND incarnation='' AND source_version='*') OR
       (match_mode!='owner' AND scope!='owner' AND kind!='owner' AND length(stable_key) BETWEEN 1 AND 200 AND length(incarnation) BETWEEN 1 AND 200)),
 CHECK((match_mode='span' AND kind='raw' AND source_version='*' AND length(message_key)>0 AND span_start>=0 AND span_end>span_start) OR
       (match_mode!='span' AND message_key='' AND span_start=0 AND span_end=0)),
 CHECK((match_mode='version' AND source_version!='*') OR (match_mode!='version' AND source_version='*'))
) STRICT, WITHOUT ROWID; CREATE INDEX content_suppression_target ON content_suppressions
 (owner_id,scope,project_id,kind,stable_key,incarnation,match_mode);
CREATE INDEX content_suppression_cleanup ON content_suppressions(cleanup_status,owner_id,fact_id);
```

Install the following only for Card-capable bases. `card_kind` is constant to
allow an exact typed FK without inventing an untyped incarnation namespace.
`authorization_action` is null for derived creation and legacy classification.

```sql
CREATE TABLE card_body_authorizations (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 host_action_id TEXT NOT NULL CHECK(length(host_action_id) BETWEEN 1 AND 200),
 card_id TEXT NOT NULL, card_incarnation TEXT NOT NULL,
 body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
 authorized_at TEXT NOT NULL CHECK(length(authorized_at)>0),
 authorization_kind TEXT NOT NULL CHECK(authorization_kind IN ('authored-input','keep-as-own','user-rewrite')),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 payload_binding TEXT NOT NULL CHECK(length(payload_binding)=64 AND payload_binding NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(owner_id,scope,project_id,host_action_id),
 UNIQUE(owner_id,scope,project_id,card_incarnation,body_revision)
) STRICT, WITHOUT ROWID; CREATE TABLE card_body_provenance (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_kind TEXT NOT NULL DEFAULT 'card' CHECK(card_kind='card'),
 card_id TEXT NOT NULL, card_incarnation TEXT NOT NULL,
 body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 provenance_revision INTEGER NOT NULL CHECK(provenance_revision BETWEEN 1 AND 9007199254740991),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 provenance_digest TEXT NOT NULL CHECK(length(provenance_digest)=64 AND provenance_digest NOT GLOB '*[^0-9a-f]*'),
 completeness TEXT NOT NULL CHECK(completeness IN ('complete','unknown')),
 origin TEXT NOT NULL CHECK(origin IN ('derived','user-authored','legacy-unknown')),
 source_count INTEGER NOT NULL CHECK(source_count BETWEEN 0 AND 9007199254740991),
 authorization_action TEXT,
 PRIMARY KEY(owner_id,scope,project_id,card_incarnation,body_revision,provenance_revision),
 FOREIGN KEY(owner_id,scope,project_id,card_kind,card_id,card_incarnation)
   REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,scope,project_id,authorization_action)
   REFERENCES card_body_authorizations(owner_id,scope,project_id,host_action_id),
 CHECK((origin='user-authored' AND completeness='complete' AND authorization_action IS NOT NULL) OR origin!='user-authored'),
 CHECK(origin!='legacy-unknown' OR completeness='unknown')
) STRICT, WITHOUT ROWID; CREATE TABLE card_body_sources (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_incarnation TEXT NOT NULL,
 body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 source_owner TEXT NOT NULL, source_scope TEXT NOT NULL CHECK(source_scope IN ('personal','project')),
 source_project TEXT NOT NULL CHECK((source_scope='personal' AND source_project='') OR (source_scope='project' AND length(source_project)>0)),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('memory','receipt','submitted-note','raw')),
 source_key TEXT NOT NULL, source_incarnation TEXT NOT NULL,
 source_version TEXT NOT NULL CHECK(json_valid(source_version) AND json_type(source_version)='array'),
 content_identity TEXT NOT NULL CHECK(content_identity='' OR
   (length(content_identity)=64 AND content_identity NOT GLOB '*[^0-9a-f]*')),
 added_revision INTEGER NOT NULL CHECK(added_revision BETWEEN 1 AND 9007199254740991),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','binding','receipt-ancestry','verified-operation','verified-trace')),
 evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(owner_id,scope,project_id,card_incarnation,body_revision,
   source_owner,source_scope,source_project,source_kind,source_key,source_incarnation,source_version),
 FOREIGN KEY(source_owner,source_scope,source_project,source_kind,source_key,source_incarnation)
   REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,scope,project_id,card_incarnation,body_revision,added_revision)
   REFERENCES card_body_provenance(owner_id,scope,project_id,card_incarnation,body_revision,provenance_revision)
   DEFERRABLE INITIALLY DEFERRED,
 CHECK(source_owner=owner_id)
) STRICT, WITHOUT ROWID; CREATE INDEX card_body_source_erasure ON card_body_sources
 (source_owner,source_scope,source_project,source_kind,source_key,source_incarnation);
CREATE INDEX card_body_header_current ON card_body_provenance
 (owner_id,scope,project_id,card_id,body_revision,provenance_revision DESC);
```

Sources are inserted before their sealing header, with `added_revision=max+1`.
Header revision 1 seals the initial set. Later immutable headers seal the cumulative
set, not copies of bindings. There is no mutable header pointer: select the largest
provenance revision for the canonical Card's exact current body revision.
The deferred FK prevents committed unsealed additions; the insert guard below
prevents additions to an already sealed revision. All constraints are validated
before COMMIT; never use `defer_foreign_keys` to bypass a failed final check.

```sql
CREATE TRIGGER safety_control_replace BEFORE INSERT ON content_safety_control
 WHEN EXISTS(SELECT 1 FROM content_safety_control)
 BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_control_delete BEFORE DELETE ON content_safety_control
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_control_update BEFORE UPDATE ON content_safety_control
 WHEN OLD.migration_state!='staged' OR NEW.migration_state!='ready' OR
 NEW.singleton IS NOT OLD.singleton OR NEW.base_layout IS NOT OLD.base_layout OR
 NEW.safety_revision IS NOT OLD.safety_revision OR NEW.migration_id IS NOT OLD.migration_id OR
 NEW.classifier_revision IS NOT OLD.classifier_revision OR NEW.inventory_digest IS NOT OLD.inventory_digest
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_replace BEFORE INSERT ON content_identity_reservations
 WHEN EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind=NEW.kind AND stable_key=NEW.stable_key)
 BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_reservation_update BEFORE UPDATE ON content_identity_reservations
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_delete BEFORE DELETE ON content_identity_reservations
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_suppression_replace BEFORE INSERT ON content_suppressions
 WHEN EXISTS(SELECT 1 FROM content_suppressions WHERE owner_id=NEW.owner_id AND fact_id=NEW.fact_id)
 BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_suppression_delete BEFORE DELETE ON content_suppressions
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_suppression_update BEFORE UPDATE ON content_suppressions
 WHEN (NEW.owner_id,NEW.scope,NEW.project_id,NEW.fact_id,NEW.kind,NEW.stable_key,NEW.incarnation,
 NEW.match_mode,NEW.source_version,NEW.message_key,NEW.span_start,NEW.span_end,NEW.reason,NEW.action_id,
 NEW.recorded_at,NEW.evidence_origin,NEW.evidence_digest) IS NOT
 (OLD.owner_id,OLD.scope,OLD.project_id,OLD.fact_id,OLD.kind,OLD.stable_key,OLD.incarnation,
 OLD.match_mode,OLD.source_version,OLD.message_key,OLD.span_start,OLD.span_end,OLD.reason,OLD.action_id,
 OLD.recorded_at,OLD.evidence_origin,OLD.evidence_digest) OR
 NEW.cleanup_attempt!=OLD.cleanup_attempt+1 OR OLD.cleanup_status='complete'
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_authorization_replace BEFORE INSERT ON card_body_authorizations
 WHEN EXISTS(SELECT 1 FROM card_body_authorizations WHERE
 (owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND host_action_id=NEW.host_action_id) OR
 (owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND card_incarnation=NEW.card_incarnation AND body_revision=NEW.body_revision))
 BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_authorization_update BEFORE UPDATE ON card_body_authorizations
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_authorization_delete BEFORE DELETE ON card_body_authorizations
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_update BEFORE UPDATE ON card_body_sources
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_delete BEFORE DELETE ON card_body_sources
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_insert BEFORE INSERT ON card_body_sources
 WHEN NEW.added_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p
 WHERE (p.owner_id,p.scope,p.project_id,p.card_incarnation,p.body_revision)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision)),0) OR
 EXISTS(SELECT 1 FROM card_body_sources s WHERE
 (s.owner_id,s.scope,s.project_id,s.card_incarnation,s.body_revision,s.source_owner,s.source_scope,s.source_project,s.source_kind,s.source_key,s.source_incarnation,s.source_version)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision,NEW.source_owner,NEW.source_scope,NEW.source_project,NEW.source_kind,NEW.source_key,NEW.source_incarnation,NEW.source_version))
 BEGIN SELECT RAISE(ABORT,'safety_source_sealed'); END;
CREATE TRIGGER safety_header_update BEFORE UPDATE ON card_body_provenance
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_delete BEFORE DELETE ON card_body_provenance
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_insert BEFORE INSERT ON card_body_provenance
 WHEN NEW.provenance_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p
 WHERE (p.owner_id,p.scope,p.project_id,p.card_incarnation,p.body_revision)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision)),0) OR
 NEW.source_count != (SELECT count(*) FROM card_body_sources s WHERE
 (s.owner_id,s.scope,s.project_id,s.card_incarnation,s.body_revision)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision)) OR
 EXISTS(SELECT 1 FROM card_body_provenance p WHERE
 (p.owner_id,p.scope,p.project_id,p.card_incarnation,p.body_revision)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision) AND
 (p.card_id IS NOT NEW.card_id OR p.body_digest IS NOT NEW.body_digest OR p.completeness IS NOT NEW.completeness OR
  p.authorization_action IS NOT NEW.authorization_action OR
  (p.origin!=NEW.origin AND NOT(p.origin='user-authored' AND NEW.origin='derived')))) OR
 (NEW.completeness='complete' AND EXISTS(SELECT 1 FROM card_body_sources s WHERE
 (s.owner_id,s.scope,s.project_id,s.card_incarnation,s.body_revision)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_incarnation,NEW.body_revision) AND s.content_identity='')) OR
 (NEW.completeness='complete' AND NEW.source_count=0 AND NEW.origin!='user-authored') OR
 (NEW.origin='user-authored' AND NEW.source_count!=0) OR
 (NEW.authorization_action IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_body_authorizations a WHERE
 (a.owner_id,a.scope,a.project_id,a.host_action_id,a.card_id,a.card_incarnation,a.body_revision,a.body_digest)=
 (NEW.owner_id,NEW.scope,NEW.project_id,NEW.authorization_action,NEW.card_id,NEW.card_incarnation,NEW.body_revision,NEW.body_digest)))
 BEGIN SELECT RAISE(ABORT,'safety_header_invalid'); END;
```

These BEFORE INSERT checks run before REPLACE's implicit deletion, independent of
`recursive_triggers`; conflict suppression is not idempotency. Retry helpers read
and compare exact stored facts, then skip an equal insert. Conflicting facts abort.
Header regressions and unknown-to-complete promotion within a body are impossible.
A later header must add sources; writer rejects no-op revisions. SQL count plus
immutable old sources enforces monotonicity; helper verifies HMAC,
canonical version shapes, complete ancestry and authorization before sealing.
Unknown rows may carry unresolved positive edges, including known suppressed ones.

Canonical parent insert/identity/resurrection guards are also mandatory, on every
base where that table exists; their exact expansion is specified in §4.1 below.
No guard deletes safety rows when a parent is purged. No SQL trigger purports to
prove a digest or that an input set truthfully covers a model's undocumented inputs.
All supported writers must receive the complete declared inputs from trusted core.
Direct SQL body changes without matching headers deny by the recomputed digest;
missing canonical rows deny even if a tombstone writer was bypassed.

### 4.1 Canonical allocation guard expansion

Install only guards whose canonical tables exist in the mapped base. These
reservations outlive canonical rows. Existing rows are seeded before installation.

```sql
CREATE TRIGGER safety_memories_insert BEFORE INSERT ON memories
 WHEN EXISTS(SELECT 1 FROM memories WHERE id=NEW.id OR rowid=NEW.rowid OR (NEW.deleted=0 AND deleted=0 AND (owner_id,scope,project_id,fingerprint)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.fingerprint))) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='memory' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_memories_reserve AFTER INSERT ON memories
 BEGIN INSERT INTO content_identity_reservations VALUES(NEW.owner_id,NEW.scope,NEW.project_id,'memory',NEW.id,NEW.id,'s2',1,'0000000000000000000000000000000000000000000000000000000000000000'); END;
CREATE TRIGGER safety_memories_identity BEFORE UPDATE ON memories
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_card_notes_insert BEFORE INSERT ON card_notes
 WHEN EXISTS(SELECT 1 FROM card_notes WHERE id=NEW.id OR rowid=NEW.rowid) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='submitted-note' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_card_notes_reserve AFTER INSERT ON card_notes
 BEGIN INSERT INTO content_identity_reservations VALUES(NEW.owner_id,NEW.scope,NEW.project_id,'submitted-note',NEW.id,NEW.id,'s2',1,'0000000000000000000000000000000000000000000000000000000000000000'); END;
CREATE TRIGGER safety_card_notes_identity BEFORE UPDATE ON card_notes
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_private_cards_insert BEFORE INSERT ON private_cards
 WHEN EXISTS(SELECT 1 FROM private_cards WHERE id=NEW.id OR rowid=NEW.rowid) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='card' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_private_cards_reserve AFTER INSERT ON private_cards
 BEGIN INSERT INTO content_identity_reservations VALUES(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'s2',1,'0000000000000000000000000000000000000000000000000000000000000000'); END;
CREATE TRIGGER safety_private_cards_identity BEFORE UPDATE ON private_cards
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_conversations_insert BEFORE INSERT ON raw_conversations
 WHEN EXISTS(SELECT 1 FROM raw_conversations WHERE id=NEW.id OR rowid=NEW.rowid OR (owner_id,scope,project_id,client,session_key)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.client,NEW.session_key)) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='raw' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_conversations_reserve AFTER INSERT ON raw_conversations
 BEGIN INSERT INTO content_identity_reservations VALUES(NEW.owner_id,NEW.scope,NEW.project_id,'raw',NEW.id,NEW.id,'s2',1,'0000000000000000000000000000000000000000000000000000000000000000'); END;
CREATE TRIGGER safety_raw_conversations_identity BEFORE UPDATE ON raw_conversations
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
```

A zero evidence digest denotes an attested SQL allocation/terminal guard, not legacy proof.
For receipts, use these additional exact guards; their original PK is
`(memory_id,receipt_key)` and id is separately unique (`core/database.mjs:71`–`:82`).

```sql
CREATE TRIGGER safety_receipts_insert BEFORE INSERT ON receipts
 WHEN EXISTS(SELECT 1 FROM receipts WHERE id=NEW.id OR rowid=NEW.rowid OR
 (memory_id=NEW.memory_id AND receipt_key=NEW.receipt_key)) OR
 EXISTS(SELECT 1 FROM content_identity_reservations r JOIN memories m ON m.id=NEW.memory_id
 WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=
 (m.owner_id,m.scope,m.project_id,'receipt',NEW.id))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_receipts_reserve AFTER INSERT ON receipts
 BEGIN INSERT INTO content_identity_reservations
 SELECT owner_id,scope,project_id,'receipt',NEW.id,NEW.id,'s2',1,
 '0000000000000000000000000000000000000000000000000000000000000000'
 FROM memories WHERE id=NEW.memory_id; END;
CREATE TRIGGER safety_receipts_identity BEFORE UPDATE ON receipts
 WHEN (NEW.rowid,NEW.id,NEW.memory_id,NEW.receipt_key) IS NOT
 (OLD.rowid,OLD.id,OLD.memory_id,OLD.receipt_key)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_memories_terminal BEFORE UPDATE ON memories
 WHEN OLD.deleted=1 AND NEW.deleted!=1
 BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_notes_terminal BEFORE UPDATE ON card_notes
 WHEN OLD.state='deleted' AND NEW.state!='deleted'
 BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_cards_terminal BEFORE UPDATE ON private_cards
 WHEN OLD.state IN ('deleted','cancelled') AND NEW.state IS NOT OLD.state
 BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
```

Receipt attachment must first look up its existing `(memory_id,receipt_key)` and
validate it, then INSERT only if absent. The current `INSERT OR IGNORE` loop would
hit the new BEFORE INSERT guard on legitimate dedup (`core/runtime.mjs:119`).
That local writer change is required; never weaken REPLACE guards for dedup.
Memory receipt migration runs before guard installation. Raw child allocations use
internal registry kinds `raw-message`/`raw-part`, not new contributor kinds. Their
keys are canonical JSON composite keys; their permanent birth rows prevent reuse
after child deletion within a surviving conversation. Sources still bind the Raw
conversation incarnation plus exact message/span/content. Seed existing children
before these guards; no registration path can recreate a deleted child key.

```sql
CREATE TRIGGER safety_raw_messages_insert BEFORE INSERT ON raw_messages
 WHEN EXISTS(SELECT 1 FROM raw_messages WHERE rowid=NEW.rowid OR (conversation_id=NEW.conversation_id AND (message_id=NEW.message_id OR ordinal=NEW.ordinal))) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-message',json_array(NEW.conversation_id,NEW.message_id)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_messages_reserve AFTER INSERT ON raw_messages
 BEGIN INSERT INTO content_identity_reservations SELECT owner_id,scope,project_id,'raw-message',json_array(NEW.conversation_id,NEW.message_id),lower(hex(randomblob(16))),'s2',1,'0000000000000000000000000000000000000000000000000000000000000000' FROM raw_conversations WHERE id=NEW.conversation_id; END;
CREATE TRIGGER safety_raw_messages_identity BEFORE UPDATE ON raw_messages
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.ordinal,NEW.role,NEW.first_event_id) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.ordinal,OLD.role,OLD.first_event_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_parts_insert BEFORE INSERT ON raw_parts
 WHEN EXISTS(SELECT 1 FROM raw_parts WHERE rowid=NEW.rowid OR (conversation_id=NEW.conversation_id AND message_id=NEW.message_id AND part_index=NEW.part_index)) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-part',json_array(NEW.conversation_id,NEW.message_id,NEW.part_index)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_parts_reserve AFTER INSERT ON raw_parts
 BEGIN INSERT INTO content_identity_reservations SELECT owner_id,scope,project_id,'raw-part',json_array(NEW.conversation_id,NEW.message_id,NEW.part_index),lower(hex(randomblob(16))),'s2',1,'0000000000000000000000000000000000000000000000000000000000000000' FROM raw_conversations WHERE id=NEW.conversation_id; END;
CREATE TRIGGER safety_raw_parts_identity BEFORE UPDATE ON raw_parts
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.part_index,NEW.start,NEW.end,NEW.digest) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.part_index,OLD.start,OLD.end,OLD.digest)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_cards_purge AFTER UPDATE OF state ON private_cards
 WHEN OLD.state IN ('draft','confirmed') AND NEW.state IN ('deleted','cancelled')
 BEGIN INSERT INTO content_suppressions SELECT NEW.owner_id,NEW.scope,NEW.project_id,lower(hex(randomblob(16))),'card',NEW.id,r.incarnation,'incarnation','*','',0,0,'purge',lower(hex(randomblob(16))),NEW.updated_at,'writer','0000000000000000000000000000000000000000000000000000000000000000','pending',0 FROM content_identity_reservations r WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id); END;
```

Raw progress UPDATE and append to new part keys remain allowed
(`core/raw-journal.mjs:198`–`:220`). Child deletion never deletes reservations.
For S2, source invalidation must retain draft state/bytes under predicate denial,
instead of cancelling it: replace the state/title/body assignments in
`core/private-card-schema.mjs:124`–`:127` and `core/card-raw-sources.mjs:53`–`:55`
with revision/time updates only; note deletion at `core/private-card-storage.mjs:190`
must do the same. Explicit cancel/delete still purges and fires the trigger above.
This keeps a new revision possible without making source suppression irreversible.

## 5. Transactional writers and acknowledgements

All following writes include body/header/source/authorization changes, existing
operation result/effects, and epoch updates in the same canonical transaction.
The existing wrapper records operations before COMMIT (`core/private-card-storage.mjs:303`–`:317`);
`transaction` commits before returning and rolls back errors (`core/database.mjs:337`–`:351`).
No await, model or host callback occurs while it is held. Commit before acknowledge.
A commit failure returns no success or recovery result. Replay checks authority
before returning its content-free stored operation receipt.

| Writer | Frozen atomic behavior |
| --- | --- |
| Draft creation, `core/private-card-storage.mjs:164`–`:173` | Allocate Card reservation, body revision 1 and provenance revision 1; snapshot and resolve full declared contributors/ancestors; insert edges then complete header. For `authoredInput`, preserve the current note creation if needed for compatibility, but omit that synthetic note from external contributors and bindings; insert trusted authored-input authorization, zero sources and user-authored complete header. Never infer this mode for any other input. |
| Draft binding-only edit, current replacement at `:214`–`:219` | Preserve body revision and header completeness; union newly declared sources and ancestry, increment provenance revision only if the union grows. Binding removal can change presentation only. Unknown bodies remain unknown. |
| Draft body/title edit | Allocate next body revision, require a complete new set; no reset to null. A trusted explicit own-writing action may use zero external sources with authorization. Otherwise resolve the declared new set completely; fail instead of labeling an unproved rewrite complete. |
| Confirmation, `:206`–`:212` | Run S1 draft-inspection safety including full accumulated durable set; preserve body and provenance revisions exactly, change Card state/revision and confirmation metadata. Replace unconditional `body_revision=1`; never rebuild from current bindings. |
| Confirmed binding-only edit | Same union rule; increment Card revision/effects as today, provenance revision on growth. A removed-and-forgotten source stays in the set. User-authored origin becomes derived when external sources are added, retaining its audit marker. |
| Confirmed title/body edit, `:214`–`:222` | Allocate next body revision and complete new set atomically. In-place source corrections do not make an old body safe; byte equality alone does not create a recovery revision. |
| User rewrite | Dedicated trusted owner action provides new complete text and explicit contributor declaration, or an own-writing authorization. New body revision even if explicit recovery retains identical bytes. Unknown/suppressed old bodies are never exposed to implement the action. |
| System regeneration | Prepare using only currently allowed input sources outside transaction; final transaction revalidates all input identities, their complete ancestry and authority, allocates new body revision and complete set. No existing system-regeneration writer is present in the cited Card method/input lists (`core/private-card-input.mjs:9`–`:16`, `:182`–`:198`); add a trusted internal seam, not an invented current API. |
| Keep-as-own | Dedicated explicit-user method; new body revision even for identical bytes, zero external edges, trusted actor/time/host-action marker bound to digest. Cannot bypass owner/Card suppression, cannot read hidden known-suppressed text, and cannot be selected by AI or a generic edit flag. Accept text explicitly supplied by the authorized human; deferred inspection stays disabled. |

S2 input validation must allow an empty presentation binding list; it does not
prove authorship (today `refs` requires 1–16 at `core/private-card-input.mjs:118`–`:120`).
A valid complete zero-source authored header supplies eligible support; change the
current nonempty-binding support test (`core/private-card-storage.mjs:109`–`:116`)
through the shared helper, retaining applicability and dependency requirements.
Body revisions are positive and strictly increase for new bodies, including drafts;
metadata revisions continue independently. A new revision uses max retained body
revision + 1, not just an untrusted current integer. Header helper verifies the
canonical current body points to that revision and refuses gaps/rollback in supported
writers. Prior complete/unknown headers never mutate. Binding-only edit cannot
promote unknown to complete. Retired body hashes/sets contain no retained body text.

The marker holds actor, trusted authorization time and host action id, never text. Existing grants currently validate action/target/binding and generation
(`core/private-card-facade.mjs:37`–`:49`, `:63`–`:69`); they do not supply this audit
record. Extend the trusted authorization adapter to supply actor/time, bound to the
same request and owner. Never accept actor/time from ordinary model input. Use
host action id to replay a semantically identical request to its original new
revision. Compare owner, actor, method, payload binding and target; any changed
payload or conflicting reuse refuses `action_conflict`, including use through a
different Card method. Do not use a later retry timestamp as a different payload.
The first trusted timestamp is retained. The existing ledger already refuses
method/payload conflicts (`core/private-operation-helpers.mjs:11`–`:16`); add the
authorization comparison before replay. This is not recovery-inspection permission.

### 5.1 Suppression writer matrix

Memory admission reserves era 1 with the new Memory (`core/runtime.mjs:239`–`:246`);
correction reserves its new revision era before commit, retiring the old era. Both
write the content HMAC in the registry. Metadata/dedup/review/supersession updates
preserve the era unless content actually changes. Direct SQL bytes cannot match an
unchanged era's HMAC. This avoids confusing supersession with same-byte correction.
Append immutable reason facts, with deterministic idempotency binding to action,
target, version/span and reason. Repeated identical requests compare then skip;
new reasons create additional facts. Pending/failed/complete cleanup all deny.
Cleanup may advance attempts/status, never change the target, reason or grant access.
Do not derive privacy suppression from the older fingerprint `suppressed` table:
supersession writes it too (`core/supersession-storage.mjs:55`–`:61`).

| Existing writer / transaction evidence | New suppression fact in that transaction |
| --- | --- |
| Forget `core/runtime.mjs:288`–`:314` | `user_forget` on Memory incarnation and every removed receipt incarnation; snapshot Raw ancestry before `excludeMemory`/receipt deletion. Pass reason/context into exclusion writer. |
| Review rejection `core/confirmation-storage.mjs:29`–`:31`, same transactional forget helper | `purge` rather than inventing an explicit user-forget cause; preserve this causal context through Memory/receipt/Raw facts. |
| Correction `core/runtime.mjs:255`–`:285` | `correction_supersession` on the retired Memory content era and removed receipt incarnations; affected Raw spans get the same reason. New corrected era stays usable. Even same-byte explicit correction retires old receipts; never suppress the whole continuing Memory incarnation. |
| Receipt removal `core/runtime.mjs:316`–`:326`, called inside Raw deletion `core/raw-deletion-storage.mjs:124`–`:127`, `:153`–`:161` | `purge` for each removed receipt, or caller's stronger privacy reason; resolve ids/ancestors before deletion. Internal helper must assert a transaction. No standalone acknowledge before the outer commit. |
| Card delete/cancel `core/private-card-storage.mjs:148`–`:154`, `:202`–`:203`, wrapped at `:305` | `purge` on Card incarnation before clearing bytes. The terminal trigger covers explicit state transitions. Source invalidation retains a denied draft for a new revision; it does not suppress the Card incarnation. |
| Note deletion `core/private-card-storage.mjs:175`–`:198` | `purge` on note incarnation; source-invalidated drafts retain their body/state under denial. Do not find safety dependents solely through current bindings; durable source index is authoritative for denial. Existing bounded effects can remain advisory. |
| Raw delete `core/raw-deletion-storage.mjs:117`–`:149`, `:153`–`:161`, episode path `:163`–`:173` | `purge` on conversation incarnation before hard deletion; downstream Memory/receipt facts retain that causal reason through injected helpers. Reserve every child-associated identity before cleanup. |
| Raw exclusion `core/raw-lineage-storage.mjs:115`–`:147` | Fact for each overlapping message span, same causal forget/correction reason; write with the exclusion clock/row. Never lose facts when later deletion clears exclusions. |
| Supersession `core/runtime.mjs:329`–`:344`, `core/supersession-storage.mjs:43`–`:63` | No content suppression. Keep existing historical/current policy and old anti-readmission fingerprint fence. Metadata revision alone cannot invalidate a history contributor whose bytes/era remain intact. |
| Owner-wide erasure | No canonical account-erasure method exists in the public dispatch (`core/contract.mjs:1181`–`:1194`, `core/runtime.mjs:678`–`:688`). Leave owner-target suppression insertion seam for a future trusted host action; do not add an account API now. Vector purge is separate derived cleanup (`core/context-semantic-maintenance.mjs:108`–`:158`). |

On an owner-wide fact, deny before item lookup. Future erasure acknowledgement must
also implement the host's drain/cancel guarantee; S2 does not invent a global lease.
For raw SQL deletion without a fact, missing identity/content still denies reads;
canonical migration cannot reconstruct every old hard deletion. If erasure required
a failure-recoverable external record, that remains the deferred ledger, not an
inert column claiming to implement it. No owner suppression epoch is added now:
local facts suffice for S2; restore-safe epoch allocation needs that later contract.

## 6. Canonical migration and shared classification

### 6.1 Quiescent migration

1. Stop new host/installer admissions, capture, ordinary writes and maintenance;
   drain reads and close old connections. Verify actual quiescence, not just a PID.
2. Make a consistent offline backup of canonical plus host accounting/authority
   state; validate identity/integrity and store it outside serving. Do not copy a
   live SQLite main file without its committed WAL state. No restore to serving.
3. Verify app id, exact base layout and allowed migration cell. Run S3 preflight
   first when available. Inventory all canonical body-bearing drafts/confirmed
   Cards plus any genuinely retained historical body records, not sidecar rows.
4. Compute proposed reservations, positive edges, denials and classifications in
   one coherent snapshot. Migration uses the same pure classifier as S3. Verify
   full enumeration and evidence coverage; unavailable required evidence refuses.
5. In one `BEGIN IMMEDIATE`, recheck the source inventory digest, install exact DDL,
   seed reservations and recovered suppression facts, allocate draft body revisions,
   seed edges/headers and guards, write `staged` control and mapped `user_version`.
   Commit atomically. Failure rolls back to the original store under quiescence;
   do not reopen it automatically. There is no mixed serving phase.
6. A separate denied maintenance verification checks exact DDL, FK/integrity checks,
   counts, all header/source/digest relations, identity coverage and reclassification.
   Only S2b-capable maintenance may seal and advance staged to ready; S2a leaves it staged.
   A crash at staged resumes verification; it never reruns destructive seeding.
   The seal is an HMAC over store/migration id, base, safety/classifier revision and
   inventory digest after full verification. Every opener checks it; missing/wrong
   seal denies the whole store. A direct ready-state SQL update cannot supply it.
7. Reopen fresh S2b handles, verify expected refusals and host paths, then resume.
   A ready inventory digest attests migration input, not today's changing inventory.

Body-bearing means actual retained title/body bytes. The current canonical Card
schema has only one body row (`core/private-card-schema.mjs:15`–`:23`); operation
results are receipts, not archived bodies (`core/private-card-storage.mjs:146`–`:147`).
Do not manufacture historical bodies. Allocate a legacy draft revision above any
retained body revision; preserve valid confirmed numbering. Invalid/reused body
numbers or malformed canonical data refuse migration, rather than dropping rows.
Terminal Cards have no body; retain their reservations and suppression facts.

### 6.2 What can prove a legacy body complete

A positive edge and a complete set are different claims. Enumerate current note,
receipt and Raw bindings; retained receipt parent/Raw ancestry; authenticated
candidate operation payloads; retained historical associations or verified trace
imports supplied to the offline evidence adapter. Persist every recovered edge
with its first evidence origin and evidence digest, even if the body is unknown.
Conservatively union plausible edges when body-revision mapping cannot exclude
this body. Keep additional verified origin facts in the migration evidence manifest;
never treat a keyed digest without a candidate payload as a decoded association.
No external ledger or backup is required merely because it might hypothetically
exist; an evidence source explicitly registered as required must be readable and
fully examined. Future ledger import plugs into this adapter; no replay is designed.

Legacy completeness requires all of the following canonical evidence:

* A verified creation payload, or a verified full body-replacement payload followed
  by a fully evidenced history from creation, matches the ledger's keyed binding,
  method, owner, target, action and normalized current body. Recover the actual
  payload; the ledger's opaque digest cannot stand in for it. Recompute exactly
  `binding('card-action-v1',[method,payload])` using store id/secret
  (`core/private-card-storage.mjs:27`, `:302`; `core/private-card-facade.mjs:43`).
* A closed, trusted operation history proves there was no later source-changing
  operation for this body, or supplies every such payload and its complete union.
  Verify the Card revision chain, state transitions and normalization, not merely
  `NOT EXISTS(edit...)`. Existing ledger/effects have no immutable retention or
  continuity seal (`core/private-card-schema.mjs:32`–`:43`), so their absence cannot
  itself prove no missing operations. Raw SQL can replace bindings without a
  revision; timestamps and matching current revision do not close this gap.
* Every input branch can be expanded to the complete contributors at that time,
  including receipt expansion for `memoryRefs` and all erasure ancestry. A verified
  creation payload with `memoryRefs` alone does not contain the historical receipt
  list: `fromMemories` enumerates whatever receipts existed at creation
  (`core/card-receipt-sources.mjs:32`–`:38`). A closed historical snapshot or equivalent
  verified full trace must prove that expansion, including subsequently lost rows.
* Every typed identity/version and the body-to-source mapping is unambiguous, and
  no unexamined required trace could add a contributor. Live sources must match
  their bound identities. Completeness is provenance coverage, not current safety;
  a complete set may still classify as known-suppressed.

A closed history means an independently authenticated, gap-free retained canonical
operation/snapshot trace covering the lifetime through the quiescent inventory,
with no untracked writer interval. S2 does not generate that proof retroactively.
An untouched-looking revision-1 Card with current bindings is therefore unknown
unless such evidence is actually provided. Creation binding plus absence of later
ledger edits alone is insufficient. No legacy body is auto-classified user-authored,
even if an authenticated old payload says `authoredInput`: legacy classification
may prove a source set but does not create the new trusted actor/time marker.
If its only proof would require invented authorship, it stays unknown.

Unknown includes missing payload, missing chain, unknown Raw origin, lost binding,
ambiguous incarnation, incomplete receipt expansion, unexamined required evidence,
or digest/body inconsistency. Malformed/corrupt population refuses the whole run;
ordinary lack of historical proof yields unknown, not a skipped row. Stores made
only by today's writers/ledger will be mostly, often entirely, unknown. A small
minority with independently retained and verified full traces may be complete.
No production proportion is claimed; S3 measures each environment privately.

Forgotten Memory rows still exist with `deleted=1` and null content
(`core/runtime.mjs:305`–`:307`): seed incarnation denial, preserving known associations even if the receipt is
gone. Use `user_forget` when verified forget evidence establishes the cause;
otherwise record conservative recovered `purge`, not an invented causal history. Deleted notes seed purge; terminal Cards
seed purge. Current Raw exclusions seed span denials with a known causal reason
only if a trustworthy trace proves it; otherwise use conservative purge. A hard
delete leaves no row, so no invented id/reason is recovered. A verified old edge
to an absent source keeps the edge and makes that body unknown/unreadable; an
explicit tombstone/verified deletion trace makes it known-suppressed. The old
fingerprint suppression table alone cannot distinguish correction from supersession.

### 6.3 One pure classifier, reused by S3

Freeze `classifyCardBodySafetyV1(observation)` in
`core/content-safety-classifier.mjs`: no db, filesystem, clock, logging, DDL or side
effects. Its input is a fully materialized normalized observation: body identity and
bytes/digest, reservation facts, proposed or retained provenance, positive evidence
edges with origins, verified completeness proof, current source states and matching
suppression facts. Trusted adapters verify HMACs and evidence coverage first; the
function receives explicit validity/coverage facts, never trusts an input flag from
an API caller. Its output is class, proposed header/source descriptors and internal
denial reasons. Both migration and S3 call this exact function/revision.

Order: (1) reject incomplete enumeration/invalid required evidence as run failure;
(2) union all proven/plausible contributor edges; (3) classify known-suppressed if
any matched owner/item/source/ancestor fact or unambiguous canonical tombstone
applies, even if completeness is unproved; (4) otherwise complete only with the
proof above or a valid S2 header/set/authorization; (5) otherwise unknown. A missing
source without a proven deletion is unknown, not an invented suppression reason.
Known-suppressed precedence never converts uncertainty into permission.

S3 entry point: `cairn-memory safety preflight --db ...`, backed by
`preflightContentSafetyV1` in `core/content-safety-preflight.mjs`. CLI router is
SQLite-free; execution imports native SQLite lazily. Installer runs it before
migration when S3 ships; hosted product runs it on each environment under its
maintenance authority. It is not an ordinary request/open hook or index operation.

Run under quiescence with a real read-only SQLite connection, `query_only=ON` and
one coherent read transaction spanning enumeration and required evidence reads.
The existing materialized snapshot helper is a starting point
(`core/database.mjs:297`–`:334`); do not stitch pages across snapshots. Refuse if the
configured full-scan/evidence budget cannot finish; never output partial counts as
complete. No DDL, temporary canonical table, seeding, cleanup, marker or remediation.
Use an isolated file-reading child for before/after SHA-256 of canonical main/WAL
and registered evidence files, with lstat device/inode/size checks; never open/close
raw SQLite file descriptors in the process holding SQLite locks. Before and after
checks include file presence. Read-only WAL use may update SHM read marks, so hash
SHM only after all handles close and require a frozen checkpointed environment if
claiming byte-for-byte equality for the full SQLite file family. The default S3
host procedure closes/checkpoints before baseline, verifies no nonempty WAL/journal,
then uses a read-only `immutable=1` URI under verified quiescence;
if any family file is created/changed, refuse the unchanged-files claim and report
no successful preflight. No preflight-side checkpoint or file deletion is allowed.

First install: no safety objects, intentionally no initialized ledger. Build proposed
reservations/denials/classification only in memory from canonical evidence. Emit a
mode tag plus counts; this grants no serving/restore admission. If safety objects
exist, require the mapped ready/staged layout and complete coherent metadata, never
silently fall back to first-install. A required authenticated evidence provider that
is unavailable refuses; a future configured ledger provider uses that same seam.

Report only totals: enumerated bodies; complete/unknown/known-suppressed bodies;
distinct owners in each class; deduplicated owners affected by unknown or known-
suppressed. Classes are disjoint and sum exactly to enumerated bodies; owner classes
can overlap, so affected owners are a set union. Include all retained body revisions,
not only eligible/current Cards. Memory-only store reports zero Card bodies/affected
Card owners; suppression verification still runs. No ids, namespace names, content,
source labels, per-owner rows, digest material or detailed failure logs leave the
report. A failed run emits a generic refusal, not misleading zero counts. Counts
are environment-local; public design/release artifacts contain no production counts.

## 7. Read integration and final delivery

Replace S1's single contributor loader with `loadCurrentCardBodySafetyInside`.
Inside the caller's canonical snapshot, load the canonical Card, its reservation,
current positive body revision, latest immutable header and all cumulative sources with `added_revision <= provenance_revision`.
Fetch real title/body before computing the digest even when caller supplied a
metadata-only row (`core/context-product-sidecar.mjs:335`–`:344`). Missing header,
unknown, invalid count/ancestry, wrong digest, ambiguous identity or exhausted
validation budget denies. Never fall back to bindings. Check owner/Card suppression
first, then every durable contributor and ancestor live. Current display bindings
can be a subset and are not an authorization source. Zero-source explicit authored
bodies require valid authorization and matching complete header.

S1 purposes and public failures remain: retrieval current/history, draft inspection,
confirmed review. Both intents and all three purposes deny unknown and suppression.
Current support/applicability/dependency eligibility remains separate; history ignores
supersession/current eligibility only, not source integrity. Internal reasons remain
`user_forget`, `correction_supersession`, `purge`, `privacy_erase`, `account_erasure`,
`missing`, `identity_mismatch`, `ineligible`. Represent unknown as ineligible with
internal classification metadata; no new reason leaks to public DTOs/errors/logs.

Prepared internal records carry body and provenance digest, revision, incarnation
and exact source identities. Final fresh snapshot after every await/host callback
repeats live validation and compares provenance digest as well as item/source fences.
A same-body union invalidates a prepared result. Never serve an older header or
historical body when the current revision is denied. Refuse partly stale assemblies
and promised-complete source snapshots; ordinary safe omission preserves existing
pagination contracts. S1 already owns all final delivery hooks; S2 changes their
shared load/compare result, not pump/quantum/publication scheduling.

Relative to S1, removed-binding sources now continue to suppress candidates/cursors,
assembly preparation/final refetch, exact/private evidence, source/receipt resolution,
legacy Memory fetch/receipt pages, source snapshots, Card detail/list/organization,
role evidence, recall/fallback and index-build eligibility. Unknown legacy Cards
now disappear, and properly marked zero-source authored Cards can be read. Draft
confirmation preserves accumulated sources. The surface inventory and relevant
current seams are in §2.2 of the parent plan; key base sites are
`core/private-card-storage.mjs:228`, `:273`, `:292`–`:299`,
`core/context-read-sidecar.mjs:668`–`:695`, `core/context-read-facade.mjs:603`, `:665`,
`:703`–`:714`, and `core/runtime.mjs:492`–`:546`. No optional tail is implemented.
Host-owned search/caches/shared Cards need separate acceptance; engine tests cannot
prove their final checks. No restricted metadata/recovery inspection ships.

## 8. Host procedure, packages and acceptance

Hosted product and local installer: schedule downtime, stop/drain all users of the
store, take and verify an offline backup, run environment-local S3 if available,
migrate to staged, verify with S2b, activate ready, reopen fresh processes and verify
host search/recall/fallback/ACL behavior before resuming. Old pins remain refused;
upgrade every installed writer/Worker/CLI pin together. On failure keep admissions
closed and investigate; do not restore the backup to serving. Backups are forensic
or offline validation inputs until separately designed restore admission exists.

S2 may split safely only with staged stores denied. S2a can merge without enabling
migration automatically and may create a staged offline store; it cannot acknowledge
safety-ready or let ordinary writers touch it. S2b adds writers, read swap and the
sole ready transition. Existing unmigrated S1 service retains S1's documented gap;
neither half alone is a completed S2 rollout. No staged-to-ready switch in S2a.
Estimates below are implementation plus focused tests/docs, not this design's size.
They exceed the old aggregate's optimistic storage slice where durable identity,
all-base guards and installed compatibility add real work; do not hide that growth.

| Package | Honest changed-line range | File inventory / scope |
| --- | --- | --- |
| S2a | 1,500–2,600 | New `core/content-safety-layout.mjs`, `core/content-safety-schema.mjs`, `core/content-safety-migration.mjs`, `core/content-safety-classifier.mjs`; modify `core/private-card-schema.mjs`, `core/database.mjs`, `core/read-database.mjs`, `core/existing-store.mjs`, `core/context-product-schema.mjs`, `core/topic-members-opening.mjs`, `core/topic-members-session.mjs`, `core/method-package-migration.mjs`, `core/method-package-storage.mjs`, `core/context-read-facade.mjs`, `integrations/client/raw/local-host-permission.mjs`, `integrations/client/raw/local-setup.mjs`, `adapters/local/configuration.mjs`, `adapters/mcp/retained-raw.mjs`, `adapters/mcp/context-read-command.mjs`, `adapters/mcp/method-package-command.mjs`, `adapters/mcp/asset-command.mjs`; new `core/test/context-read-safety-layout.test.mjs`, `core/test/context-read-safety-migration.test.mjs`, `core/test/context-read-safety-classifier.test.mjs`, `packaging/test/context-read-safety-installed.test.mjs`; artifact list and generated installed bundle. |
| S2b | 1,200–2,100 | New `core/content-safety-storage.mjs`; S1 predicate module (expected `core/content-safety.mjs`); modify `core/private-card-storage.mjs`, `core/private-card-input.mjs`, `core/private-card-facade.mjs`, `core/private-operation-helpers.mjs`, `core/runtime.mjs`, `core/raw-journal.mjs`, `core/raw-lineage-storage.mjs`, `core/raw-deletion-storage.mjs`, `core/card-raw-sources.mjs`, `core/card-receipt-sources.mjs`, `core/content-safety-migration.mjs`; S1 final-record consumers only where its internal digest seam needs adapting; new `core/test/context-read-safety-provenance.test.mjs`, `core/test/context-read-safety-writers.test.mjs`, `adapters/mcp/test/context-read-safety-authorship.test.mjs`; artifact list and generated bundle. |
| S3 | 300–550 | New `core/content-safety-preflight.mjs`, `adapters/mcp/content-safety-command.mjs`, `core/test/context-read-safety-preflight.test.mjs`; modify `adapters/mcp/cli.mjs`, installer invocation, artifact list/generated bundle. Reuses S2a classifier, no alternate policy implementation. |

S2 total: 2,700–4,700 lines; S3 is additional. S1 is separately accounted. Finite
canonical guard expansion belongs to S2a, with affected INSERT writer adaptations
landing before those guards can be activated in S2b. Exact consumer filenames must
be reconciled with S1's final seam before implementation; no performance-track files
are acquired to implement scheduling. Source-set validation remains charged to
existing support/Raw budgets; budget exhaustion refuses, not truncates lineage.

| Acceptance boundary | Required §8.1 cases and physical tests |
| --- | --- |
| S2a | Exact version/base table including 18/23/33 and attested deployed cell; no Card tables at 18; staged/partial/mismatched and old binary refusal; UPDATE/DELETE/REPLACE attacks with recursive triggers off; canonical identity hard-delete/reinsert; source/header consistency; unknown legacy and recovered suppressed edges; pure classifier class/owner reconciliation and first-install proposed classification. No claim of live writer/read acceptance. |
| S2b | A+B, remove A binding, forget/purge A, rebuild and bare exact fetch C; child deletion; same-body provenance growth before final delivery; all S1 surfaces/purposes/both intents; draft inspection/confirmation including removed contributor; confirmed repair needs-review then forgotten contributor; user-authored actor/time/action audit with identical bytes/retries/conflicts; authoredInput zero external contributors; correction versus supersession; receipt/note/Raw deletion/exclusion; direct body SQL digest mismatch; no success before commit. Installed Worker/CLI/fallback and each enabled base. |
| S3 | Coherent read-only first-install and migrated snapshots; unchanged file identity/content digests; all canonical retained bodies counted once, suppression precedence, per-class owner sets/affected union, counts-only output, unavailable/corrupt/over-budget evidence refusal instead of undercount. |
| Deferred acceptance | Restore/replay/ledger cases, suppression pulls, fourth-purpose and restricted metadata remain disabled. Demonstrate no restore-to-serving operational path; do not mark their original §8.1 tests passing through a mock admission scheme. |

## 9. Open questions requiring host or owner input

Frozen owner decisions above are not reopened. These are deployment/evidence inputs:

| Question | Recommended answer / safe default |
| --- | --- |
| What exact deployed base layout is attested? The checkout cannot establish it; current product validation accepts 18 and 20–33 (`core/context-product-schema.mjs:172`). | Host supplies exact base/DDL attestation before migration; enable only its listed cell plus 18/23/33 qualification cells. Refuse unknown/custom layouts. |
| Can the host provide authenticated closed legacy traces and actual operation payloads, not just commitments? Current ledger lacks payloads/continuity (`core/private-operation-helpers.mjs:18`–`:20`, `core/private-card-schema.mjs:32`–`:43`). | Assume unavailable; accept mostly/all unknown, run S3 privately, never relax completeness. Optional verified traces can increase proven coverage. |
| Which trusted adapter supplies actor and authorization time? Current facade grant verification supplies no persisted actor/time marker (`core/private-card-facade.mjs:47`–`:49`, `:69`). | Extend owner authorization with trusted actor/time bound to action and payload. Until available, refuse keep-as-own/authored zero-source creation rather than fabricate audit data. |
| Which maintenance window and complete process inventory will each host use for quiescence? Existing open handles survive a version bump. | Host supplies the window and inventory, drains all readers/writers/maintenance and reopens fresh S2b processes. The decided no-restore-to-serving rule remains mandatory. |
| Are explicit versioned refs needed for legacy objects whose bare refs cannot be attested? Existing public exact refs omit incarnation (`core/private-evidence-input.mjs:14`–`:23`). | Add a versioned exact-ref input for authorized typed identities; keep ambiguous bare refs denied. Do not authorize old aliases simply to preserve availability. |

Code/spec conflicts resolved explicitly: authoredInput's synthetic note is not an
external contributor; draft null revisions and confirmation reset must change;
legacy ledger absence is not completeness proof; fingerprint suppression also covers supersession.
Automatic draft cancellation conflicts with revision recovery; the cited S2 invalidation
changes preserve the denied draft rather than irreversibly suppress its incarnation.
The older B3S size estimate does not cover this frozen physical detail comfortably.
No identified requirement forces pump/quantum/publication changes. If S1's final
internal record has no digest extension point, adapt only that shared safety/final
comparison seam; otherwise report the integration conflict before implementation.
