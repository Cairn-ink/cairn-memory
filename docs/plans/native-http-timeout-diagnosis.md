# Bounded offline native HTTP timeout diagnosis

Fixed base: c982c77e3586c07e0ed024c3eee759e25cb22657. Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/native-http-timeout-diagnosis`,
branch `test/native-http-timeout-diagnosis`. One bounded actual GPT-6.1 Sol/high
author owns synthetic diagnosis; primary owns acceptance and delivery. No
worker commits, push, PR, merge or subworkers.

## Frozen NHT1–4 contract

NHT1: Construct seconds-scale RED-capable real nativeMem0/fakeHTTP +genuine
mixedv3guard loop for intrinsicnativeHTTPtimeout, distinct from authenticX
whole-scope deadline. Retain originalfailingcommand/result; minimise; verify
whetheralladmittedrequests settled, child/transportclosed, scopefinalization.
Do NOT assumeglobalhaltiswrong merelybecausebookallSettled; prove provenance
and distinguishlegitimateunsafeunknowns before anypolicyproposal.
NHT2: Inspect exactguard/bridge closure error usingFINITEsafeprojection only,
rank falsifiablehypotheses afterloop; retain primary’s knownactualN8finite
cause but never claimunknown originalcorecause or recreate its actualinputs.
NHT3: No runtimefix until root accepts reproducedcause/contract within existing
authorized single-question timeoutisolation. Unknown/unpriced/unsettled/failed
containment/forgedtimeout MUSTglobalhalt unchanged. No existingcohort resume,
refund/reset/actualnative/source/gold/key access, budget/timer/scorer change.
NHT4: Initial allowedwrites onlyfocusedsynthetic tests/fixtures and tracked
docs/plans/native-http-timeout-diagnosis.md plusnecessarylimitationsdiagnosis;
root may explicitlyexpand to minimum runtimefiles after verified RED/cause.
Worker no commits/push/PR/merge, root owns acceptance+two-axis+delivery. New
paidcohort requires new specificgrant, regardlessremainingcumulativebudget.

## Evidence boundary

The primary reports one closed actual run with runtime/native_http_timeout,
outer scope_execution_failed, retained scope ordinal 9 / active / null reason.
All 42 physical requests in that Mem0 arm and all 1,672 requests in the run
were priced and succeeded. This finite observation establishes the trigger,
not which local connection timed out or why scope finalization threw. No
operational input, journal, source, ledger, answer, provider key or helper is
accessible to this worker. Synthetic reproduction cannot reconstruct that run.

Allowed native roots are the pinned synthetic installation
`/tmp/cairn-mem0-preflight.vDNO3z/venv` and
`/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu`.
Only owned test workspaces may be cleaned. Runtime, guard, configuration policy
and child source remained byte-exact through diagnosis until the primary
accepted the synthetic cause and the minimum prospective scope below.

## Diagnosis record

The first attempt below did not satisfy Phase1. The authenticated interpreter
pause then achieved Phase1 and repeated the same symptom. Existing M7b authentic
native deadline regression covers
an X timeout with locally sealed scope and next Cairn arm; it does not establish
the intrinsic HTTP-timeout trigger. At this initial checkpoint no causal
hypothesis had been adopted; the later synthetic H1 acceptance is recorded below.

First attempted invocation (Node24.15, owned canonical runner):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu CAIRN_NHT_EXPECT_SUCCESS=1 node tools/testing/run.mjs --test-name-pattern='NHT intrinsic' evaluation/experiment-budget/testing/native-http-timeout.test.mjs
```

Exit1, one failed test, duration22670.753493ms. Actual finite output:
`nativeCode:null, guardCode:null, elapsedMs:21100, halted:false,
scope:{ordinal:0,phase:generation,arm:mem0,status:failed,reason:cancelled},
outcomeCount:1, admitted:4,succeeded:4,unknown:0,pending:0,priced:4,
responseTerminated:4,durableTerminal:true,childClosed:true,groupGone:true,
localRootAbsent:true,transportClosed:4`.
Assertion expected native_http_timeout, actual null. This attempted pause
targeted the captured outer bwrap group; the native interpreter kept running,
and the unchanged20s child watchdog produced authentic local cancellation.
This is not the required intrinsic-timeout reproduction or causal evidence.
The next trigger uses a test-only host pidfd helper, bounded to descendants of
the exact captured bwrap leader and authenticated pinned executable/command,
UID, group and fixture socket/child source bindings. No runtime/source edit.

The pidfd refinement reproduced the target on the same Node24 invocation:
Exit1, one failed explicit RED witness, duration9496.524411ms. Finite output:
`nativeCode:native_http_timeout,guardCode:callback_failed,elapsedMs:8085,
halted:true,scope:{ordinal:0,phase:generation,arm:mem0,status:active,reason:null},
outcomeCount:0,admitted:1,succeeded:1,unknown:0,pending:0,priced:1,
responseTerminated:1,durableTerminal:true,childClosed:true,groupGone:true,
localRootAbsent:true,transportClosed:1`.
The only failing assertion is the deliberately enabled RED witness, expected
nativeCode null versus authentic native_http_timeout. No new policy is implied.
The host pidfd helper proved the exact interpreter was already gone before its
cleanup, then exited naturally0; it did not repair kernel containment.

A repeat without the RED witness reproduced the same shape in8015ms, passed
normal control in2561ms (4 succeeded/priced/response attempts, completed scope),
but failed the X-deadline control's initial assumption that physical fetch was
already closed at authentic scope exit (transportOpen1). That is the documented
abort-ignoring fake transport behavior, not intrinsic timeout: the fixture now
awaits its owned physical promises and proves that late completion cannot
mutate already-terminal guard records. This adjustment changes test observation
only, not runtime/guard cancellation or accounting.

## Minimized loop and controls

The minimized fixture retains only the real pinned kernel/child, a genuine v3
lineage, one batch with one user character, one query character, topK1, one
admitted successful fake HTTP response and the authenticated interpreter pause.
No mixed generation, answer, scoring, result journal or extra connection is
needed. Removing the pause gives normal completed native add/get/search.
Changing only the fake provider to exceed X's100ms deadline produces authentic
failed/deadline and local continuation instead of intrinsic timeout. The exact
v3 lineage and bounded native protocol fields remain required authentication
preconditions; reducing them would test a different boundary.

Canonical three-control invocation uses the same command above without
`CAIRN_NHT_EXPECT_SUCCESS=1` and without `--test-name-pattern`.
Node24:3/3passed,15900.864416ms, zero skips/cancellations/todos; intrinsic
elapsed8098ms, normal2500ms, Xdeadline2094ms. Node22 after shrinking input:
3/3passed,16094.825459ms, intrinsic8197ms, normal2490ms, Xdeadline2058ms.
Normal observes4priced successful response attempts and one completed scope;
the Xdeadline observes1unknown full-reservation terminal attempt, failed/deadline
scope, no global halt, and the next declared Cairn scope enters exactly once.
Both control types close the native child/group/socket/store and fake transport.
The abort-ignoring fake physical response is awaited only for fixture cleanup;
its late completion leaves the already-terminal guarded accounting unchanged.
These kernel controls enter a next Cairn scope without implementing a Cairn
arm; the existing genuine mixed M7b regression remains the full-arm control.

## Ranked falsifiable hypotheses and finite probes

The author sent the ranking to the primary before reading pinned Node HTTP
internals or running the timing probe. No runtime fix was proposed or applied.

1. Node's post-response keep-alive timer replaces configured server.timeout.
   Prediction: intrinsic timeout follows the pinned keep-alive deadline, even
   though configured local15s/provider10s/child20s have not elapsed since the
   successful fake response; changing only the synthetic provider/local config
   does not change a fixed keep-alive deadline while all remain longer.
2. The configured local15s timer is the trigger and elapsed startup is misleading.
   Prediction: response-return to runtime exception is at least15s and scales
   with an independently varied permitted configuration value.
3. X provider10s or child20s watchdog triggers first.
   Prediction: a supported timer variant produces authentic failed/deadline or
   failed/cancelled scope, unlike the observed active/null intrinsic failure.
4. An incomplete response, disconnect or malformed/queued local connection
   supplies the wrapper cause.
   Prediction: finite lifecycle observations or actual guard records show an
   incomplete/failed response or another connection; a single valid settled
   response cannot retain the same timeout shape.

The original timing observation used wall-clock Date.now relative to
the fake physical return (not an invented guard settlement timestamp). Earlier
test output's `sinceLastSettlementMs:null` was unavailable because mixed guard
records have no such timestamp; it is not timing evidence. The corrected
finite field is `sinceLastPhysicalReturnMs`.

Latest minimized Node24 explicit RED:exit1, one deliberate witness failure,
duration9508.680679ms. Intrinsic elapsed8095ms, sinceLastPhysicalReturnMs6400,
configured provider10000/local15000/child20000. Other exact finite values match
the first authentic RED. This rules out a15s local timer or10/20s watchdog as
the first trigger in this synthetic fixture; it does not establish N8 timing.

Read-only inspection of the actual pinned Node executables via
`process.binding('natives')._http_server` establishes both runtimes default
keepAliveTimeout5000. Node22 has a hardcoded1000ms internal buffer; Node24 has
keepAliveTimeoutBuffer1000. After finishing a response and detaching it from
the socket, Node sets socket timeout to keepAliveTimeout+buffer (6000ms),
overwriting the configured server.timeout (15000ms here). On expiry,
socketOnTimeout emits server.timeout even if no incoming request or current
response exists. The unmodified kernel listens to every server timeout and
calls firstFault(native_http_timeout) while the scope remains active.
This establishes a post-response idle keep-alive timeout as the trigger in
this synthetic starvation fixture. The child pause is a deliberate model of
starvation; no starvation or idle socket has been proven for the closed run.

## Exact synthetic closure error

The inner exception is the existing genuine Mem0NativeRuntimeError with own
data code native_http_timeout. Kernel firstFault calls the current handle.halt(),
which latches the guard halt and aborts the owned scope without minting a local
reason. Kernel still kills/reaps, drains tracked work, closes the listener and
connections, rechecks artifact/source identities and removes its owned root.
The pidfd helper verifies its exact interpreter already exited; the test also
checks actual outer OS group absence despite the private launcher seam.

The operation rethrows the genuine inner error. Actual withCaseScope records
callbackError, fences/revokes the scope, then sees the already latched global
halt and throws existing ExperimentRequestGuardError callback_failed before
the later guardedVerify/completed-outcome append. Therefore the finite latest
snapshot remains active/null and no outcome is appended. This is why the
synthetic settled scope finalization throws. It does not establish a ledger
settlement/transaction failure, nor contradict all requests being terminal.
Global halt is the current deliberate native safety behavior; priced settlement
alone supplies no authority to weaken it.

## Primary acceptance checkpoint

CODE/helper files frozen for primary's personally owned Node24 RED and Node22
three-control reruns:

| File under evaluation/experiment-budget/testing | SHA256 |
| --- | --- |
| native-http-timeout.test.mjs | 3510b8c47e75abfb9b13c2b23d9e650c31b8d96fc11ed916781fbc2bec10ed76 |
| native-http-timeout-fixture.mjs | 474cbfce4f56555379e3d9ae2cabf07ac7704d0327421ee25ea20b5e75de1a1f |
| native-http-timeout-pidfd.py | e71ef2319377185989d50bf944ba02b99b07136076507c36d87f54953cd55d42 |

No worker commit/push/PR/merge or runtime/guard/native policy change. No new
paid grant, score, original-case replay, accounting reset or refund. The primary
must accept a prospective bounded contract before any implementation expansion.

The primary personally reran that frozen CODE epoch: Node24 explicit RED,
session74169,natural1,10271.115643ms, intrinsic elapsed8724ms and wall-clock
sincePhysical6448ms; Node22 fullthree-control session72708,natural0,3/3,
17986.293283ms, intrinsic8551/6398ms. Exact projected accounting, active/null
closure, native/guard codes and containment match the author's observations;
normal4settled/completed and Xdeadline1unknown/local next-scope once also match.
Primary confirmed all three recorded hashes, then released that CODE freeze.

## One-variable timing differential after primary RED acceptance

The subsequent fixture uses performance.now for both elapsed observations.
Only the permitted explicit synthetic HTTP configuration varies10s→20s, so
derived local timeout varies15s→25s; child20s, pause, one-character input,
v3 guard, provider payload and cleanup remain unchanged. Command:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu node tools/testing/run.mjs --test-name-pattern='NHT intrinsic' evaluation/experiment-budget/testing/native-http-timeout.test.mjs
```

Node22natural0,2/2,19167.139551ms; default/variant monotonic ages after fake
physical return6391/6406ms, intrinsic elapsed8253/8166ms. Same command with
PATH Node24natural0,2/2,19119.993415ms; ages6379/6391ms, elapsed8246/8137ms.
All four observations retain authentic native_http_timeout/callback_failed,
active/null, outcomeCount0, exactly1succeeded/priced/response request,
0unknown/pending, durableTerminaltrue, child/group/localroot/transport closed.
The observation includes kernel reap/artifact rehash after the approximately
6s idle timer; it is not an exact measurement of the timeout callback instant.
The timer differential and pinned source confirm H1 for this synthetic model,
and falsify15/25s configured local timeout and10/20s provider/child watchdog
as its first trigger. Original N8 cause remains unproven.

Updated test SHA256:
5c089e6ddd824337dd90173c05e26fd9656cf20fd597e5fbe3a43a4816f110f5.
Fixture and pidfd helper hashes remain identical to the primary freeze.
No runtime edit or new policy authority follows from these probes.

## Prospective seam comparison — no runtime authority yet

Initial author proposal was trusted per-socket completed-response idle
classification, including a conservative framing counter to refuse partial
next headers queued in the same chunk. A response-finish bytesRead baseline
alone cannot establish that invariant. The primary asked to compare the much
smaller standard HTTP alternative before selecting a contract: add
Connection: close only to validated guard response relay. Node closes that
completed-response socket, so a later native request uses a new UDS connection
without retrying the original request. Existing kernel timeout/parser/fault
branches would stay byte-exact and no custom parser or Node private API would
be introduced. Guard/configuration/child/scorer and all timeout numbers stay
unchanged.

Test-only evaluation may shim writeHead for the exact kernel-created listener
captured through the existing child-start seam, then resume its authenticated
pidfd-held interpreter after at least8s. Required evidence is real native
add/get/search, exact4request body/order/count parity with normal execution,
successful next scheduled scope and checked accounting/containment cleanup.
Raw UDS malformed/partial/pipelined controls must establish whether standard
connection closure changes existing global-fault behavior before accepting it.
No runtime edit has been authorized or performed.

## Standard HTTP close differential results

Primary authorized only a test shim of writeHead on the exact kernel listener
address captured by startChild, plus the authenticated pidfd resume protocol.
The shim restores through test mocking and explicit finally; it never changes
another server or any runtime file. No custom framing parser was implemented.

Native comparison command uses the clean pinned-root environment above and
`node tools/testing/run.mjs --test-name-pattern='NHT standard'
evaluation/experiment-budget/testing/native-http-timeout.test.mjs`.
Node24natural0,1/1,15205.671768ms: normal2443ms versus close+8sresume10505ms.
Node22natural0,1/1,15212.563472ms: normal2516ms versus close+8sresume10413ms.
Both variants perform actual native add/get/search, verify one persisted ADD
and one result, then permit the next declared Cairn scope exactly once. In each
closed-connection variant, all4admitted responses are succeeded/priced/terminal,
nativeCode and guardCode null, scope completed, guard not halted. Exact native
route/body/order/count deep equality against the unmodified normal control
passes, proving reconnect adds no request/retry here. All native child, OS group,
local listener/store, physical transport and pidfd helper closure checks pass;
the pidfd helper observes already_gone and exits naturally0.

Portable raw differential command uses clean pinned Node PATH without native
root requirements:
`node tools/testing/run.mjs --test-name-pattern='NHT raw'
evaluation/experiment-budget/test/mem0-native-gateway.test.mjs`.
It uses explicitly labeled controlled process doubles and the existing genuine
mixed guard/real UDS fixture. Node24natural0,6/6,9454.092058ms;
Node22natural0,6/6,8710.586662ms. Each control runs baseline then exact scoped
header shim; the test counts actual HTTP server request events, physical calls
and accepted guard attempts without retaining raw HTTP response text.

| Raw control | Accepted requests baseline / close | Physical requests baseline / close | Outcome baseline / close |
| --- | --- | --- | --- |
| Malformed accepted JSON | 1 / 1 | 0 / 0 | callback_failed global / same |
| Fully parsed same-chunk second request | 2 / 2 | 0 / 0 | callback_failed global / same |
| Buffered incomplete next header after valid body | 1 / 1 | 1 / 1, priced succeeded | six-second idle callback_failed global / normal completed close |

The last control never produces a second accepted or purchased request. With
Connection: close, Node closes the completed first response and discards the
unaccepted next-header bytes under normal HTTP close semantics. This is a
transport lifecycle difference, not authority to swallow an accepted invalid
or active request. Every raw control verifies terminal guard attempts and owned
kernel socket/store removal. Existing fresh/no-request, parser, active timeout,
unknown accounting and reap tests remain authoritative, not replaced here.

## Minimum proposed final contract awaiting root selection

Add standard `connection: 'close'` to the existing response.writeHead call only
after the existing guarded response has been returned and bounded. Normal Node
HTTP finish closes that request's UDS socket; the pinned SDK reconnects for the
next independent request with retries still0. Do not alter the timeout handler
or reinterpret native_http_timeout as locally safe. Existing global safety
branches and authentic X single-question isolation remain unchanged, as do
request bodies/order/counts, configuration/child digests, provider/child timers,
guard, scoring, budgets and consumed grants. Keep focused native starvation,
reconnect parity and raw malformed/pipeline regression coverage plus relevant
plan/limitations notes. Root must authorize the exact single runtime-file edit
before applying it; no runtime change has yet occurred.

## Primary-approved implementation extension NHT5–8

After personally inspecting the actual differential and both supported Nodes'
genuine parity/raw evidence, primary selected the single validated-response
header seam. Additional runtime ownership is ONLY
evaluation/experiment-budget/mem0-native-runtime.mjs: add connection:'close' to
the existing validated response.writeHead, with a brief accurate comment.
No custom parser, timeout localization, guard/configuration/pinned child/scorer,
prompt, dependency, CI, model or timer-number changes are authorized.

NHT5: Completed validated response orderly socket close; parsed malformed/full
pipeline remains global. Standard close may discard never-accepted next bytes
with zero added paid request.
NHT6: Actual pinned eight-second resume completes add/get/search with four
exact request bodies/order/count and next scheduled scope. An indefinitely
paused child may reach its genuine watchdog and locally cancel without a false
native idle global fault. Actual unknown/reap/drain/parser and other safeguards
remain unchanged.
NHT7: Exercise actual production header paths without a positive prototype
shim. Original RED against the new runtime must become GREEN. Baseline
keep-alive may be injected ONLY as a test-scoped negative control. No attribution
to the actual closed run, retry or replay.
NHT8: Register canonical portable and explicit native regressions. Run both
Nodes' full CONTRIBUTING generic/validate/locked Claude, budget/guard/native
gateway plus native LOCAL/MIXED/local-live-offline and required demos. Retain
exact commands/hashes/failures/cleanup evidence. Update narrow limitations from
planned diagnosis to fixed mechanical proof. Primary will personally inspect
and rerun final combined paths before scoped freeze, blind independent two-axis
review and CI. Worker still makes no commit, push, PR or merge.

Contract frozen before the single runtime edit. The author will use separate
baseline header-removal controls and genuine production close/resume controls;
no positive-header prototype shim remains in final acceptance tests.

## Implemented seam and synthetic observation threat boundary

The only production delta is the validated response relay's standard
connection:'close' header and two explanatory comment lines. No timeout/fault
handler or native/source/configuration hash was modified. The final test-only
shim removes this header solely on the exact captured listener, preserving the
old keep-alive behavior as a negative control; successful production paths
have no positive-header shim. The new installed tests are statically imported
by the existing canonical mem0-native-local test entrypoint, with no package
change. Portable raw controls live in the existing native-gateway suite. The
later explicit NHT9 delivery extension adds their existing suite to CI.

Threat-model update: elapsed timings and control enums/counts/booleans are only
synthetic test diagnostics, emitted after owned accounting/cleanup boundaries.
They add no journal schema, product API, operational ledger or runtime stderr
capture. Finite codes are projected from genuine typed own-data exceptions;
arbitrary messages, stacks, error properties, real IDs, source/query/provider
prose, raw response headers/bodies and credentials are excluded. Synthetic
request bodies are retained only in fixture memory for exact parity comparison,
not emitted. Raw socket fixtures contain only authored synthetic data. The
pidfd helper emits stopped/resumed/cleanup booleans/categories and authenticates
only its captured owned process ancestry/executable/UID/starttime/command;
it does not print process argv, environment or operational contents. Existing
native private stdout/stderr and transient synthetic-file retention boundaries
are unchanged. OS/host trust and hostile same-UID mutation limitations remain.

Actual closed-run source, journal, ledger, control, evaluator and provider key
remain inaccessible and were not read. The closed run's known native trigger
remains a finite observation; its original causal history and core recall cause
remain unknown. No partial score, retry, replay, refund, resume or new paid grant.

## Production-path primary reruns before the helper correction

Primary independently ran actual production NHT cases on both pinned Nodes,
without positive-header mocks, under exact clean environment:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin LC_ALL=C TZ=UTC NODE_DISABLE_COMPILE_CACHE=1 CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu CAIRN_NHT_EXPECT_SUCCESS=1 node tools/testing/run.mjs evaluation/experiment-budget/testing/native-http-timeout.test.mjs
```

Node22session75220natural0,6/6,56258.633511ms; Node24same command with its
exact PATH session68389natural0,6/6,57281.419699ms. Zero failures,
cancellations, skips or todos. Real8sresume elapsed10733/10746ms, completed
4exactrequests and next scope once, all checked resources closed. Production
indefinite pause reaches genuine10s child watchdog, failed/cancelled locally
without native idle fault; injected old keep-alive still produces authentic
native_http_timeout/callback_failed, active/null/global halt.

Primary's raw controls use the same clean environment without native roots or
RED flag and `--test-name-pattern='NHT raw'
evaluation/experiment-budget/test/mem0-native-gateway.test.mjs`.
Node22session86779natural0,6/6,9303.090928ms; Node24session76133natural0,6/6,
9460.160123ms. Accepted-vs-discarded counts and all owned-root checks match the
approved contract. The primary verified all final CODE/helper hashes unchanged
after these personally owned closed invocations and git diff --check passed.

## Closed broad author gates

Owned retained logs: /tmp/cairn-native-http-timeout-gates.xgb0efLa.
Both exact Nodes run the following15script sequence under env -i, their pinned
PATH, NODE_DISABLE_COMPILE_CACHE=1 and the two pinned native root variables:
test, validate, test:experiment-budget, demo:experiment-budget,
test:experiment-request-guard, demo:experiment-request-guard,
test:mem0-native-gateway, test:mem0-native-local, test:mixed-native-local,
test:live-evidence-offline, test:longmemeval, demo:longmemeval-ingestion,
demo:longmemeval-comparison, demo:longmemeval-public, demo:longmemeval-mixed.
Sessions23023(Node22) and63445(Node24) both closed naturally0, every one of
the15commands exited0. Their initial native-gateway and native-LOCAL executions
preceded the helper-only correction and are historical, not final-helper
acceptance. Corrected acceptance is recorded separately below. All other suites
are unaffected by that helper correction.

Each script in that exact sequence was invoked from this worktree as:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu npm run <script>
```

The second sequence changes only PATH to the exact Node24.15.0bin. Per-command
logs use `node-<version>-<script-with-colons-replaced-by-hyphens>.log` in the
owned directory above. These are synthetic/offline commands, not a paid run.

| Suite | Node22 pass / reported | Node24 pass / reported | Duration ms Node22 / Node24 |
| --- | --- | --- | --- |
| test | 581 / 581 | 581 / 581 | 272585.218767 / 276697.024361 |
| test:experiment-budget | 65 / 65 | 65 / 65 | 9076.707931 / 9621.144103 |
| test:experiment-request-guard | 313 / 313 | 313 / 313 | 34718.467720 / 33373.922446 |
| test:mem0-native-gateway, superseded helper | 51 / 51 | 51 / 51 | 50328.173214 / 49731.287219 |
| test:mem0-native-local, superseded helper | 15 / 15 | 15 / 15 | 73489.228392 / 73337.811150 |
| test:mixed-native-local | 43 / 43 | 43 / 43 | 252300.960297 / 254004.190875 |
| test:live-evidence-offline | 340 / 370, 30 not run | 340 / 370, 30 not run | 153544.151314 / 150030.996194 |
| test:longmemeval | 264 / 264 | 264 / 264 | 56530.897736 / 53906.040032 |

Every listed test suite has0failures/cancellations/todos. Only live-offline has
skips:30existing opt-in installed-host/artifact cases were NOT RUN on each Node
(8Hermes lifecycle,3installed capture-loop,16installed ordered capture-loop,
3installed rationale-pilot). This is not evidence those cases passed. No
qualification-wire change is in scope, and no unavailable artifact/operational
input was accessed to force those gates. The existing installed-rationale CI
gate still requires its actual remote-head PASS during primary delivery.

Both Nodes' `validate`, budget/guard demos and all four LongMemEval demos
(ingestion,comparison,public,mixed) exited0. The mixed demo reports
transportDispatched:false; none of these runs invokes a model/API.

Locked dependencies installed only in this worktree: OpenAI1package, MCP14,
maintainer Claude3, all npm ci --prefix <directory> --ignore-scripts and zero
reported vulnerabilities. First locked Claude validations on both Nodes failed
with fixed setup message `claude native binary not installed` because skipped
postinstall left the wrapper stub. Inspection of the exact installed
install.cjs proved it only places the already-installed locked platform binary;
running that local postinstall resolved setup with no download or repo edit.
Both canonical `npm run validate --prefix tools/plugin-validation` then exited0,
marketplace and strict plugin passed, with fresh owned CLI HOME and env -i.
Those first setup failures are retained, not counted as product failures or
hidden by retrying runtime tests. Raw successful validation logs are retained
in the owned directory above. No model/API invocation occurred. Exact successful
locked-Claude commands use the pinned Node PATH and compile-cache variable
above without native roots, with HOME set only for that subprocess to the owned
0700directory `/tmp/cairn-native-http-timeout-gates.xgb0efLa/claude-node22` or
`claude-node24`, and `npm run validate --prefix tools/plugin-validation`.

Primary additionally ran the complete existing portable native-gateway suite
on the same frozen CODE, exact clean Node/PATH/LC_ALL=C/TZ=UTC/compile-cache
environment: canonical `node tools/testing/run.mjs
evaluation/experiment-budget/test/mem0-native-gateway.test.mjs`.
Node22session7399natural0,51/51,60166.633989ms;
Node24session20180natural0,51/51,59279.938495ms. Zero fail/cancel/skip/todo.
These personally owned runs include all existing real-UDS accounting, parser,
unknown, drain, reap, fresh-idle and threat controls, not only the new raw cases.

Historical pre-correction CODE freeze personally rehashed by primary and author:

| Path under evaluation/experiment-budget | SHA256 |
| --- | --- |
| mem0-native-runtime.mjs | b9ba16e54f9092aff1218802c4957fb7690bc36fc849998c8fe8bb399b20d859 |
| test/mem0-native-gateway.test.mjs | 6b460f4842f18b6bfbda3ab8e7dbb94bba341d48025e5a8b81591cf8915806d3 |
| test/mem0-native-local.test.mjs | 736a6a2ffb5b0711b2dacfb71d2c56f2c532aa2033f15daa9a9b99b333b04931 |
| testing/native-http-timeout.test.mjs | ffbfe3d0c170eded4ffafd58c1c9a7dadfcefa491cdd1f2dff8ecf59fc11d569 |
| testing/native-http-timeout-fixture.mjs | 659118ceca2e58b824c91d2fdbc07c933a88224f86020be14445ab5bb705ac5b |
| testing/native-http-timeout-pidfd.py | efead4e476533c0f0eca456bc9efa18c08326f3f26a126b76882d71875117183 |

Unchanged base SHA256 evidence: native gateway/configuration
ee3c214947407b25cc211d2d99901670ba7103438a0fb4f722318ef1151d94d1;
request guard ec9f7ff62bfd66b1c209b0918dd9cd35ab4a26f5a90e1fbd030c587e7d5c9de3;
pinned child b650ca5eb6568673ec971a3189360196a23c65434033a6e8348aa0ea5cea1e84.
No further CODE/helper edit is planned unless a new genuine gate failure
requires an explained correction and renewed primary evidence.

## Primary pre-commit scope extension NHT9 — freeze before CI edit

Primary inspected actual CI and found the portable native-gateway suite was
manual-only in the existing21-job matrix. This explicitly supersedes the prior
no-CI-write boundary for one durable regression step; it does not silently
expand runtime scope.

NHT9: Add exactly one `npm run test:mem0-native-gateway` step after the existing
guard suite in the experiment-request-guard matrix. Keep the same jobs, Node
matrix, dependency installs, permissions and policies. Existing OpenAI locked
dependencies are already installed. Portable tests use real UDS, synthetic
miniature artifacts, controlled children and host Python3 standard library;
they need no bwrap or pinned installed Mem0 roots/key. The same ubuntu-latest
runner already verifies Python3 in the existing LongMemEval job, and the suite
already requires host Python for its synthetic output projections. Add a narrow
CONTRIBUTING note separating portable CI from mandatory explicit installed
LOCAL evidence. Both added remote-head CI steps must actually pass before
delivery; local old-hash passes do not substitute for the final52-case suite.

Additional allowed files are only .github/workflows/ci.yml and CONTRIBUTING.md.
No new job, dependency, provider call, guard/child/configuration/timer change.
Contract recorded before either file edit.

## Primary-owned pre-review test seam correction

Primary noticed the negative header shim could match null listener address
when its captured target was also null. Only the helper now requires a nonempty
string target before exact listener equality. New portable no-dispatch test
covers null/null, empty/empty, null/unrelated, mismatched and exact target;
only the exact nonempty target removes Connection. Node24focused1/1 passed.
Corrected helper SHA25667212e0828407490bdfa27953dd8e8c6e0570bbbc4efa5a1eed924186dc86e22;
portable test SHA2561c7a93741403909830de63822e50048c2414239b45cca94132210f867783cf7a.
Runtime, installed test, canonical import and pidfd hashes remain identical.

The broad pipelines had already completed old-helper gateway51/51 and installed
native15/15 before this correction. Those runs remain retained as superseded
helper-epoch evidence (not a runtime failure). Corrected full portable52 and
canonical installed-native15 were rerun on both Nodes before final handoff.

Primary personally reran corrected full portable suite with the nonempty-target
helper and new unit: Node22session13015natural0,52/52,52055.890861ms;
Node24session21496natural0,52/52,51509.653617ms, zero fail/cancel/skip/todo.
Exact command/environment matches the earlier primary full portable invocation.
Corrected helper native focused command changes only the name filter to
`--test-name-pattern='NHT standard|NHT baseline'` on the existing NHT installed
test path, same clean environment and pinned native roots. Node22session3609
natural0,2/2,25701.074537ms; Node24session62445natural0,2/2,25603.494396ms.
Actual production8sresume still completes4exactrequests with all resources
closed and next scope once; injected prior keep-alive still reproduces its
authentic global fault. All primary sessions are closed. Earlier full6-case
native passes retain their earlier helper hash; they are not relabeled final.

## Final-helper canonical author acceptance and handoff freeze

Corrected canonical installed LOCAL commands (the Node24 command changes only
the exact PATH) were:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin LC_ALL=C TZ=UTC NODE_DISABLE_COMPILE_CACHE=1 CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu npm run test:mem0-native-local
```

Node22session73837natural0,15/15,78016.717059ms;
Node24session38665natural0,15/15,77556.677399ms, zero fail/cancel/skip/todo.
Logs append `-final-helper` before `.log` to distinguish them from the earlier
pipeline executions. These final runs include all six NHT cases plus existing
installed-native tests, without a positive-header mock. Parent's personally
owned corrected full52-case portable runs and focused actual8sresume/baseline
reruns above independently cover the final helper and its new null-target unit.

All author sessions are closed. Canonical runners own workspace cleanup;
focused tests verify their captured child/group/socket/store roots gone and
physical transports closed even for the authentic negative/global-fault case.
Only this owned gate log directory and owned CLI homes are retained as evidence;
no operational input, journal or public capture was created or inspected.

Final frozen CODE hashes:

| Path under evaluation/experiment-budget | SHA256 |
| --- | --- |
| mem0-native-runtime.mjs | b9ba16e54f9092aff1218802c4957fb7690bc36fc849998c8fe8bb399b20d859 |
| test/mem0-native-gateway.test.mjs | 1c7a93741403909830de63822e50048c2414239b45cca94132210f867783cf7a |
| test/mem0-native-local.test.mjs | 736a6a2ffb5b0711b2dacfb71d2c56f2c532aa2033f15daa9a9b99b333b04931 |
| testing/native-http-timeout.test.mjs | ffbfe3d0c170eded4ffafd58c1c9a7dadfcefa491cdd1f2dff8ecf59fc11d569 |
| testing/native-http-timeout-fixture.mjs | 67212e0828407490bdfa27953dd8e8c6e0570bbbc4efa5a1eed924186dc86e22 |
| testing/native-http-timeout-pidfd.py | efead4e476533c0f0eca456bc9efa18c08326f3f26a126b76882d71875117183 |

Selected retained log SHA256 (basenames under the owned gate directory):

| Log | SHA256 |
| --- | --- |
| node-22.16.0-test.log | 362b4fdd974769a63b6818badc1a77494532ebdd03715bdaadd66dab75b0a95f |
| node-24.15.0-test.log | e43bcf5c85befcd4935a9f0206dbe0b566776e157fcf01ec036af97f8f69a6e6 |
| node-22.16.0-test-mem0-native-local-final-helper.log | f0a0b9950d17874f9729351d9ffef7d77e0e731d19fff143169fc2d0152db9ae |
| node-24.15.0-test-mem0-native-local-final-helper.log | 31cd601ad96783a4243116b27d7e01045ab763747ac974f78f8b63182a2c549d |
| node-22.16.0-test-mixed-native-local.log | c2923b6a69dbfea410550a4f8005bf7955f33e3b4bc21907a83d75e0c0f7eab9 |
| node-24.15.0-test-mixed-native-local.log | 183620e921cfc9289447d5df50220e6752b832393c2dfbe479098cee24cc85ef |
| node-22.16.0-test-live-evidence-offline.log | c4a22475fa501a5fd9a059411162a2be99459960d92f46535be21faf95c2fb37 |
| node-24.15.0-test-live-evidence-offline.log | c5803adc342aeac641f43eead333dd2d0dee630078a3af209e7649f6085de48b |
| node-22.16.0-test-longmemeval.log | aaf9216aee79a7cd9c6ec61fa5e500dd8c7edb98eed4af9186ae7ea5e859c7b2 |
| node-24.15.0-test-longmemeval.log | 57c5bc7392145560c686ec0c1389c76f09c2bf03f2649b262a09db26854d0e19 |
| node-22.16.0-claude-validate.log | c73a0658f36f4ed252395442c1fef764e426dcef5323fb1629d4f9eb590bba83 |
| node-24.15.0-claude-validate.log | c73a0658f36f4ed252395442c1fef764e426dcef5323fb1629d4f9eb590bba83 |

Primary owns final plan/spec inspection, scoped commit, independent blind
Standards/Spec reviews and remote-head CI/delivery. In particular both added
portable matrix steps must actually pass remotely. Worker has made no commit,
push, PR or merge. No paid case was rerun; no score or retrospective closed-run
causal conclusion follows from this synthetic mechanical proof.

Primary additionally checked the final synthetic pidfd helper's Python syntax:

```sh
python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("evaluation/experiment-budget/testing/native-http-timeout-pidfd.py").read_text()); print("synthetic pidfd helper Python AST: PASS (no pyc)")'
```

Primary exit0, output `synthetic pidfd helper Python AST: PASS (no pyc)`.
AST parsing creates no pyc. This evidence-only addition changes no frozen CODE,
CI or prior test result; no worker test, commit or push was performed.
