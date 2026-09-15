# Qualifier preservation: first installed experiment

The installed memory path completed, but qualifier fidelity did **not** pass.
All twelve histories retained their decisive sources after restart. Retrieval
lost three required passages, and complete-source answers still strengthened
conditional or possible choices. This separates evidence availability from
faithful answer generation; it is not a general accuracy score.

## Frozen execution

The [protocol](qualifier-preservation.md) uses six authored scenario pairs,
twelve four-message histories, and two answers per history. Each pair changes
only one decisive user sentence. Capture, qualification, classification,
selection/ranking and the answer consumer used the unchanged pinned
`gpt-4.1-mini-2025-04-14`. Both answer arms used the same baseline instructions,
question and flat source format, with 1,024 output tokens, no tools and
`store: false`. This does not imply zero provider retention.

The once-only run used a locally built and installed archive, actual stdio MCP
clients, a fresh synthetic SQLite database, and a separate project namespace per
history. Each capture client closed before cold inspection and recall. Explicit
tool dispatch is not evidence of a natural agent deciding when to remember.
The complete-source arm is a constructed experimental control, not ordinary
recall or a source rescue. No fixture, prompt, answer or failed prior experiment
was repaired or rerun.

| Frozen item | SHA-256 / commit |
| --- | --- |
| Source commit | `65b4da5cae0cce42614dbdd40cc2ae32959996a1` |
| Installed archive | `2e312db97063d88e2f7f0bb218aa79e553dd6e4496da4888fe8c48bd906d9eae` |
| Operator | `26c3c8fbe040223c580f73b52a50cfa5e551ac425a625418bdac7009053bf969` |
| Fixture | `e074385c3c5eba711938deba28c8ffc66bf9735ab24a1a67077b4d1d780b925e` |
| Source-ID and semantic rubric JSON | `eb6961f9fc101e9db8879adc09d7df57efa2fbf27f5ead2fef84f7c5fec788cf` |
| Protocol explanation | `825fa8cdb8a0a1e2373e45673ac3704f75727d5b7813e82166d4757c535a9af8` |
| Driver | `1829f9312cf8fbdb20fb9eca1618e0306f8010bd420391004048f97d195b0799` |
| Retained private raw report | `a233973fb483a310deb5f4ddeb5d38ccd0d960d2f444ae41e44f5b3703cb020b` |

The operator had two independent code reviews and six successful offline
rehearsal verdicts: normal success, malformed qualification, source transport
failure, malformed answer, answer transport failure and cleanup failure.
The last intentionally threw after proxy closure; remaining session cleanup,
budget snapshot/close and final-report persistence still completed. Expected
failure modes remain failures in their reports, not successful semantic results.
PR108 had all seventeen checks successful before merge and live execution.

## Mechanical findings

All twelve capture/classification operations, cold staging/admitted inspections
and recall calls completed. All twenty-four answer slots completed, with no
operation errors, retries, transport halt or cleanup failures. The immutable
machine report leaves semantic status `unassessed`; the review below is separate.

Staged views retained all 48 submitted messages. Admitted receipts retained the
36 user-message IDs, including all twelve decisive qualifiers, but not the
twelve assistant suggestions. Required-source coverage was 36/36 in both staged
and admitted views, 33/36 in recall. Qualifier availability was 12/12 in stored
views and 10/12 in recall. These are source-availability counts, not accuracy.

| Missing recalled source | Stored and navigation-visible? | First observed omission |
| --- | --- | --- |
| `p02a-m4`: sample-dependent blue glaze | Yes | Navigation selection omitted its memory; ranking never received it. |
| `p02b-m4`: blue independent of sample | Yes | Navigation selected it; ranking received the receipt but omitted its memory. |
| `p06b-m1`: earlier opening and Niko's separate show | Yes | Navigation selection omitted its memory; ranking never received it. |

Private offline replay through the actual `recallMemories` orchestration, with
frozen synthetic model outputs and a scripted token counter, reproduced these
three missing sources. Returning all existing rank candidates recovered only
`p02b-m4`; the two navigation omissions remained. This localizes observed loss,
not the model's internal reason for making those choices or a shipped fix.
The replay did not contact a provider or rewrite the live evidence.

## Separate semantic review

The primary reviewer and two independent agent reviewers inspected full answers
against the frozen rubric. Review was nonblind and same-family, not independent
human evaluation. Six paired scenarios are not twelve independent samples;
there is one sampled answer per arm. Do not infer causal retrieval superiority.

| History | Retrieved answer | Complete-source control |
| --- | --- | --- |
| p01a, provisional ridge path | Loses “for now”; correct changed reasons. | Same lost provisional/time qualification. Neither explicitly says final or permanent. |
| p01b, firm ridge choice | Commitment and changed reasons preserved. | Same; no invented lifetime commitment. |
| p02a, conditional glaze | Presents blue as the choice without its sample condition. | Same amplification even though the condition was supplied. |
| p02b, decided glaze | Matches the full history, but supplied sources establish liking, not deciding; source-relative overstatement. | Choice supported; independence from the sample is omitted, not contradicted. |
| p03a, considering character map | Explicitly says not yet decided; motivation preserved. | Also preserves consideration; current-month scope is less explicit. |
| p03b, decided character map | Decision/reason preserved; this-month limit less explicit. | Month preserved. Both use wording that can imply implementation already occurred. |
| p04a, temporary cream backdrop | Correct cream choice, reason and return-of-gray limit. | Incorrectly opens with current gray use, then describes temporary cream correctly: internal currentness inconsistency. |
| p04b, continuing cream | Decision/reason preserved, but adds “limit on switching back.” | Similarly adds “limiting your choice to cream”; no restriction was stated. |
| p05a, trial pot placement | Preserves undecided trial and actors; omits weekend timing and softer-light benefit. | Preserves trial and softer-light benefit; omits weekend timing. |
| p05b, chosen pot placement | Preserves continuing choice, weekend start, glare reason and actors; omits softer-light benefit. | Same. |
| p06a, possible instrumental opening | “You plan to use” strengthens “might replace.” | “You plan to replace” has the same amplification. |
| p06b, decided instrumental opening | Preserves choice/reason/time; abstains about Niko because that source is absent. | Correctly distinguishes Niko's separate title-card approach. |

No clear actor swap or invented causal reason was observed. Omissions are not
all contradictions: p06b's abstention is appropriate for its supplied evidence,
but incomplete against the full history. Similarly, p01a loses provisional force
without explicitly inventing permanence. One reviewer additionally flagged the
mild implementation implication in p03b and the stronger word “permanent” for
p05a's still-undecided location; these caveats are retained, not converted into
a unanimous binary score.

Clear commitment amplification occurs in two provisional scenarios (p02a and
p06a), in both arms. Full-source failures mean retrieval repair alone cannot
establish faithful answers. Conversely, a better answer prompt cannot recover
sources that never reached the consumer.

## Next engineering gates

1. Design an explicit bounded complete-source read for a genuinely small eligible
   memory set. It must avoid both model-filtering stages only when all eligible
   current memories and complete receipts fit declared bounds; otherwise fail
   explicitly, with no partial result disguised as completeness. Prove namespace,
   revision, correction/forget, source-only and aggregate-budget invariants. A
   complete map page alone must not be mistaken for all memories in a hierarchy.
   This is a proposed gate, not shipped behavior or a default recall replacement.
2. Evaluate a deterministic quotation-only delivery option separately from
   generated explanation. Exact quotations can preserve source wording; they do
   not prove relevance, truth, adoption or authority. Citations attached to free
   prose cannot mechanically certify its interpretation. Do not add another
   rationale graph or hard-coded qualifier words to fit these twelve histories.
3. After offline regression and independent review, freeze fresh multi-window
   histories with distractors and changed reasons before any new paid comparison.
   Record context size, latency/calls, failures and fidelity separately. Do not
   regenerate these answers or call a narrow small-set result broad reliability.

## Accounting and delivery boundary

The run made 144 HTTP requests: 60 source input counts, 60 source generations
and 24 answer generations. Its ceiling was 240 HTTP /24 answers /US$3 reserved
inside the existing US$50 campaign, not a new allowance. Reservations increased
US$1.80; known usage estimates increased US$0.051582; 60 additional requests have
unknown cost. There are zero unsettled requests. Estimates are not an invoice,
and unknown costs are not assumed free.

The cumulative campaign moved from 1,152 requests /US$14.336 reserved to 1,296
requests /US$16.136 reserved, with US$0.879166 known estimated usage and 624
unknown-cost requests. Conservative remaining headroom is US$33.864.
The earlier US$20 campaign is separate and was not reset or reused here.

This report changes no runtime default, retention policy, model, package version
or release channel. No npm publication, deployment, real user conversation,
private application migration or promotion was performed. Raw provider metadata
and local artifact paths remain private.
