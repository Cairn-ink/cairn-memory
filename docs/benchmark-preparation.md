# LongMemEval-S preparation, without model calls

This tool prepares a reproducible, answer-blind **pilot input** from a local
LongMemEval-S cleaned JSON file. It does not ingest memories, call a provider,
score answers, run Hermes or establish benchmark/human success. The independent
product-value track exercises first-use readiness while this track builds
measurement infrastructure.

## Supply a reviewed snapshot

Consult the [official format](https://github.com/xiaowu0162/LongMemEval#-dataset-format)
and [cleaned dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).
Review the dataset's license and provenance, pin its upstream revision, and
independently record the file's SHA-256. This repository does not redistribute
or automatically download the dataset. The CLI records declared provenance and
checks content integrity; it cannot establish upstream authenticity or decide
whether your intended use is licensed.

The `oracle` variant includes only evidence sessions and is not a substitute
for full S history. `--variant s-cleaned` is a declaration, not detection: a
matching self-supplied hash cannot prove that you downloaded the right variant.
Do not label an oracle run, shortened history or hand-picked sample as a full
LongMemEval-S benchmark. Dates/order are preserved verbatim, not inferred or
reordered. Unknown fields are stripped rather than treated as extra memory.

## Prepare an explicit pilot

Use Node >=22.16 from the source repository. Substitute the actual verified
digest, revision and question IDs. Choose a new output directory beneath an
existing real nonsymlink parent you control:

```sh
npm run prepare:longmemeval -- \
  --input /absolute/datasets/longmemeval_s_cleaned.json \
  --sha256 VERIFIED_64_HEX_SHA256 \
  --revision VERIFIED_UPSTREAM_REVISION \
  --variant s-cleaned \
  --question-id ORIGINAL_QUESTION_ID_1 \
  --question-id ORIGINAL_QUESTION_ID_2 \
  --output /absolute/existing-parent/cairn-lme-pilot
```

Selection is explicit and is emitted in original dataset order, independent of
flag ordering. Validate a fixed stratified list covering question types and
abstention before live runs. This command does not choose a representative
sample for you; every preparation is labeled `pilot`, even if you select all
instances. The entire input is validated, including unselected instances.
Digest mismatch, malformed input and invalid selection fail before output.

The input is limited to 512 MiB before reading. This is a file-size bound, not
a peak-RAM guarantee: JSON parsing and output construction allocate memory too.
Do not mutate the input or output ancestors while preparation runs. Existing
outputs, symlink parents and unsafe paths are rejected; partial outputs from
I/O failures are retained, never silently overwritten or removed. Correct the
cause and select another new directory. Nothing edits the input file.

## Keep model inputs and evaluator data separate

| File | Allowed consumer | Contents |
| --- | --- | --- |
| `history.jsonl` | Future ingestion runner | Opaque case ID, original session IDs/dates, zero-based session occurrence index, stable turn IDs, roles and source content |
| `questions.jsonl` | Future query runner | Opaque case ID, question text and date |
| `evaluator.jsonl` | Evaluator only | Original/opaque ID mapping, question type, reference answer, evidence sessions and turn labels |
| `manifest.json` | Operator/evaluator only | Revision/digest, selected original IDs, sizes, artifact hashes and compatibility blockers |

LongMemEval source IDs can end in `_abs`, exposing an abstention label. Model
inputs therefore use deterministic hashed case IDs; original IDs stay in the
evaluator and manifest. `has_answer`, reference answers, question types, supplied
summaries and arbitrary extra fields never get copied into model input records.
Correct answer text may naturally exist in the original conversation; preserving
that source evidence is required, not annotation leakage. Hashing metadata does
not address possible model training contamination on a public benchmark.

Some official S cases repeat a source session ID with identical session bodies
but different dates. Each occurrence is retained in source order with its own
`session_index`; turn IDs include that index so separate occurrences never
collapse. Duplicate occurrence counts are recorded. Conflicting bodies under a
repeated ID, or an evidence session ID matching multiple occurrences, are
rejected rather than silently deduplicated or disambiguated.

All generated files are private (0600), in a private directory (0700). The CLI
summary exposes counts and hashes, not content, original IDs or local paths.
The file separation is **not** an OS sandbox: future model runners must only
receive history/questions, never the output directory wholesale. Do not load
the evaluator or manifest into an agent workspace/context. Source histories may
still contain personal content; private file modes do not make them publishable.

The manifest reports UTF-16 character counts, UTF-8 byte counts and source turns
over the core's 4,000-character per-message boundary, with no silent truncation.
These are conservative raw-source measurements, not exact post-normalization
admission failures, token counts or cost estimates. No core limit is raised. A compatible
ingestion adapter must still handle full sessions, the per-call message/total
size bounds, source mappings and model token constraints. A preparation success
can therefore coexist with ingestion blockers; it does not mean ready to run.

## Verification and next gate

```sh
npm run test:longmemeval
```

Tests use original synthetic fixtures, not upstream data or credentials. They
check field allowlists and annotation poisoning, abstention, Unicode, malformed
input, explicit selection, stable source identities, hashes and filesystem
boundaries. They cannot establish compatibility with a downloaded upstream
snapshot until a separately reviewed snapshot is exercised. The initial
[verification record](plans/benchmark-preparation.md#verification-record)
pins a real S snapshot, validates all 500 instances and checks a seven-case
preparation on both runtimes. That is format compatibility, not memory quality
or a scored benchmark; ingestion blockers remain visible.

Next build ingestion/source-map and scorer adapters. Freeze development versus
held-out cases before tuning. Report evidence retrieval separately from final
QA correctness, with the exact answerer model, answer prompt, context budget and
judge configuration pinned across Cairn, simple retrieval and no-memory controls.
Analyze programmatic capture separately from explicit MCP memory admission;
success in one route does not establish the other. Reliability failures (isolation, forgetting,
incorrect source binding) must not disappear inside a high average QA score.
Preserve missing/failed attempts in denominators and publish limitations.

Only after a new budget is approved: estimate capture/classification, recall,
answerer and judge costs, including preflight counts/failures, then execute the
fixed live pilot. A full evaluation and real-model client task remain separate
gates. HaluMem, model promotion, private provider/billing integration, public
release and claims of superiority are outside this preparation slice.
