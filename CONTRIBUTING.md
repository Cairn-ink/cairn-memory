# Contributing

Thanks for helping make agent memory smaller, safer, and easier to inspect.

## Where to record evaluation limitations

Retained failures, frozen evaluation results and claims the evidence does not
support belong in [`docs/limitations.md`](docs/limitations.md), not in the
README. The README's first screen stays short and links there. A PR that adds
or revises evidence appends to or edits `docs/limitations.md` and, when a gate
changes, `ROADMAP.md`.

## Before opening a pull request

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

For `evaluation/longmemeval` changes, run `npm run test:longmemeval` and
`npm run demo:longmemeval-ingestion` on Node 22.16 and 24, in addition to the
generic checks above. Tests cover preparation and source-mapped ingestion;
the demo uses scripted models and a fresh synthetic SQLite store. No downloaded
corpus, provider key or paid run is required. See `docs/longmemeval-ingestion.md`
for source reconstruction, normalization and remaining evaluation boundaries.

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
running `node packaging/prepare-cache.mjs`:
`CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs`.
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
then explicitly run `node packaging/prepare-cache.mjs` (public registry metadata
requests), followed by `npm run test:artifact` on Node22.16 and24. `npm ci` alone
does not populate the metadata needed by an offline nested-shrinkwrap install.
CI also runs `node packaging/verify-clean-cache.mjs`, a network-enabled fresh-cache
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

For the experiment HTTP guard, also run `npm run test:experiment-request-guard`
and `npm run demo:experiment-request-guard` on Node 22.16 and 24, after installing
the isolated OpenAI adapter dependencies above. These exercise guarded fake HTTP
and synthetic ledgers, not paid requests or a configured Hermes profile. See
`docs/experiment-request-guard.md`; passing this gate does not authorize a live run.

For public pilot runner changes (`evaluation/live/public-pilot.mjs`,
`evaluation/live/public-pilot-merge.mjs`, `evaluation/live/public-pilot-cli.mjs`
and their tests), run
`npm run test:live-evidence-offline` on Node 22.16 and 24 with both adapters
installed, plus `npm run test:longmemeval` when the common bucket of
`aggregateOfficialScores` changes. These suites use fake HTTP only and never
read an environment key; see `docs/public-pilot-runner.md`. Passing them does
not authorize a paid run, which needs an operator-supplied key, the existing
campaign ledger and a frozen manifest.

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

For `integrations/hermes` changes, run the real pinned host's canonical test
runner as documented in `docs/hermes-memory-provider.md`, against an installed
local artifact. Use synthetic profiles only, no user keys or paid requests.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
