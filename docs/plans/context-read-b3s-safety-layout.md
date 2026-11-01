# Fix B safety layout — revision 3

Frozen design, 2026-10-29; code references use `a8fd8df3`. Design only.
This narrows [the parent design](context-read-incremental-catchup.md), §§2.2–2.3,
3.4–3.5 and 8.1. The revision-2 product facts and owner decisions supersede the
first draft's blanket reservations, legacy-ref refusal, Memory eras and staging.

## 1. Product boundary and package order

Product-supplied deployment facts: hosted stores are physical v18, Memory-only,
using DELETE journal; hosted engine Cards do not exist. The hosted product's own
Cards live in its app database and currently have no Memory lineage. Local-mode
engine Cards use installer-created stores. These are deployment facts supplied
for this revision, not properties inferred from the repository's allowed versions.

| Package | Frozen boundary |
| --- | --- |
| S2h | Suppression storage/reasons/owner epochs, referenced-identity reservations, transactional writers, atomic migration, opener compatibility and both owner-scoped pull APIs. v18 receives only this capability; v23/v33 receive the same capability without new Card lineage tables. Pull inclusion awaits the owner selection, but its design is complete here. |
| S3 | Pure shared classifier and read-only preflight, including unmigrated first-install mode. Deliver independently, in parallel with or before S2h. No installed safety tables or S2c code is required to obtain local legacy counts. |
| S2c | Complete engine Card lineage, authorization, writers, canonical legacy seeding and S1 contributor-loader/read swap in one package. **Must not ship in any installer until the owner decides the local legacy policy.** No inert half-package or staged activation. |

S2h cannot infer app-database Card sources. The hosted product must add its own
per-body-revision source sets and reconciliation/checkpoints; pulls are necessary
because suppression also originates outside its forget handler. Existing app Cards
without lineage need a product policy; engine pull success cannot certify them.
S2h alone also does not close S1's removed-binding hole for local engine Cards.
S2c closes that hole; unknown bodies remain denied on every purpose and AI path.

No pump, quantum, publication-format, reader-lifecycle or qualification-harness work
belongs here. Opener validation changes stay at existing attestation seams.
External ledger/watermark/restore admission, recovery inspection/restricted metadata
and general external trace import remain deferred. The interim rule is **no backup
restore to serving**, including pull APIs. No new column pretends to supply a ledger.

## 2. Identity verification and limited reservations

### 2.1 Existing allocation paths

The internal identity is `(storeId, owner, scope, project, kind, key, incarnation,
version)`. Personal project is SQL `''`, public null. Strings compare BINARY.
For engine-allocated CSPRNG UUIDs, **id is incarnation**, including legacy ids.
Existing public Memory, receipt, note, Card and Raw refs keep their current grammar
(`core/private-evidence-input.mjs:12`–`:23`; `core/private-card-input.mjs:95`–`:116`;
`core/raw-source-input.mjs:10`–`:16`). No public ref replacement API is introduced.

An all-tree INSERT search, followed independently by scanning every tracked source
file and reviewing dynamic table-name writers, found six serving INSERT statements:

| Kind | Every serving insertion / allocation | Caller-supplied id? |
| --- | --- | --- |
| Memory | `core/runtime.mjs:239`–`:245`: `randomUUID()`, then `INSERT memories`. Explicit, inferred and admission/dedup callers share `admitMutation` (`:184`–`:206`); dedup keeps the existing row (`:208`–`:236`). | No. |
| Receipt | `core/runtime.mjs:118`–`:122`: `randomUUID()` then `INSERT OR IGNORE receipts`; on dedup it finds the actual retained id (`:127`–`:129`). | No. |
| Receipt migration | `core/database.mjs:124`–`:129`: each old receipt gets `randomUUID()`; it does not copy an old/caller id. | No. |
| Submitted note | `core/private-card-storage.mjs:81`–`:87`: `randomUUID()` inside `insertNote`, also used by authoredInput (`:166`). | No. |
| Card | `core/private-card-storage.mjs:164`–`:171`: `randomUUID()` immediately before insertion. Edit accepts a target id, not an allocation (`:200`–`:219`). | No. |
| Raw conversation | `core/raw-journal.mjs:114`–`:123`, `:182`–`:186`: existing row id or a fresh UUID, rechecked before commit. Request session id is not the conversation id. | No. |

Raw message ids and part indices are caller supplied **inside their engine-allocated
conversation** (`core/raw-journal.mjs:198`–`:215`); they are not globally unique
incarnations. UUID evidence is a frozen product decision: collision risk remains
nonzero, and there is no lifetime allocation log before migration. UUID spelling
alone does not authenticate an arbitrary imported database or caller-supplied key.
A conflicting/ambiguous identity refuses; collision allocation retries a fresh UUID.

Search coverage includes imports, rebuilds and restores. Index rebuild writes
`index_*` projections, not canonical objects (`core/index-storage.mjs:8`–`:13`,
`:98`; `core/index-schema.mjs:89`–`:102`). Method migration installs schemas only
(`core/method-package-migration.mjs:13`–`:30`). Generic private writers target
operation/effect tables (`core/private-operation-helpers.mjs:8`–`:28`). The public
facade exports no canonical import/restore API (`core/contract.mjs:1181`–`:1194`);
the backup qualification child copies a SQLite store (`tools/testing/fixtures/context-product/storage-child.mjs:72`–`:74`), not caller ids into serving tables.
Restoring such a copy to serving remains prohibited; backup is not allocation proof.

Non-serving exceptions were found: synthetic benchmark seeders insert deterministic
Memory/receipt ids (`evaluation/architecture/bounded-keyset-measure.mjs:19`–`:43`,
`:50`–`:64`). Tests also deliberately inject ids, for example Raw conversations at
`core/test/raw-conversation-list.test.mjs:85`–`:87` and cloned Cards at
`core/test/memory-card-sources.test.mjs:232`. These are not engine UUID evidence.
Do not admit synthetic/imported keys as bare-ref-safe if such a store is presented
for serving. Historical fixture copies repeat old allocators, not new entry paths.
No serving caller-supplied allocation path was found; future imports must attest
allocation origin or mark affected keys ambiguous and refuse their bare refs.

### 2.2 Reservation boundary

Reserve only identities referenced by a suppression fact or durable provenance,
including recovered positive edges. No registry row is created for every capture,
message or part. Reservations survive canonical deletion; recreation cannot reuse
any reserved key, even with another incarnation. Supported writers reserve the
identity before inserting the referencing fact/edge in the same transaction.

For a referenced Raw span, reserve its conversation and the message/parts whose
identities enter the commitment. Internal reservation kinds `raw-message` and
`raw-part` use JSON keys `[conversationId,messageId]` and
`[conversationId,messageId,partIndex]`; incarnation is the conversation UUID.
Only referenced children are reserved. A span suppression reserves its message;
a whole-conversation suppression needs the root reservation, not every part.
A missing old association remains unknown; never invent an incarnation or ancestry.

Insert guards reject live PK/UNIQUE/rowid collisions before REPLACE can delete a
row and reject any already-reserved key. Identity/namespace UPDATE guards prohibit
moving an object behind a ref. Unreserved allocations retain the accepted UUID
collision risk; referenced identities get a durable no-reuse guarantee thereafter.
Existing `INSERT OR IGNORE` receipt dedup must first read/validate the retained
`(memory_id,receipt_key)` row, then insert only if absent (`core/runtime.mjs:119`).
This local adaptation preserves dedup without weakening REPLACE protection.

## 3. Physical versions, admission and openers

Application id remains `0x43414952` (`core/database.mjs:37`). Only these safety
mappings exist. Completion is one atomic verified commit; no staged/resumable state.

| Physical | Base | Suppression revision | Card lineage revision | Migration state |
| --- | --- | --- | --- | --- |
| 34 | 18 | 1 | absent | complete |
| 38 | 23 | 1 | absent | complete |
| 48 | 33 | 1 | absent | complete |
| 49 | 23 | 1 | 1 | complete; S2c gated |
| 50 | 33 | 1 | 1 | complete; S2c gated |

Numbers 35–37 and 39–47 remain reserved with **no mapping rows**. There are no
other safety cells and no v18 Card-lineage cell. S2h on 23/33 preserves existing
base Card tables; it does not install `card_body_*` tables or change S1 lineage
policy. S2c can atomically migrate base 23/33 directly, or add lineage to 38/48,
without resetting suppression facts, owner epochs or domain. It is not a base
feature upgrade. Already-installed features may operate; **all base feature
upgrades on safety stores refuse**, before any installer/DDL changes. A request
for absent methods/assets/roles/Raw/Cards waits for a separately supported upgrade.

A SQLite-free layout resolver maps physical to base/capabilities. Never temporarily
lower `user_version`, infer features from a large number, or accept safety objects
under an old version. Missing/inconsistent control, DDL, guards or completion
attestation refuses all owner reads and ordinary writes; no fallback opener.
Before commit, migration verifies the full relevant population. Afterward product
bootstrap remains metadata-only and per-item predicates validate live contents.

| Existing seam / evidence | Required local change |
| --- | --- |
| `core/database.mjs:355`–`:375`, `:413`–`:425`, `:683`–`:695` | Resolve safety before legacy initialization; attest exact cell. Refuse absent-feature upgrades, including `privateCards` on base 18. No automatic existing-store safety migration in ordinary open. |
| `READ_SCHEMA_VERSIONS` / `CONTEXT_READ_SCHEMA_VERSIONS`, `core/database.mjs:40`–`:45` | Add 34/38/48, and gated 49/50 for S2c-capable binaries, to both. Do not add any reserved number; lists do not replace attestation. |
| Read open, `core/read-database.mjs:26`–`:32`, `:54`–`:77` | Map base before threshold checks; validate installed safety metadata/control. Read-only, no DDL or seeding. |
| Product layout, `core/context-product-schema.mjs:170`–`:190` | Validate base 18/23/33 shapes and exact installed capability; never treat 34 as every optional feature. |
| Topic open, `core/topic-members-session.mjs:41`–`:54`; `core/topic-members-opening.mjs:18`–`:22`, `:94`; overview Worker `core/topic-overview-worker.mjs:43` | Feed resolved base to marker checks; validate safety at the existing bounded opening seam. No traversal/lifecycle redesign. |
| Existing-store pins, `core/existing-store.mjs:14`, `:85`–`:103` | Add an explicit safety pin naming exact physical/base/capabilities/store id. Old schema pins refuse migrated stores; update installed clients together. |
| Method attachment threshold, `core/method-package-storage.mjs:46`; migration `core/method-package-migration.mjs:15`–`:30` | Resolve existing assets capability; refuse feature upgrade on every safety cell before its current `>=30` shortcut. |
| Facade feature selection, `core/context-read-facade.mjs:123` | Resolve base and installed lineage capability. S2h uses S1 contributors; only S2c selects durable contributors. |
| Installed permission/setup, `integrations/client/raw/local-host-permission.mjs:18`–`:35`; `integrations/client/raw/local-setup.mjs:61`–`:79`; `adapters/local/configuration.mjs:75`–`:90` | Replace numeric checks with shared attestation and safety pin; Raw/control still require existing base features. |
| CLI probes, `adapters/mcp/context-read-command.mjs:18`–`:25`, `adapters/mcp/method-package-command.mjs:65`–`:74`, `adapters/mcp/asset-command.mjs:52`–`:69` | Validate before returning identity/secret metadata; replace asset thresholds. `core/store-fence.mjs:59`–`:71` still binds the actual physical version. |
| Installed Worker/retained CLI, `integrations/client/raw/local-worker.mjs:8`, `:28`; `adapters/mcp/retained-raw.mjs:17`–`:25`, `:65`; dispatch `adapters/mcp/cli.mjs:292`–`:313` | Inherit updated probe/pin; never select an old writer as fallback. No Worker lifecycle changes. |
| Backup/restore | Preserve safety tables/epochs/domain in offline backups; serving restore is prohibited. The sidecar reset at `core/context-product-sidecar.mjs:758`–`:765` clears derived state only and is not canonical restore admission. No reset/publication change. |

Old binaries reject these versions via finite read/product/existing-store lists
(`core/read-database.mjs:56`–`:57`; `core/context-product-schema.mjs:172`;
`core/existing-store.mjs:87`–`:91`), or unknown nonempty layout rejection
(`core/database.mjs:620`–`:621`, also `:416`–`:417`). Close old live connections
under quiescence; a version integer cannot revoke an already-open handle.
S2h-only binaries reject 49/50. Installer manifests must exclude S2c until its gate.
Keep CLI-reachable layout/schema/classifier/router modules SQLite-free: handles
are parameters; execution imports `node:sqlite` inside functions, as at
`integrations/client/raw/local-setup.mjs:61`. No `createRequire` hiding. Schema
comparison uses `new db.constructor(':memory:')` (`core/card-current-schema.mjs:65`).

## 4. S2h storage, guards and transactional writers

SQL is normative. All new tables are STRICT/WITHOUT ROWID; no rowid REPLACE route.
FKs target permanent reservations only, never bindings/receipts/notes/Raw children,
and never cascade. Built-in checks work with `trusted_schema=OFF`
(`core/database.mjs:406`); HMAC/semantic shape verification stays in shared helpers.

```sql
CREATE TABLE content_safety_control (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 base_layout INTEGER NOT NULL CHECK(base_layout IN (18,23,33)),
 suppression_revision INTEGER NOT NULL CHECK(suppression_revision=1),
 card_lineage_revision INTEGER NOT NULL CHECK(card_lineage_revision IN (0,1)),
 migration_state TEXT NOT NULL CHECK(migration_state='complete'),
 suppression_domain TEXT NOT NULL CHECK(length(suppression_domain)=36),
 migration_id TEXT NOT NULL CHECK(length(migration_id)=36),
 inventory_digest TEXT NOT NULL CHECK(length(inventory_digest)=64 AND inventory_digest NOT GLOB '*[^0-9a-f]*'),
 CHECK(base_layout!=18 OR card_lineage_revision=0)
) STRICT, WITHOUT ROWID;
CREATE TABLE content_identity_reservations (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0))),
 kind TEXT NOT NULL CHECK(kind IN ('memory','receipt','submitted-note','raw','card','raw-message','raw-part')),
 stable_key TEXT NOT NULL CHECK(length(stable_key) BETWEEN 1 AND 1024),
 incarnation TEXT NOT NULL CHECK(length(incarnation) BETWEEN 1 AND 200),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','canonical-tombstone','canonical-edge')),
 PRIMARY KEY(owner_id,scope,project_id,kind,stable_key),
 UNIQUE(owner_id,scope,project_id,kind,stable_key,incarnation),
 CHECK(kind IN ('raw-message','raw-part') OR stable_key=incarnation)
) STRICT, WITHOUT ROWID;
CREATE TABLE owner_suppression_epochs (
 owner_id TEXT PRIMARY KEY CHECK(length(owner_id) BETWEEN 1 AND 200),
 epoch_hi INTEGER NOT NULL CHECK(epoch_hi BETWEEN 0 AND 4294967295),
 epoch_lo INTEGER NOT NULL CHECK(epoch_lo BETWEEN 0 AND 4294967295)
) STRICT, WITHOUT ROWID;
CREATE TABLE content_suppressions (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 fact_id TEXT NOT NULL CHECK(length(fact_id)=64 AND fact_id NOT GLOB '*[^0-9a-f]*'),
 epoch_hi INTEGER NOT NULL CHECK(epoch_hi BETWEEN 0 AND 4294967295),
 epoch_lo INTEGER NOT NULL CHECK(epoch_lo BETWEEN 0 AND 4294967295),
 scope TEXT NOT NULL CHECK(scope IN ('owner','personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope IN ('owner','personal') AND project_id='') OR (scope='project' AND length(project_id)>0))),
 kind TEXT NOT NULL CHECK(kind IN ('owner','namespace','memory','receipt','submitted-note','raw','card')),
 stable_key TEXT NOT NULL CHECK(length(stable_key)<=200), incarnation TEXT NOT NULL CHECK(length(incarnation)<=200),
 match_mode TEXT NOT NULL CHECK(match_mode IN ('owner','namespace','incarnation','version','revision-through','span')),
 source_version TEXT NOT NULL CHECK(length(CAST(source_version AS BLOB))<=2048 AND (source_version='*' OR (json_valid(source_version) AND json_type(source_version)='array'))),
 message_key TEXT NOT NULL CHECK(length(message_key)<=200),
 span_start INTEGER NOT NULL CHECK(span_start>=0), span_end INTEGER NOT NULL CHECK(span_end>=0),
 reason TEXT NOT NULL CHECK(reason IN ('user_forget','correction_supersession','purge','privacy_erase','account_erasure')),
 action_id TEXT NOT NULL CHECK(length(action_id) BETWEEN 1 AND 200),
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)>0),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','canonical-tombstone')),
 cleanup_status TEXT NOT NULL CHECK(cleanup_status IN ('pending','failed','complete')),
 cleanup_attempt INTEGER NOT NULL CHECK(cleanup_attempt BETWEEN 0 AND 9007199254740991),
 reservation_incarnation TEXT GENERATED ALWAYS AS (CASE WHEN match_mode IN ('owner','namespace') THEN NULL ELSE incarnation END) STORED,
 PRIMARY KEY(owner_id,fact_id), UNIQUE(owner_id,epoch_hi,epoch_lo),
 FOREIGN KEY(owner_id) REFERENCES owner_suppression_epochs(owner_id),
 FOREIGN KEY(owner_id,scope,project_id,kind,stable_key,reservation_incarnation)
   REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 CHECK((match_mode='owner' AND scope='owner' AND kind='owner' AND stable_key='' AND incarnation='') OR
       (match_mode='namespace' AND scope!='owner' AND kind='namespace' AND stable_key='' AND incarnation='') OR
       (match_mode NOT IN ('owner','namespace') AND scope!='owner' AND kind NOT IN ('owner','namespace') AND length(stable_key)>0 AND stable_key=incarnation)),
 CHECK((match_mode='span' AND kind='raw' AND length(message_key)>0 AND span_end>span_start) OR
       (match_mode!='span' AND message_key='' AND span_start=0 AND span_end=0)),
 CHECK((match_mode IN ('version','revision-through') AND source_version!='*') OR (match_mode NOT IN ('version','revision-through') AND source_version='*')),
 CHECK(match_mode!='revision-through' OR kind='memory'),
 CHECK(epoch_hi!=0 OR epoch_lo!=0)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_suppression_target ON content_suppressions(owner_id,scope,project_id,kind,stable_key,incarnation,match_mode);
CREATE INDEX content_suppression_window ON content_suppressions(owner_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation);
CREATE INDEX content_suppression_cleanup ON content_suppressions(cleanup_status,owner_id,fact_id);
```

Epoch = `hi*2^32+lo`, exact unsigned 64-bit, wire canonical decimal string. JS uses
BigInt, never Number. The two integer limbs allow exact SQL increment guards under
SQLite's signed-integer limit; they are active storage, not inert ledger fields.
Domain = `(suppression_domain, owner)`; control domain is generated once at S2h
migration and survives S2c. New facts/additional reasons allocate the next owner
epoch inside the tombstone transaction. Cleanup gets no new epoch. Exhaustion
refuses the mutation; never wrap, reset or invent a new domain to continue.

```sql
CREATE TRIGGER safety_control_insert BEFORE INSERT ON content_safety_control WHEN EXISTS(SELECT 1 FROM content_safety_control) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_control_delete BEFORE DELETE ON content_safety_control BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_control_update BEFORE UPDATE ON content_safety_control
 WHEN NEW.singleton IS NOT OLD.singleton OR NEW.base_layout IS NOT OLD.base_layout OR NEW.suppression_revision IS NOT OLD.suppression_revision OR NEW.migration_state IS NOT OLD.migration_state OR NEW.suppression_domain IS NOT OLD.suppression_domain OR OLD.card_lineage_revision!=0 OR NEW.card_lineage_revision!=1
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_insert BEFORE INSERT ON content_identity_reservations
 WHEN EXISTS(SELECT 1 FROM content_identity_reservations WHERE (owner_id,scope,project_id,kind,stable_key)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.kind,NEW.stable_key)) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_reservation_update BEFORE UPDATE ON content_identity_reservations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_delete BEFORE DELETE ON content_identity_reservations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_epoch_insert BEFORE INSERT ON owner_suppression_epochs
 WHEN NEW.epoch_hi!=0 OR NEW.epoch_lo!=0 OR EXISTS(SELECT 1 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_epoch_delete BEFORE DELETE ON owner_suppression_epochs BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_epoch_update BEFORE UPDATE ON owner_suppression_epochs
 WHEN NEW.owner_id IS NOT OLD.owner_id OR (OLD.epoch_hi=4294967295 AND OLD.epoch_lo=4294967295) OR
 NEW.epoch_hi!=OLD.epoch_hi+CASE WHEN OLD.epoch_lo=4294967295 THEN 1 ELSE 0 END OR
 NEW.epoch_lo!=CASE WHEN OLD.epoch_lo=4294967295 THEN 0 ELSE OLD.epoch_lo+1 END OR
 NOT EXISTS(SELECT 1 FROM content_suppressions WHERE owner_id=NEW.owner_id AND epoch_hi=NEW.epoch_hi AND epoch_lo=NEW.epoch_lo)
 BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_suppression_insert BEFORE INSERT ON content_suppressions
 WHEN EXISTS(SELECT 1 FROM content_suppressions WHERE (owner_id,fact_id)=(NEW.owner_id,NEW.fact_id) OR (owner_id,epoch_hi,epoch_lo)=(NEW.owner_id,NEW.epoch_hi,NEW.epoch_lo)) OR
 NOT EXISTS(SELECT 1 FROM owner_suppression_epochs e WHERE e.owner_id=NEW.owner_id AND NOT(e.epoch_hi=4294967295 AND e.epoch_lo=4294967295) AND NEW.epoch_hi=e.epoch_hi+CASE WHEN e.epoch_lo=4294967295 THEN 1 ELSE 0 END AND NEW.epoch_lo=CASE WHEN e.epoch_lo=4294967295 THEN 0 ELSE e.epoch_lo+1 END)
 BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_suppression_advance AFTER INSERT ON content_suppressions
 BEGIN UPDATE owner_suppression_epochs SET epoch_hi=NEW.epoch_hi,epoch_lo=NEW.epoch_lo WHERE owner_id=NEW.owner_id; END;
CREATE TRIGGER safety_suppression_delete BEFORE DELETE ON content_suppressions BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_suppression_update BEFORE UPDATE ON content_suppressions
 WHEN (NEW.owner_id,NEW.fact_id,NEW.epoch_hi,NEW.epoch_lo,NEW.scope,NEW.project_id,NEW.kind,NEW.stable_key,NEW.incarnation,NEW.match_mode,NEW.source_version,NEW.message_key,NEW.span_start,NEW.span_end,NEW.reason,NEW.action_id,NEW.recorded_at,NEW.evidence_origin) IS NOT
 (OLD.owner_id,OLD.fact_id,OLD.epoch_hi,OLD.epoch_lo,OLD.scope,OLD.project_id,OLD.kind,OLD.stable_key,OLD.incarnation,OLD.match_mode,OLD.source_version,OLD.message_key,OLD.span_start,OLD.span_end,OLD.reason,OLD.action_id,OLD.recorded_at,OLD.evidence_origin) OR NEW.cleanup_attempt!=OLD.cleanup_attempt+1 OR OLD.cleanup_status='complete'
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
```

Control UPDATE is solely S2c's verified atomic capability addition, with new
migration id/inventory digest; it cannot change base or domain. Ordinary openers
never invoke it. No mutable staged marker exists. A lowered physical version with
these objects refuses, even if someone bypassed the supported migration command.
Reservation/fact retries read and compare then skip equal inserts; never use REPLACE
or rely on OR IGNORE to bypass a BEFORE INSERT guard. `fact_id` is an HMAC of typed
target, version/span, reason and causal action identity. Multiple reasons/actions
retain separate immutable facts. First recorded time survives retry. Cleanup may
retry pending/failed with increasing attempt; complete never regresses or lifts denial.

### 4.1 Canonical guards (closed SQL expansion)

For each row below, substitute only the listed table/kind/collision expression
into this SQL. No caller may supply identifiers. Install only existing base tables.
There is intentionally **no AFTER INSERT birth-registration trigger**.

```sql
CREATE TRIGGER safety_{T}_insert BEFORE INSERT ON {T}
 WHEN EXISTS(SELECT 1 FROM {T} WHERE {collision}) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='{K}' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_{T}_identity BEFORE UPDATE ON {T}
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
```

| T / K | collision expression |
| --- | --- |
| memories / memory | `id=NEW.id OR rowid=NEW.rowid OR (NEW.deleted=0 AND deleted=0 AND (owner_id,scope,project_id,fingerprint)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.fingerprint))` |
| card_notes / submitted-note | `id=NEW.id OR rowid=NEW.rowid` |
| private_cards / card | `id=NEW.id OR rowid=NEW.rowid` |
| raw_conversations / raw | `id=NEW.id OR rowid=NEW.rowid OR (owner_id,scope,project_id,client,session_key)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.client,NEW.session_key)` |

Receipt and Raw child keys need their actual namespace/parent join:

```sql
CREATE TRIGGER safety_receipt_insert BEFORE INSERT ON receipts
 WHEN EXISTS(SELECT 1 FROM receipts WHERE id=NEW.id OR rowid=NEW.rowid OR (memory_id,receipt_key)=(NEW.memory_id,NEW.receipt_key)) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN memories m ON m.id=NEW.memory_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(m.owner_id,m.scope,m.project_id,'receipt',NEW.id))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_receipt_identity BEFORE UPDATE ON receipts
 WHEN (NEW.rowid,NEW.id,NEW.memory_id,NEW.receipt_key) IS NOT (OLD.rowid,OLD.id,OLD.memory_id,OLD.receipt_key) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_message_insert BEFORE INSERT ON raw_messages
 WHEN EXISTS(SELECT 1 FROM raw_messages WHERE rowid=NEW.rowid OR (conversation_id=NEW.conversation_id AND (message_id=NEW.message_id OR ordinal=NEW.ordinal))) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-message',json_array(NEW.conversation_id,NEW.message_id)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_message_identity BEFORE UPDATE ON raw_messages
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.ordinal,NEW.role,NEW.first_event_id) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.ordinal,OLD.role,OLD.first_event_id) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_part_insert BEFORE INSERT ON raw_parts
 WHEN EXISTS(SELECT 1 FROM raw_parts WHERE rowid=NEW.rowid OR (conversation_id,message_id,part_index)=(NEW.conversation_id,NEW.message_id,NEW.part_index)) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-part',json_array(NEW.conversation_id,NEW.message_id,NEW.part_index)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_part_identity BEFORE UPDATE ON raw_parts
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.part_index,NEW.start,NEW.end,NEW.digest) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.part_index,OLD.start,OLD.end,OLD.digest) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_memory_terminal BEFORE UPDATE ON memories WHEN OLD.deleted=1 AND NEW.deleted!=1 BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_note_terminal BEFORE UPDATE ON card_notes WHEN OLD.state='deleted' AND NEW.state!='deleted' BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_card_terminal BEFORE UPDATE ON private_cards WHEN OLD.state IN ('deleted','cancelled') AND NEW.state IS NOT OLD.state BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
```

All REPLACE protections run before implicit deletion, with recursive triggers off.
Existing receipt constraints are at `core/database.mjs:71`–`:82`; Raw composite
PK/UNIQUEs at `core/raw-schema.mjs:28`–`:58`. Progress UPDATE/new part append remains
allowed (`core/raw-journal.mjs:198`–`:220`). Reserved deleted children cannot recur.

### 4.2 Suppression writers

S2h extends S1's common predicate with owner/namespace/item and bound-source fact
checks in every final canonical snapshot; all cleanup states deny. It retains S1's
current-binding contributor loader until S2c. Existing final/refetch hooks cover
history, fallback, cursors and complete source snapshots without scheduling changes.
Each helper snapshots identities/ancestry **before** cleanup; creates an owner epoch
row at zero if absent (`INSERT SELECT ... WHERE NOT EXISTS`); reserves referenced
identities; inserts next-epoch facts; applies the existing tombstone/effects/result;
and commits before acknowledgement. No await or host callback inside the transaction.
`transaction` commits before return and rolls back failure (`core/database.mjs:337`–`:351`).
No success is returned on suppression/epoch/commit failure. Install this fallback
only where private_cards exists; an explicit writer's already-recorded purge skips
it. Its random fact id is the exception to HMAC fact ids: the terminal transition
can happen once and retry never re-enters it. Exact epoch guards still apply.

```sql
CREATE TRIGGER safety_card_suppression AFTER UPDATE OF state ON private_cards
 WHEN OLD.state IN ('draft','confirmed') AND NEW.state IN ('deleted','cancelled') AND NOT EXISTS(SELECT 1 FROM content_suppressions WHERE (owner_id,scope,project_id,kind,stable_key,incarnation,match_mode,reason)=(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'incarnation','purge'))
 BEGIN
 INSERT INTO owner_suppression_epochs SELECT NEW.owner_id,0,0 WHERE NOT EXISTS(SELECT 1 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id);
 INSERT INTO content_identity_reservations SELECT NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'writer' WHERE NOT EXISTS(SELECT 1 FROM content_identity_reservations WHERE (owner_id,scope,project_id,kind,stable_key)=(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id));
 INSERT INTO content_suppressions(owner_id,fact_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation,match_mode,source_version,message_key,span_start,span_end,reason,action_id,recorded_at,evidence_origin,cleanup_status,cleanup_attempt)
 SELECT NEW.owner_id,lower(hex(randomblob(32))),epoch_hi+CASE WHEN epoch_lo=4294967295 THEN 1 ELSE 0 END,CASE WHEN epoch_lo=4294967295 THEN 0 ELSE epoch_lo+1 END,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'incarnation','*','',0,0,'purge','card-terminal',NEW.updated_at,'writer','pending',0 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id;
 END;
```

This captures SQL-only automatic cancellations without a discovery feed or UDF.

| Current writer / transaction evidence | Fact written atomically |
| --- | --- |
| Forget `core/runtime.mjs:288`–`:314` | `user_forget` on Memory incarnation and removed receipt ids, plus Raw spans excluded by that operation. |
| Review reject `core/confirmation-storage.mjs:29`–`:31` | Same forget helper, with causal `purge`, not fabricated user-forget intent. |
| Correction `core/runtime.mjs:255`–`:285` | `correction_supersession` on Memory revisions **through the retired revision**, and all removed receipt incarnations; affected Raw spans carry the same cause. |
| Receipt removal `core/runtime.mjs:316`–`:326`; outer Raw transaction `core/raw-deletion-storage.mjs:124`–`:127`, `:153`–`:161` | `purge`, or the caller's causal privacy reason, per removed receipt. Internal helper asserts transaction ownership; no intermediate acknowledgement. |
| Card cancel/delete `core/private-card-storage.mjs:148`–`:154`, `:202`–`:203`, wrapper `:303`–`:317` | `purge` on Card incarnation. Capture automatic state transitions too; never delete facts/reservations with bindings. |
| Note deletion `core/private-card-storage.mjs:175`–`:198` | `purge` on note incarnation; H-only automatic draft cancellation also gets its Card fact. S2c changes source invalidation as specified in §7. |
| Raw deletion `core/raw-deletion-storage.mjs:117`–`:149`, `:153`–`:173` | `purge` on conversation incarnation before hard deletion, plus causal facts from nested Memory/receipt helpers. |
| Raw exclusion `core/raw-lineage-storage.mjs:115`–`:147` | Span fact with message id, overlap interval and causal forget/correction reason, in the exclusion transaction. Facts survive later deletion of exclusions. |
| Supersession `core/runtime.mjs:329`–`:344`; `core/supersession-storage.mjs:43`–`:63` | **No suppression.** Currentness revision changes preserve receipt ids and content; intact history remains readable. |
| Owner-wide erasure | No canonical account-erasure path in facade/runtime exports (`core/contract.mjs:1181`–`:1194`; `core/runtime.mjs:678`–`:688`). Expose only a trusted insertion seam for later host integration; vector purge (`core/context-semantic-maintenance.mjs:108`–`:158`) is derived cleanup, not account erasure. |

Memory correction uses `revision-through` with version
`["memory-revision-through-v1", retiredRevision]`. It matches any bound
`["memory-revision-v1", r]` with `r <= retiredRevision`, so prior metadata bumps
cannot hide an older app/engine Card's input. New corrected revisions remain usable.
Same-byte correction still removes all old receipt ids (`core/runtime.mjs:275`–`:279`).
No Memory-era table/history or direct-Memory contributor protocol is added.
The old fingerprint `suppressed` table is not a privacy reason source: ordinary
supersession also writes it (`core/supersession-storage.mjs:55`–`:61`). Missing rows
without verified deletion evidence cause unresolved denial, not an invented reason.

## 5. S2h hosted pull entry and identity handoff

### 5.1 Read-only facade and trusted service grant

Export `openContentSuppressionReader` from new `core/content-suppression-reader.mjs` and re-export at
`core/index.mjs:10`. It is a separate long-lived read-only handle, not a method added to the product reader's closed
set (`core/context-product-reader.mjs:266`–`:279`) or the Card-dependent facade (`core/contract.mjs:1181`–`:1194`). It
opens mapped v18 without Card options/sidecars, imports SQLite-reaching open code inside execution, and exposes only
these Promise/envelope methods and `close()`:

```text
openContentSuppressionReader({version:'content-suppression-read-v1',path,expected,
  serviceBinding:S,suppression:Q,host:{authorize,isCurrent},requestMaxMs?})
listSuppressionsSince(owner,epoch,{expected,cursor?,limit},credential)
 -> {ok:true,value:{items:[{key,reason,epoch}],throughEpoch,nextCursor}}
isSuppressed(owner,sourceIdentities,{expected,cursor?,limit},credential)
 -> {ok:true,value:{results:[{inputIndex,suppressed,reasons,matchedEpoch}],observedEpoch,nextCursor}}
```

A list item's `key` is a **DenialKey**, distinct from §5.2's input `C.key` (a UUID): a closed, content-free,
lossless wire form of one `content_suppressions` fact target, `{namespace|null,kind,incarnation|null,matchMode,
version|null,through|null,span|null}`. `matchMode` is the fact's `match_mode`: `owner` (namespace, incarnation and
version null), `namespace`, `incarnation`, `version` (exact `version`), `revision-through` (Memory only; `through` is
the last retired revision, so it matches every bound revision ≤ through and never a later valid revision) or `span`
(Raw only; `span={messageKey,start,end}` with end > start, matched by interval overlap in the same message and
conversation incarnation). Each value maps one-to-one onto the fact columns; serialization never widens or narrows a
fact. Acceptance adds a fact → wire → match round trip for every mode: a correction through M@6 matches bound M@4
and M@6, not M@7; an owner-wide or namespace-wide fact matches every identity in its scope; disjoint spans do not
match.

Closed records: expected binds bootstrap UUIDs `{storeId,suppressionDomain}`; Q is trusted issuance, not request options. S is exactly the existing service binding: `kind:'service',serviceId,credentialBindingId,
credentialExpiresUtcMs,credentialDigest,ownerId,namespaces:{readSet,ownerCoverage}, issuedAt,ownerGeneration?` with
existing validation (`core/context-product-service.mjs:17`–`:29`). Add `suppressionServiceIssuance(S,Q)` there:
validate S unchanged, validate Q below, and return binding B=`{...S,suppression:Q}`. Legacy issuance stays closed.

```text
Q={version:'content-suppression-grant-v1',expected,
   scope:{kind:'owner'} | {kind:'namespaces',readSet},
   permissions:{reconcile:true,erasureReconciliation:boolean},accessGeneration}
```

Scope readSet is nonempty, unique, same-owner and within S.namespaces.readSet; accessGeneration is a positive safe
integer. Each call requires owner=S.ownerId and that owner on every identity/ancestor namespace. Explicit owner scope covers **all** owner namespaces, independently of S's bounded context-selection list;
ordinary service access/recent-project coverage never implies that permission. Lists require owner scope; namespace
grants may batch only identities/ancestors within their set. Erasure permission is trusted host issuance, requires
owner scope, and is distinct from ordinary reconcile. It alone permits an erased owner's denial facts; no grant here
permits content access. Engine checks the erasure permission even when ordinary isCurrent returns true. Owner-facing
adapters authenticate the owner before issuing B; they never gain erasure permission automatically.

Reuse `requestAuthority` (`core/context-product-authority.mjs:17`–`:59`), adding only conditional
`suppression:B.suppression` to its trusted request for this new profile. Request grammar is
`{method,input,ownerId,namespaces,requestControl, credentialBindingId,suppression}`; input is the frozen normalized
method arguments, including expected and original cursor. The trusted grant returned by authorize must equal **all of
B**, not bare S. isCurrent(grant,request) must synchronously return true at entry and immediately before **every page
delivery**, including cached pages. Match credential digest/binding/expiry and live owner/scope/permission
generations; revoked/async/changed grants refuse. Reuse requestRecord's fresh request id, handle id, credential
binding/expiry and 1–5000 ms cutoff (`core/context-product-control.mjs:104`, `:129`–`:148`); default
requestMaxMs=1000. Callbacks run outside SQLite transactions. Cursor access digest includes Q
scope/permissions/generation/expected as well as S's credential/owner binding: existing accessDigest omits Q
(`core/context-product-validation.mjs:8`–`:9`). Product-reader lifecycle is unchanged.

The handle attests DB store_metadata.store_id and control.suppression_domain against constructor expected and
Q.expected. **Every first request and continuation** must also provide options.expected copied from the product
checkpoint `{owner,storeId,suppressionDomain,epoch}`; all four owner/store/domain bindings must agree before any epoch
query. No default to the handle's current domain. Initial checkpoint epoch 0 requires the authenticated
migration/bootstrap pair; mismatch never resets to 0. Persist only a terminal page's throughEpoch with the same pair.
Original-live-store admission still applies; restored/uncertain origin refuses. Local state cannot detect a host
secretly rolling back the whole store: the decided no-serving-restore rule remains necessary until external
ledger/admission work.

### 5.2 Frozen sourceIdentities union

This is the new pull input, **not a replacement content-ref API**. Common fields C:
`{storeId,suppressionDomain,namespace:{ownerId,scope,projectId},key,incarnation, boundRevision,ancestors}`.
Store/domain match options.expected; UUID key=incarnation for content roots, scope is personal/project, projectId is
null/string. ancestors is a recursively bounded array of this union. All fields below are mandatory:

| kind added to C | boundRevision and additional fields captured at body creation |
| --- | --- |
| memory | Positive safe integer from delivered Memory.revision; no extra fields. |
| submitted-note | Positive note revision; contentIdentity from its existing source ref (`core/private-card-storage.mjs:38`–`:40`). |
| receipt | boundRevision is the parent Memory revision, not a fabricated receipt counter; require memoryId and one Memory ancestor with key=memoryId, equal boundRevision/namespace. key is get's receipt id or the existing receiptRef.receiptId (`core/runtime.mjs:449`–`:450`; `core/card-receipt-sources.mjs:13`–`:17`). No new keyed field unavailable in v18 get is required. |
| raw | key is conversationId; positive boundRevision is the conversation revision captured with the source anchor/read (`core/raw-reads.mjs:57`; `core/raw-source-input.mjs:30`–`:34`). Require messageId, span:{start,end,precision}, contentIdentity; retain the original Raw ref (`core/raw-source-input.mjs:10`–`:18`). The ref has no numeric revision: missing capture refuses; no current-state fill. |
| card | Positive Card revision and bodyRevision; require its complete bound-body source closure, verifiable from retained S2c records. H-only/unknown Card closure cannot yield a negative answer. This probe does not add Card-derived writer inputs. |

Closure is transitive, same store/domain/owner, deduplicated by full typed/versioned identity; cycles, conflicting
duplicates or budget overflow refuse. Memory is a root on v18; notes are leaf identities on Card-capable bases.
Receipt rows are children, not implicit ancestors of Memory-only text. Receipt closure contains its captured parent
Memory and all applicable Raw ancestors; Raw closure includes its conversation erasure identity
(C.key/incarnation/revision) and message/span/precision structurally, so message ids are never global keys. On
Raw-capable bases, include every applicable Raw span ancestor of a Memory/receipt from canonical lineage at capture,
recursively. Unknown/missing origin or unavailable bound-version ancestry refuses a negative result; `ancestors:[]` is
not a caller assertion of independence. Engine validates closure against bound-version canonical evidence, never
later-body sources. A positive known denial can still answer true for a removed source. Never infer a missing
revision, parent, precision or store binding from today's row. Owner/namespace-wide targets are denial facts, not
extra content input kinds. Engine may add ancestors only from immutable records of the supplied bound version; missing
versions never resolve to current.

For pinned (storeUuid,domainUuid), v18 get supplies Memory id/namespace/revision (`core/contract.mjs:375`–`:398`;
`core/runtime.mjs:449`–`:450`, metadata `:152`–`:164`). For synthetic M at revision 4, persist with the app body revision:

```text
r=core.get({namespace:N,memoryId:M}); require r.ok; // pinned storeUuid/domainUuid
{kind:'memory',storeId:storeUuid,suppressionDomain:domainUuid,namespace:r.value.memory.namespace,
 key:M,incarnation:M,boundRevision:4,ancestors:[]}
```

Both UUIDs come from pinned bootstrap, not get's response; M=r.value.memory.id. Store the exact descriptor when
consuming that read; never reconstruct it from a later get. If receipt excerpts also feed the body, persist separate
receipt roots using r.value.receipts ids and that same Memory revision, with the Memory ancestor; consume all required
receipt pages coherently or refuse a complete source claim. At reconciliation, send the stored M@4 unchanged. A
correction retiring revision 6 and creating revision 7 matches revision-through 6; forget matches M's incarnation
regardless of revision. Rebuilding M@7 would be wrong. An app body rewrite captures new descriptors; it never edits
the source set of its old body revision. Bodies without captured versions/closure remain unknown; no current-state
backfill.

### 5.3 List window, batch cache and limits

List page one captures throughEpoch in one coherent snapshot and seeks immutable facts `inputEpoch < epoch <=
throughEpoch` in `(epoch,typed key)` order. Future or unverifiable epochs refuse; no counter means 0 only after
admission. Its authenticated cursor binds owner/store/domain, full suppression access digest, original epoch/limit,
fixed throughEpoch, last epoch/key HMAC and first-issued/expiry time. Resume checks contiguity and nonregression;
facts never prune/overwrite. Concurrent newer facts wait for the next pull. Empty is terminal only for
inputEpoch=throughEpoch; a missing fact before high-water refuses. Only terminal delivery advances the product
checkpoint.

Batch evaluates all 1–256 inputs/ancestor closures in one read snapshot at fixed observedEpoch, in input-index order.
Include owner/namespace, incarnation/version, revision-through and Raw overlap denials. reasons use deduplicated
taxonomy order; matchedEpoch is highest matching epoch or null. False only means no applicable fact at that epoch,
never complete lineage/read permission. Missing/unbound evidence refuses. Materialize all results before page one; no
transaction survives pagination. The **handle's service process owns its private cache** across HTTP/page requests;
the product keeps that handle alive and routes a batch's continuations to it. Cap serialized results at 64 KiB/batch,
at most 64 batches and 4 MiB charged total cache per handle (metadata included). Cache id and handle incarnation bind
the cursor together with full input digest, observed counter, owner/store/domain/access, original limit/last index and
issued/expiry time. Repeat the full identical input list on resume. Entries expire 15 minutes after page one;
close/restart/eviction/revocation destroys them and forces a full batch restart, never mixed-epoch recomputation. Live
counter cannot regress below observedEpoch; later denials do not rewrite a materialized snapshot.

Both operations: limit 1–100, request/response <=64 KiB, cursor <=2 KiB, lifetime <=15 minutes without renewal. Byte
caps may shorten a validated prefix with valid continuation; oversize entries, exhausted execution/closure budgets,
changed authority, invalid cursors or uncertain matching refuse without partial/false-complete output. No content,
source names, operation payloads or cleanup events leave these APIs. The hosted product owns its app Card
sources/checkpoints/notify/unpublish and legacy policy. Content delivery always checks live safety independently of
pull results.

## 6. S2c lineage storage and exact-byte commitments

Each body revision has a monotone contributor set, independent of current bindings.
The current body is hidden on all purposes if any contributor/ancestor is suppressed,
missing or identity-mismatched. Supersession alone is not suppression. Unknown
lineage denies retrieval (current/history), draft inspection, confirmed review and AI.
An empty surviving binding list is never authorship. Only a complete new body revision
(rewrite, regeneration or explicit keep-as-own) can discard old contributors.

| Durable source encoding | Identity / verification |
| --- | --- |
| Memory ancestor | Key/incarnation = Memory UUID; version `["memory-revision-v1", boundRevision]`; content identity HMAC over exact stored content/fingerprint, namespace and Memory id. It ignores current metadata revision. Exists only as receipt ancestry or positive legacy evidence; no independent direct-Memory input protocol. |
| Receipt | Key/incarnation = receipt UUID; version `["receipt-v1", memoryId, boundMemoryRevision, parentContentCommitment]`; verify existing receipt commitment using the **bound** revision and current row fields (`core/card-receipt-sources.mjs:13`–`:17`) plus the parent content/fingerprint commitment. Persist the Memory ancestor row too. |
| Submitted note | Note UUID and `["note-v1", revision]`; verify exact note text identity (`core/private-card-storage.mjs:38`–`:40`). |
| Raw | Conversation UUID; `["raw-span-v1", messageId,start,end,precision,partKeys]`. `precision` is exact or whole-message, required by existing commitment (`core/card-raw-sources.mjs:145`; `core/raw-source-input.mjs:3`–`:8`). partKeys is the sorted committed part-index list, with corresponding referenced-child reservations. Recompute exact span/manifest identity. |
| Unresolved positive legacy edge | `["legacy-unresolved-v1", evidenceDigest]`, empty content identity; useful for known suppression, never completeness. |

Receipt expansion is mandatory and nonempty (`core/card-receipt-sources.mjs:32`–`:38`).
Correction deletes old receipt identities even for identical bytes; version-through
facts also deny old Memory ancestor refs. Supersession preserves receipts, content
and fingerprint, so history passes their bound commitments. Direct SQL Memory text/
fingerprint changes fail recomputed parent commitments even if receipt rows survive.
Raw ancestry comes from retained roots/lineage (`core/raw-lineage-storage.mjs:26`–`:41`,
`:68`–`:113`); unknown ancestry denies completeness. Derived Card inputs are not
accepted (`core/private-card-input.mjs:95`–`:116`, `:191`–`:192`); leave a transitive-
flattening/cycle-refusal seam before ever adding them.

**Normalization is write-time only.** `cardText` redacts (`core/private-card-input.mjs:77`–`:82`),
a non-injective transform (`plugins/cairn-memory/lib/redact.mjs:17`). Detail currently
returns stored title/body (`core/private-card-storage.mjs:127`–`:130`). Writers
normalize once, then hash exactly those stored UTF-8 bytes. Readers hash **the exact
stored bytes they will deliver**, never a normalized/redacted replacement. Read
raw text bytes with strict UTF-8 decoding/round-trip validation; malformed or lossy
representations refuse before HMAC verification or delivery. A nonmutating
canonical-form validator enforces the write-time postconditions (well-formed text,
limits and redaction form); it never substitutes transformed hash/delivery bytes.
Noncanonical stored bytes deny. Secret-bearing SQL replacement cannot collide via read normalization.

Use domain-separated HMAC-SHA256 under the store secret, 64-character lower-case hex:
`bodyDigest = HMAC("card-body-s2-v1",[storeId,namespace,cardId,bodyRevision,title,body])`;
`parentCommit = HMAC("card-parent-s2-v1",[storeId,namespace,memoryId,content,fingerprint])`;
`provenanceDigest = HMAC("card-provenance-s2-v1",[storeId,namespace,cardId,bodyRevision,
provenanceRevision,bodyDigest,completeness,origin,authorizationActionOrNull,sortedSources])`.
Sorted source tuples include full namespace/kind/key/incarnation/version/content
identity, UTF-8 byte ordering, no truncation. Wrap existing base64url commitments
with a separate S2 domain; do not reinterpret 43-character text as hex. No source
text or original secret-bearing input is copied into lineage/authorization tables.

```sql
CREATE TABLE card_body_authorizations (
 owner_id TEXT NOT NULL, host_action_id TEXT NOT NULL CHECK(length(host_action_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 method TEXT NOT NULL, request_target TEXT NOT NULL, actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
 authorized_at TEXT NOT NULL CHECK(length(authorized_at)>0),
 payload_binding TEXT NOT NULL CHECK(length(payload_binding)=64 AND payload_binding NOT GLOB '*[^0-9a-f]*'),
 authorization_kind TEXT NOT NULL CHECK(authorization_kind IN ('operation','authored-input','keep-as-own','user-rewrite')),
 card_id TEXT, body_revision INTEGER, body_digest TEXT,
 PRIMARY KEY(owner_id,host_action_id),
 UNIQUE(owner_id,card_id,body_revision),
 CHECK((authorization_kind='operation' AND card_id IS NULL AND body_revision IS NULL AND body_digest IS NULL) OR
 (authorization_kind!='operation' AND card_id IS NOT NULL AND body_revision IS NOT NULL AND body_digest IS NOT NULL AND body_revision BETWEEN 1 AND 9007199254740991 AND length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'))
) STRICT, WITHOUT ROWID;
CREATE TABLE card_body_provenance (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_kind TEXT NOT NULL DEFAULT 'card' CHECK(card_kind='card'), card_id TEXT NOT NULL,
 body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 provenance_revision INTEGER NOT NULL CHECK(provenance_revision BETWEEN 1 AND 9007199254740991),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 provenance_digest TEXT NOT NULL CHECK(length(provenance_digest)=64 AND provenance_digest NOT GLOB '*[^0-9a-f]*'),
 completeness TEXT NOT NULL CHECK(completeness IN ('complete','unknown')),
 origin TEXT NOT NULL CHECK(origin IN ('derived','user-authored','legacy-unknown')),
 source_count INTEGER NOT NULL CHECK(source_count BETWEEN 0 AND 9007199254740991), authorization_action TEXT,
 PRIMARY KEY(owner_id,scope,project_id,card_id,body_revision,provenance_revision),
 FOREIGN KEY(owner_id,scope,project_id,card_kind,card_id,card_id)
 REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,authorization_action) REFERENCES card_body_authorizations(owner_id,host_action_id),
 CHECK(origin!='legacy-unknown' OR completeness='unknown'),
 CHECK(origin!='user-authored' OR (completeness='complete' AND authorization_action IS NOT NULL AND source_count=0)),
 CHECK(completeness!='complete' OR source_count>0 OR origin='user-authored')
) STRICT, WITHOUT ROWID;
CREATE TABLE card_body_sources (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_id TEXT NOT NULL, body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 source_scope TEXT NOT NULL CHECK(source_scope IN ('personal','project')),
 source_project TEXT NOT NULL CHECK((source_scope='personal' AND source_project='') OR (source_scope='project' AND length(source_project)>0)),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('memory','receipt','submitted-note','raw')),
 source_key TEXT NOT NULL, source_incarnation TEXT NOT NULL CHECK(source_key=source_incarnation),
 source_version TEXT NOT NULL CHECK(json_valid(source_version) AND json_type(source_version)='array' AND length(CAST(source_version AS BLOB))<=16384),
 content_identity TEXT NOT NULL CHECK(content_identity='' OR (length(content_identity)=64 AND content_identity NOT GLOB '*[^0-9a-f]*')),
 added_revision INTEGER NOT NULL CHECK(added_revision BETWEEN 1 AND 9007199254740991),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','binding','receipt-ancestry','canonical-operation','canonical-trace')),
 evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(owner_id,scope,project_id,card_id,body_revision,source_scope,source_project,source_kind,source_key,source_incarnation,source_version),
 FOREIGN KEY(owner_id,source_scope,source_project,source_kind,source_key,source_incarnation)
 REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,scope,project_id,card_id,body_revision,added_revision)
 REFERENCES card_body_provenance(owner_id,scope,project_id,card_id,body_revision,provenance_revision) DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;
CREATE INDEX card_body_source_erasure ON card_body_sources(owner_id,source_scope,source_project,source_kind,source_key,source_incarnation);
CREATE INDEX card_body_header_latest ON card_body_provenance(owner_id,scope,project_id,card_id,body_revision DESC,provenance_revision DESC);
CREATE UNIQUE INDEX card_operations_owner_action ON card_operations(owner_id,action_id);
```

The authorization table doubles as the owner-wide immutable action claim for every
new Card/organization mutation, with `operation` rows carrying no authorship marker.
Only explicit own-writing rows carry the body identity/digest. Migration refuses
conflicting legacy `(owner,actionId)` duplicates; it never discards old operations
to make the unique index fit. Existing nonconflicting operations also participate
in the global conflict lookup before new claims can be written.

```sql
CREATE TRIGGER safety_action_insert BEFORE INSERT ON card_body_authorizations
 WHEN EXISTS(SELECT 1 FROM card_body_authorizations WHERE (owner_id,host_action_id)=(NEW.owner_id,NEW.host_action_id) OR (owner_id,card_id,body_revision)=(NEW.owner_id,NEW.card_id,NEW.body_revision)) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_action_update BEFORE UPDATE ON card_body_authorizations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_action_delete BEFORE DELETE ON card_body_authorizations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_operation_insert BEFORE INSERT ON card_operations
 WHEN EXISTS(SELECT 1 FROM card_operations WHERE (owner_id,action_id)=(NEW.owner_id,NEW.action_id) OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_source_update BEFORE UPDATE ON card_body_sources BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_delete BEFORE DELETE ON card_body_sources BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_insert BEFORE INSERT ON card_body_sources
 WHEN NEW.body_revision < coalesce((SELECT max(body_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id)),NEW.body_revision) OR
 NEW.added_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)),0) OR
 EXISTS(SELECT 1 FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision,s.source_scope,s.source_project,s.source_kind,s.source_key,s.source_incarnation,s.source_version)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision,NEW.source_scope,NEW.source_project,NEW.source_kind,NEW.source_key,NEW.source_incarnation,NEW.source_version))
 BEGIN SELECT RAISE(ABORT,'safety_source_sealed'); END;
CREATE TRIGGER safety_header_update BEFORE UPDATE ON card_body_provenance BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_delete BEFORE DELETE ON card_body_provenance BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_insert BEFORE INSERT ON card_body_provenance
 WHEN NEW.body_revision < coalesce((SELECT max(body_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id)),NEW.body_revision) OR
 NEW.provenance_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)),0) OR
 NEW.source_count != (SELECT count(*) FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)) OR
 EXISTS(SELECT 1 FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision) AND
 (p.body_digest IS NOT NEW.body_digest OR p.completeness IS NOT NEW.completeness OR p.authorization_action IS NOT NEW.authorization_action OR (p.origin!=NEW.origin AND NOT(p.origin='user-authored' AND NEW.origin='derived')))) OR
 (NEW.completeness='complete' AND EXISTS(SELECT 1 FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision) AND s.content_identity='')) OR
 (NEW.authorization_action IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_body_authorizations a WHERE (a.owner_id,a.host_action_id,a.scope,a.project_id,a.card_id,a.body_revision,a.body_digest)=(NEW.owner_id,NEW.authorization_action,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision,NEW.body_digest) AND a.authorization_kind!='operation'))
 BEGIN SELECT RAISE(ABORT,'safety_header_invalid'); END;
CREATE TRIGGER safety_card_body_update BEFORE UPDATE ON private_cards
 WHEN (NEW.state IN ('draft','confirmed') AND (NEW.body_revision IS NULL OR NEW.body_revision<1)) OR
 EXISTS(SELECT 1 FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(OLD.owner_id,OLD.scope,OLD.project_id,OLD.id) AND (NEW.body_revision IS NULL OR NEW.body_revision<p.body_revision)) OR
 (OLD.body_revision IS NOT NULL AND (NEW.body_revision IS NULL OR NEW.body_revision<OLD.body_revision)) OR
 (OLD.state IN ('draft','confirmed') AND NEW.state IN ('draft','confirmed') AND NEW.body_revision=OLD.body_revision AND (NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body))
 BEGIN SELECT RAISE(ABORT,'safety_body_rollback'); END;
```

Insert source additions before their new sealing header; the deferred FK prevents
committing unsealed additions. Append-only rows plus count checking prevent shrink;
helper verifies digest, semantic encoding/ancestry and authorization. Historical
header validation uses only sources with `added_revision <= provenance_revision`.
A same-body union adds a header at max provenance revision + 1; a new body uses max
retained body revision + 1. No unknown-to-complete promotion within a body. Missing
new header after direct SQL revision advance denies; reverting to an older valid
header/bytes is rejected by the canonical guard **and** latest-body reader check.
SQL HMAC forgery is not assumed; unsupported DDL removal fails opener attestation.

## 7. S2c writers, authorization and S1 read swap

Current draft insert has null body revision; confirmation resets it to 1
(`core/private-card-storage.mjs:170`, `:208`). Binding replacement deletes rows
(`:99`–`:107`), and current edit increments body revision only on changed confirmed
bytes (`:214`–`:219`). These exact seams change atomically with installed S2c reads.

| Writer | Required body/source transaction |
| --- | --- |
| Draft create | Allocate body/provenance revision 1; insert the fresh canonical Card **before its first reservation**, then reserve Card and all declared contributors/ancestors and write complete sources/header/action/result. Reserving first would correctly trip the no-reuse INSERT guard. |
| authoredInput create | Currently inserts a note then binds it (`core/private-card-storage.mjs:166`–`:172`). It is complete own writing, with zero external contributors and a trusted authored-input marker. An optional compatibility note is not an external contributor/binding; do not fabricate provenance from it. |
| Draft/confirmed binding-only edit | Preserve body revision; union new contributors/ancestry, never remove old edges. Advance provenance revision only on growth. Presentation bindings may become empty; this proves no authorship. Unknown stays unknown. |
| Draft/confirmed body or title change | Allocate next body revision with a complete new declared set, or explicit own-writing authorization. Retain old sets. No null/reset numbering. |
| Confirm | Repeat draft-inspection safety over the complete accumulated durable set, including removed bindings. Preserve exact body/provenance identity; replace `body_revision=1`. Attach confirmation/applicability/dependencies atomically. |
| User rewrite / keep-as-own | Dedicated trusted explicit-user action; always a new revision, even identical bytes. Human-supplied complete text and own-writing marker can establish zero external sources. Never reveal hidden old text to implement this action; recovery inspection remains deferred. |
| Regeneration | Internal seam prepares from allowed surviving inputs outside transaction, then final transaction revalidates authority, inputs/ancestry and allocates complete new body/set. No generation service is built; current methods have no regeneration API (`core/private-card-input.mjs:9`–`:16`, `:182`–`:198`). |
| Source invalidation | Retain draft state/bytes under predicate denial rather than cancelling it: replace state/title/body assignments in `core/private-card-schema.mjs:124`–`:127`, `core/card-raw-sources.mjs:53`–`:55`, and note deletion's draft purge at `core/private-card-storage.mjs:190` with revision/time invalidation only. Explicit Card cancel/delete still clears bytes and records Card-incarnation purge. |

New-body helpers require live, unsuppressed inputs with complete exact ancestry;
reusing a stale presentation binding cannot certify a new complete source set.
S2c installs the invalidation variant with its physical version; S2h retains legacy
invalidation behavior. Sources hidden by a missing/deleted contributor cannot
become readable merely because their presentation binding disappeared. Own-writing
zero-source complete headers supply eligible support, while applicability and
current dependencies retain their purpose policy. Update existing nonempty support
logic (`core/private-card-storage.mjs:109`–`:116`) and min-one binding input validation
(`core/private-card-input.mjs:118`–`:120`) locally. All writes, results/effects/epochs
commit together before acknowledge (`core/private-card-storage.mjs:303`–`:317`).

### 7.1 Owner/action idempotency and trusted grant

Before **any replay or mutation**, look up `(owner, hostActionId)` across namespaces
in authorization actions **and** existing card_operations. Compare namespace,
method, request target/Card, actor and payload/body binding; any difference refuses
`action_conflict`. A legacy receipt without trusted actor evidence cannot adopt a
new actor on retry; refuse that replay. A matching claim with missing/mismatched
operation receipt also refuses instead of repeating the mutation. Only then may
the existing namespaced ledger replay its result.
Marker payload binding is `HMAC("card-action-audit-s2-v1",[storeId,owner,hostActionId,
originalPayloadBinding])` in hex; the ledger retains its original binding encoding. New claim/marker and
operation receipt commit together under BEGIN IMMEDIATE;
concurrent cross-namespace attempts serialize and cannot create two claims.
Keep the first trusted timestamp; a later timestamp on an otherwise identical retry
neither replaces it nor creates a new revision. Marker includes actor/time/action,
body identity/digest and no body text. An operation-only claim is not authorship.

The current ledger lookup is namespace-scoped (`core/private-operation-helpers.mjs:11`–`:20`),
so using it first is unsafe. The shared grant verifier accepts an exact closed key
set (`core/private-card-facade.mjs:9`–`:16`) and currently returns only generation.
Add a **Card-specific trusted-grant variant** for mutation dispatch, with trusted
actorId, authorizedAt, owner/hostActionId and binding to the same method/namespace/
request target/payload. It returns verified audit data as well as generation.
Other purposes retain the old exact grammar; do not globally tolerate extra fields.
The host supplies audit data through authority callbacks, never model/caller payload.
Own-writing requires explicit human authoring authority; operation-only claims may
name an authenticated service actor without granting own-writing. Recheck the grant
before commit/replay as current facade does (`:47`–`:49`, `:63`–`:69`). Every new mutation
requires this trusted audit variant; absent actor/time refuses rather than inventing
data. Read-only grants retain their existing grammar.

S2c includes the adapters, not just the verifier. `adapters/mcp/private-card-access.mjs:25`–`:30` adds the audit
variant for permitted draft/organization mutations, using a trusted bootstrap service actor/time; it does not acquire
explicit-user permission. Callers `adapters/mcp/server.mjs:149` and `adapters/mcp/retained-raw.mjs:22` supply that
context. `adapters/mcp/review-card.mjs:111`–`:116` supplies the authenticated human actor/time for approved
confirmation/dependency mutations. First issuance stores audit data in the grant map; isCurrent returns it unchanged.
Supplemental reads keep the old variant (`core/card-current-facade.mjs:9`–`:18`). These are the two in-tree Card
mutation grant producers. Method/asset command grants target different facades
(`adapters/mcp/method-package-command.mjs:107`–`:125`; `adapters/mcp/asset-command.mjs:61`–`:67`) and retain their old
variant; embedded hosts supplying privateCards.authority must migrate too. Installed positive tests cover
service-actor draft create/cancel and organization, human terminal confirmation/dependency revalidation, unchanged
reads, first timestamp/retry and scope revocation; no actor is fabricated from tool input.

### 7.2 Read integration

Replace S1's single contributor loader only in S2c. Within the canonical snapshot,
load the Card and **max retained body_revision for its incarnation**; the canonical
body revision must equal that maximum, not just name any old valid header. Select
latest provenance revision within it, load cumulative sources, verify source count,
exact-byte body digest and provenance digest, then all live source/ancestor identities
and suppression. Fetch actual bytes even when an index caller supplies metadata-only
rows (`core/context-product-sidecar.mjs:335`–`:344`). Never reconstruct from bindings.
Unknown/missing/mismatched headers deny. Canonical noncanonical bytes also deny.

Purposes remain S1's trusted dispatch: retrieval current/history, draft inspection,
confirmed review. Current retains support/applicability/dependency checks; history
admits intact superseded sources and confirmed historical Cards, not suppression.
Content-read DTOs/errors retain S1 shapes; only the separately authorized pull APIs
return reasons. Internal read reasons stay the frozen five suppressions
plus missing/identity_mismatch/ineligible; unknown maps to internal ineligible.

Prepared internal records carry latest body/provenance identities/digests and exact
source identities. After every await/caller callback, fresh final validation repeats
latest-body/exact-byte and live suppression checks and compares provenance digest.
A same-body union invalidates preparation. No older header/body may substitute.
Refuse partly stale assembly or incomplete promised-complete source snapshots.

Affected S1 surfaces: candidate/cursor, assembly preparation/final refetch, exact/
private evidence, source/receipt resolution, legacy fetch/receipt pages, complete
source snapshots, Card detail/list/organization, role evidence, fallback/recall and
index-build eligibility. Existing seams include `core/private-card-storage.mjs:228`,
`:273`, `:292`–`:299`; `core/context-read-sidecar.mjs:668`–`:695`;
`core/context-read-facade.mjs:603`, `:665`, `:703`–`:714`; `core/runtime.mjs:492`–`:546`.
Final validation uses S1 hooks, not pump/quantum/publication changes. No optional
tail or recovery metadata route is implemented. Host-owned app Card/caches need
separate acceptance; engine tests cannot prove their source tracking or final checks.

## 8. Atomic migration and S3 classifier

### 8.1 One atomic migration per capability

Host/installer closes admissions, stops capture/writers/maintenance, drains readers
and closes old handles. Under verified quiescence, take and validate a consistent
offline canonical/accounting/authority backup; never copy a live main file ignoring
committed WAL. Backups are non-serving. A failure keeps admissions closed for
investigation, not automatic restoration. Hosted DELETE journal blocking belongs
to the planned maintenance window; no measured need justifies staged machinery.

In one BEGIN IMMEDIATE transaction: attest exact source base/capability/store;
install DDL/guards; seed all recoverable facts and referenced reservations;
allocate owner epochs in deterministic typed-target/reason order; verify exact DDL,
integrity/FKs, all fact/counter continuity and every required identity; write complete
control and new physical version; verify again **before COMMIT**. On error rollback
everything and return failure. Readers never observe a half-migrated state or run DDL.
On first migration create domain once; adding S2c retains domain/epochs and changes
only the listed lineage capability, migration id and inventory attestation atomically.

S2h seeds Memory deleted tombstones, available canonical deleted note/Card states,
Raw exclusions/deletion effects and other unambiguous retained tombstones. Deleted
Memory rows retain id and `deleted=1` (`core/runtime.mjs:305`–`:307`). Use user_forget
only when retained evidence establishes that cause; otherwise conservative recovered
purge. Old exclusions without causal evidence likewise seed purge. A hard delete
leaves no invented id/reason. Fingerprint-only suppression is ambiguous because it
also covers supersession, and cannot seed a privacy fact by itself. Old correction
versions/receipt ids are seeded only when recoverable canonical evidence identifies
them; otherwise historical suppression coverage remains incomplete. This limitation
is disclosed to product reconciliation; migration is not proof of pre-migration
complete erasure history. No general external trace/backup import engine is built.

S2c additionally classifies every body-bearing draft/confirmed Card and any actual
retained historical bodies, allocates positive draft body revisions, reserves/seeds
all recovered contributor edges with origin, and verifies full headers/digests and
latest-body pointers before commit. Preserve valid confirmed numbering; choose
new draft revision above retained history. Terminal Cards have no readable body.
The current schema retains only one body row (`core/private-card-schema.mjs:15`–`:23`);
operation results are receipts, not body archives (`core/private-card-storage.mjs:146`–`:147`).
Do not manufacture historical bodies or count digest-only retired headers as text.
Malformed/ambiguous body numbering or conflicting legacy owner/action ids refuses
migration, not silent deletion of inconvenient data. Complete writer/read support
and owner local-policy approval precede S2c installation; no inert migration phase.

### 8.2 Pure shared classifier and legacy completeness

S3 owns `classifyCardBodySafetyV1(observation)` in a SQLite-free module, shared by
S2c migration. It has no db/filesystem/clock/logging/side effects. Input is a fully
materialized normalized canonical observation: actual body identity/bytes, positive
edges/evidence origins, completeness proof, identities/current source states and
proposed or installed suppression facts. Trusted observation adapters verify keyed
bindings and evidence coverage first. API callers cannot supply a trusted-proof flag.
Output: complete/unknown/known-suppressed, proposed header/edge descriptors and
internal reasons. S2h suppression seeding/matching helpers are independent of this
Card classifier; S3 does not depend on their installed tables or migrations.

Order: refuse the run if enumeration or required evidence examination is incomplete;
union all positive/plausible canonical edges; known suppression wins over incomplete
lineage; otherwise complete requires proven coverage; otherwise unknown. A missing
source with no recoverable deletion cause is unreadable/unknown, not fabricated
known-suppressed. A known matching tombstone or fact is known-suppressed even when
other lineage is unknown. Keep every known edge and its evidence origin/digest.

Legacy completeness requires the exact creation/body-replacement payload matching
the keyed operation binding, normalized write result, target and action, **plus a
closed canonical history** proving every later contributor-changing operation for
that body absent or fully accounted for, and exact expansion of all inputs/ancestors.
A matching candidate payload alone proves only that association. The ledger stores
method, keyed binding, target and result, not payload or continuity seal
(`core/private-operation-helpers.mjs:18`–`:20`; `core/private-card-input.mjs:92`–`:93`;
`core/private-card-schema.mjs:32`–`:43`). `NOT EXISTS(later edit)` cannot prove no
missing operation. Current bindings are replaceable (`core/private-card-storage.mjs:99`).
Historical memoryRefs expansion must include the receipts that existed then, not
just survivors (`core/card-receipt-sources.mjs:32`–`:38`).

Examine canonical bindings, receipt/Memory/Raw ancestry, retained canonical operations
and any already retained canonical body/source records. Reconstruct candidate
payloads only when exact verification is possible; never decode an opaque HMAC into
an assumed list. Conservatively retain plausible associations if body mapping cannot
exclude them. No new external trace-provider/import machinery. If an actual required
canonical source cannot be examined, refuse the report; lack of historical proof
with examined evidence produces unknown. Valid S2c headers/sets supply completeness
for later bodies. Existing ledger-only stores will be mostly, often entirely,
unknown or known-suppressed; no deployed proportion is claimed. Never auto-classify
legacy authoredInput or empty bindings as user-authored, and never invent actor/time.

### 8.3 Independent read-only preflight

Entry: `cairn-memory safety preflight --db ...`, core `preflightContentSafetyV1`.
S3 may ship before/in parallel with S2h; its source readers support unmigrated base
18/23/33 and installed mapped cells without importing S2c runtime/writers. Installer
can ship this read-only command before the local policy gate; hosted product runs
it through maintenance authority. It is not a normal request or opener hook.

First-install mode: no safety objects/tables/markers are required or created. Propose
reservations and denials in memory from canonical evidence, then call the exact
shared classifier. An intentionally absent ledger is distinct from an unavailable
required evidence provider. Partial/mismatched safety objects refuse, not fallback
to first install. No serving/restore admission, seeding, DDL, cleanup or remediation.

Under quiescence use a real read-only connection, query_only and **one coherent
read snapshot** for all enumeration/evidence/classification. Materialize before
return; never stitch separately timed pages or keep a transaction across host
callbacks. Existing read helper is at `core/database.mjs:297`–`:334`. Exhausted full-
scan/evidence budgets refuse a completed report rather than undercount.

File hashing/identity checks run in a **SQLite-free child**, never raw fd opens/closes
in the SQLite-holding process. The host closes/checkpoints before the preflight
baseline; preflight itself never checkpoints. Child records device/inode/size,
presence and SHA-256 for canonical main/WAL/journal and required evidence files
before/after. Prefer a checkpointed quiescent store and immutable read-only URI,
with no uncheckpointed WAL; SHM changes/creation cannot be ignored when claiming
unchanged file-family bytes. Close all handles before final comparison. Any content,
identity or presence change refuses a successful unchanged-files report. The child
returns checks/results, not source content. No in-process hashing fd lock hazard.

Output only enumerated-body count; disjoint complete/unknown/known-suppressed counts;
distinct owners in each class; deduplicated owners affected by unknown or known-
suppressed. Class counts sum exactly to enumerated bodies; owner classes can overlap,
so affected is a set union, not their sum. Enumerate canonical retained text bodies,
not sidecar memberships or hosted app Cards. Memory-only hosted stores have no
engine Card population; still validate source/tombstone evidence. No ids, namespace
names, source labels, content, per-owner rows or digest material in reports/logs.
Generic refusal replaces partial/false-zero success. Real local counts remain
private environment-local input to the owner decision, not public design data.

## 9. Delivery, estimates and acceptance

Hosted path: quiesce → verified offline backup → atomic S2h migration → fresh pins/
processes → verify epoch/pull and exact/fallback/ACL behavior → resume. Select or
defer the already-designed pull implementation as an owner package decision; without
it the hosted product's app Card reconciliation requirement remains unmet. The
product must start new app Card lineage and decide its existing unknown-source policy.
S3 local counts can precede this rollout. S2c stays outside **every installer** until
the owner reviews those counts and decides local legacy policy; then ship its complete
storage/writers/read swap atomically. Old pins refuse new cells; no backup-to-serving.

Ranges include implementation, focused tests and compatibility/docs, not this design.
S1 is separate. Planned inventories below are scope boundaries, not claims of edits.
No S2a/S2b staged halves remain.

| Package | Scope / planned files | Changed-line estimate | §8.1 acceptance / installer constraint |
| --- | --- | --- | --- |
| S2h | New safety layout/schema/suppression storage/migration/pull modules; `core/content-suppression-reader.mjs`, `core/index.mjs`, `core/context-product-service.mjs`, `core/context-product-authority.mjs` and typed-input adapter; `core/database.mjs`, `core/read-database.mjs`, `core/existing-store.mjs`, `core/context-product-schema.mjs`, S1 common predicate, topic validation, method capability checks, CLI/probe/local permission pins; `core/runtime.mjs`, `core/private-card-storage.mjs`, Raw deletion/lineage writers; focused storage/writer/pull/installed tests and shipped runtime manifests. | 1,900–3,200 | Reasons and both suppression pulls: all scopes/ancestors/versions, fixed windows, interleaved new facts/reasons, full-page reconciliation, batch input order/fixed snapshot, cursor/authority/size/budget refusals, same-transaction/no-ack-on-failure, epoch rollover/exhaustion/no reset, old-pin/incomplete-cell refusal; 18/23/33. v18 never gets Card tables. Hosted rollout needs pulls if selected; H-only local cells remain S1 lineage semantics. |
| S3 | New pure classifier, canonical read-only observations/preflight and CLI router; `adapters/mcp/cli.mjs`; focused first-install/class/owner/count/file-identity tests. No S2c runtime dependency. | 350–650 | Per-environment first-install and migrated read-only counts; zero writes/DDL and unchanged family digests; suppression precedence, total/owner reconciliation, missing/over-budget evidence refusal. Deliver before/in parallel with S2h and may ship read-only before local policy. |
| S2c | New Card provenance/authorization storage; local audit-grant adapters `adapters/mcp/private-card-access.mjs`, `adapters/mcp/review-card.mjs` and bootstrap callers `adapters/mcp/server.mjs`, `adapters/mcp/retained-raw.mjs`; lineage additions to schema/migration; S1 predicate loader/final digest seam; `core/private-card-storage.mjs`, `core/private-card-input.mjs`, `core/private-card-facade.mjs`, `core/private-operation-helpers.mjs`, `core/private-card-schema.mjs`, `core/card-raw-sources.mjs`, receipt checks; focused provenance/recovery/rollback/normalization/installed tests and gated packaging. Reuses S3 classifier. | 1,550–2,600 | Removed A binding then forget/purge A, rebuild/bare fetch/all purposes; child deletion/same-body union; draft inspect/confirm, confirmed needs-review repair; own-writing identical bytes/audit/owner-action retry and conflicts; latest-body rollback, noncanonical bytes, Raw precision. **One complete package; must not ship in any installer before local legacy-policy decision.** |

Total selected design: 3,800–6,450 lines including S3, excluding S1 and product app
Card source sets/reconciliation/UI. Pull work is included in S2h's estimate, not a
free transfer. S2h adds 500–800 lines for the concrete service facade/grants, typed
handoff and positive hosted tests; S2c adds 250–400 for adapters/installed tests. If owner defers it, report that requirement as unfulfilled; do not
claim aggregate hosted Card safety. Existing reserved-number/feature-upgrade/general
trace/era/staging work has been removed, not relabeled into another hidden package.

Positive hosted tests open v18 without Card options, page whole-owner facts and batch M@4 through correction/forget.
Explicit erasure service access succeeds for an erased owner; ordinary service access refuses. Namespace batches
succeed within scope; namespace grants cannot list the owner window. Test stale checkpoint domain
on the first page, page-two revocation/expiry, batch pagination through the same handle, and close/eviction/restart refusal
without mixed snapshots.

Additional decisive counterexamples: create body 1, safely replace by body 2, then
SQL-restore body_revision=1 plus old valid bytes/header; UPDATE must abort and every
reader must refuse if the guard is bypassed. SQL-replace a stored redaction marker
with a synthetic unredacted value; exact-byte/noncanonical checks must deny the
entire response, including history and review. Equal Raw coordinates with different
precision must remain distinct and reconstructible after binding removal. Owner/action
reuse across namespace, Card, method, actor or body binding must refuse before replay.
Test REPLACE with recursive triggers off on facts/headers/reservations/counters and
all relevant UNIQUE/rowid conflicts. Compare lists/batch results against independent
canonical denial enumeration. No source/identity scan is silently truncated.

Deferred §8.1 restore-ledger, recovery-inspection and restricted-metadata cases remain
disabled; no mock proof marks them passed. Demonstrate no restore-to-serving route.
Hosted app Card tracking/polling/caches/notify/unpublish/ACL acceptance is product-side.
Complete engine-Card safety requires S1+S2h+S2c; S3 is diagnostic and grants no reads.

## 10. Remaining owner/product decisions

| Decision | Recommendation |
| --- | --- |
| Select or defer S2h pulls? | Select both together: required for hosted app Card reconciliation outside the forget handler. Design/storage/cost are frozen so selection does not reopen protocol work. |
| Local legacy policy after S3? | Run real local counts first; keep fail-closed unknown policy, with explicit new-revision remediation when authorized. Keep S2c out of all installers until the owner decides. |
| Existing app Cards lack Memory lineage; how recover availability? | Product records new per-revision Memory ids/bound revisions and relevant ancestor identities immediately and chooses conservative handling/regeneration for unknown legacy app Cards. Pulls alone cannot reconstruct their sources. |
| Trusted actor/time supplier for local Card actions? | Bind authenticated service actors/time for every ordinary draft/organization mutation and authenticated human actors for explicit authoring/terminal approval. Migrate adapters and embedded Card ports; absent audit data refuses all new mutations, not just own-writing. Tool input never supplies identity. |
| Host reconciliation admission and maintenance window? | Pin original store/domain, inventory/drain all readers/writers, plan DELETE-mode downtime, persist checkpoints only after terminal pages, and enforce the already-decided no-serving-restore rule. |

No deployed-layout question remains: hosted base is 18. No public ref protocol,
Memory eras, staged verifier or base-feature upgrade remains open in this round.
The legacy operation ledger cannot prove closed history by itself; this code/spec
limitation is disclosed rather than reinterpreted. Existing source-driven draft
cancellation conflicts with new-revision recovery and is changed only with S2c.
No identified requirement forces performance-track/lifecycle/harness changes.

## Revision 2 dispositions

| Finding | Resolution |
| --- | --- |
| Soundness P1 body rollback | §6 canonical body/title/body-revision guard; §7.2 requires latest retained body and exact bytes; §9 adds the reproduced rollback counterexample. |
| Soundness P1 normalization | §6 write-time-only normalization, exact stored/delivered-byte HMAC and noncanonical refusal; §9 tests redaction-marker replacement. |
| Soundness P2 Raw precision | §6 durable Raw version includes precision and committed part keys, matching existing commitment. |
| Soundness P2 feature upgrades / scope P2-5 | §3 enables only needed 18/23/33 cells and gated lineage cells; all base-feature upgrades refuse. |
| Scope P1-1 legacy refs | §2 verifies all six serving insert statements; UUID id is incarnation, legacy public refs retained, no replacement API; synthetic/imported ambiguity refuses. |
| Scope P1-2 owner/action idempotency | §6 owner/action PK and operation index; §7.1 global pre-replay namespace/method/actor/target/body conflict check, first timestamp, Card-specific closed grant variant. |
| Scope P2-3 blanket reservations | §2.2 reserves only suppression/provenance references, including only referenced Raw children; §4 has no per-allocation birth registration. |
| Scope P2-4 Memory eras | §4.2 correction-through facts and removed receipt ids; §6 parent content/fingerprint commitment. No era history/direct-Memory input protocol. |
| Scope migration reduction | §8.1 one atomic verified-before-commit migration; no staged/resumable machinery or serving restore. |
| Scope preflight-first / trace machinery | §8.2–§8.3 pure shared classifier and in-memory first install independently ship before/parallel with S2h; general external trace import deferred. |
| Product/package restructure | §§1/5/9 freeze hosted v18 path and both bounded pulls; S2c is one complete installer-gated package; app-database lineage remains product-owned. |

## Revision 3 dispositions

| Finding | Resolution |
| --- | --- |
| Scope P1 hosted pull entry/authority | §5.1 standalone v18 facade/export, closed service extension, explicit erasure permission, first-request checkpoint binding; §5.3 handle-owned cache; §9 positive hosted tests/cost. |
| Scope P1 source identity handoff | §5.2 mandatory store/domain/namespace/UUID/version union, bound ancestor closure and existing-get M@4 example; missing/unbound data refuses, never current backfill. S3 contract unchanged. |
| Scope P2 S2c adapters | §7.1 inventories both Card grant producers/bootstrap callers and installed positive paths; §9 costs adapters; §10 includes authenticated ordinary service actors as well as human authoring. |
| Soundness P2 (round 3) list response key | §5.1 defines the DenialKey wire form, distinct from §5.2's input `C.key`, mapping each fact's match mode, version, revision-through and span losslessly, with a fact → wire → match acceptance case. |

## Revision 3.2 addendum: opt-in creation at the safety cell (2026-10-29)

This addendum adds one creation path. It changes nothing above.

- **Default creation is unchanged.** New stores are still created at their legacy cell (18, 23 or 33). Installers, local setup and CLI flags are untouched.
- **One explicit opt-in creation option.** It applies only when the store file is new. It creates the base layout of that cell plus the complete S2h safety objects and guards (§4, §4.1), and the new physical version (34, 38 or 48), in **one** transaction. Before COMMIT it verifies the same items as §8.1.
  - On an existing store the option refuses and never migrates. Existing stores use only §8.1.
  - On a base the creation path cannot produce, it refuses.
- **Control fields for a never-migrated store** (§4, `content_safety_control`):
  - `migration_state` is `'complete'`;
  - `suppression_domain` is a fresh UUID;
  - `migration_id` is a fresh UUID identifying this creation;
  - `inventory_digest` is the §8.1 logical inventory digest of the pristine legacy-base store, computed inside the creation transaction before the safety objects are installed.
  - No facts, reservations or epoch rows exist until the first writer creates them.
- **The result is equivalent to a §8.1 migration of an empty legacy store**, apart from its per-store UUIDs. Every opener attests it identically, and old pins refuse it.
- **Deployment note (assumption from product facts, not measured):** a deployment that serves all owners from one store per environment reaches the safety cell through one §8.1 maintenance migration per environment. This option serves only newly built environments, or imports that build a fresh store.

**Acceptance:**
- a store created at each base has the same schema digest as an empty migrated store of that base, with control semantics equal apart from UUIDs;
- the option refuses on an existing store;
- old pins refuse the created store;
- default creation stays byte-for-byte the same schema as before.

## Revision 3.3 addendum: threat-model scope for suppression integrity (2026-10-30)

This addendum scopes the guarantees above. It changes no storage, writer or pull contract.

- **In scope:** every engine writer, reader and pull path. Suppression facts, reservations and epochs are protected against application faults and against every engine API caller. The §4.1 guards refuse UPDATE, DELETE and INSERT OR REPLACE. Openers refuse missing, partial or inconsistent safety objects, and a failed attestation refuses for the life of the native connection. Pull batches and list pages refuse a missing fact inside the interval they verify (§5.3).
- **Out of scope:** an actor with direct DDL or DML rights on the engine database file. For example, one who drops a guard, edits or deletes rows, and restores the guard. Such an actor can equally rewrite or delete the content itself, so suppression-fact integrity cannot be stronger than content integrity.
- **Basis:** this matches the existing trust boundary. Same-database DML is trusted only through the coordinated maintenance writer, and arbitrary same-user edits and undetected bit rot are not certified (`docs/plans/context-read-product.md:419`). Cooperative locks do not attest against malicious same-user filesystem or SQL edits (`docs/limitations.md:209`).
- **Consequence for §5.3:** batch and list contiguity checks detect gaps inside the interval they verify. They do not re-verify facts at or before the caller's authenticated checkpoint, which the caller already received and must retain. No schema-cookie binding is added: a legitimate external `ANALYZE` or `PRAGMA optimize` would otherwise brick a store permanently.
- Observed corruption, such as malformed rows, broken intervals or failed attestation, still always refuses.
