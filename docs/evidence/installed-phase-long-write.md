# M1c installed long-write diagnostic: one-shot result

This 2026-09-30 run used two newly authored synthetic 16-session histories,
32 indexed-evidence batches per history, alternating first arms, installed
Cairn core/OpenAI adapter and contained native Mem0. Evaluator rows and a
separate rubric were frozen before generation. The coordinator loaded the
evaluator rows only after the durable generation file; the automatic scorer
used its frozen reference answer and official-style prompt, not the exported
rubric. Agents used that rubric in their post-run source check, without
rescoring the automatic output.

The execution used the reviewed public candidate `9f3fcc8825adf6588196685ff9e13a49cc5d9d85`
and separate 16-file private review manifest. The primary reports all 21
applicable exact-head checks successful (CI `36613710220`, CodeQL
`36613710003`) before the one-shot launch. This is a synthetic diagnostic,
not an official corpus result, installed MCP/Hermes test or product quality
claim. The prelaunch contract and installation hashes are in the
[M1c plan](../plans/installed-phase-diagnostic.md).

## Completion and judgments

| Case and arm | Generation | Automatic judgment | Ingestion and context observation |
| --- | --- | --- | --- |
| First case, Cairn | Failed before answer | Unresolved; judge not attempted | Five batches completed; batch index 5 was partial; 26 were not run. |
| First case, Mem0 | Completed and answered | Incorrect | Native add and answer path completed. |
| Second case, Cairn | Completed and answered | Correct | All 32 batches completed; two cards and two receipts reached the packed answer context. |
| Second case, Mem0 | Completed and answered | Correct | Native add and answer path completed. |

The frozen automatic scorer therefore reports fixed N=2 per arm and
common-resolved N=1. Cairn has 1 correct, 0 incorrect and 1 unresolved;
Mem0 has 1 correct, 1 incorrect and 0 unresolved. The unresolved Cairn case
is not counted as wrong. These are the unmodified scorer outputs, with no
rerun, rescore or repaired answer.

The automatic positive grades on the second case **do not establish semantic
success**. In the primary and documentation worker's source-backed assessment,
the Cairn answer falsely says the earlier Thursday extension was never adopted;
the frozen source records a vote adopting it. The later transport premise
changed, making reconfirmation necessary, without an adopted replacement time.
The Mem0 answer may reverse the causal direction between the changed transport
premise and the need to reconfirm the extension. These are agent assessments
against the frozen source and rubric, not human or externally independent
judgments. The scorer's automatic grade remains recorded separately; neither
positive grade supports a broad semantic-pass claim.

## Retained execution observations

The first Cairn case stopped at batch index 5 with `classification_failed`,
marked nonretryable. Its first five batches completed; the sixth was partial,
and the remaining 26 were not run. No answer was made from partial ingestion.
The primary's read-only store observation found six admissions committed,
28 distinct memories and 31 source receipts. Admission is distinct from a
completed classification and does not make the failed arm scoreable.

Its Cairn timing observer recorded 84 phase events, retained the last 64 and
omitted 20. All retained final classification phases completed: count transport
1,790.543191 ms, generation transport 2,639.014433 ms and output validation
0.168322 ms. No timeout is observed. The retained output does not prove the
precise remaining adapter, core or application reason for classification
refusal after the observed output-validation boundary. The transport phases
include guard accounting and validation as well as HTTP; they are not isolated
provider latency. This result does not establish the cause of the historical
N7 timeout.

The second Cairn case completed 32 batches and recorded 160 admission-memory
references. These are references across batches, **not** 160 unique cards;
the primary's read-only store observation found 114 distinct memories and 171
source receipts. Recall selected two cards, with two authoritative receipts
and two packed evidence units. The selected receipts came from later
premise-change and schedule passages; they do not include the earlier adoption
passage. The primary
reconstructed canonical source windows and matched both receipt coordinates
and full normalized excerpts. Four of eight frozen annotated answer windows
were retained as exact source receipts, and two of those were selected. The
earlier adoption window **was stored but not selected**. The two selected
receipts were packed with zero omitted selected indices, so its absence is
localized before answer context, without identifying which candidate visibility,
selection or ranking step caused it. The other four missing exact windows may
still have information represented elsewhere in paraphrase. Its Cairn observer
recorded 469 phase events, retained 64 and omitted 405. The bounded tail does
not reconstruct all invocations or end-to-end work.
Both Mem0 arms recorded 512 verified add records and six native results apiece;
the 512 records do not mean 512 distinct retained facts.

## Requests, reservation and measured resources

The primary's aggregate accounting inspection reports 358 new requests,
2,019,151 microUSD reserved, 392,454 microUSD in known usage estimates,
79 requests with unknown actual cost and zero pending. The per-stage counts
are:

| Stage | Requests | Reserved microUSD | Known estimate microUSD | Unknown actual costs |
| --- | ---: | ---: | ---: | ---: |
| Cairn token count | 79 | 395,000 | 0 | 79 |
| Cairn generation | 79 | 395,000 | 69,276 | 0 |
| Mem0 embedding | 130 | 1,779 | 1,779 | 0 |
| Mem0 chat | 64 | 1,043,712 | 318,450 | 0 |
| Answer | 3 | 152,460 | 710 | 0 |
| Judge | 3 | 31,200 | 2,239 | 0 |

The four arm-attempt request records, including answer calls but excluding the
three judge requests, were: first Cairn 24 / 120,000 reserved / 9,620 known /
12 unknown;
first Mem0 98 / 573,418 / 155,965 / 0; second Mem0 98 / 573,713 /
164,733 / 0; second Cairn 135 / 720,820 / 59,897 / 67. These rows sum
to 355 pre-scoring requests. The original checkpoint was 23,869 requests and
149,768,405 microUSD reserved. The primary reports a cumulative checkpoint of
24,227 requests and 151,787,556 microUSD reserved, leaving 48,212,444 under
the unchanged 200,000,000 microUSD cap. The primary's fresh read-only audit
authenticated the parent, reconstructed the unchanged original prefix and
mapped each of the 358 new SQLite rows one-to-one to guarded attempt, channel,
reservation, outcome and actual-cost records. The original 23,869-request /
149,768,405-microUSD prefix retains history digest
`678e55a03b69eaf974a70d41cb736c989d12b7ebe009dd1b7530c0db68364579`;
the current 24,227-request / 151,787,556-microUSD checkpoint has digest
`a94be7c73fbf435bcd38bac727ca67bab5e81a48802a24f85414d394b9d18d92`.
The 2,019,151-microUSD increment is below the frozen 4,000,000 limit, and
48,212,444 remaining exceeds the protected 30,000,000. This is a **primary**
audit, not independent accounting review; it made no ledger writes, settlement
or grants. Reservation is a conservative ceiling, not an invoice; known
estimates omit the 79 unknown costs and are not total spend.

Primary-measured end-to-end wall time was 1,215,344.769056 ms. The retained
status file separately records 1,212,931.277446 ms inside the operator;
these are different measurement boundaries. Parent-process maximum RSS was
1,030,576 KiB; parent CPU was 579,890,341 microseconds user and 29,912,368
microseconds system. The elapsed and parent resource figures include the
coordinator, ledger and harness. Parent RSS and CPU omit the full process tree
and are not product-only or per-arm measurements. The previously measured
ordinary installed package used 896 KiB allocated blocks, with 38,936 KiB
for its dependency directory; this run did not revalidate installation weight.

The retained generation, scoring and status files have SHA-256 digests
`45c4816ee482d170f367286fbd2e499318d5f61922ec2bfc4ef1b4c5c8ba238f`,
`fa8148a052d072fa946d3702d062004d91b59c68cba92998ae76ca39c79933e3`
and `18bc541053405c8c74c9774733876b16113e0dc0bb6263ef91533827791ce3c4`
respectively. The primary reports accounting-file digest
`89c471e802c88dfe7e4d8d8911a3424f594b35bceae04923b0e8d842e317de8d`;
the documentation worker did not read that file. Private output paths, raw
source, answers, native payloads and opaque identifiers are omitted here.

## Gate and next diagnostic

Full completion was not achieved: Cairn answered only one of two cases, and
the common-resolved denominator is one. The larger-cohort gate remains
blocked. A separate narrow diagnosis should locate the classification failure
after the observed output-validation boundary and test evidence coverage and
preservation of an adopted decision through recall and answer. Any correction
needs new prospective review and fresh validation. Do not replay consumed
cases, alter the frozen rubric, expand to fixed-30, increase raw retention or
infer MCP/Hermes
reliability from this run. Earlier failures remain retained.
