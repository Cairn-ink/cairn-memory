# Decision-transition diagnostic: one frozen synthetic run

The [machine-readable record](decision-transition-results.json) preserves all 12 planned slots, the 11 exact generated answers, local source-unit inventories, literal-anchor availability and per-claim AI assessments. This was a one-shot, nonblind development diagnostic on four engineered Chinese counterfactual cases—not a human or blind evaluation, general accuracy estimate, causal benefit, real-user result or release-readiness claim. The primary and independent AI reviews agreed on the distinctions below; generated does not mean semantically passed.

## Provenance and accounting

Source commit `bdc7be8a59b2a535144e1c851133a1fa970cc442`; frozen source-tree SHA-256 `a74aa6bc5efc82be140096d92552cc1dc0a6a75e0f7c5bfcc3f5487d8c0162be`. Fixture `79c4065542d69e52be88b9880b8f507c863995d4005c5f6e911461927ca4420d`, evaluator-only rubric `409973020867c7a66c843ca1354e355bee0310ca62f00c37a49347e6de52f958`, private export-only operator `62b4fba74887135c924844a5733a47d2e7896058169b3e2f55425ddca68b7ce1`, installed archive `09d45659837d034d37274e04558c47033dd7068607584ce8d49c69f845f1c1ca`, and frozen final report `4cfe3fcb92298abc3bc5267194f4994cadca9c4d837feaa25e22473642397ca9`. The cold-reader pin and detailed limits are in the JSON. The answer model was `gpt-4.1-mini-2025-04-14`, with a 1,024-token output ceiling across paths.

The operator attempted 139 guarded HTTP requests: 128 core and 11 answer completions, below its theoretical 156-request/$1.32 reservation ceiling and outer 240-request/$2.50 ceiling. Conservative reservation increased by $1.19; observed token-based known-usage estimate increased by $0.064571, **not an invoice**. Sixty-four attempts have unknown cost, including count-only requests; that count is not a failure count. Unsettled attempts were zero before and after. These are experiment deltas, not disclosure of the shared ledger or prior spend.

All 12 natural capture batches completed. They retained 26 of 36 submitted original messages as 27 memory units, including all 24 relevant user messages. `export-review-m07` alone produced two units from one submitted event. Each of the eight memory-arm before/after admitted-source-and-graph snapshots matched its closed cold baseline, including the arm whose recall failed. This parity does not cover every SQLite table.

## Answers and failure

| Case | Ordinary source evidence | Projected RN source union | Full original-history diagnostic |
| --- | --- | --- | --- |
| `export-review` | 7/7 required claims supported | Unavailable: `context_item_too_large`; no answer call | 7/7 supported |
| `export-replaced` | 7/7 required claims supported, plus unsupported process-status wording | Same | Same |
| `field-unknown` | 7 supported, historical restriction partial | Same | Same |
| `field-active` | 8/8 supported | 7 supported, historical restriction partial | Same |

The field-case partial finding is narrow: the answers state the present no-delete restriction and no authorization correctly, but omit the original future sequence of *separately clearing both dependencies and then obtaining database-change approval*. The `field-active` ordinary answer includes that sequence. No answer asserted that the unknown API was definitely active/cleared, that a migration was authorized, or that an unapproved software switch occurred. The three `export-replaced` answers cover the required decision and reasons, yet each adds a different unsupported assertion about whether a selection-basis review remains necessary or has already happened; the exact wording is preserved in the JSON. These generation concerns prevent treating all generated slots as full semantic passes.

Literal rubric-anchor availability is separate from answer support. Each ordinary arm omitted the optional `m02` alternative literal passage but retained the semantically sufficient original `m01` passage; all required claims still had at least one exact cited anchor available. Projected arms that returned covered every literal anchor. The full-history diagnostic delivered all nine original messages in three synthetic batch groups per case. Its `diagnostic-batch-*` identities and revision/currentness fields only satisfy the unchanged answer consumer's syntax; they are not persisted memories, verified truths or a product retrieval arm. Rank inputs, selected roots, expanded neighborhoods and delivered source lists are kept distinct in the JSON; the projected union is not a selected-root list.

The first projected arm failed **after** ranking. Its six selected roots expanded to seven unique memory identities but only six distinct original source events because two units share `export-review-m07`. The frozen pure source-union projector refuses seven identities under its six-source cap; it must not merge units by equal text or relax the cap. No projected source or answer was delivered for that slot. This is distinct from the separately reproduced *pre-rank* problem in which an unrelated oversized candidate neighborhood prevents ranking at all; neither result fixes the other.

## Graph caution and limits

Three definite but non-exhaustive wrong model-proposed links were observed: `export-review-m01 → m04` labeled `challenges-premise` reverses the choice/update relation; `export-replaced-m04 → m07` treats old-product capability loss as a challenge to adopting the new product; and `field-active-m04 → m02` labels report retirement as support for earlier report usage, which is not a decision. These proposals are unverified graph metadata, not authoritative facts. The answers did not validate the graph, and three examples cannot establish a graph-quality rate.

The ordinary and projected paths differ in both selected roots and rank context, so their answer differences cannot be attributed solely to graph projection. The full-history diagnostic has different representation and context size. Four paired, synthetic cases and one run cannot establish broad semantic reliability or a causal advantage.
