# Card-plan invocation and exact wire — prospective offline contract

Primary decision 2026-10-12, to begin only after a committed CP1–CP9 candidate
exists. Worktree/branch and that exact base will be recorded before dispatch.
This is one dependency-stacked offline change, not execution of an experiment.
Closed v1 data, first judgments, score and ledger remain untouched.

Allowed seven paths:
- evaluation/architecture/card-plan-invocation.mjs (new)
- evaluation/architecture/source-bundle-plan-rank-transport.mjs (extend only
  with a second closed profile while preserving the existing v1 factory)
- evaluation/architecture/test/card-plan-invocation.test.mjs (new)
- evaluation/architecture/test/card-plan-transport.test.mjs (new)
- .github/workflows/ci.yml (extend existing required architecture command only)
- docs/plans/card-plan-live-integration.md (new; preserve this contract prefix)
- docs/limitations.md (append exact offline scope and remaining gates)

CW1 — Add createCardPlanRankInvocation(baseModel, { planRank }) returning a
frozen { model, takePlan } pair. Preserve bound base model methods. Its rank
uses the existing genuine prepareCardPlanRankRequest/compileCardPlan once on
the actual core request, invokes only planRank once, returns stable refs in
selectedCards order. No fallback, retry, extra select/rank or silent repair.
Require configured counter/context and valid descriptor-only data at the new
boundary. No configurable prompt/schema/model. Raw proposal and request become
detached immutable artifacts through the accepted pure seams, not trusted prose.

CW2 — One invocation lifecycle: unused -> planning -> returned or failed;
concurrent/repeated rank denies, including after failures/cancellation. takePlan
is unavailable before a successful returned rank, yields the actual genuine
compiled object once and never a clone, then denies repeats. A take after failed
rank denies. The compiled object's existing one-use assembly and abort checks
still apply. No onPlan/observer callback is inserted into core's final-read path.
Caller must await successful actual core recall before taking/assembling;
assembly still rejects failed recall, altered or stale evidence. Preserve
cancellation before/after planner and output counting; bound returned refs to
1024 tokens and 40000 characters. No unused-plan reuse after failures.

CW3 — Export createCardPlanRankTransport with exactly the same seven option
keys as the existing closed v1 transport. Manifest version must be exactly
card-budgeted-plan-rank-v1; structured format name cairn_card_budgeted_plan_rank_v1.
Reconstruct the actual card input from exact indexed cards, preserving all
identities/roles/receipts/order; rerun the accepted pure preparation and require
byte-identical system/input/schema/output limit and preparedRequestSha256.
No arbitrary wire-policy, system, endpoint, model, deadline or budget port.
Count and generation bodies retain the same gpt-4.1-mini-2025-04-14, endpoints,
strict schema, truncation disabled, no store/stream, and 1024 output. All actual
serialized request bodies remain <=6000 local tokens. Parse with existing
duplicate-key-rejecting JSON/envelope and compile through the new pure compiler.

CW4 — Reuse the current accounting/HTTP machinery through a private closed
two-profile dispatch, not a second copied transport implementation. Existing
createSourceBundlePlanRankTransport retains its version, exact v1 request bytes,
schema names, behaviors, error class/codes and tests. Never re-run old closed
experiments to establish compatibility. Existing reservation5000µ per physical
count/generation call, checkpoint/history binding, usage parsing/overrun, abort,
deadline, unknown usage, credential echo, redirect/authentication, persistence,
no retry and one-slot close semantics stay unchanged. New profile observation
version is explicit. No operational ledger, credential, provider call or import-
time network. Only synthetic ledgers/fake fetch in this packet.

CW5 — Tests first with new inert fixtures. Actual cold SQLite source capture,
bounded-source-scan recall, new invocation, fake-HTTP new transport, genuine
compiled take/assembly and actual flat answer packing must execute together.
Assert exact literal wires and original receipts/roles/order independently,
one rank/zero select, exactly two fake physical calls and settled synthetic
ledger. Shared premises, distinct equal-text cards and no invented relation in
answer evidence remain covered. Negative controls include both old structural
budget failures, schema/instruction/card-order/index/hash drift, foreign v1
manifest, callback failure, cancellation/timeout, incomplete output, malformed
usage, duplicate keys, request mutation and repeated/concurrent invocation.
Retain exact failure boundaries; fake success is not semantic efficacy.

CW6 — Use owned workspace cleanup on success and failure. Require real local
tokenizer under CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1; no fake fallback counts
as this gate. Extend only the existing Required offline query-local bundle
controls command with both new paths and the required flag. Generic optional
dependency absence may be an explicit skip; required gate must fail. Run new
and old transport/invocation focused tests, npm test and validate on Nodes
22.16/24.15. Primary directly repeats final affected gates and both validators,
cross-checks Git vs independent tree/blob inventory (seven paths), freezes
commit, obtains separate nonauthor Standards and Spec against the same full
base, then verifies exact-head CI and mergeability. No main merge/release/deploy.

CW7 — Document that this enables only an offline-verified new planner call;
new case roster/rubric, store preparation, paired coordinator, scorer bindings,
actual prepared artifacts, blind first judgments and spend preflight are
separate gates before new quality results. No current cohort repair or rerun,
no Stage2/3/D12 promotion, no paid-run authority from test success. Cumulative
400USD/protected30USD unchanged. Source retention/product defaults unchanged.

Implementation checkpoints: behavioral red and interfaces; actual-core fake-
wire integration; fixed-byte gates and inventory. Worker has no commit/push
authority; primary owns integration/acceptance/delivery. Do not read closed
model outputs, judge answers or official holdout sources for test fixtures.

## Dispatch binding

Initial fixed base30f297c204249e3940383b40a7e58261abfccdef,
worktree /home/chichieh/Github/cairn-memory-worktrees/card-plan-wire,
branch experiment/card-plan-wire. CP independent review/CI is still pending:
offline dependent development may proceed, but no live invocation or promotion.
If CP review changes its candidate, primary rebases this dependent branch and
reruns affected acceptance against the recorded final full base before delivery.

Primary consulted the official OpenAI Structured Outputs and GPT-4.1 Mini pages
on2026-10-12. The documented subset supports bounded arrays/integers and this
snapshot supports Structured Outputs. Refusals/incomplete responses can still
fail; schema adherence is not source support or semantic correctness. Preserve
the frozen model instead of substituting a new one. Documentation sources:
https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
https://developers.openai.com/api/docs/models/gpt-4.1-mini

## Implementation and acceptance record

CW1/CW2: `createCardPlanRankInvocation(baseModel, { planRank })` returns a
frozen `{ model, takePlan }`. Base methods stay bound; only rank is replaced.
One prepare and one genuine compile occur around exactly one planner call.
Repeated/concurrent rank returns `card_invocation_conflict`; unavailable or
repeated take returns `invalid_card_plan`. The plan is the genuine one-use
compiler capability. No observer callback is inserted into core final reads.

The caller must await actual core recall and check `recall.ok === true` before
taking and assembling. Rank completion alone cannot establish core recall
success. The new invocation integration explicitly changes a revision at core's
post-rank count boundary: recall fails `revision_conflict`; an incorrectly taken
plan cannot pass the accepted assembler. Correction after successful recall also
fails authoritative provenance, consuming the plan. Failed planning denies take.

CW3/CW4: the existing module exports `createCardPlanRankTransport` with the
same exact seven options and existing `SourceBundleTransportError`. Two private,
closed profiles supply only version, structured format, preparation and compiler.
All HTTP/accounting machinery is shared. Card input reconstruction preserves
indexed whole cards, receipts, roles and order; it reruns pure preparation and
compares complete bytes plus manifest hash. The new card request/proposal
boundaries reject descriptor/accessor/proxy drift without invoking hooks. Explicit
operator configuration remains an existing accounting trust boundary; the legacy
source profile helpers are unchanged. The card profile additionally rejects
configuration proxies before reflection. The existing source-bundle profile
retains its model, schema format and wire bytes.

CW5/CW6: fixtures are new inert synthetic data. The actual cold SQLite capture,
bounded source scan, new invocation, fake HTTP transport, authoritative reread
and accepted flat packer execute together. Full `indexedWindows` form an
independent exact receipt oracle, including the session-date wrapper. Two equal
whole source texts retain separate memory identities. Shared prerequisite chains
pack each selected whole card once, including receipts not used as endpoints;
no chain/terminal metadata is introduced into factual answer evidence. Success,
assertion failure and setup/callback failures use immediately registered owned
cleanup. Required tests load real local tiktoken, never a substitute counter.

## Test-first and correction evidence

Worker requested/actual: GPT-6.1 Sol, high. Primary owns all commits, final direct
reruns, independent Standards/Spec review, exact-head CI and delivery. Author
logs are confined to `/tmp/cairn-card-wire-author.9X0RDSIR`; no historic scratch
cleanup, operational data, model outputs, holdouts or provider credentials were
used. This packet adds no client UI or public core entrypoint; callers remain
explicit evaluation-only factories. Primary owns the affected CI command and
review of the new evaluator entrypoints against the unchanged pure CP dependency.

Before implementation, the new two suites ran on Node22.16 with the required
transport flag: actual exit1, tests10/pass0/fail10/skipped0. The behavioral red
assertions required missing factories (rather than failing on module loading).
The primary directly reviewed this log, interfaces and initial diff before
allowing continued work. The full red log remains `red.log` in the owned log
folder.

The first implementation run (`new-first.log`, exit1) exposed invalid synthetic
fixture IDs: the ledger attempt was not a UUID and the case used a turn-ID prefix.
The first correction fixed the UUID and matching question/history IDs but missed
the required case prefix. The next run (`new-second.log`, exit1) exposed that
remaining prefix mismatch and a newly reached prefix assertion incorrectly
expecting the upgrade inspection witness to contain attempt rows. The next
correction used proper case/session prefixes and an independent SQLite raw-row
prefix oracle; both issues then passed. There were not two unsuccessful
correction attempts left on the same problem.

The subsequent run (`new-third.log`, exit1) reached successful assembly/packing
and exposed a test oracle comparing retained complete receipt text to a bare
literal, omitting the session-date wrapper. The corrected independent oracle
uses complete original indexed-window bytes, asserts equal text with distinct
memory IDs, and checks both exact packed records. This was a fixture assertion
error, not evidence of model quality. The primary reviewed the complete oracle
and newly added actual-core failure/drift controls before allowing final gates.

The integrated checkpoint (`integrated.log`) ran both new suites with
`CAIRN_CARD_PLAN_TRANSPORT_REQUIRED=1` on Node22.16: actual exit0,
tests11/pass11/fail0/skipped0. Two fake physical requests and settled synthetic
ledger rows were asserted. No model or provider request occurred.

The first final matrix ran six gates concurrently. Both focused runtime logs
(`focused22.log` and `focused24.log`, exit1) exposed a new timeout-fixture phase
error: its100ms manifest deadline began before real-tokenizer preparation and
expired before the first dispatch, while the test expected a dispatched stalled
fetch. The transport correctly denied dispatch at the expired deadline. The
fixture now allows3000ms for preparation, explicitly proves the first dispatch
precedes its deadline with a nonaborted signal, and still asserts exactly one
dispatched call, unknown usage, concurrent/close denials and deadline failure. These original
failed logs remain; final matrices rerun all affected gates on the corrected
bytes. This is a test timing correction, not retry or changed transport policy.
Both initial generic processes also completed with actual exit1, solely on the
same100ms timeout-fixture assertion, and are pre-final evidence because the
fixture changed while they ran. The initial Node22 generic reported774 tests,
773 passed,1 failed,0 skipped. Final gates run focused, generic, then validator
in sequence for each runtime, with at most the two runtime sequences parallel.

## Final gates and remaining authority

Run the extended existing Required offline query-local bundle controls command
on both Node22.16.0 and24.15.0, including old invocation/transport and all new pure
and integrated controls, with all four required flags. Also run `npm test` and
`npm run validate` on both runtimes. Capture actual exit codes, test skip counts,
owned-workspace residue and seven-path Git/tree/blob inventory. Final worker
matrix results and frozen file hashes are handed directly to the primary;
primary independently repeats affected gates and both validators before freeze.
No success is inferred from stdout tails or optional skips.

CW7 remains prospective: this packet enables only the new offline-verified
planner invocation/wire. A separately frozen new roster/rubric, store preparation,
paired coordinator, scorer bindings, actual prepared artifacts, blind first
judgments and spend preflight are still required before any new quality result.
Neither source support nor semantic sufficiency follows from membership,
mechanical budgets or fake HTTP success. The evaluation model remains pinned,
400USD/protected30USD accounting remains unchanged, and source retention/product
defaults stay unchanged. No closed-cohort repair/rerun, Stage2/3/D12 promotion,
paid-run authority, main merge, release or deployment is authorized here.

