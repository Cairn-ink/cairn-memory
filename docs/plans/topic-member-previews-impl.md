# `topic-member-previews-v1` implementation handoff

Uncommitted implementation on `feat/topic-member-previews-impl`, based on
`7212228e`. The frozen P1 and E1-M specifications and existing assertions are
unchanged. No product enablement or full performance acceptance is claimed.

## Design

P1 has a separate Worker reader, strict own-data request validation, the exact
versioned eleven-row grapheme canary table, and an internal Node/V8/ICU/Unicode
fingerprint bound into its authenticated `tp1` cursor configuration. The
`tm1` family and overview origin domain remain unchanged. One acknowledged
member traversal spans both modes; overview has separate state.

Three charged initialization steps validate the consumed TEXT declaration,
direct `octet_length` support and indexed source point path. Metadata enumeration
and lookahead use the existing member storage. Source extraction follows a
same-transaction epoch/generation/target fence, reusing the unchanged membership
and canonical-attribution checkpoint and rechecking exact ID, namespace,
revision, kind and visibility in the guarded point query. Text transformation
runs after commit; another fence precedes delivery. There is no migration,
writer slot or new native wait policy.

The source/type/size guard uses lazy CASE and direct-column byte metadata.
Approved values are materialized whole, cast to BLOB and decoded strictly;
this is a bounded payload contract, not a physical disk-I/O or RSS bound.
Whitespace normalization, whole-grapheme prefix selection, independent
1,024-byte cap and repeated whole-grapheme trailing-space removal follow the
frozen algorithm, including `trimmed_prefix_empty`. Rejected 12,000-ASCII-byte
sources account for 12,000 decoded units, zero normalization/segmentation and a
36,000-byte source-plus-decoded temporary payload.

Each source/validation/construction operation reserves three units together,
with final fence/envelope work reserved. Capability refusal charges one outcome
unit without extraction. Pending and EOF-only-fitting refs retain metadata.
Replay recipes retain refs, revisions, nontext outcomes and envelope/cursor
fields, with sufficient regeneration work reserved; they retain no text or text
digest. Busy preserves acknowledged state; stale/timeout discards unsafe state.
The numeric-only `cairn.topic-member-previews.metrics` diagnostics channel reports
work, bytes, decoded/normalization/segmentation units, failures and payload peaks.

P1 transfers the complete bounded UTF-8 JSON envelope as an ArrayBuffer and
parses it at the host, inside the request deadline. This makes actual transfer
payload bytes directly observable, separately from V8 serialization estimates
and unexposed native framing. Default member/overview transport and DTO property
order stay unchanged. All three new runtime modules and shipped docs/report are
registered in the artifact manifest; CLI/local static imports remain SQLite-free.

## Guard proof on the installed nvm runtimes

`tools/testing/prove-topic-member-previews-guard.mjs` inspects EXPLAIN for the
actual guarded query against an owned in-memory indexed TEXT table, checks its
point plan, executes oversized/approved rows, and runs every exact raw canary.
All three binaries produced the same relevant bytecode:

- content `Column` operands at 26/30 have TYPEOFARG `128`;
- operands at 28/33 have TYPEOFARG|LENGTHARG `192`, immediately followed by
  direct `octet_length(1)`, allowing encoded-length metadata without loading text;
- opcode 35 compares against register 18, initialized to 12,000, and jumps to
  `Null` at 40 for an oversized value;
- the only ordinary content load is opcode 36 (`p5=0`), followed by BLOB
  `Cast` at 37 (`p2=65`) and `substr(3)` at 38. The oversized branch skips all
  three. The plan is `SEARCH memories USING INDEX sqlite_autoindex_memories_1 (id=?)`.

A 12,001-byte row returns a null source; 4,000 BMP CJK units return exactly
12,000 source bytes. Runtime source tests also exercise the real store table.
This proves the guarded extraction branch, not total native I/O or allocation.

| Node | Bundled SQLite | ICU | Guard/canaries exit |
| --- | --- | --- | --- |
| 22.16.0 | 3.49.1 | 77.1 | 0 |
| 24.15.0 | 3.51.3 | 78.2 | 0 |
| 24.22.1 | 3.53.4 | 78.3 | 0 |

```sh
node@v22.16.0 tools/testing/prove-topic-member-previews-guard.mjs
node@v24.15.0 tools/testing/prove-topic-member-previews-guard.mjs
node@v24.22.1 tools/testing/prove-topic-member-previews-guard.mjs
```

Each command above exited 0. The guard/canary checks on the two Node 24 versions
are not a substitute for primary's full functional/runtime acceptance.

## Functional verification and actual exits

All tests ran on Node 22.16.0, by explicit path. No broad suites or timing gates
ran. The complete focused command was:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-member-previews.test.mjs core/test/topic-member-previews-text.test.mjs core/test/topic-member-previews-bounds.test.mjs core/test/topic-member-previews-mutations.test.mjs core/test/topic-member-previews-visibility.test.mjs core/test/topic-member-previews-compatibility.test.mjs core/test/topic-member-previews-scale.test.mjs core/test/topic-member-previews-installed.test.mjs core/test/topic-member-previews-measurement.test.mjs core/test/topic-members.test.mjs core/test/topic-members-bounds.test.mjs core/test/topic-members-compatibility.test.mjs core/test/topic-members-integration.test.mjs core/test/topic-members-mutations.test.mjs core/test/topic-members-primary.test.mjs core/test/topic-members-recheck-findings.test.mjs core/test/topic-members-review-findings.test.mjs core/test/topic-members-round3-findings.test.mjs core/test/topic-members-scale.test.mjs core/test/topic-members-visibility.test.mjs core/test/topic-overview.test.mjs core/test/topic-overview-lifecycle.test.mjs core/test/topic-overview-raw29.test.mjs core/test/topic-overview-visibility.test.mjs
```

Exit **1**, 296/298 passed. Two identified failures were corrected: the new
SQL-function refusal fixture registered the wrong function arity; the existing
progress observer requires the exact `let traversal;` declaration, now restored.
The affected final command was:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-members.test.mjs core/test/topic-member-previews.test.mjs core/test/topic-member-previews-bounds.test.mjs core/test/topic-member-previews-measurement.test.mjs
```

Exit **0**, **29/29** passed, including the added EOF-only-fitting/work16 case.
Mechanically reconciling final TAP outcomes by exact test name gives **299
unique cases, 299 passing, zero unresolved**. Legacy differential assertions
against `b2513501` passed **184** page/budget comparisons and **154** fault
comparisons, with **zero differences**; those assertions were not edited.
Both P1 product worlds completed, independently reconciling 1,112/3,336 Memories,
four namespaces and 71 MOCs (60 L1, 11 L2), with zero inventory differences.

Offline installed verification command:

```sh
node@v22.16.0 tools/testing/run.mjs core/test/topic-member-previews-installed.test.mjs
```

The final installed/observer recheck also ran:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-member-previews-installed.test.mjs core/test/topic-member-previews-measurement.test.mjs
```

Exit **0**, **4/4** passed. Its owned cache uses offline `npm pack`, then actual archive
extraction and installed core/Worker imports on physical 18/33, DELETE/WAL.
Archive and recursive extracted inventories both contain **298 files**, diff
empty; **152 reachable core/Worker modules** match manifest coverage and source
bytes. npm/tar/tar child exit codes are all 0, signals null. An initial npm-path
fixture error exited 1 before correction. Earlier development checks also
caught invalid raw fixtures (STRICT BLOB insertion and insufficient oversize);
corrected focused runs exited 0. One mixed-version development run was stopped
with exit 130 after editing delivery while it was running; its partial outcomes
are excluded from the final reconciliation. No requested tests/fixtures owned
by another session were edited.

## One smoke; full acceptance remains queued work

```sh
node@v24.22.1 tools/testing/run.mjs --script tools/testing/measure-topic-member-previews.mjs --smoke --report docs/plans/topic-member-previews-smoke.json
```

Exit **0**, exactly one smoke. The saved report retains **38 raw attempts**
across six tiny cells (112 Memories, four namespaces, 71 MOCs; page24/L2;
DELETE/WAL; idle/same-owner/other-owner), exactly three warmups and separate
fresh-process cold samples. All reader/writer child exits were 0, signals null.
Concurrent DELETE produced 18 reader busy outcomes; WAL had zero busy and one
same-owner stale outcome. Observed host loop maximum was 2.667109ms. Every
retained smoke traversal reached exact EOF. These are observations only.

The saved smoke predates the final UTF-8 transfer accounting and summary
refinements; the final observation path is covered by the functional measurement
test, which checks exact transport payload/envelope equality and numeric work.
No second smoke or full measurement was run. The full harness preregisters all
144 cells, successful-page sampling/ceilings, separate cold populations,
per-request fresh capture/review writers, actual write-call overlap, unchanged
common caps, host heartbeat through cleanup, and all decision-table gates.
It records invalid overlaps and typed failures without discarding their latency.

Primary must supply unchanged production deadline provenance and run the full
final harness under the machine-wide queue, for example:

```sh
node@v24.22.1 tools/testing/run.mjs --script tools/testing/measure-topic-member-previews.mjs --writer-profile /OWNED/PATH/deadlines.json --report /OWNED/PATH/previews-full.json
```

The profile contains only `{captureMs,reviewMs,provenance}`. Missing production
results/deadlines/sample/overlap evidence is inconclusive. No latency threshold
was relaxed; page100/retained/cold3336 remain report-only for latency. Primary
also owns the remaining Node 24 functional and CI-equivalent acceptance matrix.
No background agent monitoring is promised or left running by this handoff.

## Changed files: two independent inventories

`git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`
was compared with `git status --porcelain --untracked-files=all`. Both give
**27 delivery files**, diff empty. Temporary working logs are excluded and
removed. `git diff --check` and an independent trailing-whitespace/EOF scan
include every tracked and untracked delivery file; both exit 0.

```text
core/memory-reader.mjs
core/test/topic-member-previews-bounds.test.mjs
core/test/topic-member-previews-compatibility.test.mjs
core/test/topic-member-previews-installed.test.mjs
core/test/topic-member-previews-measurement.test.mjs
core/test/topic-member-previews-mutations.test.mjs
core/test/topic-member-previews-scale.test.mjs
core/test/topic-member-previews-text.test.mjs
core/test/topic-member-previews-visibility.test.mjs
core/test/topic-member-previews.test.mjs
core/testing/topic-member-previews-fixture.mjs
core/topic-member-previews-reader.mjs
core/topic-member-previews-storage.mjs
core/topic-member-previews-text.mjs
core/topic-members-input.mjs
core/topic-members-reader.mjs
core/topic-members-session.mjs
core/topic-overview-worker.mjs
core/topic-snapshot.mjs
docs/plans/topic-member-previews-impl.md
docs/plans/topic-member-previews-smoke.json
docs/topic-overview.md
package.json
packaging/artifact-files.json
tools/testing/fixtures/topic-member-previews-metrics.mjs
tools/testing/measure-topic-member-previews.mjs
tools/testing/prove-topic-member-previews-guard.mjs
```
