# One-shot paired qualified-reconciliation experiment

Owner authorized on 2026-09-13: within original cumulative US$20, at most US$2.30
additional reservation and272 HTTP requests, eight new bilingual cases, each
version once. Offline verification and independent review must pass first.
No rerun of prior failed cases, retries, tuning after seeing outcomes, model
training, publication, deployment or self-merge.

## Frozen design and acceptance

- P1: baseline core/adapter/guard/prompt at
  `08b566fc6949f65148460e23919e49fcfb188fef`; qualified at
  `cb5d31d32a62532d36663613cbb3451956259d6d`. Pin complete candidate trees and
  this harness commit before transport. No cross-arm schema/prompt substitution.
  Use the same extraction model `gpt-5.4-mini-2026-03-17` and baseline judgment/
  recall/answer model `gpt-4.1-mini-2025-04-14` as the earlier experiment.
- P2: an independent author supplies eight previously unexecuted source-only
  cases: four English/four Mandarin, two windows and one current-state query
  each. Per language: adopted update, history plus reaffirmation, uncertain/
  rejected proposal, and distinct speaker/subject/scope. Keep expected answers,
  classifications and transition obligations in a separate evaluator file, never
  model input. Freeze SHA256s before execution; implementation authors must not
  use held-out contents for prompt/core tuning. This is eight cases, not a claim
  of real-world reliability. Retain all16 case-arm outcomes, including not_run.
- P3: case order fixed Q01..Q08; alternate arm order per case (baseline first on
  odd-numbered cases, qualified first on even). Balanced deterministic scheduling
  is not randomization. Use separate synthetic databases per case/arm; actual
  capture twice with trusted source-order allocation, close/reopen after each
  window, complete state/receipt snapshots, then fresh current recall and one
  answer using only query and retrieved evidence. No paid judge.
- P4: each arm uses its own pinned request guard and existing immutable tokens
  over the SAME durable ledger, with one operator and serialized requests. Keep
  the20M-microUSD/4000-request configuration unchanged. Do not create/replenish
  or edit campaign ledger/policy/tokens. Preflight open/settled state and enough
  headroom; initial checkpoint1919 requests/15,706,048 microUSD reserved. Known
  usage is not the conservative budget. Re-read at execution rather than trusting
  this text. Reject unexpected budget activity, changed pins/bindings or unsafe
  persistence before further transport.
- P5: a shared per-attempt gate reserves conservatively before forwarding:
  baseline count/generation5000 each; extraction count5268/generation9876;
  answer host50000. At most16 per-arm model HTTP requests plus one answer:
  16 case-arms x17 =272; worst-case reserved2,244,608 microUSD. Enforce2,300,000
  microUSD and272 requests regardless of actual lower usage. Every request also
  passes the existing campaign guard. Unknown/failed usage is never refunded.
  Stop further calls on transport, non-2xx, guard, accounting, pin or persistence
  failure. Semantic failure is retained, not retried; other scheduled cases may
  continue while transport/accounting remain healthy.
- P6: freeze an exclusive durable intent before paid I/O; reject attempt reuse.
  Persist per-stage raw synthetic envelopes, state/receipts, model input/output,
  answers, durations and content-free request/accounting metadata incrementally.
  No API keys, authorization headers or private conversations in reports/logs.
  Preserve partial outcomes if a stage fails; classify later unexecuted steps
  explicitly. Stop if evidence cannot be persisted; no overwrite or automatic
  repair. Keep authoritative private reports and export only inspected synthetic
  evidence and aggregate accounting.
- P7: independent post-run review checks all persisted assertions and every
  retirement against sources; evaluates current-state correctness, qualification,
  required retrieval, unsupported answers and justified positive updates.
  Report denominators by language and outcome, not only aggregate answer accuracy.
  Correct final wording cannot excuse wrong state transitions; abstaining on all
  updates cannot pass. Judge unobserved/failed operations as missing, never pass.
- P8: public harness tests use independent development fixtures/fake transports,
  real SQLite and actual pinned adapters where relevant. Verify cap boundaries,
  malformed input, source/oracle separation, cold snapshots, retain-failure/not_run,
  one-shot persistence and no retry. Run Node22.16/24 offline gates and fixed-diff
  Standards/Spec reviews before live execution. Afterward review retained evidence
  and final delivery diff; no semantic-success claim before that review.

The runner accepts injected candidate factories and a guarded answer function;
it never selects credentials, initializes a ledger or silently calls native fetch.
An operator outside the distributable runtime owns approved local credential
loading, immutable pin checks, existing-token validation and the one-shot intent.
