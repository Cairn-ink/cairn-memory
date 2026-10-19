# Source-time producer and answer consumer (T2)

Prospective contract, recorded before implementation. Primary DRI owns scope,
integration acceptance, commit, independent Standards/Spec review and PR delivery.
Implementation worker: actual GPT-6.1 Sol, high reasoning, isolated branch
`feat/source-time-consumer`, exact dependent T1 base
`98c6c6fdb5595ff40535b4c9df58b3eb4a7e58db`. T1 is an accepted unmerged dependency.
No worker commits, pushes, subagents, paid calls, provider/configuration reads,
user databases, corpus/reference/gold/ledger access or closed-H6 replay.

## Frozen scope

Add explicitly selected source-time indexed-evidence planner/ingester exports to
`evaluation/longmemeval/ingestion.mjs` and a separately versioned synchronous
`source-time-answer.mjs` helper. Existing entrypoints, schemas, partition, source
text, roles and identities remain byte-preserved. No core/adapter/hook/CI,
dependency, scorer, historical comparator or mixed-helper edits.

The producer copies required existing session dates exactly into every message,
validates through canonical T1 labels and actual captureSnapshot fourth argument,
recomputes normalized snapshots/catalogs/digests, freezes detached plan data before
callbacks and reuses existing partial/failure outcome handling. Its distinct plan
schema/policy/digest binds ordered capture digests and labels. Unknown dates do
not become a new prepared-history input format.

The consumer accepts only question `{text,date}`, namespace, the actual successful
source-evidence recall **value** (not its `{ok,value}` wrapper), local authoritative
synchronous core.get, declared model/limits and trusted synchronous token counter.
No history/source/origin maps or repair inputs. Validate bounded detached JSON:
12 memories, 100 complete receipts each, 800 UTF-16 excerpt units, canonical labels
128, question text 4000 and date128. Reject getters, sparse/cyclic/malformed data,
duplicates, stale/foreign/partial canonical reads, changed/removed/added labels.
Validate again after counting; this is packaging-time freshness, not a lease.

Render receipt tuples only `{role,content,sourceTime?}` in first-seen order;
unknown stays absent. Deduplicate exact tuples only; diagnostics retain every
original receipt identity and truthful inclusion/omission of duplicate origins.
The new evidence-only instruction explains opaque claimed utterance time and
untrusted data. Request format is `{model,messages,temperature:0,max_tokens,n:1}`.
Measure complete serialized request plus reserved output with safe integers,
explicit input/output/context bounds and whole-tuple omission (later smaller
tuples can fit). Counter throws/thenables/negative/nonintegers/overflow fail.
Return frozen exact measured request/bytes/resources; never dispatch an answer.

## Acceptance and caller inventory

- T2.1: Freeze legacy plan/payload/request goldens, then show real failing
  capture → close → cold reopen → recall → new consumer, indexed and ordinary
  qualified-v2 routes, without answer-time maps. Worker owns regression;
  primary independently reruns combined acceptance.
- T2.2: Distinct annotated plan identity; unchanged source partition/identities;
  changed labels bind payload and plan digests; real duplicate/conflict replay;
  invalid labels stop before any callback, detachment before callbacks.
- T2.3: Multi-session/chunk tails, known/unknown, equal text/different times/roles,
  hostile labels and literal quotes; exact allowed evidence fields, no repair.
- T2.4: Namespace/revision/completeness/duplicate/label/accessor/mutation/cyclic/
  oversize refusals; canonical mutation during count; no dispatch capability.
- T2.5: Exact equality/one over, metadata-only overflow, empty-envelope refusal,
  whole tuples/later smaller fit, invalid counters/arithmetic and immutable bytes.
- T2.6: Small synthetic owned-workspace actual producer/core/cold consumer demo.
  Teardown closes resources before owned removal on success/failure. No historical
  cleanup; scripted transport facts establish no semantic score.
- T2.7: Explicit selection, opaque semantics, whole-source budget tradeoffs,
  synchronous local-counter boundary, absent host/provider and closed-H6 limits.

Affected callers: new explicit evaluation APIs and demo only. Existing ingestion,
comparison, public and mixed paths remain unchanged and are covered by frozen
goldens plus the complete longmemeval suite. No browser/UI/URL replay affected.
Worker owns test/demo/docs checks; primary owns direct diff inspection, independent
combined probe, candidate freezing and nonauthor fixed-diff reviews.

## Gates and evidence

On pinned Node22.16.0 and24.15.0: npm test; npm run validate; pinned Claude plugin
and marketplace validation; test:longmemeval; ingestion/comparison/public/new
demos; focused real-core source-time suite. Install only existing isolated locked
tooling after node_modules symlink inspection. No TypeScript gate applies in this
JavaScript repository. Run through owned test runner where supported; inspect
actual exits, retain/explain failed or canceled attempts. Check final hashes and
independently derive/diff/count delivery paths by git diff plus untracked versus
git status. Primary acceptance and independent review remain required.

Initial state: clean exact base confirmed. Both isolated tooling node_modules
paths absent. Target repository has no scripts/README.md; validation scripts were
inspected directly; no operational script is needed. No implementation yet.
Token/cost/elapsed measurements unavailable unless exposed by runtime.

## Implementation and retained verification evidence

Public APIs are `planSourceTimeIndexedEvidenceLongMemEvalCase({history,namespace})`,
`ingestSourceTimeIndexedEvidenceLongMemEvalCase({history,namespace,capture})` and
`packSourceTimeAnswer({question,namespace,recall,get,model,limits,countTokens})`.
`limits` is exactly `{inputTokens,outputTokens,contextTokens}`. Recall is the
successful source-evidence `.value`. Only current memories are accepted; this is
not a historical applicability consumer. Producer snapshot bounds are 64 MiB,
1,000,000 nodes, depth12; consumer generic snapshot bounds are 4 MiB,60,000 nodes,
depth14, followed by the strict per-memory/receipt/question limits above.

Actual preimplementation Node22 focused run exited **1**: one frozen-golden
test passed, two intended regressions failed, zero skips/cancellations. The
ordinary qualified-v2 path really captured, closed, reopened and recalled before
the absent new consumer module failed. The indexed path failed at the missing
new producer export. Pre-T2 legacy/indexed plan hashes, payload digests and the
serialized old mixed request hash were frozen from actual base execution; their
test remains exact. No historical fixture was regenerated.

During fixture construction, two subsequent focused runs exited **1** with
2/3 passing: real indexed admission correctly remained partial because the
scripted fixture omitted classification. Adding classification then exposed
three fixture failures (12/15, exit **1**): the unfiled-only selector missed placed
refs and repeated topic titles caused the second session's classification to
fail. The fixture now selects actual placed memory refs and uses unique titles.
No partial outcome was converted to success and no core code changed. The next
15/15 run exited **0**. These scripted choices prove transport, not relevance.

Primary acceptance found an additional real ingress defect: directly forwarding
new ingester options to old ingestCase invoked a history getter and capture.
The independent Node22 red exited **1**, observed reads1/calls1. Only the new
entrypoint now checks plain-data descriptors and detaches history/namespace
before old ingestion. New tests cover history/namespace/capture getters, symbols,
extra/nonenumerable/custom-prototype/sparse/cyclic data and zero callbacks.
The first expanded run exited **1** (16/17): early synchronous refusal required
an async wrapper in the existing assert.rejects test. After that test-only
adjustment, **17/17** passed, exit **0**, zero skips/cancellations. Primary's
getter repro and independent 17-case reruns passed on both nodes, per its report.

Coverage includes actual indexed and ordinary v2 cold pipelines, multi-session
multi-chunk tail receipts, same-event duplicate/conflict replay and unchanged
partial outcome handling; exact roles/time/unknown/literal hostile labels;
source-only fields, authenticity/refusal limits, accessor/caller mutation and
canonical changes during counting; exact full-request equality/one over,
annotation-only overflow, empty-envelope failure, later-smaller fit and truthful
duplicate-of-omitted disposition. Native rejected Promises are refused without
unhandled rejection; arbitrary plain thenables are never invoked. Request bytes
and diagnostics are deeply immutable. Owned success/failure fixtures close before
removal. No helper has a dispatch port.

Pinned installs first failed with actual exit **1** before installing anything:
npm rejects using the same `/dev/null` as both user and global config. Distinct
nonexistent config paths inside an owned fresh workspace resolved this. Existing
locked isolated OpenAI and pinned Claude tooling installs each exited **0**;
both node_modules paths were absent beforehand and regular local directories
afterward, not shared symlinks. Sanitized child environment and owned cache were
used; the cache workspace was removed. No lock/dependency file changed.

Final commands use exact Node22.16.0/24.15.0 executables and matching npm-cli.js,
sanitized PATH, no caller npm configs, and the existing owned test runner.
The two-runtime logs are retained at `/tmp/cairn-t2-verification.wMhcKU`.

- `npm run test:longmemeval`: **210/210**, exit **0**, both nodes, zero
  skips/cancellations, including all 17 new focused cases and old callers.
- `npm run validate`: exit **0**, both nodes.
- `npm run validate --prefix tools/plugin-validation`: pinned marketplace and
  strict plugin validation exit **0**, both nodes, isolated Claude config paths.
- `npm run demo:longmemeval-ingestion`, `demo:longmemeval-comparison`,
  `demo:longmemeval-public`, `demo:longmemeval-source-time`: every subcommand
  exit **0**, both nodes (8/8). Each npm demo is wrapped by the owned runner.
  All four emitted legacy retained database paths were independently checked
  absent afterward, exit **0**. Public demo already owns cleanup. The new demo
  asserts its workspace absent after closing resources on either outcome.
- `node tools/testing/run.mjs core/test/source-time.test.mjs`: **22/22**,
  exit **0**, both nodes, zero skips/cancellations.
- `npm test`: **673/673**, exit **0**, both nodes, zero failures,
  skips/cancellations. Existing sessions10495 (Node22,244413ms) and36661
  (Node24,248523ms) were supervised to actual completion; no restart was needed.
- `git diff --check`: exit **0**. No TypeScript or Next.js gate applies.

The older client-bundle workers continued their imported pairing tables while
ordinary output was temporarily unchanged. Actual CPU/log/subprocess activity
confirmed progress; both generic gates finished normally. No run was canceled
or blindly restarted. All required worker gates have completed; no task is left
running unattended. Primary final inspection/combined acceptance, candidate
freezing and fixed-candidate independent reviews/PR remain pending. No merge,
release, paid run, semantic score or future semantic diagnostic is claimed here.

Final delivery inventory: `git diff --name-only` plus
`git ls-files --others --exclude-standard` versus independent
`git status --porcelain=v1 --untracked-files=all` yielded **12 paths each,
zero differences**. This includes CHANGELOG, ROADMAP, five docs (including this
plan), ingestion, new consumer/demo/test and package.json; no scripts/public/
config omission. No core, adapter, old comparator/scorer/mixed helper, hook, CI,
dependency manifest, historical evidence or private data changed. The new helper
is evaluation-only, not a packaged core runtime module; installed-artifact and
host gates are not activated by this diff.

The tested runtime/test snapshot (SHA-256, unchanged during final gates):

| File | SHA-256 |
| --- | --- |
| evaluation/longmemeval/ingestion.mjs | 1b95f031d7a158433ec2a6c17c2da51982dfd8ea967dac95aaecfdc1c7a669e6 |
| evaluation/longmemeval/source-time-answer.mjs | de32a1371df8718a4ad149b421c76c58257b9ddcfb695012b7801fd7b5b65ea4 |
| evaluation/longmemeval/source-time-demo.mjs | fe48c8a977f1545a082d3a1b004e831ce4610cc1b56c6019191fbef8f4a3e0db |
| evaluation/longmemeval/test/source-time-answer.test.mjs | 01636adb4f9d4173a9ad34837fc4a9e623819df2771916b07e675755c89b0b5c |
| package.json | b747683d2a7375fec56714e40019eeffa74294e10abc7337657309e6c0a23179 |

Primary reports independent cold-producer/authenticity/budget acceptance on both
nodes and independently checked pre-T2 goldens. Its only implementation-boundary
correction was the new-ingester descriptor gap described above; worker implemented
that scoped fix and reran affected checks. Final Standards/Spec review remains
independent and is not replaced by these worker checks. Full final-file hashes
are returned separately after this evidence update to avoid a self-referential
plan hash. All work remains an organized uncommitted diff at the exact T1 base.

## Dependent T3 factual closure

The separate [T3 source-time semantic diagnostic](source-time-semantic-results.md)
used the accepted T2 runtime `287d22625faaa50b056c83cc5745be16d01171bf` for six
new authored cases: one capture, cold ordinary flat recall and canonical T2 pack
per case, then A deleted only included labels and B retained them. All twelve
answers completed; A was correct on 3/6 and B on 6/6. Only Juniper was
prospectively repair-dependent. Alder's arithmetic difference with already
explicit event dates is not missing-date causal proof; Maple's empty recall
leaves the planned nonempty unknown-date safety exposure unexercised.

The linked result and [sanitized evidence](../evidence/source-time-semantic-results.json)
retain every actual context, answer, independent judgment/disagreement and
source-cited primary adjudication. The narrow criterion permits considering a
fresh P4 design only. It clears neither P4, Stage 3, independent reliability,
installed-host/resource nor default-adoption gates and authorizes no further
paid work. T2 APIs, public scripted demo, earlier tests and historical results
remain unchanged; this dependent evidence does not make T2 a public live runner.
