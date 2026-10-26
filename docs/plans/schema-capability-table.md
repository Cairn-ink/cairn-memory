# Schema capabilities and one-way migration runbook package

Status: proposed production runbook/tooling specification, based on main
`546d57ac`, on `docs/schema-capability-table`. No production migration is
authorized or performed by this packet. Operator-supplied planning inputs are
engine pin `7467aeb`, physical schema v18, approximately 10 MB, 1,112 Memories
and four namespaces; these are task inputs, not observations of production.
Repository references below use `file:line` at `546d57ac`, except explicitly
qualified historical/branch references and this packet's measurement script.

**Minimum for unified Memory/Card search plus the integrated private Card
lifecycle: v23.** v33 is required only if the product also requires
`card-current-dependencies-v1`, including invalidation when declared current
context/method dependencies change. Choosing v33 now can avoid another migration
for that broader roadmap, but it is not a prerequisite for baseline unified
search and private Cards (`core/context-read-facade.mjs:105`,
`core/database.mjs:489`, `core/database.mjs:677`,
`docs/card-current-dependencies-local.md:5`).

## Capability table

“Minimum” distinguishes the first physical feature layout from the target the
**present public opener** installs. It is not a promise that every subsequent
integer version is accepted. In particular, topic readers accept exactly
18, 20–23 and 29–33, while context readers additionally accept physical 24–28;
v19 was never implemented (`core/database.mjs:39`, `core/database.mjs:43`,
`core/private-card-schema.mjs:1`). Read-only means a supported public reader
that does not migrate or maintain canonical data; an ordinary `openMemoryCore`
handle is writable even when its caller only invokes `get`
(`core/read-database.mjs:22`, `core/database.mjs:400`).

| Capability | Minimum physical schema / present opener target | Read-only on v18, no migration? | WAL as well as DELETE? | Public entry point and evidence |
| --- | --- | --- | --- | --- |
| `readTopicOverview` | **18**; existing accepted layout only | **Yes** | **Yes**, qualified SHM behavior below | `openMemoryReader({path,ownerId}).readTopicOverview(input)`; Worker handle and native read-only opener (`core/index.mjs:8`, `core/memory-reader.mjs:7`, `core/memory-reader.mjs:71`, `core/read-database.mjs:27`, `docs/topic-overview.md:30`). |
| E1-M `readTopicMembers` | **18**; same exact topic allowlist | **Yes**, metadata/identifier labels | **Yes** | Same handle, `.readTopicMembers(input)`; physical schema/mode matrix and no-body assertions (`core/memory-reader.mjs:72`, `core/testing/topic-members-fixture.mjs:23`, `core/test/topic-members-compatibility.test.mjs:18`). |
| `topic-member-previews-v1` | **18 planned**, no new layout | **Contract says yes; unavailable on this base** | **Contract requires both; not implementation acceptance** | Planned same `.readTopicMembers({...input,previews:{version:'topic-member-previews-v1',maxChars:72}})`. Frozen **unmerged** contract on `feat/topic-member-previews`, reference `0a24f66c`: `feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:3`, `feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:33`, `feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:59`, `feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:476`, `feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:636`. No implementation/performance claim follows from the contract. |
| E1-C2 WAL readers / diagnostics | **18**; reader policy, no DDL | **Yes** | **Yes**; WAL wait budget ≤100 ms/request, DELETE zero wait | `openMemoryReader({path,ownerId,diagnostics:true})`, both topic methods; diagnostics optional, WAL policy not conditional on diagnostics (`core/topic-reader-sqlite.mjs:19`, `core/topic-reader-sqlite.mjs:52`, `docs/topic-overview.md:274`, `docs/topic-overview.md:299`). |
| `context-read-v1`, `types:['memory']`, sidecar | **18**, derived sidecar format **1**, not canonical v19 | **Yes, with a prebuilt, fresh compatible sidecar**; read-only cannot create/refresh it | **No for `openContextReader`**: canonical and sidecar must be rollback-journal with no companions. Ordinary writable context facade can use a WAL canonical store, with DELETE sidecar; it has no E1-C2 policy | `openContextReader({path,contextRead})` → `findCandidates`, `fetchCandidateEvidence`, `contextRead`; maintenance via `openMemoryCore({path,contextRead}).refreshContextIndex`. (`core/index.mjs:9`, `core/context-read-facade.mjs:60`, `core/context-read-facade.mjs:75`, `core/context-read-facade.mjs:719`, `core/context-read-sidecar.mjs:16`, `core/context-read-sidecar.mjs:48`, `core/context-read-sidecar.mjs:148`, `core/context-read-sidecar.mjs:193`). |
| `context-read-v1`, `types:['card']` or `['memory','card']` | **22**: Cards + receipt bindings + applicability reviews; integrated Card authoring selects **23** | **No**, v18 has no Card tables; `types` does not install them | Same context reader restriction; ordinary writable facade can use WAL canonical + DELETE sidecar | Same context APIs; capability is discovered from actual tables, not just the requested type (`core/context-read-facade.mjs:105`, `core/context-read-facade.mjs:114`, `core/private-evidence-schema.mjs:1`, `core/database.mjs:489`). |
| Private Cards / “decision B” (interpreted here as explicit private authored Cards) | Note/Card slice **20**; receipt dependencies **21**; evidence/applicability **22**; integrated organization/lifecycle target **23** | **No** | **Yes for core storage and ordinary `review-card`**; independent terminal approval still required | `openMemoryCore({path,privateCards:{...}})` → `createCardDraft`, `getCard`, `confirmCardDraft`, `editKnowledgeCard`, etc.; opaque host authority required. (`core/private-card-schema.mjs:1`, `core/read-database.mjs:50`, `core/private-card-input.mjs:9`, `core/private-card-input.mjs:21`, `core/database.mjs:489`, `adapters/mcp/review-card.mjs:90`, `adapters/mcp/review-card.mjs:130`). |
| Raw capture | Journal **24**, capture **25**, lineage **26**, deletion **27**, Card Raw sources **28**, local controls **29**; **public constructor selects 29** | **No** | **Yes for core storage**; installed configuration/preflight is a separate gate | `openMemoryCore({path,rawConversations:{mode:'raw-v1',port,capBytes,readPolicy,...}}).captureRaw(input)`; current composition always enables lineage, deletion and local controls. Private Cards add source support. (`core/raw-schema.mjs:2`, `core/contract.mjs:205`, `core/raw-options.mjs:30`, `core/raw-composition.mjs:14`, `core/raw-composition.mjs:29`, `core/database.mjs:651`, `adapters/local/configuration.mjs:75`). |
| Method packages | **30**, including schemas through 29 as prerequisites | **No** | **Yes for core storage**; `methods` terminal commands refuse WAL/companions | `openMemoryCore({path,methodPackages:{...}})` → `importMethodVersion`, `readMethodFile`, `resolveMethod`, etc. (`core/method-package-schema.mjs:3`, `core/method-package-input.mjs:8`, `core/method-package-input.mjs:17`, `core/method-package-migration.mjs:13`, `core/store-fence.mjs:26`). |
| Assets | **31**, including method schema 30 | **No** | **Yes for core storage**; asset terminal commands refuse WAL/companions | `openMemoryCore({path,assets:{...}})` → `importAssetVersion`, `readAssetBytes`, derivatives. (`core/asset-schema.mjs:4`, `core/asset-input.mjs:9`, `core/asset-input.mjs:19`, `core/database.mjs:677`, `adapters/mcp/asset-command.mjs:53`, `core/store-fence.mjs:26`). |
| Role profiles | **32**, including asset schema 31 | **No** | **Yes for ordinary core storage**; any context sidecar/read-only restrictions still apply | `openMemoryCore({path,roleProfiles:{...},...})` → `publishRoleProfileRelease`, `disableRoleProfile`, `deleteRoleProfileRelease`, `readRoleTaskContext`; MCP requires method packages + context-read and matching read sets. (`core/role-profile-schema.mjs:7`, `core/role-profile-input.mjs:8`, `core/role-profile-facade.mjs:24`, `core/database.mjs:683`, `adapters/mcp/role-profile-configuration.mjs:10`). |
| Current-dependent Card invalidation | **33**, including 30/31/32 | **No** | **Yes for core storage and ordinary terminal review** | `openMemoryCore({path,privateCards:{...,currentDependencies:{version:'card-current-dependencies-v1'}},methodPackages:{...}})`; `confirmCardDraft`, `declareCardCurrentDependencies`, `revalidateCardCurrentDependencies`. (`core/card-current-schema.mjs:4`, `core/private-card-input.mjs:28`, `core/contract.mjs:226`, `core/database.mjs:688`, `core/card-current-input.mjs:6`, `docs/card-current-dependencies-local.md:7`, `adapters/mcp/review-card.mjs:118`, `adapters/mcp/review-card.mjs:130`). |
| Supersession / history reads | **8** originally; v18 already contains it; context history reader starts at **18** | **History yes** through context reader with ready sidecar; `supersede` is a write. `core.get/list` need no v18 migration but use ordinary writable handles | Core supersession and `get/list`: **yes**. Read-only context history: **DELETE only** | `openMemoryCore(...).supersede/get/list`, list with historical states; context reader `intent:'history'`. Qualified endpoints require `transitionQualified`/`transitionQualifiedSet`. (`docs/supersession.md:87`, `docs/supersession.md:3`, `docs/supersession.md:37`, `core/contract.mjs:365`, `core/contract.mjs:375`, `core/contract.mjs:477`, `core/context-read-facade.mjs:712`, `core/context-read-sidecar.mjs:48`). |
| Correction | Baseline **1** storage primitives; **18** ordinary target suffices; no post-v18 migration needed | **No**, mutation | **Yes**, ordinary core path | `openMemoryCore(...).correct({namespace,memoryId,expectedRevision,content,kind,receipt})`; clears old receipts, invalidates dependent state and increments revision. (`core/testing/schema-v1.sql:3`, `core/contract.mjs:402`, `core/runtime.mjs:265`, `core/index.mjs:55`, `core/database.mjs:489`). |
| Forget | Baseline **1** tombstone/suppression primitives; **18** ordinary target suffices | **No**, mutation | **Yes**, ordinary core path | `openMemoryCore(...).forget({namespace,memoryId,expectedRevision})`; clears content/receipts and suppresses the fingerprint. Logical deletion does not erase backups/WAL. (`core/testing/schema-v1.sql:19`, `core/testing/schema-v1.sql:35`, `core/contract.mjs:467`, `core/runtime.mjs:288`, `docs/supersession.md:71`, `docs/supersession.md:79`). |

“Yes for core storage” means the ordinary database opener does not reject WAL
or force a journal-mode change; it configures foreign keys/trusted schema and
uses `BEGIN IMMEDIATE`, with a 5,000 ms storage timeout. It is not a claim that
every host/terminal adapter accepts WAL or that busy errors cannot occur
(`core/database.mjs:32`, `core/database.mjs:336`, `core/database.mjs:354`,
`core/database.mjs:400`, `core/store-fence.mjs:26`). Topic reads may update native
SHM read marks at offsets 100–119 without changing canonical application data;
the physical-mode tests qualify that invariant rather than asserting that a
live WAL directory is byte-identical (`core/test/topic-members-compatibility.test.mjs:31`,
`core/test/topic-members-compatibility.test.mjs:79`).

The previews references above are **branch-qualified**, not files delivered on
this base. Inspect with `git show 0a24f66c:docs/plans/topic-member-previews.md`.
That frozen contract explicitly requires physical v18/current v33 and DELETE/WAL
acceptance; neither a v33 migration nor this document makes previews available
(`feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:3`,
`feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:476`,
`feat/topic-member-previews@0a24f66c:docs/plans/topic-member-previews.md:636`).

## Why v23 is sufficient, and when to choose v33

The schema dependency chain is:

```text
18 baseline
  -> 20 submitted notes + private Cards        (19 never implemented)
  -> 21 retained-Memory receipt bindings/invalidation
  -> 22 common evidence + applicability reviews
  -> 23 typed Card organization/mappings
  -> 24 Raw journal -> 25 capture -> 26 lineage -> 27 deletion
  -> 28 Card Raw sources -> 29 local controls
  -> 30 method packages -> 31 assets -> 32 role profiles
  -> 33 declared current-context/method-dependent Card invalidation

18 or 22+ canonical store -> separate context-read sidecar format 1
                           (Memory-only at 18; Card-capable at 22+)
```

The physical table seams are enumerated in `core/read-database.mjs:50`;
the higher-version dependency installers are in
`core/method-package-migration.mjs:19` and `core/database.mjs:677`.
The context sidecar has its own application ID/format and never substitutes for
missing Card tables (`core/context-read-sidecar.mjs:16`,
`core/context-read-facade.mjs:105`). The arrows describe physical prerequisites,
not a series of production restarts: the ordinary opener executes the selected
upgrade within one enclosing transaction (`core/database.mjs:402`,
`core/database.mjs:693`).

For the stated goal, select only private Cards for the one-time **v18 → v23**
migration, then configure context-read and explicitly refresh the desired
Memory/Card projections. A Card-capable sidecar can read physical v22, but the
present integrated private Card opener also installs organization and lands at
v23. Core's existing receipt-bound invalidation already cancels dependent drafts
and invalidates support when a Memory revision changes; v33 adds a different
declaration about current context and methods (`core/database.mjs:489`,
`core/private-card-schema.mjs:90`, `docs/private-cards-local.md:140`,
`docs/card-current-dependencies-local.md:3`).

If “migrate once” includes planned method packages, assets, role profiles and
current-dependent Cards, choose **v18 → v33 now**, after separate operational
qualification. `currentDependencies` requires method-package configuration, and
the schema upgrade installs all the intermediate prerequisites. Installing
those schemas does not itself opt into Raw capture, backfill or authority grants
(`core/runtime.mjs:42`, `core/database.mjs:677`,
`core/method-package-migration.mjs:13`). Do not choose v33 to solve a WAL
read-only context problem: the auxiliary/header refusal is independent of the
canonical version (`core/context-read-sidecar.mjs:48`).

The older production engine is not a fallback opener after either migration:
at `7467aeb`, v18 is the accepted current version and an unrecognized nonempty
store fails `unsupported_database`. No downgrade path is provided here
(`7467aeb:core/database.mjs:283`, `7467aeb:core/database.mjs:400`). Restore means
restoring the consistent pre-migration backup with all connections stopped,
and accepting the explicitly recorded recovery point; it cannot retain writes
made after that recovery point. Existing operational guidance requires stopping
all processes before filesystem backup (`packaging/README.md:209`).

## Existing migration and operational inventory

| Existing surface | Behavior and operational limit | Evidence |
| --- | --- | --- |
| Public `openMemoryCore` → runtime → `openDatabase` | Feature-selected migration on construction; there is no numeric `targetSchema` option in the public grammar. With no later feature options, valid v18 returns without upgrading. Private Cards takes v18 directly to v23. | `core/contract.mjs:49`, `core/contract.mjs:185`, `core/runtime.mjs:38`, `core/database.mjs:489` |
| Ordinary migration transaction | `BEGIN IMMEDIATE`, commit on success, rollback on error. Permissions checked, but ordinary paths may create a missing file; it is not a production precheck command. | `core/database.mjs:336`, `core/database.mjs:380`, `core/database.mjs:402` |
| v18 → v23 | `installPrivateCards`, `installCardMemorySources`, `installPrivateEvidence`, `installPrivateOrganization`, then set `user_version=23` in the same transaction. No public v20/v21/v22 stop target. | `core/database.mjs:489`, `core/private-card-schema.mjs:1` |
| v18 → v30/31/32/33 | Higher feature selection reaches `migrateMethodPrerequisites`; schema installers cover 20–29, validate v29, install/validate v30, then assets/roles/current dependencies as selected. v19 refuses. | `core/method-package-migration.mjs:15`, `core/database.mjs:411`, `core/database.mjs:677` |
| Managed-existing options | `schema29-existing-v1`, `schema30-existing-v1`, `schema31-existing-v1`, `schema32-existing-v1`, `schema33-existing-v1`, with `storeId`; validates without migration. Actual version semantics differ: schema29 accepts 29–33; schema30 accepts ≥30 in that set; 31/32/33 are exact. These cannot be used to precheck v18. | `core/existing-store.mjs:12`, `core/existing-store.mjs:85`, `core/database.mjs:362` |
| Noncreating fence | `storeFence:{version:'store-fence-v1',dev,ino,applicationId,userVersion,storeId}` pins physical/logical identity before migration. Mutually exclusive with managed-existing. Current fence refuses WAL headers or any journal/WAL/SHM companion. Identity fence is not a migration approval token. | `core/store-fence.mjs:9`, `core/store-fence.mjs:26`, `core/store-fence.mjs:56`, `core/database.mjs:360`, `core/database.mjs:399` |
| Feature startup flags | `--private-cards local-v1` selects v23; `--method-packages local-v1` v30; `--assets local-v1` v31; `--role-profiles local-v1` v32; `--private-card-current-dependencies local-v1` v33, with required dependencies. Flags configure the ordinary opener; they are not backup/check/dry-run commands. | `adapters/mcp/cli.mjs:175`, `adapters/mcp/cli.mjs:198`, `adapters/mcp/server.mjs:166`, `adapters/mcp/role-profile-configuration.mjs:10`, `adapters/mcp/card-current-configuration.mjs:2`, `core/database.mjs:677` |
| Approval tokens | Private feature methods take an opaque host authority object and exact payload-bound grants; serialized JSON cannot mint them. **No separate migration token is required by the ordinary opener**: enabling a valid feature option can migrate before any data method/approval call. | `core/private-card-input.mjs:21`, `docs/private-cards-local.md:49`, `core/runtime.mjs:47`, `core/database.mjs:402` |
| Interactive approval examples | `review-card` uses controlling-terminal confirmation bound to ID/revision (and optional applicability/dependencies). `methods import` and asset import show `storeUpgrade` before approving and opening the older store for upgrade. Method phrase is `IMPORT METHOD ACTION_ID`; asset phrase `IMPORT ASSET ACTION_ID`. They are operation-specific approvals, not a general migration command. Ordinary `review-card` opens/upgrades before the confirmation prompt, so it is not a migration-approval barrier. | `adapters/mcp/cli.mjs:65`, `adapters/mcp/review-card.mjs:90`, `adapters/mcp/review-card.mjs:130`, `adapters/mcp/review-card.mjs:170`, `adapters/mcp/method-package-command.mjs:140`, `adapters/mcp/method-package-command.mjs:161`, `adapters/mcp/asset-command.mjs:48`, `adapters/mcp/asset-command.mjs:84` |
| `--check-config` | Syntax/configuration only, no database open; cannot attest backup, schema readiness or integrity. | `adapters/mcp/cli.mjs:161`, `adapters/mcp/cli.mjs:298`, `adapters/mcp/context-read-command.mjs:10` |
| `context refresh` | Sidecar maintenance command, existing rollback-journal store, pinned noncreating identity. Prints an envelope, exit 1 for failure; rebuilding/partial is not completed coverage. Not canonical migration or a backup. | `adapters/mcp/context-read-command.mjs:20`, `adapters/mcp/context-read-command.mjs:27`, `docs/context-read-local.md:188` |
| Backup today | Documented **stopped-store filesystem copy** including remaining WAL/SHM; no live consistent database-backup subcommand is dispatched by the shipped CLI. The offline measurement also uses the available low-level `node:sqlite.backup` API on Node 22.16.0; this is a SQLite primitive, not a shipped engine command. Model `verify` verifies an embedding pack, not SQLite. | `packaging/README.md:207`, `adapters/mcp/cli.mjs:283`, `adapters/mcp/cli.mjs:29`, `tools/testing/measure-schema-migration.mjs:11`, `tools/testing/measure-schema-migration.mjs:49` |
| Verification today | Embedded validators check schema, identity and selected integrity constraints; role/current validators and the context sidecar include quick/foreign-key checks. Topic validation deliberately omits full unrelated Card/Raw attestation. No production count/integrity/readability-report command is dispatched. | `core/existing-store.mjs:85`, `core/role-profile-schema.mjs:115`, `core/card-current-schema.mjs:73`, `core/context-read-sidecar.mjs:209`, `core/read-database.mjs:38`, `adapters/mcp/cli.mjs:283` |
| Dry-run/timing today | Synthetic E1-C helper can physically create v18; current WAL measurement migrates synthetic v18 to v33 via the internal opener. Neither is a live production backup/dry-run command or migration-time estimate. The optional script below measures a stopped-store SQLite backup, existing SQL precheck, public constructor migration and verification on isolated copies. | `core/testing/topic-overview-raw29-fixture.mjs:24`, `tools/testing/measure-topic-overview-contention.mjs:112`, `tools/testing/measure-topic-reader-wal.mjs:293`, `tools/testing/measure-schema-migration.mjs:1` |

## Proposed engine-owned package (not implemented commands)

Provide one versioned, offline `cairn-memory store` command group. The following
names, outputs, approval binding and exit codes are **proposals**. All paths are
operator arguments supplied through shell variables. No command loads a model,
reads provider keys, captures content or contacts the network. Keep canonical
data and identity material out of stdout/stderr; reports contain counts and
opaque comparison commitments, never cursor secrets, bodies or receipt text.

```sh
# Live consistent SQLite snapshot; destination must not exist.
cairn-memory store backup --db "$PROD_DB" --out "$BACKUP_DB" \
  --report "$BACKUP_REPORT" --deadline-ms 30000

# Read-only inspection + exact proposed path; no ordinary migrating opener.
cairn-memory store check --db "$PROD_DB" --from 18 --to 23 \
  --report "$CHECK_REPORT" --deadline-ms 30000

# Fresh consistent copy, same engine migrator, full verification on the copy.
cairn-memory store migrate --db "$PROD_DB" --from 18 --to 23 \
  --dry-run --copy-to "$TRIAL_DB" --report "$TRIAL_REPORT" --deadline-ms 30000

# Under maintenance: all old connections stopped, writes fenced; take a final
# backup and repeat check. Approval binds that final checkpoint and plan.
cairn-memory store migrate --db "$PROD_DB" --from 18 --to 23 \
  --check-report "$FINAL_CHECK_REPORT" --backup-report "$FINAL_BACKUP_REPORT" \
  --approve-plan "$PLAN_DIGEST" --report "$MIGRATION_REPORT" --deadline-ms 30000

cairn-memory store verify --db "$PROD_DB" --schema 23 \
  --baseline "$FINAL_BACKUP_REPORT" --capabilities topic-overview,topic-members,context-memory,context-card,private-cards \
  --report "$VERIFY_REPORT" --deadline-ms 30000
```

Substitute `--to 33` / `--schema 33` only after selecting the broader capability
set. The proposed target enum should initially be **23 and 33**, with an explicit
mapping to existing engine installers. Reject unsupported target/from pairs;
do not simulate intermediate layouts with `PRAGMA user_version`, expose a
generic SQL escape hatch, or silently migrate to “latest”.

| Command / missing piece | Required behavior and report fields |
| --- | --- |
| Consistent live backup | Use a supported SQLite online snapshot/backup mechanism qualified on the shipped Node/SQLite runtime; open existing source without invoking the engine's writable constructor. Include a single committed recovery point and its WAL-visible data. Never raw-copy a live main file or independently copy moving companions. Do not run journal-mode changes/checkpoints on the live source just to make a copy. Bound lock waiting/retries and report progress/expiry. Qualify the concrete backup primitive during implementation; this plan does not assert that a particular JS API exists on every runtime. |
| Backup publication | Destination private directory (0700), new regular file (0600), no symlink/hardlink aliases to source and no overwrite. Finish/close snapshot, validate application/layout/integrity/foreign keys, record recovery-point counts and backup digest, synchronize file/report and directory, then atomically publish. On failure, no artifact may be labeled complete. Backups exclude the rebuildable context sidecar by default and explicitly state that; retain the sensitive backup under product policy. |
| Pre-migration check | Native read-only, noncreating inspection in a consistent read snapshot: runtime/engine build, application ID, physical schema/DDL/indexes/triggers, store identity, journal mode, companions/recovery requirements, namespace and per-state counts, suppression/history/receipt/index counts, integrity/foreign-key results, source bytes/page count/freelist. Inventory every schema table mechanically and mark expected new tables. Report target dependency path, one-way old-engine incompatibility, disk-space requirement and blockers. Live check is advisory; the apply command must revalidate at the fenced final checkpoint. |
| Capacity / operational fence | Estimate and check enough free space for the backup, copy rehearsal, migrated file, rollback journal/WAL and reports, with a recorded conservative safety margin. Report required/available bytes. Require maintenance for apply, close all legacy readers as well as writers, and block new opens/writes with an operator-controlled exclusive maintenance lease. A filesystem identity check or a live PID is insufficient proof of quiescence. |
| Dry-run | Snapshot live source into a new owned copy, then use the **same migrator and target mapping as apply**; never call the writable migrator on production. Retain the copy and report for review. Compare source snapshot data against post-migration copy, run verify and record copy/migrate/verify/total wall times, input/output bytes, engine/runtime and journal mode. Bind results to that snapshot; subsequent production changes require a new final baseline. Read-only source snapshots may maintain native SHM bookkeeping; do not promise concurrent whole-directory byte equality. |
| Apply and approval | Require backup/check reports whose store, engine build, source schema, target, plan digest and maintenance checkpoint match. `--approve-plan` is an operator attestation, not a Card data authority token or secret. Reject stale/mismatched plans. Use a noncreating, WAL-capable identity fence and revalidate under the migration transaction; today's DELETE-only `storeFence` needs extension or a separately reviewed equivalent. Run the existing installers atomically. No data authoring/capture/role activation as a side effect. |
| Deadline / failure state | The deadline covers open, lock acquisition, migration and cleanup. A synchronous native migration needs a supported execution/interrupt arrangement; a timer alone is insufficient. Before commit, roll back on failure and report confirmed source schema. If commit outcome or durability is uncertain, report `manual_recovery_required`, forbid automatic retry and inspect the file with all writers stopped. A post-commit verify failure is not reported as rollback. |
| Post-migration verification | Full `PRAGMA integrity_check` must return only `ok`; `foreign_key_check` must return zero rows. Match application/store identity, exact target schema and expected DDL/guards. Compare **all pre-existing table counts and deterministic row commitments**, including tombstones, suppression, historical transitions, receipts, MOCs, placements, staged/episode/index state; enumerate permitted installer transformations separately. Check newly introduced feature tables against their expected empty/initialized state. Do not compare only live Memory totals. |
| Readability | In every namespace, paginate topic overview and members to exact EOF and compare totals/members with baseline. Refetch every nondeleted Memory and all of its receipt pages on the isolated copy using the visibility protocol below; compare revisions/state/content internally and emit no prose. Tombstones require raw commitments plus API invisibility, not successful `get` results. Exercise private Card capability/read paths with exact host read authority and empty expected Card results on v18-derived stores. Rebuild/refresh sidecar projections explicitly on a copy or approved maintenance handle, then find/fetch/assemble Memory and Card candidates. Empty Card data is a supported-type test, not proof of a nonempty Card lifecycle; use a separate synthetic canary for that. Report unsupported WAL/read-only context combination as a blocker, not as a successful zero-result search. |
| Verify side effects | Baseline verification is read-only. Any sidecar rebuild/refresh is a separately named phase requiring explicit maintenance authority and a writable derived store. In-process engine `get/list` may need a non-migrating validated facade or a verified isolated copy; do not describe the ordinary writable opener as read-only verification. Do not invoke correction, forget, draft or confirmation on production as smoke tests. |
| Structured outputs and supervision | Versioned JSON envelope with command/run ID, engine/runtime/SQLite, start/end UTC, elapsed phase times, source/target schema, journal, recovery-point ID, backup/check/plan digests, bytes, count comparisons, integrity/readability results and `complete/failed/partial/manual_recovery_required`. Progress records go to stderr with phase and numeric counters. Final report persists even on failure. Operator/runner waits for real exit, detects lost progress using actual phase/activity and deadlines, and surfaces failure/completion; detached processes and log files alone do not constitute monitoring. |

Canonical verification must account for the actual public visibility rules:

- Open the already validated isolated copy with
  `openMemoryCore({path,decisionReview:'required-v1'})`. For each namespace,
  exhaust both `list({namespace,states:['active','historical'],...})` and the
  separate `list({namespace,states:['active','historical'],reviewState:'awaiting',...})`
  traversal. Compare their exact ID sets with the nondeleted baseline partitions.
  Default listing excludes awaiting rows; it is not an inventory of all stored
  Memories (`core/contract.mjs:350`, `core/runtime.mjs:405`).
- Use `get({namespace,memoryId,includeAwaiting:true,receiptLimit,...})` for every
  nondeleted row. Keep `includeAwaiting` and `receiptLimit` fixed while following
  `nextReceiptCursor` as `receiptCursor` until `exhausted:true` and a null cursor.
  Compare every retained receipt's identity, attribution, canonical excerpt and
  timestamp, plus body/revision/state/filing metadata. An awaiting row must also
  fail ordinary `get` without `includeAwaiting` as `memory_not_found`
  (`core/contract.mjs:375`, `core/runtime.mjs:431`).
- Verify **every stored tombstone** through the original-table counts and raw
  content commitments, including its stored fields and suppression effects.
  Separately require absence from both listing partitions and `memory_not_found`
  from `get`, both with and without `includeAwaiting:true`. Public `get/list`
  exclude `deleted=1`; API invisibility does not replace checking retained stored
  data (`core/runtime.mjs:413`, `core/runtime.mjs:438`, `core/runtime.mjs:288`).

Proposed common exit codes:

| Exit | Meaning |
| --- | --- |
| **0** | Requested operation fully completed and all required checks passed; dry-run means only the copy migrated. |
| **2** | Invalid arguments or unsupported source/target/runtime/layout; no migration attempted. |
| **3** | Unsafe path/identity, stale plan, missing approval/backup, insufficient space or missing maintenance fence; no migration attempted. |
| **4** | Integrity, count/commitment, schema or readability failure. Report whether migration already committed; never imply automatic rollback after commit. |
| **5** | Busy/deadline/cancellation with rollback and unchanged source schema positively confirmed; retry requires a fresh check. |
| **6** | I/O/cleanup/durability failure or unknown commit outcome; report `manual_recovery_required` when state is uncertain. |

The runbook should require a successful dry-run and final backup before apply,
then keep writers fenced until verify succeeds. Resume only binaries that accept
the target. A failed verify after commit calls for investigation or a deliberate
restore under maintenance, not reopening the migrated file with `7467aeb`.
The final backup recovery point must include all accepted pre-cutover writes;
an earlier live rehearsal backup is not the final rollback baseline.

## Offline timing observation — Revision 1

Run: `node tools/testing/measure-schema-migration.mjs`, **exit 0**, on
Node **22.16.0**, Linux x64, SQLite **3.49.1**. This replaces the earlier
migration-only timing with `synthetic-schema-migration-timing-v2`. No Node
24.15.0 timing or compatibility result is claimed by this run. The script
accepts no paths/arguments, creates its own owned scratch workspace and removes
it after completion (`tools/testing/measure-schema-migration.mjs:18`,
`tools/testing/measure-schema-migration.mjs:135`,
`tools/testing/measure-schema-migration.mjs:169`,
`tools/testing/measure-schema-migration.mjs:223`).

| Target / independent backup copy | (a) Backup (ms) | (b) Precheck (ms) | (c) Migration (ms) | (d) Verification (ms) | Total wall (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| v23 / 1 | 70.113 | 7.475 | 33.668 | 709.174 | 820.751 |
| v23 / 2 | 61.942 | 8.359 | 32.927 | 687.577 | 791.143 |
| v23 / 3 | 59.006 | 7.966 | 33.378 | 629.592 | 730.254 |
| v33 / 1 | 64.715 | 7.336 | 66.657 | 729.242 | 868.235 |
| v33 / 2 | 52.291 | 8.292 | 65.070 | 760.196 | 886.119 |
| v33 / 3 | 69.897 | 7.833 | 76.562 | 722.399 | 876.969 |

The numbers above retain all three independent trials per target from the
script's `trials` records. All four steps are measured in the same warm process;
seeding, untimed canaries and the original source baseline/hash inventory are
outside the timed window. Total wall runs from immediately before backup until
verification finishes. The sum of the four phase times is also retained as
`stepSumMs` in JSON; total wall additionally includes **0.270–0.338 ms** per
trial of phase handoff/progress-report overhead, so displayed phase sums need
not equal total wall exactly (`tools/testing/measure-schema-migration.mjs:175`,
`tools/testing/measure-schema-migration.mjs:184`,
`tools/testing/measure-schema-migration.mjs:213`).

| Target | Median backup (ms) | Median precheck (ms) | Median migration (ms) | Median verification (ms) | Median total wall (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| v23 | 61.942 | 7.966 | 33.378 | 687.577 | 791.143 |
| v33 | 64.715 | 7.833 | 66.657 | 729.242 | 876.969 |

Each phase median is calculated independently; median total is the median of
the three observed total wall times, not a sum of independent medians.

| Target (same sizes in all three trials) | Source v18 (bytes) | Backup before migration (bytes) | Migrated file (bytes) |
| --- | ---: | ---: | ---: |
| v23 | 7,516,160 | 7,516,160 | 7,692,288 |
| v33 | 7,516,160 | 7,516,160 | 8,392,704 |

These sizes are observations of this fresh synthetic seed and its six copies,
recorded before backup, immediately after backup and after verification
(`tools/testing/measure-schema-migration.mjs:174`,
`tools/testing/measure-schema-migration.mjs:187`,
`tools/testing/measure-schema-migration.mjs:216`).

### What each step measures

- **(a) Consistent backup of the stopped store:** the script first confirms
  that the closed DELETE-mode source has no journal/WAL/SHM companions. It opens
  that existing source read-only, calls **`await backup(db,destination)` from
  `node:sqlite`**, closes the source connection and sets the new destination to
  0600 inside its owned private workspace. This is SQLite's available low-level
  backup primitive, not an engine backup CLI. Each destination is a fresh
  rehearsal copy; it is then migrated, rather than retained as a separate
  rollback archive (`tools/testing/measure-schema-migration.mjs:11`,
  `tools/testing/measure-schema-migration.mjs:49`,
  `tools/testing/measure-schema-migration.mjs:182`).
- **(b) Existing SQL precheck:** native read-only transaction, full
  `PRAGMA integrity_check`, zero `foreign_key_check` rows, application ID
  `0x43414952`, `user_version=18`, unchanged DELETE mode, exact original table
  inventory and all original table counts. This phase uses existing SQLite
  checks rather than the proposed engine `store check` command; it does not
  compute content hashes or public-API reads (`tools/testing/measure-schema-migration.mjs:25`,
  `tools/testing/measure-schema-migration.mjs:56`,
  `tools/testing/measure-schema-migration.mjs:189`).
- **(c) Migration:** public `openMemoryCore(options)` and synchronous close,
  with modules already loaded. v23 selects private Cards; v33 additionally
  selects current dependencies and method-package options, using the engine's
  synthetic authority helper. No Card data operation is approved/performed
  (`tools/testing/measure-schema-migration.mjs:178`,
  `tools/testing/measure-schema-migration.mjs:196`,
  `core/testing/raw-source-fixtures.mjs:8`).
- **(d) Post-migration verification:** exact target/application ID/mode, full
  integrity/foreign-key checks and equal counts plus deterministic content
  hashes for **all 43 original non-internal tables**. Public readability uses
  `decisionReview:'required-v1'`, exhausts ordinary and awaiting listings with
  both active/historical states, and refetches every nondeleted Memory with
  `includeAwaiting:true`. It follows every receipt cursor to exhaustion with
  `receiptLimit:1`, comparing every canonical receipt and body/revision/state
  metadata. Tombstone invisibility is checked by both listing partitions and
  ordinary/awaiting `get` refusals; stored tombstones remain covered by raw
  commitments. Each namespace also gets a public overview read with a matching
  owner, including Worker construction/close. A second raw inspection confirms
  that public verification preserved every original table, and no companions
  remain on the closed trial copy (`tools/testing/measure-schema-migration.mjs:25`,
  `tools/testing/measure-schema-migration.mjs:61`,
  `tools/testing/measure-schema-migration.mjs:201`).

On each of the six timed copies, verification read **1,112 Memories and 1,112
retained receipts over 1,112 receipt pages**; these particular fixtures have
**zero awaiting, historical or tombstoned Memories**. The nonempty visibility
branches are therefore covered by a separate **untimed synthetic canary**:
one awaiting Memory, one historical Memory with three receipts, one active
replacement and one tombstone. The same verifier read three nondeleted Memories
and five retained receipts over five pages, asserted default awaiting
invisibility, exact list partitions, historical readability, tombstone
invisibility and unchanged raw data (`tools/testing/measure-schema-migration.mjs:61`,
`tools/testing/measure-schema-migration.mjs:101`,
`tools/testing/measure-schema-migration.mjs:137`,
`tools/testing/measure-schema-migration.mjs:217`).

**WAL behavior of the chosen backup method:** an additional untimed synthetic
probe held a WAL writer with an uncommitted second row while backing up through
an independent read-only connection. The backup contained the committed first
row from the still-present WAL, excluded the uncommitted row, and left the
source in WAL mode. No source checkpoint or journal-mode change was requested
by the backup helper. This demonstrates logical committed-data snapshot behavior
on this runtime, rather than a filesystem copy of main/WAL/SHM. It is **not** a
WAL timing cell or production live-backup qualification; timed migration trials
remain DELETE only (`tools/testing/measure-schema-migration.mjs:49`,
`tools/testing/measure-schema-migration.mjs:122`,
`tools/testing/measure-schema-migration.mjs:138`). The shipped operational guidance
still prescribes stopping all processes before filesystem copies including
remaining sidecars. The new engine-owned live backup package above still needs
bounded waiting, failure handling, protected archive publication/durability and
operator qualification (`packaging/README.md:209`).

### Fixture shape and supplied versus retained payload

This is a **real physical v18 fixture**, created through E1-C's `seedStore`
and `installOverviewLayout(...,18)`, which uses the baseline engine schema path
and asserts v18 before any later installer. It is not v33 relabeled as v18
(`tools/testing/measure-topic-overview-contention.mjs:112`,
`core/testing/topic-overview-raw29-fixture.mjs:24`). It has 1,112 Memories, four
namespaces **across two synthetic owners**, and 71 MOCs. MOC title-support
Memories remain intact; the other **1,045** Memories receive public correction
with synthetic ASCII payloads (`tools/testing/measure-topic-overview-contention.mjs:58`,
`tools/testing/measure-schema-migration.mjs:142`,
`tools/testing/measure-schema-migration.mjs:161`).

For each of those 1,045 corrections, the **supplied body is 3,500 UTF-16 units
and the supplied receipt excerpt is also 3,500 units**, because the script passes
the body as `receipt.excerpt`. The **retained body is 3,500 units, but the
retained receipt excerpt is 800 units**: `contractReceipt` applies the 800-unit
truncating `boundedText` path. The script asserts both retained lengths and
reports all four supplied/retained length fields separately. “Matching receipt”
means the same supplied source, not equal retained body/excerpt sizes
(`core/contract.mjs:93`, `core/validation.mjs:37`,
`tools/testing/measure-schema-migration.mjs:154`,
`tools/testing/measure-schema-migration.mjs:166`). No arbitrary padding tables
or pages are added. Source data and physical v18 are rechecked after all trials
(`tools/testing/measure-schema-migration.mjs:220`).

The source is **7.52 MB decimal (7.17 MiB), smaller than the supplied roughly
10 MB production file**. These are synthetic, warm-process observations on
fresh DELETE-mode backup copies, not cold-process/cold-disk samples or a
production downtime claim. They match the requested Memory/namespace counts,
not production payload distribution, schema-object provenance, visibility mix,
filesystem latency, runtime or concurrent load. Do not linearly scale the data
or use these totals as the maintenance window: writer drain, durable backup
archive publication, actual-store rehearsal, full runbook verification and
sidecar maintenance need separate qualification. The timed verifier does not
rebuild/query the context sidecar, exercise nonempty Cards or paginate all topic
members; those remain part of the proposed production verification package.

The complete revised run and both untimed canaries exited **0**. The final
script syntax check (`node --check`) exited **0**. No broad suites, network,
provider keys or production access were used.

## Open decisions and delivery boundary

1. Confirm the product meaning of “decision B”: this table assumes baseline
   explicit private authored Cards. Does launch also require declared current
   context/method invalidation, making v33 the minimum for that enlarged scope?
2. Choose the production context access topology/journal policy. A WAL production
   store cannot use today's read-only `openContextReader`; decide between the
   supported ordinary context facade with managed sidecar maintenance, a
   consistent read copy, or separately scoped WAL read-only context work. Also
   map the four product namespaces into supported read sets: each context read
   accepts at most two same-owner namespaces, one personal and one project
   (`core/context-read-sidecar.mjs:108`).
3. Set maintenance/downtime budget, lock/deadline policy, backup retention/storage,
   disk margin, restore recovery point, write-fence ownership and verified
   completion/failure notification. No production SLA follows from a synthetic
   constructor timing.
4. Engine implementers must qualify the live backup primitive and noncreating
   WAL migration fence, plus non-migrating full verification. The command group
   and the numeric exit convention above are proposed interfaces to approve.
5. Previews remain a separate unmerged contract/implementation/acceptance track,
   including its production-runtime and load gates; a schema migration is not
   a substitute for shipping that work (branch reference above).

This packet changes only this plan and the optional synthetic measurement
script, does not commit, and does not change package manifests. If the primary
ships the plan/script, it must decide packaging and register shipped files in
`packaging/artifact-files.json`, then check the installed closure. This preserves
the task's write boundary; it does not claim manifest registration or full CI
acceptance. Only targeted offline checks are appropriate for this packet.
