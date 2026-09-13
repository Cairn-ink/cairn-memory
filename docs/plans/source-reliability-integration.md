# Source reliability integration delivery

Integrate already verified dependent changes without claiming semantic success.
Feature starting head: `acadccbe59247e0d1c88f522ef812afee7ff3cf5`.
Public review base: `ee1ba832dbe9bdf2f23b120b5a6ba2eb42c29c68`.

- D1: Preserve existing feature commit ancestry and integrate public main's
  minimum security patch. Include the otherwise missing PR66 evidence tip
  `31dc319a69828c67a9d12c251ddf8c9e66c6772a` without rewriting its results.
  Exact-head inventory must also retain PR64 diagnostic tip
  `f86dbb1bd3a197c2b1c0fb1c656b1532e1dc8b6f` and PR59 contract tip
  `6c4d0a698d24c0ec299f85eeed304c6f550ea39d`. The latter has an equivalent
  cherry-picked contract already in the feature chain; distinguish equivalent
  content from actual ancestry instead of silently counting both as included.
- D2: Inventory covered public PR52-68 heads and local stage base/head/specs.
  Preserve failed and unknown outcomes; clearly distinguish mechanical tests,
  actual model observations and still-unmet semantic reliability goals.
- D3: No new engine behavior beyond reviewed stages and necessary integration
  fixes. Retain public security disclosure links and explain historical private
  hold notes rather than pretending they describe current delivery status.
- D4: Final integrated tree must pass both Node22.16/24 generic, JSON/plugin,
  core/store/recall/capture/history, OpenAI/offline demo, MCP, artifact, offline
  live evidence, budget/guard tests and canonical pinned Hermes host tests.
  Actual installed synthetic probe and independent fixed-head Standards/Spec
  review must cover the combined tree; prior stage tests are not substitutes.
- D5: Publish one transparent PR against main only after final verification and
  review. Keep old PRs/branches intact. No feature merge, registry publication,
  deployment, production data access or new paid model experiment.

Intermediate local integration merge commits preserve ancestry; they are not
verified delivery candidates until the final D4 gates and review pass.

## Diagnostic compatibility acceptance

PR64's old test expects late targets to remain invisible. The root reproduced
its failure on the integrated query-aware core: `english-late` visibility was 1,
not the historically expected 0 (8 tests passed, 1 failed). Do not regress core
behavior to satisfy that old assertion. Keep the original report bytes intact
and assert its historical misses separately. Current-runtime tests must require
exact target reachability, preserve public-map page observations as a distinct
measurement, and require the now-complete classification catalog. No permissive
zero-or-one assertion or overwritten historical result is acceptable.

## Integrated root verification

The resolved integration passed these commands on Node 22.16.0 and 24.15.0:

| Gate | Outcome per runtime |
| --- | --- |
| `npm test` | 31 passed |
| `npm run validate` | JSON and version consistency passed |
| `npm run validate --prefix tools/plugin-validation` | Marketplace and strict plugin validation passed |
| `npm run test:core` | 502 passed |
| `npm run test:openai` | 163 passed |
| `npm run test:mcp` | 53 passed |
| `npm run test:artifact` | 54 passed |
| `npm run test:live-evidence-offline` | 109 passed, 27 existing skips; no failures |
| `npm run test:experiment-budget` | 15 passed |
| `npm run test:experiment-request-guard` | 64 passed |
| Pinned canonical Hermes runner, four integration files | 15 passed |

Also passed on both runtimes: `demo:store`, `demo:moc`, `demo:recall`,
`demo:capture`, `demo:history`, `demo:conflicts`, `demo:rebuild`,
`demo:continuation`, `demo:openai-offline`, `demo:experiment-budget`, and
`demo:experiment-request-guard`. No TypeScript gate exists in this repository.

A fresh installed artifact built from the resolved integration retained SHA-256
`aa46bb1f4792dc7de514dee397708d6406066685b0668d2808b5e13a1007b2f5`.
The actual SDK receipt lifecycle and canonical pinned Hermes MemoryManager /
scripted AIAgent tests exercised that installed shared core, not source imports.
See [the native verification command](../hermes-memory-provider.md) and
[S9's record](hermes-qualified-capture.md). All inputs, databases and provider
responses were synthetic; no model credentials or paid requests were used.

Original PR64 and PR66 result JSON remained byte-identical to their recorded
heads. The identifier validator and Unicode regression file match public main.
The main merge retained both historical security plans, and PR59's ancestry
merge left the already-equivalent tree unchanged. No old PR was closed or merged.
