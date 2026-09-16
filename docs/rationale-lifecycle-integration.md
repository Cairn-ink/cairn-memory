# Rationale lifecycle integration

This local candidate combines fixed PR136 (`54036d9`) and PR139 (`819f60b`)
with the dependent explicit rationale-correction stack and its offline
diagnostics. The integration merges are `023ea2b` and `4d3f94f`. The intended
single PR supersedes PR136, PR139, PR140 and PR141 without merging or closing
those earlier PRs. PR133–135 were already incorporated by PR136. PR137 and
PR138 are independent experiment evidence, not runtime dependencies; their
reports are neither duplicated nor reinterpreted here.

Pure MOC filing/unfiling may increment a memory revision while leaving its
content and complete retained receipts unchanged. In that narrow case, valid
proposed rationale edges are rebound inside the placement transaction. Old
revision refs still fail. Explicit `writeMode: 'replace-reviewed'` can then
remove or insert only proposals whose two endpoints are among its guarded
current refs; automatic capture and absent-mode reviews remain append-only.
The default decision-context read includes direct incoming challenges, even
without a support edge, and deduplicates a challenge seen through self-support.
These are still unverified model proposals, not source facts.

The public-API lifecycle regression in
`core/test/rationale-lifecycle-integration.test.mjs` scripts a support,
mistaken direct challenge and crossing support. It files both reviewed
endpoints, replaces only the mistaken link with fresh refs, refiles, and checks
warm and cold keyless views. It also checks qualification anchors, source
receipts, placements, stale refs, correction/forget invalidation, unrelated
graph survival and a filing-versus-in-flight-review race. The tests use fresh
synthetic SQLite stores and scripted model output; they do not measure a
model's ability to identify a false report.

This closes a mechanical integration gap, not the remaining semantic one.
Model edge accuracy, current-state binding, decision adoption and user benefit
remain unproven. Prior negative pilot results remain negative; the offline
selective-correction cases are diagnostic controls, not a quality score.
There is no automatic replacement, new relation type, provider call, schema
change or live-data migration in this integration.
