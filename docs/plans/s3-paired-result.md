> **Historical archive — PR #247, head `1948fdeec01ccebb876c9e45aece6d21423342ad`.** This preserves the
> original document from that PR for traceability. It is not the current
> protocol, result interpretation, or promotion gate; consult the latest
> [limitations](../limitations.md) and [roadmap](../../ROADMAP.md) where applicable.

# Fixed-30 paired LongMemEval pilot: retained result and next gate

This is the terminal result of one predeclared, paired pilot on the original
reserved 30 LongMemEval-S cleaned cases: five cases from each of six official
question types, in immutable dataset order. Cairn source-backed memory and
native Mem0 OSS 2.2.0 saw the same prepared pre-cutoff conversation history,
question and dataset date. The preparation retained the existing normalization,
redaction and date wrapping; it was not an unmodified byte-for-byte corpus
comparison. Arm order alternated by case, 15 Cairn-first and 15 Mem0-first.
Both arms used `gpt-4.1-mini-2025-04-14` for memory and the common answer step;
the common judge used `gpt-4o-2024-08-06`. No case was dropped, replaced or
retried. The tested evaluation runtime was
`de148532e553c7825a1c3afc9860b6fd5e3863ad`, carried by dependent PRs
[#245](https://github.com/Cairn-ink/cairn-memory/pull/245) and
[#246](https://github.com/Cairn-ink/cairn-memory/pull/246), not the `main`
commit on which this report is based. This result does not imply those PRs
have merged or that this configuration is a released product default.

## Fixed-denominator outcome

| Arm | Judged correct | Judged incorrect | Unresolved | Correct yield, all 30 | Accuracy among resolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairn | 0 | 0 | 30 | 0/30 (0%) | Undefined (0 resolved) |
| Mem0 | 20 | 9 | 1 | 20/30 (66.67%) | 20/29 (68.97%) |

All 30 Cairn generations ended with `ingestion_incomplete`; none reached a
judged answer. Mem0's sole unresolved case ended with `invalid_payload`.
Those outcomes remain unresolved in the fixed denominator. In particular,
the Cairn row is **not** 30 judged-wrong answers and does not measure the
answer model's capacity once ingestion succeeds.

The paired 3×3 table has Cairn **unresolved** against Mem0 correct in 20
cases, incorrect in nine and unresolved in one; every Cairn correct or
incorrect cell is zero. Common resolved cases: **0/30**. The predeclared
scoreability rule required at least 29/30 resolved in each arm and in common,
so it failed. No noninferiority, meaningful-gain or parity inference is
available from this cohort. It is a blocked end-to-end comparison, not a
full-500 leaderboard score or evidence of broad user value.

The post-run reader and fixed statistical adapter were checked against the
persisted generation, scoring and accounting summaries. Their retained
SHA-256 digests are:

| Private artifact type | SHA-256 |
| --- | --- |
| Generation report | `5aec19a3cbfc349c77a3ee923e2c1d20f6956448f7f6a2a9b464d4059340a4b4` |
| Scoring report | `3fe76a4d6e5ac177f6cb33c997a7f20a4d878e10b505961b296097e365a87190` |
| Accounting report | `9b9a6ca0cc7e2b26a85e93559e7b46ae9e30a3f3dacd997c83223715fc660c44` |

The hashes identify retained private evidence; the reports, questions,
answers, evaluator references, credentials and private paths are not published
here.

## Resource record

The shared US$200 ledger retained the previous 12,730 rows.
The pilot added 4,698 requests and reserved 26,872,070 micro-USD. The audited
cumulative reservation was 113,627,281 micro-USD (US$113.627281), leaving
86,372,719 micro-USD under the US$200 ceiling, with zero pending attempts.
For 4,579 new rows, reported usage sums to US$8.121573; 119 count calls
have unknown actual cost. Reservation is a conservative ledger commitment,
and reported usage is not a measured invoice. Neither number establishes a
cost or efficiency advantage over Mem0.

## Separate installed-host evidence

A later installed S4 check completed 1,025 synthetic admissions and 42
fake-HTTP requests with zero provider calls and a clean exit. An earlier
17-minute timeout remains unexplained. The later pass neither diagnoses that
timeout nor fixes this pilot's ingestion failure; it is not a complete
installed-host/growth gate. Cold onboarding remains a separate gate.

## Next failure-localization plan

1. Preserve this terminal 30-case result and its denominators. Do not replay,
   replace or selectively score these cases.
2. Reproduce `ingestion_incomplete` offline with a minimal synthetic history
   through the same capture and admission path. The observed earliest break
   was inside capture, before `finishAdmission`; the underlying error code was
   not retained, so this is not yet a root-cause finding. Add bounded,
   sanitized stage visibility sufficient to identify the failing boundary
   without exposing source text or private IDs.
3. Fix only the defect established by that reproduction. Add a regression at
   the failing boundary and exercise the end-to-end synthetic path; obtain
   independent Standards and Spec reviews of the fixed implementation.
4. Before another benchmark, freeze a fresh real-model canary design and its
   success, failure, cost and stop rules in advance. Verify that the proposed
   calls fit the existing authorization and remaining ledger headroom before
   launch; this plan itself authorizes no calls. A successful canary would
   establish only that the repaired path executes under those conditions; a
   new held-out comparison would need its own prospective method and cohort.
5. Continue installed-host/growth and cold-onboarding acceptance as distinct
   product gates. Neither a semantic score nor one later clean S4 exit closes
   them by itself.

This document authorizes no new paid launch, code change, merge or release.
