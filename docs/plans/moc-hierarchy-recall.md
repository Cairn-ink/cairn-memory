# Opt-in hierarchy recall integration

Frozen prospective contract follows verbatim; execution evidence is appended below it.

# Prospective H2: opt-in MOC recall integration

Primary decision2026-10-17, before implementation. User objective remains a
lightweight reliable shared memory engine, short-term algorithm/first-answer
improvement. H1 mechanics alone are not usable recall; this phase joins those
candidates to the existing engine, not a second engine or a new benchmark.

Fixed dependent basebcf3586a9a8e5e3543e28e9be56d86ae2b7f5546 (PR433), main
basead274b6117f86446fbf0ff16f503ae69d0278ce5. Worktree
/home/chichieh/Github/cairn-memory-worktrees/moc-hierarchy-recall,
branchexperiment/moc-hierarchy-recall. No main merge or default promotion.

## I1. One opt-in selection strategy, unchanged authoritative engine

Add `selectionMode:'moc-hierarchy-v1'` to core.recall, valid ONLY with
`contextMode:'source-evidence'`. Unknown options, wrong context and conflicting
modes remain invalid_input. Omitted option and bounded-source-scan retain their
existing behavior, requests, results and limits. No host/MCP/hook activation.

Move/reuse H1 mechanics into a core-owned module and core-owned prompts; core
must never import evaluation code. Keep the existing evaluation wrapper's
public-map semantics and all13 H1 tests intact. A small adapter can map its
existing groupModel.select to the new internal selectGroups port. Do not copy
the hierarchy algorithm or finalizer into two independently maintained engines.

Branch only candidate selection. All candidates then use existing fetch,
source packing, rank and runtime.recallSnapshot finalization. Do not change
runtime.recallSnapshot signature/body, source receipts, source-mode atomic
packing, rank prompt, rank quota, sourceCandidatePolicy or answer behavior.
No public supplied-candidate API or arbitrary callback that bypasses validation.

## I2. Non-starved catalog, exact route and freshness

Use a PRIVATE L2-only recall catalog filtered BEFORE pagination. It must not
include memory bodies, L1 groups, empty/non-current groups, other namespaces or
outdated titles. Reuse current revision-matched L2->L1->memory visibility rules.
Do not repurpose classification catalog or alter public map ordering/behavior.
Bind private cursor purpose separately; it cannot continue public/classification
maps or wrong namespace/parent/epoch. Existing parent-child map behavior stays.
Physical SQL work/latency is NOT established merely by limiting returned rows.

Keep H1 fixed traversal caps: <=2rootpages/ns, <=2selectedL2total,
<=2childpages/selectedL2, <=4selectedL1total/2pernamespace,
<=1leafpage/L1 with6rows, <=24hierarchyrefs/12pernamespace. Retain actual path
provenance, partial-page/resource evidence, exact tuple allowlists and no retries.
Keep H1 final observations (simpler shared algorithm); integrated total map cap
is therefore16, not14 after adding the two possible fallback pages.

Collect the first trusted index epoch of EVERY namespace read by hierarchy or
flat fallback. All subsequent pages and model callbacks must retain that epoch.
Supply these epochs to the existing validateFresh/finalize closures so the final
runtime.recallSnapshot transaction validates all namespaces and exact returned
source evidence. Matching public observations alone must NOT be called atomic.
Pass trusted validateFresh into guarded group calls as with select/rank: counter
or asynchronous mutations must fail before further provider work/return.

Invalid refs, stale state, bad model output, cancellation, timeout, count failure
or provider failure reject the request. Do not silently fall back after an error,
repair data, reread new epochs or return partial success from a failed strategy.

## I3. Bounded ordinary-search reserve and honest resource accounting

Always reserve up toONE existing flat queryCandidateRows-backed map page per
namespace and up toONE ordinary select call with12maximum total refs and12per
namespace. Use existing query ranking/excerpts and packSelect; it includes
eligible unfiled/orphan candidates but does not guarantee their recall. Empty
hierarchy decisions still permit this reserve; no groups means no group call.

Interleave the fallback and hierarchy sequences, fallback first, deduplicating
namespace/id/revision and retaining route provenance. Maximum36unique total and
24pernamespace (one-namespace maximum24); do not fill unused quota by extra
pages/calls. Duplicate memberships never trigger duplicate fetches.

At most16maps,2group calls,1flat select and1rank. Existing per-map4000 and per-model
6000input/1024output/8192minimum context/30second call timeout remain unchanged.
This is a maximumFOUR model-call policy versus default's maximumTHREE: local
input ceiling24,000 vs18,000 and output4,096 vs3,072. It is NOT equal total budget
or a lightweight improvement. Actual physical requests/provider tokens are a
later measured gate. Source-mode packRank may still omit whole candidates:
record/test the actual rank-visible set and omissions, not only selected refs.

Return selection metadata that truthfully identifies the opt-in strategy,
bounded fallback, candidate/path/resource evidence and unassessed semantic
coverage. Overall coverage stays budget_exhausted/incomplete for this policy;
do not claim exhaustive semantic coverage even when observed pages end. No
memory/source bodies beyond authorized existing results are exposed by audit.

## I4. Real adapter wire without broadening paid authority

Add explicit dynamic-only selectGroups schema/method. Group refs use mocId,
not disguised memoryId. Strict input shape and exact visible tuple validation,
stage limits and duplicate rejection must apply before/after serialization as
appropriate. Explicitly use the existing select model profile. Preserve local
6000, provider7024, output1024, count-before-generate, cancellation and transport
handling. Add selectGroups to diagnostics where necessary; no pricing/model
profile changes, new dependency or new model credential.

Do NOT add selectGroups to the exported legacy schemas/method allowlist or
change any live budget/guard/capability. Existing live guard must continue to
reject the new method. Fake HTTP proves actual schema/port integration only;
paid route needs separately scoped acceptance. No live run in this contract.

## I5. Falsifiable offline acceptance

Use fresh owned workspaces and ordinary capture/classification for positive
real-store fixtures; no direct SQL/manual oracle filing for positive claims.
Test at least:

- Default and bounded-source-scan behavior unchanged, no selectGroups calls
  without explicit opt-in; primary additionally compares predecessor/current
  default requests/results on an identical captured store.
- >36actualeligible refs with real connected groups, exact receipts, immutable
  canonical before/after snapshots, and a hierarchy-only target reaching actual
  rank input/result. Label scripted mechanics, not semantic quality.
- >200memory mixed-root starvation is overcome; >200L1 groups cannot starve
  the private L2-only catalog. Private cursor/namespace isolation and public
  classification/map regressions remain intact.
- Empty group selections/no groups retain bounded actual flat fallback; errors
  do not become fallback success. Unfiled/orphan positive fallback target and
  cross-topic dedup/provenance; both namespace orders and resource limits.
- Mutation during either group call, ordinary select, rank, input/output token
  callbacks and asynchronous microtasks fails through authoritative freshness;
  discarded indexes, corrections and forget cannot return stale source evidence.
- Rank packing omissions remain honest; selected does not imply packed or used.
- Actual fake-HTTP adapter path through core with strict group wire, exact
  visible domains, cancellation/context failures, and unchanged legacy-guard
  denial. No new provider call may start after authoritative freshness failure.
- Success and deliberate failure leave no unexpected owned scratch; no historic
  cleanup. Synthetic counters are not real token/cost/context-quality evidence.

Worker runs focused core/adapter/H1 suites on Node22.16/24.15 with actual exits;
primary reads full finaldiff and personally reruns them plus relevant contributor
gates: generic npmtest/validate/pinnedClaude; full core and store/moc/recall demos;
full OpenAI suite/offline demo on both runtimes. New adapter dependencies use the
existing lockfile and install contract. No TypeScript gate exists.
Independent nonauthor Standards and Spec must review one finalSHA; any change
after review requires affected checks and both axes again. Record known failures,
corrections and two independently derived changed-path inventories/count.

## I6. Ownership, file boundary, timing and subsequent gate

One actualGPT-6.1Sol/high worker implements the whole coupled seam. Allowed:
core/moc-recall-candidates.mjs;core/prompts/moc-route-l1.md;
core/prompts/moc-route-l2.md;core/contract.mjs;core/moc-storage.mjs;
core/recall.mjs;core/model-diagnostics.mjs;core/test/moc-hierarchy-recall.test.mjs;
adapters/openai/index.mjs;adapters/openai/schemas.mjs;
adapters/openai/test/moc-hierarchy.test.mjs;
evaluation/architecture/moc-hierarchy-candidates.mjs;
evaluation/architecture/prompts/moc-route-l1.md(deletion after move);
evaluation/architecture/prompts/moc-route-l2.md(deletion after move);
docs/plans/moc-hierarchy-recall.md;appenddocs/limitations.md;
docs/local-store.md;docs/openai-provider.md;CHANGELOG.md.
If caller tracing establishes another required contract doc/test, report before
expanding scope. No package/schema DB migration, runtime.mjs, host/MCP/hook,
paidguard/ledger, oldclosedresults, README,ROADMAP or main changes.

Retain this prospective contract verbatim in the new plan, then execution record.
Use apply_patch. Report at interface completion, test completion or blocker;
initial worker timebox50minutes, checkpoint01:35UTC. Freeze one scoped local
candidate only after focused gates; do not push. Primary owns integration,
acceptance and PRagainstmainwith explicitPR433dependency. No merge/release/deploy.
Mandatory user discussion03:09:19UTC; preserve partial work if unfinished.

Even a fully green integrated implementation does not pass semantic quality.
Next gate remains independently frozen real-model opportunity (>36eligible,
real groups, required source absent from actual flat navigation) before any
fresh paired24; no hand-filing/add-batches-until-success. No opportunity means
inconclusive/no paid expansion. Formalqualitygateunchanged:net>=3/24correct,
targetedroutinggain,noincreasedunsupported/staleuse,nonewseverefailure,
lifecycle time/token/cost ceilings. Realistic opportunity, raw archive, Card
governance, link discovery, vector fusion and installed-Hermes value remain open.

## Execution record

Implementation owner: GPT-6.1 Sol/high, one coupled worker. Primary owns acceptance
and independent reviews. No paid execution, default activation or merge.

Primary coordinated a dependency fast-forward to H1 correction
`4689b491986da847fcd9a662a4d9bcc640c143f7`, preserving these working changes.
The prospective original base above is retained verbatim; incremental H2 review
uses this corrected dependency. H1's supported-runtime harness now executes six
synthetic cases on Node20 and explicitly skips seven native SQLite cases there.

Pre-test clarification approved by primary: ordinary classification reads at
most 100 catalog rows and refuses to invent new groups when that catalog is
incomplete. Therefore the >200-L1 stress fixture may use existing public filing
APIs solely to generate unrelated structural load, with no SQL and no manually
filed oracle recall target. The >36 eligible-reference/hierarchy-target positive
fixture still uses ordinary capture/classification end to end. This does not
establish real-model opportunity, semantic quality or ordinary-capture scaling
to 200 L1 groups.

Primary's pre-wire inspection found repeated full-object tuple `anyOf` schemas
bloated local o200k wire estimates: 60 groups counted 2,379 core-envelope tokens
but 7,276 serialized wire tokens; 100 counted 3,859 versus 11,956. These are local
estimates, not provider counts/invoices. Use compact distinct scalar domains
and enforce exact tuple membership independently in adapter and core. Preserve
all 6,000/7,024/1,024 limits; no budget expansion or relaxed tuple validation.

Each selected L1 currently contributes its first six public-map refs in memory-ID
order. Leaf retrieval is not query-aware within the topic; relevant later refs
can remain outside the candidate set. This integration and its scripted target
do not establish semantic gain or a real flat-invisible opportunity. Four model
calls permit 24,000/4,096 local input/output ceilings versus baseline's three
calls and 18,000/3,072. No equal-budget/lightweight claim follows.

Primary caller tracing found an integration blocker: the explicit
`packaging/artifact-files.json` runtime allowlist omitted the new unconditionally
imported core module and its two prompts. A built installed default core would
fail to import, even without opt-in. Primary explicitly expanded the boundary
to that manifest plus `packaging/test/moc-hierarchy-recall.test.mjs` (21 paths
total). Add the three runtime paths and test an actual built/offline-installed
archive's default and opt-in core paths using its installed OpenAI adapter and
input-only fake HTTP. No source-tree copying, host/MCP activation or paid guard
expansion. This is a primary-found delivery integration correction; the
prospective contract above remains unchanged.

### Implementation and caller trace

- `core.recall` validates the source-evidence-only option, supplies private L2
  catalog/parent-map closures, and registers the first trusted epoch of every
  namespace. Shared candidate navigation owns no storage writes or finalizer.
- Only candidate selection branches in `recallMemories`: at most 24 hierarchy
  refs join at most 12 refs from one ordinary query page per namespace and one
  ordinary `packSelect`/select call. Fallback-first interleaving deduplicates exact
  refs and retains routes. Existing fetch/source packing/rank/finalize remain
  authoritative. Selection audit projects only IDs, revisions, relations and
  page/resource metadata, plus actual rank-visible/omitted refs.
- `validateFresh` and finalization use all observed namespace epochs through
  existing `runtime.recallSnapshot`. `git diff --quiet 4689b49 -- core/runtime.mjs`
  returned actual exit 0: its body/signature are unchanged. Public map and
  classification regressions cover the shared visibility-expression extraction.
- OpenAI `selectGroups` validates strict input before serialization and exact
  output tuples after decoding; it uses the select profile, existing guarded
  count/generate transport and unchanged budgets. Legacy exported schemas and
  live guard authority are unchanged. Fake HTTP verifies a freshness failure
  queued by group input counting starts zero HTTP requests.
- Actual tarball installation verifies default import and opt-in recall from
  the installed core/adapter, all three new runtime-path hashes, and the builder's
  independent manifest/tar listing comparison (98 archive files). No host/MCP
  option was activated. No package lock, DB migration or model profile changed.

### Verification and corrections

Worker checked that `adapters/openai/node_modules` did not exist, then ran
`npm ci --prefix adapters/openai`: actual exit 0, existing locked dependency
only. No shared install was removed. Primary separately prepared the existing
locked MCP dependencies and public npm metadata cache for installed gates.

The first new core integration suite returned actual exit 1 (one passed, eight
failed): its scripted rank fixture incorrectly read `memory.content`, which the
existing source-evidence projection intentionally omits. Corrected the fixture
to inspect exact receipt excerpts and compare the existing closed source
receipt projection. Moved the cleanup-probe branch ahead of test registration so
its child executes only the intentional behavior check. The next run returned
actual exit 0, 9/9 passed. No source projection or acceptance gate was weakened.

Focused commands use the owned runner. For each command below, `NODE` was both
`/home/chichieh/.nvm/versions/node/v22.16.0/bin/node` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin/node`:

- `NODE tools/testing/run.mjs core/test/moc-hierarchy-recall.test.mjs adapters/openai/test/moc-hierarchy.test.mjs evaluation/architecture/test/moc-hierarchy-candidates.test.mjs core/test/recall.test.mjs core/test/moc.test.mjs core/test/classification-catalog.test.mjs`:
  actual exit 0 on each runtime, 59/59 tests, no skips. This preceded the final
  additional cross-topic and failure-fixture assertions, with no later runtime
  behavior changes.
- Final affected suites:
  `NODE tools/testing/run.mjs core/test/moc-hierarchy-recall.test.mjs adapters/openai/test/moc-hierarchy.test.mjs evaluation/architecture/test/moc-hierarchy-candidates.test.mjs`:
  actual exit 0 on each runtime, 31/31 tests, no skips (12 integration, six adapter,
  13 unchanged H1 cases).
- `NODE tools/testing/run.mjs packaging/test/moc-hierarchy-recall.test.mjs`:
  actual exit 0 on each runtime, 1/1 actual archive-installed test, no skips.
- `/tmp/node-v20.19.0-linux-x64/bin/node tools/testing/run.mjs evaluation/architecture/test/moc-hierarchy-candidates.test.mjs`:
  actual exit 0, six synthetic cases passed and seven native SQLite cases
  explicitly skipped; those skips are not native-runtime passes.

The 40-reference positive store and three-memory cross-topic store use normal
capture/source binding/classification throughout and preserve canonical public
snapshots. Real 205-memory starvation and approved 206-L1 structural load are
separate cases. Negative cases cover both namespace orders, stale refs,
correction/forget/unavailable index, group/select/rank and counter/microtask
mutations. Cleanup children require actual exits 0 and 1, respectively, and
leave no child scratch. A scripted timeout exercises port failure propagation;
this is not a measured 30-second provider wait or performance result.

The same-payload local o200k wire check counted 5,908 tokens for compact domains
versus 12,048 for repeated full-object tuple schemas, retaining exact adapter
and core tuple validation. Fake provider counts are synthetic. Multiple bounded
map pages can still produce an aggregate group envelope that fails the existing
6,000-token guard; no extra call/page or raised limit repairs it.

Two independently derived scope inventories (`git status --porcelain=v1
--untracked-files=all -z`, and `git diff --name-only` plus
`git ls-files --others --exclude-standard`) agree: 21 approved paths, including
the primary-approved packaging expansion. The prospective I1–I6 contract was
checked verbatim against the frozen source; actual exit 0. Final staged/diff
whitespace checks and committed inventories are handed to primary with the SHA.

Primary owns the predecessor default/parity comparison, full contributor/core/
OpenAI/installed gates, direct final-diff acceptance and both independent review
axes. No push, merge, provider/key/operational ledger access or paid follow-up
occurred in this worker implementation. Semantic opportunity and paired quality
acceptance remain open.
