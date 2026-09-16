# Disposition comparison evidence delivery

Fixed base: `35f2c56f0df725b8959e7b088cbd8c247f6c3c8a`.

## Acceptance

- RE1: Publish a sanitized, inspectable record of all six paired synthetic
  cases (12 completed arms), not only successful results. Retain source-local
  indices, actual old-edge order, raw model relationship/disposition outputs,
  and frozen rubric judgments. Exclude private filesystem paths, credentials,
  provider request identifiers and unrelated campaign data.
- RE2: Tie evidence to exact source, fixture, rubric, prompt, artifact and
  retained private report hashes. The report hash is
  `b24012df3033438bec2f77468c9b77de3b9ab51f6ae0171f1dc3400070b6927f`.
  Check retained report and raw outputs directly; no model rerun is permitted.
- RE3: Explicitly fail promotion for both arms. Separate 12/12 structural
  completion, unchanged persisted/cold reads, 6/6 preserved historical supports,
  0 false withdrawals, and genuine-challenge coverage (control 2/5, candidate
  1/5). Record wrong retained edges, wrong unknown, unsupported additions and
  justified missing-antecedent abstention separately. Do not treat explicit
  disposition coverage as semantic accuracy.
- RE4: Describe the once-only 24-request execution, $0.12 reservation,
  $0.005847 known usage estimate, 12 unknown-cost requests and zero unsettled
  reservations. Reservation is not measured actual spend. Disclose scripted
  old-graph seeding, six selected nonblind cases and absence of end-to-end
  capture/MOC/answer or user-benefit evidence. Preserve existing frozen inputs.
- RE5: Document two separately performed semantic adjudications and their
  agreement, including the reviewer who authored v2 semantics (independent of
  other judgments, not candidate design). Hypotheses about anchoring or
  ontology ambiguity are not demonstrated causal explanations.
- RE6: Allowed edits: this plan, one evidence document, one sanitized JSON
  artifact and bounded consistency tests in existing generic evaluation test
  directories if needed. No runtime, provider, prompt, rubric, fixture, grant,
  ledger, private operator, package release or deployment changes. Run generic
  tests, JSON validation and strict plugin checks on Node22.16 and24.15. Freeze
  candidate for primary checks and independent Standards/Spec reviews before
  push/PR; no merge. The read-path feature is a separate worktree.

## Evidence delivery record

- The public evidence is `docs/rationale-disposition-results.md` and
  `docs/evidence/rationale-disposition-results.json`; the latter has SHA-256
  `dfb18ab9b85dfa79e41e2ba0138a576d5ccf244c13802b556c011ca18449ac5c`.
  Only case-local source indices, stored old-edge order, model output text and
  human rubric judgments were projected. Private filesystem paths, persistent
  memory/receipt IDs, provider request identifiers, credentials and unrelated
  campaign rows were excluded.
- The retained final report hash matched RE2. All 12 public raw model texts
  were checked against the corresponding retained HTTP generation responses;
  the actual old-edge order matched each candidate request, with both arms
  seeded from the same fixture. No scored request was retried.
- `evaluation/architecture/test/rationale-disposition-results.test.mjs` checks
  source hashes, local-edge completeness, complete candidate index coverage,
  both raw output shapes, accounting, stated gate counts and publication
  exclusions. These consistency tests do not automate semantic adjudication.
- Node 22.16.0 and 24.15.0 each passed the generic suite (141/141), JSON
  validation, and marketplace plus strict-plugin validation. `git diff --check`
  passed. The shared installed maintainer CLI was invoked under each version's
  npm environment; no package or manifest was changed.
- Both semantic promotion gates remain failed. This candidate awaits the
  primary's checks and independent Standards/Spec reviews; no push, PR, merge,
  release, default change or paid rerun has occurred for this delivery.
