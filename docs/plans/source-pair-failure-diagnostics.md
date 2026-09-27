# Source-free failure evidence for the installed source-pair launcher

Fixed base: `5ec4793249df604ef63f56d7d9469a158b92a03c`.
Branch: `feat/source-pair-failure-diagnostics`. This is a dependent, offline-only
packet after the qualification budget repair. Primary owns scope and acceptance;
bounded implementation is delegated to GPT-6 Sol/high. No live call, operational
ledger/key/corpus access, merge, release or deployment is part of this packet.

## Why this is needed

The terminal development run retained a prefix `invalid_model_output` but no
method or rejecting boundary. Its cause is unknown. The shared core and adapter
already emit finite, source-free diagnostic events, and the installed Hermes
experiment already has a bounded collector. The installed source-pair launcher
does not attach that observer. Wire it into new runs without claiming to recover
missing historical evidence or changing the operation's outcome.

## Observable acceptance

- O1: Reuse `evaluation/live/diagnostics.mjs` and the existing finite core event
  vocabulary. Collect separately per case and arm using private directories;
  no source text, provider body, exception, key, dynamic ID, path or model value
  is added to an event. Preserve the existing 64-event/256-byte per-arm limits,
  finite overflow/corruption/write-failure flags and deliveryGuaranteed=false.
  Do not add a generic diagnostics or launch framework.
- O2: A model failure from the actual installed adapter/core appears under the
  correct arm with the emitted method/stage and rejecting boundary. Success is
  silent. No emitted event means unknown, never success or an inferred cause.
  Test real fake-HTTP qualification output rejection and core validation rejection.
- O3: Observation must not alter source-pair protocol identity, ingestion,
  qualification, answer/judge inputs, deadlines, request/cost ceilings, failure
  classification or fixed denominators. A failed observer must not turn a failed
  operation into success or replace its first error. Keep no-op diagnostics on
  success comparable to the prior launcher. Do not alter the public scorer.
- O4: Each arm's observer closes when its execution scope finishes (including
  throws/timeouts); late callbacks cannot write into a completed arm or a later
  arm/case. Retain failed-arm diagnostics even if no generation.json can be
  written. Use the existing execution scope lifecycle; add only a small local
  wrapper if needed and preserve its cancellation/return/error behavior.
- O5: Persist only bounded local diagnostic files and a bounded per-case
  projection, not raw transport data. Explicitly report collection unavailable
  or corrupt without masking the primary failure. Diagnostic persistence must
  not cause an extra provider call or attempt to repair the ledger. Operator
  output remains aggregate-only; no new model content on stdout.
- O6: Pin the reused collector in the launcher's harness hash set. Prior frozen
  plans remain immutable and are not automatically migrated or rerun. Record
  new-run-only behavior and privacy/retention boundaries in the diagnostics and
  launcher documentation, including current qualifier/reconcile/relation stages
  already supported by core. No new event fields or model vocabulary required.
- O7: Fake HTTP and synthetic stores/ledgers prove success, qualification and
  core-validation failures, observer failure/overflow, arm/case separation,
  post-scope late callback rejection, hash drift, and unchanged scores/cost/calls.
  Reuse existing installed launcher tests and collector tests where appropriate.
  Assert behavior rather than matching implementation source strings.

## Scope and gates

Allowed files: `evaluation/live/qualified-source-pair-launch.mjs`, its tests in
`packaging/test/qualified-source-pair-launch.test.mjs`, a narrowly scoped helper
or focused live test only if needed, `docs/model-failure-diagnostics.md`, the
existing launcher technical document, `docs/limitations.md`, and this plan.
Collector modification, if unexpectedly needed, requires primary re-scope.
No core, adapter runtime, guard, budget ledger, protocol/scorer, dependency,
packaging format, historical artifact or public score changes.

Inspect CONTRIBUTING before gates. Run focused installed tests with isolated
OpenAI/MCP dependencies and prepared offline packaging cache on Node22.16 and24.
Then relevant full packaging/live/guard/LongMem suites, generic tests/JSON and
pinned Claude validations on both runtimes. Main personally inspects and reruns
key integrated paths, freezes the candidate, obtains independent Standards and
Spec reviews against the original base, and delivers a dependent PR only after
exact-head CI and mergeability. Record commands, counts, limitations and owners
here. Offline observability is not semantic reliability or live run permission.

## Implementation and focused evidence checkpoint

Implementation owner: GPT-6 Sol/high. The only runtime edit is
`evaluation/live/qualified-source-pair-launch.mjs`; tests use the existing
installed launcher suite. Documentation edits are this plan,
`docs/model-failure-diagnostics.md`, `docs/qualified-source-pair-launch.md`,
and `docs/limitations.md`. The unchanged collector is pinned in the launcher's
closed harness hash set. Runtime SHA-256 at this checkpoint:
`aac74c8f0d00fd68fe88ad22356013dfc841e239a45e51195de315411263d888`;
test SHA-256:
`09b29308c925cc7e294f66f7c4663c5455324c4702f120dc53f4b2f314d4ac47`.
Both are frozen while primary runs full gates; they are not yet a candidate
commit or independent-review result.

The changed entrypoint remains the existing CLI → full preflight → installed
launcher → N generation → P scoring path. The launcher supplies one installed
model observer that reads an AsyncLocalStorage context bound to each exact arm
scope. A small wrapper delegates to the unchanged quota/guard scope and seals
that arm in both callback and outer `finally`; late descendants retain their
own sealed context and cannot write under another arm. Separate 0700 directories
hold the existing 64 × 256-byte finite event slots. A best-effort per-case
projection reads only those bounded slots. The terminal private report adds
source-free `diagnostics` counts for attempted cases and failed projection
writes when report persistence succeeds. Observer setup/read/write failure
cannot replace a first execution error; it emits no new request. Prior plans,
the halted R5 marker and ledger, and the public scorer are unchanged.

After isolated `npm ci --prefix adapters/openai`,
`npm ci --prefix adapters/mcp`, and `node packaging/prepare-cache.mjs`, the
focused installed command `node --test
packaging/test/qualified-source-pair-launch.test.mjs` passed 11/11 on Node
22.16.0 and 24.15.0. It covers no-op success, unchanged guarded attempts and
fixed denominators; real installed adapter `output_shape` versus core
`invalid_qualification` under distinct arms; next-case isolation; collector
corruption and overflow; projection-write failure metadata; rejection of a
delayed installed-adapter callback only after the prior case projection exists;
diagnostics retained despite a refused generation record; and collector hash
drift before key/claim. Existing collector-specific tests own detailed
64-slot/256-byte and unsafe-file behavior. Full suites, primary acceptance,
independent reviews and exact-head CI remain pending. These fake-HTTP tests
do not reveal the missing historical prefix cause or prove provider semantics.

## Primary verification checkpoint

Primary inspected all six scoped files and personally ran the final runtime
and test bytes on Node22.16.0 and24.15.0. Both packaging suites passed 82/82;
both live-offline suites passed 335 with 30 existing opt-in skips. Budget25,
guard227, LongMem128 and generic112 passed per runtime, as did JSON validation,
budget/guard and three LongMem demos, and pinned local Claude plugin validation.
No provider key or corpus was used. These are finite offline checks, not scores.

Two initial gate interruptions are retained rather than hidden by reruns:

- The primary initially installed the pinned Claude validation dependency with
  scripts disabled, leaving its native executable missing. Rebuilding that
  isolated pinned dependency restored it; plugin validation then passed on
  both runtimes. This required no repository or global-tool change.
- With both full runtime matrices and both packaging suites competing for
  resources, Node24's unchanged D6 guard test admitted its second memory but
  omitted classification's two requests. This test assigns just one second to
  each capture. The isolated test passed on both the original base and candidate.
  A private, source-free controlled probe delayed the classification boundary
  by 1.1 seconds and reproduced the exact missing routes, explicitly observing
  `classification.status=failed` / `model_timeout` while admission stayed intact.
  This matches the documented partial-classification contract; neither the guard,
  core nor that test changed in this packet. After the competing packaging jobs
  finished, the entire Node24 matrix passed, including all 227 guard tests.
  The load-sensitive test remains a limitation, not a production fix claimed here.

Primary also replayed the same installed synthetic success fixture against the
original launcher and this candidate: both used exactly 48 guarded requests and
444,880 microUSD of synthetic reservations, with identical method order and
fixed-roster score aggregate. This verifies observation did not add model work
or change that fixture's scoring; fake answers are not semantic quality evidence.
Independent full-base reviews and exact-head remote CI remain required.
