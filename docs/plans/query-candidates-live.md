# One held-out query-candidate probe

After Q1–Q8 offline and independent reviews pass, execute at most USD0.40 / 80
HTTP requests from the existing USD50 phase ledger. The previous eight requests
and USD0.04 reservation remain; no new ledger, reset, refund or old-case rerun.
Actual core ceiling is 12 arms x at most 6 count/generation calls = 72 requests.

## Frozen protocol

1. Baseline is PR65 `b3429f1`; candidate is the reviewed query-candidate commit.
   Use each version's actual core, OpenAI adapter and request guard. Keep
   `gpt-4.1-mini-2025-04-14`, current prompts and model bounds unchanged.
2. Six independently authored synthetic cases, each in baseline/candidate stores:
   224-record correctly filed exact question; unfiled exact question; misfiled
   two-evidence question; 16-record Chinese, paraphrase and absent-answer controls.
   The private fixture SHA256 is
   `3273cdc78202deb00a590dae17b8887ebb5f3404af7e568f4181bca047311beb`.
   The author saw the specification and audited implementation: metadata held
   out from implementation/test authors, not a blinded or statistical benchmark.
3. Fixed case order is fixture order; baseline first on odd-numbered cases,
   candidate first on even-numbered cases. Explicitly admit correct memories
   with synthetic user receipts and manually file them; no extraction,
   classification, reconciliation, answer model or paid semantic judge.
   Distractors use the fixture prefix plus numbered calibration entries, filed
   under `AAA Archive`; targets use `ZZZ Target topic` or `ZZZ Recipes` when
   misfiled. An unfiled target stays unfiled. Target/rubric metadata never enters
   the model; only query and ordinary core navigation/evidence do.
4. Close/reopen before one recall per arm. Retain source-bound targets and
   cold-store metadata, full selection/ranking traces, result/error envelope,
   post-call cold reads, every request and all incomplete/not-run slots. Check
   unchanged cold source snapshots; infrastructure/persistence failures halt
   all subsequent arms. Expected invalid-model/context-limit failures remain
   incomplete, not success, without retry. Negative empty recall is judged
   against the frozen absent-source case, not automatically counted as failure.
5. Inspect required target coverage, irrelevant returned memories and source
   receipts separately. Independent post-run review must not take model output
   as truth. Report each case/arm and all denominators, not just an aggregate
   improvement. No paraphrase/CJK advantage is attributed to lexical scoring.
6. Before key access/I/O: reviewed frozen operator, exact clean source-tree and
   operator/fixture/policy/authorization hashes, Node pin, settled ledger
   checkpoint (8 requests /40000 microUSD initially), sufficient headroom, and
   an exclusive durable one-shot intent. Mode0600 records in0700 private dirs.
   One guarded request at a time;5000 microUSD conservative reservation each.
   Restrict model/routes/methods to select/rank Responses and token counting.
   Unexpected ledger activity, changed pins, non2xx, transport or persistence
   failure stops the run. No fallback, hidden retries, refunds or failed-case
   replacement. Preflight and offline operator tests never read credentials.
7. Both core review axes and a separate operator safety review must pass before
   calls; outcome/export review follows. Public evidence omits keys and local
   operational paths. No installed-client, real-user or release endorsement.

OpenAI Docs confirms the unchanged standard text pricing of USD0.40 input /
USD1.60 output per million tokens on the
[official model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Unknown count-call usage remains reserved and is not reported as a zero bill.
