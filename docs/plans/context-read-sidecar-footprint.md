# Product sidecar footprint and maintenance yield

Implementation handoff against `b40124f3`, on `fix/context-read-sidecar-footprint`. No commit, canonical migration, network/provider-key operation, vector tables, frozen-v1 sidecar edits, or setup runtime regeneration. The frozen contract is unchanged. Read §6 (including §6.1.1, §6.1.2, §6.2 and §6.3), §7's WAL policy and §8.4; the additive delta below identifies the changed format and lifecycle rules.

## Measurement

The existing Memory/Card fixtures generate **1,642 Memories + 164 authored confirmed Cards**, personal plus three projects, with overlapping Chinese, Japanese and English prose. Both owner-wide `types:['memory','card']` projections are built, for current and history. Each contains 1,806 documents, 1,712 nonempty terms and 127,863 tokens. All fixture items are eligible in both intents; different current/history eligibility and equal-body ties are covered separately by the independent P2-07 oracle suites. The 164 Cards fall in two of the four namespaces; Memories cover all four. These are synthetic measurements, not access to the product's private corpus.

Command on **Node 24.15.0** before implementation and again after format 2:

```sh
node core/testing/measure-context-product-footprint.mjs
```

Both recorded runs exited **0**. The baseline run used the same new sizing harness with the `b40124f3` implementation before editing it. The first compact-format sizing run also exited 0; review then corrected initialization to set incremental auto-vacuum before BEGIN, and the final recorded run below includes its pointer-map pages. Quanta counts are report-only, not throughput or timing gates: baseline current/history 27/35; final 47/50 on the shared machine. The harness uses direct maintenance storage, so those counts do not measure public timeout incidence.

| Both intents, one owner-wide selection | Before: format 1 | After: format 2 |
| --- | ---: | ---: |
| Canonical main file | 5,189,632 B | 5,197,824 B |
| Sidecar main file | 129,839,104 B | 7,528,448 B |
| Sidecar / canonical | 25.0189× | **1.4484×** |
| Sidecar bytes / Memory (includes Card cost) | 79,073.75 | 4,584.93 |
| Free pages | 0 B | 0 B |
| Sidecar WAL / SHM / rollback journal at measurement | 0 / 0 / 0 B | 0 / 0 / 0 B |
| Lifecycle-lock file | 0 B | 0 B |

Total reduction is **94.20%**, and the ≤5× target is achieved for this corpus across both intents. Fixture UUIDs produce small B-tree occupancy differences in canonical size between independently generated runs; content counts, text recipe and type/scope distribution are fixed. Measurements use SQLite `dbstat`, joined to `sqlite_schema`, for every table and every physical index (including automatic indexes). `page_count * page_size` independently checks allocated size; `freelist_count` checks reusable space. Format 2's 12,288 pointer-map bytes, omitted by dbstat, are accounted separately. DELETE-mode measurement has no surviving companion bytes; no raw file-content descriptor is opened in a connection-owning process. Full canonical and sidecar structure bytes and per-Memory bytes are retained in [the machine-readable measurements](context-read-sidecar-footprint-measurements.json).

| Structure | Kind | Before bytes | Before B/Memory | After bytes | After B/Memory |
| --- | --- | ---: | ---: | ---: | ---: |
| `documents` | table | 745,472 | 454.00 | 589,824 | 359.21 |
| `generations` | table | 4,096 | 2.49 | 4,096 | 2.49 |
| `pointer_map` | internal | — | — | 12,288 | 7.48 |
| `postings` | table | 47,239,168 | 28769.29 | 3,190,784 | 1943.23 |
| `product_metadata` | table | 4,096 | 2.49 | 4,096 | 2.49 |
| `product_term` | index | 40,407,040 | 24608.43 | 2,953,216 | 1798.55 |
| `progress_records` | table | 4,096 | 2.49 | 4,096 | 2.49 |
| `publications` | table | 4,096 | 2.49 | 4,096 | 2.49 |
| `selections` | table | — | — | 4,096 | 2.49 |
| `sqlite_autoindex_documents_1` | index | 380,928 | 231.99 | — | — |
| `sqlite_autoindex_documents_2` | index | 589,824 | 359.21 | 196,608 | 119.74 |
| `sqlite_autoindex_documents_3` | index | — | — | 405,504 | 246.96 |
| `sqlite_autoindex_generations_1` | index | 4,096 | 2.49 | 4,096 | 2.49 |
| `sqlite_autoindex_postings_1` | index | 39,993,344 | 24356.48 | — | — |
| `sqlite_autoindex_progress_records_1` | index | 4,096 | 2.49 | 4,096 | 2.49 |
| `sqlite_autoindex_publications_1` | index | 4,096 | 2.49 | 4,096 | 2.49 |
| `sqlite_autoindex_selections_1` | index | — | — | 4,096 | 2.49 |
| `sqlite_autoindex_statistics_1` | index | 221,184 | 134.70 | — | — |
| `sqlite_autoindex_statistics_2` | index | — | — | 53,248 | 32.43 |
| `sqlite_autoindex_validation_records_1` | index | 4,096 | 2.49 | 4,096 | 2.49 |
| `sqlite_autoindex_validation_records_2` | index | — | — | 4,096 | 2.49 |
| `sqlite_autoindex_work_1` | index | 4,096 | 2.49 | 4,096 | 2.49 |
| `sqlite_schema` | internal | 4,096 | 2.49 | 4,096 | 2.49 |
| `statistics` | table | 212,992 | 129.71 | 65,536 | 39.91 |
| `validation_records` | table | 4,096 | 2.49 | 4,096 | 2.49 |
| `work` | table | 4,096 | 2.49 | 4,096 | 2.49 |

Automatic index ordinals changed: old `documents_1` and new `documents_2` cover generation/stream/id; old `documents_2` and new `documents_3` cover generation/typed identity. WITHOUT ROWID primary keys are charged to their table rather than a separate automatic-index B-tree. Dashes mean absent structures, not unmeasured structures.

The hypothesis is confirmed for postings: the old posting table, primary-key automatic index and term index use **127,639,552 B (98.31% of the sidecar)**. Long generation and typed identity strings recur in all three. In format 2 postings plus the term index use 6,144,000 B. The representation hypothesis is refuted: `documents.representation` was only the constant representation-version marker, not duplicate body text. There is no stored body representation to share across current/history. Separate immutable lexical generations remain, with compact posting keys, rather than sharing mutable statistics or changing any eligibility semantics.

The ratio is steady-state synthetic lexical evidence. It does not cap peak space under churn, pinned readers, pending GC, staging or WAL. The product must size its representative text and leave headroom for those, and for independently enabled vectors later. This change does not claim the product's latency/freshness/availability qualification gates.

## Design and format identity

Product sidecar **format 2**, still `.context-read-product-v1.1.sqlite`, uses:

- `generations.storage_id INTEGER PRIMARY KEY`, retaining the original opaque generation ID for certificates, pointers and progress.
- Integer document ordinals scoped to the storage generation. Typed identity, canonical ID and stream live in documents, rather than each posting.
- A per-generation term dictionary combined with statistics: integer term IDs, one text term and df; the empty sentinel retains N/total length.
- WITHOUT ROWID documents, postings and statistics. Postings contain only generation/document/term integers and frequency. Their primary key covers document-frequency lookup; `product_term(generation,term,doc)` covers bounded term enumeration. No duplicate posting stream/id/identity strings and no rowid PK copy.
- A format-defined constant document representation version, reconstructed for manifest tuples. Canonical text, tokenizer, eligibility, N/df/length, query-term arithmetic order, canonical tie order, fusion and evidence refetch are unchanged.

Manifest verification reconstructs the same ordered original document/posting/statistics tuples, with the original typed identity and term bytes. The posting manifest traversal forces document identity order before joining its bounded posting ranges; query lookup pages by integer document ID and still sorts final scores by the frozen tie comparator. A separate SHA-256 oracle with hand-known tokens reconstructs the frozen logical tuple stream without the compact SQL or ManifestHash and matches the published digest. The independent pooled P2-07 tests cover v23/v33, both intents, Japanese/mixed queries, identical bodies, global horizons and permutations. DTO shapes and certificate meaning remain the same; format identity changes explicitly.

Readers physically attest application ID, `user_version=2`, exact tables/index SQL and schema identity before consuming records. Validation records require `format:2`. Progress's signed `sidecarIdentityDigest` hashes `{format:2,...sidecarIdentity}`. Old-format cache opening returns honest unavailable/incompatible; refresh refuses it too, rather than converting it through the repair branch. Unknown positive physical versions likewise refuse automatic replacement; unversioned malformed caches keep their existing repair policy. Existing same-format wrong-store/corrupt DELETE repair keeps its coordinated maintenance path; damaged/indeterminate WAL still requires the host's quiescent discard/rebuild.

Explicit format rebuild: stop admissions, readers and maintainers/pumps; await supervised native/resource drain; discard the quiescent derived product cache and companions through the host procedure, retaining canonical storage and the lifecycle lock; reopen independent service maintenance and complete both intents before search exposure. There is no live unlink, silent migration or canonical change. The frozen `.context-read-v1.sqlite` remains untouched.

## GC retention and authority

The frozen contract specifies immutable publications and separate staging but no retention count. The proposed and implemented format-2 rule is **one most recently maintained selection per owner / normalized type set / intent**. Thus the product should build one owner-wide selection per intent, not overlapping personal-plus-each-project caches. Changing selected namespaces retires the old publication/work pointer for that slot. The other intent and other owners/type sets are preserved. The host must close the old selection's pump before cutover, as already documented; two competing selections for one slot are not a supported way to retain two caches. Retiring a cache may make an old handle unavailable; no stale/partial statistics are searched.

Published generations, active staging generations and the base of any active staging work are protected. Superseded publications, abandoned work and retired projections become GC candidates. Service-authorized maintenance holds the existing lifecycle lock, first advances one cleanup slice even during a build, then admits at most 128 further slices from remaining quantum time. A slice deletes at most 128 posting, document or dictionary rows, in that order, or removes the remaining keyed certificate/progress/generation metadata. Owner filtering prevents collecting another owner's generations. Every slice commits independently; the remaining rows are the durable restart cursor. Selection pointer retirement is atomic. No reader/status path does GC.

Incremental auto-vacuum is configured only on a new staged format-2 file, before the initializer transaction. Maintenance runs `incremental_vacuum(32)` when admission allows; other free pages remain reusable. This uses the existing SQLite/companion policy, never raw reads or file truncation. Continued explicit maintenance after publication completes GC; an instantaneous physical shrink is not promised. Reopen regressions interrupt deletion after a bounded slice and verify subsequent collection, certificates and foreign-key consistency. Active delta bases and the independent history publication survive.

## Quantum yield

The Worker now passes the immutable parent cutoff into the index, converted to its performance-clock domain from the same hrtime cutoff. The index takes the minimum of that cutoff and its local budget; storage starts admission before lifecycle acquisition and sidecar opening. Reopening, dispatch and expensive open cannot reset the quantum window. Native statement policy still comes from P2d for every new prepare/step/transaction/PRAGMA, with no retries or expanded WAL waits. SQLite imports remain behind the Worker boundary.

A quantum reserves `max(50,min(250,0.15*maxMs))` milliseconds for signed checkpoint commit, publication, final fresh canonical/authority validation and response. Each kind of work starts with a 10 ms estimate and keeps **twice its largest observed cost within that quantum**. Metadata batches, items, verification-page reads, verification rows and GC have separate high-water estimates. An expensive metadata page therefore cannot prevent a cheap first item from making progress on every reopen. Admission requires strictly more than estimate plus reserve. The estimate includes tokenization and all posting/dictionary writes for an item, rather than just preparing an in-memory batch. Metadata scans, individual verification rows and transactional GC slices also contribute conservative observed cost. An estimate never decreases because a later operation of the same kind is cheap.

Item writes now occur inside the staging batch as items are admitted. On yield, every admitted completed item and its scan/progress state commit together, within the existing 128-row / 2,000,000-unit caps. Verification retains the hash/count/cursor of exactly the rows actually processed and saves it atomically. GC slices commit before more admission. Publication uses the existing final fence check and captured-certificate protocol; final authority sampling and a fresh post-commit canonical snapshot remain mandatory. A successful partial quantum returns the existing rebuilding/partial DTO with validated durable progress, and the host schedules another explicit quantum.

Deterministic tests inject a 600 ms open, 100 ms metadata batches and 70 ms items into a 1,000 ms quantum: partial progress commits before cutoff; repeated quanta complete without read_timeout. Separate tests verify that cheap items cannot lower the conservative estimate and batch cost cannot poison item admission, GC cost causes yield, GC resumes after reopen, and a single simulated 1,200 ms indivisible operation still exceeds cutoff. Existing parent/Worker cutoff tests discard late publication/envelopes and preserve their independently committed artifacts. Estimates cannot predict an unseen indivisible cost or OS scheduling; read_timeout remains possible for such an overrun and retains the ≤50 ms public-settlement rule. This is no real-machine timing gate or claim that all native operations are interruptible.

The product should continue on successful rebuilding/partial, and only treat complete as readiness for that post-commit snapshot. On timeout, await supervised cleanup and inspect durable status on a later service call before retry/reschedule. The pump still stops and surfaces genuine errors; the host owns bounded rescheduling. A successful yield should not be treated as an error that ends all subsequent maintenance.

## Versioned additive contract delta

**`context-read-product-v1.1/sidecar-format-2-yield-v1`**, applying only to the product profile. This handoff records the additive revision; it does not edit the frozen contract.

1. Extend §6.1.1's physical product format from 1 to 2, with integer storage keys, dictionary, WITHOUT ROWID tables and selection retention metadata described above. Validation's existing closed `format` field must equal 2. Progress's existing sidecar-identity digest additionally binds format 2. The lexical manifest's logical tuples, HMAC domains, evidence/DTO versions, access/fence binding and captured-certification/current-readiness meaning remain unchanged.
2. Format 1 or an unknown positive physical version is unavailable/incompatible for readers and maintenance, preserving wrong_store precedence. Rebuild only through the stopped-client, drained, explicit derived-cache discard path under §8.4; never migrate an old sidecar in place.
3. Add the one-selection-per-owner/type-set/intent retention rule and bounded, restartable, service-only GC above to §6.1/§6.2. Published or active-base rows remain immutable while referenced. Retiring a pointer invalidates its cache availability and continuations; it never confers authority or changes evidence semantics.
4. Refine §6.2 admission: honor the original parent cutoff including open, reserve checkpoint/publication/final-delivery time, and stop new work when the conservative observed estimate plus reserve no longer fits. Commit admitted completed work and signed durable progress on successful yield. Preserve §4.3 cutoff/cancellation and genuine uninterruptible-overrun behavior, service authority checks and §6.1.2 final snapshot requirements.

These are the requested explicit format/yield amendments. No other frozen rule needs relaxation, and no contract file was changed.

## P2e rebase notes

No vector tables or embeddings implementation were added. The public/internal storage refresh call and metric shape are unchanged. P2e can keep opaque generation IDs in its lexical publication binding; use the private storage generation/document keys when joining this format's documents. Extend the physical schema attestation and GC deletion order for its own vector artifacts, and reuse the quantum admission seam around its independently metered vector work. Vector publication must keep its own certificate and preserve the immutable lexical manifest. The Worker cutoff handoff is independent of embeddings policy. If format 2 ships before the vector DDL, that later physical-layout change needs its own explicit format identity/rebuild rather than reinterpreting deployed format-2 files. Product index orchestration only gains the optional cutoff argument and internal clock/storage test seams.

## Verification commands and exit codes

Commands use the named Node patch runtime as `node`; shell globs expand to explicit test paths, with test-file concurrency 1. The runner independently cross-checks each expanded group with directory enumeration. No stdout pipeline is used to infer success; each subprocess return code is captured. Packaging/setup runtime was not regenerated.

| Final command (compact shell spelling) | Explicit files | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 core/test/context-read*.test.mjs` | 34 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/context-read-product*.test.mjs` | 12 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/topic-*.test.mjs` | 17 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | 0 | 0 |
| `node --test --test-concurrency=1 adapters/mcp/test/context-read*.test.mjs` | 5 | 0 | 0 |
| `node --test --test-concurrency=1 packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 | 0 |

The required path union is **60 files**, independently enumerated with pathlib and scandir: 0 differences. The 12-file product subset includes all six new/touched test files. The final full context prefix rerun had 670 cases, 669 passing and one existing A13 tokenizer probe skipped because that process started before the dependency was supplied. After supplying the pinned local dependency, the exact skipped probe was executed on both patches with **exit 0, 1 pass, 0 skips**:

```sh
node --test --test-name-pattern='A13 frozen independent' core/test/context-read-assembly.test.mjs
```

After the last estimate separation, the final 12-file product rerun verifies the final admission code: **428 cases, all pass, no skips**, on both patches. The unchanged v1/context coverage had already passed the full prefix rerun. Topic: 238 pass; guards: 44 pass; MCP after dependency recovery: 88 pass; packaging raw29: 3 pass, on both patches. The eight new footprint/yield cases all execute, including the independent manifest oracle and metadata-cost regression.

Initial full-prefix/MCP attempts were retained rather than counted as successes: on both patches, the first batch returned `[core-context:1, topic:0, guards:0, MCP:1, packaging:0]` (aggregate exit 1). Context failures exposed the old physical-key assertions, obsolete retention expectation, missing artifact-manifest entry, no-op batch journal assumption and GC cost seam; all were corrected and rerun. The MCP failure was `ERR_MODULE_NOT_FOUND: tiktoken` / `cairn_context_tokenizer_unavailable`. After confirming the target node_modules was absent, an independent ignored copy of the already installed **pinned tiktoken 1.0.22** supplied the test dependency. No network install, dependency/lockfile edit or shared-install removal occurred. MCP then passed in full on both patches.

Exploratory commands during implementation (brace notation abbreviates the same explicit file arguments; all rows are actual captured subprocess exits):

| Command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | ---: | ---: |
| `node --test core/test/context-read-product-index.test.mjs` (initial GC assertion) | — | 1 |
| `node --test core/test/context-read-product-{owner,overflow-status}.test.mjs core/test/no-raw-db-fd.test.mjs` (initial physical-key assertions) | — | 1 |
| `node --test core/test/context-read-product-{index,owner,overflow-status}.test.mjs` (batch/lookup-plan assertions) | — | 1 |
| `node --test core/test/context-read-product-owner.test.mjs` (corrected keys and indexed probe trap) | — | 0 |
| `node --test --test-name-pattern='Fix2 repair refuses' core/test/context-read-product-index.test.mjs` | — | 0 |
| `node --test --test-concurrency=1 core/test/context-read-product-{artifact,footprint}.test.mjs` (GC cost-seam failure) | 1 | 1 |
| `node --test core/test/context-read-product-footprint.test.mjs` (after GC cost-seam fix) | 0 | 0 |
| Same footprint command: initial five cases, later manifest oracle, final work-kind regression (three separate Node 24 runs) | — | 0 / 0 / 0 |
| `node --test --test-name-pattern='repair terminal\|selection cutover' core/test/context-read-product-{wal,pump}.test.mjs` | — | 0 |

Size-command exits: format-1 baseline **0**, first compact run **0**, final compact run including pointer maps **0**. `git diff --check`: **0**. Frozen contract/v1 sidecar/setup-runtime diff check: **0**. No new raw-fd allowlist entries were needed.


## Changed files, cross-checked

Cross-check exit **0**: route 1 combines `git diff --name-only -z` with nonignored untracked files. Route 2 hashes every HEAD entry against working-tree content using the Git blob hash and independently enumerates nonignored filesystem files with `rg --files --hidden`. The sorted lists match: **17 nonignored repository files, 0 differences**. This includes the packaging manifest, docs and new sizing harness. The artifact test separately verifies manifest/archive contents (**311 files**) and runtime closure by forward traversal and independent installed reverse-edge closure (**89 modules**); the SQLite-free parent closure remains **23 modules**.

- `core/context-product-index.mjs`
- `core/context-product-quantum.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-validation.mjs`
- `core/context-product-worker.mjs`
- `core/sqlite-journal-probe.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-footprint.test.mjs`
- `core/test/context-read-product-index.test.mjs`
- `core/test/context-read-product-overflow-status.test.mjs`
- `core/test/context-read-product-owner.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/testing/measure-context-product-footprint.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-sidecar-footprint-measurements.json`
- `docs/plans/context-read-sidecar-footprint.md`
- `packaging/artifact-files.json`
