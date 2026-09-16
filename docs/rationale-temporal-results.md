# Paired chronology diagnostic: source review

One guarded, once-only paired run of the frozen [six histories](../evaluation/architecture/rationale-temporal-fixture.json)
completed all twelve arms. The [public synthetic projection](../evaluations/results/rationale-temporal-v1.json)
retains all 30 raw proposed edges, source-ID/receipt-index mappings, full
before/after/cold direct and incident graphs, review counters and per-arm
durations. Both arms used the same pinned installed core, OpenAI adapter and
model. The candidate changed only the `relate` instructions via the frozen
chronology guidance. Every arm's source records were unchanged and its cold
read matched the post-review graph. These are mechanical facts, not a semantic
pass.

| Frozen history | Paired source assessment |
| --- | --- |
| Late archival batch (English) | Both arms proposed `choice → loss` as a challenge. The choice is not evidence contradicting the later verified loss; both also missed the archival historical support and the loss's genuine challenge to the old offline premise. The default choice view remained empty. |
| Retest before old report (Traditional Chinese) | Both retained the retest's support for the unchanged choice and its historical rebuttal of the mistaken report. Candidate also added `choice → retest` support, defensible as reaffirming the recorded choice but not proof of the retest result. |
| Other owner/edition (English) | Neither arm treated the other person's Cloud Edition report as a challenge to Mira's Local Edition. Candidate added the source-supported `test → confirmation` link. Both put their links outward from the original `choice`, leaving its default read view empty; the added link does not close that visibility gap. |
| Two venue reasons (Traditional Chinese) | Both kept bus evidence/retraction and the genuine current entrance concern. Baseline additionally made the old entry observation challenge the later closure, an unsupported temporal direction; candidate omitted that edge. Both missed a distinct `entryArchive → choice` historical entrance-support link. Self-support from `choice` preserves reason text but not that separate evidence link. |
| Friday exception (English) | Both supported Monday service from its test and the Friday choice from Friday hours. Both also linked `usualChoice → exceptionChoice`: this may support the target's explicit reaffirmation of the usual Monday supplier, but would be cross-scope if interpreted as the reason for choosing the Friday supplier. It is recorded as ambiguous, not a definite false edge. |
| Unknown time and future plan (Traditional Chinese) | Candidate kept historical test support and abstained on uncertain timing, defensible but not confirmation of current safety. Baseline additionally made a not-yet-effective future plan challenge an undated uncertain memo, an unsupported temporal claim. Neither arm established present truth or changed the June arrangement. |

This is a paired observation, not a precision score or broad accuracy estimate.
The candidate omitted two baseline-only unsupported directions in this set,
but both arms shared the consequential late-archive failure and missed distinct
historical support elsewhere. Alternative source-supported links, especially
the Friday edge, cannot be graded by exact tuple mismatch alone. The
retraction-to-report `challenges-premise` link also retains the ontology
ambiguity noted in the earlier diagnostic. Independent source review was
nonblind to the frozen rubric and conducted by same-family agents. One reviewer
was independent of the candidate implementation; a second authored the
guidance before seeing the fresh fixture. The primary adjudicated the source
judgments against retained raw evidence. This is not two reviewers independent
of the candidate's design. No prompt or model was tuned on these scored outputs.

The attempt made 24 guarded HTTP calls: one provider token count and one
generation for each arm, with no retry. It reserved 120,000 microUSD; the
twelve generation calls had 4,999 microUSD of known usage estimate and twelve
count calls had unknown cost. Reservation is not an invoice and unknown does
not mean zero. The same cumulative campaign ledger ended at 2,249 requests,
25,322,000 microUSD reserved, 1,377,612 microUSD known usage, 1,050
unknown-cost calls and zero unsettled, independently verified by the primary's
read-only query of that ledger. Per-arm review durations include local
counting, the guard and core work; they are not isolated model latency or a
performance benchmark.

The projection pins source head `620044ddde593074a83355d1d8441d830e5570ca`,
the private final-report digest
`bf9bf0b13793e7c3036cadb6b31fb02e64ee4d36d060092c79648bd740eec2b6`,
fixture `a710451f7fe8d6b0ce3438260bbd9342105cfefaeb24ef54f6aed0c2a6d55d33`,
rubric `2477cf763f3f0ea22e24dcd162f2163bc26b084fcfdfa35f57fedb41885cf497`,
guidance `96b820313b6617895b6a792b798b34d7289f032c3e67e3f325c441b9018d8cda`,
operator `168909d6e3a4f869193c9a5252008faaa5f08270919b609a2dba7d4a75551551`,
cold reader `3bc31aa298cecb08506184a047075bf00fed0823bbb8d0267f69df9991c381cf`,
and installed archive `c6e88423ee4764fcf8ebfbd4359b66d89aa7a076b3315db302e3e80f049fe59c`.
Hashes bind bytes, not semantic correctness.

The set was adapted from known failure categories, manually admitted complete
sources, contained no seeded old graph, and used an embedded evaluation facade.
It does not test natural capture, retrieval, MCP-host integration, correction
of an existing mistaken link, user benefit or production defaults. Do not
promote the prompt or rerun/tune against this scored set. The next engineering
experiment is a separate, read-only proposal API for explicit `keep`,
`withdraw`, or `unknown` dispositions of source-linked edges. That interface
would expose uncertainty for human review; it does not itself correct the
remaining semantic errors or the default-root visibility gap, and it is not a
production-default or execution-authority change.
