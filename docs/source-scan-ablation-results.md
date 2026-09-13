# Source-selection ablation v1: a narrow retrieval improvement

Eight authored synthetic cases were each run once through both installed MCP
arms, with manually admitted source records and oracle routing labels. All 16
arms completed. This tests retrieval after correct ingestion, not automatic
capture, answers or rationale inference. The [rationale semantic gate still
failed](rationale-pilot-results.md); this experiment does not close it.

Both arms used `gpt-4.1-mini-2025-04-14`, identical receipts and queries, and
alternating execution order. Only `selectionMode` differed. There were no
retries or outcome-driven fixture changes. See the [frozen protocol](source-scan-ablation.md)
and [public evidence](../evaluations/results/source-scan-ablation-v1.json).

## Results

Indices below refer to each case's frozen source order. The fixed rubric counted
12/16 required sources retained by baseline versus 16/16 by source scan. Neither
arm returned any source marked irrelevant. These are source-preservation counts,
**not 75% versus 100% answer accuracy**.

| Case | Baseline indices | Source scan | Interpretation |
| --- | --- | --- | --- |
| printer-connection | 0 | 0, 1 | Baseline selection omitted the USB requirement and unchanged choice. |
| voice-backup-zh | 0 | 0, 1 | Baseline selection omitted the network requirement and no decision to switch. |
| two-people | 2, 0, 1 | 2, 0, 1 | Both preserved distinct people and choices. |
| temporary-route | 0, 1 | 0, 1 | Both preserved normal routine and temporary exception. |
| uncertain-course | 2, 1 | 2, 1, 0 | Baseline ranking, not selection, omitted assistant-suggestion provenance. |
| two-conditions | 0 | 0, 1 | Baseline selection omitted increased price, continuing encryption and no replacement. |
| compatible-confirmation | 0, 1 | 0, 1 | Both retained the choice and compatible confirmation. |
| absent-choice | none | none | Retrieval abstention only; no answer was generated. |

The first, second and sixth cases provide the strongest evidence: baseline
`select` excluded the update, so `rank` never saw it. Source scan supplied and
retained it. For uncertain-course, both rank calls received source order
`[0, 2, 1]`; different model outputs cannot be credited to avoiding a prefilter.
Baseline already preserved tentative interest and continued non-commitment.

Before execution, an independent agent recorded rubric caveats: two-people's
source 1 adds partly redundant user-choice provenance; temporary-route's source
1 already conveys routine and exception; uncertain-course's source 0 adds
assistant-origin context, while sources 1 and 2 preserve non-commitment;
compatible-confirmation's source 0 adds original-choice provenance to a largely
repeated reason. We retained the frozen rubric rather than relabelling outcomes.

Two independent same-family agents inspected the final receipts, stage traces
and metrics. Both confirmed three necessary-update recoveries, the separate
ranking/provenance difference, and no observed returned-context regression.
These are agent assessments, not human or blinded external validation. Separate
store IDs, stochastic calls, eight one-shot pairs, authored labels and small
complete maps limit generalization. Source scan exposes more authorized source
text to ranking, including irrelevant sources that are subsequently discarded.
Zero irrelevant *returned* sources is not zero model exposure.

## Transport, timing and budget

Baseline used 30 HTTP requests; source scan used 16 (46 total). Mean full-arm
duration was 4,933 ms versus 2,806 ms. The timer includes manual store seeding,
MCP startup, recall and client close. It is neither isolated model latency nor
end-to-end user workflow time, and this small run establishes no general speedup.

The attempt reserved US$0.23 conservatively. Known usage was US$0.008392, with
23 additional requests whose actual cost was unknown; unknown does not mean
free. The shared US$50 ledger ended at 538 requests, US$2.69 reserved,
US$0.150609 known usage, 269 unknown-cost requests and zero unsettled requests.
Reservations are not an invoice. No new live calls were made to publish this report.

## Provenance and next gate

- Frozen source commit: `503ad1739aa9631febbbb8f15d2262ba2f54ae82`.
- Fixture SHA-256: `6e31bfd44eaf42de5c0c55e3ccbea617633547155869eec3c2b5d9d02f374eb5`.
- Installed artifact SHA-256: `8301225177082582399ee56177a644ad3d7644f68c1c0200e6a5432646baca07`.
- Parent operator SHA-256: `3fe41cf6c7fdc7ee29ccb4c1efd38dc0f4af9f24ab229c1065a23d152ef91af8`.
- Retained private raw report SHA-256: `d6e24dc8b6c71dcfc9f8964beeaac696bcdfe9c60387854b6f516074678406c3`.
- Public allowlisted projection SHA-256: `5b4138a542f0c20dba514c77057c202b410675642b312eea68e0ae55190d30d4`.

Default recall remains unchanged. The next semantic gate is source-claim and
relationship-direction correctness: finding an update must not invent adoption,
reverse a challenged premise, or confuse another person's choice with the user's.
Automatic ingestion plus retrieval and downstream interpretation still require
separate evidence before claiming a reliable memory loop.
