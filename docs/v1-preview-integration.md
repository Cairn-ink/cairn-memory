# V1 preview: product integration

`v1-preview.0` is an opt-in preview cut from `release/v1-preview`: base
`389512d7146b5c493560017d45bc96a9be6a31f7` plus the preview fixes. The tag names the exact commit. It stacks on the unmerged local V1
chain (#453–#469, `feat/local-v1-closeout`). Default behaviour stays unchanged
unless the feature options below are selected. This is not an npm release.

## Install the preview build

Use Node **>=22.16.0**, npm and `tar`; the recorded verification baselines are
22.16 and 24.15. From the pinned source checkout:

```sh
npm run build:artifact
```

Read `artifactPath` and `sha256` from its JSON build report. Verify a distributed
archive against that hash. In a dedicated installation directory, run:

```sh
npm init -y
npm install --prefix . --ignore-scripts --no-audit --no-fund /absolute/path/cairn-memory-local-preview-0.0.0-preview.1.tgz
./node_modules/.bin/cairn-memory --help
```

The existing builder runs `npm pack --offline --ignore-scripts --json` on staged
files. Its private package metadata remains `cairn-memory-local-preview@0.0.0-preview.1`;
`v1-preview.0` identifies this source/release cut. Root `npm pack` is not the
artifact workflow. Dependency installation can contact npm. Keep the database
outside the installation; its private parent directory must exist.
Sources: `package.json:47`, `packaging/build.mjs:80`, `packaging/build.mjs:102`.
Below, `cairn-memory` means the installed executable above.

## Stable preview interfaces

Core exports come from `cairn-memory-local-preview/core/index.mjs`. Data calls
take `(input, token)` and return `{ok:true,value}` or
`{ok:false,error:{code,retryable}}`; lookup/refresh are asynchronous. The host
provides synchronous `authority:{authorize,isCurrent}` and an opaque token,
authorizing each namespace and checking access generations. Tokens, snapshots,
roles and saved prose grant no access. See [authority details](method-packages-local.md#construction-and-authority).

An exact namespace is `{ownerId,scope:'personal',projectId:null}` or
`{ownerId,scope:'project',projectId}`. A `readSet` contains one namespace, or
personal plus one project of the same owner. MCP fixes these at startup and
rejects caller-supplied namespace/readSet/context/authority/configuration and
unknown fields. MCP results contain JSON in `content[0].text`, with
`evidenceTrust:'untrusted-data-not-instructions'` and `isError:!ok`.

Both interfaces bound complete core success envelopes to **65,536 UTF-8 bytes**;
opted-in MCP messages have a separate **262,144-byte encoded bound**, including
JSON-RPC ID and newline. Escaping can exhaust transport before the core bound;
`response_too_large` or transport refusal is possible. Only `storage_busy` is
retryable. Shared failures include `invalid_input`, `authority_required`,
`scope_changed`, `revision_conflict`, `invalid_cursor`, `cursor_stale`,
`context_item_too_large`, `storage_error` and `store_closed`.
Sources: `adapters/mcp/server.mjs:202`, `adapters/mcp/context-read-transport.mjs:3`,
`core/private-card-facade.mjs:16`.

### Context retrieval (`context-read-v1`)

```js
import { openMemoryCore, openContextReader } from 'cairn-memory-local-preview/core/index.mjs';
const contextRead = { version: 'context-read-v1', authority }; // no embedder
const core = openMemoryCore({ path, contextRead });
// Alternative: const core = openContextReader({ path, contextRead });
```

`getContextReadCapabilities()` needs no token and returns an envelope describing
methods, supported types/intents, channel configuration, preset, limits,
maintenance availability and unsupported features. Use its `types`; Card support
depends on the existing canonical schema. The read-only opener never maintains
or repairs the sidecar; refresh returns `invalid_input`.

| Core method | Input | Success value |
| --- | --- | --- |
| `findCandidates` | `readSet,query,types,intent,semantic?,limit?,deadlineMs?,cursor?` | `{version,items,channels,coverage,trace,nextCursor}` |
| `fetchCandidateEvidence` | `readSet`, either `refs,intent` or `snapshot`; `responseByteLimit?` | `{items,snapshot}` |
| `refreshContextIndex` | `readSet,types,intent,budget:{maxItems,maxMs}` | `{status,progress,coverage,channels}` |

Types are a nonempty subset of `memory,card`; intent is explicitly `current|history`.
Each candidate is `{ref,rank,fusionScore,channels:{lexical,semantic}}`; channel
scores are `{rank,rawScore}|null`. Lexical-only fusionScore is null. Candidates
have no text. Refs are `{type:'memory',namespace,memoryId,revision}` or
`{type:'card',namespace,cardId,revision,bodyRevision}`. Fetch accepts 1–24 refs
and returns canonical content, qualification and provenance, then an opaque
snapshot for refetch. Receipt/source prose is read separately. Current Cards
require confirmed, eligible support and current applicability.

Defaults: `semantic:false`, 12 items, 1,000 ms. Maximums: 24 items,
4,000 UTF-16 query units, 5,000 ms; fetch responseByteLimit is 1–65,536.
This candidate query bound measures raw UTF-16 code units, without NFKC,
redaction, whitespace collapse or trim rewrite. The exported
`normalizedTextLength` and `normalizeBoundedText` instead measure the
[bounded-text path](capture.md#bounded-text-lengths) used by capture, memory
content and ordinary recall; segmenters must use each field's own rules.
Pages partition one frozen top-24 ranking without reranking/embedding; at most
128 rankings per handle, expiring after five minutes. Cursor/snapshot bounds
are 8,192/16,384 characters. Changed semantics or generations require restarting.
Sources: `core/context-read-input.mjs:8`, `core/context-read-facade.mjs:427`,
`core/private-evidence-storage.mjs:54`.

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER --project PROJECT \
  --context-read context-read-v1 --context-read-personal
```

The zero-value personal flag requires project scope and context opt-in; omit it
to read only the startup namespace. This adds only:

| MCP tool | Caller input |
| --- | --- |
| `find_memory_candidates` | `query,types,intent,semantic?,limit?,deadlineMs?,cursor?` |
| `fetch_memory_candidate_evidence` | either `refs,intent` or `snapshot`; `responseByteLimit?` |

There is no refresh tool. To enable OpenAI embeddings, append **all five** options
to MCP startup; supply `OPENAI_API_KEY` in the process environment:

```sh
--context-embedder openai --context-embed-model text-embedding-3-small \
--context-embed-dimensions 1536 --context-embed-max-requests 20 \
--context-embed-max-usd 0.10
```

The adapter defaults to `text-embedding-3-small`/1,536 dimensions, but CLI
model/dimensions are mandatory. A key alone never creates an embedder; legacy
model behaviour remains unchanged. Semantic lookup requires explicit
`semantic:true`, embeds only the query, and refuses `invalid_input` without a
configured, budgeted embedder. Only explicit refresh embeds documents:

```sh
cairn-memory context refresh --db /absolute/private/memory.sqlite --owner OWNER \
  --project PROJECT --types memory --intent current --max-items 128 --max-ms 5000 \
  --context-embedder openai --context-embed-model text-embedding-3-small \
  --context-embed-dimensions 1536 --context-embed-max-requests 20 \
  --context-embed-max-usd 0.10
```

Refresh requires an existing private rollback-journal store and a noncreating
fenced opener; it selects no feature-schema installation. Budgets are 1–1,024 transformation/embedding attempts
and 1–5,000 ms. Repeat bounded refreshes on `rebuilding`/`partial`; `complete`
means this projection completed. Ordinary writable lookup maintains lexical data
without models. `--check-config` checks syntax without database/key/provider access.
For MCP, put `--check-config` first.

Request caps are positive safe integers; USD caps finite and positive. Reservations
precede transport and share cumulative totals across handles by embedder identity
within the process. Unknown usage retains conservative charges; no automatic retry.
Caps are neither durable nor account-wide. SDK configuration adds
`embedder` and `policy:{family:'hosted',maxRequests,maxUsd,maxConcurrent,estimateUsd}`
to contextRead; `estimateUsd(texts)` is trusted synchronous policy.
Sources: `adapters/mcp/context-read-configuration.mjs:4`,
`adapters/mcp/context-read-provider.mjs:4`, `core/context-read-input.mjs:22`.

Frozen RRF presets (`core/context-read-fusion.mjs:3`):

| Family/preset | k | Depth/channel | Lexical/semantic weights |
| --- | ---: | ---: | --- |
| local / `rrf-k60-d12` | 60 | 12 | 0.45/0.45 |
| hosted / `rrf-k10` | 10 | 24 | 0.5/0.5 |

Ranks start at 1; sum `weight/(k+rank)`, then cap the final horizon at 24.
Degraded semantic search preserves lexical BM25. States include `ready`,
`unavailable`, `disabled`, `absent`, `timeout`, `provider_error`, `rate_limited`,
`budget_denied`, `stale_index`, `dimension_mismatch`, `partial_coverage`.
Coverage/trace report counts, freshness, maintenance and stops. Known vector gaps
or scan/cache bounds send zero query requests. Unusable lexical indexes return
`index_unavailable`, never successful no-matches. Additional errors:
`invalid_read_set`, `evidence_unavailable`, `invalid_snapshot`, `snapshot_stale`;
errors may carry `details:{channels,coverage,trace}`.
Source: `core/context-read-facade.mjs:23`.

### Method packages (`method-packages-local-v1`)

```js
const core = openMemoryCore({ path, methodPackages: {
  version: 'method-packages-local-v1', storage: 'local-plain-v1', authority,
} });
```

`getMethodPackageCapabilities()` requires no token. The text facade supports
immutable imports, reads, comparisons, adoption/disable, deletion, effects, usage
and reason checks. Core content/version-list reads replace MCP roleId with
optional `context:{readSet,roleId}`; resolution adds `readSet`,
package listing receives `namespace`, and event listing `bindingNamespace`.
Other text-facade calls:

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
[Detailed DTOs](method-packages-local.md#references-and-api) define metadata/ref fields.
Mutations require `explicit-user`, `actionId` and applicable expected
revisions; reads require `read`. Imports never adopt. Exact replay is content-free;
changed input under the same action ID returns `action_conflict`.

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

Optional `--project` selects project scope. Import accepts `--submitted-by`,
repeated `--exclude`, `--change`; later versions require `--package PACKAGE_ID`,
`--expected-package-revision N`, `--based-on VERSION_REF_JSON`. Binding commands
accept repeated `--reason-ref REF_JSON`; expected revision is `null` for creation,
otherwise positive. Commands require an existing rollback-journal store and real
controlling-terminal approval, with frozen payloads; no `--yes` or piped approval.
Directory importing requires supported Linux/WSL semantics.
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

Use core-issued JSON refs unchanged: package is
`{type:'method-package',namespace,packageId}`; version adds
`type:'method-version',versionId,manifestIdentity`. Current reads require roleId
(null means default; otherwise 1–200 ASCII letters/digits/`._-`);
history without roleId is unassessed. Resolution precedence:
project+role, project+default, personal+role, personal+default. Disabled/unavailable
bindings block fallback. Resolution status is `current|disabled|unavailable|no-active-version`.
Pass resolution snapshots to content reads; stale current
pins return `cursor_stale`. Unavailable content is explicitly labelled.

Pages default/cap at 20 items; file parts cap at 4,000 UTF-16 units. Imports:
1–256 files, 400,000 units/file, 4,000,000/version, 50,000,000 retained UTF-8
bytes/owner. Paths are relative POSIX, at most 512 units. Cursor/pin bounds:
8,192/65,536 characters. Text media: Markdown, plain text, JSON, YAML, CSV. Additional errors:
`approval_required`, `action_conflict`, `quota_reached`, `method_not_found`,
`method_version_unavailable`, `invalid_path`, `unsupported_media`,
`package_limit_reached`. Selecting methods can upgrade supported stores to v30;
stop mixed-version writers before migration.
Sources: `core/method-package-input.mjs:8`, `adapters/mcp/method-package-tools.mjs:4`.

## Experimental: assets

`assets-local-v1` is an embedded core API, **not for product integration yet**.
U4b CLI/MCP work is in progress and review fixes are landing. This cut exposes
neither asset commands nor asset MCP tools. Selecting assets upgrades supported
stores to v31. Known issue in `v1-preview.0`: configuring `assets` together with
`contextRead` in one `openMemoryCore` call fails with `invalid_input`. Keep them
in separate handles; a fix lands in a later preview. Keep binary attachments and derivatives outside the stable scope.
See [assets](assets-local.md), `core/contract.mjs:1177`, and
[contract §12](plans/unified-memory-v1-contract.md#12-u4-assets-derivatives-and-binary-method-attachments-v052-audited-and-confirmed).

## Limitations and non-claims

Frozen tokenization misses embedded single Han: `中` does not match `中文`.
Evidence for these interfaces is synthetic/offline, including fake HTTP and
installed-process checks. One paid smoke request against the real OpenAI API
passed after the adapter began renormalizing provider vectors, whose L2 norms
are only approximately 1. The smoke stays opt-in and outside every test suite. No complete
semantic recall, answer correctness, production latency, 100,000-Memory guarantee
or native-product activation is established. Assembly/U5b, role profiles,
relations, MOC retrieval, Raw search and local-model adapters remain unsupported.

Storage is local plaintext, including the sensitive `.context-read-v1.sqlite`
sidecar; logical deletion/invalidation provides no physical erasure from pages,
journals or backups. Method text never executes or grants permission;
source-derived imports await dependency fences. This preview offers local core
and stdio integration, no hosted-service support or hosted-safety claim. Explicit
OpenAI use sends selected text externally and may incur charges. See
[limitations](limitations.md#context-retrieval-host-u5a-part-3) and
[contract non-claims](plans/unified-memory-v1-contract.md#1-scope-and-sequencing).

## Versioning promise

Interfaces listed as stable above retain their names and DTO shapes across
`v1-preview.*`. Algorithm improvements land behind those interfaces; rankings
and quality are not frozen. Experimental assets are outside this promise.

## Release notes for GitHub pre-release

- Opt-in local V1 preview (base `389512d` plus preview fixes); no npm publication or default changes.
- Fix: the OpenAI adapter renormalizes provider vectors. Before the fix, real embeddings failed validation; verified with one live request.
- Stable context candidates/evidence, explicit refresh and budgeted OpenAI embeddings.
- Stable text method packages with terminal import/adopt/disable and nine MCP reads.
- Assets remain experimental. Synthetic evidence only; retain the documented
  single-Han miss, local-storage and logical-deletion limitations.
