# V1 preview: product integration

`v1-preview.2` is an opt-in cut from `release/v1-preview`, integration
`0a38a991` (preview HEAD `6ef5bc2a`). It stacks on the unmerged local V1
chain (#453–#469, `feat/local-v1-closeout`). Default behaviour stays unchanged
unless the feature options below are selected. This is not an npm release.

## Install the preview build

Requires Node **>=22.16.0**, npm and `tar`; verification baselines: 22.16/24.15.
From the pinned checkout:

```sh
npm run build:artifact
```

Use build-report `artifactPath`/`sha256` to locate/verify the archive.
In a dedicated directory:

```sh
npm init -y
npm install --prefix . --ignore-scripts --no-audit --no-fund /absolute/path/cairn-memory-local-preview-0.0.0-preview.1.tgz
./node_modules/.bin/cairn-memory --help
```

The builder stages files, then runs `npm pack --offline --ignore-scripts --json`.
Private metadata stays `cairn-memory-local-preview@0.0.0-preview.1`;
`v1-preview.2` identifies the source cut. Installation can contact npm.
Keep the database outside the installation in an existing private directory.
Sources: `package.json:47`, `packaging/build.mjs:80`, `packaging/build.mjs:102`.
Use that executable below.

## Stable preview interfaces

Core exports: `cairn-memory-local-preview/core/index.mjs`. Data calls take
`(input,token)`, returning `{ok:true,value}` or `{ok:false,error:{code,retryable}}`;
lookup/refresh are asynchronous. The host supplies synchronous
`authority:{authorize,isCurrent}` and an opaque token for namespace/generation
checks. Snapshots, roles and prose grant no access.
See [authority](method-packages-local.md#construction-and-authority).

Namespaces: `{ownerId,scope:'personal',projectId:null}` or
`{ownerId,scope:'project',projectId}`. `readSet`: one namespace or one owner's
personal+project. MCP fixes scopes at startup; supplied
namespace/readSet/context/authority/configuration and unknown fields refuse.
Stable MCP reads return JSON in `content[0].text`, with
`evidenceTrust:'untrusted-data-not-instructions'` and `isError:!ok`.

Complete core success envelopes cap at **65,536 UTF-8 bytes**; opted-in MCP
messages at **262,144 encoded bytes**, including JSON-RPC ID/newline. Escaping can
cause `response_too_large` or transport refusal. Only `storage_busy` is
retryable, including starvation under continuous writes (contract §16 below).
Shared failures include `invalid_input`, `authority_required`,
`scope_changed`, `revision_conflict`, `invalid_cursor`, `cursor_stale`,
`context_item_too_large`, `storage_error` and `store_closed`.
Sources: `adapters/mcp/server.mjs:227`, `adapters/mcp/context-read-transport.mjs:4`,
`core/private-card-facade.mjs:16`.

### Context retrieval (`context-read-v1`)

```js
import { openMemoryCore, openContextReader } from 'cairn-memory-local-preview/core/index.mjs';
const contextRead = { version: 'context-read-v1', authority }; // no embedder
const core = openMemoryCore({ path, contextRead });
// Alternative: const core = openContextReader({ path, contextRead });
```

`getContextReadCapabilities()` needs no token: it reports methods, types/intents,
channels, preset, limits, maintenance and unsupported features. Card support
depends on schema. The read-only opener never maintains/repairs the sidecar;
refresh returns `invalid_input`.

| Core method | Input | Success value |
| --- | --- | --- |
| `findCandidates` | `readSet,query,types,intent,semantic?,limit?,deadlineMs?,cursor?` | `{version,items,channels,coverage,trace,nextCursor}` |
| `fetchCandidateEvidence` | `readSet`, either `refs,intent` or `snapshot`; `responseByteLimit?` | `{items,snapshot}` |
| `refreshContextIndex` | `readSet,types,intent,budget:{maxItems,maxMs}` | `{status,progress,coverage,channels}` |

Types: nonempty subset of `memory,card`; intent: `current|history`.
Candidates are text-free `{ref,rank,fusionScore,channels:{lexical,semantic}}`;
channel scores: `{rank,rawScore}|null`; lexical-only fusionScore: null.
Refs: `{type:'memory',namespace,memoryId,revision}` or
`{type:'card',namespace,cardId,revision,bodyRevision}`. Fetch accepts 1–24 refs
and returns canonical content, qualification, provenance and a refetch snapshot.
Read receipt/source prose separately. Current Cards
require confirmed, eligible support and current applicability.

Defaults: `semantic:false`, 12 items, 1,000 ms. Maximums: 24 items,
4,000 UTF-16 query units, 5,000 ms; fetch responseByteLimit is 1–65,536.
Pages partition one frozen top-24 ranking without reranking/embedding; at most
128 rankings per handle, expiring after five minutes. Cursor/snapshot bounds
are 8,192/16,384 characters. Changed semantics or generations require restarting.
Sources: `core/context-read-input.mjs:8`, `core/context-read-facade.mjs:529`,
`core/private-evidence-storage.mjs:54`.

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER --project PROJECT \
  --context-read context-read-v1 --context-read-personal
```

The zero-value personal flag requires project/context opt-in; otherwise reads
stay in the startup namespace. Stable tools (experimental assembly is below):

| MCP tool | Caller input |
| --- | --- |
| `find_memory_candidates` | `query,types,intent,semantic?,limit?,deadlineMs?,cursor?` |
| `fetch_memory_candidate_evidence` | either `refs,intent` or `snapshot`; `responseByteLimit?` |

No refresh tool exists. For OpenAI embeddings, append **all five** startup options;
set `OPENAI_API_KEY` in the environment:

```sh
--context-embedder openai --context-embed-model text-embedding-3-small \
--context-embed-dimensions 1536 --context-embed-max-requests 20 \
--context-embed-max-usd 0.10
```

Adapter defaults: `text-embedding-3-small`/1,536 dimensions; CLI model/dimensions
remain mandatory. A key alone creates no embedder; legacy behaviour is unchanged.
`semantic:true` embeds only the query and returns `invalid_input` without a
budgeted embedder. Only explicit refresh embeds documents:

```sh
cairn-memory context refresh --db /absolute/private/memory.sqlite --owner OWNER \
  --project PROJECT --types memory --intent current --max-items 128 --max-ms 5000 \
  --context-embedder openai --context-embed-model text-embedding-3-small \
  --context-embed-dimensions 1536 --context-embed-max-requests 20 \
  --context-embed-max-usd 0.10
```

Refresh uses an existing private rollback-journal store and noncreating fenced
opener, without feature-schema installation. Budgets: 1–1,024 transformation/embedding
attempts, 1–5,000 ms. Repeat on `rebuilding`/`partial`. Writable lookup maintains
lexical data without models. `--check-config` checks syntax without database/key/provider
access; for MCP, put it first.

Request caps are positive safe integers; USD caps finite/positive. Reserve before
transport, sharing process totals across handles by embedder identity. Unknown
usage retains conservative charges; no automatic retry. Caps are neither durable
nor account-wide. SDK configuration adds
`embedder` and `policy:{family:'hosted',maxRequests,maxUsd,maxConcurrent,estimateUsd}`
to contextRead; `estimateUsd(texts)` is trusted synchronous policy.
Sources: `adapters/mcp/context-read-configuration.mjs:4`,
`adapters/mcp/context-read-provider.mjs:4`, `core/context-read-input.mjs:30`.

Frozen RRF presets (`core/context-read-fusion.mjs:3`):

| Family/preset | k | Depth/channel | Lexical/semantic weights |
| --- | ---: | ---: | --- |
| local / `rrf-k60-d12` | 60 | 12 | 0.45/0.45 |
| hosted / `rrf-k10` | 10 | 24 | 0.5/0.5 |

RRF sums `weight/(k+rank)`, starting ranks at 1.
Degraded semantic search preserves lexical BM25. States include `ready`,
`unavailable`, `disabled`, `absent`, `timeout`, `provider_error`, `rate_limited`,
`budget_denied`, `stale_index`, `dimension_mismatch`, `partial_coverage`.
Known vector gaps or scan/cache bounds send zero query requests. Unusable lexical indexes return
`index_unavailable`, never successful no-matches. Additional errors:
`invalid_read_set`, `evidence_unavailable`, `invalid_snapshot`, `snapshot_stale`;
errors may carry `details:{channels,coverage,trace}`.
Source: `core/context-read-facade.mjs:26`.

### Method packages (`method-packages-local-v1`)

```js
const core = openMemoryCore({ path, methodPackages: {
  version: 'method-packages-local-v1', storage: 'local-plain-v1', authority,
} });
```

`getMethodPackageCapabilities()` requires no token. Core content/version-list
reads replace MCP roleId with
optional `context:{readSet,roleId}`; resolution adds `readSet`,
package listing receives `namespace`, and event listing `bindingNamespace`.
Core-only calls:

| Core method | Input | Success value |
| --- | --- | --- |
| `importMethodVersion` | `namespace,actionId,title,files,submittedBy?,package?,expectedPackageRevision?,basedOn?,change?` | `{package,version,ordinal,packageRevision}` |
| `adoptMethodVersion` | `bindingNamespace,actionId,package,version,roleId,expectedRevision,readSet,reasonRefs?` | `{binding,state,version}` |
| `disableMethodBinding` | same, without version | `{binding,state,version:null}` |
| `deleteMethodVersion`, `deleteMethodPackage` | `actionId,ref,expectedRevision` | `{id,revision,state,effectCount}` |
| `listMethodEffects` | `namespace,limit?,cursor?` | `{effects,coverage,nextCursor}` |
| `getMethodPackageUsage` | `namespace` | `{version,namespace,retainedFileBytes,limitBytes,limitScope,aggregate}` |
| `checkMethodReasonRefs` | `namespace,reasonRefs` | `{reasonRefs:[{ref,status}]}` |

Files are `{path,text,mediaType}`; change is `{items:[{summary,paths}],reasonRefs}`.
Mutations need `explicit-user`, `actionId` and applicable expected revisions; reads
need `read`. Imports never adopt. Replay is content-free; changed input under the
same action ID returns `action_conflict`.

```sh
cairn-memory methods import --db /abs/store.sqlite --owner OWNER \
  --dir /abs/package --title 'Method'
cairn-memory methods adopt --db /abs/store.sqlite --owner OWNER \
  --binding-namespace personal --package "$PACKAGE_REF_JSON" --role '*' \
  --version "$VERSION_REF_JSON" --expected-revision 'null'
cairn-memory methods disable --db /abs/store.sqlite --owner OWNER \
  --binding-namespace personal --package "$PACKAGE_REF_JSON" --role '*' \
  --expected-revision 1
```

`--project` selects project scope. Import accepts `--submitted-by`, repeated
`--exclude`, `--change`; later versions require `--package PACKAGE_ID`,
`--expected-package-revision N`, `--based-on VERSION_REF_JSON`. Binding commands
accept repeated `--reason-ref REF_JSON`; expected revision is `null` for creation,
otherwise positive. Commands require an existing rollback-journal store,
frozen-payload controlling-terminal approval; no `--yes` or pipes.
Import requires supported Linux/WSL semantics.
Source: `adapters/mcp/method-package-command.mjs:12`.

MCP startup: `--method-packages local-v1`; add zero-value
`--method-read-personal` only with `--project`. Nine keyless read tools:

| Tool / core method | Caller input | Value fields |
| --- | --- | --- |
| `resolve_method` / `resolveMethod` | `package,roleId` | `package,status,binding,version,snapshot` |
| `resolve_methods_for_role` / `resolveMethodsForRole` | `roleId,limit?,cursor?` | `methods,coverage,nextCursor,snapshot` |
| `get_method_version` / `getMethodVersion` | `version,intent,roleId?,snapshot?` | `version` metadata/adoptionStatus |
| `list_method_manifest` / `listMethodManifest` | `version,intent,roleId?,snapshot?,cursor?` | `files,adoptionStatus,coverage,nextCursor` |
| `read_method_file` / `readMethodFile` | `version,path,intent,roleId?,snapshot?,cursor?` | `parts,adoptionStatus,coverage,nextCursor` |
| `list_method_packages` / `listMethodPackages` | `limit?,cursor?` | `packages,coverage,nextCursor` |
| `list_method_versions` / `listMethodVersions` | `package,roleId?,limit?,cursor?` | `versions,coverage,nextCursor` |
| `compare_method_versions` / `compareMethodVersions` | `from,to,cursor?` | `from,to,status,changes,items,reason,reasonRefs,coverage,nextCursor` |
| `list_method_binding_events` / `listMethodBindingEvents` | `package?,limit?,cursor?` | `events,coverage,nextCursor` |

Use unchanged core refs: package is
`{type:'method-package',namespace,packageId}`; version adds
`type:'method-version',versionId,manifestIdentity`. Current reads require roleId
(null means default; otherwise 1–200 ASCII letters/digits/`._-`);
history without roleId is unassessed. Resolution precedence:
project+role, project+default, personal+role, personal+default. Disabled/unavailable
bindings block fallback. Resolution status is `current|disabled|unavailable|no-active-version`.
Pass snapshots to content reads; stale current pins return `cursor_stale`.

Pages default/cap at 20 items; file parts cap at 4,000 UTF-16 units. Imports:
1–256 files, 400,000 units/file, 4,000,000/version, 50,000,000 retained UTF-8
bytes/owner. Paths are relative POSIX, at most 512 units. Cursor/pin bounds:
8,192/65,536 characters. Text media: Markdown, plain text, JSON, YAML, CSV. Additional errors:
`approval_required`, `action_conflict`, `quota_reached`, `method_not_found`,
`method_version_unavailable`, `invalid_path`, `unsupported_media`,
`package_limit_reached`. Selecting methods can upgrade supported stores to v30;
stop mixed-version writers before migration.
Sources: `core/method-package-input.mjs:8`, `adapters/mcp/method-package-tools.mjs:4`.

## Experimental: context assembly (`read_memory_context`)

U5b is **experimental and outside the versioning promise**.
`find_memory_candidates` and `fetch_memory_candidate_evidence` stay stable.
Enable with `--context-read context-read-v1`; no additional flag is needed.
CLI startup awaits the keyless local `o200k_base` counter (`tiktoken-o200k_base`),
independently of model/provider configuration.
Sources: `adapters/mcp/cli.mjs:335`, `adapters/openai/context-counter.mjs:11`.

| MCP input | Requirement/default |
| --- | --- |
| `query` | Required nonblank valid Unicode; ≤4,000 UTF-16 units |
| `types` | Required nonempty unique subset of supported `memory,card` |
| `intent` | Required `current|history` |
| `semantic` | Optional boolean; false by default; existing embedding opt-in applies |
| `maxTokens` | Optional integer 64–4,000; default 1,500 |
| `maxItems` | Optional integer 1–24 admitted bodies; default 12 |
| `policy` | Optional strict `{id:'rank-first-whole-v1'}` (default) or `{id:'coverage-first-v1'}` |
| `deadlineMs` | Optional integer 1–5,000; default 1,000; cooperative |

The host fixes `readSet`; tool-supplied `budget`, cursor and unknown fields refuse.
Core: `await core.contextRead({readSet,query,types,intent,semantic?,budget:{maxTokens,maxItems},policy?,deadlineMs?},token)`.
Both openers support it. Supply `contextRead.counter` from
`await createContextCounter()` in `adapters/openai/context-counter.mjs`.
Missing counter returns `invalid_input`; failed counting returns `token_count_unavailable`.
Programmatic MCP auto-loads its counter: `server.contextCounterReady` resolves
true/false. Retrieval works while loading; assembly returns `token_count_unavailable`
until ready.
Sources: `adapters/mcp/context-read-tools.mjs:25`, `core/context-read-input.mjs:93`,
`core/context-read-facade.mjs:446`, `adapters/mcp/server.mjs:132`.

Core success is `{ok:true,value:{metered,diagnostics}}`. `metered` contains
`version,policy,representation,counter,framing,items,snapshot`; each item includes
`ref,rank,type,metadata,body:{text,tokens},sources,sourceAccess,sourcesComplete`.
Bodies/sources fit whole or are omitted. Rank-first visits body then sources
per item; coverage-first visits all bodies first. HR-2 kept rank-first on short,
single-fact synthetic items, without establishing long-item validity
([context guide](context-read-local.md#budgeted-context-assembly-u5b)).

MCP success has `isError:false` and exactly one text block:
`JSON.stringify({ok:true,value:metered,evidenceTrust:'untrusted-data-not-instructions'})`.
The budget meters the complete string, including untrusted-recollection framing
and snapshot, not the total model request. Diagnostics live under
`_meta['ink.cairn/context-read-diagnostics']`: used tokens, omissions, deduplication,
stops, candidates and timings. Errors retain code/retryability/trust framing in
text; candidate diagnostics move to the same key as `{candidates}`.
Keep `_meta` in host/UI state and send only content to the model; arbitrary
clients may expose metadata. Core/transport byte limits still include diagnostics.
Sources: `core/context-read-assembly.mjs:7`, `core/context-read-assembly.mjs:86`,
`adapters/mcp/context-read-transport.mjs:6`.

On a **small synthetic store**, the real counter measured roughly 250 tokens of
per-item overhead: a 15–19-token memory cost about 250–330 tokens represented.
Budgets below about 512 may therefore return zero items, with
`diagnostics.omitted.oversized` recording exclusions. This is an observation,
not a universal threshold; if even empty framing cannot fit, the error is
`context_item_too_large`. The representation will change in a later preview:
planned `representation-v2` moves the snapshot outside metered text and compacts
refs/metadata. HEAD implements `representation-v1`, including snapshot and refs
in every trial's token count (`core/context-read-assembly.mjs:30`,
`core/context-read-assembly.mjs:47`).

## Experimental: assets

`assets-local-v1` remains **experimental, outside the versioning promise**.
U4b adds CLI/MCP; core opt-in:
`assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}`; selecting
assets upgrades supported stores one-way to v31. The assets/contextRead constructor
issue is fixed; regression coverage enumerates all eight asset/context/method
combinations (`core/contract.mjs:45`,
`core/test/assets-context-options.test.mjs:7`).

Asset commands require an existing store and
`--db ABS --owner OWNER [--project PROJECT]`:

| Command | Arguments |
| --- | --- |
| `cairn-memory assets import` | `--file ABS --title TITLE [--asset ID --expected-asset-revision N]` |
| `cairn-memory assets derive` | `--version REF_JSON --kind KIND --text-file ABS [--language TAG] [--timecodes ABS]` |
| `cairn-memory assets delete` | `--ref REF_JSON --expected-revision N` |
| `cairn-memory assets export` | `--version REF_JSON --out ABS` |

Import/derive/delete require Linux/WSL, TTY stdin/stdout and typed
approval of frozen payloads on `/dev/tty`; no `--yes` or piped
approval. Import reviews metadata/byte commitment; derive reviews text.
Import returns `{asset,version,ordinal,assetRevision}`. Export needs byte-read
authority, **no mutation approval**, verifies readback and publishes create-only
(`EEXIST` if occupied). Its receipt is `{status:'published',version,byteCount}`;
no destination path. Publication followed by failure reports
`published-but-durability-uncertain`, exit 1; inspect before retrying.
Sources: `adapters/mcp/asset-command.mjs:14`, `adapters/mcp/asset-command.mjs:43`,
`adapters/mcp/asset-export.mjs:14`, `core/asset-storage.mjs:108`.

MCP: `--db ABS --owner OWNER [--project PROJECT] --assets local-v1`.
Five tools read only that namespace; no personal expansion, bytes or mutations:

| Tool | Caller input |
| --- | --- |
| `list_assets` | `limit?,cursor?` |
| `list_asset_versions` | `asset,limit?,cursor?` |
| `get_asset_version` | `version` |
| `list_asset_derivatives` | `version,limit?,cursor?` |
| `read_asset_derivative` | `ref,cursor?` |

List pages default/cap at 20; core/MCP bounds remain 65,536/262,144 bytes. Versions
cap at 33,554,432 bytes; owner binary quota is 200,000,000 bytes. Derivatives
are user-provided, at most 20,000 UTF-16 units, in 4,000-unit parts;
no OCR/ASR. `methods import --attachments local-v1` enables experimental binary
attachments; MCP never delivers their bytes. Both remain experimental.
Sources: `adapters/mcp/asset-tools.mjs:3`,
`core/asset-input.mjs:14`, `adapters/mcp/method-package-command.mjs:41`;
see [asset DTOs and operator details](assets-local.md).

## Limitations and non-claims

Frozen tokenization misses embedded single Han: `中` misses `中文`.
Evidence is synthetic/offline mechanism checks, plus one paid opt-in smoke
request against the real OpenAI embeddings API. The primary ran that request
when cutting `v1-preview.0`; it passed after the adapter began renormalizing
provider vectors, whose L2 norms are only approximately 1. None of this
establishes complete semantic recall, answer correctness,
production/100,000-Memory latency or native-product activation. The smoke stays
outside the test suites. Role profiles,
relations, MOC retrieval, Raw search and local-model adapters remain unsupported.

Assembly's current representation can overwhelm short bodies at small token
budgets; the small-store overhead measurement above is not a scale or quality
guarantee. Whole items may be omitted as `oversized`.

Continuous rollback-journal writers can starve readers: retryable `storage_busy`.
Paced workloads meet C04/K13 gates; unpaced runs are stress observations.
WAL requires a later store-wide decision, including review/store-fence changes.
Sources: [contract §16](plans/unified-memory-v1-contract.md#16-amendment-contention-gates-under-rollback-journal-mode-v072-primary-2026-10-24),
`core/database.mjs:30`, `core/private-card-facade.mjs:16`.

Storage and `.context-read-v1.sqlite` are sensitive local plaintext. Logical deletion
does not physically erase pages/journals/backups. Method text grants no execution
permission; source-derived imports await dependency fences. Local core/stdio have
no hosted-service support/safety claim. OpenAI use transmits selected text and
may incur charges. See
[limitations](limitations.md#context-retrieval-host-u5a-part-3) and
[contract non-claims](plans/unified-memory-v1-contract.md#1-scope-and-sequencing).

## Versioning promise

Stable names/DTO shapes persist across `v1-preview.*`; algorithm improvements
land behind them. Rankings/quality are not frozen. Experimental assets and context
assembly, including its representation, are excluded.

## Release notes for GitHub pre-release: v1-preview.2

Changes since `v1-preview.1`; integration `0a38a991`, preview HEAD `6ef5bc2a`:

- Add experimental U5b `read_memory_context` / core `contextRead`, versioned whole-unit
  policies and keyless local `o200k_base` counting; rank-first remains the default.
- Return one metered text block; diagnostics use namespaced `_meta` under an explicit
  client contract. Candidate lookup/evidence interfaces stay stable.
- Document representation-v1 overhead measured on a small synthetic store;
  representation-v2 is planned, so assembly stays outside the versioning promise.
  Assets remain experimental; private package metadata stays `0.0.0-preview.1`.
