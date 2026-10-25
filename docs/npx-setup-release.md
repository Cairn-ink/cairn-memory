# One-command installer release checklist

chichi approves this release. Merging into this repository is a release;
publishing to npm is outward-facing. Building/testing does not authorize merge,
publish, tags or pushing to main.

chichi 核准這次 release。合併進 repo 就是 release，npm publish 是對外發布。
完成建置與測試，不代表核准合併、發布、tag 或 push 到 main。

- [ ] Review delivered patches and recorded checks; approve the release before
  merging or publishing. Confirm npm scope access and `@cairn-ink/memory`.
  Unscoped `cairn-memory` is owned by someone else.
- [ ] Confirm installer version **0.6.0** (0.5.2 was published on 2026-10-13) in
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

- [ ] Run the 0.6.0 setup gates on **both Node versions**, first from the checkout
  for source-only documentation/build checks, then against the installed packed
  installer. The builder reads the adapter lockfiles; isolated `npm ci` alone
  does not prime the nested-shrinkwrap engine cache. In a network-enabled phase:

  ```sh
  CAIRN_SETUP_TEST_NETWORK=1 node packages/setup/test/engine-cache.mjs "$release_cache"
  node packages/setup/build-runtime.mjs --check
  ```

  Use an absolute private `release_cache` directory. Pack with prepack enabled,
  install the installer tarball with `npm install --offline --ignore-scripts
  --cache "$release_cache" --prefix "$release_install" <tarball>`, and run the suite from the checkout
  harness with `CAIRN_SETUP_TEST_PACKAGE` pointing at
  `$release_install/node_modules/@cairn-ink/memory`, `CAIRN_SETUP_NPM_CACHE` pointing
  at the primed cache, and `CAIRN_SETUP_NPM_OFFLINE=1`. Also set
  `CX5_PACKED_PACKAGE` to that installed package for the hosted packed-runtime
  gate. Record actual exit codes and skip reasons. Installed engine/MCP cases
  must run with the cache, not count cache-gated skips as acceptance.
- [ ] After priming, repeat the packed installer tests in a **no-network phase**
  with the same cache and offline flags. Confirm no auth/provider connections
  for local setup and keyless lifecycle tests. E01's synthetic key/provider
  preload must capture exactly its four fixture requests with nothing reaching
  the network. Do not use a real key. `--offline` constrains npm; use the release
  environment's network isolation to verify the broader no-network boundary.
- [ ] Record installer tarball packed/unpacked bytes, file count and SHA-256;
  compare with the previous release and explain the bundled engine size increase.
  For E02, diff `tar -tzf` against `runtime/engine/manifest.json`'s file list;
  independently derive the list from `packaging/artifact-files.json` plus builder
  extras/generated files. Verify every `sourceHashes` entry against source and
  every `generatedHashes` entry against extracted files; print both counts.
  E03 must compare installer npm JSON, package `files` plus disk, and tar listing,
  including all `runtime/` files. Require prepack `--check` to pass, the re-gzipped
  identical-archive drift warning to pass, and stale SHA/bytes/source hash to fail.
- [ ] Verify the fresh local/cloud question in both languages, client consent,
  explicit flags, and no writes for a fresh non-TTY run without a mode. Review
  keyless tools and the disclosures: no automatic local capture/recall; semantic
  recall needs a key; a tool environment's `OPENAI_API_KEY` is used by the engine
  and selected text goes to the provider. Setup's bounded Claude registration
  read extracts only named MCP registration fields, without credential-store
  access or use of authentication fields. Check `storage_busy` is described as
  retryable. Keep all engine opt-ins off.
- [ ] Run L06 against the immutable 0.5.3 git baseline (`b2513501`), including the
  injected-unrelated-difference normalizer regression. Normalize only installer
  versions and version-derived hosted runtime names/digests; copied runtime file
  contents and all other bytes/mutating-call order must still match.
- [ ] Verify local/cloud/mixed/unknown conflicts (including `--client` checking
  both tools), ordered hosted detach commands, orphan/invalid-descriptor
  recovery, interrupted setup, changed client homes, and missing Node repair.
  Check local status/dry-run do not start the engine. Exercise confirmed local
  uninstall, `--yes`, scoped uninstall with the other client retained,
  pending-setup scoped refusal, and `--purge-config` restrictions. Data must stay;
  retain engines when detachment of every recorded client cannot be proven.
- [ ] **M01 is manual release work:** install the packed 0.6.0 with real Claude
  Code and real Codex in a fresh private temporary `HOME`/`CODEX_HOME`. Run
  `setup --local`, call `remember_memory` from one tool and `inspect_memory` from
  the other, and record the same memory ID in the PR. With no model key,
  `recall_memory` must report `model_not_configured`. Record client versions and
  results; fake-CLI success does not replace this step. Linux/WSL are tested;
  macOS remains untested and native Windows local setup must refuse.
- [ ] The hosted `codex-hooks.test.mjs` suite has a known timing flake under load.
  Run serially with private scratch; retain the failing case, actual exit code
  and load evidence. Re-run that single test only after investigating it; do not
  drop the hosted gate or label an unexplained failure as a local-mode pass.
- [ ] Resolve any failed or environment-limited checks before release.
- [ ] Verify all setup cases in private temporary homes: both tools, Claude-only,
  Codex-only, neither, declining either/both, non-TTY, rerun adding the other in
  both directions, and unqualified Codex. Assert one browser grant for initial
  dual setup and equal project IDs. Codex-first reuse needs no new approval;
  Claude-first adds exactly one approved grant when adding Codex. Verify the
  default exec skip in the runtime; keep A7 inputs and plugin version unchanged.
  Non-TTY unscoped setup never consents or installs; status/dry-run remain usable.
  Verify kept credentials/endpoints, endpoint overrides requiring --reauthorize,
  conflicting endpoints, each localized Codex inspection failure, Codex credential
  reuse without an extra cache, Claude-first new approval without opening its
  host secret store, and Codex-only MCP fallback. Check optional Claude endpoint
  metadata, dry-run overrides and accurate reauthorization messages.
- [ ] Verify default 200/stored daily caps, both config flags, exec capture/recall
  default skips and opt-in capture, prompt-recall-off documentation/status,
  copyable recovery commands and Claude-only control failures. Exercise numbered
  memory-ID choices, explicit third-endpoint reauthorization and backup rollback.
- [ ] Use a fresh private TMPDIR (`mktemp -d`, mode 0700), then remove it.
  Do not read/write real `~/.claude`, `~/.codex` or credentials.
- [ ] Build and inspect the archive from `packages/setup`. Run `npm pack --dry-run`
  with the runtime-manifest prepack check. Derive the expected list from package
  `files` plus npm's automatic metadata files; independently cross-check against
  `npm pack --json` and `tar -tzf`, diff the lists and print the count. Prepack
  lifecycle text can precede npm JSON: capture stdout/stderr separately, then
  parse the trailing JSON array and validate its shape; do not JSON.parse the
  entire stdout blindly. Keep prepack enabled. Expect
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

- [ ] After successful 0.6.0 publication, remove its awaiting-publication caveats
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
