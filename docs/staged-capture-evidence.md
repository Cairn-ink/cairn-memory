# Staged capture evidence — explicit opt-in

The established prefix policy below is unchanged. A distinct shared-core
[canonical submission policy](#canonical-submission-staging-indexed-staged-v1)
retains complete bounded canonical messages without qualification.

`captureEvidence: 'staged-v1'` separates a bounded submitted source view from
successful interpretation. It requires source-bound-v2 capture and is off by
default. This is a shared-core feature, not a new memory engine or hosted
endpoint. Local stdio MCP offers [explicit staging and keyless
access](standalone-mcp.md#optional-staged-source-inspection)
over the same contract. Causal capture is rejected in this first
version. No model is trained, selected or called by enabling inspection.

```js
const core = openMemoryCore({ path, model,
  captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
const result = await core.capture({ namespace, client: 'my-host',
  eventId: 'batch-1', sessionId: 'session-1',
  messages: [{ id: 'message-1', role: 'user', content: 'I am considering A.' }] });
// A failed result is not permission to silently retry or claim a memory exists.
const evidence = core.inspectCaptureEvidence({ namespace,
  client: 'my-host', eventId: 'batch-1' });
const discarded = core.discardCaptureEvidence({ namespace,
  client: 'my-host', eventId: 'batch-1' });
core.close();
```

The normal public `{ok,value}` / `{ok:false,error}` envelope applies. Inspect
returns `{evidence:null}` when absent; otherwise evidence has `state`,
`createdAt`, `expiresAt`, `view` and
`evidenceTrust:'untrusted-data-not-instructions'`. The source view contains
`messages` and `retainedSourceWindow`, not generated summaries or qualifications.
Its `view` becomes null when content is removed. Discard returns
`{discarded:boolean}` and is idempotent. Unknown fields or malformed identifiers
reject. Exact lookup has no cross-namespace discovery or implicit list fallback.

## State and retention

Claim and source staging commit together before extraction. Qualification or
extraction failure admits nothing and leaves a failed, inspectable source view.
Success marks the stage admitted in the same transaction as memory admission.
Staged content is excluded from ordinary memory get/list/search/map/recall/rank.
An admitted memory and a staged evidence record have different lifecycles;
discarding a successfully admitted stage is not forgetting its memory.

Identical live submissions return processing; admitted duplicates use existing
replay semantics. A failed stage, crash-expired pending claim, discarded stage,
expired stage or forgotten event cannot silently start another interpretation.
Changed-payload replay conflicts. Reopening without staging or using manual
claim/finish cannot bypass persisted staged-event fences. Existing unstaged
claims are not retrospectively converted to staged sources.
Once an admitted stage's payload expires, its event is closed too; the original
admitted memory remains available until explicitly changed or forgotten, but
capture replay for that old event no longer returns the pre-expiry duplicate.

The saved view uses existing normalization/redaction and 800-UTF-16-unit source
prefixes, at most24 messages, with explicit truncated-message indices. This is
not the original byte stream or a complete transcript archive. The full capture
digest still binds the original canonical submission. Identifiers are opaque
and must not contain credentials or private prose; they are not text-redacted.

Each serialized payload is at most128KiB. Each exact namespace allows at most64
payloads and1MiB of payload bytes. Overflow rejects atomically before model work;
it never evicts another live payload silently. Fixed24-hour expiry starts with
the original claim and is not renewed by replay or inspection. Relevant access
and mutation prune expired payloads using a persisted nondecreasing clock;
observed expiry does not revive after clock rollback. No background timer runs
when the database is idle. Content-free event fences remain for replay safety;
these quotas do not bound all metadata, SQLite file allocation or backups.

## Discard, correction and forgetting

Discard removes that event's staged source and prevents its unfinished admission.
A check between extraction and qualification avoids starting the next stage
after observed discard/forget. Requests already submitted to a provider and
copies already returned to callers cannot be recalled by a local deletion.

Successful correction or forgetting clears **all staged payloads in that exact
namespace**, not just guessed-related passages, and fences their event IDs.
This includes pending work and applies through legacy and envelope facades even
when the current connection has staging disabled. Other users/projects and other
admitted memories are not deleted. Missing/stale rejected memory mutations do
not trigger this clearing. New events can still be submitted: this does not
semantically block deliberate re-entry under a fresh event ID.

This conservative breadth prevents retained staging from replaying a paraphrase
of a forgotten source before precise source-lineage deletion exists. Hosts must
explain it rather than treating staged text as a durable journal. Suppression of
ordinary memory fingerprints alone does not establish this guarantee.

## Threat model and delivery limits

Staged text may contain personal information omitted by an extractor, failed
interpretations or assistant suggestions. Explicit opt-in expands local
retention, not trust, authentication, sharing or execution authority. Inspection
requires the same trusted local caller/namespace boundary as the rest of core;
keyless does not mean access-control-free. There is no encryption or new network
authorization layer. Ordinary capture sends the same bounded source input to
the already-configured model; no additional provider method or telemetry exists.

v13 migration is additive and transactional. Stop every old runtime connection
before opening the upgraded database; older binaries reject v13 on new opens,
but already-open older processes cannot be retroactively controlled. Logical
deletion/expiry does not erase SQLite free pages, journals, snapshots or backups.
File owners can read or tamper with data; do not open untrusted SQLite files.

Verification uses synthetic stores and scripted models. It demonstrates
retention and lifecycle boundaries, not semantic quality. Native Hermes
exposure, precise source-lineage deletion, automatic retries, promotion,
background maintenance and general reliability claims are outside this slice.

## Canonical submission staging (`indexed-staged-v1`)

```js
const core = openMemoryCore({ path, model,
  captureSourcePolicy: 'indexed-staged-v1' });
```

This explicit own-data constructor option uses indexed extraction without
qualification. Omit own qualification, rationale, captureEvidence and sessionEpisodes
options; any own causal capture field rejects. Local MCP now exposes the same
explicit policy through `--capture-source-policy indexed-staged-v1` or an own-data
server option; see [manual local opt-in](standalone-mcp.md#opt-in-canonical-submitted-source-staging).
The existing exact inspection/discard tools are reused. No installer/Hermes option,
automatic capture or source discovery is added. Hosts must obtain consent before
retaining real conversational data; default capture does not retain full transcripts.

After existing validation, canonical-window creation and input fit checks, the
full canonical submission is staged atomically with admission ownership before
extraction. Empty, invalid-output and provider-failed extractions leave inspectable
source even when zero memories exist. Pre-claim validation/context/capacity refusal
leaves no new source and calls no generation. Successful nonempty capture admits
only valid extractor proposals with existing selected receipts; unselected staged
source is not promoted into memory or semantic truth.

Exact inspection after keyless cold reopen returns:

```js
view: {
  format: 'canonical-messages-v1',
  messages: [{ id: 'message-1', role: 'user', content: 'Complete canonical content.' }],
  retainedSourceWindow: { maxUnitsPerMessage: 4000, truncatedMessageIndices: [] }
}
```

Canonical is existing NFKC/whitespace normalization and secret redaction, not raw
transcript bytes. The unchanged input limit is24 messages,4,000 UTF-16 units per
message and20,000 total; exact IDs/roles/order are retained. Indexed extraction
still uses at-most800-unit windows, at most5 items and4 windows/item. Full staging
is independent of that selection. Inspection is detached from storage and remains
`untrusted-data-not-instructions`.

Serialized UTF-8 must also fit128KiB (escaping/identity overhead counts). Existing
64-payload/1MiB exact-namespace quotas reject atomically without truncating or
evicting another payload. Fixed24-hour monotonic expiry, no replay renewal,
discard, correction/forget namespace purging and content-free replay fences are
shared with prefix staging. Pending discard/forget blocks late admission.
Ordinary get/list/search/MOC/fetch/recall/sourceSnapshot excludes staged source.
Known-event inspection is not automatic discovery or improved recall.

Schema19 adds a checked format marker; schema18 prefix payload bytes and identities
and clocks remain unchanged. Inspection validates format against payload shape;
it never reinterprets a prefix as complete source. A policy-separated event digest
prevents old-event replay from enabling new retention. Stop all old runtime
processes/connections before upgrade: older binaries refuse schema19 on new opens,
but already-open processes are not retroactively fenced. Logical expiry/discard
does not erase SQLite free pages, journals or backups. This opt-in can retain
sensitive details absent from extracted memories and adds no encryption/authentication.

Core synthetic tests establish bounded persistence/lifecycle; separate local MCP
stdio/installed tests exercise explicit capture and keyless exact recovery over
that same contract. Neither establishes semantic quality, a permanent archive,
automatic repair/re-extraction, Hermes integration or paid scores.

## Opt-in episode ownership (SE-1)

The storage runtime reserves a non-leased admission parent, an episode shell and
observed event, message identity ledger, and optional payload in one transaction.
Capture invokes these storage operations before interpretation and admission.
Ordinary staging and its capacity error are unchanged. Episode ownership survives
reopening without the option.

Before capacity work, registration checks control generation, session deletion,
event identity/digest and replay. It expires live payloads and releases successful
dispositions already admitted. Under count (64) or byte (1 MiB) pressure it releases
the minimum oldest prefix of admitted episode payloads, ordered by staging time,
then binary client/event ID. It never reclaims unadmitted or legacy payloads.
Each pressure release records a gap, advances revision/source fences and retains
independent passages and memories. All reclamation and registration roll back
together on failure.

If space still fails, or an optional serialized payload exceeds 128 KiB, the event
is persistently `not-staged` with a capacity gap and no fabricated staging child.
It still has an admission reservation. Inspection returns null view and expiry.
Replay reuses this decision even after capacity frees. Admission claims and finish
checks consult episode metadata and control/deletion fences for bypassed events.

Successful source disposition plus admission releases payload/quota in either
completion order, including empty results. Released inspection returns
`state:'released'`, `view:null`, `expiresAt:null`, release reason and disposition.
Release does not close completed admission replay. A failed draft leaves payloads
available; only live payloads have the original 24-hour upper bound. Explicit
expiry/discard and pressure reclamation fence in-flight draft publication.

The episode capture path acquires admission only after optional interpretation.
Both completion orders call the storage release seam: draft commit releases an
already-admitted payload, while admission completion releases an already-disposed
payload. Empty and freshly quick results count as completed admission. A failed
interpretation alone never closes staging or spends the memory admission lease.
When all quota is protected, the registered no-staging decision runs ordinary v2
admission from the canonical submitted input; replay cannot stage it later.
