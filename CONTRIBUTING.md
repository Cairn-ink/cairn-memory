# Contributing

Thanks for helping make agent memory smaller, safer, and easier to inspect.

## Where to record evaluation limitations

Retained failures, frozen evaluation results and claims the evidence does not
support belong in [`docs/limitations.md`](docs/limitations.md), not in the
README. The README's first screen stays short and links there. A PR that adds
or revises evidence appends to or edits `docs/limitations.md` and, when a gate
changes, `ROADMAP.md`.

## Before opening a pull request

Ordinary offline `npm test` and `test:*` suites use
`tools/testing/run.mjs`, which gives each invocation a fresh owned temporary
directory and removes it after the test processes finish, including assertion
and setup failures. Run a selected suite directly with
`node tools/testing/run.mjs --test-name-pattern='pattern' core/test/example.test.mjs`;
arguments, working directory and test concurrency are preserved. The opt-in
native suites keep their existing prerequisites. Paid/live commands are separate
and never wrapped by this runner.

New fixtures should use `createTestWorkspace(t, { prefix })` from
`tools/testing/workspace.mjs`. It registers teardown immediately; use
`workspace.defer(() => resource.close())` for resources that must close before
removal. Deferred callbacks run in reverse order and every callback is attempted;
cleanup errors fail the test. Shared file fixtures may pass `null` and call
`await workspace.cleanup()` in their outer `finally`/file teardown. The outer
runner also removes legacy scratch created under standard `TMPDIR`/`TMP`/`TEMP`.
It does not intercept arbitrary explicit paths or promise that every legacy
fixture disposes its files immediately. Public build/install output, demos,
formal evaluation databases and ledgers keep their existing retention contracts.
The runner owns only its newly created test directory. The parent `npm` process
starts first and may write its own Node compile cache (for example
`node-compile-cache`) into the caller's `TMPDIR`; that cache is outside the
test workspace and is not removed by this runner. For a strict parent-TMPDIR
residue probe, set `NODE_DISABLE_COMPILE_CACHE=1` on the parent npm invocation,
for example `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle`.
Other tool-managed caches remain governed by their own lifecycles; do not sweep
the caller's temporary directory to make a test probe pass.

Run `npm run test:workspace-lifecycle` on Node 22.16 and 24.15 with the isolated
OpenAI dependencies installed. It verifies real subprocess success/failure,
cleanup failures, concurrent/repeated runs, actual ordered/paired/semantic
fixtures and the sanitized packaging child environment. Packaging children
forward only validated standard temp paths in addition to their existing
allowlist; application environment and credentials remain excluded.

On supported POSIX hosts, the runner owns a child process group and waits for
its members to stop before cleanup; catchable SIGINT/SIGTERM/SIGHUP terminate
the group and escalate after two seconds. Linux excludes zombies awaiting the
host reaper using `/proc`; other POSIX hosts conservatively wait until the
kernel reports the whole group absent. An unverifiable group, including a
permission error or a group that remains visible after termination, fails and
retains scratch. Windows is unsupported: the runner fails before creating a
workspace or launching a child. The lifecycle gate is verified on Linux/WSL;
the other POSIX path is exercised by a simulated-platform process-group test,
not a native macOS run. Deliberately detached sessions, SIGKILL and host
crashes cannot guarantee cleanup. A replaced workspace root also fails and
is retained. No historical-directory sweep is performed. Direct `node --test`
commands bypass the invocation safety net.

CI utility scripts can use explicit `--script` mode, for example
`node tools/testing/run.mjs --script packaging/prepare-cache.mjs` and
`node tools/testing/run.mjs --script packaging/verify-clean-cache.mjs`.
These retain their public-registry network behavior and are separate from
offline tests. Standalone utility commands keep their existing behavior.

For `evaluation/live` changes, install the isolated OpenAI and MCP dependency
sets and run `npm run test:live-evidence-offline` on Node 22.16 and 24. These
tests never use a provider key or authorize paid calls. Actual pinned-host and
paid evidence requires an explicitly scoped synthetic experiment and one shared
durable budget; see `docs/plans/live-value-evidence.md`.

1. Keep changes inside the public boundary described in `docs/architecture.md`.
2. Preserve the privacy invariants in `docs/protocol.md`. New captured fields require an explicit threat-model update and tests.
3. Run `npm test` and `npm run validate` with Node.js 20 or newer. With Node.js 22 or newer, install the isolated maintainer tooling and run the Claude validations as documented in the root README.
4. Update `CHANGELOG.md` for user-visible behavior and bump plugin plus marketplace versions together for releases.

For changes to `core/` or its example, also run `npm run test:core` and
`npm run demo:store` on Node >=22.16. CI checks the minimum 22.16 runtime and
Node 24. There is no TypeScript/typecheck gate in this JavaScript repository.
Use only synthetic temporary databases; never point tests at user or production
data. See `docs/local-store.md` for the preview's boundaries and retention limits.

For MOC/classification changes also run `npm run demo:moc`. It uses a scripted
mock and a fresh SQLite file, not a model service or user database. Both core CI
runtime versions run this example as well.

For fetch/recall changes also run `npm run demo:recall`. Its scripted models test
orchestration, not semantic relevance. Both core CI runtime versions run it.

For historical evidence views also run `npm run demo:history` on both core
runtimes. It uses synthetic explicit supersession and a local token counter,
not model-generated updates, temporal inference or a hosted service.

For admission-claim changes also run `npm run demo:admission`, which uses a fresh
synthetic SQLite database and handcrafted trusted inferred items, not extraction.

For capture changes also run `npm run demo:capture` on both core runtime versions.
Its injected scripted extractor verifies source binding and lifecycle, not model quality.
For session episode changes also run `npm run demo:episodes` on both core runtimes.
For session-start context changes also run `npm run demo:session-context` on both core runtimes.

For `evaluation/longmemeval` changes, first install the existing locked isolated
OpenAI adapter dependency set with `npm ci --prefix adapters/openai`, then run
`npm run test:longmemeval` and `npm run demo:longmemeval-ingestion` on Node
22.16 and 24, in addition to the generic checks above. Tests cover preparation
and source-mapped ingestion; the demo uses scripted models and a fresh synthetic
SQLite store. No downloaded corpus, provider key or paid run is required. The
install is for evaluation imports only; it does not change the public core's
dependency surface. See `docs/longmemeval-ingestion.md` for source
reconstruction, normalization and remaining evaluation boundaries.

For comparison/scoring changes, also run `npm run demo:longmemeval-comparison`
on both runtimes. The same `test:longmemeval` suite includes these tests. This
demo compares three synthetic arms using scripted models and the real local
core; its diagnostic scores are not measured real-model accuracy. See
`docs/longmemeval-comparison.md` for scorer and model-facing data separation.
For the separately versioned public comparison/scorer, also run
`npm run demo:longmemeval-public` on both runtimes. This synthetic demo verifies
source-only evidence and official-style prompt plumbing, not real-model quality.
The optional reference-sidecar tests invoke Python 3 (standard library only)
on synthetic JSON. Install Python 3 for the LongMemEval maintainer test suite;
the public memory core and ordinary scorer do not invoke Python.

For conflict lifecycle changes also run `npm run demo:conflicts` on both core
runtime versions. It uses explicit synthetic hints, not semantic detection.

For index generation changes also run `npm run demo:rebuild` on both core
runtime versions. This validates existing organization without a model service.

For recall continuation changes also run `npm run demo:continuation` on both
core runtime versions. Its fixed counter/scripted model verifies traversal only.

For optional OpenAI adapter changes, run `npm ci --prefix adapters/openai`, then
`npm run test:openai` and `npm run demo:openai-offline` on both core runtimes.
These use fake HTTP and need no key. Real-provider tests require explicitly
approved credential scope and budget.
For qualification wire-format changes, also run the opt-in installed rationale
gate on both core runtimes after installing both adapter dependency sets and
running `node tools/testing/run.mjs --script packaging/prepare-cache.mjs`:
`CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node tools/testing/run.mjs evaluation/live/test/rationale-pilot.test.mjs`.
This is synthetic HTTP only. The ordinary offline evidence suite skips these
installed cases, so its success does not substitute for this CI gate.
The opt-in `npm run test:openai-live -- --live --budget-usd 0.25` uses synthetic
temporary data and paid requests; it is never a CI gate. Its budget and CLI
safety tests run within the ordinary offline adapter suite. See
`docs/plans/live-provider.md` for acceptance and `docs/openai-provider.md` for
credential and cumulative-budget handling.
For the isolated MCP host, `npm ci --prefix adapters/mcp` and `npm run test:mcp`
exercise actual stdio client/server calls using synthetic stores and scripted
models only. Run on both core Node versions; CI has a separate MCP matrix.
No key or paid request is needed. See `docs/standalone-mcp.md`.
For local artifact changes, install both isolated adapter dependency sets above,
then explicitly run `node tools/testing/run.mjs --script packaging/prepare-cache.mjs` (public registry metadata
requests), followed by `npm run test:artifact` on Node22.16 and24. `npm ci` alone
does not populate the metadata needed by an offline nested-shrinkwrap install.
CI also runs `node tools/testing/run.mjs --script packaging/verify-clean-cache.mjs`, a network-enabled fresh-cache
regression separate from ordinary offline tests. Tests build inspected private
archives and install them offline into explicitly prefixed temporary projects;
there are no model calls, global installs or registry publications. See
`docs/install-artifact.md` for packaging and dependency-cache boundaries.
Semantic evaluation scorer/runner tests also run in `npm run test:openai` with
fake HTTP. The opt-in `npm run eval:semantic -- --live --budget-usd 4.80` incurs
charges and is never run in CI. Freeze fixtures and rubric before scored calls;
retain failures and label independent semantic judgments honestly. See
`docs/semantic-evaluation.md`.

For `evaluation/experiment-budget` changes, run `npm run test:experiment-budget`
and `npm run demo:experiment-budget` on both Node 22.16 and 24, in addition to
the generic contributor checks above. These use synthetic temporary ledgers,
including real child processes; they do not call models or authorize paid runs.
See `docs/experiment-budget.md` for the ledger-only boundary and remaining
transport integration gates.
The same gate includes the maintainer-only exact orphan settlement's synthetic
history/target refusals, rollback/acknowledgement uncertainty and owned cleanup.
Never substitute an actual pending ledger for those fixtures or treat a passing
accounting gate as approval to settle, refund, recover answers or spend.

For the experiment HTTP guard, also run `npm run test:experiment-request-guard`
and `npm run demo:experiment-request-guard` on Node 22.16 and 24, after installing
the isolated OpenAI adapter dependencies above. These exercise guarded fake HTTP
and synthetic ledgers, not paid requests or a configured Hermes profile. See
`docs/experiment-request-guard.md`; passing this gate does not authorize a live run.

For the evaluation-only native Mem0 gateway, additionally run
`npm run test:mem0-native-gateway` on both Node 22.16 and 24. Its explicit
`npm run test:mem0-native-local` gate also requires pinned local
`CAIRN_MEM0_NATIVE_VENV_ROOT` and `CAIRN_MEM0_NATIVE_PYTHON_ROOT`, Linux
`bwrap`, and both Node versions. The Y16 startup regression additionally needs
host `/usr/bin/python3` with `os.pidfd_open` and
`signal.pidfd_send_signal`; this is test-only and does not change the pinned
Mem0 interpreter. Missing prerequisites fail this gate rather than count as a
skip. Both suites use new synthetic ledgers and fake HTTP; the
local gate imports installed Mem0 but never uses a provider key or operational
ledger. This is containment/accounting verification, not permission to spend.

For the controlled mixed Cairn/Mem0 runner, additionally run
`npm run demo:longmemeval-mixed` and the explicit `npm run test:mixed-native-local`
on Node 22.16 and 24.15 after `npm ci --prefix adapters/openai`. The demo is
pre-grant preparation/packing only. The local test requires the same pinned
native roots and Linux containment prerequisites as the Y gate, and exercises
fresh real Cairn and native Mem0 through one synthetic X ledger with fake HTTP.
Missing prerequisites fail, never skip as a pass. Do not supply a live key,
corpus or operational ledger. These gates do not establish a semantic score,
credential broker, resource fit or paid-run authorization.

For public pilot runner changes (`evaluation/live/public-pilot.mjs`,
`evaluation/live/public-pilot-merge.mjs`, `evaluation/live/public-pilot-cli.mjs`
and their tests), run `npm run test:live-evidence-offline` on Node 22.16 and 24
with both adapters installed, plus `npm run test:longmemeval` and
`npm run demo:longmemeval-public` on both runtimes when the common bucket of
`aggregateOfficialScores` changes. These suites use fake HTTP only and never
read an environment key; see `docs/public-pilot-runner.md`. Passing them does
not authorize a paid run, which needs an operator-supplied key, the existing
campaign ledger and a frozen manifest.

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

For `integrations/hermes` changes, run the real pinned host's canonical test
runner as documented in `docs/hermes-memory-provider.md`, against an installed
local artifact. Use synthetic profiles only, no user keys or paid requests.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
