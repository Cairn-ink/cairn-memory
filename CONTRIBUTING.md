# Contributing

Thanks for helping make agent memory smaller, safer, and easier to inspect.

## Before opening a pull request

1. Keep changes inside the public boundary described in `docs/architecture.md`.
2. Preserve the privacy invariants in `docs/protocol.md`. New captured fields require an explicit threat-model update and tests.
3. Run `npm test` and `npm run validate` with Node.js 20 or newer. With Node.js 22 or newer, install the isolated maintainer tooling and run the Claude validations as documented in the root README.
4. Update `CHANGELOG.md` for user-visible behavior and bump plugin plus marketplace versions together for releases.

Please keep pull requests focused. A protocol change should include its schema, documentation, and conformance tests in the same PR.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
