# Source-time preservation (T1)

Prospective contract recorded before runtime edits. Primary DRI owns acceptance
and independent review. Implementation: actual GPT-6.1 Sol, high reasoning,
in the isolated `feat/source-time-preservation` worktree, fixed base
`d46f7d0aef7b0011e982da8e10f1f26e90706767`. H6 remains closed; this work is an
input-preservation fix and makes no accuracy, evaluation or default-promotion
claim. No user/production database, paid calls, operational ledger, provider,
adapter, hooks, hosted schema or evaluation producer changes are authorized.

## Contract

Add embedded opt-in `captureSourceTime: 'claimed-v1'` for ordinary
`source-bound-v2` (including staged-v1) and `indexed-evidence-v1` capture.
Optional message `sourceTime` is an exact opaque producer-claimed utterance
label, not event occurrence, applicability, ingestion, authenticated chronology,
identity, permission or causal order. Unknown is omitted. Never parse dates,
invent timezone/clock values, sort, infer events, rewrite content or backfill.
Reject the capability with source-bound-v1, unsupported/unqualified capture,
session episodes or automatic rationale capture. Reject any own causal field
before model/write/claim. Explicit remember/correct/supersede receipt APIs stay
strict; existing unannotated ordinary configurations remain unchanged.

Validate present labels as 1–128 UTF-16 units, well-formed Unicode, no C0/C1
controls or line separators, no outer whitespace; existing canonical
normalization/redaction must preserve the exact string. Reject explicit
undefined/null/empty/oversize/noncanonical input; never truncate or change it.
Valid instruction-like labels remain untrusted data and confer no authority.

Carry labels through normalized snapshots, bounded planning/windows, trusted
receipts, immutable identity, staging, inspection and source/rationale-evidence
projections. All upgraded readers expose retained labels even when reopened
without opt-in; opt-in controls retention, not concealment. Add no projection
switch or cursor state; preserve namespace, revision/epoch, retention,
forgetting and atomic source-read guards. Extraction and qualification provider
requests, schemas and content remain unchanged. Source-evidence rank and final
context carry the exact label with its receipt under ordinary exact token/byte
budgets: a whole item may cease fitting; never strip fields or add free sidecars.

Add transactional v18→v19 nullable `receipts.source_time`, after the existing
migration chain. Old rows stay NULL; old unannotated receipt keys, capture
digests and output envelopes remain byte-identical. Annotated canonical receipt
identity appends sourceTime after the existing five fields; centralize
reconstruction for validation, qualification and persistence. Annotated capture
digest wraps the old digest and ordered optional-label vector in a versioned
domain; enabling opt-in with no labels preserves the old digest. Same event
identity plus changed/added/removed label conflicts before model/write; no
mutable enrichment. Preserve v2 qualification anchors and existing
qualification_conflict semantics. Labels cannot be excerpt anchors or prove
claim applicability. Older binaries reject v19; stop/drain older connections
before upgrade. No migration against user databases.

## Required acceptance

- T1.1: Before fixing, run a real failing capture→cold-reopen→source-evidence
  fetch/recall regression using two synthetic relative-date messages with
  different labels; then demonstrate green for indexed and source-bound-v2.
  Scripted selection proves transport only.
- T1.2: Unknown remains absent in every projection; pre-change unannotated
  digest/key/envelope fixtures remain byte-identical; disabled capability rejects
  labels before calls/claims; mixed known/unknown never borrows labels.
- T1.3: Identical annotated replay duplicates without calls/mutation;
  changed/added/removed labels conflict without calls/write. Same content with
  different labels produces distinct immutable receipts.
- T1.4: Cover Unicode/control/undefined/null/empty/whitespace/redaction/max
  boundaries, full-message/window splits, ownership before model, unsupported
  combinations and no additional roles/file/tool payload/authority.
- T1.5: Durable v2 staging/retry/discard and forgetting preserve/remove labels;
  qualification bind/inspect and invalid-evidence guards remain exact;
  episode/causal/rationale routes unchanged without opt-in and visibly rejected
  with unsupported opt-in combinations.
- T1.6: Fresh/v18→v19 and supported migration fixtures, old keys, fail-closed
  corruption, reopen/old-binary refusal, no createdAt inference/backfill. Every
  test owns fresh scratch and closes resources before cleanup on pass/failure.
- T1.7: Rank/fetch/recall/sourceSnapshot/source-rationale whole-source envelopes
  count metadata exactly; hostile labels untrusted; no namespace/identity leak;
  insufficient budgets never return source halves or silently strip labels;
  source/cursor stale guards preserved.
- T1.8: Document core-only producer absence, rank-provider exposure, schema
  upgrade and exact incompatibilities in protocol/threat model, storage/capture/
  source docs, limitations, changelog and this plan. Add glossary term to
  CONTEXT.md; no ADR needed. No score/default/evaluation promotion.

## Verification and delivery

Use owned test runner and synthetic scratch only; no broad temporary-directory
sweep or shared-install deletion. Check node_modules symlinks before installs.
Run npm test, npm run validate, pinned Claude plugin/marketplace checks,
test:core and demos store/capture/recall on Node 22.16 and 24.15, plus touched
v2/staging/source/migration suites and other applicable CONTRIBUTING gates.
No TypeScript gate. New runtime helpers require packaging manifest and installed
artifact gates; prefer existing packaged modules. Record actual exit codes,
exact commands and scratch cleanup. Derive changed paths twice independently,
compare and report counts, including docs/config/scripts/public paths.

Primary inspects actual diff and reruns key paths before candidate commit;
worker does not commit/push/open PR. After acceptance, primary freezes candidate
and commissions independent Standards and Spec review at exact base/head,
fixing/rechecking/reviewing until pass, then PR/main exact-head CI and
mergeability; no auto-merge. Checkpoint after plan/red and meaningful milestones.

T2 producer/answer packing and T3 complementary-evidence evaluation are deferred.
Any new paid evaluation needs a new prospective frozen scope, independent
review and remaining cumulative 400/protected 30 affordability; H6 stays closed.

## Evidence

Implementation ownership remains the assigned actual GPT-6.1 Sol/high worker;
primary owns final acceptance, candidate commit and independent reviews. No
worker commit, branch push, PR, production access or paid/model-service call.

The initial Node 22.16 command
`node tools/testing/run.mjs core/test/source-time.test.mjs` returned exit **1**:
both intended capture→cold-reopen→fetch/recall cases refused the unsupported
constructor capability. Runtime changes followed that red signal. The same real
paths now pass, including ordinary v2, indexed-evidence and v2 indexed-windows.
The final focused file has **22 cases**, all passing on Node 22.16 and 24.15 (exit **0**);
the complete two-runtime core gates also include this file.

The traced loss boundaries were normalization/window copies, canonical receipt
construction/storage and closed source read projections. Extraction and
qualification requests remain unchanged. Primary approved adding
`core/moc-storage.mjs` to the advisory inventory: three explicit canonical
receipt SELECTs need source_time for integrity validation, without changing
scoring/order/query terms. Primary also required preserving old rank prompt bytes;
`core/recall.mjs` adds its safety text only for source/rationale candidate sets
containing retained annotations (including linked rationale sources), before
the existing exact rank measurement/packing. Plain/qualified prompts and
unannotated source/rationale prompts remain unchanged. No repacking loop.

Acceptance coverage in the focused suite includes mixed known/unknown and legacy
reads; same/changed/added/removed replay and no-call/no-write conflicts; distinct
immutable same-content receipts; Unicode/control/redaction/length/disabled
refusals; explicit system/tool role and file/tool/authority-key cases inside
the focused validation test (zero provider calls/claims), also covered by the
broader existing core boundary suites; unsupported combinations and causal-own
undefined; caller mutation specifically at the extraction callback after the
normalized snapshot was copied; whole-message planning and indexed splits;
v2 qualification cold anchors and invalid evidence; durable staged failure,
closed retry, successful staging, discard and forgetting; real frozen-v18
migration, NULL/no-clock-backfill, old-binary refusal and transactional failure;
corruption and canonical source rereads; exact whole-source token/UTF-8 budgets,
rank omission without stripping labels and stale source/cursor fences.

The frozen v18 opener fixture is mechanically copied from base d46f7d0 with
only relative imports relocated. A byte comparison against the git base after
that relocation passed (exit **0**). No historical fixture was regenerated.
Existing version expectations advance to 19; raw pre/post migration comparisons
explicitly assert the additive source_time is NULL and compare every prior
field. Pre-change v2/indexed capture digests were produced by executing the base
captureSnapshot and frozen as exact hex constants in the test. Both unannotated
source/rationale system prompt SHA-256 values are likewise frozen from that base.

Verification checkpoints (all Node versions mean pinned 22.16.0 / 24.15.0):

- Initial full Node22 `npm run test:core`: exit **1**, 1195/1226 passed,
  31 failed, zero skips; this exploratory run overlapped test changes and is
  not acceptance evidence. Failures exposed additive-column expectations in
  historical migration/parity assertions. The isolated migration batch first
  returned exit **1** (32/50), then exit **1** (47/50); after only the explicit
  NULL/prototype expectation corrections, `node tools/testing/run.mjs
  core/test/*migration.test.mjs` passed **50/50**, exit **0**, zero skips.
- A Node24 full core run started before those last test corrections was
  deliberately stopped via SIGTERM to its owned test runner, exit **143**;
  its process group was stopped and scratch cleaned by the runner. It is not
  a passing gate. Clean final full core runs began after runtime/test edits
  stopped and remain pending below.
- Initial Node22 `npm test`: exit **0**, 673 tests, zero skips. Since runtime
  edits overlapped its start, a final rerun is required. Initial Node24 run and
  final generic gates are still pending.
- `npm run validate`: exit **0** on both nodes.
- Pinned Claude install used sanitized `env -i` and a checked absent local
  tooling node_modules. Initial `--ignore-scripts` install succeeded (exit **0**)
  but `npm run validate --prefix tools/plugin-validation` returned exit **1**
  because its native binary was not installed. Sanitized local `npm rebuild
  --prefix tools/plugin-validation` returned exit **0**; plugin and marketplace
  validation then passed on both nodes, exit **0**.
- `npm run demo:store`, `demo:capture`, `demo:recall`, `demo:moc`: exit **0**
  on both nodes, invoked through the owned runner's --script npm-cli wrapper.
  The wrapper removes the synthetic databases after close; all **8/8** emitted
  owned demo roots were independently checked absent (exit **0**).
- `git diff --check`: exit **0**. No new runtime module or packaging file;
  the installed-artifact gate is not activated. No TypeScript gate applies.

Caller/check ownership: worker runs full core (v2/qualification/staging, MOC,
source/rank, old cursor, episode/causal/rationale absence and migration/parity
callers) and generic checks on both nodes. Primary reruns actual final key paths,
audits the diff and commissions independent fixed-base/head reviews. No adapters,
evaluation ingestion/defaults, hook payloads, hosted schemas or H6 artifacts
were changed; no browser/UI route is affected.

Delivery inventory cross-check: `git diff --name-only` plus
`git ls-files --others --exclude-standard` versus independent
`git status --porcelain=v1 --untracked-files=all` yielded **44 paths each,
zero differences**. This includes core runtime/tests/frozen fixture, CONTEXT,
CHANGELOG, ROADMAP and all requested docs; no scripts/public/config omission.
The final inventory and runtime/test snapshot are rechecked before handoff.

Final full gates and primary acceptance are pending; this record does not
claim candidate acceptance, independent-review passage or delivered PR.

Primary intervention: after the two worker migration expectation correction
rounds, primary independently ran the exact historical parity case in
`core/test/episode-mode-parity.test.mjs` on Node22 and observed exit **1**:
the only remaining difference was receipts[].source_time:null. Under the narrow
integration-takeover rule, primary owns that one test-only correction (assert
NULL, then compare preserved fields), both-node rerun and readiness confirmation;
worker does not edit that file. Runtime is unchanged. The now-stale clean full
core22/core24 invocations were deliberately SIGTERM-stopped through their owned
runners and settled with actual exit **143** each; no passing gate is claimed.
Final generic runs are unaffected. Full core acceptance must restart after
primary confirms the corrected test bytes; no expensive run is left unattended.

Primary's corrected parity file SHA-256 is
`51c3b2e68bbe3722b6a878622fa6356ec1c0fcde40f9917d9bc8ad1b00bb99a6`;
the exact previously failing case passed 1/1, exit **0**, zero skips on both
nodes. New full-core invocations started after that correction, bound to core
working-diff SHA-256
`d4c99d0566d413fd48c365b98e057bcee9782625e87711277f4ba4216742ae86`
(binary tracked core diff followed by sorted untracked core path/text bytes).
Worker makes no further runtime/test edits while these gates run.

Primary independent acceptance also reran the focused file **22/22**, exit
**0**, zero skips on each node. Its separate synthetic scratch probe passed
exit **0** on both: three real capture configurations (indexed evidence, v2
prefix, v2 windows), each cold-reopened without captureSourceTime across default,
IDF, keyset and combined candidate/ranking policies, in source/rationale modes:
**24 read paths per node**, each retaining three exact receipts/two labels/one
unknown. Classification applied; rank/final receipt tuples matched; no private
identity leaked; owned scratch was checked absent. This independently covers all
three MOC receipt SELECTs. It is transport acceptance, not a semantic score.

The primary scratch probe's extension passed one additional nested-rationale
path per node, **25 paths/runtime total**: unannotated root with annotated linked
support/challenge, explicit reviewRationale persists two edges then idempotently
zero, cold digest bindings stay exact, and linked annotations trigger the
counted rank-only addendum while relation-provider input still omits labels.
Actual exits **0** on both; scratch was checked absent. Probe SHA-256:
`0fd71c1bf68bc14356f87368e9a144f4760d269d2b3891d622d1c10455ce8c88`.

Final `npm test` has settled with exit **0**, **673/673** tests, zero skips on
both Node22 (312.6 seconds) and Node24 (326.9 seconds).

The full core runs bound to d4c99d0 settled with actual exit **1** on each
node: **1232/1233 passed**, one failed, zero skips (427.5/427.7 seconds). Sole
failure: R9 in core/test/rationale.test.mjs synthetically removes post-v11
schema objects from a fresh current store but leaves receipts.source_time,
so the later real migration correctly rejects a duplicate column. This is a
test-fixture downgrade mismatch, not a demonstrated supported-store migration
failure. Worker immediately reported exact error/line/exits to primary and
escalated the one-test correction under the existing takeover after repeated
same-class worker expectation corrections. Recommended repair removes the new
column when constructing synthetic v11, then explicitly asserts NULL and
compares all old receipt fields after upgrade. Runtime and historical fixtures
remain unchanged; worker has not edited this further test. No passing full-core
gate is claimed and all invocations are now settled. Primary correction,
focused rerun and final full-core re-verification remain required.

Primary extended the narrow takeover only to that R9 synthetic fixture. It
reproduced the selected case with actual exit **1**, then removed source_time
when constructing v11 and asserted restored NULL/all prior fields after upgrade.
The entire rationale file passed **21/21**, exit **0**, zero skips on both nodes.
Corrected file SHA-256:
`229860404a10dfadef9cdf31e4ff979b9ea261d448483f8f8e1a03b749d068d4`.
The r4 full-core runs started only after this correction, bound to core
working-diff SHA-256
`7ff8fd046b29a7cdaa4c6f6abe8c2d77fa1723dc6bf7af3af40954f88a01a17c`.
No runtime code changed during either primary test-only intervention.

### Final worker verification — supersedes earlier checkpoint statuses

All required worker gates have now settled. The r4 full-core invocations ran
after the last test-only correction against unchanged core working-diff SHA-256
`7ff8fd046b29a7cdaa4c6f6abe8c2d77fa1723dc6bf7af3af40954f88a01a17c`.
Terminal process results were collected directly, not inferred from log tails:

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm run test:core` | exit **0**, **1233/1233**, zero skips, 491.5s | exit **0**, **1233/1233**, zero skips, 492.4s |
| `npm test` | exit **0**, **673/673**, zero skips | exit **0**, **673/673**, zero skips |
| Focused source-time file | exit **0**, **22/22**, zero skips | exit **0**, **22/22**, zero skips |
| Primary full rationale file after R9 correction | exit **0**, **21/21**, zero skips | exit **0**, **21/21**, zero skips |
| `npm run validate` | exit **0** | exit **0** |
| `npm run validate --prefix tools/plugin-validation` | exit **0**, marketplace + strict plugin | exit **0**, marketplace + strict plugin |
| store/capture/recall/MOC demos | all four exit **0** | all four exit **0** |
| Primary independent cold-read/nested-rationale probe | exit **0**, **25 paths** | exit **0**, **25 paths** |

Exact full-core commands were `npm run test:core` and
`env PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin npm run test:core`;
generic commands substitute `npm test`. Both final core runs used the owned
runner through the npm script. Focused commands were
`node tools/testing/run.mjs core/test/source-time.test.mjs` with the same Node24
PATH prefix on that runtime. Demos ran the requested npm scripts through
`node tools/testing/run.mjs --script /home/chichieh/.nvm/versions/node/v22.16.0/lib/node_modules/npm/bin/npm-cli.js run demo:store`
and analogous demo:capture/demo:recall/demo:moc paths; Node24 used its own
npm-cli.js and PATH. This confines their deliberately retained synthetic
databases to the owned outer workspace, which is removed after resource close.
All eight emitted demo roots were separately checked absent. Successful runner
exit follows child-group termination and awaited owned-workspace cleanup; a
cleanup failure sets exit 1. No historical temporary-directory sweep occurred.

Final full-core logs retained for primary inspection:
`/tmp/cairn-source-time-core-final22-r4.log` and
`/tmp/cairn-source-time-core-final24-r4.log`; generic logs:
`/tmp/cairn-source-time-generic-final22.log` and
`/tmp/cairn-source-time-generic-final24.log`. Earlier failed/cancelled runs above
remain explicit and do not substitute for these passing final results. All
worker processes are settled; no supervision promise or unattended task remains.

Final independent inventories again matched **44/44 paths**, zero differences:
**13 existing runtime files**, **19 test files** (18 updated plus one focused
addition), **one frozen v18 fixture**, **11 docs/glossary/changelog/roadmap paths**.
`git diff --check` returned exit **0**. Primary independently confirmed the
inventory, frozen-v18 import-only byte comparison and final core hash. There is
no new runtime module or packaging change, so no widened installed-artifact
gate; no TypeScript gate applies. Runtime token/cost data is not exposed and is
unknown; no paid calls were made.

Worker implementation, regression and verification are complete. **Only primary
candidate freeze/commit, independent fixed-base/head Standards and Spec review,
and authorized PR/CI delivery remain pending.** No worker commit/push/PR/merge
was made. This is transport preservation acceptance, not a semantic score,
default promotion, producer rollout or reopening of H6.
