# Optional local Raw search and maintenance

An explicitly selected local service indexes retained Raw and returns canonical
source candidates and prepared ranges for a later context allocator. Existing
constructors, capture, privacy mutations, representations and transports retain
their behavior when this service is absent or disabled. Hosted backends refuse.

The sidecar is per owner and plaintext. It stores authenticated source manifests,
postings and optional vectors; canonical Raw remains authority. Maintenance uses
existing durable facts, exclusions, missing rows, session fences and capture
controls under the existing host broker. No canonical migration, mutation hook,
outbox, timer, index export or hosted upload is added.

## Coordinator answers followed

| Answer | Status | Implementation |
| --- | --- | --- |
| Q2 | Amended | Separate read selection and independently selected maintenance; entirely unselected paths do zero new work. Every protected dispatch checks canonical denials, including unchanged-epoch session fences. Cleanup never gates privacy commits. Counts are unknown/unavailable. No online export; journals, inactive generations and backups remain under retention/erasure and non-serving restore policy. Explicit owner purge on decommissioning. |
| Q3 | Accepted local choice; hosted deferred | Separate per-owner plaintext SQLite sidecar behind an owner segment/search interface. Hosted selection fails closed; no sealed-index claim or new key custody. |
| Q4 | Provisional, awaiting 9a | Full global-turn/session hierarchy, k10 fusion, top-three session centers, k60 round-robin/global fusion, adjacent neighbors at .65 and strongest-source deduplication. Bounds are 256 expanded turns, 50,000 work and 24 final turns, with partial coverage. |
| Q5 | Amended | Privacy denials block both intents. Known retired/current-history overlaps and unresolved linked currentness are history-only. Unknown privacy ancestry denies both. Demonstrably bare Raw is current-eligible as attributed unknown-currentness evidence; rendering must say it may be outdated. Capture-only controls do not erase earlier saved ranges or authorize backfill. |
| Q7 | Provisional, awaiting 9a | Existing selected embedder only, no automatic remote fallback. Missing/partial vectors yield explicit BM25-only. Shared process allowance and vector residency; explicit document refresh, bounded attempts and later-turn backoff. Durable hosted accounting is reserved behind the interface because this local path does not enter product workers. |
| Q8 | Provisional, awaiting 9a | Frozen measurement targets precede runs. Separate 512 MiB owner index quota, shared 20,000-vector / 128 MiB resident ceiling, bounded sidecar transactions and shared background commit cadence. Canonical Raw is never evicted to make index room. |
| Q9 | Amended | Fresh final canonical snapshot after callbacks/serialization; whole-preparation refusal with a fixed content-free error. Complete ranking contributors survive fusion and preparation. Each opener/provider dispatch is independently guarded. `revalidate` is exposed for a later consumer's dispatch after its own waits. Only engine-snapshot semantics are advertised; no atomic wire-send contract. |
| Q10 | Accepted | This PR owns index, authority, retrieval and maintenance. The next PR owns the shared allocator and selected delivery surfaces. `RAW-SEARCH-INTERFACE.md` freezes the dependency contract. |
| Local-first scope | Accepted | No product-profile behavior/signature changes. Hosted integration remains reserved; actual local shared budget, broker and vector participation are described in `SEAM.md`. |
| Memory-first floor | Binding read policy; next PR | The allocator preserves existing Memory items/order before admitting Raw or Cards. This PR exposes typed candidates, separate ranges and revalidation, and emits no new context output. |

Q1's authored-Card authority and Q6's representation/allocator budgets are outside
this PR. No complete authored lineage or full three-layer qualification is
claimed. These are scope boundaries, not additional answered questions.

## Interface and host seam

See [RAW-SEARCH-INTERFACE.md](RAW-SEARCH-INTERFACE.md) and [SEAM.md](SEAM.md).
Candidate policy is explicit per range and turn. Denied classification contains
no source identifiers. Service-local prepared tickets support fresh validation
after IPC/host waits; a later transport must install and test that call itself.

## Validation

Synthetic targeted tests cover the parent off differential, exact canonical
materialization, classification, bounds, segment CAS/forgery, maintenance and
multi-connection privacy races. Provider tests use fake offline ports only.
Actual exit codes, measurements and remaining qualifications are recorded in
the delivery report; no passing result is inferred from partial output.

Large-corpus measurements are operational partial BM25-only profiles: the
8 MiB encoded-hint ceiling admits fewer rows than the retained corpus, and the
owner quota can stop indexing before all chunks fit. The separate paged vector
scan measures indexed vectors, not a complete hybrid read. Full hybrid coverage
and the provisional cost choices still require review. Hosts select the service
before admitting Memory reads, or drain existing preflight caches first. The
local process budget is not a durable hosted owner ledger.

Performance approval remains blocked. The latest full synthetic run exits 1 on
the frozen capture-contention allowance; its 20K profile also reports a failed
maintenance lane during concurrent capture. First-read probes distinguish lock
holding from writer wait time. The failed result is retained, and no target is
relaxed to turn it into a pass.

## Inherited paths reviewed for privacy and dispatch

All 26 inherited paths are accounted for below. The first group contains the
production privacy, exclusion, publication and dispatch boundaries. The other
groups specify or exercise those boundaries and were checked against the same
amended contract.

| Group | Inherited paths |
| --- | --- |
| Production boundaries (9) | `core/context-read-embedder.mjs`, `core/context-read-sidecar.mjs`, `core/index.mjs`, `core/raw-search-authority.mjs`, `core/raw-search-index.mjs`, `core/raw-search-input.mjs`, `core/raw-search-maintenance.mjs`, `core/raw-search-retrieval.mjs`, `core/raw-search-storage.mjs` |
| Synthetic proofs (9) | `core/test/raw-search-index.test.mjs`, `core/test/raw-search-maintenance.test.mjs`, `core/test/raw-search-off.test.mjs`, `core/test/raw-search-performance.test.mjs`, `core/test/raw-search-privacy.test.mjs`, `core/testing/raw-search-fixtures.mjs`, `core/testing/raw-search-mutation-child.mjs`, `core/testing/raw-search-off-child.mjs`, `tools/testing/measure-raw-search.mjs` |
| Contracts and descriptions (8) | `CHANGELOG.md`, `docs/context-read-local.md`, `docs/context-read-product.md`, `docs/plans/memory-architecture-alignment.md`, `docs/plans/raw-layer-contract.md`, `docs/plans/three-layer-engine-contract.md`, `RAW-SEARCH-INTERFACE.md`, `SEAM.md` |

The inherited snapshot inventory and this table were independently parsed and
compared: 26 paths, no omissions or additions.
