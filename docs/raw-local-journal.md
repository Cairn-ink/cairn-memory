# Internal local Raw journal, capture, lineage, deletion and sources (P1/P2/P3a/P3b/P3c)

These are the internal local mechanisms in
[the V1 plan](plans/raw-local-v1-completion.md), not completed installed/hosted
Raw V1. They are default-off and authorized only for pure-local synthetic
development and tests. P2 joins the existing bounded capture engine; P3c adds
explicit Raw references and authored Cards through the same private engine.
No public Raw mutation, MCP tool, client hook, hosted encryption or production
enablement is added. Ordinary public capture keeps its existing wire contract.

## Internal producer foundation (P4a)

`integrations/client/raw/index.mjs` is an uninstalled, synthetic-only producer
foundation. It prepares an exact authorized JSONL record from an already-open
positional source handle. It does not enumerate transcripts, acquire permission,
publish a cursor, install a hook or add an HTTP route. Existing Claude/Codex
capture remains v1; installed transport and lifecycle work belongs to P4b.

The helper exports are:

- `scanRawRecordRanges({source,start,end}, {limits?,signal?})`: yield complete LF
  record byte ranges one at a time; an unfinished tail refuses.
- `prepareRawRecord(input, {identityKey,limits?,signal?})`: stream and validate
  the complete record, apply the layout's privacy/turn policy, redact the whole
  joined message, then return an excluded disposition or a private handle.
- `planRawBatch({message,projectId,position})`: produce one frozen v2 part/body,
  content-free pending manifest and proposed next position. Only a completed,
  matching acknowledgement permits the host to adopt that next position.
- `restoreRawBatch({message,projectId,pending})`: validate closed pending metadata
  against freshly prepared identities and reconstruct the same canonical body.
- `validateRawRequest(body)` and `classifyRawAcknowledgement(status,value,body)`:
  enforce closed transport and exact matching part dispositions. Processing,
  model quota and HTTP failure do not authorize advancement. A durable Raw skip
  is distinct from daily model quota. The internal core envelope needs an
  explicit host adapter and is not itself an acknowledgement.

The private handle exposes frozen bounded metadata, `readPart({start,maxUnits})`
and asynchronous idempotent `close()`; no path or full-text getter. Close it in
`finally`. Parts contain at most 4,000 UTF-16 units with code-point-safe bounds.
Trusted bindings/key material are copied before asynchronous work, and the
caller retains ownership of its source handle. Schemas describe structural
limits; code additionally checks Unicode/calendar validity, UTF-16/serialized
byte budgets, increasing ordinals, canonical parts and frozen identities.

Source buffers default to 16,384 bytes, selectable from 1 through 65,536.
Scratch I/O uses separate fixed 16,384-byte buffers and decoded chunks of at
most 8,193 UTF-16 units, including a boundary surrogate pair. There is no
whole-record AST or selected-text accumulation. Nesting defaults to/maxes at 64,
retained metadata at 65,536 bytes. Actual simultaneous owned scratch defaults to
512 MiB, with an explicit maximum 1 GiB. Each preparation, read/plan/restore or
scanner next-record operation gets an active deadline, default 30 seconds/max 300.
Nested reads share their outer operation's allowance. Caller idle/ack time does
not expire a prepared handle; cancellation remains effective. An uncooperative
filesystem operation cannot be forcibly preempted.

### Internal producer threat model

Before redaction, candidate selected text can exist in transient private
UTF-16LE scratch while trailing metadata is being validated. This sensitive
plaintext is separate from retained redacted Raw. Invocation-owned directories/
files use 0700/0600 permissions and exclusive creation; at most the active input/
output stage files coexist. All eight legacy redaction patterns run in order;
unresolved candidates are file offsets. Source/content HMACs detect observed
changes, not an atomic filesystem snapshot or change-and-restore attacks.

Cleanup verifies path identities before unlinking. One-shot creation, I/O and
cancellation failures clean their owned resources. If ownership checks fail or
another inode replaces a path, the helper refuses instead of removing an
unverified replacement. This can retain scratch requiring operator inspection;
there is no historical sweep. Logical unlink is not guaranteed physical erasure,
and SIGKILL/host crashes cannot guarantee cleanup.

Claude machine/skill/control exclusions and qualified Codex layout checks are
selection boundaries, not authenticated speaker identity or semantic truth.
The trusted caller supplies loaded-plugin and previously authorized source/format
context. Transcript text, request booleans, pending HMACs and schemas grant no
retention, read, Card or publication authority. Notice, hosted encryption and
production activation gates remain separate.

## Internal boundary

`openDatabase(path, { rawConversations: true })` atomically upgrades a compatible
store to schema 24, including the compatible private-engine schema through 23.
Raw tables start empty; no transcript or legacy evidence is backfilled. Ordinary
new stores remain schema 18, or 23 with the existing private-engine option.
Current option-off openers preserve a genuine schema 24 store. Pre-Raw openers
reject it; stop old writers before any future migration. This packet migrates
only owned synthetic fixtures, never an operational database.

`createRawJournal({ db, mode, port, capBytes, readPolicy })` is an internal source
module and is not part of the installed runtime manifest. Canonical DB-only
schema/input/authority dependencies are packaged for ordinary selected-store
enforcement; the journal, async reader and usable factory stay uninstalled.
No installed Raw capability is advertised. The internal journal provides:

- `prepareRegistration(input)`: validate exact namespace and camel-case message
  parts, snapshot host policy/control/namespace/conversation state, then seal
  eligible parts outside a transaction. It returns an opaque token bound to that
  journal instance; caller changes cannot change the prepared input or AAD.
- `commitRegistration(token)`: synchronously recheck state and join an existing
  transaction. A savepoint rolls back that registration on failure. The caller's
  eventual rollback also removes all journal, ledger and usage effects.
- `register(input)`: prepare, then run that commit in its own transaction.
- `getConversation`, `getRawUsage`, internal CAS raw controls and pending-attempt
  closure. These are not attached to `openMemoryCore` or `openMemoryStore`.

The trusted `readPolicy` callback is synchronous and receives exact namespace and
client, returning `{generation,reason}`. A null reason permits prospective saving;
`tool_off`, `notice_required` and `raw_disabled` are content-free policy skips.
Existing durable namespace capture controls and session-deletion state are also
checked. The P2 factory below joins authoritative capture controls, admission
and episode registration. The standalone P1 journal remains model-free and does
not make an ordinary public opener perform this integration automatically.

## Internal P2 factory

`openRawCaptureCore(coreOptions, rawOptions)` in `core/raw-capture.mjs` is an
internal, synthetic-only construction seam. `coreOptions` uses unchanged strict
`openMemoryCore` options. `rawOptions` supplies the journal's explicit mode, port,
cap and trusted synchronous `readPolicy`. Public `openMemoryCore` does not accept
these fields or forward construction extensions. The usable factory and its
capture-storage module remain absent from the installed artifact manifest.
No capabilities, MCP tools, client producers or HTTP wire versions are added.

Without the separate lineage selection below, this construction opts into schema **25**. Genuine P1
schema 24 stores migrate transactionally; the new capture ownership and session
fence records start empty, with no inferred backfill. `rawConversations:true`
alone still creates schema 24. Option-off current openers preserve schema 25;
the actual frozen P1 opener refuses it. As before, stop/drain older writers
before any future operational migration; this packet migrates synthetic stores
only.

`captureRaw` takes the journal's camel-case message-part request, plus ordinary
`causal` or episode-mode `episodeContext` at the top level. It validates and
detaches identity, context, profile and bounded normalized first-part projection
before asynchronous sealing. The durable, content-free ownership mapping records
first-part and eligible-projection message IDs, projection/profile digests, the
HMAC session identity, namespace generation and staging disposition. It does not
store another transcript or implement a second admission engine.

The prepared registration joins the real `claimAdmission` transaction for
ordinary, staged and ordered capture, or `reserveEpisodeBatch` for episodes.
Raw, usage, immutable event/part identities and required admission/episode
observation either commit together or roll back together. Raw commits before
staging expiry can advance the namespace epoch; the ordered proof is acquired
after both. Episode registration precedes duplicate/processing branches and lazy
interpretation of another session. Provider and sealing/opening callbacks run
outside the write transaction.

Only initially fresh index-zero messages enter the existing model projection.
Continuations make no extractor, qualifier, classifier or episode calls and do
not create admission claims or advance episode debounce counts. A mixed batch
uses only its fresh first parts. Blank or otherwise ineligible canonical first
parts retain exact Raw and explicitly report `no-eligible-first-part`; a later
continuation cannot become substitute model input. Exact replay and new-event
overlap retain original ownership. A live original claim reports processing;
failed/expired interpretation remains explicitly incomplete without a retry.
Exact durable replay observes the existing claim after revalidating source
identity, profile and current namespace/session fences. It never renews a lease,
restages text, touches staging expiry or invokes a provider. Completed admission
stays completed even after its staging expires; failed/expired ownership stays
incomplete while the original Raw disposition remains available. Ordered replay
returns its recorded reconciliation. An intentionally absent interpretation does
not invent a pending job.
The admission/episode registration transaction repeats the durable-binding check,
so another process winning during sealing or before the claim turns the slower
identical request into an observation. A different-event stale registration still
refuses. This private short-circuit is never accepted from request/model fields.
If interpretation fails before accepting its own registration, finalization also
checks for an identical durable winner, including one committed during token
counting. This observation requires both the binding and its Raw receipt inside
one transaction, revalidates the same identity and authority fences, and never
registers or repairs source. Without a recorded winner, the original refusal
remains unchanged and preflight still writes nothing. An already accepted
attempt retains its own interpretation failure rather than hiding it as replay.
New Raw first parts that collide with an already covered legacy episode message
(including a mixed batch) refuse atomically instead of backfilling that source
without its own admission reservation. Frozen legacy batches keep their legacy
path; only fresh post-upgrade ranges are eligible for future client adoption.

The internal result separates source saving from interpretation:

```js
{ ok: true, value: {
  raw: { conversationId, revision, parts },
  interpretation: /* existing core success/error envelope */
} }
```

Registration failure returns the existing error envelope with no successful Raw
result. After successful registration, extraction/qualification failure, staging
release/expiry or capacity bypass leaves Raw intact. Internal staged capture may
bypass full staging and records `not-staged`; ordinary legacy capture still
refuses capacity. This internal split is **not the future public v2 wire
acknowledgement**. An interpretation error/incomplete/processing result is not
permission for a future client to advance its capture cursor as completed.

Through this internal factory, namespace pause/project-stop setters close affected pending Raw
assemblies in their control transaction, including when episodes are off. The
owner/client Raw-off setter closes only that owner/client's pending assemblies.
All preserve accepted parts and release unused reservations once. Resume/on
permits fresh messages but never backfills a closed suffix. Sealing rechecks
these controls and session fences before commit. Namespace generation and
session deletion are checked again inside admission publication, including
unstaged and ordered capture. Raw-off after registration permits Memory work to
finish. Episode prose publication is also fenced for the new path.

`fenceSession({namespace,client,sessionId})` is a narrow internal tombstone seam
for episode-off race/restart fixtures. Existing episode deletion tombstones also
fence registration and publication. This is not `deleteConversation`: full D5
source cascades and host withdrawal effects remain P3b; P3a's separately selected
D6 mechanics are described below. The factory must remain unavailable to real capture clients until those
protections and installed-client acceptance are complete. Arbitrary option-off
v25 writers do not yet join Raw reservation closure to their control changes;
that mutation-safety work remains P3. The durable admission guard already checks
namespace/session fences for existing Raw admissions, but does not establish all
option-off control or source mutations as complete.

## Internal P3a lineage and exclusions

The same uninstalled factory accepts the separate own boolean option
`rawOptions.lineage:true`, transactionally selecting additive schema **26**.
Omission/false does not upgrade P2's schema 25. Public constructor fields remain
unchanged. Current option-off writers preserve an existing 26 store and enforce
its exclusions, including a connection opened before another current connection
selects lineage. The frozen P2 opener refuses 26; this is not mixed-version writer
support or authorization to migrate user data.

Core prepares source maps before asynchronous sealing/model work and commits them
with the original first-part registration. Stored metadata contains keyed receipt
identities, conversation/message IDs and half-open UTF-16 spans, not source text
or a raw session ID. Whitespace-only normalization has validated exact offsets;
NFKC changes, redaction and ambiguous historical projection use whole-message
precision. The mapping follows the existing twice-normalized bounded projection,
including cuts exposed by normalization expansion. Repeated equal windows bind
all matching positions conservatively; substring search never guesses an offset.
The entire retained prefix/window is covered, not only a fact's selected wording.
Provenance also exists for policy-skipped Raw, without inventing a saved anchor.

Receipt insertion and dedup attachment share the same resolver across capture,
ordered/manual finish, explicit admission and episode keep. Keep uses each
source's origin episode client/session, not its new action identity. Existing
v25 evidence can resolve only from a unique exact scoped client/session/message
tuple; without a historical position map it covers the whole message. No source
content or precise historical positions are backfilled. Per-receipt origins
distinguish proven independent explicit evidence, derived sources and unknown
evidence. Missing legacy origin is unknown, not independent; explicit promotion
of a Memory or duplicate receipt cannot launder that uncertainty. Known Raw
identity remains derived even when supplied through an explicit API.

Forget/correction persist exclusions before removing receipts or invalidating
episode sources, in the same transaction. Failure rolls both changes back.
Exclusions retain only source identities/spans and a scoped fence generation;
Raw text and its usage remain unchanged. Extraction filters excluded provider
windows, preserving original message provenance after reindexing. Trusted
freshness checks run after token counting, in the actual invocation microtask
and after response; admission rechecks current anchors inside its transaction.
Any overlapping source refuses with `source_excluded`, even under a new event
ID or paraphrased assertion. Disjoint windows and genuinely unrelated explicit
receipts remain eligible; ordinary fingerprint suppression still applies.
Exact replay continues to observe its recorded outcome without model work.

P3a alone is **not completed P3 or Raw V1**. The separately selected P3b
packet below adds D5's live-source cascade, conversation deletion,
reservation/control closure and withdrawal effects. P3a/P3b alone do not include
the asynchronous Raw resolution and bare Raw-to-Card support described below
in the internal P3c section. No public Raw anchors,
installed Raw capability or re-extraction job is introduced here; RL-9 owns the
later explicit re-extraction workflow.

## Internal P3b source deletion

The uninstalled `openRawCaptureCore(coreOptions, { ...rawOptions, deletion: true })`
selects additive schema 27 and implies lineage. Only an own boolean option is
accepted; public constructor fields are unchanged. New ordinary stores remain
schema 18. Omission/false preserves earlier Raw selection behavior. A current
option-off connection, including one opened before this migration, honors the
persisted deletion rules once 27 is selected. This is not permission for old
binary writers: the frozen actual v26 opener refuses 27. No text or synthetic
receipt provenance is backfilled during migration.

The internal model-free methods use existing success/error envelopes:

- `previewDeleteConversation({ namespace, conversationId, expectedRevision })`
  returns `{ conversationId, revision, forgottenMemories, retainedMemories,
  removedReceipts, invalidatedEpisodes }` without writing.
- `deleteConversation({ namespace, conversationId, expectedRevision, actionId })`
  returns the same counts plus `{ actionId, effectCount }`. Its revision is the
  committed tombstone revision. Exact action replay returns the original result
  after restart, without new effects or usage changes; changed arguments refuse.
- `listRawEffects({ namespace, limit?, cursor? })` returns finite content-free
  `withdraw_pending` effects, coverage and a continuation cursor. Default limit
  is 20, maximum 50, with a 65,536-byte whole-envelope ceiling and a signed,
  scoped immutable high-watermark. It does not deliver or acknowledge effects.

Preview and delete share one transactional live-receipt plan. Current and
historical source-only Memory is forgotten through ordinary suppression. A
Memory with actual independent explicit or other-conversation support retains
its interpretation and currentness; only the deleted source's receipts are
removed, with normal revision/evidence/index/episode/Card invalidation. Neither
an explicit alias nor a keep action manufactures independent support. Unknown
legacy surviving receipt provenance refuses `raw_lineage_unavailable` before
mutation. Unlinked provenance is not assumed independent.

Pre-P3a keep receipts can contain the consumer's client/session, not the source's.
For these receipts the shared authority resolver follows the actual receipt ID,
episode Memory link and scoped keep action's recorded source IDs to the original
source episode before considering a consumer tuple. It never matches prose or
substitutes current passages for missing IDs. Missing or ambiguous keep proof
that cannot exclude the target refuses `raw_lineage_unavailable` across the exact
namespace, including other clients; known unrelated roots do not block. Such
legacy state needs repair, not inferred independence or Raw backfill.

Receipt/provenance changes advance only source roots reached from the affected
Memory. One DB-only before/after authority guard covers Raw registration,
episode reservation and trusted job binding that resolves an old duplicate
receipt, including registration whose extractor produces no new Memory.
Episode source additions, replacements and invalidation also advance reached
origin conversation/episode revisions, including zero-Memory consumers. The same
transaction preserves before/after authority for exact keep-linked receipts:
losing a keep proof invalidates other actual support roots on that Memory even
without receipt SQL changes. Unrelated conversation revisions are untouched.
This invalidates stale deletion CAS even without a Raw append. The immutable
`captureRaw` receipt retains its registration-time revision; refresh
`getConversation` before obtaining the preview/delete revision.

One transaction fences the source session, closes known pending consumers
(including cross-client keep origins), purges retained staging and obsolete job
bindings, mutates Memory, invalidates dependent episode prose, releases saved
and reserved bytes once, purges Raw rows/maps/exclusions, and records replay and
withdrawal metadata. Existing `forgetEpisode` delegates to this same cascade on
27, even for actual pre-Raw/empty episodes and option-off writers. It retains its
old DTO and compares the episode revision, not the conversation revision.
Confirmed authored Card bodies/host records remain retained while their current
receipt-backed evidence becomes unavailable and bound drafts are cancelled.

Real ordinary/staged/ordered/episode/keep transactions persist core-owned source
session bindings before provider dispatch. Tombstones refuse late legacy and Raw
interpretation/publication. Old pending work without provable source metadata
blocks deletion only in the exact target namespace/client when it retains payload
or publication authority, even when that payload has expired. Repair is required;
no text matching, guessed session or broad deletion is attempted. Terminal,
payload-free unbound jobs do not block. Pause/project-stop and client-off share
DB-only reservation closure; accepted parts remain, late suffixes never backfill,
and a fresh higher-ordinal message may save after resume/on.

This P3b slice implements only internal synthetic D5/D6 mechanics. Raw resolution
and bare Raw-to-Card are the separate internal P3c slice below; installed/client
Raw lifecycle and host effect consumption
remain P4. The factory must not be exposed before those packets and acceptance.

## Internal P3c source references and authored Cards

Only the uninstalled factory's own boolean `sources:true` selects schema 28,
implying deletion and lineage, with the existing trusted private-Card authority.
Public constructor fields, ordinary capabilities and synchronous note/receipt
methods remain unchanged. The actual frozen v27 opener refuses 28. Migration
adds metadata bindings and an indexed Raw part start lookup, not source backfill.
`core/testing/raw-v27-database.mjs` freezes the actual opener from
`50230c0390a0e035b8d15f0cdeb9c335f97e3ffb`: 22,229 bytes after removing its
header and undoing only relative-import relocation.

`resolveSourceReferences({namespace,anchors,budgets?},authority)` is asynchronous.
It resolves all 1–16 explicit `{rawAnchor,expectedConversationRevision}` entries
or returns an error without partial references. An anchor is the existing
`{conversationId,messageId,start,end,precision}` on original redacted UTF-16 text,
with code-point boundaries and contiguous saved coverage. Whole-message precision
requires the entire saved message, not a bounded receipt/prefix. No substring or
normalized-offset inference occurs. Success is `{sources,coverage}`; coverage is
`{status:'complete',included:<anchor count>,omitted:0,conversationCoverage:'unknown'}`.

A reference is exactly `{type:'raw',namespace,conversationId,messageId,
span:{start,end,precision},contentIdentity}`. Its opaque core-keyed identity binds
the store/scope, span, immutable source metadata, keyed content digests, sealed
fingerprints and format/key version. It excludes assembly state, conversation
revision and locator Memory filing. Unchanged saved prefixes survive completion
and unrelated append; re-encryption requires explicit re-resolution. Only verified
asynchronous decoding mints a reference. Later authored Card writes synchronously
recompute its bounded canonical manifest and D5/D6 authority, without a crypto
port or host callback under the write lock. No Memory, note, model call or stored
Raw text copy is manufactured for source-only Cards.

Raw-only `getSource({namespace,source,limit?,cursor?,budgets?},authority)` is async;
note/receipt variants remain synchronous and reject `budgets`. Limit defaults to
20/max 50. Parts are `{start,end,text}` with absolute original offsets, no extra
surrounding text and at most 4,000 units. Coverage is
`{status:'complete'|'budget_exhausted',completeness:'selected-raw-span',
conversationCoverage:'unknown',included:<part count>,omitted:0|null}`.
Source cursors bind the exact reference, normalized budgets, limit and trusted
access generation. A changed budget is `invalid_cursor`; a revoked generation
is `cursor_stale`. Unrelated append does not invalidate an unchanged reference.

The budgets allowlist is `sourceByteLimit,scanRowLimit,deadlineMs,responseByteLimit`:
defaults 16,000/128/1,000/65,536; maxima 64,000/1,024/5,000/65,536. Anchors share
one allowance, reusing cached covered intervals and unique enclosing parts.
Metadata and `length(sealed)` are checked before BLOB loading/opening; only the
two existing formats and their exact payload sizes are accepted. Port opening
occurs outside transactions, followed by host-generation and final canonical
rechecks without callbacks afterward. A deadline cannot preempt an uncooperative
port; its late output is discarded. Preparation errors are nonretryable
`source_budget_exceeded`, `source_timeout`, or `context_item_too_large` for an
indivisible response. Missing/foreign/deleted/skipped sources are unavailable.

Every Raw source page authenticates its **complete selected reference** within
the caller's byte/row budgets, charging each unique enclosing part once across
snapshot, recheck and opening. Paging bounds returned/opened plaintext, not
whole-reference authentication work: a reference larger than 16,000 bytes needs
an explicit larger budget even for `limit:1`. There is no cheap-pagination claim
or hidden fixed-64k bypass. Current Card writes retain the aggregate 64,000-byte
source ceiling, conservatively counting enclosing parts and deduplicating only
identical canonical parts, not equal text. At most 128 live draft/confirmed Cards
may depend on one conversation across all spans; cancellation/deletion frees room.

D5/D6 source mutations invalidate bound Cards in the same transaction, including
already-open option-off writers. Drafts purge body/bindings; confirmed authored
body and bounded typed metadata remain private while current evidence becomes
unavailable. Multiple affected spans do not multiply Card invalidation. Exact
create replay remains its original content-free receipt, not a resurrected draft.
The shared canonical checks also cover evidence, snapshots and typed Card MOCs.
Raw-only provenance uses `selected-raw-span`; mixed sources including Raw use
`mixed-sources`, with `corroboration:'not-assessed'`. Old note/receipt output and
note-only usage remain unchanged; `getRawUsage` remains separate.

An ordinary private-Card facade encountering required Raw bindings fails
`source_unavailable` for get/list/evidence/organization/source-consuming writes,
rather than returning an unsupported DTO or silently claiming complete results.
Cancellation, deletion and content-free action inspection remain available by ID.
This mixed-store browsing limitation is deliberate; no installed Raw reader is
advertised. Capture pause/raw-off do not revoke separately authorized retained
source reads, and missing read crypto never enables capture or a decoder fallback.

## Storage and reads

The same SQLite file holds conversations, immutable keyed event/part identities,
content-free message progress, dispositions, raw parts and owner usage. Session
identity uses the existing `s1:` episode HMAC; raw session IDs are not retained.
Parts preserve exact selected/redacted whitespace and Unicode. No normalization,
redaction or whole-message truncation is applied by the journal. Hosts must
redact the entire logical message before splitting it in the later client packet.

The first part reserves the entire declared UTF-8 message size. The owner counter
covers clients and personal/project namespaces in this store. Saving converts
reserved bytes to saved bytes; replay and reads charge nothing. Cap decreases
leave existing reservations intact, and skipped or closed messages cannot be
backfilled after a policy/cap change. Closing a pending attempt releases its
unused reservation once and retains accepted parts. An omitted cap on a reader
preserves the durable configured cap.

The port is explicitly versioned `raw-seal-v1`; seal/open run without a database
transaction. Associated data follows the exact field order in
[the Raw contract](plans/raw-layer-contract.md). Tests use only explicit
`local-plain-v1`, which provides no encryption. The journal validates port
descriptors, local sealed bytes and decoded text's units/bytes/keyed identity.
Failures expose the fixed `raw_crypto_unavailable` code, never port exception
prose or a plaintext fallback. This does not establish the hosted construction,
key lifecycle, backup erasure or production privacy gates.

Reads return whole parts in ordinal/index order, with explicit unknown time and
incomplete coverage. They include `evidenceTrust:'untrusted-data-not-instructions'`
and fit within 65,536 bytes including the success envelope and signed cursor.
Cursors bind store, exact namespace, operation, conversation/revision, part limit,
namespace epoch and position. Publication rechecks revision, epoch and exact
stored part/message metadata after opening. Owner usage uses one SQLite read
snapshot and counts plaintext bytes, not ciphertext or file allocation.

## Verification boundary

`core/test/raw-journal.test.mjs` and `core/test/raw-boundaries.test.mjs` use the
owned test runner and synthetic workspaces, including two real child processes.
The frozen `core/testing/raw-v23-database.mjs` is the actual pre-Raw opener from
`cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`, with only relative imports relocated,
so old-opener refusal remains testable in shallow CI checkouts.

The four `core/test/raw-capture*.test.mjs` suites additionally exercise actual
P2 admission/episode transactions, controls/fences, bounded model projections,
ordered proofs, staged bypass, replay, migration and independent child processes.
`core/testing/raw-v24-database.mjs` freezes the actual P1 opener from
`0be04cdcc9e5a88b3702bf915510da810d5e797a`, with only an explanatory header and
relative import relocation. All fixtures use synthetic owned workspaces.

`core/test/raw-lineage.test.mjs` adds actual P3a mutation/admission, mapping,
legacy/option-off, cold-process, migration and exclusion-race fixtures.
Episode drafting uses the same exclusion authority before batch/precompact,
end and lazy interpretation, including retained passages with no Memory link.
Filtered messages keep their original omission positions; inherited passages
retain their origin episode's client/session/message identity. Freshness checks
validate the actual prepared input after token counting, at dispatch and after
the response. Publication repeats source checks inside its transaction, including
sources reattached for pinned fields or step closure. An excluded reattachment
fails rather than publishing new prose. The immediate episode error can report
`source_excluded`; the existing finite durable attempt outcome remains
`episode_failed`, preserving consumed-attempt/debounce and closed replay rules.
`core/test/raw-lineage-episodes.test.mjs` covers provider input, cold published
state, zero-Memory passages, inherited origins, concurrency and rollback.
`core/testing/raw-v25-database.mjs` freezes the P2 opener from
`9a7bbe59c9c0ec72227310cece43fce7ac589c6e`, with only an explanatory header and
relative import relocation.

The three `core/test/raw-deletion*.test.mjs` suites additionally cover the P3b
shared cascade, legacy and cross-client episode/keep consumers, durable job and
control fences, migration rollback, usage, actual receipt-backed Cards, competing
processes, asynchronous reads, CAS and bounded effects. The actual v26 opener in
`core/testing/raw-v26-database.mjs` is frozen from
`99b09855358176786d86765d009faba4777867f6` (21,414 bytes after removing its header
and undoing only relative-import relocation).

These establish internal P1/P2/P3a/P3b/P3c mechanics. Installed Raw
lifecycle, production controls/encryption and semantic
quality remain later packets and acceptance gates in the plan. Existing
installed/public compatibility tests do not establish installed Raw capability.
