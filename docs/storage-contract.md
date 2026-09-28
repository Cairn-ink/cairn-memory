# Model-free core contract — S2a preview

This is the first implementation slice of the Memory/MOC core contract, not the
complete memory engine. It uses the **same SQLite storage** as `openMemoryStore`.
There is no model, MCP server, hosted account, network client, telemetry, or cloud
fallback in this path. The released HTTP plugin is unchanged.

Use Node >=22.16 and a source checkout; this is not an npm-published package:

```js
import { openMemoryCore } from './core/contract.mjs';

const core = openMemoryCore({ path: '/your/private/directory/memory.sqlite' });
const namespace = { ownerId: 'local-user', scope: 'project', projectId: 'demo' };
try {
  const result = core.admit({
    namespace,
    memory: { content: 'Show sequence diagrams for protocols.', kind: 'instruction' },
    receipts: [{ client: 'example', sessionId: 'session-1', eventId: 'message-1',
      role: 'user', excerpt: 'Show sequence diagrams for protocols.' }],
  });
  if (!result.ok) throw new Error(result.error.code);
  const { id, revision } = result.value.memory;
  console.log(core.list({ namespace, limit: 20 })); // metadata only
  console.log(core.get({ namespace, memoryId: id, receiptLimit: 20 }));
  console.log(core.forget({ namespace, memoryId: id, expectedRevision: revision }));
} finally { core.close(); }
```

Only use synthetic content when trying the example. The path must be controlled
by the application; do not point preview code at production or a user's only
database. The [local store security and retention limits](local-store.md) apply:
no encryption or secure erasure, local file access is trusted, and redaction is
best-effort. Constructor/storage-opening errors throw; operation failures return
`{ok:false,error:{code,retryable}}`, never an empty success or raw database message.

## What works

- Explicit `admit`: one to four source receipts in one transaction, stable
  memory/source IDs, duplicate no-op handling and namespace-scoped suppression.
- `list`: metadata only, including unfiled memories, bounded keyset pages beyond
  any recent-40 window. No content or receipt excerpts are returned here.
- `get`: content with separately paginated receipts at a consistent revision.
- Explicit synchronous [sourceSnapshot](bounded-source-snapshot.md): complete
  current admitted sources across an authorized small read set, with no relevance
  filtering or generation calls. Requires a local exact token counter and fails
  without partial content when count, aggregate token, or byte limits are exceeded.
- Optional manual [claim qualification](claim-qualification.md) on admission,
  with immutable source bindings and opt-in `get.includeQualification` inspection.
- Trusted-manual [qualified transitions](qualified-transition.md) bind single
  claims to immutable server-generated slots and enforce source-backed guards
  before retiring an already-admitted predecessor. Legacy retirement is fenced
  whenever either endpoint is qualified; automatic unqualified retirement remains
  unprotected by these guards.
- `transitionQualifiedSet`: retire 1–5 explicitly revision-guarded qualified
  predecessors into one already-admitted replacement, only with complete current
  slot coverage and validated sources. Existing plus new incoming history links
  are limited to five; all writes succeed or roll back together. This local-only
  trusted-manual method does not change pair transitions or automatic capture.
- `correct` and `forget`: revision checks, replacement/removal of active receipts,
  persistent suppression and atomic invalidation of inspection cursors.
- Explicit [supersede](supersession.md): atomically admit a replacement and
  preserve the predecessor as historical, with source-bound transition metadata.
  Inspection `list/get` includes labeled history; current recall/navigation
  excludes it. Opt-in [ordered capture](capture.md#opt-in-source-ordered-reconciliation)
  composes this history mechanism without promoting inferred claims to explicit authority.

The exact inputs, result fields and acceptance gates are in the
[S2a plan](plans/s2-storage-contract.md). Unknown fields are rejected. The subsequent
[S2b extension](moc-placement.md) adds real placements and filed/unfiled state;
[1c](conflicts.md) adds optional admission hints and attributed conflict inspection.

Personal scope must be exactly `{ownerId,scope:'personal',projectId:null}`.
Project scope must be exactly `{ownerId,scope:'project',projectId}` with a
nonempty opaque project ID. Namespace is selected by a trusted host; the library
does not authenticate callers. Inspection/mutations never implicitly include
another namespace, even for the same owner. IDs outside the scope are not found.

## Pagination and revisions

Pass `nextCursor` back as `cursor` to `list`, or `nextReceiptCursor` as
`receiptCursor` to `get`, keeping the namespace, limit and filters unchanged.
Only `exhausted:true` indicates the end of the requested range. A signed cursor
survives restart but is invalid in another store, operation or scope. Cursors
are tamper-evident, not encrypted credentials or authorization grants.

A namespace mutation makes its old cursors `cursor_stale`; restart pagination
from the beginning. Exact no-op retries do not invalidate them. A stale mutation
returns `revision_conflict`; reread before deciding whether to retry. Writes via
the existing low-level store also update the same namespace epoch, so switching
between APIs cannot bypass this safety rule.

Temporary SQLite lock contention returns `storage_busy` with `retryable:true`.
Other failures return `retryable:false`; a CAS conflict requires a fresh read and
an explicit decision, not blind replay of the stale request.

## Database upgrade boundary

Opening the committed v1 or v3–v15 format performs an atomic upgrade to v16, retaining
existing memory/source data, revisions and suppression. Back up the file while
all older-runtime processes and connections (including idle readers) are closed
before upgrading meaningful data. The host must stop/drain those connections
before opening the store for upgrade, even with episodes disabled. No request
performs a lazy upgrade. Mixed-version coexistence is unsupported;
an already-open old process is not retroactively fenced. Older binaries cannot
open v16; there is no downgrade tool. Existing receipts remain unordered; no past
chronology is invented. The unmerged engine draft reserved v2; this
slice deliberately **rejects v2** rather than guessing its migration semantics.
Keep draft-engine test databases separate. Unknown/foreign databases are refused,
not reset. Reconciliation with that draft belongs to the later engine work.

## Verification without overstating coverage

`npm run test:core` includes real temporary SQLite storage scenarios, negative
adapter checks, migration, cursor, rollback and restart tests, in the existing
Node22.16/24 CI matrix. `npm run demo:store` still exercises the old store API.

For a locally available frozen S1 oracle, the test-only runner accepts an
explicit file path; no private fixture contents are bundled or fetched:

```bash
node examples/check-storage-oracle.mjs /absolute/path/to/oracle.json
```

It runs **only M08, M10, M13, M16, M18, M20, M23, M29** against a fresh SQLite
store per case. It compares actual records, source identities and declared
assertions, and rejects unsupported action/assertion fields. It does not run
the rest of the memory/placement suite, infer model quality or emulate model
output. Synthetic setup pins timestamps only; generated runtime IDs and actual
returned revisions/content are never rewritten to make assertions pass.

S2b adds MOC placement/map and a mock-model adapter; [S2c](fetch-recall.md) adds
bounded fetch/recall. MCP integration and real-model evaluation remain separate.
This does not certify the draft
engine's unrelated-query recall behavior. Hosted migration and Moss remain out
of scope; the end goal is one public core consumed by all host adapters.

## Episode management and procedural tags (SE-1)

The local envelope facade adds `getEpisode`, `correctEpisode`,
`releaseEpisodeCorrection`, `forgetEpisode`, `getCaptureControl`,
`setCapturePaused`, `setProjectCapture`, and `setProceduralMemory`. No HTTP/MCP
schema or provider interface is widened. `getEpisode` needs no model or mode
option on a v16 store. It takes the plan's exact namespace/episode ID and
independent source/memory/policy/keep limits/cursors (20 default, 50 maximum).
`{episode,sources,memoryLinks,policies,keepActions,status}` returns each page as
`{items,nextCursor,exhausted}`. Signed cursors bind store, namespace, episode,
page kind, limit and epoch; mutation returns `cursor_stale`. Pages retain whole
items under 64 KiB and report `budget_exhausted` when truncated. Source roles and
prose remain untrusted and `semanticSupport:'unassessed'`.

`correctEpisode({namespace,episodeId,expectedRevision,patch})` accepts gist,
outcome and nextStep entries as `{text,anchors:[{sourceId,digest,start,end}]}`.
Outcome/nextStep can be null; clearing a step closes it. Corrections pin fields;
`releaseEpisodeCorrection({namespace,episodeId,expectedRevision,fields})` removes
pins. UTF-16 offsets cannot split a code point, and prose bounds apply before and
after normalization/redaction. These operations never invoke a model.

`forgetEpisode({namespace,episodeId,expectedRevision})` removes conversation prose,
labels, metadata and retained passages, tombstones the derived session, and forgets
all derived memories including deduplicated and historical ones with normal exact
suppression. Source consumers are invalidated even without memory lineage. Other
memories of an invalidated consumer are not recursively forgotten. Both existing
memory facades invalidate dependent episodes when correcting/forgetting, including
feature-off reopens. Existing namespace-wide staged purges remain in effect.

Control getters take `{namespace}`; setters take that namespace, an
`expectedGeneration` and respectively `paused` or `enabled`. Project setters
require project scope. Generations are opaque strings (`initial` before the first
mutation); setters produce a new token. Pause excludes newly submitted text;
already accepted requests and claimed drafts may finish. Project stop discards
and fences unfinished work, including after re-enable. Producers must
still implement the skip-to-transcript-end barrier; SE-1 cannot authenticate their
submitted roles or generations.

Explicit `admit` accepts `procedural:{anchors:[{receiptIndex,start,end}]}` for
instruction/preference memories, independently of episode mode. Anchors address
canonical admitted receipts. `setProceduralMemory` takes namespace, memoryId,
expectedRevision, expectedTagRevision (0 when absent), and `procedural` as null
or `{anchors:[{receiptId,digest,start,end}]}`. It updates only the sidecar tag and
namespace epoch. `get` includes `procedural` only when a tag revision exists;
cleared tags expose `procedural:false` with no anchors. Tag-only edits preserve
memory revision, receipts and conflict/qualification/rationale links. Filing
preserves tags; content correction and forgetting clear them. Deduplicated
admission adding receipts preserves tags and dependent episodes while retaining
existing conflict/rationale/qualification invalidation semantics.
Automatic tag proposals require episode-v1; legacy automatic outputs still reject tags.

The operation envelope uses these episode-specific error codes (opening failures
throw instead). They never expose raw database or provider errors.

| Code | Meaning |
| --- | --- |
| `episode_identity_unavailable` | The private session-key secret is missing or corrupt; do not regenerate it for an existing store. |
| `episode_mode_required` | The requested episode write/control seam requires the episode option. |
| `episode_not_found` | The episode is absent, deleted or outside the exact namespace. |
| `generation_conflict` | The supplied control generation is stale. Reread controls. |
| `capture_disabled` | Capture is paused or disabled for that scope; new work cannot start. |
| `stale_episode` | The draft claim expired, was consumed, or lost its revision/source fence. Discard its result. |
| `episode_step_conflict` | A draft would replace an existing open next step without a supported disposition transition. |
| `episode_sources_unavailable` | Explicit keep has no currently retained source passages. |
| `missing_evidence` | The interpretation target has no available staged evidence. |
| `episode_failed` | The interpretation call failed; ordinary admission continues. |
| `episode_outcome_pending` | Failure recording is still locked after admission; the consumed attempt awaits finalization or lease-expiry recovery. |
| `episode_timeout` | The bounded interpretation call timed out; ordinary admission continues. |

Interpretation never holds up ordinary admission. A reserved, started or stranded
attempt and its writer lease cannot make admission report `processing`; only its
own live admission lease can do that. The first due draft is attempted before
extraction. Failure proceeds to normal extraction, independently of whether its
failure outcome has already been recorded.

A local SQLite busy/locked error before a draft starts returns retryable
`storage_busy` in the episode outcome, spends no attempt and records no permanent
gap. A draft reservation is consumed immediately before calling the port, or on
a terminal preparation failure. An unstarted reservation whose cleanup is locked
can be recovered after its 125-second lease expires, including after restart.

After start, the owner records a finite failure and coverage gap. A correction,
capacity release or other publication fence rejects stale content but still lets
the owner finish its failure immediately. Failure finalization authenticates the
attempt token without requiring its old revision or source fence. It preserves
current corrected content and accumulated stronger deletion/discard gaps.

If a lock prevents finalization, the owner makes up to 21 writes within a
five-second budget, yielding between writes and limiting each SQLite wait to
250 milliseconds or the remaining budget. If the store remains locked throughout,
the consumed attempt stays unfinished. Admission still proceeds when writable,
in this call or its immediate retry. After successful admission, the owner makes
one additional failure write, bounded to 250 milliseconds. Success returns the
recorded finite code; a still-locked write returns retryable
`episode_outcome_pending`, not a claim that the failure is already recorded.
A later capture or end signal recovers a stranded attempt after lease expiry as `episode_timeout` with a coverage gap,
without repeating that interpretation call.

Quick policy is recorded only while the batch is reserved with no live admission
claim. Claiming admission atomically freezes and returns its policy before any
extraction. A later quick draft cannot rewrite a pending or completed batch.
Completion records that frozen policy and its basis with the admission result in
one transaction: an extracted batch remains `normal`; a batch already marked
`skip-quick` completes without extraction.

Retryable admission busy errors preserve staged evidence. Cleanup returns the
owned claim to reserved state; if cleanup is also locked, the process remembers
it for the next claim. After restart the admission's own bounded lease permits
recovery. Only terminal admission errors mark staged evidence failed. Deletion,
forgetting, explicit discard and project stop remain closed admission fences
(`capture_evidence_closed`); diagnostic failures cannot reopen them.

The v16 `episode_messages` ledger has `(episode_id,message_id)` identity and
stores `first_event_id` and `coverage_event_id` plus HMAC-SHA256 using the
existing private episode key over `["m1", role, canonicalText,
eventTimeOrNull]`. Its rows register atomically with the batch. Completed or
legitimately in-flight matching identities count zero; an abandoned/failed
original without a live lease permits new registration while preserving the
first event ID. Bounded batch message-ID membership fences transferred messages
against admission by a previous owner. A resumable original can still admit its
remaining messages; a closed stage records a content-free gap for any remainder.
Different digests reject with `event_payload_conflict`. It holds no source
plaintext or role and survives deletion as content-free fence metadata.
Upgrading v15 creates an empty ledger; earlier messages are not reconstructed.
Both v14 and v15 opens upgrade eagerly to v16, including feature-off opens, with
foreign keys on and rollback on failure.

`endEpisodeSession({namespace,client,sessionId,generation,eventId})` is an
explicit host signal in episode mode. Client keys use `[A-Za-z0-9._-]{1,64}`.
It consumes at most one end allowance when undrafted evidence exists and never
completes an admission or changes an already completed batch policy. Missing or
capacity-bypassed evidence records its actual gap reason, not a token-budget error.

`keepEpisode({namespace,episodeId,expectedRevision,actionId})` bypasses debounce
and admits from currently retained passages, never interpretation prose. The
opaque action binds exact source IDs, source revision and source fence in dedicated
`episode_keep_actions` rows; coverage remains inspectable after later drafts
replace the passages. Keep policy is recorded beside source batches; their policy,
type, basis and admission status remain unchanged. Keep admissions use a separate
table and admission-key column; client keys and event IDs remain unchanged.
Per-episode keep ordinals have their own counter (the transactional maximum plus
one) and never advance the namespace receipt ordinal.
Terminal model-validation/source failures have explicit outcome/code columns;
transient or unknown failures release the owned claim and allow the same action
to retry. Busy cleanup is retried by its in-process owner with the original token;
after a crash, a new process may reclaim the action once its persisted 125-second
admission lease expires. No in-memory cleanup entry is required for recovery.
Completed actions replay without model calls. Unknown errors retain the ordinary
`storage_error` label.

`getEpisode` includes `keepActions:{items,nextCursor,exhausted}`. Supply `keepLimit`
(default 20, maximum 50) and `keepCursor` to page all actions by creation ordinal.
Each item contains `actionKey`, `ordinal`, `createdAt`, `policy:'explicit-keep'`,
`admission` (`pending`, `completed`, `failed` or `retryable`), nullable `errorCode`,
and `sourceCoverage:{sourceIds,revision,sourceFence}`. Cursors share the existing
namespace/episode/limit/epoch binding, stale-cursor checks and 64-KiB response budget.
Source IDs are lineage metadata; this page does not retain additional source text.

Gap reasons use a fixed vocabulary with codes at most 64 ASCII characters.
Policy pages carry omissions separately as `omittedCount` and bounded
`omittedMessageIndices` (positions 0–23). Pause permits registered work to finish;
a stale-generation draft attempt consumes its marker, records `generation_conflict`
and proceeds to admission. Project stop and deletion fences remain stronger.

Fixed gap codes: `forgotten`, `discarded`, `expired`, `capacity`, `omitted`,
`episode_failed`, `episode_timeout`, `invalid_model_output`,
`context_budget_exceeded`, `generation_conflict`, `missing_evidence`.
Interpretation outcomes may return `missing_evidence`, `episode_failed` or
`episode_timeout` in addition to the validation, budget and fence codes above.
These consume the attempt without blocking ordinary admission.

An identical overlap stays `processing` while its original admission has a live
lease or its pending payload remains within the retention/replay window. An
intact capacity-bypassed registration is also resumable until completed,
abandoned or closed by a discard/stop fence, even without a staged payload. Once
abandoned, failed, released or expired, evidence may move to a new event; the
old event cannot admit transferred messages. Completed originals always count
zero. Every episode-mode capture result includes `admission.status`
(`completed`, `covered` or `processing`); episode-off result shapes are
unchanged.
