# Offline Python reference rendering

The public LongMemEval scorer accepts an optional evaluator-only rendering
capability for reference answers that are not strings. This does not run Python
in the public memory core or call a provider. It reproduces the pinned upstream
evaluator's `json.load` → `str(answer)` behavior from the original JSON bytes.
JavaScript's parsed number is never used to reconstruct the reference text.

After `prepareLongMemEval` has made its four-file v2 directory, run the offline
Python 3 utility on the same original source file:

```sh
python3 evaluation/longmemeval/fixtures/render-reference-sidecar.py \
  --source /private/source.json --prepared /private/prepared \
  --output /private/reference-sidecar.json
```

The source must match the prepared manifest's input digest. The utility checks
the evaluator artifact's digest and exact selected case order, then writes a
new, mode-0600 JSON sidecar outside the prepared directory. It will not
overwrite an existing file; its CLI prints only the sidecar SHA-256 and case
count. Keep the sidecar private with the evaluator and independently record and
review its printed SHA-256. Do not copy it into `history.jsonl`,
`questions.jsonl`, or generation/answer-model inputs. The official judge
necessarily receives the rendered reference in its prompt; do not log the
whole sidecar or expose it to any other provider path.

Load with `loadReferenceRenderings({preparedDirectory,sidecarPath,
expectedSidecarSha256})` from `evaluation/longmemeval/reference-rendering.mjs`.
The loader checks the caller-pinned sidecar digest against its bytes and the
source, manifest, evaluator digests and roster against the prepared artifacts.
It does not read or authenticate history/question content; generation must
still use the separate digest-checked prepared-v2 loader. This helper validates
reference bindings, not the entire benchmark input pipeline.
It returns a map of opaque question IDs to in-process capabilities. Pass only
the matching token as `referenceRendering` to `scorePublicComparison`:

```js
const renderings = await loadReferenceRenderings({
  preparedDirectory, sidecarPath, expectedSidecarSha256,
});
const score = await scorePublicComparison({
  run, evaluator, judge,
  referenceRendering: renderings.get(run.questionId),
});
```

The scorer compares the supplied evaluator with the loader's exact saved
snapshot before any judge call. It rejects naked strings, forged tokens, and
tokens for another case. Without a capability, old string-reference behavior
is unchanged; non-string references remain unresolved. Aggregate records
distinguish `verified-python-rendered` from `verified-string` and
`unverified-non-string`.

The renderer supports the prepared format's strings, finite numbers, and
nonempty flat arrays of those scalar types. Python's float conversion and list
`repr` are why values such as `3.0`, `9007199254740993`, and mixed arrays need
the raw bytes. The generator compares evaluator values to the source's
JavaScript-number projection; a different integer that rounds to the same JS
double is not distinguishable in the prepared evaluator. The source digest
and caller-pinned sidecar digest protect the selected bytes against accidental
mixing, but they do not prove that a dataset or arbitrary pinned sidecar is
authentic. A separately verified roster and source provenance remain required.
No corpus, provider key, SDK, or network access is required by this path.
