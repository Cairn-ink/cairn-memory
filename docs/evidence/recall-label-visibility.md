# Real-model navigation-label diagnostic

The [machine-readable record](recall-label-visibility.json) includes fixture
construction, exact source hashes, every observation and both ledger checkpoints.

This is a six-case synthetic diagnostic, not an accuracy benchmark. The unchanged
core at `c0cbc6027316750a73a8a9423e62aeae4104c2f3` used actual SQLite and
`gpt-4.1-mini-2025-04-14`. Explicit admission and deterministic placement avoided
extractor/classifier calls. The [plan](../plans/recall-label-evidence.md) preceded
provider requests. All six cases ran once; none was replaced.

Each pair stores identical facts with generic filler either after or before the
fact. The query is “Who owns the fictional Juniper migration?”; the target is
“Rina owns the Juniper migration.” Other memories concern unrelated fictional
projects. All are filed under `Project notes`. UUID ordering is not controlled.

| Memories | Fact position | Query term in navigation | Target selected | Target recalled |
| --- | --- | --- | --- | --- |
| 1 | Front | Yes | Yes | Yes |
| 1 | Back | No | Yes | Yes |
| 4 | Front | Yes | Yes | Yes |
| 4 | Back | No | No | No |
| 16 | Front | Yes | Yes | Yes |
| 16 | Back | No | No | No |

All six direct reads contained the target. All six maps exposed the target
reference and were exhausted. No structural diagnostic or storage error occurred.
Both failing cases returned an empty recall with `coverage:complete`: that field
describes traversal, not semantic correctness. The model chose a distractor and
the ranker correctly rejected it. The single-memory back case succeeded despite
the hidden term, so information loss is not a claim that every such request fails.

The evidence localizes the observed miss before fetch/ranking: a 120-code-point
prefix discards the discriminating fact. It does not establish that this explains
all earlier evaluation failures. Increasing retries or relabeling empty results
would not correct the missing selection evidence.

Run completed `2026-09-10T17:28:24.976Z`. Per-case recall duration in order was
4,203 / 4,074 / 3,534 / 3,284 / 4,308 / 4,459 ms. The run added 24 guarded HTTP
requests, USD0.120 reserved and USD0.004963 known usage estimates; 12 requests
had unknown cost. The original cumulative ledger now records 886 requests,
USD9.650 reserved, USD0.785152 known usage estimates, 387 unknown-cost requests
and zero unsettled requests. These are ledger values, not a provider invoice.

Raw synthetic SQLite stores, results, frozen fixtures and source/operator hashes
are retained privately in the original experiment directory. No credentials or
raw provider messages are included here. This diagnostic does not pass the
broader product-quality or PLG readiness gates.

Baseline frozen-intent SHA-256:
`fc2f32e4e3455da627cd03bc93e4cad65c3d52de0d3c376efc589349e4af0ef7`.

## Follow-up: bounded query-aware excerpts

The [repair contract](../plans/recall-query-excerpts.md) and exact literal-window
policy were written before runtime changes. Independent tests first reproduced
the missing target; the implementation changes only recall-internal labels and
their cursor binding, not model, prompts, candidate membership/order or limits.

A separately frozen ten-case run retained all outcomes. The original six fixtures
were reused unchanged: all six target memories were now selected and recalled.
The target query term was visible in all six navigation inputs. These are
development regressions, not independent accuracy evidence.

Four additional fixtures, not supplied to the implementation worker, used the
same bounded path: middle-position Marigold ownership with four memories;
middle-position Cedar responsibility with sixteen; absent Aster ownership with
four; and absent Quartz ownership with sixteen. The first two recalled the correct
target. Both absent-answer cases returned no memories. The Quartz selector did
select a Juniper memory, but ranking rejected it; this is not perfect selection.
These are small synthetic English literal-overlap checks, not blinded benchmark
results or evidence of synonym, multilingual or long-history quality.

All ten results were structurally successful with complete bounded traversal and
no diagnostic events. No case was retried or replaced. Durations in order were
4,458 / 4,666 / 3,934 / 3,571 / 4,421 / 3,875 / 4,773 / 3,403 / 1,500 / 3,922 ms.
Run completed `2026-09-10T17:35:29.874Z`; frozen-intent SHA-256:
`79a33af55b10d19c7c8be63cafecd1b000b8e90c7232e5d88c9ffcbe44031051`.
The intent records exact runtime and operator hashes before requests; they are
not claims that the already-installed previous artifact contains this repair.

The follow-up added 38 guarded requests, USD0.190 reserved, USD0.008794 known
usage estimates and 19 unknown-cost requests. Cumulative original-ledger values
are now 924 requests / USD9.840 reserved / USD0.793946 known usage estimates /
406 unknown-cost requests / zero unsettled. The original USD20 ceiling is not
refilled. No paid traffic is part of ordinary tests.

## New installed artifact: actual Hermes loop

After the source follow-up, a separately frozen single fresh-profile confirmation
used the new archive, SHA-256
`c3310204f3e3e8351134433318876852666c389012c0d33c846da5350cff0dff`.
Every installed allowlisted source hash matched this worktree before traffic.
Pinned Hermes0.21.1, Node22.16.0 and the same real baseline model performed the
six explicit stages. Primary and an independent reviewer accepted all six:

- A/B: one Tuesday decision; fresh-session recall preserved identity and receipt.
- C/D: a sourced read preceded guarded revision1→2 correction to Friday; the next
  session recalled the updated decision and replacement receipt.
- E/F: current sourced lookup preceded `forgotten:true`; the next session returned
  empty recall and truthfully reported no recorded information.

The separate no-memory control asked for context without guessing or claiming a
completed search. Both reviewers accepted that abstention. This is not a rerun
or reinterpretation of PR44's failed combined batch, which remains unchanged.
No structural diagnostics occurred. One run is not broad reliability evidence.

Completed `2026-09-10T17:40:30.117Z`; frozen-intent SHA-256:
`3550aa00e56d90d753df7a385e1baa88b5b9baaf9a025090a09cc4ea35b704e1`.
It added 33 guarded requests, USD0.840 reserved, USD0.022877 known usage estimates
and nine unknown-cost requests. Latest original-ledger checkpoint: 957 requests,
USD10.680 reserved of USD20, USD0.816823 known usage estimates, 415 unknown-cost
requests and zero unsettled. No release or deployment occurred.
