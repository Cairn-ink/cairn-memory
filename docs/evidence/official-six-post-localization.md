# Post-localization official six-type checkpoint

Status, 2026-09-29: the one-shot coordinator completed without a global generation
or scoring halt, but mechanical completion and paired scoreability failed. The
[prospective P1–P9 contract](../plans/official-six-post-localization.md) fixed the
six cases and denominators before the run. An independent read-only outcome
audit confirmed the retained artifact hashes, roster, all 24 arm scopes,
12 generation and 12 judgment slots, raw-to-public score aggregates, type
mapping and cold-store counts. A separate independent frozen accounting audit
matched the prior ledger prefix and all new guarded rows. The primary also
authenticated the live terminal ledger.

## Frozen method and preflight

The six previously unused LongMemEval-S cases cover one of each official type,
retain corpus order and alternate first arm 3/3. The 148 previously consumed or
reserved cases and six new cases were sealed as 154 future exclusions before
selected source preparation. No case was replaced. The unchanged public runtime
was `59c74540bdbd4984896afa80452f4928f7c1bfdf`. Cairn used the opt-in,
probe-free `indexed-evidence-v1` route with bounded source scan and recall limit
six; Mem0 used the same pinned native 2.2.0 comparator and model/scoring
protocol as the [earlier official-six packet](indexed-evidence-official-six.md).
The cleaned source SHA-256 is
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`,
declared revision `98d7416c24c778c2fee6e6f3006e7a073259d48f`. Memory and
answer calls used `gpt-4.1-mini-2025-04-14`, the official-style judge used
`gpt-4o-2024-08-06`, and Mem0 embeddings used `text-embedding-3-small`.
Selection, preparation, protocol and resource pins are recorded in the
prospective plan. Private case identifiers, corpus content,
questions, answers, references, provider payloads and operator material are
omitted here. This public aggregate cannot replay the exact private roster.

All six source-only preparations were ready. The planned capture batch vector
was `[50,53,49,47,47,47]` (293 batches per arm). The whole-vector ceiling was
77,711 requests and 14,749,619 microUSD of conservative reservation; these
were prelaunch bounds, not observed usage. The final operator candidate passed
independent Standards and Spec review, and PR #292 passed all 17 applicable CI
checks at `b6a1de125e52d9cec6ce299e6ae15db8002d49ad` before launch.

## Fixed-denominator outcomes

| Measure | Cairn | Mem0 |
| --- | ---: | ---: |
| Completed ingestions and nonempty answers | 5 / 6 | 5 / 6 |
| Correct / incorrect / unresolved judgments | 1 / 4 / 1 | 2 / 3 / 1 |
| Accuracy on all six scheduled cases | 1 / 6 | 2 / 6 |
| Accuracy among resolved judgments only | 1 / 5 | 2 / 5 |

The common resolved denominator is **4 / 6**; among those four paired cases,
Cairn was correct in 0/4 and Mem0 in 2/4. Ten judgments ran; the two failed
generation arms kept `case_sealed` scoring slots with `attempted: false`.
An unresolved arm is not an incorrect semantic judgment. The official-style
binary judge does not validate every detail of an answer.

| Frozen order and official type | Cairn judgment | Mem0 judgment |
| --- | --- | --- |
| 1 — single-session-user | Correct | Unresolved |
| 2 — multi-session | Incorrect | Incorrect |
| 3 — single-session-preference | Incorrect | Correct |
| 4 — temporal-reasoning | Incorrect | Incorrect |
| 5 — knowledge-update | Incorrect | Correct |
| 6 — single-session-assistant | Unresolved | Incorrect |

The first Mem0 generation failed at its native stage with `invalid_payload`.
Its guarded `mem0-chat` request was the 44th Mem0 chat within that first case
and settled failed; it had 12,754 input tokens, 1,129 output tokens, a
16,308-microUSD reservation and 6,909-microUSD
known actual cost. A bounded offline fake-HTTP diagnosis reproduced several
distinct `invalid_payload` variants with matching code/accounting behavior.
The raw causal payload was not retained, so the exact predicate and root cause
are unknown. The final Cairn case completed 28 capture batches, failed one and
left 18 not run. Its first stop was zero-based batch index 28, with a
nonretryable `capture/model_timeout`; diagnostics were
`extract/core_call/model_timeout` then `extract/adapter/model_cancelled`.
The generation request settled `unknown`, not pending. The observation does
not establish why it was slow or that a larger deadline would fix it.

For the five completed Cairn cases, admitted-card counts were
`[226,234,223,220,224]`, recalled-card counts `[0,1,1,2,1]`, source-receipt
counts `[0,3,3,7,1]`, and selected evidence indices
`[[],[0],[0],[0,1],[0]]`. No packed evidence unit was omitted or duplicated.
The sole correct Cairn judgment was an abstention-tagged case 1 with **zero**
recalled cards; its correctness cannot be attributed to useful recalled memory.
Independent read-only cold-store counts were:

| Frozen case | Filed cards | Unfiled cards |
| --- | ---: | ---: |
| 1 | 155 | 71 |
| 2 | 200 | 34 |
| 3 | 143 | 80 |
| 4 | 175 | 45 |
| 5 | 170 | 54 |
| 6, partial | 125 | 5 |

Each filed card had valid MOC revision references, with no invalid references
observed. Case 6's 130 current cards follow 28 completed batches and one
pending admission claim; that claim is distinct from ledger pending requests,
which numbered zero. All 14 observed source receipts matched their source
origins. In cases 3 and 5, respectively one and two annotated answer-bearing
turns were present in rendered/indexed history but had no retained receipt
from those turns; none was selected. No selected receipt in a completed Cairn
case mapped to an annotated answer-bearing turn. Case 5 had a different filed,
unselected receipt from an annotated answer session containing a short reference
term; whether its context was stale, contextual or current remains undetermined.
This is an observed source coverage gap, not proof that equivalent or paraphrased
information was absent elsewhere or that an incorrect answer had one cause.

## Accounting and decision

The authenticated terminal ledger was open with zero pending requests. Its
original 21,862-request prefix was unchanged. This cohort added **2,007**
guarded requests and **10,928,769 microUSD** of conservative reservation.
The guarded outcomes were 2,005 succeeded, one failed and one settled unknown.
Known-cost estimates total **2,514,746 microUSD** across 1,444 rows; 563
unknown-cost rows retained **2,815,000 microUSD** of reservation. Known actual
cost is not a final bill, and unknown cost was not refunded or reset. The
cumulative checkpoint is **23,869 requests / 149,768,405 microUSD** reserved,
leaving **50,231,595 microUSD** beneath the unchanged 200,000,000-microUSD
cap and 420,000-request cap. Its history SHA-256 is
`678e55a03b69eaf974a70d41cb736c989d12b7ebe009dd1b7530c0db68364579`.

The published SHA-256 digests of retained private artifacts are: preflight
`0088b942bd999fbd658ec595ae0647f913c4b81667ec5e6ea60e20fccd3eb69d`,
generation `0d20a039a079880ef24d92594fe18900c04614d10e098cefd80de96ce872226a`,
scoring `973103d432979eff4cdd4cfab46c0b0b93179b6b3c56268bdbe903b06c06beb8`,
accounting `e5ba63bac36e722f4b1cbb81a978aa173fbb999e23673804c3631c5490973e6a`,
and status `36c70e9389b2fb2b2ac611c25227e51654c364843cdad47c306cc228b5aa9732`.
They bind retained artifacts without publishing their contents. The independent
outcome auditor verified raw-to-public mapping, including numeric-reference
rendering and receipt source-origin matches. A separate independent accounting
audit matched the exact ordered 21,862-attempt prefix and 2,007-row guarded
tail on five fields, found all 23,869 IDs unique and no differences. Blind
ranking, full source-freeze timing, raw judge responses, word-by-word semantics
and product gates were outside those audits.

P8 required 6/6 completed ingestions, nonempty answers and paired resolved
judgments in both arms. It **failed** with 5/6 completion in each arm and 4/6
common resolution. A completed coordinator and settled ledger do not pass that
feasibility gate. No fixed-30 expansion, replay or rescore follows. The next
step is bounded offline reproduction of the exact failures and an audit of
stored versus retrieved evidence before any new paid experiment or prompt,
vector or graph decision. Per-question timing was not captured. This selected
six-question subset is not a 500-question score or evidence of general
comparative superiority; default MOC and installed MCP/Hermes product gates
remain separate. The prior authored N6 result (3/3 correct in each arm) is a
narrow diagnostic, not a benchmark improvement; earlier official scores and
their failed gates remain unchanged.
