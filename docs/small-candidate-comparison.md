# Fixed-candidate retention comparison

Status: fresh synthetic protocol; no scored run in this change. The
[small-candidate policy](small-candidate-retention.md) remains evaluation-only.

The question is deliberately narrow: when a fetched set fits the result limit,
does preserving it help retain changed reasons, and what happens when that set
contains irrelevant material? More sources and fewer rank calls are not enough;
ordinary host answers must preserve scope, attribution and uncertainty.

## Frozen design

The fixture `evaluation/live/small-candidate-fixture.json` contains four new
cases, with evaluative labels kept separately in `small-candidate-rubric.json`.
Every case requests three results. The cases cover three-source positive and
mixed sets, a two-source entirely irrelevant set, and a four-source larger set.
Questions and complete submitted source text are identical between arms.

Before any scored calls, preflight found the original Chinese fixture's
fullwidth punctuation would change under admission's existing NFKC normalization.
The fixture is therefore frozen with NFKC-stable source punctuation, with a test
enforcing that boundary. The operator must still reject any stored-text mismatch;
it cannot repair the source silently. This fixed-input diagnostic does not
establish fidelity for arbitrary normalization-sensitive user text.

Seed one temporary synthetic store per case through trusted `core.admit`, with
one receipt per source and exact original submitted role/content. Reopen the same
unchanged store for each arm. Fix the selector to all of that case's predeclared
source references; never consult the rubric to select evidence. Run actual
`core.recall` with `contextMode: 'source-evidence'` and `limit: 3`:

- Baseline: original OpenAI rank port.
- Candidate: the same model wrapped by `createSmallCandidateRetentionModel`.

Alternate baseline-first and candidate-first by case. Assert identical ordered
rank inputs before attributing any source difference to the policy. Verify each
returned source projection against the store's original receipts before using
the unchanged `prepareInstalledSourceAnswer` / `deliverInstalledSourceAnswer`
ordinary answer path. Despite those helper names, this source-built diagnostic
is not an installed-artifact or natural MCP-client test.

A successful empty recall still gets an ordinary answer call, allowing review
of abstention. A failed recall leaves its preallocated answer slot not run;
never replace it with a full-source control. Do not retry malformed outputs,
regenerate failed answers, widen limits or modify fixtures after scoring starts.

## Boundaries and gates

At most five real rank generations: four baseline and one larger-set candidate.
Each uses one provider input-count request and one generation. Together with
eight ordinary host completions this is at most **18 HTTP requests**. Pin the
current ordinary adapter and host model and preserve all existing token limits.
The proposed local ceiling is **US$1 within the existing cumulative US$50**;
verify the actual reservation policy and remaining ledger balance before
freezing any operator. Unknown costs remain reserved, not treated as free.

Use the existing ordinary request guard for rank and host calls, the same durable
shared ledger, and an exclusive run intent. No new qualification/checklist grant
is needed. Keep keys only in the explicit parent transport, never child env.
Pin the exact source commit, all dependencies, fixtures, rubric, operator and
control before live execution. Require root offline verification, independent
exact-commit reviews and all 17 CI checks first.

Rehearse success, invalid rank, wrong source identity, transport halt,
pin/accounting mismatch and cleanup failure with fake HTTP and separate synthetic
ledgers. Retain available raw responses before interpretation; record cleanup
failures independently. A real run requires a separately frozen reviewed
operator and preflight, not just this protocol's merge.

## Evidence and decision

Preallocate all eight answer slots. Preserve selected references, exact rank
inputs/outputs, final receipts, host answer inputs/raw outputs, failures and not-run
slots. Report required-source retention separately from irrelevant-source
exposure, plus rank calls saved, added context bytes/tokens, latency and cost.
Independent semantic review should examine current and historical reasons,
tentative choices, nonadoption, actor attribution and unsupported authority.

The larger case delegates in both arms; any difference there includes independent
provider variability. Fixed selection excludes extraction and navigation quality.
This does not test real users, long-term maintenance, automatic discovery of
related updates, or installed MCP behavior. Four cases cannot establish a general
accuracy benchmark. Preserve negative evidence and do not promote a new default
without a broader end-to-end comparison.

Acceptance and delivery gates: [plan](plans/small-candidate-comparison.md).

Execution update: the [once-only results](small-candidate-results.md) retain all
eight answers, one concrete source/answer improvement and added irrelevant
exposure. The frozen protocol above is unchanged; the policy is not promoted.
