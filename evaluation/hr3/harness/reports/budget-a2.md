# A-2 budget after non-author audit (offline)

**Binding pre-pilot budget gate: PASS.** Pilot responses $17.510400 + the entire shared embedding allowance $2.560000 = **$20.070400**, below $24 by $3.929600. This is budget fit only; certification and other scientific/resource gates remain separate.

**A-3 combined pilot ceiling:** first-run reported spend $0.840000 + fresh-run conservative ceiling $20.070400 = $20.910400, below the shared $24 pilot cap. The source is A-3's reported first-run spending, not a new ledger settlement. The runs are separate and are never pooled. This calculation does not authorize a paid rerun.

| Stage | Calls extraction / reader | Planned cost | Theoretical all-maximum-plus-retry envelope | Existing stage limit |
|---|---:|---:|---:|---:|
| pilot | 240 / 480 | $5.262336 | $17.510400 | $24.000000 |
| development | 800 / 1600 | $17.541120 | $58.368000 | $46.000000 |
| test | 6400 / 12800 | $140.328960 | $466.944000 | $345.000000 |
| alternative | 800 / 800 | $25.172480 | $69.365760 | $45.000000 |
| Shared embeddings | 64M research + 64M P units | $2.560000 | $2.560000 | Charged to active stage |
| Total | | $190.864896 | $614.748160 | $450 operational stop |

**Theoretical-envelope coverage: NO.** 17.510400 + 58.368000 + 466.944000 + 69.365760 + 2.560000 = 614.748160, above $450 by $164.748160. Revised A-2 explicitly supersedes this envelope as the feasibility gate. It is not spending authorization and does not block pilot budget fit. The planning forecast is $190.864896 + 25% ($47.716224) = $238.581120; this estimate does not guarantee completion.

**Later-stage feasibility: PENDING, not computed from fake usage.** Before development, use real settled pilot usage and the frozen input schema in `reports/pre-development-projection.schema.json`. It covers all experiment spending, full outstanding reservations, every remaining stage, shared embeddings, alternative extraction and contingency. Require projected completion <= $400 and compliance with every stage limit. Freeze exact inputs, ledger/configuration/schema/implementation hashes and per-stage arithmetic before development. Any rederived stage limits must fit within $450 and be disclosed first.

Dynamic stage/$450 hard stops and the $500 authorization with $50 unavailable headroom remain unchanged. The complete test is still required; budget exhaustion makes the result Inconclusive. No stage-limit changes or continuation approval were made here. Verified rates and unchanged token/call assumptions are recorded in the JSON; no network, API or credentials were used.
