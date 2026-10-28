# Context-read P2e implementation handoff

Implements hosted semantic selection under `context-read-product-p2e-v1`, with
the primary's supplied Revision 2 resolution. The product profile refuses local
selection/runtime observer wiring; the existing unified §20 local path stays
unchanged. No frozen contract, generated setup runtime or commit is included.
All provider/HTTP/clock/crash inputs in verification are synthetic. No real
provider, credential, network, model download, measurement or rollout is used.

## Design and module map

The parent owns a branded coordinator and supervised lifetime; its Worker owns
provider execution, owner accounting and the host's independent authorities.
Request/maintenance Workers borrow a private channel and shared epoch/commit
gate. Provider ownership is entered before invoking an injected port, so an
immediate fatal exit cannot escape its resource count. Close distinguishes an
already observed Worker exit from a future disposal acknowledgement. Closing a reader does not settle or close its borrowed provider. Public
timeout returns independently of underlying settlement; service close waits for
actual provider/native disposal. A failed open exposes its cleanupId and must be
drained before replacement. A separate SQLite ownership file holds exclusion;
no accounting/canonical/sidecar transaction spans provider or authority awaits.

| Module | Responsibility |
| --- | --- |
| `core/context-semantic-input.mjs` | Closed inputs, hosted-only selection, canonical hashes, exact integer USD arithmetic, immutable query cutoff. |
| `core/context-semantic-coordinator.mjs` | Public owner API, owner/service binding, parent cutoffs/cancellation, identity accounting domain, supervised Worker and borrowed channels. |
| `core/context-semantic-worker.mjs` | Trusted runtime ports, entry/final authority, independent price assertion/high-water, serialized owner changes, durable reservations/settlement, actual execution ownership. |
| `core/context-semantic-ledger.mjs` | Lazy SQLite schema, explicit never-bound enrollment, physical/header/anchor attestation, prepare/commit/seal, exact pending-state recovery after disposal proof. |
| `core/context-semantic-client.mjs`, `core/context-semantic-gate.mjs` | Bounded private RPC, attempts rendezvous, deadline refusal, owner epoch/disable barrier and synchronous native publication exclusion. |
| `core/context-semantic-maintenance.mjs` | Physically resolved initial targets, scoped certificate receipts, public final-pass latch validation, catalog and resumable owner purge. |
| `core/context-product-vectors.mjs`, `core/context-vector-validation.mjs` | Exact identity cache, bounded manifest hashing, f32le canonical bytes, immutable vector generations, independent HMAC certificate/pointer and pooled cosine list. |
| `core/context-product-index.mjs` | Explicit embeddings refresh; complete selected-projection preflight; one query embedding and one k10 fusion; canonical refetch, lexical degradation and projection-only status. |
| `core/context-product-reader.mjs`, `core/context-product-worker.mjs` | Constructor-only semantic attachment, configured capability authority, original request lifetime and existing lexical/default path. |
| `core/context-semantic-pump.mjs`, `core/context-product-pump.mjs` | Explicit modes/USD dimensions, durable minute reservations, both intents, initial public status probes, mandatory owner validation despite paid exhaustion. |
| `core/context-product-sidecar.mjs` | Optional vector schema and guarded transactions; fresh canonical/dependency/scalar fence check before vector COMMIT; unchanged lexical certificates. |
| `core/context-product-sqlite.mjs`, `core/topic-reader-sqlite.mjs` | Existing P2d native wait policy with per-async-operation state for a concurrent service; no reset on connection/transaction admission. |
| `adapters/openai/product-embedding.mjs` | Injected fixed-endpoint hosted transport; whole-input/batch/response bounds, one-use transmission guard, cancellation/drain and validated usage callback. |
| `core/context-semantic-gates.mjs` | Offline fabricated-outcome metric/bootstrap/stratum and four-cell staging arithmetic; no measurement collector or enablement decision. |
| `core/testing/context-semantic-host.mjs`, `core/testing/context-semantic-process.mjs` | Fake provider, separately stored SQLite anchor/price authority, shared rendezvous and owned process crash points. Never shipped runtime fixtures. |
| `packaging/artifact-files.json`, `core/index.mjs` | Installed runtime closure and public coordinator export. |

The ledger records refresh and query reservations separately. All applicable
owner/day/lifetime, identity and minute limits intersect before invocation.
Usage reports settle at the reserved rate, once, after actual execution. Missing
or over-bound usage retains full exposure; an over-bound identity is blocked.
A transaction-level budget refusal cancels only its exact uncommitted external
preparation; it cannot leave spendable capacity or an invented empty ledger.

Anchor state binds the accounting file's physical identity and complete owner
state, excluding catalog path spelling. Copying header/rows to another inode
cannot establish continuity. Ordinary operations never initialize or repair a
binding. Exact prepared-state crash recovery requires independent disposal
proof. Loss/migration reconciliation remains a separately authenticated host
control-plane procedure under E.3, preserving charges and all safety barriers.
There is no reset, forgiveness or ceiling-raise method.

First complete hints are provisional. The last initial-target hint seals a
pending-validation barrier before later backfill admission. The public validator
persists bounded receipts; after registry preparation and the final authority
sample it opens fresh canonical snapshots for all targets and performs only
synchronous keyed/scalar comparisons and the prepared latch CAS. No callback,
RPC or await follows those final reads. The next service admission seals that
latch before any dependent send. The one-way steady phase retains earlier
same-day exposure and lifetime spend through restart, disable and purge.

Vector publication binds the exact lexical certificate, six identity fields,
owner epoch, representation, canonical/body revisions and manifest counts. A
reader checks bounded keyed evidence and every selected vector, then ranks one
pooled list across the selected namespaces. It performs one query invocation and
one registered k10 fusion, with final canonical evidence checks. Partial,
corrupt, stale or over-capacity coverage never authorizes a query. semantic:false
uses the original lexical execution path, including after its borrowed service
has closed, with no semantic trace/RPC. Ordinary status never exposes owner
refresh/latch/purge totals.

Purge batches delete only the owner across registered identities, both intents,
staging and obsolete generations. Sidecar deletion, pointer invalidation and its
owner/store/file/epoch-bound authenticated checkpoint commit together. Ledger
progress can lag that COMMIT; restart reconciles the checkpoint exactly once.
Native statements, ownership file probes, ledger and host anchor use SQLite or
the established child-process file helpers. No runtime raw-fd allowlist changes.

## Deterministic acceptance map

`S` means `core/test/context-read-product-semantic.test.mjs`; `G` means
`core/test/context-read-product-semantic-gates.test.mjs`; `H` means
`adapters/mcp/test/context-read-product-provider.test.mjs`. Test titles carry
P2e row IDs. Existing frozen suites below supply the shared authority,
serializer, eligibility, fusion and native-policy controls rather than replacing
them with implementation-mirroring assertions.

| Row | Tests and exercised boundaries |
| --- | --- |
| P2e-01 | S hosted defaults-off/enable; Revision 2 refusal; malformed controls refuse without getter/proxy effects; off-owner pump, continuation/fetch/status/capabilities/lexical maintenance zero calls; exact owner/capability authority; semantic:false closed-coordinator trap and complete lexical envelope. Existing product/default/adapter goldens and both entropy tests. |
| P2e-02 | S public refresh/read, pooled four-namespace oracle, shared cutoff arithmetic, actual-settlement subdeadline and assembly singleton. Existing product-control mock-clock/cutoff tests. |
| P2e-03 | S provider-error/rate/dimension/unavailable lexical success, price denial, attempts0/1, private canary and assembly diagnostic placement; existing final authority/cutoff suppression controls. |
| P2e-04 | S missing evidence, invalid certificates, typed schema/journal coverage and zero-query preflight. Existing embedder capacity boundary tests, product overflow and physical type/intent controls. |
| P2e-05 | S real process kills before/after prepare/seal CAS and after possible send; exact anchored recovery; actual settlement stays pinned; ledger/anchor/ownership cross-process lock probes. |
| P2e-06 | S canonical smaller batches, tighter item caps, unknown exposure/UTC rollover/backward clock, USD-first exact ceiling; existing shared identity budget controls. |
| P2e-07 | S public both-intent coverage, maximum 64-target enablement and independent G digest oracle, maxTargets1/restart, durable pending barrier, exhausted-budget pump validation, steady same-day accounting and persistent ceiling. No latch setter or ledger mutation. |
| P2e-08 | S unknown/validated/over-bound usage, exact decimal rounding, price refusal and possible-send crash; H usage independent of vector validity, malformed/over-bound usage. |
| P2e-09 | S public bounded owner purge/restart and independent inventories; real before/after sidecar COMMIT process kills; physical schema/journal matrix and intact lexical/other-owner canaries. |
| P2e-10 | S independent full manifest/HMAC/pointer oracle and corrupt/duplicate/noncanonical evidence; G fixed f32le SHA-256 known answer and negative-zero rejection; Revision 2 local identity refusal. |
| P2e-11 | S public pooled Memory/Card four-namespace cosine/BM25/k10 arithmetic for both intents and all 24 selection permutations; existing mixed zh/ja/English owner oracle. |
| P2e-12 | S pooled k10 oracle and frozen ranking path; existing context-read-fusion and product-owner numeric oracles pin depth24, absent membership, union/top-k and canonical ties. Legacy local preset stays unchanged. |
| P2e-13 | H whole input, 64-document/response/redirect/usage bounds and guard/cancellation; S ready-only maintenance, final canonical race, price change before send, pump validation, native locks and physical WAL paths; existing P2d SQL-policy tests. |
| P2e-14 | S exact owner/capability authority, sanitized provider canaries, phase/purge/restart status and final revocation; existing untouched default DTO/native cleanup goldens. |
| P2e-15 | S fake price currentness/expiry between reservation and guard; H no-send price guard; persisted admission high-water and pinned rates in ledger records; no live price source. |
| P2e-16 | S copied/empty ledger, repeated enrollment refusal, exact pending crash recovery and possible-send no replay; independently retained anchor registry. |
| P2e-17 | S owner-only status/method credentials and capability final revocation; projection status implementation excludes owner progress. Existing owner/evidence canary suites cover unselected and foreign scopes. |
| P2e-18 | S missing/invalid certificate zero-dispatch lexical success and unchanged lexical evidence; assembly fallback path. |
| P2e-19 | S repeated identity-query budget denial, tighter item/USD refresh exhaustion, one-way ceiling and paid-exhausted validation. Query and refresh charges are separate. |
| P2e-20 | S all fake provider failure variants, assembly byte equality, subdeadline fallback and actual execution ownership; H sanitized transport/429/bad response, no retry. |
| P2e-21 | S semantic:false envelope trap, staged 26-namespace canaries, canonical forget during settlement, public owner purge with two independent zero inventories and another-owner/lexical canaries; existing owner/mutation/refetch suites. |
| P2e-22 | G independent binary metrics, seeded 10,000-draw bootstrap oracle, conjunctive primary/challenge/identifier/nDCG/safety gates, incomplete registration and four-cell staging p95 equality/over-bound. Fabricated arithmetic only. |

## Verification commands and exits

The final explicit-path matrix is complete on both required runtimes. Its inventory is independently
expanded by filesystem globs and `rg --files` with the required family predicate:
**61 paths, zero differences**. Commands run one path at a time through the
managed process-group runner, with the matching pinned Node directory first on
PATH:

```sh
"$p2e_node" --version
"$p2e_node" tools/testing/run.mjs --import "$p2e_verification/npm-cache-only.mjs" \
  --test-reporter=tap --test-concurrency=1 "$p2e_test"
```

The temporary preload confines npm subprocesses to an owned offline cache. It
was seeded read-only from 19 already-cached public URLs, preserving 22 cached
entries/Accept variants. No shared cache is written. The OpenAI adapter's
missing pinned tokenizer was installed offline with ignore-scripts (exit0)
after confirming node_modules was absent; MCP's existing real directory was
kept. No provider key is involved.

Development checks retained their actual exits: initial missing-tokenizer matrix
command exit1 before test import; corrected offline installation exit0. Earlier
semantic runs exposed a typed-array return through readTransaction and an
unapproved raw-fs import; both were corrected, with no allowlist expansion.
A restart test initially retried a quarantined failed open before awaiting its
cleanup; it now verifies actual supervised drain before recovery. An independent
bootstrap oracle differed by one floating addition unit; its numeric comparison
uses machine-precision tolerance, without rounding any gate decision.

The Node 22 full matrix completed with exit0 for all **61 paths / 1,064
passing tests / zero skips**. Five late-added semantic cases and the final
constructor/certificate/resource corrections were then checked on Node 22 by
these explicit focused commands, all using the same managed runner:

| Extra `--test-name-pattern` on S | Exit | Pass |
| --- | ---: | ---: |
| `accepted price sequence` | 0 | 1 |
| `zero-call\|off-owner pump\|staged 26` | 0 | 3 |
| `exact owner authority\|independent canonical` | 0 | 2 |
| `fatal service Worker\|subdeadline degrades` | 0 | 2 |
| `exact owner authority` (final required-budget refusal cases) | 0 | 1 |

The Node 24 full matrix includes all final semantic cases. The fatal-exit
regression's first development command exited1: provider ownership was counted
after entering the port. Moving that counter before invocation fixed it, and
the final focused command above passed without weakening the assertions. The
certificate correction also requires published===1, bounds generation-state
reading, and compares the current lexical pointer inside the vector evidence
transaction. Malformed request-control accessors/proxies refuse before any
property execution. Reader semantic configuration requires every field and an
explicit positive query budget; missing/undefined values refuse before service
channel attachment. The last focused command traps that attachment path.

The initial Node 24 owner regression command exited1 (13/14): its existing
prebuild helper retried a handle made terminal by a parent timeout. The parent
lifecycle confirms that timeout stops that Worker; the helper now awaits close
before reopening and resuming committed checkpoints. A deterministic mock case
asserts drain-before-open and refuses replacement after uncertain cleanup. The
updated full owner file passed on Node 22 (exit0, 15/15); the Node 24 retry passed (exit0, 15/15). The matrix resumed at its failed file
rather than repeating completed paths. No timeout,
budget, golden or production lexical behavior was changed for this correction.

All **61 final explicit-path commands on each runtime exited0 with zero skips**.
The latest full-file commands report **1,065 / 1,070 passing tests** on
Node 22 / Node 24 respectively. The difference is the five semantic cases added
after the initial Node 22 file execution; their Node 22 focused exits are above.
The 15-case owner rerun is used in this table; its earlier failed Node 24 command
remains recorded above rather than being reclassified as a pass.

Two final changes were checked separately on **both** runtimes:

```sh
"$p2e_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 \
  --test-name-pattern='64-target|maximum 32' \
  core/test/context-read-product-semantic-gates.test.mjs \
  core/test/context-read-product-semantic.test.mjs
"$p2e_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 \
  --test-name-pattern='pooled four-namespace' \
  core/test/context-read-product-semantic.test.mjs
```

The target-boundary commands exited **0 / 0**, two tests each. A valid 32-target
input expands to 64 engine-owned descriptors beyond the generic IPC node cap;
the engine now hashes the same canonical array incrementally, retaining bounded
per-descriptor validation. Public enablement freezes all 64 targets without a
provider call. The strengthened numeric oracle commands exited **0 / 0**, one
test each: exact fusion scores and both channel ranks/raw scores are checked
across every permutation and both intents. Each request Worker is closed before
the next permutation to keep test resource use bounded. These supplemental
cases complete the final semantic/gate file versions (43 and 6 cases).

Both version probes printed the exact required versions with exit0. Syntax
checks for all **29 changed JavaScript files** exited0 individually on both
versions. `git diff --check`, changed-file newline/whitespace checks and added-text
local-path checks exit0. Frozen contracts, generated setup runtime and the raw-fd
allowlist/guard file remain unchanged. No command's exit is inferred from a pipe.

| Explicit path | Node 22.16.0 exit (pass) | Node 24.15.0 exit (pass) |
| --- | ---: | ---: |
| `adapters/mcp/test/context-read-assembly.test.mjs` | 0 (43) | 0 (43) |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `adapters/mcp/test/context-read-product-owner-evidence.test.mjs` | 0 (34) | 0 (34) |
| `adapters/mcp/test/context-read-product-provider.test.mjs` | 0 (9) | 0 (9) |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 (4) | 0 (4) |
| `adapters/mcp/test/context-read.test.mjs` | 0 (6) | 0 (6) |
| `core/test/context-read-assembly-races.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 (28) | 0 (28) |
| `core/test/context-read-assembly.test.mjs` | 0 (20) | 0 (20) |
| `core/test/context-read-bm25.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-budget.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-core.test.mjs` | 0 (26) | 0 (26) |
| `core/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-embedder.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-fusion.test.mjs` | 0 (4) | 0 (4) |
| `core/test/context-read-local-embedder.test.mjs` | 0 (38) | 0 (38) |
| `core/test/context-read-local-status.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-moc-source.test.mjs` | 0 (15) | 0 (15) |
| `core/test/context-read-process.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-artifact.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-control.test.mjs` | 0 (83) | 0 (83) |
| `core/test/context-read-product-import.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-index.test.mjs` | 0 (65) | 0 (65) |
| `core/test/context-read-product-overflow-status.test.mjs` | 0 (16) | 0 (16) |
| `core/test/context-read-product-owner.test.mjs` | 0 (15) | 0 (15) |
| `core/test/context-read-product-p2cd.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-pump.test.mjs` | 0 (24) | 0 (24) |
| `core/test/context-read-product-semantic-gates.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-product-semantic.test.mjs` | 0 (37) | 0 (42) |
| `core/test/context-read-product-service.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-wal.test.mjs` | 0 (85) | 0 (85) |
| `core/test/context-read-product.test.mjs` | 0 (126) | 0 (126) |
| `core/test/context-read-recovery.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-review.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-sidecar.test.mjs` | 0 (17) | 0 (17) |
| `core/test/context-read-source-work.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-sources-authority.test.mjs` | 0 (6) | 0 (6) |
| `core/test/context-read-sources-bounds.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-sources-races.test.mjs` | 0 (16) | 0 (16) |
| `core/test/context-read-sources.test.mjs` | 0 (14) | 0 (14) |
| `core/test/context-read-tokenize.test.mjs` | 0 (2) | 0 (2) |
| `core/test/no-raw-db-fd.test.mjs` | 0 (5) | 0 (5) |
| `core/test/sqlite-lock-safety.test.mjs` | 0 (16) | 0 (16) |
| `core/test/topic-members-bounds.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-compatibility.test.mjs` | 0 (32) | 0 (32) |
| `core/test/topic-members-integration.test.mjs` | 0 (1) | 0 (1) |
| `core/test/topic-members-mutations.test.mjs` | 0 (20) | 0 (20) |
| `core/test/topic-members-primary.test.mjs` | 0 (26) | 0 (26) |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 (33) | 0 (33) |
| `core/test/topic-members-review-findings.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-round3-findings.test.mjs` | 0 (18) | 0 (18) |
| `core/test/topic-members-scale.test.mjs` | 0 (2) | 0 (2) |
| `core/test/topic-members-visibility.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-members.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 (11) | 0 (11) |
| `core/test/topic-overview-raw29.test.mjs` | 0 (22) | 0 (22) |
| `core/test/topic-overview-visibility.test.mjs` | 0 (8) | 0 (8) |
| `core/test/topic-overview.test.mjs` | 0 (4) | 0 (4) |
| `core/test/topic-reader-cancellation.test.mjs` | 0 (6) | 0 (6) |
| `core/test/topic-reader-sqlite.test.mjs` | 0 (21) | 0 (21) |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 (3) | 0 (3) |


All managed runners and supplemental commands exited before cleanup. An
independent process-argument check found zero active processes using the owned
verification workspace; its logs, scripts, private offline cache and archives
were then removed. The ignored adapter dependency installation remains in the
worktree for local verification. No commit or staging operation was performed.

## Deferred integration and qualification

The host supplies production enrollment/tombstones and explicit loss/migration
reconciliation, independent durable anchor/CAS and price publication, trusted
clock, owner and projection issuance, runtime credential closure, supervision
and organize scheduling. Hosted embeddings need owner approval and the host's
consent/privacy surface. None is inferred from installing this package.

E.9's real hosted measurement extension, sealed E.10 corpus/quality evaluation,
production-class staging p95 evidence and product rollout/monitoring remain
separately registered and authorized work. G validates future scorer arithmetic;
it is not model quality or latency evidence. No generated runtime, canonical
migration, deploy, real provider run or commit is part of this handoff. Product
local selection is deferred by supplied Revision 2; frozen §20 remains usable
through its existing engine/adapters.

## Changed files

Inventory is cross-checked mechanically using diff plus untracked enumeration
against HEAD blob hashes plus an independent `rg` filesystem enumeration:
**32 files, zero differences**. Final verification confirmed the same inventory.

- `adapters/mcp/test/context-read-product-provider.test.mjs`
- `adapters/openai/product-embedding.mjs`
- `core/context-product-index.mjs`
- `core/context-product-pump.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-sqlite.mjs`
- `core/context-product-vectors.mjs`
- `core/context-product-worker.mjs`
- `core/context-semantic-client.mjs`
- `core/context-semantic-coordinator.mjs`
- `core/context-semantic-gate.mjs`
- `core/context-semantic-gates.mjs`
- `core/context-semantic-input.mjs`
- `core/context-semantic-ledger.mjs`
- `core/context-semantic-maintenance.mjs`
- `core/context-semantic-pump.mjs`
- `core/context-semantic-worker.mjs`
- `core/context-vector-validation.mjs`
- `core/index.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-owner.test.mjs`
- `core/test/context-read-product-semantic-gates.test.mjs`
- `core/test/context-read-product-semantic.test.mjs`
- `core/testing/context-product-owner-fixture.mjs`
- `core/testing/context-semantic-host.mjs`
- `core/testing/context-semantic-process.mjs`
- `core/topic-reader-sqlite.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2e-impl.md`
- `packaging/artifact-files.json`
- `packaging/test/topic-overview-raw29.test.mjs`
