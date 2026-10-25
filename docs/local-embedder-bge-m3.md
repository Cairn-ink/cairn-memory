# Optional local bge-m3 embedding

Local embedding is an explicit opt-in for `context-read-v1`. No embedder is
selected by default. OpenAI's adapter default remains `text-embedding-3-small`
with 1536 dimensions. A key, pack path or installed pack never selects a provider.
Local embedding keeps embedding text on this machine; other configured model
operations may still use hosted services.

The base package requires no Transformers.js, ONNX Runtime, Sharp or weights.
The separate pack uses `Xenova/bge-m3@4de13258303883538bd53b696b452bf8099f0858`,
FP32 CPU, CLS pooling, empty prefixes, 1024 dimensions and L2 normalization.
Transformers.js 3.7.6, ORT 1.21.0, Sharp 0.34.5 and libvips packages 1.2.4
are pinned in its reviewed release inventory. Inputs include special tokens;
8192 tokens are accepted and larger inputs are refused without truncation.

**Release prerequisite:** this checkout has no reviewed production release
catalog. Until approved manifest digests, artifact URLs/hashes, complete runtime
lock/native binaries and upstream MIT evidence are supplied, real packs are
refused. Research cache hashes are not an authenticity root. Fixture tests do
not qualify a release. Never replace the catalog with a user-supplied manifest.

## Installation and offline verification

```sh
cairn-memory model install bge-m3 --dir /absolute/new-pack
cairn-memory model verify bge-m3 --dir /absolute/copied-pack
cairn-memory model install bge-m3 --dir /absolute/new-pack --check-config
```

Only explicit installation may download, from exact catalog-approved HTTPS
URLs with redirects refused. Transfers have a 120-second idle and 30-minute total
limit per artifact, with archive/expansion bounds and every extracted file hashed.
Installation runs no npm lifecycle scripts, CUDA installers or compilation.
One immutable manifest can include both platforms' native targets and helpers.
Publication uses the manifest-bound `runtime/publish/<os>-<arch>-<libc>/cairn-publish` native helper for
atomic no-replacement. Release builders compile that helper before publishing
its reviewed binaries for every supported tuple; its Apache-2.0 source/provenance is bound in the pack.

An identical complete destination is idempotent; any different existing target
is `model_pack_conflict`. Updates use a new directory. Offline copying is allowed;
`verify` checks bytes, dependency/native inventory and compatibility without
loading a runtime. `runtimeStatus:'not-loaded'` is not a successful native-load
attestation. Missing/unsafe/corrupt/unapproved files are refused, including
external ONNX data, symlinks, hardlinks and extra files.

Management returns one JSON envelope and exit 0 on success, otherwise exit 1
with a sanitized nonretryable code. Codes include `invalid_model_configuration`,
`model_pack_conflict`, `model_pack_unavailable`, `model_pack_manifest_invalid`,
`model_pack_integrity`, `model_pack_license`, `model_pack_download_failed` and
`model_runtime_unavailable`. Hash-valid evidence without a confirmed MIT
model declaration cannot be published. Packs retain conversion/tokenizer
attribution, Apache-2.0/MIT notices and LGPL-3.0-or-later libvips source obligations.

## Selection and check mode

```sh
cairn-memory --db /absolute/store.sqlite --owner owner \
  --context-read context-read-v1 \
  --context-embedder local --context-embed-model bge-m3 \
  --context-embed-dimensions 1024 --context-embed-pack /absolute/pack \
  --context-embed-max-requests 100 --context-embed-threads 4

cairn-memory context refresh --db /absolute/store.sqlite --owner owner \
  --types memory,card --intent current --max-items 128 --max-ms 5000 \
  --context-embedder local --context-embed-model bge-m3 \
  --context-embed-dimensions 1024 --context-embed-pack /absolute/pack \
  --context-embed-max-requests 100
```

The provider/model/dimensions/pack/request fields are all required together.
Threads default to 4 (range 1–64); inter-op threads are 1, with sequential CPU
execution. Requests range from 1 to `Number.MAX_SAFE_INTEGER`. Pack paths are
absolute and normalized. Local USD flags and hosted/local mixtures are refused.
Existing `--project` and scope rules apply. Refresh does not accept `--context-read`.
Only explicit refresh embeds documents, one request and committed transaction
per document. Lookup embeds only its query after complete vector preflight;
`semantic:false`, missing coverage, cursors and evidence fetch do not embed.

Prefix startup with `--check-config`, or append it to refresh. Checks report the
local provider, pack, effective threads/limits, preset, qualification label,
`packStatus:'not-inspected'`, `revision:null`, and false runtime/child/network/key/
database/provider side-effect indicators. Even nonexistent pack directories are
not inspected. Syntax-only checks cannot attest readiness. Legacy/hosted check
responses retain their existing fields and semantics.

## Ownership, status and recovery

```js
import { createLocalContextEmbedding } from './adapters/local-embedder/index.mjs';
const local = await createLocalContextEmbedding({
  packPath: '/absolute/pack', threads: 4, maxRequests: 100,
});
try {
  const server = createCairnServer({
    path: '/absolute/store.sqlite', namespace,
    contextRead: 'context-read-v1',
    contextEmbedding: {
      embedder: local.embedder, policy: local.policy, localStatus: local.localStatus,
    },
  });
  // Use the synchronous server factory; close the server before the owner.
  await server.close();
} finally {
  await local.close();
}
```

The factory is asynchronous, SQLite-free at link time, verifies and warms before
returning, and never downloads. The caller awaits its idempotent `close()`.
CLI ownership covers ordinary close, EOF, signals and construction failure;
refresh closes in `finally`. Pack/runtime initialization failures reject
programmatic construction. CLI catches operational failures and retains a
configured unavailable provider so fresh lexical results remain usable.

The policy is exactly `{family:'local',maxRequests,maxConcurrent:1,maxBatchDocuments:1}`.
It has no USD fields or usage callbacks. Attempts and active slots are shared by
identity across handles/stores/query/refresh and retained after reopening.
Warm-up consumes no attempt. A crash, invoked token refusal or timeout consumes
an attempt. Another live handle cannot choose conflicting thread settings.
The last owner reaps the independent supervisor/inference bundle. Cancellation
and failure do not release capacity until complete termination is observed;
unconfirmed termination quarantines the identity. There is no automatic restart.

`localStatus()` synchronously returns a frozen `{state,reason}`: ready/null,
closed/closed, or unavailable with an enumerated pack/runtime/crash/protocol/
timeout reason. Search and refresh expose it at `trace.localEmbedder`; assembly
uses `diagnostics.candidates.trace.localEmbedder`, carried by MCP only in
`_meta['ink.cairn/context-read-diagnostics']`. Assembly error status is also only
in that diagnostic metadata, never its text block. It does not grant authority,
replace coverage or enter the assembly token budget. Invalid observers are
sanitized to unavailable/protocol_error. Existing authority/store errors still
suppress diagnostics. Legacy and hosted responses gain no local status field.

Pack revisions hash the entire canonical approved manifest. Changing only its
path preserves identity; changing any bound bytes changes revision. Switching
providers/manifests requires explicit process selection and resumable refresh.
Old vectors are reused only while every canonical key/fence remains valid.
No vectors are resized, relabelled or rebuilt implicitly. Refresh exit 0 alone
is insufficient: completion requires `status:'complete'` **and ready semantic
coverage for the selected identity**. Partial/rebuilding responses may exit 0.

Plan approximately 3 GB installed and 2.2 GB observed model RSS for the baseline,
with more disk space for staging and potentially higher near-limit peak RSS.
Vector/cache limits do not cap native RSS. Linux x64 (WSL2 on a Linux filesystem)
and macOS arm64 require qualification on Node 22.16.0 and 24.15.0. Other platforms
are unverified and may attempt use; missing binaries/ABI or supported supervision
still refuse `model_runtime_unavailable`. No Windows qualification is claimed.

Normal CI runs `test:local-embedder` with deterministic fake runtimes/children on
Node 22.16.0 and 24.15.0. Its publication fixture uses the development host's `cc`;
the installed package and installer do not require a compiler.

## Explicit qualification, outside ordinary CI

On exclusively reserved single-executor hosts, the primary first admits each
job through its machine-wide queue, provisions both exact Node toolchains/base
dependencies, and copies the complete official pack. No qualification step
installs, downloads, compiles or provisions a model. Set runner environment
`CAIRN_QUAL_TOOLCHAINS` to an absolute directory containing
`22.16.0/bin/node` and `24.15.0/bin/node` (and their npm commands).

The queue issues `CAIRN_QUAL_ADMISSION`, an absolute 0600 regular JSON lease:
`{commit,node,platform,arch,expiresAt,exclusive:true}`. It must match the tested
commit, exact cell Node/platform/architecture and remain unexpired at admission.
The queue must hold the exclusive host reservation until the job finishes and
issue the next cell's matching lease. A lease file is evidence of external
admission, not an implementation of the queue. Missing admission/toolchain fails.

Dispatch **Local embedder qualification** with required `linux_pack_dir`,
`macos_pack_dir` and `manifest_sha256`. Its only trigger is workflow dispatch;
the four cells are Linux x64/macOS arm64 × Node 22.16.0/24.15.0, serialized both
by workflow concurrency and the external queue. Reports, exit codes and tested
commit/platform/Node evidence are preserved on failure as well as success.

The repository command is exactly:

```sh
npm run measure:local-embedder -- --pack /absolute/pack \
  --expected-manifest-sha256 REVIEWED_LOWERCASE_64_HEX \
  --output /absolute/job-private/report.json
```

Missing/unreadable/unapproved packs, wrong hashes or unavailable runtimes fail
nonzero with a sanitized report when possible; there is no successful skip.
The command records cold initialization, warm query IPC/inference and lookup
p50/p95, fresh uncached short/near-limit refresh, actual token refusal, explicit
crash/reinitialization, event-loop delay, sampled parent/supervisor/inference RSS
and disk bytes, with hardware/OS/libc/Node/threads/manifest/cache/sample/coverage
labels. Valid vectors/coverage and zero failures are separate from latency
observations. This path is not run by ordinary tests. The research cached-document
0.55 ms/document is not a fresh rebuild estimate; its Linux timing is not macOS
or local-pack IPC evidence. No retrieval-quality parity, GPU/quantization, bounded
native RSS, model security sandbox or cross-platform identical vectors is claimed.
