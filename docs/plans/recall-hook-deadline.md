# Claude recall hook: complete inside the host window

Historical record: authorized isolated diagnosis and bounded repair, based on
`cd6d1ad3`. All timing, hash, inventory and matrix evidence below belongs to that
historical repair based on that commit and does not establish acceptance after
the main merge. The post-merge coverage section below describes current tests.
Historical fixed base: `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.
Branch: `fix/recall-hook-deadline`.
Source report: product coordination issue
[wiki #453 comment 6309026333](https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6309026333).

This is an independent repair to the existing installed Claude recall path,
not part of the dependent internal Raw source packet. Preserve the user's
working tree, real client configuration, tokens and conversation files. Use
synthetic temporary state and fake HTTP only. No deployment, publication,
merge, live calls or product-pin change in the historical repair scope. Do not
investigate the report's separate authentication observation by inspecting user
credentials.

## Outcome and observable acceptance

Keep the configured outer host timeout at 3 seconds. Give the recall invocation
one application budget of 2,500 ms, beginning at hook-module entry after Node
startup and static imports, before asynchronous input/setup work rather than at
the first fetch. Startup/scheduling overhead is not claimed to be preemptible. Controlled process tests must prove actual exit before the
unchanged 3,000 ms host kill, not merely that stdout appeared before it.

| ID | Required observation |
| --- | --- |
| RH-01 | Immediate valid recall still emits the same validated untrusted-context envelope once and exits 0. Missing input/token, no memories and invalid responses remain silent fail-open. Capture/start/control/status contracts are unchanged. |
| RH-02 | Historical acceptance target: the actual child hook with 450 ms real synthetic quota-lock contention, 1,800 ms fake recall and slow telemetry delivers context before the unchanged 3 s host kill. No synchronous per-prompt telemetry remains after output. Do not add a detached worker or text/telemetry queue. Omitting the optional recall-success event is preferable to losing context; document that limitation. |
| RH-03 | Slow recall and pre-dispatch contention consume the same remaining application deadline. Expiry cancels outstanding work and exits 0 with empty stdout; no late context, new request after expiry, partial JSON, leaked lock ownership or successful progress claim. Cover stalled stdin as an entrypoint too. |
| RH-04 | The recognized old-schema fallback shares the remaining invocation and existing HTTP budgets, never starts a fresh full allowance. Unrecognized 400 responses still do not downgrade. Quota/pause/auth observation and authority rechecks are preserved. |
| RH-05 | A pause/control change during recall still suppresses injection. Exhausting a lock budget never steals or deletes a live foreign lock. New optional deadline plumbing does not alter callers that omit it; all generated source mirrors remain reproducible. |
| RH-06 | Historical acceptance target: independent process evidence records time to stdout, actual termination time/code/signal and host-kill state, including success/failure and cleanup. Logs use only synthetic content and finite event names; no query, token, real memory or arbitrary service-error text. |
| RH-07 | Both runtimes' affected plugin/client/pairing/golden/setup/artifact checks, primary rerun, mechanical two-route file inventory, frozen candidate and separate non-author Standards/Spec review precede PR delivery. Monitor all latest-head CI and mergeability. No claim of native-host verification from the simulated 3 s host boundary. |

One bounded worker (actual GPT6.1Sol/high) owns implementation/tests after the
diagnostic checkpoint. Primary owns this plan, integration decisions and
independent acceptance. Exact runtime/helper/generation ownership is pinned
after the worker's read-only seam map, before implementation. Do not refactor
unrelated capture, lexical retrieval, core algorithms or server deadlines.

## Reproduction before repair

The worker's owned-runner test
`recall-host-window.test.mjs` (historical reproduction evidence)
uses the actual unchanged hook, a real synthetic quota-file lock, fake HTTP
which honors cancellation, and a 3 s simulated host process boundary. It verifies
plugin/shared-client source equality with the fixed main before running.

Initial Node 22 run: 3 controls/observations passed, one exact delivery assertion
failed, actual exit 1. With contention+slow recall+telemetry, valid stdout appears
at 2,305.5 ms but the host kills at 3,001.9 ms. Without the host kill, the same hook
exits 0 only after 3,108.7 ms. Disabling telemetry exits 0 at 2,305.1 ms; immediate
control exits 0 at 84.3 ms. Primary independently reran the exact red with
`node tools/testing/run.mjs --test-name-pattern='red: valid recall' <suite>`:
actual exit 1, stdout 2,303 ms, telemetry starts 2,304.9 ms, host kill 3,002.8 ms,
process ends 3,005.4 ms with SIGTERM and no stderr. No real HTTP or user state.

Ranked predictions announced before further probes: awaiting post-output
telemetry extends lifetime; pre-dispatch local waits can independently exhaust
the outer window; schema fallback might restart a budget (lower prior because
existing tests claim a shared HTTP deadline). Test one variable at a time and
retain counterevidence; do not assume every hypothesis is a defect. These
measurements are diagnostic evidence, not a completed fix or production SLA.

The same initial loop on Node 24 also retained 3 controls/observations and one
delivery failure, actual exit 1. Five one-variable diagnostic probes pass on
each runtime, actual exit 0: immediate telemetry restores the 450 ms-lock scenario
to about 2.31 s; removing contention with stalled telemetry exits about 2.68 s;
increasing only the local wait to 1,600 ms with telemetry disabled gives valid
stdout only around 3.45 s naturally, or a 3 s host kill with no stdout. These
support separate post-result and pre-request budget defects.

The fallback hypothesis has counterevidence: the recognized 400 triggers exactly
two requests, removes only session_id, reuses the exact AbortSignal, and aborts
around 2,000 ms after the first fetch (about 2.48 s total), exiting 0 silently without
a host kill. Preserve that correct behavior; do not present it as another bug.
Raw logs are `recall-timing-probes22-first.log` and
`recall-timing-probes24-first.log` in the historical evidence collection. All are
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
2.5 s SLA. Pause/identity authority takes precedence over a desire to emit context.
The source and tests remain separate from the P3c frozen candidate throughout.

Primary constructed a separate five-case suite at
`acceptance.test.mjs` (historical primary acceptance evidence) and ran it against
the unchanged plugin/shared-client source, not the worker's changing repair.
Node 22 actual exit 1: one foreign-lock preservation control passes; four required
new behaviors fail. Stalled stdin and 1,600 ms contention+1,800 ms recall are killed
by the 3 s simulated host; immediate successful recall still dispatches telemetry;
an already-aborted optional signal does not suppress the lock callback. The last
case is a red for the newly specified cancellation API, not a claim that the
old API promised cancellation. This suite independently checks actual child
termination and owned/foreign lock state; the source report's loop is retained
separately. Syntax check exited 0. No real service, transcript or credential.

## Primary pre-freeze cancellation finding

The first repair added a cancellation check after electing a dead-lock reaper.
An independent deterministic two-case probe at
`reaper-cancellation.test.mjs` (historical primary reaper evidence)
injected cancellation at the second owner read, after the permanent election
marker existed. Node 22 actual exit 1: the no-cancellation control passed, while
the cancelled invocation left the old dead lock behind its permanent marker;
the next invocation could not acquire it. Both use the same constant-dead
liveness probe and 150 ms acquisition window; the control completes in about 13 ms.
This is a new graceful-cancellation defect, separate from the original hook
timeout. Keep the red log `reaper-first22.log`.

The bounded correction must finish the already-elected token-checked recovery
critical section before honoring cancellation. It must not delete election
markers, steal a live foreign lock or unlink a successor. The worker owns the
runtime correction and tracked regression; primary reruns the independent
probe unchanged. Permanent election tombstones are existing intentional state,
not unexpected temporary residue or a new cleanup promise.

The minimal critical-section correction passed the unchanged primary two-case
reaper probe, actual exit 0. The combined independent seven-case suite then
passed 7/7 on Node 22.16 and 24.15, actual exit 0 each. Stalled stdin and
1,600 ms-lock+1,800 ms-HTTP schedules exit normally with no output around 2.531–
2.534 s, before the unchanged 3 s simulated host; immediate valid output exits in
73/84 ms and emits no recall telemetry. Foreign lock ownership remains intact.
These are pre-freeze checkpoints (`repaired-first22.log`/`repaired-first24.log`),
not substitutes for final content matching, broad gates or independent review.

## First frozen matrix and retained source-pin failure

The first Node 22 broad plugin/architecture gate completed 655/656 tests with
actual exit 1. Its sole failure was the intentionally changed current
`transport-hosted.mjs` SHA256 in `integrations/client/test/parity.test.mjs`;
the behavioral parity, original goldens and new timed process cases passed.
Primary inspected that test and approved updating only this explicit current
transport mechanism pin/comment. The historical base, source-hash fixture,
mechanisms and hosted-output goldens remain unchanged. Keep the original red
log and re-freeze the additional tracked test; this is not evidence of a green
matrix until the affected broad gate is rerun.

The matrix stopped automatically; Node 24 generic and the pinned plugin
validator had not run. Before that validator executes, route it through an
owned test harness with synthetic HOME. Retain successful
command records and compare their input hashes before reusing them; do not
rerun successful commands merely to obscure the interrupted matrix. Source
remains frozen through each corrected run. The primary independently checks
the final inventory and reruns process acceptance after worker verification.

The corrected Node 22 broad gate passes 656/656, actual exit 0. A requested public
limitations prose cleanup landed just after its snapshot; preserve that exact
snapshot and record the sole doc hash delta rather than silently replacing it.
Primary's first strict inventory check exited 1 on that known document only;
its explicit before/after-hash check then passed. All original runtime hashes
are unchanged, with 22 paths independently reconciled against base tree/blobs
and 21 worker paths checked. No runtime/test exception is permitted.

Primary reran the unchanged seven-case process/lock acceptance on the final
runtime bytes: 7/7, actual exit 0 on each 22.16/24.15. Stalled stdin and
contention-plus-HTTP scenarios terminate normally around 2.53 s with no output,
not a host kill; immediate valid context exits around 76–81 ms with no telemetry.
These `repaired-final22.log`/`repaired-final24.log` records are local synthetic
acceptance, not a claim that the native host or released package has shipped.

Read-only preflight identified that the pinned maintainer Claude validator is
a native Linux ELF, not a Node script. The owned `--script` runner must therefore
execute a small JavaScript harness which spawns that exact binary with a fresh
synthetic home and minimal environment, not feed the ELF into Node. The harness
validates only the two named task worktrees, runs the marketplace/plugin checks,
records each actual code/signal, and cleans both owned workspaces. This is a
verification-harness correction; no pinned dependency or tracked CI change.

The first four Node 22 commands (bundle, runtime manifest, JSON validation,
transport) already passed with actual exit 0 on the same runtime bytes. The
corrected generic gate is 656/656 and pairing 270/270, actual exits 0. The paused
controller was deliberately terminated with 143 after its pairing child had
finished; the child's actual wait status 0 is retained separately in
`repair-paused-controller.json`. Controller termination is not a full-matrix
pass. Remaining checks resume in a new controller without overwriting those
logs or rerunning successful commands.

The corrected native-validator harness and real setup pack gates now pass on
both runtimes, all four invocations actual exit 0. Each validator invocation
runs both marketplace and strict-plugin commands successfully in fresh synthetic
homes. Each package contains 52 files, reconciled through four independent
routes: package metadata/allowlist, npm dry-run manifest, actual pack manifest,
and tar listing. Prepack is enabled; no release/publish occurs. All owned test
workspaces are removed and no light-gate child remains active. Four remaining
Node 22 gates and ten Node 24 gates precede the fixed-candidate review.

### Remaining-gate stop: two Codex qualification failures

The remaining-only controller retained the earlier successful evidence and
passed Node 22's original pairing golden command, actual exit 0 (43.711 s).
Its next command, `npm run test:codex`, failed 196/198, actual exit 1 (68.773 s),
signal null. It stopped without editing or retrying; no Node 24 command ran.
The two assertions are the live `/proc` synthetic-host ancestry child exit
(1 rather than 0) and creator-version retry capture (empty rather than the one
expected synthetic message), both in unchanged `qualification.test.mjs`.
The qualification runtime, worker, helper and tests match the fixed base.
That excludes direct edits to those files, not indirect shared-client effects.

All 21 worker paths still match the verified start bytes. Preserve
`repair-remaining-codex-22.16.0.log` and the actual-code JSONL. A bounded
selected-case and old/current differential diagnosis is required; a green
rerun alone cannot dismiss the failed broad gate. The separate P3c source
packet continues its own verification and is not changed to address this.

The selected two-case command reproduces the ancestry failure in 0.529 s on
the candidate, actual exit 1; version retry passes alone. A clean P3b worktree
serves as a baseline only after 175 client/Codex/test-runner paths match actual
fixed-main blobs through two inventory routes. Its same selected command also
exits 1 with the same ancestry failure and a passing version retry.

Ranked predictions before probes were real-ancestor test-guard interaction,
scheduling/deadline exhaustion, and indirect changed shared-client behavior.
A tagged throwaway probe confirms the first on candidate and baseline: the
closest synthetic host and identity are correct, but continuing ancestry
inspection triggers the unchanged `test_observed_real_codex_host` guard and
sets the child exit 1. Both diagnostic probes exit 0 because they assert that
specific failure mechanism; they are not passing feature tests. The separate
version probe sees qualified evidence, creator checks false/true/true, worker
states creator_unqualified/idle/idle, and exactly one capture. Its default
worker deadline is 60 s, weakening the initial one-second-budget hypothesis.
The earlier broad version-retry failure remains unexplained at this checkpoint.

The next environment control uses only a dedicated owned tmux server/session,
unchanged tests and unchanged home guard, never a user's live pane or a global
permission bypass. Establish the actual launch ancestry, output and exit status,
then clean the owned server. No source fix is justified by an environment-only
finding; the independent second failure needs its own explanation.

The owned-server control now passes the unchanged two selected qualification
cases on candidate and baseline, 2/2 each, actual exits 0. The home guard remains
enabled. All owned sessions, sockets and servers are cleaned. This resolves the
first ancestry finding as an environment dependency, not a product regression.

### Shared-lock compatibility correction

Primary inspection found a separate concrete compatibility regression: the
repair started the ordinary acquisition deadline before publishing the owner
file, whereas the original starts it after publication. A controlled independent
four-case probe delays only that synthetic owner write by 150 ms and retains the
same 50 ms acquisition window. Baseline immediate/delayed and candidate immediate
pass; candidate delayed returns false without entering the callback. The probe
exits 1, 3/4 pass, with no residue. Preserve `lock-window-red22.log` in the primary
evidence directory. This establishes the changed contract, not the unobserved
scheduling history of the earlier full Codex version-retry failure.

The bounded worker correction restores the original post-publication deadline
boundary. Cancellation checks, graceful cleanup and the recall-wide budget
remain intact. The worker's tracked default 250 ms/delayed 300 ms controls reproduce
the failure (2/3, exit 1), including a passing independent cancellation control,
before the fix. All old freezes and broad-gate results remain historical; a new
corrected-runtime freeze and final affected matrix are required. Primary will
rerun all eleven independent process, reaper and acquisition-window cases on
both supported runtimes. No deadline or assertion is relaxed.

The corrected worker packet passes 24/24 on each Node 22.16/24.15, actual exits 0.
Primary's unchanged eleven-case packet also passes 11/11 on each, actual exits 0.
The stalled-input/contention probes exit normally around 2.54–2.59 s under the
unchanged 3 s simulated host, with no expired context or telemetry; the default
lock retains its full acquisition window after delayed owner publication.
The two-route inventory agrees on 22 paths/21 worker paths and exactly six reviewed
deltas from the previous freeze. `repair-corrected-freeze.json` is a new retained
snapshot; the old snapshots are not rewritten. Broad affected gates and final
independent review are still required before delivery.

### Controlled exact worker-path comparison

A separate bounded diagnostic uses the actual unchanged Codex qualification,
fixture, helper and worker entrypoints. After the initial `creator_unqualified`
result and a successful qualification, it delays only the synthetic guard's
usage-lock owner publication by 300 ms. Fixed-main baseline and corrected runtime
each return `idle/idle` on the two retries and capture the message exactly once;
the exact pre-correction module returns `timeout/timeout` and captures nothing.
The pre-correction module was reconstructed only in an ephemeral loader and
verified byte-for-byte against its preserved frozen SHA before execution.

All three Node 22 diagnostic commands exit 0 because they assert that differential;
the original capture assertion would pass/fail/pass respectively. This ties the
compatibility defect to a reachable instance of the missing-capture symptom.
The old full-run scheduler sequence was not instrumented, so this is not proof
that the historical failure had that exact timing. No qualification evidence,
home guard, timeout or expected capture was bypassed. All owned fixture roots
were removed; the 21 frozen worker-file hashes remain unchanged. Evidence is
`repair-worker-lock-path-{baseline,pre-correction,corrected}22.log` and the
`debug/worker-lock-*` harnesses in the historical evidence collection.

Primary independently ran the same three diagnostic commands on Node 24.15:
each actual exit 0, reproducing the same pass/fail/pass original-assertion
differential and verified fixture cleanup. These are controlled diagnostics,
not new semantic evaluation results.

### Corrected matrix supervision boundary

The corrected frozen-source matrix completed 21 logical gates with actual exit 0:
all 12 on Node 22.16 and the first 9 on Node 24.15. The outer 30-minute test-controller
deadline then interrupted Node 24 setup at 331.7 seconds; its actual child status
is signal SIGTERM, not a passing test or an assertion failure. The outer controller
exits 1 (`deadline_exceeded`). Its 22nd result records a temporary nested runner
still present during interruption. Final teardown subsequently verifies the
owned pane/server/socket absent and removes the owned invocation workspace.
Retain that interruption and its partial setup log; do not relabel it green.

The final tail runs only setup, native-plugin validation and setup packaging on
Node 24, in a new owned supervised workspace with a 15-minute outer bound. This is
a harness scheduling correction, not a product deadline or assertion change.
The 21 prior successful results are reusable only after their complete source
freeze matches. Primary's post-interruption inventory still agrees on 22 paths
and 21 unchanged worker files. Full delivery requires the three remaining actual
exit 0 results and final cleanup/inventory before freezing the candidate.

### Completed corrected-source matrix

The remaining-only Node 24 controller exits 0. Setup passes 398/398 (446.69 s),
native marketplace/plugin validation exits 0, and actual setup packing exits 0;
the pack verifier independently agrees on 52 archive files. Each gate's owned
parent contains only its expected home and pane marker, with no test residue.
Final supervision verifies 225 observed owned processes, none running, the
private server/socket absent, and the invocation workspace removed.

Primary read the actual result records and reconciled the 21 earlier successful
gates with these 3 fresh successes: 24 unique runtime/gate pairs, all actual
exit 0 and signal null. The interrupted setup attempt remains in its original
log/result and is not counted as success. Primary's independent two-route
inventory again agrees on 22 changed paths and 21 frozen worker-file hashes;
the corrected worker digest remains
`5a0c424f1d2d8fa2d0c3362f1e370676f00030130b7253d19075f3260f5e2bc9`.
Evidence is `repair-finish24-{results.jsonl,consolidated.json,cleanup.json,
final-freeze.json,supervision.log}` under the historical evidence collection.

The scripted recall demo was additionally run personally through the owned
runner on Node 22.16 and 24.15; both actual exit 0. It exercises unchanged core
recall orchestration, not a provider, hosted integration or semantic score.
The JavaScript repository has no TypeScript/typecheck gate. Freeze the scoped
candidate next, personally rerun the eleven key cases on both runtimes, and
obtain separate non-author Standards/Spec review before pushing a draft PR.
No merge, release, deployment, real transcript or product pin change was included
in the historical repair scope.

## Post-merge coverage (main `ff6616a1`)

The process tests run the real hook with synthetic state and cancellation-aware
fake HTTP. Every invocation records spawn-to-close time inside the close listener
and asserts exit code 0, signal null, empty stderr, no simulated host kill, and
spawn-to-close below 3,000 ms. Ordinary tests add no tighter timing gate.

In `plugins/cairn-memory/test/recall-deadline.test.mjs`:

| Scenario | Test name | Required outcome |
| --- | --- | --- |
| Slow recall | `RH-03 slow HTTP cancels within the narrower existing HTTP budget` | Empty output; one HTTP-budget abort. |
| Success with slow telemetry | `RH-02 actual recall with quota contention and slow telemetry completes inside the unchanged host window` | Exactly one valid UserPromptSubmit envelope containing the synthetic memory; zero telemetry fetches. |
| Unavailable quota lock | `RH-03 unavailable quota lock exits silently without host intervention` | Empty output, no recall or telemetry fetch; foreign owner unchanged, no child-owned residue, holder cleanup verified after release. |
| Schema downgrade | `RH-04 schema fallback shares remaining invocation and HTTP deadlines` | Two requests, session_id removed on retry, otherwise unchanged payload and same signal; application-budget abort. |

Lock release is scheduled from the child's first actual quota-lock contention,
not preload readiness. The fallback schedule combines 900 ms contention with a
shared 2,000 ms HTTP deadline, so only the application budget cuts it off near
2,500 ms. Abort diagnostics report only `application`, `http` or `other`.

Opt-in measurement (default 5 sequential runs per scenario):

```sh
npm run measure:recall-hook-deadline -- --runs 5
```

The shared harness observes creation of the hook's 2,500 ms timer in the preload,
without production changes. Cross-process monotonic timestamps exclude IPC
receipt latency from application-entry-to-close measurements. JSON summaries
report exit codes, host kills, and maximum/p50 spawn-to-close and
application-entry-to-close times. Gates require all exit codes 0, no host kill,
maximum spawn-to-close below 3,000 ms, and maximum application-entry-to-close at
most 2,750 ms. Functional assertions also apply. Failures retain their first run
and finite violation names; no retry replaces a failed result.

Post-merge results (2026-10-26, Linux x64 shared machine, load average about 9–11,
`npm run measure:recall-hook-deadline -- --runs 5`, exit 0 on both runtimes; every
run exited 0 with no host kill). Maximum times in ms:

| Scenario | Node 22.16.0 spawn→close | Node 22.16.0 entry→close | Node 24.15.0 spawn→close | Node 24.15.0 entry→close |
| --- | --- | --- | --- | --- |
| Slow recall | 2,084 | 2,054 | 2,080 | 2,052 |
| Success with slow telemetry | 2,351 | 2,321 | 2,355 | 2,327 |
| Unavailable quota lock | 2,070 | 2,038 | 2,074 | 2,045 |
| Schema downgrade | 2,535 | 2,505 | 2,540 | 2,505 |

Historical measurements above are not reused.
