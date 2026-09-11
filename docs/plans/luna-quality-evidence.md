# Luna versus GPT-5.4 mini: evidence delivery

Fixed implementation base: `7ec459a20231e628550f0bdfa517b22b98feccf3` (PR47).
This evidence-only delivery follows [L1-L7](luna-extraction.md). No runtime,
default, prompt, fixture, rubric, budget policy or test threshold is changed here.

## Acceptance before reviewing results

- E1: Preserve the original Luna compatibility probe and every completed or
  failed scored attempt. Public reports may remove only private database paths;
  do not rewrite raw pending-review scores. Publish semantic labels separately.
- E2: Confirm both arms use exactly the same frozen source, corpus, scorer,
  extraction plan and request-policy extension. Report any operator-control
  amendment separately, never claim identical operator hashes after an amendment.
  Report different model and reasoning
  identity honestly; only extraction changes, all other methods stay baseline.
- E3: Independent agent labels each captured claim against its actual source
  receipts, every capture query's returned evidence and all required MOC cases.
  Primary independently inspects sources before agreeing/disagreeing. Unchanged
  scorer must reproduce labels with no pending reviews or review errors; quality
  requires zero unsupported claims and all24 required capture facts as well as
  the existing score gates. Neither human review nor broad reliability is implied.
- E4: Report actual completeness, source support, omissions, recall, relevance,
  lifecycle/isolation checks, latency and model usage. Separate whole-suite costs
  from extraction-only costs: only extraction model changed. Reservations remain
  conservative nonrefundable upper bounds, not invoices or token-cost savings.
- E5: Retain original USD20 run identity, checkpoint, unknown/failed requests and
  cumulative remaining allowance. New extension provisioning must leave original
  binding bytes and full historical ledger state unchanged. No reset/refill,
  credentials, full env, provider raw error or private paths in public evidence.
- E6: Run the model-free scorer on Node22.16 and24 against retained raw reports
  and labels; generic tests/validation and pinned Claude validation. Freeze the
  evidence commit and obtain independent Standards/Spec reviews before PR push.
  No merge, publication, deployment or automatic default promotion. Installed
  programmatic capture and MCP lifecycle are separate next-stage evidence.

The explicit MCP `remember_memory` currently directly admits a user-supplied
assertion; it does not invoke the extractor. A passed programmatic capture
experiment must not be advertised as automatic transcript capture in Hermes.

## Comparison gate clarification, frozen before comparator calls

The original L7 operator stopped when Luna's report was `incomplete`:34/36
completed, two failed empty captures. All36 cases were attempted; all210 guarded
HTTP requests returned200, there were no unrun cases, no budget/transport
rejections and no unsettled requests. Both failed fresh databases confirm
completed empty admission, zero suppression and no stored memory. This is a
measured quality failure, not an unavailable provider or interrupted batch.

To fulfill the owner's already-approved two-model comparison, permit exactly one
GPT-5.4 mini comparator on the unchanged implementation/corpus/scorer within the
original USD1.50 /300-request comparator cap and USD20 cumulative allowance.
This clarifies the execution gate only: every Luna failure remains failed, all
denominators and quality gates stay unchanged, and no Luna retry is authorized.

The revised private operator must validate the complete prior attempted batch,
the two known empty C12 failures, successful HTTP metadata, unchanged frozen
source/plan/binding/token hashes, and the original operator's separately retained
bytes. It records both operator hashes and this amendment hash. A mismatch,
unrun case, unexplained failure, transport/budget failure or unsettled request
still blocks comparison. Independent review must approve this narrow control
amendment before comparator calls. Product integration still requires quality
acceptance; successful API execution alone never promotes a model.
