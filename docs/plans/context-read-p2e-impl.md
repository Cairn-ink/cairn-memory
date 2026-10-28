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

## Fix round 1

Addresses both independent reviews of `7b56a88c`. Defaults, frozen contracts,
WAL/native wait policy, raw-fd allowlist and lazy import boundaries are retained.
All providers, prices, faults and clocks are synthetic; new asynchronous races
use shared-state rendezvous, never elapsed-time assertions. No network, real
credential, measurement, product enablement or commit is part of this round.

### Findings, fixes and regressions

The test references below are in `core/test/context-read-product-semantic.test.mjs`
unless the gates file is named explicitly. New titles start with `Fix1`.

1. **Safety 1, physical ledgers:** process-wide provider policy now binds the
   attested device/inode as well as logical ledger IDs. A second physical ledger
   refuses before its host/provider factory, including after the first service
   closes. The two `shared identity refuses a second physical ledger` cases use
   separately enrolled owners with identical logical IDs and unit request and
   concurrency limits. This implementation chooses configuration refusal rather
   than independent allowances in multiple files.
2. **Spec 1, other owners:** global admission authenticates every contributing
   owner against that owner's independent anchor outside the ledger transaction.
   The reservation transaction then compares the complete owner inventory and
   every authenticated sequence/digest before aggregating exposure. Both
   `shared identity authenticates another owner's` cases preserve A's anchor
   while rolling back B's rows inside the same inode or removing B's anchor.
   Neither can authorize a new send or reservation.
3. **Safety 2, ID records:** all ledger dictionaries are rebuilt with null
   prototypes at initialization, JSON decoding and mutation cloning; new window
   quanta and reset pump bindings also use null prototypes. Authority/revision
   IDs retain the closed, nonempty, well-formed, NUL-free, 200-unit opaque grammar.
   The `__proto__ price authority` regression accepts sequence 2, inspects its
   durable own-property high-water, reopens and refuses sequence 1 without a send.
   The record audit covered days, reservations, identities, prices, receipts,
   hints, windows/quanta, pump bindings and catalog; transient operation/client,
   coordinator, path/view and ranking registries already use Map/Set. Remaining
   ordinary objects have fixed schema keys (including literal model/type keys),
   or use the existing own-data whitelist/unsafe-key rejection boundary.
4. **Safety 4, pre-invocation cleanup:** reservation admission failures now enter
   the existing settlement path with invocation still false. A durable reserved
   row becomes released; both abort-controller sets are cleaned and the controller
   is aborted. Every service mutation registers its exact preparation, so a native
   error after the may_transmit COMMIT can be reconciled before no-invocation
   settlement too. The two `pre-invocation` cases inject a mock monotonic expiry
   after the reserved seal or an error after the may_transmit COMMIT, assert zero
   invocation, released state, zero reserved items and created/aborted controller
   counts, then successfully refresh with maxConcurrent 1 on the same service.
5. **Spec 2 / safety 3, prepared validation:** register reconciliation immediately
   after prepare, before any final authority sample, cutoff branch or native read.
   The four `validation ... after prepare` cases rendezvous at that exact
   preparation, inject revocation, a native read exception, mock cutoff or an
   error reported after a successful native COMMIT, assert the frozen error, and
   reconcile through the next authorized status admission. Reconciliation selects
   the exact previous or committed state from its persisted sequence/digest; an
   already committed latch remains steady.
   Validation then completes on the still-open coordinator without another send.
6. **Spec 3, invalid receipts:** final mismatches remove affected receipts/hints
   from returned progress and retain exact receipt invalidations in the pending
   reconciliation. The next authorized admission cancels the unused preparation
   and persists those invalidations through an anchored mutation before allowing
   dependent work. `failed final comparison` changes exactly one certificate
   after receipt collection, then asserts partial 1/2 progress both immediately
   and durably, an unset latch and a cleared validation barrier. It also injects
   a post-COMMIT error during receipt reconciliation itself; the following
   authorized admission recovers the exact invalidation without stranding state.
7. **Safety 5, vector republication:** re-observe vector publication after the query
   attempt; invalidated semantic evidence yields the captured valid lexical list
   and validation_invalid degradation. The final native check can also select
   lexical delivery if publication races counting. Assembly prepares both delivery
   alternatives before the final authority sample; final delivery performs only
   native evidence comparisons, with one query embedding and one fusion. Both
   preparation branches are included in counter-call and assembly-time telemetry.
   Three
   `vector republication` cases cover candidates, assembly during embedding, and
   assembly during the counter callback. They compare lexical item bytes and
   retain unchanged lexical certificates under a no-op vector refresh.
8. **Spec 4, configured capability:** the opening handshake retains verified runtime
   identity independently of mutable owner accounting. Snapshot failure keeps that
   identity, marks owner policy unknown and reports ledger_unavailable.
   `ledger failure retains configured provider` uses the real service/client and
   public capabilities/status/read methods to assert configured true, enabled null
   and lexical degradation after a ledger row becomes unavailable.
9. **Spec 5, quality gates:** the +5-pp condition matches only the four named critical
   aggregates/directions. All slices retain their no-regression checks, including
   strict identifier nonregression. The gates-file `quality slices +4/+6/+8 pp`
   regression gives +6-pp critical aggregates, positive nDCG and no regressions;
   each +4-pp slice and the complete gate must pass.
10. **Spec 6 / Revision 2 test:** the fake local runtime now supplies both independent
    authorities and owned disposal. The strengthened Revision 2 case separately
    exercises invalid runtime shape/observer wiring and local identity behind a
    valid hosted policy. Each reaches the post-factory boundary, confirms Worker
    and native disposal and asserts zero provider/observer/authority operations.
    Removing just runtime identity validation makes the old test pass and the
    strengthened test fail; this mutation is checked on both required runtimes.
11. **Spec 7, accounting transitions:** `canonical edits after first completion`
    uses distinct steady/backfill item and USD limits, completes coverage, performs
    a public canonical correction, rebuilds lexical coverage and actually attempts
    embedding refresh. The attempt must refuse at steady limits without new sends
    or changed exposure. The two `already-sent settlement` cases hold an actual
    transmitted refresh at a rendezvous, replace the independent price publication
    or advance mock UTC to expiry, then settle while the coordinator stays open.
    They independently check the reserved revision/rate and exact token cost,
    zero outstanding exposure, and refusal of subsequent new transmissions.

### Verification

The required test inventory is expanded independently from the previous explicit
path table and filesystem family globs: **61 paths, zero differences**. Each path
runs separately through the managed process-group runner with the pinned Node
binary directory first on PATH. Actual subprocess return codes are captured,
without pipes; logs retain full TAP and child cleanup results. The active command,
progress, process state, failures and exits are supervised until completion.

Commands (the test and Node variables denote the mechanically enumerated path
and the exact version's executable):

```sh
"$p2e_node" --version
"$p2e_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 "$p2e_test"
"$p2e_node" tools/testing/run.mjs --test-name-pattern='Fix1|Revision 2' \
  core/test/context-read-product-semantic.test.mjs \
  core/test/context-read-product-semantic-gates.test.mjs
"$p2e_node" tools/testing/run.mjs --test-name-pattern='Revision 2' \
  core/test/context-read-product-semantic.test.mjs
"$p2e_node" tools/testing/run.mjs --test-name-pattern='Fix1 canonical edits' \
  core/test/context-read-product-semantic.test.mjs
"$p2e_node" tools/testing/run.mjs --test-name-pattern='Fix1 already-sent' \
  core/test/context-read-product-semantic.test.mjs
"$p2e_node" --check "$p2e_changed_js"
git diff --check
```

The baseline and mutation commands run in an isolated checkout of `7b56a88c`,
with the new tests and synthetic host overlaid. Runtime mutations are confined to
that checkout. The accounting-transition additions and corrected runtime fixture
are coverage fixes: they pass against the original runtime, so they are verified
by deliberately broken implementations instead of claiming a false baseline
failure. The original runtime-mismatch test's false positive is also demonstrated
explicitly. No assertion is weakened to manufacture red/green evidence.

| Baseline / deliberately broken implementation command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | ---: | ---: |
| Baseline `--test-name-pattern='Fix1\|Revision 2'`, both semantic files | 1 (20 cases: 16 fail, 4 pass) | 1 (20 cases: 16 fail, 4 pass) |
| Baseline `--test-name-pattern='Fix1 pre-invocation native'` (additional boundary) | 1 (1 fail) | 1 (1 fail) |
| Identity validation removed; original `Revision 2` test | 0 (false positive demonstrated) | 0 (false positive demonstrated) |
| Identity validation removed; strengthened `Revision 2` test | 1 (expected rejection missing) | 1 (expected rejection missing) |
| Refresh admission uses backfill limits; `Fix1 canonical edits` | 1 | 1 |
| Settlement uses a replacement rate; `Fix1 already-sent` | 1 (both cases fail) | 1 (both cases fail) |

These nonzero baseline/mutation exits are required red evidence, not final-suite
failures. The four baseline passes are the corrected runtime test and three
previously missing accounting-transition tests. The additional native reservation
case brings unique baseline red evidence to 17 cases per runtime. Final accounting follow-up also
performs a canonical correction before testing new price admission: history alone
would reuse current-intent cached vectors and could pass without a new reservation.

Node 22 development commands retained actual exits: the first focused `Fix1`
command exited 1 (12 pass / 2 fail) because the test queried a nonexistent
certificate field and exceeded the existing assembly token bound. Correcting
those fixture inputs gave vector-query regressions exit 0 (2/2) and the combined
Revision 2 / receipt / transition command exit 0 (5/5). A final-assembly race probe
then exited 1: retrying the authority's one-use final sample refused. Preparing
both deliveries before that sample fixed it; the pooled-oracle / subdeadline /
vector command exited 0 (5/5), and the counter-telemetry probe exited 0 (1/1).
The post-COMMIT fault probes initially exited 1 because a read hook consumed the
commit fault and because status correctly returns an unknown-owner envelope on
native unavailability. Corrected fault assertions passed the reconciliation
command with exit 0 (5/5); the final in-flight settlement command exited 0 (2/2).
An initial mutation driver exited 2 after its test exited 0: changing the whole
phase was independently caught by the transmission barrier. The corrected mutant
changes only refresh admission limits; its actual failing exits are recorded
above. No production deadline, gate, golden or error precedence was loosened.


The first Node 24 complete semantic command exited **1** (57 pass / 4 fail).
Those failures occurred in coordinator binding after the intentional fatal-exit
case: fixture cleanup freed its quarantined ledger inode, and unrelated later
fixtures reused it. The supervisor correctly refused that identity. The fatal
fixture now retains a hard link only after its Worker has exited and close has
reported failure; the link is removed by the file-level cleanup after all tests.
The failed provider/resource quarantine remains asserted and is never cleared or
recovered. This is test-lifetime isolation, with no production safety exception.
The first isolation retry exited **1** (60 pass / 1 fail): registering `after()`
inside the fatal test scoped cleanup to that test. Registering the cleanup hook
at file scope retains the inode through every subsequent case. A focused
fatal-exit/64-target diagnostic command exited **0** (2/2); complete-file retries
remain the acceptance evidence, since inode allocation can vary between runs.
The matrix stopped on that nonzero exit and resumed from the failed path, without
repeating completed paths. The initial Node 22 semantic command exited 0 (60
cases) before the extra post-COMMIT case and final assertions; its final complete
file rerun is reported with the final per-path results below.


The added post-COMMIT reservation boundary also required preparation tracking for
ordinary service mutations, rather than only validation latches. Its focused
baseline command exited **1** on both runtimes, while the final combined
reservation/validation/receipt probes exited **0** on both (**7/7 each**).
Two earlier fault-simulator development probes were stopped with actual exit
**143**: the new reservation fault mode accidentally entered a validation-only
rendezvous. Restricting that rendezvous to its declared modes corrected the
fixture. Neither stopped probe is counted as red/green acceptance evidence.

### Final per-path results

All **61 required paths on each runtime** have final complete-file exit **0**,
with **zero skips**. Latest complete-file totals are **1092 / 1092 passing tests**
on Node 22.16.0 / 24.15.0. The Node 22 final semantic rerun and the corrected
Node 24 complete semantic command each passed all **62 cases**, exit **0**.
Earlier failed commands remain documented above; this table reports each path
after its final correction, rather than relabeling those failures.

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
| `core/test/context-read-product-semantic-gates.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-product-semantic.test.mjs` | 0 (62) | 0 (62) |
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

Both exact-version probes exited **0**. All **10 changed JavaScript files**
passed individual `--check` commands on both versions: **20 actual exits 0**.
The final source SHA-256 inventory remained unchanged throughout the last
complete-file verification. Managed runners completed and drained their owned
process groups before returning. The isolated baseline checkout was removed
only after independently verifying zero processes in it. No commit or staging
operation was performed.

### Fix-round changed files

Cross-checked `git diff --name-only HEAD` plus untracked enumeration against
independent HEAD blob hashes and an `rg --files --hidden` filesystem inventory:
**11 files, zero differences**. This round changes no generated runtime,
contract, dependency installation, artifact manifest or raw-fd allowlist.

- `core/context-product-index.mjs`
- `core/context-semantic-client.mjs`
- `core/context-semantic-coordinator.mjs`
- `core/context-semantic-gates.mjs`
- `core/context-semantic-ledger.mjs`
- `core/context-semantic-maintenance.mjs`
- `core/context-semantic-worker.mjs`
- `core/test/context-read-product-semantic-gates.test.mjs`
- `core/test/context-read-product-semantic.test.mjs`
- `core/testing/context-semantic-host.mjs`
- `docs/plans/context-read-p2e-impl.md`


## Fix round 2

Addresses both remaining P1 findings against `0f43acaf`.

The host ledger authority now requires
`listOwners({accountingDomainId, ledgerId})`, returning its independently durable,
complete membership inventory. Enrollment must register membership before a
ledger row can exist; membership survives ledger deletion, snapshot restore,
restart, disable and purge. It must never be reconstructed from ledger rows.
The synthetic authority enumerates its separately persisted permanent anchors.
Every anchored owner is authenticated before shared identity admission, and the
complete row inventory and exact sequences/digests are checked again in the
reservation transaction. Missing members, missing anchors and extra rows refuse
closed. No ordinary operation initializes, repairs or removes membership.

Semantic assembly now selects a single horizon. After query embedding, an
observed vector-publication change still selects the original lexical result.
Before counting a hybrid horizon, the reader enters the existing synchronous
publication gate and rechecks vector evidence. Contention or changed evidence
selects lexical before counting. The gate spans only synchronous preparation,
counting and final validation; no provider/authority await or SQLite transaction
spans it. Valid publication cannot change during that pass. Unexpected evidence
damage still refuses `snapshot_stale`. The gate releases in `finally`, and the
existing supervised Worker-exit cleanup releases only that Worker's gate slot.
Both alternatives therefore use the same single assembly path: at most 24 bodies
and 16 receipts per body, `U <= 408`, and `2 + 2U + R <= 1,226` counter calls.
There is no second assembly, embedding or fusion after final authority reads.

Regression coverage includes B exhausting `maxRequests:1` followed by row
deletion, same-inode snapshot restoration and coordinator restart while B's
anchor remains; A must report `budget_denied` with zero additional sends. The
maximum-horizon fixture has 24 items and 16 short receipts each, all fitting,
with an independent actual counter-call total under every assembly policy.
Embedding-time republication still checks exact lexical delivery for both
`findCandidates` and `contextRead`. The former final-assembly republication case
now verifies publication exclusion and a valid hybrid delivery; additional cases
verify gate release after a throwing counter and actual Worker termination.

Default lexical code, serializer defaults, frozen contracts, WAL/native-lock
policy, generated runtime and raw-fd allowlist are unchanged. All providers,
prices, counters and credentials are synthetic; no network or keys are used.
No commit or staging operation is performed.


### Round 2 verification

The required inventory was derived from the handoff's explicit path tables and
independently expanded from filesystem test-family globs: **61 paths, zero
differences**. Each complete-file command uses the exact pinned Node version
first on PATH, offline npm mode and the managed process-group runner:

```sh
"$p2e_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 "$p2e_test"
```

An isolated `0f43acaf` archive received only the new tests and synthetic host
fixture changes. On **both Node 22.16.0 and 24.15.0**, the five defect probes
(row deletion, pre-enrollment snapshot restoration, restart, whole-policy
maximum receipts, coverage-policy maximum receipts) all fail: each baseline
command exits **1**, with **five failures and zero passes/skips**. Both counter
probes report **1,636 actual calls**. Baseline comparison wrappers exit **0**
after verifying the expected failures; no baseline runtime source was edited.

Two preliminary Node 22 baseline commands exited **1**, with four failures: the
initial snapshot fixture performed a preliminary denied refresh that advanced
A's coverage hint, accidentally testing A's rollback as well as B's omission.
Removing that operation isolates B's missing row; the final snapshot probe
fails on the baseline on both runtimes. The first matrix was deliberately
interrupted at the Node 22 assembly file to correct the fixture; that managed
command exited **143**, drained its process group, and was subsequently rerun.
Earlier completed paths were retained rather than rerun.

Focused Node 22 development commands exited **0**: nine race/missing-row/counter
cases and two gate-cleanup cases. All four changed JavaScript files pass
individual syntax checks on both versions: **eight actual exits 0**.


### Round 2 final per-path results

Both exact-version probes exit **0**. All **61 complete-file commands per runtime**
exit **0**, with **1,100 passing tests and zero skips on each runtime**.
The hosted-semantic file includes all eight added cases and passes **70/70**
on both versions. The managed matrix runner exits **0** and verifies that all
four JavaScript source hashes remain unchanged throughout the resumed matrix.

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
| `core/test/context-read-product-semantic-gates.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-product-semantic.test.mjs` | 0 (70) | 0 (70) |
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


### Round 2 changed files

Cross-checked Git diff/untracked enumeration against independent HEAD blob
hashes and filesystem enumeration: **5 files, zero differences**. Whitespace
and added-text local-path/private-dispatch checks exit **0**. No frozen
contract, generated runtime, dependency, artifact manifest or raw-fd allowlist
changes. No commit or staging operation.

- `core/context-product-index.mjs`
- `core/context-semantic-ledger.mjs`
- `core/test/context-read-product-semantic.test.mjs`
- `core/testing/context-semantic-host.mjs`
- `docs/plans/context-read-p2e-impl.md`

## Integration with sidecar format 2

Integrates approved P2e at `ea71baf4` with `origin/main` at `be5698fa` by
merge. The incoming changes include #493, #494, #495 and #486. No frozen
contract text is edited. The accepted format-2 handoff and all preceding P2e
report sections are preserved byte-for-byte; the format-3 revision is appended
to the handoff as `context-read-product-v1.1/sidecar-format-3-vectors-yield-v1`.

### Conflicts and semantic resolution

The merge command exited **1**, with exactly four content conflicts:

- `core/context-product-index.mjs`: combined P2e's semantic configuration,
  coordinator dispatch and single-horizon assembly with main's injected clock,
  storage test seam and original parent cutoff. Embedding refresh uses the same
  maintenance quantum as lexical refresh, starting before opening. Evidence
  materialization, asynchronous provider settlement and vector persistence share
  a doubled high-water work estimate. Provider admission ends before the shared
  reserve and original parent cutoff; integer USD accounting, captured prices,
  durable reservation/settlement and one-query limits remain independent.
- `core/context-product-sidecar.mjs`: retained main's compact integer layout,
  dictionary, WITHOUT ROWID tables, positive-key CHECKs, exact schema attestation,
  incremental vacuum, selection retention, verified cursors and bounded GC;
  incorporated P2e vector access and final lexical fencing. All hosts initialize
  one complete format-3 schema. No semantic-dependent schema exception remains.
- `core/context-product-worker.mjs`: retained P2e's awaited asynchronous dispatch
  and main's conversion of the immutable parent cutoff to the performance-clock
  domain. SQLite remains behind the existing Worker/lazy-import boundary.
- `core/test/context-read-product-artifact.test.mjs`: the exported closure is
  **99 modules**, combining the hosted P2e closure with shared quantum admission.
  The executable manifest/archive/installed-files cross-check remains intact.

The runtime archive arrived through the clean merge and was then regenerated
from source; no bundle bytes were hand-merged. The clean documentation merge was
reviewed and its obsolete optional-vector/automatic-upgrade guidance corrected.
The evaluation runner's pre-P2e test expected the public semantic API to be
absent. With P2e integrated, the existing sealed run correctly blocks instead on
`sealed_public_engine_host_binding_required`. Its assertion now checks that
reason plus unchanged unconfigured capabilities, zero observations and unrun
safety cells. The runner, sealed registration, safety gates and frozen fake
report are unchanged. The initial Node 22 `p2e-*` group exited **1** (35/36);
the complete corrected group is rerun below.

Layout-specific inherited assertions now expect format 3 and resolve opaque
vector IDs to integer storage keys before SQL access; their independent logical
manifest, HMAC, fusion and purge oracles are retained.

### Format-3 storage, lifecycle and verification

`PRAGMA user_version=3`, exact table/index SQL attestation, lexical and vector
validation `format:3`, and signed `{format:3,...sidecarIdentity}` progress bind
the new physical identity. Both lexical-only and configured semantic hosts
refuse deployed format-1/format-2 files during observation and maintenance,
without conversion or replacement. Wrong-store precedence and P2d's DELETE/WAL
repair, lock, native-admission and resource-drain rules remain intact. Rebuild
requires stopped admissions and clients, supervised drain, explicit quiescent
derived-cache discard, then independent maintenance of both intents. Canonical
storage and the lifecycle lock are retained.

Vector generations use integer `storage_id` and `lexical_generation` references
while certificates retain their opaque generation IDs and lexical binding.
Cached vectors and publication rows carry positive integer document keys;
cache reuse across intents resolves and validates the original document.
Format 2's constant document representation is reconstructed for vector tuples.
Owner purge deletes by integer keys without creating tombstone documents.

GC keeps main's protections for published lexical generations and active bases,
including its read-only candidate hint before entering a write transaction.
Owner-filtered slices delete at most 128 data rows: postings, documents and
statistics first, then cached vectors and vector publication rows. Vector rows
are removed before their matching validation/progress/generation metadata;
selection retirement invalidates its pointers atomically. Superseded vector
certificates on an otherwise current lexical generation are also collected.
Keyed pointer deletion cannot erase a replacement publication. Other owners,
intents and active selections remain protected.

Vector construction, ordered manifest verification and the independent physical
cache audit admit bounded pages and individual rows. Every processed row is
validated before its cursor/hash/count advances, and partial checkpoints commit
only completed rows. Initial scans have no lower-bound shortcut that could skip
a nonpositive key or empty malformed ordering key. Positive document domains,
exact keyed document references, revision/representation, canonical vector
bytes, sort keys and complete row counts are checked. BLOB reads are bounded to
the fixed 6,144-byte vector domain. The lexical `verifyPage` implementation is
byte-identical to main's three reviewed fix rounds.

### Regressions and verification evidence

The new `context-read-product-format3` suite covers refusal of both deployed
formats without semantic configuration, fake vector certification/ranking,
nonpositive CHECK enforcement, exact vector index SQL attestation, orphan and
nonpositive publication/cache rows,
130-item partial verification checkpoints, missing-payload count rejection,
orphan cache-origin generation rejection, retired/superseded vector GC and
other-intent preservation, and deterministic embedding quanta including open,
provider reserve, durable received vectors and later certification without
resending. The public hosted-semantic suite adds a fresh format-3 lexical build,
vector refresh, semantic read and one-item-slice owner purge with fake providers.

The format-3/artifact focused command on Node 22.16.0 exited **0**, **13 passing,
zero skips**. The focused public end-to-end and pooled owner-wide oracle command
exited **0**, **2 passing, zero skips**. Runtime generation and check on Node
24.15.0 each exited **0** (32 client files, 330 engine files).

Development evidence is retained honestly: the initial footprint/semantic run
exited **1** (105 pass, two failures): a stale rebuild assertion expected format
2, and one pooled-oracle query did not dispatch (the original assertion did not
capture its degradation reason). The rebuild assertion was updated; the diagnostic-enhanced complete pooled oracle passed
unchanged on its focused rerun. The first format-3-only run exited **1** because
its 130-item fixture populated only one 64-item provider batch; the fixture now
fills all batches. The next run exited **1** because the injected-clock planning
seam still compared the real performance clock; planning now uses the supplied
quantum clock. Its focused deterministic rerun exited **0**. No production
budget, timeout, golden output or provider policy was relaxed. One developmental
sizing run was intentionally stopped with **143** after final physical index
constraints changed, so sizing could restart against the final schema.

### Final footprint measurement

The unchanged `core/testing/measure-context-product-footprint.mjs` ran with
semantic configuration absent on **Node 24.15.0**, exit **0**. It built both
owner-wide intents over 1,642 Memories and 164 Cards in four namespaces.
Canonical allocation is **5,197,824 B**; sidecar allocation is **11,968,512 B**,
with **0 free bytes**, for **2.3026004728×** (≤5×). Current/history completed in
182/149 quanta; these are observations, not timing or throughput gates. Every
table/index/internal structure plus free space independently reconciles to the
page allocation, and recomputing the ratio from both byte totals exits **0**.
Complete structure bytes are appended as `integrationFormat3` to
`context-read-sidecar-footprint-measurements.json`; all seven earlier entries
are preserved unchanged.

Vector payload planning estimate: 1,536 float32 dimensions = **6,144 B/vector**.
A reusable cache plus one intent costs **12,288 raw B/embedded item**; two
immutable intent projections sharing the cache cost **18,432 raw B/item**.
These estimates exclude SQLite page/index/identity overhead, staging,
superseded generations and journals. Semantics-off sizing includes the complete
empty vector schema but no embedding payloads.

The first full Node 22 context run exposed an additional integration regression:
GC had dropped main's read-only candidate hint and opened an empty write batch,
triggering the unchanged `Fix2 repair refuses while an ordinary batch holds its
lock` assertion. The hint is restored and extended to vector candidates, with
both decisions rechecked under BEGIN IMMEDIATE. The focused GC/repair-lock
command exits **0**, **4 passing**; a complete Node 22 context rerun and affected
guard/adapter groups validate the final implementation. No journal assertion or
lock policy is weakened.

The same initial context run also logged `read_timeout` in the existing
off-owner pump probe, whose quanta are 500 ms. Its unchanged focused rerun exits
**0**, one passing case; the complete final context runs remain the acceptance
evidence. No timeout, budget or timing threshold was changed.

### Required commands and actual exit codes

Both runtime binaries were invoked by explicit absolute path and checked with
`--version`: **v22.16.0 / v24.15.0**, probe exits **0 / 0**. `$NODE22` and
`$NODE24` below denote those exact binaries, with each runtime's npm toolchain
first on PATH and offline mode enforced. Adapter and tokenizer dependencies
were already available; no dependency installation or lockfile edit was needed.

```sh
"$NODE22" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 <expanded files>
"$NODE24" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 <expanded files>
```

Glob expansion and independent directory enumeration agree on **68 required
files, zero differences**. Table globs abbreviate the actual explicit argument
arrays. Child return codes were captured directly, without a stdout pipeline.

| Expanded files | Files | Node 22.16.0 exit (pass) | Node 24.15.0 exit (pass) |
| --- | ---: | ---: | ---: |
| `core/test/context-read*.test.mjs` | 37 | 0 (794) | 0 (794) |
| `core/test/topic-*.test.mjs` | 17 | 0 (238) | 0 (238) |
| `core/test/no-raw-db-fd.test.mjs + sqlite-lock-safety.test.mjs + sqlite-journal-probe.test.mjs` | 3 | 0 (44) | 0 (44) |
| `adapters/mcp/test/context-read*.test.mjs` | 6 | 0 (97) | 0 (97) |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 (3) | 0 (3) |
| `tools/testing/p2e-*.test.mjs` | 4 | 0 (36) | 0 (36) |

Every final required group has **zero failures, cancellations and skips**:
**1212 / 1212 passing tests** across the required union.
The final format-3 file has **15 passing cases** on both runtimes, included in
these context totals. Its complete-file Node 22 rerun also exited **0**, 15/15.

The first full Node 22 context command exited **1** (791 pass, two failures):
the empty-GC-batch lock regression and the 500 ms off-owner pump timeout recorded
above. The complete context rerun exits **0**. Its final guard and adapter groups
were also rerun, exits **0 / 0**. The initial Node 22 evaluation group exited
**1** (35/36); its corrected complete-file group exits **0** on both runtimes.
Earlier nonzero development exits are preserved above rather than relabeled.

Other final commands/checks:

| Command/check | Runtime | Actual exit |
| --- | --- | ---: |
| `git merge origin/main` | Git | 1 (four conflicts, resolved) |
| `node core/testing/measure-context-product-footprint.mjs` through the managed script runner | 24.15.0 | 0 |
| Independent structure/page/ratio reconciliation | Python | 0 |
| `node packages/setup/build-runtime.mjs` | 24.15.0 | 0 |
| `node packages/setup/build-runtime.mjs --check` | 24.15.0 | 0 |
| Individual `node --check` on all 13 changed JavaScript files | 22.16.0 + 24.15.0 | 26 exits 0 |
| `git diff --check` | Git | 0 |

The final regenerated bundle is checked after this report is complete, so its
included report copy agrees with the source. Independent manifest/filesystem
and manifest/tar inventories agree on **32 client / 330 engine files**, zero
differences; the archive SHA-256 matches its manifest. There was no hand merge
of generated content. The lexical deep verifier and both accepted report/note
prefixes are independently byte-compared and preserved. Final fingerprints cover
**1,532 JavaScript modules**. No canonical migration, external provider traffic, keys,
timing threshold change or raw-fd allowlist change was introduced by the
resolution. All supervised verification completes and drains before handoff.

### Changed files of the resolution

Relative to the automatic merge tree `ec93fe5bf870676487f4bb29bcc940a79469e618`,
`git diff --name-only` plus nonignored untracked enumeration is compared with
independent Git tree/blob hashes and `rg --files --hidden` filesystem enumeration:
**19 files, zero differences**, cross-check exit **0**. Incoming clean changes
from main remain part of the merge; this inventory identifies the resolution
and integration edits. The four original conflict paths are independently
recovered from conflict markers in that automatic merge tree.

- `core/context-product-index.mjs`
- `core/context-product-quantum.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-validation.mjs`
- `core/context-product-vectors.mjs`
- `core/context-product-worker.mjs`
- `core/context-semantic-maintenance.mjs`
- `core/context-vector-validation.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-footprint.test.mjs`
- `core/test/context-read-product-format3.test.mjs`
- `core/test/context-read-product-semantic.test.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2e-impl.md`
- `docs/plans/context-read-sidecar-footprint-measurements.json`
- `docs/plans/context-read-sidecar-footprint.md`
- `packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz`
- `packages/setup/runtime/engine/manifest.json`
- `tools/testing/p2e-eval.test.mjs`

## Integration fix round 1

The embedding planner now uses the lexical scan/first-row admission rule. It
retains an authenticated stream/key cursor and an exact pending document probe
in the existing vector work checkpoint. A quantum that cannot dispatch after
planning commits that planning progress; the next quantum resumes the pending
unit without repeating the expensive scan. Received vectors and their planning
cursor commit together. New vectors invalidate staged verification while
preserving planning progress; the existing bounded collector reclaims obsolete
staging. Once planning is exhausted, later quanta proceed directly to resumable
certification, so a scan estimate cannot permanently bar certification.

Planning releases its read snapshot before checkpoint writes or provider work.
The existing native transactions, publication/fence checks, semantic gate,
provider cutoff/reserve, lock order and WAL policy remain in force. No host callback,
provider operation or await was added inside a transaction. The public contract,
lexical implementation and semantic-off result assembly are unchanged.

All lexical and vector ID-to-storage-key lookups in the vector module now use a
checked resolver. A missing key yields recoverable `index_unavailable` before
SQLite binding. Planning, insertion and certification also check that the
captured lexical publication is still current. Cached origins still require an
exact published lexical document reference; loaded vector pages still validate
all document bindings. Collected and retired generations cannot supply new
vector evidence or terminate an otherwise usable maintainer.

Purge metadata selection now orders by `storage_id`, matching the existing
`vector_generation_owner(owner,storage_id)` index. The regression executes the
captured production statement with SQLite's instruction callback: both 1,000
and 19,000 empty generations return 128 rows in **2,058 VM instructions**.

The nine added regression cases cover deterministic 1,000 ms quanta with a
600 ms opening and 250 ms planning/verification scans, strictly increasing
committed progress across handle recreation and eventual certification;
collected/retired captured generations in planning, insertion and certification;
the public maintainer's recovery after competing collection; and bounded purge
metadata VM work. Progress assertions compare actual cache/cursor/verification
state, excluding checkpoint-only increments and random IDs. No wall-clock
threshold, external provider, credential or network service is used.

The focused new-regression command on Node 22.16.0 exits **0**, **9/9 passing**.
The same regression sources applied to untouched `e0822184` exit **1** on
Node 22.16.0 and 24.15.0 as expected: embedding progress repeats without advancing, collection returns
`reader_failed`, and purge work grows from **21,268 to 399,268 VM instructions**.
The different purge baseline totals reflect deliberately reversed ID order;
the fixed production query has identical work at both sizes.

The initial Node 22 context group exits **1**: **802/803 passing**, one bare
`read_timeout` in the existing daily-cap/UTC-rollover embedding refresh test.
Its unchanged focused rerun exits **0** (1/1), and the complete unchanged
`context-read-product-semantic.test.mjs` rerun exits **0** (72/72). These outcomes
are reported separately; the initial group exit is not relabeled. No deadline,
budget, timing assertion, fixture corpus or production policy was relaxed.

Development-only focused attempts also exited **1** while unconditional planning
writes introduced extra connection-opening work. The final planner uses a
read snapshot for planning and persists separately when dispatch cannot proceed;
successful dispatch commits planning with received vectors. An initial public
race fixture retry encountered its shared publication/provider fault slot; the
new test clears that synthetic fault selector before invoking embeddings.
Existing tests and assertions remain unchanged.

### Required commands and actual exits

Both exact runtime probes exit **0**, reporting **v22.16.0 / v24.15.0**.
Commands used each runtime’s executable and toolchain with npm offline mode:

```sh
"$NODE22" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 <expanded paths>
"$NODE24" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 <expanded paths>
```

Glob expansion and independent directory/`rg --files` enumeration agree on
**68 required files, zero differences**. Counts include the nine new cases.

| Expanded group | Files | Node 22.16.0 exit (passed/total) | Node 24.15.0 exit (passed/total) |
| --- | ---: | ---: | ---: |
| `core/test/context-read*.test.mjs` | 37 | 1 (802/803) | 0 (803/803) |
| `core/test/topic-*.test.mjs` | 17 | 0 (238/238) | 0 (238/238) |
| Raw-fd, SQLite lock-safety and journal-probe guards | 3 | 0 (44/44) | 0 (44/44) |
| `adapters/mcp/test/context-read*.test.mjs` | 6 | 0 (97/97) | 0 (97/97) |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | 0 (3/3) | 0 (3/3) |
| `tools/testing/p2e-*.test.mjs` | 4 | 0 (36/36) | 0 (36/36) |

The initial Node 22 context exit **1** is retained above. Its only failing
case passes in both the unchanged focused rerun (exit **0**, 1/1) and the
unchanged complete semantic-file rerun (exit **0**, 72/72), as recorded above.
Every required case has passed on both runtimes across these recorded runs;
the required union contains **1,221 cases per runtime**, with zero skips or
cancellations. All nine new regression cases pass on both runtimes.

Individual syntax checks on all four changed JavaScript files exit **0** on
both runtimes: **8 commands, 8 exits 0**. Bundle generation and `--check` on
Node 24.15.0 each exit **0**, with **32 client / 330 engine files**. The bundle
is regenerated and checked again after this report is complete.

The changed-path inventory independently compares Git diff/untracked output
with baseline-tree blob hashes, filesystem bytes and an ignore-aware file walk:
**7 paths, zero differences**. Client manifest/filesystem and engine
manifest/archive/source-byte inventories independently agree at **32 / 330
files**, zero differences; the archive SHA-256 matches its manifest. All
generated content comes from the runtime builder. No commit was created.
