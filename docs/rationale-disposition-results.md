# Disposition comparison: one synthetic paired diagnostic

Neither arm passes the semantic gate for a relationship write path. The run
completed structurally, but the control missed three of five genuine challenges
and the explicit-disposition candidate missed four. Both preserved all six
independently supported historical reasons without a false withdrawal. Those
facts do not make the remaining relationships sound: the candidate confidently
kept two wrong old edges, and its `unknown` left a definitely wrong cross-scope
edge unresolved. The control retained a non-adoption edge, added an unsupported
challenge, and confidently kept a link whose antecedent is missing.

The [public record](evidence/rationale-disposition-results.json) gives all six
case-local source indices, the actual stored old-edge order, both unmodified
model-output texts, and the human judgments. Read indices against the frozen
[source fixture](../evaluation/architecture/rationale-disposition-fixture.json),
not as persistent memory identifiers. Candidate `dispositions.edge` is an
index into the *stored* order shown in the record, which can differ from the
fixture's authored order. The [frozen rubric](rationale-disposition-rubric.md)
states why each old edge should be kept, withdrawn, or left unresolved and
which new challenges are required. The control proposes a full edge set;
absence is not an explicit withdrawal or an `unknown` disposition.

| Case | Control: decisive observation | Candidate: decisive observation |
| --- | --- | --- |
| 01, press K | Keeps both historical selection reasons and adds the correct firmware-loss challenge `3→0`. | Keeps both reasons but also keeps the reversed old challenge `0→3`; misses `3→0`. |
| 02, logger N | Keeps the dated reason and drops the reversed old challenge; misses the later same-device challenge `2→0`. | Correctly withdraws the reversed old challenge and keeps the dated reason; also misses `2→0`. |
| 03, scope | Keeps the Design reason and its valid `3→0` challenge; excludes Finance's cross-scope `2→0`. | Keeps the valid reason and challenge but marks the definitely wrong cross-scope `2→0` **unknown**, so it remains in the projection. |
| 04, non-adoption | Keeps valid self-support `2→2` but also the false `0→1` support for an unapproved switch; misses the Q-failure challenge `3→2`. | Keeps both old supports, including the false non-adoption link; misses `3→2`. |
| 05, corrected guess | Keeps valid insurance support but adds unsupported `0→1` as a challenge: a price quote is not a contradiction of the stated non-price motive. Misses `3→2`. | Withdraws both false price-motive supports and keeps insurance support, but adds no correction challenge `3→2`. |
| 06, missing antecedent | Confidently keeps `0→1` despite absent notes identifying “that”; omission would have been defensible. | Marks `0→1` unknown, a defensible unresolved treatment, not a verified reason. |

The five genuine challenge obligations are original-premise targets `3→0`
(01), `2→0` (02), the already-seeded `3→0` (03), `3→2` (04), and `3→2`
(05). Cited challenges to a decision statement that itself repeats the same
premise could also be defensible; neither arm produced such an alternative in
these missing cases. Challenge coverage is therefore control 2/5 and candidate
1/5, not an exact-tuple-only penalty against a legitimate alternative. The
candidate supplied dispositions for all 14 old edges, but coverage of those
indices is not semantic accuracy. Its `unknown` in case 03 is not equivalent
to withdrawing a demonstrably cross-scope link. Conversely, case 06's
missing antecedent makes candidate `unknown` defensible; that link is not
confirmed. None of these results asserts the cited source text is true or
that the recorded decisions changed.

## Execution and limits

One approved, once-only run made 24 HTTP requests to the pinned
`gpt-4.1-mini-2025-04-14` model: a count and generation request for each of
12 arms. All 12 arms completed; each persisted graph and cold read matched its
pre-review state, and sources were unchanged. The reservation delta for this
run was $0.12. Known usage estimates sum to $0.005847, while 12
requests have unknown cost; the reservation is **not** measured actual spend.
All 24 request attempts settled. The retained private final report has SHA-256
`b24012df3033438bec2f77468c9b77de3b9ab51f6ae0171f1dc3400070b6927f`.
The public record binds the fixed source commit, fixture, rubric, both prompts,
installed archive, and this report by hash, without publishing private paths,
request identifiers, credentials, or campaign ledger rows. The private raw
responses were checked directly against the public model-output texts; no
provider rerun was made for this document.

These are six selected, nonblind synthetic histories with scripted old-graph
seeding. The control and candidate are whole protocols, not an isolated causal
test of one instruction. The run did not exercise end-to-end capture, MOC
filing, answer generation, a real user, or user benefit. Two reviewers made
separate source-semantic judgments and agreed on the findings above. One
reviewer authored the candidate's v2 semantic guidance before seeing this
fixture and run; that review was independent of the other adjudication, **not**
independent of candidate design. Old-edge anchoring, new-edge discovery
difficulty, and ontology ambiguity remain hypotheses, not demonstrated causes.
Future work could distinguish historical validity from current applicability
and assess discovery of new challenges separately from old-edge audit on fresh
cases. The earlier source-by-source role-hint comparison also failed its own
gate; this result does not imply that decomposition or another prompt change
will help. No default, write path, release, or deployment is promoted here.
