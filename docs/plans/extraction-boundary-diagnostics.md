# Extraction boundary diagnostics

Status: implementation and author offline gates complete; candidate frozen for
primary acceptance and independent review. Acceptance was frozen before code.
Base: `142c7a242e345ae2cfe3920ae607828c742cf99a`. Actual implementation
model: GPT-6.1 Sol, high. The evaluated runtime and private operators remain
immutable. The author owns implementation and synthetic verification; the
primary owns independent acceptance, fixed-SHA reviews and delivery.

## Acceptance N20A–F

- N20A: distinguish duplicate selected indices (`invalid_extraction_source_duplicate`)
  from duplicate canonical receipts (`invalid_extraction_receipt_duplicate`).
  Neither acceptance nor deduplication changes.
  Historical `source_duplicate` events remain ambiguous between the two branches
  without a known producing runtime; unchanged event version 1 does not resolve it.
- N20B: refine the existing failed final 600-UTF-16-unit canonical-text bound
  into finite original, NFKC and redaction checkpoints. Preserve legacy
  `invalid_extraction_text_normalized_bounds` in collectors. Each checkpoint
  collapses whitespace and trims, consistently with the existing final pipeline.
  On final-bound failure only, precedence is original over-bound, then NFKC
  over-bound, otherwise redaction over-bound. This classifies an observed
  checkpoint, not the causal contribution of a transformation: earlier expansion
  followed by shrinkage can still select the earlier checkpoint. No raw-600
  rejection is added; raw strings over 600 may contract and pass. The 600/20,000
  bounds, normalization, redaction, truncation and earlier rejection order stay.
- N20C: returned errors, retryability, store counts, receipt binding, request
  counts and whole-batch atomicity remain unchanged. Observer throws, rejections
  and getters cannot replace a result. Events contain only four finite fields,
  never text, lengths, IDs, hashes or exceptions.
- N20D: actual OpenAI adapter plus indexed core with fake HTTP covers 300/301
  ligatures, redaction expansion, raw 601, whitespace contraction, astrals,
  duplicate indices, distinct indices yielding the same canonical receipt,
  different valid receipts, malformed/oversized arrays and source-range errors.
  Raw-601 and long-whitespace fake outputs deliberately violate the provider
  schema; they test unchanged authoritative core behavior, not a structured-output
  guarantee. Successful and failed captures count both token-count and generation
  requests; duplicate replay adds neither.
- N20E: refined reasons survive the bounded mixed observer and public-pilot
  projection; historical reasons remain accepted and unknown reasons filtered.
  Trace every finite vocabulary and caller, not only the producer.
- N20F: diagnostics only, not a runtime reliability or score claim, paid replay,
  repair, retry or changed retention. Public documentation uses synthetic examples
  and never authentic case identities or content.

## Exact proposed surface and compatibility

Runtime: `core/validation.mjs`, `core/capture-input.mjs`,
`core/source-windows.mjs`, `core/model-diagnostics.mjs`, and the existing finite
projection in `evaluation/live/public-pilot.mjs`. Keep the existing boundedText
hook's first category `normalized_bounds`; add only a finite second checkpoint
argument there, which the extraction caller maps to refined reasons. Other
callers and first-argument callbacks retain their behavior.

Tests: extend `core/test/extraction-text-diagnostics.test.mjs`; add the real
adapter matrix under `evaluation/longmemeval/test/extraction-boundary-diagnostics.test.mjs`
(not core CI, which does not install adapter dependencies); extend the existing
public-pilot synthetic test seam as needed. Documentation: this plan,
`docs/model-failure-diagnostics.md`, `docs/limitations.md`, `CHANGELOG.md`.
No prompt/schema, model, budget, runner, storage policy or package changes.

Core emission and the installed diagnostic slots share `emitDiagnostic`'s
vocabulary; mixed collection receives only those emitted events. Public pilot
has a separate closed vocabulary and must be updated. Existing indexed-capture
and retained-window tests verify atomic rejection; their strict duplicate
contract is retained. ADR 0002 keeps classification distinct from admission;
ADR 0003 does not turn admitted receipts into a complete transcript.

## Verification and ownership

First record a baseline behavioral RED in this worktree before production edits,
then GREEN with the same test. Both exact Node 22.16 and 24.15 use the canonical
keyless runner, owned workspaces and fake HTTP. Required gates: focused tests,
full core, LongMemEval, live-offline projection, demo:store, demo:capture,
demo:longmemeval-ingestion, generic npm test, validate and maintainer validation.
The primary may run generic/maintainer gates after runtime freeze; actual exits,
setup failures and cleanup evidence will be appended. No authentic data,
provider calls or operational scripts are authorized. Two mechanical file-list
routes must agree before handoff.

## Retained RED and initial verification

Before production edits, the exact Node 24 canonical command
`node tools/testing/run.mjs --test-name-pattern='N20A canonical' core/test/extraction-text-diagnostics.test.mjs`
failed with actual exit 1 (`5c2375`): distinct selected indices producing the same
canonical receipt reported `source_duplicate` instead of `receipt_duplicate`.
This was a behavioral assertion failure, not an import/setup failure. The same
new branch then passed; full text diagnostics passed 24/24, actual exit 0
(`9006f1`, before the additional hook-arity test). Final focused A/B/D/E passed
4/4 with zero skips on exact 24 (`9ab732`) and 22 (`8fb302`), both actual exit 0.
The later test-only tightening additionally checks full receipt fields and
token-count/generation endpoint order; final gates must include those bytes.

OpenAI dependencies were absent before isolated locked installation (`68fb95`,
the absence-check command exited 2). Installation exited 0 (`a19682`); all three
adapter/maintainer lockfiles are unchanged (`fb4bb2`, exit 0). The primary owns
MCP/maintainer installs, generic/validate/maintainer/workspace gates. Existing
MCP dev-only OAuth advisory is retained as a separate dependency limitation,
not described as a clean dependency audit; this change does not update locks.

Author full-gate logs: `/tmp/cairn-n20-gates.nKsum8Fa`. Two per-version drivers
run core, LongMemEval and store/capture/ingestion/public demos sequentially with
keyless `env -i`, exact node-bin PATH, `TMPDIR=/tmp` and compile cache disabled.
Those two already-started full suites use the existing default test concurrency;
they are not host-resource/performance baselines. Subsequent live-offline runs
use explicit `--test-concurrency=1`. No historical scratch is swept.

### Retained assertion correction

The primary's integrated run failed 25/26 with actual exit 1 (`8acb5f`), because
the tightened test incorrectly expected public `get()` receipts in source-index
order. The fixture loaded and executed correctly; this was an assertion failure,
not a setup failure or product race. `contract.get()` calls `runtime.getPage()`,
whose query sorts by `created_at ASC, id ASC`. Random receipt IDs make that order
different from source selection. The corrected test compares the complete
receipt-binding set and independently checks `extractedWindowItems`' selected
index order, including a reversed `[1,0]` control. No runtime change was made.
Final focused A/B/D/E then passed 4/4 with zero skips and actual exit 0 on exact
22 (`ca3954`) and 24 (`98af60`). The final actual-adapter matrix has 18 controls.

### Completed gates (actual command exits)

| Gate / owner | Node 22.16 | Node 24.15 |
| --- | --- | --- |
| Full core / author | 1192/1192, 0 skips, exit 0 (`5def70`) | 1192/1192, 0 skips, exit 0 (`813145`) |
| Final full LongMemEval / author, concurrency 1 | 301/301, 0 skips, exit 0 (`2baea3`) | 301/301, 0 skips, exit 0 (`2a5ecc`) |
| Store/capture/ingestion/public demos / author | each exit 0 (`ccfede`) | each exit 0 (`9c6ae7`) |
| Live-offline / author, concurrency 1 | 341 pass / 371, 30 existing opt-in skips, exit 0 (`03a3e9`) | 341 pass / 371, 30 existing opt-in skips, exit 0 (`871f50`) |
| Generic / primary | 581/581, 0 skips, exit 0 (`8c2754`) | 581/581, 0 skips, exit 0 (`3778af`) |
| Validate / primary | exit 0 (`35ec83`) | exit 0 (`655799`) |
| Maintainer / primary | exit 0 (`ab1fa4`) | exit 0 (`c3a616`) |
| Workspace lifecycle / primary | 25/25, 0 skips, exit 0 (`71e3e1`) | 25/25, 0 skips, exit 0 (`c6be74`) |
| Public-pilot N20E / primary | 1/1, 0 skips, exit 0 (`fa526e`) | 1/1, 0 skips, exit 0 (`ce1423`) |

Live-offline skips do not establish installed opt-in acceptance. Core elapsed
times were 419631 ms (22) and 418751 ms (24), not performance claims. No provider
or operational ledger was used. Final LongMemEval elapsed times were 57452 ms
(22) and 57094 ms (24). Fixed-SHA independent reviews and delivery remain
pending; no paid
replay is required or authorized by this change.

The original full LongMemEval runs also passed 301/301 (`ccfede`/`9c6ae7`),
but the receipt-order test correction landed approximately 0.2–0.5 seconds after
those commands started. Their final test-file load was not independently proven;
they remain production-green evidence, not final-test-byte acceptance. The full
suite was therefore rerun sequentially with concurrency 1 under the final files.
Eight production/test SHA256s match before and after both reruns (`2a5ecc`,
comparison exit 0), retained as `final-lme-before.sha256` and
`final-lme-after.sha256` in the owned gate directory. Primary final integrated
text/matrix tests additionally passed 26/26 on 22 (`117a11`) and 24 (`73b371`),
both actual exit 0. No code or test edits occurred during these final reruns.

### Reproduction commands and final scope

For either version substitute its exact binary directory in this environment:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --test-concurrency=1 --test-name-pattern='N20' core/test/extraction-text-diagnostics.test.mjs evaluation/longmemeval/test/extraction-boundary-diagnostics.test.mjs evaluation/live/test/public-pilot.test.mjs
```

The full author commands in that same environment were `npm run test:core`,
`npm run test:longmemeval`, `npm run demo:store`, `npm run demo:capture`,
`npm run demo:longmemeval-ingestion`, `npm run demo:longmemeval-public` and
`npm run test:live-evidence-offline -- --test-concurrency=1`, on both exact nodes.
Per-version logs for the six-command drivers and Node 22 live-offline are in
the owned gate directory above; Node 24 live-offline's actual completion is
retained as `871f50`. Demos preserve their existing explicit fresh-synthetic
output retention contract; tests use owned-workspace teardown, including failed
assertions. No historical cleanup or source/data replay is performed.

The final scope is 12 source/docs files. Independent mechanical routes
(`git diff --name-only` plus untracked files, and `git status --porcelain`)
must match exactly, and the handoff hashes every file. Production source remains
at the five-file freeze: validation `87595252…`, capture input `16f61638…`,
source windows `0d9bfbd0…`, diagnostics `fcf2d887…`, pilot projection `b7dd2bc9…`.
Only tests and documentation changed after that freeze. The final matrix receipt
set correction is not a runtime fix. No package, dependency lock, prompt,
schema, accounting, native child or old operator source is changed.
