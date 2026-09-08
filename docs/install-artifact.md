# Local install artifact

This package builds a private local npm archive of the same public core and MCP
host. It does not publish to npm, deploy a service or create a second engine.
The preview name/version is `cairn-memory-local-preview@0.0.0-preview.1`;
a future registry release needs a separate naming/version/release decision.

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

The production closure is pinned to SDK server/core2.0.0, Zod4.5.4 and
tiktoken1.0.22 using the existing adapter lockfiles' exact versions, registry URLs
and integrity values. Builds fail on unreviewed dependency changes. No dependency
is bundled or downloaded by an install lifecycle script; npm itself retrieves
the pinned archives. See [third-party notices](../packaging/THIRD_PARTY_NOTICES.md).

Follow the [installed README](../packaging/README.md) for local installation,
explicit db/owner/project startup, tool inspection/correction/forgetting, backups,
same-schema upgrade, uninstall and troubleshooting. Initialize a dedicated local
installation project first and use `--prefix .`, so npm cannot walk up to an
unrelated ancestor project. Keep the memory database outside node_modules.

## Verification and compatibility

Populate dependency caches once, then run offline artifact tests:

```sh
npm ci --prefix adapters/mcp
npm ci --prefix adapters/openai
npm run test:artifact
```

The two `npm ci` commands may download dependencies. The artifact tests then
use `npm install --offline --ignore-scripts` into initialized, explicitly prefixed
synthetic temporary projects. Tests exercise real installed subprocess stdio,
not a source-checkout executable. They retain artifacts, install directories and
synthetic databases for inspection; nothing is globally installed.

| Surface | Evidence / status |
| --- | --- |
| Official SDK client2.0.0 → installed stdio executable, Linux x64, Node22.16.0 | Artifact tests cover contents/closure, lifecycle/restart, isolation/revisions, same-schema upgrade/uninstall and ancestor-project isolation |
| Same installed SDK/stdio path, Node24.20.0 | Same offline installed-artifact verification; no semantic or named-client claim |
| Installed host with actual OpenAI model and new session | Separate DRI-paid acceptance pending; no mock substitution |
| Claude, Codex, ChatGPT, Hermes or other named clients | Not verified by this package; no compatibility badge |
| Remote HTTP/OAuth connectors | Not implemented in this package |

Model-free installed tests cannot establish semantic recall. Without a key,
recall returns `model_not_configured`; no lexical fallback is introduced. MCP
does not imply automatic capture. General semantic quality remains a separate
release gate. See [I01–I08 acceptance](plans/install-artifact.md).
