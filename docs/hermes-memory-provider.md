# Hermes native memory provider verification

See [setup and boundaries](../integrations/hermes/cairn/README.md). This is a
third-party `memory.provider: cairn` plugin, not a manual MCP config entry or a
Hermes core change. The installed public core executes all five tools.

Prepare Hermes 0.21.1 source revision
`c8aa5608c24e3636e77c267650c0f1f52e44adb0` with its development dependencies and
MCP SDK 2.0.0, and an inspected installed Cairn archive. From the Hermes checkout:

```sh
scripts/run_tests.sh /absolute/cairn/integrations/hermes/test/test_provider.py -- \
  --cairn-executable /absolute/install/node_modules/.bin/cairn-memory \
  --cairn-node /absolute/node -q -p no:cacheprovider
```

The canonical runner strips credentials. Tests use fresh temporary profiles,
real Hermes discovery and MemoryManager, actual installed MCP, no model calls.
The dedicated-key test observes a synthetic canary then removes it before
starting the child. Negative transport tests use controlled fake executables.

Coverage: availability without subprocess; schema discovery without profile DB;
deep-copied schemas; save/receipt inspection; new session/provider instance;
correction/stale rejection/forget; two-profile isolation; no-key recall; strict
inputs; non-primary/gateway rejection; inert hooks; invalid config; malformed
transport; timeout and active SDK-child shutdown.

Tested Linux x64, Python 3.11.12, MCP SDK 2.0.0, psutil 7.2.2, Node 22.16.0
and 24.20.0.
Installed archive SHA-256:
`708a72b597d2958bd5c37340c4b28559ba707829e6e7a65d69858e20bb976020`.
Five host tests passed on both Node versions, including complete-profile
relocation and corrupt identity.
The host source archive lacks `.git`, so the optional
bytecode-precompile step prints a git warning; actual tests run and return 0.

This proves host/tool lifecycle, not interactive model tool selection, paid
recall, upstream listing, other versions or general semantic quality. The
separate frozen suite still fails source-support acceptance; this cannot waive
that release gate.
