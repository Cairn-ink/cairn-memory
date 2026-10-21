# Durable local capture authority (B2b)

Status: implementation authorized for this bounded synthetic-local packet.
Fixed dependent base: `1824f81ef77321613907f56565c0c261d55d04f5`
([B2a PR #458](https://github.com/Cairn-ink/cairn-memory/pull/458)).
Branch: `feat/raw-local-controls`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-controls`.
Evidence: `/tmp/cairn-raw-b2b-evidence.CV8jdu`.
Main at creation: `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.

B2a's exact parent has passed affected local gates, primary committed public/
installed checks and independent Standards/Spec review. Its latest-head CI is
now 31/31 successful with clean mergeability and an identical synthetic-merge
tree. The parent is ready/unmerged; B2b retains its own independent gates.
No merge, release, deploy, real transcript, paid/live request, operational
migration or product pin/flag change is authorized.

This follows B1 public composition and B2a skipped-tail recovery. Its API and
authority decisions below are settled for this bounded packet. No actual hook
text, setup state, provider or user database is involved; public behavior changes
only in this isolated candidate. Primary owns this plan and independent acceptance;
one actual GPT 6.1 Sol/high worker owns the permitted implementation.

## Outcome and distinctions

An explicitly managed local capture target needs durable, content-free consent
authority in the same SQLite transaction domain as Raw registration and Memory
publication. It is not another engine, a new source-retention default, or a
replacement for the existing trusted host boundary.

Three meanings must remain separate:

- Automatic-capture consent permits interpreting newly captured conversations
  under the configured provider/cost policy. Revocation blocks new work and
  publication of in-flight automatic work; historical stored data is not deleted.
- Raw notice acknowledgement records the disclosure for retaining permitted
  source text. Its absence blocks Raw saving but does not revoke separately
  granted Memory interpretation. It is neither a capability probe nor a wire flag.
- The per-client Raw saving switch stops retaining new Raw text. Existing
  Memory interpretation may finish, as already specified by B1/P2.

Pause and project stop continue using the existing namespace capture-generation
barrier. This is not consent deletion, and resume does not grant missing consent.
Neither remembered consent nor a model-generated request can change authority.

## Bounded design

1. One installed local target is bound to exactly one store identity, owner and
   namespace; both clients may use it. No enumerate-current-projects workaround
   for an owner-wide pause claim. A changed target binding is replacement, not a
   mutable wire routing field. Future multi-target setup is outside this packet.
2. Explicit managed mode is additional to the existing trusted library use.
   Legacy public constructors retain their default behavior. Managed mode cannot
   silently fall back to unmanaged mode when configuration/authority is absent.
   Untrusted capture input keeps its closed existing DTO, with no consent fields.
3. A content-free authority row is keyed by exact target/boundary/client. It has
   a CAS revision, automatic-capture enabled state and a capture generation, plus
   the acknowledged Raw notice version. Absent means no automatic authorization.
   Reading or opening does not enable it or synthesize notice acknowledgement.
   A successful settings mutation advances the row revision; a change to
   automatic capture rotates its generation, including disable/re-enable ABA.
   Notice-only changes must not invalidate previously admitted Memory work.
4. The trusted local adapter will supply a frozen startup snapshot containing
   expected target/store/boundary/client, row revision, namespace generation and
   Raw-switch revision. Core verifies it against durable authority before any
   port/model work and at registration. It never adopts the latest generation
   merely because a detached worker starts late. A mismatched snapshot refuses.
5. New managed Raw-capture bindings persist only the content-free authority
   identity and capture generation needed by the existing admission guard.
   Claim/publication and replay compare that generation and enabled state inside
   their normal transaction. Revocation during interpretation cannot publish
   Memory; no provider cancellation/refund guarantee is implied.
6. Raw notice and Raw-switch changes are checked at source saving, not used as
   Memory publication permission. Existing saved prefixes and immutable receipts
   remain. A notice revocation must close outstanding saving reservations once
   without backfilling a suffix after re-acknowledgement. The exact pending-only
   `notice_required` closure and ordering acceptance are defined below.
7. Authoritative setters are trusted local host/CLI operations, never MCP tools
   available to a model. They use exact expected revisions and atomic SQL state
   changes. They perform no file IO, network, async callback, provider work or
   unbounded configuration traversal inside a write transaction.
8. A new optional schema version must preserve old Raw stores and feature-off
   writers. Legacy capture-event bindings stay distinguishable from managed
   bindings, never silently upgraded to consent. Synthetic upgrade, rollback,
   reopen and partial-schema rejection are mandatory. No operational migration.

## Later setup/transport rules, not this worker's scope

The next installation packet must keep launch disabled while changing target
configuration; commit SQL authority before publishing a usable matching config.
Failures never report successful enablement. Revocation must commit SQL before
claiming in-flight publication is stopped. Filesystem markers alone remain
launch barriers, not transactional database revocation. Host pause must invoke
the fixed target's SQL namespace bridge as well as filesystem controls.

Provider credentials remain outside SQL and wire data; explicit API-key mode,
provider disclosure and finite per-call daily cap are still mandatory before a
model can run. Durable content-free cursors, lost-ack/high-water recovery,
actual source transport, MCP/verified-intent lifecycle and installed setup
closure remain separate implementation packets. No HMA or automatic Card work.

## Required acceptance

- No authority / disabled consent / wrong target, store, owner, namespace,
  client, revisions or generation: zero model/seal calls and no Raw/admission
  writes; no input getter or forged wire field grants authority.
- Grant in one process, reopen another, then revoke during sealing, preparation
  and scripted interpretation: correct registration/publication fence with no
  partial mutation; pause/resume and consent disable/re-enable reject old work.
- Notice-only revocation and Raw-only off preserve the separate Memory rule;
  saving reservations release once, original receipts/prefixes remain, suffixes
  never backfill, and valid fresh work resumes only with fresh trusted authority.
- Controls are exact-scope and CAS-atomic across owners, projects and clients;
  feature-off writers and restart cannot restore old authority.
- Old database upgrade is explicit and transactional; unmanaged/default-off
  behavior is unchanged; malformed supported layouts refuse rather than repair.
- Actual installed archive runs the public managed path in fresh processes with
  zero network/provider calls, independent closure checks and owned cleanup on
  success/failure. Both Nodes, primary acceptance, independent dual review and
  latest-head CI are required before ready/unmerged, as in B1/B2a.

## Reader integration boundary

E1-A PR #457 intentionally accepts only schemas18/20/21/22/23. Integrating its
reader with this Raw stack requires a separate explicit compatibility packet
for24–29. This packet does not silently change the independent E1 candidate or
claim that its pre-Raw reader already supports managed Raw stores.

## Primary seam decisions after the read-only check

Inspection confirms namespace generation is too broad for client-specific
consent: it invalidates both clients, including unmanaged captures. Retain a
separate per-client consent generation. A Raw notice-only change cannot reuse
`capture_barrier` (which discards transport tails) or mislabel itself `tool_off`.
Its closure will be pending-only `notice_required`: release reservations once,
keep saved prefixes/receipts, allow eligible Memory publication, and require
remaining suffix parts to be recorded as gaps before a later ordinal. An actual
pause/project/consent barrier may separately discard that transport tail.

Exact trusted library surface:

```
core.getLocalCaptureControl({namespace, client})
core.setLocalCaptureControl({
  namespace, client, targetId, expectedStoreId, expectedRevision,
  automaticCaptureEnabled, rawNoticeVersion, // null or 'local-plain-v1'
})
rawConversations.localAuthority = {
  version: 'local-capture-authority-v1', targetId, storeId, namespace, client,
  expectedControlRevision, expectedConsentGeneration,
  expectedNamespaceGeneration, expectedRawRevision,
}
```

These methods belong only to the explicitly Raw-enabled trusted core facade;
they are not published as model/MCP tools. Control reading returns actual store
identity plus absent/disabled revision0 without creating an authorization row.
The first explicit setter can grant or decline with expectedRevision0. Existing
target identity is immutable in this packet; replacement is not a wire feature.
Rows are unique by owner/namespace/client, with the bound nonsecret target ID.
There is no automatic multi-target enumeration or fallback namespace.

The one-target limit belongs to the first installer profile, not a global
uniqueness claim for every trusted library user. The same opaque target label
may exist in another exact namespace/client row; the full store/owner/
namespace/client binding, not that label alone, determines authority. Do not
query or revoke other rows by targetId alone.

The additive schema installs with explicit Raw capture construction; ordinary
new stores stay unchanged. Existing optional Raw versions upgrade transactionally
only through that opted construction, while feature-off openers understand and
preserve the new layout. No absent legacy row becomes consent. The constructor
validates the optional snapshot before opening; capture validates its current
authority before invoking the trusted policy, seal or model port. Unmanaged
trusted library use without that option retains its existing contract; installed
managed routing must never choose that omission as a fallback.

Setters perform exact-store/CAS validation and closure in one SQL transaction.
The authority row revision advances on a real change; consent generation rotates
only on consent change, and never on a Raw-notice-only change. Automatic-consent
revocation closes the exact namespace/client tails with `capture_barrier` and
blocks managed in-flight publication via its stored consent generation. It does
not delete evidence, revoke another client, or promise to undo a dispatched cost.

Managed registration records the authority binding in raw_capture_events.
Publication/replay use only its exact binding, enabled state and consent
generation in addition to existing namespace/session guards. Full startup row,
namespace and Raw-switch revisions are checked before registration; fresh worker
configuration is required after changes. No auth data is accepted in captureRaw
wire input. Pure continuation and control operations invoke zero models.

Tests must include stale startup after ABA,
authority changes while sealing, post-registration notice-only changes versus
consent revocation, old unmanaged rows, explicit per-client isolation, and
snapshot-spoofed boundary/store IDs. Changing the API or permission semantics
requires primary re-scoping; the implementer must not invent them implicitly.

The getter/setter value uses `{storeId,targetId,client,revision,
automaticCaptureEnabled,consentGeneration,rawNoticeVersion}`. An absent row
returns targetId:null, revision:0, automaticCaptureEnabled:false,
consentGeneration:'initial', rawNoticeVersion:null. Setter returns the new
getter value, including on an exact idempotent no-op. First row creation binds
the nonsecret target ID and a fresh consent generation; later changes to
consent rotate it, notice-only changes do not. Target replacement is rejected
in this first packet, not a CAS side effect. Each request still supplies exact
namespace; the trusted host, not a stored consent row, authenticates its owner.

## Primary pre-implementation oracle

`primary-local-controls.test.mjs` is an independently authored, external
12-case contract oracle, SHA256
`bce0b915fca05bc12b161fc10712b93a600dbb041554a6f70580b099b18ca2f3`.
It tests public library boundaries, stale CAS/store identity, both ABA cases,
revocation while sealing/after registration, separate notice/Raw-off semantics,
continuation zero-model work, per-client/project isolation and wire redirection.
Its first Node22.16 command on the B2a frozen candidate exits1:0/12 pass because
the new `getLocalCaptureControl` API is absent in every case. This is an expected
unimplemented-contract baseline, not evidence of an existing runtime regression
or a semantic score. Log `primary-local-controls-baseline-22.log` is retained;
the owned runner removed all synthetic fixture directories. The exact script
will move by reference to the next tracked contract, not become part of B2a.

## Final migration and replay constraints to carry into the tracked contract

Use additive optional schema29 for local authority, with a strict content-free
control table and nullable managed binding columns on raw_capture_events.
Every binding is either entirely legacy/unmanaged or entirely managed; partial
managed bindings must be rejected. Explicit public Raw construction opts into
this layout; ordinary construction must not migrate an older store merely to
provide controls. Internal legacy Raw fixtures may retain their selected
24–28 versions. The database option that installs29 also installs any missing
prerequisite28 table layout, even when Card methods remain disabled. Schema
presence is not public Card/Raw-source access authority: those facades still
require their existing privateCards/source options. Feature-off writers can
validate/preserve29 without granting consent or exposing controls.

The existing Raw migration chain must check28 prerequisites for every version
at least28, not only exactly28. Before installing29, validate the claimed old
layout and refuse pre-existing partial29 artifacts; do not use IF NOT EXISTS
to silently repair them. Upgrade, new creation and rollback run in the same
existing opening transaction. No provider, filesystem callback or async work
is introduced inside that transaction.

Preserve the old unmanaged binding digest byte-for-byte. Managed digests bind
target/store/client/namespace and consent generation, not the mutable notice
revision. Thus a fresh startup snapshot after a notice-only change can observe
an eligible prior event without acquiring interpretation; disable/enable ABA
cannot revive a prior consent generation. Managed and unmanaged event identity
collisions refuse instead of implicitly upgrading old evidence to consent.
Publication must enforce a stored managed binding even if a later trusted
caller uses an unmanaged facade; omission is not a way to remove a stored guard.

The authority setter is a trusted operation over the exact namespace/client
capture target. Its consent or notice revocation closes that target's relevant
Raw saving tails, including any existing tails under the same boundary. It does
not claim to revoke unrelated namespaces/clients. Memory publication guards are
applied only to managed bindings, so it does not retroactively convert legacy
Memory work into managed work. Docs and tests must distinguish this intentional
shared-target saving effect from the unchanged unmanaged behavior when local
authority is never configured.

### Error and snapshot behavior

Use existing fixed core error vocabulary. Malformed control/snapshot DTOs,
unknown fields, symbols, proxies, accessors or invalid enums return/throw
`invalid_input` without invoking getters. Revision/expected-store/target/
startup-binding mismatches refuse with `revision_conflict`; an absent or
disabled current automatic-capture grant is `capture_disabled`. Previously
registered managed work whose consent generation was revoked uses the existing
`capture_evidence_closed` publication/replay fence. These are not retryable
model errors. Only actual storage contention remains retryable storage_busy.
Do not disclose paths, SQL, keys, transcripts or callback exception text.

`localAuthority` itself is optional, but explicit undefined/null is invalid,
not an unmanaged fallback. Copy/freeze all its validated own-data fields,
including a canonical namespace, before opening the database. Validate shape
before side effects; compare the trusted expected identities/revisions to SQL
at prepare, after async sealing, and in the atomic registration transaction.
The complete startup snapshot can expire after a settings change; it is not
silently refreshed. After registration only the consent generation/enabled
state (plus existing namespace/session guards) determines Memory publication,
so a notice or Raw saving change alone cannot cancel admitted interpretation.

In managed capture, inspect the existing request/namespace/message/part/context
DTOs as closed own-data values before reading their fields, too; proxy/accessor
wire-like objects cannot execute getters before authority checks. Keep the
existing wire field set and unmanaged compatibility unchanged. This may live in
the new input helper, rather than broadening shared validation for unrelated
public APIs.

Exact CAS no-ops return unchanged revision/generation and do not close tails
again. First creation generates a real consent generation even for an explicit
disabled row; absent controls remain revision0/initial and no row. Session
fences, deletion/exclusion and actual pause/project-generation barriers retain
their existing priority and cannot be overridden by an automatic-capture grant.

### Episode path is part of the same authority boundary

The ordinary admission guard alone is insufficient: episode capture publishes
an interpretation before ordinary extraction, and `episode-storage.attempt`
already has a Raw-specific registration/generation fence. Extend the same
stored managed-binding check to that existing Raw episode attempt seam, at
start and commit. Bind the attempt to its recorded watermark event, not just
whichever grant is current when publication happens. Consent revocation or
disable/enable ABA during `interpretEpisode` must prevent stale episode prose
as well as Memory admission. A notice-only change must permit both, and a
legacy/unmanaged episode must retain its existing behavior. No eager optional
schema probe may break exec-only cleanup seams previously fixed in P2.

This is not erasure of previously completed episode/history evidence. A later
newly authorized event may use still-readable historical context under normal
source rules; an old attempt/watermark cannot borrow that newer grant. Cover
ordinary, staged and episode configurations and both client identities in the
author tests; the primary12-case oracle currently concentrates on ordinary
public capture and is not a substitute for these episode checks.

Primary now also freezes `primary-local-episode.test.mjs`, SHA256
`925e9f579b583960bf44de458460e36d0c15d4040654caec69135bdc0c041afe`.
Eight public episode cases independently construct both clients and four
mid-interpretation changes: revoke, disable/re-enable, notice-only and Raw-only.
They require the model race to be reached exactly once, retained permitted Raw,
and either no published gist/sources/Memory or successful independent gist and
Memory as appropriate. Node22.16 baseline exits1,0/8passed: all eight fail at
the absent control API, not yet at a semantic assertion. The original log is
`primary-local-episode-baseline22.log`. Owned test scratch was removed; the
concurrent B2a matrix's separately owned directory is not touched or swept.

## B2b execution packet (promote only after recording the fixed parent)

Primary owns this plan, the immutable independent20-case acceptance, caller
tracing, integration and delivery. Assign one bounded actual GPT6.1Sol/high
implementer; reserve two independent nonauthor reviewers of the eventual same
fixed diff. No schema or authority decision is delegated implicitly. Existing
Raw B2a is the dependency; its exact reviewed candidate must be written into
the tracked plan before implementation starts.

Allowed author scope: new local-authority input/schema/storage/guard modules
under core; necessary seams in core/{contract,runtime,database,raw-options,
raw-composition,raw-capture-storage,raw-journal,raw-control-storage,
admission-storage,episode-storage}.mjs; focused new core tests and synthetic
fixtures; installed archive allowlist and dedicated installed fixture/tests;
accurate CHANGELOG, CONTEXT terminology, architecture/local Raw/limitations
documentation. Root owns the tracked packet plan and parent completion plan.
Any extra runtime path or permission interpretation returns to primary first.
Do not modify hooks, wire DTOs, provider adapters, setup config, product files,
dependency versions, benchmark rules, live ledgers or existing regression
expectations merely to get green. Ordinary public defaults remain unchanged.

| ID | Observable pass condition |
| --- | --- |
| B2b-01 | Own-data closed constructor/control DTOs are snapshotted; malformed/accessor/proxy/unknown input invokes no getter/host port and does not create or migrate SQLite. Omission is legacy; explicit invalid localAuthority is not fallback. |
| B2b-02 | Absent controls stay disabled/revision0 with no grant row; explicit exact-store/namespace/client CAS survives reopen/new process, no-op is stable, stale CAS and target replacement are atomic refusals. Other boundaries remain independent. |
| B2b-03 | Disabled/missing or stale target/store/namespace/client/row/Raw/namespace-generation snapshots stop before policy, sealing, registration or model work. Pause/resume and consent ABA cannot refresh old workers implicitly. |
| B2b-04 | Revoke during sealing leaves no new Raw/admission rows; revoke after registration retains permitted Raw but blocks new Memory publication and old-generation replay. Stored managed guards cannot be dropped through an unmanaged caller. |
| B2b-05 | Both clients' ordinary/staged/episode paths enforce the same authority. In-flight episode prose and Memory cannot publish after revocation/ABA; legacy and exec-only cleanup seams remain intact. |
| B2b-06 | Missing/revoked notice and Raw-only off do not revoke granted Memory/episode work. Pending reservations release once, original receipts/prefixes remain, no backfill or invented EOF, proper fresh snapshot is needed for future work. Continuation/control/reads have zero model calls. |
| B2b-07 | New explicit opt-in and supported24–28 upgrades reach29 transactionally with no fake grants. Old unmanaged bindings stay legacy; partial layouts refuse; injected migration/control failure rolls back. Feature-off writers preserve29 and all source/deletion fences without exposing Card/control capabilities. |
| B2b-08 | Installed private archive/fresh processes execute actual public grant/capture/revoke/reopen, both clients, no source fallback or network/provider calls. Independently derived complete import/asset inventory matches packed files and hashes. |
| B2b-09 | Owned scratch/resources are removed on success and deliberate failures. Both supported Node versions pass current contributor/CI gates, primary20-case and installed checks, same-candidate independent Standards+Spec, latest-head CI/mergeability before ready/unmerged. |

Verification sequence: implementation/API/preflight checkpoint, focused
state/transaction checks including pre-fix evidence, installed lifecycle,
frozen scope/hash, then scheduled full matrix. Report at meaningful milestones,
on any contradictory requirement, and at least every20minutes. No heavy timing
suites while another scheduled matrix runs; primary coordinates capacity.
After two unsuccessful correction rounds on one cause, primary re-scopes.
No hidden retries, returned-failure relabelling, production data or user key.

Required affected matrix on Node22.16/24.15: core, MCP, artifact, generic,
JSON and native plugin validation, store/capture/episodes/session-context/
private-cards demos and generated client/setup parity. Add admission/MOC or
source-specific demo gates if the actual diff changes those paths. There is no
TypeScript gate. Frozen byte inventories use two independently derived routes;
primary reruns key public/installed checks after candidate commit, then dual
review. Any correction gets affected checks and both reviews again. Latest-head
remote checks must pass; no merge/release/deploy/pin/flag change is included.

## Exact-parent baseline and routing record

On the reviewed fixed parent above, primary runs its frozen12-case public
control oracle plus frozen8-case episode oracle together on Node22.16.0:
0/20pass,20fail, actual test exit1. The controls are not implemented yet; this
is the required red baseline, not a production regression or semantic score.
The expected-red audit exits0 and confirms owned runner roots are absent.
Log: `primary-baseline-parent-22.log` in this packet's evidence directory.
The two immutable oracle files and hashes remain in the preceding evidence
directory as identified above; set `CAIRN_LOCAL_CONTROL_REPO` to this worktree
when evaluating the new candidate. Do not edit those oracles to fit the author.

Assigned implementer: `/root/raw_b2b_controls61`, actual requested
`gpt-6.1-sol`, high effort; no model fallback planned. Primary owns caller
tracing, frozen plan, independent acceptance, integration and delivery; two
separate nonauthor reviewers will inspect the same eventual committed diff.
Token/cost data is unavailable; do not infer spend from the model label.

## Parent correction and early independent acceptance

Implementation began from `52b7d825c5cdd2715bd57fc6c6713f02ab29439c`.
That parent passed its original local matrix but remote MCP CI exposed an
existing PTY test-fixture framing defect. The explanation, retained red evidence
and minimal test-only correction live in `raw-skipped-tail-barrier.md`.
Final parent `1824f81ef77321613907f56565c0c261d55d04f5` preserves all original
eight author files, passes full MCP 134/134 and primary committed 35/35 on each
Node (actual exits 0), and passes both independent review axes with no findings.

At an explicit worker checkpoint, primary fast-forwarded this local dependent
branch to that reviewed parent. Incoming changes were exactly the PTY helper,
new framing test and B2a plan. All 28 pre-existing local changed/untracked files
were disjoint and byte-identical before/after; the index stayed empty. The
integration audit exited 0 and is retained as `primary-parent-integration.json`.
This was not a GitHub PR merge, runtime change or permission to deploy.

Primary also independently constructed nine additional acceptance cases using
the actual frozen parent database opener to create real schemas 24 through 28.
They verify opt-in upgrade to 29, unchanged ordinary stores, no Card authority
from schema presence, retained legacy Raw/Memory and replay identity without
retroactive consent, partial-layout refusal and an injected control/closure
failure that rolls back consent, pending assembly and reservation together.
The last check observes state through a separate SQLite connection. Combined
with the frozen 20 public/episode cases, this early roster passes 29/29 on
Node 22.16.0, actual exit 0 (`primary-initial-all22.log`). It is not final-frozen,
installed-hook or semantic evidence; final committed checks and both review
axes are still required.

## Frozen candidate verification checkpoint

The final B2a parent is now ready/unmerged with 31/31 latest-head remote
checks successful, clean mergeability and identical synthetic-merge/candidate
trees. No runtime files were changed by its test-only correction.

Author's final scope is 27 files; the root-owned plan makes 28 total. Primary
independently compared Git diff plus untracked paths against the fixed parent
tree and filesystem blob/mode comparison: 28/28 agree, and all 27 author SHA256
hashes match `worker-author-freeze.json` (manifest SHA256
`8e7116b9ca00e053d2f14388be2affba581198c03d4de9ebc3306769ab3fb495`).

Retained explanations before this freeze:

- A new migration test mistakenly expected a private Card facade from schema
  presence. Seven fixture checks failed (23/30 passed, actual exit 1); correcting
  that new fixture to require absent Card methods preserved the runtime's
  intended capability boundary. No existing expectations were changed.
- A synchronous host-policy callback could revoke consent after the first
  authority check but before sealing. Two new cases first failed, actual exit 1;
  rechecking the same frozen authority after the callback made both pass before
  sealing, actual exit 0. No snapshot refresh or broader grant was added.
- Optional Raw-table detection now caches only positive presence. A previously
  opened feature-off handle must see another connection's later explicit Raw
  migration when checking publication. Dedicated lazy-probe regressions retain
  the exec-only cleanup seam and demonstrate the actual late migration.
- An early suspicion that old public tests hard-coded a schema version was
  checked and withdrawn: there was no such expectation to change. Existing
  regression assertions remain untouched.

Final focused author roster: 78/78 on Node 22.16.0 and 24.15.0, actual exit 0
each. Primary independently ran its frozen 20 public/episode cases, nine genuine
old-schema/atomicity cases and the two actual installed-archive cases: 31/31 on
each Node, actual exit 0. Owned runner roots were removed. Installed checks use
both clients, four distinct successful processes and a deliberately failing
process per client, real archive/public imports, no network and zero provider
calls. Source import/assets closure is 112 files; independently observed
installed closure and hashes agree; the archive has 130 files.

The frozen matrix completed at 2026-10-21 12:31 UTC: 42/42 scheduled commands
have actual exit 0 and null signals. Each Node passes core 1724/1724, MCP
134/134, artifact 100 passed with one explicitly native-Windows-only skip,
generic 635/635 and workspace lifecycle 25/25. Both also pass JSON/native plugin
validation, twelve relevant demos, generated bundle parity and setup parity.
No skipped test is counted as passed. Primary's separate audit verifies all
42 exits, suite totals, all 27 frozen author hashes, and the absence of both
the owned matrix directory and outer runner directory; audit exit 0.

Commands and exact child PIDs/exits/timestamps are retained in
`worker-matrix.mjs` and `worker-matrix-results.json`; primary's independent
audit is `primary-matrix-audit.json`. Committed-candidate primary reruns and
both independent review axes remain required before delivery. Evidence is in
`/tmp/cairn-raw-b2b-evidence.CV8jdu`; those local logs are not portable test
dependencies. No model-quality score is inferred.

