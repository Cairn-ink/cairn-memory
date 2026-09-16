# Combined cold-neighborhood preparation acceptance

Fixed base: `c82a6eb00ace70ca78a30bbefdecbba9b1aadb8b` (PR156).

This combines two independently authored, bounded packets into one coherent
evaluation-preparation PR, not a new model method or a scored run:

- NC1–7: [external neighborhood source consumer](neighborhood-source-consumer.md).
- CF1–7: [fresh source histories and evaluator-only rubric](cold-neighborhood-fixture.md).

## Integration gate

- Preserve both packet contracts. The runtime, MCP adapter, provider profiles,
  prompts, original source consumer, paid guards and campaign state remain
  unchanged from the fixed base. No extra relationship/basis generation or
  implicit interpretation-to-fact promotion.
- Confirm the actual installed cold MCP neighborhood result reaches the
  existing one-completion source-only consumer through the new explicit
  projection. No fixture gold or handpicked scored root may enter that path.
  Scripted integration tests establish mechanics, not semantic quality.
- Keep four fresh fifteen-message histories separate from their rubric. All
  eight future case/arm slots remain unrun. Verify frozen source and rubric
  hashes, semantic support of obligations, and required versus optional details.
- Primary directly inspects combined diff and personally runs new focused
  tests, installed neighborhood/source delivery, full offline-live and generic
  suites, JSON and strict plugin validation on Node22.16/24.15. Worker full
  artifact gates must pass both runtimes; CI also checks full installed suites.
- Two reviewers who authored neither packet review exact final base-to-head
  diff for Standards and Spec. Record source commits, primary checks, reviews
  and latest-head CI in the PR. Deliver only after all checks pass. No merge,
  release, deployment or paid dispatch is included.

The next step after this packet is a separately frozen bounded operator with
offline rehearsals and budget/pin preflight—not an automatic live invocation.
The known failed disposition comparison remains failed and is not rerun.

## Primary integration evidence

CF source commit `3e8d9adecc242b0a01cd8243acc62286be10d74d` and NC source
commit `844978e020532cd502d8cbc0d9bf6ccc078cad78` were cherry-picked without
conflicts as `0f3e650` and `fb33dab`. The primary owns this integration plan;
the two implementation packets retain their separate Sol/high authors.

On the combined tree, the primary independently ran, on both Node 22.16.0
and 24.15.0: the three focused test files (7 passed),
`npm run test:live-evidence-offline` (269 passed, 30 intentionally skipped),
`npm test` (141 passed), `npm run validate`, and
`npm run validate --prefix tools/plugin-validation` (both validations passed).
The shell completed successfully with `pipefail`; `git diff --check` passed.
No provider dispatch, budget change, production access, merge or release occurred.
Exact final review and latest-head CI evidence belongs in the delivery PR.
