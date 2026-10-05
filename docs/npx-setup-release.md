# One-command installer release checklist

chichi approves this release. Merging into this repository is a release;
publishing to npm is outward-facing. Building/testing does not authorize merge,
publish, tags or pushing to main.

chichi 核准這次 release。合併進 repo 就是 release，npm publish 是對外發布。
完成建置與測試，不代表核准合併、發布、tag 或 push 到 main。

- [ ] Review delivered patches and recorded checks; approve the release before
  merging or publishing. Confirm npm scope access and `@cairn-ink/memory`.
  Unscoped `cairn-memory` is owned by someone else.
- [ ] Confirm the proposed initial installer version **0.1.0** in
  `packages/setup/package.json`. Future releases explicitly bump this version.
  It is independent of plugin versions. If plugin changes ship too, bump plugin,
  marketplace and runtime versions together per `CONTRIBUTING.md`.
- [ ] Move the installer entry in root `CHANGELOG.md` from Unreleased to the
  approved installer version/date. Keep plugin release notes separate.
- [ ] On Node **22.16.0** and **24.15.0**, install isolated maintainer dependencies
  per `CONTRIBUTING.md`; first check each `node_modules` for a shared symlink.
  Run the following from the repository root, recording actual exit codes:

  ```sh
  npm run test:setup
  npm test
  npm run validate
  npm run validate --prefix tools/plugin-validation
  node tools/testing/run.mjs --script packaging/prepare-cache.mjs
  npm run test:artifact
  ```

- [ ] Resolve any failed or environment-limited checks before release.
- [ ] Build and inspect the archive from `packages/setup`. Cross-check npm's
  file list against `tar -tzf`, and print the count. Expect only `package.json`,
  `LICENSE`, `README.md`, `bin/memory.mjs`, `lib/setup.mjs`.

  ```sh
  cd packages/setup
  npm pack --ignore-scripts --json --pack-destination /tmp
  ```

- [ ] In a disposable Claude Code profile, verify packed `setup --dry-run`,
  `setup`, `status`, masked PAT input, Claude-owned storage, restart hook loading
  and confirmed legacy MCP removal. Validate the actual hosted PAT page and
  compatible service. Never put a PAT in arguments or logs.
- [ ] Check current CLI and older fallback. `configure --values-stdin` requires
  Claude Code 2.1.285+; setup checks actual help output.
- [ ] After chichi approves, publish **from the package directory**:

  ```sh
  cd packages/setup
  npm publish --access public
  ```

- [ ] After successful publication, remove “not published yet” caveats from root,
  plugin and package READMEs. Verify registry name/version and smoke-test
  `npx @cairn-ink/memory setup --dry-run` in a clean temporary profile. This does
  not publish the local SQLite preview under `packaging/`.

## CLI verification boundary

Sources: [plugin command reference](https://code.claude.com/docs/en/plugins/cli-reference)
and [userConfig](https://code.claude.com/docs/en/plugins-reference#user-configuration).
The helper uses marketplace add/install and `configure --values-stdin`, not
token-bearing `install --config` arguments.

The PAT URL comes from existing repo instructions. Opening it is a manual PAT
handoff; no Cairn pairing/device-code API was verified or added. Fake-CLI tests
verify commands and secret handling, not production authentication, OS credential
storage, hosted service support or hooks in a signed-in session.
