# Bounded installed-Hermes diagnostic collection

Base: 364e2497e416218ce4683173b396606bc1ba105e (PR #40–#42 merged).

## Acceptance

- H1: `runHermesValueExperiment` has an explicit optional boolean
  `collectDiagnostics` (default false). Disabled calls retain existing report
  shape/behavior. Enabled stages collect existing model diagnostic events from
  the actual installed MCP/OpenAI/core path, not reconstructed public errors.
  No prompt/model/limit/acceptance changes, retries or paid invocation by tests.
- H2: Each executed stage gets a distinct operator-owned private diagnostic
  directory. A bounded cross-process collector preserves at most 64 fixed event
  slots per stage, each at most 256 bytes, using exclusive creation and 0600 files
  in a 0700 real directory. No overwriting, symlink following, unbounded journal,
  arbitrary filenames or raw payloads. Concurrent writers cannot exceed slots.
  Read at most the fixed slots with bounded reads after the child settles.
- H3: Reproject the existing finite `{version,stage,layer,reason}` event schema
  at write and read boundaries. Reject extra/forged fields, invalid enums and
  code-shaped private strings. Per-stage report diagnostic field contains only
  bounded events and fixed collection metadata, never diagnostic paths, raw
  bytes, model text, keys, IDs or error messages. Collection overflow/corruption
  is explicit; empty events are not proof no failure occurred. Observer write
  errors must not replace operation results. No stdout MCP pollution.
- H4: Launcher config strictly validates the optional diagnostic directory,
  installs callback only when enabled and uses new installed diagnostic helper.
  Before model traffic, verify installed runtime files against current source
  via the reviewed artifact allowlist, including the new helper, rather than
  only checking the former four files. Record exact runtime/collector hashes
  for enabled evidence. Existing installed artifacts must be rebuilt.
- H5: Offline tests cover collector privacy/bounds/concurrent processes,
  malformed/truncated/symlinked files, disabled behavior and source mismatches.
  With the pinned actual Hermes host, fresh installed artifact and fake HTTP,
  verify a successful lifecycle and an injected invalid select/rank response:
  actual failure diagnostic reaches the stage report, lifecycle halts, later
  stages remain not-run, and failure is not marked successful.
- H6: Run live-offline suite on Node 22.16/24, actual opt-in pinned host gate on
  both, plugin/JSON/pinned validation and relevant installed artifact checks.
  Primary personally reruns critical paths; separate implementation/test agents
  and final independent Standards/Spec review. No keys, new paid calls, private
  app changes, merges, deployment or releases in this implementation slice.

## Interpretation and later work

Slot order is reservation order, not a global model-call trace or exactly-once
operation counter. Nested layers can report one failure more than once. No
callback/filesystem mechanism proves delivery after arbitrary process crashes;
capacity/corruption markers are diagnostic limits, not a product failure cause.
Retain all old evidence unchanged. A new live trial still needs a frozen scope,
the original durable budget identity and explicit credential handling; do not
create a new ledger or rerun until green. Historical missing causes cannot be
recovered by this collector. Fix the real recall defect only after evidence
identifies its failing boundary.

## Verification receipt (2026-09-11)

Primary ran the full live-offline suite with all six explicit Hermes fixture
variables on Node22.16.0 and24.15.0: 26 passed, no skips. The pinned host was
Hermes0.21.1 at c8aa5608c24e3636e77c267650c0f1f52e44adb0 with its Python3.11.12
virtual environment. Both successful A–F/control runs used 25 scripted HTTP
requests, with diagnostics disabled and enabled. Injected select and rank
malformed refs each produced `core_validation / malformed_refs`, failed B,
left C–F not-run and completed the separate control. This is actual installed
host dispatch with fake HTTP, not real-model quality evidence.

The initial test expected an adapter `output_shape` event; observed behavior and
core validation showed malformed refs are rejected at the core boundary. That
test expectation was corrected, not the runtime or acceptance predicate. A
launcher test initially failed too early on the fixture's package name; its
fixture was corrected and a valid-directory positive control was added. Primary
reran that final launcher test separately on both runtimes.

Generic live-offline invocation without the host variables: 20 passed, six
explicit host skips. Artifact tests: 14/14 on each runtime, including fresh
offline installs. Archive SHA256:
`d8e045376c340103b51a4716e1706be44c20fef3fac78f68f5aafccc6d029f27`.
Plugin tests: 31/31 and JSON/version validation passed on both runtimes. Pinned
Claude2.1.260 marketplace and strict plugin validation passed. No TypeScript
gate exists in this JavaScript repository. No provider key or paid call was used.

Commands: `npm run test:artifact`, `npm test`, `npm run validate`,
`npm run test:live-evidence-offline`, plus the same live suite with the six
fixture variables documented in `docs/live-value-evidence.md`. Pinned Claude
commands: `claude plugin validate .` and
`claude plugin validate plugins/cairn-memory --strict`.
