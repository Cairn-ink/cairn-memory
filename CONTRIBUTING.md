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
For changes to the engine/model/MCP path, also run `npm ci --prefix runtime
--ignore-scripts` and `npm run test:mcp`. Real-model probes are explicit opt-in
commands with synthetic data and preinstalled weights; report their outcomes
separately from deterministic mock tests. Do not download models or call paid
providers implicitly as part of CI.
Use only synthetic temporary databases; never point tests at user or production
data. See `docs/local-store.md` for the preview's boundaries and retention limits.

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
