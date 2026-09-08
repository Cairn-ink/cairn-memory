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

## Bounded actual-model native-provider probe

The DRI's separate [sanitized report](../integrations/hermes/evidence/native-live-v1.json)
records a passed native discovery/MemoryManager lifecycle: session A explicitly
remembered a synthetic fact and inspected its receipt; after shutdown, a new
manager/session B recalled the same ID, content and receipt with the real model;
forgetting it then produced an empty recall. The latest persisted UUID identity
implementation and the installed archive above were used.

The provider bridge and installed engine were unchanged. A test-only `node_path`
wrapper added budget preloading (US$0.03 / six HTTP requests per subprocess,
at most two recall invocations). The dedicated key was supplied out-of-band,
never persisted in provider JSON or report. Six HTTP responses were all 200;
US$0.026688 was reserved, with US$0.000608 observed usage estimate (not an invoice).
The cumulative campaign reservation is US$3.006848 of US$5, leaving US$1.993152.
Offline tests remain key-free; the worker made no paid requests.

This proves bounded native host/tool lifecycle and actual-model recall, not
interactive AIAgent tool selection, upstream listing, other versions or general
semantic quality. The
separate frozen suite still fails source-support acceptance; this cannot waive
that release gate.
