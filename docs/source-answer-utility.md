# Do returned sources help downstream answers?

The controlled consumer produced **twelve useful source-supported answers and
four appropriate no-memory abstentions**. We found no clear unsupported factual
addition or contradiction in these sixteen responses, but several omitted
details. This is not sixteen successful memory answers, a general accuracy
estimate, or evidence that MOC beats simple lexical retrieval.

The [complete evidence](../evaluations/results/source-answer-utility-v1.json)
retains all model-facing bodies, answer text, projected response choices and
usage, including omissions. The [frozen fixture](../evaluation/live/source-answer-fixture.json)
and [pre-live rubric](source-answer-rubric.md) accompany it. Judgments below were
made by the author and a separate nonblind agent reviewer, not independent humans.

## What actually ran

Four already-seen development questions from the
[installed source loop](source-loop-results.md), each answered once with:

- No memory: empty sources, where appropriate ignorance is correct behavior.
- MOC: exact previously returned source receipts and order.
- Lexical: the previous lexical control's captured receipts, in selected order.
- MOC plus basis: identical MOC receipts plus its unchanged, unassessed proposal.

The pinned `gpt-4.1-mini-2025-04-14` model received the same explicit instruction
to use original evidence, preserve attribution and timing, treat proposed
relations as unassessed, and not treat memory as execution authority. Arm order
rotated by case. There were sixteen actual host-completion HTTP requests, no
tools, retries, model switching, truncated outputs or transport failures.

This step **reused frozen retrieved evidence**: it did not recapture/retrieve,
install again, or test a default GUI/MCP host. The upstream run exercised an
installed local core, source-bound capture, cold reopen and actual MOC recall.
MOC and lexical differ in order and extra receipts, not just the retrieval label.

## Every case and arm

| Case | No memory | MOC sources | Lexical sources | MOC sources plus basis |
| --- | --- | --- | --- | --- |
| Rill battery | Appropriate abstention | Both original reasons, battery change, no replacement | Same substance | Same substance |
| Pickup hours | Appropriate abstention | Next-week 16:00 closing causes 15:00 pickup; old 18:00 historically correct | Same substance | Future change and historical 17:00/18:00 correct; omits new 15:00 pickup |
| Temporary reading | Appropriate abstention | Usual quiet library; two noisy days at café, then return; not permanent | Same substance | Same, despite missing temporary-support graph link |
| Journal belief | Appropriate abstention | Attributed local-only belief, cloud-default correction, no switch or moving authority | Same, explicitly says always cloud-default | Same, explicitly says always cloud-default |

All three Rill memory answers omit an explicit statement that the rack is
unchanged, while identifying only the battery as changed. This is omitted
explicit rubric detail, not a false rack-change claim. For pickup, source-only
answers omit the old 17:00 pickup; the basis arm includes it but omits new 15:00.
All address the literal why/history question, but none reproduces every rubric
timeline detail. Journal MOC's phrasing about misunderstanding cloud sync is
awkward; its surrounding original belief and correction do not establish a
reversed claim. No source-free answer guesses personal facts.

Reading shows that an incomplete relationship proposal did not prevent a useful
complete answer when original receipts remained available. Pickup's basis
omission co-occurs with its missing graph support, but one sample cannot establish
that the graph caused the omission. Adding a basis shows no demonstrated benefit
here, not proven general harm. MOC and lexical deliver substantially equivalent
supported content in this small sample.

## Provenance and spending

Frozen source commit: `79eb3c57224f492c8349dbb90cc9423e75f47114`.
Upstream raw SHA256: `81d43ebd678afef6c5f5f0ab03a567db670562bf3e4674d15a4ea6272eb8874e`.
This run's raw SHA256: `12fcb85367bd3b154b94e5ee8cf0bf405a3b6ddaa74910b7768e957cde5497a8`.
Operator SHA256: `b4a0b42207d6219c4bcc6bd6ec8e3e0e3609d63ffc48de18b60bd813883d8a27`.
Fixture and rubric hashes are included in the public artifact and tested against
the committed files. Provider/session IDs, headers, local paths and credentials
are excluded; this fixed synthetic-only exporter is not a general log sanitizer.

Both pre-live reviews passed. Successful, malformed-response and transport-failed
offline rehearsals respectively exercised 16, 16 and 1 mock requests; transport
failure halted fifteen remaining slots and retained unknown cost. An earlier
mock-only missing response `object` field was correctly rejected by the guard;
the mock was fixed and preparation repeated before any live call. No real
failure was rerun and the production guard was not relaxed.

The existing US$50 ledger moved from 1,042 to 1,058 requests and US$12.706 to
US$13.506 conservative reservations: this run reserved US$0.80. Known token-priced
usage estimates rose from US$0.769069 to US$0.772930, a US$0.003861 increase.
The 521 earlier unknown-cost requests remain unknown, not free; zero requests
are unsettled. Reservations are conservative spending bounds, estimates are not
invoices, and the ledger was neither reset nor refunded. Conservative remaining
authorization is US$36.494, not additional authorization to publish or deploy.

## Decision and next gate

Keep original source receipts available and relationship interpretation optional.
Do not promote a more expensive graph mode merely because it compiles, or make
source-only answers depend on graph completeness. These results justify advancing
the source-first user path, not claiming the architecture has won a benchmark.

Installed MCP already has scripted capture, source-context recall, restart and
privacy tests, including the generated installer command. The next engineering
gate extends that coverage through downstream host consumption of this evidence
contract: original receipts, clear uncertainty and provenance, no accidental
execution authority, bounded context, and observable failures. It is not a new
MCP implementation. Then evaluate
fresh longer histories with distractors, paraphrased questions, actor/time
ambiguity and missing evidence, comparing downstream usefulness and cost against
a simple source baseline. Those are still pending, as are independent real-user
validation and broad long-term reliability. Four previously inspected synthetic
cases, one response per arm and an explicitly instructed consumer cannot replace
those gates.
