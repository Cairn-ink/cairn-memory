# MOC hierarchy candidate experiment

Owner: bounded GPT-6.1 Sol/high worker; primary owns architecture, integration,
acceptance and independent review. Fixed base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/moc-hierarchy-candidates`.
Branch: `experiment/moc-hierarchy-candidates`.

The following prospective H1–H5 contract was frozen before implementation and is
retained verbatim. The execution record below does not weaken these criteria.

# Prospective H1: bounded real MOC candidate navigation

Primary decision after the closed factorial: do not expand another small-pool
source-copy/scan comparison. All four within-write answer requests were identical
between modes and there was no required-answer gain. Test the missing real
hierarchy route instead, keeping the shared memory engine authoritative.

Worktree `/home/chichieh/Github/cairn-memory-worktrees/moc-hierarchy-candidates`,
branch `experiment/moc-hierarchy-candidates`, fixed base
`ad274b6117f86446fbf0ff16f503ae69d0278ce5` (fresh origin/main).
This phase is evaluation-only candidate generation. It is NOT final retrieval,
a copied engine, a paid study, a quality-score claim or a product default.

## H1. Real existing hierarchy, bounded input-only decisions

Implement `generateMocCandidates({core,readSet,query,groupModel})` in an
evaluation-only module. Use the supplied existing public `core.map` exclusively
for hierarchy reads, with purpose recall. Support the same maximum two explicit
namespaces/order as existing recall; validate namespace/query shape locally.
Do not read SQL/files, call list/get/fetch, admit/correct/forget, or read raw.

Fixed caps, not knobs to increase until a target appears:

- Per namespace at most2rootpages,limit100,tokenBudget4000. Count ALL returned
  rows against bounds, including memory rows. Root is NOT a group-only catalog.
  Filter observed L2 MOC rows for the first model request.
- One guarded global group-model call selects at most2 observed L2 refs.
- Each selected L2 gets at most2pages,limit50,tokenBudget4000. Join visible L1
  records with real matching L2→L1 contains edges and matching revisions;
  duplicate child/header rows are not separate topics.
- One guarded global group-model call selects at most4 observed connected L1
  refs total, at most2 per namespace.
- Each selected L1 gets exactly at most1leafpage,limit6,tokenBudget4000.
  Memory candidates require matching observed L1→memory contains refs.
  At most24 candidates total/12 per namespace, dedup namespace+id+revision while
  retaining all observed path provenance. No leaf model call or final rank.
- At most1final root observation per namespace compares index revisions.
  Maximum2 group-modelcalls and14mapcalls for two namespaces (including final
  observations). Stop early on empty observed groups. No retry/repair/extra-page
  loops. Model decisions use only supplied query and exact visible group refs
  and titles, not source answers, hidden fixture constants or source bodies.

Use existing callModel for actual6000input/1024output/context/timeout checks.
Add strict visible-ref allowlist validation for each group output; no use of the
ordinary memory-select schema for group IDs. Titles/placement are untrusted
navigation hints, never truth, adoption, permission or current-state proof.
Reuse existing validation utilities where appropriate; no generic serializer,
new model SDK, protection framework or dependency.

## H2. Observation integrity and explicit incompleteness

Preserve exact namespace ordering, parent/ref revisions, opaque cursor bindings,
indexRevision and invalidRefs. Never combine namespace epochs. Index drift,
stale parent/model refs, wrong scope or model-invented refs fail without returning
a success candidate set. Do not repair stale data or swallow invalid_ref errors.
Record actual maps/model inputs/selected refs/candidate paths and resource counts.
No returned namespace or source may escape the original readSet.

Return explicit `finalRetrieval:false`, `fallbackRequired:true`,
`snapshotGuarantee:'per-call-not-atomic'`, `semanticCoverage:'unassessed'`.
Even matching final root observations do not reproduce the existing atomic
runtime.recallSnapshot guarantee. Report partial root/child/leaf pages and
truncation; not observed is NOT absent. Public root map orders L1/memory before
L2/edges/unfiled, so fixed root budgets may see no L2 at all.

Do NOT counterfeit a flat/unfiled fallback with a few arbitrary root rows.
Orphan L1s/unfiled/cross-topic/unvisited evidence can be absent in this phase.
That limitation is a gate for a later integrated policy, not a claim of complete
recall. Do not return an answer, source evidence, confidence score or authorization.

## H3. Offline falsifiable tests and test-state cleanup

Use public normal capture→source binding→classification→applied filing APIs in
fresh createTestWorkspace stores. Scripted models may create synthetic topics
from their supplied inputs; label this mechanics, not real-model semantic proof.
No SQL insertion/manual oracle memory for the positive routing fixture.

- Real two-hop L2→L1→memory path returns exact current revision and intact
  receipts; a fixed store with >36 actual eligible refs must establish the
  precondition rather than assume batch count. Keep the store unchanged.
- A red control disables only group traversal/selection (e.g. injected group
  selector returns no refs): routed target disappears while canonical captured
  memories/receipts are identical. This is a mechanics ablation, NOT the current
  default recall baseline or a semantic score. Explicitly mark that distinction.
- Cover two namespaces, cross-topic duplicate membership/provenance, unknown
  and wrong-namespace IDs, stale parent/memory/index during model call, empty
  maps and model cancellation, strict limits and group output bounds.
- Cover root truncation before L2, child pagination/dedup and leaf truncation;
  orphan/unfiled are not falsely declared absent or fully covered. Never read
  an extra page to force success. Count actual map calls/model calls.
- No writes during routing: compare canonical store snapshots before/after,
  except deliberately injected concurrency mutations in failure cases.
- Workspace cleanup on both passing and intentionally failing behavior cases,
  through existing owned runner/workspace. No historical cleanup.

Tests need no provider/key/network/operational ledger. Token counters may be
scripted for mechanics but state that they are not measured real token/cost data.
Run focused suite on Node22.16 and24.15, actual exits. Primary reruns both and
generic npm test/validate plus pinned Claude validation per CONTRIBUTING.

## H4. Integration boundary and subsequent acceptance

The core has real map(parentRef) but default recall uses flat queryCandidateRows.
core.recall accepts no supplied candidate set and ordinary select can choose
only refs visible in its own flat map. recallMemories exposes map/fetch/finalize
callbacks, but authoritative validateFresh/finalize closures are private to
openMemoryCore. Do not invent a second finalize or bypass that contract.

If H1-H3 pass, the NEXT phase may design one internal candidate-strategy seam
before existing fetch/rank/finalize, carrying hierarchical epochs into current
freshness validation and reserving bounded existing flat/unfiled fallback.
This candidate-only PR does not implement or pass that phase.

Before paid comparison require an independently frozen realistic opportunity
probe: ordinary real-model capture/classification yields >36eligible refs,
usable real groups, and required receipt evidence missing from actual flat
navigation input. Do not hand-file correct labels or add batches until success.
If absent, inconclusive/no paid QA expansion. If present and integrated safety
checks pass, freeze fresh paired24 with unchanged net≥3/24correct improvement,
targeted routing gain, no increased unsupported/stale use and no new severe
failure, plus lifecycle time/token/cost ceilings. Neither the scripted red
control nor the prior2sessions satisfies this gate. No automatic paid launch.

Full raw archive, Card governance, links discovery, vector fusion and installed
Hermes remain separate; routing cannot restore unretained sources or prevent
unsupported reasoning when sufficient evidence is already packed.

## H5. Scope, ownership, delivery

One actualGPT-6.1Sol/high worker implements only:
evaluation/architecture/moc-hierarchy-candidates.mjs;
evaluation/architecture/prompts/moc-route-l2.md;
evaluation/architecture/prompts/moc-route-l1.md;
evaluation/architecture/test/moc-hierarchy-candidates.test.mjs;
docs/plans/moc-hierarchy-candidates.md;
append docs/limitations.md.
No core/default/API/schema/dependencies/README/ROADMAP changes. The plan must
retain this prospective contract and actual evidence, not silently lower gates.
No paid calls or real ledger access. No merge/main update/release/deploy.

Primary owns architecture/integration/acceptance. Worker initial timebox40minutes;
report blockers and after implementation before final tests. Use apply_patch;
record exact test exits and two independent changed-path inventories/count.
Worker may make one scoped candidate commit after tests, never push.
Primary reads actual diff, reruns gates and invokes independent Standards/Spec
review on the same finalSHA; only then pushes a separate coherent PR.
No claim of delivered status until latest-headCI passes/mergeable. User discussion
checkpoint2026-10-17T03:09:19Z; if work cannot finish by then preserve its exact
state and report partial status, not a made-up pass.

## Execution record

- Public entrypoint: `generateMocCandidates` in the evaluation module. No existing
  core/default/API entrypoint or caller changes. Existing recall remains flat;
  a future integration seam is required before candidate results can be consumed.
- Reads are exclusively existing public `core.map` calls, bound to namespace,
  purpose, parent revision, limit, token budget and opaque cursors. At every page
  and one final root observation per namespace, compare that namespace's first
  observed index revision. No extra model freshness map calls are added.
- Group requests contain only the supplied query and visible exact group refs
  and titles. Existing `callModel` supplies token/context/output/timeout checks.
  No fetch, rank, answer, copied finalize, flat fallback or candidate insertion.
- All returned root rows consume the fixed page allowance. L1 headers and edges
  are joined across up to two child pages, with duplicate headers deduplicated.
  Candidates deduplicate namespace/id/revision and retain observed path provenance.
- All results explicitly remain incomplete; matching final observations are
  per-call observations, never an atomic cross-namespace snapshot. Changes
  after a namespace's last observation can race its result. Unfiled, orphan,
  cross-topic, unvisited and root-budget-hidden evidence may be missed.
- Positive tests use ordinary public capture, source binding, classification
  and applied filing. The fixed store establishes 40 actual eligible unique
  memory/revision refs through public map observations. Its canonical public
  memory/receipt/map snapshots are identical before routing and after both
  routed and traversal-disabled conditions. Scripted models are input-only;
  the red control is mechanics ablation, not flat recall or semantic evidence.
- Real 205-memory mixed-root fixture demonstrates 200 returned rows can consume
  both root pages before any L2. A synthetic public-map boundary fixture reaches
  exactly 14 maps and two model calls across two ordered namespaces. Synthetic
  ports isolate pagination, duplicate membership, invalid-ref and join failures;
  they are not a replacement for the real positive store.
- Owned workspace and owned runner exercise success and an intentionally failing
  subprocess, expecting actual exits 0 and 1 and no remaining child scratch.
- Initial Node22.16 focused run: exit 1, 9/10 pass; cleanup probe incorrectly used
  `--script --input-type` (the runner requires a script file). Corrected once to
  re-enter this test file with a synthetic probe flag. Next Node22.16 run: exit 0,
  10/10 pass. No algorithm gate was lowered. Final expanded-suite results follow.
- Final focused commands, each through the owned runner:
  `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/moc-hierarchy-candidates.test.mjs`
  and the same command with `v24.15.0`: both actual exits 0, 13/13 tests, no skips.
  Cleanup subprocess assertions require actual exits 0 and 1, respectively.
- `git diff --check`: actual exit 0. Scope inventories independently derived
  from `git status --porcelain=v1 --untracked-files=all -z` and
  `git diff --name-only` plus `git ls-files --others --exclude-standard` match:
  six files, exactly the H5 allowlist. Default status collapsed the new prompts
  directory; the explicit all-files inventory caught and resolved that listing
  difference without a scope change.
- No paid provider, key, network, ledger, operational configuration or production
  access. No dependency write/install. Counter `() => 1` is synthetic and does
  not measure provider token use, cost, context realism or semantic quality.

Primary must inspect the actual diff, rerun contributor gates and invoke both
independent review axes against one final SHA before any push/PR. No push,
merge, deployment or paid follow-up is authorized by this candidate experiment.
