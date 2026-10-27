# Context-read P2c implementation handoff

Implemented on `feat/context-read-p2c`, base `9a8f6fb7`, without staging or
committing. The frozen `context-read-product-v1.1` and unified-memory contracts
are unchanged. This package supplies C-2 on the existing DELETE path: one owner,
at most one personal namespace and 31 projects, explicit overflow coverage,
pooled ranking and maintained active selections. Production v18 remains
Memory-only. Physical v23/current-v33 mixed retrieval is tested separately.

## Design

`contextReadSet` and `contextInput` accept the explicit product profile. Parent
admission, request/service issuance, Worker facade input, product sidecar input,
and stable digest construction use that profile-aware validation. The facade
and independent product storage boundary validate before storage work. Selected
arrays and namespaces reject accessors, proxies, sparse entries, hidden/symbol
fields, duplicates, mixed owners, 33 entries and 32 project-only entries. The
frozen v1 sidecar and the default validator retain their one/two-scope grammar.
Canonical UTF-8 namespace-key ordering preserves previous compact indices.
Fences, stream construction, progress and certificates already used general
arrays/digests in P2b; they now receive the full validated selection.

The new pure host utility `selectContextProductNamespaces` implements
`recent-projects-v1` over ACL-filtered `{namespace,lastActiveAt?}` records. It
retains requested personal scope and only the best 31 projects, ordering by
descending safe nonnegative epoch milliseconds and ascending UTF-8 project ID
bytes. Missing activity is zero; explicit invalid activity refuses. The
utility retains 31 winners while scanning, rather than sorting an entire heavy
inventory. Its inventory scan and duplicate detection belong in host background
work, never HTTP admission. The host owns inventory/ACL/current activity and a
nonempty well-formed selection revision of at most 200 UTF-16 units.

The engine receives only the selected list and the exact closed `ownerCoverage`
descriptor. Counts must be safe, nonnegative and arithmetically consistent;
overflow requires 31 selected projects. The host verifies membership against
its inventory. The engine never enumerates or reads omitted namespaces. Ready
scope-overflow reads have partial coverage, including empty selected matches.
Candidate/assembly traces add exactly `namespaceSelection:{...ownerCoverage}`
on overflow, including authorized unavailable diagnostics. Status retains its
closed namespaces descriptor. Exact evidence and metered v2 text gain no fields.

Ranking extends the P2b storage path and the existing shared T1/BM25 and fusion
modules; there is no forked scorer or namespace fusion. Every eligible document
contributes to pooled N, total token length and df. Every match is scored before
one global top-24 retention, with canonical tuple ties. Disabled semantics
preserve global BM25 order. The shared `fuseCandidates` seam still consumes one
global lexical and one complete semantic list with the frozen `rrf-k60-d12` /
`rrf-k10` arithmetic. Product semantics remain disabled; lexical, semantic-flag,
continuation, fetch, status, pump and maintenance checks make zero provider calls.
The complete-semantic/vector-gap arithmetic tests use synthetic global lists;
no enabled product semantic/provider implementation is claimed in P2c.

Stable access/projection digests independently normalize selections. Request,
handle, service issuance and selectionRevision never enter lexical statistics
identity. Tests verify independently constructed four-scope digest bytes,
authenticated pooled statistics and reuse across fresh issuance/revision changes.
Changing membership requires a new handle/mapping and its own matching prebuilt
projection. A maintained subset or previous selection cannot authorize it.
Unbuilt combinations return unavailable, without silent type/scope downgrade.

The P2b pump normalizes and validates each active selection at admission. Its
renewal fingerprint now includes the exact coverage descriptor, so a changed
revision cannot retain old handle coverage. Close/drain the old pump and supply
a new service binding/handle for a changed selection; cumulative domain charges
remain intact. Mock scheduling exercises actual four- and 32-scope maintainer
prebuilds of both intents. Existing mock multi-selection round-robin tests cover
concurrent registered selection scheduling and quota/renewal ownership.

No runtime file-touching path, raw SQLite descriptor operation, allowlist entry,
provider, canonical write/migration or WAL policy is added. SQLite-reaching
imports remain behind the established dynamic Worker boundary. The new selector
is SQLite-free and consumes no import-time entropy. The adapter guide documents
host metadata, coverage, mapping lifetime and active-selection prebuild.

## Deterministic acceptance mapping

Names below are paths under `core/test` unless an adapter/packaging path is
specified. Inherited coverage is distinguished from P2c additions; deferred
portions are not claimed complete by a narrower test.

| §9 row | Tests and scope |
| --- | --- |
| P2-01 | `context-read-default-entropy.test.mjs`, `context-read-product.test.mjs`; adapter entropy and `adapters/mcp/test/context-read-sources.test.mjs` C06 pinned bytes. Legacy assertions stay unchanged; only the product capability maximum changes to 32. |
| P2-02 | `context-read-product-artifact.test.mjs`, `context-read-product-import.test.mjs`, inherited real Worker/counter tests. Installed four-scope mixed build/read/assembly/fetch and selector run without source fallback. |
| P2-03 | Inherited `context-read-product-control.test.mjs` cutoff, abort, crash, idle, termination and cleanup rendezvous. No timing acceptance claimed. |
| P2-04 | Inherited `context-read-product.test.mjs` and `context-read-product-index.test.mjs` physical v18, old-pin, sidecar-only build and preservation cases. WAL qualification remains P2d. |
| P2-05 | New `context-read-product-owner.test.mjs` pooled mixed gates on physical v23/v33; inherited product physical-version/capability refusals. |
| P2-06 | New owner tests: one/four/32 success and namespace-31 compact/snapshot round trip; raw 33/duplicates/mixed owners/accessors refuse before Worker/storage; personal+32 authorized inventory gives exact personal+31 selection; missing/tied activity, ACL-filtered inventory, revision and permutations. Omitted/foreign data cannot alter selected statistics/ranks. Existing product/control tests cover entry/final denial. |
| P2-07 | New owner independent corpus/oracle: manually frozen Chinese/English/Japanese tokens, pooled N/df/length, exact BM25 scores/global ranks, canonical ties, equal bodies, current/history eligibility, permutations, 30 dominant personal matches before top-24, and a separate actual-engine single-Han known miss. Shared global-list RRF oracle checks both existing presets and incomplete-semantic lexical fallback. Enabled product semantic/provider acceptance belongs to P2e. |
| P2-08 | Inherited index ready-only/deep-scan/write traps; new selection-change and overflow unavailable cases. Evidence remains usable independently of an index. |
| P2-09 | Inherited index checkpoint/durability/publication tests; new owner matching-selection prebuild and actual pump current/history prebuild under mock scheduling. |
| P2-10 | Product DELETE/WAL refusal tests and both SQLite lock guards run. Canonical/sidecar WAL cross-product, wait policy and contention qualification remain P2d. |
| P2-11 | New `context-read-product-owner-evidence.test.mjs`: independent byte-exact v2 serialization/fence HMAC oracle with concrete receipts, sameAsBody and cross-namespace backward aliases, four-scope compact/full/mixed/snapshot round trips over IPC, and 13 mutation kinds × two intents × all four namespace positions. Pins revisions, eligibility, generations, receipt/support/applicability loss, edits and parent-only path differences; inherited assembly races remain covered. |
| P2-12 | New owner/evidence/pump fake provider counters stay zero, including semantic flags and continuation; inherited index disabled embeddings/lexical maintenance tests. Enabled provider budgets and shared child ownership remain P2e. |
| P2-13 | Extended product artifact test: offline manifest-only archive, independent source/installed runtime closure, byte equality, actual installed mixed four-scope Worker/counter, selector and cleanup. Required installed raw29 packaging test also runs. |
| P2-14 | Inherited product/control/index currentness rendezvous and two-sample tests. Widened bindings still use one request snapshot, without per-namespace authority vectors. |
| P2-15 | New owner independent digest known answers, pooled certificates, fresh request/revision reuse and changed-selection refusal; inherited index certificate corruption, file identity, ownerGeneration and handoff tests. |
| P2-16 | Inherited product/control/service/index failed-open, quarantine and confirmed disposal tests. |
| P2-17 | Inherited control BUSY/cutoff, incomplete telemetry and failed-drain tests; independent writer telemetry is deferred to P2d. |
| P2-18 | New exact selected/overflow ready and absent status goldens, partial empty search and candidate/assembly traces. Inherited index closed-state reasons/progress/crash/reopen goldens remain unchanged. |
| P2-19 | Performance protocol population/exposure harness is deferred to P2d; no latency or synthetic population acceptance is claimed by P2c's functional tests. |
| P2-20 | Inherited index restore/copied-cache/rebuild tests run. Product stopped-client/fallback integration and WAL restore qualification remain product/P2d work. |
| P2-21 | Inherited index DELETE publication-race/no-op/timeout cases run. The WAL race variant remains P2d. |
| P2-22 | Inherited product/control/service/index request replay and independent service credential tests run. |
| P2-23 | Independently observed ordinary writer provenance/drain acceptance remains P2d; product native-reader telemetry tests do not substitute for it. |
| P2-24 | Inherited control 10,000-operation history/expiry/quarantine tests run. |
| P2-25 | Inherited product/control/index optional ownerGeneration entry/final/stable certificate tests run; no generation is synthesized. |
| P2-26 | Inherited product/control/index synchronous adapter and exact sample-count tests run; new mixed evidence still uses the same final-read path. Private product checklist sign-off remains product-owned. |
| P2-27 | Inherited index/control diagnostic-error revocation and parent-discard tests run. New overflow error trace assertions preserve the existing final-envelope guard. |
| P2-28 | Inherited control parent admission/expiry/domain/binding mock-clock tests run. |
| P2-29 | Inherited control cumulative opening/call/page/error cutoff tests run. No request deadline is renewed by namespace selection. |

## Deferred items and product inputs

P2d owns canonical/sidecar WAL policy and full deployment qualification,
including native writer provenance, latency/host-loop/freshness/availability,
backup/restore timings and sidecar size at the required world sizes. Product
capabilities continue to advertise DELETE only; sidecar WAL remains refused as
`index_unavailable`. No partial WAL support is claimed.

P2e owns explicit product semantic enablement, certified vector/provider work
and the shared provider-budget/child coordinator. Existing presets/tokenizer/
representation are unchanged. P2c constructs no provider and performs no
inference. Shared semantic-list arithmetic tests are not product semantic
coverage or provider-call acceptance.

The product must supply ACL-filtered activity/inventory snapshots and revisions,
cache/compute selection outside HTTP callbacks, maintain active exact
projections, record churn, configure and qualify service quotas, observe pump
completion, persist charges across restarts, keep diagnostic/snapshot metadata
outside model text, and reauthenticate partial fallback. Erase/restore still
requires stopped clients and confirmed drain. The two deliberately forged
in-process caller hardening cases documented in the P2a/P2b reports are unchanged.

## Verification

The required test inventory was independently derived by filesystem glob and
`rg --files` predicates: **53 explicit paths**, zero differences. Each path ran
separately and sequentially, using the exact nvm-installed Node **22.16.0** and
**24.15.0** binaries with that binary's directory first in PATH. Both exact
binary `--version` checks exited **0**. Direct binary selection avoids the
shell's separate `node` shim, which does not follow `nvm use`.

Invocation for every ordinary table row (with each path supplied literally):

```sh
p2c_node="$NVM_DIR/versions/node/v$version/bin/node"
PATH="$(dirname "$p2c_node"):$PATH" "$p2c_node" --test --test-reporter=tap "$test_path"
```

Each subprocess return code was captured directly. TAP totals were parsed
independently and checked for equal test/pass counts and zero failed,
cancelled, skipped or todo tests. **Both complete matrices exited 0: 844/844
tests per runtime, all 106 per-file process exits 0.** No broad suite,
measurement gate, network/key/model operation or setup-runtime regeneration ran.

Adapter dependencies were absent initially. `npm ci --offline --ignore-scripts
--no-audit --no-fund` ran separately for the MCP and OpenAI adapters, both
**exit 0**, after checking their node_modules paths were absent, not shared
symlinks. Only cached lockfile payloads were needed. Install/cache writes stayed
inside this worktree or the owned temporary verification directory.

The installed raw29 row additionally used
`--import "$P2C_VERIFY/npm-cache-only.mjs"`. This temporary test-only preload
forwards only `npm_config_cache` into packaging's sanitized npm subprocess
environment, keeping cache/log writes in the owned temporary directory. It
changes no product source, inputs, assertions, or non-npm children. Its complete
source was:

```js
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  if (command === 'npm') options = { ...options, env: {
    ...options.env, npm_config_cache: new URL('.', import.meta.url).pathname
  } };
  return Reflect.apply(spawnSync, this, [command, args, options]);
};
syncBuiltinESMExports();
```

| Explicit path (`--test --test-reporter=tap`) | Node 22.16.0 exit / passed | Node 24.15.0 exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
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
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `adapters/mcp/test/context-read-product-owner-evidence.test.mjs` | 0 / 27 | 0 / 27 |
| `core/test/context-read-product-owner.test.mjs` | 0 / 11 | 0 / 11 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 17 | 0 / 17 |
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

Development failures are retained separately from the passing matrices:

- The initial combined new-evidence/pump invocation exited **1**: evidence
  could not import the not-yet-installed `zod`, and the first native pump
  fixture exhausted its cold opening/operation cutoff. Offline dependency
  installation resolved the import failure.
- Two isolated developing two-selection pump cases exited **1** with actual
  `read_timeout` at 1,000/1,250-ms quanta. The functional fixture now explicitly
  activates each selection separately with the existing allowed 2,500-ms
  quantum; multi-selection round-robin remains independently tested under mock
  scheduling. This does not qualify cold multi-selection capacity or weaken
  production cutoff/cadence rules. That capacity remains a deployment gate.
- Development full owner/evidence/artifact files then exited **0**. A filtered
  Node 22 byte-oracle check after adding concrete/backward-alias receipts and a
  filtered selected-grammar check after guarding the internal readSet descriptor
  each exited **0**. They supplement, rather than replace, the full-file runs.

After the internal readSet descriptor guard, concrete/backward-alias receipt
fixture and explicit namespace-31 round trip were finalized, these full files
were rerun by the same explicit-path command. Every actual exit was **0**:

| Final rerun path | Runtime | Actual exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 22.16.0 | 0 / 1 |
| `adapters/mcp/test/context-read-sources.test.mjs` | 22.16.0 | 0 / 4 |
| `core/test/context-read-default-entropy.test.mjs` | 22.16.0 | 0 / 1 |
| `core/test/context-read-product-index.test.mjs` | 22.16.0 | 0 / 65 |
| `adapters/mcp/test/context-read-product-owner-evidence.test.mjs` | 22.16.0 | 0 / 27 |
| `core/test/context-read-product-owner.test.mjs` | 22.16.0 | 0 / 11 |
| `core/test/context-read-product-pump.test.mjs` | 22.16.0 | 0 / 17 |
| `core/test/context-read-product.test.mjs` | 22.16.0 | 0 / 126 |
| `core/test/no-raw-db-fd.test.mjs` | 22.16.0 | 0 / 5 |
| `core/test/sqlite-lock-safety.test.mjs` | 22.16.0 | 0 / 16 |
| `core/test/context-read-product-owner.test.mjs` | 24.15.0 | 0 / 11 |

The first final-report archive rerun on Node 22 exited **1** with
`read_timeout` during the installed maintainer's 5,000-ms mixed refresh
(`context-read-product-artifact.test.mjs:85`). Its manifest/archive bytes and
87/87 runtime closure checks had already passed. The functional runtime and
test deadlines were unchanged; earlier full artifact invocations on both
runtimes exited 0. This failure is retained independently of the isolated
follow-up artifact results below; no load-related cause is asserted from the
error alone.

These reruns do not inflate the 844-test per-runtime inventory above. The final
product artifact file also ran again on both runtimes after this report was
completed: **exit 0 / 1 test each**, manifest/archive **308/308**, independent
runtime/Worker closure **87/87**, static SQLite-free closure **23**, tar pack
and unpack **exit 0**. This final archive check covers the completed shipped
report and adapter guide bytes as well as the final runtime.

All **18 changed JavaScript paths** passed `node --check` separately on each
runtime: **36 actual exits 0**. Final `git diff --check` and an independent
trailing-whitespace/final-newline scan, including untracked files, each exited
**0** over all **21 files**. Added text contains no private local absolute
paths. The file inventory was re-derived and still matches both routes.
The frozen product/unified contracts, default v1 sidecar, generated setup
runtime and raw-fd allowlist have empty diffs (**exit 0**). The index is unchanged
and HEAD remains `9a8f6fb7`; no commit was made. Test/verification processes
completed and the owned temporary verification directory was removed after
recording results. No unattended task or supervision promise remains.

## Changed files and packaging

The changed-file list was derived from `git diff --name-only -z HEAD` plus
`git ls-files --others --exclude-standard -z`, then independently from
`git status --porcelain=v1 -z`. Sorted sets match: **21 files**, zero
differences. The check includes the new report, docs, fixtures and packaging.
No scripts, public assets or configuration changes are omitted.

The artifact manifest retains its existing order and adds exactly one runtime
module and this shipped report: **308 entries**, from 306. The pinned
product runtime/Worker closure grows from **86 to 87** solely for the host
selector. The static reader/supervisor closure remains **23** SQLite-free
modules. The artifact test now compares its source regex walk with the separate
installed import-graph parser, and compares manifest entries with a filesystem
walk and each shipped byte. The independent installed graph also covers the
fixed Worker and child entries. The capability assertion changes only the
product maximum from 2 to 32; legacy capability/wire assertions are untouched.

- `core/context-product-control.mjs`
- `core/context-product-index.mjs`
- `core/context-product-pump.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-selection.mjs`
- `core/context-product-service.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-validation.mjs`
- `core/context-product-worker.mjs`
- `core/context-read-facade.mjs`
- `core/context-read-input.mjs`
- `core/index.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `adapters/mcp/test/context-read-product-owner-evidence.test.mjs`
- `core/test/context-read-product-owner.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/testing/context-product-owner-fixture.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2c-impl.md`
- `packaging/artifact-files.json`

## Fix round 1

Changes are relative to `d23649a6` on `feat/context-read-p2c`; nothing is
committed. Both review documents were read in full. The two runtime findings
are fixed, and the two acceptance gaps now have deterministic product coverage.

### Findings, fixes and regressions

1. **Pump renewal identity.** `context-product-pump.mjs` now passes the validated
   `ownerCoverage` descriptor through the established `canonicalJson` helper
   before incorporating it into the renewal fingerprint. No new canonicalizer
   or SQLite import was added. The new pump regression reverses every descriptor
   property's insertion order and requires the same pump object, one timer and
   no opened handle. A changed revision and a different active selection still
   refuse `read_in_progress`.
2. **Unbounded multi-term enumeration.** The product sidecar now enumerates each
   query term through `INDEXED BY product_term`, with equality on generation and
   term, an identity keyset cursor, and `LIMIT 128`. Each native enumeration
   visits at most 128 matching postings, with no join, grouping or sorting scan.
   Missing terms perform one index probe each, independent of the total posting
   population. Eligibility and document reads follow the bounded page. A document
   is scored only on its first matching query term, retaining the original query
   term order, pooled statistics, BM25 arithmetic, canonical ties and global
   top-24 horizon. Memory holds one posting page and the winning identities.
   The one/two-namespace P2b product path used the same defective statement and
   receives the same fix. The frozen v1 sidecar already checks keyed term df
   before its per-term enumeration, skipping absent terms; it is unchanged. New one-, two-
   and 32-namespace regressions inspect `EXPLAIN QUERY PLAN` for the actual
   production statements: exact generation/term/identity index constraints,
   no scan or temporary B-tree, two probes for two absent terms, bounded pages,
   pagination beyond 128 matches, unique winners and exact matched counts.
3. **P2-18 overflow lifecycle acceptance.** The new
   `context-read-product-overflow-status.test.mjs` supplies full status goldens
   for selected/omitted counts 32/0 and 32/1, including 33/32/1 requested/selected/
   omitted on overflow. It covers every enabled lexical state and reason:
   absent/missing; building/initial_build and rebuild; ready; stale/access_changed,
   dependency_changed and fence_changed; catching_up/resume_pending; and all six
   unavailable reasons. Every golden pins disabled/not_enabled semantics,
   freshness, coverage, nullability and namespace counts. Reason precedence
   includes simultaneous access/dependency/canonical mismatches, format/store/
   validation failures ahead of stale scope, and a missing publication certificate
   ahead of otherwise valid rebuild progress. Native corruption and I/O failures
   use deterministic statement faults rather than raw database file access.
   Initial and delta builds crash the actual product Worker immediately after
   checkpoint 1 commits. The delta contains exactly one newly transformed
   selected document. Two fresh reader reopenings require the same authenticated
   `catching_up/resume_pending` progress, unavailable/stale coverage, null counts
   and unchanged namespace descriptor. Closed handles return only `store_closed`.
4. **P2-11 assembly mutation acceptance.** The test host now optionally supplies
   a SharedArrayBuffer rendezvous in its counter inside the actual product
   Worker. The parent waits for that counter, commits an independent SQLite
   mutation, then releases counting. No production test hook or legacy facade
   path was added. Six fourth-namespace races cover Memory receipt deletion,
   revision change, eligibility loss and a parent-only move, plus Card revision
   and support loss. Same-epoch mutations reach the final evidence refetch;
   every in-flight mismatch refuses exactly `snapshot_stale` with no prepared
   text. Subsequent compact fetches retain their separate frozen error classes;
   parent-only moves preserve compact evidence and invalidate snapshots.
   Instrumentation verifies counting outside transactions, no authority/counter
   callback after final evidence reading, and a queued microtask running only
   after synchronous final revalidation. A successful four-namespace case pins
   four final evidence reads and exact counter-call accounting, then checks that
   a later mutation leaves delivered text intact while invalidating refetch.

The Worker SQL fixture adds a checkpoint-number crash trigger, preserving its
existing first-checkpoint and precommit crash modes. Test host SQLite access is
still a dynamic import, enabled only for the assembly rendezvous. There are no
new runtime modules, file-touching paths, raw descriptors, allowlist entries,
provider calls, schema changes or dependency installs. Existing installed
closure checks continue to cover the same runtime module set.

### Baseline evidence

Before changing either runtime module, the new pump and term-plan regressions
ran against `d23649a6` on both required runtimes:

```sh
"$p2c_node" --test --test-name-pattern='P2c fix1' \
  core/test/context-read-product-pump.test.mjs \
  core/test/context-read-product-owner.test.mjs
```

**Node 22.16.0: exit 1, four failures. Node 24.15.0: exit 1, four failures.**
The pump fails with `read_in_progress`. All three query-plan cases show
`sqlite_autoindex_postings_1 (generation=? AND identity>?)`, without a term
constraint. The later page-count assertion strengthens the same regression.

The two spec findings are missing acceptance tests, not demonstrated runtime
failures. For those, a separate coverage check extracted the original owner and
evidence test files with `git show d23649a6:<path>` into an owned temporary
fixture, preserving their imports against the source tree. It selected the new
P2-18/P2-11 case families and required respectively 16 and seven named TAP
subtests. Both original files contain **zero** such cases: the Node subprocess
exits 0, while the explicit nonempty/completeness audit exits **1** for each
family on each runtime. This is a failing coverage check, not a claim that the
previous runtime returned incorrect status or assembly bytes. Its predicate is:

```python
count = len(re.findall(r'^# Subtest: ' + pattern, stdout, re.M))
coverage_exit = int(node_exit != 0 or count < required)
```

Patterns are `P2c fix1 P2-18` and `P2c fix1 P2-11`; required counts are 16 and 7.
The final full-file invocations below execute those previously absent cases.

Development invocations also exited 1 while fixing test fixtures: required MCP
intent fields were initially omitted, a deletion fixture violated the canonical
content/null constraint, and initial checkpoint/rebuild/Card-stream expectations
were incorrect. These were fixture/expectation failures. The final goldens use
independently specified checkpoint values and actual committed rendezvous;
Card-only canonical invalidation advances the existing Card epoch. Local
prebuild helpers explicitly finish publication before testing its invalidation,
so a maintenance quantum's wall-clock cutoff cannot fabricate a test failure.

### Fix-round verification

The explicit path inventory was independently derived by filesystem glob and
`rg --files` predicates: **54 paths, zero differences**. Each path is invoked
separately and sequentially on exact nvm binaries for Node 22.16.0 and 24.15.0,
with that binary's directory first in PATH:

```sh
p2c_node="$NVM_DIR/versions/node/v$version/bin/node"
PATH="$(dirname "$p2c_node"):$PATH" "$p2c_node" --test --test-reporter=tap "$test_path"
```

The raw29 installed-artifact invocation additionally uses a temporary npm cache
preload, extended with the notifier/network controls described below. Four exact production tarballs were
copied from the existing cache into an owned temporary cache; npm remains
`--offline`. Temporary/cache/artifact writes stay in owned directories. Every
subprocess exit code is captured directly and TAP totals are checked separately.

The first matrix attempt stopped with **exit 1** at the owner file: 13/14 tests
passed, and the inherited 32-namespace service prebuild returned `read_timeout`
at the existing 5,000-ms cutoff before lookup. The three new term-plan cases
and both physical-version P2-07 oracle cases passed in that invocation. An
isolated unchanged 32-namespace rerun exited **0** (1/1); no deadline, budget or
assertion was relaxed. Only the failed owner file and remaining paths were
resumed; already passing files were retained.


The first installed raw29 invocation also exited **1** (0/3), before runtime
execution: copying tarballs alone omitted npm's cached package metadata, so the
offline install returned `ENOTCACHED`. Four existing metadata cache indexes and
seven referenced content entries were then copied into the owned temporary
cache; no dependency version or test assertion changed.

**Network exception:** the initial `npm pack --offline` unexpectedly ran npm's
separate update notifier. Its debug log records one successful registry GET for
npm's public version metadata and an update banner. This violated the task's
no-network instruction; it was not a product/provider call, and the sanitized
npm environment contained no keys or user npm configuration. Subsequent npm
subprocesses explicitly set `npm_config_update_notifier=false` and load a
temporary guard that throws before socket connection, TLS connection, datagram
creation or DNS lookup. The preload still forwards only temporary cache and
verification controls into npm; product source, test assertions and runtime
children are unchanged. The passing installed runs below use this guard.

The final npm preload's complete mutation is limited to this subprocess:

```js
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  if (command === 'npm') options = { ...options, env: {
    ...options.env,
    npm_config_cache: new URL('./npm-cache', import.meta.url).pathname,
    npm_config_update_notifier: 'false',
    NODE_OPTIONS: '--import=' + new URL('./no-network.mjs', import.meta.url).href
  } };
  return Reflect.apply(spawnSync, this, [command, args, options]);
};
syncBuiltinESMExports();
```

The temporary `no-network.mjs` is:

```js
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { throw Error('network_disabled_for_offline_verification'); };
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
dgram.createSocket = blocked;
dns.lookup = blocked;
syncBuiltinESMExports();
```

Final results: **54/54 paths per runtime, every final process exit 0; 871 passed tests per runtime**. Both exact binary version checks exited 0. The resumed matrix runner exited 0. The earlier timeout remains recorded above; no passing result replaces that history.

| Explicit path (`--test --test-reporter=tap`) | Node 22.16.0 exit / passed | Node 24.15.0 exit / passed |
| --- | --- | --- |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
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
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `core/test/context-read-product-overflow-status.test.mjs` | 0 / 16 | 0 / 16 |
| `adapters/mcp/test/context-read-product-owner-evidence.test.mjs` | 0 / 34 | 0 / 34 |
| `core/test/context-read-product-owner.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 18 | 0 / 18 |
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

Additional final checks:

- A temporary comparison loads the exact `d23649a6` product-sidecar source with
  only its relative imports retargeted, alongside the fixed sidecar. Against the
  same certified fixtures, it compares serialized rankings, exact scores and
  matched counts for eight queries, both intents, and one/two/four/32 namespaces:
  **64 byte-identical comparisons per runtime**. The explicit
  `"$p2c_node" --test --test-reporter=tap "$P2C_FIX1/rank-parity.test.mjs"`
  commands each exit **0** (one test, 64 comparisons). The fixture includes
  bilingual terms, query permutations, missing terms, mixed types, ties and more
  than 128 matches. This supplements the permanent independent P2-07 oracle.
- The Node 22 owner file was rerun after its final prebuild-resumption edit:
  **exit 0, 14/14**. The Node 22 installed product-artifact file was rerun after the final test-host
  microtask notification edit: **exit 0, 1/1**. Node 24's matrix run already used
  that final fixture. Both installed closure derivations still agree at
  **87 runtime/Worker modules**, with no manifest additions required.
- `git diff --check` and an independent whitespace scan including the untracked
  new test both exit **0**. An added-content scan finds no machine-local home or
  temporary-directory paths. No keys, broad suites, setup-runtime
  regeneration, staging or commit was used.

### Fix-round changed files

The inventory was derived from `git diff --name-only -z d23649a6` plus
`git ls-files --others --exclude-standard -z`, then independently re-derived
from `git status --porcelain=v1 -z`: **9 files, zero differences**. Both routes
include the new test and this report. No scripts, public assets, configuration
or packaging-manifest changes are omitted.

- `core/context-product-pump.mjs`
- `core/context-product-sidecar.mjs`
- `core/test/context-read-product-overflow-status.test.mjs`
- `adapters/mcp/test/context-read-product-owner-evidence.test.mjs`
- `core/test/context-read-product-owner.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/fixtures/context-product-index-worker.mjs`
- `core/testing/context-product-index-host.mjs`
- `docs/plans/context-read-p2c-impl.md`
