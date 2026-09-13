# Narrow rationale-model experiment capability

Base 1de6ea2a0be1f5751d8fd88934b677751655c710 (#82 merge).
This slice adds transport authorization plumbing, not a paid run or a new default.

## Acceptance

1. A separately named immutable capability binds the existing shared ledger,
   baseline policy and settled checkpoint. Never replace old capability files or
   reset the aggregate budget. Reopening requires identical authorization identity.
2. Its guard permits only `cairn_relate` count/generation, with exactly baseline,
   Luna or Sol. No host completion, extraction, qualification or other method.
   Baseline framing stays unchanged; alternate models require reasoning none.
   Existing factories continue to reject alternate relation models.
3. Reuse the existing bounded request/response, exact schema, pre-send reservation,
   cancellation, durable settlement and capability revalidation machinery. Fixed
   conservative per-HTTP reservations are 5,000/3,000/56,000 microUSD, including
   count requests. Unknown usage retains reservations; no retry or fallback.
4. Tests with synthetic ledgers and fake HTTP cover all models, both request types,
   denied methods/models/reasoning, old-grant immutability, tampering, exhausted
   budgets, transport failure and exact pricing. Run contributor budget/guard,
   adapter and generic gates on Node22.16 and24 plus independent dual review.
5. No live call, credential access, operator or automatic new grant. Before a
   live run, separately freeze fresh fixtures, model/input arms, a durable one-shot
   intent, source/artifact hashes, full failure denominator and smaller run caps.
