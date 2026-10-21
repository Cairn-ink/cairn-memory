# Claude recall hook: complete inside the host window

Status: authorized isolated diagnosis and bounded repair; not delivered.
Fixed base: `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/recall-hook-deadline`.
Branch: `fix/recall-hook-deadline`.
Source report: product coordination issue
[wiki #453 comment6309026333](https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6309026333).

This is an independent repair to the existing installed Claude recall path,
not part of the dependent internal Raw source packet. Preserve the user's
working tree, real client configuration, tokens and conversation files. Use
synthetic temporary state and fake HTTP only. No deployment, publication,
merge, live calls or product-pin change. Do not investigate the report's
separate authentication observation by inspecting user credentials.

## Outcome and observable acceptance

Keep the configured outer host timeout at3seconds. Give the recall invocation
one application budget of2,500ms, beginning before asynchronous input/setup
work rather than at the first fetch. Startup/scheduling overhead is not claimed
to be preemptible. Controlled process tests must prove actual exit before the
unchanged3,000ms host kill, not merely that stdout appeared before it.

| ID | Required observation |
| --- | --- |
| RH-01 | Immediate valid recall still emits the same validated untrusted-context envelope once and exits0. Missing input/token, no memories and invalid responses remain silent fail-open. Capture/start/control/status contracts are unchanged. |
| RH-02 | The actual child hook with450ms real synthetic quota-lock contention,1,800ms fake recall and slow telemetry delivers context before the unchanged3s host kill. No synchronous per-prompt telemetry remains after output. Do not add a detached worker or text/telemetry queue. Omitting the optional recall-success event is preferable to losing context; document that limitation. |
| RH-03 | Slow recall and pre-dispatch contention consume the same remaining application deadline. Expiry cancels outstanding work and exits0 with empty stdout; no late context, new request after expiry, partial JSON, leaked lock ownership or successful progress claim. Cover stalled stdin as an entrypoint too. |
| RH-04 | The recognized old-schema fallback shares the remaining invocation and existing HTTP budgets, never starts a fresh full allowance. Unrecognized400 responses still do not downgrade. Quota/pause/auth observation and authority rechecks are preserved. |
| RH-05 | A pause/control change during recall still suppresses injection. Exhausting a lock budget never steals or deletes a live foreign lock. New optional deadline plumbing does not alter callers that omit it; all generated source mirrors remain reproducible. |
| RH-06 | Independent process evidence records time to stdout, actual termination time/code/signal and host-kill state, including success/failure and cleanup. Logs use only synthetic content and finite event names; no query, token, real memory or arbitrary service-error text. |
| RH-07 | Both runtimes' affected plugin/client/pairing/golden/setup/artifact checks, primary rerun, mechanical two-route file inventory, frozen candidate and separate non-author Standards/Spec review precede PR delivery. Monitor all latest-head CI and mergeability. No claim of native-host verification from the simulated3s host boundary. |

One bounded worker (actual GPT6.1Sol/high) owns implementation/tests after the
diagnostic checkpoint. Primary owns this plan, integration decisions and
independent acceptance. Exact runtime/helper/generation ownership is pinned
after the worker's read-only seam map, before implementation. Do not refactor
unrelated capture, lexical retrieval, core algorithms or server deadlines.

## Reproduction before repair

The worker's owned-runner test
`/tmp/cairn-recall-timeout-evidence.b2AryH/recall-host-window.test.mjs`
uses the actual unchanged hook, a real synthetic quota-file lock, fake HTTP
which honors cancellation, and a3s simulated host process boundary. It verifies
plugin/shared-client source equality with the fixed main before running.

Initial Node22 run:3controls/observations passed, one exact delivery assertion
failed, actual exit1. With contention+slow recall+telemetry, valid stdout appears
at2,305.5ms but the host kills at3,001.9ms. Without the host kill, the same hook
exits0 only after3,108.7ms. Disabling telemetry exits0 at2,305.1ms; immediate
control exits0 at84.3ms. Primary independently reran the exact red with
`node tools/testing/run.mjs --test-name-pattern='red: valid recall' <suite>`:
actual exit1, stdout2,303ms, telemetry starts2,304.9ms, host kill3,002.8ms,
process ends3,005.4ms withSIGTERM and no stderr. No real HTTP or user state.

Ranked predictions announced before further probes: awaiting post-output
telemetry extends lifetime; pre-dispatch local waits can independently exhaust
the outer window; schema fallback might restart a budget (lower prior because
existing tests claim a shared HTTP deadline). Test one variable at a time and
retain counterevidence; do not assume every hypothesis is a defect. These
measurements are diagnostic evidence, not a completed fix or production SLA.

The same initial loop on Node24 also retained3controls/observations and one
delivery failure, actual exit1. Five one-variable diagnostic probes pass on
each runtime, actual exit0: immediate telemetry restores the450ms-lock scenario
to about2.31s; removing contention with stalled telemetry exits about2.68s;
increasing only the local wait to1,600ms with telemetry disabled gives valid
stdout only around3.45s naturally, or a3s host kill with no stdout. These
support separate post-result and pre-request budget defects.

The fallback hypothesis has counterevidence: the recognized400 triggers exactly
two requests, removes only session_id, reuses the exact AbortSignal, and aborts
around2,000ms after the first fetch (about2.48s total), exiting0 silently without
a host kill. Preserve that correct behavior; do not present it as another bug.
Raw logs are `recall-timing-probes22-first.log` and
`recall-timing-probes24-first.log` in the evidence directory above. All are
synthetic cancellation-aware HTTP, not native Claude or hosted-service tests.

## Bounded repair ownership, approved after diagnosis

The same GPT6.1Sol/high implementation worker owns:

- `plugins/cairn-memory/scripts/hook.mjs` and hook-owned
  `plugins/cairn-memory/lib/credential-state.mjs`;
- optional recall cancellation/remaining-budget plumbing in shared
  `integrations/client/file-lock.mjs`, `transport-hosted.mjs`,
  `control-state.mjs`, and only the project-identity/resolve path of
  `pairing.mjs` (not pairing reset, repair or migration policy);
- focused tests/fixtures under `plugins/cairn-memory/test/` and affected
  `integrations/client/test/` tests;
- corresponding generated plugin mirrors and setup runtime/manifest, using
  `integrations/client/bundle.mjs` and `packages/setup/build-runtime.mjs`, never
  hand editing generated copies;
- minimal `docs/protocol.md`, `docs/limitations.md` and an unreleased
  `CHANGELOG.md` repair note. No release/version/publication claim.

Primary alone updates this plan. No core/Raw code, outer hook timeout, endpoint,
wire schema, recall query algorithm, configuration or product code may change.
If another runtime seam is necessary, report the exact dependency before editing
it. No dependency installation through a shared node_modules symlink.

Use one recall-scoped cancellation signal from the earliest action entrypoint
before asynchronous setup/input. Preserve the existing narrower HTTP timeout
and fallback sharing; propagate remaining cancellation through lock waits and
final dispatch/output barriers. Cancel before entering a callback when already
expired, and release only this invocation's owned lock. Default callers that do
not supply a signal retain their present contract. A top-level Promise.race
without cancelling underlying work is insufficient. Do not add a blanket
forced process.exit that can discard stdout or interrupt owned-lock cleanup.

A deadline cannot hard-preempt synchronous CPU or an uncooperative kernel/filesystem
operation. Document that limitation; tests prove bounded cooperative waits and
actual child completion under specified synthetic schedules, not a universal
2.5s SLA. Pause/identity authority takes precedence over a desire to emit context.
The source and tests remain separate from the P3c frozen candidate throughout.

Primary constructed a separate five-case suite at
`/tmp/cairn-recall-deadline-primary.PvOG6d/acceptance.test.mjs` and ran it against
the unchanged plugin/shared-client source, not the worker's changing repair.
Node22 actual exit1: one foreign-lock preservation control passes; four required
new behaviors fail. Stalled stdin and1,600ms contention+1,800ms recall are killed
by the3s simulated host; immediate successful recall still dispatches telemetry;
an already-aborted optional signal does not suppress the lock callback. The last
case is a red for the newly specified cancellation API, not a claim that the
old API promised cancellation. This suite independently checks actual child
termination and owned/foreign lock state; the source report's loop is retained
separately. Syntax check exited0. No real service, transcript or credential.

## Primary pre-freeze cancellation finding

The first repair added a cancellation check after electing a dead-lock reaper.
An independent deterministic two-case probe at
`/tmp/cairn-recall-deadline-primary.PvOG6d/reaper-cancellation.test.mjs`
injected cancellation at the second owner read, after the permanent election
marker existed. Node22 actual exit1: the no-cancellation control passed, while
the cancelled invocation left the old dead lock behind its permanent marker;
the next invocation could not acquire it. Both use the same constant-dead
liveness probe and150ms acquisition window; the control completes in about13ms.
This is a new graceful-cancellation defect, separate from the original hook
timeout. Keep the red log `reaper-first22.log`.

The bounded correction must finish the already-elected token-checked recovery
critical section before honoring cancellation. It must not delete election
markers, steal a live foreign lock or unlink a successor. The worker owns the
runtime correction and tracked regression; primary reruns the independent
probe unchanged. Permanent election tombstones are existing intentional state,
not unexpected temporary residue or a new cleanup promise.

The minimal critical-section correction passed the unchanged primary two-case
reaper probe, actual exit0. The combined independent seven-case suite then
passed7/7 on Node22.16 and24.15, actual exit0 each. Stalled stdin and
1,600ms-lock+1,800ms-HTTP schedules exit normally with no output around2.531–
2.534s, before the unchanged3s simulated host; immediate valid output exits in
73/84ms and emits no recall telemetry. Foreign lock ownership remains intact.
These are pre-freeze checkpoints (`repaired-first22.log`/`repaired-first24.log`),
not substitutes for final content matching, broad gates or independent review.

## First frozen matrix and retained source-pin failure

The first Node22 broad plugin/architecture gate completed655/656 tests with
actual exit1. Its sole failure was the intentionally changed current
`transport-hosted.mjs` SHA256 in `integrations/client/test/parity.test.mjs`;
the behavioral parity, original goldens and new timed process cases passed.
Primary inspected that test and approved updating only this explicit current
transport mechanism pin/comment. The historical base, source-hash fixture,
mechanisms and hosted-output goldens remain unchanged. Keep the original red
log and re-freeze the additional tracked test; this is not evidence of a green
matrix until the affected broad gate is rerun.

The matrix stopped automatically; Node24 generic and the pinned plugin
validator had not run. Before that validator executes, route it through an
owned test harness with synthetic HOME. Retain successful
command records and compare their input hashes before reusing them; do not
rerun successful commands merely to obscure the interrupted matrix. Source
remains frozen through each corrected run. The primary independently checks
the final inventory and reruns process acceptance after worker verification.

The corrected Node22 broad gate passes656/656, actual exit0. A requested public
limitations prose cleanup landed just after its snapshot; preserve that exact
snapshot and record the sole doc hash delta rather than silently replacing it.
Primary's first strict inventory check exited1 on that known document only;
its explicit before/after-hash check then passed. All original runtime hashes
are unchanged, with22paths independently reconciled against base tree/blobs
and21worker paths checked. No runtime/test exception is permitted.

Primary reran the unchanged seven-case process/lock acceptance on the final
runtime bytes:7/7, actual exit0 on each22.16/24.15. Stalled stdin and
contention-plus-HTTP scenarios terminate normally around2.53s with no output,
not a host kill; immediate valid context exits around76–81ms with no telemetry.
These `repaired-final22.log`/`repaired-final24.log` records are local synthetic
acceptance, not a claim that the native host or released package has shipped.

Read-only preflight identified that the pinned maintainer Claude validator is
a native Linux ELF, not a Node script. The owned `--script` runner must therefore
execute a small JavaScript harness which spawns that exact binary with a fresh
synthetic home and minimal environment, not feed the ELF into Node. The harness
validates only the two named task worktrees, runs the marketplace/plugin checks,
records each actual code/signal, and cleans both owned workspaces. This is a
verification-harness correction; no pinned dependency or tracked CI change.

The first four Node22 commands (bundle, runtime manifest, JSON validation,
transport) already passed with actual exit0 on the same runtime bytes. The
corrected generic gate is656/656 and pairing270/270, actual exits0. The paused
controller was deliberately terminated with143 after its pairing child had
finished; the child's actual wait status0 is retained separately in
`repair-paused-controller.json`. Controller termination is not a full-matrix
pass. Remaining checks resume in a new controller without overwriting those
logs or rerunning successful commands.

The corrected native-validator harness and real setup pack gates now pass on
both runtimes, all four invocations actual exit0. Each validator invocation
runs both marketplace and strict-plugin commands successfully in fresh synthetic
homes. Each package contains52 files, reconciled through four independent
routes: package metadata/allowlist, npm dry-run manifest, actual pack manifest,
and tar listing. Prepack is enabled; no release/publish occurs. All owned test
workspaces are removed and no light-gate child remains active. Four remaining
Node22 gates and ten Node24 gates precede the fixed-candidate review.

### Remaining-gate stop: two Codex qualification failures

The remaining-only controller retained the earlier successful evidence and
passed Node22's original pairing golden command, actual exit0 (43.711s).
Its next command, `npm run test:codex`, failed196/198, actual exit1 (68.773s),
signal null. It stopped without editing or retrying; no Node24 command ran.
The two assertions are the live `/proc` synthetic-host ancestry child exit
(1 rather than0) and creator-version retry capture (empty rather than the one
expected synthetic message), both in unchanged `qualification.test.mjs`.
The qualification runtime, worker, helper and tests match the fixed base.
That excludes direct edits to those files, not indirect shared-client effects.

All21 worker paths still match the verified start bytes. Preserve
`repair-remaining-codex-22.16.0.log` and the actual-code JSONL. A bounded
selected-case and old/current differential diagnosis is required; a green
rerun alone cannot dismiss the failed broad gate. The separate P3c source
packet continues its own verification and is not changed to address this.

The selected two-case command reproduces the ancestry failure in0.529s on
the candidate, actual exit1; version retry passes alone. A clean P3b worktree
serves as a baseline only after175 client/Codex/test-runner paths match actual
fixed-main blobs through two inventory routes. Its same selected command also
exits1 with the same ancestry failure and a passing version retry.

Ranked predictions before probes were real-ancestor test-guard interaction,
scheduling/deadline exhaustion, and indirect changed shared-client behavior.
A tagged throwaway probe confirms the first on candidate and baseline: the
closest synthetic host and identity are correct, but continuing ancestry
inspection triggers the unchanged `test_observed_real_codex_host` guard and
sets the child exit1. Both diagnostic probes exit0 because they assert that
specific failure mechanism; they are not passing feature tests. The separate
version probe sees qualified evidence, creator checks false/true/true, worker
states creator_unqualified/idle/idle, and exactly one capture. Its default
worker deadline is60s, weakening the initial one-second-budget hypothesis.
The earlier broad version-retry failure remains unexplained at this checkpoint.

The next environment control uses only a dedicated owned tmux server/session,
unchanged tests and unchanged home guard, never a user's live pane or a global
permission bypass. Establish the actual launch ancestry, output and exit status,
then clean the owned server. No source fix is justified by an environment-only
finding; the independent second failure needs its own explanation.

The owned-server control now passes the unchanged two selected qualification
cases on candidate and baseline, 2/2 each, actual exits0. The home guard remains
enabled. All owned sessions, sockets and servers are cleaned. This resolves the
first ancestry finding as an environment dependency, not a product regression.

### Shared-lock compatibility correction

Primary inspection found a separate concrete compatibility regression: the
repair started the ordinary acquisition deadline before publishing the owner
file, whereas the original starts it after publication. A controlled independent
four-case probe delays only that synthetic owner write by150ms and retains the
same50ms acquisition window. Baseline immediate/delayed and candidate immediate
pass; candidate delayed returns false without entering the callback. The probe
exits1, 3/4 pass, with no residue. Preserve `lock-window-red22.log` in the primary
evidence directory. This establishes the changed contract, not the unobserved
scheduling history of the earlier full Codex version-retry failure.

The bounded worker correction restores the original post-publication deadline
boundary. Cancellation checks, graceful cleanup and the recall-wide budget
remain intact. The worker's tracked default250ms/delayed300ms controls reproduce
the failure (2/3, exit1), including a passing independent cancellation control,
before the fix. All old freezes and broad-gate results remain historical; a new
corrected-runtime freeze and final affected matrix are required. Primary will
rerun all eleven independent process, reaper and acquisition-window cases on
both supported runtimes. No deadline or assertion is relaxed.

The corrected worker packet passes24/24 on each Node22.16/24.15, actual exits0.
Primary's unchanged eleven-case packet also passes11/11 on each, actual exits0.
The stalled-input/contention probes exit normally around2.54–2.59s under the
unchanged3s simulated host, with no expired context or telemetry; the default
lock retains its full acquisition window after delayed owner publication.
The two-route inventory agrees on22paths/21worker paths and exactly six reviewed
deltas from the previous freeze. `repair-corrected-freeze.json` is a new retained
snapshot; the old snapshots are not rewritten. Broad affected gates and final
independent review are still required before delivery.

### Controlled exact worker-path comparison

A separate bounded diagnostic uses the actual unchanged Codex qualification,
fixture, helper and worker entrypoints. After the initial `creator_unqualified`
result and a successful qualification, it delays only the synthetic guard's
usage-lock owner publication by300ms. Fixed-main baseline and corrected runtime
each return `idle/idle` on the two retries and capture the message exactly once;
the exact pre-correction module returns `timeout/timeout` and captures nothing.
The pre-correction module was reconstructed only in an ephemeral loader and
verified byte-for-byte against its preserved frozen SHA before execution.

All three Node22 diagnostic commands exit0 because they assert that differential;
the original capture assertion would pass/fail/pass respectively. This ties the
compatibility defect to a reachable instance of the missing-capture symptom.
The old full-run scheduler sequence was not instrumented, so this is not proof
that the historical failure had that exact timing. No qualification evidence,
home guard, timeout or expected capture was bypassed. All owned fixture roots
were removed; the21 frozen worker-file hashes remain unchanged. Evidence is
`repair-worker-lock-path-{baseline,pre-correction,corrected}22.log` and the
`debug/worker-lock-*` harnesses in the evidence directory above.

Primary independently ran the same three diagnostic commands on Node24.15:
each actual exit0, reproducing the same pass/fail/pass original-assertion
differential and verified fixture cleanup. These are controlled diagnostics,
not new semantic evaluation results.

### Corrected matrix supervision boundary

The corrected frozen-source matrix completed21 logical gates with actual exit0:
all12 on Node22.16 and the first9 on Node24.15. The outer30-minute test-controller
deadline then interrupted Node24 setup at331.7seconds; its actual child status
is signalSIGTERM, not a passing test or an assertion failure. The outer controller
exits1 (`deadline_exceeded`). Its22nd result records a temporary nested runner
still present during interruption. Final teardown subsequently verifies the
owned pane/server/socket absent and removes the owned invocation workspace.
Retain that interruption and its partial setup log; do not relabel it green.

The final tail runs only setup, native-plugin validation and setup packaging on
Node24, in a new owned supervised workspace with a15-minute outer bound. This is
a harness scheduling correction, not a product deadline or assertion change.
The21 prior successful results are reusable only after their complete source
freeze matches. Primary's post-interruption inventory still agrees on22paths
and21 unchanged worker files. Full delivery requires the three remaining actual
exit0 results and final cleanup/inventory before freezing the candidate.

### Completed corrected-source matrix

The remaining-only Node24 controller exits0. Setup passes398/398 (446.69s),
native marketplace/plugin validation exits0, and actual setup packing exits0;
the pack verifier independently agrees on52 archive files. Each gate's owned
parent contains only its expected home and pane marker, with no test residue.
Final supervision verifies225 observed owned processes, none running, the
private server/socket absent, and the invocation workspace removed.

Primary read the actual result records and reconciled the21 earlier successful
gates with these3 fresh successes:24 unique runtime/gate pairs, all actual
exit0 and signal null. The interrupted setup attempt remains in its original
log/result and is not counted as success. Primary's independent two-route
inventory again agrees on22 changed paths and21 frozen worker-file hashes;
the corrected worker digest remains
`5a0c424f1d2d8fa2d0c3362f1e370676f00030130b7253d19075f3260f5e2bc9`.
Evidence is `repair-finish24-{results.jsonl,consolidated.json,cleanup.json,
final-freeze.json,supervision.log}` under the recorded evidence directory.

The scripted recall demo was additionally run personally through the owned
runner on Node22.16 and24.15; both actual exit0. It exercises unchanged core
recall orchestration, not a provider, hosted integration or semantic score.
The JavaScript repository has no TypeScript/typecheck gate. Freeze the scoped
candidate next, personally rerun the eleven key cases on both runtimes, and
obtain separate non-author Standards/Spec review before pushing a draft PR.
No merge, release, deployment, real transcript or product pin change is included.
