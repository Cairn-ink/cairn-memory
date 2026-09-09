# First model-backed evidence: useful failures, not launch-quality proof

The unchanged seven-case pilot completed on 2026-09-09 UTC (September10 in
Taipei). Cairn answered only three cases, all with abstention; four cases stopped
during ingestion. This run does **not** establish useful long-history QA quality.
The raw same-model judge also produced two false positives. Retaining both
product failures and evaluator failures is part of the reliability evidence.

## Frozen comparison and original outcomes

The [machine-readable original aggregate](first-live-pilot.json) retains the
unmodified run. The source engine/adapter was merged base
`bbcaac46cf78f6e081bc9de6c989e600bf525168`, before the separately tested provider
framing fix. Uncommitted experiment session/pilot files were frozen by SHA256 in
the pre-run intent; their exact hashes are in that aggregate. Later harness
edits or fixes do not retroactively change the measured implementation.

The existing seven-case LongMemEval-S prepared sample was used unchanged:
335 sessions, 3,512 turns and 343 planned capture batches. Source revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f` and preparation hashes are recorded in
the existing preparation evidence and this aggregate. This is a small selected
engineering pilot, not a representative sample or an official LongMemEval score.

All arms used `gpt-4.1-mini-2025-04-14`, answer template
`cairn-longmemeval-answer-v1`, evidence6000/request8000/output512 tokens;
Cairn recall limit6 and lexical candidate limit100. Three cases generated at a
time. Every generation settled before reference answers reached any judge.

| Arm | Planned | Completed | Failed | Machine correct | Machine incorrect | Judge unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cairn | 7 | 3 | 4 | 1 | 2 | 0 |
| Lexical history search | 7 | 7 | 0 | 5 | 2 | 0 |
| No memory | 7 | 7 | 0 | 1 | 5 | 1 |

These are **unvalidated machine judgments**, not accuracy claims. Seventeen
judge calls were attempted; sixteen returned a scored verdict and one unknown.
The four failed Cairn arms were not judged or removed from the planned denominator.

## Primary audit: the judge itself failed

The primary inspected all generated answers and references after scoring. A
second agent independently checked the disputed case. For source case `0a995998`,
the reference asks for an exact quantity: the Cairn abstention and the lexical
wrong quantity were both marked correct. The judge input retained the original
reference type, question and generated answer; inspection found no serialization
bug. The same-model rubric is not a reliable quality gate on this evidence.

Removing those two demonstrated false positives gives an **agent-reviewed
diagnostic**, not an independent human or official score: Cairn0, lexical4,
no-memory1 accepted answers out of the same seven planned cases. The no-memory
unknown remains unknown; the raw machine report is not overwritten. The
no-memory success is the deliberately unanswerable case, not retrieval value.

| Source case ID | Cairn | Lexical | No memory |
| --- | --- | --- | --- |
| e47becba | Incorrect abstention | Incorrect | Incorrect |
| 0862e8bf_abs | Ingestion failed | Correct | Correct abstention |
| 0a995998 | Machine false positive | Machine false positive | Unknown |
| 8a2466db | Ingestion failed | Correct | Incorrect |
| gpt4_59149c77 | Ingestion failed | Incorrect | Incorrect |
| 6a1eabeb | Incorrect abstention | Correct | Incorrect |
| 7161e7e2 | Ingestion failed | Correct | Incorrect |

## Reliability, coverage and resource observations

- Ingestion:154 completed batches,4 partial,185 not run. The partial batches
  were zero-based indices2,5,4,4 in cases2,4,5,7. No answer was synthesized from
  their partially ingested stores. Original summaries omit nested error codes;
  do not infer that all four failures share one root cause.
- All three completed Cairn recalls reported `budget_exhausted` coverage, with
  respectively0,1,0 candidates. This is the bounded recall/traversal resource
  status, **not exhaustion of the USD20 spending allowance**. Source-session
  coverage was1/6 retrieved and packed, available for only those three cases.
  Lexical coverage was11/11 retrieved and10/11 packed across all seven cases;
  no-memory was0/11. These denominators differ and are not semantic support scores.
- Cairn cumulative arm time was1,498,334ms, versus30,814ms lexical and17,602ms
  no-memory. Cairn includes one-time model ingestion, so this is not a fair
  per-query latency comparison. The three fully ingested cases each took roughly
  6.6–7.6minutes to ingest. Case generations overlap; summing arm time is not
  wall-clock time. The first pilot intent to result checkpoint was about15.6minutes.
- Per-case closed SQLite bytes are in the aggregate. Failed partial stores are
  included; their smaller sizes must not be presented as successful compression.
- No recorded safety blocking flags is not proof of comprehensive safety; this
  seven-case QA experiment did not adversarially test isolation or data leakage.

## Separate framing regression probe

A fresh copy of failed case2 reproduced a real preflight defect:4146 local input
tokens,5173 provider-counted input tokens, versus the former relative allowance
5170. The existing absolute input ceiling was7024. A separate fix uses that
absolute ceiling without enlarging local input, output or cost reservations.

On another fresh copy, the fixed adapter accepted the same5173 count and completed
a five-item classification proposal. Neither probe applied the proposal; the
original database hash remained unchanged. This is targeted regression evidence,
**not a corrected seven-case score** or proof all ingestion failures are fixed.
The fixed adapter SHA256 is
`911d885d95e522c07759b76c37466677a8f3fb21987e6da8cfbdfcc552e7f46d`.

## Next quality gates

Before another quality claim: retain nested ingestion failures, verify the
framing regression across a complete fresh pilot, diagnose bounded recall's
missing evidence without answer-specific tuning, and calibrate the judge against
synthetic known-correct/incorrect/abstention cases. Evaluate any retrieval change
on fresh held-out data after the development sample; do not tune and report on
the same seven questions. A successful explicit-tool lifecycle and useful
long-history QA remain separate claims.

## First real Hermes trial: retained protocol failure

The actual Hermes AIAgent/native-provider/installed MCP path used the same pinned
baseline, global ledger and synthetic Lantern prompts. A and B passed: explicit
save, then fresh-session recall of the same ID/revision and source receipt.
C actually corrected that same ID from revision1 to2, stored Friday with a new
supporting receipt, and left exactly one active memory. The model first read the
current ID/revision via `cairn_recall_memory`, not `cairn_inspect_memory`.

The original inspector required the literal inspect tool and marked C failed.
D–F remain `not_run` in this trial; they are not retroactively filled in. The
no-memory control made no tool calls and guessed neither day, but its final text
claimed a search had started. Primary semantic review rejects that as successful
task behavior; the automated no-tools predicate alone is not a quality pass.

This distinguishes a harness false negative from product state: the actual
guarded correction succeeded, but the frozen trial's stricter tool-sequence
acceptance did not. A separately frozen follow-up may accept either actual
inspect or actual recall that exposes the matching current revision and source
**before** the mutation; it must retain this original failed trial and use a
new profile. No model prompt, tool output, engine or provider default is repaired.

At this checkpoint the whole experiment had703 requests, USD5.450 conservatively
reserved, USD0.668753 known usage estimates and332 unknown-cost requests. These
are global totals including probe, pilot and diagnostic calls, not a provider
invoice. The actual count-call cost is unknown, never assumed free.
