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
independent source/memory/policy limits/cursors (20 default, 50 maximum).
`{episode,sources,memoryLinks,policies,status}` returns each page as
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
| `episode_processing` | Another live session writer owns the episode. Retry after it completes/expires. |
| `stale_episode` | The draft claim expired, was consumed, or lost its revision/source fence. Discard its result. |
| `episode_step_conflict` | A draft would replace an existing open next step without a supported disposition transition. |
| `episode_sources_unavailable` | Explicit keep has no currently retained source passages. |

An admission with a live admission lease can finish after its session writer
expires. Deletion, forgetting, explicit discard and project stop remain closed
fences (`capture_evidence_closed`); draft failure merges diagnostic gap reasons
and cannot reopen them or erase a capacity gap.

The v16 `episode_messages` ledger has `(episode_id,message_id)` identity and stores
`first_event_id` plus HMAC-SHA256 using the existing private episode key over
`["m1", role, canonicalText, eventTimeOrNull]`. Its rows register atomically with the
batch. Matching identities count zero; different digests reject with
`event_payload_conflict`. It holds no source plaintext or role and survives deletion
as content-free fence metadata. Upgrading v15 creates an empty ledger; earlier
messages are not reconstructed. Both v14 and v15 opens upgrade eagerly to v16,
including feature-off opens, with foreign keys on and rollback on failure.
