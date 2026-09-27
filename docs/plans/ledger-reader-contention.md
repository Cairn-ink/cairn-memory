# Bound short-reader contention and retain settlement failure categories

Base: `93e52b7afb298d728cb4831c34bbda6dcf750704`.
Status: offline correction, not historical-cause proof or accounting recovery.

## Observed failure and falsifier

The terminal official-six v3 run retains one Mem0 embedding reservation10 with
observed cost10/input470/output0, but durable outcome and cost null. It globally
halted before scoring. Original mapped ledger exception was not retained; the
public boundary alone cannot identify its cause. The prior-prefix and exact-tail
audits pass, with no detected foreign writer, but the pending reservation remains.

An independent synthetic probe using the actual mixed guard and real ledger
reproduced the exact signature on Node22.16/24.15 by holding a legitimate
read-only SQLite transaction over settlement. Instrumentation saw COMMIT fail
with SQLite5. Releasing the reader before settlement gives success. A separate
foreign-rowid mutation also produces the same retained signature. Primary has
personally rerun all three paths and the explicit failing settlement assertion.
Thus contention is a demonstrated defect/mechanism, not a uniquely proven cause
of the historical run. No raw source, key, operational database or network was
used in those probes.

## Frozen acceptance

- B1: Configure a fixed1000ms SQLite busy timeout only for writable experiment
  ledger connections. Keep read-only inspectors read-only with their existing
  behavior; no journal-mode/schema/file-permission change and no user-selectable
  wait knob. The wait is local lock acquisition/commit handling, not a provider
  retry, new request, automatic reconnect or second settlement attempt after a
  failed transaction. Existing transaction/witness validation and fail-closed
  behavior remain authoritative. A lock outlasting the timeout still fails.
- B2: In the mixed guard only, when recordOutcome throws, retain an optional
  closed diagnostic on that attempt:
  `settlementFailure: { operation: 'record_outcome', category }`.
  Allowed categories are ledger_busy, invalid_ledger, ledger_closed,
  configuration_mismatch, or ledger_failed (all other errors map to that fallback).
  Do not copy message, stack, SQL, identifiers, payload, exception properties or
  arbitrary strings. Successful attempt records retain their old exact shape.
  Preserve observed usage, null durable outcome/cost, full reserved amount,
  global halt, frozen attempt projections, and denial of further requests.
  Keep thrown/public error behavior unchanged; do not claim transaction phase
  when it was not explicitly retained by the ledger boundary.
- B3: Add deterministic actual-ledger and actual-mixed-guard tests. A separate
  child process holds a read lock and releases it after a synchronized signal
  and short fixed hold well below1000ms; settlement succeeds exactly once with
  one physical fakeHTTP request, same reservation and no extraattempt. A
  indefinitely held reader fails after the finite timeout, retains pendingusage
  and ledger_busy diagnostic, and denies all laterpaidwork. Use synchronized
  child handshakes; generous test watchdogs are not a production deadline claim.
  Preserve a held-lock base-red/new-green transient-reader test. Same-process
  setTimeout cannot release a lock while synchronous SQLite blocks the eventloop.
- B4: Witness tampering still fails as invalid_ledger without retry or success
  promotion. Test arbitrary thrown exception sanitization and successful records
  with no diagnostic field. Existing deadline/abort, namespace, price/cap,
  interrupted transaction and historical-prefix protections stay unchanged.
  Do not broaden an accepted request body, scope schedule or budget grant.
- B5: Technical docs explain the bounded local wait and diagnostic limits.
  Retain historical pending record and uncertainty. No manual settlement, ledger
  recovery, paid-run restart, reservation refund, limit reset or provider call
  belongs to this packet; no new permission follows from tests or merge.
- B6: Full experiment-budget and request-guard suites plus synthetic demos,
  generic/JSON/strict-plugin and affected mixed/native-local and live-evidence
  integration run on Node22.16 and24.15. Primary reruns the exact red/green seam
  and finalfocusedtests. Independent non-author Standards and Spec reviews of
  the same committed diff, then all applicable exact-head CI before authorized
  merge. Missing genuine native prerequisites are a blocker, never a passedskip.

## Ownership and allowed files

Primary owns this scoped decision and acceptance. GPT-6 Sol/high worker owns
implementation. Allowed runtime: `evaluation/experiment-budget/index.mjs` and
the narrow mixed settlement catch in `request-guard.mjs`. Tests in existing
budget/guard directories (including one focused childfixture ifneeded), thisplan,
`docs/experiment-budget.md`, `docs/experiment-request-guard.md` and a bounded
technical changelog entry. Package test-script edits only ifnecessarytoinclude
newtests in existing CI. No core/adapter/host/nativecomparator/scorer/model,
dependency, operational script, ledger or frozenresult changes.

Worktree `ledger-reader-contention`, branch `fix/ledger-reader-contention`.
Worker records changedcallers, failedtests and exactgatecommands here. No paid
work or operational accounting mutation. Separate resultreport preserves this
run's observed facts; it cannot be rewritten as a recovered or successful run.

## Implementation and verification record

Implementer: GPT-6 Sol/high, independently of the forthcoming reviewers.
Runtime edits are two lines in `configureConnection` and the mixed guard's
`recordOutcome` catch. No package test-script edits were needed: the existing
budget and guard suites already include the changed test files.

Changed consumer trace:

- All writable budget constructors, migrations and cap transitions pass through
  `configureConnection`; their transaction and witness checks remain intact.
  Read-only inspection does not receive the timeout. The budget suites exercise
  interrupted commits, caps, historical prefixes and connection behavior.
- Only mixed settlement records gain an optional failure field. The mixed
  scorer reads attempt stage/count and scope outcomes, while generation and
  native containment still treat unsettled accounting as global failure.
  `attempts()` returns frozen detached projections. Existing public-pilot and
  qualified-source launch paths use other guards and keep their record shapes.
  Mixed/native and offline live-evidence gates cover these callers. No browser,
  URL, product flow, model input or public wire entrypoint changed.
- The new fixture uses a real child reader with IPC lock/timer acknowledgments.
  The child's own event loop releases its lock during synchronous parent waits;
  indefinite readers are released only after the failure assertion.

Retained failures and corrections:

- Before the runtime fix, the new short-reader bound-ledger test failed with
  `ledger_busy` on the actual settlement seam.
- Exact base `93e52b7afb298d728cb4831c34bbda6dcf750704` was loaded from
  `/tmp/cairn-base-budget93.mjs`. Running
  `node /tmp/ledger-reader-base-red.mjs base` failed with `ledger_busy`, while
  `node /tmp/ledger-reader-base-red.mjs new` settled one request successfully,
  on both Node 22.16.0 and 24.15.0. Both use the same acquired child lock and
  acknowledged 200 ms release schedule; no base or historical file was edited.
- The initial post-fix helper sent another release after its timed child exit,
  causing EPIPE in short-reader tests on both runtimes. It now awaits the
  already scheduled exit, and `releaseAfter` requires a positive hold time.
  The affected six focused tests then passed on both runtimes.
- First full budget gates passed 64/65 on both runtimes: the old busy-error test
  required return in less than 1,000 ms. That assumption conflicts with B1's
  fixed 1,000 ms wait. Its assertion now checks the wait and a generous 10 s
  test watchdog while preserving zero reservations and the same error category.

Final gates on both Node 22.16.0 and 24.15.0:

| Command | Result on each runtime |
| --- | --- |
| `npm run test:experiment-budget` | 65 passed, zero failed/skipped |
| `npm run test:experiment-request-guard` | 292 passed, zero failed/skipped |
| `npm run test:mem0-native-gateway` | 45 passed, zero failed/skipped |
| `npm run test:mem0-native-local` | 9 passed, zero failed/skipped |
| `npm run test:mixed-native-local` | 22 passed, zero failed/skipped |
| `npm run test:longmemeval` | 185 passed, zero failed/skipped |
| `npm run test:live-evidence-offline` | 340 passed, zero failed, 30 explicit opt-in skips |
| `npm test` | 112 passed, zero failed/skipped |
| `npm run validate` | JSON and matched-version checks passed |
| `npm run validate --prefix tools/plugin-validation` | Marketplace and strict-plugin checks passed |
| `npm run demo:experiment-budget` | Passed, synthetic ledger only |
| `npm run demo:experiment-request-guard` | Passed, synthetic ledger/fake HTTP only |
| `npm run demo:longmemeval-mixed` | Passed, preparation only |

The live-evidence opt-in skips are not an installed-runtime pass claim. Native
gates used the existing pinned synthetic installation with
`CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv` and
`CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu`.
Adapter and maintainer tooling were installed from their existing lockfiles.
Logs are `/tmp/ledger-reader-final-{22.16.0,24.15.0}-<script>.log`; earlier failed
budget logs remain separately at `/tmp/ledger-reader-{22.16.0,24.15.0}-test:experiment-budget.log`.
The final seven focused connection/reader/settlement/witness tests passed on
each runtime with zero failures/skips; their logs use the `-focused.log` suffix.
`git diff --check` passed. The candidate commit preserves this tested code and fixtures;
primary reruns and independent non-author review remain delivery gates.

No paid call, operational ledger inspection/mutation, accounting repair or
historical cause claim occurred in this implementation packet.
