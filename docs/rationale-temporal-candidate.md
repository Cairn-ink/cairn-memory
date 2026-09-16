# Evaluation-only temporal rationale candidate

`createTemporalRationaleModel` wraps an injected model for an explicitly chosen
offline or separately authorized comparison. It accepts only the exact
source-only rationale system prompt and appends the fixed guidance in
`evaluation/architecture/prompts/rationale-temporal-guidance.md` to `relate`
requests. It does not alter core prompts, model defaults, provider schemas,
capture, MCP tools, or other model methods. The underlying model receives the
same source indices and excerpts; the wrapper recounts the modified request
against the existing 6,000-token input bound before its one provider call.
Core still enforces freshness, its 1,024-token output bound, and exact output
validation. The wrapper never repairs or filters a model proposal.

The guidance separates event/applicability time from storage/import order,
retains independently sourced historical reasons, and treats a later genuine
challenge as a reason to review—not a new decision or established truth. These
are instructions, not evidence that model judgment improves. Scripted tests
exercise mechanics only.

The guidance was frozen before the primary authored the six fresh bilingual
[histories](../evaluation/architecture/rationale-temporal-fixture.json) and
their separate [rubric](rationale-temporal-rubric.md). The implementation worker
did not inspect them before the freeze. They adapt known failure categories;
this is not a blind public benchmark, and no scored provider calls have run.
A later paired comparison should count
false challenge direction, missed genuine challenges, omitted independent
supports, abstention, structural failures, and guarded costs for both arms.
Alternative source-supported links require independent semantic review; an
exact tuple mismatch alone is not a failure. No paid runner, provider call, or
default promotion is part of this slice.
