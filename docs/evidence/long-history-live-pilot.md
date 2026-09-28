# Four-case real-model long-history feasibility pilot

Status: one completed, one-shot diagnostic on four newly authored synthetic
histories. All eight scheduled generation arms and all eight judgments
completed. This is a small feasibility observation of an explicit opt-in
source-evidence path, not a LongMemEval cohort score, a default-product result,
or evidence of broad Cairn/Mem0 superiority.

## Frozen method

The [pre-outcome plan](../plans/long-history-live-pilot.md) fixed four new
histories and separate evaluator/rubric records before provider output. Each
history has 60 original messages and four batches under the actual public
`indexed-evidence-v1` planner. One archive message is 2,690 UTF-16 units, with
the answer objects near its front, middle and tail. The other cases test an
explicitly adopted replacement route with two reasons, a changed venue premise
without a replacement decision, and a Traditional Chinese confirmed event date
distinguished from an import date and an unadopted proposal. Cairn and Mem0
alternated first position, twice each. No official corpus case or prior
consumed case was resampled for this packet.

Public fixture commit: `fd1e09b5c5bf96d0ec26b88eaa9a3418691f1de1`.
SHA-256 of the source-only module is
`de01931ca7faf312f07940ee9eff13005d8fb158d4c2a78dce91a195200e1f53`;
the separately loaded evaluator module is
`fb958ee4ec6a99dd7ece038eb85de2b30526150630956a759582d63c325aadef`;
the preparation helper is
`320dbb53e2c1a2d1519b52d8a3d59a42192fcae2a89ed1bdf87b18bc4c695cfd`.
The source, questions, reference strings, supported facts and forbidden
inferences remain inspectable in that fixed public commit. The evaluator was
loaded only after durable generation.

The common memory and answer model was `gpt-4.1-mini-2025-04-14`; the
independent-model official-style judge was `gpt-4o-2024-08-06`. The comparator
was pinned native Mem0 2.2.0 with `text-embedding-3-small`, native infer-add,
top-k 6 and threshold 0. Cairn used the explicit `indexed-evidence-v1`
capture profile, `bounded-keyset-v1` candidate routing and source-evidence
recall with `bounded-source-scan` selection and limit 6. Qualification was
omitted by this profile. The existing guarded transport, request bounds,
common answer model and scorer were reused; no product default, engine,
adapter, prompt, provider guard or runtime code changed for this result.

## Completion, judgments and selected evidence

All 16 planned Cairn capture batches completed. Both arms generated a nonempty
answer for every case; both were judged on all four fixed questions, so the
common resolved denominator is 4/4. Here `correct` and `incorrect` are the
fixed official-style model-judge outcomes, with primary manual checks against
the authored rubric; they are not a proof that every statement in an answer
is true or supported.

| Authored case | Cairn | Mem0 | Salient observation |
| --- | --- | --- | --- |
| Archive objects across one long message | Correct | Incorrect | Mem0 gave a vague description of three checkpoint objects without the required objects. |
| Adopted gallery route and two reasons | Correct | Correct | Both included the later adopted route and its two stated reasons. |
| Room premise changed; no replacement adopted | Incorrect | Correct | Cairn identified no adopted Ferry Hall replacement but omitted the failed no-fee premise and need for reconfirmation; its response also did not establish that the pop-up was not cancelled. |
| Confirmed Chinese event, import date and proposal | Correct | Incorrect | Mem0 said the confirmed event date was unknown. |

Totals: Cairn 3 correct, 1 incorrect, 0 unresolved; Mem0 2 correct,
2 incorrect, 0 unresolved. The numbers are diagnostic for these four authored
questions only. They are not a statistical advantage, a causal intervention
comparison, an official benchmark rank or a quality guarantee.

Cairn admitted 11/10/9/14 cards by case (44 total), recalled 1/2/2/4 cards
(9 total), and supplied 4/2/2/4 source receipts (12 total). The answer packer
selected 1/2/2/4 evidence units with none omitted. The pinned native Mem0
reported 11/9/11/7 verified add records (38 total) and six retrieval results
per case. Those add records are not equivalent to Cairn admitted cards, so the
two memory counts should not be compared as retention or quality rates.

In the failed Cairn room-premise case, the primary's read-only inspection of
selected source receipts found both the no-fee room's unavailability and Niko's
explicit statement that Ferry Hall was not chosen and the pop-up was not
cancelled. These passages were selected and not omitted in packing. The
original decision passage was not selected, so the packed evidence does not
establish complete decision context. The observed answer left out essential
parts of the selected evidence. This locates an answer-stage omission in this
one run; it does not prove a model root cause or a general repair.
There was no retry, answer editing, reclassification or replacement case.

## Accounting and interpretation

The whole one-shot run took 347,599.914 ms (approximately 347.6 seconds).
This is elapsed time for the bounded experiment, not production request
latency; per-arm and per-stage latency was not measured. It made 142 new
guarded requests: 37 count, 37 Cairn generation, 16 Mem0 chat, 36 embedding,
8 answer and 8 judge. All settled, with zero pending. Conservative reservation
increased by 1,121,062 micro-USD; known usage estimates total 98,275
micro-USD for 105 rows, while 37 rows have unknown cost. Known estimates are
not total spend and reservation is not an invoice. The conservative prelaunch
projection allowed up to 4,284 requests and 1,365,856 micro-USD of reservation,
below the packet's 3,000,000-micro-USD limit. The post-run cumulative
checkpoint is 19,420 requests and 124,916,555 micro-USD reserved under the
unchanged 200,000,000-micro-USD cap, leaving 75,083,445 micro-USD. The
previously authorized settlement of one older pending request to `unknown`
retained its 10-micro-USD reservation and did not revise the old halted run's
observation or score. The primary's fresh read-only ledger inspection matched
the saved post-run checkpoint exactly; an independent reviewer reconciled all
142 new row amounts and outcomes with the guarded request record, found zero
pending, and confirmed that the settled prelaunch prefix was unchanged.

Before dispatch, non-author Standards and Spec reviews of the fixed public
commit and private helper hashes both passed. Primary-owned offline checks
passed on Node 22.16 and 24.15: the new fixture gate 3/3, pinned native gate
26/26 and private operator gate 10/10 on both; the LongMemEval suite passed
193/193 on Node 24, and generic tests 121/121 plus JSON validation passed.
These are engineering gates and fake-HTTP checks, not additional scored cases.
The private operator gate was pinned to the prelaunch runtime commit above;
the later result-delivery commit changes only documentation and does not
retroactively change that tested runtime.

The experiment did not cold-reopen model recall, exercise MOC-led navigation
or normal MCP/Hermes use, test 1,025-card capacity, validate source
qualification or automatic supersession, or establish lightweight installed
latency and cost. Selection bias and the simple authored questions limit
generalization. The earlier [fresh official-six v3 halt](qualification-official-v3.md)
remains immutable: its scheduled arms did not become scores because this new
opt-in packet completed. A fresh six-type official cohort must independently
clear completion and common-resolution gates before a separately reviewed
fresh fixed-30 proposal. Installed MCP/Hermes behavior and the semantic
source-support loop remain separate product gates. This report grants no
replay, deployment, release or additional paid dispatch.
