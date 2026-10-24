# Known limitations

## Local role profiles (U5c-1)

[Role profiles](role-profiles-local.md) require explicit matching method/context
read scopes and migrate ordinary writers to v32. Direct agent publication uses
role-specific write grants; attribution labels and retained instructions grant
no execution authority. Caller-held receipts preserve identities across adoption
changes, while every read rechecks scope, availability and applicability. A lost
receipt cannot be recovered. Deletion and source fences prevent recovery of
purged content, without erasing backups or caller copies.

The exact single text budget includes the escaped receipt, defaults to 4000
local tokens and may reject legal maximum Unicode or many-package profiles.
Diagnostics require client handling of namespaced `_meta`. No live cross-agent,
answer-quality, authoring-UI, relations/MOC, receipt-lookup or current-dependent
Card invalidation claim is made. Stop older writers before v32 migration.

## Budgeted context assembly (U5b)

The [assembly tool](context-read-local.md#budgeted-context-assembly-u5b) bounds
its exact single text block in the local `tiktoken-o200k_base` counter, not
total model-request spend. Both success diagnostics and candidate diagnostics
on assembly errors are confined to namespaced `_meta`; error text preserves
its code, retryability and trust framing without candidate telemetry. These
diagnostics require an explicit client contract that excludes them from model
input; no invisibility is claimed for arbitrary clients. Separate core/transport byte bounds remain.
Whole units may be omitted; no body or source is silently shortened.

The experimental preview.2 assembly shape uses `representation-v2`; the snapshot
is host-only `_meta` beside diagnostics. Compact refs are scoped to the host's
immutable startup read set. A filed-to-filed MOC parent move leaves compact-ref
fetch succeeding with byte-identical evidence while snapshot fetch refuses
`snapshot_stale` through the namespace generation. Compact refs check exact
revisions, intent eligibility and item fences; full refs retain their prior semantics.

The mandatory 8-character `f` is a stable keyed fingerprint, exposing item
equality/change information across calls, not plaintext or key material. The
store-local HMAC prefix cannot be inverted or extended. Assuming pseudorandom
HMAC output, a changed item escapes detection with probability 2⁻⁴⁸ per comparison,
with union bound `M/2⁴⁸` over `M` comparisons. This is bounded accidental-change
detection, not adversarial integrity or authority. A client forwarding `_meta`
to a model receives no metadata-isolation guarantee.

HR-2 has run on the frozen HR-1 fixture: coverage-first did not beat
rank-first whole units (−2.5 points, 95% CI [−6.6, +1.5] at the preregistered
cell), so the rank-first default stands; it is versioned and swappable. That
research design addresses short, single-fact items with evidence often in
receipts and provides no external validity for long items. U5b makes no claim
about answer quality or correctness, generated summaries, prefix/window
degradation, Card source units, role profiles, relations, MOC (U5c), total
model-request spend or any budget number being a recommendation.

## Context retrieval host (U5a part 3)

The [context host](context-read-local.md) adds two explicit MCP read tools and a
separate bounded document-refresh command. Startup fixes provider, preset and
read set. Tool arguments cannot select authority, configuration or another
namespace; returned source text remains untrusted data. Semantic query embedding
is off by default; a key alone does not construct an embedder. Known coverage
gaps send no query request. Hosted configuration uses frozen `rrf-k10`.

The OpenAI adapter uses reviewed frozen accounting inputs, not live price quotes
or billing attestation. Reported-token settlement releases unused reservations
only at actual completion; unknown usage keeps the full conservative charge.
Caps and concurrency share process totals by embedder identity, including
configuration changes; they are not durable or account-wide spending limits.
Inputs/transport bytes and cooperative deadlines are bounded without a latency
guarantee. No hidden retry occurs. A paid smoke script exists but is unrun by
default and never executes in offline tests. Actual fake HTTP and installed
process tests use synthetic sources, not paid calls or native-product evidence.
Sidecars remain sensitive, invalidation is logical rather than secure physical
erasure, and the intentional `中` versus `中文` miss is unchanged. Assembly,
complete semantic recall, answer correctness and 100,000-Memory latency remain
non-claims. See the separate core limitations below.

## Opt-in core candidate retrieval (U5a parts 1–2)

Candidate retrieval requires explicit `contextRead` configuration and method-specific
host authority. Flag-off behaviour stays unchanged. This packet provides core
lookup, refresh and canonical evidence refetch; MCP, CLI and hosted adapter wiring
remain deferred. Candidate ranks do not assemble context or establish answer quality.

The local `<store>.context-read-v1.sqlite` sidecar is sensitive: lexical terms,
postings, projection statistics, identities and optional embedding vectors can
reveal private information. It is a protected plaintext-derived cache, not an
encryption boundary. Canonical revisions and eligibility changes cause logical
invalidation. Removing entries or the sidecar is not secure physical erasure of
SQLite pages, journals, filesystem blocks or backups. Read-only handles refuse
unsupported auxiliary files and never repair or maintain the sidecar.

Frozen T1 tokenization intentionally misses an embedded single-Han query: `中`
does not match `中文`. Exact-term and CJK fixture results describe these frozen
mechanics, not general semantic recall. Measurements use synthetic data only and
are observational. Reported timings vary with runtime, workload and filesystem;
they are not production-latency guarantees or evidence of answer correctness.
Paid API smoke remains unrun by default, and no 100,000-Memory latency guarantee
is made.

## Text-only local method packages and host workflow (U2/U3)

[Method packages](method-packages-local.md) are default-off text-only mechanics
with separate real-terminal import/adopt/disable and read-only MCP opt-ins. They
never execute package text or turn it into permission. U2b adds explicit binding CAS,
four-level resolution, authenticated pins and content-free events on the same
frozen v30 layout. Every read set requires fresh host authorization; pins grant
no access. Disabled/deleted targets remain barriers. Historical pins preserve
identity and access checks, without asserting current adoption. Deletion changes
lifecycle revisions and its deletion effect only; binding generations advance
only on binding transitions. U3 adds descriptor-capability confinement on
supported Linux/WSL environments and method-specific frozen-payload approval;
U4 owns binary assets; U5 owns dependency fences
for source-derived copies and generated summaries. Hosts must not import fenced
or forgotten source output. Best-effort redaction is not a secret-removal
guarantee; logical purge is not secure physical erasure. Limits are 256 files,
400,000 units/file and 4,000,000 units/version; the owner cap remains 50 MB.
Importer depth, entry, raw-byte and change-file bounds are published in the guide.
The whole-version write-lock contention found in U3 is resolved by U2c:
method reads use deferred, consistent SQLite snapshots with `query_only`
enabled. File pages verify lifecycle and manifest metadata, then hash and check
only the requested file's text and byte count. Out-of-band text corruption in
file A refuses A while file B remains readable; version metadata, manifest
listing and comparison still verify the whole version. Resolution verifies
metadata; file content is checked when read. These semantics do not detect
unread text corruption through resolution alone. SQLite contention can still
return retryable `storage_busy`; byte ceilings do not guarantee latency.
The opt-in C04 gate runs a continuous maximum-version reader and at least 100
independent binding transitions in separate processes, with finite deadlines.
It runs separate labelled paced and unpaced scenarios. The paced gate uses a
fixed writer pause derived from an uncontended reader baseline and requires a
complete contended read, at least 100 commits, and at least 200 distinct reader
pages overlapping actual synchronous writer-call intervals. Writer sleeps and
report publication do not count as active overlap. Any busy outcome fails this
gate, including retried outcomes; writer p95 must be at most 250 ms on the
reference machine. Rollback-journal readers can queue behind pending commits
even when neither side returns busy. Reader page p50, p95 and maximum during
active calls and across the writer's whole lifetime are reported separately
from the whole run; reader overlap p95 and maximum have no threshold.
Both child exit codes are checked.

A process that writes continuously, without pauses, can starve readers under
rollback-journal locking. Readers then receive retryable `storage_busy`.
Normal capture and imports are sporadic and meet the paced gates. The unpaced
scenario is a bounded stress observation: the writer stops when the reader
finishes or its duration bound expires, and the reader retries the same page
and cursor with bounded backoff within the overall deadline. Reports include
pages, busy outcomes, SQLite waits, retry delays, maximum page latency and
whether an exact-byte read eventually completed. Busy reader outcomes and
reader latency do not fail this observation; corruption, byte mismatches,
writer errors and deadline breaches do. WAL mode is a separate store-wide
follow-up decision, affecting every V1 opener and the terminal-review store
fence, which currently requires rollback-journal mode.
Method command review supports rollback-journal stores only. It refuses WAL
headers and existing journal/WAL/SHM companions before SQLite inspection, pins
filesystem and SQLite identities, and uses a noncreating fenced opener after
approval. Participants must keep rollback-journal mode throughout review. A
refusal guarantees no application data or schema writes; SQLite crash recovery
may cause filesystem effects after approval. Approval reviews metadata
and commits frozen bytes, rather than reviewing every file's prose. Pinned
directories can remain usable after ancestor relocation; continuous pathname
ancestry and atomic directory snapshots are not promised. Unsupported flag or
`/proc` semantics refuse, with no pathname fallback. Native arm64, macOS and
Windows importing are unverified/unsupported; tests exercise Linux x64. Namespace usage excludes metadata, ledgers, effects,
SQLite overhead, WAL and backups; owner-wide totals are not exposed by U2.
Synthetic migration tests consume frozen historical fixtures in shallow CI;
maintainers verify their provenance through the opt-in full-history recipe in the
[guide](method-packages-local.md#synthetic-verification-and-historical-fixtures).
Process-race tests establish local SQLite serialization, not cross-host coordination.
Schema v30 upgrade is explicit and writable-ordinary-only; stop mixed-version
writers first. Core SQLite tests establish database mechanics; separate real-process/PTY
installed tests exercise confinement and approval, including same-filesystem
bind mounts in an unprivileged user+mount namespace on this host. These do not
establish hosted safety, remote-human authentication, semantic quality, safe
code execution or product readiness.

## Explicit local foreground setup preview

The [operator path](raw-local-journal.md#explicit-standalone-foreground-setup-preview)
is default-off Linux/WSL + Node >=22.16, not native macOS/Windows verification or
complete semantic/product V1. Hooks run foreground for up to 160 seconds; there
is no daemon, detached retry or long SessionEnd capture. Exact generated commands
exercise quiet/keyless installed routing; provider-backed installed capture uses
trusted test-only HTTP interception and synthetic Codex ancestry. A Codex command
outside a qualified actual host is expected to refuse. Qualification proves
schema/format evidence, not native hook execution or model meaning.

Setup requires an existing private schema 29 or upgraded schema 30 store. Separate new-store-only init
refuses every existing path; failure can leave its owned incomplete new file.
Init does not persist an owner cap or fake event: first actual capture persists
the setup-selected cap. Both clients must share the private usage descriptor,
target and limits. Daily usage counts model-port invocations, not money. These
cooperative locks do not attest against malicious same-user filesystem/SQL edits.
The selected native settings parent must be private, and JSON conflicts refuse
rather than erase unknown Cairn commands. Trust/global policy is never changed.

Disable preserves data/identity and revokes SQL before config cleanup. Re-enable
stays `rearm_required` until existing explicit admissible rearm; missing identity,
zero-history or other unsupported recovery refuses rather than resetting it.
Status is an observation, not repair. Activation/SQL/source checks are repeated,
but there is no cross-filesystem/SQLite transaction against hostile same-owner
races. No plaintext encryption or account-wide financial cap is implied.

Retained author failures: the first decoder rejected real Codex required
`turn_id`/optional agent metadata, and then official Claude session-title/task/
cron fields; full native-shape red tests now constrain those inert fields.
Installed fixture reds used a non-UUID rearm action and wrongly expected a killed
provider's reservation to disappear immediately or through guard status. Existing
guard recovery is reserve/resume-driven; uncertain usage is not refunded and a
started dead-owner reservation is durable state, not a live child or unexpected
scratch. Separate source-status and SIGHUP reds exposed transient status locking
and a missing signal handler. Logs/actual exits remain recorded; no source or
authority boundary, provider behavior or timeout budget was weakened for them.

The v3 repeat-setup regression retained source 33/37 and installed 6/8 reds
(actual exit 1): missing/changed owned commands now refuse without repair.
Independent Spec review then found that an owned group matcher or hook modifier
could still report active. The v4 pre-fix source 39/47 and installed 8/10 reds
also exited 1 with cleanup verified. Active status, repeat setup and repeat
activation now require the exact unconditional foreground owned group/hook keys;
unrelated handlers and matched groups remain preserved. These are configuration
observation corrections, not changed SQL consent, identity or capture algorithms.

Actual pinned Claude Code 2.1.260 `--init-only` dispatches the unchanged installed
SessionStart hook, but its transcript is absent and no EOF cursor is created.
A separate normal interactive probe in a fresh keyless, network-isolated PTY
exited 1 at `api.anthropic.com: ETIMEOUT`, before hook dispatch or transcript
creation. Only loopback DNS connect syscalls were observed; no provider server
or authentication workaround was used. Normal interactive source timing and
complete native Stop capture remain unverified, not inferred from init-only.

## Asynchronous Memory topic metadata

The [asynchronous Memory topic reader](topic-overview.md) supplies bounded
owner/namespace metadata over the same SQLite engine without model calls. It
reports unknown counts until aggregation completes and refuses unavailable
generations. Historical E1 synthetic Node 22 measurements at 1,112 Memories/four
namespaces/71 MOCs and a larger 3,336-Memory/multifiling case showed responsive
main-loop behavior; those are not schema 29 measurements. The combined candidate
requires both supported
runtimes, installed bytes, concurrency gates, independent review and latest-head
CI. This is metadata mechanics, not semantic recall accuracy or the product
team's exact old-map 33-second reproduction. Legacy `map` is unchanged; product
integration and feature re-enablement remain separate.

The store has no placement-added timestamps: `lastMemberAddedAt` is explicitly
null with `addedAtCoverage:'not_recorded'`. `latestMemberCreatedAt` describes
current members' creation times, not filing recency. Opt-in member refs are a
first-K sample, not a complete member-page/location API; Card MOCs and episode
headers are outside this port. Continuations are ephemeral, with finite work,
state, byte and time caps; a changed snapshot requires restarting the read.

Schema 29 compatibility preserves the old exact 18/20/21/22/23 layouts, while
actual 24–28 layouts remain unsupported. New synthetic fixtures use public Raw
capture and public placement, not SQL-seeded Memory/receipt relationships.
Correction, forget, real conversation deletion, surviving independent-source
support and published/staging generations test metadata mechanics, not source
truth, semantic relevance, product integration or native-client activation.
Consumed Memory/index access paths are validated; this is not full Raw-table
integrity or local-authority attestation. Required archive closure remains
complete; exact eager import traces are separate from actual installed Worker
execution, rather than hiding lazy files behind broad exceptions.

The port-only baseline retained expected schema 29 refusal and two installed
one-shot failures per runtime: exactly three present-but-lazy Worker modules
were absent from the old eager trace. The first new author source run exposed
two invalid pagination preconditions and an overbroad all-SHM-byte assertion.
Its binary failure dump exhausted the output buffer (ENOBUFS, runner exit 143,
supervisor exit 1); scratch was removed. The cursor fixture now creates a real
L2/L1 hierarchy. Minimized reader and bare native read-only controls both changed
only SHM byte 104 after a fresh WAL commit, with DB/WAL hashes unchanged; warmed
whole-file hashes stayed exact. SQLite documents read marks at offsets 100–119.
The contract and bounded test now distinguish that coordination from data writes;
reader runtime, journal mode and time/work bounds were not changed.

The first new installed run passed its physical-layout case but failed both
client lifecycle cases at an explicit correction missing required `kind`.
Actual exit was 1 with cleanup verified; adding the required fixture field was
the only correction. Original red logs and native-control diagnostics remain
retained, rather than being replaced by subsequent passing runs.

## Installed Raw / Memory / Card lifecycle evidence

The six installed lifecycle cases select three independent synthetic scenarios
for each supported client format. Foreground capture, not SQL seeding or
remember_memory, creates the tested Memory/receipt/Raw lineage. Explicit resolved
Raw references support authored drafts, generic MCP approval still refuses, and
a synthetic controlling TTY supplies the exact confirmation phrase. Cold stdio
reads, precise original-anchor exclusions, surviving independent-source support,
private authored-body retention and pause/rearm replay are mechanical evidence.
The matching-evidence policy is explicitly enabled only for the two-conversation
scenario; duplicate receipts alone do not establish independent corroboration.

Scenario B corrects a captured Memory and then forgets that corrected revision.
It proves the original exclusions persist, not an independent standalone-forget
case. Disjoint and future Raw controls use scripted empty extraction; there is
no claim that model outputs are semantically accurate or that suppression bans
newly entered text in a genuinely new session. Fresh coarse conversation revisions
are inspected before testing original anchors. Re-extraction jobs are unavailable
and are not simulated as a shipped API. Deletion uses the installed trusted core,
not a nonexistent MCP deletion tool. These short fixtures do not replace the
specialized long/multipart, quota, crypto, race, isolation or deletion-table suites.

The first author run failed 0/6, actual exit 1, before capture: its new static
closure looked for the archive's bin/cairn-memory.mjs target as a root source file.
The build maps it from packaging/bin; archive/installed launcher bytes are now
checked separately. A second 0/6 run and a minimized 0/1 run exited 1 at MCP
startup because the new fixture's nested import-loader string expanded a newline
inside quoted JavaScript. A direct syntax probe distinguished outer success from
nested failure; only the test guard's trace-newline construction changed. Runtime
files and dependency versions were untouched, and the red receipts remain retained.

This installed subset does not complete all T01–T18 or RL-1–RL-3 rows. Semantic
decision/rationale accuracy, generated summaries, automatic consolidation, vector
retrieval, actual native-client setup/activation, product joint acceptance and
production G1/G2/H6 remain separate. No real transcript, operational store/key,
paid request, activation, release, deployment or new competitive score is claimed.

## Explicit authority-only local rearm

The [explicit rearm path](raw-local-journal.md#explicit-authority-only-rearm)
adopts already-enabled authority for one established session. It does not enable
controls, recover unknown identity, retry old interpretation, read retained Raw
under capture permission, activate a native client or establish semantic quality.
The same key/store/target/namespace/client/session and issued ordinal survive;
one frozen complete EOF skips paused content. Only clean pending-null state or
a proved SQL-closed continuation with completed/no-eligible first-part ownership
qualifies. Incomplete, first-part, unknown/deleted, quota/exhausted and other
blocked states refuse rather than reset.

Rearm status reports action metadata, not fresh SQL permission or enabled controls.
Status revision 0 observes an absent global action record; it cannot prove no
historical rearm because there is no new sentinel or session enumeration. A
selected session's positive revision/committed receipt refuses missing or older
global history before publication. Only one predecessor authority pair is kept;
sessions older than it cannot be implicitly adopted. Same-action replay retains
its original EOF and never rewrites a cursor after terminal publication or later
progress. Missing/contradictory receipt/revision pairs refuse, not repair.

Actual rearm/recovery/replay also rechecks the exact selected session's deletion
fence after awaited source proof and before subsequent publication. Deletion can
leave general capture controls unchanged. A deleted session refuses even if its
action was previously completed; pending recovery remains visibly pending, with
no automatic cancellation, rollback or repair. Metadata status is not permission
to resume it. These fresh SQL checks cannot make separate filesystem writes and
deletion share a transaction or undo already-published state.

Case A checks content-free SQL ownership, event/part/binding and completed
admission consistency, not historical source-file attestation or semantic truth.
Case B reconstructs only its already-authorized bounded original record. Existing
32 MiB/128 MiB/scratch/deadline limits remain; a source inode plus 4 KiB anchor is
not a complete historical checksum. Filesystem and SQL cannot share an atomic
transaction. Later revocation cannot undo source reads or dispatched costs, and
Raw-only controls do not retroactively cancel eligible admitted interpretation.
Normal direct workers now reject revoked no-work permission before source
access; eligible legacy cursor encoding and SQL-free transport fixtures remain.

The first source run passed 2/14, actual exit 1: a new fixture supplied a trailing
runtime-root slash, while reused bounded source helpers needed the host's private
remaining-budget accessor. The fixture was normalized and that accessor added
without changing timeout ceilings. The expanded run passed 38/40, exit 1, because
two new incomplete/processing fixtures violated the existing pending-claim CHECK
before reaching rearm; only those fixture fields changed. A separate source-close
regression failed 0/1, exit 1: actual close rejection skipped key zeroing. Nested
finally now guarantees zeroing while the outer fixed failure remains visible;
durable ready state is not rolled back. All original reds remain retained.

Independent review found a missing deletion recheck in the first committed rearm
candidate despite its passing bounded matrix. A completed real capture followed
by pending-intent interruption, real conversation deletion and same-action recovery
incorrectly returned ready/replayed and published the remaining state. The tight
repro failed 0/1 twice, exit 1. New focused source regressions initially passed 1/9,
exit 1, and installed regressions 0/2, exit 1; two source cases and one installed
case first stopped at an incorrect fixture count for Codex's excluded header.
After correcting only that count, all eight failing source cases reached the
intended deletion refusal assertion. The installed Codex fixture then stopped
before interruption because its direct API call lacked the existing synthetic
host-ancestry binding; the fixture now reuses that binding without changing
runtime qualification. The first post-fix focused run passed 9/9 source cases
and 1/2 installed cases (exits 0 and 1 respectively), retaining that fixture red.
The correction reuses the existing exact-session SQL lookup in
the shared publication proof without rechecking historical admission against
terminal-progressed cursors. No deleted-content resurrection or core capture
fence bypass was demonstrated; the defect was false successful rearm. All red
receipts and the original candidate/review remain retained.

Focused synthetic checks include actual SIGKILL, rename/fsync ambiguity and cold
publication recovery. These do not promise cleanup after arbitrary SIGKILL/host
crash or preemption of an uninterruptible kernel hang. Linux/WSL and the two
supported Node runtimes are the tested boundary; no native macOS/Windows, provider,
paid-call, installation activation, completed local V1 or new score is claimed.

## Optional matching qualified duplicate evidence

The explicit `captureQualifiedDuplicates:'append-matching-evidence-v1'` policy
is a mechanical ordinary-capture exception, requiring source-bound-v2, exact
canonical content, the same seven labels and valid incoming/intact original
source bindings. It appends eligible receipts while preserving the original
qualification and anchors. It is not semantic deduplication, truth, reaffirmation,
new confidence/currentness promotion, automatic Cards or a benchmark improvement.
The default remains strict, as do manual/explicit/ordered/episode paths; episode
configuration cannot select this policy. Unknown/unqualified/corrupted originals
cannot be silently repaired or replaced. See [the contract](capture.md#optional-matching-qualified-evidence).

Existing suppression, correction/forgetting, source exclusions/session fences and
deletion guards remain in force. Deleting a source can clear the surviving
Memory's qualification; later duplicates can refuse instead of requalifying.
Changing policy does not reopen old Raw events or implicitly rearm an established
host. Updating both config and profile digest still refuses the old preparation.
Installed checks use synthetic ancestry, sources and fake HTTP only, not an
actual native host, provider, semantic score, activation or completed Raw V1.

Retained author fixture reds used an invalid-shaped corrupted digest, counted
Raw registration's independently committed epoch as admission mutation, confused
covered completed-message overlap with incomplete interpretation, counted skipped
part metadata as saved bytes, and used an empty legacy keep-source array forbidden
by schema. Assertions/fixtures were corrected, not runtime boundaries. The first
affected runs hit the author's insufficient 180-second outer cap (actual 143,
ETIMEDOUT, owned cleanup verified); the identical 29 suites passed with a 600-second
cap in about 392 seconds on each Node, consistent with prior full-core runs around
425 seconds. A separate primary launch-order ENOENT preceded tests and was resolved
by awaiting its freeze. The initial installed Codex fixture omitted required
`history_mode:'paginated'`; the existing parser correctly refused it. Its synthetic
header was corrected without changing qualification or host runtime.

Both initial local affected runs passed 35/36 with actual exit 1: the existing
deadline fixture expected process exit 124 but observed 0 without retaining its
provider trace. A controlled synthetic planning delay reproduced exit 0 with
503 `interpretation_incomplete`, planning only and a released slot without refund
on both parent and candidate, on both Nodes. This proves the old assertion lacked
a provider-entry precondition, not the exact cause of those two untraced reds.
The corrected tests separately handshake actual pending provider work before
asserting hard termination/no refund/dead-owner recovery, and planning-only work
before asserting cooperative timeout. Only test windows and fake HTTP changed;
production deadlines, guards and configuration remain unchanged.

## Retained Raw MCP and authored Cards

The [retained-profile path](private-card-terminal-review.md#retained-raw-profile)
is a synthetic-tested installable private preview, not a newly published package,
real-client qualification, semantic-quality result or completed Raw V1. It uses
an already compatible schema 29 store; existing-only opening refuses creation
and migration. Necessary metadata/structure validation is not a full SQL-hash
manifest, historical-data scan or protection against malicious same-owner DDL.
Linux/WSL with Node >=22.16 is the initial boundary; native macOS/Windows
retained-profile verification is not claimed.

The separate private profile freezes namespace/store authority across SDK
negotiation fallback. Identity/permission checks detect file/parent replacement,
not every same-inode content edit; restart to reconfigure. Capture consent and
capture `readPolicy` are not retained-read authority. Fixed Raw off mode changes
no consent, cap or permissions, enables no automatic capture and creates no
provider. It decodes only valid UTF-8 `local-plain-v1` with null key version,
preserving BOM/Unicode; encrypted/unknown formats have no guessed fallback.

Discovery returns bounded indexed metadata, not proof of saving, interpretation
or complete coverage. Reads expose pending/skipped regions and still compute
conversation aggregates; bounded pages do not imply constant-time large-history
latency. Resolve only inspected saved spans. Explicit author text and separate
real-TTY exact-revision confirmation are required; a long message does not become
a Card automatically, and source support is not truth or adoption. Source
deletion cancels bound drafts while confirmed authored text can remain with
support unavailable. Logical deletion does not erase SQLite/WAL/free pages/backups.

Retained author reds were fixture issues: an SDK constant imported from the wrong
export, a synthetic seed decoder stripping BOM, and missing expected revision.
The packaging Node 22 run initially passed 12/13 with actual exit 1: invalid
profile negotiation correctly closed, but the fixture expected a numeric JSON-RPC
code rather than SDK `CONNECTION_CLOSED`; only its predicate changed, not runtime.
Primary's initial wrong-store check used EOF without negotiation, so the lazy SDK
factory never opened core; a real handshake corrected the harness. No runtime
workaround was introduced. Syntax-only `--check-config` intentionally reads no
profile/database/API key and cannot establish store readiness.

## Explicit local host (B4c)

The [foreground local host](raw-local-journal.md#explicit-local-host-b4c)
checks current SQL capture authority before source/header access and before
dispatching the existing worker. SQLite permission snapshots and filesystem
reads are separate operations. A later revocation cannot unread bytes already
opened; registration/publication fences still prevent stale Memory. Capture
consent does not authorize retained Raw reads, which retain their own policy.

The owner explicitly selects one source/session. Claude's private profile and
installation binding are trusted caller configuration, not native-hook
attestation. Codex requires actual host/binary/cache/header helpers; the bounded
tests exercise them against synthetic ancestry and caches. No automatic hook,
daemon, session discovery, qualification probe or background retry is installed.

Preparation creates only a fresh key/state and an external durable intent/ready
marker. Ordinary preparation refuses partial creation, missing established
identity and authority drift without repair. The separate authority-only rearm
above does not regenerate that identity. Deleting all owner state is outside that loss
detection guarantee. Deadlines initiate cancellation with teardown reserve;
actual child close remains required even if it exceeds the nominal155seconds.
Confirmed worker ready/progress survives a late abort; waiting/blocked outcomes
may carry an outer cancellation reason with the unchanged nested summary.

Retained focused reds found a personal namespace normalization mismatch and a
derived runtime trailing slash; corrections remain in the host. Ancestor aliases
could place preparation under usage, while the Linux source opener already
refused aliased source traversal; canonical host comparisons now refuse both
before preparation/source dispatch. A held real child exposed missing outer
deadline reporting, corrected without changing worker identity or progress.
Separate fixture errors (missing home and treating an incomplete reply as saved
acknowledgement progress) are retained as fixture failures. Installed evidence
uses fake HTTP injected by a test-only exact-child spawn wrapper; production
profiles cannot choose executables, runtime roots, environment or test seams.
No real model calls, user sources, automatic Cards, source-to-Card lifecycle or
completed V1 claim is made. Without the separate explicit policy above,
identical-content/new-receipt qualification conflicts remain unchanged.

## Durable local worker (B4b)

The explicit [local worker](raw-local-journal.md#durable-local-worker-b4b)
joins the real private-archive producer→transport→one-shot/core path using
synthetic sources and fake HTTP. It is not automatic Claude/Codex hooks, setup,
full conversation coverage, Card promotion or completed V1. The separate explicit
host rearm above is not generic worker reset or failed-interpretation retry.
Only Linux verified-source capture is implemented; Node20 smoke tests pure
import, not capture. Normal process exit and saved Raw alone are not completion.
Observed saved/skipped acknowledgements are not unique-row or quality scores.

State continuity is fail-closed, not repair: lost claims/cursors/root/key,
authority drift and confirmed interpretation/refusal keep visible failure and
high-water identity. An invocation given the wrong inode/path refuses without
rewriting an otherwise valid cursor; supplying the original inode with matching
anchor/pending bytes can resume that same identity/cadence. A confirmed pending
byte mutation during progress persists a block which later restoration does not
clear. There is no silent epoch reset or new-session fallback. Historical bytes
earlier than the bounded completed-offset anchor are not rehashed every time.

Cooldown is not orphan-death proof. After parent death, safety relies on exact
event registration/admission in the existing core: registered events cannot
reacquire interpretation; never-registered events may acquire their first work.
No wake-up polling or automatic retry exists inside a run. Confirmed incomplete,
quota/authority/deletion refusals and exhausted recovery require later operator
or host recovery, not a changed credential/config filename. Default qualified
dedup still refuses different evidence bindings as qualification_conflict/incomplete;
the separately selected matching-evidence policy is not automatic retry or rearm.
Raw notice/saving and Memory consent remain separate. Plain Raw is not encryption,
and deleting all owner state is not prevented. SIGKILL/kernel hangs cannot promise
scratch/orphan cleanup; tests explicitly reap only their owned descendants.

Retained M2 reds exposed stale corrective writes after uncertain cursor
publication, hidden cancellation, malformed pending cadence combinations and
wall-clock-based lock acquisition. Corrections preserve possibly published
state without overwriting/refunding identity, retain fixed cancellation reasons,
validate cross-field states and use monotonic acquisition time without changing
ownership/reaping. Separate syntax/readback/fake-extraction fixture failures are
retained, not presented as model or core regressions. Bounded source/read reserves
can stop before dispatch; the finite ceilings do not guarantee throughput.

The first final matrix stopped at generic634/635, actual exit1: retaining the
old generated Claude lock conflicted with the unchanged bundle reproducibility
map. The same monotonic three-line correction is synchronized into that generated
copy and the setup copy, without changing capture/recall/pause algorithms,
versions, schemas or module inventory. The original failed matrix is retained;
its reproducibility check is not weakened or exempted.

## Local process transport (B4a)

The opt-in [local transport](raw-local-journal.md#local-process-transport-b4a)
connects a trusted host to one fixed one-shot entrypoint. It is not wired into
automatic host capture, setup or hooks. B4b separately supplies an explicit
durable worker; neither packet completes local V1. Synthetic subprocess/fake-HTTP archive checks establish mechanisms,
not real model quality or user transcript coverage. Full integration is tested
only on Node22.16/24.15; the separate Node20 CI smoke tests pure import without
SQLite, not Node20 capture. Exact stable runtimes >=22.16 are accepted without
download or fallback; this is not a claim that every future runtime was tested.

Configuration binding hashes the UTF-8 text returned by the existing bounded
private reader, not arbitrary file bytes. It does not defend against a hostile
same-user executable or filesystem replacement. HOME must be an explicit existing
owned directory; ordinary0755 HOME is accepted without changing permissions or
reading its contents. Config/store/usage retain their separate private checks.
Only the configured own-data credential is read, once after the config identifies
its name; no constructor-time snapshot of the whole environment is claimed.

The one outer deadline reserves teardown time and awaits actual child close;
Node timers cannot promise termination of an uninterruptible kernel hang. A
capture PID makes failures conservatively uncertain, even if source was already
saved. No-PID spawn failure is known not-started. Neither uncertainty nor a
normal process exit alone permits cursor advancement. There is no retry policy
or cursor persistence in this packet.

The retained two-case actual-process red (exit1) exposed an overly strict HOME
mode check and uncertainty set before a failed capture spawn. Corrections accept
owned0755 directories and use actual launch evidence. A later27/29 focused red
(exit1) was a fixture expectation error: a whitespace-only first part has no
eligible interpretation projection, so its replay is not an admitted duplicate.
The corrected fixture preserves exact Raw receipts, two exact Unicode parts and
zero model usage; a separate admitted-duplicate case retains duplicate coverage.
An earlier26/29 red used a non-normalized fixture runtime path. These retained
reds did not require changing core replay, provider or admission semantics.

A pre-matrix cleanup regression failed0/1 on both runtimes, actual exit1: a
forged AbortSignal prototype passed `instanceof`, then listener registration
threw after allocating the operation timer. Isolated `async_hooks` diagnostics
on both runtimes identified one live timer originating in the process scope
and zero other timers, excluding a test-owned timeout explanation. Native
signal-brand validation now precedes timer allocation; native listener/getter
methods avoid caller-owned overrides during checks and cleanup. Proxies/forged
brands refuse without spawning or leaving an operation timer. The original
source freeze and both red logs remain retained rather than overwritten.
An additional public-boundary regression failed0/1 on both runtimes, actual
exit1: the caller's earlier `instanceof` invoked a Proxy `getPrototypeOf` trap
before the native helper refused it. The public boundary now rejects proxies
before that reflection. This narrow caller correction and its tracked test
follow the retained28-gate historical freeze; affected transport/import/archive
checks are rerun on the corrected snapshot, not claimed from the older bytes.

## Local one-shot adapter (B3)

The [private POSIX one-shot CLI](raw-local-journal.md#local-one-shot-adapter-b3)
handles an already selected/redacted capture-v2 request for a fixed store,
namespace/client and frozen authority. Offline fake-HTTP and installed archive
checks exercise the existing qualified engine, not real model quality, source
truth, full transcript coverage or completed local V1. No hooks, setup, durable
cursor, automatic Card promotion, hosted change or production enablement follows.
Configuration cannot grant itself consent. Plain Raw is not encryption.

Read-only private-file/store/cap preflight follows runtime loading and checks
file identity across read-open; it is not a lock against same-user filesystem
replacement after validation. `configureCap:false` prevents capture construction
from overwriting durable owner caps. The usage root must remain the same across
clients/restarts for a target. Daily accounting limits model-port invocations,
not dollars; it has no protection against the local owner deleting the ledger.
Dispatch consumption is not refunded. Slots remain owned until actual provider
settlement or confirmed dead-process recovery, not just a core timeout race.
Process deadline termination emits no successful completion, but is not proof
of preempting an uninterruptible kernel hang or the future host's outer worker.
Normal process exit can carry a non-2xx interpretation failure; retained Raw
alone never establishes complete interpretation or authorizes cursor advancement.

The first Phase-A combined run passed3/16, actual exit1: two cap-preservation
checks awaited the explicitly deferred journal condition; other failures exposed
an adapter public-namespace mismatch (internal empty project ID versus public
null). Correcting only that adapter boundary made its subprocess cases pass.
The primary's separate Phase-A roster retained16/17, exit1, solely because the
not-yet-implemented cap condition reset50 to1000. These original reds remain
evidence, not waived failures or semantic scores.

The first full verification matrix stopped at the existing Codex live-ancestry
fixture (197/198, actual exit1). A content-free guarded readlink diagnostic on
both Nodes proved that, after observing its owned fake host, the fixture walked
into the actual outer agent and correctly tripped `test_observed_real_codex_host`.
Only that fixture now bounds its injected read/link callbacks to its owned fake
parent before OS access. It still verifies real `/proc` executable/cmdline/stat
and actual binary identity; separate synthetic ancestry cases retain outer-exec
and closest-host coverage. Neither production detection nor the home guard is
relaxed. The original failed matrix and diagnostic reds remain retained.

## Durable local authority (B2b)

The trusted programmatic local controls and frozen startup snapshot are bounded
synthetic-local infrastructure. They do not implement installer/provider policy,
filesystem/SQL setup coordination, hook transport, durable cursor recovery,
MCP lifecycle, hosted controls or production enablement. Revocation fences new
managed publication but does not cancel a dispatched provider cost or erase
completed evidence. Raw notice acknowledgement and saving switches remain
separate from automatic interpretation consent. Historical unmanaged Memory
work keeps its legacy publication behavior; configuring local authority can
still close existing saving tails in that exact namespace/client target.

The independent20-case controls/episode oracle initially failed0/20 on the
fixed parent because the APIs were absent (actual exit1). A first authored
migration/episode run passed23/30 (exit1): seven migration fixtures incorrectly
called a private-Card capability method that the feature-off facade correctly
omits. The corrected fixtures assert method absence. These mechanism tests and
fresh-process private-archive fixtures do not establish semantic model quality
or compatibility with the separately frozen pre-Raw reader schemas18/20–23.

A focused pre-correction race also failed0/2 (exit1): a trusted policy callback
revoked consent and the prepared capture still invoked sealing once before
refusal. Managed policy evaluation now rechecks the full snapshot immediately
after the callback, preventing either client's first seal after that change.

Independent Spec review found another dispatch gap in the first candidate:
consent revoked during the first seal still allowed a second seal in the batch,
although final registration refused and no Raw/admission/model writes occurred.
Both clients with revoke and disable/re-enable failed the independent and
author regressions before correction (0/8, actual exit1). Each sealing dispatch
now checks the same frozen authority outside the crypto-error handler, retaining
`capture_disabled`/`revision_conflict` and stopping after the already-started
first seal. This does not cancel work already dispatched or refresh authority.

## Public Raw constructor (P4b-B1)

Explicit public construction and private-archive programmatic lifecycle do not
complete installed Claude/Codex hooks, transport, controls, cursor recovery or
MCP/terminal acceptance. A primary probe found a pre-existing skipped-tail
barrier gap in both public construction and the internal factory: an incomplete
first part skipped for quota, notice or Raw-off survived pause/resume and rejected
the next ordinal with `raw_part_out_of_order`. Both six-case probes exited 1.
The bounded [B2a correction](plans/raw-skipped-tail-barrier.md) closes these
incomplete policy-skipped tails at an actual namespace/project capture barrier.
Original part/event dispositions remain unchanged and late suffixes stay gaps.
Without that barrier, the predecessor still blocks a higher ordinal; Raw-only
off/on does not repair it. This covers known durable identities during ordinary
pause/resume, not lost-client-state recovery or installed-hook acceptance.

The first new combined public/installed run passed 17/18 (exit 1): its forget
fixture expected `source_unavailable`, while existing exclusion enforcement
correctly returned `source_excluded`. Only that expected code was corrected;
both installed cases already passed. The original failure remains retained.

## Internal Raw producer foundation (P4a)

The [internal producer](raw-local-journal.md#internal-producer-foundation-p4a)
prepares synthetic authorized records; B4b ships its required private primitives,
but it is not automatic installed Claude/Codex Raw
capture, an HTTP endpoint, a cursor writer or completed local V1. Privacy policy
and best-effort secret redaction do not prove semantic truth, full transcript
coverage or permission. Pending identities require the host's original trusted
key/bindings; legacy Claude pending windows remain v1.

The first bounded test run retained one resource failure: seven-byte buffers
were applied to every scratch-stage copy, so a long native-redactor case exceeded
the unchanged 30-second preparation deadline (9/10, actual exit 1). Fixed 16 KiB
scratch buffers preserve the independent source-read bound; the same ten cases
then passed, actual exit 0. Early primary checks also exposed caller-idle deadline
charging, missing ordinal order checks, native errors/empty scratch residue
before initialization completed, malformed pending fields classified as
changed source, and binding property order changing replay identities. These
failures remain in the primary evidence with focused regressions.
A 20 MiB/32 MiB-heap run was an initial checkpoint, not proof against
whole-string retention because V8 may store ASCII strings using one byte.

The P4a Spec review exposed a missing complete-envelope byte check for quota
acknowledgements: valid long fractional timestamps let 65,537/65,538-byte JSON
responses pass. The independent boundary probe initially passed 2/4 (exit 1),
and the tracked regression also failed before correction. Acknowledgement
validation now checks the full serialized envelope after bounded shape checks;
65,536 bytes remains accepted, and quota still does not authorize advancement.

The final resource probe streams a 32 MiB assignment prefix with a bounded
synthetic secret under a 32 MiB old-space limit, instrumenting actual I/O, live
scratch bytes/files and cleanup. Its explicit 300-second allowance does not
establish default 30-second fit. Filesystem calls cannot be forcibly preempted.
Lost ownership proof or replaced paths retain/refuse rather than delete foreign
data; logical unlink is not secure erasure. SIGKILL/host crashes cannot guarantee
scratch cleanup.

The opt-in [integrated local engine preview](private-engine-v1-local.md) owns
submitted notes, retained Memory receipt excerpts, Memories and private authored
Cards in one core. It includes exact-namespace common reads, explicitly reviewed
current Card applicability, two typed MOC views, bounded Card placement and
explicit navigation mappings. Installed local MCP supports read/draft/organization
operations; a separate real-TTY command confirms an exact private draft and may
record an explicitly chosen applicability review. Default startup remains off for
these additions. Memory writes never automatically promote a Card.

Receipt sources remain excerpt-only with unknown conversation coverage. Required
Memory revisions invalidate dependents transactionally, including feature-off
writers: drafts cancel and purge; confirmed authored bodies remain private with
unavailable support and no carried-forward current review. Targeted synthetic
installed source/Card and H/R/M stdio/TTY lifecycle checks passed on Node 22.16
and 24.15 with actual exit 0. Final combined full-core/MCP/artifact checks,
independent dual review and latest-head CI are still underway; the delivery PR
will record final evidence. These checks establish mechanics, not semantic
support, truth, adoption, product usability or full conversation capture.

Full Raw, hosted encryption/approval, remote ChatGPT authentication, publication,
product UI/integration and semantic quality remain separate
[completion gates](plans/private-engine-v1-completion.md). The product integrates
this core's Cards and supplies its UI, authority and publication decisions; it
does not need a second Card engine. Mapping activation/refresh/removal remains a
trusted host API; MCP startup cannot grant that explicit-user authority.

The recorded MCP dependency audit found a high-severity OAuth advisory in the
development-only client dependency; the keyless synthetic checks do not use
OAuth. The runtime-only audit
(`npm audit --prefix adapters/mcp --omit=dev --json`) returned zero vulnerabilities
and exit 0; the full development audit returned exit 1. No forced dependency
upgrade or clean-development-audit claim is included in this slice.

The [offline long-history stage gate](plans/long-history-stage-gate.md) uses
scripted visible-input-only models and exact synthetic source receipts. A
default 1,024-ID candidate prefix can miss a retained target among 1,025
captured memories; explicit bounded keyset routing can carry that target into
the packed answer request, while coverage remains `budget_exhausted`. These
mechanical observations do not establish real-model extraction, semantic
selection, answer accuracy, complete retention, current-choice judgment,
installed-host readiness or cost superiority. Dated A/B sources remain
separate evidence; the script emits no adopted latest choice.

The opt-in [indexed-evidence mixed comparison profile](longmemeval-comparison.md#explicit-indexed-evidence-mixed-profile)
has bounded synthetic coverage through the actual public core and pinned native
Mem0 with fake HTTP. It omits qualification explicitly, retains the strict
mechanical gate and full fixed-N failures, and separately projects every allowed
route and native fallback. Selected receipts can still omit necessary source;
classification and recall can fail, and conflicting dated choices remain
unresolved evidence. Successful empty extraction is not useful retention. This
does not repair qualified semantics, establish a measured quality/cost result,
authorize a paid run or expose a host flag. Frozen historical results remain
unchanged. The later independently frozen four-case real-model pilot is
reported below; installed-host acceptance is still required.

The [four-case long-history live pilot](evidence/long-history-live-pilot.md)
completed all eight arms and judgments with common resolved N=4: Cairn 3/4
correct, Mem0 2/4 correct on authored synthetic questions. Its explicit
indexed-evidence, bounded-source-scan path is opt-in; it does not validate
default MOC navigation or installed MCP/Hermes use. One Cairn answer omitted
important premise and reconfirmation information even though the relevant
source passages were selected. Four simple authored cases cannot establish
reliable current-decision reasoning, comparative superiority or an official
benchmark score.

This is the one place where Cairn Memory records what does not yet work, what
the frozen evaluations found, and which claims the evidence does not support.
The README links here from its first screen and stays short. A PR that adds or
revises evidence appends to or edits this file rather than the README; see
[CONTRIBUTING](../CONTRIBUTING.md#where-to-record-evaluation-limitations).

The [2026-10-03 promotion installation batch](promotion/install-validation/README.md)
passed three clean Linux x64 source installs and all 18 model-free walkthrough
stages on Node 22.16.0 and 24.15.0. All were operated by one AI agent, using
separate local Git archives, empty installation targets and empty npm caches.
They did not retest the public Git clone, semantic recall or a named chat host.
The new [36-second demo](promotion/demo/README.md) presents selected fields from
one additional real synthetic tool transcript, with edited display timing.
The unfamiliar-human installation and five-reader comprehension checks remain
pending. This batch changes no extraction-quality or broad-promotion gate.

The later [2026-10-05 native Windows check](evidence/windows-install.md) verifies
source installation and the six-stage keyless SDK lifecycle on Windows x64 with
Node 24.15.0 after correcting npm CLI launch and CRLF archive parsing. It is
agent-operated and separate from the reader's report of installing after manual
changes. It does not establish named chat-client compatibility, Windows ACL
privacy, semantic recall or long-term retention quality. The POSIX maintainer
test runner remains unsupported on Windows; the focused native check owns its
own scratch and cleanup.

The section below is the text that opened the README until 2026-09-18, moved
here unchanged apart from link paths and the bold lead-in becoming this section's heading.

## Preview, not a quality guarantee

The opt-in embedded [indexed evidence capture](indexed-evidence-capture.md)
lane separates indexed extraction/admission from optional claim qualification;
it is not a repair or fallback for the qualified lane. Synthetic core and actual
installed-adapter fake-HTTP checks establish exact selected receipts, cold reads,
atomic failures and absent qualifier calls, not model fidelity, a complete source
archive, host usability or improved answer correctness. Extraction/classification
and bounded source retrieval can still fail or omit needed passages. Conflicting
dated choices remain evidence, not automatically adjudicated decisions. No MCP/
Hermes exposure, existing benchmark/grant change, replay of consumed cases or
paid result is authorized. The prior 13/24 semantic-probe result is unchanged.

The optional [indexed source-window experiment](retained-source-windows.md)
can retain a scripted passage beyond the ordinary first-800-unit receipt
prefix in synthetic actual-core and installed fake-HTTP tests. It does not
measure real-model selection, semantic support, answer accuracy, installed
Hermes behavior or matched Mem0 performance. Window selection can still omit
the needed context; four receipts, five items, existing token ceilings and
bounded recall remain. Rationale and staged-evidence integration are not
supported. The current public comparison verifies prefix receipts and must
reject window receipts that differ; no prior result is relabeled.
The separate [indexed-window offline comparison](indexed-window-provenance.md)
can verify exact catalog membership through synthetic cold recall and answer
packing, but the official scorer rejects its schema. It is not a balanced paid
comparison or evidence of improved real-model answers.
The [qualified-prefix ingestion control](longmemeval-ingestion.md#qualified-prefix-control-offline-only)
uses the same source-bound-v2 qualification as indexed windows but exposes only
the retained first-prefix view. It is offline ingestion mechanics, not a
matched answer comparison or proof that either treatment improves QA. An
injected callback must be the intended trusted core; response metadata alone
does not attest its origin.
The [qualified source-pair generator](qualified-source-pair.md) now places that
prefix control beside indexed windows under one source-bound-v2 offline
protocol. It verifies deterministic binding, isolated synthetic capture/recall
and source-only answer requests. Its separate offline two-arm official-style
scorer checks a separately supplied trusted protocol, runs matching scoring
scopes and counts unresolved cases against a fixed roster. Synthetic request,
sidecar and fake-HTTP guard tests verify compatibility and accounting, not a
balanced scored campaign, semantic support, model configuration, provider
context fit or matched Mem0 performance. The reported fixed-N ranges are
best/worst unresolved bounds, not confidence intervals. Digests are not
signatures; an arbitrary injected callback is not authenticated. A fresh
roster, fully guarded capture and answer transports, resource caps and reviewed
paid authorization remain separate gates. No new paid grant follows.
The [offline cohort preparation helpers](source-pair-cohort-preparation.md)
derive a disjoint six-case development membership and thirty reserved holdout
IDs from a caller-supplied audited ID/type inventory, plus a conservative
two-arm request/reservation ceiling. They cannot prove the exclusion list is
complete, that prompts fit provider limits, that the needed source survives or
that any answer will be correct. Reserving holdout IDs does not authorize
opening their answers or running them. The source experiment isolates two
exposure policies, not a matched Mem0 result or parity claim; the real ledger,
prices, caps and comparator budget remain unaudited in this offline packet.

The first paid six-case source-pair development attempt halted after seven
requests and produced zero scored cases. Its prefix capture returned
`invalid_model_output`; retained evidence does not identify that failure's
method or subreason. Its indexed capture later observed an 8,701-token provider
input count above the unchanged 7,024-token ceiling and globally halted.
The [qualification budget-boundary repair](plans/qualification-budget-boundary.md)
compacts only the candidate-qualification wire schema and adds a conservative
complete-wire local check. Synthetic fake-HTTP tests now fit the previously
failing prompt-shaped fixture without dropping source receipts, but the
historic method, real-provider token savings and strict-schema compatibility
remain unverified. The consumed attempts are not reclassified or retried, and
there is no new semantic score or quality claim.

The next closed six-case source-pair development run completed its wrapper but
resolved zero cases in both arms: eight arm ingestions reached qualification
request bounds, four reached the qualification compiler's then-generic
rejection, and no answer or judge call occurred. The frozen old cohorts are not
relabelled or retried. The [evidence-pool-v1 offline repair](qualification-evidence-pool.md)
shrinks one fixed five-item synthetic qualification request enough to reach
fake HTTP and compile exact anchors, and adds finite source-free compiler
failure categories. It does not identify the old compiler subreasons, prove
real-provider strict-schema behavior, or resolve any benchmark case. The
maximum-size unique-source synthetic fixture (five items × four 800-unit
excerpts) still exceeds the unchanged local budget as one request. Qualification
is now planned per item, using the adapter's own wire fit, so that fixture
reaches one request per item instead of refusing
([model input budgets](model-input-budgets.md)).

An [optional adaptive text catalog](qualification-evidence-pool.md) shares only
identical candidate text bytes in a local qualification request while retaining
every candidate ID, role and receipt mapping. The repeated-source five-item ×
four-receipt × 800-unit synthetic fake-HTTP fixture fits and compiles original
anchors; an all-unique fixture remains too large for one request and is now
planned per item. Token ceilings are unchanged.
Existing v1 guards deny this named mode, and no paid cohort, real-provider response,
semantic quality or source-selection improvement has been demonstrated.

The separately versioned adaptive source-pair guard can authorize both inline
and text-catalog qualification for a declared artifact/configuration identity
and a fixed normalized roster. Synthetic temporary-ledger and installed local
archive tests exercise its one-shot claim, phase caps, original source anchors
and request accounting with fake HTTP. The capability's artifact and
configuration hashes are declarations: issuing the grant does not inspect or
certify the actual runtime, and the offline installed test is not a paid launch.
Real-provider strict-schema compatibility, semantic support, benchmark answers
and quality remain unmeasured. Existing grants still deny catalog mode.

An [explicit embedding-ledger migration](embedding-ledger-migration.md) and
bound-v2 accounting handle have offline synthetic coverage for mixed historical
outcomes, original rowid gaps, one shared request/money cap and foreign-edit
fencing. Migration is opt-in and irreversible for old v1 readers: existing
request guards reject v2 before claim or transport. The new handle is an
accounting seam only, not a mixed-engine grant, credential owner or Mem0
transport. That original offline implementation packet migrated no operator
ledger; its synthetic tests alone establish no provider request, recall
comparison or quality result. Later operational evidence is separate from
these migration tests; see the [historical S3 result](plans/s3-paired-result.md).
The [mixed embedding lineage assertion](embedding-ledger-migration.md) can
check a supplied v2 snapshot against the existing 200M parent and original
historical prefix without opening a ledger. Its success does not authenticate
the supplied current suffix or digest, bind a new grant, or authorize transport.
The separately versioned offline mixed guard now binds that full history from
B4's authentic in-transaction snapshot, under a private one-shot claim. It
still does not authenticate an installed native child or contain its requests.
The separate [contained native gateway](plans/mem0-native-gateway.md) now
rehashes a local pinned Mem0/Python installation and exercises real native
add/get/search under Linux bwrap and a private AF_UNIX fake-provider gateway.
It verifies returned ADD persistence, scoped accounting, child exit and its
owned process-group disappearance for that run. These local checks assume a
trusted OS and same-UID host; they are not an immutable artifact, general
sandbox guarantee, credential owner, paid launch, source-provenance renderer,
matched-resource comparison, or semantic quality measurement.
The no-optional-spaCy condition is checked through ordinary package/module
and distribution layouts in the hashed roots and again at child import
resolution before Mem0 configuration. These are preflight checks on a trusted
local installation, not universal proof against hostile import hooks or
same-UID mutation, and they do not establish native semantic behavior.
An earlier Node 24 local native gate failed 7/8 when a 1 ms timeout sent TERM
during bwrap startup: its outer leader exited, but namespace PID 1 remained
blocked on the startup eventfd and kept stdio open. A scoped pidfd diagnostic
cleaned that exact process; the failure was not reclassified as a pass. The
corrected disposable-case abort policy sends immediate KILL only to the
original owned group while its leader is still observed live. Controlled
real-bwrap and actual-kernel startup tests reproduced the old failure and
passed under the correction. This is not universal protection against every
OS race, nor permission to signal a numeric group after leader exit.

The [controlled Mem0 text-wire profile](plans/mem0-wire-contract.md) validates
synthetic chat and embedding JSON, pinned token counts, bounded response shape
and known usage cost without sending requests. Its caps are prospective
engineering limits, not native Mem0 limits or a parity claim. The validator
does not hold credentials, reserve money, grant transport, run native Mem0 or
measure recall. The mixed guard composes it with B4 only for synthetic fake-HTTP
tests; a contained gateway, real compatibility and measured parity remain
separate work.

The [mixed resource projection](plans/mixed-resource-projection.md) is a pure
conditional money/request ceiling for a supplied fixed roster and accepted
profile snapshots, not a new quality score or launch authorization. It never
reads the last dated campaign audit or an operational ledger. The v2
[aggregate fact-payload correction](plans/mixed-resource-byte-bound.md) uses
the accepted native chat response's complete byte cap to bound fact embedding
tokens across each pass. It still reserves both attempted batches and all
possible singleton fallbacks, including previously successful chunks; the
historical v1 independent token-maxima projection is retained, not rewritten.
The later v3 [bounded qualifier partition](plans/bounded-qualification-partitions.md)
reserves up to five qualifier count/generation pairs per source batch; it does
not make an oversized individual source fit or establish that cited evidence
entails a field. Old stopped pilots and reservations remain unchanged.
No version is an expected invoice: a ceiling above available funds does
not prove the run cannot fit, and a ceiling below them does not guarantee
completion. The v3 high-batch fixed-30 arithmetic exceeds the earlier request
cap even before accounting for previously consumed requests. Fresh request-cap
and money checks, verified native configuration, the full common protocol,
actual artifact and source-only checks
remain necessary before a paid pilot.

The [same-dollar request-cap transition](plans/mixed-request-cap-v2.md) adds
an explicit schema-2 allowance without increasing the US$200 monetary limit,
resetting reservations or rewriting earlier authorization records. Its full
history digest necessarily changes because it includes the request cap; the
allowance binds old- and new-cap prefix digests over the same retained rows.
This is an operator transition, not permission to retry failed questions.
Synthetic checks do not establish that an operational transition has occurred.
Only the new parent assertion uses the larger bounded lineage envelope; old
parent behavior remains unchanged. A 420,000-row synthetic check reached a
fake physical request, but the whole check took roughly 84–100 seconds and
about 3 GiB resident memory. Repeated full-history validation remains quadratic
over a growing campaign. These are evaluation-accounting costs, not measured
memory-engine performance or a practical throughput guarantee.

[Mixed attempt diagnostics](plans/mixed-bounded-attempt-diagnostics.md) retain
all numeric request/cost/unknown-usage aggregates but only the first 64 detailed
attempt stages per arm. `retainedStageCount` and `omittedStageCount` explicitly
describe that sample; use the guard and ledger artifacts for the full trail.
This prevents an unbounded duplicate diagnostics list from exhausting the
fixed report envelope after generation. Synthetic large-report validation is
not a completed paid run or a semantic score. Unexpected process death before
the generator returns still does not supply per-case generation checkpoints or
authorize resuming the consumed cohort.

The completed fixed-30 S3 attempt remains unresolved for every Cairn arm at
ingestion. Its retained report records `ingestion_incomplete` but not each
capture's underlying error code, stage or model diagnostic; those facts cannot
be reconstructed or relabeled from later code. The bounded
[ingestion-stop diagnostics](plans/mixed-ingestion-observability.md) add
source-free status counts, first stop and finite model observations only to
future runs. Synthetic tests distinguish several boundaries but do not prove
which one occurred in the old 30 cases, fix capture, improve answer quality or
authorize a new run.

The completed N1 single synthetic-case diagnostic retained a narrower but
still inconclusive boundary: Cairn completed three ingestion batches, then
batch index 3 failed with `invalid_model_output` during `qualifyCandidates`;
the adapter reported `output_shape` and the core reported
`adapter_output_invalid`. Mem0 completed, and the mixed runner did not halt.
That finite trace did not retain the response body and cannot establish which
field was malformed, whether the provider or another boundary caused it, or
what would happen for a different case. The dependent
[qualification output diagnostics](plans/qualification-output-diagnostics.md)
split future local shape observations without reclassifying N1, changing
capture acceptance, improving measured quality or authorizing a replay.
The later [qualification wire guidance](plans/qualification-wire-guidance.md)
removes conflicting output-format examples from the standard provider request,
but this synthetic-tested prompt change does not identify N1's malformed
field, prove it caused N1's failure, or establish real-provider reliability or
memory-quality improvement.

The fresh [N2 six-batch synthetic canary](evidence/qualification-canary.md)
completed all six Cairn captures and produced one correct, resolved synthetic
answer in each Cairn/Mem0 arm. Its single new case is operational evidence,
not an official LongMemEval score, a statistical comparison, proof of semantic
fidelity, or a causal repair of N1's qualification failure. The fixed-30 S3
ingestion failures and N1 failure remain unchanged. N2's 63 requests added
420,352 micro-USD of conservative reservation, not an invoice; the unchanged
shared cap and zero-pending aggregate were checked independently. A separately
sealed and authorized multi-type pilot remains necessary before any new
fixed-30 comparison or broader quality claim.

The later [fresh six-type official pilot](evidence/qualification-official-pilot.md)
completed without a global halt but did not pass mechanical completion or
paired scoreability. Cairn completed no full case ingestion or answer: all six
judgments are unresolved, not incorrect. Four ingestions ended at a
`qualifyCandidates` context-budget boundary and two at a finite
qualification-slot mapping boundary followed by adapter-output rejection;
the exact unretained response and underlying causes are unknown. Mem0 produced
six answers, four judged correct and two incorrect, but the common resolved
denominator is zero. This small pilot is neither a leaderboard result nor
evidence of parity, source fidelity or product reliability. The 976 new
requests all settled and added 5,582,424 micro-USD of conservative reservation,
not a bill; 29 costs remain unknown. S3, N1 and N2 are unchanged. No fresh
fixed-30 expansion follows this failed feasibility gate: context-fit and
slot-mapping falsifiers, reviewed repair and a separately frozen new probe
come first, without retrying these consumed cases.

The [controlled mixed comparison runner](plans/mixed-comparison-runner.md)'s
offline fake-HTTP tests are engineering evidence, not a measured Cairn/Mem0
score.
Its `apiKey` parameter serves Cairn and shared answer/judge requests; the
native child uses a local-only dummy key and operational launches require a
separately trusted parent-side credential broker. No provider credential is
passed into the native child. The runner can await core work, owned guarded
promises,
X accounting and native cleanup; it cannot attest an abort-ignoring physical
fetch's settlement. The guard fences late responses, and local tests must
release such test doubles and check for no late dispatch or database progress.
An X-authenticated local deadline can leave unknown actual cost while retaining
full reservation; other unknown outcomes globally stop. A failed native HTTP
timeout that races X's own timer may be an ambiguous external abort, not an
authenticated local deadline, and is never promoted by error text alone. The
v2 native configuration adds a fixed five-second local child/socket transport
grace so X normally owns the provider deadline, without extending that X
deadline or guaranteeing cross-process scheduling under starvation.
Synthetic admission and source-receipt checks cannot prove real-model support,
retrieval usefulness, parity, resource fit or semantic answer quality.

An M12b scripted mixed-scoring test exposed a valid Python-issued non-string
reference capability being rejected before judging: the validated evaluator
snapshot had null-prototype objects, while the existing strict capability
binding expected ordinary JSON objects. Cloning only after full validation
restored the detached representation without weakening that binding. Genuine
and wrong-bound capability checks now pass under fake HTTP; they add no
measured comparison score or real-model quality evidence.

PR243's first LongMemEval Node24 CI run (`36263553569`) failed before the
projection tests: the evaluation-only import chain could not resolve the
existing OpenAI adapter's `tiktoken` dependency. The paired Node22 matrix leg
was cancelled, not passed or failed. The LongMemEval CI job and contributor
instructions now require the adapter's existing locked isolated install before
tests; a dependency-free checkout reproduced the failure and the same suite
passed after that install. This is a test prerequisite correction, not evidence
about projection arithmetic, real resource fit or benchmark quality. The public
core installation and its dependency surface remain unchanged.

The first PR233 CI run (`36148762416`) failed the OpenAI Node22.16 tokenizer
performance test at its unchanged five-second child-process timeout; the other
223 adapter tests passed. A controlled two-CPU diagnostic reproduced that timeout
in eight of eight copies. With the same 30 test files forced to concurrency 16
on two CPUs, 222 tests passed and two timed out (the tokenizer test and a CLI
child-process test). Isolated prior and current candidate counts used about 1.5
CPU seconds each but about six wall-clock seconds under contention. These
observations show scheduling sensitivity, not the exact cause on the CI host.
The adapter test script now runs those files sequentially; external CPU load
can still make the unchanged five-second guard fail. This is an execution
stability correction, with no new model or product-performance result.

New installed source-pair launches can retain bounded, source-free model
failure events separately by case and arm, but the earlier halted R5 run did
not collect them. Its prefix `invalid_model_output` remains unattributed.
Events identify a finite rejecting boundary, not a provider root cause or
semantic error; missing events can mean no emission or failed observation.
The per-case projection is best effort, and its failure is counted only when
the terminal report persists. This offline observability does not authorize a
retry, provider call or quality claim.

The [offline synthetic evidence-lineage harness](plans/synthetic-evidence-lineage.md)
uses scripted model callbacks and fresh temporary stores to show where fixed
source receipts stop moving through capture, recall and answer packing. It adds
no quality score and measures no semantic accuracy. A source-to-receipt link
does not prove that the needed fact, qualification or meaning was retained.
An unobserved downstream stage is unknown, including when classification
failure stops the public comparison before recall. The harness cannot diagnose
the historical eight wrong questions or support a product reliability claim.
Its small capture-based fixtures do not test candidate discovery beyond the
index scan prefix. A separate direct-admit synthetic capacity diagnostic put
1,025 current unfiled memories in one namespace; a query for the memory beyond
the first 1,024 scanned IDs was not visible in two map pages and recall reported
`budget_exhausted`. After one different low-ID memory was forgotten, the same
target became visible and returned with 1,024 current rows. This demonstrates
a scan-prefix boundary, not a diagnosis of past wrong answers. A positive
beyond-prefix regression is needed before changing candidate retrieval.

The optional [Python reference sidecar](official-reference-rendering.md)
preserves number/array rendering from original JSON for official-style judging.
It is evaluator-only and requires an independently pinned sidecar digest.
Hash/capability checks bind reviewed artifacts; they do not authenticate the
corpus or prove a model was called. Without that opt-in binding, non-string
references still remain unresolved. No public accuracy result follows from
these synthetic compatibility tests.

The [offline public comparison](public-longmemeval-comparison.md) and
[official-style scoring adapter](official-longmemeval-scoring.md) provide
synthetic plumbing, not measured accuracy. The three arms now retain source
dates and Cairn uses source receipts rather than generated summaries. Capture
itself is still source-time-unaware. Context counts are caller estimates, not
proof of a provider's context-window fit. The default scorer verifies string
references only; numeric/array references require the opt-in bound Python
sidecar above or remain unresolved. A complete
protocol record does not prove that a real provider ran. Dataset exposure,
configuration freeze, guarded transport and independently reviewed paid results
remain separate gates; no competitor comparison or promotion readiness follows.

The private public-pilot loader defaults to seven prepared cases. Its explicit
`--max-prepared-cases` opt-in can raise only that manifest-count ceiling, up to
500; it neither enlarges the fixed artifact byte limits nor proves that a
larger cohort fits them. It also grants no monetary or request authority and
does not establish benchmark quality. Current coverage is synthetic and
offline; any paid larger-cohort run remains separately gated.

The [fresh six-case development smoke](fresh-reliability-smoke.md) reached a
terminal real-model result on 2026-09-25 at runtime
`45eca22639836e8035c3ccbbe6403a9f5c076b1d`: every arm generated and
judged 6/6 answers. The [archived aggregate](evidence/fresh-reliability-smoke.md)
records Cairn 2 correct/4 wrong/0 unresolved, full history 3/3/0, and no
memory 0/6/0. Its dry-run did not issue or prove a case-deadline capability;
the one-shot launch was separate. This selected small default-core roster
cannot establish comparative superiority, population accuracy, installed
Hermes behavior or that historical failures were repaired; it is distinct
from the later [official six-type qualification pilot](evidence/qualification-official-pilot.md).
The offline genuine-core-timeout smoke test now drives the real core timer in
an isolated test-only process and confirms five later cases continue; it does
not calibrate a 30-second wall-clock deadline. Its earlier Node 24 full-suite
45-second outer-timeout failure remains retained, with initial cause unknown.
It exercises embedded default capture and recall, without native v2
qualification, explicit recovery or a capture invocation deadline. The old
30-case counts remain unchanged.

The [Mem0 OSS actual-engine synthetic preflight](mem0-engine-preflight.md)
uses a hash-pinned Python 3.11 install, fake loopback model responses and
temporary local stores. It verifies request and evidence plumbing only; its
fake facts are not recall accuracy or a matched competitor result. Mem0 OSS at
this pin rejects direct timestamp/reference-date parameters and does not
return exact source spans. Its default extraction uses the run date unless a
separate fair replay treatment is frozen. The child-process socket check is
not a paid-run outbound or cost guard. At that preflight checkpoint S3 was
pending; the later terminal fixed-30 outcome is recorded separately in the
[historical S3 result](plans/s3-paired-result.md).

The public-comparison provenance adapter previously expected only capture's
first 800-unit normalized source prefix. When that prefix ended in whitespace,
admission's existing second canonicalization trimmed it before storage and the
adapter incorrectly blocked the exact stored receipt. The adapter now derives
the same single canonical form as capture plus admission while retaining exact
identity, role, source-map and excerpt equality. This is an evaluation-adapter
repair, not a storage migration, recall improvement, semantic-quality result or
reason to revise any retained historical outcome.

The experimental answer-template v2 only moves the quoted evidence before a
separate final current question/date in the private evaluation request. Its
synthetic tests establish request, identity, resume, and merge mechanics—not
better instruction following or answer quality. V1 and v2 scores are distinct
protocols and must not be compared as though the request were unchanged.

An installed subprocess has passed a real
model-backed remember → restart → sourced recall → forget loop. The frozen
semantic evaluation still fails source support: an extractor sometimes turns
“uses a language” into “is implemented using it.” [All retained results](https://github.com/Cairn-ink/cairn-memory/pull/23)
remain visible. This is synthetic evidence, not a competitor benchmark or a
claim that real users save a measured amount of time.

An explicitly selected [experimental extraction profile](plans/extraction-model-profile.md)
passed the frozen synthetic gate after independent agent review. The default
model's failure remains; MCP does not automatically enable the experimental
profile, which is a programmatic adapter option. MCP `remember_memory` saves
explicit content directly; it does not run that extractor. Those extraction
scores therefore do not certify the MCP recall experience.

The [paired update-reliability experiment](evidence/qualified-comparison.md)
also remains failed: the experimental source-ordered capture path can retire an
unchanged fact or another person's still-valid preference. A source receipt and
model-declared update labels are not a truth guarantee. This is separate from
the MCP tools' explicit remember/correct operations; no automatic transcript
capture or new quality certification is implied.

The latest [eight-case source-support pilot](../evaluations/results/source-support-v1.json)
stored and recalled all ten records but still showed false adoption and lost
uncertainty. Optional [source-only context](source-evidence-context.md)
separates retained passages from generated interpretations; it does not certify
source completeness or downstream answers. The
[integration inventory](source-reliability-integration.md) distinguishes
shipped security work, developer-preview changes and unfinished reliability goals.

## Verified preview baseline is not a semantic benchmark

The [consolidation baseline](plans/pr-consolidation.md) combines a narrow
filing-only rationale preservation fix, a bounded direct premise-challenge
read fix extracted from #136, an explicit local MCP source-evidence recall
startup default, provider response-byte ownership, and an installed cold-recall
regression. These are engineering and offline regression checks.
They do not show that proposed rationale is correct, that source selection is
complete, or that an answer faithfully uses the retained evidence. The larger
rationale lifecycle in #142 and the remaining #136 branch, as well as later
experimental assessment paths, were not adopted as a whole; their code and
prior failures remain in archived branches and evidence.

There is no measured LongMemEval score for this combined candidate. A public,
reproducible benchmark needs a frozen dataset and scoring protocol, declared
model/configuration and comparison arms, retained per-case failures, and an
independent review before any quality claim. Offline ingestion/comparison demos
exercise mechanics with scripted models; they are not that measurement. No
paid evaluation or broad promotion is authorized by this consolidation.

Prepared LongMemEval v1 histories exposed raw session-ID labels to ingestion
and answer evidence, and legacy turn IDs depended on those labels. A source
session ID could itself encode an answer or abstention. Preparation v2 blinds
that metadata and makes turn identities label-independent, with an offline
synthetic preparation → local-core comparison → scoring regression. Old v1
artifacts must be regenerated, not counted as blinded. This repair does not
scrub exact source prose, prove public benchmark quality, or revise retained
historical results.

## Capture-admission diagnostics are prospective mechanics, not coverage

Fresh private public-pilot diagnostics can distinguish a completed empty
capture, suppression, admitted references, an exact duplicate, a capture
failure and admission followed by classification failure. This observation is
prospective. An old completed batch did not retain this observation or the
receipts needed to determine retroactively which submitted messages extraction
omitted; absence of the new subsection is unavailable evidence, not a measured
zero. This does not erase separately retained failure evidence.

`admittedReferenceCount` counts references accepted by the core. It is not a
new-memory count: content deduplication may return an existing memory. It is
also not retained-message or source coverage: partial extraction can omit
messages despite a nonzero count, and stage `admitted` can accompany zero
references. The diagnostic says nothing about semantic quality, answer quality
or whether a source claim is true.

The private observation retains at most 64 primitive-only rows per case, counts
overflow and marks malformed response projections unavailable. It retains no
source text or identifiers and does not enter ordinary comparison output,
scoring, aggregates or the redacted report. Default qualified deduplication attaches
only for identical resolved source anchors; changed source identity still fails
with `qualification_conflict`. The separate matching-evidence policy above is
not enabled by this observer and does not rescore historical results. No source
archive, staging default, retry or source-bound-v2 benchmark switch is added.

## Historical extraction rejection remains unattributed

Three retained cohort failures are categorized as
`invalid_extraction_source_range`, but the offending indices and provider
objects are unavailable. The optional OpenAI adapter now limits its outgoing
extract schema to the current canonical message indices, closing a demonstrated
request-schema gap in synthetic fake-HTTP tests. This does not identify why the
three earlier requests failed, repair an invalid historical output, prevent
semantic misinterpretation, or establish a new benchmark result. Core still
rejects invalid and duplicate references independently. See the
[bounded repair plan](plans/extraction-source-domain.md).

The retained six-case public pilot records one legacy `invalid_extraction`
event, but not the rejected extraction object or provider response. Its exact
validation branch is therefore unproven. Prospective fixed extraction reasons
can distinguish shape, text/value and source-selection checks without retaining
returned values or indices; they cannot refine that old event, repair the old
case or justify a paid retry. This is an observability change, not evidence of
better extraction, recall or answer quality.

## Recall-stage observations are mechanics, not retrieval quality

Fresh private public-pilot diagnostics can prospectively distinguish visible
map items followed by empty model selection, selected/fetched candidates followed
by empty model ranking, and final ranked candidates omitted by whole-item answer
packing. Old pilot artifacts did not retain these stage observations and cannot
be reconstructed from storage counts or final `candidateCount`; absence is
unavailable evidence, not an observed zero.

Selection and rank counts describe bounded adapter-returned shapes before core
validates membership, duplicates, freshness, namespace limits and output
budgets. They are not counts of accepted, relevant or correct memories. Final
`candidateCount` remains post-core-ranking output, and `selectedCount` remains
answer-packed items. Likewise, core `budget_exhausted` means map/fetch traversal
did not prove completion under its bounds; it is not evidence that the experiment
spent its monetary/request allowance or exhausted provider tokens, and it does
not explain why a model returned no refs.

The private observation contains only bounded counts, booleans, ordinals,
closed status enums and overflow state. It retains no question, source, label,
answer or identifier and no source-derived hash; identifiers used to count
unique model-returned refs remain transient. Malformed fields are null/unavailable,
late settlements are ignored after case close, and the subsection never enters
comparison output, scoring, aggregates or the redacted report. These mechanics
do not establish answer quality, semantic recall, source sufficiency or a fix
for any historical result.

## Complementary ranking is an unscored prompt candidate

The explicit source-evidence rank prompt now asks one existing rank call to
preserve complementary directly relevant evidence for multi-part, temporal and
changed-reason questions. Offline actual-core tests show that complete retained
receipts reach that call and valid selected references survive the unchanged
final read. Scripted outputs do not establish that a provider will select those
references, improve answers or resist source-embedded instructions.

The twelve-case public fixture is wholly synthetic and its expectations are
kept outside model input. The exact prior prompt is retained for a future paired
comparison; no paid call or semantic score is included here. Earlier examples
where rank reduced several selected references to one only motivate the
hypothesis. They do not prove ranking caused the missing answer evidence, that
the selected sources were necessary, or that this candidate repairs an old
LongMemEval result.

The candidate does not change navigation, the 120-unit query-aware selector
label, map/fetch traversal, caps, token budgets, current-only ordinary recall or
answer synthesis. Required evidence can therefore remain outside the rank pool,
the fixed result limit can still exclude it, additional context can add noise,
and a final answer can still misread perfectly retained source. See the
[candidate description](source-coverage-ranking.md).

## Source-aware candidate navigation is a bounded literal heuristic

Explicit `source-evidence` and `rationale-evidence` recall can now use at most
the first four stable-ID receipt excerpts of each eligible current memory as
private select-label features. This improves literal reachability when a
generated interpretation omits query words, but it is not semantic retrieval,
source completeness or answer-quality evidence. Whole Unicode letter/number
runs still do not handle paraphrases, stemming, synonyms or dictionary-style
CJK segmentation. A useful match in receipt five or later remains invisible to
candidate scoring in a crowded store, although complete fetched sources are
still returned if some other feature selects that memory. Stable receipt-ID
order is deterministic, not chronological.

Internally, explicit source mode reads and scores up to four retained excerpts
of 800 UTF-16 units per eligible memory within the existing 1,024-current-memory
scan. The supplied selector receives only the winning 120-code-point preview for
each candidate packed into the existing at-most-100-item, 4,000-token page over
at most two rounds, not those four full excerpts, receipt IDs or source metadata.
Each candidate receipt must first pass the same authoritative stored identity,
memory binding, role, canonical-excerpt and receipt-key validation as final source
output; corruption fails before selector invocation, including empty selection.
That preview still widens opt-in personal-data exposure. It does not widen
namespace authority or affect default recall and automatic rationale discovery;
public maps and the classification topic catalog remain unchanged. Existing
freshness checks stop later use or finalization after a valid mutation, but data
already sent in a begun model request cannot be withdrawn retroactively.

An embedded caller can explicitly select the experimental
`sourceCandidatePolicy: 'bounded-keyset-v1'` constructor option. Only explicit
source-context recall then scans up to 20,000 current physical memories per
authorized namespace in 256-row keyset pages, retaining at most the 1,024
highest literal scores. A physical cap with more current rows, or pruning at
1,024 candidates, remains incomplete even when the retained candidate pages
are consumed. This widens which retained source previews may reach the selector
within the same read authority; it does not widen the final source DTO, model
budgets or public host default. It is still a literal heuristic with the same
first-four-receipt, Unicode-run/CJK and semantic limitations above. The scan
bound is an engineering envelope, not a latency or answer-quality SLA.

Synthetic actual-core tests demonstrate bounded page visibility, including one
offline run with the pinned local tokenizer. A post-hoc development replay over
already exposed copied stores moved one previously absent target onto the first
candidate page while preserving two targets that were already visible; an
explicit visibility oracle could then fetch and finalize them. This does not
measure model selection, answer quality or a benchmark score. Neither probe
measures provider token accounting, latency or total SQLite page I/O. The row
and excerpt limits describe returned SQL rows and core scoring work only.

## Classification count limit: pilot halted before scoring

The [P3 pilot report](https://github.com/Cairn-ink/cairn-memory/issues/180#issuecomment-5751116229)
records 67 provider requests, USD0.335 reserved, and no answer or judge requests.
The first case stopped during classification and the second never started;
common resolved N is zero, not a measured zero-percent accuracy. These failures
and their reservations must remain visible in any subsequent experiment.

The run's `a31f9d9` classification path sends a token-bounded MOC catalog page
and at most five target memories, not all stored memory bodies. The ordinary
OpenAI adapter also has a 6,000-token local-input limit and a 7,024-token
provider-input limit; these are not only benchmark guard settings. The provider
request includes the dynamic output schema as well as instructions and input.
The benchmark guard can turn a count-response rejection into an unknown
outcome and a paid-work halt; the ordinary adapter's own oversize check refuses
generation with `context_budget_exceeded`.

Classification runs after admission. A failed classification can therefore leave
retained current memories unfiled; a successful top-level capture envelope is
not proof of successful filing. The MCP/Hermes bridge passes this nested status
through rather than turning it into a host-wide halt. The classification call
currently reads one catalog page, with no public continuation for that private
catalog cursor; an incomplete map cannot propose new topics. These are product
boundaries to test separately from the pilot's whole-run stop policy.

The opt-in local MCP `classify_unfiled_memories` tool can explicitly place
retained current unfiled references under core revision guards. It is a general
placement action, not verification of a failed capture batch. The accompanying
keyless `inspect_capture_admission` can now recover committed batch membership
from an existing admission claim after a lost response, with fresh current refs
and a bounded suppression count. It reports classification as unknown even for
empty or fully filed membership, and closed historical/deleted members have no
actionable refs. It does not recover source text or infer missing extracted
items. A v14 opt-in read can now report the exact initial capture attempt's
bounded, source-free journal status after a cold restart. It can distinguish
failed from an applied no-op that left members unfiled; it cannot certify model
quality, current filing, later explicit recovery or whether an in-flight
attempt is still running. A changed, deleted, historical, missing or foreign
original member makes that initial status unknown. Manual and older batches
also remain unknown. There is no persistent retry queue or durable history of
later classification attempts. By default, a whole capture may run several
separately bounded model stages, so it has no single 30-second deadline. Trusted
embedded callers can configure an opt-in monotonic `captureDeadlineMs` of 1–120000
for the whole invocation. It does not preempt synchronous SQLite or token
accounting mid-instruction, guarantee a wall-clock return bound, or change
native Hermes or MCP defaults. Local MCP can opt in through trusted startup
configuration; native Hermes can opt in through a validated v2-only profile
string capped at 110000 milliseconds. Before admission it fails with
`model_timeout`;
after admission it preserves receipts and reports downstream failure. This
mechanical boundary does not establish semantic quality or repair older cases.
Concurrent explicit requests
may duplicate provider work. Stale guards prevent a second conflicting change,
but no-op proposals can both succeed. An applied empty-parent proposal can
remain unfiled and be classified again by another explicit call. These limits
leave S1 incomplete and do not repair or rerun any historical pilot result.

The optional OpenAI adapter now requires the response array length to equal
the distinct target count for zero through five classification targets, and
rejects duplicate or oversized direct target lists before HTTP. Core still
validates exact target coverage, including repeated IDs, after the model call.
This prospective schema constraint does not reconstruct the pilot's rejected
response or establish its cause. It does not change that pilot's partial result,
stop policy or score denominators.

The rejected provider response and its exact token count were not retained.
Database size and a matching synthetic rejection do not establish that the
historical response exceeded the token ceiling. Neither a deterministic repeat
at batch 16 nor failure of all seven cases has been demonstrated. See the
[bounded diagnosis plan](plans/classification-count-diagnostics.md). A later
[benchmark-only guard diagnostic](plans/guard-count-reason.md) can retain a
finite reason and exact structurally validated count in private attempt
accounting, but it is not retroactive and does not recover this response or
resolve its cause. No budget increase, automatic retry, successful score or
historical count is implied.

The optional OpenAI adapter now compresses repeated classification target/MOC
UUIDs into request-local role-separated wire aliases and decodes validated
references before core/storage. Offline fixed fixtures and a separately replayed
copy show material local-token and byte reduction with the same visible
candidate/card/MOC content, but local tokenizer measurements are not provider
counts. Aliases do not hide personal content, titles or metadata, do not solve
arbitrary catalog growth or source-support quality, and do not recover the
historical count or prove its cause. The 6,000/7,024/1,024 limits, incomplete-map
behavior and benchmark halt policy remain. Any paid rerun still requires a
frozen, independently reviewed candidate and separate authorization.

## Public pilot v2: halted before scoring

The [retained v2 halted-run record](plans/public-pilot-v2-halted-results.md)
preserves a prospectively frozen seven-slot roster, the first-six packet and
the conditional seventh slot. The run stopped in the first packet: `fixedN=6`,
one generation wrapper was written, five following cases were blocked during
generation, all six were blocked during scoring, and `commonN=0`. Every arm's
accuracy is `null`, not zero percent; there is no v2 score.

The wrapper's one generated case is not a successful Cairn result. Batches 0–4
completed, batch 5 failed during extraction, and batches 6–50 were not run.
The Cairn arm is `ingestion_incomplete` within the one completed generation
wrapper; full-history and no-memory are `answer_failed` because the halt guard
prevented answer work. No answer or judge request was made. Admission
reference counts in the private diagnostics are not semantic source coverage,
extracted unique-unit counts or verified truth.

The safe audited packet contains 22 unique requests (11 count and 11
generation), 110,000 micro-USD reserved, 12,037 micro-USD of known actual
usage that is incomplete billing, and 12 requests with unknown billing. The
observed `core_call/model_timeout` and `adapter/model_cancelled` labels do not
identify a provider, network, HTTP or model-quality cause, and no fix is
claimed. No automatic retry or new session is implied, and a longer timeout is
not a proven remedy.

Optional `bounded-v1` transport milestones can localize a future synthetic
case-deadline attempt to fetch wait versus response-body wait at the guard.
They cannot distinguish provider processing from network buffering or prove
provider cancellation, billing, model quality, or a remedy for the old pilot.
The collector does not authorize rerunning that pilot; only generation
observations are persisted in private diagnostics, not scoring observations.

This is a selected engineering packet without population, representativeness,
blindness or contamination guarantees. It is not an official benchmark,
competitiveness, production-reliability, installed-real-host or Hermes-quality
claim. The offline diagnosis records fail-closed timing mechanics but cannot
identify a provider or network cause; its focused and live-offline gates pass
on Node 22.16 and 24.15. The legacy v1 result remains separate and is not
combined with this v2 roster or identity. Any future score requires a new
prospectively frozen and independently reviewed protocol and separate
authorization.

## Chained benchmark budget is not a transport grant

The separately versioned `benchmark-budget-chain-v1` US$100→US$200 chain was
first validated with synthetic temporary ledgers. A later one-time operational
cap transition used `authorizeChainedBenchmarkBudgetExtension` and retained
the completed US$100 history under the US$200 ceiling; see the
[historical milestone record](plans/comparative-reliability-milestones.md).
That record is not a current balance audit or permission to repeat the
transition, change the ledger, or spend. The chain itself does not select a
fresh roster, a request schedule, source-policy transport, retries, models,
provider prices or any paid request. Unknown historical costs and reservations
remain charged; the prior experiment ledger
must not be reset. Old benchmark and scoped capabilities do not inherit the
chain, although the generic baseline guard can still be explicitly configured
with a valid new ledger configuration for its unchanged routes. Existing-only
SQLite opening and path/inode checks cover named synthetic races, not a
privileged same-user process repeatedly swapping paths: Node SQLite does not
expose its opened file descriptor for independent inode verification. The
synthetic SIGKILL cases are crash-boundary tests, not a power-loss guarantee.

## Qualified source-pair guard is an offline transport prerequisite

The separately versioned qualified-prefix versus indexed-window guard has
only synthetic temporary-ledger, fake-HTTP and real local-core evidence. Its
compact roster and one-shot claim do not themselves supply trusted full
protocol preimages, a frozen case population, operator approval, credentials,
or an installed host launcher. N/P backup deadlines must be configured with
explicit margin after the guard's stage deadlines; no timer setting proves
remote cancellation or billing. The ledger witness closes named races inside
reservation but not direct network bypass, hostile privileged same-user file
replacement after the last check, or unreported provider retries. A halted or
unknown-cost row retains its full reservation, not a refund. No answer-quality
gain, semantic coverage, fair Mem0 comparison, paid readiness or product
reliability is inferred from these transport tests. The actual operator ledger
and historical cohort remain untouched.

## Installed qualified source-pair launch remains offline

The [installed qualified source-pair launcher](qualified-source-pair-launch.md)
has only synthetic temporary-ledger and fake-HTTP evidence. Its one-shot marker
prevents a fresh launcher attempt after a crash; it does not resume an
interrupted score. The in-process pre-dispatch phase quota bounds this trusted
launcher, not another process or arbitrary outbound HTTP. A denied dispatch
still consumes its shadow reservation, while the durable ledger records only
G-owned attempts. Local deadline and 429 fixtures cannot establish remote
cancellation, final billing, source relevance or accuracy. A `completed`
launcher status can coexist with unresolved judgments and is not a ≥95%
completion or quality gate. No operator ledger, provider, private corpus,
actual cap transition or paid comparison was used in this packet.

An initial actual-installed timeout fixture exposed separate module-local
deadline WeakSets: the guard misclassified a genuine installed-core timeout
as external, globally halting after two requests. The narrow verified-origin
token corrected this in synthetic installed tests, including one native 30s
core timer. This supports local continuation accounting, not a guarantee
about remote abort or eventual provider billing; foreign and external aborts
still halt globally.

The [pure mixed-source renderer](plans/mixed-source-renderer.md) can prepare
identical bounded user/assistant role-and-content batches for a future
controlled Cairn/Mem0 comparison using synthetic source histories. Its
date-as-content header is synthetic metadata, not an original quotation;
normalization can prevent exact raw-span attribution. It does not run Mem0,
retrieve evidence, map generated memories back to source IDs, answer or judge
questions, estimate complete joint resource needs, inspect the held-out roster
or authorize a provider call. Exact date parsing may reject histories that
earlier preparation retained as opaque strings. Its bounded greedy partition
can also reject an otherwise valid normalized turn; such a preflight failure
leaves a future fixed-N case unresolved, rather than dropping source from one
arm. The renderer's node and byte caps bound traversal and cloned data, not
all JavaScript process memory or side effects of Proxy traps during own-key
inspection. No semantic score, parity or installed behavior follows from
renderer tests.

## Direct candidate-ID wire remains an offline experiment

The [direct candidate-ID experiment](plans/direct-candidate-wire-experiment.md)
keeps the production pool/slot wire unchanged. Its detached decoder and actual
core compiler agree with the current wire on synthetic source bindings, but
fake HTTP cannot prove provider schema acceptance, semantic entailment, or
repair of unretained official-run malformed responses. The modeled alternate
one-item bodies are slightly smaller; in a distinct five-item intermediate
fixture, the current adapter fits one whole request while the alternate needs
five singleton qualifier pairs. Valid maximal-label outputs also exceed the
unchanged output-token ceiling. The decision is to revise the design rather
than adopt it; no paid cases, user data or operational ledger were used.

## Combined ingestion remains an offline design experiment

The [12-case ingestion comparison](plans/ingestion-design-comparison.md) uses
source-only synthetic fixtures, real adapter/core fake HTTP for current paths,
and reconstructed evaluator-only combined requests. Current bounded partition
completes 11 scripted cases; combined and whole-batch each complete 10. Combined
has lower local input work in some fitting cases, but refuses a multi-source
case that current partitioning completes. Selected legal-long outputs exceed
the unchanged 1,024-token output ceiling in both designs. All total work retains
failed-stage extraction. These are output-conditioned counts, not measured
cost, provider schema acceptance or interpretation quality. Valid citations can
still carry a wrong interpretation or unhelpful all-unknown fields. The decision
is revise before a separate fresh semantic test; no default, persistence,
installed MCP/Hermes behavior, paid call or live guard change follows.

## Short-source semantic probe does not support combined adoption

The [paired ingestion semantic probe](evidence/ingestion-semantic-probe.md)
attempted twelve new short synthetic scenarios twice per arm with the actual
pinned model. Baseline mechanically completed 23/24, combined 24/24; strict
all-six semantic success was 11/24 and 12/24. Combined useful coverage was
18/24 against baseline's 19/24, failing the frozen adoption hypothesis despite
fewer requests. No engine, default, installed host or broad reliability claim
changes. The earlier multi-source input-fit and 1,024-output-token limits remain.

These are independent same-model-family agent ratings, not human labels or an
independent benchmark. Two repetitions of each scenario are not independent
questions. Original A/B ratings, six rows of eleven dimension disagreements,
source/card projections and frozen adjudication are inspectable. Primary had
seen a baseline projection example and mechanical failure before adjudication;
the arm mapping was joined only after adjudication was frozen. Two consensus
preference failures were corrected against the existing settled-position
guidance, with raw ratings retained. Eleven nondecision `adopted` failures are
interpretation-sensitive, not proof of fabricated actions or stable traits;
a post-hoc 17/24-per-arm sensitivity does not replace the frozen strict score.
Four assistant rows lack an explicit claimant in content/fields despite receipt
role recoverability. Date, historical provenance, condition and cap omissions
remain named failures rather than citation-certified meaning.

The second baseline conditional-cap attempt failed on repeated valid
`scope.evidenceSlots: [1, 1]` within `pool: [1, 2]`. Local in-memory deduplication
compiled without a model replay, but changed neither retained output nor score.
This specific diagnosis does not explain older official-run slot failures.
Known generation-usage uncached ceilings total US$0.058577, while the retained
new reservation is US$0.640512; count cost remains unknown. Neither is an invoice.
Instrumented latency includes guard/persistence work and baseline's extra local
serialization, so it is not production speed evidence. Next work is a separate
narrow reference fix, semantic clarification and capacity gate, followed by
reviewed NEW held-out evidence, a completion-gated fixed-N comparison, and
ordinary installed Hermes/MCP validation. Overall reliability remains unfinished.

The [decision-commitment guidance](plans/qualification-meaning-guidance.md)
now distinguishes source commitment to a choice or settled preference from an
observation or dated feeling. Unknown commitment retains useful descriptors;
claimant and explicit material event/decision/import times remain source-backed
interpretations. This narrows earlier ambiguous guidance without revalidating
immutable records or changing historical scores. Synthetic checks establish
storage, recall projection and existing trusted-transition constraints, not
model adherence or semantic improvement. A NEW held-out semantic experiment
remains required before quality claims.
Unknown observations remain retrievable, but factual assertion alone does not
authorize retirement through `transitionQualified`'s adopted-choice gate. That
policy does not itself resolve evolving facts; existing trusted correction and
other update paths are unchanged. Reliable factual state updates remain unproven.

On the unchanged twelve offline ingestion-design fixtures, bounded qualification
still completes 11/12 with 26 count/generation pairs; generation input increases
62,217 → 64,590 tokens (3.8%) and serialized input work 124,044 → 128,790.
No new refusal or partition occurs in these fixtures, but this is not a general
fit guarantee. The existing multi-source refusal and legal-long output exceeding
1,024 tokens remain; no budget or default changes accompany the guidance.

## Fresh meaning guidance does not establish source fidelity

The [fresh qualification meaning diagnostic](evidence/qualification-meaning-probe.md)
mechanically completed 24/24 attempts and 31 cards after the guidance clarification,
but only 13/24 passed all six adjudicated semantic dimensions. Supported meaning
and uncertainty each passed 16/24, attribution 21/24, scope/time 22/24, useful
coverage 20/24 and exact cited entailment 15/24. Eight attempts retain false
`adopted` on observations, moods or factual/historical claims; both planetarium
outputs omit the group claimant, one supplier correction has incorrect direct
attribution, both repair cards omit import time/provenance, and one foldout
scope lacks its antecedent in the exact cited anchor. Useful coverage is scored
separately from false commitment; unknown useful observations are not failures
solely because commitment is unknown. Guidance was present in the actual
requests but is not a reliable semantic validator. Unchanged structural guards
do not certify entailment. No currentness/retirement write occurred, and this
probe establishes no automatic-retirement or new authority bypass.

Both same-family agent raters had 12/24 raw full successes. Two rows disagree on
seven dimensions; separately frozen adjudication resolves genuine interpretation
close calls rather than objectively verified rater mistakes. Exact original
outputs and raw notes remain inspectable, with no repaired outputs, post-hoc
threshold, human-judge or causal comparison claim. Twelve short repeated scenarios
do not resolve long-history capacity, endpoint/cold-session performance, factual
updates or earlier failures. New reservation was 427,008 microUSD, known generation
uncached ceiling 34,440 microUSD and 48 count costs remain unknown; reservations are
not invoices. The next decision is fresh long-history six-type paired feasibility,
with semantics still an unresolved product gate, then a separately assessed fresh
fixed-30 only after six common resolved cases, source-only operator review and v3
budget projection. Ordinary installed Hermes/MCP remains separate.

## Fresh official-six v3 halted before scoring

The [fresh official-six v3 observation](evidence/qualification-official-v3.md)
retains six planned cases and twelve arms: one completed, five failed and six
blocked after a global `scope_execution_failed` generation halt. Cairn failed
ingestion after 10/8/3 completed batches; the remaining three cases were not
executed. Finite canonicality and slot-mapping diagnostics locate validation
boundaries, but diagnosis is ongoing and no root cause or resolved defect is
established. Scoring never ran, so there is no new correctness score or accuracy.
The earlier cohorts and short 13/24 semantic probe remain unchanged.

Of 510 new requests, 509 settled and one embedding request remains pending;
107 costs are unknown including that pending request. Its observed usage is not
durable settlement. The final reservation checkpoint is 123,795,493 micro-USD
under the unchanged 200,000,000 cap; reservations are not invoices. Ledger state
`open` does not authorize resumption. Preserve the pending row during offline
settlement diagnosis. The independently planned opt-in indexed-evidence slice
remains an experiment, not an adopted remedy; future protocol, resource and
fresh-case review follows only after accounting is safe. No dispatch, replay,
replacement or fixed-30 expansion follows from this failed gate.

## Four-case opt-in long-history pilot completed, with answer omissions

After the official-six v3 observation, a separately authorized accounting
settlement marked its formerly pending embedding request `unknown`, keeping
its 10-micro-USD reservation and the original halted report unchanged. The
subsequent [fresh long-history pilot](evidence/long-history-live-pilot.md)
used four new 60-message synthetic histories, four actual indexed-evidence
batches per case and alternating first arms. It finished all 16 Cairn capture
batches, all eight generation arms and all eight official-style judgments.
The common resolved denominator is 4/4; Cairn was judged 3 correct and 1
incorrect, Mem0 2 correct and 2 incorrect, with no unresolved judgments.
This is a diagnostic result for the authored cases, not a statistical or
causal comparison or a score for the six-type official cohort.

In the failed Cairn premise-change case, selected, packed receipts included
the no-fee room's unavailability and the source's explicit statement that
Ferry Hall had not been chosen and the pop-up had not been cancelled. The
answer still omitted the failed premise and need for reconfirmation. The
original decision passage was not selected, so this observation does not
establish complete decision-context retention
or a model root cause. No case was retried or repaired. Native Mem0 add-record
counts and Cairn admitted-card counts are different measures.

All 142 new guarded requests settled with zero pending; 1,121,062 micro-USD
was conservatively reserved and 98,275 micro-USD is known usage-estimated
cost across 105 rows, leaving 37 rows with unknown cost. Reservation is not
an invoice or proof of low operating cost. An independent read-only review
matched the 142 guarded rows and unchanged settled prelaunch ledger prefix.
The opt-in path omits qualification, does not exercise cold-reopened model
recall, default MOC-led navigation, 1,025-card capacity, installed MCP/Hermes,
or automatic supersession. A fresh six-type official completion and
common-resolution gate, followed by separately reviewed fresh fixed-30 work,
remains necessary before comparative or promotion claims.

## Fresh six-type official indexed-evidence cohort missed feasibility

The [new official-six evidence packet](evidence/indexed-evidence-official-six.md)
uses six previously unused LongMemEval-S questions, one per official type,
separate from the four authored synthetic histories above. Its prospective
seed and audited 142-ID exclusions were fixed before source preparation;
all 148 future exclusions were sealed before cost inspection. The explicit
opt-in indexed-evidence planner accepted all six source cases with 292 Cairn
capture batches. A fresh whole-vector ceiling of 77,446 requests and
14,702,404 microUSD of conservative reservation fit the fixed pilot cap,
protected remainder and shared ledger checkpoint. Those were prelaunch upper
bounds, not observed calls or upfront ledger reservations.

The one-shot orchestration completed without a global halt, but Cairn
completed ingestion and nonempty answers in 5/6 cases versus Mem0's 6/6.
Common resolved judgments were 5/6; Cairn had 3 correct, 2 incorrect and 1
unresolved, while Mem0 had 3 correct and 3 incorrect. The unresolved Cairn
case failed its sixth capture batch with a settled `unknown` generation
timeout after five successes. That failure is not an incorrect semantic
judgment, nor proof of a provider cause or timeout remedy. Both incorrect
Cairn answers were abstentions. The multi-session case had zero observed
recalled cards, receipts and packed evidence units; why that path was empty
remains unproven. In the temporal-reasoning case, the sole selected receipt
lacked the target event and its timing, with no packing omission. This
localizes an evidence-sufficiency miss without proving the fact was never
stored or identifying a model root cause. The frozen 6/6 completion and
common-resolution feasibility gate failed, so a fixed-30 expansion is blocked.

Actual accounting added 1,935 guarded requests and 10,621,743 microUSD of
conservative reservation. Known usage estimates were 2,452,595 microUSD for
1,417 rows; 518 costs remain unknown, and none of the requests is pending.
The cumulative shared checkpoint is 21,355 requests / 135,538,298 microUSD
reserved. Reservation is not an invoice, and known usage is not total spend.
The primary reconciled the unchanged parent prefix and all new guarded rows;
an independent read-only audit confirmed the aggregate and accounting. This
consistency check does not pass the failed feasibility or semantic gates.

The public report names the frozen seed, source hash and revision so the
method is inspectable. The selected IDs, complete exclusion roster and
one-shot operator are retained privately, so the public aggregate alone is
not a fully replayable benchmark packet.

This pilot leaves the earlier official qualification failures and four-case
synthetic diagnostic unchanged. Its selected subset cannot establish full-500
LongMemEval accuracy, a general Cairn/Mem0 ranking, a causal effect of omitting
qualification, default MOC navigation,
source fidelity or installed MCP/Hermes reliability. A larger cohort requires
a new frozen selection and resource check after the failed feasibility gate,
not reuse of these six.

## Claude plugin 0.1.1 filter rests on narrow evidence

Plugin 0.1.1 stops sending user-role records that Claude Code writes itself (the
[second D1 exception](plans/codex-client.md#second-d1-exception-plugin-011-privacy-filter)).
The evidence behind it is narrow:

- **One version, one interactive session.** Only one synthetic interactive
  session on Claude Code 2.1.283 showed that interactive typed prompts carry
  `promptSource: "typed"`. F0's print-mode runs on the same version showed
  `"sdk"`. No other version was checked, and no other entry point (IDE
  extensions, the desktop app, resumed or forked sessions).
- **`promptSource` is not required.** The rule excludes on structure (meta,
  compaction summary, tool result) and on a fixed list of wrapper prefixes;
  `promptSource` only exempts a submitted prompt from the prefix check. Requiring
  it would drop every typed prompt on a host that omits or renames the field,
  and one version's evidence cannot show the field is stable. The trade-off has
  two sides. On such a host, a typed prompt that itself starts with a wrapper
  (for example pasted command output) is not sent. And a new kind of
  machine-written user record that no rule recognizes is sent until the rule is
  updated.
- **Windows queued before the upgrade.** 0.1.1 keeps 0.1.0's batch boundaries
  and event ids and removes withheld records from each batch, so a window 0.1.0
  froze is retried without machine records. Whatever 0.1.0 already delivered
  stays with the service, and so does a request it had already sent that later
  completes; 0.1.1 deletes nothing. The replay relies on the receiver keying a
  capture on its event id alone, as the protocol and the hosted service do. A
  compatible service that also compared payloads would refuse the filtered replay
  of a batch 0.1.0 had completed. That session's capture would then stop
  advancing rather than resend machine records.
- **Reconstructed fixtures.** The two 2.1.283 fixtures in
  `plugins/cairn-memory/test/fixtures/` are synthetic reconstructions of the
  record shapes seen in F0 and in the interactive session, with canary text.
  They are not recorded transcripts. They show the rule handles those shapes,
  not that those are all the shapes Claude Code writes.
- **Own skill turns.** The unreleased follow-up recognizes Cairn's command XML,
  qualified `Skill` calls and meta skill-directory headers. Its
  [synthetic status fixture](../plugins/cairn-memory/test/fixtures/claude-plugin-status.md)
  records the shape evidence and checks multiple answers and normal followups.
  Unrecognized future host markers can still leak command answers. An old cursor
  that already consumed an invocation has no skill-turn boolean; only whole
  status/pause/resume output lines can be recognized in that case. Longer quoted
  outputs in otherwise ordinary assistant answers remain eligible. No backfill
  or removal of already delivered memories is performed.
- **Review validation.** A frozen shared cursor hash was accidentally changed by
  the first skill-turn follow-up. Comparing only the names of failing test files
  missed that incremental parity assertion. The helper is restored byte for byte;
  Claude-specific metadata is read only by the hook. Hash and mechanism checks
  must be reported separately from full integration results. A sandbox that
  rejects loopback listeners (`listen EPERM`) or child socketpair stdio cannot
  certify the full client-bundle/hosted parity gate; matching failure filenames
  is not evidence of equivalence or a passing CI run.

## Decision confirmation hides whole episode context

CF-1's optional `decisionReview: 'required-v1'` uses conservative admission,
chosen by **chichi on 2026-09-29**. Every automatically captured decision waits,
including paraphrases of the person's direct statements; explicit remember/admit
stay direct. The extractor has no provenance contract that can reliably tell
those statements from inference. Chichi noted that confirming all of these is
probably too much. The follow-up admits decisions from the person's typed
prompts, marked by plugin 0.1.1's `promptSource`, as direct; it is recorded in
cairn-wiki `docs/plans/one-brain-u6.md` → “Confirmation burden” and is not part of
CF-1.

- **Measured synthetic cost.** The fixture built from the existing episode
  capture helpers has three user/assistant turns, two automatically captured
  decisions and one next step. Nothing is reviewed initially. All episode
  context is hidden until both decisions are confirmed:

  | Reader | Neither confirmed | One confirmed | Both confirmed |
  | --- | --- | --- | --- |
  | `listEpisodes` | 0 episodes | 0 episodes | 1 episode |
  | `getEpisode` | `episode_not_found` | `episode_not_found` | readable with next step |
  | `sessionStartContext` next steps | 0 | 0 | 1 |
  | `sessionStartContext` procedural items | 0 | 0 | 0 |

- **Whole-episode rule.** One live awaiting link hides the episode's unrelated
  prose and next step too, as well as episodes borrowing its passages. Rejection
  makes an invalidated shell readable again, not the rejected prose. The
  conservative rule remains because episode prose cannot reliably be split
  into confirmed and awaiting assertions.
- **Scope of evidence.** This is a 100% loss of episode context in one scripted
  fixture, not a measured frequency across real sessions or a model-quality
  result. Every session with at least one live awaiting decision has this cost.
  The option is off by default; U-6 will measure the burden in dogfood.

The measurement is asserted in `core/test/confirmation-state.test.mjs` (“typical
synthetic session”); see the [contract](plans/confirmation-state.md).

## Awaiting predecessors are not reconciliation candidates

If an awaiting decision A is superseded by a later awaiting decision B, capture
creates no held supersession between them. Confirming both, in either order,
leaves two current decisions, even when they contradict each other. With review off,
reconciliation can retire A when admitting B. The review queue currently
cannot discover that missing transition; a separate reconciliation is needed
after review. Synthetic tests freeze this limitation rather than implying
that confirmation resolves every contradiction.

Evidence: `core/test/confirmation-state.test.mjs` tests both confirmation orders.

## Background context is recent, not relevant or reviewed

Opt-in session-start `background` returns at most six current facts/context
items, newest-updated first, with ties broken by ID. This is recency ordering,
not relevance ranking. Its independent budget and the whole-response limits may
return fewer items; the existing next-step and procedural groups fill first.
If no item fits with its additional warning, the group is omitted. An empty
complete group is allowed when there are no candidates and metadata fits.
`backgroundOmitted: true` reports omission only if the marker itself fits;
otherwise it is absent too. A requested but absent background group always
means incomplete, never an empty complete result. Per-group completeness
reports truncation when the group is present.

Background includes **agent-inferred facts no one has reviewed**, as well as
explicit facts and context. Excluding awaiting decisions does not make other
inferences verified. Receipts retain provenance, not truth or human approval.
Returned background content is framed as potentially inferred and unverified.
Without background content, the original session framing is retained.
A concurrent forget fails the final reread with a conflict; a fresh retry drops
the forgotten item, consistent with SE-3. The reread includes background rows
even when the group was omitted, so forgetting an item that was never returned
can still cause that conflict.

Evidence: `core/test/background-context.test.mjs`, including character-budget
(200–8000) and token-budget (1–2000) sweeps under character, lexical and
camelCase-splitting counters, comparing existing group bytes with background
on/off. Synthetic counters test budgeting, not provider tokenizer fidelity.
See the [session-start contract](storage-contract.md#session-start-context).

## Model input budgets

Recall, classification and qualification now fit their model input by packing
or planning, and capture batches are planned. See
[fitting the model budget](fetch-recall.md#fitting-the-model-budget),
[planning capture batches](capture.md#planning-capture-batches) and the
[per-call audit](model-input-budgets.md). What remains:

- **Dense scripts can make one capture message too large.** In plain,
  `source-bound-v1` and indexed-evidence capture, a message may hold 4,000
  UTF-16 units. For ordinary Chinese, Japanese, Korean and English text that is
  at most about 4,600 tokens under o200k × 1.15. For dense scripts such as CJK
  Extension A or Yi, or for control characters, it can reach about 14,000. The
  planner reports such a message in `oversizedMessageIndices` instead of
  splitting it inside the message, and capture refuses it with
  `context_budget_exceeded` before any write. **The caller must split such a
  message itself, with its own windowing,** as cairn-wiki's hosted H4a already
  does. Local automatic capture (LAC) must do the same. This is an accepted,
  documented boundary (chichi, 2026-09-29). Retained (`source-bound-v2`) and
  episode capture, which extract from 800-unit views, are not affected.
- **Capture batches must be planned.** Capture refuses a batch whose single
  extraction request cannot fit, before any claim, staging, write or provider
  call, and retrying the same batch refuses again. Hosts plan batches with
  `core.planCaptureBatches`, which splits only between whole messages. Hosted
  and MCP capture tools do not call it for you yet.
- **Episode targets degrade differently.** When an episode's own new messages
  cannot fit one interpretation request, the attempt records gap code
  `context_budget_exceeded` and the same batch is still admitted as memories.
  That batch does not need to be split or retried; only its episode draft is
  missing.
- **Ranking may see less than it returns.** A shortened rank candidate shows a
  query-aware window of its content and then its earliest excerpts; later
  excerpts can be empty. Evidence outside that window cannot influence ranking.
  Returned memories are never shortened. Ranking quality over shortened text
  has not been measured on a real model.
- **Heavily re-captured memories return fewer receipts.** Every receipt a
  ranked memory returns was sent to the ranker with its identity. Identity
  fields cost about 86 tokens each under o200k × 1.15 (55 under the test
  counter). When a memory's whole receipt list cannot fit, recall caps the list
  to its most recent receipts, newest first with ties broken by ID. It sends
  and returns that same list. Two separate counts report it. Each capped
  memory's `receiptsOmitted` counts the receipts left off that memory's list.
  `recallTruncated.receiptListsCapped` counts how many candidate lists were
  capped in the recall. For example, a memory recaptured from 200 short English
  turns returns its 66 most recent receipts under o200k × 1.15. That memory
  shows `receiptsOmitted: 134`, and the recall reports `receiptListsCapped: 1`.
  Older receipts stay readable through `get`. The memory itself is left out
  only when its content floor and one receipt identity cannot fit.
- **Shares are equal in characters, not tokens.** Every shortened rank
  candidate gets the same code-point allowance, so a CJK candidate spends about
  four times the tokens of an English one of the same length.
- **Atomic evidence can crowd itself out.** A qualification, a complete
  `source-evidence` set or a `rationale-evidence` graph is never cut. When one is
  too large, that candidate is left out whole.
- **An unfetchable memory is not recallable.** A memory whose body plus first
  receipt exceeds one 4,000-token fetch envelope, or whose complete source set
  cannot be fetched in a source mode, is left out of recall and counted. It
  remains readable through `get` and `list`.
- **Qualification may describe a prefix, or nothing.** An item that cannot fit
  alone is qualified from its excerpts' first units only (never fewer than 120).
  If even that cannot fit, the item is admitted unqualified and reported. In the
  measured scripts this never happened at the maximum item size.
- **Keep may extract from a prefix.** When an episode's kept sources no longer
  fit one extraction request, each is shown only up to a common prefix, reported
  as `extractionTruncated`.
- **The recall query itself is not shortened.** A query that cannot fit even
  with no map items or candidates still refuses with `context_budget_exceeded`.
- **Rationale and decision-basis review still refuse.** `relate` and
  `reviewBasis` send complete retained receipt sets and refuse with
  `context_budget_exceeded` rather than packing, because their proposals cite
  complete receipts and `relate` persists them. Automatic rationale reports
  `rationale.status: 'failed'`; the capture itself is unaffected.
- **Classification may file from a prefix.** A packed classification sees only
  a prefix of each long memory, never below 120 code points. If the catalog
  itself had to be cut, no new topic can be proposed for that batch.
- **Hosted responses lack these fields.** `recallTruncated` and the other
  truncation fields belong to the local core response. The hosted
  `schemas/recall-response.schema.json` is owned by CX-4 and does not carry them
  until CX-4 publishes them.

Evidence: `core/test/recall-budget.test.mjs`, `core/test/capture-budget.test.mjs`
and `core/test/classification-budget.test.mjs` use the test counter.
`adapters/openai/test/recall-budget.test.mjs` and
`adapters/openai/test/capture-budget.test.mjs` use exact o200k × 1.15. The test
counter is shaped like a padded o200k count but is not a provider tokenizer. The
small-recall parity fixture was frozen from main `3a1c17d`.

## Where the evidence lives

- [Model input budgets and packing](model-input-budgets.md)
- [Awaiting predecessors and conflicting current decisions](#awaiting-predecessors-are-not-reconciliation-candidates)
- [Decision confirmation and whole-episode context cost](#decision-confirmation-hides-whole-episode-context)
- [Claude plugin 0.1.1 privacy filter](plans/codex-client.md#second-d1-exception-plugin-011-privacy-filter)
- [Fresh official-six indexed-evidence packet](evidence/indexed-evidence-official-six.md)
- [Four-case real-model long-history pilot](evidence/long-history-live-pilot.md)
- [Fresh official-six v3 halted observation](evidence/qualification-official-v3.md)
- [Installed qualified source-pair launch](qualified-source-pair-launch.md)
- [Fresh qualification meaning diagnostic](evidence/qualification-meaning-probe.md)
- [Semantic evaluation](semantic-evaluation.md)
- [Paired ingestion semantic probe](evidence/ingestion-semantic-probe.md)
- [Paired update-reliability experiment](evidence/qualified-comparison.md)
- [Source-support pilot results](../evaluations/results/source-support-v1.json)
- [Source-only context](source-evidence-context.md)
- [Integration inventory](source-reliability-integration.md)
- [First live evidence](evidence/first-live-evidence.md)
- [ROADMAP](../ROADMAP.md): the gates that must pass before broad promotion.

## CX-4 round 2 verification environment

The 202 processing, operation-scoped refusal/cooldown and interrupted-hook
recovery changes have 184 direct conformance/transport/plugin cases on Node
22.16.0, 24.15.0 and 20.19.0. Real hook subprocesses receive SIGTERM/SIGKILL;
a gated file-based fake fetch peer supplies synthetic HTTP replies. These tests
exercise request classification and persistent cursor/gate behavior, not TCP
acceptance against a deployed server.

The round 2 worker's restricted execution environment rejects localhost TCP
listeners with EPERM and loses Node child pipe I/O, including test-runner
serialization. The required CI-shaped matrix is attempted and its actual exits
are retained in the [round 2 handoff](plans/codex-client.md#cx-4-round-2-決策與交接2026-10-01).
A file-level pass from a broken worker pipe is not evidence of case-level success;
hung or failed CI commands require a rerun in the ordinary CI environment.
The existing round 1 results do not qualify the revised round 2 implementation.


## Setup 0.2.0 browser authorization

The setup suite uses a fake contract HTTP server and fake Claude CLI. Actual
Node HTTP/TLS parsers exchange bytes over duplex streams and subprocess IPC;
loopback listeners are denied with EPERM in this execution environment. TLS
fixtures verify explicit CA trust, certificate rejection and HTTP/HTTPS proxy
CONNECT behavior with verification enabled. This is client protocol evidence,
not OS TCP, deployed server, real browser approval or credential-store evidence.
Windows/WSL/macOS launch commands are selected by simulated-platform tests;
no native desktop launch or corporate network acceptance is claimed.

The installer uses Node HTTP/HTTPS/TLS, not fetch's implicit proxy behavior.
Supported NO_PROXY rules are hosts/domain suffixes, optional ports, bracketed
IPv6 and `*`; no CIDR/PAC/SOCKS or OS proxy discovery. Enterprise CA files use
Node's NODE_EXTRA_CA_CERTS at process startup. There is no insecure TLS option.
JavaScript strings cannot be zeroed in place: owned references are dropped and
request/configuration Buffers are zeroed. Host malware/crashes and Claude's
own storage remain outside installer guarantees.

The current task explicitly chooses automatic hidden manual fallback on create
404/501. The copied spec's older generic-404 paragraph instead asked users to
rerun with --manual-token; the task instruction takes precedence. Other HTTP,
TLS, redirect or protocol failures never trigger that fallback.

Plugin 0.3.1 already contains the required hook credential-state correction.
Installer status queries configuration presence without reading the token;
installer credential checks never write hook-owned observations. Real hook
verification still needs a restarted Claude Code session and a submitted message.
Installer 0.2.0 remains unpublished; chichi publishes from her laptop.


### Installer 0.2.0 review follow-up

Configure and ACK use monotonic clocks. The delivery budget starts before the
potentially issuing exchange; an ambiguous lost exchange keeps its original
start, and retries cannot extend it. One second is reserved for server timestamp
rounding, including grant expiry. Each ACK attempt may wait up to 15 seconds,
capped by the remaining budget. Connections still open afresh; this change
lengthens the timeout rather than claiming keep-alive reuse. Absolute server
expiry values are metadata; the server's valid/ACK result is authoritative.
Tests simulate skew in both directions, wall-clock jumps, slow ACK replies,
replayed exchanges and exhausted budgets over the fake HTTP wire.

Remaining review P3 work:

- A saved credential may remain invalid after interruption or explicit revocation.
  No automatic removal/rollback is implemented: the installer cannot read back
  the old sensitive token, and ambiguous ACK must preserve potentially delivered
  configuration. Recovery messages now name `setup --reauthorize`; an unconfirmed
  delivery first asks for a fresh hook observation after a 60-second wait.
- `--reauthorize` does not revoke the previous PAT automatically. Its value/id is
  unavailable without forbidden sensitive config reads. The active-token-cap
  error now directs users to `/settings/tokens` to revoke unused credentials.
- HTTP-date `Retry-After` remains unsupported; the client accepts integer seconds
  plus the contract's integer JSON `retry_after`. Supporting dates needs a
  separate header parser and skew-safe reference, beyond a one-line correction.

The prior round's review also noted intentional changes in endpoint path
validation, no-install CLI exit status, dry-run MCP queries, non-TTY setup, and
release/readme wording. This follow-up retains those reviewed behaviors: the
explicit authorization brief still governs endpoint/TTY/network safety and
publication is still reserved for chichi.

## Codex app-server client scope (installer 0.5.1)

Since Codex 0.160 the interactive TUI starts its threads on the shared app-server
daemon. The app-server records every thread as `source: "vscode"` and stores the
connecting client's self-declared name as `originator`. Installer 0.5.1 counts a
`vscode` thread as interactive only for `codex-tui`, `codex_vscode` and
`Codex Desktop`; any other or missing originator is gated like `exec` and needs
`--codex-capture-exec on`. The 0.5.1 evidence is header metadata and synthetic
fixtures; no conversation body is part of it.

Demonstrated:

- TUI on the daemon, header only. A synthetic probe started the installed native
  0.162.1 app-server with hooks disabled, in a throwaway `CODEX_HOME`, with no
  model call. Every client got `source: "vscode"` and its own name as
  `originator`: `codex-tui`, `codex_vscode` (through the extension's originator
  override), `Codex Desktop`, `codex_exec` and an arbitrary automation name.
- Installed-hook tests with a fake endpoint and synthetic transcripts capture and
  recall for the three interactive originators. Automation on the daemon, with
  no exec source and no native exec ancestor, is skipped by default and captured
  only after the opt-in.
- `codex_vscode` matches the installed VS Code extension, which launches its
  app-server with `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_vscode`. The
  maintainer's own rollout headers contain `codex-tui` and `codex_vscode`
  `vscode` threads. They also contain an automation client
  (`vibe-codex-executor`) and the default `codex_cli_rs` name on `vscode`
  threads, both of which the allowlist now excludes.

Unverified:

- `Codex Desktop` comes from strings in the 0.162.1 native binary (its
  first-party originator check and telemetry mapping) and the synthetic probe.
  No desktop-app session was observed. If the app reports a different name, its
  threads are skipped until the user opts in or the allowlist changes.
- End-to-end hook delivery from the VS Code extension or desktop app. The
  extension runs its own bundled Codex binary; that binary's format
  qualification, hook trust and transcript delivery were not exercised. Only the
  header gate is tested.
- The originator is self-declared. An automation client that names itself
  `codex-tui` cannot be told apart and is captured; the gate excludes only
  clients that identify themselves differently.
- Classification is per thread, from the creating client's header. Resuming an
  interactive thread through another app-server client keeps that header; only a
  native `codex exec` ancestor is detected.

## Codex new-session boundary (installer 0.5.3)

A session's first Codex hook sets its pause boundary at the end of the rollout,
and nothing written before it is sent. This holds in every root, including one
that has never been paused. Up to 0.5.2 that first hook was normally the first
Stop, so once a root had been paused, resumed or set up again, the first
exchange of every new conversation was skipped as `pause_boundary`. In a root
that had never been paused, an existing conversation was sent from its start.
Installer 0.5.3 also sets the boundary at `UserPromptSubmit`, which Codex runs
before it records the prompt. The rule is the same; the first observation just
comes earlier.

A pause made with only the legacy `paused` marker (plugins that predate
`control.json`, or by hand) is resumed by deleting the file, which leaves no
trace and restores the pre-pause generation. Codex therefore keeps that path as a
tripwire: a dangling symlink to `.paused-tripwire`.

- Pausing through the marker by any means creates the target, so the root reads
  as paused exactly as before.
- Deleting the marker removes the symlink, so every tool resumes as before.
- Each Codex cursor records the token in `codex-tripwire.json` it was observed
  under. Codex prepares and sends text only while the tripwire is intact under
  that token.
- A missing symlink, a present target or a lost record means a pause may have
  happened. Codex arms a new token under the control lock, and every Codex
  session starts again at its next hook. If the lock is busy, Codex reads as
  paused for that run.
- Codex never writes `control.json`.

Demonstrated:

- Codex source at the pinned commit: `hook_transcript_path` materializes the
  rollout before a hook gets its path, and `UserPromptSubmit` runs before
  `record_pending_input` records the prompt. Resume appends to the existing file
  without a new header.
- Worker tests for the three invariants, run against this branch's earlier
  commits and `main`. Paused text is not sent after a legacy pause that a run
  observed while `control.lock` was held, after one no run observed (with an
  existing cursor, after a resume while active, and in a root without
  `control.json`), or after the 0.5.3 draft's stamped-activation case. Deleting
  the marker resumes every tool and leaves `control.json` untouched. A session
  that begins after a resume keeps its first turn.
- Installed-hook tests with a fake endpoint and synthetic rollouts:
  - The first turn is kept via `UserPromptSubmit` (prompt recall on or off) and
    via SessionStart, after setup, after `resume` and after a marker deletion.
  - Earlier sessions are skipped up to their boundary.
  - Paused text is never sent, whether or not hooks ran during the pause.

Limits:

- The hook order comes from Codex source and synthetic tests. Hook delivery in
  a real TUI session on the app-server daemon was not observed. If
  `UserPromptSubmit` does not reach the runtime (hooks not yet trusted in
  `/hooks`, an unqualified host, a busy lock), Stop sets the boundary and that
  turn is skipped.
- Every tripwire re-arm costs each Codex session the text since its last hook.
  This includes a resume on an active control by the Claude plugin, which
  deletes the symlink. Codex's own `resume` leaves an active control alone.
- The tripwire guards the legacy marker path. Deleting or editing
  `.paused-tripwire` or `codex-tripwire.json` by hand while paused is outside it.
- A foreign symlink at `paused` that does not resolve is left in place, and
  Codex reads as paused until it is removed.

## Internal Raw journal P1: synthetic foundation only

The [internal local Raw journal](raw-local-journal.md) is a default-off storage
and read foundation tested with synthetic local fixtures. It does not expose
public Raw capture, installed hooks, Raw → Card support or source-deletion
integration. It establishes no production readiness or semantic score, and does
not authorize real transcript retention, operational migration or deployment.
The remaining packets and final verification outcomes belong in the
[local Raw V1 completion plan](plans/raw-local-v1-completion.md).

Retained failures under simultaneous core, generic and package test load:

- The first Node 24 MCP run reported 124 passed and 1 failed, exit code 1.
- The first Node 22 artifact run reported 93 passed, 1 failed and 1 Windows-only
  skip, exit code 1.

An independent eight-case H4 matrix exercised real stdio on the baseline and
candidate with Node 22 and 24 and controlled delay: four cases passed and four
reproduced the exact failure. It establishes the shared 1,500 ms deadline as a
sufficient cause, not the precise latency of the original failed runs. The H5
evidence is only a family-level probe before model work; it is not a reproduction
of the installed H5 failure. After the competing core load ended, serial MCP
passed all 125 cases on each runtime, and artifact tests passed 94 with one
native Windows-only skip on each runtime; all four commands exited 0. No runtime
or fixture deadline was relaxed. These later results do not erase the initial
failures or establish that concurrent execution will never hit those deadlines.

## Internal Raw capture P2: registration mechanics only

The [local Raw V1 plan](plans/raw-local-v1-completion.md) records the bounded,
synthetic-only P2 integration and its final gates. It joins the existing capture
engine internally; it exposes no installed Raw capability. D5 independent-source
deletion, D6 forgotten-span exclusions, Raw → Card, arbitrary option-off control
closure, client adoption and production enablement remain later work. The local
fixtures establish lifecycle mechanics, not extraction quality or semantic truth.

Retained development failures include legacy episode/source identity collisions
that saved Raw without a new admission reservation (four red regressions), and
an eager schema probe that broke two legacy cleanup/query-count tests in the
first full Node 22 run (1,311 passed, two failed, actual exit 1). Narrow fixes
refuse those collisions atomically and defer the optional schema probe; the
first reviewed candidate subsequently passed 1,317 core tests on each supported
runtime, actual exit 0. Those greens missed the replay issue below.

Independent review of `05f4a94` found that staging failure/expiry could hide
already saved Raw on an identical retry. The new replay regressions initially
reported six passed and ten failed, actual exit 1. A further four-case red probe
showed that untouched staging past wall-clock expiry or its persisted watermark
could still be reported as processing. The correction observes durable replay
without renewing leases, restaging, invoking models or mutating expiry; completed
admission wins over staging expiry, while failed/expired jobs stay incomplete.
Source identity, profile, namespace and session fences still apply. The final
plan/PR records corrected verification and independent review; earlier green
results do not substitute for those gates or erase these retained failures.

Further scheduling probes retained six held-seal failures (two completed-winner
controls passed) and two failed-winner cases in a separate process, each command
exiting 1 before the atomic correction. Detecting replay only before an await
was insufficient: the real claim/reservation transaction must observe an existing
durable binding before acquiring any work. The correction also moves all nine
secondary P2 test resources onto their owning workspace's deferred cleanup;
Linux's ability to unlink open SQLite files was not evidence of correct teardown
ordering. No independent-review or final-gate pass is inferred from these fixes.

The atomic correction passed 1,350 core tests on each supported runtime, actual
exit 0. Two later red cases (actual exit 1) showed that a same-event winner during
sealing must also be selected as observation before model-budget preflight. The
final internal-only correction adds that post-await selection recheck while
retaining the transaction's authoritative check. Those full-core results precede
this last correction; corrected focused tests, independent review and final-head
CI are recorded separately in the plan/PR.

A subsequent independent review found that a winner committed during token
counting could still be hidden when that preflight then refused the slower
attempt. The new 34-case probe retained 26 failures and eight passing controls,
actual exit 1. A centralized final observation now requires an unaccepted
interpretation attempt and an existing identical binding plus Raw receipt;
it cannot create source, retry interpretation or bypass identity/control fences.
The expanded regression coverage includes failed/completed winners, throwing
counters, fresh zero-write refusals and corrupt orphan bindings. Earlier full
suite greens precede this correction; the plan/PR records its separate final
focused, full-suite and independent-review gates.

The subsequent full-core runs retained 1,389 passes and one failure on each
runtime, actual exit 1: the existing D3 journal-begin fixture expected admission
to finish inside a 600 ms wall-clock budget before injecting a 900 ms delay.
The unchanged selected case passed in isolation on both runtimes. Controlled
clock probes on clean P1 and the candidate reproduced both outcomes: expiry
before admission commits returns an outer timeout and rolls admission back;
expiry after the journal UPDATE retains admission and rolls the journal back.
The hook executed once when reached. This establishes a baseline-shared timing
precondition, not the exact historical expiry site, which was not instrumented.
The test-only correction keeps the 600 ms deadline, controls time only in an
isolated child at the actual SQL boundary, checks cold state and cleanup, and
requires a removed post-work-check mutant to fail. Runtime deadline behavior
and production clocks are unchanged; the plan/PR records the new final gates.

## Internal Raw lineage P3a: not complete source deletion

The [local completion plan](plans/raw-local-v1-completion.md) separates P3a's
lineage/exclusion mechanics from mandatory P3b deletion and P3c Raw-to-Card.
The separately selected schema 26 records no synthetic historical text. Exact
whitespace maps are supported; NFKC/redaction ambiguity falls back to the whole
message, and equal windows conservatively cover every matching position.
Legacy unknown receipt provenance is not evidence of independent support.
These scripted fixtures establish source fences, not semantic model quality.
Installed Raw capability, the D5 cascade (including old `forgetEpisode`), Raw
Card resolution and real re-extraction remain unavailable.

The primary independently reproduced missing D6 guards on the fixed P2 baseline in the expected-red P3a acceptance.
Worker fixture-development runs also retained four failed commands: 24/26
passed with an invalid indexed-profile setup, 30/32 passed when the disjoint
fixture accidentally reused a suppressed assertion fingerprint, and 46/48
passed when its purported unique Unicode prefix actually repeated across four
windows. Those were corrected fixture premises, not weakened suppression or
mapping rules. A later 269/271 run passed the expanded source-map assertions but
its legacy resubmission incorrectly exceeded the unchanged normalized 4,000-unit
input limit; the fixture now resubmits the actual bounded canonical projection.
Primary inspection additionally caught missing-origin duplicate
promotion and inferred legacy-receipt classification gaps during implementation;
the regression suite distinguishes unknown from genuinely independent evidence.
Final focused/full gates and independent reviews are recorded in the plan/PR;
earlier greens do not substitute for final-source verification.

Independent Spec review then found an episode-mode D6 gap on the frozen P3a
candidate: ordinary capture refused an excluded source, but a later option-off
episode capture could send it to the interpreter and publish a gist/passage
before extraction refused. The checked-in regression first reproduced both
clients (two positive controls passed, two exact leak assertions failed, exit 1).
The correction applies existing lineage authority to prepared episode inputs and
transactional publication, including zero-Memory prior passages, inherited
origin identities, pinned fields and step closure. Existing durable attempt codes
still record `episode_failed`; the immediate episode error may be
`source_excluded`, and a closed failed replay remains `capture_evidence_closed`
without another provider call. This does not implement P3b deletion of old prose.

Retained correction-development failures were fixture issues: an initial 0/4
run also reused an unqualified assertion in qualified positive controls; a
16/30 run used the wrong strict correction/reservation shapes; a 28/30 run
passed public-shaped namespaces directly to normalized internal runtime calls;
and a 36/38 run incorrectly expected an open-job error on closed replay. Each
command exited 1 and its evidence remains retained. These are distinct from the
specific provider-leak red and do not justify weakening source guards or legacy
validation. Final-source verification is recorded separately in the plan/PR.

## Internal Raw deletion P3b: local cascade, not host delivery or Raw Cards

The [bounded deletion plan](plans/raw-local-v1-delete.md) selects schema 27 only
through the uninstalled internal factory. It shares preview/delete planning and
legacy `forgetEpisode` mutation over actual retained receipt/source provenance,
including historical Memory and source-only episode consumers. Unknown legacy
support or unresolvable active/retained staged provenance fails closed and needs
repair; no backfill, independence inference or broad cleanup is offered. New
ordinary stores are not silently upgraded. The actual frozen v26 opener refuses
27; current option-off writers honor selected rules, including late migration.

Existing receipt-backed Card drafts/current evidence invalidate, but confirmed
authored bodies and host records remain. The finite content-free Raw outbox is
not evidence that a host withdrew an ask/preview, consumed an effect or received
an acknowledgement. RawSourceRef resolution/bare Raw-to-Card remain P3c;
installed Raw/client lifecycle and consumption remain P4. No paid-model,
semantic-quality, production encryption or operational-data claim is made.

Compatibility import closure adds exactly `core/raw-deletion-schema.mjs`,
`core/raw-deletion-storage.mjs`, `core/raw-source-roots.mjs`,
`core/raw-control-storage.mjs` and the already-existing `core/raw-input.mjs` to
the artifact manifest. These DB-only dependencies let installed ordinary
openers enforce selected-store rules. The usable Raw factory, journal/read
engine, resolver and new public constructor/tool fields remain uninstalled.

Two runtime failures are retained. The first integrated 17-case worker run
passed 13 and failed four; the primary's independent original 35 passed 31 and
failed the same pending-job deletion races, both commands exit 1. A minimal
public-created pending-claim probe reproduced SQLite CHECK failure (errcode 275):
clearing its token while keeping pending state was invalid. Deletion now expires
the valid pending lease while a separate durable closed-job fence prevents retry
and publication. The original four worker cases then passed on both runtimes
(actual exit 0), and the original primary 35 passed unchanged (actual exit 0).
The probe's first missing-lease setup error is retained separately.

The later 17-case jobs run passed 16, actual exit 1, reproducing a support-only
CAS gap: a trusted job could resolve an existing unknown duplicate receipt
without a Raw append or receipt insertion. The correction compares only exact
source receipts before/after binding and invalidates the reached Memory roots;
it does not update every namespace conversation. The combined 34 cases then
passed, actual exit 0. Final-source gates/reviews are recorded in the plan/PR.

The same support-proof transition was then tested through episode reservation
and Raw registration with zero extracted items and unchanged receipt rows.
Both exposed why observing job insertion alone is insufficient: message ledgers
can resolve a receipt earlier. Retained focused commands exited 1 (ordinary
control green, episode red; then ordinary/episode green, Raw red). The shared
DB-only authority-mutation guard now covers all three entrypoints. Its first
Raw integration still failed because journal preparation intentionally removes
the original session ID; using the journal's canonical session in the comparison
resolved that integration error without retaining raw IDs or creating a guessed
job binding. The three-entrypoint regression passed, actual exit 0. An initial
episode fixture qualification conflict is retained separately from its CAS red.

Fixture-development failures are not additional runtime hypotheses: the first
jobs run passed 4/17 because async conversation reads were not awaited; the
second passed 15/17 because registration legitimately purged staging that the
fixture had already expired. Four two-case cross-client setup runs used, in
turn, missing ledger timestamps, an extra view field, a public-shaped namespace
at an internal seam, and an incorrect count of pruned uncited sources. The host
suite first passed 6/10 because it assumed a suppressed assertion was admitted
again and replaced a crypto callback after construction had bound it. A later
47/49 run expected public Memory state `current` instead of `active`. All those
commands exited 1; fixture corrections preserve strict validation, suppression,
source pruning and callback binding. Worker logs, including these failures, are
retained under `/tmp/cairn-raw-p3-evidence.67nhhd/worker-delete-*.log`; primary
independent logs use `/tmp/cairn-raw-p3b-evidence.xOAiQk/` instead. Neither earlier
green runs nor a setup failure substitute for final frozen-source verification.

The first independent P3b Spec review found two further defects on candidate
`6596b2e`: actual P2 keep receipts stamped with a cross-client consumer could be
missed/misclassified during origin deletion, and zero-Memory episode-source
changes did not stale origin deletion CAS. Four checked-in regressions failed
on that candidate (0/4, actual exit 1). The correction shares exact retained
receipt/link/keep-action/source-ID resolution between planning and cascade,
and transactionally invalidates reached source-graph roots without a schema
change or namespace-wide revision bump. Missing/ambiguous legacy keep proof
requires repair and refuses before mutation; it is not independent support.

An additional support-authority transition was reproduced (0/2, actual exit 1):
removing recorded keep IDs changed a receipt from known A to unknown while the
same Memory also had actual Raw C support. Receipt rows were unchanged, but C's
old CAS was not invalidated. The episode-source mutation guard now retains exact
keep-linked receipt authority and Memory roots before source IDs disappear and
compares them after SQL, covering replacement and invalidation. The expanded
23-case review suite then passed on Node 22.16 (actual exit 0); final frozen-source
gates remain separately recorded in the plan/PR, not inherited from earlier runs.

A narrow helper lifecycle regression also failed for both clients (0/2, actual
exit 1): a failed preparation query before the mutation context's cleanup guard
could preserve that context across rollback and suppress a later CAS flush.
The direct DB-only helper test uses real source rows and a single injected read
failure. Its existing cleanup guard now covers preparation too. Current episode
callers normally establish an outer guarded context first; this test does not
claim that the public facade reproduced that injected read failure. The selected
regressions then passed (2/2, actual exit 0). The preceding six-suite 162/162 pass
was before this last lifecycle correction, not final-source verification.

The legacy fixture copies the actual `keepEpisodeCapture` function from P2
`9a7bbe59` (1,930 function bytes after trailing-whitespace removal, SHA-256
`b41fb629088170813a99b6232e3a80646da5f09bdd7cf974c585c034880ad926`), relocates
imports, and uses the real shared engine with its old snapshot fallback. It is
not a frozen copy of the entire P2 engine. Fixtures assert schema 25 and absence
of lineage/origin/job tables before upgrade; the primary also independently
exercises the actual old runtime. All fixture data is synthetic.

Correction fixture errors are retained separately: the first two C-support runs
stopped on qualification conflict and invalid profile setup before the real
authority-loss red; a later expanded run passed 15/17 because history setup used
ordinary supersede on a qualified Memory. History now uses real qualified
binding/transition, preserving the existing refusal. Correction logs, including
all reds and setup failures, are under
`/tmp/cairn-raw-p3b-evidence.xOAiQk/review-correction-*.log`.

## Internal Raw sources P3c: bounded local references, not installed Raw adoption

The [source packet](plans/raw-local-v1-sources.md) opts into schema 28 through
the uninstalled factory and existing trusted private-Card authority. Authored
Cards reuse the current lifecycle, ledger, evidence and typed organization engine;
no synthetic Memory/note, model call or retained Raw-text copy is required.
Only canonical DB/schema/input modules enter installed static import closure:
`core/raw-source-schema.mjs`, `core/raw-source-input.mjs`, and
`core/card-raw-sources.mjs`. The async reader and usable factory stay uninstalled.
Ordinary mixed-store browsing fails closed on required Raw-backed Cards while
deletion/cancellation/content-free operation inspection remain available by ID.
New source capability does not complete P4 clients, installed lifecycle, hosted
crypto/notice/production gates or host effect consumption.

Source budgets charge full enclosing parts shared across anchors, not selected
substring bytes. Each page authenticates the entire selected reference within
the caller's byte/row limits, even when returning one part. Large references
require an explicit larger budget; there is no cheap-pagination or latency claim
for an uncooperative crypto port. Re-encryption invalidates existing identities
and requires re-resolution. Raw and note usage projections remain separate.

Retained runtime reds include partially overlapping anchors: the first cached
prefix was reread/charged while extending a later anchor, refusing a request
whose actual distinct parts fit. The worker's two-client regression failed 0/2,
actual exit 1; the shared indexed collector now seeks only uncovered intervals,
including left/right extension and gaps between cached islands. Full bounds
coverage then passed 15/15 on Node 22.16, actual exit 0, without raising limits.

Independent P3c review exposed duplicate invalidation of a confirmed Card with
overlapping Raw spans and receipts from two Memories of the same conversation:
one deletion advanced its revision and effects twice (both clients, actual exit
1). Schema 28 now queues affected Raw-bound Cards for one outer-transaction
invalidation, including receipt loss when its Raw spans are disjoint. Its two
content-free coordination tables remain empty outside the mutation; queue,
source work, effects, indices and cleanup roll back together. Ordinary receipt-only
Cards retain their prior per-Memory revision behavior. The union is capped at
128 unique live Raw-bound Cards per outer source mutation, across direct Raw and
receipt dependencies; a 129th fails `dependency_limit_reached` atomically even
when each individual Memory/conversation fanout fits. This is a separate bounded
mutation limit, not a promise to erase arbitrarily large dependency graphs in
one call. Schema 28 is unpublished; no compatibility with earlier synthetic
schema-28 candidates or operational-store migration is claimed.

A real pre-P3a keep also exposed a D6 hole: its receipt contained consumer B's
identity while exact keep metadata proved original already-saved Raw A. After
upgrade, option-off forget succeeded but left zero A exclusions and an eligible
source-only A Card (0/2, actual exit 1). The shared exclusion seam now reuses
P3b's canonical keep-origin resolver before stamped-tuple fallback. Forget and
correction exclude the proven origin with existing exact maps/conservative
whole-message fallback; missing/ambiguous proof refuses before mutation instead
of guessing. The six-case legacy regression then passed, actual exit 0. No source
text matching, union of ambiguous roots or provenance backfill was introduced.

A subsequent actual-P2 differential probe found an ordinary-memory regression:
after consumer-source proof was removed, no-Raw legacy keep forget/correct still
worked on P3b but failed on the initial P3c source (four baseline passes/four
candidate failures, actual exit 1). The checked-in two-client regression also
failed all 12 operation/foreign-namespace cases before correction, actual exit 1.
The exclusion seam now first checks for Raw in the exact owner/scope/project
namespace. With none, ordinary mutation keeps its previous behavior; foreign
Raw is neither authority nor a mutation target. Missing keep proof still refuses
atomically when target-namespace Raw exists. The retained differential and
tracked-red logs are `worker-no-raw-legacy-first22.log` and
`worker-no-raw-tracked-red22.log` in the evidence directory below.

The frozen `compat-final` Node 22 full-core run retained one failure:
1,613/1,614, actual exit 1. The unchanged serialization-deadline test returned
the expected `model_timeout`, but its assumption that a 500 ms budget reached
the 700 ms serialization hook failed (`serialized=0`, expected 1). Controlled
probes on actual P3b and P3c, on both runtimes, reproduce that exact assertion
with a 600 ms pre-output delay; controls reach serialization. No Memory,
receipt, initial-classification or MOC rows are written, though the expected
content-free pending claim remains. This demonstrates baseline-shared timing
sensitivity, not the uninstrumented historical scheduler/expiration path.
The first probe's nonexistent-table instrumentation error is retained separately.

The first `compat-bounded` scheduling attempt put the concurrency option after
file arguments and did not enforce the intended limit; it was deliberately
stopped (core exit 143, matrix exit 1, empty owned scratch). The corrected
`compat-scheduled` run keeps the same 104-file roster, assertions and product
deadlines, placing `--test-concurrency=4` before the files. Its 22 Node 22
commands all exit 0, including full core 1,614/1,614; Node 24 verification is
still pending at this checkpoint. Neither that result nor an isolated green
rerun erases the original failure. The earlier pre-correction candidate's
intentional interruption is also retained in the [packet plan](plans/raw-local-v1-sources.md).
The usable Raw factory/reader remain uninstalled; the product pin is unchanged.

Fixture-development failures remain separate: a 50/52 run expected exclusion
before the mandatory concurrent coarse-revision fence; a fresh-revision check
now proves exclusion afterward. An 11/13 bounds run reused an event ID across
different sessions and correctly conflicted. The initial legacy correction
matrix passed 4/6 because its correction request used admission-shaped fields
rather than the existing strict correction DTO. Those commands exited 1; fixture
fixes did not relax runtime validation. Logs are retained under
`/tmp/cairn-raw-p3c-evidence.n7PShP/worker-*.log`. Final frozen-source gates and
independent reviews are recorded separately in the plan/PR; earlier green runs
are not final-source evidence or measured semantic quality.

## Standalone binary asset preview

`assets-local-v1` is an explicit embedded opt-in using v31 SQLite BLOB chunks.
It matches only the contract's bounded leading signatures and does not parse,
decode, render, execute, scan for malware or call models. Asset mutations use separate real-TTY commands. MCP exposes metadata and supplied
derivative text only, with no binary delivery or mutations. Embedded derivative creation accepts only
explicitly supplied text with `method:{kind:'user-provided'}`; it performs no
OCR, ASR, captioning or media understanding. Optional ordered audio/video
intervals are `user-supplied-unverified`, with no text-span alignment claim.
Derivative history compares the exact source ordinal with the greatest imported
ordinal; it does not infer a current source or inherit text into later versions.
Embedded mixed-method import requires both capabilities and separate grants.
Attachments are exclusive copies, charged independently, with no deduplication.
Method-only processes can inspect mixed metadata and purge attachments, including
corrupt bytes, but cannot deliver binary content without asset grants. Current
attachment cursors stale on adoption transitions; history remains on the exact
requested version with fresh authorization. CLI attachment import is explicit via `--attachments local-v1`; there is no MCP
attachment import or byte export. Local asset export uses a pinned operator-owned
parent, private source name and create-only link publication. A post-publication
fsync/cleanup failure reports `published-but-durability-uncertain`; termination can
leave private partials. Recovery never overwrites/removes the final, and cleanup
never adopts stale names. Same-UID processes remain inside the Unix owner trust
boundary. See [the host and recovery guide](assets-local.md#local-host-commands). The opt-in K13 measurement asserts both 32-MiB standalone
and 64-MiB mixed-import transaction/RSS thresholds, including byte preparation.
Every binary read verifies metadata and only the selected chunk; corruption in
another chunk is detected when it is selected. Authenticated totals prevent
truncated completion. Logical purge does not erase freed pages, journals/WAL or
backups, and the binary quota excludes that physical overhead. Deferred reads
avoid the previous write-lock contention mechanism, but rollback-journal readers
can still queue behind commits; overlap reader latency is reported without a
latency threshold. A continuously writing process can starve readers, producing
retryable `storage_busy`. The paced K13 gate requires at least 200 pages
overlapping actual writer calls, excluding pacing sleeps. The unpaced scenario
observes bounded stress with reader retries and eventual exact-byte verification;
normal sporadic capture/imports meet the paced gates. WAL mode remains a separate
store-wide follow-up decision. The unreleased
v31 guards reject replacement of retained tombstones and immutable payload keys,
including method tombstones and stale binding revisions. Every opener rejects
unexpected triggers on owned tables and ASCII-case-varied premature artifacts;
this is schema validation, not protection against a party able to rewrite the
database and remove its guards. Selecting assets performs a one-way v31 upgrade; older v30
binaries refuse the upgraded store.


<!-- U5c-2 optional source integration. -->
## Optional context sources

Relations and MOC title ranking require explicit host opt-in; calls can only
narrow that availability. Neither source is selected as a default by research.
Relations traverse one hop in four existing families, seed only four direct
candidates, and add at most two per seed/eight total. Relation existence remains
proposed/unassessed. There is no two-hop expansion, supersession/qualification
traversal, Raw/receipt candidate endpoint, episode or operational lineage.

MOC ranks valid authorized titles, not compiled summaries. Its full title
statistics and member ranking must complete within the shared deadline,
50,000-work and 8-MiB accounting bounds or its contribution is discarded.
With the default caps, broad queries over filed corpora typically degrade
around 10,000 Memories: the balanced synthetic 10⁴ probe reports
`degraded`/`work_limit` and contributes zero MOC candidates. The cutoff varies
with titles, memberships and projection state, and can come earlier or later.
Other enabled channels continue under the configured preset without weight
renormalization. Membership never filters lexical/semantic discovery. A history request still
uses current MOC members. Active Memory projection unavailability is not
bypassed; absent optional Card organization storage degrades MOC explicitly.
`summaryFreshness` is always unavailable pending E1. No retrieval-quality,
production-latency or 100,000-Memory guarantee follows from synthetic timing.

Source scan accounting is conservative application accounting, not a process
memory limit; SQLite calls remain synchronous/non-preemptible. Relations can
return a validated prefix with an unknown remainder. At most 32 candidates
reach assembly, while at most 24 bodies/refs are delivered. The 16-MiB aggregate
retained-source budget can evict rankings before the 128-ranking count limit;
continuations then return `cursor_stale`. New source state is never persisted.

Source fences include consulted, undelivered dependencies and are checked
inside final delivery transactions. Discovery changes can stale a page or
assembly even if its eventual evidence subset is unchanged. Independent full,
compact and snapshot fetches retain their prior evidence semantics; they do
not provide durable proofs of the discovery path. MCP source diagnostics stay
in host `_meta`, with the existing client-contract caveat: clients forwarding
metadata to models do not get a metadata invisibility guarantee.
<!-- End U5c-2 integration. -->

### Current-dependent Cards

Explicit Card dependency review is opt-in for authoring and always enforced for existing declarations. Stale current evidence is excluded; eligible retained authored history is qualified. Review does not judge semantic accuracy, rewrite content, archive overwritten revisions or restore purged sources/methods. Complete declaration context requires separate authorization; restricted readers receive minimal `access_revoked` metadata. Memory dependencies and generated-summary freshness remain unsupported. Schema v33 requires stopping older binaries before upgrade. Dependency contention/latency gates run only in the opt-in measurement script. See [the local guide](card-current-dependencies-local.md).
