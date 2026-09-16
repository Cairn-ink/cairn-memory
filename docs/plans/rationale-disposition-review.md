# Read-only explicit relationship dispositions

Base: `620044ddde593074a83355d1d8441d830e5570ca`.
The fresh chronology comparison retained a reversed challenge and missing
independent evidence despite clearer instructions. Earlier source-basis,
addressed-anchor and context experiments already exist and do not establish
semantic reliability. This slice changes the update-review contract, not the
production default or source truth model. No new paid run belongs here.

## Domain boundary

A relationship disposition is an explicit proposed assessment of whether an
existing relationship should be retained, withdrawn or left unresolved.
Proposed withdrawal concerns an interpretation, not deletion of source history
or proof that either source is false. An unresolved relationship has insufficient
support for a disposition; preserving it does not confirm it. Add these tight
definitions to CONTEXT.md using the existing glossary format, without API or
implementation details. No ADR is needed for this reversible experimental view.

## Acceptance

- DR1: Add an explicit embedded `reviewRationaleDispositions({namespace, refs})`
  read-only view over 1–6 exact current refs. Snapshot their complete retained
  source receipts and all existing proposed edges whose BOTH endpoints are in
  those refs, atomically with the namespace epoch. Bound that edge set to ten;
  fail before a model call if it does not fit. Do not silently truncate or
  include crossing/out-of-scope evidence. Preserve existing APIs/defaults.
- DR2: Use a separate injected `model.reviewRationaleDispositions` port with
  existing 6000-input/1024-output, 30-second timeout, cancellation and freshness
  checks. Model input contains only local memory/receipt/old-edge indices,
  retained source excerpts/roles and old edge proposals explicitly labelled
  unverified. No stored summaries, qualifications, namespace/persistent IDs,
  receipt event/client/session metadata, timestamps or inferred truth flags.
- DR3: Require exact output `{dispositions, additions}`. Every old edge receives
  exactly one `{edge, action, evidence}` with `action` keep/withdraw/unknown and
  evidence an array of distinct `{memory, receipt}` source citations. Withdrawal
  requires at least one valid citation; keep/unknown may cite none. Omitted,
  duplicate, out-of-range or extra fields reject the entire proposal. Citations
  prove attachment only, not entailment. Additions use the existing bounded
  relation tuple contract, including valid receipt indices and self-support
  versus forbidden self-challenge; reject duplicates and overlap with old edges.
- DR4: Compile an ephemeral proposed graph: retain keep and unknown edges,
  omit ONLY explicitly withdrawn edges, append validated additions, and mark
  unknown edges unresolved rather than confirmed. The result remains
  unassessed/model-proposed/not-stored, exposes complete source evidence,
  dispositions/citations, additions, projected edges, unresolved count, guarded
  revisions/epoch and scope within supplied refs. Bound projected edges to ten
  and full result to existing 24000 UTF-16 units; fail, never silently prune.
- DR5: No database, source record, actual stored edge, qualification, MOC or
  epoch mutation, even on success, failure or empty output. Revalidate source
  revisions/receipts, old edges and epoch before/after arbitrary callbacks and
  after detached output validation/counting. Same-namespace concurrent edge-only
  mutation must invalidate the result even when memory revisions do not change.
  Source correction/forget/filing also fences it. Reopening cold retains only
  original stored data, never the ephemeral projection. There is NO commit API.
- DR6: Tests include two independent reasons with valid support preserved,
  mistaken challenge explicitly withdrawn and genuine new challenge proposed;
  unknown old relation retained visibly unresolved; missing disposition rejects
  without withdrawal; empty-old-graph additions; all bad indices/duplicate and
  extra fields; source/namespace/epoch races; counter mutation/cancellation;
  oversized inputs/outputs; keyless cold original graph equality; absent port
  sends nothing. Use scripted models and synthetic temporary databases only.
- DR7: Document experimental meanings, relation ambiguity, source citations
  versus semantic proof, extra provider-visible OLD unverified proposals and
  bounded scope in the glossary/protocol/feature docs/changelog. No new OpenAI
  adapter, MCP tool, automatic capture, paid capability, schema migration,
  model default or traversal change. Existing paid guards still reject the new
  method; no actual provider request. This does not fix the remaining direction
  error, distinct-evidence omission or original-root visibility by itself.
- DR8: Include new required runtime files in the existing install manifest.
  Run full core and store demo, generic, JSON/strict plugin and artifact gates
  on Node22.16/24, relevant diagnostic/privacy/guard controls, and independent
  fixed-candidate Standards+Spec reviews plus exact-head CI. Primary personally
  reruns key paths. Deliver through an isolated PR, no merge/release/deployment.

One Sol/high worker owns this coherent engine slice. Primary owns terminology,
contract, final acceptance and later comparison design. Explicit old-edge
coverage is a mechanical improvement to evaluate, not semantic correctness.
Old-root outgoing/reaffirmation traversal is a separate question, not bundled
into this change. All earlier scored fixtures/results remain unchanged.

## Implementation checkpoint

Sol/high worker implementation is in this isolated worktree from the fixed
base above; primary acceptance and independent fixed-candidate reviews remain
separate. The changed public entrypoint is only embedded
`openMemoryCore().reviewRationaleDispositions`. Existing `reviewRationale`,
`reviewDecisionBasis`, `getRationale`, capture, MCP and adapter callers do not
invoke it. A new atomic rationale-storage snapshot carries complete current
sources, all bounded in-scope old edges and namespace epoch to that port. The
new internal compiler reuses the existing bounded relation-tuple validator for
additions and returns only an ephemeral projection. No schema migration or
stored-graph write path was added.

Focused synthetic tests cover complete keep/withdraw/unknown review, model
input privacy, source/crossing scope, missing/malformed dispositions, old and
projected edge caps, source/edge/filing/forget/counter/getter races, keyless
cold original-graph equality and existing guard denial of the new method.
Targeted ten disposition tests and four rationale-model guard tests passed
14/14 on Node 22.16 and 24.15 after the final test edits. Worker full-core
suites passed 696/696 on both runtimes. Primary independently ran the full
core suite (before the last test-only additions), store demo, generic suite
(121 tests), JSON and strict-plugin validation, artifact suite, existing
rationale-model guard (four tests), and diagnostic controls (nine tests) on
both runtimes: pass. After the final test edits, primary reran the ten DR
tests and a separate black-box current-core/cold-reopen probe on both: pass.
`git diff --check` passed. These are scripted/synthetic mechanical checks,
not semantic accuracy evidence. No provider key or paid request was used.

Primary reviewed the worker tests and identified an impossible duplicate-edge
snapshot in the initial 24,000-unit-bound test. Worker corrected it to ten
unique valid old edges and asserted that the input snapshot fits; primary
then requested a synthetic-clock timeout/diagnostic test, which worker added.
The final targeted reruns above include both corrections. This record concerns
the working diff from base `620044ddde593074a83355d1d8441d830e5570ca`;
the candidate commit, independent fixed-diff reviews and exact-head CI remain
primary-owned gates. No elapsed time or model cost is inferred here.
