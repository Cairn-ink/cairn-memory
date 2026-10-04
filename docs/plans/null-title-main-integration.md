# NULL-title filing on released main — NR1–NR8

Status at 2026-10-05: NR shared-core behavior implemented; accepted offline
verification is recorded below. Final fixed-candidate Standards/Spec review and
remaining CI are pending at this checkpoint. Only `applyPlacement` production
behavior changed. Ordinary scoped verification and PR delivery follow the
contributor workflow; paid/native trials, publication and merge are not implied.

Fixed base: `81ed1da6f366a6f288122e00f9df8ef68c832bb8`.
Worktree: `null-title-main-integration`; branch:
`fix/null-title-main-integration`.
Bounded implementation owner: actual GPT-6.1 Sol/high. The primary owns scope,
controlled prerequisites, integrated verification, evidence acceptance and delivery.
Different nonauthor reviewers own final Standards and Spec on the same fixed
base and final candidate.

## Decision and observable acceptance

The already accepted [ADR 0004](../adr/0004-null-title-structural-reuse.md)
distinguishes a topic identity from its source-supported label. Exact canonical
key equality establishes organizational identity, not semantic equivalence.

- NR1: In the existing guarded placement transaction, resolve an existing group
  only by exact namespace, hierarchy level and canonical title key, and only
  when its authoritative visible title is NULL. This includes nonempty groups
  with an invalid original title source. Visible collisions still return
  `moc_title_conflict`; no global lookup, orphan-only shortcut or relabeling.
- NR2: Preserve the reused ID, stored title/key, creation time and every original
  title-source binding. Never attach fresh label evidence. Reused groups are
  absent from `createdMocs`; no reused DTO or `titleSources` field is added.
  Repeated reuse, classification/public maps, MCP inspection, cold open and
  published index rebuild keep the unsupported label NULL. Genuinely new
  groups retain ordinary source binding.
- NR3: Coalesce aliases and explicit IDs by actual resolved identities. Memory
  memberships remain complete replacement; inherited hierarchy remains.
  Requested edges are additive and resolved-pair deduplicated. At most three
  submitted explicit existing L2 IDs may be unioned for a coalesced L1. Inherited
  degree is not that limit. One requested `newL2Title` remains distinct, even
  when it resolves to an existing NULL L2: three explicit IDs plus that request
  can name four parents without widening either per-item field limit.
- NR4: Real direct membership changes bump an existing L1 once; new direct child
  edges bump an existing L2 once. Combined changes bump each once. New groups
  start at revision 1 and refs bind resulting revisions. No duplicate edge
  writes or alias double-bumps; true no-op preserves versions, times and epoch.
- NR5: Preserve namespace, level, currentness, memory/revision and index guards.
  Stale, foreign, deleted, historical and visible-conflicting proposals refuse
  atomically. Late edge/ref or initial-classification completion failures roll
  back structure, revision, epoch and rationale changes; prior admitted cards
  and source receipts remain durable. Test second-connection mutations too.
- NR6: Fresh capture can complete its initial placement atomically by reusing
  a NULL identity. Exact replay is inert. Later manual or MCP recovery never
  rewrites an earlier failed initial attempt. Cold and mixed-dedup reads retain
  original batch members and receipts; current filing does not establish the
  initial attempt's success.
- NR7: Except only S2 B3's historical blanket collision refusal for this
  exact NULL case. Preserve historical evidence and visible-title refusal.
  Disclose that fresh membership can make retained ancestors navigable again:
  this deliberately associates new memories with retained structure, without
  restoring labels, forgotten text or semantic support. No historical cause,
  measured quality improvement or zero-privacy-change claim.
- NR8: Freeze Stage 1 against unchanged released production bytes and obtain
  fresh focused RED with real admission/source/cold prerequisites and passing
  contrasts. ROOT must accept it before the smallest shared-core implementation.
  Verify the final combined candidate on both exact supported runtimes, then
  obtain independent fixed-candidate Standards and Spec reviews. Old results
  are immutable history, not fresh RED, GREEN or final-candidate coverage.

## Scope and preservation

Stage 1 adds the three NR core/OpenAI/MCP test files and only the NR fixture
plus three tests in `packaging/test/install.test.mjs`. Existing packaging
imports, helpers and tests stay unchanged. The new OpenAI fixture omits the
unrelated optional phase-timing observer and its timing assertion; it retains
actual fake-HTTP calls, proposals/catalogs, diagnostics already supported by
main, complete source receipts, episode session key, cold journal, replay,
namespace and visible-collision assertions.

Following accepted Stage 1 RED and the separate ROOT source-edit grant, Stage 2
changes only `applyPlacement` in `core/moc-storage.mjs` production behavior. ET7/CR8 refinements, supplied-history
or private mixed journals, phase/recall/native observers, embedding optimization
and budget extensions are deferred to separate work. No production adapter,
guard, hosted/client/Codex module, schema, package script, workflow or artifact
allowlist change belongs to this delivery.

Preserve all five coupled 0.3.0 version values and the independent hosted
`server.json` semantics. Preserve the released optional trusted conversation
ID, ASCII validation, exact one-time older-schema fallback, shared first-dispatch
deadline, quota/cancellation and nonnested control-lock behavior; Codex prompt
recall remains disabled. Keep promotion docs/assets and the released README
untouched. No prompts, request/token/parent-field caps, timers, provider models,
source defaults, capture/retention/suppression policy, public DTO, storage schema,
telemetry, credentials or paid authority changes.

## Tests-first footprint and historical expected RED

The focused command selects these complete files through the
existing `tools/testing/run.mjs`, with no name filter:

- `core/test/null-title-placement.test.mjs`: 24 statically expanded cases;
- `adapters/openai/test/null-title-capture.test.mjs`: four contrasts;
- `adapters/mcp/test/null-title-recovery.test.mjs`: two actual SDK controls.

The footprint is 30 cases. The accepted Stage 1 RED and subsequent Stage 2
GREEN are recorded below. Controlled executions retained canonical argv and
authenticated source/dependency/runtime/environment/containment inputs;
mechanically pending parent status alone was not accepted as a gate.

Before Stage 2, the prediction on unchanged main was that NULL-title resolution
would still return
`moc_title_conflict`: repeated/aliased/nonempty NULL reuse, NULL-parent reuse,
new-edge/revision/no-op paths and successful initial placement/recovery fail
their new contract assertions. The four-parent refusal and late SQL/completion
fault cases must eventually reach their intended seams; an earlier title
collision is a failed NR test, not the intended atomic fault proof.

The predicted passing contrasts were visible collision/stale namespace-level
guards, visible-L2 refusal with a proven absent requested L1 and unchanged
whole state/epoch/receipts/filing/provenance, historical/deleted-memory refusal,
both second-connection stale guards,
OpenAI visible collision/alternate-title/explicit-NULL-ID paths and MCP visible
collision. The static prediction was 19 failing/five passing core cases, one
failing/three passing OpenAI cases and one failing/one passing MCP case
(21 failures/nine controls overall), not an observed or required footer.
Unexpected setup errors, reachability changes or counts require diagnosis;
never weaken assertions or relabel them to match that prediction.

The separate installed fixture adds three cases: genuine installed stdio
NULL L1/L2 initial reuse, completion-fault rollback then guarded recovery/cold
replay, and visible-collision refusal. The first two were predicted to fail
before Stage 2; the third is a positive contrast. All three subsequently passed
in the accepted artifact suites. They use the existing archive,
source SDK client seam and installed core/adapter/server dependencies, with
fake HTTP only; no phase helper or new artifact entry is needed.

## Safety and verification gates

Use only immediately registered owned synthetic workspaces and deferred resource
closure. No user/production store, corpus, provider key, operational ledger,
historical cleanup or paid/model request. Mock/fake-HTTP success establishes
contracts, not semantic classification or recall quality. Missing prerequisites
fail rather than become skips or passing evidence.

The offline matrix and remaining delivery checks use exact Node 22.16.0 and
24.15.0:

- Complete `npm test`, `npm run validate`,
  `npm run test:workspace-lifecycle`, and canonical
  `npm run validate --prefix tools/plugin-validation`.
- Complete `test:core`, the three focused NR files, and affected canonical core
  demos: store, MOC, capture, history, recall, admission, episodes,
  session-context, conflicts, rebuild and continuation.
- Complete `test:openai` / `demo:openai-offline`, `test:mcp` and
  `test:artifact`, including the three installed NR cases. Preserve required
  installed rationale synthetic-HTTP coverage where the affected closure needs it.
- Downstream `test:live-evidence-offline`, `test:longmemeval`,
  `test:long-history`, `test:long-history-live:offline` and all four LongMemEval
  demos retain their canonical commands. Thirty source-declared opt-in cases
  remain uncovered rather than being credited as full coverage.
- Released pairing/golden/client/Codex regression gates and the generic
  recall-session tests remain present; this change cannot regress them.

For this NR-only placement diff, unchanged native-local/mixed-native and
installed Hermes opt-ins are separate M3 prerequisite/M4 coverage work, not
mandatory NR pass credit. This explicitly narrows the earlier prospective
native matrix; missing prerequisites never become successful native runs.
Copied native backing is DATA only, not Python/native readiness or resource fit.
No native, request-guard, provider, cap, default or containment code changed.

Locked isolated OpenAI/MCP/maintainer dependencies, genuine historical golden
sources and offline artifact metadata were authenticated for the selected
offline checks. Cache preparation/clean-cache retain their existing
public-registry behavior and need separate authority; no install or network
operation is implied here. Canonical scripts/rosters and actual results must be
bound to the final candidate; no old branch pass carries forward. Generic CI's
20/22 matrix remains distinct from these exact local 22.16.0/24.15.0 checks.

The primary inspects the combined diff, personally verifies key integrated
paths and preserves failed attempts. Independent Standards and Spec review the
same fixed base/candidate before PR delivery. Scoped commits, push and PR follow
the contributor workflow; release, promotion, deployment, paid trials and merge
remain separate.

## Historical evidence and current status

The prior c8/SJ composed branch's tests-first failures and later verification
belong to that frozen source and remain unchanged. They are not executions on
this released-main candidate, do not explain an unretained paid proposal and
supply no score, reliability or installed-host readiness claim here.
ROOT accepted one fresh focused Stage 1 RED on exact Node 22.16.0 and source
`2a326051669c61ee0cebcff8c0bb796778230332507f05df5e006faf5d8142f8`:
`node tools/testing/run.mjs core/test/null-title-placement.test.mjs adapters/openai/test/null-title-capture.test.mjs adapters/mcp/test/null-title-recovery.test.mjs`.
The actual invocation naturally exited 1: 30 tests, nine passing controls and
21 failures, all at early `moc_title_conflict`; zero cancelled, skipped or todo.
The untouched production core was SHA256
`aa5c2ace15cc604f434bacc2e2c244cb2d82d93e3b1675b930e725960cdb9b4d`.
This is accepted expected RED, not a green product result. Four-parent refusal,
late SQL/completion rollback and the blocked later reuse/cold/replay assertions
were not proved by that run. No Node 24 or installed-artifact pass is inferred.

Retained exact evidence, read as DATA before the Stage 2 source edit:

- Raw: `/tmp/nr-focused-result.ZlF8K6/raw.log`, SHA256
  `046881c200c9c711e7b03cce665ac9ad2c1fd28beaef357e431f01c597d9aeee`;
  receipt SHA256
  `6063caecb28f5c9084adb692e2e2b6cb9c0d3893c9f4dbcf1a1d66dd05f9d2bc`.
- Different actual review:
  `/tmp/nr-focused-red-actual-review61.JvpRgXV4/ACTUAL-FOCUSED-STAGE1-RED22-REVIEW.json`,
  SHA256 `cad82692f991f14f6b320ca268824228c1934d97eb76afe7b678491f35909e29`.
- ROOT acceptance:
  `/tmp/nr-main-delivery.sRvtOZvf/ROOT-FOCUSED-RED-ACTUAL-ACCEPTANCE.json`,
  SHA256 `abdaf67eacb917b97a5d8efb869a8d0d23f43a5ffe25ff2a1017e5241d395fe9`.
- ROOT retained-failure purpose:
  `/tmp/nr-main-delivery.sRvtOZvf/ROOT-PURPOSE-focused-stage1-red-22.16.0.json`,
  SHA256 `3a8d4f61e67cbced984a5f13610444a776a9f16ed0f7e44a84aa2a8f84e8de2e`.

Stage 2 ports only the already scoped shared-core placement function; all 30
focused assertions and the three installed cases remain unchanged. The author
performed only source edits and builtin DATA audits, not imports, syntax checks,
tests, installs, native/product execution, Git, commit, push or PR actions.
Subsequent accepted evidence below belongs to this released-main candidate,
not the prior composed branch.

## Accepted implementation evidence

The unchanged implementation/test bytes were verified under source
`6647c8f8c0d41dfa451da8b9cf360e2f745e5bb74892fc2649cebd5998a7d131`.
The 2026-10-05 documentation refresh changes no code, assertion, prompt,
version, default, product timer or canonical command. Short SHA256 bindings:
core `7e64d378`; focused core/OpenAI/MCP tests `a509965b`/`2d3800f2`/
`d873181b`; installed tests `efb93e74`. Counts below are actual observations,
not forced totals or semantic scores.

At the final documentation integration checkpoint, the primary personally
reran the complete focused command on both exact runtimes through the owned
runner and a cleared, keyless environment: Node 22 passed 30/30
(40,269.904333 ms), and Node 24 passed 30/30 (39,974.03943 ms), with zero skips,
cancellations or todo. JSON validation checked ten files plus consistent
version values successfully on each runtime. The same five code/test hashes
above were unchanged before and after; no provider/API request occurred.

| Canonical check | Accepted on Node 22.16.0 and 24.15.0 |
| --- | --- |
| Focused three-file command above | 30/30 passing; unchanged RED assertions |
| `npm run test:core` | 1,160 passing |
| `npm run test:openai`, `npm run test:mcp` | 314 and 113 passing |
| `npm run test:artifact` | 90 passing, including three installed NR regressions |
| `npm run test:workspace-lifecycle` | 25 passing |
| `npm test`, `npm run validate` | 591 passing; 11 JSON validation lines, not TAP |
| `npm run validate --prefix tools/plugin-validation` | Genuine pinned Claude command validation; warnings retained |
| Eleven core demos and `demo:openai-offline` | Synthetic source assertions and retained SQLite content accepted |
| Canonical pairing/Codex/client suites | 270/136/5 passing, zero skips or other nonpassing outcomes |
| Client runner `--script integrations/client/testing/golden-cli.mjs --verify` | Genuine historical Git data; unchanged canonical variants and host/profile comparisons |

The Node 24 downstream phase accepted all eight canonical steps: live evidence
340 passing plus 30 declared optional skips, LongMemEval 193 passing, long
history five passing, long-history-live three passing, and four synthetic
LongMemEval demos. Its suites total 541 passing with 30 uncovered cases:
ordinary phase completion, not full coverage. The two fresh retained demo
databases received separate read-only SQL export, different CONTENT review
(`7f801fa5`) and finite ROOT SQL acceptance (`ca5a06d1`). Different ACTUAL
review `35864e21` and ROOT purpose `b96cf7a1` accept that finite scope.

The original Node 22 downstream phase remains failed acceptance: all seven
executed commands exited zero, but a Node SQLite warning in combined
stdout/stderr broke the public-demo JSON observer; the mixed demo was unrun.
Its raw evidence, consumed choice and P2 finding remain unchanged. After
accepted Node 24 completion, Node 22 ran only that previously unrun mixed demo,
once, with separate stdout/stderr. Different ACTUAL review `1ac68326` accepts
code 0, closed streams, B=A and removed scratch. Its stdout was
`mixed-pregrant-demo-v1` with `transportDispatched:false`. No earlier
command was retried; no native Mem0 dispatch/readiness is implied.

Earlier control failures also remain history, including the first full-core
Node 22 four-minute containment expiry and retained scratch. The separately
versioned 30-minute validation envelope changed no product/test timers,
assertions, concurrency or reporter. Later accepted core results do not relabel
that attempt or explain old paid classification failures.

At this dated checkpoint, final fixed-candidate Standards/Spec review,
network-enabled clean-cache and installed-rationale CI on the actual PR head,
and remaining applicable CI are pending. Generic CI's 20/22 matrix is not
replaced by local exact 22.16.0/24.15.0 evidence. The engine/document author is
excluded from both final review axes. These engineering results establish no
semantic quality, lightweight/performance gain, installed-Hermes readiness,
provider/default improvement, paid result or new pilot score. Historical
failures and source-support limitations remain unchanged.
