# Context-read P2b implementation handoff

Implemented on `feat/context-read-p2b`, base `9312c5d9`, without a commit.
The frozen product and unified-memory contracts and the legacy sidecar are
unchanged. This package releases lexical candidates, representation-v2 assembly,
closed index status and explicit service maintenance for physical v18 Memories
and v23+ Cards, on one namespace or personal plus one project, in DELETE.
Deployment performance qualification and the broader P2c/P2d scope remain open.

The product adapter handoff is in [context-read-product.md](../context-read-product.md).
It describes trusted service issuance, the supervisor, quantum and cumulative
budgets, exact prebuild selections, cron renewal, completion observation,
shutdown, fallback and restore admission gates. No private product integration,
provider/key/model operation or network access is claimed.

## Design

`openContextIndexMaintainer` uses the same fixed isolated Worker entry and
parent watchdog/supervisor machinery as the reader, with an independent service
role. Its constructor validates trusted service issuance; each later quantum
gets a fresh bounded service control record and authenticated expiry handoff.
HTTP credentials cannot open or operate it. Both maintenance and status sample
service currentness at entry and immediately before the fresh final canonical
transaction. Changed final authority returns bare `scope_changed`, even when a
checkpoint or publication has already committed. Request controls retain P2a's
original cumulative admission window.

The canonical connection remains read-only. Product storage is the separate
`.context-read-product-v1.1.sqlite` cache, format 1 with its own application ID,
incarnation, keyed projection pointers, immutable captured generations and
validation/progress records. It never imports a migration-capable core. Safe
metadata checks use stat only; new and replacement cache files are created in
the existing isolated child path. No runtime raw-fd allowlist entry was added.
A cross-process child proves that host writer exclusivity survives maintainer
open, refresh and close in the same process.

The builder reuses the existing metadata keysets, canonical eligibility,
current-dependent fences, tokenizer and BM25/scoring rules. Staging generations
scan bounded canonical pages, copying unchanged indexed tuples/postings without
refetching or tokenizing unchanged candidate text. Changed candidate text is
bounded by 128 rows/2,000,000 units per batch. Reconciliation still scans the
projection; this is not an O(changes) cost claim. Published rows are never updated
in place. Old, no-longer-pointed generations remain derived cache data; erase or
restore must discard the cache under the documented quiescence procedure.

Deep validation is resumable across quanta. Its three fixed verification streams
are documents by canonical identity, postings by identity/term, and statistics by
term. Each hashes newline-delimited JSON tuples with standard SHA-256 after
checking joins, token lengths, eligibility and statistics. A checkpointable
compression state, committed by the signed checkpoint incarnation together
with scan position and verified counts, permits bounded verification pages without restarting a whole
manifest hash. Known-answer tests independently compare it with Node SHA-256
across empty, block-boundary, Unicode and resumed inputs. Scan phase ordinals
include those three verification streams after the canonical scan streams.

Certificates are the frozen closed record, at most 16,384 bytes, with full
43-character digests, store/schema/file identities, tokenizer/representation,
captured canonical/dependency fences, publication, manifest and verified counts.
Progress is the separate closed signed record, at most 4,096 bytes, committed
atomically with each batch or verification checkpoint. Both use recursively
UTF-8-key-sorted canonical JSON and distinct product HMAC domains. The certificate
MAC, projection, access and fence digests have independent known-answer tests.
Stable access binds owner, canonical readSet and optional ownerGeneration/null;
request IDs, issuance, deadlines, credentials and selection provenance do not
enter the certificate or snapshot access binding. Compact item fence bytes retain
the frozen representation-v2 rule; product opaque snapshots/cursors and cache
certificates use distinct domains from v1.

The final sidecar-only transaction installs captured E's complete generation,
certificate and pointer together, after the last pre-commit fence check. No
current-ready bit is persisted. After commit, the second service sample precedes
a new deferred canonical transaction whose first actual read acquires a fresh
snapshot. Its bounded pointer/certificate and current-fence comparison determines
completion. Independent E+1 writes between the pre-commit check and sidecar COMMIT
leave an intact E certificate but force `rebuilding`, unavailable/stale coverage
and null current counts. No-op refreshes skip publication and use the same final
fresh-snapshot rule. Timeout after publication discards the envelope while keeping
the durable artifact; later fresh authorized readers independently validate it.

Readers perform constant-size physical format/schema checks, keyed pointer,
record and generation reads, bounded HMAC/binding checks and scalar currentness
probes. Counts come from authenticated records. Reads perform no creation,
refresh, repair, quick_check, integrity/statistics scan or corpus tokenization.
The real Worker regression traps writable opens, mutations and deep scans.
Search retains bounded pages/top-24 ranking state, the frozen trace metadata
and channel timing fields, and exact empty-population fractions/omission counts; canonical final refetch and
pointer/fence revalidation precede delivery. Assembly uses the existing frozen
serializer/metering/source logic with a Worker-local exact host counter, and a
single final canonical validation. Missing counter refuses
`token_count_unavailable`. A semantic request flag retains a validated lexical
result with disabled semantics and zero provider calls; it cannot enable a port. Diagnostic not-ready errors take the final-envelope
currentness sample; no private data survives failed final sampling.

The closed status DTO reports durable `absent`, `building`, `ready`, `stale`,
`catching_up` or `unavailable` state, never Worker liveness. Counts are unknown
outside ready state. Every embedded count is null and semantics are disabled.
Initial and delta crash/reopen tests retain signed checkpoints and independently
specified progress values. Missing/invalid evidence, format/store failures and
current-fence/access/dependency mismatches preserve their closed reasons and
precedence. Explicit maintenance may repair an unusable protected cache; readers
never repair it. Copied file identities cannot reuse old certificates.

The service-owned pump reserves full quantum allowances before opening or
refresh, retaining unknown usage on failure. Cumulative process-owned charges are
keyed by store/owner/stable host domain and quota window, so a new handle or pump
ID cannot reset exhaustion. A different window cannot overlap an unexpired one.
The host persists charges across process replacement and supplies fresh process
clock-domain windows. Current/history work round-robins active projections;
validated settings must fit a nominal full sweep within the five-second epoch
observation interval. Actual scheduling overhead remains a qualification gate.
Renewal reuses the same owned pump/handles, extends supervision without resetting
quotas, and cannot create a second projection writer. The parent retains
maintenance-writer ownership by canonical identity/normalized selection through
confirmed cleanup. The product coordinates ownership between service processes.
Pump completion/status expose exhaustion, renewal expiry and failures; failure
stops dispatch and drains handles. Supervisor shutdown owns timers, pending work,
failed constructors and native disposal.

## Deterministic acceptance mapping

All file names below are under `core/test/` unless another path is displayed.
A deferred portion is not claimed complete by an inherited or narrower test.

| Row | Evidence and package boundary |
| --- | --- |
| P2-01 | `context-read-default-entropy.test.mjs`; C06 in `adapters/mcp/test/context-read-sources.test.mjs`; product certificate domain known answers in `context-read-product-index.test.mjs`. Legacy sidecar and wire fixtures unchanged. |
| P2-02 | Product index/assembly tests record Worker counter execution; `context-read-product-import.test.mjs` runs both existing SQLite-free import fixtures and records child exits; installed artifact exercises actual exported maintainer/Worker. |
| P2-03 | Existing `context-read-product-control.test.mjs` plus publication timeout in index tests and failed maintainer opening in service tests. No elapsed-time gate. |
| P2-04 | Index tests physically build v18, compare canonical logical and DELETE file hashes in a separate child, reopen the pinned old implementation, and refuse Cards; P2a physical layout matrix retained. WAL preservation belongs to P2d. |
| P2-05 | Index tests use physical v18/v23/v33 and actual mixed Card candidates/assembly on v23; P2a accepted/intermediate/malformed layout matrix retained. |
| P2-06 | Production personal/project prebuild, pooled lookup, assembly compact mapping and snapshot fetch across readSet permutations in index tests; P2a authority tests retained. Selection overflow and 32 namespaces are P2c. |
| P2-07 | Existing BM25/fusion tests retained and lexical mixed candidates exercised. Four-namespace bilingual pooled oracle is P2c; semantic execution is unavailable. |
| P2-08 | Index tests trap writable opens, creation, mutation, repair and deep scans in a real reader Worker; missing/building/stale/invalid states refuse. Explicit maintenance repair is separate. Exact evidence still works without an index. |
| P2-09 | Index tests rendezvous independent checkpoint/publication writers; feature-off correction/deletion and v33 method adoption change current eligibility/dependency fences. Immutable staging/checkpoint replay and unchanged-text reuse are exercised. Semantic/vector cases are unavailable. |
| P2-10 | DELETE-only product refusal/capabilities and retained legacy topic lock/WAL tests. Product canonical/sidecar WAL and wait-policy qualification are P2d. |
| P2-11 | Product candidates/assembly/snapshot fetch round trip; frozen assembly and source mutation suites retained. Final assembly mismatch refuses snapshot_stale. Four-namespace extension is P2c. |
| P2-12 | Fake provider counter stays zero for lexical maintenance/reads; embeddings-only refresh never creates or builds storage and reports disabled semantic state. No provider coordination or model execution is released. |
| P2-13 | `context-read-product-artifact.test.mjs` independently compares source/installed runtime closure, manifest/archive inventory and all shipped bytes; actual installed current/history maintenance, candidates, assembly, fetch and cleanup run offline. R29 installed closure retained. |
| P2-14 | P2a request entry/final/cutoff tests retained; real data-bearing candidate/assembly errors and service final denial tested in index tests. |
| P2-15 | Fresh HTTP credentials consume production certificates without maintenance/deep scans; independent HMAC/digest oracle, missing/MAC/manifest/pointer/generation/schema/store/incarnation/projection/binding matrix, restore copies and ownerGeneration access staleness in index tests. |
| P2-16 | `context-read-product-service.test.mjs` proves failed-opening settlement before delayed disposal and cross-supervisor quarantine; index tests cover resource-acquisition bootstrap failure; pump tests prove supervisor-owned shutdown. |
| P2-17 | Existing product native telemetry/control fault matrix retained. Actual publication timeout keeps retrieval cutoff separate from cleanup; observed native corruption produces the closed DTO with one failed open and no retry. Broader WAL writer native qualification is P2d. |
| P2-18 | Independently constructed full status goldens, explicit progress values, initial/delta committed Worker crash/reopen, missing/invalid/identity precedence and disabled semantics in index tests. Enabled semantic states are outside this lexical package. |
| P2-19 | Measurement population/exposure harness work belongs to later qualification. No timing gate was added or run. |
| P2-20 | Index tests copy canonical/sidecar files, observe unavailable certificates, explicitly rebuild and admit a fresh reader. Product-owned stopped-client admission, consistent backup, old-binding invalidation, fallback and erase/restore procedures remain required integration. |
| P2-21 | Real Worker sidecar-COMMIT rendezvous with independent DELETE writer: rebuilding/stale refresh, null counts, durable E certificate and explicit catch-up. Separate no-op and post-publication timeout tests. WAL variant is P2d. |
| P2-22 | Request credentials refuse at service construction/use; service tests move mock time beyond the opening window and verify a later independent bounded quantum. Pump rejects HTTP credentials before timer/handle work. |
| P2-23 | Independent writer provenance/drain measurement instrumentation is P2d. Functional writer children in these tests have actual exit-code assertions and supply no zero-busy measurement claim. |
| P2-24 | Existing 10,000-operation supervisor retention/quarantine tests retained unchanged. |
| P2-25 | Existing request ownerGeneration tests retained; index tests prove a new valid generation makes the old certificate access-stale while fresh request identity does not. |
| P2-26 | Actual service refresh/status count two synchronous samples, with final failure stripping progress; request ready and not-ready data envelopes also assert exact counts. No callback follows final canonical reading. |
| P2-27 | Real candidate/assembly not-ready error tests revoke at the second sample and assert exact bare scope_changed; service progress denial and late publication discard also covered. |
| P2-28 | P2a trusted control/expiry matrix retained. Service tests assert parent-stamped later-call admission/cutoff and failed-opening ownership. |
| P2-29 | P2a original request window/cumulative cutoff tests retained; service windows are independently bounded. Publication response held at the parent receipt cutoff yields bare timeout and no data. |
| Pump | `context-read-product-pump.test.mjs`: mock clocks/timers, both intents and active selections, renewal reuse, cumulative reservation/exhaustion across new IDs, bounds/cadence, expired renewal, no HTTP authority, new-window sequencing and supervisor shutdown. |
| Lock safety | `sqlite-lock-safety.test.mjs`: independent writer remains BUSY throughout same-process maintainer open/production refresh/close, then succeeds after host COMMIT. Raw-fd guard passes with unchanged allowlist. |

## Verification

The final commands, actual exits, test counts and inventory cross-checks follow
below. No broad suite,
network, key access, generated runtime update, frozen-contract edit or commit was
performed. Every test command uses low CPU and I/O priority.

## Deferred work and product inputs

P2c widens validators/mapping to owner-wide selection and the 32-namespace pooled
oracle; digest formats already accept general canonical projection arrays.
P2d supplies canonical/sidecar WAL policy, wait/checkpoint qualification, the WAL
publication-race variant, independently observed writer native diagnostics and
complete deployment measurements. `sidecarJournalMode:'WAL'` currently refuses
`index_unavailable`, with an explicit deferred capability statement; no mode is
half-enabled. Semantic/provider paths remain disabled/unavailable, including
embeddings-only maintenance. No vector/provider budget service is constructed.

The product supplies and freezes service ownership, cumulative per-minute quotas,
renewal/capacity policy, active projection selections and selection metadata.
It observes pump completion/failure and persists reservations before process
replacement. It supplies an exact Worker-local counter for assembly and maps
both diagnostic `_meta` keys outside model input. It owns HTTP disconnect,
reauthenticated partial fallback and stopped-client erase/restore admission gates.
No latency/freshness/availability, sidecar-size or backup-time measurement has
been run; the contract's production qualifications remain unmet until measured.
P2a's two documented deliberately forging in-process caller hardening cases are
unchanged, as is its intentionally bounded post-second-sample authority window.

## Final verification results

The permitted test inventory was derived independently by filesystem glob and
`rg --files`, then compared: **50 explicit paths**. Every invocation used
`nice -n 19 ionice -c3 node <explicit path>` with PATH and the executable pinned
to the indicated nvm runtime. Both exact runtime versions were checked before
dispatch. Child return codes were captured directly; no pipeline tail or stdout
summary supplied the exit status.

Final consolidated results: **772 passed on Node 22.16.0** and **772 passed on
Node 24.15.0**, across the same 50 paths, with every final command exiting **0**.
The sequential matrix stopped on development findings and resumed only failed
or unrun paths. Focused lifecycle/artifact reruns after the final changes
supersede earlier index counts. These are functional checks, not deployment
performance qualification.

| Explicit path after the command prefix above | 22.16.0 exit / passed | 24.15.0 exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-assembly-races.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 / 28 | 0 / 28 |
| `core/test/context-read-assembly.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/context-read-bm25.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-budget.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-core.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-embedder.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-fusion.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-local-embedder.test.mjs` | 0 / 38 | 0 / 38 |
| `core/test/context-read-local-status.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 / 15 | 0 / 15 |
| `core/test/context-read-process.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-control.test.mjs` | 0 / 83 | 0 / 83 |
| `core/test/context-read-product-import.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 44 | 0 / 44 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product.test.mjs` | 0 / 126 | 0 / 126 |
| `core/test/context-read-recovery.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-review.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 / 17 | 0 / 17 |
| `core/test/context-read-source-work.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-sources.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/topic-members-bounds.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-compatibility.test.mjs` | 0 / 32 | 0 / 32 |
| `core/test/topic-members-integration.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/topic-members-mutations.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/topic-members-primary.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 / 33 | 0 / 33 |
| `core/test/topic-members-review-findings.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-round3-findings.test.mjs` | 0 / 18 | 0 / 18 |
| `core/test/topic-members-scale.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/topic-members-visibility.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-members.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 / 11 | 0 / 11 |
| `core/test/topic-overview-raw29.test.mjs` | 0 / 22 | 0 / 22 |
| `core/test/topic-overview-visibility.test.mjs` | 0 / 8 | 0 / 8 |
| `core/test/topic-overview.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/topic-reader-cancellation.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/topic-reader-sqlite.test.mjs` | 0 / 21 | 0 / 21 |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 / 3 | 0 / 3 |

Development runs exited **1** for two fixture mistakes (a duplicate physical
schema installation and the Card confirmation return shape), a mock cleanup
ordering cancellation, and Node 24 defensive mode ignoring the deliberate
schema-version mutation. The fixture now disables defensive mode only on that
test writer and asserts the actual mutation. A read-only preparation change
also exposed three expected-unavailable states escaping as bare errors; those
runs exited **1** on both versions. The final observation now acquires a fresh
canonical snapshot, returns the closed DTO, and carries a preparation failure
without retrying its native call. All were corrected and superseded by the
final results above. No unrelated expensive workload was restarted.

`node --check <explicit changed .mjs path>` ran for **21 files on each runtime**,
with every actual exit **0**. `git diff --check` exited **0**. The independent
whitespace/final-newline scan includes every untracked deliverable. The frozen
product/unified-memory contracts, legacy sidecar and generated setup runtime
have empty diffs (actual exit **0**).

The installed product test cross-checks **306 manifest/archive files**, all
shipped bytes, and **86 source/installed runtime and Worker modules**; its
SQLite-free static reader/supervisor closure contains **23 modules**. It runs
installed current/history maintenance, fresh candidates/assembly/fetch and
confirmed shutdown. Both existing SQLite-free import fixtures exit **0** on
both runtimes through the new import test. R29's fixed Worker entry list stays
unchanged because reader and maintainer use separate isolates of the same fixed
product entry; the installed graph assertions pass without weakening them.
P2a capability assertions now list the newly released methods, and its absent-
index assertion accepts the required authorized diagnostic envelope. The
installed closure explicitly includes the pump because it is a new public
service entry. These are additive P2b expectation changes; frozen legacy
assertions and fixtures are unchanged.
The raw-fd allowlist is unchanged. There are **14 changed shipped runtime/docs
files**, all registered; the manifest has six new runtime entries and this new
handoff document, with its original ordering preserved.

## Changed-file cross-check

Route one is `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`. Route two is the independent
`git status --porcelain=v1 -z` inventory. Sorted files were compared with
`diff -u`: actual exit **0**, **24 files**. The mechanically generated list is:

- `core/context-product-authority.mjs`
- `core/context-product-index.mjs`
- `core/context-product-manifest.mjs`
- `core/context-product-pump.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-service.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-validation.mjs`
- `core/context-product-worker.mjs`
- `core/context-read-facade.mjs`
- `core/index.mjs`
- `core/sqlite-journal-probe.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-import.test.mjs`
- `core/test/context-read-product-index.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/context-read-product-service.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/test/fixtures/context-product-index-worker.mjs`
- `core/test/sqlite-lock-safety.test.mjs`
- `core/testing/context-product-index-host.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2b-impl.md`
- `packaging/artifact-files.json`

## Fix round 1

Base: `8e4212b3`, `context-read-product-v1.1`, production index lifecycle.
The frozen specification is unchanged. This round addresses the two independent
reviews without widening the existing DELETE / one-or-two-namespace scope.

| Finding | Fix | Regression test and before-fix evidence |
| --- | --- | --- |
| 1. Selection-set quota keys recharge an exhausted store | Keep cumulative ledgers independently for each normalized store/owner/host domain and window. Reserve a quantum only against its dispatched domain. Admission validates every domain before changing any counter. | Pump `Fix1 domains retain charges independently across A -> A+B -> B selections` fails at the base with active instead of exhausted. `Fix1 a mixed pump reserves each quantum only against its dispatched domain` independently checks A=2/B=1 and also exits 1 against the original runtime. |
| 2. Renewal admits overlapping windows | Initial admission and renewal share the same per-domain validation, including immutable bounds and rejection of another unexpired window. Reject before switching the active window or completion promise. | Pump `Fix1 renewal rejects a third window overlapping another pump current window` fails at the base because the expected refusal is missing. |
| 3. Rollover abandons completion observers | Settle the previous window's completion before installing the next window and promise. Shutdown settles the new observer too. | Pump `Fix1 boundary renewal settles every previously exposed completion before shutdown` finds an orphaned promise at the base. The test uses an event-loop rendezvous rather than a latency gate. |
| 4. Discarded async stop wrappers reject unobserved | Return the original observed close promise directly. Await every handle disposal with allSettled before reporting cleanup; retain a failed status/completion and failed supervisor drain when disposal fails. | Both pump `Fix1 refresh failure ...` and `Fix1 supervisor shutdown ...` produce unhandledRejection and process exit 1 against the original runtime, even with completion and public close observed. The fixed tests check failed completion/status/drain and reject the explicit close. |
| 5. Valid delta progress masks broken publication evidence | Authenticate and validate existing publication evidence before returning resumable progress. Missing/invalid publication evidence keeps unavailable precedence and null counts/progress. | P2-15/P2-18 combined-state goldens, `Fix1 ... delta progress cannot mask publication validation_missing/validation_invalid`, both return catching_up incorrectly at the base. Both status and candidate refusal are asserted after the fix. |
| 6. Repair unlinks a newer cache and exposes a missing target | Use a cache-wide child-owned repair lock; stage and fsync an initialized successor, verify the expected inode immediately before rename inside the child, then publish atomically. Retain the identity whose validation failed, and refuse if a different maintainer has replaced it in the meantime. | Probe `Fix1 cache replacement stale-identity`, `stage-fsync`, and `competing-selection` all fail at the base. Child fault injection verifies a newer inode survives, staging failure preserves the incumbent, and a second selection cannot replace while the first stages its successor. Existing production repair and lock-safety tests remain required. |
| 7. P2-09 only crashes after commit at checkpoint 0 | Add a Worker kill immediately before batch COMMIT, after document/posting/statistics mutations. Start from transformed durable checkpoint 1, compare all durable generation/document/posting/statistics/progress/pointer/certificate rows after rollback, then replay the next quantum and finish with four unique searchable documents. | `Fix1 P2-09 killed uncommitted ...` fails against the old fixture because it never interrupts the batch. The new crash marker proves the kill point was reached; unchanged checkpoint/rows and successful replay prove rollback and recovery. |
| 8. P2-21 self-compares the certificate digest and lacks the later writer boundary | Independently hash E's canonical epoch vector before any writer commit and compare the durable certificate against that expected digest. Add an independent writer after the final canonical snapshot's COMMIT: completion remains complete at E; later status and fresh-reader candidates are stale/unavailable. | The strengthened existing precommit race checks the independent expected digest. New `Fix1 P2-21 writer after final snapshot ...` fails against the old fixture because no late writer runs. With the new deterministic boundary it verifies the already-required completion semantics without adding a production callback after final validation. |

Before implementation, the three files run with `--test --test-name-pattern=Fix1`
on Node 22.16.0 each exited **1**: pump, index and probe. The isolated original
pump disposal tests also each exited **1**, with explicit unhandledRejection
reports. These are recorded failures of the submitted implementation or missing
acceptance instrumentation, as distinguished in the table; the independently
strengthened digest oracle does not imply that the original digest was wrong.

A pump selection stops conservatively when any selected domain is exhausted;
another selection may still spend a different domain's remaining budget.
Status usedItems/usedMs report the largest individual domain charges. Unknown
or failed work remains reserved. Repair never removes the target first, and
ordinary exclusive creation retains no-replace publication. A killed repair
child can leave a repair lock: subsequent repair fails closed until an operator
confirms the child has exited and removes that lock. Normal completion and
handled errors remove the lock in the child. No host raw database descriptor,
canonical write/migration, generated bundle update, network/key access or commit
was introduced.

The first matrix guard run exited **1** because the exact source allowlist
rejected the expanded child import and an additional staging descriptor open.
The descriptor reopen was removed: its original child-owned staging descriptor
stays open until SQLite initialization has closed, then is fsynced and closed.
A second guard run exited **1** because replacing the original import allowance
also rejected the unchanged generated archive. The final change preserves the
original raw-fd import/call sites, adds a separate metadata-only child import
and its exact justified allowance, and leaves the guard implementation and
generated bundle unchanged. The recovery guard run passed all **5** tests with
exit **0**. The affected probe/index/artifact tests were rerun after this change.

Changed files were derived from `git diff --name-only -z` plus untracked files,
then independently from `git status --porcelain=v1 -z --untracked-files=all`.
The sorted lists agree: `diff -u` exit **0**, **9 files**. All four changed
shipped runtime/doc paths already occur in `packaging/artifact-files.json`; no
new runtime module or manifest entry is needed. The mechanical inventory is:

- `core/context-product-pump.mjs`
- `core/context-product-sidecar.mjs`
- `core/sqlite-journal-probe.mjs`
- `core/test/context-read-product-index.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/fixtures/context-product-index-worker.mjs`
- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `core/test/sqlite-journal-probe.test.mjs`
- `docs/plans/context-read-p2b-impl.md`

Final verification used the mechanically cross-checked **51 explicit paths**
(filesystem glob versus `rg --files`, identical inventories) on both exact nvm
runtimes, Node **22.16.0** and **24.15.0**. Every invocation used
`nice -n 19 ionice -c3 <exact-nvm-node> <explicit-path>` with that runtime first
in PATH. Each runtime's version command exited **0** and returned its expected
version. Child exit codes were captured directly, independent of reporter output.
The log summaries were separately checked for matching test/pass totals and zero
failed, cancelled, skipped or todo tests.

**Final: 804 passed on each runtime; every final test invocation exited 0.**
The two development guard failures above were corrected; only their affected
probe/index/artifact checks and failed/unrun paths were repeated. No broad suite
was run. Both C06 source/wire checks, the default-path entropy check, lock tests,
MCP source tests and packaging raw29 tests are included below.

| Explicit path | 22.16.0 exit / passed | 24.15.0 exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-assembly-races.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 / 28 | 0 / 28 |
| `core/test/context-read-assembly.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/context-read-bm25.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-budget.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-core.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-embedder.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-fusion.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-local-embedder.test.mjs` | 0 / 38 | 0 / 38 |
| `core/test/context-read-local-status.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 / 15 | 0 / 15 |
| `core/test/context-read-process.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-control.test.mjs` | 0 / 83 | 0 / 83 |
| `core/test/context-read-product-import.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 48 | 0 / 48 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 11 | 0 / 11 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product.test.mjs` | 0 / 126 | 0 / 126 |
| `core/test/context-read-recovery.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-review.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 / 17 | 0 / 17 |
| `core/test/context-read-source-work.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-sources.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-journal-probe.test.mjs` | 0 / 22 | 0 / 22 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/topic-members-bounds.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-compatibility.test.mjs` | 0 / 32 | 0 / 32 |
| `core/test/topic-members-integration.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/topic-members-mutations.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/topic-members-primary.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 / 33 | 0 / 33 |
| `core/test/topic-members-review-findings.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-round3-findings.test.mjs` | 0 / 18 | 0 / 18 |
| `core/test/topic-members-scale.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/topic-members-visibility.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-members.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 / 11 | 0 / 11 |
| `core/test/topic-overview-raw29.test.mjs` | 0 / 22 | 0 / 22 |
| `core/test/topic-overview-visibility.test.mjs` | 0 / 8 | 0 / 8 |
| `core/test/topic-overview.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/topic-reader-cancellation.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/topic-reader-sqlite.test.mjs` | 0 / 21 | 0 / 21 |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 / 3 | 0 / 3 |

Final `node --check <explicit changed .mjs path>` passed for **7 files per
runtime**, each exit **0**; the updated allowlist JSON parses successfully.
`git diff --check` and the independent whitespace/final-newline scan passed
with exit **0**. Frozen product docs, default `core/context-read*.mjs` source,
and the generated setup runtime have empty diffs (`git diff --exit-code`: **0**).
The branch remains `feat/context-read-p2b` at `8e4212b3`, with no staged changes
and no commit. Temporary verification scripts/logs were removed after recording
these results.

## Fix round 2

Base: `eb304e74`, `context-read-product-v1.1`, production index lifecycle.
The frozen product specification and both independent re-reviews were read.
No commit or setup-bundle regeneration is part of this fix.

| Finding | Fix | Deterministic verification |
| --- | --- | --- |
| A: empty first publication; replacement races initialization, ordinary batches and readers | First creation initializes and commits format, metadata and incarnation in its private stage. Every production cache operation pins a shared SQLite transaction on a persistent `.lifecycle-lock.sqlite` coordination file. Creation/replacement children hold its exclusive transaction through publication. Sidecar transactions check the opened inode after obtaining their SQLite lock; idle handles reopen a successor. | Index Fix2 tests rendezvous inside the creation child, inside an ordinary batch and a reader snapshot, and while repair stages. A different selection cannot initialize or start a batch under exclusive exclusion. First publication contains complete metadata. An idle reader reopens the successor. |
| A: work may commit during the shared-to-exclusive handoff; late companions | The child checks the failed observation's device/inode/size/nanosecond modification and change timestamps after obtaining exclusion. Changed observations refuse replacement; independently, the child rechecks format, store/profile and integrity under exclusion and refuses a valid incumbent even if timestamps collide. Immediately before rename it rechecks the incumbent identity and all three companion paths. | Index Fix2 commits a valid winner during handoff, disables the timestamp shortcut to emulate indistinguishable timestamps, and verifies refusal, preserved inode/publication and subsequent readiness. Probe `late-companion` creates a journal after staging and verifies refusal without replacement. |
| B: killed child or timeout leaves permanent directory exclusion | SQLite owns exclusion; process death releases it. The coordination file persists and is never unlinked or replaced by the lifecycle. Exclusive owners reclaim previous product stages and stage companions without depending on PID liveness. | Index Fix2 kills the actual child after exclusive acquisition, stage creation, initialization transaction, initialization COMMIT, stage fsync, rename and directory fsync. Each ordinary refresh recovers; pre-rename kills retain the incumbent and post-rename kills retain a fully initialized successor. A separate actual child timeout recovers automatically. |
| C: invalid publication evidence repeatedly discards valid rebuild progress | Status retains publication-validation precedence. Maintenance independently authenticates resumable work and continues a rebuild without trusting the broken publication. A delta with an invalid base starts one full rebuild. Superseded unpublished work belonging to that projection is removed; published generations are protected. | Index Fix2 removes the certificate from a five-document publication, runs repeated `maxItems:1` refreshes, checks strictly increasing checkpoints and a stable work generation, checks unchanged unavailable status until publication, and checks exactly two generations throughout. |
| D: renewal exposes a completion with no timer to settle it | Exhausted renewal immediately reports its terminal observation, including a newly admitted exhausted window and same-window host usage. | Pump Fix2 tests both renewal paths, zero scheduled timers and settled `budget_exhausted` completions, including the previous window's observer. |
| E: retained mutable options cause a rejection outside tick handling | Admission validates and copies options, preserving only the intended shared host state and supervisor identity. Ledger lookup and quantum accounting execute inside the tick error boundary. | Pump Fix2 mutates the caller's path, namespace and host after admission; timer dispatch uses the admitted values and completion settles normally. |

### Replacement interleaving argument

The coordination database is separate from the cache and is never replaced.
Its zero-byte initial file is a valid empty SQLite database used only for OS
locks; a deferred BEGIN is followed by a schema query to acquire a real shared
lock. Only explicit maintenance creates that file, in a child. Status/read paths
open it read-only and create no files. Missing-cache observations linearize at
the missing-file check and cannot subsequently open a newly published cache
without coordination. A restored cache without its coordination file refuses
reads until explicit maintenance establishes coordination.

Every ordinary cache open, observation, query and complete refresh quantum holds
that shared lock. This includes initialization decisions and all batch
transactions. A replacement child must obtain an exclusive SQLite transaction
before staging; therefore a live ordinary writer or reader snapshot prevents
replacement, and a new ordinary operation cannot enter while the child stages.
The same exclusion covers other processes and selections. The parent closes its
failed cache handle and releases its shared lock before spawning the child;
the child rechecks the failed-observation stamp under exclusion, then independently
revalidates schema, store/profile metadata and integrity before deciding repair
is still needed. It refuses a valid incumbent. Timestamp changes can reject an
obsolete decision early, but correctness does not depend on timestamp resolution:
a completed valid initialization or ordinary commit during handoff cannot make
the child replace a healthy cache. The test deliberately disables the timestamp
shortcut while the writer restores a valid incumbent, and replacement still refuses. Initial creation uses no-replace link publication of the already
committed, closed and fsynced stage, so a second creator never sees an empty
cache and cannot replace a winner.

Under exclusive exclusion the child checks the incumbent inode and refuses
`-journal`, `-wal` or `-shm` immediately before rename. A killed ordinary writer
can leave a hot journal after its OS locks disappear; that companion still
prevents replacement. Writable SQLite opening performs recovery on the incumbent
before a subsequent repair decision; repair never deletes a journal to force
progress. After rename the initialized successor is already present. Idle cache
connections may still refer to the old inode, but hold no transaction or journal;
their next operation reacquires coordination and reopens on identity change.
Every read transaction also pins its SQLite snapshot before rechecking inode,
and every write checks immediately after BEGIN IMMEDIATE, refusing and closing
on a mismatch. Thus no coordinated operation uses the old inode alongside a
replacement pathname, no concurrent committed work is overwritten, and no old
journal can be paired with the successor.

SIGKILL/timeout releases the child's exclusive lock automatically. Before rename
the incumbent remains; after rename the full successor remains. The next repair
reclaims abandoned private stages while holding exclusion, including rollback
companions left during stage initialization. No directory lock or manual stale
owner recovery is needed. The persistent coordination file must stay in place
while clients are admitted; ordinary canonical-only backup and restore still
requires the existing drained-client gate.

All raw file creation, publication and lock-file creation remain child-only.
The sole added raw-fd allowlist entry is the child-only lock-file creation call,
with its one-line reason. Host inspection uses only metadata; host data and lock
access uses SQLite connections. The prior child import is retained for the
unchanged setup archive's exact-source guard. No new shipped module or document
is introduced, so existing artifact manifest entries cover the runtime changes.

The final defense is tested separately for both readers and writers: a child
intentionally replaces the path immediately after the connection's own BEGIN,
before the inode check. The operation refuses `storage_unavailable`, leaves no
journal, closes the old connection, and the next observation authenticates the
successor rather than reusing the old certificate. SQLite contention from the
publication child's exclusive lock preserves its numeric SQLite error and maps
to `storage_busy`; the observed child call is covered by the native transaction
boundary. Companion-path refusal remains a separate storage-availability check.

### Changed-file inventory

`git diff --name-only HEAD` was cross-checked against an independent comparison
of every tracked worktree blob with its index object (`git ls-files -s` plus
`git hash-object`), augmented with untracked-file enumeration. The sorted lists
match: **8 changed files**. This includes the report and allowlist, with no new
runtime modules, scripts, public assets or configuration files omitted.

- `core/context-product-pump.mjs`
- `core/context-product-sidecar.mjs`
- `core/sqlite-journal-probe.mjs`
- `core/test/context-read-product-index.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `core/test/sqlite-journal-probe.test.mjs`
- `docs/plans/context-read-p2b-impl.md`


### Verification and actual exit codes

The required inventory was derived by filesystem glob and independently by
`rg --files` with the matching filename predicates; the sorted inventories
match at **51 explicit test paths**. Each path ran directly with the exact nvm
Node **22.16.0** and **24.15.0** executables, with that runtime first in PATH;
both version commands exited **0**. Each child process return code was captured
directly. Reporter summaries were independently parsed for matching test/pass
counts and zero failed, cancelled, skipped or todo tests on final invocations.
Node 22 used TAP and Node 24 used its spec reporter; both were checked.

**Final result: 825 tests passed per runtime; every final per-file invocation
exited 0.** These are deterministic functional checks, with no broad suites or
performance/qualification measurements. After the final child-side semantic
recheck was added, the index, probe, both lock guards, entropy and both C06 source
files were rerun by explicit path on both runtimes; all 14 invocations exited 0.

Earlier failures are retained here rather than counted as first-pass success:

- Initial required Node 22 `context-read-local-embedder.test.mjs`: **exit 1**,
  37/38 passed; L12's first lexical query reached its ordinary deadline. After
  both matrices finished, one isolated rerun of the unchanged test and default
  implementation passed **38/38, exit 0**, with no deadline or test adjustment.
- Initial required Node 22 `sqlite-journal-probe.test.mjs`: **exit 1**, 22/23
  passed; the new late-companion fixture had a duplicated out-of-scope statement.
  That statement was removed; the corrected file passed **23/23, exit 0**,
  including the final reruns on both runtimes.
- Development index invocations exited **1** while integrating missing-cache
  status and read-only service observation with the new coordination file;
  corrected full-file runs exited **0**. Development raw-fd guard runs exited
  **1** for the unchanged archive's exact import and then a stale allowlist entry;
  retaining the original child import fixed both, with final guard exits **0**.
  Development pump and legacy probe runs exited **0**. Filtered Fix2 rendezvous
  runs exited **0**, including **17/17** after disabling the timestamp shortcut
  in the handoff test. No filtered run substitutes for the full-file results.

The following table records each final explicit-path exit and passed count;
`1 → 0` also preserves an initial required-run failure above.

| Explicit path | Node 22.16.0 exit / passed | Node 24.15.0 exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-assembly-races.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 / 28 | 0 / 28 |
| `core/test/context-read-assembly.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/context-read-bm25.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-budget.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-core.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-embedder.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-fusion.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-local-embedder.test.mjs` | 1 → 0 / 38 | 0 / 38 |
| `core/test/context-read-local-status.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 / 15 | 0 / 15 |
| `core/test/context-read-process.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-control.test.mjs` | 0 / 83 | 0 / 83 |
| `core/test/context-read-product-import.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product.test.mjs` | 0 / 126 | 0 / 126 |
| `core/test/context-read-recovery.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-review.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 / 17 | 0 / 17 |
| `core/test/context-read-source-work.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-sources.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-journal-probe.test.mjs` | 1 → 0 / 23 | 0 / 23 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/topic-members-bounds.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-compatibility.test.mjs` | 0 / 32 | 0 / 32 |
| `core/test/topic-members-integration.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/topic-members-mutations.test.mjs` | 0 / 20 | 0 / 20 |
| `core/test/topic-members-primary.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 / 33 | 0 / 33 |
| `core/test/topic-members-review-findings.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/topic-members-round3-findings.test.mjs` | 0 / 18 | 0 / 18 |
| `core/test/topic-members-scale.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/topic-members-visibility.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-members.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 / 11 | 0 / 11 |
| `core/test/topic-overview-raw29.test.mjs` | 0 / 22 | 0 / 22 |
| `core/test/topic-overview-visibility.test.mjs` | 0 / 8 | 0 / 8 |
| `core/test/topic-overview.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/topic-reader-cancellation.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/topic-reader-sqlite.test.mjs` | 0 / 21 | 0 / 21 |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 / 3 | 0 / 3 |

All six changed `.mjs` files passed `node --check` by explicit path on both
runtimes: **12 invocations, each exit 0**. The allowlist JSON parses. Final
`git diff --check` and an independent trailing-whitespace/final-newline scan
passed with **exit 0**, covering all eight changed files, including the report.
The changed-file inventories were re-derived after implementation and still
match at **8 files**. All four changed shipped runtime/doc paths already occur
in `packaging/artifact-files.json`; no manifest addition is needed.

The frozen specification, default `core/context-read*.mjs` sources and generated
setup runtime have empty diffs (**exit 0**, 50 explicitly enumerated paths).
C06 and default entropy checks pass on both runtimes. The branch remains
`feat/context-read-p2b` at `eb304e74`; nothing is staged or committed. Temporary
verification scripts and logs are removed after these results are recorded;
no test or repair process is left running.

## Fix round 3

Base: `bebc85da`, `context-read-product-v1.1`, production index lifecycle.
The frozen specification, both re-review reports and dispatch traps were read.

The remaining P1 in requirement D occurred after a completion had already
settled as `renewal_expired`: same-window renewal with host usage at the item
limit updated status to `budget_exhausted`, but retained the old resolved
promise and its zero usage. In `renew()`, a settled observer now always gets a
fresh completion, including renewal into an exhausted window. The existing
exhaustion branch immediately settles that new promise with the current
terminal observation and cumulative usage, without scheduling a timer. A
still-pending same-window completion retains its identity and settles through
the existing round-2 path; that identity is now asserted explicitly.

Two in-memory `Fix3` cases first expire renewal with zero work, then renew the
same window. The exhausted case checks a fresh promise, terminal status,
`usedItems:8`, `usedMs:200`, matching status/completion and zero timers. The
budget-left case imports `usedItems:3`/`usedMs:200`, resumes five normal quanta,
and completes at `usedItems:8`/`usedMs:700` with zero timers. Both preserve the
previous promise's expired observation.

### Before/after evidence and round-2 qualification

Each new case ran separately by explicit pump-test path with
`--test --test-reporter=tap --test-name-pattern='Fix3 .*<case>'` on both nvm
runtimes before editing the runtime. At that point,
`git diff --exit-code bebc85da -- core/context-product-pump.mjs` exited **0**,
confirming the pump implementation was the base version. The same cases then
passed in each complete fixed pump-suite run.

| New case | Node 22.16.0 base → fixed exit | Node 24.15.0 base → fixed exit |
| --- | --- | --- |
| Settled expiry → exhausted same window | 1 → 0 | 1 → 0 |
| Settled expiry → same window with budget left | 0 → 0 | 0 → 0 |

The first case fails on the base because the renewed promise is still the old
resolved `renewal_expired` observer with zero usage. The budget-left case is a
preservation control: the base already creates a fresh observer and completes
normally. Thus the requested claim that **each** new case fails on `bebc85da`
cannot accurately be made; only the exhausted case is a new behavioral
before/after regression.

For the earlier round-2 A/B evidence against `eb304e74`, distinguish behavioral
regressions from instrumentation-dependent tests, as the reviewers requested:

- The late-companion refusal, post-BEGIN reader/writer inode checks and repair
  timeout cases distinguish the relevant behaviors before and after round 2.
- Several A/B rendezvous tests depend on new hooks: `creationBoundary` matches
  a new child-source marker; ordinary batch/snapshot rendezvous, handoff
  injection and the seven repair-kill steps also require their source hooks.
  Failures caused by an absent marker or an unreached rendezvous on the older
  base do not independently demonstrate the race or crash-recovery defect.
  Their passing instrumented runs exercise the intended interleavings and
  recovery checks at the fixed implementation.
- The idle-reader successor case passes on both sides and is a preservation
  check. No new round-2-base A/B runs are claimed in this round.

### Verification and actual exit codes

Only the six requested test paths ran, each separately via
`node --test --test-reporter=tap <explicit-path>`, using the exact nvm Node
**22.16.0** and **24.15.0** executables with the selected runtime first in PATH.
Both `--version` checks exited **0**. Each test process's actual return code
was captured directly, and its TAP test/pass/fail/cancelled/skipped/todo totals
were checked independently. No broad suite was run.

| Explicit path | Node 22.16.0 exit / passed | Node 24.15.0 exit / passed |
| --- | --- | --- |
| `core/test/context-read-product-pump.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |

All **12 full-file invocations exited 0**, **105/105 tests per runtime**, with
zero failed, cancelled, skipped or todo tests. Both SQLite lock guards pass;
this change adds no database or companion access. The four filtered base runs
and their individual exit codes are recorded separately above.

### Changed files and handoff

The changed-file list was derived from `git diff --name-only HEAD` plus
untracked-file enumeration, then independently re-derived with
`git ls-files --modified --others --exclude-standard`. The sorted lists match
at **3 changed files**, including this report. `git diff --cached --exit-code`
exited **0**, confirming an unchanged index for the independent comparison.

- `core/context-product-pump.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `docs/plans/context-read-p2b-impl.md`

Final `git diff --check` and an independent trailing-whitespace/final-newline
scan covering all three files each exited **0**. Added lines contain no local
absolute paths. The frozen specification and setup bundle are unchanged.
No network or key access was used. Branch `feat/context-read-p2b` remains at
`bebc85da`; nothing is staged or committed. Verification processes have exited,
and the owned temporary verification directory and logs were removed after
recording the results.
