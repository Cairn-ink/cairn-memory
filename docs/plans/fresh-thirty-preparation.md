# Fresh-thirty preparation and conditional projection

Status: contract recorded before implementation; primary read and scope approved;
owned synthetic implementation complete and source-frozen for primary review.
No actual cohort, source preparation, evaluator read, ledger mutation or paid
dispatch is authorized by this packet. Worktree `fresh-thirty-preparation`,
branch `test/fresh-thirty-preparation`, fixed base
`b9a4a52a5c21b3fda41ae8dbee17c4f8852acf26` (N15 policy integration).
Author: delegated GPT-6.1 Sol/high. Primary owns actual inputs/exclusions,
integration, source/runtime freezes, authority, independent reviews and dispatch.

## Acceptance

- P30a: `prepareThirty` uses the frozen N17A selector/source reader, exact 500
  metadata rows, quotas `[6,6,0,6,6,6]`, unchanged original seed/domain/hash/JS
  order, dataset-order selection and 15/15 alternating arms. Preference remains
  uncovered. Previous-six corroboration is exactly six distinct excluded IDs;
  it is not changed to 30 or treated as complete historical authentication.
- P30b: Selection and exposure are create-only, file-fsynced and directory-
  synced before the original-source producer is called or original source bytes
  are opened. An existing selection/exposure/output directory fails closed.
  Producer or downstream failure retains all 30 frozen IDs and exposure; no
  cleanup of that record, resampling, retry or implicit resume is permitted.
  Selection metadata never receives question/answer/content or evaluator bytes.
- P30c: Preserve finite limits: original input 512 MiB, reader history 128 MiB,
  questions 2 MiB, evaluator stat metadata 8 MiB, each metadata receipt 1 MiB.
  The reader never opens/hashes evaluator bytes. A producer may split generated
  synthetic reference answers while creating test artifacts, but that does not
  authorize authentic corpus/evaluator access. Frozen N17A helpers stay unchanged.
- P30d: `projectThirty` calls real public `prepareMixedComparison` with explicit
  `comparisonProfile: 'indexed-evidence-v1'` and
  `navigationLabelPolicy: 'rare-query-window-v1'`. Every one of the 30 preflight
  rows must be ready. Use real `projectMixedResources` for the full cohort and
  each of 30 singletons with both explicit fields. Models, native topK 6,
  timeouts, prompts, capture planning and numeric pricing/ceilings remain intact.
- P30e: Require the supplied checkpoint to describe cumulative limit
  400,000,000 microUSD, request cap 840,000 and zero pending attempts. The new
  round ceiling is 100,000,000 microUSD and protected reserve 30,000,000:
  whole joint reservation must be at most
  `min(100000000, 400000000-currentReserved-30000000)` and projected requests
  must fit `840000-currentRequestCount`. Validate finite safe integer counts,
  nonnegative values, unknown reservations retained, and fail closed if reserve
  is already unavailable. These numbers/records are projections, not v4 grants,
  authenticated ledger state or permission to spend; no old 20M/300M limit is
  silently mutated.
- P30f: Derive phase caps from the whole projection and each arm's generation/
  scoring caps from the maximum of the 30 singleton projections. Freeze complete
  preparation/source/roster/navigation identities, full projection and singleton
  hashes; refuse changed native/profile/source/navigation pins or unready final
  row. Do not create a guard, grant, operator, callback, launcher or supervisor.
- P30g: Use real public synthetic preparation/projection fixtures. Prove
  freeze-before-producer ordering with source-open/producer fault traps, durable
  failure retention, create-only collisions, six-ID corroboration, malformed
  schemas and row 29, evaluator-read traps, all-30-ready, native/navigation drift,
  exact money/request boundary equality and one-unit-over rejection. Feature RED
  must exercise genuine old six-count or old 300M/20M behavior, not setup/import
  failure. Canonical owned-workspace tests run exact Node22.16.0 and24.15.0,
  report actual exits/skips and prove success/failure cleanup.
- P30h: Freeze owned private sources/tests and public contract inputs through
  `SOURCE-SHA256.json`, excluding that manifest itself. Derive the complete file
  inventory by two independent mechanical routes, compare and report counts;
  rehash all records before handoff. No commit/push/PR by this worker.

## File and caller map

Private owned root `/tmp/cairn-fresh-thirty-preparation.LP9Tg5Sx`:

| File | Scope |
| --- | --- |
| `preparation.mjs` | `prepareThirty` metadata freeze before statically imported real preparation; `projectThirty` conditional checks/caps/identities |
| `private-io.mjs` | Narrow create-only file write/fsync and directory sync; no ledger/controller lifecycle |
| `synthetic-fixture.mjs` | Generated fake corpus, six-ID corroboration and synthetic public pipeline descriptors |
| `preparation.test.mjs` | P30a–P30g boundary and parity tests |
| `suite.mjs` | Canonical owned-workspace `--script` test entrypoint |
| `SOURCE-SHA256.json` | Owned helper source/test/contract inventory, not launch authority |

Public edits are this plan and one small `docs/limitations.md` appendix only.
No public runtime, dependency, accounting, native or scoring changes. N17A import
root is exactly `/tmp/cairn-fresh-thirty-source.CXFeV4Z8`; its source pins remain
the frozen source-only version, not a mutable alias or copied implementation.
The current source freeze manifest SHA is
`2ec40e0cc5e935fac2e7b75aa54d3dee636dfbc79444f4041cee94bcc6a991c1`.
Runtime may bind this N15-base worktree because preparation/projection APIs do
not depend on prospective N16 v4 authority. Future dispatch must freeze its own
actual runtime and v4 authority separately.

Caller flow: explicit metadata/pins and prior-six receipt → selector → durable
selection/exposure → statically imported real `prepareLongMemEval` → N17A source reader →
real mixed preparation with N15 navigation → full+singleton projections → finite
conditional acceptance/caps and identity receipt. The private helper receives
no default corpus/key/evaluator path, no provider callback and no ledger writer.
The real producer is statically imported from this same N15-base worktree;
there is no caller-supplied producer hook or selectable runtime root. Worker
tests use generated fake corpora and builtin fs fault/order traps only. Primary
alone may later supply an actual source descriptor under separately reviewed
acceptance/authority; implementing this API does not authorize that execution.

Projection-only native configuration validation uses strict detached canonical
equality of the entire configuration and hash against this same trusted
worktree's fixed mem0NativeConfiguration (topK6/threshold0/child3600000/
HTTP60000). It rejects proxies before reflection and getters without invocation,
including nested settings. It does not require a cross-module WeakMap identity
or accept a digest alone. Equivalent descriptors from another frozen runtime
are metadata, not execution brands; actual dispatch must separately mint and
validate its own branded gateway object and authentic artifact identity.

## Verification evidence

The feature RED imported the unchanged old `projectSix` and actually rejected
the new 400M checkpoint as `n11_checkpoint_invalid` before source preparation;
the assertion requiring that checkpoint to be accepted failed (actual exit 1,
`a51886`). This establishes the old checkpoint restriction, not full old-pipeline
acceptance or a cohort-size reproduction. `red-projection.test.mjs` was
intentionally moved/replaced via patch by `preparation.test.mjs`; no RED file is
silently omitted from the delivered inventory.

Final canonical synthetic command, with `VERSION` replaced by each exact bin:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/VERSION/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/VERSION/bin/node tools/testing/run.mjs --script /tmp/cairn-fresh-thirty-preparation.LP9Tg5Sx/suite.mjs
```

| Final version | Tests | Skips | Actual exit | Raw result |
| --- | --- | --- | --- | --- |
| Node22.16.0 | 12/12 | 0 | 0 | `36c18d`, 82,039.545588 ms |
| Node24.15.0 | 12/12 | 0 | 0 | `79018a`, 75,544.100486 ms |

Both final runs include actual cross-runtime equivalent native descriptors,
strict full-config/hash equality, coherently wrong config+hash refusal and
nested proxy/getter zero-invocation controls. Earlier 9/11-test green runs are
development checkpoints, not final acceptance. An implementation-tool syntax
error before patch application changed no files and is not a feature RED.

Tests use generated fake 500-row corpora and real public preparation/resource
APIs. They check all 30 ready rows, 15/15 arm order, exactly six excluded prior
IDs, fsync-before-source-open traps, producer-failure retention, create-only
refusal, evaluator-open/read traps, last-row repinned tampering, native/profile
pins and exact cumulative request/protected-reserve equality. Real planning at
the 100M round boundary yields 99,999,635 microUSD / 535,895 requests accepted
and the next batch 100,046,850 microUSD / 536,160 requests rejected. This is
synthetic reservation projection, not provider use or an invoice. Owned
workspaces are registered before fallible setup and cleaned after success and
failure; no authentic inputs or runtime children are used.

The isolated locked OpenAI adapter install exited 0 (`7f2b47`); no dependency
manifest/lockfile was changed. No other dependency installation was needed.
The approved metadata-only native check replaces an overrestrictive cross-module
WeakMap prerequisite; it grants no gateway execution identity.

### Source freeze

The manifest contains five owned private source/test records plus the two public
document inputs: seven records, excluding itself, eight delivered files total.
Private enumeration is cross-checked by directory entries and `find`; public
enumeration by porcelain status and tracked diff plus untracked file listing.
The final manifest is checked against both inventories and every record rehashed.
This source freeze is not a future launch inventory or runtime authority.

| Owned private input | SHA-256 |
| --- | --- |
| `preparation.mjs` | `8f7b3e00fa7daf394beace60bce0a2ea60378af330a4c77e93ffacf2ad859fbd` |
| `private-io.mjs` | `fe7415aa54bef4198cd3dd7ef00ee0d691421f089d41e73ce251390aac749ce0` |
| `synthetic-fixture.mjs` | `4fbecfa728d1a79d39b55731afa433952654a3d12113cab655f9ad0a227e820d` |
| `preparation.test.mjs` | `c2928fb6f4f3450cb8636ad8675921b43f6056b5c9d7a20edaf35a1d0fb0ec8f` |
| `suite.mjs` | `b2f9974e332d023a80fe60bc79286e43c7cdfd2328466c6bf113e8ad46b751a4` |

N17A's frozen five sources and its manifest remain unchanged. Read-only old
preparation, tests and private I/O also retain their original hashes:

| Original input | SHA-256 |
| --- | --- |
| N11 `preparation.mjs` | `0d356a9b76333f6c7c9ddd5471787c9773c2ad553740fcbef043b11c7cc7e1e0` |
| N11 `preparation.test.mjs` | `311222dafa98a5113b05c87ce249252897b4781c909c9d2f2044e09b26d891ae` |
| Six-source `private-io.mjs` | `2a418fcc92814ac4c1b0942a0550f5772c0d187c45445ce56ee8bbb40dac0338` |

No metadata authenticity, complete historical exposure union, actual exclusions,
actual source preparation, ledger checkpoint authenticity, v4 activation or
paid launch is certified here. Generic/documentation checks, independent fixed-
source reviews and future runtime binding remain primary-owned. Worker makes
no commit, push or PR and leaves all original frozen sources untouched.
