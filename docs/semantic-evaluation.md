# Synthetic memory evaluation

This evaluation exercises the public memory core with the pinned optional
OpenAI adapter. It is not a competitor benchmark, a representative human study,
or proof of readiness at arbitrary scale. The corpus and acceptance thresholds
are frozen in [the package spec](plans/semantic-evaluation.md) before scored runs.

## What it measures

Twelve cases distinguish captured memories from explicitly admitted recall
fixtures. They cover source attribution, decisions, MOC organization, paraphrase
and distractors, unrelated questions, changed/forgotten memories and namespace
isolation. Each runs in three fresh temporary stores. Exact IDs/revisions/source
bindings are checked automatically. Source entailment, captured-fact mapping
and topic coherence need independent evidence review; pending judgments cannot
be reported as semantic success. Agent review is not human validation.

Missing or failed repetitions remain in expected denominators. A partial run is
incomplete, not passed. Safety violations cannot be averaged away. The report
contains synthetic extracted/recalled content and source evidence for inspection,
but never raw HTTP bodies, environment values, keys or provider error messages.

## Running it

Use Node >=22.16 and install the isolated adapter with `npm ci --prefix
adapters/openai`. Supply only `OPENAI_API_KEY` from your environment or secret
manager, then explicitly authorize a bounded run:

```sh
npm run eval:semantic -- --live --budget-usd 4.80
```

This incurs model charges. It does not load an application `.env`, accept a user
database, or run in CI. The guard reserves cost before each request, including
count requests and failed/unknown outcomes. At most 40 HTTP requests per
repetition are permitted, under one shared sequential-run budget capped at
US$4.80. To retry a suite, subtract previous reservations from the authorization;
starting a new process does not grant a new budget. No automatic retries occur.

Observe both generation-usage estimates and conservative reserved costs; neither
is a provider invoice/account-wide cap. Review current model pricing before any
later run. Timing, process peak RSS and retained SQLite/WAL/SHM bytes are measured
with scope recorded, not extrapolated to other machines, datasets or clients.
Resource acceptance currently requires Linux: peak RSS is the current executable's
`/proc/self/status` VmHWM. Other platforms report unsupported, never a false pass.

Ordinary `npm run test:openai` runs only offline fixture/scorer/guard tests.

An explicitly experimental extraction-only profile can be measured with:

```sh
npm run eval:semantic -- --live --budget-usd 1.40 --extraction-model gpt-5.4-mini-2026-03-17
```

This is a paid command, not an offline check. The current campaign requires a
separate bounded compatibility probe first and one authorized frozen suite;
see [X01–X07](plans/extraction-model-profile.md). No worker executes either.
`runEvaluation` accepts the same `extractionModel` option. Reports include exact
per-method `models`, mark the top-level model as `mixed` for this profile, and
sum integer guard reservation units across all repetitions. Default execution
still uses the old model; old report files and the frozen scorer remain unchanged.

Do not tune the corpus after seeing live results. Record failures, fix the
underlying behavior in a separately scoped change, and rerun the frozen suite
under newly available budget. Real-human benefit remains a later product gate.

## Results

The original baseline completed 25/36 attempts. After the separately reviewed
reference/cold-start fix, the unchanged suite completed 36/36 with recall 45/45,
relevance 45/45, MOC placement 12/12 and passing small-fixture resource limits.
However, independent agent review found **two unsupported extraction claims**;
overall quality acceptance remains **failed**. Relevant retrieval is not proof
that every part of a memory is true to its source.

The subsequent source-faithful prompt change also completed 36/36, with recall
and relevance 45/45, but again produced **two unsupported records** (21 of 23
captured records supported; 22/24 required facts recovered with support).
The mandatory source-support gate still fails: a prompt policy and a passing
minimized probe did not establish reliable extraction.

All three runs and independent labels are retained in the [evidence ledger](plans/semantic-evaluation.md).
The initial RSS measurement was inconclusive; the rerun measures the current
Linux executable (about 163 MiB peak, 4.963-second recall p95). These are small
synthetic fixtures, not a human study, scale benchmark, client certification or
evidence that Cairn outperforms another product.
The third run measured about 170 MiB peak and 4.557-second recall p95.

The fourth run explicitly changed only extraction to the experimental profile.
It completed 36/36 and passed the unchanged gate after independent agent review:
44/45 recall, 44/44 relevance, 25/25 captured records source-supported and 24/24
required capture facts recovered. One cooking retrieval omitted the soup fact;
that miss remains in the denominator. MOC discoverability was 12/12, empty queries
6/6, with zero reported safety violations. Peak RSS was 176254976 bytes, retained
storage 233472 bytes and recall p95 4856 ms. See the [fourth-run evidence and
limits](plans/extraction-model-profile.md#measured-evidence). The default model
remains unchanged and its source-support failure is not superseded by an opt-in
profile's result.
