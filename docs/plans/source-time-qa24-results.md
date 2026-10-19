# Source-time QA24 (T4): closed candidate, advancement stopped

The fresh authored 24-pair experiment completed all 48 answers, but retaining
`sourceTime` labels produced **20/24 correct versus 20/24** with labels deleted.
There were zero paired wins or losses, 20 both-correct pairs and four
both-incorrect pairs. The frozen required gain of at least three was not met.
Stale use increased from one to two questions; Tamar introduced a new severe
failure and Serein retained an unresolved severe judgment. **Stop this label-only
candidate.** Mechanical completion, the targeted anchor improvement and resource
passes do not override these failures.

The [sanitized evidence](../evidence/source-time-qa24-results.json) preserves all
24 authored histories/questions/rubrics, exact two answer messages and answers
for all 48 cells, all four independent grading reports, source-cited primary
decisions, three field disagreements and three claim-segmentation differences.
No historical result is rescored, pooled, replaced or repaired. The earlier
[T3 six-case gain](source-time-semantic-results.md) does not survive as a QA24
correctness gain.

## What was actually compared

Runtime was the accepted T2 commit
`287d22625faaa50b056c83cc5745be16d01171bf`. Each case used one shared normal
indexed-evidence capture, store close/reopen, one cold ordinary flat recall with
`contextMode: source-evidence`, and one canonical-authenticated T2 pack. B kept
that request; A deleted only included tuple labels. Source text, roles, order,
prompt, question, model and caps stayed equal. There was no refill, reordering
or additional deduplication after deletion. The only actual packed duplicate
was one Tamar tuple; no tuple was omitted by the answer packer.

The model was `gpt-4.1-mini-2025-04-14`, temperature 0, answer output cap 512.
Cases ran in source-index order, with AB/BA alternating from AB. Exact T2
system/user strings became two plain-text Responses input messages; count and
generation used the same model/input/text format with truncation disabled.
Generation added the output cap, temperature, `store:false` and `stream:false`;
the asserted T2 `n:1` was not sent as an unsupported wire field. Each cell had
one count and one generation request, with no retry or extra answer call.
Per-cell canonical requests and count/generation hashes and byte lengths are
retained in `cases[].cells[].wire`.

This is a short, primary-authored development experiment about answer use
conditional on shared retrieval. It is not independent engine ingestion, the
native comparator's opt-in bounded-source-scan profile, LongMemEval,
real-user or long-history evidence, an installed-host test, or the full new
architecture. The 48 cells are paired, correlated outcomes, not 48 independent
questions. Freshness means new primary authorship, not a whole-corpus novelty
search. Private operators are not public live commands.

## Fixed 24-pair outcome

Correctness uses complete authored source and the frozen rubric. Support uses
only the actual answer messages. In the table, C/I means correct/incorrect;
S means supported answer, J justified abstention and U unsupported answer.
Correctness and support are separate: a supported answer can be wrong against
omitted full-source evidence, and a correct answer can be an unsupported guess.

| Source index / case | A correctness / support | B correctness / support |
| --- | --- | --- |
| 0 Neris capacity | C / S | C / S |
| 1 Halcyon condition | C / S | C / S |
| 2 Plover exception | C / S | C / S |
| 3 Vesper assistant suggestion | C / S | C / S |
| 4 Orpin exact lexical | C / S | C / S |
| 5 Islet paraphrase | C / S | C / S |
| 6 Fenglin Chinese | C / S | C / S |
| 7 OtterBox-Lite alias | C / S | C / S |
| 8 Serein failed premise | I / S | I / U |
| 9 Tamar session chain | I / J | I / U |
| 10 Rill distractor | C / S | C / S |
| 11 Mistral missing link | C / J | C / J |
| 12 Avel event date | C / S | C / S |
| 13 Bracken late old import | C / U | C / S |
| 14 Fen relative date | I / U | I / U |
| 15 Lyra overlapping scopes | C / U | C / S |
| 16 Cerulean proposal | C / S | C / S |
| 17 Quill adoption | I / U | I / S |
| 18 Kepler failed premise | C / S | C / S |
| 19 Sable reaffirmation | C / S | C / S |
| 20 Astrid absent answer | C / J | C / J |
| 21 Briar conflict | C / J | C / J |
| 22 Dovetail partial support | C / S | C / S |
| 23 Elm third-party claim | C / S | C / S |

| Frozen family, four cases each | A correct | B correct |
| --- | --- | --- |
| Detail retention | 4 | 4 |
| Lexical / paraphrase / CJK | 4 | 4 |
| Multi-session | 2 | 2 |
| Event time / late import | 3 | 3 |
| Proposal / adoption / premise | 3 | 3 |
| Unknown / conflict | 4 | 4 |

Each arm has 20 correct, four incorrect, zero unresolved correctness and zero
not-run cells. Actual-context supported answers are A16/B18, justified
abstentions A4/B3, unsupported questions A4/B3 and stale questions A1/B2.
Reviewed factual claims are A46/B48, of which A4/B3 are unsupported and zero
have unknown claim support. Unsupported and stale question categories can
overlap. Supported-correct answers are A18/B20, a secondary diagnostic that
must not replace the frozen primary full-source correctness gain of zero.
Definite-answer source sufficiency is A14/B18; qualified correct answers and
honest abstentions can remain possible with insufficient definite-answer evidence.

Predefined severe violations are A1/B2, with A0/B1 unresolved severity.
Quill fails in both arms. Tamar is newly severe in B: it calls West Studio
the latest approval although the full source's February 20 North Room approval
is missing from context. A honestly abstains on the incomplete three-venue
question, but is still full-source incorrect. Serein B calls the old choice
validated while the omitted vendor finding says offline operation fails.
Whether that wording specifically endorses reliance offline under the frozen
narrow severe predicate remains unknown and blocking. Unknown severity does
not mean safe. Fen's answers of one day and four days are both wrong: the
full source supports five elapsed days, July 11 to July 16. A wrong calculation
alone does not prove a specific forbidden date mechanism or a model-internal cause.

## Frozen independent judgments and adjudication

Two nonauthor GPT-6.1 Sol/high graders separately judged all 48 masked cells
against the full source. Both first reports froze at 23:21:52 UTC on
2026-10-18 before actual contexts were exposed. Both second reports froze at
23:25:34 UTC before arm mapping was opened. They were not semantically edited.
Context timestamp presence can reveal treatment, so masked labels do not
guarantee perfect blinding. Freeze records and original hashes are in the
public packet; hashes bind original artifacts, not the sanitized JSON.

First-pass correctness and severe labels had no field disagreements. The three
second-pass field disagreements remain visible: Quill A answer support, plus
Dovetail A and B definite-answer sufficiency. Primary adjudication keeps Quill
A unsupported because an undated approval does not establish the latest
identity. It keeps both Dovetail contexts insufficient for both definite values
because water resistance was not tested; a qualified correct response remains
possible. Every decision retains its exact context citations.

Three claim-segmentation differences also remain: Tamar B has four versus five
claims, and Rill A/B each have two versus three. Primary consistently uses the
second grader's 94-claim enumeration while preserving both originals. That
choice does not choose a favorable correctness or safety grader. The separate
source-cited Serein severity disposition remains unresolved. Exact primary
adjudication SHA-256 is
`6010c155b0914c84217f2deb5c502887d4c10b7e128c63071153f3e1bed88ce8`.

## Where recorded evidence was lost

The frozen exact-anchor audit finds 46 retained required anchors, 36 selected,
30 ranked/recalled and 30 in each arm's actual context as source text. Complete
required-source sets decline from 24 retained cases to 15 selected to nine
ranked/actual-context cases. Actual selection/rank stages were observable;
these are mechanical role/content/label checks, not semantic judgments.
The five predeclared label-dependent cases are 9, 13, 14, 15 and 17. Complete
required role/content/time tuples in actual context improve from A0/5 to B1/5,
only Fen (14), which still answers incorrectly.

Serein's adverse vendor finding, Tamar's latest North Room approval and Quill's
latest Lumen approval were retained but not selected, and therefore absent at
rank and answer. B's labels cannot restore an omitted premise or latest choice.
Bracken retains and returns the latest Delta note while excluding the older
Sigma note. Lyra selects the future August 20 production change and includes
it in rank input, then excludes it during ranking before final recall/answer;
that omission can be appropriate for an August 15
question. Its B answer is judged sufficient despite failing full historical
anchor coverage. Exact full-set coverage is not semantic sufficiency. Astrid
returns no memories: its honest abstention is not successful evidence retrieval.
These observations locate recorded stage loss; they do not infer internal
model causes or establish a routing repair.

## Resource and closure boundaries

All 24 groups and 48 answers completed; the supervised original run's actual
exit was **0**. Closure audited 1,405 record files with two agreeing inventories,
24 owned case workspaces and their parent absent, source/runtime/wire bindings
unchanged and the original accounting prefix preserved. Phase starts were
extract 53, classify 53, select 24, rank 23 and answer 48. This cohort has only 53
short source turns, 92 admitted memories, 7,133 source code points / 7,367 UTF-8
bytes and 1,508 local source-text tokens. That token count excludes full requests.

| Observed resource | Shared capture / recall | A answers | B answers |
| --- | --- | --- | --- |
| Physical HTTP requests / reservations | 306 | 48 | 48 |
| Added conservative reservation, US$ | 1.530000 | 0.240000 | 0.240000 |
| Known generation input tokens | 109,019 | 5,053 | 5,351 |
| Known generation output tokens | 9,311 | 694 | 710 |
| Known generation usage estimate, US$ | 0.058558 | 0.003142 | 0.003288 |

The total is 402 physical requests/reservations and US$2.010000 conservatively
added, cumulative US$347.002281 at 60,533 requests. All 23 historical unknowns
remain; there are zero new unknowns and zero pending requests. US$22.997719
remains after the protected US$30. The US$0.064988 known generation estimate
is not an invoice or total count-route billing; count billing stays unknown
and reservations were not refunded. B used 298 more known provider input tokens
without extra answer calls. Balance is an accounting observation, not spending
permission.

Private operator duration was 1,356,735.768 ms; summed capture wall time was
703,179.850 ms, shared recall 316,220.879 ms and answer cells 302,729.521 ms.
These shared-host private wall times are not production latency. Closed owned
case SQLite files totaled 13,475,840 bytes; production storage and host memory
remain unmeasured. Frozen bounds included 1,440 requests / US$7.20 total,
60 requests / US$0.30 per case, four capture batches, ten minutes per case and
60 minutes total. Core local/provider input caps were 6,000/7,024, output1,024,
context 8,192; answer local input 4,000, output 512, context 4,512. No resource pass
establishes lightweight behavior, realistic long-history capacity or host fit.

## Preserved gates and bounded next checkpoint

The [historical P1–P10 / P4 master plan at its frozen commit](https://github.com/Cairn-ink/cairn-memory/blob/36c566013d615bc29852428bbf5fb1c77b80c70f/docs/plans/reliability-three-stage.md)
is preserved unchanged; it is absent from this dependent branch and is not
imported here. P4 net gain at least 3/24, targeted improvement, no increased
unsupported/stale use, no new severe failure, no unresolved safety and resource
acceptance remain conjunctive gates. This candidate fails them. Stage 3 fresh30
native comparison, independent reliability challenge, installed Hermes
new-session use, lightweight resource gates and all earlier results remain
unchanged. No benchmark/parity/full-architecture claim, default promotion,
merge, release or additional paid work follows.

The next checkpoint is **offline only**: inspect actual retained/selected/ranked
and sourceTime seams while reusing the existing bounded-source-scan route.
The current native mixed runner already uses bounded-source-scan but does not
use the T2 source-time producer/packer. This experiment did not test that route
and delivers no successor algorithm or runtime. Any proposed change still
needs its own prospective acceptance and authorization; closed cases remain
closed.

## Delivery record

One bounded implementation worker, actual GPT-6.1 Sol/high, prepared only this
report/evidence and compact ROADMAP/T2/limitations updates on branch
`docs/source-time-qa24-results` from exact dependent base
`061dc31ffe32d6e40d55ee6d3c01d144097c7795`. The initial evidence projection used
no subdelegation, runtime imports, paid/API calls, credentials, ledger/database
access, historical replay or worker commit/push. Later contributor checks below
execute offline test modules. The unmerged T1/T2/T3 dependency chain is not a
released result. At the initial checkpoint, dependent
[PR #442](https://github.com/Cairn-ink/cairn-memory/pull/442) had a retained
unrelated MCP CI failure; this factual delivery does not erase that failure
history or claim that dependency has passed final delivery.

Worker source checks matched the exact primary hash and all 20 artifact
bindings via Node crypto and independent `sha256sum`, actual exit **0**.
A separate verifier compared every authored source, exact request/answer, four
unaltered reports and primary entry to its original; independently grouped all
24 unique pairs/48 unique cells, family/support/severe/claim counts, 402 resource
requests and anchor stages; checked seven new relative links, sensitive-path
exclusion, both old document prefixes and all historical ROADMAP text. Actual
exit **0**. `git diff --name-only` plus untracked paths versus independent
`git status --porcelain=v1 --untracked-files=all` yielded **five paths each,
zero differences**, including the new evidence file. `git diff --check` and
safe `npm run validate` each exited **0**; validation's existing script checks
manifests/version consistency, while the separate verifier parses and checks
the new evidence. This initial projection-only check did not duplicate the full
generic gate; the later primary-requested contributor checks are recorded below.
Primary owns combined gates, exact-candidate Standards/Spec review, commit, PR and CI
supervision; none is substituted by worker self-checks.

The original-base Node 22.16.0 generic check subsequently passed 673/673,
actual exit **0**, with zero failures/skips/cancellations (206.7 seconds).
That result remains historical. The primary then integrated the independently
reviewed three-file MCP test correction `8e4183e` into T3 and advanced this
local dependent base to `b876f0b02a0824d51cdbffea5c39cd51831c60e6`, whose parent
is the original `061dc31` base. All five draft file hashes matched before and
after that local integration. No main/PR merge or experiment replay occurred;
the public evidence retains its original experiment/projection bindings.

Fresh contributor gates on the corrected base ran sequentially under exact
Node 22.16.0 and 24.15.0 executables with matching npm, an explicit environment
allowlist, disabled parent compile cache, absent isolated npm configuration,
offline npm, isolated Claude configuration and the existing owned runners.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 673/673; exit **0** | 673/673; exit **0** |
| `npm run validate` | exit **0** | exit **0** |
| `npm run validate --prefix tools/plugin-validation` | marketplace + strict plugin pass; exit **0** | marketplace + strict plugin pass; exit **0** |

Both generic runs had zero failures, skips or cancellations, completing in
231.2 and 251.3 seconds respectively. Process CPU, child activity, changing logs
and error markers were supervised throughout; no restart or cancellation was
needed. All five draft hashes remained unchanged through all six gates.

Maintainer prerequisites were initially absent. Before installation, the target
tooling directory was confirmed absent rather than a shared symlink, and its
lockfile was byte-identical to the approved existing local tooling lock:
SHA-256 `4f8437487e60c8c3f297ee4baae6f3a1ba950d68fa8dea800b7a72f10eaf7ec1`.
The authorized `npm ci --offline --ignore-scripts --prefix tools/plugin-validation`
used only the approved local cache and exited **0**, installing three packages
without lockfile changes. Ignoring lifecycle scripts left a launcher stub.
The fully inspected pinned Claude 2.1.260 `install.cjs`, SHA-256
`5cbab1670597f492cd4eeb946f3c344ebcb1fbd43c623ba192c9b33744461b85`, was then
run only for its Linux local-payload hardlink path, exit **0**. The matching
installed optional payload and launcher had the same inode and 214,687,216-byte
size afterward. No download, new dependency selection, shared-tree write or
access to existing user credentials/application configuration was needed.
Private command logs are retained in the worker handoff. Only this delivery
record changed after the gates;
outcomes, sources and the other four files remain unchanged. Final independent
evidence/inventory verification and `git diff --check` were rerun, each exit
**0**, before handing the candidate back to the primary.
