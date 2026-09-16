# Bounded source-by-source decision-basis pilot: no gain

The additional local reviews did not improve this diagnostic sample. The
coverage workflow produced fewer complete cases and three unsupported accepted
links, while costing more calls and time. Do not promote it to a default or
general reliability claim. This is a nonblind review of eight fresh bilingual
synthetic cases in known failure categories, not a held-out benchmark or a
user-value evaluation.

The frozen [fixture](../evaluation/live/basis-coverage-fixture.json) has exactly
two original source memories per case. The separate
[rubric](../evaluation/live/basis-coverage-rubric.json) specifies sixteen
required conceptual relationships and forbidden inferences. Both arms used
`gpt-5.6-luna` with reasoning none, the original quote schema, and unchanged
per-call token ceilings. Baseline reviewed each pair once; coverage reviewed
each source separately, then the complete pair with compiled local quote/role
suggestions explicitly marked untrusted. Coverage had up to three generations
versus baseline's one, so this is a workflow cost/quality comparison, not an
equal-compute causal ablation. It is not numerically comparable to PR137.

| Measure | Baseline | Source-by-source coverage |
| --- | ---: | ---: |
| Completed / failed arms | 7 / 1 | 6 / 2 |
| Complete cases on the strict whole-link rubric | 6 / 8 | 4 / 8 |
| Strictly source-supported whole proposals | 6 / 8 | 3 / 8 |
| Accepted global links | 15 supported, 0 unsupported | 10 supported, 3 unsupported |
| Generations / HTTP requests | 8 / 16 | 23 / 46 |
| Sum of arm latency | 28.514 s | 59.223 s |
| Median arm latency | 3.3785 s | 7.4815 s |
| Unrounded generation-token estimate | USD 0.0029548 | USD 0.0071200 |

The baseline's explicit-replacement answer included both B price and quality
facts, but bundled them in one premise and link. That is a distinct-reason
representation gap, not a missing fact. The coverage arm's second local pass
for that case was mechanically rejected: it proposed challenges from A updates
to the B decision. Its global pass remained unrun, and valid local B supports
were not salvaged as accepted links. Thus six of the sixteen required rubric
relationships were unavailable for coverage in this case, not scored as
correct abstentions.

No observed token truncation or budget exhaustion explains these failures:
the largest generation input was 1,020 tokens and largest output 262, below
the unchanged 7,024/1,024 provider ceilings. The replacement scenario could
use all eight allowed units, but its actual coverage rejection was caused by
wrong challenge targets. The baseline's bundled B reasons cannot be attributed
to a measured output cap.

Both career global proposals were rejected for orphan challenges; neither
rejection is a correct abstention. In the coverage arm, the global proposal for
different actors had three source-supported links but also assigned the
unlinked “neither chose a replacement” passage a premise role. The three
accepted unsupported coverage links were two stale-report errors—using an old
nonduplex report as support for the current duplex choice and treating current
confirmation as a challenge to the old report—and one temporary-scope error
that treated “usual plan unchanged” as challenging the one-day closure.
Rejected raw proposals were reviewed separately from accepted-link errors;
mechanical rejection was never counted as semantic success. The case-level
figures above are descriptions of this fixed sample, not estimated accuracy.

The shared ledger moved by 62 HTTP requests and USD 0.186 in conservative
reservations. Its known-usage estimate rose by USD 0.010097 after per-request
rounding; 31 count requests still have unknown usage cost, and unsettled
requests remained zero. The unrounded arm estimates above total USD 0.0100748.
Neither reservations nor estimates are provider invoices.

Provenance: source head `28a403f1fbd91064cc168c6d20e1f66fe9ad69bc`;
private sanitized raw-report SHA-256
`eea44bd6ce56c58779e1442eba953b35ab612e91b749408e8524a8914ccc08b9`;
fixture SHA-256 `f930f4e6f15cc0c6c6ab8935aeb069a91c862d56fa372b7f6383c5f43ac654fa`;
rubric SHA-256 `6ecdd2fdb881d22e6293f3ce2335f09f9843da7fcfd662e7f5808df9e7184fca`.
The [closed public projection](../evaluations/results/basis-coverage-pilot-v1.json)
has SHA-256 `2c57d8d3f897be7a3cf60ef12aa9904b730ce598999824a5622f7400c221c718`.
It retains all sixteen arms, all 31 raw proposals—including local passes and
rejected outputs—and the unrun stage without publishing private prompts,
response envelopes, paths, keys or identifiers. Primary and independent
semantic reviewers examined all 31 raw proposals nonblind.

The next useful target is stronger association of decision, role, event time,
scope and distinct reasons—not simply more generations or higher caps. This
pilot did not measure direct MOC retrieval, installed-product behavior or user
outcomes, and makes no release, deployment or model-default recommendation.
