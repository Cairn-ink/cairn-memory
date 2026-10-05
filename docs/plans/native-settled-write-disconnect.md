# Accounted native response disconnection

## Scope and fixed base

Base `0cab3ed7186bf6533a947852b50fb4b38b548c19`, branch
`fix/native-settled-write-disconnect`. This is an explicitly dependent change
on `fix/token-fit-ingestion` (PR343), which contains the currently evaluated
runtime and prior client-error provenance. The primary fetched current main
`68f244c6161671025fc87f39f3ad5edb997cc2cf`; it lacks that provenance. Use the
user-authorized dependent-branch workflow, not a main merge or a modification
of the immutable runtime used by the closed paid experiment.

One GPT-6.1 Sol/high author implements; primary owns the decision, direct
acceptance and delivery; independent Standards and Spec reviewers inspect the
same final committed diff. No paid requests, actual corpus/key/book/control
access, retry, new evaluation authorization, release or deployment in this PR.

## Observed versus reproduced

A closed development continuation stopped in its first native arm after nine
successful, priced and settled provider responses. The kernel retained
`native_http_invalid`, client-error category `other`, idle connection phase,
active scope, stopping=false and last-response age zero. The exact original
socket error is unknown. No semantic score or framework-quality conclusion
follows; the Cairn arm was not entered.

On the unchanged kernel, a real UDS client sending a complete valid embedding
request and immediately destroying its socket reproduces that diagnostic
pattern. Node emits genuine EPIPE/write; there is no event injection. The
ninth-request version reproduced5/5 on22.16 and3/3 on24.15. Removing the eight
preceding requests reproduced2/2 on22.16, so a single request suffices. Healthy,
normal FIN, close-after-headers and close-after-body controls each completed2/2.
A pinned installed Mem0/httpx fake-provider control completed19 requests.

These observations support a bounded transport-failure class, NOT proof that
the original paid event was EPIPE. Provider settlement and response.finish do
not establish receipt or ingestion by the native client.

## Acceptance D1–D7

- D1: Preserve a red-capable, genuine-kernel/guard/UDS regression for the minimal
  accounted-response peer-close failure. Demonstrate RED on the fixed base,
  then GREEN on the correction on exact Node22.16.0 and24.15.0. Healthy/FIN and
  completed-response controls remain completed. No arbitrary error injection
  as the sole reproduction; use fresh owned synthetic workspaces.
- D2: Only a positively identified EPIPE in the bounded, validated and fully
  provider-settled response path may seal this native scope locally. Do not
  use category `other`, response.finish alone, or a loose idle check as proof.
  Track necessary per-connection state privately. Return a failed/unresolved
  infrastructure outcome, never a native success, answer or completed ingest.
  Prefer existing handle.revoke and cleanup contracts over changing authority
  or accounting APIs. Preserve an explicit finite disconnect reason in results.
- D3: Cancel descendants, reap the owned child/group, close sockets, drain work
  and verify accounting before the next scheduled arm. Only after all existing
  cleanup/accounting gates pass may that next arm run once. All reservations
  and failed outcomes remain; no replay, refund or implicit retry.
- D4: Parser/framing faults, unidentified errors, unsettled/mismatched accounting,
  artifact changes, cleanup/reap failures and leaked descendants stay global.
  Verify late malformed traffic still overrides a local seal. Do not broadly
  ignore socket errors or weaken the existing fail-closed tests. Add EPIPE to
  bounded diagnostic allowlists only if needed, with unchanged identity and
  plain-data/forgery protections. Never retain raw packets/messages/headers.
- D5: Exercise continuation through the genuine mixed runner and journal:
  disconnected native arm is U, subsequent arm/case can execute, denominator
  and scoring treatment unchanged; failed native arm is not judged as correct
  or wrong. Include negative cleanup/accounting controls and the installed
  native fake-provider healthy gate. No source/oracle or selection changes.
- D6: Run applicable CONTRIBUTING gates on exact22.16/24.15: generic test and
  validate, budget/guard, portable and installed-native, LongMemEval/mixed-native,
  required demos and maintainer checks as applicable. Record actual exit codes,
  no skipped/missing-prerequisite pass, retained failures and temporary cleanup.
  Primary independently reruns key real-UDS and integrated paths on final bytes.
- D7: Update this plan and docs/limitations.md with bounded evidence and unknown
  original causation. Freeze scoped commit, independent double review, push a
  dependent PR and monitor latest-head CI. No merge, package publication or
  general memory-quality/benchmark-parity claim.

## Allowed implementation surface

Native runtime and focused controlled fixture/tests; minimal shared diagnostic
shape or mixed result projection needed for the finite reason; mixed/journal/
scorer regressions; this plan and docs/limitations.md. Existing configuration,
models/prompts, native child source, public memory core, budget/request guard
authority, timers and price policy are out of scope. Checkpoint a precise
proposed state transition before broad gates or widening files. No edits to
the old evaluated worktree or its private artifacts.

## Implementation and evidence checkpoint — 2026-10-06

Author: actual GPT-6.1 Sol/high, bounded worker; primary owns acceptance,
candidate commit, independent review and dependent delivery. The immutable
evaluated worktree remains untouched. Locked dependency directories are reused
through new owned symlinks in this worktree; these links must not be committed,
recursively removed, or used for an install that changes their shared targets.

The kernel clears per-connection eligibility on every new request. Eligibility
requires the complete bounded response returned by X, HTTP200, exactly one new
successful priced response attempt for the current native generation ordinal,
settled attempt history and a non-halted guard. Own-data EPIPE on that eligible
connection revokes the native scope, kills/reaps and closes/drains existing work.
The result is sealed with `native_response_disconnect`, never native success.
Eligible teardown EPIPE after this local revocation is restrictive; parser and
unidentified errors still globally halt, including after the local seal. The
existing cleanup/accounting checks and X's final ledger reconciliation remain
vetoes. No authority API, timer, native child, model or prompt changed.

Two existing `guard.attempts()` snapshots per request supply the association
proof. Their cloning overhead has not been benchmarked; no latency improvement
or original timeout explanation is claimed.

Before the runtime correction, the new D1/D2 genuine UDS tests failed2/2 on
exact22.16.0 and24.15.0, each command exit1, with real EPIPE/write and global
`callback_failed`. The primary also independently reproduced the minimal red
on unchanged0cab using the original private probe on24.15.0: exit1,1failed,
0skipped, one successful settled request, child closed and root absent.

After the first correction, this focused command passed14/14,0skipped on both exact
runtimes, each exit0:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin \
NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs \
evaluation/experiment-budget/test/native-settled-disconnect.test.mjs \
evaluation/longmemeval/test/mixed-settled-disconnect.test.mjs
```

For24.15.0, substitute that exact Node directory. Before-fix red used
`--test-name-pattern='D1/D2'` with the first test file. Coverage includes minimal
and ninth-request real EPIPE, healthy/FIN/received-response controls, genuine
late malformed headers, accounting/descendant/cleanup vetoes, noneligible and
unidentified errors, finite EPIPE projection roundtrip, and a new request
clearing prior eligibility on a persistent test connection. The request-reset
adversarial negative injects a socket event; it is not the reproduction.
Accounting/scope negatives alter cloned test observations, not the guard API
or an operational ledger.

The integrated D5 test runs actual mixed generation, Cairn core, X guard, native
kernel, UDS, journal and scorer, with a narrowly controlled built-in bwrap
launcher/owned-PID fixture. It does not execute installed Mem0. The first native
arm is failed/unjudged U; subsequent Cairn and both second-case arms complete
once. FixedN=2, commonResolvedN=1, native U=1/correct=1/incorrect=0, Cairn correct=2;
both phase reports survive journal roundtrip. Child streams close and all
native roots disappear before phase return. Installed Mem0 fake-provider
healthy coverage remains a separate mandatory gate.
The final test also asserts roots are absent and prior native children closed
at every subsequent Cairn provider entry, before that later request executes.
This test-only ordering strengthening passed1/1,0skipped, exit0 on both exact
runtimes; it was applied before the full LongMemEval gates read the test.
The primary independently inspected the final runtime/fixture/test diff and
reran the complete strengthened focused command on both exact runtimes:
14/14,0failed,0skipped, actual exit0. Primary result chunks are0c0a8b (22.16.0)
andf35eea (24.15.0); this acceptance check does not replace independent review.

Retained setup failures: the first integrated assertion used a nonexistent
`wrong` summary field; corrected to the existing `incorrect` field. Initial
accounting/scope negatives attempted to mutate frozen observation snapshots
and therefore saw `native_gateway_failed`; the fixture now clones before
altering them. These were test setup failures, not unexplained runtime flakes.

At the initial checkpoint, full contributor gates and final primary reruns
were pending. Their final results are recorded below. No commit, push or PR
is made by the author worker.

### Final-state correction found during primary inspection

Before candidate commit, the primary identified that child success was cached
before socket cleanup. A later eligible EPIPE could revoke the scope while the
cached kernel result still said completed. A deterministic additional lifecycle
fixture demonstrates this at `server.close`: a real UDS response is validated
and settled, the controlled child exits0, then a labelled injected EPIPE occurs
during cleanup. This additional race test failed1/1,0skipped, exit1 on both exact
runtimes, showing completed kernel output alongside X's failed/cancelled scope.
It is not genuine-socket evidence about the original paid event.

The final return now honors any classified disconnect after all global fault
and cleanup vetoes. The focused command above passes15/15,0failed,0skipped on
both exact runtimes, each exit0. The primary independently reran that final
command:22.16.0 chunk431461 and24.15.0 chunk392a18, both15/15 and exit0. No
source/test edits follow this checkpoint; affected native and mixed gates rerun
these final bytes. Runtime SHA256:
`53a8e16505b4e505ba8cdb80369d2341b62a65fd4dda94963d93aef39bd97b7a`.

Initial full installed-native runs failed14pass/2fail,0skipped, exit1 on both
runtimes: the doubly nested canonical runners under the long private TMPDIR
made containment UDS paths117/122 bytes. Retained24.15 logs show `listen EINVAL`;
22.16 logs show ENOENT at the expected socket and `forked_probe_not_ready`.
A bounded owned117-byte path control observed22.16 creating a108-byte socket
whose expected full path did not exist, while24.15 returned EINVAL; each probe
exited0 and cleaned its workspace. This supports the shared harness pathname
failure, not native execution evidence. Final native/mixed gates use the
canonical owned runner under `/tmp`; a targeted private observer records the
actual replacement containment socket lengths without changing listen calls.
No historical temporary-directory sweep or runtime timeout change is made.
On both exact runtimes the replacement sockets measured88/93 bytes and the
complete installed-native gate passed16/16,0skipped, exit0. The local ABI header
`/usr/include/x86_64-linux-gnu/sys/un.h` declares108-byte `sun_path`; the observed
old paths exceeded it and the new paths fit. The final portable native gate
also passed72/72,0skipped, exit0 on both exact runtimes.

### Completed contributor verification

Every gate below ran on exact22.16.0 and24.15.0, each with actual exit0,
0failed and0skipped. Counts are identical across the two runtimes.

| Command | Tests passed on each runtime |
| --- | ---: |
| `npm test` | 581 |
| `npm run test:workspace-lifecycle` | 25 |
| `npm run test:experiment-budget` | 65 |
| `npm run test:experiment-request-guard` | 313 |
| `npm run test:mem0-native-gateway` | 72 |
| `npm run test:mem0-native-local` | 16 |
| `npm run test:longmemeval` | 281 |
| `npm run test:mixed-native-local` | 47 |

`npm run validate`, `npm run validate --prefix tools/plugin-validation`, and
the six demos `demo:experiment-budget`, `demo:experiment-request-guard`,
`demo:longmemeval-ingestion`, `demo:longmemeval-comparison`,
`demo:longmemeval-public`, `demo:longmemeval-mixed` also each exited0 on both
runtimes. The final four affected native/mixed suites reran after the final
return correction. Unaffected generic, budget, guard and workspace results
remain applicable; they were not needlessly repeated.

Commands use the exact Node directory first in a clean PATH, the pinned native
roots stated in the task, `NODE_DISABLE_COMPILE_CACHE=1`, and canonical owned
test workspaces. The final full-runner TMPDIR is `/tmp`. Per-command raw logs
and actual exits remain private under `/tmp/cairn-n10-idle-diag.2SThfaAq/`:
initial `verification-{version}.json`, workspace-specific JSON, and final
`verification-{version}-final.json`. Failed initial installed-native logs are
retained separately from the successful `*-final.log` files. Canonical runner
groups stop before workspace removal; no historical directory is swept.

The primary additionally reran installed Mem0's actual add/get/search healthy
test on final bytes at24.15.0:1/1,0skipped, actual exit0, chunk0ca19f. This
targeted spot check supplements the author's complete16/16 installed gates.
The primary owns candidate commit and both independent fixed-diff review axes,
dependent PR against `fix/token-fit-ingestion`, and latest-head CI. Only those
delivery gates remain; no merge or paid run is authorized by this correction.
