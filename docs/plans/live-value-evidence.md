# First model-backed value and evaluation evidence

Fixed base: bbcaac46cf78f6e081bc9de6c989e600bf525168 (PR37/38 merged).
User authorized this experiment's cumulative model spending up to USD20, including
failed calls and reruns. No renewed ledger, release, merge, production or private
application changes are authorized. Primary alone executes paid requests.

## Acceptance

- L01: One durable shared ledger, limit 20,000,000 microUSD, request cap 4000,
  reused across both tracks and any reruns. All external model calls pass through
  the merged request guard and a single-attempt native fetch, never SDK retries.
  Reopen rather than replenish. Retain failed/unknown accounting. No secrets in
  logs, URLs, prompts, reports or repository; inject only the authorized key.
- L02: Pin existing baseline gpt-4.1-mini-2025-04-14 throughout memory, answering
  and judging. Standard text input USD0.40/output USD1.60 per million tokens,
  official model page checked before calls; ignore cache discounts conservatively.
  Host max input 100000 (UTF8 bytes plus framing), output1024, reservation50000
  microUSD; Cairn max input7024/output1024, reservation5000; count output0,
  reservation5000 and actual cost unknown. Timeout60s, no media/streaming/tools
  outside the existing guard subset. Record usage-priced cost separately from
  reserved allowance; neither is an audited invoice.
- L03: Frozen value prompts follow docs/hermes-first-use.md stages A–F plus
  no-memory control. Each fresh session starts without previous dialogue; only
  Cairn store persists. Discover actual tool schemas, execute actual memory tools,
  retain model-chosen calls/results and independent store/receipt checks. No
  handcrafted successful tool responses or answer repair. Real Hermes evidence
  requires all its host/background routes guarded; if not feasible in this slice,
  clearly label the narrower MCP test host and leave native Hermes unverified.
- L04: Use the existing seven-case prepared LongMemEval pilot unchanged, verifying
  manifest artifact hashes before calls. No corpus download or answer annotations
  in generation. Run actual core capture/recall and existing three-arm comparison;
  freeze model, prompts, limits, sample and judge rubric before generation. Keep
  all seven cases and failures. No silent source truncation or invented results.
- L05: Evaluate only after generation. Report each arm separately, attempted,
  completed, judged, correct, unknown/failed and evidence-coverage denominators.
  Semantic judgments are a pinned same-model rubric, not independent human or
  official LongMemEval scores. Primary inspects disagreements/failures; no tuning
  on answers or skipping difficult cases. Track latency, storage and known versus
  unknown cost. Safety failures are not averaged into QA scores.
  Up to three independent case generations may run concurrently, sharing only
  stateless callbacks and the global ledger. Report order remains the fixed
  sample order; no judge starts until all case generation settles.
- L06: Offline fake-HTTP tests prove all routes/accounting, malformed output and
  unknown failures, evaluator isolation and deterministic prompt boundaries before
  live calls. Primary verifies both Node22.16/24 and real integrated paths.
  Public report contains aggregate/source IDs only for the corpus and synthetic
  value evidence, not redistributed corpus text, secrets or personal paths.
- L07: Candidate commits pass contributor gates and independent Standards/Spec
  reviews before PR. Fix/reverify/rereview changes. Live failures are evidence,
  never converted into passing quality claims. Record exact tested revision,
  prompts/artifact hashes, local private evidence location and paid run totals.

## Ownership

Primary owns live session/transport, credentials, global ledger, run execution,
acceptance, docs/results and integration. Sol high workers own bounded value/eval
modules and offline tests; no credentials or paid requests. Separate read-only
reviewers inspect final committed diff. No core/default/provider/schema changes
unless a concrete defect requires a separately reviewed scope.

Pricing source: https://developers.openai.com/api/docs/models/gpt-4.1-mini

## Separately frozen Hermes authority follow-up

The first trial is retained in commit e7b37f364aafa91fb9ee6b1a37f51b02ad631538.
Its C stage performed a valid current-revision correction using an actual recall
result, but the inspector required the literal inspect tool and halted D–F.
This is a false-negative harness constraint, not permission to rewrite the trial.

For one fresh-profile follow-up, keep prompts/model/tools/engine/limits unchanged
and freeze acceptance `cairn-value-authority-v2` before any call. C/E must first
observe the same ID, current revision and matching source receipt through actual
inspect OR actual recall, in trace order before the mutation. The mutation must
use that ID/expectedRevision; C must increment by one and leave one active memory
with a new matching receipt; E must leave the target absent. Reject stale reads,
unsupported receipts and reads only after mutation. Retain the original trial,
new source hashes, all new failures and the same cumulative USD20 ledger.
Primary semantic review of final answers remains required; the control's no-tool
predicate is not a semantic task pass. No repeated reruns until green.
