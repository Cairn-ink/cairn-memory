# Local install artifact

This package builds a private local npm archive of the same public core and MCP
host. It does not publish to npm, deploy a service or create a second engine.
The preview name/version is `cairn-memory-local-preview@0.0.0-preview.1`;
a future registry release needs a separate naming/version/release decision.

For explicit default-off Claude Code/Codex foreground capture, the installed
binary has a separate `local --help` path. See the [closed request and operator
sequence](raw-local-journal.md#explicit-standalone-foreground-setup-preview):
new-store-only `local init`, existing-store-only `local setup`, read-only status,
explicit activation and SQL-first disable. This does not change MCP startup or
the released hosted setup helper. The foreground 160-second hook timeout,
separate consents, explicit private HOME/source root and shared usage/target
binding must be chosen before activation. No provider key is required for these
setup actions, and no credential is copied to their files. Native-client and
semantic/provider acceptance remain distinct from the offline synthetic chain.

The archive includes the [asynchronous topic reader](topic-overview.md) and its
fixed Worker closure. The installed regression independently walks imports and
the Worker URL, compares the five reader modules with the archive allowlist and
source hashes, and executes public reads from installed bytes in a separate
synthetic process. It checks lazy startup, bounded continuation, counts, optional
refs, unchanged database bytes and awaited close. No checkout runtime fallback
or model service is used. Capture-flow tests retain complete required archive
and source-hash coverage while distinguishing eagerly observed imports from
literal Worker-only dependencies. Shared dependencies remain eager when any
eager path reaches them; observed eager imports must match exactly, not merely
form a subset. Separate installed reader cases actually start and close the
fixed Worker with empty application environment and `execArgv`, and exercise
physical legacy layouts plus schema 29 capture-derived Memory metadata.

## Build and inspect

Use Node >=22.16, npm and `tar` from the repository root:

```sh
npm run build:artifact
```

The build creates a fresh temporary staging directory and prints the archive's
absolute path, exact version, SHA-256, byte size and inspected archive file list.
It also retains `build-report.json` beside the archive. No files are written into
the source checkout. It runs `npm pack --offline --ignore-scripts`, never publish.

`packaging/artifact-files.json` explicitly names runtime sources. The builder
copies those files without rewriting engine/host code, adds its small executable
wrapper, README and license notices, and generates the private manifest and
production npm-shrinkwrap. It then compares the actual `tar -tzf` contents with
the exact allowlist and records source-file SHA-256 values. Tests compare the
installed bytes too. Tests, fixtures, databases, reports, local configuration,
environment files and node_modules are not packaged.

The allowlist also includes `evaluation/live/diagnostics.mjs`, a local collector
with no additional npm dependencies, used only by the opt-in Hermes experiment launcher. No other
experiment runners or credentials are included, and the consumer executable
does not enable it. See [collection boundaries](model-failure-diagnostics.md#installed-hermes-collection).

The production closure is pinned to SDK server/core 2.3.1, Zod 4.6.7 and
tiktoken 1.0.22 using the existing adapter lockfiles' exact versions, registry URLs
and integrity values. Builds fail on unreviewed dependency changes. No dependency
is bundled or downloaded by an install lifecycle script; npm itself retrieves
the pinned archives. See [third-party notices](../packaging/THIRD_PARTY_NOTICES.md).

Follow the [installed README](../packaging/README.md) for local installation,
explicit db/owner/project startup, tool inspection/correction/forgetting, backups,
same-schema upgrade, uninstall and troubleshooting. Initialize a dedicated local
installation project first and use `--prefix .`, so npm cannot walk up to an
unrelated ancestor project. Keep the memory database outside node_modules.

## Explicit programmatic Raw opt-in

The private archive includes the public `openMemoryCore({rawConversations})`
composition and its actual import/asset closure. The internal `raw-capture.mjs`
compatibility factory stays uninstalled. See the [constructor contract and
threat boundary](raw-local-journal.md#explicit-public-constructor-p4b-b1).
Omission preserves the existing ordinary facade; existing MCP startup, CLI
configuration and installed hooks do not enable Raw automatically.

Synthetic installed tests run both client identities through fresh-process
first-part replay, exact multipart reads, a bare Raw-backed explicitly authored
Card, revision-bound deletion and cold invalidation/action replay. They import
only installed engine bytes and verify those bytes against the archive/source
hashes, with an independent source graph and actual Node import/asset trace.
This is programmatic lifecycle evidence, not completed installed-client/MCP
capture or semantic-quality evidence. The [skipped-tail barrier recovery gap](limitations.md#public-raw-constructor-p4b-b1)
remains a later correction before full installed-hook acceptance.

## Verification and compatibility

Populate dependency caches once, then run offline artifact tests:

```sh
npm ci --prefix adapters/mcp
npm ci --prefix adapters/openai
node packaging/prepare-cache.mjs
npm run test:artifact
```

The two `npm ci` commands download dependencies; the explicit preparation command
fetches public registry metadata for the four pinned production dependencies.
`npm ci` alone caches tarballs but is insufficient for the later offline install.
`node packaging/verify-clean-cache.mjs` separately reproduces this boundary with
a fresh isolated cache: it records the unprepared baseline and requires installation
to pass after preparation. This CI regression uses network access; ordinary artifact tests do not.
The artifact tests then
use `npm install --offline --ignore-scripts` into initialized, explicitly prefixed
synthetic temporary projects. Tests exercise real installed subprocess stdio,
not a source-checkout executable. They retain artifacts, install directories and
synthetic databases for inspection; nothing is globally installed.

| Surface | Evidence / status |
| --- | --- |
| Official SDK client 2.0.0 → installed stdio executable, Linux x64, Node 22.16.0 (recorded before the SDK 2.3.1 update) | Artifact tests cover contents/closure, lifecycle/restart, isolation/revisions, same-schema upgrade/uninstall and ancestor-project isolation |
| Same installed SDK 2.0.0/stdio path, Node 24.20.0 | Same offline installed-artifact verification; no semantic or named-client claim |
| Installed host with actual OpenAI model and new process | Passed: remember → restart → recall with exact source receipt → forget → empty recall; six actual HTTP requests |
| Hermes0.21.1, commit c8aa5608c24e3636e77c267650c0f1f52e44adb0, Linux x64, Node22.16.0 | Actual `hermes mcp test cairn` connected and discovered all five tools; discovery only, no chat/native memory-provider acceptance |
| Claude, Codex, ChatGPT or other named clients | Not verified by this package; no compatibility badge |
| Pinned Hermes0.21.1 general MCP client and native provider, actual AIAgent loop | [Synthetic completion / real dispatch cross-session test](hermes-agent-loop.md) passed on Node22.16/24.20; not real-model tool selection or semantic recall |
| Remote HTTP/OAuth connectors | Not implemented in this package |

Model-free installed tests cannot establish semantic recall. Without a key,
recall returns `model_not_configured`; no lexical fallback is introduced. MCP
does not imply automatic capture. General semantic quality remains a separate
release gate: the frozen full suite still fails source support. The narrow
installed lifecycle and Hermes discovery do not override that result. See
[I01–I08 acceptance and exact artifact hash](plans/install-artifact.md).

The [profile integration](plans/profile-artifact-integration.md) adds the shared
`adapters/openai/profiles.mjs` runtime module and an installed-import regression.
MCP keeps its existing default model and has no extraction-profile CLI option.
The separately measured experimental profile requires explicit programmatic
`createOpenAIModel({ apiKey, extractionModel: 'gpt-5.4-mini-2026-03-17' })`
configuration; its source-level quality evidence does not certify MCP capture
or the new archive's model-backed recall.
