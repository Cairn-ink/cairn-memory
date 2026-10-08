# Bounded private recall lineage export

Status: implementation, focused gates and primary full gates complete on both
exact runtimes; fixed-candidate review pending. No paid activation or quality claim.
Worktree `recall-lineage-diagnostics`, branch `feat/recall-lineage-diagnostics`,
fixed base `a1f2354d9ea84220f81dbe59cec1ce83cfbdfcfe` (PR #362).
The dependent PR targets `feat/model-call-timeout`, not `main`.
Actual author: delegated GPT-6.1 Sol/high. Primary owns integration acceptance,
full serial gates, candidate commit, independent Standards/Spec review and
delivery. The author does not commit, push or access authentic artifacts.

## Acceptance frozen before code

- N27A: `runMixedGeneration` accepts explicit own data-property
  `recallWitness: 'bounded-lineage-v2'` only for 1–30 prepared cases. Default
  and `bounded-v1` reports remain unchanged. Invalid options fail before
  preparation consumption. No new model, host, timeout, prompt or schema policy.
- N27B: a witness exports only after close and before disposal. A detached
  bounded version-2 snapshot retains existing token-only call events, final
  state, limits/uncertainty and `{token,kind,digest}` identity rows. Fresh
  random 32-byte salt and domain-separated SHA-256 bind each exact existing
  canonical private mapping key, including namespace index, revision and
  receipt-to-ref association. Caps remain four calls, 128 ref slots, 256
  receipt slots and 1,024 identities (configured caps can only decrease).
  A strict own-data offline digest helper allows an authorized DB reader to
  match known identities without exporting raw IDs, namespace text, content,
  requests, answers, exception strings or arbitrary caller objects.
- N27C: open/disposed export fails with fixed lifecycle errors. Disposal still
  clears all witness private mappings/events. Mixed export failure produces
  only a finite unavailable observation, never exception data or a fabricated
  empty complete trace. Its `finally` disposes even on export failure. The
  observer cannot change invocation, receiver, native Promise identity,
  arguments, outputs, retries, accounting or settlement. Generation reads no
  corpus/evaluator or DB identity lookup for this export.
- N27D: retain preimplementation RED, then keyless synthetic GREEN through
  actual witness/core/adapter and mixed seams. Independently computed digests
  and joins distinguish retained-not-shown, shown-not-selected, selected but
  empty-rank, and selected/returned. Cover failure/early stop, partial/overflow,
  accessors/malformed refs, input mutation, namespace/revision separation,
  multi-receipt association, disposal, detached mutation and fresh case salts.
  Serialized canaries must be absent. Original provider/count/Promise/receiver
  controls and existing default/v1 behavior must pass. These observations do
  not independently prove core acceptance or semantic relevance.
- N27E: document private linkable metadata exposure and retention boundaries.
  Salted hashes are not anonymity, authenticated membership or permission.
  N26 closed ordinals 15/17 showed unretained direct user candidate windows,
  retained relevant assistant receipts and empty ranking; their disposed
  per-call mappings cannot be reconstructed. N25's synthetic date gap was not
  an observed whole-unit loss in 14/16/18. No historical replay/repair, score
  improvement, date-field/raw-layer work or new paid run follows.
- N27F: focused canonical owned-workspace tests on exact Node 22.16.0 and
  24.15.0, serial concurrency 1; actual exits and owned cleanup on success and
  failure recorded. Primary owns required generic/JSON/maintainer,
  LongMemEval/long-history and applicable synthetic demo/full integration
  gates under CONTRIBUTING. Inspect dependency directories before isolated
  locked installs; never mutate shared links. No TypeScript gate.

## Design and caller map

`createRecallWitness` already constructs bounded events/final metadata and a
private canonical-key/token map. Add `exportAfterClose()` there, without copying
model/request/DTO objects. Export shape is
`{version:2,status:'available',salt,limits,summary,events,final,identities}`.
Hash domain is versioned and separates ref from associated receipt identity.
The exported offline digest helper validates exact enumerable own data shapes,
bounded IDs and safe integer namespace/revision; it rejects proxies/accessors
without getters or coercion. Export salt is per export/case, not a stable
cross-run identity. Missing identity plus partial/unknown observation never
means the retained DB record was absent.

The sole changed evaluation entrypoint is `runMixedGeneration`, through its
private `cairnCase`: recall finish/close → v2 export → unconditional disposal →
retained private diagnostics. V1 retains its existing aggregate-only shape;
v2 retains those aggregates plus the lineage snapshot. Mem0 has no witness.
Pre-recall failures retain unknown/not-run observations, not successful recall.
Existing report cloning/scorer/journal callers require explicit compatibility
checks; no validation relaxation or new runtime authority is permitted.

Allowed production files: `evaluation/long-history/recall-witness.mjs` and
`evaluation/longmemeval/mixed-generation.mjs`. Tests are the two corresponding
existing files under `evaluation/longmemeval/test/`; one additional focused
test/helper may be used only if required for the actual mixed seam. Docs are
this plan, `docs/protocol.md` and `docs/limitations.md`. No other file/dependency
changes without primary approval. No browser/UI/URL callers are affected.

## Verification and routing record

The author reread workflow/routing, CONTRIBUTING, CONTEXT, protocol and the
existing witness/mixed-witness plans. Initial `git status --short` is clean.
Dependency inspection found both isolated OpenAI and maintainer directories
absent (actual exit 2). Primary verified all three locked dependency manifests
against the existing PR #362 worktree and supplied read-only OpenAI/MCP/
maintainer dependency symlinks. No install/rebuild/update/removal of these
links or their targets is authorized.

Planned RED command, once isolated imports are available:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs --test-concurrency=1 --test-name-pattern=N27 evaluation/longmemeval/test/recall-witness.test.mjs evaluation/longmemeval/test/mixed-recall-witness.test.mjs
```

Actual RED/GREEN commands, exits, cleanup, final two-route file count/hashes and
primary acceptance will be recorded here. No gate is inferred from a previous
worktree. Token/cost measurements are unavailable, not estimated from model.

## Implementation and bounded verification

Only the two named evaluation production modules change. V2 retains outer
aggregates with `version:2` and a detached `lineage` snapshot; V1's shape remains
unchanged and no export salt is generated unless export is explicitly requested.
The digest helper checks own-data exact shape before getters/coercion, rejects
proxies before traps, and rejects negative-zero namespace indexes. Encoding is
`JSON.stringify(['cairn.recall-witness.identity.v2',salt,kind,exactMappingKey])`
before UTF-8 SHA-256; neither IDs nor private keys are serialized in the export.

The one additional helper is `testing/recall-lineage-child.mjs`, a dedicated
owned subprocess for actual mixed core/fake-HTTP/X-guard/journal controls.
It revokes Mem0 scopes before their callback, never executing the synthetic
Python/native descriptor. Default/V1/V2/export-fault share exact HTTP stage and
count order and unchanged synthetic answers. V2 independently joins the
closed synthetic stores' exact namespaces/revisions/receipts using a literal
expected digest, not the production helper. Two cases have distinct salts.
The RNG fault lives only in that child, after fake answer dispatch; it restores
crypto plus builtin ESM exports immediately and again in `finally`. Both fault
exports produce only the finite unavailable DTO, while arm success and actual
disposed flags stay unchanged. An intentional child assertion exits 1 and
still proves zero owned residue; successful children exit 0 with zero residue.
Actual mixed pre-recall extraction refusal retains failed ingestion, no answer,
available but unknown/not-run lineage and disposed mappings, not empty success.

Direct actual-core/adapter pairs additionally cover stored-not-shown,
shown-not-selected, empty ranking, final return, failed duplicate/freshness,
projection/overflow and complete-map bypass with original request/count/signal/
receiver/Promise controls. Constructed adversarial fixtures distinguish
namespace/revision and multi-receipt association, malformed Unicode, accessor/
proxy rejection, mutation detachment, pending/late completion and disposal.
Thirty maximal lineage snapshots **alone** fit unchanged 500,000-node/32-MiB
report validation; this is not a worst-case combined-diagnostics guarantee.
Real two-case reports and unchanged journal roundtrips are separately exercised.

Retained failures and correction ownership:

- Before production edits, the exact Node 22 RED command above exited 1:
  0/2 passed, new option unsupported and export method missing. Initial scoped
  implementation then passed 2/2 (exit 0), followed by expanded 7/7 (exit 0).
- First child fault integration failed (7/8, exit 1); a scoped correction still
  failed (0/1, exit 1). Both children reported zero owned residue. The author
  stopped after two rounds and escalated. Primary inspected and took over only
  the helper's unavailable-DTO assertion: reportSnapshot's null-prototype DTO
  cannot equal a plain literal under strict prototype comparison. Exact own
  keys plus primitive values corrected the assertion, without production
  changes. Primary reran N27C (1/1, exit 0), proving two RNG fault triggers.
- The author's full focused 19/19 Node 22 run exited 0 before the final
  pre-recall control and envelope-label clarification; it is superseded below.

Final focused command on each exact runtime replaces the RED pattern filter
with the same two files and `--test-concurrency=1`, preserving keyless `env -i`,
`TMPDIR=/tmp` and disabled compile cache. Node 22.16.0: 20/20 passed, actual
exit 0, zero failed/cancelled/skipped, 14057.538397 ms test-runner duration.
Node 24.15.0: 20/20 passed, actual exit 0, zero failed/cancelled/skipped,
13201.658876 ms. Durations are not latency/performance evidence.
Primary full contributor/native gates and fixed-candidate independent reviews
remain pending; the author makes no commit or delivery mutation.

Delivery scope is eight files, cross-checked by `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z` against
`git status --porcelain=v1 -z --untracked-files=all`. The three primary-created
read-only dependency symlinks are setup only, explicitly excluded from delivery
and unchanged. Final `git diff --check` and manifest checks are recorded in the
author handoff; primary will bind the same bytes before/after its full gates.

### Primary full acceptance checkpoint

The primary inspected the complete production/test/docs diff and independently
cross-checked the two manifest routes: 11 discovered paths comprise 8 delivery
files and 3 explicitly excluded read-only dependency links. All eight file
hashes remained identical throughout the full serial gate run. Only this
verification record was appended afterward; the tested implementation and tests
are unchanged. No dependency install, key, corpus or operational ledger was used.

On **each** exact runtime, Node 22.16.0 and 24.15.0, these commands completed
with actual exit **0**, no signals or process errors:

| Command | Result per runtime |
| --- | --- |
| `npm test -- --test-concurrency=1` | 581/581; zero skipped |
| `npm run validate` | JSON/version checks passed |
| `npm run validate --prefix tools/plugin-validation` | Marketplace and strict plugin validation passed |
| `npm run test:longmemeval -- --test-concurrency=1` | 311/311; zero skipped |
| `npm run test:long-history -- --test-concurrency=1` | 5/5; zero skipped |
| `npm run test:workspace-lifecycle -- --test-concurrency=1` | 25/25; zero skipped |
| `npm run demo:longmemeval-ingestion` | Synthetic demonstration passed |
| `npm run demo:longmemeval-comparison` | Synthetic demonstration passed |
| `npm run demo:longmemeval-public` | Synthetic demonstration passed |
| `npm run demo:longmemeval-mixed` | Pre-grant synthetic demonstration passed |
| `npm run test:mixed-native-local -- --test-concurrency=1` | 47/47; zero skipped |

The 22 commands ran serially in a keyless environment with the exact runtime's
bin first on PATH, `TMPDIR=/tmp` and `NODE_DISABLE_COMPILE_CACHE=1`. Only the
explicit native gate received the pinned Mem0 virtualenv/Python-root paths;
it used new synthetic stores/ledgers and fake HTTP. The final harness exit was
0, independently checked against all individual subprocess statuses and hashes.
These checks establish engineering behavior, not a new semantic score.

Primary acceptance log set: `cairn-n27-primary-gates.m0UrE34g`. The final
candidate and two independent review reports are bound in the PR delivery record;
no self-merge, publication, deployment or paid evaluation follows from this gate.
