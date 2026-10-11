# Six-case larger-pool source and rubric evidence

Status: prospective authored-development checkpoint, before paid answers.
Contract: [large-pool-six.md](large-pool-six.md), L1 and the author-controlled
parts of L7–L10. This note records fixture evidence, not semantic scores,
observed admissions, larger-pool eligibility or a launch authorization.

## Ownership and independence

The primary assigned one bounded independent corpus author to
`/home/chichieh/Github/cairn-memory-worktrees/large-pool-six-corpus`,
branch `fixtures/large-pool-six`, fixed base
`afa68cb47ead699725aef6878194b6d4fe6f8236`. The task packet selected
GPT-6.1 Sol/high. The author read the fixed contract, repository contribution
and domain instructions, workflow/model-routing instructions, generic source
preparation code and test-workspace contract. The author did not inspect the
lexical candidate implementation, old case answers, operational ledger,
environment secrets or paid observations. The existing preparation export is
imported for an offline source-plan check; this does not exercise its recall
compiler or authorize model requests.

Only these four new files are owned by this packet:

- `evaluation/algorithm-development/large-pool-cases.json`
- `evaluation/algorithm-development/large-pool-rubric.json`
- `evaluation/algorithm-development/test/large-pool-corpus.test.mjs`
- `docs/plans/large-pool-six-fixtures.md`

The source and gold were authored before any paid answers. Pre-freeze review
changed only prospective calibration: L03 explicitly asks for its original
reason; its exact fee-change date is optional, L04 host/volunteer operations
are optional, and L06 explanation of distractor groups is optional. After
the first paid answer these fixtures must not be tuned or replaced.

## Closed roster

Each case has six sessions with explicit UTC event times, and each session
contains user, assistant, user turns. Both user turns contribute meaningful
durable statements; assistant turns acknowledge or clarify the preceding
statement. There are 36 sessions and 108 messages total. Each source contains
ordinary supporting facts and distractors, with no instructions to admit a
specified memory count, memorize a span or manufacture a MOC/card.

| ID | Family | Unicode source characters | Exact anchors | Requested answer |
| --- | --- | ---: | ---: | --- |
| L01 | three-source-handoff | 1,886 | 4 | Priya; Marsh reel → Tern → Evening set |
| L02 | dated-location-update | 1,786 | 5 | West annex shelf C, effective May 12 |
| L03 | decision-premise-reconfirmation | 1,993 | 7 | Dock Hall remains recorded; included-technician basis needs review |
| L04 | cjk-paraphrase-retrieval | 580 | 6 | Palm toward host requests a pause; respondent decides when to resume |
| L05 | missing-entity-binding | 1,694 | 7 | Borrower unidentified; destination Studio D |
| L06 | lexical-scope-collision | 1,824 | 7 | No recorded weekend-club June adoption; cafe remains suggested |

Character counts use Unicode code points across message content only, not
JSON bytes, question text or UTF-16 length. All six are below 4,000.
Event days are at or before the question day. L02 deliberately places an
April event after the May agreement in source-array order, while retaining
the old event time; array order cannot make that historical pickup current.

The model-facing source file permits only id/family/question/sessions and
their closed nested fields. Gold is a separate evaluator-only object with
version `large-pool-six-v1` and `utf16-code-unit` offsets. Every anchor is
a unique exact user-message slice with safe Unicode boundaries.

## Calibration and limits

Four cases request known information and two require supported uncertainty.
All four known cases mark the generic answer “I do not know.” incorrect.
Unknown positive examples preserve the supported destination/proposal status
without inventing identity or adoption. Unknown negative examples make an
unsupported entity join or transfer another group's decision.

Concise and explained correct examples are equally valid. Required facts
match the question. L01 can omit Elias's separate check, L02 can omit earlier
pickup history, L03 can omit the exact June 1 date and Birch Studio,
L04 can omit host/volunteer operations, and L06 can omit the distractor
groups and older venue history. Qualifications still constrain any extra
claims an answer chooses to make.

The 36 anchors include diagnostic, historical and disambiguating passages,
such as another projector's return and an equipment report author's role.
They are not 36 mandatory answer facts or a minimal answer checklist.
Multi-source sets identify diagnostic source chains; they do not require
every chain to be narrated in the answer. Literal coverage is not semantic
support and must not inflate correctness for optional background.

The corpus provides a natural opportunity for several admitted facts per
session. It does not guarantee admissions, selected references, an actual
rank pool larger than six or `lexical_bridges` eligibility. Those are
runtime observations. It is fresh authored development data, not an
independent holdout or official benchmark.

CJK question wording paraphrases the operative user passages: 暫停錄音
maps to 先別把談話收進音檔, and 繼續 maps to 重新開機. Normal NFKC
preparation changes some full-width punctuation; selected literal anchors
avoid that punctuation and remain unchanged. No source message is altered
by secret redaction. Explicit UTC input times are rendered through the
unchanged preparation adapter's existing minute/date grammar; no new
timezone policy is introduced here.

## Verification checkpoint

The dedicated fixture suite imports the base
`prepareAlgorithmDevelopmentCase`, without directly importing or exercising
a candidate compiler.
Its local source whitelist assertions are fixture acceptance checks, not
proof of the prospective runtime loader. Runtime boundary/scorer tests
remain owned by the implementation packet. Static known/unknown examples
are calibration controls, not semantic judge results.

The nine tests verify source shape and dates, rejection of evaluator fields
at every source depth, exact anchor spans, six executable normal
indexed-evidence batches per case, roles and preserved normalized anchor
opportunities, late old-event dates, CJK paraphrases, the four/two control
split, optional-background omission and prospective canonical hashes.
Normal preparation yields 36 batches and preserves all 108 turns.

Commands and actual results on this four-file checkpoint:

- `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/large-pool-corpus.test.mjs`:
  exit **0**, 9 passed, 0 failed.
- `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/large-pool-corpus.test.mjs`:
  exit **0**, 9 passed, 0 failed.

An initial Node 22 run exited 1 on two test-author assumptions: the exact
preparation policy label is `indexed-evidence-v1`, and the concise location
example begins with a capital S. Those assertions were corrected without
changing the corpus or gold. An earlier one-off inspection exited 1 because
it tried `plan.batches` rather than `plan.cairnPlan.batches`; inspection
was repeated correctly with exit 0. No model or HTTP calls were made.
No TypeScript gate exists in this JavaScript repository. Full contributor
and combined runtime gates remain with primary integration.

Tests create no file fixtures or external resources; they use the repository
owned invocation runner for temporary-directory ownership and cleanup.
Source preparation is in memory and creates no SQLite database.

Canonical SHA-256 identities, pinned in the suite:

- Source: `cb3834f6b4672e95fe5d79d51d93bcf3fe042a73f829aecc8b813b3e7ce8c118`
- Gold: `39bb513e254d489912540f9cdc762f7cac5c3dac70fc3f26f236ccf836b4c27e`

Changed-file inventory is cross-checked from Git's porcelain status and an
independent tracked-diff plus untracked-file listing: both contain exactly
the four owned files above, count **4**. No existing case/rubric, dependency,
lock, core, adapter, CI or operational file is changed by this author.
The checkpoint is uncommitted pending primary diff review; the author has
not pushed, opened a PR or made paid calls.
