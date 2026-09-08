# Contributing

Thanks for helping make agent memory smaller, safer, and easier to inspect.

## Before opening a pull request

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

For admission-claim changes also run `npm run demo:admission`, which uses a fresh
synthetic SQLite database and handcrafted trusted inferred items, not extraction.

For capture changes also run `npm run demo:capture` on both core runtime versions.
Its injected scripted extractor verifies source binding and lifecycle, not model quality.

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
then run `npm run test:artifact` on Node22.16 and24. Tests build inspected private
archives and install them offline into explicitly prefixed temporary projects;
there are no model calls, global installs or registry publications. See
`docs/install-artifact.md` for packaging and dependency-cache boundaries.

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

For `integrations/hermes` changes, run the real pinned host's canonical test
runner as documented in `docs/hermes-memory-provider.md`, against an installed
local artifact. Use synthetic profiles only, no user keys or paid requests.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
