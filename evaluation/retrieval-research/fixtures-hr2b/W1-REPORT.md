# HR-2b v1.1 W1 second seed-advance report

Protocol v1.1 (d3a6e24f). Chosen candidate **3**, seed **3023009795**, mulberry32; stage 1 **pass**. No generator edits, identity gate, W2/W3 products, retained validator contents, tests, retrieval/assembly runs, network or commits.

Actual exits this round: build-world.mjs / build-world.mjs --check / check-world.mjs.

| Candidate | Seed | Exits | Stage 1 | Diagnostics |
| --- | ---: | --- | --- | --- |
| 2 | 2352062053 | 0/0/1 | fail | memory:duplicate_normalized_body:m-8dd15190c519f600 |
| 3 | 3023009795 | 0/0/0 | pass | none |

The frozen sequence started at candidate 2 and stopped at its first stage-1 pass. Later candidates are unattempted. Selected exits: **0/0/0**.

World: 90 families (40 target/40 distractor/10 foreign), 1020 facts, 540 assistant-note bodies; receipt roles 905 user/526 assistant.

| Scale | Memories | zh/en/mixed | Receipts 1/2/3/4 | Placement body/first/later | Body bands | Receipt bands | Mean body/receipt tokens | Domains E/W/O/F/P/D |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| S300 | 160 | 88/48/24 | 32/40/40/48 | 126/70/84 | 48/64/48 | 148/170/106 | 216.7813/92.8656 | 40/28/28/32/24/8 |
| S1000-extra | 320 | 176/96/48 | 64/80/80/96 | 270/150/180 | 96/128/96 | 297/339/212 | 218.6031/92.4682 | 80/56/56/64/48/16 |
| foreign | 60 | 33/18/9 | 12/15/15/18 | 27/15/18 | 18/24/18 | 56/63/40 | 218.9333/92.5031 | 12/12/12/12/6/6 |

Every scale exactly matches receipt-count targets **20/25/25/30%** and distinct-fact placement targets **45/25/30%**. Languages: 55/30/15%; total 297/162/81. Body bands: [120,180), [180,260), [260,400]; receipt bands: [40,70), [70,130), [130,200]. Counter: tiktoken@1.0.22, o200k_base. Domains E/W/O/F/P/D: engineering/work-preferences/operations/finance/product/everyday. Distractors: 160 hand/160 template.

Filler: 1080 bank sentences, 3683 UTF-16 ranges across 1971 units; 18297 per-fact terms scanned, 0 hits. HR-1 exact-statement overlaps/unannotated exact facts: 0/0. Independent annotation totals: 1340/1340. Detailed measurements and diagnostics are in build/world-stats.json.

Decisions: all seven generator files, including four-bin config, are byte-identical to HEAD. Only the authorized candidate index changed; no sentence tuning or structural-check relaxation. Decision/reason and primary/nearby assignments stay separated. Body-only support uses span:null; topical anchors remain disclosed.

History preserves both candidate-0 rejections, candidate 1's stage-1 pass/stage-2 rejection (test:first-receipt:groups_minimum_30, 20 groups/12 families), and this round's attempts. Supplied diagnostics are verbatim in world-stats.json, referencing build/candidate1-v11-validation/. All three retained directories and earlier development diagnostics remain untouched.

W1 stage 1 is complete; stage-2 quotas and W3 re-audit remain pending with their owners.

Inventory: 15 owned files, filesystem/Git diff empty. **6 changed files**, independently derived from Git diff/untracked paths and filesystem bytes versus HEAD blobs; diff {"gitOnly":[],"byteComparisonOnly":[]}, Git exits 0. All owned files pass whitespace checks.

- `README.md`
- `W1-REPORT.md`
- `build/check-world.mjs`
- `build/world-stats.json`
- `hr1-corpus.json`
- `hr1-facts.json`
