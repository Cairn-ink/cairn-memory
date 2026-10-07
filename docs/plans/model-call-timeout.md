# N22: Explicit per-core model-call timeout

Fixed base: `193e248f53a0a577f6ad408fa8b53b1bf53ea633` (PR #361).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/model-call-timeout`.
Branch: `feat/model-call-timeout`. Implementation: GPT-6.1 Sol/high;
primary owns integration, full gates, independent reviews and delivery.

## Contract

Add trusted constructor option `modelCallTimeoutMs` to `openMemoryCore`:
omitted defaults to 30000; an explicit own data-property safe integer from 1
through 120000 is accepted. Reject explicit undefined, invalid values,
accessors and inherited options without invoking getters, before database
creation. Snapshot the primitive once in the core closure and pass it explicitly
through helpers into `callModel`; do not mutate, wrap or add timeout metadata to
the supplied model. No AsyncLocalStorage, global policy or new timer registry.

One call clock covers the complete adapter invocation, including remote count
and generation. A capture's existing monotonic aggregate deadline remains
authoritative: use the smaller of the configured call cap and aggregate
remaining time. Preserve token/output bounds, freshness checks, transactional
deadline checks, branded AbortSignal provenance, existing error envelopes,
no model retries, and owner-token cleanup. Standalone calls get the same core's
configured call cap. Existing episode interpretation starts before the admission
aggregate deadline; keep that scope and give batch/lazy/end interpretation the
configured call cap.

Keep existing 125-second leases. A longer per-call cap does not bound total
multi-stage work; callers may also configure `captureDeadlineMs`. This is a
prospective core facility, not evidence that provider latency or accuracy has
improved, a repair of frozen Q4, or activation in MCP/Hermes or an evaluation.

## Observable acceptance

- N22A — Constructor/default: omitted retains 30000; 1 and 120000 are valid;
  explicit undefined/null, invalid types, non-integers and values outside the
  range fail before database creation. Own accessors and inherited data/getters
  fail without getter execution. Public operation arguments do not accept it.
- N22B — One call clock: a synthetic adapter count followed by generation can
  complete beyond 30000 under an explicit larger cap; the second phase does not
  receive a fresh timer. Default and configured expiry abort at their boundaries.
- N22C — Aggregate deadline: shorter capture remainder wins, including cumulative
  stages, no admission before expiry and honest post-admission classification/
  rationale failure. Transactional and cleanup protections remain intact.
- N22D — Isolation: two simultaneous cores sharing one frozen model use their
  own configured budgets; neither modifies the model or the other's calls.
- N22E — Snapshot: changing the original constructor object after opening or
  during an outstanding call changes neither current nor subsequent call caps.
- N22F — Receiver compatibility: methods/counters/qualification-fit keep their
  original receiver, including a class with private fields and a recall-witness
  facade. No timeout field enters the counted/model-facing request.
- N22G — Complete forwarding: exercise all ten sites: extract, qualify,
  qualifyCandidates, reconcile, classify, relate, select, rank, reviewBasis and
  interpretEpisode. Include standalone operations and episode batch/lazy/end.
- N22H — Termination: actual timeout preserves genuine core AbortSignal
  provenance and adapter cancellation; external cancellation/forged errors do
  not mint provenance. Late resolution/rejection causes no admission or further
  model calls; fake HTTP settlement remains conservative and no retry occurs.
- N22I — Workspace/gates: fresh owned fixtures use `createTestWorkspace` with
  immediate deferred resource teardown, and canonical invocation runner. Keyless
  Node 22.16/24.15 probes are serial (`--test-concurrency=1`); success and intended
  assertion/setup failure clean their workspaces. Record actual exits, final
  file-list cross-check/count, and exact candidate bytes. Primary runs full
  CONTRIBUTING gates and independent Standards/Spec reviews before delivery.

## Scope and caller audit

Production core allowlist (11 files): contract, model-call, capture,
automatic-qualification, qualification-candidates, ordered-capture,
classification, rationale, source-basis, recall, episode-capture. The nine
direct-caller modules contain ten call sites; independently cross-checked
model-call imports against call-site searches. `capture-deadline.remainingMs`
already accepts a ceiling argument. Automatic rationale uses a contract-owned
operation closure; counting-only packing/fetch/session-context helpers need no
new timer option.

Existing model wrappers to preserve: long-history recall witness; architecture
augmented/checklist/full-label selection and small-candidate retention models.
MCP's primary core and temporary episode keeper, Hermes hosts and evaluation
constructors keep their existing defaults; no activation is in this packet.
The installed-core deadline bridge hashes existing model-call dependencies;
keep imports unchanged so its dependency list does not need expansion.

Allowed supporting edits: focused core tests and one synthetic adapter/guard
integration test if needed; capture, model-input-budgets, protocol, limitations
documentation and CHANGELOG. No private/live/operator changes, provider calls,
new benchmark profiles, cap/lease/schema changes, relaxed validation,
output truncation or deduplication changes. No worker commit/push.

## Evidence and handoff

Before production edits, run a new-option RED that fails specifically because
the constructor does not yet support the option, alongside default regressions.
Then run focused acceptance on both runtimes. Implementation evidence will be
appended here; full gates, candidate commit, two independent reviews, push/PR and
CI are primary-owned and remain incomplete until their actual results exist.

### Worker verification (2026-10-08)

Prepatch RED: the new constructor acceptance test on exact Node 22.16.0
exited 1 (`invalid_input` from the unsupported constructor option). The existing
`core/test/model-call.test.mjs` baseline exited 0, 5/5. After implementation,
constructor plus baseline exited 0, 6/6. The initial combined focus passed 45/45
(exit 0); its two short real-delay cumulative tests were subsequently replaced,
not accepted as evidence of load-independent timing.

The final deterministic cumulative helper installs the monotonic clock before
importing the real core in an isolated child. Both scenarios first show an
explicit 60000 call cap surviving 30001 and expiring at 60000. They then advance
extraction/qualification by 20000 each: aggregate 35000 refuses admission at
40000; aggregate 60000 permits admission, then classification advances another
30000 and returns honest classification/rationale failure at 70000. No small
wall-clock margin determines these outcomes. Existing clock helpers and their
counterfactual source targets are unchanged.

Historical four-file regression command (before the final N22F strengthening,
run once per exact runtime below):

```sh
env -i PATH=/usr/bin:/bin /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs --test --test-concurrency=1 core/test/model-call-timeout.test.mjs core/test/model-call.test.mjs core/test/capture-invocation-deadline.test.mjs evaluation/live/test/model-call-timeout.test.mjs
env -i PATH=/usr/bin:/bin /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --test --test-concurrency=1 core/test/model-call-timeout.test.mjs core/test/model-call.test.mjs core/test/capture-invocation-deadline.test.mjs evaluation/live/test/model-call-timeout.test.mjs
```

Both exited 0, 47/47 (20.860s and 21.792s respectively). After adding late
rejection alongside late resolution to the existing N22H test, reran the same
commands with only the new core and adapter test paths: both exited 0, 23/23
(3.830s and 3.829s). These are historical pre-strengthening test bytes. The 21 new core tests remain
dependency-free; the two real-adapter/fake-HTTP tests live under evaluation/live
because core CI does not install adapter dependencies. The integration probes
measure the complete guarded adapter invocation, not pure provider latency.
They preserve conservative unknown settlement after cancellation and late
response, with no second generation attempt. No provider request was made.

Test-development failures were retained as actual failures: the initial fake
HTTP fixture used a non-UUID ledger identity (exit 1); the next used nonexistent
guard inspection APIs and assumed diagnostic callback ordering (exit 1); a
follow-up capture with an unadvanced fake timer caused one cancelled test
(exit 1). Corrected fixtures use the existing guard state API and assert both
diagnostic layers without imposing order; final targeted tests exited 0, 2/2
before the final combined runs. None required a production change.

Lifecycle probe retained at
`/tmp/cairn-n22-cleanup-evidence.poaAwDF5/lifecycle.test.mjs`: a fresh owned
fixture creates the database and immediately defers core teardown. Canonical
runner success exited 0 and deliberate assertion-after-creation failure exited 1
on both exact runtimes. `fs.readdirSync` and independent `find -mindepth 1`
both observed zero entries in its owned scratch parent after every run; find
exited 0. The first lifecycle driver exited 1 because it assumed Node 24's
default reporter used TAP; forcing `--test-reporter=tap` fixed only that probe
assertion and the final four-run driver exited 0. No historical temporary
directory was removed.

Final file manifest was mechanically cross-checked: `git diff --name-only` plus
untracked `git ls-files --others --exclude-standard` against independent
`git status --porcelain=v1`; both agree on 20 files (11 production core, three
test/helper, six documentation/plan/changelog). `git diff --check` exited 0.
Ordered `path:sha256\n` digests at that historical handoff:

- Production core (11): `a43850f661c472eb4f756739c14c0c6628cf3a5dae346c553422a8e8e9602f32`.
- Tests/helper (3): `f1259087396bcbf2efe3d8de9485f051d40f486fa0e0dec5b7ee2404b194fbc0`.

Primary acceptance subsequently identified that N22F's qualification-fit arrow
function captured lexical `this` and its aggregate counter did not prove the fit
check ran. The test-only correction uses an own data-property normal function
with a dynamic receiver assertion and private `#fitCalls`; a separate positive
fit-call assertion proves execution. Counter, extract, qualifyCandidates and
classify also assert the original model receiver. No production bytes changed.

The worker reran the new core and adapter test paths serially on exact Node
22.16.0 and 24.15.0: both exited 0, 23/23 (5.962s and 6.054s). Primary independently
reran the same final 23-test focus on both runtimes, both actual exit 0. Final
tests/helper (3) digest:
`f83bae578407de77da854879f6f0d97d233163795d37f7531cd9208247c9ad90`.
The production core (11) digest remains
`a43850f661c472eb4f756739c14c0c6628cf3a5dae346c553422a8e8e9602f32`.
Primary's full Node 22 core gate started before this final test-only correction
and subsequently exited 0, 1213 tests; it is not a clean final-byte full-suite
run. The final full Node 24 core gate was still running at this record.

Full gates, candidate commit, independent reviews and PR delivery remain
primary-owned. Worker made no commit/push and did not touch the frozen runtime,
live operator, evaluation inputs or provider configuration. The retained Q4
witness does not establish the cause of adapter lateness, and this prospective
configuration does not claim to fix that historical case.
