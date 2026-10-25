# A-2 budget after non-author audit (offline)

**Binding pre-pilot budget gate: PASS.** Pilot responses $20.582400 + the entire shared embedding allowance $2.560000 = **$23.142400**, below $24 by $0.857600. This is budget fit only; certification and other scientific/resource gates remain separate.

**A-3 combined pilot ceiling (complete verified exposure):** settled 0.836664260 USD + outstanding 0.025576400 USD + fresh responses 20.582400000 USD + remaining shared embeddings 2.555133940 USD = **23.999774600 USD**, within the shared $24 cap. Preparation completeness: **verified**. All amounts derive from hash-verified ledger arithmetic, not the rounded $0.84. Embedding units already reserved are not restored. Runs are separate; this is not spending authorization.

| Stage | Calls extraction / reader | Planned cost | Theoretical all-maximum-plus-retry envelope | Existing stage limit |
|---|---:|---:|---:|---:|
| pilot | 240 / 480 | $5.262336 | $20.582400 | $24.000000 |
| development | 800 / 1600 | $17.541120 | $68.608000 | $46.000000 |
| test | 6400 / 12800 | $140.328960 | $548.864000 | $345.000000 |
| alternative | 800 / 800 | $25.172480 | $75.765760 | $45.000000 |
| Shared embeddings | 64M research + 64M P units | $2.560000 | $2.560000 | Charged to active stage |
| Total | | $190.864896 | $716.380160 | $450 operational stop |

**Theoretical-envelope coverage: NO.** 20.582400 + 68.608000 + 548.864000 + 75.765760 + 2.560000 = 716.380160, above $450 by $266.380160. Revised A-2 explicitly supersedes this envelope as the feasibility gate. It is not spending authorization and does not block pilot budget fit. The planning forecast is $190.864896 + 25% ($47.716224) = $238.581120; this estimate does not guarantee completion.

**Later-stage feasibility: PENDING, not computed from fake usage.** Before development, use real settled pilot usage and the frozen input schema in `reports/pre-development-projection.schema.json`. It covers all experiment spending, full outstanding reservations, every remaining stage, shared embeddings, alternative extraction and contingency. Require projected completion <= $400 and compliance with every stage limit. Freeze exact inputs, ledger/configuration/schema/implementation hashes and per-stage arithmetic before development. Any rederived stage limits must fit within $450 and be disclosed first.

Dynamic stage/$450 hard stops and the $500 authorization with $50 unavailable headroom remain unchanged. The complete test is still required; budget exhaustion makes the result Inconclusive. No stage-limit changes or continuation approval were made here. Verified rates and unchanged token/call assumptions are recorded in the JSON; no network, API or credentials were used.
