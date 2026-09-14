# Hermes native memory provider verification

See [setup and boundaries](../integrations/hermes/cairn/README.md). This is a
third-party `memory.provider: cairn` plugin, not a manual MCP config entry or a
Hermes core change. The installed public core executes the five default tools;
explicit native `capture_qualification: source-bound-v2` adds submitted capture
as a sixth tool. The historical evidence below predates this opt-in and does not
certify its semantic quality.

Newer [agent-loop verification](hermes-agent-loop.md) also covers the actual
AIAgent conversation loop for native-provider and general MCP-client routes,
with scripted completions and real tool dispatch. This does not turn the older
real-model MemoryManager probe below into a full real-model conversation test.

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

### Source-context preference: offline host verification

The optional native `recall_context: source-evidence` preference supplies the
source-only mode when a recall call omits both context and qualification options.
Explicit arguments still take precedence; absent preferences preserve existing
generated/qualified context. See the [setup guide](../integrations/hermes/cairn/README.md).

The canonical four-file matrix passed **16 tests on each of Node 22.16.0 and
24.15.0**, using the pinned Hermes checkout above and a separately built,
inspected, locally installed archive with SHA-256
`9b7c3b2ef0745b7878a0e7037201cc6e864ce275ed821251fcb0a570b9967b4a`.
The qualified lifecycle now observes 24 fake provider requests, including legacy
query-only recall and a new AIAgent query-only source recall after provider
restart; keyless cold inspection/replay adds zero. The fake model intentionally
supplies incorrect adopted interpretations, which remain inspectable but are
excluded from source context. Other tests cover explicit override preservation,
caller dictionary immutability and invalid configuration.

All profiles and data are synthetic. Agent completions and provider HTTP are
scripted, while discovery, dispatch, subprocess transport and installed storage
are real. This does not prove natural tool choice, truthful sources, general
answer quality or successful long-history capture. No provider key was used.

### Historical paid probe

The historical real-model probe in this section covers manual memory and recall,
not the newly opt-in capture tool. For the new mode's offline integration check,
run the same canonical command above with all four test paths:
`test_provider.py`, `test_agent_conversation.py`, `test_qualified_provider.py`
and `test_qualified_conversation.py` (each under `integrations/hermes/test/`).

Root verification passed all 15 tests on Node 22.16.0 and 24.15.0 against an
installed archive with SHA-256
`aa46bb1f4792dc7de514dee397708d6406066685b0668d2808b5e13a1007b2f5`.
The new lifecycle uses the real pinned MemoryManager, AIAgent routing and
installed MCP/core; a test-only explicit Node wrapper replaces provider fetch
with scripted responses. Sixteen fake provider requests occur before restart,
zero during keyless cold inspection/replay. A deliberately wrong adopted
interpretation remains inspectable but is absent from source-only rank/context.
Separate tests verify native setup, key isolation, applied deadlines and active
helper/SDK termination. No real credential or model service was used.
This is mechanical integration evidence, not natural tool selection, semantic
quality, or a claim of recovery from arbitrary operating-system process kills.

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
At that historical probe's completion, the cumulative campaign reservation was
US$3.006848 of US$5, leaving US$1.993152. This is not the current spendable balance;
later evaluation reservations are recorded in the delivery roadmap.
Offline tests remain key-free; the worker made no paid requests.

This proves bounded native host/tool lifecycle and actual-model recall, not
interactive AIAgent tool selection, upstream listing, other versions or general
semantic quality. The
separate frozen suite still fails source-support acceptance; this cannot waive
that release gate.
