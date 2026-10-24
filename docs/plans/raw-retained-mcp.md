# Next packet: discover retained Raw and author a Card through installed MCP

Status: core, MCP/TTY, installed acceptance and both-runtime combined gates passed,
2026-10-21. Final committed acceptance, independent review and PR delivery follow;
this is not full Raw V1 acceptance or public release.
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

## B4c integration and bounded MCP/TTY freeze

B4c PR463 now has31 successful checks and four successful exact-head workflows;
the GitHub merge preview has the exact candidate tree. No merge performed.
Primary locally rebased the clean core-only milestone e8a2405847971de00cc22b4b07638ea1799a8b1f
onto accepted728fbf4767fb8d7d8131c46239cabb4a7619f412. Resulting core commit:
43afb3cfccc8f6f24ba36f9af096d5f44458c354. The next fixed incremental delivery base
is728fbf; the worktree retains the single core milestone43afb3 above that base.
Before adapter edits, primary reran all11 core cases on this combined tree on
both runtimes: actual0/null, no skip or retry, owned workspace removed. Outer
session62146 was reaped with actual0. Independent inventories still agree11
changed paths;1833 frozen sources SHA256
1d3963e8359466fe585d5815de2f328be6a867de0b25ca873e02a34ae6b336ef.
Evidence:primary-b4c-integrated-core-{freeze,report}.json and per-runtime logs.

Same author/model/effort, now authorized only these10 adapter paths:
adapters/mcp/cli.mjs,adapters/mcp/server.mjs,
adapters/mcp/private-card-access.mjs,adapters/mcp/review-card.mjs;
new adapters/mcp/retained-raw-profile.mjs,adapters/mcp/retained-raw.mjs,
adapters/mcp/test/retained-raw-profile.test.mjs,
adapters/mcp/test/retained-raw.test.mjs,
adapters/mcp/test/retained-raw-review.test.mjs,
adapters/mcp/test/retained-raw-support.mjs.
Reuse existing card-review-pty.py unchanged. No core, docs, package/manifest,
CI, setup or packaging changes in this milestone. No commits/pushes/PRs by author.

One local MCP node_modules symlink may target the existing reviewed install at
/home/chichieh/Github/cairn-memory-worktrees/raw-local-v1-sources/adapters/mcp/node_modules.
First prove the new link location absent and target realpath/package identities
match the14 MCP entries in the earlier dependency freeze. No install, deletion,
shared-target mutation or OpenAI/root dependency link. Primary freezes these
identities before running adapter acceptance.

Freeze the proposed profile and CLI names above. Runtime refusal must precede
SQLite-dependent imports. Profile module has no SDK/SQLite/provider imports;
read at most65537 bytes through owned O_NOFOLLOW, reject above65536, strict UTF-8
JSON, closed fields, UID/mode and descriptor/path/parent identity checks.
Retained --check-config is syntax/runtime only: no profile/DB/key inspection,
provider, automatic capture or mutation. It works with a nonexistent profile.

Freeze async createRetainedRawServer({profilePath}) and reviewRetainedRawCard(args).
CLI prepares one immutable profile snapshot per process and gives serveStdio a
synchronous factory rechecking that snapshot. The actual SDK can create/discard
a negotiation probe; it must not rebind store or namespace by rereading a changed
profile on its second factory call. Test the actual fallback, not only a mocked
factory. Legacy createCairnServer remains synchronous and keeps its option list.
Both paths share an internal registration builder; no caller core/authority
override. New startup codes:invalid_mcp_configuration,
retained_raw_runtime_unavailable,invalid_retained_raw_profile,
retained_raw_profile_changed. Existing core/tool errors remain intact.

Fixed Raw decoder: local-plain-v1, null keyVersion, fatal UTF-8 with ignoreBOM:true
to preserve a legitimate leading BOM. sealRaw refuses. Core verifies source
length/digest. mode:off/configureCap:false/no capBytes/provider; capture permission
remains separate. Server cleanup irreversibly revokes Card/source grants before
its first await and before closing core, including construction/transport close.
In-flight async reads must encounter the existing scope_changed publication fence.

Freeze exact extra tools: list_raw_conversations,read_raw_conversation,
resolve_source_references. Existing default5/private22 remain unchanged;
retained mode has exactly25. All inputs strict; namespace only from profile.
List uses client(enum),limit?,cursor?; read uses conversationId,limit?,cursor?.
Resolve uses1..16 {rawAnchor:{conversationId,messageId,start,end,precision},
expectedConversationRevision}; precision exact/whole-message, safe integers and
end>start. Optional positive budgets:sourceByteLimit<=64000,scanRowLimit<=1024,
deadlineMs<=5000,responseByteLimit<=65536; retain existing defaults.

Only retained mode adds Raw source DTO {type:'raw',conversationId,messageId,
span:{start,end,precision},contentIdentity:43-base64url}; namespace is injected.
read_private_card_source allows budgets only for Raw. Authored drafts have exact
XOR memoryRefs(existing1..6) or sources(Raw1..16), with actionId/title/body.
Reject mixed references/grants/foreign/stale/invented sources; no authoredInput
bypass, automatic Card, implied Memory, source copying or capture tool.
MCP confirmation remains approval_required. Shared synchronous terminal body
preserves controlling TTY, escaped/bounded display, exact phrase/applicability,
post-prompt profile/source reinspection, revision CAS and resource closure.

Author's focused matrix covers profile/runtime rejection, actual negotiation,
rosters/schemas, public discovery, partial/skipped coverage, exact Unicode/BOM,
malformed/encrypted source, revoked async read, no quota/provider work, real TTY
confirm/refuse/stale/cancel cleanup. Add affected existing configuration, stdio,
Card, receipt, evidence, organization and PTY-framing tests on both Node versions.
Retain all red results with diagnosis. Stop at this bounded checkpoint for main
inspection and independent acceptance, not a user decision. Installed packaging
and the final affected matrix/dual review follow as separate bounded stages.

## Primary independent MCP acceptance freeze

Before adapter implementation or reading its new tests, primary authored8 real
stdio/TTY acceptance cases in the same evidence directory, primary-mcp.test.mjs,
SHA256 b8968d4a5a64a56082a540b0b0b851bbd2dd695f2b4d04aa404fed00c08b1d99.
Syntax check exits0. They have not yet run against an implemented adapter.

M01 syntax-only check with missing profile and throwing credential accessor;
M02 malformed/mixed/private profile refusal without DB creation; M03 real
default5/private22/retained25 roster and both-client exact scoped Unicode reads;
M04 public discovery -> Raw draft -> MCP refusal -> real controlling TTY exact
confirmation -> fresh MCP sees same Card/source without manufactured Memory;
M05 delete source while actual TTY waits prevents confirmation and purges draft;
M06 mixed/forged/foreign/stale sources cannot create Card/authority; M07 prior
Memory-receipt draft behavior remains; M08 invalid UTF-8/encrypted source does
not produce a fallback. Public APIs derive all IDs; only synthetic stores,
network-forbidden subprocesses and owned cleanup. Main retains any fixture
failure and its correction separately rather than weakening expected behavior.

## Primary installed acceptance freeze

Before authoring packaging integration, primary separately authored3 cases in
primary-installed.test.mjs in the evidence directory, SHA256
d08231f0c4d75517e3ceccfae8299047ded3f57bd23c63144c0b01d0abfadeea.
Syntax check exits0; no behavioral installed result yet. Build the actual private
npm archive, install pinned production dependencies offline with scripts disabled,
and run the installed binary/engine in fresh processes, not a source alias.
I01 compares package manifest, actual tar inventory and installed file walk,
checks installed source hashes and literal relative-import references, and runs
syntax-only retained configuration without opening a missing profile/DB.
I02 public discovery -> bare Raw draft -> MCP approval refusal -> real TTY exact
confirmation -> cold MCP same source/Card, then confirmed-source deletion retains
authored body but invalidates support. I03 deleting source during actual review
prevents confirmation and purges the pending draft. Both success/refusal paths
own cleanup. No SQL-derived IDs, real data, network/provider or paid calls.

Primary runner serializes supported runtimes, stops after first failed gate,
records actual close/exit and test totals, freezes source plus14 MCP dependency
realpaths/package hashes, and checks all owned scratch is removed. Actual core,
MCP and installed receipts are separate: a syntax pass is not behavioral evidence.

Packaging preflight independently compares literal relative imports from the167
listed runtime modules (428 edges) with base/current added runtime files: both
identify exactly4 required additions, existing-store.mjs,
raw-conversation-list.mjs,retained-raw-profile.mjs and retained-raw.mjs under their
respective core/adapters/mcp directories. Receipt:primary-package-preflight.json.
Primary also refreshed only the existing parent plan's checkpoint paragraph;
historical evidence and its four workstreams remain unchanged. No other plan
or product tracker is created, and no packaging author writes are authorized
before the bounded adapter acceptance checkpoint.

## Bounded adapter receipt and primary M02 diagnosis

Author completed exactly the frozen10 adapter paths, with no core edits or
commits. Main read all6 runtime paths and4 test/support paths, and independently
checked the file hashes in
/tmp/cairn-retained-adapter-evidence.Q171yd/author-adapter-freeze.json:
aggregate205afefea5db5372b5be691cf5b4a331c53762682b1c5bf828bc6b06fb14af75.
Focused3 new suites17/17 and affected7 existing suites50/50 pass on both
Node22.16 and24.15, all actual0/null and owned workspaceRemoved:true. Main
personally inspected the4 JSON receipts and corresponding log counts/cleanup.
Retain author's first missing-SDK-export fixture failure and later two fixture
failures (BOM in close-race fixture and missing expectedRevision); their corrected
tests do not change runtime behavior or remove the separate BOM test.

Primary original8-case run adapter-v1 stopped with actual1 on Node22.16:7/8
passed, M02 expected exit1 but got0. Node24 was not run. Outer session88271
was reaped with actual1; owned workspace was removed. Preserve original test
SHA b8968d4a5a64a56082a540b0b0b851bbd2dd695f2b4d04aa404fed00c08b1d99,
primary-adapter-v1-{freeze,report}.json and its Node22 log without rewriting.
The source/dependency freeze remained unchanged. Narrow M02 invocation reproduced
the same red in0.5s. No broad bisection was warranted for this deterministic case.

Following diagnosing-bugs, primary disclosed three falsifiable alternatives:
no request reached the lazy SDK factory; wrong-store binding really bypassed
the guard; or an actual refusal used a different process/protocol error channel.
The independent diagnostic used one synthetic store, unchanged runtime and the
same wrong-store profile. EOF produced exit0, direct construction rejected with
unsupported_database, and actual SDK negotiation rejected with JSON-RPC-32603
Internal server error. The SDK only invokes its factory after negotiation input;
ordinary EOF never opened the core. A correct-store constructor succeeded.
Therefore the original M02 was testing the wrong seam, not finding a store-ID
bypass. The diagnostic's own first run lacked Raw opt-in, and its second expected
stderr instead of the protocol error; both actual1 results are retained in tool
receipts/comments. Final diagnostic actual0. No product change was made.

Preserve the original8-case source. Primary v2 changes only M02 to send a real
SDK negotiation for wrong-store identity and assert exact protocol rejection,
not an arbitrary EOF exit status. All profile-shape, permissions, no-create and
mixed-flag checks remain. No timeout qualifies as the expected refusal. The
single M02 v2 regression passes with actual0. New full8-case frozen file:
primary-mcp-v2.test.mjs, SHA256
5c40db17bab711c628423bce1df2691e069580c7983e41cba6bc3bada16c1446.
Full two-runtime v2 acceptance is next; this paragraph is not its pass claim.

The subsequent primary-adapter-v2 run passed all8 cases on BOTH Node22.16 and
24.15, actual0/null, no skips. Outer session20044 reaped with actual0 and owned
workspace removed. Main personally parsed both exit records and log totals and
checked workspace absence. Source1839 files/hash and14 dependency identities
are identical to the original red run:
a16267b653ff312e4301121761f9c89aab55e81ea2522678c7b375242fc1ab93,
dependency8e373ed11fa4f1754fa38e8f9e01b541a39f5ee59f98fc2808cb3d1dca63e595.
Independent diff/untracked and full blob/mode inventories agree22 changed paths.
The scoped runtime is accepted for installed integration; no merge/public release.

## Bounded packaging/docs assignment

Continue with the same nonreviewer author, actual GPT6.1Sol/high, same worktree,
base728fbf and core HEAD43afb3. Preserve the accepted10 adapter files and all
core files unchanged. Primary owns this plan and the parent checkpoint.
The author may change only these10 paths:

- packaging/artifact-files.json
- packaging/test/retained-raw-mcp.test.mjs (new)
- packaging/test/fixtures/retained-raw-mcp.mjs (new, only if the test needs it)
- docs/raw-local-journal.md
- docs/standalone-mcp.md
- docs/private-card-terminal-review.md
- docs/private-cards-local.md
- docs/limitations.md
- packaging/README.md
- CHANGELOG.md

Add exactly the4 missing runtime modules identified by the independent preflight;
do not replace or reorder the existing manifest. Do not change package versions,
dependencies, build/install scripts, CI, setup, flags/pins or product files.
No new dependency link/install is authorized for this finite packet; the accepted
MCP link and existing offline artifact cache suffice unless an actual prerequisite
failure proves otherwise. Never stage the local dependency symlink.

Installed tests must build/inspect the actual private archive, offline install
with scripts disabled into an owned project, then use its installed engine and
binary. Derive source IDs through public APIs, never SQL inventions. Cover strict
profile/mixed/wrong-store refusal through actual negotiation, default5/private22/
retained25 rosters, public Raw discovery/Unicode without Memory, authored draft,
MCP approval refusal, actual controlling-PTY approval and cold source/Card
reopen, plus source deletion during approval and unsupported confirmed Card
after deletion. Report actual child/outer exit codes and clean owned scratch.
No key, model/network fallback, real transcripts or client activation.

Docs must distinguish the keyless retained-profile path from ordinary/provider
MCP and from B4c capture. Include the exact closed profile, private Linux/WSL
runtime/path requirements, already-existing schema29/store requirement and how
to obtain storeId from trusted existing host/SDK inspection (do not guess it).
Show list -> read -> resolve -> draft -> separate terminal review -> cold inspect,
with public returned IDs and explicit user-authored Card text. A long message
does not automatically become a Card; no fake Memory prerequisite. Explain
syntax-only check versus actual MCP negotiation readiness; empty stdin is not a
store-validation probe. Preserve default receipts-only behavior outside the new
opt-in. Clearly describe partial/skipped coverage, local-plain-only decoding,
no provider/automatic capture/permission changes, no constant-time conversation
read claim, logical deletion and lack of semantic/real-client qualification.
This is an installable synthetic-tested preview, not a newly published package.

Run the new installed suite and existing packaging private-card-mcp,
raw-conversations and local-host suites on both supported runtimes. Freeze exact
source hashes/modes and actual commands; retain every red with its cause. Stop
at the bounded author checkpoint for primary independent installed3, direct diff
inspection and the final combined affected matrix. Do not commit/push/open PR.

## Packaging and independent installed acceptance

The author froze exactly the assigned10 packaging/docs paths. Main read the
final docs and installed fixture/test, verified every file hash/mode against
/tmp/cairn-retained-package-evidence.JpymDi/author-package-freeze.json and checked
both durable logs/exit records and the absence of their owned workspaces.
The four-suite packet passed13/13 on Node22.16 and24.15, actual0/null. Preserve
the initial Node22 actual1,12/13 result: strict-profile negotiation correctly
closed but its test expected numeric JSON-RPC error instead of SDK-local
CONNECTION_CLOSED. Only that fixture predicate changed, not runtime behavior.
Nested budgets now have finite valid-input/top-level-lookalike refusal checks;
the fixture also asserts nested Raw interpretation success rather than only
outer source retention. Accepted core/adapter hashes remain unchanged.

Main's prior advice that budgets were top-level was mistaken. Direct rereading
of the accepted server schema confirmed the existing nested budgets object.
The author corrected docs to match it; no API change was made to accommodate
that advice. The retained source/code and independently authored tests, not a
recollection of them, remain authoritative.

Primary independently froze the combined32-path delta using git diff/untracked
and a complete base/current blob-and-mode comparison: both inventories match.
Source1841 files SHA256
d4fbe39d23c54806a81e8a3489474405520f6fe32efcb786793676d3c9a9fa20,
plus the same14 MCP dependency identities. The original independently authored
installed3 test file was not modified. Both supported runtimes passed3/3,
actual0/null, no skips, outer session88741 reaped actual0, and owned workspace
removed. Main parsed each log's counts, report codes and actual cleanup.
Evidence:primary-installed-v1-{freeze,report}.json and two runtime logs.
Actual archive, manifest and installed inventory agree177 files; all installed
source hashes and444 literal relative-import edges resolve, including exactly
the4 new runtime modules. This establishes only the bounded installed subset,
not complete correction/forget V1, actual client activation or semantic quality.

## Final combined gate preparation

Before freezing the complete candidate, primary will add only the missing
OpenAI tokenizer and native-validator local dependency links to the same
already verified raw-local-v1-sources shared installs. Verify absent destinations,
all18 dependency realpaths/package hashes and native validator version before
use. No install, shared dependency mutation, package/version/lockfile change or
dependency-link staging is authorized. The accepted MCP link stays unchanged.

Primary owns an immutable48-command manifest:24 gates on each of Node22.16 and
24.15. Mechanically enumerate test paths using directory listing and independent
rg inventory, and freeze all source/dependency identities before execution.
Run core, MCP, artifact, generic, JSON validation, local adapter/transport,
worker, host, host import, workspace lifecycle, all12 core demos and both native
plugin validators. Core/artifact/generic concurrency4, MCP/local/transport/worker
and workspace concurrency2, host concurrency1. The sole expected skip is the
existing artifact native-Windows platform case; no other skip becomes a pass.
Use isolated home/temp and no forwarded provider credentials. Stop on the first
red, preserve actual exit/signal and logs, check all scratch ownership/cleanup,
and verify frozen source/dependencies before and after every gate. Heartbeats,
20-minute per-gate/90-minute whole deadlines and actual progress inspection
support foreground supervision; a PID or unchanged counter alone is not health.

After these gates, retain focused primary core11/MCP8/installed3 evidence on
the exact delivery candidate, commit only mechanically checked intended files,
and request independent nonauthor Standards and Spec reviews against fixed
base728fbf. Main owns integration and acceptance; no merge, release or activation.

Preparation completed: all18 inherited dependency realpaths/package hashes match;
both additional destinations were absent and now point only to the verified
shared installs. Native validator is2.1.260. No package installation or shared
dependency edit occurred. Final-v1 freeze again independently agrees on32
changed paths and1841 source files, SHA256
f036014de172f3bf671a0607606914daa41c2d99b962cdf51b1f791981791f9e.
The external48-command manifest and its runner/validator hashes were written
before execution. Source hashes exclude only this evolving evidence plan and
the three local dependency symlinks; the parent plan is frozen normally.

The explicitly required public-registry metadata preparation also completed
through the owned runner: env -i with Node22.16 and no forwarded credentials,
node tools/testing/run.mjs --script packaging/prepare-cache.mjs, outer
session66284 reaped actual0. It made package metadata requests only, no model
calls. The final48 matrix was then supervised in session57753.

The final-v1 matrix subsequently completed all48 gates with actual0/null,
outer session57753 reaped actual0. Main separately parsed all48 logs, compared
their counts with the report, checked every owned scratch roster, and verified
sourceUnchanged:true and actual removal of the owned workspace. Both runtimes:
core1752/1752; MCP151/151; artifact115 passed and1 native-Windows-only skip;
generic635/635; local30/30; transport34/34; worker59/59; host41/41;
workspace-lifecycle25/25. JSON validation, host import, all12 demos and both
native plugin validators also exited0. This is mechanical/synthetic evidence,
not a semantic score, real-client activation or completed V1.

Only a retained-failure explanation in docs/limitations.md and the two existing
plan/checkpoint files may change after this full-matrix freeze. No runtime,
test, manifest, dependency or CI change is authorized for that finalization.
Primary will independently compare the final source against the frozen matrix,
confirm precisely that documentation-only delta, and rerun JSON validation and
the original independent core11/MCP8/installed3 on both runtimes at the committed
candidate. Both nonauthor review axes inspect the complete32-path incremental
diff against728fbf, including those final documents. Their final-SHA reports,
latest-head CI and remote delivery receipt belong in the PR; prior test hashes
remain preserved rather than relabelled as runs against a later documentation SHA.
