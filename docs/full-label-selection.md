# Full admitted-label selection: evaluation only

This diagnostic asks whether navigation compression hides evidence from the
selector. It does not change the default memory engine or assert that more text
improves memory reliability.

The [ordinary-MOC comparison](retention-moc-results.md) retrieved23 of36 required
sources in both arms. Follow-up inspection of the preserved selector inputs
found materially clipped clauses in four of the13 missing sources per arm;
nine had relevant meaning visible but were not selected. This describes exposure,
not a causal experiment. Expanding labels cannot recover facts lost during
capture and cannot guarantee that visible facts will be selected or understood.

## Capability boundary

`evaluation/architecture/full-label-model.mjs` exports
`createFullLabelSelectionModel(model, { readSet, getMemory })`.
The caller explicitly binds the same core's public `get` method and the exact
read-set namespace order used by recall. There is no CLI flag, package export,
new provider method, production default or automatic enablement.

The wrapper lets the ordinary core construct its original navigation pages.
It replaces each visible memory label with that same active revision's complete
admitted content. It does not add references, alter groups or page order, change
the question or selection instructions, pad the selected set, or bypass ranking.
The normal core still validates selected references, fetches source evidence and
performs authoritative final freshness checks.

Only admitted content is forwarded, not the additional receipts or metadata
returned locally by `get`. This nonetheless exposes more potentially irrelevant
memory content to the selection model than the ordinary short labels. Admitted
content can contain extraction mistakes; it is neither canonical conversation
text nor verified truth. Use only fresh synthetic stores for this diagnostic.

The expanded request must fit the existing model budget. Oversized input is a
failed condition, not permission to expand only useful-looking items, truncate
the request, shrink a page or silently use ordinary labels. Missing or changed
exposed records also fail, including records the model does not select. These
checks are conservative callback fences, not a new atomic snapshot guarantee.
The wrapper counts the actual request against6,000 tokens and24,000 UTF-8 bytes,
and the output against1,024 tokens. Reused input validation also has a
conservative24,000-byte envelope including its own helper instructions; those
instructions are not sent to the selector. The original selection prompt stays
unchanged, and the stricter validation may reject an otherwise fitting request.

## One finite follow-up comparison

No paid result is claimed here. A future experiment must freeze fresh histories,
rubrics, source and operator before any scored calls. Never rerun or regenerate
the scored failures from earlier comparisons. Use the existing cumulative
budget and reviewed request guard; this module supplies no spending authority.

Capture each fresh history once normally, freeze its actual admitted state and
compare short versus full labels. Keep model/settings, query, references, order,
instructions and selection limits fixed; alternate arm order. Preserve exact
inputs, outputs, failures and costs. Required-source judgments stay outside
model-facing inputs and must be audited against actual admitted content.
Freeze identical navigation inputs for each paired selection call, including
any continuation page. If later inputs differ, report those observations as
end-to-end differences, not an isolated effect of label exposure.

Include independently authored scenarios with late decisive predicates and
equally necessary early-visible facts; changed and reaffirmed reasons; actor
and tentative-scope distinctions; similar distractors; and unsupported approval
queries. Report clipped versus already-visible evidence separately. Admission
distortion is its own failure stage, not evidence against navigation compression.

Measure required-source-bearing selected references, losses of evidence retained
by the baseline, distractor selection, request tokens, overflow and cost.
Unchanged downstream ranking may be traced, but answer-host fidelity is a
separate question. Larger context is not a positive score by itself.

Proceed toward a bounded engine change only if independent fresh scenarios show
repeated recovery of previously hidden facts without meaningful retention or
negative-query regressions within unchanged budgets. One comparison is not a
general accuracy benchmark or sufficient proof to promote a default. If fuller
labels do not help, exceed budgets or introduce regressions, stop this expansion
hypothesis and investigate selection behavior or answer-host interpretation;
do not create an endless series of label wrappers.

## Offline verification

`npm test` includes pure synthetic wrapper tests. Its real-core SQLite tests run
on Node22.16 and24; Node20 skips only those SQLite cases. No provider key, model
service, user store or natural chat client is involved. Passing these tests shows
mechanical isolation and safety, not semantic selection quality.

Acceptance: [delivery plan](plans/full-label-selection.md).
