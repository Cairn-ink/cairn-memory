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
