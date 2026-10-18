# H4: ordinary-topic entry with preserved flat-search opportunity

Prospective primary contract, frozen before implementation on 2026-10-18 UTC.
This is stage one of the user-approved algorithm plan, not a quality result.
Goal: a lightweight, source-backed reliable memory engine. Short-term success
means better first answers, not simply more tests or more model calls.

Fixed base: `872fd921ccb8519777840a373743d7a911073982` (PR435).
Main remains `ad274b6117f86446fbf0ff16f503ae69d0278ce5`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/moc-standalone-entry`.
Branch: `feat/moc-standalone-entry`. This is a dependent PR against main;
no main merge, default activation, release, deployment or paid run belongs here.

## A1. One versioned opt-in on the existing engine

Add `selectionMode: 'moc-hierarchy-v2'`, valid only with
`contextMode: 'source-evidence'`. Preserve default, bounded-source-scan and
moc-hierarchy-v1 model requests/results/limits. Keep the existing canonical
fetch, whole-source packing, rank and runtime.recallSnapshot finalizer, and
their current permission/freshness authority. No new public supplied-candidate
port, second engine, storage migration or hidden replay.

Do not change capture/classification prompts or policy, force L2 creation,
source receipts, raw retention, Card governance, relation discovery, vector
integration, provider profiles, operational ledgers, guards or host settings.
No MCP/hook/Hermes activation. No public map/classification behavior change.

## A2. A real standalone-L1 entry alongside connected groups

Keep the independent current L2 catalog. Add a PRIVATE standalone-L1 catalog
filtered before paging through the same active-generation projected readers.
An eligible L1 has a valid same-namespace current, nondeleted, nonawaiting,
revision-matched memory membership and no valid projected L2 parent. The
anti-join considers ALL valid current same-namespace projected parents and
revision-matched edges, not merely selected/visited parents. An unvisited valid
parent still makes its child connected. Stale or foreign edges do not.

Use at most one standalone page per namespace, limit100/tokenBudget4000,
with the existing extra-row continuation sentinel. Keep its cursor purpose
separate from public/root/classification/query cursors, bound to store,
namespace, epoch, limit and budget. Parent/navigation/classification use of
this private lane is invalid. Never query raw declarations to bypass a
discarded/staged generation or create a false standalone candidate.

Read this lane even when L2 roots exist. Combine eligible standalone L1s and
actually joined selected-L2 children for the bounded L1 decision. Use a new
standalone-aware L1 prompt; preserve the old v1 prompt bytes. A standalone
path records its actual L1 and L1-to-memory edge, with an explicit origin and
no fabricated L2. A connected path retains actual L2/edge/L1/leaf identities.
Deduplicate namespace/id/revision while retaining observed route origins.

## A3. Whole-group packing with explicit opportunity and work bounds

Keep selectGroups wire unchanged: only query/maps/maxRefs/maxRefsPerNamespace,
and existing namespaceIndex/mocId/revision/title group fields. Origin/omission
metadata stays out of the model input and outside hosted telemetry.

Use deterministic private lanes. L2: namespace order. L1: namespace order,
standalone then connected within each namespace. Preserve order within each
lane. First reserve the first whole group from every nonempty lane. If that
bundle or the empty envelope cannot fit the existing6000-input limit, reject
explicitly before model execution; do not pretend all origins were represented.
Then visit remaining groups once in round-robin lane order, adding each only
if the complete request fits. Do not shorten titles/identifiers/revisions or
assume token-count monotonicity on fragments. Packing performs at most N+3
fit checks for N observed distinct groups; N<=400/stage under these page caps.
Count and document actual fit checks, not provider billing.

Validate model output against only the packed exact tuple allowlist. Record
exact observed packed/omitted references and counts, separately from unread
page tails whose total size is unknown. No source bodies in new public audit
fields. Empty/limited navigation is not exhaustive semantic coverage.

Bounds: existing <=2L2 root pages/namespace, <=2selectedL2 total,
<=2child pages/L2, <=4selectedL1 total/2pernamespace, one6-row leaf page/L1;
<=24hierarchy candidates/12pernamespace. With standalone and final epoch
observations, <=16hierarchy map calls, plus <=4flat maps = <=20total.
Group model calls<=2, flat calls<=2, rank<=1: <=5 versus default<=3.
At most36unique chosen refs/24pernamespace; canonical fetch can use two pages
per identity, so <=72actual fetch calls. These are not equal-cost or SQL-work
guarantees. Keep6000input/1024output/8192minimum context/30-second calls and
the adapter's provider-token guard unchanged. No retry or extra-page loops.

## A4. Preserve the actual two-round flat exposure

Reuse existing default cursor-following flat selection, packSelect and quotas:
<=24 refs/call, <=36cumulative, <=12pernamespace/perround. Maintain a separate
flatChosen through BOTH rounds. Round-two maxRefs depends only on earlier flat
choices, not hierarchy refs. Actual serialized maps/IDs/revisions/labels and
quota inputs must match default for the same stable store/query/counter and
identical scripted first-round choices. No promise of identical stochastic
choices. Check0/12/24first selections, both namespace orders and skew.

Give all selected flat refs fetch priority before admitting hierarchy-only
refs within the same <=36total/24pernamespace capacity. Overlap adds actual
provenance rather than duplicate fetch identities. Report skipped hierarchy
capacity refs explicitly; if flat selection fills capacity, no extra hierarchy
opportunity is promised. Flat-priority is not a guarantee of identical later
rank/answer visibility after source packing. Keep all omission boundaries honest.

Validate trusted epochs before/after map, counting and model work and at final
atomic snapshot. Mutation, invalid refs, cancellation/provider/counter failures
must not become successful fallback or a repaired partial response.

## A5. Falsifiable verification

Positive retrieval fixtures use ordinary capture/classification, retained source
bindings, cold reopen and actual core/adapter fake HTTP. No direct SQL/manual
oracle filing for the positive target. Structural unrelated catalog load may
use existing public placement APIs, labeled as structural rather than model
quality evidence. Test at least:

1. Standalone-only: an actually captured leaf reaches fetch, rank and final
   recall with intact source. A group-disabled control loses that path on the
   same store. Adding an unrelated connected L2 does not remove the standalone
   group from the packed L1 opportunity when its reserved bundle fits.
2. Mixed connected/standalone with both namespace orders; valid unvisited and
   multiple parents; stale/foreign links; current versus staged index generation.
3. Many L1s cannot crowd out the separate L2 catalog. Oversized aggregate group
   inputs obey6000, preserve lane reservation, report exact omissions, reject
   omitted/invented tuples and expose unread tails as unknown.
4. The actual flat second-page target and model-input parity under0/12/24first
   choices; full/residual capacity, namespace skew and cross-path overlap.
5. Deleted/historical/awaiting/stale evidence cannot return; mutations at group,
   counter (including queued microtasks), flat select, fetch and rank boundaries
   cannot pass trusted freshness. Errors, empty stores and cursor substitutions
   retain existing failure behavior. No provider call after known invalidation.
6. Default, bounded-source-scan and v1 keep existing serialized behavior, calls
   and results. New mode validates correctly and old contexts remain invalid.
7. Exact counted map/model/fit/fetch work bounds; before/after canonical stores
   unchanged except deliberate failure-injection mutations. Success and intended
   failure leave no unexpected owned scratch, including child processes.
8. Built and offline-installed archive bundles every new runtime/prompt, imports
   installed core and actual OpenAI adapter, and exercises both old and v2 paths
   with fake HTTP. Independently compare manifest and archive paths/hashes.

Run focused suites on Node22.16.0 and24.15.0, then full core/OpenAI/artifact and
generic contributor checks, validate, pinned Claude marketplace+strict plugin,
owned store/MOC/recall demos. Existing CI covers MCP; run its local suite too
when caller tracing or changed installed packaging requires it. No TypeScript
gate exists here. Record actual exits, failures and diagnosis; no blind green
rerun, weakened assertion or relabeled semantic success.

Primary inspects actual diff and personally reruns key integrated paths on final
combined candidate. Derive changed inventories through Gitdiff and full-tree
mode/blob comparisons; print counts. Non-author Standards and Spec independently
review the same fixed base/finalSHA. Revisions rerun affected gates and both axes.
Only after local acceptance may primary push a PR against main and supervise
all latest-head CI until complete or a documented real blocker. Never merge.

## A6. Ownership, scope and supervision

Actual implementation: one GPT-6.1 Sol/high worker. Primary owns this prospective
contract, integration and acceptance; worker appends execution evidence without
rewriting it. Allowed paths (request before expansion):

- core/contract.mjs
- core/moc-storage.mjs
- core/moc-recall-candidates.mjs
- core/recall.mjs
- core/moc-group-packing.mjs (new)
- core/prompts/moc-route-l1-v2.md (new)
- core/test/moc-standalone-recall.test.mjs (new)
- core/test/moc-group-packing.test.mjs (new)
- core/test/moc-hierarchy-recall.test.mjs (only additional regression coverage)
- adapters/openai/test/moc-standalone.test.mjs (new)
- packaging/artifact-files.json
- packaging/test/moc-hierarchy-recall.test.mjs
- docs/plans/moc-standalone-entry.md
- docs/local-store.md
- docs/openai-provider.md
- docs/limitations.md (append)
- CHANGELOG.md

Worker traces existing public/evaluation/installed callers and records each
affected check and owner. No UI/browser/URL change is expected; confirm rather
than invent a browser task. Worker reports interface completion, focused results,
blockers and at least every20minutes during implementation. After two failed
correction rounds on one issue, escalate/rescope rather than repeat blindly.
Worker does not push, merge, call providers or read live credentials/ledgers.

Turn began2026-10-18 15:58:13UTC; discussion checkpoint approximately
2026-10-19 03:58UTC (12hours). Primary remains active while jobs run, checks
progress/logs/exits, and investigates a long gate with no output for120seconds
using actual child activity rather than PID alone. No unattended local paid job
or promise of background agent supervision. Stop starting long work before the
checkpoint; do not end with an unmonitored job. CI notification settings are not
assumed. Pause for user decisions or the agreed discussion, not routine approvals.

## Next stages, not claimed by H4

H5 separately tests bounded frequency-aware lexical ranking with unchanged LLM
call count. Query-aware leaves are a separate measured hypothesis, not silently
added here. Freeze new cases and necessary-source rubrics before any paid run;
do not tune/replay the consumed H3 case as fresh success. Two new real diagnostic
cases precede any24-case quality comparison; no hierarchy opportunity means
inconclusive, not a reason to hand-file or keep selecting until it works.

Quality gate remains net>=3/24correct versus old, targeted benefit without more
unsupported/stale use or a new severe failure; compare resource-matched flat
search before claiming a routing-specific gain. Later fresh30 must complete>=29
and reach>=same-batch Mem0, counting incomplete cases. These are internal
progression gates, not certification or proof of competitive parity.

Last verified cumulative reservation342.162281/400USD, protected30USD. Recheck
original ledger before paid work; do not reset/refund or treat remaining27.837719
as sufficient for every later cohort without a cost estimate. No paid call in H4.

## A7. Prospective acceptance clarifications after independent feasibility review

Primary decision2026-10-18, before the new integrated acceptance cases run.
The original A1-A6 wording above remains unchanged.

- Freshness preserves existing authority: each namespace anchors at its first
  trusted map/index observation, not at function entry or before any local
  token-counter callback. A mutation before that namespace's first observation
  may become its initial snapshot. Test that boundary explicitly, including
  a not-yet-observed second namespace, and distinguish it from any mutation
  after anchoring, which must reject before further model work/return.
  Finalization still validates every observed namespace atomically. This is
  not a promise of an invocation-start snapshot or a new concurrency model.
- A5.1's group-disabled control must lose the target from actual canonical
  fetch, rank input and final recall, not merely lose hierarchy provenance.
  Hold the store/query/counter and scripted flat choices fixed. The ordinarily
  captured, cold-reopened standalone target must reach all three stages with
  group selection enabled and none with that selection disabled. No hidden
  oracle data enters a model call. Label this an offline mechanics control.

## Execution record

Primary inspected current contributor/CI requirements and the existing H2/H3
code/evidence. Read-only worker feasibility confirmed projection/cursor reuse,
unchanged strict adapter wire and the two-page-per-identity fetch bound.
Primary verified PR435 samehead/all31SUCCESS/MERGEABLE and marked ready;
no merge. Parent/main promotion work and privatewiki untracked files preserved.
New worktree created from872fd9; isolated locked adapter dependencies are being
prepared offline after confirming no existing node_modules/symlinks.

### Worker implementation and focused evidence

Implemented H4 only on the fixed dependent base. Private projected standalone
catalog/cursor, reserved whole-group packing and new L1 prompt feed the existing
shared helper and canonical recall. V2 reuses the actual default flat loop;
hierarchy refs are merged only after both flat decisions. The existing final
fetch, source packing, rank and atomic snapshot remain authoritative. No host,
capture/classifier, adapter runtime/schema, provider profile, ledger or H5 change.

The initial new focused run exited1 (8/9passed): the deliberate fetch-count
mutation correctly returned the existing `cursor_stale` error, while the new
test expected revision/index conflict. Inspection of runtime.fetchPage confirmed
the existing expectedEpoch guard. The corrected test specifically requires
`cursor_stale` at fetch; it does not broaden accepted errors for that boundary.
The rerun and expanded focused gates below passed. No provider was contacted.

Actual Node22.16.0 and24.15.0 focused results, each through the owned runner:

- New standalone core, whole-group packer, actual adapter fake HTTP and installed
  archive suites: exit0 on both runtimes, 20/20tests each. The installed test
  independently compared100manifest/archive paths and verified hashes for five
  hierarchy runtime/prompt paths, then exercised default/v1/v2 from installed
  imports. Ordinary captures and cold reopen retained exact source passages.
- Existing v1 integrated/helper architecture regressions plus packer units:
  Node22.16 exit0, 28/28tests. Primary owns the complete two-runtime broad gates.
- Deliberately failing cleanup children returned expected exit1; successful
  children returned exit0. Both left empty owned scratch roots. These expected
  child failures are assertions inside the passing focused cleanup gate.
- `git diff --check`: exit0. Final changed inventory was derived from Gitdiff
  plus untracked paths and independently compared against the full base tree's
  mode/blob hashes:16changed paths, all inside A6. The optional existing
  core/test/moc-hierarchy-recall.test.mjs was left unchanged.

The new core coverage includes real standalone-only and mixed groups, both
namespace orders, zero-fetch/no-rank group-disabled controls under fixed empty
flat choices, current exact source retention, 0/12/24first-flat-choice input
parity, full/residual flat capacity and overlap, exact observed packing omissions
versus unknown unread tails, omitted tuple rejection, all-parent anti-join beyond
visited roots, multiple parents, active/discarded/staged projection authority,
stale/foreign parent links, deleted/historical/awaiting/stale membership exclusion,
group/count/queued-count/flat/fetch/rank mutation boundaries, A7pre-anchor and
unobserved-second-namespace boundaries, whole-source rank omissions and exact
helper16-map/2-model/24-leaf ceilings. These are scripted mechanics assertions,
not semantic measurements or paid-run authorization.

Caller and installed-artifact checks traced before handoff:

| Entry/caller | Affected check | Owner |
| --- | --- | --- |
| Embedded contract/default/v1/v2 recall | New focused core cases; complete core suite and store/MOC/recall demos | Worker focused; primary broad |
| Architecture wrapper of shared MOC helper | Existing moc-hierarchy-candidates tests; generic npm test | Worker focused; primary broad |
| Dynamic OpenAI selectGroups and canonical core | New fake-HTTP capture/reopen test; existing group wire tests/full OpenAI suite | Worker focused; primary broad |
| Installed local artifact | Manifest/archive path/hash cross-check; installed default/v1/v2 fake HTTP; full artifact suite | Worker focused; primary broad |
| MCP embedded-core caller | Existing host supports bounded-source-scan only; no new activation; local MCP suite | Primary |
| Marketplace/plugin/validation | Existing contributor checks and pinned strict validations | Primary |

No UI/browser/URL change is present. Primary's independent prefreeze harness
reported exit0 after212ordinary captured memories,24exact predecessor/current
old-mode request/result comparisons (two counters including actual o200k_base,
three namespace sets) and12v2/default flat exposure comparisons. Primary will
repeat key acceptance against the final combined candidate and run independent
Standards/Spec reviews on one fixed finalSHA. No worker commit or push has been
made at this checkpoint; primary retains delivery ownership.

The final additional catalog-overflow fixture retained two distinct setup/
expectation failures, both on Node22.16 and24.15:

- First narrow run: exit1 on both. Creating another topic after an ordinary
  classification catalog became incomplete returned classification status
  `failed`/`invalid_model_output`, before recall. That existing safety boundary
  is preserved. The revised test captures its positive targets ordinarily first,
  then creates105unrelated structural groups with public applyPlacement, using
  captured receipt titles and preserving the original memberships. This is
  explicitly structural load, not evidence of classification quality at scale.
- Expanded run: exit1 on both (20/21passed). The connected group was selected
  and visible, but the default final rank limit6 selected six standalone leaves
  before the seventh connected source. The test now requests supported limit12
  to verify both sources at final output. This does not promise that default
  limit6 returns both origins. Failed expanded logs were retained separately as
  `/tmp/cairn-h4-worker-checks.UIeN6e/node22-focused.log` and
  `/tmp/cairn-h4-worker-checks.UIeN6e/node24-focused.log`; final reruns use new paths.

The exact final focused invocation uses `tools/testing/run.mjs` with
core/test/moc-standalone-recall.test.mjs, core/test/moc-group-packing.test.mjs,
adapters/openai/test/moc-standalone.test.mjs and
packaging/test/moc-hierarchy-recall.test.mjs. Node22.16 uses `node`; Node24.15 uses
its absolute versioned binary. Actual completion codes are captured before
printing any log tail. No failed assertion or runtime classification threshold
was relaxed.

Final expanded focused completion: exit0 on Node22.16.0 and24.15.0,
21/21tests on each runtime. Full retained logs:
`/tmp/cairn-h4-worker-checks.UIeN6e/node22-focused-final.log` and
`/tmp/cairn-h4-worker-checks.UIeN6e/node24-focused-final.log`.
The prospective prefix through A7 was independently hashed after the execution
append and still equals
`d49cfc464256d7b958f78040cda9ff9f721d122d1be072d4cfa83e7677267c36`.
Worker is freezing this scoped candidate for primary broad acceptance and the
two independent reviews; no paid call, host activation, push or merge occurred.
