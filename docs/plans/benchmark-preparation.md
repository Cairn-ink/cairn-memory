# Benchmark preparation: offline, answer-blind LongMemEval input

Base: `d6cdf36107641f990a04c7c54aeac64d1cda8db6`.
This is the evidence track of the paired product-value/reliability effort.
It prepares reproducible inputs, not a benchmark score, model run or runtime
engine change. Product onboarding proceeds separately from the same base.

## Acceptance B01–B08

- B01: Support the official cleaned LongMemEval-S JSON array shape, with a local
  user-supplied input file and mandatory expected SHA-256 and dataset revision.
  No automatic download, network access, environment credentials or paid calls.
  Reject digest mismatch and malformed input before creating output. A pilot
  selection is an explicit list of question IDs, never an implicit first-N slice;
  reject duplicate or unknown selected IDs. Preserve source instance order.
- B02: Create separate history, question and evaluator artifacts. History keeps
  only an opaque deterministic question ID, original session IDs/dates plus a
  zero-based session occurrence index, and turn
  role/content plus stable turn IDs. Question artifacts keep only that opaque
  question ID/text/date. The source question ID can expose the `_abs` abstention
  label: map it only in evaluator/manifest, never model-facing artifacts. Evaluator data
  alone keeps question type, reference answer, answer-session IDs and has_answer
  labels. No annotations, supplied summaries or unknown input fields may cross
  into model-facing artifacts. Answers can naturally appear in source dialogue;
  the prohibited leakage is copying evaluation annotations into that dialogue.
- B03: Validate required nonempty identifiers/dates, aligned session arrays,
  unique question IDs, user/assistant role, string content, boolean
  has_answer when present and reference session IDs belonging to that instance.
  Abstention cases may have empty evidence lists. The pinned official S snapshot
  repeats session IDs with identical session bodies and different dates: retain
  each occurrence and include its index in stable turn identities. Reject
  conflicting bodies for one source session ID and reject an evidence ID that
  maps to multiple occurrences rather than guessing its source. Record duplicate
  occurrence counts. Retain dates verbatim and
  preserve ordering; do not silently infer chronology, truncate turns, collapse
  speakers, relabel oracle data as S or drop malformed/unselected instances.
  Dataset identity is declared provenance, not proof of upstream authenticity.
- B04: Record schema version, declared dataset revision/variant, input digest,
  selected IDs/counts and exact output digests in a manifest. Label selected
  subsets as pilots, not official full scores. CLI summary contains counts and
  digests only, not raw content, answers, local paths or provider secrets.
  Require declared variant `s-cleaned`; document that oracle input cannot be
  certified by its shape/hash without separately verifying the upstream source.
- B05: Output only to a new directory under an existing real nonsymlink parent;
  reject overwrite, symlink ancestors and unsafe paths. Private directory/file
  permissions. Explicit input size bound before reading, no in-place input edit,
  no cleanup of pre-existing or partial artifacts. Inspectors/model runners must
  not receive evaluator.jsonl or manifest.json (which contains source question
  IDs); this filesystem split is not an OS sandbox.
- B06: Expose actual input sizes and capture compatibility blockers (turns over
  the core's 4,000-character per-message limit) without silently truncating or
  claiming token counts/costs. This slice does not ingest data into core, batch
  capture calls, select a new model, change core limits or implement scoring.
  Future ingestion must preserve all history and separately verify source maps.
- B07: Offline synthetic tests prove source/question/evaluator separation,
  poisoning via unknown fields is stripped, invalid input and digest mismatch
  leave no output, explicit selection reproducibility, abstention, Unicode,
  stable source IDs, output hashes, permissions and non-overwrite. Wire tests
  into CI on Node 22.16 and 24; run repository contributor gates. Include
  sensitivity assertions: forbidden annotations in model-facing output fail.
- B08: Document the exact command, source and license verification prerequisite,
  artifact privacy, annotation boundaries and remaining full evaluation gates.
  Compare retrieval evidence and answer correctness separately; pin answerer,
  prompt/context budget and judge for future comparisons. Preserve failures and
  denominators, and separate programmatic capture from explicit MCP admission.
  Do not bundle upstream data, claim HaluMem usage or claim human benefit.

## Sources and next gate

Official format: https://github.com/xiaowu0162/LongMemEval (README dataset format).
Cleaned data: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned.
Pin an actual upstream revision and digest and review its dataset license before
using a downloaded corpus. HaluMem's license requires separate review and is not
part of this implementation. No new paid budget is authorized by this plan.

Next: ingestion and evidence scoring adapters, reliability regression cases,
then a budget-estimated live pilot and separately authorized full run. This
preparation slice must never be described as running LongMemEval successfully.

## Verification record

The primary reviewed the official cleaned dataset card and upstream MIT license
before downloading S into a private temporary directory. No source data or
generated corpus is committed. The pinned upstream snapshot is
`98d7416c24c778c2fee6e6f3006e7a073259d48f`; file
`longmemeval_s_cleaned.json` is 277,383,467 bytes with SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
The primary independently matched digest and size to the snapshot's Hugging Face
LFS metadata, rather than trusting a locally supplied declaration.

Full-source read-only inspection found 500 instances and 246,750 turn
occurrences. There are 717 raw turn occurrences over 4,000 UTF-16 units, with
a maximum of 76,560; these are conservative source-size measurements, not
post-normalization admission failures or token budgets. The initial synthetic
suite passed but actual-source preparation rejected duplicate session IDs.
Investigation found 13 instances with one repeated ID each, identical bodies
and different dates; none of those IDs is referenced as answer evidence.
The primary approved the explicit occurrence identity in B02/B03 to preserve
all source material, with synthetic regressions instead of silently dropping
or repairing official records.

Before any model run, the fixed format-compatibility subset selected the first
source-order case in each question-type stratum, with abstention as a separate
overlay: `e47becba`, `0862e8bf_abs`, `0a995998`, `8a2466db`,
`gpt4_59149c77`, `6a1eabeb`, `7161e7e2`. This seven-case subset is not a
representative performance sample or a successful live pilot.

After the correction, the primary ran the following command in a sanitized
environment (only the selected runtime's executable path), separately under
Node 22.16.0 and 24.20.0, with new output directories `prepared-node22` and
`prepared-node24` respectively:

```sh
node evaluation/longmemeval/cli.mjs \
  --input /tmp/cairn-lme-source-5OxIfC/longmemeval_s_cleaned.json \
  --sha256 d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442 \
  --revision 98d7416c24c778c2fee6e6f3006e7a073259d48f \
  --variant s-cleaned \
  --question-id e47becba --question-id 0862e8bf_abs \
  --question-id 0a995998 --question-id 8a2466db \
  --question-id gpt4_59149c77 --question-id 6a1eabeb \
  --question-id 7161e7e2 \
  --output /tmp/cairn-lme-source-5OxIfC/prepared-node22
```

Both commands exited 0: all 500 source instances validated; the selected seven
cases preserve 335 sessions and 3,512 turns, with 11 raw oversized turns. All
four output files are byte-identical across runtimes. The primary independently
compared every selected role/content/date, question, answer/evidence mapping
and turn label against the source, checked model-facing field allowlists,
unique turn IDs, artifact digests/counts and 0700/0600 permissions. No data was
sent to any model. The seven-case output has no duplicated source session ID;
full-source validation/counting exercises the 13 duplicates, while synthetic
tests directly verify their selected-output identities and rejection cases.

| Artifact | SHA-256 |
| --- | --- |
| history | `02ef9286e77df82fa92919fc26da9cacc69a489dec66a650b03828a62db0e44f` |
| questions | `c730ecccb02c933b116c37eb798aca28de3aa1bcf9c548b4cd13e28f964e746a` |
| evaluator | `e91e20ed8d19c0114c20f06676b66711b5f0ad317dc52f4c5c39f349826960ac` |
| manifest | `84bccc5726c910c8d99e81bdbcbc98d9fc6447df0bf011dd139fea1dfc00c6f8` |

The worker and primary each ran all 15 synthetic preparation tests on Node
22.16 and 24 successfully. Plugin tests passed 31/31 and JSON/version validation
passed on both runtimes. The primary also ran the pinned Claude 2.1.260
marketplace validator and strict plugin validator: both passed. No production
database, user profile, model credential, publishing or paid run was involved.

Delegation: a fresh Sol high worker owns preparation code/tests/CI/package
commands; the primary owns acceptance, documentation, architecture corrections
and actual-source verification. Primary interventions include opaque question
IDs to avoid `_abs` label leakage, fatal UTF-8 decoding, bounded regular-file
reads, safe CLI import, raw-size caveats and explicit duplicate occurrences.
Independent Standards and Spec reviewers must both examine the frozen candidate
before push. Agent token costs and total elapsed times are not measured here;
no paid model calls are made by this preparation or verification workflow.
