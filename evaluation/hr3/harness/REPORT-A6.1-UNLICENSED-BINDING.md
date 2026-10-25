# Trivia P2-2 — no-trivia exemption bound to the complete trusted target

Focused fix only; no full recertification, full fake pilot, freeze or commit.
Commands ran directly and unlocked. No network, key access, provider dispatch or
new paid reservation. Numerical limits and scoring semantics are unchanged.
The existing `a6-verification.json` remains failed; nothing is promoted to paid
readiness. The primary starts recertification after the scorer worker finishes.

## Fix and trusted authority

- `scoring-a6.mjs:12` requires a trusted source world and its exact adapted gold.
  `unlicensed-authority-a6.mjs:6` is a fixed, deeply frozen catalog of explicit
  no-trivia engineering authoring targets: base, conjunctive and alternative
  English witnesses, plus the independent Chinese-question witness used by the
  replay test. Each record commits to family/world ID, source-specific case ID,
  exact question, complete source-world SHA-256 and projected-gold SHA-256.
  There is no caller-supplied authority/declaration flag or runtime registration
  of new source worlds. Candidate answer text never selects an authority record.
- The catalog is fixed code, not inferred from missing trivia at scoring time.
  Matching includes the complete original source/delivery/support plans and exact
  original private gold, independently of submitted answers. An unknown source,
  family, case or question fails `frozen_unlicensed_target_required`; mismatched
  projected gold fails `unlicensed_gold_target_mismatch`. A future bank needs an
  explicit catalog/source review and recertification. Generator families have no
  entry: their separately pinned generator authority and proofs remain required.
- `scoring-a6.mjs:21` binds opaque tokens and the actual adapted gold object in
  separate private WeakMaps to the full authority/record digest. `:25` requires
  both bindings to agree and rechecks the complete gold digest on every call.
  Matching questions alone cannot transfer an exemption. Copied/mutated gold,
  cloned tokens, same-question tokens from different source cases, and licensed
  targets stripped of trivia all fail closed. An exemption grants no optional
  character positions and does not alter the raw scorer's literal semantics.
- `integration/adapters.mjs:95` constructs the gold from the trusted joined world
  before requesting its no-trivia binding at `:96`. The candidate remains separate.
  The private authority/catalog and binding records never enter reader bodies,
  receipts or retrieval. Opaque tokens serialize with no target metadata.
- The new authority is a static MJS import of the scoring guard, so it is part of
  the actual runtime dependency graph consumed by both closure derivation routes.
  No closure certificate or freeze was regenerated in this focused task.

## Regression tests and evidence

All tests are in `test/trivia-consumers-a6.test.mjs`; the four added tests are:

1. `:79` **P2-2 en: unrelated no-trivia token cannot downgrade a licensed same-question target**.
2. `:79` **P2-2 zh-Hant: unrelated no-trivia token cannot downgrade a licensed same-question target**.
3. `:96` **P2-2 no-trivia authority: unknown family case question and source cannot self-declare absence**.
4. `:104` **P2-2 no-trivia binding: same-question cases cannot exchange tokens or cloned gold**.

The two bilingual regressions select genuinely licensed final `.` / `。` omissions
through the real verified-input/guarded harness path and first assert R=1. They
then empty licensed case A's trivia, keep its question identical to independent
case B, and try B's genuine no-trivia token. Both throw after the fix. The same
stripped case also fails with A's original licensed options; metadata removal
never downgrades it to literal-only scoring.

Both replay regressions ran against the pre-fix guard and failed with **Missing
expected exception**, confirming the reviewer's accepted downgrade path in English
and Chinese (0 passed / 2 failed, exit 1, expected baseline). The pre-fix source
SHA-256 and exact command/log digests are in `reports/p22-result.json`.

| Command | Passed | Failed | Actual exit | Meaning |
| --- | ---: | ---: | ---: | --- |
| p22-baseline (two replay tests) | 0 | 2 | 1 | Expected failure on old guard |
| p22-focused (first attempt) | 19 | 1 | 1 | New test changed quote length without its endpoint; schema rejected before binding |
| p22-focused-final | 20 | 0 | 0 | All 16 existing focused tests plus four new regressions |
| p22-integration-focused | 7 | 0 | 0 | Existing adapter source-integrity, quotation/topology, loss, metadata and referral tests |

The first focused-attempt failure was a test-fixture construction error: a quote
length change made the span invalid. The final test changes one character while
preserving the valid span length; its binding-error assertion is unchanged.
No production rule was weakened to pass it. Earlier logs are retained.

## Deliberately deferred verification

The full harness suite directly imports `scorer/scorer.mjs` and `scorer/support.mjs`,
which the primary identifies as in-flight. It was therefore not run, following
this task's condition. Full recertification, generator/scorer suites, standalone
480-answer fake pilot, leak scan, bound report, reconciliation, certificate bundle
and freeze were not run. The prior successful full-suite results are not relabelled
as certification of this changed guard.

All protected files matched their entry hashes during the focused work; exact
count is in the machine report. Writes stay within harness/integration. Scope and
changed-file inventory are mechanically derived by Git/Python SHA-256 and an
independent recursive Dirent/Node SHA-256 traversal, then canonically diffed in
`reports/a6-changes.json`. The primary owns the stable-source full rerun and freeze.
