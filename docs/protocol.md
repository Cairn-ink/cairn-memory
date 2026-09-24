# Compatibility protocol v0.1

### Offline synthetic evidence-lineage boundary

The maintainer-only `demo:synthetic-lineage` runs fixed synthetic sources through
the embedded core and the existing public comparison. It uses a fresh temporary
store, scripted callbacks and no provider credentials or historical data. The
report contains only fixed scenario names, fixture-local source ordinals, counts,
closed statuses and explicit unknown/overflow markers. Source, question and
answer text, identifiers, paths, raw errors and source-derived hashes are excluded;
transient identifiers are used only to join capture receipts to later refs and
answer-packed receipts while the case runs. The wrapper adds read-only `core.get`
calls after capture to join admitted memories to receipts; it preserves model
callback inputs, outputs, errors and order. These fixed one-chunk-per-turn
fixtures are not a general multi-receipt tracer or a live benchmark artifact.
This local diagnostic adds no core,
MCP, HTTP or hosted telemetry field, and captured metadata must never enter
hosted telemetry. Linked evidence proves provenance plumbing, not semantic
truth or answer correctness. An unobserved stage is unknown, not a measured
zero or loss.

### Experimental public-pilot answer boundary

The evaluation-only public comparison and pilot accept an explicit
`cairn-longmemeval-public-answer-v2` opt-in. It changes only the answer user
message from v1 `{question,evidence}` ordering to
`{evidence,currentQuestion}` ordering, identically across all three arms.
The system instruction, provider controls, evidence, scoring rubric, guard,
limits and retry policy are unchanged. Identity is retained through private
pilot artifacts, resume and offline merge so v1 and v2 cannot be mixed. This
does not change the public core, plugin, MCP, HTTP, or telemetry protocol.

### Private public-pilot diagnostic boundary

The optional live public-pilot runner writes a per-case `diagnostics.json` only
inside its private 0700 run directory. This is benchmark-local observation, not
a hosted protocol field, telemetry event, model request, public comparison
response or scoring input. It does not widen HTTP, MCP, core or adapter
contracts. Ordinary answer callbacks remain exactly `{text,usage}`.

The artifact contains only the opaque case ID; fixed version, stage, layer and
reason categories already allowed by model diagnostics; runner-owned answer
order and arm categories; `stop`/`length`; availability markers; fixed limits;
drop counts; and separately versioned capture-admission and recall-stage
subsections.
That subsection is `cairn-capture-admission-observation-v1`, contains at most 64
rows, and projects only a batch ordinal, `completed|partial|failed|unavailable`,
finite admitted-reference and suppression counts, a duplicate-event boolean and
`skipped|applied|failed` classification status. Unsupported fields are `null`;
malformed projections are unavailable, not zero.

The `cairn-recall-stage-observation-v1` subsection adds only bounded ordinals,
counts, booleans, closed status enums and explicit overflow state. It projects
visible selection-map shape, model-returned select/rank ref counts and the
existing final core map/fetch exhaustion booleans. Returned ref identities may
be compared transiently for a cumulative unique count but are neither retained
nor hashed. Accessors and `toJSON` are not invoked to produce the projection;
malformed or inaccessible metadata is unavailable/null. These counts precede
core validation and do not assert that a ref was accepted, relevant or correct.
The ordinary retrieval `candidateCount` still means final core-returned memories,
and `selectedCount` still means answer-packed items.

The artifact never accepts provider/model exception strings, raw responses,
request bodies, source or answer text, headers, keys, paths, memory/receipt/
source identifiers or arbitrary observer fields. Every observed field is read
once, checked against the fixed allowlists and projected into a new object.
Prospective core extraction validation uses fixed output-shape, item-shape,
text, value, source-shape, duplicate-source and source-range reason categories.
These categories retain neither returned values nor indices and do not recover
the branch behind an older `invalid_extraction` catchall.
Model and capture events are each capped at 64 per case and answer completion
rows at the three fixed arms; overflow is counted, not retained. Recall-stage
selection retains at most two rows and rank/final recall at most one, with a
separate bounded invocation counter and explicit overflow uncertainty. Capture
and recall observations wrap runner-owned core calls and are available
independently of a session's optional model-diagnostic hook. They preserve the
original response, exception, call order and request and do not change the
public core response or any HTTP/MCP/adapter wire contract.

The real benchmark session binds collection to each asynchronous case
invocation and keeps sessions separate. Work spawned in an earlier case retains
that earlier collector even if it completes after another case begins; once a
collector closes, late events are ignored and cannot be reassigned. This avoids
cross-case attribution but does not prove complete delivery. `available` means
the hook was installed, not that an empty list proves no error. A missing file,
an unavailable row, a legacy/custom session or a case blocked before generation
is non-evidence. These local files share the run directory's ordinary
filesystem, journal, backup and secure-erasure limitations and grant no
authority or semantic correctness.

The separate prospective `case-deadline-v1` benchmark capability adds no hosted
or public core field. Its private operator-controlled files contain only bounded
authorization/execution IDs, the existing ledger/policy/benchmark configuration,
opaque source-free case IDs, ordered generation/scoring phases, checkpoint
counters and a SHA-256 digest of historical accounting rows. The digest is a
consistency binding, not anonymization; attempt identifiers and cost/outcome
metadata remain sensitive local experiment data. The one-shot claim grants no
new allowance and is never automatically removed or reset.

The private benchmark request-allowance record changes only the finite request
cap on that same ledger while preserving its run ID, monetary ceiling, ordered
attempt history, outcomes and reservations. It contains the old/new ledger
configuration, existing policy and benchmark grant, authorization IDs,
checkpoint counters and the same content-free five-field accounting digest.
The digest and IDs remain sensitive local experiment metadata, not anonymized
telemetry. The record contains no key, prompt, source, answer, provider body or
raw error, grants no new model/method/stage, and cannot reset, refund, retry or
resume an old execution.

The private `benchmark-budget-extension-v1` record is a single explicit
monetary transition on the same run to strictly higher finite monetary and
request ceilings. This campaign separately pins those parameters to cumulative
`50_000_000` → `100_000_000` micro-USD. The record embeds and re-verifies the exact request-allowance
grant, unchanged policy/stages, settled checkpoint, and five-field history
digest. Its create-only private file is durable before a conditional transaction
changes only the two ceilings. Original bindings and attempt history remain
unchanged; unknown outcomes stay charged. Loading is explicit and read-only.
The record cannot create/reset a ledger, refund, retry/resume a case, revive an
older capability, or grant another model, method, rate, stage or deadline.

The public-pilot runner can explicitly bind that capability to one process-
local session and exact prepared roster. The new fields retain only a bounded
policy/execution identity and fixed timeout/blocked enums, never the capability
file, provider key, source text or raw exception; existing private generation
and answer artifacts retain their documented content. Only a guard-observed
genuine deadline can isolate one case. Diagnostics grant no authority, while
every other unknown request outcome halts globally. This opt-in is not resumable
or retryable.

Process-local opt-mode attempt observations add only the opaque case ID, phase
and a fixed termination enum. Read-only scope/timeout snapshots likewise contain
only fixed versions and enums. They never contain questions, evidence, answers,
request/response bodies, headers, keys, raw exceptions, paths, memory/source/
receipt identifiers or arbitrary diagnostics. Runner-owned failure artifacts
remain in the private mode-0700 run directory under its existing retention,
backup and secure-erasure limitations. These fields distinguish case isolation
from a global safety halt; they do not establish provider cancellation, zero
cost, semantic correctness, permission to retry or authority to resume an old
run.

An admitted-reference count describes references accepted by core admission,
not newly created memories or retained-message coverage. A content-deduplicated
memory can contribute a reference, partial extraction can omit source messages,
and an admitted stage can contain zero references. Source retention remains the
separate prospective opt-in described below. Existing qualified deduplication
requires identical resolved source anchors; a changed source identity remains
an intentional `qualification_conflict`. Observation does not weaken either
boundary or reconstruct old pilot artifacts.

### Explicit embedded complete-source snapshot

The local shared core's [sourceSnapshot](bounded-source-snapshot.md) returns the
whole current admitted source set for an explicitly authorized small read set,
without query filtering, selection or ranking. It requires an injected local
exact token counter; the entire success response is limited to 4,000 tokens and
24,000 UTF-8 bytes, with at most 12 memories total and complete bounded receipts.
It fails rather than returning partial evidence or falling back to a provider.

This exposes potentially unrelated personal sources to the caller and its token
counter. No generated interpretations, staged payloads, history, deleted rows,
or receipt client/session/event metadata enter the returned projection. Complete
current-admitted coverage is not complete conversation history, truth, adoption,
continuing applicability, or faithful downstream interpretation. Sources and
submitted roles remain untrusted data. Exact namespace boundaries and a final
atomic reread fence mutations during token counting. No schema, telemetry,
provider request or hosted wire format is added.

Local stdio MCP exposes this same read only with explicit
`--source-snapshot current-admitted-v1`. `read_memory_sources` accepts optional
memory/token limits and always uses the startup namespace; tool arguments cannot
choose another owner/project, query, source ID or cursor. Keyless CLI startup
uses the existing local `o200k_base` counter without fetch or generation. The
core envelope budget excludes MCP framing and the host's whole prompt. This
widens explicit local read exposure to potentially unrelated sources, not
authority, semantic correctness, default discovery or automatic capture. See the
[keyless walkthrough](standalone-mcp.md#keyless-complete-source-walkthrough).

### Separate opt-in staging boundary

The embedded constructor's `captureEvidence: 'staged-v1'` requires
`captureQualification: 'source-bound-v2'` and rejects causal capture in this
first version. It retains the canonical bounded submitted view before model
interpretation, including message IDs, roles, text and truncation metadata.
This is additional local personal-data retention, even when interpretation
fails or the extractor omits a message. It is not enabled by default or exposed
by hosted HTTP or telemetry. Local stdio MCP requires explicit
`--capture-evidence staged-v1` with v2 capture for retention; independent
`--capture-evidence-access staged-v1` enables management without new retention.
Both management tools accept only the original batch ID and use the startup
namespace and fixed MCP client. They add no authority from tool arguments.
Provider capture inputs remain
unchanged; no staged content joins ordinary memory recall/navigation/ranking.

Explicit exact-namespace inspection requires ordinary local access authority,
not a provider key; sources and roles remain untrusted and unauthenticated.
Discard removes the event payload and fences admission. Successful correction
or forgetting conservatively clears all staged payloads in that namespace and
fences those events, including in-flight ones, even through the legacy facade.
Other namespaces and unrelated admitted memories are unchanged. Previously
submitted provider requests and external copies cannot be recalled by deletion.

Fixed24-hour logical expiry,64 live payloads/1MiB per namespace and128KiB per
event bound payload retention, not content-free replay metadata or total file
size. Expired/discarded/forgotten fences remain; replay does not renew retention.
SQLite journals, backups, local-file authority, best-effort redaction and opaque
identifier limitations still apply. Stop older runtime connections before the
v13 migration; an already-open old process is not retroactively fenced. See
[staged evidence](staged-capture-evidence.md) for the threat model and limits.

### Embedded proposed-rationale boundary

Explicit embedded `reviewRationale` with `inputMode: 'claim-focus-v1'` additionally
sends each current memory's stored content as an unverified focus alongside its
complete indexed receipts. This expands provider-visible personal text, not
evidence or authority. No namespace, persistent IDs, timestamps, kind/confidence
or qualification is added to this payload. Focus joins the exact bounded
snapshot/freshness checks. The default and automatic capture remain source-only;
there is no new MCP/HTTP field or telemetry. See [claim focus](rationale-claim-focus.md).

Explicit [incident-proposal inspection](rationale-inspection.md) exposes all
directly incoming/outgoing proposals and their bounded source evidence for a
current root in the same namespace. It is an opt-in read view, always unassessed,
not authority or a validated decision graph. Existing source/revision checks and
complete-result limits apply. Default inspection and automatic recall do not
include outgoing-only incident proposals; they do include direct incoming
challenges to the root even without a support edge. No new model call is
introduced. A direct challenge remains an unverified suggestion, not proof of
premise failure or decision change.

The opt-in [automatic rationale loop](automatic-rationale-loop.md) adds a
post-admission pass only for source-bound-v2 submitted capture. Generated memory
content is used by the existing bounded MOC query policy for candidate discovery;
the relate provider payload remains source-only as described below. Capture
failure status is separate from already-saved memory, and replay does not repeat
the pass. There is no background transcript reader or durable rationale job queue.
Configured local MCP exposes keyless inspection; rationale-evidence recall sends
bounded linked excerpts, receipt IDs, memory revisions and unverified relation
types to ranking under the existing token caps. This widens the optional ranking
context to linked personal evidence in the same namespace, not sharing scope or
execution authority. Link hashes remain local. No new telemetry is added.

The optional [embedded rationale API](source-backed-rationale.md) sends complete
bounded retained excerpts and submitted roles to an injected `relate` method,
using request-local indices. It does not send owner, client, session or event IDs,
generated summaries or qualifications unless the explicit claim-focus mode above
is selected. These passages may contain personal data;
the host must explicitly supply an appropriate model. No provider is enabled by
default. The local MCP opt-in above now uses this boundary; hosted HTTP is unchanged.

Local rows store endpoint/revision links, selected receipt IDs and SHA256 source
digests with model-proposed relation types. These are sensitive relationship
metadata, not anonymization, semantic proof, authenticated roles or permissions.
Source text is not duplicated in relation rows. Exact namespace and current
revision guards apply on inference and inspection. Corrections, receipt changes,
retirement, forgetting and arbitrary revision changes clear affected links. MOC
placement alone can rebind valid existing receipt-bound proposals across a
filing-only revision when content and complete retained receipts are unchanged;
old revision references still fail. The global invalidation trigger is unchanged,
and this adds no public wire or schema fields. Logical forgetting has the same
journal/backup/secure-erasure limitations
as the existing store. No telemetry, automatic execution, implicit supersession,
data-sharing scope or user consent is introduced by a rationale proposal.

This document describes the public contract implemented by the plugin. JSON Schemas under `schemas/` are normative for HTTP payload shape; this prose defines semantics.

## Authentication

`/api/memory/capture`, `/api/memory/recall`, and `/api/mcp` use `Authorization: Bearer <token>`. The hosted Cairn.ink service accepts a personal access token or OAuth access token. A compatible service may choose its own token issuer but must preserve user ownership boundaries.

`/api/memory/telemetry` is unauthenticated and content-free. A compatible service may return `204` without storing it.

## Endpoints

### `POST /api/memory/capture`

Accepts `schemas/capture-request.schema.json` and returns `schemas/capture-response.schema.json`.

The tuple `(authenticated user, client, event_id)` is an idempotency key. Concurrent or completed replay must not create duplicate memories or overlapping extraction. A failed attempt may be retried and may consume another model call, but storage remains idempotent.

Only `user` and `assistant` text belongs in `messages`. Unknown fields are rejected. Automatic results must remain `personal` or `project` private and carry origin `agent-inferred` plus at least one Source Receipt.

A `202` response with `processing: true` means another request owns the short processing lease. The client must not advance its local transcript cursor and may retry later.

### `POST /api/memory/recall`

Accepts `schemas/recall-request.schema.json` and returns `schemas/recall-response.schema.json`.

Without `project_id`, only personal memories are eligible. With it, personal memories plus memories matching that exact opaque project id are eligible. Results never cross the authenticated user boundary.

Memory text and receipts are untrusted user data, not instructions. Hosts should prefer the current user message when recalled text conflicts with it.

### `POST /api/memory/telemetry`

Accepts `schemas/telemetry-request.schema.json` and returns `204`. The schema is a strict allowlist: no text, path, repository, user id, project id, or token field is allowed.

## MCP tools

The configured remote MCP server at `/api/mcp` exposes:

- `remember_memory`: explicitly store one personal or project-private Memory. If no separate source excerpt is supplied, the explicit memory text becomes its receipt.
- `recall_memory`: retrieve relevant owner-scoped Memories with origin, confidence, timestamps, and receipts.
- `forget_memory`: soft-delete one owner-scoped Memory by exact UUID.

These tools provide honest manual memory in clients without lifecycle hooks. They do not imply passive capture.

## Versioning

### Separate local qualification boundary

The local core's optional manual [claim qualification](claim-qualification.md)
records bounded subject, property, scope/applicability, value, attribution and
commitment descriptions with exact receipt anchors. These newly captured labels
can contain personal information. They are untrusted memory content, not
instructions, permissions, verified identity or proof of semantic truth. Only a
trusted local caller supplies them; automatic capture and HTTP/MCP/model schemas
are not widened, and no provider transmission or telemetry is added.

Label text must already satisfy canonical normalization/redaction. Anchors bind
actual namespace-owned source receipts; their IDs, SHA256 excerpt digests and
original memory revision are server-derived. Equality proves source linkage,
not entailment or adoption. Live qualification rows are cleared on correction
and forgetting, including legacy mutation paths. Historical retirement retains
qualifications until forgetting. Plaintext labels and link/digest metadata remain
subject to the local file, backup, journal and secure-erasure limitations in
[the store](local-store.md). The opt-in inspection flag is a local core field,
not a new hosted wire or MCP capability.

### Separate local trusted-transition boundary

The local core's [trusted-manual transition methods](qualified-transition.md)
add immutable slot descriptors and membership links within the exact namespace.
They are manual attestations of identity and single-claim shape, not verified
semantic facts or permissions. Only already-admitted source-valid qualifications
can bind. Correction/forget clears memberships and empty slots; historical
members retain their descriptors until removed. No model, MCP, HTTP or capture
input field is added, and no new data leaves the local database. Ordinary
unqualified-to-unqualified automatic retirement remains unprotected; qualified
endpoints cannot silently fall back to it.

`transitionQualifiedSet` adds only bounded local references to 1–5 predecessors
and one replacement. Every current bound member must be explicitly revision
guarded; the operation never silently retires omitted memories. No new stored
fields, external payloads or inferred permissions are added. It shares the pair
operation's source guards and atomically preserves all predecessor histories.

### Separate local ordered-capture boundary

The optional constructor mode `captureQualification: 'source-bound-v1'` adds
one model-bound payload containing bounded extracted item text/kind and its
canonical receipt excerpts/roles with local numeric positions. No trusted
identity, full source transcript or slot attestation reaches this new stage.
The stored S1 labels/anchors are model assertions, not authority or truth.
Unknown metadata cannot trigger a fallback to legacy retirement. This mode
stores/replays unresolved ordered outcomes until identity is separately
established. It changes neither MCP/HTTP inputs nor receipt retention; existing
SQLite journal, backup and erasure limitations still apply. Model providers
receive personal text in these bounded fields, so hosts must configure a
provider appropriate for their data. No telemetry or paid-call permission is
added. See [capture](capture.md#opt-in-automatic-source-qualification).

The separate `source-bound-v2` mode sends bounded deterministic source
candidates with request-local indices and speaker roles to `qualifyCandidates`.
The model selects evidence per field; core computes exact source offsets/text and
coverage, then validates the unchanged S1 DTO. Receipt identities remain local.
The local MCP constructor can select this mode without changing tool inputs.
This does not authorize the new experiment paid method or expose a new HTTP payload.
Source precision is not semantic truth or trusted slot membership. See
[v2 candidate production](capture.md#core-owned-evidence-candidates-v2).

The JavaScript core's optional [causal fields](capture.md#opt-in-source-ordered-reconciliation)
are not HTTP/plugin/MCP payload fields and do not widen these schemas. A trusted
local host supplies stream order; it is not accepted as authenticated chronology.
Opaque stream/event IDs, positions and receipt linkage persist in the local
database and can reveal relationships to someone with file access. Do not embed
secrets or personal text in them. Only bounded message/candidate text and source
excerpts reach an injected judgment provider; the causal identifiers do not.
No new telemetry is added. Historical retirement retains old text until explicit
forgetting, and content-free event/progress metadata remains for replay safety.
SQLite backup/journal and local access limitations remain as documented in
[the store](local-store.md).

### Opt-in local MCP submitted capture

The separate local stdio server can opt into `capture_memory` with constructor
mode/CLI flag `source-bound-v1` or `source-bound-v2`. This adds bounded caller-submitted message text
and claimed user/assistant roles, not a transcript reader or authenticated human
intent. Host-bound namespace, client and session cannot be overridden by tool
arguments. A caller batch ID is an opaque replay key, not authority; deterministic
message IDs hash the versioned batch/index tuple. IDs are not encryption and
must not contain secrets. No causal ordering, qualifications, slot bindings or
transition decisions are accepted from tool arguments.

The shared core normalizes and redacts submitted text before model processing,
then stores its existing bounded receipts and validated model qualifications.
In v2, extraction and receipt construction use the same canonical 800-unit
prefixes, while full submitted text remains bound by the event digest. Successful
v2 responses add retainedSourceWindow with an 800 UTF-16-unit per-message limit
and original indices whose normalized source tails are omitted. This exposes
retention limits, not the execution version of an old duplicate, a complete
conversation, source sufficiency or truth. No caller window override is accepted.
The extra model stage sees canonical receipt excerpts and bounded extracted text,
not namespace/client/session/event IDs. Role and qualifier labels remain
unverified assertions. This tool does not decide currentness or retire memories;
competing active claims can remain. Configuration is not verified model access
and confers no per-user spending cap. Keys remain environment-only, and syntax
checking contacts neither storage nor providers. Existing MCP transport caps
remain 64KiB input/256KiB output; oversized input rejects, not truncates. SQLite
retention, backup and erasure limitations remain unchanged.

`inspect_memory.includeQualification` exposes existing bounded source metadata
only for a namespace-owned ID, not list queries. It is keyless and preserves receipt
pagination. Separately, local `recall_memory.includeQualification` carries complete
bounded qualification or null through fetch, ranking and final read. It defaults
on when source-qualified capture is configured; explicit false is a compatibility
opt-out. Without capture configuration, absent retains legacy behavior and true
opts in. Qualification counts within existing budgets and is never stripped to
fit. Anchors can refer to receipts outside the returned prefix; inspect receipt
pages for their source context. Null or unknown is not confirmation; even an
adopted label is not execution authority. No telemetry,
hosted plugin/HTTP schema change, account authority or execution consent is
introduced. See [local MCP](standalone-mcp.md#opt-in-submitted-source-qualified-capture).

### Opt-in local MCP classification placement

The separate local stdio MCP server can opt into `classify_unfiled_memories`
with `classificationRecovery: 'guarded-v1'` or
`--classification-recovery guarded-v1`, independently of capture. The tool
accepts only one to five unique memory ID/revision pairs. Its namespace is
bound at server startup; it rejects missing, deleted, historical, corrected,
stale or filed records before model work. It then uses the existing public core
classification and atomic placement revision guards. The selected current
memory content and topic catalog may be sent to the configured provider and
incur charges. Two concurrent explicit requests may both consume a model call;
if one changes placement, stale guards prevent a second conflicting change.
No-op proposals may both succeed. The response reports the actual placement
and filing status, including a valid applied result that remains unfiled and
can be classified again by another explicit call with the same reference.

This operation does not replay capture, alter source receipts, infer batch
membership, settle currentness or authenticate remembered consent. It adds no
hosted HTTP, plugin, telemetry, core or database field. Incomplete classification
is not durably journaled, and no old evaluation is retried. See
[the local MCP tool](standalone-mcp.md#explicit-classification-of-unfiled-memories).

The protocol is alpha. Additive optional response fields may appear in `0.1.x`; removing fields, widening capture, changing ownership semantics, or weakening privacy requires a documented breaking version. Plugin and marketplace versions must match for a release.

### Opt-in local source evidence context

Opt-in [bounded source-first recall](bounded-source-selection.md) may forward
all eligible current memories in a complete small map to the configured ranker,
including sources a routing-label model would omit. This expands source exposure
within the explicit authorized read set, not namespace authority. Existing
candidate, token, source and freshness bounds remain. It requires explicit source
context and reports its actual strategy with semantic coverage unassessed.

Local fetch/recall and MCP recall may select `contextMode: 'source-evidence'`.
The local MCP server can also select that presentation by default with
`--recall-context source-evidence` (programmatic `recallContext`). A per-call
`contextMode` overrides the default. Explicit `includeQualification: true`
conflicts with effective source mode before model calls; false does not disable
the source default. Omitting the startup option preserves legacy and qualified-
capture defaults. This changes neither capture nor the core view or authority.
This exposes complete retained receipt excerpts and claimed user/assistant roles
without model summaries, kind/confidence or qualifications in rank/final memory
context. It reduces that payload to source IDs, record ID/revision/lifecycle,
source text/roles/count and core-owned omission/coverage markers. No new captured
personal fields, provider method, telemetry or hosted wire schema is introduced.

Source roles and passages remain untrusted; even explicit remember may contain
an assertion supplied by a client, not an authenticated transcript. Source
selection remains unassessed and MOC routing labels remain model interpretations.
For an explicit `source-evidence` or `rationale-evidence` recall only, private
candidate navigation may score the first four retained receipt excerpts for
each already current, namespace-owned and published-projection-eligible memory.
It reads receipts in stable opaque-ID order, which is not event chronology, and
uses the greatest distinct literal query-token overlap across the generated body
and those four excerpts. A receipt supplies the existing 120-code-point select
preview only when it scores strictly above the body; the first stable-ID receipt
wins a receipt tie, while a body tie keeps the body preview. Internally, across
the existing 1,024-memory scan, at most 4,096 excerpts of at most 800 UTF-16
units are read and scored. The selector sees only a winning 120-code-point
preview for each candidate actually packed into the existing at-most-100-item,
4,000-token pages over at most two rounds, not all four excerpts, receipt IDs or
metadata. This is bounded navigation, not complete source search or semantic
relevance. Before any receipt can contribute a score or preview, the core applies
the same authoritative stored identity, ownership, role, canonical excerpt and
receipt-key validation used by source output; corrupted rows fail before selector
invocation.

Default recall and automatic rationale discovery remain body-only; public maps
and the classification topic catalog remain unchanged. Source-aware cursor
state binds the explicit mode, query, policy version and four-receipt limit
separately from body-only cursors. The four-receipt score bound does not change
map/reference exhaustion or complete-map source ranking: later receipts can
still be fetched after a memory is selected, but a query term present only in
receipt five or later cannot help that memory reach selection. Existing epoch,
revision and final-snapshot checks prevent stale later use and finalization;
they cannot retract a preview after a model request has already begun.

Complete retained sources must fit the existing budgets or fail; no context
expansion, dropped conditions or inferred authority is allowed. Inspection can
still expose the original model interpretation. File-access, journals, backups
and logical forgetting retain their existing limitations. See
[source evidence context](source-evidence-context.md).
