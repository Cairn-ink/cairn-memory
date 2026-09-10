# Default capture: relation-strength diagnostic

Base: `40acbb4cd548d61530606d2137524be9408ed721`, dependent on PR45.

The repaired explicit MCP/Hermes loop does not exercise inferred capture. Earlier
`reference-fix-v1` and `source-faithful-v1` semantic reviews retained unsupported
claims where `uses Go` became `implemented using Go`. The experimental extraction
profile has separate positive evidence, but the default profile remains unchanged.

## Frozen acceptance before provider calls

- S1: No runtime, prompt, model, classification or recall-policy changes. Actual
  current core/SQLite and default `gpt-4.1-mini-2025-04-14`. Normal `core.capture`
  including classification, then model-free list/get of every admitted record.
  No recall, generated answers, same-model judge or retries to obtain success.
- S2: Exactly nine fresh stores: three repetitions of each two-message fixture.
  First fixture preserves the original C02 source IDs/roles/text:
  `harbor-source`: `Harbor uses Go.` and `juniper-source`: `Juniper uses Python.`.
  Second: `Aster uses Rust.` / `Cedar uses Ruby.`. Third:
  `Marigold plans to use SQLite.` / `Birch plans to use PostgreSQL.`.
  All messages have user role. Each family has two required facts; fixed recovery
  denominator18. Repetitions are separate observations, not replacement attempts.
- S3: `uses` does not establish implementation language, exclusivity, adoption date
  or completion. `plans to use` does not establish current use or completed
  adoption. Facts and sources may not be transferred between entities. Exact
  wording is not required; semantically equivalent paraphrases are acceptable.
  Primary and an independent reviewer inspect every record against its actual
  receipts. Any unsupported record fails source support; uncertain means unreviewed,
  never accepted. Report recovery separately (at least17/18 for the local90% gate);
  omissions cannot manufacture perfect quality. Any operation/classification error
  is retained and reported separately from semantic judgment.
- S4: Freeze fixtures, source/operator hashes and local caps before calls. Original
  USD20 ledger only:957 requests /USD10.680 reserved at entry. Additional stop line
  USD0.50 /100 requests, no refill. Primary alone injects the authorized key in
  memory; agents receive only synthetic evidence, never credentials.
- S5: Keep every outcome. A passing nine-run probe does not erase earlier failures
  or establish general capture quality. If it fails, localize the boundary before
  another change; do not respond with an untested prompt patch or default-model
  switch. No private application edits, merging, publication or deployment.

Ranked hypotheses: relation strengthening by extraction (supported historically),
incorrect source selection, classification rewriting, and storage/source loss.
Reading extraction output through admitted content/receipts and normal operation
status distinguishes storage/source and filing failures from unsupported wording;
this is not a recall or large-store paging experiment.

## S6: one full semantic regression after the nine-case diagnostic

The nine-case diagnostic completed with18supported records and18/18required facts
under primary and independent review; one supported record remained unfiled.
This does not erase the historical failures. To assess the changed recall engine
against the existing broader gate, freeze one complete default-profile run of the
unchanged `evaluations/semantic-cases.mjs` and `evaluations/score.mjs`:12cases ×
3repetitions,36runs. No fixture/rubric/prompt/model changes, no replacement runs.
Retain errors, missed targets and pending judgments; independent labels and the
unchanged scorer decide the outcome. This is the existing synthetic suite, not
LongMemEval, a competitor benchmark or human-use evidence.

Use the same durable ledger at993requests /USD10.860reserved. Additional outer
cap USD2 /400requests, under the original USD20 ceiling. The historical runner's
run-local accounting remains an additional stop, not the authority for remaining
campaign funds; every HTTP call must also pass the current shared request guard.
Freeze exact runtime/fixture/scorer/operator hashes before traffic. Primary alone
handles credentials in memory. Do not promote a model or declare overall product
readiness solely because a small repeated suite passes.

## Result and next decision

S1–S5 local diagnostic passed: 18 supported records, all 18 required facts;
17 filed and one unfiled. S6 completed all 36 runs but failed the unchanged semantic
gate: recall/relevance 45/45 each, three unsupported captured statements,
supported recovery 20/24. Primary and independent review agreed on the fabricated
software-project types and the substituted project actor. See
[retained evidence](../evidence/capture-source-faithfulness.md). This delivery
records a failure; it does not implement or claim an extraction repair.

The next recommended candidate is the existing extraction-only
`gpt-5.4-mini-2026-03-17` profile, not another unmeasured prompt patch or an
across-the-board model switch. Its previous full-suite evidence is separate and
does not certify the current engine. OpenAI Docs verification on 2026-09-11
confirmed the pinned snapshot, `reasoning.effort:none`, and standard text prices
of USD0.75 input /USD4.50 output per million tokens in the
[official model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

The current experiment's immutable request-policy binding permits only GPT-4.1
mini on all three channels. Changing a model on this ledger fails `policy_mismatch`;
deleting the binding or opening a fresh allowance would bypass its safeguards.
Before paid comparison or default promotion, obtain explicit authorization for
an extraction-model policy extension while preserving the original USD20 total
and all accumulated reservations. Then implement and review an auditable policy
amendment, run bounded offline accounting tests, and freeze a single comparison.
No binding, default model or allowance was changed here; no further paid run is
in progress. This is an authorization/design boundary, not a claim that more
money or a new credential is currently needed.

Verification: primary ran `npm test` (31/31) and `npm run validate` on Node22.16
and24.15; pinned marketplace and strict plugin checks passed. Source runtime,
fixtures and scorer are unchanged from PR45. The new report and labels can be
checked with the model-free command in the evidence page. Independent fixed-SHA
Standards/Spec review and remote CI are recorded in the delivery PR.
