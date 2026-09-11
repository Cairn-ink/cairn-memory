# Multi-turn history diagnostic

Base: `ce4632bbe372545ff57bc674b2c3b152a7c112c1` (PR49, not merged).
This package measures capture/recall gaps; it does not silently add automatic
conflict resolution, alter prompts/defaults or claim a long-history benchmark.

## Acceptance frozen before implementation and model calls

- H1: Four deterministic synthetic histories cover a within-window explicit
  change, a three-window change with a rejected proposal, entity/negation and
  attribution, and a24-message window with required facts at beginning/middle/end.
  Keep each capture within current input limits. Freeze histories and independent
  required/forbidden propositions before calls. No replacement or cherry-picking.
- H2: The model-facing runner receives only messages and queries, never required
  answers, forbidden propositions, review labels or oracle IDs. Reuse actual
  public core and injected model. Capture windows sequentially, close/reopen the
  same fresh synthetic store between windows and before final recall. No admit,
  correct, conflict resolution or evaluator cleanup may repair model output.
- H3: Retain every window's capture result and all current records/receipts after
  it, plus complete final recall envelopes, model diagnostics, failures and unrun
  windows. Validate structural receipt identity against supplied source windows.
  Record cold-reopen persistence and distinguish window processing from quality.
- H4: Independent review labels every stored assertion for source support and
  current-vs-historical truth, required-fact retention and returned relevance.
  Temporal correctness is separate from literal source support: an old Friday
  assertion can be supported historically yet wrong as current truth. Missing
  review, failed capture/recall, unrun windows, malformed labels or incomplete
  coverage cannot pass. No model-based judge or keyword-only semantic pass.
- H5: Model-free regression tests use actual core with scripted models and test
  failure retention, reopening, oracle separation, source mismatch, incomplete
  recall, missing/duplicate labels and the historically-supported-but-stale case.
  Wire tests into existing OpenAI offline CI. Run that suite, generic31 tests and
  validation on Node22.16 and24, plus pinned Claude validation. Freeze and obtain
  independent Standards/Spec reviews before any paid execution or PR push.
- H6: If running live, one four-history attempt, explicit previously accepted
  GPT-5.4 mini extraction and unchanged baseline other methods. Primary alone
  uses the existing key/guard/extension and original USD20 ledger, starting at
 1673requests/USD14.326872reserved with0unsettled. Local capUSD0.75 and150requests,
  no retry/refill/new allowance. Freeze immutable operator intent/code/fixture
  hashes; retain sanitized results and independent review even on failure.
  No merge, publication, deployment, production or default promotion.

Passing this small diagnostic does not demonstrate autonomous host capture,
large-history performance or user adoption. A failure yields a concrete next
engine contract/fix proposal; it must not be patched invisibly during scoring.
