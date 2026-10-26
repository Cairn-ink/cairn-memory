# Context-read for the product — P2 contract draft

Draft identity: **P2 v0.1, `context-read-product-v1`**, 2026-10-27. Inventory baseline: `546d57ac083f`, branch `feat/context-read-product`. This is an authored proposal awaiting a non-author audit, not implementation approval or evidence of acceptance. The primary owns commits and implementation dispatch.

## 1. Purpose, evidence and compatibility boundary

The commercial product wants its ChatGPT `ask_cairn` tool and website search to retrieve Memories and Cards together through `find_memory_candidates`, `fetch_memory_candidate_evidence` and `read_memory_context`. Its private repository is unavailable to this author. The following observations are **product-supplied evidence from a synthetic trial against `b2513501`, Node 24**, not measurements reproduced here:

| Product observation | Consequence for this proposal |
| --- | --- |
| 1,112 Memories across four namespaces; memory-only v18 reads preserved user_version, logical hash and file hash, and the old pin reopened the file. Cards required v23. | Preserve production v18 without canonical migration; distinguish capabilities by physical schema. |
| 52 handwritten Chinese questions, lexical only: recall@5 and recall@12 reported as 92%. | Directional evidence only. Freeze queries and relevance labels before a new recall comparison; Japanese and mixed queries still need coverage. |
| A four-namespace readSet failed `invalid_read_set`; four separate calls summed to 1.36 s at 1,112 Memories and 4.47 s at 3,336. | One authorized projection and one engine ranking must replace product-side fan-out. |
| Initial lexical build took 4.5 s at 1,112 Memories and returned `index_unavailable` at 3,336. | Request success must not depend on finishing index construction in that request. |
| A 50 ms deadline still allowed 0.31–1.06 s loop gaps; every request exceeded the 100 ms main-loop budget. | Isolate native work and counting in a Worker; add a parent-controlled response cutoff. |

Production remains **schema v18**. P2 introduces no canonical migration, DDL, index, trigger, capture hook or writer callback. An explicitly authorized sidecar maintainer is sufficient for memory-only production use. Upgrading canonical storage to enable Cards is a separate product rollout, never a side effect of opening a reader.

The frozen baseline is [unified-memory-v1-contract.md](unified-memory-v1-contract.md): U5a §13, U2c §14, U5b §§15.1–15.7, the superseding §15.8 representation amendment, and §§17–§20. In particular, §15.8 supersedes earlier §15 DTO examples (`docs/plans/unified-memory-v1-contract.md:1439`, `docs/plans/unified-memory-v1-contract.md:1473`, `docs/plans/unified-memory-v1-contract.md:1608`). No frozen section is edited by this packet.

Only the new product profile changes four execution rules: Worker execution/hard response deadlines (C-1), the readSet bound (C-2), request-time maintenance (C-3), and WAL eligibility/lock handling (C-4). These are explicit opt-in amendments to §13.1, §13.2, §13.4 and §15.1, including §19.4's allowance for final work after a cooperative deadline. Every other evidence, authorization, accounting, currentness and representation rule remains authoritative.

## 2. Inventory at the baseline

Every repository behavior below is grounded in the cited source location. Proposed behavior starts in §3; product observations above are not attributed to this checkout.

### 2.1 Execution, synchronous work and deadlines

| Finding | Evidence |
| --- | --- |
| Public core exports distinguish `openMemoryReader` and `openContextReader`; the latter is a direct facade wrapper, not a Worker dispatcher. | `core/index.mjs:8`, `core/index.mjs:9`, `core/context-reader.mjs:1`, `core/context-reader.mjs:3`. |
| Context-enabled `openMemoryCore` constructs the base and a context facade on the calling thread; read-only context construction synchronously opens and initializes its own canonical connection. | `core/contract.mjs:185`, `core/contract.mjs:192`, `core/context-read-facade.mjs:60`, `core/context-read-facade.mjs:69`, `core/context-read-facade.mjs:75`, `core/context-read-facade.mjs:82`. |
| Canonical reads use `DatabaseSync`; context opener configuration currently sets a 5,000 ms native busy timeout. Thus even opening/configuring the context reader can block its caller. | `core/read-database.mjs:6`, `core/read-database.mjs:27`, `core/read-database.mjs:31`, `core/read-database.mjs:88`. |
| `findCandidates` and `contextRead` are async functions, but their canonical reads, lexical reconciliation, tokenization, BM25, fusion and exact counter work execute synchronously in that same thread between awaits. An async signature supplies no execution isolation. | `core/context-read-facade.mjs:316`, `core/context-read-facade.mjs:332`, `core/context-read-facade.mjs:347`, `core/context-read-facade.mjs:402`, `core/context-read-facade.mjs:464`, `core/context-read-facade.mjs:545`, `core/context-read-facade.mjs:618`; `core/context-read-sidecar.mjs:447`, `core/context-read-sidecar.mjs:451`, `core/context-read-sidecar.mjs:512`. |
| `fetchCandidateEvidence` is synchronous. It performs a preparatory canonical read, an authority recheck, then the final canonical refetch/fence comparison before returning the envelope. It has no deadline input today. | `core/context-read-facade.mjs:666`, `core/context-read-facade.mjs:695`, `core/context-read-facade.mjs:699`; fetch's strict field allowlist is `core/context-read-input.mjs:119`, versus query deadline parsing at `core/context-read-input.mjs:148`. |
| Search/assembly deadlines default to 1,000 ms and cap at 5,000 ms. Maintenance has explicit item/time bounds. Checks are cooperative; they do not interrupt an executing native step. Frozen U5b final validation can continue after admission stops. | `core/context-read-input.mjs:25`, `core/context-read-input.mjs:148`, `core/context-read-input.mjs:163`, `core/context-read-sidecar.mjs:422`, `core/context-read-sidecar.mjs:492`; `docs/plans/unified-memory-v1-contract.md:935`, `docs/plans/unified-memory-v1-contract.md:1154`, `docs/plans/unified-memory-v1-contract.md:2345`. |
| Authority is synchronous and checked separately for every namespace, with a complete payload binding and captured access generations. A grant is rechecked after asynchronous work. Ordinary function objects and the current MCP WeakMap token identity cannot simply be structured-cloned into a Worker. | `core/context-read-input.mjs:34`, `core/context-read-facade.mjs:137`, `core/context-read-facade.mjs:151`, `core/context-read-facade.mjs:385`, `adapters/mcp/context-read-access.mjs:10`, `adapters/mcp/context-read-access.mjs:25`. The cloning consequence is a design inference from these object/function requirements. |

### 2.2 Sidecar construction, refresh and WAL refusal

| Finding | Evidence |
| --- | --- |
| The existing sidecar is the canonical filename plus `.context-read-v1.sqlite`, independently format 1. It stores generations, documents, postings, statistics and vectors, and uses protected regular 0600 files on POSIX. | `core/context-read-sidecar.mjs:16`, `core/context-read-sidecar.mjs:28`, `core/context-read-sidecar.mjs:64`, `core/context-read-sidecar.mjs:145`. |
| Sidecars are acquired lazily per readSet/types/intent projection. Writable acquisition can create a missing file/schema and repair certain wrong-store/incompatible/corrupt sidecars; read-only acquisition refuses those conditions. Opening includes integrity/statistics checks, so simply moving `reconcile` is insufficient to remove all cold maintenance-like work from requests. | `core/context-read-facade.mjs:166`, `core/context-read-facade.mjs:179`, `core/context-read-sidecar.mjs:193`, `core/context-read-sidecar.mjs:211`, `core/context-read-sidecar.mjs:242`. |
| Writable search automatically calls `storage.reconcile` with up to 1,024 transformations and the remaining deadline. Read-only search skips reconciliation, then requires a ready projection. | `core/context-read-facade.mjs:330`, `core/context-read-facade.mjs:336`, `core/context-read-facade.mjs:341`, `core/context-read-facade.mjs:344`. |
| Reconciliation compares ordered canonical and sidecar metadata, reads/tokenizes changed eligible texts, updates postings/statistics in bounded transactions, checkpoints scan progress, and publishes only a complete matching projection. Unchanged rows avoid candidate-text retokenization; the scan itself is not O(changes). | `core/context-read-sidecar.mjs:374`, `core/context-read-sidecar.mjs:381`, `core/context-read-sidecar.mjs:385`, `core/context-read-sidecar.mjs:422`, `core/context-read-sidecar.mjs:440`, `core/context-read-sidecar.mjs:469`; frozen cost statement: `docs/plans/unified-memory-v1-contract.md:969`, `docs/plans/unified-memory-v1-contract.md:974`. |
| Readiness binds published state, canonical fences and access generations. Missing/unpublished/stale generations cannot be searched. | `core/context-read-sidecar.mjs:274`, `core/context-read-sidecar.mjs:480`, `core/context-read-sidecar.mjs:582`, `core/context-read-sidecar.mjs:598`. |
| Explicit `refreshContextIndex` refuses on the read-only facade, otherwise reconciles lexical state and may then embed documents if an embedder is configured. It can return successful `rebuilding` or `partial`, so success alone does not establish completion. | `core/context-read-facade.mjs:474`, `core/context-read-facade.mjs:478`, `core/context-read-facade.mjs:488`, `core/context-read-facade.mjs:493`, `core/context-read-facade.mjs:501`, `core/context-read-facade.mjs:525`. |
| Exact canonical WAL refusal: read-only and managed-existing context preflight checks **both** canonical and sidecar paths before opening SQLite. For each, any protected `-wal`, `-shm` or `-journal` file refuses as `index_unavailable` with internal reason `auxiliary_file`. A WAL header refuses even without companions. Guards repeat during use. | `core/context-read-facade.mjs:64`, `core/context-read-facade.mjs:85`, `core/context-read-facade.mjs:98`, `core/context-read-sidecar.mjs:48`, `core/context-read-sidecar.mjs:55`, `core/context-read-sidecar.mjs:60`, `core/context-read-sidecar.mjs:148`. |
| Exact header check in the context sidecar code reads 20 bytes, checks the SQLite signature and treats **either** byte 18 or 19 equal to 2 as WAL. This is different from corrected E1-C2 detection and must not be copied into the new policy. | `core/context-read-sidecar.mjs:35`, `core/context-read-sidecar.mjs:42`; corrected detector: `core/topic-reader-sqlite.mjs:12`. |
| Exact sidecar WAL refusal also applies to writable maintenance: existing WAL header → `incompatible`; WAL/SHM companions → `auxiliary_file`; after opening, any `PRAGMA journal_mode` other than `delete` → `incompatible`. Writable rollback journals alone can accompany authorized recovery. Ordinary writable context construction does not apply the read-only canonical preflight, so the refusal is not one universal canonical-WAL check on every opener. | `core/context-read-sidecar.mjs:48`, `core/context-read-sidecar.mjs:195`, `core/context-read-sidecar.mjs:209`, `core/context-read-sidecar.mjs:251`; caller distinction: `core/context-read-facade.mjs:85`. |

### 2.3 Read sets and ranking

| Finding | Evidence |
| --- | --- |
| Public validation accepts one namespace or two of the same owner with different scopes. With valid namespaces, two means personal plus one project; multiple projects, duplicates, mixed owners and four entries refuse `invalid_read_set`. Sorting uses UTF-8 bytes of the serialized namespace key. | `core/context-read-input.mjs:91`, `core/context-read-input.mjs:92`, `core/private-card-input.mjs:70`. |
| The sidecar independently enforces the same one/two, same-owner/different-scope boundary, associates access generations with namespaces, and creates streams over the whole projection. Widening only the facade validator would still fail. | `core/context-read-sidecar.mjs:108`, `core/context-read-sidecar.mjs:114`, `core/context-read-sidecar.mjs:119`, `core/context-read-sidecar.mjs:123`. |
| This restriction is deliberate authority/projection scope, not evidence of an inherent SQLite two-namespace limit. The frozen contract explicitly chooses personal plus one project, and the MCP adapter fixes exactly that mapping at startup. | `docs/plans/unified-memory-v1-contract.md:906`, `adapters/mcp/context-read-access.mjs:5`, `adapters/mcp/context-read-access.mjs:8`. The absence of an engine necessity is an inference from explicit validation and the stream construction above. |
| There already is engine-wide ranking for the permitted union: a projection's N/total length/df cover all its streams; one BM25 list is scored and sorted across them. There is no per-namespace result concatenation or separate namespace RRF. | `core/context-read-sidecar.mjs:123`, `core/context-read-sidecar.mjs:348`, `core/context-read-sidecar.mjs:488`, `core/context-read-sidecar.mjs:490`, `core/context-read-sidecar.mjs:512`; projection-statistics invariant: `core/context-read-bm25.mjs:19`. |
| RRF fuses **channels** over that projection. Local preset is k60/depth12/weights .45/.45; hosted is k10/depth24/weights .5/.5. Without ready complete semantic coverage, ordinary two-channel fusion preserves lexical BM25. Raw and fused score ties use binary canonical `(owner,scope,project,type,id)` order. | `core/context-read-fusion.mjs:3`, `core/context-read-fusion.mjs:27`, `core/context-read-fusion.mjs:33`, `core/context-read-fusion.mjs:39`; `core/context-read-bm25.mjs:6`, `core/context-read-bm25.mjs:12`, `core/context-read-bm25.mjs:17`. |
| Optional MOC/relations have a separate opt-in, preset and horizon. They must not appear implicitly as part of P2. | `core/context-read-input.mjs:9`, `core/context-read-input.mjs:60`; `docs/plans/unified-memory-v1-contract.md:1877`, `docs/plans/unified-memory-v1-contract.md:1880`. |

### 2.4 Reusable Worker/WAL machinery and measurement tools

| Finding | Evidence |
| --- | --- |
| `openMemoryReader` offers a fixed lazy Worker entry, isolated env/execArgv, drained stdout/stderr, resource limits, one pending call, idle unref/60 s disposal, crash handling, a parent watchdog and async close that awaits termination. Member requests carry a monotonic absolute deadline, with late-success rejection. | `core/memory-reader.mjs:7`, `core/memory-reader.mjs:10`, `core/memory-reader.mjs:16`, `core/memory-reader.mjs:32`, `core/memory-reader.mjs:40`, `core/memory-reader.mjs:49`, `core/memory-reader.mjs:59`, `core/memory-reader.mjs:73`. |
| Reuse does require a cancellation improvement: current timeout/failure paths await `stop()` before settling the pending call. Copying that ordering would couple public cancellation to native cleanup. Lifecycle tests already cover close, watchdog, idle expiry and unexpected exit. | `core/memory-reader.mjs:26`, `core/memory-reader.mjs:61`, `core/memory-reader.mjs:73`; `core/test/topic-overview-lifecycle.test.mjs:48`, `core/test/topic-overview-lifecycle.test.mjs:58`, `core/test/topic-overview-lifecycle.test.mjs:71`. |
| E1-C2 establishes the first-statement WAL hazard: recorded busy failures occurred during fresh per-write close, before enumeration, consistent with last-connection reset racing metadata reads. This is existing recorded evidence, not a new P2 run. | `docs/plans/topic-reader-wal-fix.md:7`, `docs/plans/topic-reader-wal-fix.md:9`. |
| Corrected WAL detection reads a complete 100-byte safe descriptor, matches device/inode, checks the format-3 signature and requires 2/2. `createTopicSqlitePolicy` refreshes a single request-wide 100 ms WAL wait allowance, capped by the deadline, before prepares, cached executions, iterator steps and rollback. DELETE keeps zero wait. It captures sanitized stage/statement/numeric native diagnostics and does not retry transactions. | `core/topic-reader-sqlite.mjs:7`, `core/topic-reader-sqlite.mjs:19`, `core/topic-reader-sqlite.mjs:24`, `core/topic-reader-sqlite.mjs:49`, `core/topic-reader-sqlite.mjs:59`, `core/topic-reader-sqlite.mjs:71`, `core/topic-reader-sqlite.mjs:82`; corrections: `docs/plans/topic-overview-member-pages.md:887`, `docs/plans/topic-overview-member-pages.md:912`. |
| Existing memory layout is v18. The context opener's accepted-version union includes v18 and 20–33, not v19; it opens read-only rather than migrating. Its Card capability detection checks requisite tables rather than enforcing the product's v23 floor. P2 must state that floor explicitly. | `core/confirmation-schema.mjs:3`, `core/database.mjs:39`, `core/database.mjs:43`, `core/private-card-schema.mjs:2`, `core/private-evidence-schema.mjs:1`, `core/private-organization-schema.mjs:1`, `core/local-authority-schema.mjs:3`, `core/raw-schema.mjs:2`, `core/raw-lineage-schema.mjs:1`, `core/raw-deletion-schema.mjs:1`, `core/raw-source-schema.mjs:3`, `core/read-database.mjs:27`, `core/context-read-facade.mjs:110`. |
| `measure-context-read-u5a.mjs` is an explicit `--run` synthetic sidecar refresh profiler: default 1k/10k sizes, build/cold/warm/delta work, SQL/commit timing, file size and RSS. It is not a product Worker/WAL gate. | `tools/testing/measure-context-read-u5a.mjs:1`, `tools/testing/measure-context-read-u5a.mjs:18`, `tools/testing/measure-context-read-u5a.mjs:21`, `tools/testing/measure-context-read-u5a.mjs:40`, `tools/testing/measure-context-read-u5a.mjs:49`, `tools/testing/measure-context-read-u5a.mjs:61`. |
| `measure-context-read-u5c2.mjs` profiles optional-source work using synthetic public operations and independent database instrumentation; cold means a new handle, not an OS cache flush. It performs no provider calls. | `tools/testing/measure-context-read-u5c2.mjs:1`, `tools/testing/measure-context-read-u5c2.mjs:15`, `tools/testing/measure-context-read-u5c2.mjs:23`, `tools/testing/measure-context-read-u5c2.mjs:29`, `tools/testing/measure-context-read-u5c2.mjs:101`. |
| `measure:topic-members` already uses 1,112/3,336, DELETE/WAL, host-loop sampling and actual read/write intervals, but its output explicitly disclaims performance acceptance. Its writer arrangement is not the fresh per-request writer-close matrix needed here. | `package.json:75`, `tools/testing/measure-topic-members.mjs:8`, `tools/testing/measure-topic-members.mjs:14`, `tools/testing/measure-topic-members.mjs:29`, `tools/testing/measure-topic-members.mjs:39`. |
| `measure:topic-reader-wal` is the stronger reuse basis: child-process retained/fresh writers, fresh public reader lifecycles, paired baselines, zero-wait controls, five 30 s repetitions, native busy classification, and actual write/close overlap minima. Its 250 ms reader target belongs to E1-C2, not P2. | `package.json:79`, `tools/testing/measure-topic-reader-wal.mjs:1`, `tools/testing/measure-topic-reader-wal.mjs:36`, `tools/testing/measure-topic-reader-wal.mjs:50`, `tools/testing/measure-topic-reader-wal.mjs:77`, `tools/testing/measure-topic-reader-wal.mjs:93`, `tools/testing/measure-topic-reader-wal.mjs:171`. |
| Moving embedding into multiple Workers would accidentally multiply the existing module-local budget ledger unless explicitly coordinated. Existing accounting is per identity/process and retains active reservations until actual provider settlement. | `core/context-read-budget.mjs:3`, `core/context-read-budget.mjs:19`, `core/context-read-budget.mjs:35`, `core/context-read-budget.mjs:59`; process-wide local ownership requirements: `docs/plans/unified-memory-v1-contract.md:2542`, `docs/plans/unified-memory-v1-contract.md:2555`. The Worker multiplication risk is an inference from module-local state. |

## 3. Version identity and unchanged defaults

Select P2 through **new constructors** with literal `profile:'context-read-product-v1'`; retain `version:'context-read-v1'` for the existing data contract. Unknown/missing product profile on these constructors refuses `invalid_input`. Existing `openContextReader`, context-enabled `openMemoryCore`, `openMemoryReader`, tools and CLI defaults do not silently switch execution modes or widen validation.

Without P2 selection, preserve byte-identical DTOs, ordering, errors, capabilities, tool descriptions/schemas, prompts and provider-call counts. No new default field, background timer, Worker, sidecar probe, environment lookup or network call is introduced in legacy paths. Compatibility golden comparisons normalize only pre-existing nondeterministic fields explicitly identified by the test; metered serializer bytes and tool-list bytes are exact.

Product capabilities additionally identify the profile, execution mode, hard response cutoff, cancellation support, readSet maximum, ready-only index use, supported schema/type combinations and journal support. Candidate/evidence/assembly success DTOs retain U5a/U5b shapes. Lifecycle status is a separate host API, not a field inserted into the metered representation.

Use a separate product sidecar suffix, **`.context-read-product-v1.sqlite`**, with independently versioned format 1 and a product-profile marker. This avoids making legacy readers refuse their own cache after product maintenance enables WAL, and avoids mutating old generations in place. No implicit import, conversion, deletion or repair of `.context-read-v1.sqlite`. Product initial construction is an explicitly scheduled build, even if a legacy sidecar exists. Reuse the storage algorithms and invariants, not legacy file ownership.

Bind product cursors/snapshots to the product profile and canonical readSet in addition to all existing bindings; they are opaque strings with the same bounds. Reject cross-profile cursor/snapshot reuse as `invalid_cursor`/`invalid_snapshot`. Compact item fences retain the existing store-local `snapshot-item` HMAC and eight-character prefix; this profile does not replace that identity or mint new authority.

## 4. Public API and execution boundary — C-1

Proposed core exports (names are part of this draft):

```js
const reader = await openContextProductReader({
  path,
  version: 'context-read-v1',
  profile: 'context-read-product-v1',
  readSet,                         // host-fixed, canonicalized once
  host: { moduleUrl, configuration },
  diagnostics: false,              // literal true opts into native diagnostics
  deadlineMs: 5000                 // opening deadline; 1..5000
});

await reader.getContextReadCapabilities();
await reader.getContextIndexStatus({ readSet, types, intent, deadlineMs }, token, { signal });
await reader.findCandidates(input, token, { signal });
await reader.contextRead(input, token, { signal });
await reader.fetchCandidateEvidence({ ...fetchInput, deadlineMs }, token, { signal });
await reader.close();
```

All methods return Promises of envelopes, including fetch and capabilities. Constructor option validation rejects invalid input before dispatch; operational opening failures reject with a sanitized coded error. No partially initialized handle escapes. `close()` is idempotent, stops dispatch and awaits actual Worker/native cleanup; it is not itself a reader-latency promise.

`input` and `fetchInput` retain existing strict core grammars and bounds. Query/fetch/status deadlines are positive integers 1–5,000 ms, default 1,000 ms. Fetch gains `deadlineMs` **only on this profile**; it supports existing full refs, aligned internal fences, or snapshot, with their original mutual exclusions. The product tool adapter accepts compact refs under §15.8 and expands them against the immutable startup mapping. The adapter must await fetch and propagate disconnect/abort through the separate `signal` control argument. Signals, tokens and host configuration never become model-supplied tool fields. The P2-only fetch tool schema may expose bounded `deadlineMs`; legacy schemas stay exact.

The trusted host fixes the readSet. Core requests repeat it, accepting permutations that normalize to the fixed set; omission or a different well-formed set refuses `invalid_read_set`. A new selection requires a new handle and mapping, never live reordering of compact `ns` indices. MCP and website adapters inject that fixed set; an LLM cannot supply namespaces, authority, fences, bootstrap modules, maintenance options, providers or ranking configuration.

### 4.1 Non-transferable host functions

`host.moduleUrl` is a trusted constructor-only local file module, loaded **inside the fixed Cairn Worker entry**, exporting `createContextReadHost(configuration)`. It supplies the existing synchronous `{authorize,isCurrent}`, optional exact `{id,countTokens}`, and explicitly configured optional embedder/policy/local-status ports. It does not open a migration-capable core. Configuration and per-call tokens must be bounded structured-cloneable data; closures, function-source evaluation and serialized grants are unsupported. The host authenticates and issues its own opaque tokens; cloning a token is never an authorization decision.

The module is explicit host code with host privileges, never a URL or import selected by request data. No network module loading, environment-inherited provider selection, model download or key discovery occurs implicitly. An absent counter still permits candidates/fetch and refuses assembly under the existing counter contract.

The Worker-local authority must synchronously consult current host authority, including revocation generations. A host may supply a synchronized shared revocation registry in constructor configuration; it must publish changes atomically before treating revocation as effective. A stale startup allowlist or parent-provided `authorized:true` is insufficient. If the host cannot provide current synchronous checks in the Worker, construction refuses `authority_required`; do not fall back to main-thread SQLite or a last-minute parent RPC after final reading. The current MCP WeakMap authority therefore needs an explicit product adapter, not a generic function copier.

Authorize the complete method/input, including fetch fences and every namespace, before index access or transmission. Recheck after every await, before provider transmission, publication and final validation. No host callback, counter or await occurs in a transaction or after the final authoritative read. The Worker posts the already frozen result synchronously after that read; parent IPC delivery is transport, not a later revalidation point. Linearization remains the Worker's final read. A write/revocation after it invalidates later operations according to frozen rules, not retroactively the completed read.

### 4.2 Worker ownership and bounds

Reuse/refactor `memory-reader.mjs` dispatch, identity, resource, error, idle and termination machinery behind the new entry; preserve legacy behavior. SQLite-reaching imports remain dynamic behind the established local/CLI boundary, with no `createRequire` escape. Keep the Worker entry fixed, env empty, execArgv empty and output drained. All native open/configure/schema work, canonical/index reads, scoring, tokenization and exact counting run off the host thread.

One in-flight operation per handle, no implicit queue; overlap refuses `read_in_progress`. The reader and maintainer have distinct Workers, so background work cannot occupy the request slot. Retain bounded ranking state, 128 rankings/five-minute TTL and 60 s idle disposal; idle/crash/timeout invalidates retained cursors as `cursor_stale`. A valid durable snapshot can still be canonically refetched after reopening, subject to its fences and profile.

Parent validation inspects own data without executing getters/proxies and caps request/token/configuration IPC separately at 262,144 UTF-8 bytes per message. Data responses still fit the existing 65,536-byte envelope, snapshots 16,384 characters, cursors 8,192 characters and tool transport 262,144 bytes. Reject oversized indivisible data as `context_item_too_large`. Clone/serialization costs and startup/settlement callbacks count toward the host-loop gate; offloading SQLite alone is insufficient. Select Worker heap limits explicitly after auditing the existing 128 MiB vector-cache allowance and counter runtime; do not copy the topic reader's 64 MiB heap blindly.

### 4.3 Hard response deadlines and cancellation

Measure one absolute monotonic deadline from public method entry, including bounded validation, IPC, any lazy restart/opening, authority checks, native waits, scoring, counter work and final canonical revalidation. The parent watchdog owns this deadline independently of Worker progress. Cooperative checks remain useful inside the Worker but do not define the public cutoff.

On expiry, latch `read_timeout`, discard all later messages for that operation/Worker epoch, signal cancellation and request termination. **Settle the public call before awaiting termination.** On AbortSignal, do the same with `read_cancelled`; pre-aborted calls dispatch nothing. On explicit close, settle active work with `store_closed`, then await cleanup. First terminal event wins; a result received at or after the absolute deadline is a timeout even if the Worker computed it earlier. A result accepted before the cutoff must have completed all frozen final checks.

Never deliver a partially refetched evidence list or an assembly whose final validation was cut short. If an ordinary semantic timeout degrades to lexical and a fully validated result arrives before the outer cutoff, retain that frozen channel behavior. Otherwise the entire operation times out. Optional admission may stop early, but required metering/final validation must fit the hard response window or the result is discarded. Do not extend a deadline for a final pass.

“Hard” means a parent-enforced response cutoff and prompt public cancellation independent of native cleanup; it does **not** claim that Node terminates an executing SQLite step at an exact CPU instant. Timers also depend on host scheduling. Record actual settlement overshoot and native cleanup lag separately. Keep the Worker/resource slot quarantined until observed termination and any provider cleanup settle. While quarantined refuse `read_in_progress`; do not launch replacements or free provider capacity on a timer alone. Failure to confirm cleanup latches `reader_failed` and forbids automatic replacement. An idempotent `close()` exposes cleanup completion; the product owns awaiting it on shutdown.

## 5. Owner-wide readSet and deterministic fusion — C-2

The shape stays an array of full namespaces:

```js
[
  { ownerId, scope: 'personal', projectId: null },
  { ownerId, scope: 'project', projectId: 'project-a' },
  { ownerId, scope: 'project', projectId: 'project-b' },
  { ownerId, scope: 'project', projectId: 'project-c' }
]
```

Proposed maximum: **32 distinct namespaces**, one owner, at most one personal namespace, up to 31 projects when personal is included. A nonempty project-only subset or personal-only set is legal. Every namespace uses existing identifier/namespace rules. Reject duplicates, mixed owners, malformed entries, sparse arrays, unknown fields, accessors and over-limit input as `invalid_read_set`, before sidecar statistics or evidence work. “Owner-wide” means the host's explicit authorized enumeration, not automatic discovery or permission to read every project belonging to that owner. Product confirmation of the maximum remains open.

Canonicalize with the existing UTF-8 namespace-key ordering, preserving the current mapping for existing one/two-namespace inputs. Both facade and sidecar projection validation must use the new profile-aware validator. Access-generation vectors are sorted with their namespaces; sorting them independently is forbidden. No namespace may be dropped silently. Authorization refusal fails the entire call; no partial authorized subset is inferred.

The **ranking rule is pooled projection ranking**, extending today's engine rule, rather than adding a second RRF over namespaces:

1. Construct the exact authorized union for normalized `(readSet, types, intent)`. Use one complete eligible-projection N, total token length and term df. Score every matching document with frozen T1/BM25 constants. Sort descending score, then binary canonical `(owner,scope,project,type,id)` tuple. No per-namespace top-k truncation before this score/rank.
2. If explicitly enabled semantic preflight is complete over that entire union and within existing vector/resident-byte bounds, embed the query once and score the full authorized vector set. Sort cosine ties with the same tuple. Never dispatch one embedding per namespace or fuse incomplete semantic coverage.
3. Fuse the **global lexical and global semantic lists once**, using the existing family preset: local `rrf-k60-d12` or hosted `rrf-k10`. Score is `sum(weight / (k + oneBasedChannelRank))`; absent membership contributes zero. Sort fused score descending with the same canonical tuple tie-break; retain the existing 24-item horizon, default limit 12 and maximum 24. Disabled/degraded semantic preserves global BM25 order.
4. Freeze this single ranking for continuation; namespaces do not receive quotas, weights or a priority based on input order. Equal bodies remain separate typed identities. ReadSet permutations cannot change ranks, compact namespace indices, statistics, snapshots' scope binding or results.

This is the deterministic engine fusion across namespaces: one pooled lexical/semantic universe followed by the established channel fusion. The product performs no RRF, score normalization or merging of namespace responses. P2 adds no new tokenizer, substring fallback or quality claim. Explicitly test the frozen one-character Han known miss separately from regression failures.

The initial product profile exposes the baseline Memory/Card lexical and optional semantic channels. Optional relations/MOC, role reads, assets and Raw search are not enabled by P2. Source/profile requests unavailable on the product handle refuse `invalid_input`; legacy separately opted-in paths remain unchanged. Card current-dependency checks on schemas that contain them remain mandatory even without optional retrieval sources; background maintenance must observe their extra fences before statistics/publication, per frozen §19.4.

## 6. Index lifecycle and maintenance — C-3

### 6.1 Lifecycle and visibility

Readiness is **per exact normalized readSet/types/intent projection**, tokenizer/representation, store/profile identity and access/canonical/dependency fences. A ready single-namespace index does not imply a ready four-namespace index. The host pre-registers/builds projections it plans to query; unforeseen combinations return unavailable until explicitly maintained. Requests never manufacture aggregate statistics from incomplete shards.

`getContextIndexStatus` is an authorized, Worker-backed observation only, with the same hard deadline and fixed readSet. Its strict input is `{readSet,types,intent,deadlineMs?}` with existing type/intent validation. Authority must explicitly allowlist this new method and bind its full input before any projection observation. Proposed success value is `{profile, lexical:{state,reason,progress}, semantic:{state}, coverage}`; counts/progress are limited to that authorized projection, unknown counts are null. `state` for lexical lifecycle is the closed enum below; `reason` uses sanitized missing/stale/corrupt/incompatible/wrong-store/closed categories, never paths or native messages. Semantic state reuses the frozen channel-state enum. This DTO is host lifecycle metadata, not a retrieval DTO or model text.

| Lexical state | Meaning | What search/assembly requests see |
| --- | --- | --- |
| `absent` | No validated product generation for this projection. | `index_unavailable`; coverage unavailable, unverified counts null. No file creation. |
| `building` | First build/rebuild has committed incomplete checkpoints. | `index_unavailable`, existing maintenance buildState `rebuilding`; never search checkpoints. |
| `ready` | Complete published generation matches current canonical/access/dependency fences. | Read it with existing channel/coverage DTOs and final fences. Complete-empty requires a fresh exhausted lexical search. |
| `stale` | Published generation exists but any required fence changed. | `index_unavailable`; never serve stale candidates while waiting for catch-up. Existing affected continuations use `cursor_stale`. |
| `catching_up` | Explicit background reconciliation is in progress for a stale generation. | Same as stale; an old generation is usable only if it still matches all required fences. |
| `unavailable` | Corrupt, incompatible, wrong-store or unsafe/unusable index. | `index_unavailable` (or existing safe-file opener refusal where applicable); no request repair. |
| `closed` | Handle closed or connection discarded. | `store_closed`. |

States are derived from durable checkpoints plus current observations; do not require a canonical state table. A maintainer crash cannot leave a permanent “running” claim. Valid incomplete progress is resumable. Read-side status checks may detect staleness but cannot persist catch-up markers or enqueue an implicit repair.

Incomplete lexical generations remain unavailable. This proposal chooses that honest failure rather than a new partially searched namespace DTO. Existing `coverage.status:'partial'` or channel degradation remains usable only when its frozen meaning is truthful for an already matching published generation. Lexical-ready/vector-incomplete reads with `semantic:true` follow existing `partial_coverage` semantic degradation and make zero query embedding calls; lexical coverage is not relabeled incomplete merely because vectors are missing. Maintenance may report `partial`; neither partial nor unavailable is “no matches.”

### 6.2 Explicit background API and budgets

```js
const maintainer = await openContextIndexMaintainer({
  path, version: 'context-read-v1', profile: 'context-read-product-v1',
  readSet, host: { moduleUrl, configuration },
  sidecarJournalMode: 'WAL',        // required: 'DELETE' or 'WAL'
  deadlineMs: 5000
});

await maintainer.refreshContextIndex({
  readSet, types, intent,
  mode: 'lexical',                  // required: 'lexical' or 'embeddings'
  budget: { maxItems: 1024, maxMs: 5000 }
}, token, { signal });
await maintainer.getContextIndexStatus({ readSet, types, intent, deadlineMs }, token, { signal });
await maintainer.close();
```

The maintainer opens the **canonical database read-only** and only the product sidecar writable. It never constructs ordinary `openMemoryCore`, migrates canonical v18, changes canonical journal mode or installs hooks. Host authority explicitly allowlists `refreshContextIndex`. Read handles do not expose refresh; maintenance is neither an MCP tool nor a lookup fallback.

One refresh is one bounded quantum: `maxItems` 1–1,024 transformation/embedding attempts, `maxMs` 1–5,000 including opening/validation needed by that call, native waits, scans, checkpoint/publication and inference. Parent cutoff/cancellation follows §4.3. Existing batches cap at 128 rows/2,000,000 text units, with provider-aware single-document local batches where §20 requires them. Scanned metadata, support/dependency lookups and text bytes are independently metered; item caps alone do not bound scanning cost. No unbounded “drain until complete” call is exposed.

`mode:'lexical'` builds missing storage or catches up changed metadata/text and never calls an embedder, even when one is configured. `mode:'embeddings'` requires an independently explicit provider and maintenance policy/budget; it operates only on an already ready lexical projection, otherwise returns `rebuilding`/unavailable without implicitly performing lexical work. It embeds missing exact-identity document vectors outside transactions and revalidates authority/fences after every await and before each commit. Missing vector state never triggers implicit embeddings in a read.

Reuse checkpoint/replay and metadata-merge machinery. Put deep integrity/statistics verification, first schema creation, repair, full build, tokenization and catch-up in maintenance Workers. Read requests perform only bounded read-side identity/format/publication/freshness verification and ready-index lookup; never DDL, `quick_check`, full statistics consistency scans, tokenization of canonical document corpora, writes or repairs. Schema validation must still attest consumed physical layouts; a maintenance certificate cannot substitute for canonical identity/fences. Canonical physical-layout validation may be cached during explicit Worker initialization and invalidated on file/schema change. Projection observations and index validation still require per-call authority; construction without a call token cannot pre-read private projection statistics. A request encountering a new unvalidated index returns unavailable until explicitly maintained/validated.

Checkpoints atomically commit documents/postings/statistics/vector changes and matching progress. Publish only after the entire projection and its statistics are complete under unchanged authority/canonical/dependency fences. Changes invalidate at canonical commit, including feature-off writers and other processes. No changed/revoked batch publishes, no partially updated statistics score. Killing an uncommitted batch leaves replayable work; committed checkpoints survive. Reuse valid unchanged text/vector identities, never relabel vectors across embedder/representation identities.

The host may explicitly schedule repeated refresh quanta with its own total wall/item/provider budget and cadence. It must stop/reschedule on exhaustion or failure, report last durable progress and establish supervision; a detached OS task/log alone is insufficient. Reader startup and requests never start that scheduler. Freshness delay and prolonged unavailability during sustained writes are product-visible tradeoffs, not permission to serve stale evidence.

Maintenance success retains `{status,progress,coverage,channels}` with `status:'rebuilding'|'partial'|'complete'`. Lexical completion means a ready matching generation; embedding completion additionally requires ready full semantic coverage for the configured identity. Timeout/abort may occur after a durable checkpoint, so callers inspect status on a later explicit call rather than assuming rollback of all previous progress.

### 6.3 Embeddings and shared accounting

`semantic` remains opt-in and false by default. A configured provider/key alone does not enable it. A semantic read may make the existing **one explicit query embedding** after complete-coverage/capacity preflight, with guarded transmission and declared budgets; it never embeds documents, downloads a model, starts catch-up or hides a network call inside lexical lookup/fetch. Continuations, evidence-only calls and incomplete semantic coverage make zero embedding calls. An offline deployment can configure only the audited local provider or no provider.

Maintenance embedding configuration and budgets are explicit and separate from reader work budgets. They constrain, rather than replace, the frozen process-wide identity ledger and local child ownership. Provide one shared coordinator across Worker isolates/handles, covering query and refresh attempts, money where applicable and active native children. Provider execution, estimation callbacks and child supervision also stay off the host main thread; the coordinator is an owned supervised service, not disposable request-Worker state. Worker restarts cannot reset totals, double-spend or duplicate local children. Reserve before transmission, recheck authority after reservation, retain unknown-usage charges, and keep active capacity reserved until actual underlying settlement/reaping. If that coordination is unavailable, refuse semantic configuration rather than advertising isolation with multiplied budgets. Follow §20's independent child supervisor and quarantine rules when the optional local model is selected.

## 7. WAL and lock policy — C-4

Support canonical DELETE and WAL databases and product sidecars in DELETE and WAL, including read-only context handles. Test all canonical/sidecar combinations; primary performance cells include DELETE/DELETE and WAL/WAL. A background maintainer may explicitly establish its sidecar's configured journal mode during initialization, with no concurrent product handles; it never switches a live canonical mode. Concurrent external journal-mode changes are outside the connection contract.

Reuse `topicJournalMode`, `createTopicSqlitePolicy`, native diagnostics and the Worker dispatch policy; generalize their use rather than adding another sleep/retry subsystem. Detect each database from the complete safe 100-byte format-3 header, verified descriptor/device/inode, before lock-taking metadata PRAGMAs. Only 2/2 enables WAL waiting. Unknown/truncated headers retain zero wait and normal layout refusal. Install the policy **before the first configuration/validation statement**, including `application_id`/`user_version`, to cover E1-C2's first-statement race.

Use one operation-wide native WAL wait window of **100 ms**, capped by remaining monotonic request/maintenance deadline. Canonical and sidecar connections share its start and end; do not restart it per connection, transaction or statement. Query work consumes this window. Refresh floored nonnegative remaining time before prepare, cached execution, iterator step, BEGIN/COMMIT/ROLLBACK, including zero after expiry. DELETE connections retain zero wait. All waits happen in the Worker. No application transaction retry, polling sleep, parent-thread wait, hidden five-second native timeout or automatic repeated request is allowed.

Canonical/sidecar reads use the frozen deferred-BEGIN/query_only transaction discipline; maintenance's sidecar writes use separate bounded transactions. Never hold a canonical snapshot while awaiting a provider, callback or next quantum. Background maintenance must release read snapshots between bounded phases so it does not indefinitely pin the WAL. Public cancellation settles independently; native rollback/close and WAL lock release may lag until termination is observed.

Replace blanket WAL/header/companion refusal **only for the product profile** with safe live-WAL handling. Allow SQLite's normal coordinated WAL/SHM access, including safe companion creation when needed and permitted by the explicitly opted-in deployment. Do not use `immutable`, force checkpoints, restore SHM bytes, manually unlink a live WAL/SHM, recover canonical hot journals, open canonical writable or change its journal mode. Validate existing companion identity/type/protection and safe creation context; unsafe/symlinked companions still refuse. Unsupported filesystem/SQLite read-only WAL arrangements report `index_unavailable` honestly, never fall back to canonical writes. Supported arrangements must be qualified on the target runtime/platform.

Quiescent canonical schema/data/user_version/journal mode stay unchanged. For DELETE, demand canonical file-hash equality. For WAL, separate logical/canonical preservation from native SHM read marks/creation: reuse the native-control comparison, cold differences limited to permitted read marks and warmed equality described in `docs/plans/topic-overview-member-pages.md:777`. Do not promise whole-file equality during concurrent writes or erase legitimate SHM changes to satisfy a hash check. Legacy sidecar bytes remain untouched by product maintenance.

Native budget exhaustion remains `storage_busy`; parent deadline cutoff is `read_timeout`. Never reclassify native busy as unavailable/unsupported/timeout just to pass a gate. Optional native diagnostics use the existing closed E1-C2 stage/statement families and numeric primary/extended codes, adding fixed context statement-family labels only through an audited enum extension. No SQL, native messages, paths, identifiers, text or credentials appear. Diagnostics do not enter metered text.

**WAL `storage_busy = 0` is a measured product gate for the registered workload, not an assertion that arbitrary external locks cannot produce busy.** Deterministic exclusive-lock/exhaustion tests must still prove truthful busy classification. There is no inspected-code reason to drop the product's gate; the first-statement race has reusable mitigation, but P2 has not yet been measured.

## 8. Errors, evidence and schema requirements

### 8.1 Error contract

All data errors use `{ok:false,error:{code,retryable,...sanitizedDetails}}`. Preserve existing codes and precedence; only `storage_busy` is automatically marked retryable. There are no automatic retries. New lifecycle errors are confined to the new constructors/handles/profile.

| Code | Product meaning |
| --- | --- |
| `invalid_input`, `invalid_read_set` | Bad strict grammar, unsupported option/type or invalid/fixed-set mismatch. |
| `authority_required` | Missing/denied initial host authority; no index access. |
| `scope_changed` | A granted scope/access generation was revoked or changed before the operation's final authority check. |
| `invalid_cursor`, `cursor_stale` | Invalid binding versus changed/expired/evicted/Worker-lost ranking; never rerank silently. |
| `invalid_snapshot`, `snapshot_stale` | Invalid snapshot scope/integrity versus changed generations/full item fences or compact fence mismatch, subject to frozen eligibility/revision precedence. |
| `revision_conflict`, `evidence_unavailable` | Existing exact-revision/eligibility errors; whole fetch refuses, never substitutes a new revision. |
| `index_unavailable` | No ready matching validated projection, unsafe/unusable index or unsupported WAL arrangement; sanitized existing coverage/channels/trace when authorized. |
| `token_count_unavailable`, `context_item_too_large` | Existing exact-counter/size refusal; no heuristic, truncation or partially fetched evidence. |
| `storage_busy`, `storage_error` | Native contention versus other sanitized storage failure; retain stage/numeric diagnostics when opted in. |
| `read_timeout` | New handle's hard response cutoff, nonretryable; late results discarded. |
| `read_cancelled` | New handle's explicit AbortSignal cancellation, nonretryable; late results discarded. |
| `read_in_progress` | New handle already occupied or native cleanup quarantined; no queue. |
| `reader_failed`, `store_closed` | Unexpected Worker/protocol/cleanup failure versus explicit closed/discarded handle. |
| Existing opener codes | Preserve `invalid_path`, `database_not_found`, `unsafe_database_file`, `unsupported_database` and their existing safe precedence. |

Scope/store/authority failures suppress private diagnostics. Candidate failures retain existing `details:{channels,coverage,trace}`; assembly candidate failures retain `details:{candidates}` and the existing `_meta` extraction. Worker lifecycle failures carry no invented counts or partial data. A malformed/future schema remains an opener refusal, not empty results. An unsupported requested capability on an otherwise supported layout is `invalid_input`.

### 8.2 Evidence, refs and model boundary

U5a §13.6, U5b §§15.5–15.8 and applicable §§17–§20 remain normative. Preserve `representation-v2` serializer byte order, exact counter budget, whole bodies/source units, omission algebra, default omission, trust framing and `untrusted-data-not-instructions`. Snapshot and diagnostics stay outside assembly metered text in the existing two `_meta` keys. The host tests that neither is forwarded to the model; no extra text block or `structuredContent` is added.

Compact refs retain `ns/type/id/rev/bodyRev/f`, eight-character mandatory `f`, core verification in both preparatory/final reads, and immutable canonical namespace mapping. They confer no authority. Full refs retain their existing semantics; raw `fences` remains unavailable to tool callers. Host-only snapshots bind exactly the delivered ordered set, full fences and generations. Preserve the frozen documented difference: a parent-only filed→filed MOC move can leave compact-ref fetch unchanged while snapshot fetch is stale. Do not collapse all mutations to `snapshot_stale`; eligibility and revision errors retain §15.8.3 precedence.

### 8.3 Per-capability schema table

Physical layout and consumed tables/indexes must validate, not merely a relabeled `user_version`. The supported-version allowlist is explicit and does not automatically admit a future version.

| Capability | Canonical requirement under P2 | Sidecar / deployment requirement |
| --- | --- | --- |
| Memory candidates, exact Memory evidence, Memory assembly (`current`/`history`) | **v18**, also accepted physical layouts v20–v33; no v19, below-v18 or unknown future layout. Never query absent Card tables. | Candidates/assembly need a ready product lexical projection. Exact evidence can read canonically without a ready/missing sidecar; it still enforces refs/snapshot fences. Assembly needs an exact counter. |
| Card candidates, exact Card evidence, mixed Memory/Card assembly | **v23–v33** for the product profile. v18/v20–v22 expose Memory only; requesting Cards refuses `invalid_input`. This explicit product floor is stricter than baseline table-presence detection. | Same ready-index rule for search/assembly; exact evidence needs no index. Existing Card eligibility/support semantics remain mandatory. |
| Background lexical build/catch-up | Same schema as selected types: v18 for Memory, v23+ for Cards, within the allowlist. | Canonical read-only, product sidecar writable, explicit maintenance authority/budgets; no migration. |
| Semantic query / explicit document-vector catch-up | No extra canonical schema beyond selected types. | Explicit provider, exact identity/full coverage/capacity and shared budgets; document catch-up only on the maintenance API. Local pack requirements remain §20. |
| WAL readers/maintenance | Same schema gates as above; WAL is not a reason to upgrade v18. | Qualified live-WAL filesystem/SQLite arrangement and Worker-only bounded lock policy, for canonical and product sidecar independently. |
| Later optional features | P2 does not enable Raw search, assets, roles or optional MOC/relations retrieval. Existing current-dependent Card data in v33 must still be honored. | Any added retrieval composition needs its own explicit opt-in/audit under frozen §§17–§20. |

## 9. Deterministic acceptance before performance claims

These are future implementation checks, **not run in this docs-only task**. Ordinary suites assert functional outcomes with mock clocks/rendezvous points, not elapsed timing, overlap counts or p95 gates. Use Node **22.16.0 and 24.15.0**, physical v18/v23/current-v33 fixtures, DELETE and WAL, and intermediate accepted-version smoke coverage. Do not edit another owner's tests/fixtures to make P2 pass.

| ID | Required observable |
| --- | --- |
| P2-01 Defaults and versioning | Legacy goldens, tools/list, strict refusals, providers and sidecar bytes remain identical without P2. Product profile/version mismatch refuses; product and legacy opaque tokens cannot be interchanged. |
| P2-02 Real execution isolation | Exercise actual exported handle and installed Worker. SQLite, tokenization, canonical validation and exact counter execute in Worker, including cold initialization and fetch. The parent owns only bounded input/transport/control work. No static SQLite link leaks into local transport/host/CLI closures. |
| P2-03 Cutoff and cancel | Controlled Worker/native-boundary stalls plus mock parent clock: expiry/abort settles before an intentionally delayed termination acknowledgement; no late success, slot reuse, publication callback or leaked unhandled rejection. Cover pre-abort, abort during fetch/count/final read, close races, crash, idle expiry, cleanup failure and simultaneous requests. Assert termination/child cleanup separately from public settlement. |
| P2-04 v18 preservation | Use a real old-pin physical v18 file. Build/catch up only the sidecar, then candidates/fetch/assembly Memory reads. Compare canonical DDL, user_version, logical hash and DELETE file hash before/after; old pin reopens. Under WAL apply the native-control SHM qualification and old-pin reopen on supported arrangements. No canonical migrate/open-write call occurs; Card requests refuse without querying absent tables. |
| P2-05 Schema/capabilities | Physical v23 and current mixed Memory/Card success; v20–v22 remain Memory-only on P2; v19/future/malformed layouts refuse untouched. Verify capability table and no implicit feature enablement. |
| P2-06 ReadSet/authority | One, four and 32 namespaces succeed; 33, duplicates, mixed owners, malformed/accessor input refuse before storage. Permutations preserve mapping/results. Deny/revoke each namespace at preflight, every await, pre-transmission and final authority boundary; foreign corpora influence no ranks/counts/text. No unauthorized subset result. |
| P2-07 Independent ranking oracle | Freeze bilingual/mixed and Japanese fixtures with relevant Memory/Card matches in all four namespaces. Independently calculate pooled N/df/BM25, global channel ranks, RRF and canonical tie order; compare exact identities/ranks. Include lexical-only, complete semantic, vector gaps, score ties, equal bodies, both intents and readSet permutations. Assert one query embedding, no namespace truncation/quota and no host RRF. Preserve the known single-Han miss. |
| P2-08 Ready-only reads | Trap all create/write/reconcile/refresh/repair/deep-index-scan paths and document embeddings during reads. Missing/building/stale/corrupt/unvalidated states return honest unavailable; empty matches only on ready exhausted lexical search. Exact evidence remains usable with no sidecar. Reader and maintainer can run independently. |
| P2-09 Maintenance durability | Rendezvous at checkpoint/publication and provider awaits; insert/correct/delete/revoke/change eligibility/dependencies from an independent writer. No incomplete statistics or stale vectors publish; interrupted uncommitted batch replays, committed checkpoints survive reopen. Catch-up ignores unchanged candidate texts. Cover owner-wide projection keys and absent prebuilt combinations. |
| P2-10 WAL correctness | Test canonical/sidecar DELETE/WAL cross-product, no-companion checkpointed WAL, live companions, first-statement contention during fresh writer close, safe-file replacement and unsafe companions. Assert one shared native wait window, configured before first statement, zero DELETE wait, refreshed rollback/iterator policy, truthful busy after exhaustion, no retries/migration/mode change/immutable/manual companion deletion. Use rendezvous for outcomes. |
| P2-11 Frozen evidence semantics | Extend §§15.5–15.8 known-answer serialization and mutation matrix to four namespaces and IPC. Snapshot fetch returns exactly admitted items/order; compact refs round-trip against fixed mapping. Receipt deletion, revision changes, eligibility loss and parent-only moves keep their exact frozen distinctions. No callback/await follows worker final reading; no unvalidated partial fetch/assembly escapes timeout. |
| P2-12 Provider ownership | Fake providers test zero calls for lexical/fetch/continuation/gaps and maintenance lexical mode; explicit semantic preflight/reservation/guard only. Multiple reader/maintainer Workers and restarts share totals and active local-child slots; timeout cannot free capacity before actual settlement. No real network/key/model operation. |
| P2-13 Installed artifact | Offline archive install, actual exported reader/maintainer/Worker/counter/bootstrap dependencies, no source fallback. Mechanically derive archive/runtime/Worker/doc closure and independently installed closure, diff and print counts; manifest coverage and exact shipped bytes required. Check child exit/cleanup and sanitized diagnostics. |

Implementation verification must follow the dispatch traps: primary runs the CI-equivalent acceptance matrix including both SQLite-free import checks; no broad sandbox suites. Record actual build/typecheck/test exit codes, with pipefail or explicit status capture. Cross-check changed-file and artifact inventories by independent routes, include untracked whitespace, and report counts. The primary adds this document to `packaging/artifact-files.json` if it ships; this one-file authoring packet deliberately cannot edit the manifest, following the same docs-only boundary recorded in `docs/plans/topic-overview-member-pages.md:784`.

## 10. Opt-in measurement protocol and pre-registered gates

Propose **`measure:context-read-product`, protocol `P2-product-v1`**, a new opt-in harness based on the E1-C2 writer/control/overlap machinery. This is a proposed entry, not an existing script or a claim it has run. Timing/contention assertions belong only in this opt-in measurement path, scheduled serially by the primary's machine-wide queue, potentially a future CI `extra` job. No network, keys, real user data or real hosted inference is needed.

Before any run, commit the implementation/profile, protocol revision, complete expanded cell list and count, corpus seed/hash, labels/query hashes, exact runtime, counter identity, hardware/filesystem, load, workload rates, request deadlines and gates. No threshold, query, sample exclusion or wait-budget tuning after observing results; a change creates a new protocol revision and rerun. Distinguish synthetic fake-semantic observations from lexical runs with the real local counter.

### 10.1 Required cells and populations

- **Worlds:** 1,112 and 3,336 Memories, distributed deterministically over personal plus three project namespaces. Physical v18 Memory-only, physical v23 mixed types and v33 mixed types. Register the Card count/content/receipt lengths separately from Memory counts; choose and freeze them before running. Register a full four-namespace query projection and actual writer mutation targets.
- **Languages/methods:** zh, ja and mixed queries with fixed relevance labels; candidates, assembly and evidence fetch (refs/compact-ref adapter and host snapshot). Search/assembly primarily lexical; include separate fake-semantic complete/gap cases for execution/accounting. Preserve Chinese trial queries if supplied, without inventing that fixture or its denominator.
- **Modes:** DELETE canonical/DELETE sidecar and WAL canonical/WAL sidecar required; mixed journal combinations get functional coverage and registered measurement control cells. Reader lifecycles include retained warmed handles and fresh public open/read/await-close per request. Count cold startup and first callback costs; cold means new handle unless a separately specified OS-cache protocol exists.
- **Index phases:** absent/cold build in another Worker, ready/warm, dirty while catch-up runs, and ready after catch-up. Register same-projection writers, which can truthfully make reads unavailable, and other-projection writer controls that retain ready searchability. Run a separate quiescent ready series to establish useful retrieval; unavailable responses alone cannot certify success.
- **Writers:** independent process, per-request open/public-write/close with no keeper connection for the fresh-writer gate; retained writer controls also reported. Log exact public-write, successful native commit and per-write close intervals. Fixture/opening commits and sleeps never count as contention exposure.
- **Repetitions:** five 30 s windows per required reader-load cell and paired no-reader writer baseline; reverse paired order on odd repetitions. Use E1-C2 minima per window: at least 20 attempts overlapping actual public writes, at least 10 overlapping fresh per-write close, and at least 100 successful public-write native commits in-window in both load and baseline. Require at least one validated successful retrieval/fetch in each designated ready series. Insufficient exposure or missing useful-ready evidence makes a cell **invalid**, never pass. Dirty/building series explicitly expect unavailable and are judged separately.
- **Attempt population:** every attempt begun in-window, including failures and final drain; no success-only latency sample. Enable `diagnostics:true` on measured handles so native busy is counted independently of public classification. Keep open/read/close lifecycle, public read call, public write call and native cleanup times separately. Record every unavailable/stale/timeout/cancel/busy outcome, native primary/extended code and stage, plus index coverage/checkpoint/transformed/scan bytes and embedding attempts.

### 10.2 Gates and reports

| Metric | Pre-registered P2 rule |
| --- | --- |
| Host main-loop maximum | **≤100 ms in every required DELETE and WAL cell**, including per-request writers, cold/read/fetch/assembly/maintenance overlap and timeout/cancellation settlement. Track maximum 1 ms heartbeat gap plus `monitorEventLoopDelay` maximum, parent synchronous dispatch duration and settlement callback duration; retain the final scheduled heartbeat across the drain. Report raw maxima, never averages or a baseline-subtracted pass. Writer work stays outside the measured host process. |
| WAL busy | **0 public `storage_busy` and 0 diagnostic native primary 5/6**, regardless of outer classification, across all required WAL reader attempts and drain. Retain failures hidden under opener/unsupported/index errors in this count. No replacement of busy with timeout counts as a successful mitigation. |
| Ready functional outcomes | Correct oracle results, valid snapshots/fences and complete lexical coverage in quiescent ready series; no unexpected failures. During concurrent mutation, explicitly expected unavailable/stale outcomes are counted, never interpreted as empty. Native contention and cutoff tests have separate expected-outcome cells and cannot be mixed into the zero-busy/normal-deadline gate. |
| Hard cutoff/cancellation | No success accepted at/after deadline or after accepted cancellation. Report requested deadline, public settlement overshoot and native cleanup lag independently. Deterministic cutoff semantics must pass; the product must set a numeric settlement-overshoot target if required. |
| Reader latency | Report per-method and lifecycle p50/p95/max and all attempts. **Product target is OPEN; do not import E1-C2's 250 ms target or use the 100 ms host-loop target as reader latency.** |
| Writer impact | Report public-write p50/p95/max, full lifecycle/close latency and paired throughput ratio. Product writer-latency gate is OPEN; the E1-C2 0.90 throughput reference is not silently a P2 gate. |
| Language retrieval | Record recall@5/@12 per language/type/namespace, ranking ties and known misses on frozen labels. Correct frozen known-answer fixtures gate determinism; a new quantitative recall threshold needs product approval before its measurement. The supplied 92% is not generalized to Japanese or treated as a reproducible oracle without its fixture. |
| Index/service availability | Report unavailable/stale fractions, build/catch-up time/throughput, progress, request-path maintenance attempts (must be zero), RSS/Worker cleanup lag, WAL growth and successful ready reads. Product freshness/availability target is OPEN. |

The inspected architecture does not establish that the 100 ms loop and zero WAL busy gates are impossible, so they remain proposed gates. They apply to the registered synthetic workload, not arbitrary process pauses or indefinitely held external locks. A 2 s single-repetition smoke may validate the harness but cannot establish performance acceptance. Any failed/invalid cell prevents a blanket P2 pass; report evidence and recovery options without automatically restarting an expensive run.

## 11. Reviewable implementation packages and product integration

The non-author contract audit precedes **all** implementation. Keep defaults opt-in at every package, with an installed-artifact handoff and actual check exit codes. Each package has its own review and release capability statement; earlier packages do not imply later requirements are complete.

| Package | Scope and dependency | What the product can integrate afterward |
| --- | --- | --- |
| **P2a — Worker, deadlines and authority transport** | New profile/reader/bootstrap boundary; reuse dispatch with prompt public timeout/abort settlement and quarantined cleanup; async fetch with deadline; exact counter in Worker; shared provider ownership prerequisite if semantic is exposed. Keep baseline readSet limit and DELETE-only support. Read path uses already prepared indexes only; no temporary lookup-time build exception. | Async candidates/assembly/fetch for v18 Memories or v23+ Cards on a prepared index, personal plus at most one project, DELETE. Integrate AbortSignal, disconnect and shutdown behavior. C-1 is available; no owner-wide/WAL claim. |
| **P2b — Explicit index lifecycle** | Product sidecar namespace/format, maintenance Worker/API, status/readiness, durable lexical build/catch-up, explicit vector mode/budgets, no migration, ready-only read validation; depends on P2a. P2a may consume a prebuilt fixture; P2b supplies the production build route. | Schedule supervised maintenance, show honest not-ready UI, and keep v18 production through the sidecar without a schema rollout. Still at most two namespaces and DELETE until later packages. C-3 is available. |
| **P2c — Owner-wide projection and fusion** | Widen both validators and immutable mapping, projection/fence/access/token bindings and pooled statistics/ranking oracle to 32 namespaces; depends on P2a/P2b. No new RRF preset. | Replace per-namespace calls with one personal-plus-N call; reuse compact ref/snapshot paths. Mixed Memory/Card requires separately upgraded v23+ storage. C-2 is available in DELETE. |
| **P2d — WAL and full qualification** | Reuse/generalize E1-C2 header/policy/diagnostics for both connections with shared wait window; safe live companion handling and no write-capable canonical opener; depends on P2a/P2b, and qualifies the complete four-namespace P2c combination. Add opt-in product matrix and pre-registered gates. | Integrate WAL deployment after qualified-runtime results meet the 100 ms loop and zero-busy gates. C-4 and the full C-1–C-4 product acceptance claim require this package plus product decisions on outstanding targets. |

Product glue in the inaccessible private repository remains product-owned: `ask_cairn`/website adapters, authentication/bootstrap, fixed owner/project enumeration, non-model `_meta` retention, maintenance scheduling, not-ready UX and rollout switches. This plan specifies that boundary rather than claiming those changes are implemented here.

## 12. Open questions for the product and primary

1. **Reader latency:** what p95/max targets apply separately to candidates, assembly and fetch, and to warm read versus fresh open/read/close? What public timeout/cancel settlement-overshoot bound is required? Request deadlines remain caller controls, not chosen latency SLOs.
2. **Namespace bound/mapping:** does personal plus at most 31 projects cover the product's near-term requirement? Can a host keep one immutable readSet for its lifetime, opening a new handle when project access/selection changes?
3. **Worker authority integration:** can the product provide the proposed local bootstrap with synchronous current authority/revocation checks and bounded transferable tokens? Its real authentication and counter/provider integration are unavailable here; validate the seam before coding P2a.
4. **Index scheduling and availability:** what freshness delay and unavailable fraction are acceptable, especially under continuous same-projection writes? Which types/intent/readSet combinations should be prebuilt, who supervises their budgets, and what not-ready UX should search/`ask_cairn` show? The draft deliberately refuses stale and partially built lexical indexes.
5. **WAL deployment:** which OS/filesystem/SQLite arrangements must qualify, and may an opted-in read-only reader permit SQLite-created WAL/SHM companions/read marks? Must canonical and sidecar modes differ in production? Canonical migration/mode change remains prohibited on reads.
6. **Measurement fixture:** can the product provide its 52 Chinese questions/labels and corpus recipe? Freeze Japanese/mixed labels, Card count/lengths, receipt distributions, writer rates/targets, normal request deadlines and expanded matrix before running; decide recall, writer-impact and availability gates without borrowing E1-C2 reader latency.
7. **Semantic rollout:** lexical-only first, or an explicitly configured local/hosted provider? Confirm separate document catch-up budgets, process-wide coordinator ownership and consent for explicit query transmission. No answer enables network or keys in this authoring task.
8. **Release/packaging:** approve the new constructor/profile names, separate product-sidecar disk cost and maintenance migration boundary; decide whether this plan ships and register it in the manifest if so. The primary owns commits and the independent audit; no implementation is authorized by this draft alone.

Authoring validation: source inspection only. No tests, builds, measurements, provider/key access or network calls were run for this draft. Only this new plan is delivered; frozen contracts and runtime/package manifests are unchanged.
