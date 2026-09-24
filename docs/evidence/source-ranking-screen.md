# Public source-ranking screen

This record covers a completed 12-case public synthetic ranking screen and a
separate 30-case launch that stopped before any API request. The completed
screen showed exact equality between its frozen baseline and candidate. It did
**not** show an improvement.

## Frozen screen

The reviewed runtime is commit
[`ca9c15c68e4078e8478877bece44d6e83f6a2ad1`](https://github.com/Cairn-ink/cairn-memory/commit/ca9c15c68e4078e8478877bece44d6e83f6a2ad1)
from [PR #203](https://github.com/Cairn-ink/cairn-memory/pull/203). It is a
reviewed candidate, not code copied into this documentation branch or a claim
that the runtime has merged or shipped. The fixture checkout used local candidate
`1174206acda370e184984a280f03b6751f7ae414`; that local commit is not published.
The byte-identical [public cases](https://github.com/Cairn-ink/cairn-memory/blob/ca9c15c68e4078e8478877bece44d6e83f6a2ad1/evaluation/architecture/source-coverage-cases.json)
and [rubric](https://github.com/Cairn-ink/cairn-memory/blob/ca9c15c68e4078e8478877bece44d6e83f6a2ad1/evaluation/architecture/source-coverage-rubric.json)
are available at the reviewed runtime commit; their hashes are checked below.

| Frozen item | SHA-256 |
| --- | --- |
| Baseline configuration | `e08ced39cfe8873be5b03fc473d52acbf9ff6682c0741c2a5514df1ce3dc63db` |
| Candidate configuration | `c9cb1fbf0bee20a0e8568d405cc3ac9fb81ceb65926f47389ad13975d96326da` |
| Public fixture | `d51fda299c7795049e6926ded0083889dbaa849c6b8ace0bae6a15d2a5a0121e` |
| Evaluator-only rubric | `f04721dfd198e82fe3b03b811cc52538e57a72dbc0dc59283b096ee15a8b1bca` |
| Completed result | `b6afa9189606ad51733dd7f2867c299976b1b78805860bc8ffc9b1887d9032d4` |

The 12 cases produced 24 arms. Each arm used the real core
`callModel(rank)` seam through the guarded OpenAI adapter and pinned
`gpt-4.1-mini-2025-04-14`. Each rank operation made one count request and one
generation request: 48 requests total. Cases at zero-based even indices ran
baseline first, beginning with index 0; zero-based odd indices ran candidate
first, beginning with index 1. Schemas and bounds were unchanged.

The rubric was never supplied to the model. There were no answer-generation or
judge calls, no retry and no outcome-driven replacement.

## Result

| Arm | Cases completed | Failed | Unknown | Not run | Required groups | Irrelevant | Redundant |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 12/12 | 0 | 0 | 0 | 23/23 | 0 | 0 |
| Candidate | 12/12 | 0 | 0 | 0 | 23/23 | 0 | 0 |

All 24 arms completed. The candidate retained exactly the same required groups
as the baseline, with the same zero irrelevant and zero redundant selections.
The predeclared screen allowed equality to pass its provisional-benchmark gate,
so the candidate qualified only for that next evaluation stage. Equality is not
an improvement, an accuracy score, or evidence of more reliable answers.

## Accounting checkpoint

The screen added 48 requests and reserved 240,000 micro-USD. Known reported
actual usage was 9,068 micro-USD. All 24 successful count calls retained null
actual cost, so their conservative reservations remain consumed; they are not
free calls. Reported usage is not a provider-invoice audit.

The ordered 6,051-row prior ledger prefix and 55 prior controls were verified
unchanged. The resulting cumulative checkpoint is 6,099 requests and
48,635,560 micro-USD reserved under the 100,000,000-micro-USD cumulative
ceiling. The screen did not reset, refund or rewrite prior evidence.

## Original 30-case launch did not run

A fresh LongMemEval cohort was frozen with 30 cases, balanced at five cases for
each of six question types. It was drawn from 36 selected candidates after
excluding the prior 46 slots. Its launch envelope was capped at 6,236 requests
and 35,789,800 micro-USD reserved.

The launch exited with `unsafe_output` before any API request. Independent
offline reproduction through the actual public CLI confirmed an
operator/output-setup bug: the caller's preflight omitted a parent-directory
check, then the non-recursive private-output directory creation encountered the
missing parent.
A synthetic prepared input, synthetic ledger and fake HTTP reproduced exit 1,
the exact error, zero HTTP requests, unchanged ledger state and the missing
parent/output condition on Node 22. This is not a model or product-memory quality
failure.

In that first attempt, there were zero API calls, zero new reservations and no
ledger-hash change. The launch marker, cap and consumed claim state remain
preserved. All 30 cases were `not_run`; that attempt had no score. The retained
private launch metadata has
SHA-256 `424f1dc0ba214b758b209e03437db9b261ababd8737f289724d7ef67606f743e`.
That digest identifies retained bytes without publishing them or proving the
cause of failure.

At the time of this original screen record, a zero-call relaunch exception had
been requested and awaited authorization. The later decision and execution are
recorded below.

The subsequent private preflight correction checks the existing real `0700`
output parent before importing the original wrapper, consuming a marker or
reading a key. The primary reran all 20 combined wrapper tests on Node 22.16.0
and 24.15.0; both passed. An independent non-author review passed, including
the actual CLI's missing-parent failure and valid-parent fake-HTTP completion.
This is offline operator verification, not a paid rerun or memory-quality result.

## Trust limits and next gate

This screen measures source-group selection on authored public synthetic cases.
It has no model answers or judge verdicts, and therefore establishes no answer
quality, LongMemEval score, full-benchmark result, real-user benefit, competitor
comparison, promotion readiness or runtime-default decision. Required-group
coverage is rubric-relative; it does not authenticate truth or corpus
provenance. Hashes establish checked byte identity only.

At the time of this original screen record, the next gate was an explicit
decision on a zero-request launch exception. On 2026-09-24, the user authorized
exactly one such startup exception for the same frozen 30 unattempted cases,
preserving the original failed marker, cap and claim state. It used the
existing shared cumulative US$100 ceiling, not a new US$100 allowance. The
execution completed at 10:48:56 UTC. Its live wrapper exited 1 with
`postrun_accounting_anomaly`; the separate private-artifact auditor v4 exited 0
with `cohort_audit_ok` and emitted redacted aggregates. The wrapper did not
exit cleanly. See the [audited 30-case reliability result](reliability-cohort-30.md).
This update does not revise the 12-case source-ranking screen or the prior
six-case result, authorize another launch, or establish a broader quality
outcome.
