# Longer source history: frozen semantic rubric

Post-run: see the [once-only capture failure report](long-source-history-results.md).
This link was added after the frozen rubric; the report records its pre-live hash.

One authored 32-message history, eight capture windows, four later questions,
MOC and lexical source controls, at most eight once-only host completions. This
is newly authored synthetic development evidence, not a blind human benchmark
or proof of real-world longevity. Freeze these documents before live calls;
never replace or rerun failed cases, switch models, or tune to observed answers.

Keep the JSON scorer labels outside all extract/select/rank/answer inputs.
Required IDs measure retention of specific reference passages, **not whether the
answer is correct**. Repeated corroborating passages can support a correct answer
even if a designated required ID is missing. In particular, later Sable remarks
corroborate both condition and nonreplacement, earlier Lina enrollment corroborates
her enrollment, the final Oriole remark repeats the travel exception, and earlier
telescope negatives may support appropriate nonpurchase answers. Never relabel
these after outcomes to improve the metric.

Marked irrelevant IDs are a frozen non-exhaustive negative set; an unmarked
receipt is not automatically relevant. Report both these presence counts and
independent semantic relevance assessment. Compare the same retained active
captured source store and top-six limit; no hand-admitted corrections or oracle
routing labels. Lexical overlap can return empty or irrelevant results and gets
no rubric rescue. Both answer arms use the same explicit safe consumer.

Pre-live independent review clarification: the machine's `irrelevantPresent`
means designated off-target passages, not automatically harmful or useless
context. Mara's flask passages explicitly distinguish her choice from the user's
and can help actor disambiguation; Lina's notebook is topical but unnecessary.
Also distinguish omitted useful rubric detail from missing literal question
requirements: the studio's nearby location and French nonenrollment add detail
beyond the minimum commute/course questions. Four queries share one history,
not four independent long-term histories; equal top-six limits do not guarantee
equal semantic information budgets.

## Answer judgments, separately from retrieval

1. Sable: original one-hand opening and six-hour heat retention; replacement lid
   requires two hands but heat retention still works; no new flask selected.
   Do not transfer Mara's Cedar-to-Birch switch or assistant straw suggestion to
   the user. A condition changed, not all reasons or the user's choice.
2. Courses: user postponed and did not enroll in Estuary or French. Lina remains
   enrolled in Spanish; hers is not the user's enrollment. Preserve earlier
   consideration as uncertainty, not an adopted course or retroactively false
   event. No fabricated dates or claims that Lina postponed.
3. Travel: normally walks because studio is nearby; one Tuesday's heavy equipment
   prompted a bus trip, then walking resumed. Not a permanent switch, every
   Tuesday arrangement, or travel change caused by the electrical repair.
4. Telescope: no selected or purchased telescope; browsing/bookmarking/talk are
   not purchase or adoption. Reject the question's presupposition rather than
   inventing a model or purchase reason. Saying the supplied sources do not
   establish a purchase is appropriate if explicit final nonpurchase is absent;
   do not score that cautious answer as full recall of the final declaration.

Per answer record supported useful content, appropriate ignorance/abstention,
unsupported additions/contradictions, missing requested details and actor/time/
uncertainty handling. Missing evidence and failed/partial recall remain separate
from host refusal, malformed output or provider failure. An OK partial recall
is still scored for source coverage; the strict consumer then records
`answer_not_run_partial_coverage`. This is a policy observation, not zero source
recall or an incorrect answer. Generated-unassessed is not a correctness score.

One answer per arm cannot isolate model variance, and same-family nonblind agent
review is not independent-human adjudication. No MOC superiority, global accuracy,
injection immunity or broader host support claim follows automatically. Report
all captures, intermediate source coverage, eight answer slots and actual budget,
including omissions and not-run slots.
