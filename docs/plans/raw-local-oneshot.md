# B3: installed local one-shot capture adapter

Status: Phase-B source frozen; focused and primary independent checks passed on
both runtimes. The full-matrix Codex fixture failure is diagnosed and corrected;
all 54 unique affected runtime/gate pairs are independently audited as passing.
Committed acceptance, independent review and delivery remain pending.
Prepared worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-oneshot`,
branch `feat/raw-local-oneshot`. Fixed B3 base is now corrected B2b
`d8e114c52f6cac02315f55ce326473d1c1edb386`, accepted by both independent
review axes after its corrected 42-command matrix and committed primary 35-case
roster on both Nodes. Parent PR #459 is now ready/unmerged, with all 31 latest-
head CI checks passed and the remote merge tree matching the reviewed tree.
The initial B2a anchor `1824f81ef77321613907f56565c0c261d55d04f5` and interim
Phase-A parent `a4553873c9ff31453e7f8ac83e1d8d10abb0e008` are historical,
not the final B3 review base. No delivery uses the known-failing interim parent.
Final combined verification and both B3 independent axes remain mandatory.
This is one bounded part of step 3 in `raw-local-v1-completion.md`, not
automatic hooks/setup or a claim that standalone local V1 is complete.

## Outcome and boundaries

One explicit local process accepts one already selected/redacted capture-v2
request, invokes the existing managed `openMemoryCore().captureRaw`, then emits
one bounded truthful reply. It uses the existing SQLite engine, OpenAI adapter
and product runtime request-count guard. It never grants itself consent,
constructs Cards, invents a separate Memory algorithm or uses the benchmark
ledger. No real user data, provider calls, merges, releases, deployments,
product pins/flags or operational migrations are authorized for this packet.

Actual Claude/Codex hook routing, producer/cursor persistence, initial setup and
the integrated Raw/Memory/Card lifecycle are subsequent packets. Existing
hosted/v1 entrypoints and defaults remain byte-identical. B3's installed
entrypoint is opt-in only; packaging is not publication or automatic routing.

## Fixed configuration and process contract

The entrypoint is `adapters/local/cli.mjs --config <absolute-private-file>`.
No other CLI argument, source path, inline key, environment-expansion string,
runtime module path or arbitrary command is accepted. Input is one JSON v2
request on stdin, followed by EOF; use the existing strict validator and
65,536-byte bound, not normalized v1 capture. Invalid UTF-8/JSON, unknown keys,
extra trailing JSON, oversize, unsupported client and scope mismatch refuse
before opening a writable database or reading a provider key.

Configuration is a closed own-data JSON object, read through the existing
private-state reader (owner-only, no symlink leaf, bounded 64 KiB). Native
Windows is explicitly unavailable for this private-state adapter; do not
weaken permission checks or change its unrelated preview support.

```
{
  version: 'local-capture-config-v1',
  databasePath: '<existing absolute normalized SQLite path>',
  authority: { ...complete local-capture-authority-v1 snapshot... },
  raw: { mode: 'off' | 'local-plain-v1', capBytes: <positive safe integer> },
  provider: { profile: 'openai-baseline-v1', apiKeyEnv: '<explicit env name>' },
  usage: { root: '<existing absolute private directory>', dailyCap: <positive>,
           concurrency: <1..32> },
  timeouts: { captureMs: <1..120000>, processMs: <1..150000> }
}
```

All fields are required; captureMs must not exceed processMs. Scope/client/
target/store/generation/revision come only from the detached trusted authority,
not request fields. A project request must have exactly the bound project ID;
a personal request must omit project_id. Both supported client names map to
their existing engine names without broadening any identifier policy.

Use existing authority input validation, not a second authority schema. A
read-only preflight confirms an existing private regular database, Cairn app ID,
schema 29 and exact store ID. It must not create a file, upgrade an older store
or change a stored cap. The existing Raw usage row for the bound owner must
already agree with the configured cap; a different cap is a setup/configuration
decision, not an implicit effect of capture. The real core still checks durable controls and
the frozen snapshot at registration/publication; preflight is not a grant.
Do not silently reload current control generations to make stale work pass.

Source inspection found one required narrow primitive: the existing journal
has a no-reconfiguration branch when capBytes is omitted, but not an explicit
configureCap parameter. Public raw-v1 construction requires capBytes, so it
cannot use that branch while also supplying an initial cap for a new owner.
Add an optional own-data boolean `configureCap` to the trusted Raw constructor
options, forward it to the journal, and make its existing cap-update branch
conditional on both an explicit cap and configureCap not being false.
Omission preserves current behavior, including no update when no cap is given;
the local adapter explicitly uses false.
This avoids overwriting a concurrent cap change between read-only preflight and
writable core open. Existing stored owner caps remain authoritative; absent
owner usage uses the explicit configured initial cap. No new cap setter, schema
or wire permission is added. Invalid values still fail before database open.
Test both legacy/default reconfiguration and the new no-reconfiguration path,
including a lower cap written by another connection before capture. A static
preflight alone is not presented as concurrency protection.

The local plain port preserves exact selected/redacted bytes and identifies
itself as local-plain-v1, not encryption. Core's separate notice and Raw-only
controls remain authoritative; missing notice may skip Raw while eligible
Memory work continues. This entrypoint never invokes a control setter.

Use the existing `captureQualification: 'source-bound-v2'` ordinary capture
profile, without staged evidence, episode generation, ordered reconciliation
or automatic rationale. This retains source-bound qualification instead of
silently treating unqualified extraction as a reliable fact. Those other
existing optional profiles remain separate from this first transport packet;
do not accept arbitrary core profile options from config or wire.

For this mechanical integration use the existing OpenAI baseline profile
(currently DEFAULT_MODEL), without changing provider profiles, prompts, token
budgets or claiming a model-quality upgrade. API-key environment lookup is lazy
at the first actual remote model port. No hosted bearer-token discovery,
subscription credential reuse, key in argv/stdin/config/SQLite/logs or arbitrary
endpoint. Missing/invalid credentials refuse the attempted interpretation with
fixed content-free errors; continuation/replay need no provider key.

## Accounting, authority and lifetime

Use `integrations/client/runtime-usage.mjs` in api-key mode, with client names
mapped to its existing claude/codex owners. Derive its 64-hex budget target from
the versioned tuple [local-capture-budget-v1, storeId, targetId], independent of
client/session/namespace generation, credential, config path and consent epoch.
One installed target must use the same private usage root for both clients.
Count one permit for each remote model-port invocation, including uncertainty;
that invocation contains the adapter's count and generation HTTP requests.
These are daily invocation-count limits, NOT a dollar/spend guarantee.

Preserve the guard's lock, durable dispatch-intent and no-refund rules. Do not
await network work under its state lock. Local countTokens/fit planning,
continuations and completed replay reserve nothing. Do not pre-reserve a
full-batch allowance, refill by creating a new ledger on conflict, retry a failed
port or add failover. State corruption/unknown liveness refuses new dispatch.
The existing guard's explicit first-use initialization and UTC daily rollover
remain; this is not protection against the local owner deleting their ledger.

Recheck the recorded consent/target/store/namespace capture generation at the
actual dispatch boundary after asynchronous guard work and before each HTTP
request. Use the existing public read controls for this adapter-side check;
only registration/publication in core remains definitive. Raw-only/notice
changes after valid registration do not revoke eligible Memory work. A true
capture revocation/ABA must prevent later model dispatch and Memory publication.

Combine the core's supplied AbortSignal with the process deadline. The existing
core aggregate/per-port and provider token/output bounds are never enlarged.
Release a guard reservation only when its underlying provider invocation has
actually settled, or through existing dead-owner recovery after the process is
confirmed dead. A Promise.race timeout alone is not termination. The standalone
CLI must never emit a successful completion/normal exit while an underlying
invocation remains unconfirmed. Hard process deadline exits 124 with only a
fixed diagnostic and no fabricated success; a dead process can free a slot on
restart but consumed calls are not refunded. Catchable termination closes owned
handles, and every failure path preserves the original durable capture outcome.
No unattended background child or retry scheduler is created.

## Reply mapping

Stdout is one JSON line `{ status, body }`, at most 262,144 bytes. A v2 body
itself retains its 65,536-byte protocol limit. Stderr never contains source,
key, model response, filesystem path or arbitrary exception prose. Each
reported success is checked with `classifyRawAcknowledgement` against the exact
frozen request before emission. A fixed nonzero exit is used for malformed
configuration/input/internal process failure; a well-formed completed request
can exit 0 with a non-2xx refusal response. Document the exact distinction.

Start the maximum 150-second watchdog before configuration/stdin work, then
shrink it to the configured processMs measured from the same monotonic start.
No full timeout is restarted at each stage. A blocked output pipe cannot turn
partial stdout into successful process completion; consumers require both a
valid reply and normal exit. This is the supervised Node-process contract, not
proof of preempting an uninterruptible kernel/filesystem hang; the later host
worker adds its own independent outer termination deadline.

- 200 only for completed durable admission (including empty legitimate
  extraction), completed exact replay/covered overlap, or durable continuation/
  no-eligible-first-part. Count memories from explicit committed IDs, not model
  candidates. A later optional MOC-classification failure does not erase a
  completed admission, but must not be misreported as classification success.
- 202 with processing:true only for actual durable active work. It never
  authorizes a future cursor to advance.
- Saved Raw plus failed/incomplete interpretation is non-2xx, with fixed
  `interpretation_incomplete` and bounded content-free Raw dispositions. It is
  never 200 merely because the outer core envelope is ok. A cap/provider failure
  after registration stays an incomplete event, not a promise that resetting a
  quota will retry that event. No hidden interpretation retry is added.
- A failure before registered Raw produces a fixed allowlisted refusal code;
  arbitrary nested errors collapse to a generic local-capture failure. The
  adapter may keep a trusted local budget-denial reason separately because core
  intentionally does not forward arbitrary model errors. Never override proof
  of completed admission or fabricate Raw receipts using that reason.

This is request processing status, not semantic truth, final answer accuracy,
full conversation coverage or new knowledge-card consolidation.

## Acceptance roster

| ID | Observable requirement |
| --- | --- |
| B3-01 | CLI/config/wire bounds, invalid UTF-8 and forged routing refuse before writable open/key lookup/network; owner/mode/symlink and unsupported-platform handling are fixed errors. Existing wrong/old/missing DBs and mismatching caps are unchanged. |
| B3-02 | Both clients map exact v2 identity/ordinals/parts to managed capture; actual core + SQLite + fresh process reconstruct selected Unicode/whitespace. No auto-grant and no second storage/algorithm. |
| B3-03 | Exact replay, covered overlap, empty projection and continuation use correct terminal status with zero extra remote calls/usage; saved Raw plus extraction/qualification failure stays incomplete and cannot advance. Processing remains processing. Optional filing failure cannot disguise completed admission. |
| B3-04 | Every remote port has one durable permit covering its two HTTP requests. Concurrent clients/processes cannot overspend; restart/credential or generation rotation cannot reset same-target counts; corruption and uncertain liveness fail closed; no refunds/retry. |
| B3-05 | Revocation/ABA before dispatch, between guard work and dispatch, or between count/generation prevents later request/publication. Notice/Raw-only changes do not falsely revoke Memory. Plain Raw requires the engine's notice policy. |
| B3-06 | Cooperative abort and deliberately uncooperative provider child demonstrate actual termination accounting; deadline outputs no false success. Per-call/aggregate/token/output limits remain and all resources/children are supervised and reaped. |
| B3-07 | Real private archive installs offline, includes complete independently derived import/assets closure, and executes the CLI in fresh processes for both clients with intercepted fake HTTP only. No source fallback, provider key or external network. Test stderr/stdout leakage sentinels. |
| B3-08 | Success, deliberate failure, cancellation and child timeout leave no unexpected owned scratch. Existing hosted/v1 core/provider/client/setup suites stay unchanged/green on Node22.16/24.15. New entrypoint is included in actual CI discovery; independent Standards+Spec review the same committed diff. |

## Scope, verification and routing

### Two-phase ownership during the B2b correction

Primary authorizes parallel implementation only in disjoint files while B2b's
already-reproduced two-line sealing fence repeats verification. This avoids
serializing new adapter code behind unrelated full-suite wall time without
pretending the interim parent passed its Spec review. No behavior, permission,
budget or final gate is relaxed.

- Phase A: new adapters/local modules/tests, dedicated new packaging fixture/
  tests, artifact allowlist, package/CI discovery, and the additive raw-options
  validation/forwarding only. Do not edit raw-journal, CHANGELOG, existing
  limitations/architecture/Raw docs, either root-owned plan, or B2b tests. Those
  overlap or depend on the still-running parent correction. Local focused
  diagnostics may expose the known missing no-reconfiguration branch; do not
  weaken expectations or claim that seam is already implemented.
- Primary then pauses edits, checks the exact corrected/reviewed parent,
  verifies incoming paths are disjoint, and fast-forwards while checking every
  existing local file's bytes and the index. If overlap is detected, stop that
  integration and resolve it explicitly; never overwrite the worker's changes.
- Phase B: after that recorded integration, implement the previously approved
  raw-journal cap condition and accurate shared docs, then freeze and verify the
  whole candidate. Review/PR/CI evidence uses this final parent and candidate,
  never the temporary phase-A anchor.

One actual GPT 6.1 Sol/high implementer owns new `adapters/local/` modules and
tests, dedicated packaging fixture/test, explicit artifact allowlist additions,
one owned-runner package script/CI gate and accurate local Raw/limitations/
architecture/CHANGELOG documentation. Root owns this plan and primary probes.
Existing OpenAI/runtime guard/core/hosted/setup behavior is read-only; report a
demonstrated missing primitive before editing those seams. Keep direct closure
imports narrow: protocol/bounds/hosted-contract, private-state/state-lock/runtime-
usage. The runtime guard's necessary static transitive pairing/control-state/
file-lock/liveness dependencies are allowed and must be mechanically inventoried;
do not include whole producer/host trees just because they are nearby. This is
packaging existing helpers, not enabling pairing or hosted transports.
The sole approved core exception is the additive configureCap forwarding above
in raw-options/composition as needed and the existing raw-journal cap-update
condition, its focused test and documentation. Do not change raw-journal's
capture, admission, authority or reservation behavior for this packet.

Worker traces actual CLI -> validator/config -> provider/guard -> managed core
-> acknowledgement and each dependent packaging/CI path, then reports an early
API/file checkpoint before broad tests. Freeze author hashes through two
independent file inventories. Primary inspects the actual diff and personally
runs independent subprocess/installed checks on the exact committed candidate.
Separate nonauthor reviewers inspect Standards and Spec without sharing their
conclusions. After two unsuccessful corrections of one cause, root re-scopes.

Required affected gates: new one-shot tests, runtime-usage/client tests, Raw
producer protocol, OpenAI offline/demo, artifact, MCP, generic/validate/native,
bundle/setup parity and workspace lifecycle on both supported runtimes. Run the
full core matrix for the approved constructor forwarding change; retain the exact
B2b base and personally exercise actual integrated capture. All commands use
owned synthetic workspaces and sanitized credentials; report actual exits and
cleanup rather than pipeline tails. No typecheck exists in this JS repository.
CI must pass on the final reviewed head before ready/unmerged delivery.

Token/cost telemetry for agents is unavailable; no paid-memory experiment is
authorized. The continuous-work 12–18-hour discussion checkpoint remains.

## Primary baseline

Before implementation, primary's separate 12-case subprocess roster on Node
22.16 exits 1: 0/12 passed because the one-shot entrypoint does not yet exist.
This is an explicit missing-feature baseline, not 12 discovered production
bugs or a semantic score. The roster covers both client replay/continuation,
real fake-HTTP provider framing, qualification and optional-filing failures,
revocation between count/generation, private input/config boundaries and a
deliberately uncooperative provider followed by dead-owner slot recovery.
It and its HTTP preload live in `/tmp/cairn-raw-b3-evidence.rO3Vxh` outside the
author's edit scope; the parent matrix remains untouched.

Primary validated the fake-HTTP oracle itself against the actual source-bound-v2
engine before exposing it as acceptance. Its first run exited 1 because the
new test preload used obsolete inline qualifier output; the current adapter
correctly requires evidence-pool-v1. Changing only that external test fixture
to the documented pool/slot wire shape makes the direct oracle pass (actual
exit 0): one durable Memory survives a separately reported optional
classification failure, five fake HTTP requests, exact Raw reconstruction and
zero provider/network calls. This is a fixture correction, not a product bug
or a reason to weaken provider validation. The product code is unchanged.

The corrected HTTP oracle passes on both Node 22.16 and 24.15, actual exit 0
each. Frozen independent CLI roster SHA256:
`dc4f381b756ea1cb99ec63d3911a6ceb9d0264c647cbdb318d787beca34c32c3`;
HTTP preload after the justified wire correction:
`738a68c4b450349508d9b08aafb68994b30fe33750bc753663de58e0cd8d0df2`.
Primary's separate cap-opening oracle establishes a real owner usage row,
lowers it from another connection, then tests non-reconfiguring capture. On
the pre-B3 parent, 1/2 pass and 1 fails with invalid_input at the not-yet-supported
configureCap:false option, actual exit 1. Invalid values already fail safely.
Both original baselines remain retained rather than relabelled as passing.
Cap-opening oracle SHA256:
`ab1b0d7b6cef0512b530ff84ce0f48a9fdd35c7fe49432a0f6143bbf8ef901e4`.
Before implementation, a second source check corrected the contract's wording:
configureCap was an internal computed condition, not an existing parameter.
The approved additive option must reach that condition; default behavior stays
unchanged. Opening with mode off and no explicit cap already avoids rewriting
usage caps, so the independent revocation fixture needs no unrelated change.

Dependency setup reused existing installations only after all three package
and lock pairs matched byte-for-byte. New ignored node_modules directories
contain links to existing entries; no npm ci, shared-install removal, network,
credential/configuration change or dependency version update occurred.

Primary additionally freezes one paired-process acceptance case: a held Claude
invocation occupies the shared slot, a separate Codex process is refused without
another HTTP request/count, releasing the first process does not retry Codex's
failed event, and a fresh Codex event consumes the same target's remaining daily
allowance. A later Claude process cannot escape that cap. This uses actual CLI
processes and the unchanged guard with intercepted synthetic HTTP, not a fake
guard. Its missing-entrypoint baseline is 0/1, actual exit 1, separately retained
as `primary-paired-baseline22.log`. Combined primary roster is now 15 cases
(original 12, cap-opening 2, paired-process 1), not a semantic benchmark.
Paired oracle SHA256:
`9cf68c5b3673dd78bcc771cb42da08f56d0e0702665672bbf199782a953a9f9f`;
controlled-wait preload SHA256:
`75537f6c7946bc36c1232a40cd36d232fec97fd26b4b715590e754b2e963221d`.

Primary also prepares two independent installed-package cases (one per client),
separate from the worker's packaging tests. Each installs the inspected private
archive offline and runs fresh actual CLI processes for qualified admission,
keyless replay, Unicode continuation, provider failure, failed-event replay and
malformed input. A module loader refuses runtime fallback outside the install;
observed imports/assets must match a separately derived source closure. HTTP is
intercepted and direct sockets are refused. These checks also inspect real
SQLite readback, one shared durable usage ledger and owned success/failure
cleanup. This increases the eventual primary combined roster from 15 to 17;
syntax checks exit 0, but execution is still pending the frozen B3 candidate.
Installed test SHA256:
`0642bf53112f40d3338e4ba42c8c5c46d8d5fa47a44acfa110145d98be1991f4`;
installed interception/closure preload SHA256:
`0216c7d66ad84653477f25e3667d86d0658cb6584d0c4dc97f37e4bdc5d4d822`.

## Phase A integration record

The first author-focused run on Node 22.16 passes 3/16 and exits 1, retained as
`author-phase-a-first22.log`. Two cap-preservation failures are expected until
the reserved phase-B journal condition is implemented; the other failures are
not waived. The author isolates an adapter representation mismatch: the shared
authority validator canonicalizes personal projectId to an internal empty
string, while the public namespace API requires null. Reusing the internal form
in getCaptureControl refuses before guard reservation or HTTP dispatch. The
correction belongs at the adapter's public API boundary, not in a relaxed core
validator. Primary inspected those actual input/caller paths and the failed log.
The test's original off-mode readback assertion is also replaced with real
stored-byte inspection; an unavailable read port cannot prove source fidelity.
After converting only the detached adapter namespace to the public null form,
the 13 CLI subprocess cases pass on Node 22.16, test and outer runner exits 0
(`author-phase-a-second22.log`). Primary inspected the change and reported
suite totals. Cap-preservation integration, both-runtime frozen verification
and final independent acceptance are still pending; the 13-case pass does not
silently count the two deferred cap semantics checks as passed.

Phase A is frozen at interim parent `a4553873c9ff31453e7f8ac83e1d8d10abb0e008`:
17 author paths, manifest SHA256
`5d342623eb99c5c7971a1c5a7ac3d9d3f876cfa0f16d0db3126de1750e4122ad`.
The author runs 29/29 focused checks on each supported Node, actual exits 0;
these deliberately exclude the two deferred journal-cap semantics checks.
No author commits or pushes occur before integration of the corrected parent.

Primary's separate Phase-A diagnostic on Node 22.16 passes 16/17, actual test
and outer-runner exits 1 (`primary-phase-a-diagnostic-report.json`). The single
failure is the expected non-reconfiguring constructor case: a previously
lowered cap of 50 is reset to 1000 because the Phase-B journal condition is not
implemented yet. All other independent checks pass, including both actual
installed-package cases, cross-client live-slot/daily-limit sharing, replay,
Unicode continuation, revocation, truthful incomplete acknowledgements and the
uncooperative-provider deadline. Each installed runtime's observed 132-file
closure matches its independently derived source closure; the archive contains
144 files. Both the inner workspace and outer owned runner directory are absent.
The runner stops after this expected red, so this is not a Node-24 primary pass
or final acceptance. The entire source snapshot stays unchanged during the
diagnostic; the original failed result is retained for the Phase-B comparison.

Primary fast-forwards the paused Phase-A worktree to the exact reviewed B2b
candidate, actual exit 0. Five incoming paths are independently derived by Git
diff and old/new tree blobs/modes; none intersects the 18 local changed paths.
All 17 frozen author files plus the root plan retain identical bytes and modes,
and the index remains empty. Evidence: `primary-parent-integration.json`.
The root plan's subsequent status update records this transition separately.
Phase B may now implement only the approved journal cap condition and accurate
shared CHANGELOG/architecture/Raw/limitations documentation, then freeze all
author files for focused, full-matrix and primary acceptance. Do not expand the
adapter into setup, hooks, cursor persistence or any new permission/profile.

Primary adds one explicit B3-04 acceptance case before final verification:
after using a target's daily allowance, rotate consent through disable/re-enable,
select a different credential environment name and rename the private config.
For both clients, a fresh valid process must use the same ledger and remain
capped, with no second provider dispatch. Actual Raw registration distinguishes
the budget refusal from a stale-authority rejection. This is coverage of the
existing no-reset contract, not an additional feature or budget policy.
The separate oracle `primary-rotation.test.mjs` is frozen at SHA256
`a58fd508883d5a1a8d9cb337b850a013ac69cfd6dafa47b46ec06d80e169882a`.
Final primary roster is therefore 18 tests (17 unchanged plus this one); the
historical Phase-A diagnostic remains 16/17, not a new denominator. The final
runner records its explicit roster and expected count in each report.

## Discussion checkpoint, 2026-10-21 13:14 UTC

The user asks to interrupt for discussion. The worker pauses with no running
owned process and no full matrix launched. Its Phase-B focused run completes
and is reaped with actual outer exit 0: 32/32 on Node 22.16 and 24.15 (three
cap-construction checks, 27 local adapter checks, two installed cases), each
test exit 0 and null signal. The original Phase-A reds remain retained.
Twenty-two author paths retain identical before/after hashes, combined SHA256
`57b11a8b6be2c033ec104b5efaa706a0d5f5367f229b4fb951f4e9407d399661`;
the root plan is the 23rd local path. Owned scratch is removed. Evidence is
`author-phase-b-focused-report.json`; no B3 commit or push has occurred.

On resume, inspect this exact frozen source, run primary's 18 independent cases
and the full affected two-runtime matrix, then commit, dual-review and deliver
through latest-head CI. Parent B2b is now PR #459, draft/unmerged at `d8e114c`;
the 13:14 UTC read shows 23/31 CI checks successful, eight still running and no
failure. GitHub CI continues independently during discussion; this checkpoint
does not establish unattended agent supervision. Recheck the remote head and
results before claiming readiness. No product pin/flag or real data is changed.

The user resumes work at 14:00 UTC after the status discussion. Primary checks
that all 22 frozen author hashes still match and the prior owned workspace is
absent; both main worktrees retain their unrelated changes. Parent PR #459 now
has 31/31 successful checks on the exact reviewed head and clean mergeability;
final remote head/run/merge-tree audit precedes marking it ready, never merging.
Continue the pending B3 gates without resetting prior failures or expanding the
contract. This is the next continuous-work segment after the requested recap;
the user's 12–18-hour discussion checkpoint remains applicable.

## Resumed verification and delivery record

Primary independently executes the final 18-case roster on the frozen Phase-B
source: 18/18 on Node 22.16 and 24.15, actual test exits 0/null signal and outer
runner exit 0. The 23 changed paths are identical throughout that run, and both
owned workspace levels are absent afterwards. Evidence:
`primary-source-final-report.json` and its two runtime logs. A separate inventory
compares Git's changed/untracked paths with base-tree versus filesystem
blobs/modes: both routes identify the same 23 paths. The formerly failing
lowered-cap preservation case now passes without changing its oracle. Installed
tests still observe exactly 132 runtime closure files and 144 archive files;
the added rotation case proves the same durable allowance remains consumed
after consent, credential-name and configuration-path changes. These are local
synthetic integration checks, not semantic accuracy or a live provider result.

Parent PR #459 is ready/unmerged at `d8e114c` after primary's remote audit:
31/31 successful checks associated with that exact head, four successful
workflow runs plus the standalone CodeQL check, clean mergeability, and a
GitHub merge-ref tree identical to the reviewed head tree. Marking it ready
does not merge, publish or activate local capture for either client.

The B3 author starts the full 54-command matrix at 14:05 UTC, with all 22 author
paths and 1,786 repository source paths frozen. A transient agent-service
capacity error interrupts that agent's reporting, not its test process. Primary
immediately checks the exact process tree and increasing test log, then resumes
the same agent's supervision of session 75104. The original matrix is not
restarted or relabelled; its actual completion/exit remains a pending gate.
Primary's root-owned plan alone is excluded from the author's source freeze so
this contemporaneous record can be appended without changing tested code.

### Following client handoff (not implemented by B3)

A separate read-only seam audit confirms the next boundary is the shared v2
worker/cursor and one-shot process transport, followed by disabled Claude/Codex
entrypoint and installed-closure integration. Reuse the existing Raw selection,
parts, pending restoration and acknowledgement helpers; do not feed v2 Raw
through the hosted v1 normalization or cursor format. Keep SQLite authoritative
for registration/admission and B3 authoritative for per-model-port accounting.
The host may publish progress only after a matching complete acknowledgement
and normal child exit; incomplete or unconfirmed writes cannot advance it.

The future packet must explicitly reconcile the old LAC retry/profile contract
with B3: observed permanent interpretation-incomplete results retain a visible
blocked pending state without hook-driven retries or replacement events;
uncertain delivery may only replay the identical event under the bounded retry
policy. A content-free cursor cannot store the producer manifest's raw
sessionId; reconstruct it from freshly authorized host input. Use explicit
Node >=22.16 for the local child, a bounded outer host watchdog, the shared
target usage root without an extra per-batch charge, and the approved
source-bound-v2 profile. Operator recovery and actual host enablement remain
separate work, not claims made by this adapter. E1 overview schema 24–29
compatibility is also a separate follow-up; PR #457 supports 18/20–23 only.

The follow-on audit identifies additional concrete integration seams, not B3
features: the current Codex installed launcher deliberately strips all provider
credentials; a future local launcher must forward only an explicitly selected
credential name, never inherit NODE_OPTIONS, preload, proxy or unrelated token
variables. Missing credentials must still allow keyless replay/continuation.
The current configuration module statically imports node:sqlite, so a Node-20
host cannot import it unchanged. Also bind the host's validated configuration
snapshot to the actual child's configuration read; a before/after pathname
stat alone does not prevent an intervening configuration replacement. These
changes need their own transport contract and affected verification, not an
unreviewed alteration to this frozen B3 source.

For the later shared worker, the existing planner manifest contains raw
sessionId and cannot be written verbatim to a content-free cursor. Persist only
its explicitly allowed projection and reconstruct the full manifest from freshly
authorized host context. Preserve committed pre-record selection state until
the final part is acknowledged; nonfinal acknowledgements advance only the part.
The existing stateLock, not publishCursor's in-memory monotonicity check, is the
cross-process publication guard. Releasing it around child dispatch would need
a separate claim protocol; no such protocol is assumed here.

Two source-progress gaps require explicit tests before client enablement.
prepareRawRecord currently returns excluded records before its selected-path
source recheck and without sourceIdentity, so an exclusion result alone cannot
prove stable excluded bytes. A bounded verified commitment must accompany any
future exclusion/selection-state publication. Core conversation identity also
does not include the producer epoch: resetting ordinal to one after a source
replacement would conflict, and an unfinished earlier suffix cannot be silently
skipped. Preserve ordinal continuity for the same wire session and surface a
source-change refusal unless an existing real control barrier closes that suffix.
Neither a fabricated session ID nor an automatic control setter is recovery.

### Full-matrix stop and bounded qualification diagnosis

The original 54-command run stops at Node 22 Codex gate 25, test exit 1/null
signal and actual outer runner exit 1. Gates 1–24 pass, including core 1,731,
MCP 134, artifact 102 plus one native-Windows skip, generic 635, local 27 and
workspace lifecycle 25. The Codex suite passes 197/198; its single failure is
the existing live `/proc` ancestry fixture in
`integrations/codex/test/qualification.test.mjs:125`, whose child exits 1
instead of 0. Node 22 client/raw-producer and all Node 24 full-matrix gates are
not run. `author-matrix-report.json` retains code 1/completed 25/required 54;
the original log is never overwritten. No full-matrix pass is claimed.
All 1,786 source bytes/modes and 22 author hashes still match the pre-run
freeze; both owned workspace levels are independently confirmed absent.

Primary's minimal feedback command is the unchanged client runner on Node
22.16 with `--isolated-host --test-name-pattern='live /proc ancestry selects'
and that qualification test file, using a sanitized environment and owned
temporary root. It reproduces the identical single-case failure in under a
second, actual exit 1. Removing only --isolated-host still exits 1. Replacing
the client wrapper with the ordinary owned runner makes the case pass, actual
exit 0; this is a diagnostic contrast, NOT permission to disable the home guard
in verification. The three stated hypotheses are guard/fixture boundary,
synthetic executable startup, and real ancestry-discovery failure.

Source inspection shows the current detector intentionally continues beyond
the closest Codex process to find an outer automated-exec ancestor. The live
fixture has no explicit boundary, while the unchanged home guard refuses any
observed real Codex ancestor and latches an exit failure even if detection
catches the exception. A content-free diagnostic must confirm that exact cause
before a fix. The sole additional author path is the live fixture in
`integrations/codex/test/qualification.test.mjs`: confine real /proc observations
to the test-owned process chain through the existing injection seam. Keep real
binary identity and app-server/CLI assertions, plus existing outer-exec tests.
Do not weaken/disable the guard, change production qualification, skip the case
or increase timing limits. Root retains independent acceptance and all original
failed evidence; no broad matrix restart is authorized before diagnosis.

The author confirms the exact cause on both Node versions with a separate
fixed-code diagnostic wrapper: the real guarded readlink first observes the
owned synthetic Codex host, then throws `test_observed_real_codex_host` after
traversal crosses that owned boundary. The unchanged original test exits 1 on
both; the diagnostic supervisor exits 0 because those expected-red assertions
are met. Only finite markers are logged, never real host paths, arguments or
home data. The wrapper preserves and rethrows the guard; its diagnostic files
stay in the clearly named external evidence directory, not the repository.
Primary inspected the instrumentation and raw failure output. The isolated
fixture's scope, not B3 runtime behavior or failed native executable startup,
is the established cause.

Primary approves that single-fixture boundary repair and an accurate retained
record in docs/limitations.md. All other original author/runtime/guard paths
must remain frozen. After targeted qualification verification on both Nodes,
the continuation matrix must run exactly the three outstanding Node 22 gates
(Codex, client, Raw producer) and all 27 Node 24 gates, with fresh log/report
names and the original budgets. The original 24 successful Node 22 gates may
be retained only after independently confirming that the entire source delta
is the isolated qualification fixture plus non-runtime limitations/plan text,
and that their actual rosters do not depend on that fixture. This is affected-
gate continuation, not changing a failed result or shrinking the 54 unique
command requirement. No continuation execution before primary checks the
corrected diff, source inventory and exact runner plan.

The corrected live fixture uses the detector's existing injected readers to
permit only its owned synthetic process's exe/cmdline/stat observations. An
attempt beyond that boundary is rejected before any OS read; real binary
identity, selected process identity and an observed boundary attempt are all
asserted. Existing outer-exec/closest-host cases and the production detector/
home guard remain unchanged. Author's single-case and full 19-case qualification
checks pass on both runtimes with actual exits 0. Primary separately runs the
complete 19-case file through the unchanged guarded client runner with
--isolated-host on both Nodes: actual exits 0, no skipped or cancelled tests.
The Node-24 root session 32116 is explicitly reaped; the log tail alone was not
accepted as completion.

Primary independently compares all 1,786 source hashes/modes with both freezes.
Exactly two paths changed from the original full-matrix source:
docs/limitations.md and integrations/codex/test/qualification.test.mjs. The
corrected 23-author-path digest is
`f04a61e2ebd98ae17021b79dab6184d15d70929f1996fab092c38fd8629eb85f`;
the complete source digest is
`7c7778278c510b7e422601336a4fad756310a1ba98010bf43e2bc9a7edcde99b`.
The root plan is now the 24th changed path and remains excluded from the
author's runtime freeze. The original 24 successful gate rosters do not import
the corrected qualification fixture. Primary inspects and approves the exact
30-gate continuation script; it starts once at 14:39 UTC under owned session
14680 with active author/root supervision, fresh reports/logs, the original
per-command/whole-run deadlines and credential-free synthetic workspaces.
Final acceptance requires all 54 unique runtime/gate pairs, unchanged hashes,
actual outer exit and absence of both owned scratch roots. The original failed
Codex gate remains in the evidence, not overwritten by the corrected result.

Primary adds a separate two-case B3-06 observation, without changing any frozen
repository source or the original 18-case oracle. Through the actual CLI and
fake HTTP, a cooperative capture timeout aborts the provider, returns a normal
process exit with status 503/interpretation_incomplete, retains Raw and consumed
usage, and releases the settled reservation. A second case sends real SIGTERM
only after the provider has started: the child exits 143 with no success reply;
a fresh process recovers the dead slot but not the already consumed allowance.
Both cases pass on Node 22.16 and 24.15, actual outer exits 0, no skipped cases.
Evidence: primary-abort-source-{22.16.0,24.15.0}.log. Their separate frozen test
and preload hashes are respectively
`0374af319304082677f2990fac8f1bc984d877da8c4b25023dc00a6841d79f67` and
`dfce2a99f77d235b180b665d748a8cfcfa67ec07eab3783676f08285794f3a8e`.
These two checks supplement, rather than rename, the earlier 18/18 source
acceptance; both rosters must run again on the committed candidate.

### Final-source matrix acceptance

The approved 30-gate continuation completes with every test/command exit 0 and
null signal. Primary independently re-derives all 27 per-runtime command rosters
from the current root and prefixed package scripts, rather than trusting the
author's plan array, and checks every raw log against its actual recorded exit
and counts. The retained 24 unaffected Node-22 gates plus the 30 continuation
gates cover exactly 54 unique pairs; none is silently omitted or duplicated.
`primary-matrix-audit.mjs` exits 0 and records its results in
`primary-matrix-audit.json`. All 23 author paths and 1,786 source hashes/modes
match the corrected freeze; both inner and outer roots of the original and
continuation runs are independently absent.

| Gate, each Node 22.16 / 24.15 | Actual result |
| --- | --- |
| Core | 1,731 passed; exit 0 |
| MCP | 134 passed; exit 0 |
| Installed artifact | 102 passed, one existing native-Windows-only skip; exit 0 |
| Generic | 635 passed; exit 0 |
| Local one-shot | 27 passed; exit 0 |
| OpenAI offline | 310 passed; exit 0 |
| Codex | 198 passed; exit 0 |
| Shared-client parity | 5 passed; exit 0 |
| Raw producer | 38 passed; exit 0 |
| Workspace lifecycle | 25 passed; exit 0 |
| JSON/native plugin validation, thirteen demos, bundle/setup checks | Every command exit 0 |

The full source-only matrix is not yet independent review or latest-head CI.
Final committed source equality, primary 18-case plus two-case acceptance and
both nonauthor review axes remain necessary before pushing a delivery candidate.
This packet changes no real account configuration, user data, product pin/flag,
provider profile or semantic benchmark result.

The author explicitly reaps continuation session 14680 with actual outer exit
0; no owned process remains active. Primary's pre-commit inventory independently
compares Git diff plus untracked paths with base-tree/filesystem blobs and
modes: both routes agree on 24 scoped paths (23 author paths plus this plan),
including tests, docs, packaging manifest and CI/package configuration. The
candidate commit must contain those exact bytes, without unrelated main-worktree
changes. Fixed B3 review base remains d8e114c, not origin/main's cumulative
parent stack. Exact candidate/review/remote delivery outcomes will be recorded
in the PR to avoid changing the reviewed source merely to append its own SHA.
