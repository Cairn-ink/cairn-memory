# Receipt-ID groups: provider wire, offline contract

Primary direction 2026-10-13: finish the actual receipt-ID model interface before
any fresh model experiment. This is an offline adapter packet, not new spending
authority or a claim of first-answer improvement. Implementation base is the
independently reviewed receipt-group-plan commit
129c4c539ef0315df7b534d28b55f6bccc6f3f31 (Standards and Spec both PASS).
No old CQ/BQ/official cohort may be prepared, run, resumed, retried or rescored.

Allowed five paths only:
- evaluation/architecture/source-bundle-plan-rank-transport.mjs
- evaluation/architecture/test/receipt-group-transport.test.mjs (new)
- docs/plans/receipt-group-provider-wire.md (new; exact contract prefix)
- docs/limitations.md (append only)
- .github/workflows/ci.yml (append one suite to existing required core step)

RW1. Add only one closed private profile and public named factory to the existing
transport engine: createReceiptGroupPlanRankTransport(options), version
receipt-group-plan-rank-v1, format cairn_receipt_group_plan_rank_v1. Use genuine
prepareReceiptGroupPlan and compileReceiptGroupPlan. No generic profile/prompt/
schema/compiler port, new HTTP client, ledger, endpoint, model, rate, retry,
fallback or shared-engine refactor. Existing source/card factories, public error
class, their exact request bytes, result behavior and policies stay unchanged.

RW2. Descriptor/proxy-safe exact request reconstruction accepts the actual RG
request: fixed instruction, input query/limit/cards, complete outputSchema,
maxOutputTokens1024 and native signal. Cards contain original supplied fields,
not candidateIndex. Rebuild through genuine RG preparation; require exact JSON
identity before dispatch. Bind manifest preparedRequestSha256 to ACTUAL RG
request, never derived CP assembly. Extend existing card-shaped options/request/
mutation guards to this profile without weakening their old behavior. Source
bytes, role, namespace, revision, card/receipt order and schema cannot drift;
do not execute proxy/getter/toJSON hooks. Mutation stays fatal and exhausts slot.

RW3. Preserve all shared caps/accounting/timeouts, original400USD/protected30USD,
count+generation two-slot affordability and one-shot lifecycle. Count complete
actual prepared/count/generation strings with real tiktoken before reservation;
each <=6000, provider<=7024, output<=1024 and40000chars remain. Empty candidate
wire rejects locally before physical dispatch/reservation; no sentinel or schema
rewrite. Verify actual empty core recall never invokes ranking. Receipt enums
stay exact: no shortening, clipping or ID replacement. For this fixed twice-
embedded enum, reject >500 distinct receipt IDs; if >250, reject summed ID string
length >15000. These conservative preflight checks follow the official documented
1000-total enum and per-large-enum string limits; they do not prove API acceptance.
Use existing invalid_request for unsupported structure; preserve earlier genuine
context_budget_exceeded when already over that bound. Document any unreachable
enum boundary under the stricter real input budget rather than faking coverage.
Reference: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

RW4. Preserve raw first response and its literal hash, usage settlement and
existing redaction/credential-echo behavior. Duplicate JSON keys, oversized raw
text, malformed/incomplete/refusal/model/usage/output fail visibly, never repair.
Return only detached literal RG proposal after genuine compilation. Derived CP
diagnostics are not model output and genuine CP capability is not exposed by
transport. Complete request/response/prepared/canonical-proposal hashes have
distinct independently checked meanings; canonicalization does not rewrite raw
response provenance. Every dispatched failure settles once, unknown remains
conservatively reserved, no refund/reset/retry. No real key or original ledger.

RW5. Tests first at actual new factory: minimal new request/valid group must fail
for the OLD card profile's format, not merely because export/import is missing.
Pause for primary checkpoint1 inspection. Then fake-HTTP controls independently
assert exact literal count/generation body, fixed model/options, actual IDs/order,
prepared-vs-derived identities, one generation/two requests, raw hash/proposal and
ledger prefix. Cover empty groups with nonempty cards; empty cards zero dispatch;
cross-profile/version/hash; schema/instruction/card/receipt drift; malicious
descriptors; during-flight mutation; invalid/duplicate/extra/oversize groups;
duplicate JSON keys; malformed usage/refusal/incomplete; callback persistence
failure, redaction, cancellation/deadline, single use and complete-HTTP budget
failure before reservation. Shared existing controls may provide unchanged
engine coverage, but demonstrate profile-specific integration directly.

RW6. Actual fresh owned SQLite through normal source-mapped capture, close/cold
reopen, actual bounded-source-scan recall, one NEW RG invocation and real local
tokenizer. Feed that exact request through NEW factory with fake HTTP/synthetic
ledger. Authoritative reread and unchanged flat answer packing must match an
independent raw-literal oracle for exact ID/role/text/order, including shared
contexts and terminal on already represented card. Verify no extra select/rank/
generation or organization leakage; stale/deleted/source drift/foreign query
fail and consume ownership. Use owned runner/workspaces; success and deliberate
assertion/setup failures leave no unexpected owned scratch. No direct SQL memory
insertion, old sources/gold/artifacts, external HTTP, user DB or historical cleanup.

RW7. Stop after checkpoint1 RED; then primary releases implementation. Native
sequence is separately released and serialized. Stop again at focused GREEN.
Primary inspects actual diff and personally runs new+old source/card transport,
RG integration/packing controls, generic npm test, validate, and both Claude
validators on Node22.16.0/24.15.0. Reuse installed isolated real tokenizer; no
shared install removal. Add only new suite name to existing required core CI
command with its existing CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1 flag. Missing
native/tokenizer prerequisite fails required gate. No TS gate; no UI or runtime
caller change. Do not run historical paid commands or operational scripts.

RW8. Worker owns five files only, no commit/push/merge. Record behavior/callers,
actual exits, failed observations and correction rounds in tracked plan. At
most two unsuccessful correction rounds before re-scope. Primary derives Git
inventory, independently walks filesystem/base blobs and compares count5; freezes
reviewed candidate after final gates; distinct nonauthor Standards/Spec review
same base/head. Dependent PR stays draft until latest-head CI succeeds and is
mergeable; no main merge/release/deploy. Fake HTTP demonstrates wire/accounting
plumbing only, not API acceptance, model compliance, QA gain, Stage2/3/D12,
natural MOC, resource fit or installed Hermes readiness.

Next outcome checkpoint (not implemented by this packet): a separately frozen,
reviewed fresh synthetic first-response structural feasibility experiment, using
this actual wire and retained failure denominator, within original cumulative
400USD/protected30USD and current affordability. Do not jump into another large
QA comparison before testing this changed model-facing representation. A small
structural pass is not the product score; a fresh matched first-answer comparison
and later independent benchmark/harness acceptance remain separate milestones.

## Working record: checkpoint 1 preparation

Implementation owner: actual GPT 6.1 Sol, high; primary owns acceptance, review
and delivery. Active worktree
/home/chichieh/Github/cairn-memory-worktrees/receipt-group-wire; branch
experiment/receipt-group-wire; exact clean base
129c4c539ef0315df7b534d28b55f6bccc6f3f31. Shared worktree workflow/model-routing,
CONTRIBUTING, CONTEXT and source-retention ADRs were read before acting. The
existing isolated tiktoken symlink was inspected and is not changed.

Entrypoint/caller trace before implementation:
- New createReceiptGroupPlanRankTransport will select one private closed profile
  in source-bundle-plan-rank-transport.mjs. The initial RED scaffold uses the
  new receipt-group version/name but unchanged reprepareCard/compileCardPlan;
  this deliberately cannot accept the actual receipt-only request.
- createSourceBundlePlanRankTransport and createCardPlanRankTransport remain
  unchanged. Existing source-bundle-runner and card-plan-runner import their
  respective old factories; no runtime caller/profile/scorer/case changes are
  authorized. This trace inspected source imports only, not closed artifacts.
- The complete shared transport and card-plan-transport tests were read.
  Existing source-bundle-plan-rank-transport.test.mjs and card-plan-transport.test.mjs
  own old exact-wire/accounting/mutation/lifecycle regressions. Primary will
  run them on the final integrated candidate; checkpoint 1 does not claim them.
- New receipt-group-transport.test.mjs directly exercises the named factory with
  genuine RG preparation, independent literal schema/count/generation wire
  oracle, fresh normal synthetic budget creation/upgrade, injected fake fetch
  and owned cleanup. A global-fetch sentinel rejects accidental real network.
- The existing required core CI step owns both old transport suites and uses
  CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1. Only one new suite name may be appended
  after implementation release; no CI or limitations edit is needed for RED.

Checkpoint 1 acceptance: the valid exact-ID request/proposal must succeed through
the new factory with exactly the independent literal HTTP bodies and unchanged
literal proposal. First observe the old-card reconstruction rejection, not a
missing export/import. One pinned Node 22.16.0 owned-runner invocation is
authorized with env -i, pinned PATH, NODE_DISABLE_COMPILE_CACHE=1 and
CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1. Retain its actual exit, failure boundary,
no-network observations and cleanup evidence, then stop for primary inspection.

No implementation release follows from RED. Outstanding RW2-RW6 work includes
safe RG reconstruction/compiler binding, the three existing card-shaped guard
branches, exact empty/enum checks with genuine budget precedence, profile-specific
failure/provenance controls and genuine cold-core integration. The enum boundary
must not be claimed reachable by substituting a fake tokenizer. Fake HTTP cannot
establish provider acceptance, model compliance or first-answer improvement.

## Checkpoint 1 observed RED and stop

Command: `env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/receipt-group-transport.test.mjs`.
Actual original process exit 1; 1 test, 0 passed, 1 failed, no skips. Full log:
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/receipt-group-wire-checkpoint1-red-node22.log`.
This was the only authorized native invocation in checkpoint 1.

Preconditions passed: the new factory import exists, genuine RG preparation and
compilation accept the literal IDs/proposal and yield the independent expected
card refs, actual RG hash differs from derived CP hash, and complete independent
count/generation body strings fit the real-tokenizer 6000 cap. The new manifest
version opens successfully. The behavioral assertion then fails with
`invalid_request`: the scaffold's unchanged old card reconstruction requires
CARD_PLAN_RANK_INSTRUCTION before it can inspect candidateIndex/card schema,
where the supplied request has the fixed actual RG instruction and exact-ID
schema. This is an observed incompatible request-format boundary, not a missing
export/import, invalid fixture or provider/model failure.

Retained diagnostics: physical fake HTTP 0, real network 0, ledger requestCount
1 (the original prefix only), original synthetic rows unchanged and owned
workspace cleanup confirmed after the deliberate assertion failure. The desired
exact count/generation body, returned literal proposal, raw response hash and
settlement assertions are prospective; RED does not claim they were reached.
No real key, network provider, operational ledger, old cohort, core/native
capture, install, cleanup sweep, commit or push was used.

Current delta is intentionally only three of the five allowed paths: transport
forwarding scaffold, new prospective suite and this contract-prefixed plan.
Limitations and CI remain unchanged pending implementation release. Stop here
for primary inspection of API/test adequacy; no full implementation, second
native run, broad regression gate or model experiment is authorized yet.

## Checkpoint 2 implementation ready; native hold

Primary accepted the actual scaffold, independent oracle, retained RED and
cleanup evidence, then released implementation on the same exact base and
five-path scope. The new closed profile now binds genuine RG preparation and
compilation. Descriptor-only reconstruction accepts original card fields without
candidateIndex and compares the complete actual request JSON; actual RG hash
binds the manifest. Only the three existing card-shaped options/request/mutation
guard conditions extend to the new closed profile. Shared HTTP, ledger, model,
rates, deadlines, errors and source/card profile definitions stay unchanged.

Genuine preparation precedes empty-card and conservative exact enum preflight,
preserving earlier context-budget errors. Prospective real-token enum cases report
whether the enum guard is actually reached or the stricter input budget rejects
first; no fake counter, shortened ID or guard-coverage claim substitutes for this.
The real full-HTTP budget search requires a prepared request that fits while an
independently built complete HTTP string exceeds the unchanged cap.

The new suite has 11 normal top-level tests plus one explicitly flagged child
failure test. Its literal wire oracle reconstructs schema from fixture IDs, not
production schemas. It covers exact raw/canonical/prepared/derived hash meanings,
empty group/card/core paths, cross-profile versions, source/order/schema drift,
descriptor/proxy rejection, during-flight mutation, invalid/oversize group limits,
duplicate raw JSON keys, incomplete/refusal/usage/model/credential/status failures,
record persistence, cancellation/deadline, single-use and retained reservations.
Each loop owns a single global-fetch guard at test level and restores the exact
prior binding; fixtures never stack guard restoration.

Fresh core fixtures use normal bounded source-mapped capture, close/cold reopen,
one new RG invocation, two injected HTTP responses, authoritative reread and
unchanged whole-card flat packing. The literal source/date wrapper oracle starts
from raw synthetic role/text pairs, not prepared indexedWindows. Actual opaque
receipt IDs are retained and complete actual request/proposal, derived CP, refs
and both HTTP bodies get tokenizer diagnostics. Shared contexts and terminal on
an already represented card are exercised. Actual stale/deleted, changed source
and foreign-question assembly failures consume ownership. Deliberate setup and
post-HTTP assertion child failures assert owned cleanup with no new scratch.

CI appends only the new suite to the existing required core offline command,
retaining CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1. Limitations append describes
offline scope and does not claim unrun tests passed. Syntax checks of adapter
and new suite exited 0; no native execution followed implementation release.

Proposed focused sequence after explicit primary release: serial pinned Node
22.16.0 then 24.15.0, each with env -i, its Node bin:/usr/bin:/bin PATH,
NODE_DISABLE_COMPILE_CACHE=1, CAIRN_CARD_PLAN_TOKENIZER_REQUIRED=1 and
CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1, through tools/testing/run.mjs for
evaluation/architecture/test/receipt-group-transport.test.mjs only. Expected normal
test count is 11, not an observed GREEN. Primary requested this focused scope;
old two transport suites run only as subsequently needed/authorized. Primary
owns old source/card transport, RG pair and broad gates afterward. Stop for
inspection and native release; no commit/push, provider call or old-cohort work.

## Focused native failure retained before correction

Primary inspected the complete five-path implementation and released only the
new suite, serial pinned Node 22 then 24, with both required flags and scrubbed
environment. First Node 22.16.0 attempt exited 1: 11 tests, 10 passed, 1 failed,
no skips. Retained log:
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/receipt-group-wire-focused-node22-attempt1.log`.
The sole failure was `invalid_read_set` in the empty-core fixture, before rank:
its personal namespace omitted `projectId: null`. The unchanged
core/contract.mjs contractNamespace requires own ownerId/scope/projectId fields,
and the existing source-evidence-context test uses the explicit null field.
This is a fixture precondition error, not adapter GREEN or permission to change
core. Primary received the actual observation before the one-field correction.
The correction adds only the required null namespace field; all caps, model,
core and shared-engine bodies remain unchanged.

Observed first-run budget diagnostics: actual prepared request 5840 tokens,
count HTTP 5990, generation HTTP 6005; the complete generation envelope rejects
before reservation. The 501-ID literal request measured 10628 tokens, and the
251-ID/16456-character literal request 13011 tokens. Both failed genuine input
budget preparation before enum preflight: no enum-branch coverage or provider
acceptance is claimed. Other wire/accounting/packing/failure/cleanup tests passed,
but overall exit 1 remains retained. No correction round has failed yet.

Second Node 22 attempt also exited 1: 10/11 passed, no skips, retained as
`receipt-group-wire-focused-node22-attempt2.log` in the same private directory.
The corrected namespace passed its original boundary and exposed a second
fixture precondition: `model_not_configured`. Unchanged core/recall.mjs requires
both select and rank functions before inspecting empty maps. The empty fixture's
base had no select function. Primary received this observation before the second
narrow correction: add a select trap/counter, and require zero actual select
calls along with zero rank/generation. No adapter, core, model profile or cap
changes. One correction round failed; if this empty fixture remains unresolved
after the next round, stop and rescope rather than weakening the gate.

## Focused native GREEN; documentation closure

The second fixture correction resolved the empty-core case without adapter,
core, model-profile, accounting or cap changes. Node 22.16.0 attempt 3 exited 0:
11/11 passed, no skips. Node 24.15.0 attempt 1 then exited 0: 11/11 passed, no
skips. Logs in the same private acceptance directory are
`receipt-group-wire-focused-node22-attempt3.log` and
`receipt-group-wire-focused-node24-attempt1.log`. Both use the owned runner,
env -i, pinned Node PATH, NODE_DISABLE_COMPILE_CACHE=1 and both required flags.
Only the new suite ran; no old-profile/generic/broad matrix was run by the worker.
One unsuccessful correction round is retained; the subsequent fixture-only
correction passed. Earlier exit-1 logs and checkpoint 1 RED were not rewritten.

On both runtimes, the real-token full-HTTP boundary was prepared 5840 / count
5990 / generation 6005. The generation-body overflow rejected before reservation.
For the two exact tested enum boundary shapes, genuine input-budget rejection
preceded enum guards: 501 IDs, summed length 1894, actual request 10628 tokens;
251 IDs, summed length 16456, actual request 13011 tokens. No enum-guard branch
coverage, request shortening or provider schema acceptance is claimed.

Successful fresh actual-core token measurements (opaque captured IDs vary):

| Runtime | Actual RG request | Actual groups | Derived CP request | Derived CP proposal | Refs | Count HTTP | Generation HTTP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node 22.16.0 attempt 3 | 2177 | 163 | 1754 | 92 | 115 | 2292 | 2307 |
| Node 24.15.0 attempt 1 | 2214 | 171 | 1761 | 92 | 111 | 2329 | 2344 |

These are worker focused-run measurements, not new fixed-wire hashes or a
semantic score. The literal independent wire test observed exactly two fake
HTTP calls, no real network, four records and unchanged original ledger prefix.
Cold capture/new invocation/transport/authoritative whole-card packing, shared
contexts, represented-card terminal, exact raw-response hash, empty recall zero
select/rank/generation, stale/deleted/source/query failure consumption and owned
setup/assertion failure child cleanup passed.

Documentation is now closed for final focused frozen-byte runs, to be retained
as `receipt-group-wire-final-node22.log` and
`receipt-group-wire-final-node24.log` in the same private directory. No source
edit follows those gates; final actual exits and hashes are handed to primary
without self-invalidating post-gate plan edits. Git plus independent filesystem/
base-blob inventory must match the five allowed paths: 1613 base files plus two
new files yields 1615 current files. Contract prefix remains 7645 bytes and prior
limitations prefix 177461 bytes. Primary owns full old-profile/regression gates,
fresh independent Standards/Spec reviews, commit/PR and latest-head CI delivery.
No worker commit, push, real provider, operational ledger or closed-cohort work.

## RW2 native signal review correction — prospective RED

Independent Spec found a P2 at candidate 040a9ab9185cbf213a855dc27f88911a49ec670d:
identity-only signal checks missed native prototype/own accessor mutation during
fake count/generation and dynamically accessed cleanup methods. This bounded
correction retains base 129c4c539ef0315df7b534d28b55f6bccc6f3f31 and the original
contract/history. Actual worker remains GPT 6.1 Sol/high; primary owns acceptance.

Tests were added at the actual new factory before production changes. Pinned
Node 22 owned-runner RED with env -i and both required flags exited 1, 0/2 passed,
no skips. `receipt-group-wire-signal-regression-red-node22.log` retains count
mutation dispatching generation, nonfatal invalid_model_output, and a throwing
cleanup getter masking the error and leaving active/transport_busy. Test-owned
cleanup failed; the outer owned runner completed with actual exit 1. No historical
directory cleanup was attempted. A second RED, with nonthrowing getter controls,
also exited 1, 0/2, no skips; all fifteen signal/record boundary observations are
retained in `receipt-group-wire-signal-regression-red2-node22.log` in the private
acceptance directory. Six original HTTP mutation modes reproduced the review.

The minimal correction revalidates the RG signal's native prototype, brand and
own data descriptors at mutation checks and before output compilation. RG setup
and cleanup use captured native listener operations; cleanup transitions the
slot to consumed even on cleanup failure. Source/card branches retain their
original listener operations and wire policies. Tests retain throwing-getter
controls rather than erasing the additional failed observation, and check count
versus generation dispatch, zero hooks, fatal request_mutated, exact accounting,
reuse rejection, original prefix and owned cleanup. Genuine cancellation remains
covered by the existing suite. No generic port/helper or core change is added.

Standards' nonblocking P3 standalone test-ledger duplication is intentionally
deferred by primary: preserve the original standalone RED and literal oracle
while scoping this correctness correction. No cleanup refactor is included.

The first corrected focused pair completed with actual exit 0 on both pinned
Node 22.16.0 and 24.15.0: 13/13 tests each, no skips. Logs are
`receipt-group-wire-signal-focused-node22.log` and
`receipt-group-wire-signal-focused-node24.log` in the same private directory.
All twenty accessor/prototype/nonthrowing-or-throwing cleanup getter controls at
count/generation and pre/post record boundaries observed zero hooks, fatal
request_mutated, consumed state and slot_consumed reuse. Detected count mutation
prevented generation. Existing reservations each retained one pre/post record
and exactly one settlement; post-record mutation preserved the already-written
disposition. Native cancellation and own data listener-function controls passed.
Every corrected test-owned workspace explicitly cleaned; no real network ran.

Initial corrected actual-core measurements (request/groups/derived CP request/
derived CP proposal/refs/count HTTP/generation HTTP) were Node 22:
2177/167/1748/92/109/2292/2307 and Node 24:
2131/156/1736/92/106/2246/2261. These are fresh opaque-ID diagnostics, not fixed
wire hashes or semantic observations. The stricter budget witnesses remain
5840/5990/6005; enum boundary cases still fail the earlier genuine input cap.

Documentation closes here before final frozen-byte focused runs named
`receipt-group-wire-signal-final-node22.log` and
`receipt-group-wire-signal-final-node24.log`. Final exits/hashes are handed off
privately without post-gate repository edits. Exact correction inventory is four
paths against 040a9ab, within the existing original five-path PR scope. Primary
owns the unchanged independent probe, affected full matrices, fresh dual review
and delivery. No worker commit/push or paid/model authorization is implied.
