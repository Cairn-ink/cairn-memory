# Card-budgeted evidence planning — prospective offline implementation

Primary decision 2026-10-12. Initial base d7c02f3f8e6913155bebfa7de9515268b084a794,
worktree /home/chichieh/Github/cairn-memory-worktrees/source-card-plan,
branch experiment/source-card-plan. Primary integrates the separate closed-result
documentation commit before final acceptance if necessary and records exact base.
This is a separately versioned evaluator algorithm, not a UI/throwaway HTML demo,
production feature, provider transport or paid-run authorization.

Question: can selected-card and per-chain card budgets be expressed directly
in the proposed plan structure while preserving multi-receipt evidence and
keeping unverified grouping OUT of factual answer evidence? This packet tests
mechanical feasibility, not model compliance or semantic efficacy. The closed
v1 24-pair run remains15/24 ordinary vs12/24 bundle,10failed,newsevereBQ08.
Never repair/reanswer/rescore/rejudge that cohort. Do not read its model outputs,
judge payloads/raws or old/official holdout sources for implementation tests.

Allowed exactly seven paths:
- evaluation/architecture/source-bundle-rank.mjs (export existing pure rankInput
  validation for reuse only; unchanged v1 input/output/schema/prompt/behavior)
- evaluation/architecture/card-plan-rank.mjs (new)
- evaluation/architecture/card-plan-evidence.mjs (new)
- evaluation/architecture/test/card-plan-rank.test.mjs (new)
- evaluation/architecture/test/card-plan-integration.test.mjs (new)
- docs/plans/card-budgeted-evidence-plan.md (new, preserve this contract prefix)
- docs/limitations.md (append only offline capability/limitations)

CP1 — Prepare from the actual core source-evidence rank request only, reusing
the existing descriptor-safe source-candidate validation. One authorized namespace,
0–36 unique current cards,1–100 exact source receipts/card,existing<=800char
excerpts; no new source data, lookup, gold labels, inferred timestamps or summaries.
Preserve query, limit1–6, candidate identity/order, roles/receipt identity/text.
New fixed instruction separates necessary prerequisites from relevance, scope,
time, proposal/quotation and missing links. It does not claim any source is true.
Request contains source-only indexed cards, never rubric or case IDs. Count the
complete actual new request including schema<=6000 tokens;1024output/40000chars.
No silent clipping, added candidate retrieval, retry, prompt port or fallback.

CP2 — New closed output schema:
{selectedCards:[candidateIndex,...],chains:[{
 members:[selectedCardSlot,...],
 sources:[{member:chainMemberSlot,receipt:receiptIndexWithinThatCard},...],
 terminal:sourceSlotWithinThisChain
}]}
selectedCards array maxItems=input.limit<=6;chains maxItems6;members minItems1
maxItems3;sources minItems1 maxItems6;terminal0..5. Numeric indices are bounded
integers, no negative/-0, fractions, coercion or strings. Selection uniqueness,
slot existence, receipt membership, terminal range, unique member/source tuple,
every member used and every selected card represented remain compiler checks.
Empty selection requires empty chains and vice versa. No invented source index.
All six singleton chains and one-card six-receipt chain remain expressible.
Shared cards across different chains are permitted explicitly; selected cards
stay unique and whole-card evidence is delivered once. Do not silently dedup,
trim, split, repair or reorder raw plans. A chain is unverified organization,
not an asserted semantic relation or proof of missing information.

CP3 — Genuine process-local prepared/compiled ownership, frozen detached raw
proposal and source identities, request SHA and stable refs in selectedCards
order. Reject forged/cloned/accessor/proxy/sparse/inherited/toJSON hazards without
executing them. Preserve cancellation checks. Compile only genuine prepared
objects. Expose a narrow consume operation for one-use assembly, including
consumption before failed assembly. No live model wrapper/port/transport here;
future integration owns lifecycle/accounting and is NOT implied by pure tests.

CP4 — Assembly takes genuine compiled plan, successful actual core recall,
actual core, source-mapped ingestion plan, namespace and canonical question.
Match query, namespaces, refs/revisions/order and exact candidate receipts to
recall, then reuse unchanged verifiedRoleEvidence with actual core.get for full
authoritative source/role/coordinate binding. Stale/deleted/altered/foreign/query
or provenance mismatch rejects. All whole-card receipts retained, including
those not singled out by chain endpoints. Preserve existing384total/100percard
verification limits. No callback added inside core after its final read.

CP5 — New flat answer projection: one unit per unique selected card; explicit
card identity/revision prevents equal-text cards being silently deduplicated.
Only exact whole-card source receipts and submitted roles form evidence. Chains,
terminal labels, inferred conclusions or generated summaries stay in external
diagnostics, not model-facing facts/instructions. Use unchanged packMixedAnswer
and answer model/instruction/output cap; independently enforce6units/6cards,
<=6000 actual full request tokens, no omitted/duplicate units or lost receipt.
Empty plan packs empty evidence honestly. No claims absence means permission.

CP6 — Tests first, new inert/source-only synthetic fixtures, no closed-cohort
replay. Old four-card-bundle/seven-total invalid shapes must be rejected by the
NEW structural shape (not a claimed repair of v1 answers). Assert actual schema
array bounds AND compiler behavior. Positive cases: limits1–6, six singleton
chains, three disjoint two-card chains, one card with six receipts, shared
prerequisite across chains, arbitrary selected-card order, multi-receipt roles,
equal text/different identity, explicit missing-link/scope/time/proposal sources.
These are mechanical source-fidelity tests, NOT assertions that mocks know truth.
Malformed/mutation/foreign/forged/stale/deletion/cancel/oversized controls and
owned workspace success/failure cleanup. Actual core fresh SQLite capture,
bounded-source-scan recall with scripted rank invoking the NEW compiler,
authoritative reread and actual flat answer request must be exercised. An
independent literal oracle checks exact receipts/identities/order, not helper
diagnostics agreeing with themselves. Verify no chain metadata or inferred
relationship enters the packed user payload; no extra rank/select/model call.

CP7 — No core/public adapters/default/schema/dependency/package/CI/transport/
runner/scorer/closed-fixture changes. No API key/network or operational ledger.
Implementer checkpoints: interfaces/red test, actual-core integration, gates.
Run focused tests +generic npm test +validate, supported Nodes22.16/24.15 with
real installed local tokenizer. Primary directly reruns focused/generic/validate,
relevant core/LongMemEval integration paths and both Claude validators; no TS
gate exists. Retain actual exits, positive/negative evidence, exact bytes,
zero unexpected owned temp residue. Git plus independent tree/blob inventory.
Primary freezes commit, independent nonauthor Standards/Spec same full base,
all exact-head CI and mergeability; no worker commit/push and no main merge.

CP8 — Later, separately gated work must integrate a new exact structured-wire
version and freeze new cases before provider calls. Selection-format compliance
and grouped-vs-flat answer presentation are distinct hypotheses: same selected
card/receipt texts/roles/order/question/system for the latter. Do not change
answer instruction simultaneously or claim this packet diagnoses model causality.
Original400USD/protected30USD budget, Stage2/3 and D12 remain unchanged. Tests
alone never authorize launch or prove model quality, natural MOC scale, lightweight
resource fit or Hermes/product readiness. No blanket source retention expansion.

## Preimplementation gate amendment CP9

Primary inspection found the generic CI job has no optional tokenizer installed,
and the core job's required architecture list currently names only v1 tests.
Add .github/workflows/ci.yml as EIGHTH allowed path, only to extend the existing
Required offline query-local bundle controls command with the two new card-plan
test paths and CAIRN_CARD_PLAN_TOKENIZER_REQUIRED=1. No other job, permission,
matrix, dependency installation or execution policy changes. This narrow explicit
amendment supersedes CP7's no-CI-change clause only for that existing command.
The author must preserve the original preceding contract text verbatim as history.

No silent fallback tokenizer may count as the real-tokenizer integration gate.
Generic dependency-free CI may explicitly skip a separately labeled tokenizer-
dependent test when optional dependencies are absent, like v1 does; primary and
the existing required core-job gate must fail rather than skip in that case.
Pure tests may use visibly scripted counters without implying real token counts.
Final inventory is8paths and reviews include exact CI changes and actual gate.

## Implementation record

Owner: bounded author GPT-6.1 Sol/high; primary retains acceptance, commits,
independent review and delivery. Worktree/branch/base are fixed above; no author
commit or push. CP9 expands the allowed inventory to eight paths without
rewriting the original seven-path historical contract.

The new pure seam is prepareCardPlanRankRequest(request, counter), then
compileCardPlan(prepared, raw), then one-use consumeCardPlan(compiled) used by
assembleCardPlanEvidence. Source candidate validation reuses the existing pure
rankInput export; that export is the only v1 change. New schema bounds selected
cards to input.limit, chain members to three, sources to six and chains to six.
Compiler checks literal index membership, uniqueness, complete member/card
representation and empty-plan consistency without any plan repair. Shared cards
across chains are permitted; refs preserve raw selectedCards order. Prepared and
compiled objects have process-local ownership, detached frozen data, request SHA,
and cancellation checks. Proxy denial precedes descriptor reflection at new seams.

Assembly consumes before validation, matches canonical question/query/namespace
including the authorized namespace on every ingestion batch,
and exact selected recall candidates in order, then calls unchanged
verifiedRoleEvidence through the actual supplied core.get. That verifier retains
its full source/session/event/window/role binding and 384-total/100-card limits.
Each selected card becomes one flat answer unit containing format, memoryId,
revision and exact whole-card receipt IDs, submitted roles and text. Chain and
terminal declarations remain diagnostics. Identity prevents equal-text cards
being silently deduplicated. Unchanged packMixedAnswer retains its model,
instruction and 512-output cap; a separate 6000 complete-request ceiling and
exact selected-unit comparison deny clipping, omission or duplication.

### Entry points, callers and verification ownership

No public/default adapter, provider transport, live wrapper, runner, scorer or
core entrypoint changes. New tests are the only callers of the new pure/evidence
exports. Existing source-bundle callers continue through their existing v1
exports; generic architecture regression tests cover that unchanged path. The
only CI change extends the existing Required offline query-local bundle controls
command with the two new test paths and required real-tokenizer flag (CP9).

The integration fixture uses actual source-mapped preparation, cold fresh SQLite
capture and explicit bounded-source-scan/source-evidence recall. Scripted rank
invokes the new prepare/compiler once; select asserts unreachable. The independent
capture/core.get oracle first compares receipt byte/role sets against literal
indexed source windows, then compares packed card identities/receipt order against
that captured authoritative list in selectedCards order. Exact parsed field sets
exclude organization metadata while retaining any such words in source text.
Actual four-receipt cards cover multi-role whole-card retention, including
unselected endpoints; pure compilation additionally covers the one-card six-
receipt structural plan. Existing extraction accepts at most four sourceIndices
per captured item; this packet does not expand that contract.

### Red and green evidence

Tests were added before the new modules. Node22.16 focused discovery first exited1
for missing modules; that is a harness-not-implemented red, not behavioral proof.
The actual new preparation schema was then run with pre-fix selectedCards max36
and members max6: CP1/2 exited1 at actual maxItems36 versus required limit1.
After tightening those structural bounds, schema/compiler tests passed. Integration
setup failures were retained and corrected: case/session/turn prefixes and matching
project/case identity; a genuine role flip (rather than assigning its existing
role); extraction's four-source limit; and source-literal set comparison while
preserving authoritative receipt order in the separate packed-output oracle.
These are synthetic fixture corrections, not repairs or replays of v1 results.

Focused real-tokenizer Node22.16 run after these changes exited0, with10passing
checks (the earlier intermediate run had9passing checks). Owned subprocess
assertion-failure control actually constructs and recalls a fresh SQLite fixture,
exits1 intentionally and leaves an empty owned parent directory; success fixtures
also close their handles and verify their directories are absent after cleanup.
Final supported-runtime focused/generic/validate results are appended below by
the author; primary fixed-byte reruns, core/LongMemEval gates, both Claude
validators, independent dual-axis review and exact-head CI remain separate gates.

### Limits and future work

These tests establish source fidelity, structural expressibility and mechanical
failure behavior only. The caller supplies the actual core and ingestion plan;
these pure evaluator seams do not authenticate arbitrary external whole-process
inputs or replace source provenance checks. The supplied core and ingestion plan
remain a caller trust boundary, not an authenticated external-plan capability.
There is no live provider wrapper,
structured wire integration, settlement/accounting port or paid request. Generic
CI explicitly skips tokenizer-dependent integration only when optional tiktoken
is absent; required core/manual gates fail in that condition. Pure counters are
visibly scripted. No mocked planner proves semantics, model compliance, natural
MOC scale, resource fit, Hermes readiness, or model causality. CP8's future exact
wire version/frozen new cases and separate grouping-versus-flat hypothesis remain
required. Original budget/protected reserve, Stage2/3 and D12 stay unchanged.

### Author handoff gates and byte scope

The last two scoped corrections deny cancellation-signal accessors before
native cancellation reads and require the authorized namespace on every source
ingestion batch. The actual second-batch foreign-namespace control first asserts
a successful core recall, then mutates the batch and verifies rejection and
one-use consumption. No shared verifier/core changes were made. Primary approved
this final CP4 consistency correction and owns the final combined-byte broad
verification after integrating the separately reviewed results documentation.

Author commands used pinned /home/chichieh/.nvm/versions/node/v22.16.0/bin
and v24.15.0/bin. Real tiktoken1.0.22 came from the existing frozen local install;
no install or shared-dependency mutation occurred. Full command outputs remain
in the owned /tmp/cairn-card-plan-gates.w7P67ST0 directory for primary inspection.
All author gate processes completed and were reaped before handoff.

| Gate | Node22.16 | Node24.15 | Byte scope |
| --- | --- | --- | --- |
| Required-tokenizer focused two new test files | exit0;10/10;0skips | exit0;10/10;0skips | Final author code/tests, including both last corrections |
| npm run validate | exit0 | exit0 | Final author code/config |
| npm test, first matrix | exit0;763/763;0skips | exit0;763/763;0skips | Before cancellation-signal correction |
| npm test, second matrix | exit0;763/763;0skips | exit0;763/763;0skips | After signal correction, before all-batch namespace correction |

Focused command: CAIRN_CARD_PLAN_TOKENIZER_REQUIRED=1 node
tools/testing/run.mjs evaluation/architecture/test/card-plan-rank.test.mjs
evaluation/architecture/test/card-plan-integration.test.mjs. Generic commands
set CAIRN_CARD_PLAN_TOKENIZER_REQUIRED=1; the second matrix additionally set
NODE_DISABLE_COMPILE_CACHE=1 on parent npm. Last focused/validate logs have
the suffixes focused-author-final and validate-author-final respectively.
Earlier broad successes are explicitly pre-final evidence; primary will
personally rerun generic, focused, relevant core/LongMemEval paths and both
Claude validators on the frozen combined candidate. No nonexistent TS gate is
claimed. A failed orchestration JavaScript expression launched no gate process;
it was corrected before the final focused/validate commands above executed.

Git diff names plus untracked names were independently cross-checked against
a recursive filesystem inventory and the fixed base's Git tree/blob hashes:
exactly8changed paths, including the sole permitted CI command extension.
The preserved contract prefix was compared byte-for-byte to CP1–CP9 and matched.
Source/test bytes remain frozen after author handoff; primary owns commits,
integration, independent Standards/Spec review, CI and delivery. The only retained
owned temp directory is the declared gate-log evidence directory; actual success
and assertion-failure fixture/runner scratch cleanup reports zero unexpected
owned residue. No historical-directory sweep or destructive cleanup was run.

### Primary dependency integration

The final review base is the separately reviewed closed-result documentation
commit 6890bd0360bd6419cb031fec37d4772e67b753f9, stacked on the original
d7c02f3f8e6913155bebfa7de9515268b084a794 base. Primary preserved the eight
author paths in a retained named backup, fast-forwarded only this task branch,
and restored them. The single append-only docs/limitations.md conflict was
resolved by retaining the full results section followed by the new algorithm
limitation paragraph. No implementation/test/CI bytes changed in integration.
This paragraph and that conflict resolution are primary-owned bounded
integration work; the original CP1–CP9 contract prefix remains untouched.
Primary acceptance and both independent review axes use this final full base.
