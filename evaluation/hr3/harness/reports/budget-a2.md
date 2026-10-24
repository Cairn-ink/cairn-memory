# A-2 budget recomputation (offline)

The output caps pass certification separately. The complete protocol reservation plan does **not** fit the unchanged operational budget.

| Stage | Extraction / reader calls | Attempts at ceiling | Expected planned cost | Worst reservation | Existing limit | Covered |
|---|---:|---:|---:|---:|---:|---|
| pilot | 240 / 480 | 480 / 960 | $5.065728 | $17.117184 | $24.000000 | Yes |
| development | 800 / 1600 | 1600 / 3200 | $16.885760 | $57.057280 | $46.000000 | No |
| test | 6400 / 12800 | 12800 / 25600 | $135.086080 | $456.458240 | $345.000000 | No |
| alternative | 800 / 800 | 1600 / 1600 | $24.087040 | $67.194880 | $45.000000 | No |
| Shared research + P embeddings | — | Within shared unit allowances | $2.560000 | $2.560000 | Shared | — |
| Total | | | $183.684608 | $600.387584 | $450.000000 | No |

Reservations per attempt are: primary extraction $0.0131072, primary reader $0.0112768, alternative extraction $0.0307200. Each stage reserves twice its logical call counts. Embeddings add (64M + 64M) × $0.02/M = $2.56 once. They also consume the active stage's limit, rather than providing an extra stage allowance.

17.117184 + 57.057280 + 456.458240 + 67.194880 + 2.560000 = 600.387584 > 450.000000. The $450 shortfall is $150.387584. Even the gross $500 authorization is short by $100.387584, before preserving its unavailable $50 headroom. No valid stage-limit allocation within $450 exists; no limit changes were applied.

The forecast uses the unchanged §14 input assumptions (8,000 extraction / 6,000 reader), the new full output caps, one attempt per call, and the full embedding allowance. It is $183.684608 + 25% ($45.921152) = **$229.605760**. This is a planning assumption, not measured model usage. Rates are the primary-supplied 2026-10-25 verification; no network or API was used.

The original ceiling reproduces exactly at $440.905728; A-2 increases it by $159.481856. Further primary amendment of the workload/reservation design is required before the complete paid plan is feasible. The operational stop remains $450 and authorization remains $500.
