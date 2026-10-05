# Metadata-eligible official-six observation

Checkpoint: 2026-09-30. This fresh six-question observation completed its frozen
mechanical and paired-scoreability gates. Cairn answered 2/6 correctly and native
Mem0 4/6, with no unresolved judgments. Completion is not semantic parity or
product readiness. This cohort is distinct from the
[earlier indexed-evidence official six](indexed-evidence-official-six.md), whose
Cairn 5/6 completion and common resolved N=5 failure remain unchanged.

## Frozen selection and method

The runtime was `aa02d06880b7e4029ff72ae4261419910c1b9c21`. The cleaned dataset
revision was `98d7416c24c778c2fee6e6f3006e7a073259d48f`, with source SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.

Allocation used the exact 500-entry ID/type metadata inventory and 160 audited
known exclusions, checking privately that each official type had at least one
eligible remaining case. The frozen seed was
`cairn-official-observed-six-20260930-Tzlii1`. Candidates were ranked by
SHA-256(seed + ID), with UTF-8 ID tie-breaking; the first per type was selected,
then retained in corpus order. First-arm order alternated, 3:3. Only six cases
were allocated, with no spare holdout. All six entered the consumed union
(160 to 166) before selected-history and cost preparation. There was no replacement,
retry or replay.

Cairn used explicit `indexed-evidence-v1`, no qualification and recall limit 6,
not default MOC/MLC navigation. Native Mem0 2.2.0 used top-k 6, threshold 0, with
graph, reranking and vision off. Memory and answer generation used
`gpt-4.1-mini-2025-04-14`; embeddings used `text-embedding-3-small`; the judge
used `gpt-4o-2024-08-06`. Generation artifacts were durable before verified
evaluator access. Fixed models and policies are experimental comparison
conditions, not default-product acceptance.

The exclusion roster, selected IDs and one-shot operator remain private. This
public protocol and aggregate record cannot independently replay the exact run;
it contains no source passages, questions, answers, references or provider bodies.

## Completion and judgments

Six source preparations were ready and all 295 capture batches completed.
Generation status was `completed`, reason `null`, with mechanical success and
six-case scoreability true. All twelve generation arms completed with null
reasons. Both arms completed 6/6 ingestions and answers and resolved 6/6
judgments; common resolved N=6.

| Arm | Correct | Incorrect | Unresolved | Correct / fixed N=6 |
| --- | ---: | ---: | ---: | ---: |
| Cairn | 2 | 4 | 0 | 33.33% |
| Native Mem0 | 4 | 2 | 0 | 66.67% |

| Official type | Cairn batches | Cairn | Mem0 | Cairn admitted cards | Mem0 ADDs | Cairn returned receipts |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| single-session-user | 51 | Incorrect | Correct | 237 | 435 | 4 |
| single-session-preference | 48 | Incorrect | Correct | 217 | 380 | 3 |
| multi-session | 46 | Incorrect | Correct | 223 | 441 | 1 |
| temporal-reasoning | 44 | Correct | Incorrect | 209 | 415 | 4 |
| knowledge-update | 53 | Correct | Incorrect | 242 | 453 | 3 |
| single-session-assistant | 53 | Incorrect | Correct | 232 | 473 | 2 |

Cairn recalled one card and selected one evidence unit per case; Mem0 selected
six per case. Answer packer omissions were zero for every case in both arms.
The totals, 1,360 admitted cards and 2,597 native ADDs, measure different units,
not retention coverage or answer quality. Completed batches do not establish
faithful retention of every fact. These aggregates do not establish why either
arm was correct or incorrect, or explain the retrieval-count difference.

## Accounting and retained evidence

The new guarded tail contained exactly 2,124 requests: count 606, generation
606, answer 12, embedding 593, native chat 295 and judge 12. All settled as
succeeded, with zero pending and 24 completed scopes. Conservative reservations
were 11,622,098 microUSD; known actual-usage estimates were 2,632,861 microUSD.
The 606 count-stage rows had unknown actual cost, not unknown transport outcomes.
Reservations and partial known estimates are not an invoice total or production
cost measurement.

At this historical checkpoint, cumulative accounting was 27,976 requests and
172,282,993 reserved microUSD under the original US$300 ceiling. Remaining
reservation headroom then was 127,717,007 microUSD, not a live balance during the
separate running thirty-case continuation.

Primary verified the retained artifact digests; they identify bytes, not
authenticated source truth:

| Artifact | SHA-256 |
| --- | --- |
| Status | `f6fe39ada4b17bd485c6543f9a630c4e0bb0e350ca9dd9e021e92c0a4f54accc` |
| Generation | `9a4b58cd6f28289d23b307876af37f541d8899bc5adbcb453625d5f6a5ce7304` |
| Scoring | `7abd9f12b254b7ddbc4d397449009d825bff8e871ef7e38ae7349bf0ab789a3c` |
| Accounting | `a8b8195c9dd6511bff055c65bc94658623210737ab6c4cdfbb32fad9d5d10f4b` |

## Boundaries and separate continuation

This is neither a full 500-question LongMemEval result, statistical superiority,
causal ablation nor verified semantic truth. It does not establish default
source fidelity, current-decision reasoning, natural installed MCP/Hermes
adoption, lightweight latency/RSS/request cost or promotion readiness. The
unmerged PR #313 manual history-update tool is separate, not a score fix.

At the same dated checkpoint, the separately authorized frozen thirty-case
cohort was running. Ordinal 22 retains both arms unresolved within N=30;
remaining cases are first executions, with no retries or replacements. Earlier
failures stay immutable and the original cumulative US$300 ceiling remains.
That new authority covers only the specific same-cohort continuation, not a
general old-run resume. No thirty-case completion or score is reported here,
and this document grants no paid execution authority. See the
[delivery contract](../plans/official-eligible-six-observation.md) and
[limitations](../limitations.md) for scope and outstanding gates.
