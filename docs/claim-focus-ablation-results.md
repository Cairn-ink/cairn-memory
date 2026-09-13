# Claim-focus ablation v1: semantic gate not passed

Explicit unverified claim focus did **not** reliably repair rationale endpoint
identity, direction or scope. It remains experimental, not a default for capture.
All 16 arms completed mechanically and persisted identical warm/cold incident
views. That is not evidence of correct interpretation.

Eight fresh authored cases each ran once through source-only and claim-focus
inputs using the actual installed embedded core and OpenAI adapter, with
`gpt-4.1-mini-2025-04-14`. Order alternated. Ingestion was manual, including one
deliberately unsupported stored focus. No capture, retrieval, answerer or MCP
conversation was measured; no failed case was retried. See the [fixture](../evaluation/live/claim-focus-fixture.json)
and [public evidence](../evaluations/results/claim-focus-ablation-v1.json).

## Per-case assessment

Indices refer to fixture record order. S means supports-decision; C means
challenges-premise. Counts are proposal tuples, not accuracy.

| Case | Baseline | Focus | Assessment |
| --- | --- | --- | --- |
| Router | C 1→0 | C 1→0 | Both supported; original self-support omitted. |
| Chinese recorder | C 1→0 | C 1→0 | Both supported; no replacement adoption. Self-support omitted. |
| Shared people | S 0→0, S 0→1, C 2→0 | C 1→0 | Baseline shared receipts hide claim identity. Focus still links different people's original choices; actual update is source 2. |
| Career not decided | C 1→0 | none | Baseline infers an unstated suitability premise; focus appropriately abstains. Not fabricated job adoption. |
| Two premises | S 0→0 | C 0→1 | Baseline misses the price challenge. Focus reverses its direction. |
| Unsupported focus | none | none | Both abstain despite candidate focus falsely saying a course was chosen. |
| Compatible lamp | S 0→1 | S 0→1 | Defensible at receipt level, but focus target 1 is a confirming test, not the decision. |
| Temporary travel | C 0→1 | S 0→1 | Both cross scopes incorrectly: usual tram reasoning neither refutes nor supports Thursday's taxi-for-a-box decision. |

Baseline proposed/inserted nine unique tuples; focus six. Repeated appearances
in incident inspections are deduplicated. Two focus tuples are supported
challenges; four violate focused identity, direction or role/scope. Two focus arms
abstain appropriately. Do not compare this classification directly with baseline
precision: baseline lacked focused identity, and its shared-receipt/lamp tuples
permit receipt-level interpretations disallowed by the stricter focus contract.
Fewer edges or fewer challenges is not evidence of better reasoning.

Router/recorder challenges also lack the original support links needed by the
default decision-context traversal. Incident inspection makes them observable,
but does not establish a complete decision/reason path.

## Pre-live caveats and limits

An independent same-family agent reviewed the fixture before execution. Router
focus was amended to retain “I thought” before outcomes existed. Shared receipts
leave legacy endpoint identity underdetermined; the new update focus still
contains two claims. Career non-adoption alone does not forbid a challenge, but
the particular source states no concrete positive suitability premise. The price
case still has a compound reason: a whole-memory edge cannot identify the atomic
sub-premise. Lamp/temporary support tuples may be permissible without all being
mandatory; missing redundant links is not automatically a wrong answer.

Two independent same-family agents assessed the retained outputs. This is not
human or blinded external evaluation. Eight one-shot authored pairs, different
store IDs and stochastic calls limit generalization. The experiment changes both
input information and focus-specific guidance; it does not isolate their separate
effects. The earlier [rationale pilot failure](rationale-pilot-results.md) remains.

## Cost, timing and provenance

Both arms used 16 HTTP requests, 32 total. Conservative reservation increased
US$0.16; known usage increased US$0.004840, with 16 unknown-cost requests. The
shared US$50 ledger ended at 570 requests, US$2.85 reserved, US$0.155449 known
usage, 285 unknown-cost requests and zero unsettled. Unknown is not free;
reservations are not invoices.

Mean full-arm duration was 1,919 ms baseline and 1,740 ms focus, including manual
seeding, review, warm inspection and keyless cold reopen/inspection. These are
small-run observations, not model-only latency or general speedup evidence.

- Source commit: `bd4bb5c718570d97d2ba93797079f9eb48636933`.
- Artifact SHA-256: `ea3976ec01f1852d0e7bc7ae00f9d26d877eac55a28f397a3fcdad82176405fb`.
- Fixture SHA-256: `f4002b94bd4bb2bc2efd1594300084021e40b9cfa466eba999a287a35605d141`.
- Operator SHA-256: `cf202a9db4c12756c46515ac2e05bb6be4fd76ca560a4da02c21a555df722d35`.
- Pre-live caveat SHA-256: `fa1fe16bd2a9525eb8bf35745c01d76e02a857067495f3199bc4a3fc95924e9c`.
- Private raw report SHA-256: `b5d1d48691fc7589ef816c845f747461fff75eab56907cfc1f93c609c703c251`.
- Public projection SHA-256: `0ccabc256518148bdefb8e9bc6ba8c6bd8da57a3684d6a8e22613719bb4ae9f0`.

Before live execution, the final operator passed actual-guard fake-service tests:
32 requests/16 completed; malformed output 32/15 completed; transport failure
one unknown reservation/one failed arm/15 unrun. Earlier preparation-only drafts
failed offline setup and were preserved; neither was executed live.

## Next direction

Do not promote this mode based on these results. Investigate explicit source-bound
decision, reason and counterevidence units before relation assignment. Named roles
and source anchors should be evaluated separately from arbitrary from/to tuples;
exact quote binding would still not prove entailment or authorization. No new
method or semantic success is claimed by this report.
