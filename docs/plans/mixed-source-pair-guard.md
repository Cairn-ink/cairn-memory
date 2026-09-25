# Mixed Cairn/Mem0 bound request guard

Fixed base `6d67cf0c8cf67adddcc74622e9c805d632ed7769` (accepted PR #238).
Branch `feat/mixed-source-pair-guard`. This is an offline
implementation contract, not an S3 manifest, paid permission, operational
migration or proof that original reserved30 fits the remaining budget.
Primary owns architecture/acceptance; one GPT-6 Sol/high worker implements.
Independent nonauthors review Standards and Spec on the final exact diff.

## Outcome and scope

Compose accepted bound-v2 accounting, authentic parent lineage and the pure
Mem0 wire profile into one distinct scoped request guard. Preserve all old
grants, ordinary Cairn behavior and v1 readers' refusal of migrated ledgers.
No native process, provider key, actual ledger, downloaded corpus or old
experiment is used in this packet. Only fresh synthetic ledgers and fake HTTP.
Gateway containment and shared answer renderer/runner remain subsequent gates.

## Observable acceptance

- X1 Add these exports in request-guard.mjs:
  `authorizeMixedSourcePairCapability(options)`,
  `inspectMixedSourcePairParent(options)`, and
  `createMixedSourcePairExperimentRequestGuard(options)`.
  Reuse private bounded file/binding/parent/claim and transport helpers, not
  copied lineage recursion or newly exported privileged general helpers.
  Mixed construction MUST use openBoundEmbeddingExperimentBudget. Old
  constructors must not use this opener or accept new capabilities/schema2.
- X2 Authorization exact options: ledger, policy, benchmarkExtension,
  authorizationId, executionId, checkpoint, manifest, roster, limits.
  Existing valid identifier/policy/200M chained-parent rules apply. checkpoint
  exact requestCount/reservedMicroUsd/historySha256 (lowercase64hex), all three
  compared against authentic B4 transaction snapshot. Descriptor-first bounded
  detachment rejects getters without invocation, symbols, extra/nonenumerable
  fields, sparse arrays, cycles and unsupported prototypes before side effects.
  Reuse M bounds depth32/1m values/16MiB strings. Source text and keys never
  enter capability; identifiers/hashes remain sensitive local metadata.
- X3 manifest exact fields sourceProtocolSha256, contextProtocolSha256,
  answerProtocolSha256, scorerProtocolSha256, cairn, mem0. Four digest fields
  lowercase64hex. cairn exact runtimeArtifactSha256,
  adapterConfigurationSha256, qualificationInputProfile, captureSourcePolicy;
  two digests, profile adaptive-text-catalog-v1 and policy indexed-windows-v1.
  mem0 exact version, sourceTreeSha256, dependencyLockSha256,
  configurationSha256, wireProfile. Version2.2.0, three digests, wireProfile
  canonical-equal to the complete corrected mem0WireProfile(), including its
  embedding minimum reservation. A hash is identity binding, not verification
  that the later child/artifact actually matches it; gateway must prove that.
- X4 roster1–250 entries exact questionId/protocolDigest/armOrder/arms.
  questionId existing lme-case-64hex pattern, unique; protocolDigest64hex.
  arms exact ordered cairn then mem0, each name/scopeId. scopeId is lme-case-
  plus SHA256 of existing canonical serialization of
  ['cairn.lme.mixed-source-pair.scope.v1',[questionId,name]]. armOrder is each
  name once in declared order. Derive schedule: ordered generation scopes for
  all questions/arms, then scoring in same order. No supplied mutable schedule,
  old qualified-prefix/indexed-windows roster aliases, duplicate scopes or
  post-claim reordering. One capability binds this complete ordered roster.
- X5 limits exact phaseCaps/caseCaps/mem0TimeoutMs. phaseCaps generation/scoring;
  caseCaps cairn/mem0, each generation/scoring. Each leaf exact requests and
  reservedMicroUsd, positive safe integers. mem0TimeoutMs integer1..110000.
  Phase totals (safe sums) must fit remaining campaign request/money at frozen
  checkpoint; each case leaf <= corresponding phase leaf. These finite ceilings
  do NOT imply all roster entries will fit; final S3 feasibility remains separate.
  Before each physical dispatch validate route/body, scope, ledger, then check
  prospective phase+case counters and reserve synchronously before fetch.
  Phase tallies are shared across the whole roster; a case tally belongs to one
  distinct arm+phase scope, starts at0 only when that scheduled scope first
  opens and is never reset/reentered. Answer/judge consume the same applicable
  case/phase limits as their other requests. Commit tally after reserve succeeds
  and before any callback/await/HTTP; a reservation error globally halts.
  Counters consume actual reservations, including dynamic embedding costs;
  no refund of failed/unknown work, no free native fallback. Per-case ceiling
  seals that arm locally before additional HTTP; phase/campaign exhaustion
  globally halts dispatch (fixed-N runner later records remaining not-run).
- X6 Capability version cairn-mem0-source-pair-case-v1, methodProfile
  cairn-mem0-source-pair-v1. Exact record fields version, authorizationId,
  executionId, ledger, policy, benchmarkExtension, checkpoint, manifest,
  roster, limits, rosterDigest, experimentDigest, schedule, methodProfile.
  rosterDigest = pairHash('cairn.lme.mixed-source-pair.roster.v1',roster);
  experimentDigest = pairHash('cairn.lme.mixed-source-pair.experiment.v1',
  {checkpoint,manifest,roster,limits}). Complete exact record is file-bound;
  generated hashes are never caller-authoritative substitutes for equality.
  Distinct experiment-mixed-source-pair-EXECUTION.json and .claim.json paths.
  Provision binding only inside B4 authorize: M assertion on authentic state,
  checkpoint equality, claim-unused, durable private create/same-content sync
  then reread. No ledger attempts/counters changed by authorization. Partial
  claims stay consumed; no automatic cleanup/restart/resume.
- X7 Read-only inspect exact ledger/policy/benchmarkExtension/checkpoint uses
  B3 then M and full checkpoint equality; returns frozen authentic snapshot,
  creates no handle/file/claim. Constructor exact ledger/policy/
  benchmarkExtension/mixedSourcePairCapability/fetchImpl, optionally
  installedCoreDeadline (existing trusted predicate). Callback functions are
  read via own data descriptors, not invoked by detachment. Verify full bound
  capability and unused claim; B4 authorize again verifies baseline then writes
  exclusive durable claim, closes on any failure. B4 itself fences rowids,
  inode/path, caps and all expected reserve/settlement mutations. Additionally
  compare public historical attempts to pinned prefix plus own records before
  each dispatch and scope transition; no fabricated snapshot or writablev1 read.
  Re-read capability binding before dispatch. Preserve inherited safe errors.
  checkpoint.historySha256 is B4's actual rowid-aware hash, never the old
  five-field projection hash. Existing canonical() recursively sorts object
  keys and retains array order; all new hashes use that same normalized closed
  schema. Own-record public equality is an additional check, not its substitute.
- X8 Returned guard exposes cairnFetch, mem0ChatFetch, mem0EmbeddingFetch,
  answerFetch, judgeFetch, withCaseScope, caseScopeSnapshot, caseOutcomes,
  quotaSnapshot, attempts, getState, isHalted, close, policy, stages,
  mixedSourcePairCapability. hostFetch remains an explicit denial if retained.
  No unrestricted fetch or route spoofing. Exact route ownership:

| Route | Arm/phase | Ledger channel |
| --- | --- | --- |
| Cairn count | cairn/generation | cairn-count |
| Cairn generation | cairn/generation | cairn-generation |
| Mem0 chat | mem0/generation | host-completion |
| Mem0 embedding | mem0/generation | host-embedding |
| Shared answer | either/generation | host-completion |
| Shared judge | either/scoring | host-completion |

  Preserve inherited Cairn/stage schemas/model/rates/limits. Mixed Cairn selects
  explicit indexed source input plus adaptive qualification, not public old-arm
  relabeling. Add a narrow private mixed-mode validation branch: indexed
  extraction required; qualifyCandidates uses adaptive profile. Cairn count
  validates only the same extract/classify/select/rank/qualifyCandidates bodies
  admitted for mixed generation; no qualify/relate/other-method widening.
  Mem0 request/response passes W: only validated canonical body is
  forwarded; every physical request reserves before HTTP, timeout pinned X5.
  Both embedding duplicate inputs and native batch fallback count in full.
  No guard retries. Wrong route/arm/phase/model/body refused before reservation;
  such unexpected violations latch global halt, except fenced stale descendants
  of an already sealed/closed scope which cannot poison the next valid scope.
- X9 New withCaseScope takes exact {phase,caseId}, async operation(handle).
  Schedule enforced once; concurrent scopes/requests denied. handle has only
  snapshot(), revocationSignal and revoke(). Signal is guard-owned, aborts when
  scope seals/closes. Idempotent no-argument revoke() is an explicit trusted
  caller cancellation of ONLY that still-active scope: atomically seal with
  reason cancelled, abort active work, retain unknown full reservation if any.
  Calling a stale handle after closure is inert and cannot cancel the new scope.
  Cancellation is not a verified timeout or semantic failure. No caller can
  mint trusted deadline status from an error code or external AbortSignal. Old APIs'
  return values/error handling remain unchanged. New wrapper returns
  {status,reason,value}: completed/null/callbackValue, failed/fixedReason/null,
  or blocked/case_sealed/null for scoring of a sealed generation case (do NOT
  invoke its callback). Scope status alone never means semantic success.
  Closed local reasons: embedding_singleton_failed, invalid_payload, deadline,
  case_cap_exceeded, cancelled; blocked reason case_sealed; completed reasonnull.
  A definite batch5xx is intermediate fallback, not itself a failed scope.
  Global halt wins over blocked-scoring progression; halted guard never advances.
  On any exit close scope and fence ALS descendants BEFORE checking accounting.
  No pending/in-flight attempts; B4 full validation must pass before advancing.
  A callback swallowing a local error cannot turn internally sealed state into
  completed. Arbitrary callback errors are global unless the guard already
  established a local terminal state; never infer local status from error.code.
  caseOutcomes() returns {version:'mixed-source-pair-outcomes-v1',scopes:[...]};
  each consumed slot exactly {ordinal,phase,arm,status,reason}, ordinal0-based
  schedule index; status completed/failed/blocked; no case IDs. A global error
  does not fabricate consumed scope outcomes. quotaSnapshot() exact
  {version:'mixed-source-pair-quota-v1',phaseUsed,phaseCaps,scopes}; phaseUsed
  and phaseCaps generation/scoring leaves requests/reservedMicroUsd; scopes
  holds each opened scope once {ordinal,phase,arm,used,cap}, same leaf shape.
  Return frozen detached snapshots. caseScopeSnapshot() and handle.snapshot()
  exact {version:'mixed-source-pair-scope-v1',ordinal,phase,arm,status,reason},
  status also allows active, reasonnull while active; before first scope=null.
  caseOutcomes/quotaSnapshot use bounded ordinals/closed enums/counts only;
  no source/request/response/header/key/exception text. At most schedule length
  scope outcomes. Public schema/version choices must be recorded in plan.
- X10 Prospective local/global failures (old behavior unchanged):
  (a) Fully read, nonredirected Mem0 embedding HTTP5xx with inputCount>1:
  settle failed with unknown actual (full reserve retained), verify ledger and
  no pending before returning sanitized fixed generic5xx to native. Allows its
  individual fallback, each fresh validated/reserved. Failed singleton5xx
  settles failed/null then seals case; no apparent partial-ingestion success.
  (b) W-valid pinned model/usage within all bounds but invalid payload:
  settle failed with known actual, seal case and abort revocationSignal; never
  return malformed body or allow subsequent fallback/answer for that scope.
  (c) Guard-recognized transport/core deadline: settle unknown/fullreserve,
  seal case. Synthetic tests prove late callbacks cannot start new HTTP or
  be attributed to another scope. Provider cancellation itself is NOT proved.
  Explicit handle.revoke() has the same settlement/isolation obligations but
  distinct cancelled status reason; it cannot erase a preexisting global fault.
  (d) Any missing/bad usage, wrong model, usage/reservation overrun, unreadable
  or oversized response, redirect, 4xx/config error, ambiguous transport/body,
  pending/foreign history/failed settlement globally halts. Retain known cost
  whenever W has priced it, including usage-bound violation. Never fabricate0.
  (e) Per-case resource limit locally seals without another reserve/HTTP;
  phase/campaign exhaustion globally stops. Durable failed settlement always
  overrides a local classification. Returned payloads/errors are source-safe.
- X11 No containment claim: this packet's scope callback operates fake HTTP
  in-process. Future native gateway MUST bind each socket request to an immutable
  scope identity, observe revocationSignal, block queued/late requests, and
  terminate/reap child BEFORE allowing scope callback to resolve. A guard
  quiescence check is not a child-exit acknowledgment. Native paid execution is
  blocked until that separate verified integration exists; do not add a public
  arbitrary 'reaped:true' or opaque string that bypasses it.
- X12 Synthetic tests use a fresh REAL nonempty50→100→200→explicitv2 chain.
  Cover exact capability/manifest/roster hashes/checkpoint; all six routes/four
  channels; cumulative no-refund/dynamic costs; durable binding/replay/partial
  claim; wrong descriptors/getters0; all old v1 factory refusals. Tamper rowid,
  prefix/suffix/caps/fileidentity/config/roster/digests:0newHTTP. Batch500 then
  two valid individuals gives3 reservations, capchecked before each; invalid
  singleton cannot complete. Knownpricedinvalidpayload retainsactual,seals,
  blocks caught-error fallback/answer, nextarm succeeds, sealedscoring skips.
  Unknown/malformedusage/ambiguousfailure/globalhalt preventsnextarm. Case
  quota local vs phase quota global, no reservation on predispatch denial.
  Recognized deadline, spoofed deadline/error.code, late callbacks, callback
  swallow/throw, concurrent request/scope, settlement fault/pending and close
  all have explicit assertions. Source-safe diagnostics and bounded outputs.
- X13 Append focused test to existing requestguard script; preserve all old
  tests. Both Node22.16/24.15 full budget/guard/liveoffline/generic/JSON/pinned
  strict plugin and marketplace/budget+guarddemos. Add targeted existing phase
  quota tests if integration touches their callsites; they need not change.
  Primary inspects actualdiff and independently runs key integration on frozen
  SHA. Separate nonauthor Standards/Spec; fix/reverify/review final exactbase;
  scoped PR againstmain, currentCI allgreen/mergeable beforeREADY. No merge.

## Allowed files and stop conditions

request-guard.mjs, new focused mixed-source-pair-guard.test.mjs, this tracked
plan, narrow docs/experiment-request-guard.md and docs/limitations.md,
docs/protocol.md only for new private metadata boundary, rootpackage script
append. Existing ledger/W/core/adapter/runner/CI/dependencies unchanged.
During verification, primary approved one additional synthetic child-harness
file, `evaluation/experiment-budget/testing/bound-embedding-ledger-child.mjs`,
solely to keep its old-v1 factory-denial probe tokenizer-independent after
the new guard's eager W import. No legacy factory, ledger, or W behavior changed.
If private helper reuse needs an unexpectedly broad refactor, report before
editing beyond this boundary. No new grand framework, vector service, budget
increase, operator migration, nativechild/key access or evaluation-score claim.

Next gates: contained key-owning UDS gateway with pinned native fakewire;
common source/context/scorer/runner; freeze and source-free feasibility of
originalreserved30 and remainingUS$200 cumulative budget; one paired S3 run.

## Preimplementation feasibility record

Primary read current B4/M/W and private guard scope/transport paths. Author's
read-only audit raised five contract questions (mixed Cairn validation, closed
outcomes, quota debit semantics, authentic rowid hash, revocation); primary
resolved each above before implementation. Independent nonauthor GPT-6 Sol/high
feasibility review found no remaining blocking contradiction. This is design
review only, not code acceptance. Dependencies are ready/unmerged; no paid call.

## Implementation and author verification record

GPT-6 Sol/high authored this isolated candidate. The mixed exports use the
existing private canonicalization, bounded detachment, binding, M lineage,
claim, request snapshot, and transport primitives, plus B4's authentic bound-v2
opener. The new case engine and Cairn validation branch are mixed-only. A
capability contains pinned metadata and a rowid-aware B4 history hash, not
source text, a child identity proof, or a semantic success assertion. The
runtime exposes only the X9 closed snapshots and the six X8 routes; native
containment and paid execution remain explicitly out of scope. The affected
callers are the new factory/inspector/authorizer, the root explicit guard test
script, and the old B9 synthetic factory-denial child loader. Existing v1
constructors and live callers retain their prior entrypoints and ledger fence.

The focused synthetic suite creates a real nonempty 50M→100M→200M→v2 chain,
then tests binding/claim replay and tamper, all six routes/four channels,
actual adapter indexed extraction and inline/catalog qualification wires,
wrong-source/method/arm pre-dispatch denial, no-refund dynamic embedding
fallback, local seal versus phase/global halt, authentic deadline and trusted
revocation, late ALS descendants, first-cause transport/body races, and a
foreign historical rowid mutation during settlement. It uses fake HTTP and
fresh disposable ledgers only. An initial qualification test incorrectly used
the scoring Cairn slot for a generation route; separate fresh Cairn-generation
fixtures corrected that test, with no runtime change. An initial B9 budget
run passed 57/58 but its old factory-denial child could not load the eagerly
imported W module through its ESM-only `tiktoken` data-URL stub (CJS loader
ENOENT). Primary approved an exact child-loader interception for the W import
only in `old-guards-v2`: all four stubbed wire names throw if called and an
assertion proves zero calls. The unchanged thirteen old factories still deny
v2 before claim/transport; the full budget suite then passed. Controlled
first-cause red tests also exposed transport rejection/revoke ordering; the
mixed send path now latches the physical promise's first rejection, including
a synchronous throw, before a queued revoke can reclassify it. These are
retained diagnostic outcomes, not evidence of an observed provider failure.

On each of Node 22.16.0 and 24.15.0, sequential offline commands passed:
`npm run test:experiment-budget` (58/58),
`npm run test:experiment-request-guard` (284/284; focused mixed 19/19),
`npm run test:live-evidence-offline` (340 pass, 30 skip), `npm test` (112/112),
`npm run validate`, `npm run validate --prefix tools/plugin-validation`,
`npm run demo:experiment-budget`, and `npm run demo:experiment-request-guard`.
Both isolated MCP and plugin-validation dependency installs used local offline
packages; no lockfile or dependency declaration changed. Author verification
does not substitute for primary exact-head acceptance, independent Standards
and Spec reviews, or PR CI. No operational ledger, key, corpus, holdout,
native child, or provider was accessed.
