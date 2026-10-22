# HR-1 harness interfaces and ownership

Companion to the [HR-1 protocol](hybrid-retrieval-hr1.md) (v2.1) and the
[fixture schema](hybrid-retrieval-hr1-fixture-schema.md). Two Codex workers
build the harness in parallel, and the primary integrates. Everything lives under
`evaluation/retrieval-research/` and is Node 22 ESM, matching repo style. Neither
worker reads or writes `evaluation/retrieval-research/fixtures/`; the world
author owns it.

## Ownership

| Path | Owner | Purpose |
| --- | --- | --- |
| `lib/tokenize.mjs` | W4b `hr1_arms` | T1, T1+, Porter stemmer, frozen English stopwords, `wholeRuns` |
| `lib/bm25.mjs`, `lib/fts5-trigram.mjs`, `lib/embed-local.mjs`, `lib/embed-openai.mjs`, `lib/api-ledger.mjs`, `lib/fusion.mjs`, `lib/a0-core.mjs`, `lib/arms.mjs` | W4b | Arms (protocol §5) |
| `run.mjs`, `latency.mjs`, `package.json`, `package-lock.json`, `.gitignore` | W4b | Rankings CLI, timing, isolated deps |
| `lib/fixture.mjs`, `tools/facts-view.mjs`, `tools/split.mjs`, `tools/labels.mjs`, `tools/apply-audit.mjs`, `tools/validate.mjs` | W4a `hr1_tooling` | Fixture pipeline (protocol §4.1) |
| `lib/metrics.mjs`, `lib/stats.mjs`, `score.mjs`, `report.mjs` | W4a | Metrics, statistics, reports (protocol §§6–7) |
| `test/arms-*.test.mjs`, `test/fixtures-arms/` | W4b | Arm tests and toy data |
| `test/tooling-*.test.mjs`, `test/metrics-*.test.mjs`, `test/fixtures-tooling/` | W4a | Tooling and metrics tests and toy data |

W4a may import `lib/tokenize.mjs` but must not edit it. Until it exists, inject
a tokenizer function in its tests. The primary wires the final imports.

## Shared signatures

```js
// lib/tokenize.mjs (W4b)
export const ENGLISH_STOPWORDS;            // frozen Set<string>, committed before the fixture freeze
export function tokenizeT1(text);          // → string[] (protocol §5.2 T1, with duplicates; callers dedupe)
export function tokenizeT1Plus(text);      // → string[] (T1+: Han unigrams + bigrams; Porter-stemmed English)
export function porterStem(word);          // classic Porter (1980)
export function wholeRuns(text);           // → string[] lowercased /[\p{L}\p{N}]+/gu runs (core v2 scorer compatible)

// lib/fixture.mjs (W4a)
export async function loadFixture(dir);    // → { facts, corpus, queries, split, labels, audit, hashes }
// The evaluator-input barrier (protocol §5.1): arms receive only these projections.
export function armDocuments(fixture, { namespace, scale, intent, include });
//   include ∈ 'body' | 'spans' | 'both'
//   → [{ docId, memoryId, kind: 'body'|'span', text }]
//   memoryId is opaque, eligible members only.
export function armQueries(fixture, { split, categories });
//   → [{ queryId, text, intent }]   (no category, facts or labels)
```

## Rankings file (W4b → W4a)

`run.mjs` writes one JSON file per run:

```json
{
  "format": "hr1-rankings-v1",
  "run": {
    "arm": "A1", "config": "BM25-T1", "model": null, "scale": "S1000", "split": "dev",
    "fixtureHashes": {}, "env": {}, "startedAt": "", "finishedAt": "",
    "store": null
  },
  "queries": {
    "q-001": {
      "ranked": ["m-0001"],
      "channels": { "lex": ["m-0001"], "sem": ["m-0002"] },
      "unionSize": 17
    }
  },
  "costs": { "indexBuildMs": 0, "embedDocs": 0, "embedMsPerDoc": 0, "apiTokens": 0, "apiSpendUsd": 0 }
}
```

- `ranked` is at most 24 deduplicated memory IDs.
- `channels` and `unionSize` appear only on fused arms.
- `store` is set only for A0, giving the store index 0–4.
- A0 runs include `pages`, `scannedRows`, `coverage` and `errors` per query.

`latency.mjs` writes `hr1-latency-v1` with request-level samples
(`queryId`, `pass`, `ms`), cold-load times, threads, device and peak RSS.

## Scoring (W4a)

- `score.mjs`: labels + one or more rankings files → `hr1-scores-v1`. It holds
  per-query group recall@12/@24, all-required, best rank of every group,
  hard-negative@12, strata, C8/FOREIGN diagnostics and foreign-leakage failure.
- `report.mjs`: scores → the confirmatory comparisons (§2), cluster-bootstrap
  CIs, McNemar, and exploratory tables, as JSON and Markdown.

## Common rules for both workers

- Run tests with
  `node tools/testing/run.mjs evaluation/retrieval-research/test/<your files>`.
  Use `createTestWorkspace` for scratch. Report actual exit codes.
- There is no network at query time.
- Only W4b installs dependencies, with an exact version in its isolated
  `package.json`.
- Determinism: fixed seeds; stable sort with documented ties.
- Neither worker commits. The primary reviews, integrates and commits.
