# HR-2b v1.1 W1 rebuild report

Protocol v1.1, frozen at d3a6e24f; restart candidate 0, seed 1924440465, mulberry32. STOP: the required identity check failed; no seed was advanced and the generator was not changed further. No tests, prohibited products, retained validator contents, retrieval/assembly runs, network or commits were used.

Actual exits: build-world.mjs **0**; build-world.mjs --check **0**; check-world.mjs **1**. Structural checks: fail; identity: fail.

Structural diagnostics: memory:duplicate_normalized_body (m-9e1321fab528a943). The failed structural result cannot be recorded as a stage-1 pass.

Identity helper output (also printed by the checker):

```json
{"ok":false,"baselineCommit":"d3a6e24f15cda63504135cfa55dded02f41a9760","differingFields":["generation.placementAllocation"],"factsByteIdentical":true,"factCount":1020,"familyCount":90,"placementFacts":940,"placementDifferencesByRole":{"target":0,"distractor":381,"foreign":34}}
```

Fact categories mean kind/state metadata; no query categories were read. The helper also checks every fact field, the lexicon, fact-to-memory plan, six unchanged generator sources and config excluding RECEIPT_COUNTS against HEAD.

There are 90 families (40 target, 40 distractor, 10 foreign), 1020 facts and 540 memories. Target facts: 280 rendered plus 40 absent; distractors: 600 rendered plus 40 absent; foreign: 60 rendered, including 20 near-duplicates and 10 unique custody anchors. All bodies are assistant notes. Receipt roles total user 912, assistant 519.

| Scale | Memories | zh/en/mixed | Receipt user/assistant | Receipts 1/2/3/4 | Body bands | Receipt bands | Mean body/receipt tokens |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| S300 | 160 | 88/48/24 | 278/146 | 32/40/40/48 | 48/64/48 | 148/170/106 | 216.775/93.0613 |
| S1000-extra | 320 | 176/96/48 | 531/317 | 64/80/80/96 | 96/128/96 | 297/339/212 | 218.7813/92.3597 |
| foreign | 60 | 33/18/9 | 103/56 | 12/15/15/18 | 18/24/18 | 56/63/40 | 219.35/92.4843 |

Receipt-count shares per scale are S300: 20/25/25/30%; S1000-extra: 20/25/25/30%; foreign: 20/25/25/30%, against **20/25/25/30%**. Body bands: [120,180), [180,260), [260,400]; receipt bands: [40,70), [70,130), [130,200]. Counter: tiktoken@1.0.22, o200k_base. Overall languages: 297/162/81. Distractors: 160 hand/160 template.

| Domain | Target memories | Distractors | Foreign |
| --- | ---: | ---: | ---: |
| engineering | 40 | 80 | 12 |
| work-preferences | 28 | 56 | 12 |
| operations | 28 | 56 | 12 |
| finance | 32 | 64 | 12 |
| product | 24 | 48 | 6 |
| everyday | 8 | 16 | 6 |

Distinct-fact placements (body/first/later): targets 126/70/84 ({"body":0.45,"first-receipt":0.25,"later-receipt":0.3}); distractors 270/150/180 ({"body":0.45,"first-receipt":0.25,"later-receipt":0.3}). Full allocations, exact measurements and evidence ranges are retained in build/world-stats.json.

Filler disclosure: 1080 complete bank sentences, 3683 UTF-16 ranges across 1971 units; 18297 per-fact terms scanned, 0 hits. HR-1 exact-statement overlaps: 0; exact unannotated facts: 0. Annotation totals independently agree (1340 forward/1340 reverse).

Declared decisions: only RECEIPT_COUNTS changed in the generator. Families, factual sources, filler banks, seed sequence and band logic were preserved. Four target episodes still express three facts each across body/receipts, with separate decision/reason and primary/nearby assignment notes. Body-only support uses span:null; entity-bearing topical anchors remain separately disclosed. All earlier development diagnostics were preserved.

History in build/world-stats.json records v1 candidate 0 as stage2 rejected, pointing at build/candidate0-v1-validation/ and preserving the supplied coordinator diagnostics verbatim; v1.1 restarts candidate 0 with structural stage1 fail, stage2 pending-coordinator and the identity result. The retained directory was never traversed or modified.

Could not deliver all three exits as zero or certify unchanged placement: fewer target receipt draws shift the shared random stream before distractor/foreign placement allocation. No corrective generator edit or seed advance was attempted. Coordinator resolution is required.

Owned inventory: 15 files, filesystem/Git diff empty. Changed files: **7**, independently derived from Git diff plus untracked paths and filesystem bytes versus HEAD blobs; diff {"gitOnly":[],"byteComparisonOnly":[]}; Git exits 0. Whitespace checks cover all owned files, including untracked files.

- `README.md`
- `W1-REPORT.md`
- `build/check-identity.mjs`
- `build/check-world.mjs`
- `build/config.mjs`
- `build/world-stats.json`
- `hr1-corpus.json`
