# Explicit answer boundary v2

Status: implementation complete; awaiting primary acceptance and independent review. Offline mechanics only. Initial base:
`7a80e088be7732e51250762d5badae9bad8064b6`.
Phase B fixed base after the accepted capture-admission-observation integration:
`327cdbc98b9fe71dde3c57983035c67e843635ff`.

The change tests the hypothesis that putting quoted historical evidence before a
separate final current question/date helps the answer model stay on the current
task. It does not establish that this caused or fixes the earlier full-history
mistakes, and it does not authorize new scored or paid calls.

## Acceptance

### AB1 — Explicit version and preserved v1

`runPublicComparison` and `runPublicPilot` accept optional
`answerTemplateVersion`; the CLI accepts `--answer-template-version`. The only
values are existing `cairn-longmemeval-public-answer-v1` and new
`cairn-longmemeval-public-answer-v2`. True absence means v1; present `undefined`,
empty, or unknown values fail before capture, answer, judge, reservation, ledger
open/authorization, or writes. The version is snapshotted once. Omitted and
explicit v1 preserve existing request bytes and run, score, aggregate, pilot,
and CLI output shapes.

### AB2 — One controlled request difference

V2 preserves the system instruction byte-for-byte and changes only user content
to `JSON.stringify({ evidence, currentQuestion: { text, date } })` in that key
order. The identical wrapper applies to Cairn, full-history, and no-memory;
their evidence representations do not change. Historical roles remain quoted
data rather than provider message roles. Model, temperature, `n`, output/context
bounds, token counter, timeout, arm order, guard, and no-retry policy remain
unchanged. Requests contain no arm labels, evaluator data, references, reference
sessions, or extra task hints. Positional artifact labeling stays authoritative;
fallback inspection continues to read `.evidence` and keeps empty evidence
ambiguous.

### AB3 — Scoring and aggregation identity

Scoring validates generation `templateVersion` before judge calls. Legacy absent
generation identity means v1 only; unknown identity fails. V1 score output stays
unchanged. V2 uses a distinct scoring schema and carries exact
`answerTemplateVersion`; the judge prompt, rubric, parser, reference rendering,
models, and compatibility pin do not change.

`aggregateOfficialScores` accepts an optional expected version, defaulting to
v1, and rejects mixed, unknown, or schema/marker-mismatched records. A v1 schema
cannot carry a v2 marker. V2 aggregate identity survives even with zero score
records. V1 aggregate output remains unchanged, and denominators retain their
existing meaning.

### AB4 — Resume and merge cannot lose identity

Before the first request, v2 identity is bound in manifest and checkpoint and is
retained in generation/scoring wrappers (including failures and blocks), final
aggregate/report, and merged output. V1 omits new artifact fields; missing
identity is interpreted only as v1. Completed nested run/score identity must
match its wrapper.

Resume validates requested, manifest, checkpoint, all existing selected-case
generation/scoring artifacts, and any aggregate/report before writes, callbacks,
reservations, or earlier pending-case work. Legitimate interrupted missing
artifacts in `generating`/`scoring` remain supported; pending state with existing
generation/scoring data and other inconsistent identities fail closed. No old
file is rewritten or failed case replayed.

Merge validates manifest, checkpoint, report, aggregate, and every case's
generation/scoring wrapper, including failed, blocked, and zero-score cases,
before creating output. All inputs must have one effective version. Editing one
wrapper cannot relabel v2; absent identity never fabricates it.

### AB5 — Falsifiable offline evidence

Existing synthetic suites must show a public-boundary RED before implementation,
then cover exact v1 preservation; exact v2 bodies for all arms; benign, hostile,
multilingual, and long-history shapes; evaluator non-leakage; unchanged paired
blocking; no retry and at most three answer attempts; timeout behavior; invalid
version without side effects; immutable option snapshot; v2 scored and zero-record
aggregates; unknown/mixed identity; all-layer resume mismatch before work;
same-version and mixed-version merge; all-blocked v2 merge; and legacy v1
artifacts. Fake provider bodies and reservation counts are checked directly.
Scripted answers provide mechanics evidence, not instruction-following quality.

### AB6 — Documentation and gates

Comparison, scoring, pilot, protocol, limitations, and changelog documentation
must mark v2 as explicit experimental opt-in and non-comparable with v1. The old
pilot result remains unchanged. Run focused tests, full LongMemEval and its three
demos, live-offline, OpenAI, generic, JSON/plugin validation on Node 22.16 and
24.15. Primary acceptance and both independent review axes inspect one frozen
candidate; no merge, publication, deployment, corpus read, or provider call is
part of this change.

## Ownership and sequencing

Phase A owner: delegated Sol/high worker. It owns only
`evaluation/longmemeval/public-comparison.mjs`, `official-scoring.mjs`, their
existing tests, and this plan. It implements AB1–AB3, records RED/GREEN evidence,
and stops without committing.

The capture-admission-observation worker owns the initially non-overlapping
pilot/CLI/merge and shared-document files. After that candidate is accepted and
integrated, the primary pins a new base before assigning Phase B. The primary
owns integration, direct gates, the fixed candidate commit, and independent
Standards/Spec review.

No core, adapter, guard, ledger-policy, corpus, prepared artifact, dependency,
new framework, rubric, or label change is allowed.

## Implementation evidence

- Phase A boundary RED reached the public comparison/scoring APIs (16 passing,
  6 failing) without relying on missing-export syntax errors. Phase B boundary
  RED had 42 passing and 3 failing tests: explicit v2 was rejected at the
  pilot boundary and a later tampered identity was not preflighted before an
  earlier pending case.
- Focused comparison, scoring, pilot, and merge tests pass 57/57 on Node
  22.16.0 and Node 24.15.0. A subsequently added real durable-generation-
  failure resume regression passes for both omitted-v1 and explicit-v2 on both
  runtimes; it performs no provider request and returns the existing report.
- All evidence is synthetic and offline. No provider call, key, corpus,
  historical run rewrite, or semantic-quality inference is part of it. The
  primary owns the full dual-runtime acceptance gates and fixed candidate.
