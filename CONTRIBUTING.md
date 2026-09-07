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

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
