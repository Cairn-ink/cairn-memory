# Decision-transition answer fixture preparation

Fixed dependent base: `c7ccc68378918427d867747c58bd5d8732c7eb0c`.
This packet prepares synthetic, nonblind diagnostic inputs. It does not run a
model, authorize spending, or claim product accuracy.

## Acceptance

- DT1. Four fresh Chinese-language team conversations form two counterfactual
  pairs. Each case contains exactly three chronological capture batches of
  three messages (36 messages total), with unique case-local message IDs and
  explicit event versus import dates. Pair one shares an initial software
  export decision with two independent reasons and the later loss of only one
  reason; one ending retains the choice pending review and the other explicitly
  adopts a replacement for a stated reason. Pair two shares a conditional
  database-field restriction with two dependencies, later retires one
  dependency and imports an older report; one ending leaves the other
  dependency unverified and the other confirms it remains active. The story
  details must not be renamed versions of earlier diagnostic cases.
- DT2. Each final question requests the current decision or restriction,
  historical reasons, and the changed, still-valid, or unknown conditions.
  Every required evaluator claim cites an existing message ID and an exact
  verbatim passage. The model-facing JSON holds only conversations, batch
  metadata, and questions: no rubric, gold links, grades, or expected answers.
  Submitted speaker claims and passages are source evidence, not authenticated
  truth or execution permission.
- DT3. A separate evaluator-only JSON rubric distinguishes historical fact,
  current applicability, unknown status, and explicit adoption. It permits
  alternate semantically sufficient source support rather than requiring one
  scripted tuple. Literal anchor retrieval and source-supported answer
  correctness are distinct judgments. Optional history is not a hidden
  required criterion. Explicit forbidden conclusions include an automatic
  software switch, all-safe database migration, false rewriting of the old
  decision/dependencies, and blanket refusal of known facts.
- DT4. A later comparison has three cold answer paths per case: ordinary
  source-evidence, actual installed MCP `sourceProjection:
  'neighborhood-sources-v1'`, and equal-model full-history diagnostic. The
  question, answer model, instructions, and output cap are fixed across paths.
  Full history is an oracle-availability diagnostic, not equal context size or
  a product benchmark. Its nine submitted messages may be represented as
  three chronological synthetic batch source groups with exact original
  text, roles, and fixture IDs, explicitly distinct from persisted memories
  or verified truths. It must not silently relax the existing six-source or
  24,000-UTF-8-byte answer-consumer body limits; if safe admission needs another
  bounded operator step, leave it for that step rather than change the
  consumer here. Capture is natural; no manually seeded roots or links.
  This packet implements only fixture and offline structural checks, not the
  operator or scored calls.
- DT5. Before any later live use, freeze fixture/rubric/source/operator pins,
  add diagnostic-phase persistence and complete failure accounting, rehearse
  a bounded one-shot operator, and obtain independent reviews. A proposed
  ceiling is US$2.50 and 240 requests, without retries, under the one shared
  existing budget; only the primary may inspect its actual ledger or keys.
  This packet reads neither. It makes no paid/provider calls.
- DT6. Scope is exactly this plan, `docs/decision-transition-rubric.json`,
  `evaluation/live/decision-transition-fixture.json`, and
  `evaluation/architecture/test/decision-transition-fixture.test.mjs` unless
  a short protocol document proves necessary. The tests check artifact
  structure, separation, IDs, chronology, bounds, and exact anchor references
  but do not score semantics. Run focused/generic/JSON checks on Node 22.16
  and 24.15, then freeze a scoped local commit without push, PR, or merge.

## Ownership and verification

Owner: Sol/high worker. The dependent base is NSP's frozen candidate, not an
authorization to alter its runtime. The primary inspects source/rubric and
arranges independent Standards and Spec review before any later operator is
considered. Authors and reviewers see both sources and rubric: this is not a
blind, held-out, or real-user benchmark. Verification evidence and final
hashes will be recorded here.

## Frozen packet record

The four cases contain 36 synthetic messages total. Within each pair, the
first six source messages and the final question are byte-identical in
content; only the third batch differs. Assistant messages are ordinary
workflow offers, not grading instructions. Source and rubric text were
normalized to the core's NFKC/whitespace admission form so their exact
passages can remain attributable after capture. This trades typographic
Chinese punctuation for canonical storage-compatible text. Dates and the API
check method are evaluator-optional detail; ordering, status, and explicit
authorization boundaries are required. The authored source/rubric are
nonblind, same-family synthetic diagnostics, not independent generalization.

SHA-256: source fixture
`79c4065542d69e52be88b9880b8f507c863995d4005c5f6e911461927ca4420d`;
evaluator-only rubric
`409973020867c7a66c843ca1354e355bee0310ca62f00c37a49347e6de52f958`.
These identify preparation inputs, not semantic correctness.

Worker checks on both Node 22.16.0 and 24.15.0: `node --test
evaluation/architecture/test/decision-transition-fixture.test.mjs` passed
2/2; `npm test` passed 143/143; `npm run validate` and `npm run validate
--prefix tools/plugin-validation` passed. The plugin validator dependency was
installed only within this worktree. Structural tests verify ID/role/date,
batch and text bounds, exact anchors, source/rubric separation, and
counterfactual prefix/question equality. They do not run natural capture,
recall, answers, or adjudication. No operator, provider request, credential,
or real ledger was accessed. Primary acceptance and independent reviews are
still required before any later experimental dispatch.
