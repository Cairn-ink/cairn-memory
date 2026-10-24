# V1 preview: product integration

`v1-preview.4` is an opt-in cut from `release/v1-preview`, integration
`b096e043` (`ef38da4a` plus a role-guide wording fix). It stacks on the unmerged local V1
chain (#453–#469, `feat/local-v1-closeout`). Default behaviour on stores without
dependency declarations stays unchanged unless the feature options below are
selected. This is not an npm release.

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
`v1-preview.4` identifies the source cut. Installation can contact npm.
Keep the database outside the installation in an existing private directory.
Sources: `package.json:47`, `packaging/build.mjs:11`, `packaging/build.mjs:102`,
`packaging/build.mjs:119`.
Use that executable below.

## Upgrade and rollback

Stop all writers and keep a consistent pre-upgrade backup before enabling U5c
storage features. Ordinary writable opening with role profiles performs a
**one-way schema v32 migration** (including method v30 and asset v31
prerequisites). Card current dependencies perform a **one-way schema v33
migration**, including v32 even without enabling role tools. These happen on
opening, before any profile publication or dependency declaration.
Read-only and managed-existing openers validate without migrating.
Sources: `core/database.mjs:362`, `core/database.mjs:402`,
`core/database.mjs:677`, `core/test/role-migration.test.mjs:20`,
`core/test/card-current-schema.test.mjs:22`.

**A store opened with these storage flags cannot go back to a `.3` binary:**
older binaries refuse v32/v33 stores. Removing flags does not downgrade the
schema or remove existing Card dependency enforcement. To roll back the binary,
stop writers and restore the pre-upgrade store backup; changes made after the
backup are not carried back. Never lower `PRAGMA user_version` by hand.
Optional context sources alone add no canonical schema migration.
See [role migration details](role-profiles-local.md),
[Card dependency migration details](card-current-dependencies-local.md) and
[optional sources](context-read-local.md#optional-relation-and-moc-sources).
Sources: `core/database.mjs:413`, `core/database.mjs:683`,
`core/card-current-storage.mjs:34`, `docs/role-profiles-local.md:18`,
`docs/card-current-dependencies-local.md:5`.

## Stable preview interfaces

The `.3` interfaces remain **stable and unchanged**: `find_memory_candidates`,
evidence fetch (including compact refs), `read_memory_context` with
`representation-v2`, and method packages. With all U5c flags off and no Card
dependency declarations, their default schemas, wire behaviour and presets
remain unchanged. HEAD includes frozen flag-off tool/DTO/schema fixtures,
source-disabled wire fixtures and no-declaration assembly/deadline regressions.
Existing declarations are always enforced, even with authoring disabled.
Sources: `adapters/mcp/test/role-profile.test.mjs:156`,
`adapters/mcp/test/context-read-sources.test.mjs:16`,
`adapters/mcp/context-read-sources-tools.mjs:7`,
`adapters/mcp/test/card-current-legacy-deadline.test.mjs:7`,
`core/card-current-storage.mjs:15`.

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
Sources: `adapters/mcp/server.mjs:255`, `adapters/mcp/context-read-transport.mjs:4`,
`core/private-card-facade.mjs:18`.

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
| `fetchCandidateEvidence` | `readSet`, either `refs,intent,fences?` or `snapshot`; `responseByteLimit?` | `{items,snapshot}` |
| `refreshContextIndex` | `readSet,types,intent,budget:{maxItems,maxMs}` | `{status,progress,coverage,channels}` |
| `contextRead` | `readSet,query,types,intent,semantic?,budget?,policy?,deadlineMs?` | `{metered,snapshot,diagnostics}`; assembly below |

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
Sources: `core/context-read-input.mjs:26`, `core/context-read-facade.mjs:454`,
`core/private-evidence-storage.mjs:54`.

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER --project PROJECT \
  --context-read context-read-v1 --context-read-personal
```

The zero-value personal flag requires project/context opt-in; otherwise reads
stay in the startup namespace. Stable tools:

| MCP tool | Caller input |
| --- | --- |
| `find_memory_candidates` | `query,types,intent,semantic?,limit?,deadlineMs?,cursor?` |
| `fetch_memory_candidate_evidence` | either `refs,intent` or `snapshot`; `responseByteLimit?` |
| `read_memory_context` | `query,types,intent,semantic?,maxTokens?,maxItems?,policy?,deadlineMs?` |

Fetch accepts full refs or the compact refs emitted by assembly, including mixed
arrays; its canonical evidence output is unchanged. Compact refetch details follow below.

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
`adapters/mcp/context-read-provider.mjs:4`, `core/context-read-input.mjs:42`.

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
Source: `core/context-read-facade.mjs:29`.

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
Source: `adapters/mcp/method-package-command.mjs:14`.

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

### Context assembly (`read_memory_context`, `representation-v2`)

`read_memory_context` with `representation-v2` and the compact-ref input form of
`fetch_memory_candidate_evidence` are **stable preview interfaces** from `.3`.
**Breaking from experimental `.2`: `representation-v1` output is gone**, with no
selector. Candidate lookup and existing full-ref/evidence outputs remain stable.
Enable with `--context-read context-read-v1`; no additional flag is needed.
CLI startup awaits the keyless local `o200k_base` counter (`tiktoken-o200k_base`),
independently of model/provider configuration.
Sources: `adapters/mcp/cli.mjs:359`, `adapters/openai/context-counter.mjs:11`.

| MCP input | Requirement/default |
| --- | --- |
| `query` | Required nonblank valid Unicode; ≤4,000 UTF-16 units |
| `types` | Required nonempty unique subset of supported `memory,card` |
| `intent` | Required `current` or `history` |
| `semantic` | Optional boolean; false by default; existing embedding opt-in applies |
| `maxTokens` | Optional integer 64–4,000; default 1,500 |
| `maxItems` | Optional integer 1–24 admitted bodies; default 12 |
| `policy` | Optional strict `{id}`: `rank-first-whole-v1` (default), `coverage-first-v1`, or `rank-first-first-source-v1` |
| `deadlineMs` | Optional integer 1–5,000; default 1,000; cooperative |

The host fixes `readSet`; tool-supplied `budget`, cursor and unknown fields refuse.
Core: `await core.contextRead({readSet,query,types,intent,semantic?,budget:{maxTokens,maxItems},policy?,deadlineMs?},token)`.
Both openers support it. Supply `contextRead.counter` from
`await createContextCounter()` in `adapters/openai/context-counter.mjs`.
Missing counter returns `invalid_input`; failed counting returns `token_count_unavailable`.
Programmatic MCP auto-loads its counter: `server.contextCounterReady` resolves
true/false. Retrieval works while loading; assembly returns `token_count_unavailable`
until ready.
Sources: `adapters/mcp/context-read-tools.mjs:74`, `core/context-read-input.mjs:141`,
`core/context-read-facade.mjs:529`, `adapters/mcp/server.mjs:147`.

Core success is `{ok:true,value:{metered,snapshot,diagnostics}}`, where
`metered` is only `{framing,items}`. MCP success has `isError:false` and exactly
one text block, byte-identical to:
`JSON.stringify({ok:true,value:{framing,items},evidenceTrust:'untrusted-data-not-instructions'})`.
Only that complete string is token-metered, not the total model request.

Each item has `{ref,rank,body,metadata?,sources,sourceAccess?,sourcesComplete?}`;
`body` is a whole canonical string (Card: title, newline, body). Ranks retain
candidate positions. Memory metadata defaults are
`{state:'active',reviewState:'none',filing:{status:'unfiled'},kind:'fact',origin:'explicit',confidence:1}`;
Card default is `{state:'confirmed'}`. Default metadata fields, `sourceAccess:'available'`
and `sourcesComplete:true` are omitted; capabilities expose `assembly.defaults`.
An excerpt equal to its own body becomes `{index,role,sameAsBody:true}`:
reconstruct its excerpt from `body`. Other sources carry `{index,role,excerpt}`
or backward `{index,sameAs:{item,source}}` aliases to concrete sources.
Sources remain distinct receipt positions and require an admitted body.
Sources: `core/context-read-input.mjs:19`, `core/context-read-assembly.mjs:36`.

Snapshot: `_meta['ink.cairn/context-read-snapshot']` (null for no items), never
metered text or `structuredContent`. Diagnostics:
`_meta['ink.cairn/context-read-diagnostics']`, now containing version, policy,
representation, counter, full refs/metadata and unit token counts in positional
`items`, alongside budget, omissions, deduplication, stops and timings.
Errors keep code/retryability/trust framing in text; candidate diagnostics move
to that diagnostics key as `{candidates}`. Retain `_meta` in host/UI state and
send only content to the model; arbitrary clients may forward metadata.
Core/transport byte limits still include snapshot and diagnostics.
Sources: `core/context-read-assembly.mjs:109`, `adapters/mcp/context-read-transport.mjs:6`.

Compact refs are `{ns,type,id,rev,f}`; Cards additionally require `bodyRev` before
`f` (forbidden for Memory). `ns` is a zero-based index into the host's immutable,
canonical namespace-key-sorted read set. `f` is the mandatory 8-character
base64url prefix of the store-keyed canonical item fence. Copy refs unchanged
into `fetch_memory_candidate_evidence({refs,intent})`; a fence mismatch returns
`snapshot_stale`: re-run `read_memory_context`. Every refetch reauthorizes access.
The prefix provides bounded accidental-change detection, not adversarial integrity
or authority, and exposes equality/change information across calls.
Sources: `adapters/mcp/context-read-tools.mjs:17`, `adapters/mcp/context-read-tools.mjs:48`,
`core/context-read-facade.mjs:648`.

| Fetch path | Guarantee |
| --- | --- |
| Compact `refs,intent` | Exact revision/intent eligibility plus item-fence prefix; detects same-revision receipt changes within that bounded guarantee |
| Host-retained `snapshot` | Exact delivered set/order, full item fences, namespace and access generations |

Full refs retain their earlier exact-revision semantics. A filed-to-filed MOC
parent move leaves canonical evidence byte-identical: compact-ref fetch succeeds,
while snapshot fetch returns `snapshot_stale` through the namespace generation.
Other mutations retain eligibility/revision error precedence. Core callers use
full refs, optionally with a parallel `fences` array (8-character prefixes or null);
MCP callers cannot supply that vector. See [fetch limitations](limitations.md#budgeted-context-assembly-u5b)
and [contract §15.8](plans/unified-memory-v1-contract.md#158-amendment-v0104-representation-v2-host-only-snapshot-first-source-policy-u5b-2).
Sources: `core/context-read-input.mjs:123`, `core/context-read-facade.mjs:648`.

Bodies/sources fit whole or are omitted. Rank-first visits body then sources
per item; coverage-first visits all bodies first. Non-default
`rank-first-first-source-v1` considers only the earliest receipt per admitted
body; later receipts count as omitted. HR-2 kept rank-first on short, single-fact
synthetic items, without establishing long-item validity
([context guide](context-read-local.md#budgeted-context-assembly-u5b)).
Source: `core/context-read-assembly.mjs:91`.

Measured on a **small synthetic store**, the frozen host-v2 probe uses a 15-token
body and one `sameAsBody` receipt per item: envelope ≈43 tokens, first item
adds ≈83, each further item ≈82. These increments include body and receipt
representation; do not add those costs twice. The one-item probe drops from
488 to 126 tokens. UUID/text tokenization varies; these are observations, not
budget recommendations or frozen constants. Whole units can still be omitted
as `diagnostics.omitted.oversized`; an empty envelope that cannot fit returns
`context_item_too_large`.
Sources: `evaluation/retrieval-research/assembly/overhead-host-v2.json:11`,
`docs/plans/unified-memory-v1-contract.md:1450`, `core/context-read-assembly.mjs:69`.

## Experimental: role profiles and task receipts (U5c-1)

**Experimental in `.4`: names and shapes may change before becoming stable.**
Contract §18 v0.12.2 (`docs/plans/unified-memory-v1-contract.md:2012`);
see the [role guide](role-profiles-local.md) for full DTOs,
authority and retention rules. Enable all three flags:

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER \
  --method-packages local-v1 --context-read context-read-v1 --role-profiles local-v1
```

Programmatic MCP: `createCairnServer({path,namespace,methodPackages:'local-v1',
contextRead:'context-read-v1',roleProfiles:'local-v1',
roleProfileAttribution:{actorId,agentId}})`. Attribution is optional here;
CLI defaults are actor `cairn-local-mcp`, agent `--client` or `cairn-local-mcp`.
For project+personal reads, both `methodReadPersonal` and `contextReadPersonal`
must be true (CLI: both zero-value personal flags); mismatches refuse.
Core hosts add `roleProfiles:{version:'role-profiles-local-v1',
storage:'local-plain-v1',authority,attribution:{actorId,agentId}}` to
`openMemoryCore`, alongside method packages and `contextRead` with its counter.
Sources: `adapters/mcp/role-profile-configuration.mjs:4`,
`adapters/mcp/server.mjs:142`, `core/role-profile-input.mjs:9`,
`core/role-context-facade.mjs:24`.

Four tools, confined to host scopes and attribution:

| MCP tool / core method | Key inputs | Success value |
| --- | --- | --- |
| `publish_role_profile_release` / `publishRoleProfileRelease` | `roleKey,actionId,expectedCurrentRelease,expectedRegistryRevision,fields,changeReason?` | `{registry,release,ordinal,createdAt}` |
| `disable_role_profile` / `disableRoleProfile` | Same head guards, without fields/reason | `{registry}` |
| `delete_role_profile_release` / `deleteRoleProfileRelease` | Same head guards plus `release,expectedRevision` | `{registry,release,state,revision,purgedBytes,eventCount}` |
| `read_role_task_context` / `readRoleTaskContext` | `mode`, mode-specific fields, `budget?,deadlineMs?` | Core `{metered,diagnostics}`; MCP emits the metered value as one text block |

Core mutations additionally take `namespace`; the read takes `readSet`.
**Agents publish directly, without confirmation**; a new immutable release is
immediately current. All mutations require both inspected CAS expectations;
null/null is only for an absent registry. Stale heads return `revision_conflict`;
changed input under a reused action ID returns `action_conflict`.
`fields.duties` and `fields.requiredOutputs` are mandatory arrays of 1–8
nonblank strings, at most 300 UTF-16 units each. `methods` and `related` refs
are optional, each at most 16; `appliesTo` is optional.
Sources: `adapters/mcp/role-profile-tools.mjs:30`,
`core/role-profile-storage.mjs:46`, `core/role-profile-input.mjs:31`.

| Read mode | Mode-specific inputs | Selection |
| --- | --- | --- |
| `now` | `roleKey,task?,history?` | Resolve current profile/methods; issue receipt |
| `then` | `receipt,history?` | Retain original identities, label present applicability |
| `refresh` | `receipt,task?` | Resolve the whole selection again; issue a new receipt ID |
| `compare` | `roleKey,from,to,cursor?` | Compare same-family releases or method versions |
| `file` | `receipt,package,path,range?` | Continue the exact receipted method version |

The metered value carries `framing,mode,registries,profile,methods,evidence,
history,comparison,file,receipt`. Compact `task-receipt-v1` strings are
**caller-held**: the host or agent must store the complete string verbatim.
There is no engine receipt lookup or recovery. `then` and `file` return the
original receipt; each call still needs fresh authorization. Historical content
is labelled separately from current guidance. File ranges are at most 4,000
UTF-16 units; binary continuation is metadata-only with separate asset authority.
Sources: `adapters/mcp/role-profile-tools.mjs:43`,
`core/role-context-facade.mjs:153`, `core/role-context-facade.mjs:198`,
`core/task-receipt.mjs:6`, `docs/role-profiles-local.md:69`.

Default/max budget: **4,000 tokens**, including the escaped receipt and complete
success text; default 12 evidence items (max 24), deadline 1,000 ms (max 5,000,
cooperative). Mandatory guidance and receipt must fit together or return
`budget_insufficient`; receipt/core/transport ceilings are 32,768/65,536/262,144
bytes. Diagnostics stay in host `_meta['ink.cairn/context-read-diagnostics']`.
No semantic/provider calls, execution authority, receipt recovery or answer-quality
guarantee. Profiles are local plaintext; caller copies survive logical deletion.
Sources: `core/role-context-input.mjs:25`, `core/role-context-facade.mjs:211`,
`core/role-context-wire.mjs:4`, `docs/role-profiles-local.md:89`.

## Experimental: optional context sources (U5c-2)

**Experimental in `.4`: names and shapes may change before becoming stable.**
Contract §17 v0.11.1 (`docs/plans/unified-memory-v1-contract.md:1862`);
see [optional relation and MOC sources](context-read-local.md#optional-relation-and-moc-sources)
and [source limitations](limitations.md#optional-context-sources).

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER \
  --context-read context-read-v1 --context-read-sources relations-one-hop-v1,moc-v1
```

Enable either ID or both. Programmatic MCP adds
`contextReadSources:['relations-one-hop-v1','moc-v1']`; core adds
`sources:['relations-one-hop-v1','moc-v1']` inside `contextRead` for either opener.
No new tools: opted-in `find_memory_candidates`/`findCandidates` and
`read_memory_context`/`contextRead` accept optional `sources`. Omission selects
all configured sources, `[]` disables them per call, and other selections must
be distinct subsets of the host configuration. Fetch inputs are unchanged.
Sources: `adapters/mcp/context-read-sources-configuration.mjs:9`,
`adapters/mcp/server.mjs:78`, `core/context-read-input.mjs:30`,
`core/context-read-input.mjs:106`, `adapters/mcp/context-read-sources-tools.mjs:7`.

`relations-one-hop-v1` expands current evidence one hop: **4 seeds / 2 additions
per seed / 8 additions total**, validating endpoints and source support. Families:
`supports-decision`, `challenges-premise`, `contradicts`, Card→Memory bindings.
Additions follow their direct seeds with revision-bound `via`; additions never
seed another hop. History reports `unsupported_intent` for this source.
`moc-v1` ranks authorized topic **titles**, using T1 BM25 and current eligible
members, including on history requests. It fixes `rrf-k60-d12-moc-v1`:
k=60, depth=12, lexical/semantic/MOC weights 0.45/0.45/0.10, without
renormalization when a channel is disabled or unavailable.
Sources: `core/context-read-input.mjs:10`, `core/context-read-relations.mjs:277`,
`core/context-read-moc.mjs:24`, `core/context-read-fusion.mjs:3`.

Candidate results can add `via` and `channels.moc`; core source diagnostics are
in `trace.sources`. MCP keeps source diagnostics in host
`_meta['ink.cairn/context-read-diagnostics']`; assembly retains representation-v2
and the existing snapshot/diagnostics metadata keys. The frozen horizon can
reach 32 candidates, but pages, delivered bodies and fetch refs remain capped
at 24. Source fences can stale continuations when consulted, undelivered
dependencies change; refetch still proves the existing evidence semantics.
Sources: `adapters/mcp/context-read-sources-tools.mjs:14`,
`core/context-read-facade.mjs:255`, `docs/context-read-local.md:330`.

**Known limitation:** with default caps, broad MOC queries degrade around
**10,000 Memories** (`degraded`/`work_limit`, **zero MOC candidates**). The exact
cutoff depends on titles, memberships and projection state. Each source has
50,000 work units and 8 MiB accounted state; retained source state shares
16 MiB per handle. Incomplete MOC statistics/ranking are discarded; relations
may retain a validated prefix. The deadline is cooperative and SQLite steps
cannot be preempted. This adds no model calls or persisted source data and
promises neither retrieval-quality improvement nor MOC summary freshness.
Sources: `core/context-read-input.mjs:10`, `core/context-read-relations.mjs:32`,
`docs/context-read-local.md:346`, `docs/limitations.md:2698`.

## Experimental: Card current dependencies (U5c-3)

**Experimental in `.4`: names and shapes may change before becoming stable.**
Contract §19 v0.13.2 (`docs/plans/unified-memory-v1-contract.md:2274`);
see the [Card dependency guide](card-current-dependencies-local.md)
for review and retention details. Enable authoring with:

```sh
cairn-memory --db /absolute/private/memory.sqlite --owner OWNER \
  --private-cards local-v1 --method-packages local-v1 \
  --private-card-current-dependencies local-v1
```

Programmatic MCP adds `privateCards:'local-v1',methodPackages:'local-v1',
privateCardCurrentDependencies:'local-v1'`. Core adds
`currentDependencies:{version:'card-current-dependencies-v1'}` inside the existing
`privateCards` configuration, alongside configured method packages.
Sources: `adapters/mcp/card-current-configuration.mjs:2`,
`core/private-card-input.mjs:21`, `core/contract.mjs:224`.

Two MCP tools, `declare_private_card_current_dependencies` and
`revalidate_private_card_current_dependencies`, accept
`actionId,cardId,expectedRevision,expectedDependencyRevision,roleId,packages`
(1–16 package refs) and **always refuse `approval_required`** for valid inputs.
Approval happens in an independent terminal:

```sh
cairn-memory review-card --db /absolute/private/memory.sqlite --owner OWNER \
  --card CARD --revision 2 --dependencies PACKAGES.json --role finance \
  --dependency-revision null --dependency-operation declare
```

`PACKAGES.json` is the complete package-ref array. For revalidation, use
`--dependency-operation revalidate` and the inspected positive dependency
revision. Project+personal review adds `--project PROJECT --method-read-personal true`.
The terminal displays the Card, complete resolutions and both CAS expectations,
requires the displayed phrase, then re-reads; tool input cannot approve it.
Sources: `adapters/mcp/card-current-tools.mjs:4`,
`adapters/mcp/review-card.mjs:40`, `adapters/mcp/review-card.mjs:162`.

Core `confirmCardDraft` accepts optional `currentDependencies`; standalone
`declareCardCurrentDependencies` / `revalidateCardCurrentDependencies` take
`namespace,cardId,actionId,expectedRevision,expectedDependencyRevision,currentDependencies`.
The declaration is `{context:{readSet,roleId},packages:[{package,snapshot}]}`;
obtain each current resolution snapshot with `resolveMethod` under that exact
context and fresh authorization. Initial dependency expectation is null;
replacement/revalidation uses the inspected positive revision. Revalidation
keeps the same context and complete package set. Standalone success is
`{id,revision,bodyRevision,dependencyRevision,state:'confirmed',effectCount:0}`;
it advances the dependency revision without changing the Card's text/revisions.
Sources: `core/private-card-input.mjs:152`, `core/private-card-facade.mjs:37`,
`core/card-current-input.mjs:7`, `core/card-current-storage.mjs:64`.

Reads **always compare with canonical current resolution**, even when authoring
is off. Changed consulted bindings (including same-version re-adoption),
withdrawal/deletion or Card revisions produce effective `needs-review`, not a
new lifecycle state. `support.currentDependency` reports dependency revision,
context, status, reasons and described/current versions. Reason codes:
`binding_changed`, `binding_absent_now`, `binding_disabled`, `version_deleted`,
`access_revoked`. An unauthorized complete context returns only revision,
`needs-review` and `access_revoked`, without denied-scope/package disclosure.
Sources: `core/card-current-storage.mjs:34`, `core/private-evidence-storage.mjs:54`.

Stale Cards are excluded from **current evidence, candidates, assembly,
relations, MOC members/title sources and current role guidance**. Retained
authored history remains qualified by dependency status and source availability.
With no declarations, behaviour stays byte-identical, including assembly at
deadline expiry. Dependencies do not judge semantic accuracy, rewrite Cards,
recover purged content, support Memory dependencies or establish summary freshness.
Sources: `core/test/card-current.test.mjs:11`, `core/test/card-current-sources.test.mjs:14`,
`core/test/card-current.test.mjs:76`,
`adapters/mcp/test/card-current-legacy-deadline.test.mjs:7`,
`docs/card-current-dependencies-local.md:36`.

## Experimental: assets

`assets-local-v1` remains **experimental, outside the versioning promise**.
U4b adds CLI/MCP; core opt-in:
`assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}`; selecting
assets upgrades supported stores one-way to v31. The assets/contextRead constructor
issue is fixed; regression coverage enumerates all eight asset/context/method
combinations (`core/contract.mjs:269`,
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
outside the test suites. Role profiles/task receipts, relation/MOC retrieval and
Card current dependencies are experimental opt-ins in `.4`; Raw search and
local-model adapters remain unsupported. MOC can contribute zero candidates
around 10,000 Memories under default caps, as described above.

The small synthetic host-v2 probe measured an envelope of ≈43 tokens, a first-item
increment of ≈83 and subsequent increments of ≈82 (488→126 tokens for one item).
These are not scale, quality or universal token-cost guarantees. Whole units may
still be omitted as `oversized`. Compact refs provide bounded 48-bit-prefix
change detection; snapshots additionally fence namespace/access generations.
The filed-to-filed parent-move difference above is intentional.

Continuous rollback-journal writers can starve readers: retryable `storage_busy`.
Paced workloads meet C04/K13 gates; unpaced runs are stress observations.
WAL requires a later store-wide decision, including review/store-fence changes.
Sources: [contract §16](plans/unified-memory-v1-contract.md#16-amendment-contention-gates-under-rollback-journal-mode-v072-primary-2026-10-24),
`core/database.mjs:32`, `core/private-card-facade.mjs:18`.

Storage and `.context-read-v1.sqlite` are sensitive local plaintext. Logical deletion
does not physically erase pages/journals/backups. Method text grants no execution
permission; source-derived imports await dependency fences. Local core/stdio have
no hosted-service support/safety claim. OpenAI use transmits selected text and
may incur charges. See
[limitations](limitations.md#context-retrieval-host-u5a-part-3) and
[contract non-claims](plans/unified-memory-v1-contract.md#1-scope-and-sequencing).

## Versioning promise

Stable names and DTO shapes persist across `v1-preview.*`, including
`read_memory_context` with `representation-v2` and compact-ref inputs to
`fetch_memory_candidate_evidence` from `.3`. Algorithm improvements land behind
them. Rankings, policies' quality and measured token constants are not frozen.
All three U5c features (role profiles/task receipts, optional context sources and
Card current dependencies) are **experimental in `.4`**, as are assets,
attachments and derivatives. Their names and shapes may change before becoming
stable and are excluded from this promise. This promise does not retain `.2`'s
experimental `representation-v1` output. Storage upgrades are one-way even for
experimental features; see [upgrade and rollback](#upgrade-and-rollback).

## Release notes for GitHub pre-release: v1-preview.4

Changes since `v1-preview.3`; integration `b096e043` (`ef38da4a` plus a role-guide wording fix):

- Add experimental role profiles/task receipts: four tools, direct agent
  publication with dual CAS, five read modes and caller-held `task-receipt-v1`
  receipts; default budget 4,000 tokens.
- Add experimental opt-in one-hop relations (4/2/8 caps) and MOC title ranking
  with fixed `rrf-k60-d12-moc-v1` and per-call narrowing. Default-cap MOC queries
  can degrade around 10,000 Memories with `work_limit` and zero MOC candidates.
- Add experimental Card current dependencies, separately approved through
  `review-card --dependencies`. Canonical read-time comparison excludes stale
  Cards from current guidance and reports effective `needs-review` reasons.
- **Upgrade warning:** role/dependency opt-ins migrate stores one-way to v32/v33.
  `.3` binaries refuse those stores; binary rollback requires a pre-upgrade backup.
- Keep `.3` candidate/evidence (including compact refs), representation-v2
  assembly and method-package interfaces stable, with unchanged U5c-off defaults
  on stores without declarations. All three U5c features may change names/shapes
  before stabilizing. Assets remain experimental; the private package stays
  `0.0.0-preview.1`; no npm publication.
