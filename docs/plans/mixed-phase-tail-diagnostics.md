# M1b: bounded late-phase diagnostics in the paired runner

Status: offline contract, not a launch authorization or a score. Dependency:
M1a PR #297, `810a6ef4878554e0c31e19eb033864faae005a82`; original public base
`c2212ce12fa0f31d4847bfc3838f11db377fa51f`. The primary owns this contract and
integration; the bounded GPT-6 Astra/high fallback worker implements after M1a
exact-head CI passes. Reviewers must not be authors. No merge, release or deployment.

## Outcome and boundaries

The goal remains a lightweight, reliable memory layer, with real matched
comparison rather than a perfect-score claim. The new adapter observer alone
does not place timings in a paired evaluation report. Retaining the first 64
events would also hide a late long-history failure. Wire bounded **tail**
observations into the existing Cairn/Mem0 mixed runner, without changing either
arm's memory, answer, judge, resource, timeout, accounting or retention policy.

This packet is synthetic/offline. Do not access a provider key, historical
corpus, operational ledger, private user store or old paid output. Do not build
a new capture-only budget guard. A later real diagnostic must use genuine
paired generation/answer/judgment under the existing v2 cumulative USD200
parent, a fresh settled checkpoint, frozen unused cases and reviewed installed
operator. Existing cases, charges and unresolved outcomes stay immutable.

The public mixed runner imports checkout core/adapter modules. Its offline
success is **not** an installed-runtime claim. The existing public qualified
source-pair launcher is two Cairn arms, not a substitute for native Mem0. The
later private mixed coordinator must separately verify and load the installed
runtime, include the new helper hashes, pin native Mem0 and preserve the
source/evaluator boundary before any paid launch.

## Closed opt-in contract

`runMixedGeneration` accepts the optional trusted maintainer option
`phaseTiming: 'bounded-tail-v1'`. This diagnostic mode supports 1–30 frozen
cases, matching the next fresh-six and conditional fresh-30 checkpoints.
Reject a larger roster before consuming preparation, creating stores or
dispatching requests. Omission preserves the current 1–250-case preparation
contract, report shape,
callbacks and behavior. An own undefined/null/unknown mode fails before the
prepared input is consumed, store creation or guarded dispatch. Do not add a
CLI switch, relax other option validation, or change the frozen mixed manifest.
This observational option must be recorded in any later frozen launch plan;
it is not provider or spending authority.

On opt-in, only a Cairn arm that actually enters execution receives
`diagnostics.adapterPhaseTiming`. Its closed snapshot is version 1,
`sample: 'last'`, `capacity`, `totalEventCount`, `retainedEventCount`,
`omittedEventCount`, and `events`. `events` holds the last valid adapter events
in original order, with exactly the adapter's existing
`{version,stage,phase,outcome,elapsedMs}` fields. Preserve finite allowlisted
values; do not copy arbitrary fields, getters, IDs, messages, source text,
exception strings, URLs, request/response bodies, usage or timestamps.

Use capacity 64 per entered Cairn arm. Across at most 30 frozen cases the
entire report therefore retains at most 1920 events, not an unbounded per-case
log. Counters count valid events admitted before observer closure, including
evicted events; retained count equals
array length and omitted equals total minus retained. Snapshot copies cannot
mutate the collector. No per-event disk/network write or full hidden history.
At `Number.MAX_SAFE_INTEGER` accepted events, stop admitting and close the
observer before incrementing again. Counters remain exact for admitted events,
not callbacks after closure; do not silently saturate while claiming to count
later callbacks. This practically unreachable boundary may be tested through
a small pure checked-increment helper actually used by the collector, not a
new mutable production test hook.

Collect inside each arm's scope, retain terminal observations across ordinary
capture failures and thrown execution errors, and close/snapshot after owned
work/transport settlement using existing runner lifecycle. Ignore late observer
calls after closure. Never let collection failure replace a model outcome,
change request order, grant a retry, keep a core open or alter an unknown cost.
Do not change the existing first-64 `modelDiagnostics` or attempt aggregation.
No extra Mem0 diagnostics, diagnostics on never-entered arms, or retrieval
context fields are introduced.

The ring can start mid-invocation; it is not a complete trace or a correlated
concurrent-call timeline. It measures adapter phases, not earlier core planning,
local map work or SQLite commit. An aborted phase does not prove provider
cancellation or billing; missing events do not imply zero elapsed work. Do not
infer historical N7's cause or announce long-write reliability from this change.

## Acceptance

- **T01 — configuration/default parity:** invalid opt-ins reject before any
  consumption or dispatch; omission produces the exact old report fields.
  Enabled observation preserves request bodies/count/order, arm status/reason,
  answers, scorer denominator and monetary reservations in fake-HTTP controls.
- **T02 — bounded tail:** actual collector tests cover 0, 1, capacity,
  capacity+1 and a late failed/aborted event after more than 64 observations;
  assert exact last-event order, all counters, bounded memory, immutable copied
  snapshots, close/late no-op and malformed/private-sentinel rejection.
  Exercise N=1,6,30 plus pre-consumption rejection at 31 and 250, and safe
  counter-boundary handling. Omitted mode must not inherit the 30-case limit.
- **T03 — real runner failure:** actual `runMixedGeneration` with real core,
  guard, synthetic ledger and fake HTTP must retain a late adapter failure
  beyond the initial 64 events. Keep the arm failed/unresolved, do not answer
  from partial ingestion, and continue only the already permitted next slots.
  The report must pass the actual scorer validation; no filtered denominator.
  Test a success baseline and a thrown execution boundary as well.
- **T04 — configured report headroom:** construct a complete 30-case synthetic
  report with both arms' maximal 64 attempt samples, Cairn's existing 64 model
  diagnostics and new 64-event tail per arm, and real success/failure arm fields
  including nonempty provenance/coordinates where applicable. Pass unchanged
  report snapshot/scorer validators and measure nodes/bytes. This is a bounded
  high-diagnostic control, not a universal proof for every possible old
  provenance combination. Report bounds stay unchanged; no empty placeholder
  report or omitted baseline diagnostics may make the check pass.
- **T05 — native paired integration:** run the explicit pinned native-local
  paired suite on Node22.16 and24.15 using fake HTTP, real installed Mem0 and
  synthetic owned stores/ledger. Exercise opt-in success and late-failure
  coverage in this existing lane; missing prerequisites are blockers, not
  skips. This is native comparator evidence, not installed Cairn evidence.
- **T06 — privacy/lifecycle:** use owned test workspaces, close processes and
  SQLite before removal on success/failure, deny live provider use, and keep
  old guard global stops, one-shot claims, scope/timeouts, no-retry policy and
  source/evaluator isolation unchanged. No old test/output edits or historical
  temporary-directory cleanup.
- **T07 — delivery:** primary inspects actual combined diff and reruns key
  controls. Fixed-candidate independent Standards/Spec reviews and latest-head
  CI must pass. Document the source-only/partial-timing and bounded-sample
  limitations before delivery. A subsequent paid diagnostic remains separate.

## Allowed work and verification

Allowed: `evaluation/longmemeval/mixed-generation.mjs`, one narrowly named
phase-observer helper under that directory, relevant existing/new mixed tests
and native-local fixture, this plan, scoped protocol/privacy/limitations and
CHANGELOG updates. No core/adapter behavior change, package/lockfile/dependency,
guard/ledger, model, prompt, CI or public schema changes. Do not modify old
evaluation results, the retained-episode MCP branch or another agent's worktree.

Install existing locked adapter dependencies only as needed. Both pinned Node
runtimes must pass generic tests, JSON and pinned strict plugin validation,
`test:longmemeval`, ingestion/comparison/public/mixed demos, and the explicit
`test:mixed-native-local` gate. Run affected guard/native boundary checks when
the actual diff/caller trace warrants them. Record red/green and any failed
attempts honestly, exact commands and stable byte identity before primary's
candidate commit. Do not claim unrun gates. No typecheck gate exists here.

Record final evidence and ownership below; exact committed SHA, review findings
and final CI can live in the PR to avoid self-referential document churn.

## Feasibility correction before implementation

The original draft attempted 1–250 cases with a global 4096-event allocation.
The read-only author probe found that 250 cases combining both arms' 64 attempt
samples, Cairn's existing 64 model diagnostics and 16 phase events already
require 528,000 nodes before full report metadata. The unchanged 500,000-node
validator rejected that reduced shape at 4,476,261 JSON bytes. Nonterminal
qualification diagnostics mean a first-error-only cardinality assumption is
unsupported. This is a contract feasibility result, not a measured paid-run
failure or proof that every maximum-shaped report is reachable.

The DRI narrowed only the new diagnostic mode to 30 cases and a concrete
high-diagnostic report gate, rather than widening report limits or changing
existing diagnostic semantics. Broader report/provenance headroom remains a
separate scaling question. Initial GPT-6 Sol/high assignment failed at model
capacity before edits; actual author is GPT-6 Astra/high. No monetary cost is
inferred from the model name.

## Implementation and verification evidence

Author: GPT-6 Astra/high; requested GPT-6 Sol/high was unavailable at capacity
before edits. Root retained contract, integration, acceptance and delivery.
M1a's exact head passed all 21 checks before author release. The implementation
is confined to the mixed runner, its new private phase helper, focused tests,
the synthetic native fixture and scoped documentation. No cost measurement is
available. No commit, push, paid request or operational data access was performed
by the author.

The changed entrypoint is the trusted `runMixedGeneration` option. Its callers
are the native paired test lane and preparation-denial tests; preparation-only
`mixed-demo` and `long-history-live/prepare` imports retain their original
manifest/golden behavior. The scorer consumes the same report envelope and
accepts the optional nested diagnostics without changing its validation or
denominator. There are no browser routes, UI strings, old URLs or CLI switches
in this change. Author owns these focused and native checks; root independently
checks the actual integrated diff and reruns key paths before candidate review.

Recorded red/corrections:

- The initial 250-case shape probe failed `invalid_mixed_report`; the DRI
  narrowed the opt-in contract as described above before implementation.
- The test-first collector suite initially failed `ERR_MODULE_NOT_FOUND` for
  its not-yet-created helper. Root additionally compared the actual public
  entrypoint against the fixed parent on both runtimes: the parent rejects the
  new mode, while the candidate reaches the intentional guard mismatch with no
  HTTP or stores. The missing-helper failure alone is not an integration repro.
- The first native late-failure control correctly failed the Cairn arm, but its
  expected adapter phase outcome was wrong: an object-shaped extraction output
  can pass adapter framing and fail core validation. The fixture now returns a
  JSON string, which fails adapter `output_validation` itself. The corrected
  control observes 70 admitted events, the final failed event in the last 64,
  six omitted events, no partial-ingestion answer and a completed native arm.
- Root found an inherited `Object.prototype.phaseTiming` getter was consulted
  by destructuring even with omission. The implementation now reads the mode
  only when its own descriptor exists; a getter/value regression verifies zero
  inherited reads and preserves the omitted mode's 31-case acceptance path.
- New mixed fixture workspaces register guard closure before cleanup; old
  explicit caller `finally` closures remain and the guard is idempotent.

The paired success and late-failure controls compare complete stable request
bodies/order, arm reports (removing only the new timing field), attempt outcomes
and monetary reservations, answers and scoring summaries between omitted and
enabled modes. The late-failure and thrown-recall controls explicitly use
`indexed-evidence-v1`. The latter injects a one-shot synthetic SQLite read
failure and asserts `diagnostics.stage === 'execution'` with prior phase events.
A deadline control preserves unknown cost, retains the aborted terminal phase,
and proves delayed physical completion cannot change the settled report, guard
attempts, scopes or request count. A failed-preflight control creates no timing
snapshot or store. All fixtures use synthetic data and fake HTTP only.

The full 30-case high-diagnostic report passes the actual snapshot and scorer:
87,037 traversal nodes, 763,346 JSON bytes and 1,920 retained timing events.
It includes the full manifest/roster, both arms' 64 attempt samples, 64 existing
Cairn diagnostic samples, success/failure fields and nonempty success
provenance/coordinates. It is expressly not a universal provenance-size proof.

Run gates from this worktree with each pinned runtime prepended to `PATH`:

```sh
npm ci --prefix adapters/openai
npm test
npm run validate
npm run test:longmemeval
npm run demo:longmemeval-ingestion
npm run demo:longmemeval-comparison
npm run demo:longmemeval-public
npm run demo:longmemeval-mixed
npm run test:experiment-request-guard
npm run test:mem0-native-gateway
npm run test:workspace-lifecycle
CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv \
CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu \
npm run test:mixed-native-local
```

The native roots were reused from the repository's documented synthetic pinned
installation, with Linux `bwrap` and host pidfd support checked read-only.
Strict plugin validation reused the existing pinned Claude 2.1.260 binary:
prepend `/home/chichieh/Github/cairn-memory-worktrees/source-window-coverage/tools/plugin-validation/node_modules/.bin`
to `PATH` after the selected Node binary, then run
`npm run validate --prefix tools/plugin-validation`.
The adapter locked install audited two packages with zero vulnerabilities.
No dependency or lockfile changed. Demo artifacts retain their documented
synthetic demonstration lifecycle; no historical directories were cleaned.

Broad-gate logs: `/tmp/cairn-mixed-phase-gates.aEfekA/<runtime>-<script>.log`.
On both Node 22.16.0 and 24.15.0, completed checks are ordinary tests
(131), LongMemEval tests (199), request-guard tests (292), workspace lifecycle
tests (25), JSON/version validation, pinned strict plugin validation and all
four named LongMemEval demos. Native gateway tests also passed 45/45 on each
runtime. Full mixed-native tests passed 30/30 on both runtimes (154.7 seconds on
Node22.16.0 and 152.0 seconds on Node24.15.0). No completed broad test gate had
failures or skips. `git diff --check` passed and source hashes remained unchanged
through all broad gates. Earlier failed focused attempts are retained above.
No typecheck gate exists in this repository.

Stable source SHA256 at broad-gate start (verified again before handoff):

| File | SHA256 |
| --- | --- |
| `mixed-generation.mjs` | `6aaaa8e60dd08bb5716ef99c9ca1c38ecd58290c84011a045ea4596f298dc16a` |
| `mixed-phase-timing.mjs` | `48a899136a405386623ef288c847660aa7da3b6c46003288a21111d2ca885dcd` |
| `test/mixed-phase-timing.test.mjs` | `81831f84e60665d456a06cd3d1d6a660279ef44435b415144d6141cd34af768e` |
| `testing/mixed-fixture.mjs` | `e6c7380e6610a9d2c74b469f2e431cc184b70b691caa46616e24f0ae719fd389` |
| `testing/mixed-native.test.mjs` | `3b01b41bfc2b601d69dcbbe31c9fee60c85a4911f7dffe862c6a707d33f82133` |
