# Complementary source-evidence ranking candidate

The source-evidence rank prompt now asks the existing rank call to retain a
nonredundant set of directly relevant candidates that jointly covers a query.
This is deliberately narrower than a graph rewrite, cap increase or "return all"
policy. Selection, full-receipt fetching, rank limits, reference validation and
the authoritative final read are unchanged.

The instruction calls out multi-fact and multi-session questions, temporal
events, separate people/scopes and changed reasons. It also preserves product
semantics: a proposal is not adoption, a rejected or pending option is not a
settled choice, and evidence that a reason no longer holds does not establish
that the recorded choice was cancelled or replaced. Missing antecedents or
source tails must not be reconstructed. Unrelated candidates remain excluded,
and an empty result remains correct when no supplied evidence is relevant.

## Frozen prospective comparison

The exact previous prompt is retained at
`evaluation/architecture/fixtures/recall-rank-source-evidence-baseline.md`,
SHA-256
`e08ced39cfe8873be5b03fc473d52acbf9ff6682c0741c2a5514df1ce3dc63db`.
`source-coverage-cases.json` contains twelve wholly synthetic model-facing cases
in fixed source order. `source-coverage-rubric.json` separately records the
required any-of groups plus optional, redundant and irrelevant source
annotations; those expectations are not model input.
Their SHA-256 identities are
`d51fda299c7795049e6926ded0083889dbaa849c6b8ace0bae6a15d2a5a0121e` and
`f04721dfd198e82fe3b03b811cc52538e57a72dbc0dc59283b096ee15a8b1bca`,
respectively.
The cases cover exact lookup, three-card questions, history/currentness,
rejected and pending choices, an invalidated premise, person/scope separation,
three temporal events, duplicate versus complementary evidence, no answer,
embedded untrusted instructions and lexical decoys.

Offline tests verify only the package and actual-core plumbing: complete exact
receipts reach rank, selected refs survive finalization, invalid refs still fail,
and no call or limit is added. They do not test whether a model follows the new
instructions. A future paired run must keep both prompt arms, source order,
model controls and request limits fixed, retain every failure, and score required
source retention separately from irrelevant exposure. The separately approved
diagnostic ceiling is at most US$3 within the same cumulative campaign ledger;
this repository change neither spends nor authorizes it.

The motivating observations—two selected references becoming one ranked
reference in one multi-session case, and four becoming one in one temporal
case—localize a possible rank-stage loss. They are not a causal test of this
prompt, do not show that the omitted references were sufficient or correct, and
do not repair or revise any historical benchmark result.

Acceptance details: [source-coverage ranking plan](plans/source-coverage-ranking.md).
