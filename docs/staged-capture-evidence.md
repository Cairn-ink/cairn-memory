# Staged capture evidence — embedded opt-in

`captureEvidence: 'staged-v1'` separates a bounded submitted source view from
successful interpretation. It requires source-bound-v2 capture and is off by
default. This is an embedded shared-core feature, not a new memory engine,
hosted endpoint or MCP capability. Causal capture is rejected in this first
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
retention and lifecycle boundaries, not semantic quality. MCP/native host
exposure, precise source-lineage deletion, automatic retries, promotion,
background maintenance and general reliability claims are outside this slice.
