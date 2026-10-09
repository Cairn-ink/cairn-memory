# One-command installer release checklist

chichi approves this release. Merging into this repository is a release;
publishing to npm is outward-facing. Building/testing does not authorize merge,
publish, tags or pushing to main.

chichi 核准這次 release。合併進 repo 就是 release，npm publish 是對外發布。
完成建置與測試，不代表核准合併、發布、tag 或 push 到 main。

- [ ] Review delivered patches and recorded checks; approve the release before
  merging or publishing. Confirm npm scope access and `@cairn-ink/memory`.
  Unscoped `cairn-memory` is owned by someone else.
- [ ] Confirm installer version **0.4.0** (0.3.0 was published on 2026-10-10) in
  `packages/setup/package.json`. Future releases explicitly bump this version.
  It is independent of plugin versions. Plugin 0.3.2 includes the required
  hook credential-state fix. If plugin changes ship too, bump plugin,
  marketplace and runtime versions together per `CONTRIBUTING.md`.
- [ ] Move the installer entry in root `CHANGELOG.md` from Unreleased to the
  approved installer version/date. Keep plugin release notes separate.
- [ ] On Node **22.16.0** and **24.15.0**, install isolated maintainer dependencies
  per `CONTRIBUTING.md`; first check each `node_modules` for a shared symlink.
  Run the following from the repository root, recording actual exit codes:

  ```sh
  npm run test:setup
  npm test
  npm run test:pairing
  npm run test:codex
  npm run validate
  npm run validate --prefix tools/plugin-validation
  node tools/testing/run.mjs --script packaging/prepare-cache.mjs
  npm run test:artifact
  ```

- [ ] Resolve any failed or environment-limited checks before release.
- [ ] Verify all setup cases in private temporary homes: both tools, Claude-only,
  Codex-only, neither, declining either/both, non-TTY, rerun adding the other in
  both directions, and unqualified Codex. One browser grant and equal project IDs
  must be asserted. Keep frozen runtime/A7 inputs and plugin version unchanged.
  Non-TTY unscoped setup never consents or installs; status/dry-run remain usable.
- [ ] Use a private 0700 TMPDIR under `/tmp/claude-1000/`, then remove it.
  Do not read/write real `~/.claude`, `~/.codex` or credentials.
- [ ] Build and inspect the archive from `packages/setup`. Run `npm pack --dry-run`
  with the runtime-manifest prepack check. Derive the expected list from package
  `files` plus npm's automatic metadata files; independently cross-check against
  `npm pack --json` and `tar -tzf`, diff the lists and print the count. Expect
  `package.json`, `LICENSE`, `README.md`, `bin/`, `lib/` (including client/auth
  coordination), and the frozen `runtime/`; exclude tests and build-runtime.mjs.

  ```sh
  cd packages/setup
  npm pack --dry-run --json
  npm pack --json --pack-destination /tmp
  ```

- [ ] In a disposable Claude Code profile, verify packed `setup --dry-run`,
  `setup`, `status`, device-code approval, `--no-browser`, `--manual-token`,
  `--reauthorize`, Claude-owned storage, restart hook loading
  and confirmed legacy MCP removal. Validate the actual hosted PAT page and
  compatible service with CAIRN_CLI_AUTH_ENABLED. Verify 404/501 manual
  compatibility, interruption/configure-failure cancellation and expiry display.
  Never put a PAT or proof in arguments, environment, URLs or logs.
- [ ] Check current CLI and older fallback. `configure --values-stdin` requires
  Claude Code 2.1.285+; setup checks actual help output.
- [ ] After chichi approves, publish **from the package directory**:

  ```sh
  cd packages/setup
  npm publish --access public
  ```

- [ ] After successful 0.4.0 publication, remove its awaiting-publication caveats
  from root, plugin and package READMEs. Verify registry name/version and smoke-test
  `npx @cairn-ink/memory setup --dry-run` in a clean temporary profile. This does
  not publish the local SQLite preview under `packaging/`.

## CLI verification boundary

Sources: [plugin command reference](https://code.claude.com/docs/en/plugins/cli-reference)
and [userConfig](https://code.claude.com/docs/en/plugins-reference#user-configuration).
The helper uses marketplace add/install and `configure --values-stdin`, not
token-bearing `install --config` arguments.

The client implements the server's `/api/cli-auth/v1` contract: S256 device
proof, credential validation, secure stdin configuration and ACK/cancel.
The default flow opens a bare `/device` URL and requires manual code entry.
Generic create 404/501 falls back to hidden manual input per chichi's task;
5xx/TLS/protocol errors do not. Manual credential 404/501 saves unverified
configuration. Browser credentials expire after 180 days.

The setup suite exercises real HTTP/TLS parsers over duplex streams and IPC,
including HTTP/HTTPS proxies, CONNECT, CA trust, certificate rejection and
secret scans. The restricted environment rejects loopback binds with EPERM.
This does not establish deployed server, native desktop/browser, corporate
network, OS credential storage or signed-in hook behavior. Native OS and
hosted smoke checks above remain release work on chichi's laptop.
