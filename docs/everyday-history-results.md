# Everyday source history: observed evidence and limits

One fresh synthetic history completed through an installed local MCP server,
source-bound-v2 capture, restart inspection, source-evidence recall and bounded
model answers. This is encouraging end-to-end development evidence, not a
general reliability score or proof that MOC outperforms other retrieval.

The earlier stopped longer-history experiment remains failed. This new history
is not a rerun or repaired score. The qualification-slot change was present;
there was no model switch, retry, manual source rescue or answer regeneration.

## Frozen execution

The history has 32 messages in eight four-message windows and four questions.
29 messages are attributed to the user and three are assistant suggestions.
Both retrieval arms use the same captured store and top-six bound. The lexical
arm is a simple control, not an optimized search baseline or oracle.

Capture and MOC selection/ranking used `gpt-4.1-mini-2025-04-14`. The bounded
answer consumer used the same model with a 1,024-output-token ceiling, no tools,
no streaming and `store: false`. This exercises installed stdio MCP explicitly;
it does not demonstrate a natural Hermes/Claude agent choosing when to remember
or recall. Source excerpts, not generated relationship graphs, fed the answers.

| Immutable input | SHA / identifier |
| --- | --- |
| Source commit | `eedeb101adfc93438f32a34316dcb8469b563c02` |
| Installed archive | `940bb0ee1b2f4094f8f18815d81ca4bf7f7699c97f1f89344a9d62be971077fe` |
| Operator | `37fc508c054c809fc0a80d11c8a9f62c6028a8052e7831030bad9c85f6777435` |
| Fixture | `acf5532def6566f3f9367cabcb42e19cef04ae6ff127f2f30e7a2f2d6f94ba25` |
| Source-ID rubric | `aa8317f4cbd596227893a5dd5126bf3024c933cae741b0b5dfeff44f2df4feb3` |
| Semantic rubric | `8071571806748201f82021f1da010f7c2420e4f812dd8f4fe3792b4f190f83e1` |
| Retained private raw report | `91044425570d51a9e532d8d9d05de6fe0c0143813c55dbd31f74674df4107a5f` |

## Mechanical observations

All eight capture windows completed, with matching warm and cold source records
after every restart. The final store retained source passages for all 29 user
messages. Three assistant suggestions were not retained: the upstairs desk,
rug and noise machine. Thus submitted-message coverage is 29/32, not universal
conversation retention. This fixture does not show whether an important
assistant statement would be retained when needed.

All four questions and eight answer arms completed once. Each answer remains
`generated-unassessed` in the immutable machine report: semantic review below is
a separate judgment, not a rewritten machine success flag.

| Question | MOC designated source IDs | Lexical designated source IDs | Observed answer content |
| --- | --- | --- | --- |
| Work room | 2/2 | 2/2 | Both preserve original wired/noise reasons, broken latch, continuing wired service, conditional continued use and possible upstairs move. |
| Bakery | 1/2 | 2/2 | Both explain normal Friday late-hours collection and the single Thursday repainting exception. |
| Table actors | 2/2 | 2/2 | Both identify Jon as prospective collector, current refusal, and Priya's separate chairs. |
| Table change | 2/2 | 2/2 | Both distinguish earlier consideration from current refusal; MOC overstates the decision's finality. |

The missing designated bakery passage is not a missing answer fact: later
retained sources repeat the normal Friday schedule and late-hours reason.
Source-ID coverage is therefore diagnostic, not answer accuracy. No marked
irrelevant source IDs appeared, but that finite label list is not a complete
relevance judgment.
Independent inspection found unrelated passages in all four lexical contexts:
table material in work-room/bakery contexts, and work-room material in the two
table contexts. The answers did not incorporate these distractions. Empty
`irrelevantPresent` arrays must not be presented as clean retrieval.

## Semantic caveats and next work

The MOC table-change answer says the current decision is "final", omitting the
source's "for now" qualifier. It otherwise preserves consideration versus
refusal and invents no reason for refusing. The lexical answer avoids that
finality claim. Neither answer should be used as execution authorization.
The MOC answer also compresses explicit approval contingency in describing the
earlier prospective collection, although it still says no decision had been
made. The lexical actor answer omits the proposed Saturday timing; neither
actor answer specifies that Priya had two chairs. These omissions do not change
the identified actors or current refusal, but eight useful answers are not eight
unqualified fully faithful answers.

Both arms give useful answers on this history; there is no demonstrated MOC
advantage. Four questions share one authored history, not four independent
histories. One answer per arm cannot separate retrieval effects from model
variance. Review is nonblind and same-family, not an independent human holdout.
The raw report is retained privately rather than exposing provider metadata.

Remaining work includes preserving commitment/time qualifiers in answer
delivery, testing fresh histories with less repeated evidence, and evaluating
source retention when optional interpretation fails. The latter is a storage
and privacy contract question, not permission to admit invalid qualifications.
No automatic promotion, retry, new retention behavior or runtime default is
introduced by this report.

### Next architectural gate: failed-capture evidence retention

The next proposed slice is opt-in capture integration that commits a bounded
submitted-evidence record together with the admission claim, before model work.
It is not an admitted memory and must remain excluded from ordinary recall,
navigation and ranking. A separate host-owned outbox would leave each host to
coordinate two writes and deletion; that does not establish shared-engine
retention. This is a proposed contract, not shipped behavior.

Before implementation can be called reliable, synthetic tests must establish:

- Qualification failure admits no memory, while explicit inspection can still
  show the bounded submitted view without a provider key or new model call.
- A crash after the claim/evidence transaction leaves inspectable state without
  triggering background inference. Stale workers cannot finalize newer claims.
- Changed-payload replay conflicts; identical replay never extends retention or
  recreates evidence that was discarded. Discard fences in-flight admission.
- Forget removes associated staged evidence and prevents an in-flight or later
  replay from reconstructing a paraphrase. Existing memory-fingerprint
  suppression alone does not provide this source-level protection.
- Explicit byte/count quotas reject before model invocation; expiry does not
  revive after restart or clock rollback. Logical expiry/deletion must not be
  advertised as erasure from SQLite journals or backups.

Persist only the canonical bounded extraction view and explicit truncation
metadata, not a silently expanded conversation archive. Source-lineage and
forget semantics must be resolved before adding retention; neither a new table
alone nor bypassing qualification validation satisfies this gate. No automatic
retry, promotion, default retention or additional paid experiment is authorized
by this report.

## Cost and delivery boundary

The run used 72 HTTP requests: 32 source input-count requests, 32 source
generations and eight answer generations. Its independent ceiling was 128 HTTP,
eight answer calls and US$1.50 conservative reservations. Actual reservations
increased by US$0.720; known usage estimates increased by US$0.042336, with 32
additional unknown-cost requests and zero unsettled requests. Estimates are not
an invoice; unknown costs are not assumed free.

The shared US$50 campaign moved from 1,080 requests / US$13.616 reserved to
1,152 requests / US$14.336 reserved. Known estimates total US$0.827584; 564
requests have unknown cost. Conservative remaining headroom is US$35.664.

Separately, PR102 was merged despite a failing opt-in installed-rationale CI
test. The failure used an outdated synthetic qualification response format;
the ordinary offline suite skipped that opt-in case. A separate corrective PR
addresses the test and contributor gate. This experiment's frozen operator
already emitted the new format in offline rehearsal and its real requests used
the installed adapter. The CI failure must still be resolved before declaring
delivery verified. No package publication, deployment or production change
occurred.
