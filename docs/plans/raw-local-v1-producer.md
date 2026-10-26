# Local Raw V1: bounded transcript producer foundation

Status: authorized bounded local implementation, not delivered.
Fixed dependency: `98ef7916072e63e777c0cec21b4f5a28794c39ee`, P3c
[PR #453](https://github.com/Cairn-ink/cairn-memory/pull/453). Its primary
acceptance and independent Standards/Spec reviews passed. All 31 latest-head
remote checks passed on that same candidate; the PR is mergeable and ready,
not merged. The synthetic merge tree equals the reviewed candidate tree.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-v1-producer`.
Branch: `feat/raw-local-v1-producer`.
Owner: primary for contract/integration/acceptance; one GPT6.1Sol/high worker
for implementation; separate non-author reviewers for both axes.
The continuous-work segment began 2026-10-21 ~02:10 UTC; the user discussion
checkpoint remains 12–18 hours, not an open-ended unattended promise.
The public/default and installed hook paths remain v1 in P4a.
P4b must wire the actual hooks, local configuration/authority,
capability negotiation and installed lifecycle before local V1 is complete.

## Outcome

Both actual supported transcript layouts feed one shared bounded preparation
pipeline, producing exact selected/redacted v2 parts that the existing internal
`captureRaw` registers. Synthetic producer-to-core-to-paged-read tests reconstruct
the complete selected redacted text, including a single JSON record beyond the
current reader caps. No second capture/storage engine, automatic Card creation,
hidden model call or newly installed capability.

## Fixed decisions

1. Preserve released v1 parser, normalization, cuts, batch/event identities and
   cursor behavior. A pre-upgrade Claude pending window has no historical keyed
   digest. It stays v1 with Raw unavailable; a new digest is not proof of its
   previously transmitted body. Only new v2 ranges get the new guarantee.
2. New v2 selection occurs before normalization. Claude joins selected text
   blocks with newline; Codex uses its existing empty separator. Preserve all
   selected whitespace/Unicode. Redact the whole joined logical message before
   splitting; first-part model projection remains the current bounded engine.
3. Incrementally decode UTF-8 and JSON from a trusted already-open source,
   retaining only bounded structural metadata. No whole-record JSON.parse,
   readFile or accumulating string for oversized text; no fixed-overlap secret
   filter. Validate trailing metadata/filter decisions before any dispatch.
   Reject malformed Unicode, NUL and unsupported layouts explicitly. Incomplete
   source records do not advance or dispatch.
4. Implement the existing eight ordered redaction stages as dedicated bounded
   transducers, not a general-purpose regular-expression engine. Match the
   actual legacy regular expressions' order, boundaries and greediness exactly.
   Keep unresolved candidates as input-spool offsets, not retained strings.
   Copy the assignment prefix from offsets; do not bound it by truncating text.
   Compare against the existing redactSecrets as an independent test oracle.
5. Scratch is invocation-owned, private (directory0700/file0600), exclusive,
   and transient. At most active input/output stage files; predecessor removal
   follows successful transition. Handles do not expose paths. Count actual
   bytes across owned files, use bounded buffers, and clean on success/refusal/
   exception/cancellation. SIGKILL/host crashes cannot promise cleanup. No
   durable second plaintext archive, transcript path or plaintext cursor.
6. Explicit scratch/work limits cause a visible resource refusal and no cursor
   advancement; never clipped/complete success or silent oversize skip. Initial
   defaults: source I/O buffers16KiB (max64KiB), JSON nesting64 and retained
   structural metadata65,536bytes, scratch512MiB (max1GiB), preparation deadline
   30,000ms (max300,000ms). Selected text and unresolved match lengths have no
   in-memory length allowance: they remain streamed/spooled. Scratch counts
   actual simultaneous owned bytes, not the caller's original source file.
   Deadline/abort checks occur around asynchronous I/O and before output; this
   does not promise hard preemption of an uncooperative filesystem operation.
   Resource exhaustion is `raw_source_resource_limit`, malformed selected text
   `raw_source_invalid`, changed/frozen identity `raw_source_changed`, missing
   locator `raw_source_unavailable`, cancellation `raw_source_cancelled` and an
   unfinished record `raw_source_incomplete`. Unsupported layout is the existing
   `unsupported_format`; malformed v2 request/ack uses `invalid_capture_v2` /
   `invalid_capture_ack`. All are content-free, with no automatic retry here.
   These resource limits must not be confused with whole-message Raw admission
   or the existing owner cap. Tests use modest synthetic sources, not hundreds
   of megabytes merely because a maximum permits it.
7. Prepare one logical message completely, counting UTF-16 units and UTF-8 bytes
   plus a keyed content identity, then emit code-point-safe parts. A handle can
   emit many parts without re-preparing its message. Explicit retry preparation
   reconstructs and verifies its frozen identity from the trusted source.
8. Strict v2 request limits are 24parts/20,000units/65,536serialized bytes,
   one part per message per batch, message then part order, stable ordinal and
   totals. Cursor/pending publication remains owned by existing client workers;
   foundation helpers only validate/prepare content-free records and next steps.
9. Strict acknowledgements must match every outstanding identity/disposition.
   Processing/202, daily quota, malformed success and failed interpretation do
   not advance. The internal raw/interpretation envelope is not itself a wire
   acknowledgement. A continuation-only durable registration may be terminal
   with zero model calls. No automatic retry scheduler is added.
10. Capability probing later is authenticated/text-free and not notice authority.
    No request/model boolean grants Raw retention or Card permissions. The new
    foundation accepts trusted host context separately from wire data.

## Required observations

- Real Claude and qualified Codex layout -> v2 -> existing core -> exact paged
  reconstruction; include Unicode/escaping/whitespace, >20k text and >262144-byte
  selected JSON record, without raising legacy cuts or altering old IDs.
- Excluded tools, structural machine records, rich input, partial/delta records,
  own-skill/control turns remain excluded; new v2 must not broaden that policy.
  Do not confuse it with v1 normalization-driven invalid_text outcomes: Raw
  preserves whitespace and whole-message redaction before the separate bounded
  extraction projection, including the already authorized empty projection.
- Secrets crossing byte/code-point/block/part and streaming-buffer boundaries;
  redactor equivalence with ordered native regex on fixed adversarial cases and
  seeded generated input, including failed/ambiguous matches and EOF.
- Bounded live buffers/metadata with huge candidate tokens and preserved
  assignment prefixes; actual child constrained-heap run, instrumented read
  bounds and scratch accounting. Do not infer bounded memory from code alone.
- Exact lost-ack/middle/final-part reconstruction from a new process; altered or
  missing source refuses, pending metadata has no text/path/unkeyed digest.
- Continuations invoke no extractor/qualifier/classifier/episode calls; first
  parts retain existing limits. Capture remains model-independent for Raw saving.
- Strict ack mismatch, processing, quota and resource refusal leave progress
  unchanged. Raw-policy skip is not daily-model quota and does not retry forever.
- Every success/failure/cancellation path leaves no unexpected owned scratch;
  foreign/replaced paths are never removed to manufacture a clean result.
- Existing v1 suites and golden fixtures remain unchanged/green on both runtimes;
  exact final-source primary acceptance plus independent Standards/Spec review.

## Reviewed foundation scope

Expected modules: shared streaming JSON, raw selection, ordered redactor/spool,
message/part planner, strict protocol/pending helpers and two layout adapters.
Only minimal shared-policy extraction from existing parsers is permitted, backed
by v1 differential/golden checks. New versioned schemas belong with conformance,
not by widening the legacy schema. Do not hand-edit generated runtime mirrors.
The concrete allowed paths and DTOs are pinned below. Public hook/setup/MCP
exposure and product pin stay out.

## Concrete implementation boundary

Keep all new helpers under a dedicated `integrations/client/raw/` directory;
the existing bundle's top-level module inventory and installed closure stay
unchanged. Client-specific adapters may live in that directory too, because
the future installed Claude entrypoint must not import Codex or core source
files. P4a's uninstalled `index.mjs` can dispatch to separate Claude/Codex
adapters; only the Codex adapter may import the actual pure Codex parser/header
oracle. Keep shared JSON/spool/redaction/protocol modules independent of both
host trees. P4b must choose a client-specific installed entrypoint/closure;
shipping this internal aggregate index wholesale into Claude is not implied.
Tests
under `integrations/client/test/raw-*.test.mjs` need an explicit new
`test:raw-producer` owned-runner script and a step in the existing two-runtime
Codex CI job: the current `test:client` lists two files explicitly and will NOT
discover these tests. `package.json` and only that CI step are therefore in
scope. Fixtures/child probes use `integrations/client/test/fixtures/raw-*`.
`schemas/capture-v2-request.schema.json` and `capture-v2-response.schema.json`
are new names; do not widen or regenerate the old hosted schema bundle yet.
Main owns the new plan and completion-plan updates. Worker owns only new helper,
schema and test files plus minimal API/limitations documentation. Existing
parsers/installed scripts are read-only unless primary approves an exact policy
extraction with unchanged behavior and generated parity.

Add a narrowly labelled internal-producer threat-model section to the Raw
reference documentation and a link from `docs/protocol.md`. It must distinguish
transient pre-redaction spool from retained redacted Raw, selected-record privacy
from semantic truth, HMAC identities from permissions, and logical cleanup from
guaranteed disk erasure. Do not imply these uninstalled helpers are a supported
HTTP route. Privacy/notice/hosted encryption/production flags remain separate.

Preparation accepts an already authorized open file handle and one exact JSONL
record byte range, not a path or a transcript directory. A streaming range
scanner can yield complete record ranges one at a time with bounded buffers;
it must not accumulate every range or silently drop a long/incomplete record.
Codex's verified layout and client qualification come from the trusted caller;
the helper does not infer an approved creator from conversation text. Claude's
existing own-skill boolean and loaded plugin root come from trusted selection
state. The result includes the next selection state even when a record is
excluded, but nothing publishes it before the caller's existing cursor barrier.

Pinned public-to-this-internal-module shape:

```
prepareRawRecord(
  { source, range: { start, end }, client, sessionId, wireSessionId,
    generation, epoch, messageOrdinal, selectionState, formatAuthority },
  { identityKey, limits?, signal? }
) -> { disposition: 'selected', message: privateHandle, nextSelectionState }
   | { disposition: 'excluded', reason, nextSelectionState }
```

The private handle owns only its invocation spool. It exposes immutable bounded
metadata (opaque ID, role, canonical occurrence time or null, totals and keyed
identity), a bounded part iterator/read operation and `close()`. It never exposes
a spool/source path or whole plaintext string. Preparation failures clean their
own workspace; a successful caller must close in `finally`. Tests prove failure
teardown too. Copy caller inputs/key material before asynchronous work so mutable
arguments cannot change an in-flight identity. Do not close the caller's source
handle. Read-range identity is keyed and bound to profile/client/session/control
generation/epoch/range, not an unkeyed secret-dependent fingerprint. Reopening
the source for a later invocation must reproduce that identity before a frozen
request can be emitted. Source append outside the selected range is harmless;
changed/truncated range is not. Avoid claiming an atomic filesystem snapshot.

`planRawBatch` accepts one prepared handle and a trusted binding, then
returns one frozen bounded v2 request plus a content-free pending manifest and
the next in-memory position. Do not materialize all message parts or all batches.
The exact manifest is versioned and closed: client/profile/range and ordinal,
part index/start, totals, keyed content/source identities, generation/epoch and
event ID. No content, arbitrary free-text reason, transcript or spool path.
The event ID binds the exact canonical request identities; a replay cannot
repack to different part boundaries under the same ID. A restored manifest is
validated against freshly prepared handles before returning the identical body.

`classifyRawAcknowledgement(status, value, frozenRequest)` returns a closed
content-free decision (`complete`, `processing`, `quota_reached`, or refusal).
Only complete authorizes the caller to advance the pending part position. It
validates the exact message IDs/part indices, one disposition per requested part,
no extras/duplicates, correct saved/reason pairing and valid conversation/revision.
It cannot turn a failed interpretation into a success or treat an unverified
internal core envelope as an HTTP acknowledgement. A small explicit synthetic
host adapter can map real core results for end-to-end tests; that is not a new
production hosted route.

New schema/parser tests compare each other and actual generated bounded bodies;
they do not claim production schema adoption. Unknown request/ack properties,
unsafe integers, malformed dates/Unicode, absent required fields or over-limit
JSON bytes refuse. Existing v1 request/response golden bytes remain unchanged.

There is no general JSON AST and no per-block unbounded array. Streaming layout
selection may spool candidate text before trailing metadata establishes whether
it is eligible, but it dispatches nothing until the whole record is validated.
Duplicate selected/decision-bearing keys or unsupported shapes refuse visibly;
never guess a role/allowlist from an early substring. Preserve each layout's
actual key policy: Codex closed objects remain closed, while Claude's ignored
top-level metadata is streamed past rather than made a new closed schema.
A rejected tool/rich/machine
record may not leak candidate text through errors or diagnostics. The bounded
metadata limit counts object keys/selection state too, not only value strings.

Primary acceptance will use real supported layout fixtures, the current regex
oracle, actual `captureRaw` and fresh paged readers, not a second fake storage
engine. Include a no-text sent exclusion whose disqualifying metadata is after
an oversized text field, and a >262144-byte record with a >20000-unit selected
message. Measure the whole flow's heap/read/scratch bounds in a constrained
child. Do not infer a public client capability from this foundation alone.

## DTO decisions for the bounded foundation

The existing Raw contract's snake-case v2 transport, not the internal core
registration DTO, is authoritative. A frozen body is exactly
`{version:2,client,event_id,session_id,project_id?,messages}`. Each message is
`{id,role,occurred_at,message_ordinal,content,part:{index,start,totalUnits,totalBytes}}`.
The trusted namespace/owner, crypto port, notice/control grant and identity key
never enter this body. Client is one of the existing two supported keys; absent
project means personal, while a supplied project must be a valid existing host
project identity. IDs have the existing 1–200 UTF-16-unit bound; project has its
existing 128-unit bound. All strings are well-formed and NUL-free; occurrence
time is canonical UTC milliseconds or null. Arrays are dense; reject extras
and unsafe integers. Core and transport 65,536-byte limits are both checked by
the test adapter; a wire body fitting its limit does not waive the core limit.

Preparation's profile key is a finite constant (`raw-producer-v1`), not arbitrary
caller text. Codex's qualified format is supplied by a trusted format descriptor
constructed from the existing supported header gate; never infer that gate from
a text message. The read-only source handle supports positional reads. It cannot
be an arbitrary callback which changes text between metadata and emission.
Source identity is computed over the exact original record bytes plus the
trusted binding, and content identity over the fully selected/redacted text.
Both use separate HMAC purposes. They are not authority and are never sent as
unkeyed hashes. Re-read source identity after preparation before publishing the
handle, detecting observed mutation; document the normal filesystem snapshot
limitation instead of promising to detect a change-and-restore attack.

Successful handles are private branded objects with immutable metadata and a
bounded `readPart({start,maxUnits})` operation; permit only code-point boundaries,
safe integer ranges and `maxUnits` at most 4,000. No raw full-text getter. The
planner accepts branded handles, not caller-created metadata masquerading as
prepared data. One call yields one bounded batch, never all parts at once.
For the first implementation it is valid to emit one part per batch: this
preserves the required message-before-next-message ordering, all protocol
bounds and retry identity without an unnecessary batching optimization.

The content-free pending record is exactly versioned and keyed to this profile:
`{version:1,profile,client,sessionId,wireSessionId,projectId,generation,epoch,
range:{start,end},messageOrdinal,messageId,role,occurredAt,sourceIdentity,
contentIdentity,totalUnits,totalBytes,part:{index,start,end},eventId}`.
`projectId` is null for personal; the range addresses the current trusted source,
not a stored path. Fixed-length HMAC strings replace any source-dependent plain
digest. No free-text reason or content field is accepted. This describes one
message part, matching the initial planner's one-part batches; future batching
must get a separately versioned manifest, not silently repack this one.
Restore verifies every binding against a freshly prepared handle and emits the
same canonical serialized body. Cursor integration/persistence and key lifetime
remain P4b, with no API to infer a historical identity from a legacy pending
window. Source append outside the frozen range is allowed; changed or truncated
range is refused. Caller must retain the same trusted key across an authorized
restart; tests pass it privately rather than place it inside the manifest.

The complete success acknowledgement is closed and requires
`{version:2,duplicate,memoryCount,raw:{conversationId,revision,parts}}`, optionally
`processing:boolean`. Each exact part is `{messageId,index,saved,reason}` and
matches the frozen body once, with no extra/duplicate entries; saved requires
reason null, not-saved requires an existing finite Raw reason. Conversation ID
is valid and revision a positive safe integer. `memoryCount` is a nonnegative
safe integer. A valid processing response on 200/202 yields processing and never
progress; a terminal ack requires 200. The existing strict 429 quota envelope
is retained as quota, distinct from a terminal Raw part with `quota_reached`.
Other non-success statuses are finite refusals and never acknowledgements.
An internal result whose interpretation is failed cannot be mapped to this
success by the synthetic adapter. An eligible continuation-only result can.

Versioned JSON schemas express structural limits; code additionally validates
UTF-16/batch/serialized-byte budgets, valid surrogate boundaries, semantic
ack matching and manifest HMAC/bindings. State explicitly which checks are
semantic, rather than falsely treating a schema-only match as permission to
advance. Reuse existing test tooling for schema checks, with no new public
dependency or installed generated-schema bundle.

## Primary resolution of the four adapter audit questions

1. Claude uses trusted `selectionState:{ownSkillTurn:boolean,pluginRoot:string}`;
   the returned `nextSelectionState` is exactly `{ownSkillTurn:boolean}`. The
   supplied root is the actual loaded plugin root, never a transcript-derived
   path. Apply original turn transitions before empty-text exclusion, including
   assistant Skill-tool-only records. `toolUseResult:null` excludes by property
   presence, as the existing parser does. Keep old parser sources read-only;
   approve a separate streaming policy implementation using its exported finite
   constants and differential tests against actual `transcriptWindow` for
   withheld/state decisions. Those tests must include late structural metadata,
   typed exceptions, exact loaded-root matching, single-line control outputs,
   quoted control strings, long whitespace and policy-like text. A bounded
   prefix alone must never decide that an ambiguous complete line is ordinary
   conversation. Bound policy metadata or refuse visibly rather than transmit
   a control record. Do not turn that into a blanket long-message text cut.
2. Codex receives trusted `formatAuthority:{format,sessionId,creatorVersion,
   qualifiedCreatorVersion}`; the last field is null for an already frozen
   qualified creator, otherwise the explicit result of the host's existing
   creator qualification. Reuse actual `verifyHeader` on the source's first
   bounded record and compare its session/creator against this descriptor.
   Missing creator qualification retains `creator_unqualified`; invalid layout
   is `unsupported_format`. The source is an already-open authorized handle and
   the caller must have run existing interactive-originator/exec-resume gates.
   This descriptor is not a request/model boolean granting capture permission;
   it never bypasses the core's controls or notice policy. The foundation does
   not perform native-binary qualification or claim public installation support.
   Claude uses null formatAuthority; Codex selection state is an empty object.
3. Preserve a valid existing Claude UUID as its logical ID. Absent/null/empty UUID
   uses `raw2_` plus a purpose-separated HMAC over the fixed producer profile,
   client, trusted session/wire session and exact record range. Do not include
   clipped text, part index, occurrence time, control generation or message
   ordinal in this fallback: retries/parts/control changes cannot rename the
   same record. A supplied nonempty invalid/oversized UUID refuses visibly,
   not silently truncates. Mirror the core identifier restrictions (no leading/
   trailing whitespace, C0/DEL, malformed Unicode, or over200 UTF-16 units).
   Codex preserves the current metadata-only logical ID recipe
   `hash(PROFILE,'codex',wireSessionId,epoch,start,end)`; no native item ID fallback
   or text fingerprint is introduced. The new v2 event ID remains separately
   keyed/versioned and binds generation and exact part bounds. Source/content
   HMAC purposes differ from event/message identity. Legacy pending stays v1.
   For occurrence time take only a present top-level `timestamp` on either
   supported layout: validate with the existing UTC-calendar validator, then
   canonicalize to milliseconds via `toISOString()`. Missing/null is null;
   invalid supplied time refuses. Never substitute import/wall/file time or
   infer it from text; fractional precision finer than milliseconds is not
   claimed preserved. Session versus wire session follows each existing host's
   binding; both are explicit trusted inputs, not guessed from another field.
4. Structurally eligible records with no selected blocks or exactly empty
   joined text return `excluded/empty_text`, with next turn state. Whitespace
   and fully redacted text are valid Raw, regardless of whether later model
   normalization produces an empty interpretation. Finite excluded reasons are
   `non_conversation`, `meta`, `compact-summary`, `tool-result`,
   `machine-wrapper`, `own-skill`, `control-output`, `rich_input`, `empty_text`.
   Shape/Unicode/resource failures are errors, not invented exclusion reasons
   or successful cursor advancement. Codex ignored attachment blocks preserve
   the existing policy; nonempty text_elements excludes the entire user record.

## Initial helper exports and progress ownership

The new internal `integrations/client/raw/index.mjs` exports these entrypoints:

- `scanRawRecordRanges({source,start,end}, {limits?,signal?})`: async iterator of
  one `{start,end}` byte range at a time. Both bounds are explicit safe integers;
  the caller freezes the end. A complete range ends with LF (including CRLF).
  An unfinished final record returns `raw_source_incomplete`, not an implicitly
  consumed range. The scanner does not retain a roster of every prior range.
- `prepareRawRecord(input,options)`: exact preparation DTO already defined above.
- `planRawBatch({message,projectId,position})`: one branded handle and one
  position `{index,start}`, starting at `{index:0,start:0}`, plus null or a valid
  project identity. Returns frozen `{body,pending,nextPosition}`. `nextPosition`
  is null after the final part, otherwise the next `{index,start}`. Reading or
  planning does not durably advance anything. The host may adopt nextPosition
  only after a complete matching acknowledgement. Validate integer/boundary
  consistency; the real core remains the authority for contiguous part order.
- `restoreRawBatch({message,projectId,pending})`: validates the exact closed
  pending DTO and all current trusted bindings against the freshly prepared
  handle, reconstructing byte-identical body/event ID, or refuses without
  progress. Its output shape matches planRawBatch. Never trust a pending content
  identity instead of recomputing the selected source and redacted content.
- `validateRawRequest(body)` and
  `classifyRawAcknowledgement(status,value,frozenRequest)`: closed validation
  and semantic acknowledgement rules above. Validation copies/freezes accepted
  input; no caller mutation can change a subsequent match.

The prepare handle privately retains its copied key and trusted session/control
binding for event derivation; neither is serialized as authority. The initial
planner always uses the maximal code-point-safe part up to4,000 UTF-16 units.
Restore verifies the canonical part index/start/end sequence, not just that a
supplied span is inside the message. A bounded spool traversal may establish
that sequence after restart; no unbounded part-offset array is required.
`readPart` returns exactly `{start,end,text}` and never the entire message.
All helpers are synchronous only where their work is genuinely in-memory;
preparation, spool reads, planning and restore are asynchronous.

The handle's public `metadata` is a frozen object with exactly
`{id,role,occurredAt,messageOrdinal,totalUnits,totalBytes,sourceIdentity,
contentIdentity}`; trusted keys, sessions and other planner bindings stay
private. `close()` is asynchronous and idempotent. Once closed, reading or
planning refuses with `raw_source_unavailable`. Reading at `start===totalUnits`
may return the terminal empty range; a nonterminal read must make progress.
If a positive `maxUnits` cannot fit the next complete code point, refuse with
`raw_source_resource_limit`, never return an empty nonterminal part or split
a surrogate pair. An offset inside a surrogate pair is `raw_source_invalid`.
The normal planner uses4,000units and never emits an empty terminal message.

The source is a trusted positional file-handle interface supplied by the host,
not a wire-deserialized object or caller-supplied text conversion callback.
Synthetic tests may instrument that trusted interface to measure actual read
sizes and mutation schedules. Such instrumentation is not a public capability.
The helper validates read counts and EOF against the frozen range, copies bytes
before retaining them and never closes the caller-owned handle.

### Scalar/API details pinned before dispatch

The trusted `identityKey` is exactly32bytes (`Uint8Array`/Buffer), copied before
the first await; it is never included in outputs or errors. Generation uses
the existing control grammar `initial`,36 lowercase hex/hyphen characters, or
`legacy-` followed by64 lowercase hex characters. Epoch is a nonnegative safe
integer; message ordinal is a positive safe integer. Record ranges are
nonnegative safe integers with `end > start`; the scanner alone allows an
empty `[start,end)` interval. Trusted IDs follow the existing client/core
identifier restrictions, not permissive arbitrary strings.

`limits` is closed and contains optional `bufferBytes` (default16,384,
range1–65,536), `maxDepth` (default64,range1–64), `metadataByteLimit`
(default65,536,range1–65,536), `scratchByteLimit` (default536,870,912,
range1–1,073,741,824), and `deadlineMs` (default30,000,range1–300,000).
All are safe integers; lower limits are useful deterministic refusal probes,
not permission to enlarge another budget. Do not hide an unbounded string in
metadata or call a structural limit an ordinary-text admission limit.

The deadline bounds active producer operations, not a prepared handle's lifetime.
Completing preparation ends that operation's wall-clock allowance. A later
read/plan/restore receives a fresh bounded allowance; a restore's full canonical
traversal shares one allowance rather than resetting at each internal part.
Time the caller spends awaiting an acknowledgement between calls is not producer
work and must not expire an already prepared message. Likewise, a scanner's next
range operation does not charge time suspended at a previously yielded range.
The original AbortSignal still cancels subsequent operations. No operation may
continue after its own deadline, and no extra time permits dispatching expired
work. This clarification does not increase the30-second default or add a worker
scheduler; it separates producer work from caller-owned progress/network waits.

Foundation APIs reject with an Error whose `code` and `message` are the same
fixed finite code above; no source text, path, provider exception or arbitrary
version value is attached. Invalid preparation/scanner bindings and malformed
source use `raw_source_invalid`; invalid request or pending structure uses
`invalid_capture_v2`; malformed/mismatched acknowledgement uses
`invalid_capture_ack`. Valid non-success acknowledgements return the specified
content-free disposition and never grant advancement. Existing header helpers'
extra version fields are not copied into this API's errors.

Acknowledgement decisions are frozen one-field objects
`{disposition:'complete'|'processing'|'quota_reached'|'refused'}`. A malformed
or semantically mismatched success/processing/429 payload throws
`invalid_capture_ack`; other HTTP failures return `refused`, with no response
prose. A valid terminal Raw skip still returns `complete` because its exact
disposition is durable; this does not turn an internal failed interpretation
into an ack. The existing core result must be checked separately by the
synthetic host adapter. No helper writes or adopts a cursor.

## Next seam already constrained by the existing client plan

P4a does not deliver LAC. `docs/plans/codex-client.md`'s LAC contract calls for
one-shot local Node subprocess transport (bounded64KiB stdin/256KiB stdout),
not a new HTTP daemon, text queue or second memory engine. It binds authority
and configured model access at startup. The existing loopback feasibility
server is explicitly a stand-in, not production local capture. P4b must inspect
the current LAC/HMA delivery state and existing consent/model-call guards before
claiming both installed clients capture locally. API-key and host-CLI modes
have distinct existing availability/policy gates; do not silently change them
or treat Raw-only mechanical verification as approval for background inference.
The product's `cd6d1ad` pin is unchanged by this foundation.

## P4a acceptance and supervision roster

These are observable gates for the already defined foundation, not additional
product features. P4a is one dependent packet inside completion step3; it is
not a substitute for P4b's installed client and full lifecycle work.

| ID | Required evidence |
| --- | --- |
| P4a-01 | Both actual layout adapters preserve eligible exact text and next selection state, with complete-record late privacy decisions. Existing parser/golden behavior remains unchanged. |
| P4a-02 | All eight redaction stages match the existing native oracle on fixed adversarial and seeded cases across tiny and ordinary I/O buffers, including long unresolved tokens, EOF, greediness and assignment prefixes. |
| P4a-03 | Exact bounded v2 requests feed real captureRaw and reopened paged reads. Both clients reconstruct long Unicode messages; continuations make zero additional model calls and charge no duplicate bytes. |
| P4a-04 | A fresh process reconstructs first, middle and final pending bodies exactly. Appending outside the frozen range works; changed/truncated/missing ranges and mismatched key or trusted binding refuse without progress. |
| P4a-05 | Closed request, pending and acknowledgement validation enforces structural and semantic bounds, immutable copies and exact part dispositions. Only complete matching acknowledgements authorize advancement. |
| P4a-06 | A constrained-heap child and instrumented reads/scratch establish bounded working state and maximum two simultaneous private stage files. Success, exclusion, malformed input, resource exhaustion, injected I/O failure and cancellation clean owned scratch without touching foreign replacements. |
| P4a-07 | Frozen final source passes both Node22.16 and24.15 affected suites, unchanged v1 golden/client regression, schema checks and explicit CI discovery of the new test roster. Primary personally reruns the integrated cases. |
| P4a-08 | Same fixed candidate passes independent non-author Standards and Spec review, then latest-head CI and mergeability. No automatic merge, installed capability, deployment or new score claim. |

Read-only preflight by `/root/raw_p3c_dedup61` (actual GPT6.1Sol/high) on
2026-10-21 found no concrete contradiction between the pinned contract and
the actual parser/core seams. It ran no tests and changed no files; that is
feasibility feedback, not verification. Its candidate module decomposition is
source/scratch, streaming JSON, two adapters, ordered redactor, private message,
protocol/planner and an internal export index. Only one worker will own their
shared implementation. Primary owns the contract, separate acceptance probes
and gate orchestration. Reviewers must not be that author.

Worker checkpoints: (1) bounded source/JSON/selection with differential cases;
(2) full redactor equivalence and private message/parts; (3) replay/protocol/core
integration and resource/cleanup evidence; (4) final freeze and review. Report
at each seam, on a concrete contradiction, or after20minutes without a completed
checkpoint. Preserve failed evidence and test the cause before changing scope.
Do not keep retrying a failed hypothesis: after two unsuccessful correction
rounds on the same problem, primary re-scopes or takes a bounded integration
takeover under the shared routing policy. The user's12–18hour discussion
checkpoint still applies to the overall continuous-work segment.

## Primary early integration and bounded corrections

The unchanged primary synthetic producer/protocol suite plus a separate resource
suite passes38/38 on Node22.16, actual exit0 (31.402s), before freeze. Both actual
client layouts reconstruct complete selected/redacted messages beyond262,144
source bytes through the real core and reopened paged reads. The cases also
exercise late exclusions, fresh-process first/middle/final replay, Unicode
boundaries, strict acknowledgements and success/failure scratch cleanup. This
early result is not final-source acceptance, public installation or a semantic
benchmark. Evidence: `p4-primary-early22.log` in
`/tmp/cairn-raw-p3c-evidence.n7PShP`.

Worker's first tiny-buffer oracle test exceeded the unchanged30-second bound:
9/10 pass, exit1. It incorrectly reused the tiny source buffer for scratch I/O.
Fixed bounded16KiB scratch buffers, while retaining the caller's source-read
limit, pass the exact10-case loop, actual exit0 (9.37s). Final resource evidence
must measure the actual buffers and simultaneous files/bytes, not just constants.

An independent three-case lifetime probe then exposes the clarified boundary:
preparation succeeds, but caller idle time makes a subsequent read and scanner
next fail with `raw_source_resource_limit`. Node22 actual exit1,1/3 pass; the
post-preparation cancellation control passes. Keep `p4-primary-lifetime-first22.log`.
Worker must fix operation scoping and rerun the probe unchanged, preserving a
single bound through each restore traversal and continued cancellation checks.

The primary's independent native-redactor oracle passes39 fixed cases at both
7-byte and16KiB source buffers plus2,000 fixed-seed cases:2,078 comparisons,
three tests, actual exit0 (41.382s), `p4-primary-redaction-first22.log`. This
establishes equivalence for those inputs, not detection of every possible secret.

Two further small primary probes retain actionable reds. Request validation
accepted duplicated/reversed message ordinals even though the real journal
rejects them; `p4-primary-order.test.mjs` exits1 with its valid-order control
passing before the missing refusal. The fix must enforce increasing ordinals,
without inventing policy assumptions about incomplete Raw-policy-skipped parts.
Initial scratch creation also leaked native filesystem errors outside the
finite-error boundary; injected directory-open failure left one empty owned
directory. `p4-primary-open-failures-first22.log` is0/2, actual exit1. The worker
must cover initialization in the cleanup/error boundary and recover owned
resources where identity can be established. Never unlink an unverifiable or
replaced path merely to report clean teardown; irrecoverable ownership/cleanup
failures remain explicit refusals with retained state, not a cleanup guarantee.

Primary reran the lifetime, initial-I/O and ordinal probes unchanged after the
bounded corrections:6/6, actual exit0 (1.445s),
`p4-primary-corrections22.log`. Caller idle no longer consumes the next active
operation's allowance; cancellation still works. Both one-shot initialization
faults now return only `raw_source_unavailable` and leave zero owned residual
entries. The original reds remain retained. This is not a promise to remove a
path whose ownership cannot be verified or survive an uncatchable host crash.

A further primary pending-record probe found9 malformed scalar/range variants
already refused, but with `raw_source_changed` rather than the pinned
`invalid_capture_v2`. The valid changed-generation control passed. Preserve
`p4-primary-pending-first22.log` (actual exit1); this was incorrect error
classification, not accepted invalid progress. Closed typed validation now
precedes copying the manifest. The same unchanged probe passes11 test nodes,
actual exit0, `p4-primary-pending-corrected22.log`. A valid-but-different binding
still reports a source change.

The separate late scratch-read fault probe passes2/2 on its first run, actual
exit0 (`p4-primary-part-io-first22.log`): both public part reading and planning
sanitize an injected filesystem error/path to the finite unavailable code.
This is counterevidence to a suspected gap, not another observed/fixed defect.

Worker measured ordinary sequential planning before adding a single bounded
private position cache: a24,000-unit/six-part synthetic message read168,070
scratch bytes; the same measured path reads48,020 after caching, both actual
exit0. The cache contains one canonical position, not all part offsets, and
is never durable cursor or acknowledgement authority. A new process still
reconstructs canonical positions under one bounded restore operation.

Final constrained-heap acceptance uses a32MiB streamed assignment prefix,
the synthetic suffix `_api_key=` and128 value characters, with a32MiB V8
old-space limit and an explicitly selected300-second operation limit. It must
assert bounded source/scratch reads, actual simultaneous stage files/bytes,
expected redacted last part and cleanup. This deliberately tests a long
redaction candidate rather than only the stage-fast-skip path. Its result must
not be advertised as fitting the default30-second allowance. The earlier
20MiB ASCII fast-skip run alone is insufficient to establish that stronger claim.

Primary also exposed a deterministic-replay defect before candidate freeze:
the same source/key/trusted binding values, reconstructed with reversed object
property order, produce different source identities for both clients. The
source HMAC was serializing caller insertion order; Claude's fallback message
ID similarly includes the uncanonicalized range object. The independent
`p4-primary-binding-order.test.mjs` first run is0/2, actual exit1 (85.56ms),
retained as `p4-primary-binding-order-first22.log`. Object construction order
is not a source or authority change. Construct the closed binding explicitly
in canonical field order, including nested range/selection/format fields,
before deriving identities. Preserve every actual value/mutation refusal and
rerun the unchanged primary oracle; do not sort or admit arbitrary extra input.

After the explicit canonical DTO correction, primary reran that same two-client
oracle unchanged:2/2, actual exit0, `p4-primary-binding-order-corrected22.log`.
The worker additionally tests fresh-process replay and actual changed-epoch
refusal. Pending HMAC fields now require exactly64 characters as well as the
hex pattern, rejecting a trailing-newline `$`-anchor edge before source matching.
These changes affect only unpublished internal v2 identities, not v1 fixtures.

The completed pre-correction tracked roster is35/35, actual exit0 (18.164s),
`worker-p4-combined22-first.log`. Its32MiB long-assignment child takes14.099s,
with actual source/scratch read/write maxima16,384bytes,2 simultaneous stage
files,134,218,276 peak simultaneous owned scratch bytes, zero open handles and
zero residual entries. The reported9,616,672-byte heapUsed is an endpoint
observation, not a peak heap/RSS measurement. Its explicit300-second allowance
remains disclosed. Final-source runs must repeat the affected roster after the
canonical-identity correction; this old result is not silently relabelled.

### Final-source gate selection

Freeze all worker files before the final matrix; primary-owned plan records may
be appended separately. Cross-check incremental and cumulative inventories via
Git name-only output and independent base-tree/filesystem hashing. The final
worker digest must match before and after every reused group of results.

On both Node22.16 and24.15 run the explicit new `test:raw-producer` roster,
primary producer/protocol/replay/resource/correction cases, and the independent
native-redactor oracle. The constrained-heap resource case belongs to that new
roster and must run on both. Primary personally reruns the real producer→core→
reopened-reader path and the resource child on the frozen bytes. Retain actual
exit codes, counters, cleanup and any explicitly raised probe deadline.

The unaffected-v1 regression matrix on both runtimes is shared client, Codex,
pairing, original golden fixtures, generic plugin/architecture, JSON validation,
generated-client parity, setup-runtime parity and the native plugin validator.
Use an owned private launch ancestry for real `/proc` qualification fixtures;
do not disable their home/host guards or target an interactive user's pane.
Run timing-sensitive suites serially and supervise progress/teardown. Uninstalled
P4a changes no core/runtime, installed package closure or setup implementation;
full core/MCP/artifact/setup matrices remain in latest-head CI, while primary's
actual-core producer cases verify the new connection locally. This is not a
substitute for P4b's later installed Raw lifecycle acceptance.

Freeze a scoped local candidate after the offline gates, inspect the current
contributor/runtime/CI configuration, then repeat primary key paths and both
non-author review axes on that same SHA. Push only after reviews pass; latest
remote-head checks and mergeability still precede PR readiness. No merge or
product pin change is authorized by a passing gate.

Parallel installed-recall repair [PR #454](https://github.com/Cairn-ink/cairn-memory/pull/454)
is independently delivered at `5345318950ffb4046e99532f56988d76fb47ed77`:
both non-author review axes accepted it, all31 latest-head checks pass, and
the merge tree matches the candidate. It is ready/unmerged; no deployment or
product pin update occurred. That repair is not included in P4a's fixed P3c
base or counted as Raw acceptance. The product handoff is
[wiki #453 comment](https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6311652844).

### Primary frozen-source acceptance

The final worker manifest contains28 paths; its SHA256 is
`29bca7b1cf913a51d3e6789ebab7ec9ebaf4e0d979ed82fa484a6f5c38945a88`.
Two independent inventory routes (Git diff/untracked paths and base-tree versus
filesystem blob/mode comparison) agree on30 incremental paths, including the
two primary-owned plans, and106 cumulative paths against public main `cd6d1ad`.
All28 worker file hashes match the manifest; plans are separate evidence records.

Primary personally ran the ten independent producer/protocol/resource/lifetime/
failure/order/pending/replay-binding/redaction probe files serially on those
bytes:62/62 on Node22.16, actual exit0 (62.144s), and62/62 on Node24.15, actual
exit0 (64.851s). Evidence is `p4-primary-final22.log` and
`p4-primary-final24.log` under `/tmp/cairn-raw-p3c-evidence.n7PShP`.
This includes2,078 native-redactor comparisons and both real producer→core→
reopened-reader paths, not model responses or user transcripts.

Primary separately ran the final tracked resource roster:12/12 on Node22.16,
actual exit0 (14.727s), and12/12 on Node24.15, actual exit0 (15.728s), in
`p4-primary-final-resource22.log` / `p4-primary-final-resource24.log`.
The32MiB long-assignment child reports16,384-byte maximum source/scratch reads
and writes, two simultaneous stage files,134,218,276 maximum simultaneous
owned scratch bytes, zero open handles and zero residual entries on each
runtime. Node24's child takes13.817s and reports5,668,416-byte endpoint heapUsed;
Node22 reports6,682,168. These are not peak heap/RSS measurements and the probe
explicitly allows300 seconds rather than claiming default-budget fit.

The separate20-command final compatibility matrix runs serially under an owned
private tmux ancestry with a30-minute outer bound and30-second actual-progress
reports. It verifies the exact worker manifest before/after every gate and both
inventory routes before/after the matrix. Source mutation, a gate failure,
interruption or unverified owned-process/workspace cleanup is failure, not a
silent retry. Results and final cleanup must be inspected before candidate freeze.

### Final compatibility matrix accepted locally

Primary inspected all20 command records: both Node22.16/24.15 pass the new
Raw roster37/37, shared client5/5, Codex198/198, pairing270/270, original golden
verification and generic plugin/architecture635/635, plus validation, both
generated-runtime checks and strict native marketplace/plugin validation. Every
command has actual exit0; no test failures, skips, cancellation or retry. The
generic runs take324.440s/321.783s. Temporary quiet output was traced to buffered
imported pairing cases with progressing child activity, not treated as a stall.

`worker-p4-matrix-report.json` records code0/completed20 and the same28-file
manifest before/after every gate. Primary separately checked all28 hashes and
reran both inventory routes:30 incremental paths, actual exit0. The supervisor's
final cleanup verified277 observed owned process identities, zero running owned
processes, absent private tmux server/socket and removed owned workspace. No
historical temporary directories or user processes were touched. This completes
local frozen-source gates, not fixed-candidate review or remote PR acceptance.
The supervising outer execution also terminated with actual exit0; a report
file alone was not substituted for the process result.

### First fixed-candidate review and bounded correction

The first local candidate `e8e5b11257528bfd04f1d21dc4e8cbfac8ca4fa1` is
not pushed. Primary repeated the producer→actual core→reopened reader,
fresh-process replay, protocol, ordinal and property-order paths on that commit:
28/28 on Node22.16 (20.471s) and24.15 (28.362s), both actual exit0.
The28 worker hashes still match the earlier20-command matrix; the worktree was
clean. Current CONTRIBUTING, scripts and CI configuration were inspected again.

Independent non-author GPT6.1Sol/high Standards review finds zero documented
breaches and one optional Repeated Switches observation in the client selection
policy. This is not a functional or privacy finding. Keep the current explicit
two-client policy boundary; future installed closure work may gather the policy
selection without changing this packet's behavior.

Independent non-author GPT6.1Sol/high Spec review requests one low correction:
the429 quota acknowledgement accepts65,537/65,538 serialized bytes when an
otherwise valid UTC timestamp has a long fractional component. The existing
65,500-character field check does not bound the full JSON envelope. It never
grants progress, but violates the pinned65,536-byte boundary. Primary's separate
four-case oracle accepts65,535/65,536 and requires refusal at65,537/65,538;
before correction it passes2/4, actual exit1, retained as
`p4-primary-ack-limit-before22.log`. No provider or database was involved.

The author receives only a bounded protocol/test correction: measure the full
acknowledgement size after shape bounds and keep exact-limit acceptance. The
independent probes remain unchanged. Repeat the entire new producer roster and
focused primary cases on both runtimes plus validation/generated parity, then
freeze a new candidate for both review axes. Previous broad compatibility
results remain tied to the earlier unchanged legacy closure, not relabelled as
a newly executed full matrix. Latest-head CI still runs the complete required
matrix. No v1 parser, core behavior, resource setting or installed capability is
changed to fix this boundary.

### Acknowledgement correction accepted locally

The bounded correction changes only protocol validation, its regression and
the retained-failure note; primary owns the two additional plan records.
The immutable independent four-case byte oracle now passes4/4 on each runtime;
the separate Spec oracle also passes unchanged. The explicit new producer roster
is38/38 on both Node22.16/24.15. Validation, client bundle parity and setup-runtime
parity also pass on both. All12 affected commands and the supervising runner
exit0; every gate leaves only its synthetic home, and the owned workspace is
removed at completion. The initial failing probes remain preserved.

Primary inspected the complete correction and all12 actual command statuses in
`worker-p4-ack-gates.log`; the author reports outer session18930 exit0. Two
independent inventory routes again agree on30 cumulative packet paths/28 worker
paths, including exactly3 changed worker paths since the first candidate.
`worker-p4-ack-freeze.sha256` preserves the new worker snapshot separately from
the original matrix freeze. The original20-command broad matrix is not claimed
as a rerun on changed protocol bytes. Post-commit integrated primary checks,
both independent reviews and latest-head full CI still gate delivery.
