# Next packet: discover retained Raw and author a Card through installed MCP

Status: core-only milestone authorized, 2026-10-21; not delivered or accepted.
Initial fixed base:96fd4c64e719427e594b7600702294f7313e88e2 (reviewed B4b).
Worktree:/home/chichieh/Github/cairn-memory-worktrees/raw-retained-mcp.
Branch:feat/raw-retained-mcp. B4c changes no core files, so this bounded core work
can proceed independently while B4c finishes review/CI. Primary will integrate
the exact accepted B4c commit before host/installed freeze and delivery, record
the resulting base, and rerun the combined affected gates. No assumptions about
future main merges; do not modify B4c's worktree or frozen source.

## Outcome and limits

An owner can run one explicitly configured local MCP against the existing
schema29 store, discover retained conversation metadata, page its exact source,
resolve source references, author a private Card draft, and approve that exact
draft through the separate local terminal command. Reopen in a fresh process and
inspect the same Card/source bindings. Raw may support a Card without a fake
Memory intermediary. This is the same engine, not a second product data model.

Synthetic local implementation/tests/PR only. No real transcripts/configuration,
paid calls, merges, releases, deployment, migration of an operational store,
product pins/flags, automatic Cards, new Raw capture tool or native client
activation. Existing benchmark results stay unchanged. This packet is a bounded
part of installed V1, not full V1 or measured semantic reliability.

## Owner configuration and opening

Use a separate private retained-read profile rather than borrowing capture's
B3 provider/usage/consent-generation configuration. Reading previously retained
evidence is distinct from permission to capture new messages.

Proposed closed profile (freeze exact names before authoring):
`{version:'local-raw-retained-profile-v1',path,storeId,namespace}`.
Path is an absolute existing private SQLite file; namespace has the existing
exact ownerId/scope/projectId contract. Profile and DB leaves are own-UID regular
files0600; their immediate parents are own-UID directories0700. Canonicalize
host-owned ancestors as existing private-state does, rather than claiming every
ancestor is private or forbidding platform aliases. Refuse a symlink at the
owned leaf; freeze the canonical path and compare parent/file identities around
opening. Bound profile size to64KiB; no accessor/proxy or unknown-field adoption.
Do not accept SQL, executable, provider, environment,
crypto callback, authority or auto-migration overrides from the profile.

CLI opt-in: `--retained-raw-profile ABS` (alone, apart from syntax-only
`--check-config`). Reject combinations with --db/--owner/--project/model/capture
flags rather than allowing two sources of authority. Reuse this profile in
`review-card --retained-raw-profile ABS --card ID --revision N
[--applicability ...]`. Legacy CLI/API behavior remains unchanged.

An async preparation/wrapper may read/validate the profile, while preserving
the existing synchronous createCairnServer and legacy reviewCard behavior.
The new server path is keyless and must not inspect OPENAI_API_KEY, instantiate
a provider, run interpretation, grant capture consent or alter quota settings.
Its fixed exact-namespace retained-read permission lasts for this process;
closing/restarting is the way to change that configuration. Capture readPolicy
is not a retained-read grant. No remote human authentication is claimed.
This new retained-profile host path initially supports Linux/WSL and Node>=22.16,
the same qualified local boundary as B4c. Unsupported paths refuse before
SQLite-dependent work; no native macOS/Windows qualification is claimed and
legacy MCP platform behavior is unchanged.

The real core opener needs an opt-in existing-only guard, not just a disposable
readonly preflight. Validate exact store ID/application/schema29 and required
layout on the actual opened connection before initialization/migration or
runtime attachment. Open through a correctly escaped file URI with mode=rw,
never CREATE, :memory:, arbitrary URI/query or directory creation. Preserve
ordinary openMemoryCore defaults. Compare canonical private file identity
before/after opening; close every failed connection. Writable access is needed
for explicitly requested Card drafts/confirmation, not for startup mutation.

Scope the layout guard to owner-selected stores created by the reviewed engine:
app/schema/store identity, existing identity-secret shapes, and bounded required
Raw/source/control metadata including the actual keyset index shape. Preserve
the existing default opener's validation; any new metadata-only extraction must
not silently remove its historical binding-anomaly scan. Close handles on every
construction failure, including failure after the database opener returns.
This packet does not add full SQL-definition hashes, a second schema manifest,
historical-data integrity scans or authentication of hostile same-owner DDL.
Do not claim it detects arbitrary extra triggers, same-owner rollback, or a
database replacement-and-restoration that escapes filesystem identity checks.
Freeze the precise required objects/columns and failure tests with the author
before implementation. The hard guarantee here is no creation/migration of an
unavailable or incompatible store, not certification of all stored history.

Primary separately qualified node:sqlite mode=rw on Node22.16/24.15: existing
files (including URI-special Unicode names) open, missing/delete-gap files do
not appear, WAL writes survive a new connection and process. This native probe
is not proof the proposed core integration is already correct. Retain the
existing-only tests at the actual core seam, including missing schema/identity,
wrong schema/store, replacement, busy store and zero creation/migration.

Use Raw mode off, configureCap false, and a strict local-plain-v1 decoder with
no sealing capability. Public Raw constructor currently requires both port
slots, so sealRaw must refuse; do not broaden its input contract just for this
adapter. Decoder checks format/keyVersion and valid UTF-8; core checks exact
length/digest. No unencrypted fallback for encrypted/unknown formats.

## Discovery and source APIs

Discovery is required: a test cannot query SQL privately to supply the ID that
an actual MCP user has no way to obtain. Keep additive listRawConversations in
the Raw SDK family, usable without privateCards, like getConversation. Do not
invent a second Card-only Raw directory or pretend capture readPolicy secures
SDK reads; the SDK is a trusted-host API and the MCP fixes its namespace.

Proposed input: `{namespace,client,limit?,cursor?}`; exact client is claude-code
or codex; default20/max50. Use the existing unique namespace/client/session_key
index with keyset pagination, order by session_key and LIMIT limit+1. At most51
metadata rows, no joins, source decode, aggregates, total-count scan, OFFSET,
chronological sort or new schema/index. Return id/client/revision and received
times, not raw session IDs, paths, inferred titles, excerpts or message counts.
Metadata presence does not imply Raw saved/completed coverage.

Opaque signed cursor binds purpose/version, store, normalized namespace,
client, page limit, last key and durable namespace epoch. Opaque is not encrypted.
Strict input, canonical cursor, foreign binding invalid_cursor; changed epoch
cursor_stale. Capture/delete ABA must invalidate continuation. No invented
retained-access generation in a core API that has no such authority. Bounded
whole success response <=65536 bytes; cursor <=8192. Empty pages explicit.

Retained mode keeps the existing22 local private-Card tools, including explicit
remember/correct/forget, and adds only list/read Raw plus source resolution.
It is not a read-only database or a provider-enabled MCP. Revoke its Card read/
draft grants when the server closes, including an async source read in flight.
No capture/local-control/Raw-delete tool is added.

Expose exact-namespace MCP list/read wrappers. The getConversation result gives
actual message IDs, totalUnits and conversation revision; it preserves paged
parts, partial/skipped coverage and existing publication fences. No tool can
supply another namespace or a permission flag.
The existing conversation reader still computes per-conversation aggregates;
bounded response/decoded pages are not a proven constant-time read for huge
histories. The new indexed metadata list must not add that scan. Do not claim
this packet establishes large-history latency or alter the old reader silently.

Expose resolveSourceReferences as a bounded Card read operation using the
existing 1..16 anchors and budgets. Anchor = existing rawAnchor fields plus
expectedConversationRevision, not a new wholeRaw flag. Expand the source union
for getSource with exact Raw references, inject only the bound namespace, and
preserve asynchronous grant-generation and source publication checks.

Allow authored Card draft input from exactly one of existing memoryRefs or
1..16 resolved Raw source refs; keep existing memoryRefs behavior. Reject
mixed alternatives, invented/foreign/stale refs and user-grant fields. Reuse
core createCardDraft; no implicit Memory, authoredInput permission bypass,
automatic consolidation, new retained copy or model call.

MCP confirmation continues to refuse approval_required. Terminal review must
open the same Raw-enabled existing store, display the exact untrusted Card,
bindings and applicability, use the real controlling TTY and exact phrase,
re-read after the prompt, then perform the existing revision/source CAS.
No piped/environment/--yes/MCP approval. Preserve terminal escaping, byte bound,
closure and signal/child teardown. Do not claim confirmation proves truth.

## Acceptance to freeze before implementation

1. Existing-only core: actual Node22/24 open succeeds only on the intended
   existing schema29/store/layout; all rejection paths leave DB/schema/identity
   unchanged and no created leaf/parent. Test preflight/open deletion and
   replacement, unsafe private paths, URI-special names, WAL/busy and close.
2. Metadata: both clients/scopes, empty and multi-page traversal, indexed plan
   and <=51 returned SQL rows, no duplicates, no decode/provider/mutations;
   malformed/foreign/limit-changed cursors, cold reopen and capture/delete ABA.
3. Host: default server/tool roster unchanged; explicit private profile enables
   only intended namespace/tools, invalid/mixed config refuses before DB/model
   access, current capture-off does not erase retained-read permission.
4. Source: inspect actual listed conversation and derive anchors through public
   responses; exact Unicode reconstructed, incomplete/skipped state honest;
   stale/foreign/excluded anchors refuse; read/draft do not reseal or charge.
5. Cards: bare Raw -> authored draft with zero Memory and zero provider work;
   existing Memory-ref drafts unchanged; MCP never confirms, real TTY does;
   source invalidation/revision change during review prevents confirmation.
6. Installed: actual private archive + real stdio + fresh processes use the
   source discovery flow without SQL-derived IDs. Independently compare import
   closure and archive inventories. Cold reopen verifies same source/identity;
   success, assertion failure and cancellation reap processes/owned scratch.
7. Final affected gates on both supported runtimes, primary independent
   acceptance, fixed-commit nonauthor Standards/Spec and latest-head CI. Only
   then PR ready/unmerged; product gets exact revision, no automatic pin update.

Primary owns contract/integration and separate acceptance. One bounded
GPT6.1Sol/high author first proposes the exact API/tool names, core guard DTO,
file roster and affected callsites/tests. Author may not change this plan,
commit/push/merge or expand scope silently. Keep implementation stages finite:
core open/discovery first, then MCP/TTY, then one combined installed proof.
Use targeted red/green checks before the final matrix; unrelated full sweeps do
not substitute for the required user flow. Token/cost data unavailable; no paid
API evidence is planned here.

## Still separate

B4 control rearm, strict qualified duplicate-source admission, combined
correction/forget/delete lifecycle acceptance, schema29 overview compatibility,
actual automatic client selectors/setup, product joint acceptance and semantic
benchmark improvements remain separately tracked. Do not mark them complete
because this retained-read/Card bridge passes.

## Core milestone freeze

Actual author:/root/retained_raw_bridge_impl61, gpt-6.1-sol/high, no fallback.
Primary owns this plan and separate acceptance; author owns runtime/tests and
later user-facing implementation documentation. Author has not seen primary
acceptance code. No author commits, pushes, PRs, merges or plan edits.

Freeze core option `existingStore:{version:'schema29-existing-v1',storeId}`.
Closed own-data options reject proxies/accessors/symbols/inherited/unknown fields
before opening SQLite, both with and without rawConversations. Absolute existing
filesystem path only; no :memory: or caller-provided URI. Preserve default opens.
Actual open uses own canonical URI mode=rw and checks file/parent ownership,
permissions, identities, application/schema/store before any attachment.

Freeze synchronous SDK `listRawConversations({namespace,client,limit?,cursor?})`.
Success value has conversations:[{id,client,revision,firstReceivedAt,lastReceivedAt}],
nextCursor,complete,budget_exhausted,evidenceTrust. Cursor purpose/version and
binding follow the contract above; no privateCards dependency or host grant
argument. Preserve empty metadata versus actual saved-coverage distinctions.
If the byte guard trims a page, continue after the last returned row; an
individually oversized item fails instead of returning an empty nonprogress page.

Required schema guard: exact application0x43414952/schema29/store ID; expected
singleton identity fields and64-lowercase-hex cursor/episode secrets. Preserve
the existing schema29 object-presence set: Raw journal/capture/fence, lineage/
exclusion, deletion/effects, Raw/Card support, local controls and private Card
tables, plus identity/epochs. Check bounded column/type/key metadata on
store_metadata,episode_identity,namespace_epochs,raw_conversations,raw_messages,
raw_parts,raw_source_exclusions,card_raw_bindings,card_raw_mutation_context,
card_raw_pending_invalidations,local_capture_controls,raw_capture_events.
Use the existing actual definitions, including full Raw message/part layouts;
verify STRICT status and required nullability/keys. Require the existing Raw
conversation unique nonpartial binary-ascending namespace/client/session_key
index by structure, not its generated name, plus raw_source_part_start and
card_raw_dependents shapes. Require the existing card_raw_purge,
card_memory_revision_invalidation and local_capture_binding_insert/update
triggers by presence. This is bounded compatible-layout checking, not exact
DDL/hash certification or a historical data-integrity guarantee.

Extract metadata-only local-authority validation if needed while preserving the
ordinary validator's existing data scan. Wrap ownership across actual runtime
and facade construction so a later initialization failure closes exactly once;
do not mask the original failure with a second-close exception.

Core author roster (only these until primary accepts milestone):
core/contract.mjs,core/runtime.mjs,core/database.mjs,
core/local-authority-schema.mjs,core/raw-composition.mjs,core/raw-journal.mjs;
new core/existing-store.mjs,core/raw-conversation-list.mjs,
core/test/existing-store.test.mjs,core/test/raw-conversation-list.test.mjs;
core/test/raw-public.test.mjs only if a demonstrated compatibility assertion
needs updating. No package/CI/docs/packaging/adapter/setup edits in this phase.

First checkpoint: exact guard DTO/module seams plus tests for no-create,
no-migrate, identity/scope/cursor correctness and actual indexed row bound.
Run focused tests through tools/testing/run.mjs on Node22.16/24.15; register
owned cleanup before resource acquisition, and record actual exits including
red failures. No dependency install or links are needed without a demonstrated
import requirement; report any such need before touching dependency locations.
Stop after core milestone for primary inspection, not for user approval. Later
MCP/TTY/installed stages retain the proposed interface names from preflight and
require their own frozen acceptance before authoring.

## Primary independent core acceptance freeze

Before reading the author's new core tests, primary independently authored11
cases in /tmp/cairn-raw-retained-evidence.SDfDOf/primary-core.test.mjs,
SHA256366883040ce6e1d56cfd27fbaf5cda223c5c8e19846abf3a274573177baae048.
Syntax check on Node22.16 exits0; no behavioral result is claimed yet.
The cases use the public Raw capture API to seed new owned synthetic stores,
not real data or copied author fixtures. Test-only SQL observes persisted state
and actual query plans; it does not manufacture the discovery IDs handed to a
read operation.

R01 default/guarded open compatibility and no startup mutation; R02 closed
options/accessors/proxies before creation; R03 missing/unsafe/URI paths without
repair; R04 incompatible app/schema/store/layout without initialization;
R05 opening while another writer holds BEGIN IMMEDIATE, with actual SQL tracing;
R06 post-opener construction failure closes exactly once; R07 scoped52-item
pagination with at most51 SQL rows and actual indexed plan; R08 cold cursor,
scope/client/limit/store binding and tamper refusal; R09 capture/delete ABA makes
the prior continuation stale; R10 actual discovered Raw reconstructs exact
Unicode without fabricated Memory/Card; R11 URI-special filename and WAL source
through a fresh Node process. No semantic reliability or native client claim.

Primary runs these only after the core milestone is frozen. Any fixture fault
must retain its original test/log, explain the correction, and rerun the same
case set; a passing retry alone is not a diagnosis.

## Core milestone acceptance, 2026-10-21

Author changed exactly10 core paths; raw-public.test.mjs remained untouched.
Affected14-suite regressions pass224/224 on each Node22.16.0/24.15.0, actual0.
The only later addition was an explicit-cap compatibility test: final two new
suites pass21/21 on both runtimes, actual0. Initial6/10 existing-store run was
actual1 from four fixture setup errors (receipt/check/FK setup), corrected in
fixtures rather than runtime; retain that red tool receipt. No dependency edits.

Primary independently cross-checked Git diff/untracked inventory with complete
base/current blob-and-mode reconstruction:10 author paths plus this plan=11.
Frozen source1820 SHA256
b06ebac30dea4bf4290197c2e6812d1a73d3a7b89ac0191785f5c8d7cd94da6c.
Primary R01–R11 all pass on BOTH runtimes, actual0/null, with no skip or retry.
Actual outer session19801 exits0, both children reaped and owned workspace
removed; source hashes/modes unchanged. Evidence:
primary-core-milestone-{freeze,report}.json and per-runtime logs in the directory
above. Main read all10 actual changed/new core paths and their tests before
accepting this milestone for adapter integration, not public delivery.

The existingStore guard prevents creation/schema migration; it does not make a
trusted SDK read-only. An explicit SDK raw capBytes/configureCap:true still uses
the existing cap configuration behavior. Retained MCP must force mode:off and
configureCap:false, supply no capBytes, and leave quota/consent unchanged.

B4c dependency728fbf4767fb8d7d8131c46239cabb4a7619f412 passed independent dual
review and primary committed acceptance; draftPR463 is awaiting latest-head CI.
Integrate that exact accepted commit before adapter/installed freeze and record
the new base. No source mutation is authorized while the author prepares the
bounded read-only MCP/TTY integration proposal.
