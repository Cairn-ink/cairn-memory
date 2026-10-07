# Raw-layer contract (RL-0)

Status: decided contract, **not implemented or enabled behavior**. RL-0 changes
documentation only; it changes no schema, executable, default or release version.
Implementation is split into RL-1–RL-3 here and RL-4 in the host.

Authority: cairn-wiki [raw-layer plan (#309)][plan] and [ADR 0006][adr], supplied
as `one-brain-raw-layer.md` and `adr-0006.md` in the RL-0 packet. The plan's
recorded bases are cairn-wiki `940e6309` and cairn-memory `7467aeb`.
This documentation uses cairn-memory `0c7aa20a9cb490bac4d15eca28b2036823a5f48e`
(the worktree's `origin/main`), so the follow-up quotes below use current lines,
not the plan's older line numbers.

On **2026-10-07 chichi accepted D2, D4, D6, D9, D10 and D11 as recommended**.
The initial raw-text cap is **200 MB per person = 200,000,000 UTF-8 bytes**,
across clients and personal/project namespaces in the selected cloud/local store,
not 200 MiB or a cap per client. Separate local stores do not synchronize usage.
D13 requires the privacy page to be updated before anyone else receives raw
storage. The plan's stricter production gate also remains: copy, listings,
notice email and quotas merge before enabling the production flag, including
for chichi. RL-0 is not permission to cross that gate.

[plan]: https://github.com/wsxqaza12/cairn-wiki/blob/main/docs/plans/one-brain-raw-layer.md
[adr]: https://github.com/wsxqaza12/cairn-wiki/blob/main/docs/adr/0006-keep-full-conversations-as-a-raw-layer.md

## Scope, ownership and gates

A conversation is the complete locally redacted user/assistant text selected by
today's Claude Code and Codex allowlists, grouped by exact namespace, client and
host session. Remove both per-message cuts. Tool calls/results, file reads,
machine wrappers and Cairn control turns remain excluded. An assistant's ordinary
quotation of excluded material remains eligible under the existing filter.
This is a complete archive of **submitted selected text**, not every byte in a
tool's transcript. Unknown times stay unknown; source roles/times are claims.

Core owns persistence, usage accounting, paging, lineage and deletion. Hosts
authorize namespaces, bind capture controls/notice authority, supply encryption
and configure the per-person cap. Local mode stores text locally and uploads
nothing for raw storage; configured model adapters may still send bounded input
to their providers. There is no hybrid upload, raw search or read-triggered model
work. Recall continues to use memories and episodes. Website workspace records
keep their existing collection/limits. MCP chat histories, URLs and meeting notes
are outside this capture contract; ChatGPT export import is RL-8.

RL-1 code waits for RL-0, G1 (production backups running and a staging restore)
and G2 (completed H6 cutover). RL-2/RL-3 follow RL-1. RL-4 additionally waits for
RL-1–RL-3 and H6-T's pinned-core adoption. Launch waits for RL-5's H6-E inventory,
erasure/restore fixtures, RL-6 UI, RL-7 copy and cap enforcement. Only chichi
authorizes the production flag at the time. No backfill from before launch,
before notice or across pause/resume barriers.

## Continuation protocol: `raw-conversation-v1`

RL-3 publishes a **new capture request `version:2`** and the
`raw-conversation-v1` capability. This is a future wire revision, distinct from
the currently released package/protocol version. It is not a version bump in
RL-0. Both readers select and redact the **whole logical message before splitting**;
redacting each part independently could leak a credential crossing a boundary.
Preserve the selected text's whitespace and Unicode in raw parts. Existing
canonicalization remains in the bounded extraction projection, not the archive.
Invalid Unicode/NUL input is rejected explicitly, never silently cut.

The strict v2 request keeps `client`, `event_id`, `session_id`, optional
`project_id` and `messages`. Each message part has:

| Field | Meaning |
| --- | --- |
| `id`, `role` | Existing opaque logical message identity (1–200 units), and `user` or `assistant`; do not invent a new message ID per part. |
| `occurred_at` | Required canonical UTC instant or null, constant across parts. |
| `message_ordinal` | Positive safe integer assigned by the reader in selected transcript order, stable across retry/restart; gaps are allowed for excluded/skipped records. |
| `content` | Nonempty redacted text part, at most 4,000 UTF-16 units, with code-point-safe boundaries. |
| `part` | `{index,start,totalUnits,totalBytes}`: zero-based part index and UTF-16 start offset; total full-message UTF-16 units and UTF-8 bytes are positive safe integers. |

`end = start + content.length`; the last part ends at `totalUnits`. The first
part has index/start zero. Parts have contiguous indices/offsets. Final assembly
must match both declared totals and well-formed Unicode. There is no total
message-length cut; the storage cap may prevent archiving an oversized message
but cannot clip it into a falsely complete one. No arbitrary part-count ceiling
substitutes for the removed cuts. Streaming readers/spooling must bound memory.

A batch contains at most 24 parts, at most 20,000 content UTF-16 units and at most
65,536 bytes of serialized JSON. It contains at most one part of a given message.
Shrink a part at a code-point boundary when escaping/metadata would exceed the
JSON bound. Do not normalize, redact again, reorder or trim split substrings.
Clients send message order then part order and finish a message before the next;
server retries may overlap already registered parts. The stable event ID binds
the version, session, control generation, selected transcript range and exact
part identities/bounds. A retry sends the identical frozen body, including totals.
Durable client cursor state stores version/range/ordinal/part offsets and keyed
identities, not raw text, secrets or transcript paths. Reconstruct frozen retries
from the current trusted transcript locator and verify the saved identity before
sending; a changed/unavailable source fails visibly without advancing the cursor.
Any temporary text spool is private, bounded, owned by that invocation and removed
on completion/failure; it cannot become a second durable raw archive.

Core validates identity/ordinal/role/time/totals, bounds and part order before
registration. The unique key is `(namespace,client,sessionKey,messageId,partIndex)`.
Identical overlap is a no-op; changed content or metadata is
`event_payload_conflict`. A missing predecessor is `raw_part_out_of_order`, with
no write/ack; retry the pending predecessor. An ordinal reused by a different
message conflicts. Final total mismatch rejects atomically without marking the
message complete. Already saved earlier parts remain inspectably incomplete.
The first part can be registered even when raw storage is off/unavailable by
policy: a content-free ledger still fences identity and part progression.

**Extraction is independent of assembly.** Only index zero produces ordinary
capture input, through existing normalization and source-bound limits (at most
4,000 units per message, 20,000 per batch and existing provider budgets).
Continuation-only batches register raw/ledger outcomes without extractor,
qualifier, classifier or episode interpretation calls. They do not increment
episode accepted-batch debounce counts. Mixed batches count once if they contain
new first parts. Episode/receipt evidence stays bounded to cited passages; raw
continuations never silently widen a provider request. Receipt anchors bind to
the raw span through the mapping described below.

V2 success uses the current acknowledgement fields and adds `version:2` and
`raw:{conversationId,revision,parts:[{messageId,index,saved,reason}]}`. `reason`
is null for saved parts or a reason from the storage-state table below.
`processing:true` on 200/202 remains unfinished work and **never advances the
cursor**. A final ordinary-admission acknowledgement, or a durable registration
ack for a continuation-only batch, advances only that batch's pending part
position. Transcript EOF advances only when all parts of its selected range have
been acknowledged. Lost ack/restart reuses event/part identities without another
extraction. Storage-policy skips (`tool_off`, `quota_reached`, etc.) acknowledge
the disposition while memory capture continues. Existing daily model-quota
refusals keep pending bytes and cursor unchanged; raw-cap exhaustion is not that
429 and never creates a retry loop. Pause/project/deletion fences take priority.

## Core configuration and registration

The constructor adds `rawConversations:{mode:'raw-v1',port,capBytes:200000000}`;
`mode:'off'` can supply the same port/cap for reads without enabling new saving.
Omission disables new raw saving. It is off by default in the public core and on
in one-brain configuration. No staging/episode option implicitly turns it on.
Enabled mode requires a valid port and positive safe-integer cap. Raw registration
does not require successful staging or episode interpretation. Existing stored
raw records remain deletable and inspectable with the option off when a valid
read port is supplied; deletion/lineage/suppression fences always apply. An
encrypted read without a port fails `raw_crypto_unavailable`, never guesses a
local decoder. Disabled mode does not delete or hide persisted usage.

Trusted host capture context, separate from model/wire fields, supplies the
current pause/project generation, client-switch revision and credential notice
eligibility. Local setup config supplies the equivalent local authority. Core
must never accept a client-supplied `noticeShown:true` as authority.

Registration snapshots controls and prospective capacity. Valid policy skips
bypass sealing entirely, so a raw-off/notice/quota disposition still permits
ordinary memory capture without calling the crypto port. For eligible text it
prepares sealing outside a write lock,
then rechecks authority, part/event identity, deletion fences and owner-wide
capacity in **one write transaction**. That transaction registers the event,
content-free message ledger, raw parts or their skipped dispositions, usage/
reservation changes and the ordinary admission reservation/episode observation
when applicable, before interpretation. Staging release, expiry, capacity bypass
or model failure cannot remove successfully saved raw text. A crash leaves
either all registration effects or none. Retry reuses the recorded disposition;
freeing capacity or turning a switch on never backfills a skipped part.

Preflight pause/project stop or a deleted session refuses the batch before raw
saving or model work. Recheck their fences after asynchronous sealing and before
publication/admission. Pause discards pending client continuations at the existing
EOF resume barrier; paused text is never resent. Turning raw off is different:
clients still transmit the same parts needed to complete the capture protocol.
A seal failure is `raw_crypto_unavailable`: no registration/model work/ack,
no plaintext fallback and no cursor advance. This operational error differs from
a valid policy skip. The host reports it without logging text or port exceptions.

## Encryption port and threat model

The port is versioned `raw-seal-v1` and has two asynchronous operations:

```text
sealRaw({ownerId, context, text}) -> {format, keyVersion, sealed}
openRaw({ownerId, context, format, keyVersion, sealed}) -> {text}
```

`context` is core-owned canonical associated data:
`{version:'raw-seal-v1',namespace,client,sessionKey,conversationId,messageId,
messageOrdinal,role,occurredAt,partIndex,start,end,totalUnits,totalBytes}`.
Both calls use exactly the same context. `sealed` is an opaque byte array;
`format` is `local-plain-v1` or `envelope-aes-256-gcm-v1`; `keyVersion` is null
only for local pass-through, otherwise an opaque nonsecret version ≤64 ASCII
units. A port may reject but cannot redirect namespace/identity. Validate decoded
text length/byte count/Unicode against its stored part; wrong owner, context,
format, version or authentication fails `raw_crypto_unavailable` without output.
Never expose sealed bytes, keys or port errors in public DTOs or telemetry.

Local uses explicit `local-plain-v1`, UTF-8 encoding/decoding with no encryption;
the database's existing file permissions govern access. The hosted construction
requires `envelope-aes-256-gcm-v1` and rejects the local format. RL-4 generates a
random 256-bit data key per owner, wraps it under the server master key, and uses
a fresh 96-bit nonce plus 128-bit authentication tag per sealed part. The exact
versioned blob layout is `nonce || tag || ciphertext`; canonical context JSON is
authenticated as AAD. Canonical encoding is UTF-8 `JSON.stringify` of the context
fields in the order listed above, with namespace keys `ownerId,scope,projectId`
in that order and null for a personal project; no omitted/extra fields. Wrapped
data keys use their own authenticated owner/key-version context and fresh nonce.
The host key record binds `ownerId,dataKeyVersion,masterKeyVersion,wrappedKey`;
the data key's version selects this record, not an assumed current master key.
Master-key rotation rewraps keys without changing
raw payloads; retain the needed master versions until rewrap completes. Data-key
rotation retains old versions until their data is re-sealed or deleted. RL-4
tests rotation/restart rather than guessing that every row uses the latest key.

Only wrapped data keys live in the database/key table and its backups. Master
keys live in server environment now (KMS later), never in database/backups,
source control, logs or delivery artifacts. Core's session HMAC key is a separate
identity key, not the encryption data key. Database/WAL/backup leaks without the
master key cannot reveal raw text. Operators with database and master key can
decrypt it; this is **not end-to-end encryption**. Other existing episode prose,
receipts and staged text retain their current storage rules. The canary encryption
test therefore uses raw-only continuation text excluded from those projections.
Plaintext in process memory, model requests and missed redaction remain risks.

Backup erasure is not achieved by envelope encryption: backups retain wrapped
keys. H6-E P1 limits backups to 30 days and replays erasures before restored data
can serve reads/capture. Logical deletion may leave free pages/WAL until cleanup.
Account deletion covers raw rows, tombstones/lineage/usage and wrapped owner keys,
with the existing 60-day completion promise. Prior provider copies cannot be
recalled. RL-7 must describe these boundaries accurately.

## Storage model, completeness and the cap

The following logical records are mandatory; physical table names are private
implementation choices, not a second host-owned conversation engine.

| Record | Fields and invariants |
| --- | --- |
| Conversation | Core UUID, exact namespace, client, existing `s1:` HMAC session key, revision, first/last known message times and time coverage, receipt times, saved bytes, raw coverage and reasons. No raw session ID, path, reverse map or prose in metadata. Identity is unique per namespace/client/session key even when episodes are disabled. |
| Message ledger | Logical message ID, ordinal, role/time, full declared totals, part progress/completion, first/coverage event identities and keyed content/part digests. HMAC binds version, role, exact part text, time and bounds. No plaintext or public unsalted text digest in metadata. Reuse is checked even when no raw was saved. |
| Raw part | Conversation/message/part identity, offsets, byte count, port format/key version and sealed bytes. Identity is immutable; only exact retry is accepted. Parts are archived independently and compose one complete message only after final validation. |
| Raw disposition/gap | Event/part identity, `saved` boolean and finite reason; contains no omitted text. Retain missing/disabled/quota/incomplete coverage rather than claiming the whole session was archived. |
| Owner usage/reservation | Atomic aggregate across all namespaces/clients in this store: saved UTF-8 plaintext bytes and outstanding message reservations. Does not count ciphertext/JSON/SQLite allocation, metadata, staging or receipts. |
| Lineage/exclusion | Receipt/admission links to conversation/message/raw spans; keyed, content-free forgotten-span exclusions and session deletion tombstones, independent of raw or episode options. |
| Host key/config and core control mirror | Wrapped owner data keys and per-credential notice/email state stay host-owned. App/local config represents per-client switches; their authoritative revision is persisted in the same core store as registration so the switch check is transactional. Setup/UI updates use the core setter and then project its result to config; a failed projection is visible and cannot override committed core authority. |

At the first part of a new message, atomically reserve its entire declared UTF-8
size against `savedBytes + reservedBytes <= capBytes`. If it cannot fit, save none
of that message, persist `quota_reached`, and process its first part for memory
normally. Existing text is never evicted. Each accepted saved part converts its
actual bytes from reservation to saved usage; assembly verifies declared totals.
Duplicate events/parts consume zero additional bytes. Multiple clients/cores must
use the same transactional owner counter, never a host read-then-write estimate.

Reservations prevent ordinary continuation from hitting the cap halfway through
a message. A switch/pause/project barrier may still stop it: retain accepted
parts, release its remaining reservation, close that raw attempt and mark it
incomplete. Later parts are gap dispositions, even after re-enable/resume; no
retroactive fill. A crash alone does not release a valid reservation or expire
text. Pending assemblies/reservations remain visible until resumed or explicitly
deleted. If a host later lowers a cap, existing reservations are honored; block
new reservations while usage exceeds the cap. Raising a cap/deleting text permits
only new messages, not replay backfill. Removing a conversation releases both
its saved bytes and reservations once, in the delete transaction.

| Reason | Meaning |
| --- | --- |
| `tool_off` | This client's raw switch was off at registration. |
| `notice_required` | Sending credential/local setup has not satisfied notice eligibility. |
| `quota_reached` | Entire new message could not be reserved under the owner cap. |
| `raw_disabled` | Core raw option was off for this new submission. |
| `before_launch` | Legacy evidence predates raw support; no reconstruction/backfill. |
| `capture_barrier` | An already pending assembly was closed by pause/project stop; rejected paused batches themselves are not registered. |

Conversation `rawState` is `saved` (all submitted messages complete and saved),
`partial` (some saved parts plus gaps/pending messages), or `not_saved` (no saved
text). An additional `assemblyState:'complete'|'pending'|'closed'` describes each
raw message attempt, independently of the content-free transport ledger's final
completion; `pending` is not a policy reason. A saved state covers submitted selected
text only: batches that never reached Cairn remain an explicit coverage gap, not
an invented count. No automatic raw expiry (D7). Staging's 24 hours and episode's
16 × 800 citation bounds remain unchanged.

## Reads: `getConversation` and usage

All operations use core's existing success/error envelope and trusted host
authority. No model-controlled namespace or owner-wide listing is introduced.

```text
getConversation({namespace,conversationId,limit:20,cursor?})
getRawUsage({ownerId})
getRawCaptureControl({ownerId,client})
setRawCaptureControl({ownerId,client,enabled,expectedRevision})
previewDeleteConversation({namespace,conversationId,expectedRevision})
deleteConversation({namespace,conversationId,expectedRevision,actionId})
```

`getConversation` has part limit default 20/max 50 and a hard **65,536-byte whole
serialized response** budget, including metadata/cursor. Return whole parts in
message-ordinal/part-index order, never trim text to fit. A part is at most 4,000
units, so a long message spans pages without imposing a message-size read cut.
`value` contains `conversation` (identity/revision/client/times/rawState/coverage/
savedBytes/reasons), `messages` (message metadata with `parts:[{index,start,end,
text,saved,reason}]`, assemblyState and totals), `nextCursor`, `complete`,
`budget_exhausted` and `evidenceTrust:'untrusted-data-not-instructions'`.
Skipped positions expose no text. `complete` means the page traversal is complete,
not that every source was saved; rawState and assemblyState remain visible.
Clients concatenate contiguous parts, showing incomplete messages explicitly.

The exact nonnull conversation DTO is `{id,revision,namespace,client,sessionKey,
eventStart,eventEnd,eventTimeCoverage,firstReceivedAt,lastReceivedAt,rawState,
savedBytes,reservedBytes,coverage,reasons}`. Event times are canonical UTC or
null; eventTimeCoverage is `complete|partial|unknown` as in episodes. Receipt times
are core UTC instants. Coverage is `{completeMessages,pendingMessages,
closedMessages,skippedParts,unreceivedBatches:'unknown'}`: counts cover registered
messages/parts only; completeMessages counts fully saved raw assemblies, and
skippedParts counts received parts with a not-saved disposition. Reasons is a
deduplicated, bytewise-sorted array from the finite table above. It describes
source saving, independently of an episode interpreter's coverage.

Each message DTO is `{id,ordinal,role,occurredAt,totalUnits,totalBytes,
assemblyState,parts}`. A part DTO is exactly `{index,start,end,text,saved,reason}`;
text is a string for saved parts and null otherwise. A part not received has no
fabricated entry; totalUnits and assemblyState expose the missing suffix. Page
boundaries can repeat a message's metadata with later parts, never duplicate a
part. A legacy metadata-only record has no fabricated messages/offsets and uses
the `before_launch` reason. Counters/ordinals are nonnegative safe integers
(message ordinals and revisions positive), and all fields are mandatory unless
explicitly nullable; schemas reject extras.

The signed opaque keyset cursor binds store, exact namespace, operation,
conversation ID/revision, limit, last message ordinal/part index and namespace
epoch. Fresh mutation yields `cursor_stale`; foreign/malformed cursors are
`invalid_cursor`. Missing/deleted/foreign conversations return
`{conversation:null,messages:[],nextCursor:null,complete:true,budget_exhausted:false}`
with the trust marker and no leaked tombstone. A valid legacy conversation can
return `before_launch` with no raw parts; the host uses its existing excerpts.
An envelope/first part that cannot fit fails `context_item_too_large`.

Opening encrypted parts occurs outside locks. Re-read conversation revision,
part identities, deletion fence and namespace epoch before publishing plaintext;
a concurrent change fails `revision_conflict`, without a stale partial result.
Reads invoke no extraction/re-extraction, queue drain or quota charge and remain
available during pause/raw-off/model-quota refusal. The UI uses receipt/episode
span links to highlight saved raw text, never guessed offsets into normalized
or freshly redacted returned strings. Hosts that redact reads again must return
an explicit offset mapping or omit highlights with a coverage reason.

`getRawUsage` is one host-authorized **owner-wide** snapshot: `{ownerId,revision,
capBytes,savedBytes,reservedBytes,remainingBytes,atCap,clients}`. Remaining is
`max(0,capBytes-savedBytes-reservedBytes)`; atCap means remaining is zero (a larger
message can fail with space still remaining). Client entries carry the same byte
counts and conversation count, not text, paths or inferred device identities.
Each `clients` entry is exactly `{client,savedBytes,reservedBytes,
conversationCount}`, ordered by bytewise client key; include the two supported
clients with zero values even before first capture, and importer when RL-8 lands.
The owner usage revision starts at zero and advances on actual saved/reserved
usage or configured-cap changes, never on an identical replay/read. All byte
counts are nonnegative safe integers and capBytes is positive.
Reservations are shown separately, so an incomplete upload cannot hide capacity.
Local setup status and hosted 設定 › 方案 consume this read. Core counts bytes;
plan selection/billing belongs to the host. Missing owner usage returns zeros and
the configured cap; the read itself creates no row. No raw search is added.

## Per-tool control and notice (D8/D9)

Unit: one switch per owner/client (`claude-code`, `codex`, later `importer`),
shared across credentials/projects/devices in that store; default **on**.
Local setup writes one switch per client in its core-store config. The getter
returns `{client,enabled,revision}` (absent state is on, revision zero); setter
requires CAS and returns the committed state. Stale updates fail
`revision_conflict`; failure is surfaced and never presented as successful.
Core rechecks its authoritative revision at registration commit. Already committed
batches keep their disposition; the next registration uses the new switch.

Off stops **raw saving only** from the next batch. Memory capture continues,
already saved text stays, and pause remains a separate control. On affects new
messages, including new messages in an existing session; it never fills previous
gaps or retries a closed raw attempt. Raw-off does not
change client allowlists, transmission or memory-model quotas.

The committed off setter closes pending raw assemblies for that owner/client
and releases their unused reservations while preserving accepted parts. Existing
core pause/project-stop setters likewise close affected pending raw assemblies
in their control transaction, using `capture_barrier`; they do not rely on a
later rejected batch to release capacity. In-flight registration rechecks these
fences. Resuming/enabling cannot reopen a closed assembly; new messages in the
same surviving conversation can still be saved.

The one-time notice is disclosure, **not confirmation**: no new checkbox, modal
approval or blocked consent step. Show it on every credential-issuing path before
the credential can send: OAuth consent beside scopes; token creation beside its
one-time display; plugin install/one-command setup in the disclosure printed
before existing consent. Local setup shows it before capture can start. A manual
token paste relies on the issuer's notice, not a guessed local notice bit.

The service records notice version/time per credential at grant/issuance. The
sender's credential must be eligible independently of the default-on switch.
Missing notice records (including prelaunch credentials) allow memory capture
but return `notice_required` for raw. For existing tools, raw eligibility starts
only after the same website notice has been shown once **and** the significant-
privacy-change email has been sent; persist both facts, without a confirmation.
The switch appears from that client's first connection/capture in 設定 › 連線
and links to the notice. No pre-notice batch is fetched again.

## Precise lineage, deletion and forgotten-span exclusion (D5/D6)

RL-2 adds durable links from every retained receipt/admission (including dedup,
keep and later re-extraction) to its actual conversation/message source. A receipt
is not an independent source merely because it has a new event/receipt ID.
Explicit remember has its own explicit receipt and is not assigned to a capture
conversation. Hosts cannot mark a derived memory as explicit to evade the cascade.
Lineage covers current and historical memories; do not use the episode's bounded
16-passage set or stale `memoryLinks` alone as the deletion authority.
Here a **live receipt** means retained, non-deleted source support on either a
current or historical memory, not merely an admission event or historical link.
Evaluate only memories actually linked to the deleted conversation; zero receipts
on an unrelated row cannot make it a source-only deletion target.

Episode source and receipt inspection may expose an additive `rawAnchor` with
`{conversationId,messageId,start,end,precision}` only on raw-capable reads when
the span is saved. Precision is `exact` or `whole-message`. Missing raw means
no public anchor, not a guessed link. Internal provenance/exclusions still exist
for skipped raw. Legacy DTOs and option-off ordinary memory reads retain their
existing fields; RL-4 publishes these optional inspection fields in its new
raw-capable schema rather than widening an old strict response silently.

Anchors use half-open UTF-16 spans `[start,end)` on the exact redacted raw message,
at code-point boundaries. Normalized extraction/receipt spans need a validated
mapping to those raw offsets; store it with provenance even when raw text was
not saved. If normalization makes a precise mapping ambiguous, link the entire
message conservatively and mark that precision explicitly. Never infer offsets
with substring search. A receipt selecting an entire bounded source prefix
excludes that entire mapped span when forgotten. A candidate with several sources
is excluded if **any** proposed source anchor overlaps a forgotten span.

`deleteConversation` is revision-guarded and action-idempotent. Preflight and
commit compute the same source effects under one transaction. Return content-free
counts `forgottenMemories`, `retainedMemories`, `removedReceipts`,
`invalidatedEpisodes`, and host-withdrawal effects; replay returns the original
counts without another decrement/purge. Stale revision is `revision_conflict`.
`actionId` is an opaque 1–200-unit identity bound to namespace/conversation/action;
reuse with different arguments is `event_payload_conflict`. A completed delete's
identical replay succeeds after tombstoning; an unknown/foreign conversation fails
`conversation_not_found` without revealing existence. Concurrent first deletes
serialize and cannot each decrement usage or emit a second withdrawal.
`previewDeleteConversation` is a model-free snapshot of those same counts and
the conversation revision, with no deletion or usage change. The host's delete
prompt uses it to split disappear/stay counts and revalidates on commit; a changed
preview fails CAS and must be shown again with current counts. A content-free
tombstone retains namespace/client/HMAC
session identity and fence; late batches fail `conversation_deleted`.

| Object | Delete conversation | Forget memory | Delete account |
| --- | --- | --- | --- |
| Raw/record | Delete parts/record/reservation; keep session tombstone only. | Keep raw conversation. | Remove raw, metadata, tombstones, usage and wrapped keys under H6-E. |
| Episodes | Clear prose/passages/steps/policies; fence session and invalidate all consumers of removed sources, without recursively forgetting unrelated memories. | Invalidate dependent interpretations/steps/closure evidence under existing rules. | Delete. |
| Memory with no other live receipt | Forget with normal suppression, including historical source-only content; do not retain it through stale admission lineage. | Forget selected memory with suppression. | Delete. |
| Memory with another conversation or explicit receipt | Remove deleted-conversation receipts and lineage; preserve content, surviving receipts and current/historical state. Advance affected revisions and invalidate dependent indexes/relationship evidence as normal. | Other memories unaffected except existing dependent-evidence invalidation. | Delete. |
| Staging/work | Discard this conversation's staged payloads/leases/pending work; normal suppression may also invoke existing namespace-wide staging purge. Fence in-flight publication. | Existing namespace-wide purge applies to **staging only**, never raw. | Delete. |
| Pending asks/unconfirmed Action Capture previews | Withdraw those sourced from this conversation. | Withdraw asks about the forgotten memory. | Delete. |
| Confirmed Action Captures, Commitments, promoted cards | Keep their collection records and own excerpts (ADR 0002/0003 in the host). | Keep. | Host H6-E P3. |

Core atomically persists finite, content-free host-effect records (conversation/
affected memory IDs, kind and action identity) with deletion. The host's own
collection lineage locates related pending ask/preview IDs; core does not pretend
to own those records. RL-4 consumes effects idempotently to withdraw
asks/previews in host collections. A cross-database transaction is not assumed.
Before host completion, reads/confirmation must consult the deletion fence and
hide/refuse affected pending items. Retry after restart drains durable effects;
do not report completed withdrawal merely because an HTTP call returned once.

D5 **supersedes the old multi-source rule of `forgetEpisode`**. RL-2 routes both
conversation deletion and the old episode-delete facade through this cascade,
including feature-off opens. Calls deleting legacy episodes with no raw still
use source lineage and retain a tombstone. Unknown legacy lineage must be resolved
from existing receipt/session/admission metadata before launch; never guess that
unlinked receipts are independent support. Ambiguous records fail closed with
`raw_lineage_unavailable` and a reviewable repair requirement, not silent loss
of multi-source memories. Deleting raw cannot leave historical source-only prose
or dependent closure descriptions accessible.

D6 records content-free exclusions **before** forgetting removes receipt text:
namespace/client/session HMAC/message identity plus mapped forgotten spans and
fence revision. They remain while the raw source remains, including through
restart, option-off opens and episode invalidation. No plaintext forgotten-memory
copy is needed. Re-extraction/keep/any replay that reads retained raw must filter
anchor overlap before admission and recheck the exclusion generation at commit,
on top of ordinary fingerprint suppression. Exact and paraphrased candidates on
the same span are blocked even with a fresh extraction event ID. Disjoint spans
can still support different memories. This is provenance exclusion, not a
semantic guarantee against deliberate re-entry in a genuinely new session.
Conversation/account deletion removes obsolete exclusions along with the source;
the session tombstone still prevents re-upload. Correction records equivalent
old-source exclusions where needed to keep discarded source wording from returning.

## Re-extraction hooks (D11; ships in RL-9)

RL-1/RL-2 retain exact messages, lineage and exclusion generations so RL-9 can
read paged sources and make new bounded capture windows without reopening an
old admission event. Reserve capability `raw-reextract-v1`, but expose no job,
daemon, model-call-on-read or automatic retry in RL-1–RL-4.

The later trusted host job requires an explicit person-started action, namespace,
conversation revision, new action/job identity, source watermark and extraction
profile version. It uses its own model-quota bucket, reports partial coverage,
and binds every generated receipt to the original raw span. Check source revision,
deletion/pause fences and D6 exclusions before provider dispatch and admission.
Deleting/forgetting during a job prevents stale publication. Absent/partial raw
cannot be invented or fetched from old tool history. RL-9 tests a paraphrase on
the forgotten span, a disjoint-span candidate, restart/replay and concurrent
forget/delete. Storage capability alone is not evidence that re-extraction ships.

## Compatibility and migration

### RL-4 HTTP surfaces

Route names below are future RL-4 obligations, not deployed endpoints. Capture
credentials keep their current authority; full raw reads/deletion/control use
the authenticated person's website session and must not silently broaden an
existing tool token's memory scopes. Capabilities is authenticated but text-free.
The service derives owner from authentication, resolves optional `project_id`
against that owner's access and passes exactly one namespace to core; there is
no owner ID in a public request and no cross-project fallback.

| Surface | Binding |
| --- | --- |
| `GET /api/memory/capabilities` | Strict `{version:1,captureVersions:[1,2],rawCapability:'raw-conversation-v1'}` on an enabled v2 host. The advertisement means wire support, not the sender's notice/switch eligibility. Disabled/unsupported hosts omit this capability or return unavailable; never send transcript text to probe support. |
| `POST /api/memory/capture` | Existing bearer capture authentication; strict v2 request/acknowledgement above, plus unchanged legacy path. Sender's notice eligibility comes from the credential record. |
| `GET /api/memory/conversations/:id` | `project_id?`, `limit?`, `cursor?`; maps `getConversation` and returns its value with `version:1`. Missing/deleted/foreign results share the null shape. |
| `GET /api/memory/conversations/:id/deletion-preview` | `project_id?`, required `expected_revision`; maps the core preview, returning counts/revision with `version:1`. |
| `POST /api/memory/conversations/:id/delete` | Strict `{version:1,project_id?,expected_revision,action_id}`; maps revision-guarded/action-idempotent delete and durable host withdrawals. |
| `GET /api/memory/raw-usage` | No owner/project selector; returns authenticated owner's `getRawUsage` value with `version:1`. |
| `GET /api/memory/raw-control/:client` | Returns the current owner/client switch and revision with `version:1`. |
| `PUT /api/memory/raw-control/:client` | Strict `{version:1,enabled,expected_revision}`; commits core switch then app projection, returning state/revision. |

All these reads return `Cache-Control: no-store`; no raw body/IDs/digests enter
telemetry, request-body logs or arbitrary error text. Reject unknown fields.
Use 400 for invalid input/version/part order, 401 for invalid authentication,
409 for payload/CAS/stale-cursor/deletion/capture-control conflicts and 503 for
crypto/storage unavailability. Preview/delete of missing/foreign IDs share 404.
Retain the existing bounded memory quota's exact 429 shape; raw-cap skips are
successful capture dispositions. Errors project only fixed codes and no source
text. Unsupported capabilities cannot authorize a client version upgrade.

### Wire and store upgrades

RL-3 changes schemas, both client validators/producers, frozen retry identities,
documentation and conformance tests together. RL-4 publishes authenticated
capability support; setup independently verifies it before enabling v2. No guessed
version header or masquerading Codex-as-Claude fallback. V2-only fields are never
sent to a strict old server. If unsupported, retain the legacy memory path with
explicit raw-unavailable status; never claim complete raw capture. Local upgraded
cores consume the same continuation contract without needing an HTTP service.

An upgraded host accepts unchanged legacy requests for ordinary memory capture.
They cannot establish full-message completeness and therefore save **no new raw**;
their evidence is `before_launch`/legacy coverage, even if a notice is eligible.
Frozen pre-upgrade batches finish under their old protocol identity; only fresh
post-upgrade ranges become v2. Switching protocol never changes a pending event
in place or reconstructs previously clipped messages. Existing response/quota/
processing parsers remain exact for legacy; v2 acknowledgements require strict
version/part disposition validation before any cursor advance.

RL-1 reserves the next transactional additive core schema revision, **v19 from
current v18**, with empty raw records/counters and no inferred backfill. RL-2
must add lineage/exclusion upgrades atomically (choose its next available revision
at implementation time, do not overwrite an intervening migration). Stop/drain
old connections first; older openers refuse unsupported versions. Option-off
opens still preserve raw rows, usage and deletion fences; disabling an option is
not downgrading the database. No mixed-version writers or lossy rollback. H6-T
pins the exact tested producer/core revision and carries restore/rollback gates.

## Acceptance by package

All fixtures are synthetic and use temporary stores on core Node 22.16 and 24.
They establish mechanism/lifecycle behavior, not model quality. Later packages
include their implementation, schema/docs and conformance tests in their own PRs.

| Package | Required observable acceptance and plan criteria |
| --- | --- |
| **RL-1: core storage** | Reconstruct submitted redacted text byte-for-byte from paged parts for Claude/Codex, including Unicode/escaping and messages >4,000 and >20,000 units (RA1 foundation). Verify raw/event/usage/admission atomic rollback, save before staging expiry/release/bypass and extraction failure, duplicate/overlap/restart charge zero, out-of-order/changed totals refuse, missing final part stays incomplete. Test raw with episodes/staging off. Port spy verifies exact AAD, seal-before-commit control recheck, no callback under write lock, no plaintext fallback and read failure/race without leakage. Two-process reservation races cannot exceed 200,000,000 bytes; test exact boundary, oversized-message skip with first-part extraction and no eviction/backfill (RA6 foundation). Test paged bounded reads/cursors across restart/foreign namespace/mutation, unknown times, legacy/null reads, owner-wide usage and schema rollback/old opener/option-off preservation. |
| **RL-2: lineage and cascade** | Fixture includes only-source, multi-source, explicit and historical memories, quick episode with no memory, cross-episode consumers, pending ask/preview and confirmed Commitment (host effects asserted here, consumed in RL-4). Every deletion-table row holds; old `forgetEpisode` shares D5; late session batches and in-flight workers cannot publish (RA3). Counts/CAS/action replay survive restart and usage is decremented once. Forget keeps raw and blocks exact/paraphrased same-span candidates via changed event IDs, including keep, normalization mapping, ambiguous whole-message anchors, option-off opens and concurrent exclusion changes; a disjoint source is allowed (RA8 hooks). Verify staging purge cannot remove unrelated raw, receipt provenance cannot be laundered as an independent source, historical prose/source consumers clear, unresolved legacy lineage fails visibly. |
| **RL-3: both clients/local setup** | Remove Claude's `transcript.mjs` 20,000-unit slice and shared `common-profile.mjs` 4,000-unit cut; end-to-end synthetic transcripts round-trip full redacted selected text (RA1/RA11). Secret crossing a part boundary is redacted before splitting; excluded tool/control records remain excluded. Strict v2 batches meet 24/20,000/65,536 bounds for Unicode and JSON escaping. Test interrupted middle/final part, lost ack, processing/202, daily quota, exact frozen replay and cursor/EOF progression without repeated extraction. Pause/resume and project-stop discard pending/partial records and never backfill (RA5). Local default-on switch/status/usage, CAS failure and off-next-batch memory-continuation hold (RA4/RA11); setup disclosure appears before capture with no new confirmation. Unsupported host and frozen legacy batch tests cannot silently claim full raw. |
| **RL-4: hosted adoption (cairn-wiki)** | Pin tested RL-1–RL-3 through H6-T. Serve authorized v2 capture/read/delete/usage/control routes with strict DTOs, no-store raw reads, scope/client isolation and no raw telemetry/log/body dumps. Two owners have different wrapped keys; raw-only canary absent from DB/WAL/backup; missing/wrong master/AAD fails; rewrap/rotation/restart works (RA2). At 200 MB, messages skip whole with visible reason, no eviction, unchanged daily memory quota and concurrent clients cannot overspend (RA6). OAuth/token/install/setup notice precedes first batch; each credential's record is enforced; old credentials require website notice plus email; off takes effect next batch and memory continues (RA4). Pause generation races/pre-notice batches cannot save raw (RA5). Durable host deletion effects withdraw asks/previews across restart while confirmed records stay (RA3). Prove staged restore/erasure replay covers raw and owner keys with RL-5 (RA10). No production writes before gates; privacy page/copy/listings/email and cap merged before flag, chichi authorizes flag (RA9/RA12). |

RL-6 owns RA7: phone/desktop prototype comparison, paged full text and accurate
span highlights, excerpt fallback plus reason, switch/usage and split deletion
prompt. RL-7 owns the privacy page, `legal-a8-content.md`, listings and email;
the ChatGPT/MCP statement that Cairn does not read chat history stays true.
RL-8 importer counts toward the same owner cap. RL-9 owns actual explicit,
quota-charged re-extraction and end-to-end RA8; RL-2 only supplies/tests its hooks.

## Follow-up statement ledger: quotes at this packet's base

These are exact current excerpts at `0c7aa20`, before RL-0 edits. They make the
plan's cairn-memory follow-up auditable despite moved line numbers. The linked
files are edited in the same packet. A future contract must not be presented as
today's runtime: implementation summaries identify legacy behavior until RL-2.

| File and original lines | Current excerpt | RL-0 disposition |
| --- | --- | --- |
| `docs/plans/session-episodes.md:21–22` | “Controls are at entry: pause, stop capturing a project, delete a conversation.” | Add per-tool raw switch, distinct from pause. |
| `docs/plans/session-episodes.md:86` | “≤16 distinct passages per episode, each exact canonical prefix ≤800 units with claimed user/assistant role.” | Keep citation cap; add raw message/span links. |
| `docs/plans/session-episodes.md:224–225` | “No full transcript, old-prose audit log or automatic age TTL is added.” | Raw mode adds full selected conversations with no expiry; old-prose audit log remains excluded. |
| `docs/plans/session-episodes.md:348–350` | “Forget all live and historical memories with admission lineage from it using normal suppression, including multi-source deduplicated memories.” | D5 deletes raw and only forgets source-only memories; remove this conversation's receipts from others. |
| `docs/plans/session-episodes.md:352` | “Preserve existing namespace-wide staged purge when memory forgetting invokes it.” | Staging only; add D6 exclusion while raw stays. |
| `docs/plans/session-episodes.md:380` | “Keep cannot recover omitted/expired text.” | Keep can use saved raw after integration, under existing budgets/suppression; absence still cannot be recovered. |
| `docs/plans/session-episodes.md:1086–1088` | “the one-brain client must disclose durable selected-passage retention when enabling capture” / “Existing staging opt-in must not silently acquire permanent retention.” | Disclose full conversations and switch; preserve separate raw opt-in boundary. |
| `docs/plans/session-episodes.md:1101–1102` | “additional unsupported clients, complete archives/backfill, cross-store identity” | Raw complete archive in scope; no automatic backfill; later explicit import remains RL-8. |
| `docs/staged-capture-evidence.md:53–55` | “This is not the original byte stream or a complete transcript archive.” | Still true of staging; point to raw archive. |
| `docs/staged-capture-evidence.md:61–62` | “Fixed24-hour expiry starts with the original claim and is not renewed by replay or inspection.” | Keep; independently saved raw survives expiry. |
| `docs/staged-capture-evidence.md:75–77` | “Successful correction or forgetting clears **all staged payloads in that exact namespace**, not just guessed-related passages, and fences their event IDs.” | Explicitly exclude raw conversations from purge. |
| `docs/staged-capture-evidence.md:83–85` | “This conservative breadth prevents retained staging from replaying a paraphrase of a forgotten source before precise source-lineage deletion exists.” | Legacy staging rationale stays; raw journal requires RL-2 precise lineage/D6. |
| `docs/staged-capture-evidence.md:94–95` | “There is no encryption or new network authorization layer.” | Scope it to staging; raw uses host sealing/cloud encryption. |
| `docs/staged-capture-evidence.md:105–107` | “Native Hermes exposure, precise source-lineage deletion, automatic retries, promotion, background maintenance and general reliability claims are outside this slice.” | Staging slice exclusion stays; precise lineage is required in RL-2. |
| `docs/adr/0003-session-episodes-retain-sources.md:32–34` | “forgetting its derived memories through existing suppression, including deduplicated multi-source memories.” | Record explicit D5 supersession, preserved-source wording trade-off. |
| `docs/privacy.md:41` | “It does not need the raw transcript.” | State future full selected-text retention and boundaries with gate; do not claim deployment. |
| `docs/privacy.md:424–426` | “conservatively forgets even multi-source derived memories.” | Identify legacy implementation and future D5. |
| `docs/privacy.md:444–446` | “deletion suppresses even multi-source/historical derived memories.” | Same legacy/future distinction for storage summary. |
| `docs/privacy.md:542–546` | “suppresses all derived live/historical memories including multi-source deduplication” | Same legacy/future distinction for management summary. |

## Remaining later decisions

Tool output remains excluded unless chichi decides otherwise. KMS adoption,
bulk deletion per tool and later plan-specific cap changes are separate work.
The six accepted rows and the initial 200 MB cap are settled, not open questions.
