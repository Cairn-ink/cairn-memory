# Fresh fixed-candidate retention comparison

Initial dependent base `561026398cf08bb9acd08cb74ee9337d3dc471c9` (PR126).
Refresh against merged main before delivery. This freezes a small diagnostic,
not a paid-run grant, product integration or quality claim.

## Question

Does removing redundant ranking for small selected sets preserve changed reasons
without making host answers less faithful when irrelevant evidence is retained?
Separate that question from navigation, extraction and long-term lifecycle.

## Acceptance

1. Add fresh synthetic fixture and separate rubric JSON under `evaluation/live/`
   using ID `small-candidate-comparison-v1`. Exactly four cases in frozen order:
   positive (3 sources), mixed actor/advice distractors (3), none relevant (2),
   larger set (4). Every case uses limit3. Each source has unique safe ID, a
   user/assistant submitted role and <=800-character complete content; question
   <=4000 characters. At least one Traditional Chinese case. No prior fixture
   reuse, hidden planted instructions, credentials or real conversations.
   Source content must already be NFKC-stable before freezing, matching the
   current admission contract. Assert this in fixture tests; reject any further
   stored-text mismatch at execution. This is not a normalization-fidelity test.
2. Keep evaluative labels out of the fixture. The rubric separately defines
   required and irrelevant source IDs and source-supported facts, unknowns and
   prohibited inferences. The positive case contains an original choice with two
   reasons, a changed premise, and reaffirmed remaining reason with a tentative
   choice; changed premise must not imply a new choice. Mixed and none-relevant
   cases test attribution and abstention, not forced empty baseline output.
3. Document fixed execution: one synthetic admitted store per case, reused
   unchanged by both arms; a fixed selector returns all predeclared source refs.
   Actual core recall uses source-evidence, limit3, baseline original OpenAI rank
   versus the small-candidate wrapper. Verify identical ordered rank inputs and
   exact final source projection. Use unchanged ordinary source-answer delivery
   for both arms, including successful empty recalls. Failed recall leaves its
   answer not run. Alternate arm order by case, no retries or repairs.
4. Freeze maximum18 HTTP requests: 5 rank generations, 5 input-count requests,
   8 ordinary host completions; only the larger candidate arm calls rank. Current
   pinned ordinary adapter and host model, unchanged token/output ceilings and
   existing durable shared ledger/guard. Proposed per-run ceiling US$1 within
   cumulative US$50, contingent on verifying actual reservation policy. No run
   before exact commit reviews, all17 CI, source/dependency/operator pinning,
   offline rehearsals and unchanged-budget preflight. Preserve all failures and
   unknown costs. Key remains in explicit parent transport, not child env.
5. Require recording exact selected refs, rank input/output, final receipts,
   eight answer slots and raw available responses, retention and irrelevant
   exposure separately, saved rank calls, added context bytes/tokens, latency
   and cost. No aggregate score turns this four-case diagnostic into a benchmark.
   Larger-set differences include provider variability. No installed-MCP,
   extraction, navigation or real-user claim from source-built fixed selection.
6. Independent fixture tests verify schema, safe unique identities, exact case
   sizes, labels/source membership and disjointness, meaningful rubric fields,
   language and no labels in model-facing data. Root generic/JSON/strictplugin
   and full live-evidence-offline on Node22.16/24, independent reviews on final
   commit and all17 CI before merge. No live operator or paid call in this PR.
