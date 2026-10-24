# HR-2b v1.1 W1 seed-advance report

Protocol v1.1, frozen at d3a6e24f. Candidate in use: **1**, seed **500613191**, mulberry32; structural stage 1 **pass**. New-candidate identity comparisons are inapplicable and were not run. No W2/W3 products, retained validator contents, tests, retrieval/assembly runs, network or commits were used.

Actual exits for every candidate attempted in this advance round, ordered as build-world.mjs / build-world.mjs --check / check-world.mjs:

| Candidate | Seed | Exits | Stage 1 | Diagnostics |
| --- | ---: | --- | --- | --- |
| 1 | 500613191 | 0/0/0 | pass | none |

The frozen sequence was followed from candidate 1 and stopped at its first stage-1 pass. Later candidates are unattempted. The selected command exits are 0/0/0.

There are 90 families (40 target/40 distractor/10 foreign), 1020 facts and 540 memories. Target facts: 280 rendered/40 absent; distractors: 600 rendered/40 absent; foreign: 60 rendered, including 20 near-duplicates. All 540 bodies are assistant notes; receipt roles are 908 user/523 assistant.

| Scale | Memories | zh/en/mixed | Receipts 1/2/3/4 | Placement body/first/later | Body bands | Receipt bands | Mean body/receipt tokens |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| S300 | 160 | 88/48/24 | 32/40/40/48 | 126/70/84 | 48/64/48 | 148/170/106 | 216.85/92.5731 |
| S1000-extra | 320 | 176/96/48 | 64/80/80/96 | 270/150/180 | 96/128/96 | 297/339/212 | 218.9188/92.7653 |
| foreign | 60 | 33/18/9 | 12/15/15/18 | 27/15/18 | 18/24/18 | 56/63/40 | 219.05/92.1321 |

Every scale realizes receipt-count shares **20/25/25/30%** and distinct-fact placement shares **45/25/30%**, exactly matching their targets. Language shares per scale are 55/30/15%; overall counts 297/162/81. Body bands: [120,180), [180,260), [260,400]; receipt bands: [40,70), [70,130), [130,200]. Counter: tiktoken@1.0.22, o200k_base. Distractors remain 160 hand/160 template.

| Domain | Target memories | Distractors | Foreign |
| --- | ---: | ---: | ---: |
| engineering | 40 | 80 | 12 |
| work-preferences | 28 | 56 | 12 |
| operations | 28 | 56 | 12 |
| finance | 32 | 64 | 12 |
| product | 24 | 48 | 6 |
| everyday | 8 | 16 | 6 |

Filler disclosure: 1080 complete bank sentences, 3676 UTF-16 ranges across 1971 units; 18297 per-fact terms scanned with 0 hits. Exact HR-1 statement overlaps and unannotated exact facts: 0/0. Independent annotation totals: 1340/1340. Full measurements, evidence ranges and per-attempt diagnostics remain in build/world-stats.json.

Declared decisions: the seven generator files, including four-bin config, are byte-identical to HEAD; only the authorized candidate index changed. Families, factual sources, filler, lexicon, seed sequence and band logic were not edited. Facts-view coverage and placement can differ for a new candidate. Four target episodes express three facts each across body/receipts; decision/reason and primary/nearby assignments stay separated. Body-only support uses span:null; topical anchors remain separately disclosed.

Preserved history: v1 candidate 0 stage-2 rejection (quota failures and admission cap); v1.1 candidate 0 duplicate normalized body m-9e1321fab528a943, identity failure and coordinator rejection. References point to build/candidate0-v1-validation/ and build/candidate0-v11-identity/; neither directory was traversed or modified. Earlier development diagnostics are retained.

W1 stage 1 is complete. Stage-2 quotas and W3 semantic re-audit remain pending with their owners.

Owned inventory: 15 files, filesystem/Git diff empty. Changed files: **6**, independently derived from Git diff plus untracked paths and filesystem bytes versus HEAD blobs; diff {"gitOnly":[],"byteComparisonOnly":[]}; Git exits 0. Whitespace checks cover all owned files, including untracked files.

- `README.md`
- `W1-REPORT.md`
- `build/check-world.mjs`
- `build/world-stats.json`
- `hr1-corpus.json`
- `hr1-facts.json`
