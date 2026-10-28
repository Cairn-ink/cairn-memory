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

## Fix round 1

This round addresses both accepted-delta reviews of `fd4252ee`. The additive delta `context-read-product-v1.1/sidecar-format-2-yield-v1` above remains verbatim. Format 2 is still the unreleased compact format under review; its physical schema attestation now includes the corrected access paths and allocator. The frozen contract, v1 sidecar, default profile, manifest tuple encoding, certificate fields/HMAC domains and host rebuild procedure are unchanged.

### Findings, fixes and deterministic regressions

1. **Incomplete deep verification (spec P1).** Posting verification uses left dictionary probes, so a missing term cannot disappear behind an inner join. An independent keyset scan traverses the physical posting primary key and checks both document and dictionary references, eligibility and the total number of hashed postings. Per-document frequency sums must match token lengths. Staging dictionary `verified_df` counters are first reset in bounded primary-key ranges, then incremented transactionally with verified posting progress; every nonempty term requires positive matching df, and the empty-term sentinel must match eligible N and total length. Unposted dictionary terms are rejected. `Fix round 1 deep verification rejects badtoken` stages a unique term, removes its dictionary row while `foreign_key_check` remains clean, and requires corrupt refusal with no publication. Companion cases cover orphan documents/terms, pre-seeded verification counters and inconsistent df, N and total length.
2. **Collected captured generation (both reviews, P1).** The shared `storageKey()` helper checks for an absent generation before binding any integer and throws the recognized `index_unavailable` outcome. All three callers are covered by that guard: lexical lookup, unchanged base-document lookup and copied base postings. Real Worker regressions rendezvous after both observation snapshots have committed and before lexical lookup; a separate maintenance process either changes selection or catches up the same projection and collects the captured generation. Both calls return `index_unavailable`; a status call and another lookup prove the reader remains alive. The tests also confirm the captured physical generation was actually deleted.
3. **Wrong-store precedence (spec P2).** Refusal of an older physical format preserves an already established `wrong_store` reason instead of overwriting it with `incompatible`. Replacement remains prohibited for that format. The format-1/foreign-store regression compares metadata and validation records before and after refresh. Existing explicit repair behavior for the current format remains covered by its original tests.
4. **Cross-projection GC race (standards P1).** A scalar read-only hint may skip an empty GC pass, but it never authorizes deletion. Candidate selection, owner matching, publication/work/base protection and deletion all occur under the same `BEGIN IMMEDIATE`. `generations.storage_id` uses `AUTOINCREMENT`, so a collected committed ID cannot name a later generation. The cross-projection regression lets another maintainer consume the hint, collect the highest old ID and publish its replacement before the delayed collector starts its transaction. It verifies increasing IDs, intact replacement postings, foreign keys and transaction state at actual candidate selection.
5. **Inconsistent item checkpoints (standards P1).** The complete target is revalidated after metadata/text transformation and before saving any batch checkpoint. A mismatch rolls back document, posting and statistics writes and produces `index_unavailable`; no progress is signed against that mismatched fence. The regression corrects revision-1 text to revision 2 at the metadata-scan rendezvous, checks that checkpoint 0 and empty staging tables remain durable, then completes an ordinary revision-2 rebuild.
6. **Verification livelock (standards P1).** An admitted metadata or verification scan and its first returned row form one admission unit: the first row is processed even if scanning consumed the normal admission margin; later rows use the conservative estimate. A scan that has already crossed cutoff returns `read_timeout` and rolls back. Thus scanning cannot repeatedly sign the same successful zero-row cursor. Cursor, hash, document-length and df progress commit together. No cross-quantum estimate is required for this guarantee: every successful nonempty scan advances durable row progress. The regression injects exactly 600 ms opening, 250 ms scanning and 1 ms verification work into repeated 1,000 ms quanta and requires strictly increasing durable document counts, positive verified rows and settlement before cutoff. A companion metadata case injects 250 ms scans and 1 ms items after the same opening cost, including empty-stream transitions. The original indivisible-overrun and Worker cutoff/cancellation tests remain applicable.
7. **Unbounded compact joins (standards P2).** Each posting stores an integer position assigned in UTF-8 term order. `product_document_order(generation,doc,position,term,frequency)` covers ordered verification pages; dictionary lookups are keyed left probes. The page builder fills the original 128 logical posting rows across documents, with a separate 128-document bound for empty documents. Frequency sums accumulate across pages, and df validation uses keyed counters instead of document/term-wide aggregates. Scoring explicitly drives query terms through the existing covering dictionary unique index and probes the posting primary key `(generation,doc,term)`. The VM regression runs the actual captured production SQL in independent in-memory SQLite databases, using an instruction callback, at 1,000 and 19,000 terms. The additional exact-page-boundary/empty-document case compares the final ordered manifest to independent SHA-256.
8. **Weak monotonic-estimate assertion (standards P2).** After observing a 70 ms item followed by a 1 ms item, the clock advances monotonically to a 280 ms remaining-budget boundary. Admission must refuse because the retained 140 ms estimate plus 150 ms reserve does not fit. Removing `Math.max` admits work and fails the assertion. The original conservative implementation passes this strengthened assertion on `fd4252ee`; the disposable mutation fails on both runtimes.

All corruption, writer and collection interleavings use statement seams or explicit rendezvous points. The SQL work counter is deterministic; there is no wall-clock acceptance gate or network access. The independent healthy-data manifest oracle, pooled rank/score/tie tests and closed DTO goldens remain the compatibility checks.

The instruction counter uses Python's SQLite progress callback at one callback per VM instruction, with the actual production SQL captured through the storage seam. These counts are identical at 1,000 and 19,000 terms for the fixed statements:

| Operation | Rows returned | Baseline VM steps at 19,000 terms | Fixed VM steps at both sizes |
| --- | ---: | ---: | ---: |
| Ordered posting verification | 128 | 608,929 | 1,934 |
| Two-term query frequencies | 1 | 190,015 | 50 |
| Verification-counter initialization | 128 | — | 7,191 |

The final baseline replay overlays only the regression tests/fixture on an isolated `fd4252ee` snapshot. It exits **1** on both Node patches, with the expected **10 failures** (including the additional metadata-scan case). The high-water control exits **0**; removing only `Math.max` exits **1** on both patches. Separate allocator-only, scoring-only and counter-reset-only mutations also exit **1** on both, proving those assertions observe their named failures.

The existing pump selection-cutover test now forces the first quantum for each intent/selection to use `maxItems:1`, observes honest rebuilding, and drives bounded scheduled quanta until both certified intents report complete. It no longer assumes exactly two real-machine quanta suffice. Its explicit mock minute quota allows that work; the native 2,500 ms quantum and all response cutoffs remain unchanged.

### Updated footprint

The final unchanged sizing harness ran on **Node 24.15.0**, exit **0**, with the same 1,642 Memories, 164 Cards and four namespaces. Both current and history contain 1,806 documents, 1,712 terms and 127,863 tokens. Current/history used 91/169 explicit quanta; these are report-only shared-machine observations, not timing or timeout gates.

| Both intents, one owner-wide selection | Reviewed format 2 | Fix round 1 |
| --- | ---: | ---: |
| Canonical main file | 5,197,824 B | 5,173,248 B |
| Sidecar main file | 7,528,448 B | 11,862,016 B |
| Sidecar / canonical | 1.4484× | **2.2930×** |
| Sidecar bytes / Memory, including Cards | 4,584.93 | 7,224.13 |
| Free pages | 0 B | 0 B |
| WAL / SHM / rollback journal; lifecycle lock | 0 / 0 / 0 B; 0 B | 0 / 0 / 0 B; 0 B |

The **≤5× target remains satisfied**. The added covering posting-order index, integer positions and verification counters account for the increase. No canonical padding or corpus reduction was used. UUID-driven canonical B-tree occupancy varies slightly between fixture runs. Allocated file bytes include pointer-map pages; SQLite `dbstat` accounts for each table and physical index, and page-count/freelist accounting independently checks the total. Complete canonical and sidecar structure/per-Memory figures are preserved under `fixRound1` in [the measurements](context-read-sidecar-footprint-measurements.json).

| Sidecar structure | Kind | Reviewed bytes | Fix bytes | Fix B/Memory |
| --- | --- | ---: | ---: | ---: |
| `documents` | table | 589,824 | 589,824 | 359.21 |
| `generations` | table | 4,096 | 4,096 | 2.49 |
| `pointer_map` | internal | 12,288 | 16,384 | 9.98 |
| `postings` | table | 3,190,784 | 3,751,936 | 2284.98 |
| `product_document_order` | index | — | 3,747,840 | 2282.48 |
| `product_metadata` | table | 4,096 | 4,096 | 2.49 |
| `product_term` | index | 2,953,216 | 2,965,504 | 1806.03 |
| `progress_records` | table | 4,096 | 4,096 | 2.49 |
| `publications` | table | 4,096 | 4,096 | 2.49 |
| `selections` | table | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_documents_2` | index | 196,608 | 196,608 | 119.74 |
| `sqlite_autoindex_documents_3` | index | 405,504 | 405,504 | 246.96 |
| `sqlite_autoindex_generations_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_progress_records_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_publications_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_selections_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_statistics_2` | index | 53,248 | 53,248 | 32.43 |
| `sqlite_autoindex_validation_records_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_validation_records_2` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_autoindex_work_1` | index | 4,096 | 4,096 | 2.49 |
| `sqlite_schema` | internal | 4,096 | 4,096 | 2.49 |
| `sqlite_sequence` | table | — | 4,096 | 2.49 |
| `statistics` | table | 65,536 | 69,632 | 42.41 |
| `validation_records` | table | 4,096 | 4,096 | 2.49 |
| `work` | table | 4,096 | 4,096 | 2.49 |

### Verification and exit codes

The final required runs used the exact Node patches below, file concurrency 1 and explicit file arguments. Table globs are compact spellings of those expanded argument arrays. Glob expansion and independent directory enumeration agree on **60 required paths**. Each subprocess return code was captured directly; no pipeline tail supplied a test verdict.

| Command | Explicit files | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 core/test/context-read*.test.mjs` | 34 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/topic-*.test.mjs` | 17 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | 0 | 0 |
| `node --test --test-concurrency=1 adapters/mcp/test/context-read*.test.mjs` | 5 | 0 | 0 |
| `node --test --test-concurrency=1 packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 | 0 |
| `node --test --test-concurrency=1 core/test/context-read-product-footprint.test.mjs core/test/context-read-product-pump.test.mjs` (final touched tests) | 2 | 0 | 0 |
| `node core/testing/measure-context-product-footprint.mjs` | 1 harness | — | 0 |

Final required-set results on each patch: context: **687 pass**; topic: **238 pass**; guards: **44 pass**; mcp: **88 pass**; packaging: **3 pass**. Every group has **0 failures and 0 skips**. The separately rerun touched pair has **48 pass**, including 24 footprint/yield cases and 24 pump cases. All final new statements use the existing native statement policy; the raw-fd guard needed no new runtime allowlist entries.

Earlier verification failures are retained as failures: local integration attempts exited **1** while checkpoint compatibility and refusal precedence were corrected; a pre-final full context run exited **1 on both patches** because the pump test assumed two quanta implied readiness. The deterministic partial-quantum pump test now passes without increasing native deadlines. Its initial test-only minute quota was also insufficient for the forced extra quanta (exit **1 on both**); the bounded mock minute quota was corrected before the final runs.

Initial installed-packaging runs exited **1 on both patches** because a pre-existing temporary npm wrapper forced an offline cache missing `@modelcontextprotocol/server@2.3.1`. Using each named runtime's normal npm toolchain and the already populated offline cache produced the final **0/0** above. A pinned local `tiktoken 1.0.22` copy supplied the ignored test dependency. No network install, dependency/lockfile edit, shared install removal, runtime regeneration or commit occurred.

The baseline replay and mutation commands intentionally return failure: `node --test --test-name-pattern='Fix round 1|high-water|250ms scans' core/test/context-read-product-footprint.test.mjs` on `fd4252ee` is **1/1**; isolated high-water control is **0/0**, and high-water/allocator/scoring/counter-reset mutants are each **1/1**. These were executed in disposable snapshots, leaving the delivered implementation unchanged.

`git diff --check`: **0**. Frozen contract/v1 sidecar/setup-runtime/raw-fd-allowlist diff: **0**. Accepted-delta byte comparison: **0**, unchanged. Measurement structure/page totals and ratio validation: **0**. Changed-file cross-check: **0**, six paths. No long-running verification is handed off without a result.

### Changed files, independently cross-checked

Cross-check exit **0**: `git diff --name-only -z HEAD` plus nonignored untracked paths was compared with independent Git blob hashes of every HEAD entry plus `rg --files --hidden` enumeration of nonignored files. The mechanically derived lists agree at **6 files, 0 differences**, including the fixture and measurement JSON. The required test union was independently derived with glob expansion and directory enumeration: **60 explicit paths, 0 differences**.

- `core/context-product-sidecar.mjs`
- `core/test/context-read-product-footprint.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/fixtures/context-product-index-worker.mjs`
- `docs/plans/context-read-sidecar-footprint-measurements.json`
- `docs/plans/context-read-sidecar-footprint.md`

## Fix round 2

This round addresses both P1s in the spec and standards re-reviews of `b3a74eb5`. All earlier sections, including the accepted additive delta and Fix round 1, are retained verbatim. The physical format/schema, lock lifecycle, DELETE/WAL refusal and rebuild policy, allocation, GC protection, checkpoint fence checks and conservative quantum admission are unchanged.

### Completed documents and the referential audit

Posting verification now places a document-completion item immediately after that document's posting items, including documents with no postings. Completion checks the accumulated frequency sum against the document's token length before marking its cursor complete. Posting position, frequency sum, term-order state, dictionary counters and manifest hash remain transactional signed checkpoint state. A yield midway through a document resumes its posting position; a yield after completion resumes strictly after the checked identity. A full 128-posting page resumes the current document and checks completion before passing it. Phase advancement requires processing every returned item and exhausting the document scan. Completion items do not enter the manifest or alter its logical tuple order.

Each scan admits at most 128 posting rows and processes at most 128 document ranges, with one successor lookahead. Completion items have their own ordinary measured verification admission, so empty documents cannot bypass either validation or the quantum budget. At most 128 completion items accompany the posting page; no whole-document sum or unbounded join was introduced.

The independent referential audit's first page has no lower-bound predicate. It therefore includes physical keys such as `doc=-1`; resumed pages seek strictly after the last checked `(doc,term)` pair. Left document/dictionary probes and the final physical-versus-hashed posting count remain intact. No schema/domain change or new format identity is needed.

### Audit of the other verification cursors

| Loop | Initial page and resume rule | Validation before advancement |
| --- | --- | --- |
| Documents | No initial identity bound; subsequent pages use `identity > lastIdentity`, at most 128 rows. | Parse/hash the complete document tuple and update counts before assigning that row's cursor. Partial pages retain the last processed identity; phase advancement requires a fully processed short page. Removing the initial empty-string bound also prevents skipping an empty malformed identity. |
| Dictionary counter reset | Already begins without a term-ID bound; subsequent updates use `term_id > resetLast`, at most 128 keyed rows. | Each returned row was reset in the same transaction; the maximum returned ID is saved because SQLite RETURNING order is unspecified. Full pages continue rather than concluding reset. Negative IDs are included. |
| Statistics/dictionary validation | No initial term bound; subsequent pages use `term > lastTerm`, at most 128 rows. | Check sentinel N/total length and every nonempty term's positive matching df, then hash/count and assign that row's cursor. Removed the inclusive seek plus OFFSET in favor of an exclusive seek. Partial pages cannot skip unprocessed terms. |
| Ordered postings and document completion | No initial document bound; resumptions distinguish a pending posting position from a checked completed identity. Position zero is safe because the attested schema requires positive positions. | Every completion is processed in order, including zero-posting documents, before a later document's posting can move the cursor. Pending document state cannot be discarded on transition. |
| Physical posting references | No initial tuple bound; subsequent pages use `(doc,term) > lastTuple`, at most 128 rows. | Check eligibility and both references before incrementing the checked count and saving the cursor. Full and partial pages retain checked progress. |

No other cursor-based verification loop exists in `verifyPage`. The source-to-staging metadata cursor was also inspected: transformation and target revalidation precede its signed checkpoint; it advances streams only after a fully processed short page. GC remains bounded transactional deletion rather than a verification cursor.

### Regressions and byte compatibility

Five corruption cases checkpoint the staged items before editing data: the spec's `badtoken` followed by 128 distinct terms, the standards case of 2 + 128 distinct terms with the first document's postings and dictionary rows removed, each under both full-page and injected partial-quantum processing, plus a copied posting with `doc=-1`. Missing-document-posting cases retain nonzero token length and a clean foreign-key check. Each requires recognized `index_unavailable/corrupt` and no publication.

The same five corruption tests were overlaid on disposable snapshots, with no implementation changes. On **both Node 22.16.0 and 24.15.0**, `b3a74eb5` exits **1** with **five expected failures**; `fd4252ee` exits **0**, five passing. A sixth regression traverses 130 documents, 128 nonempty and two empty, under partial document/posting/statistics pages. It closes/reopens midway through a document, observes separate durable completion progress, then compares manifests, counts and lexical scores/order with an ordinary build. The existing independent SHA-256 tuple oracle and exact 128-posting-page regression remain intact.

The VM regression now captures the production document and statistics scans and both initial/resumed referential-audit statements in addition to posting verification, reset and scoring. Independent in-memory databases contain 1,000 or 19,000 dictionary rows and documents; instruction callbacks count actual work without timing gates. Both sizes return 128 rows for every page operation and one row for scoring, with identical instruction counts:

| Operation | VM steps at either size |
| --- | ---: |
| Ordered postings | 1,934 |
| Query frequencies | 50 |
| Counter reset, resumed range | 7,194 |
| Document scan | 2,058 |
| Statistics scan | 1,805 |
| Referential audit, first page | 2,825 |
| Referential audit, resumed page | 3,737 |

An initial extension of this probe exited **1** because its three-digit fixture terms placed the small database's statistics cursor past its last row while the large database returned a page. Matching the five-digit probe key recipe made both return 128 rows; the corrected probe exits **0**. This was a test-fixture correction, not a runtime threshold change.

A separate byte comparison uses the same canonical fixture and query order for the reviewed implementation and this fix. On **each Node patch**, initial and delta-corpus current/history manifests and counts, plus **480 query outputs** (120 queries per intent per corpus state), compare byte-for-byte, exit **0**. Those outputs include scores, ranks and ties across Memory/Card selections, Chinese/Japanese/English queries and equal bodies. All product runtime changes are confined to `verifyPage`; everything before and after that function remains byte-identical to `b3a74eb5`.

### Updated footprint

The unchanged sizing harness ran on **Node 24.15.0**, exit **0**, using the same 1,642 Memories, 164 Cards and four namespaces. Both intents retain 1,806 documents, 1,712 terms and 127,863 tokens. Current/history used 148/101 quanta; these counts are report-only observations, with no timing gate.

| Both intents, one owner-wide selection | Fix round 2 |
| --- | ---: |
| Canonical main file | 5,177,344 B |
| Sidecar main file | 11,862,016 B |
| Sidecar / canonical | **2.2911×** |
| Sidecar B/Memory, including Cards | 7,224.13 |
| Sidecar free pages | 0 B |

The **≤5× target remains satisfied**. Sidecar allocation is identical to Fix round 1; fixture UUIDs account for small canonical B-tree occupancy variation. Each database's table/index/internal structure bytes plus free bytes reconcile independently with its page-count allocation, and the recorded ratio is checked directly against both allocated byte totals. Complete structure/per-Memory figures are appended as `fixRound2` in [the measurements](context-read-sidecar-footprint-measurements.json); all preceding measurement entries are preserved.

### Required verification and exit codes

Each required group ran on the exact Node patches below, with explicit file arguments, TAP reporting and file concurrency 1. Glob expansion and independent directory enumeration agree on **60 required paths, 0 differences**. Every child return code was captured directly; no piped tail supplied a verdict. Table globs abbreviate those explicit argument arrays.

| Command (after `node --test --test-reporter=tap --test-concurrency=1`) | Files | Node 22.16.0 exit | Node 24.15.0 exit | Passing tests, 22 / 24 |
| --- | ---: | ---: | ---: | ---: |
| `core/test/context-read*.test.mjs` | 34 | 0 | 0 | 693 / 693 |
| `core/test/topic-*.test.mjs` | 17 | 0 | 0 | 238 / 238 |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | 0 | 0 | 44 / 44 |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | 0 | 0 | 88 / 88 |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 | 0 | 3 / 3 |

Every required group has **0 failures, 0 cancellations and 0 skips**. The full context prefix includes all **30 footprint cases**, including the six Fix round 2 regressions and the extended VM probe. The corruption-only baseline replays exit **1/1** on `b3a74eb5` (five expected failures each) and **0/0** on `fd4252ee` (five passing each). Independent healthy-output comparisons exit **0/0**. Footprint measurement on Node 24.15.0 exits **0**; structure/page/ratio reconciliation also exits **0**.

The missing ignored test dependency was supplied as an independent copy of the already available pinned `tiktoken 1.0.22`. Tests used each named runtime’s normal npm toolchain and existing offline cache. No network install, package/lockfile edit, shared-install removal, setup-runtime regeneration or commit occurred.

`git diff --check`: **0**. Runtime source outside `verifyPage`, every preceding plan section and every earlier measurement entry were independently compared to HEAD and remain unchanged. The frozen contract, frozen-v1 sidecar, setup runtime and raw-fd allowlist have no diff. All supervised runs completed; no running verification is handed off.

### Changed files, independently cross-checked

`git diff --name-only -z HEAD` plus nonignored untracked files was compared with independent Git tree/blob hashes of working files plus `rg --files --hidden` enumeration. Both inventories agree: **4 files, 0 differences**, cross-check exit **0**.

- `core/context-product-sidecar.mjs`
- `core/test/context-read-product-footprint.test.mjs`
- `docs/plans/context-read-sidecar-footprint-measurements.json`
- `docs/plans/context-read-sidecar-footprint.md`

## Fix round 3

This round addresses the linked nonpositive-document-key P1 in both re-reviews of `26d2c5d8`. All earlier sections and measurement entries remain intact. Format 2 is unreleased; its valid document-key domain is now **positive integers**. Both STRICT `documents.doc` and `postings.doc` declarations include `CHECK(doc > 0)`. Physical schema attestation and initialization attestation derive from the same DDL, so both now require these checks. Readers refuse the earlier unchecked format-2 schema as incompatible. Existing explicit DELETE repair and quiescent host rebuild requirements for WAL remain unchanged.

Deep verification independently rejects nonpositive document keys in the document scan, ordered posting/document-completion stream and physical referential audit. It therefore refuses tampered rows even when an external SQLite connection bypasses CHECK constraints. Domain validation precedes the affected row's hash/count/cursor advancement. Lookup's existing `doc > 0` first-page boundary now enumerates the entire accepted domain; subsequent pages remain exclusive positive-key seeks. The referential audit retains its unbounded first page, both left reference probes and final posting-count comparison.

### Dictionary and storage ID audit

Dictionary term IDs and generation storage IDs have no corresponding positive-only enumeration boundary. Dictionary reset starts without an ID bound and resumes after the last processed ID; term validation scans by text. Posting verification, query enumeration and scoring resolve dictionary IDs by equality. The empty-term sentinel is identified by `term=''`, rather than a hard-coded zero ID during verification or retrieval. Storage IDs use keyed equality in lookup/base-copy paths; GC starts without a storage-ID bound. Ordinary allocators continue to produce positive document/nonempty-term IDs and AUTOINCREMENT storage IDs, with zero reserved by construction for the empty-term sentinel.

Two regressions remap dictionary and storage IDs to `-1` or `0`, relocating the sentinel to `-2` before assigning zero to the nonempty term. Both certify a positive document, retrieve it, reopen a new handle and retrieve byte-identical results. These accepted signed IDs remain reachable, so they need no new domain restriction. The earlier allocator and GC protections are unchanged.

### Linked-key regressions and baseline replay

Four corruption cases cross document keys `-1` and `0` with dictionary IDs `1` and `-1`. Each checkpoints a staged `badtoken` document, remaps its linked document/posting pair in a transaction with CHECK enforcement disabled, confirms a clean foreign-key check and a matching dictionary reference, then requires `index_unavailable/corrupt`, no publication and no validation certificate. The admitted maintenance connection remains open, so these tests exercise deep verification rather than repair or an opening quick-check. The earlier copied-orphan regression also explicitly bypasses the new CHECK to keep exercising its original referential-audit failure.

The final tests were overlaid without implementation changes on disposable snapshots. Each row below has the same exit code on **Node 22.16.0 and 24.15.0**:

| Document key | Dictionary ID | Fixed exit | `26d2c5d8` exit | `b3a74eb5` exit |
| --- | --- | --- | --- | --- |
| -1 | 1 | 0 | 1 | 0 |
| -1 | -1 | 0 | 1 | 0 |
| 0 | 1 | 0 | 1 | **1** |
| 0 | -1 | 0 | 1 | 0 |

Both signed-dictionary boundary regressions meet the requested replay expectation together: **1/1** on `26d2c5d8`, **0/0** on `b3a74eb5`. The ordinary-dictionary zero case exposes an additional historical defect: `b3a74eb5` already accepts `(doc=0, term=1)`, because its initial audit bound is `(0,-1)`. Consequently, claiming that ordinary zero-key regression passes there would be incorrect. It is retained as extra coverage; the four-case baseline replay exits **1/1** with exactly this one failure on `b3a74eb5`, and **1/1** with all four failing on `26d2c5d8`.

A separate DDL regression requires both tables to reject `-1`, `0` and fractional document keys, then removes the CHECK declarations from physical schema metadata and requires incompatible attestation. Its tampering connection explicitly disables Node 24 defensive mode where that API exists; production connections retain their existing settings.

### Byte compatibility and bounded work

On each Node patch, the same canonical fixture and query sequence were evaluated against `26d2c5d8` and this fix. Initial and actual delta-build current/history manifests, counts and **480 query outputs** compare byte-for-byte, exit **0/0**. Queries cover Memory/Card selections, Chinese/Japanese/English, equal bodies, scores, ranks and ties. Every handle is closed before swapping the quiescent DELETE caches between implementations.

Production SQL statements and page bounds are unchanged. The deterministic VM probe retains exactly the Fix round 2 counts at both 1,000 and 19,000 dictionary rows: ordered postings **1,934**, scoring **50**, reset **7,194**, documents **2,058**, statistics **1,805**, initial audit **2,825** and resumed audit **3,737** instructions. Page operations return 128 rows and scoring returns one. New domain checks add only constant work per verified row. Runtime source outside the DDL and `verifyPage` remains byte-identical to `26d2c5d8`.

### Updated footprint

The unchanged sizing harness ran on **Node 24.15.0**, exit **0**, with 1,642 Memories, 164 Cards and four namespaces. Both intents retain 1,806 documents, 1,712 terms and 127,863 tokens. Current/history each used 73 explicit quanta; these are report-only observations, with no timing gate.

| Both intents, one owner-wide selection | Fix round 3 |
| --- | ---: |
| Canonical main file | 5,193,728 B |
| Sidecar main file | 11,849,728 B |
| Sidecar / canonical | **2.2815×** |
| Sidecar B/Memory, including Cards | 7,216.64 |
| Sidecar free pages | 0 B |

The **≤5× target remains satisfied**. Table/index/internal structure bytes plus free bytes independently reconcile with each database's page allocation, and the ratio is checked against both byte totals, exit **0**. Complete structure/per-Memory figures are appended as `fixRound3` in [the measurements](context-read-sidecar-footprint-measurements.json), preserving every earlier entry.

### Required verification and exit codes

The exact runtime binaries report **v22.16.0** and **v24.15.0**. Each required group ran with explicit file arguments, TAP reporting and file concurrency 1; glob expansion and independent directory enumeration agree on **60 required paths, 0 differences**. Child return codes were captured directly. Table globs abbreviate those expanded arrays.

| Files after `node --test --test-reporter=tap --test-concurrency=1` | Files | Node 22.16.0 exit | Node 24.15.0 exit | Passing tests, 22 / 24 |
| --- | ---: | ---: | ---: | ---: |
| `core/test/context-read*.test.mjs` | 34 | 0 | 0 | 700 / 700 |
| `core/test/topic-*.test.mjs` | 17 | 0 | 0 | 238 / 238 |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | 0 | 0 | 44 / 44 |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | 0 | 0 | 88 / 88 |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 | 1 → 0 | 3 / 3 |

The initial Node 24 required-matrix process exited **1** because the installed `layouts/claude-code` packaging child reached its existing **30,000 ms** subprocess timeout (`ETIMEDOUT`): two cases passed and one failed. Inspection found this fixture exercises legacy topic-reader layouts, with no product sidecar build or lookup. Re-running only the unchanged three-case packaging group with the same timeout and offline settings exited **0**, all three passing. The table preserves both packaging exit codes; no timeout or test threshold was changed.

Every final required group has **0 failures, 0 cancellations and 0 skips**. The full context prefix includes all **37 footprint cases**, with the seven new cases also run separately using `--test-name-pattern='Fix round 3'`, exit **0/0**, seven passing each. Healthy-output comparisons exit **0/0**; sizing on Node 24.15.0 and independent structure/page/ratio reconciliation each exit **0**. The expected baseline replay failures and their exact cases are recorded above.

Initial targeted fixture-development runs exited **1** while foreign-key bypass, new-handle reopening and the Node 24 defensive-mode setting were corrected. Final targeted runs use the completed fixture on both runtimes. No production lock, journal or timeout setting was relaxed. Tests used each named runtime's normal npm toolchain, its existing offline cache with offline mode enforced, and the already available ignored tokenizer dependency; no network install or dependency/lockfile change occurred.

`git diff --check`: **0**. Runtime source outside the DDL and `verifyPage`, the entire previous plan prefix and all previous measurement entries were independently compared with HEAD and remain unchanged. The frozen contract, frozen-v1 sidecar, raw-fd allowlist and setup runtime have no diff. No timing gates, provider calls or commits were introduced. All supervised runs completed; no running verification is handed off.

### Changed files, independently cross-checked

`git diff --name-only -z HEAD` plus nonignored untracked files was compared with independent Git tree/blob hashes plus `rg --files --hidden` filesystem enumeration. Both inventories agree: **4 files, 0 differences**, cross-check exit **0**.

- `core/context-product-sidecar.mjs`
- `core/test/context-read-product-footprint.test.mjs`
- `docs/plans/context-read-sidecar-footprint-measurements.json`
- `docs/plans/context-read-sidecar-footprint.md`
