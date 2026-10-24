# HR-2b W1 delivery report

Synthetic stage-1 world; candidate 0, seed 1924440465, mulberry32. Stage 2 quota validation and W3 semantic audit remain pending. No queries, labels, retrieval, rankings, assembly runs, network access or commits were used.

Actual exits: build-world.mjs **0**; build-world.mjs --check **0**; check-world.mjs **0**. Structural errors: 0.

There are 90 families (40 target, 40 distractor, 10 foreign), 1020 facts and 540 memories. Target facts: 280 rendered plus 40 absent; distractors: 600 rendered plus 40 absent; foreign: 60 rendered, including 20 near-duplicates and 10 unique custody anchors. All bodies are assistant notes. Receipt roles total user 1013, assistant 526.

| Scale | Memories | zh/en/mixed | Receipt user/assistant | Receipts 1/2/3/4/5/6 | Body bands | Receipt bands | Mean body/receipt tokens |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| S300 | 160 | 88/48/24 | 284/172 | 32/40/40/24/16/8 | 48/64/48 | 160/182/114 | 216.8813/92.8026 |
| S1000-extra | 320 | 176/96/48 | 608/304 | 64/80/80/48/32/16 | 96/128/96 | 319/365/228 | 218.9375/92.4386 |
| foreign | 60 | 33/18/9 | 121/50 | 12/15/15/9/6/3 | 18/24/18 | 60/68/43 | 219.0667/91.924 |

Body bands are [120,180), [180,260), [260,400]; receipt bands [40,70), [70,130), [130,200]. Counts and means use tiktoken@1.0.22, o200k_base. Namespace target contains S300 plus S1000-extra; namespace foreign contains foreign. Overall languages are 297/162/81. Distractor authoring is 160 hand/160 template.

| Domain | Target memories | Distractors | Foreign |
| --- | ---: | ---: | ---: |
| engineering | 40 | 80 | 12 |
| work-preferences | 28 | 56 | 12 |
| operations | 28 | 56 | 12 |
| finance | 32 | 64 | 12 |
| product | 24 | 48 | 6 |
| everyday | 8 | 16 | 6 |

Distinct-fact placements (body/first/later): targets 126/70/84 ({"body":0.45,"first-receipt":0.25,"later-receipt":0.3}); distractors 270/150/180 ({"body":0.45,"first-receipt":0.25,"later-receipt":0.3}). Full allocations, exact measurements and evidence ranges are retained in build/world-stats.json.

Filler disclosure: 1080 complete bank sentences, 3840 UTF-16 ranges across 2079 units; 18297 per-fact terms scanned, 0 hits. HR-1 exact-statement overlaps: 0; exact unannotated facts: 0. Annotation totals independently agree (1340 forward/1340 reverse).

Declared decisions: four target episodes express three facts each; 2–4 facts means the entire memory including receipts. Historical notes may also contain still-valid bounds or nearby attributes with current support elsewhere. Changed decisions/reasons and primary/nearby assignments never share a memory. Body allocation uses body-only support with span:null. Non-supporting units have entity-bearing topical anchors disclosed apart from fact-free padding, since their entity references intentionally belong to the forbidden lexicon. Authored filler is factored by domain and role; every resulting sentence is disclosed, and opening/ending clauses cannot repeat within a unit. Mixed units contain substantive English and Chinese clauses. Distractors use four hand-authored adjacent-artifact episodes and four disclosed fabrication-template episodes; only those 160 memories count as template. Seeded capacity matching assigns whole-sentence constructions to token bands; endpoints follow the coordinator convention.

Candidate diagnostics: [{"candidateIndex":0,"seed":1924440465,"stage1":"pass","stage1Errors":[],"stage2":"pending-coordinator","stage1Attempts":[{"stage1":"pass","errors":[],"hashes":{"hr1-facts.json":"78e486837b8eb442a530165c0f6d5e6f20724bf0c3bb477da064f9b717c8f881","hr1-corpus.json":"df72a31d9bf18a16fa4fc4c8e5336e125ccfa5b70750cf53ffd414d88964bb56"}},{"stage1":"pass","errors":[],"hashes":{"hr1-facts.json":"78e486837b8eb442a530165c0f6d5e6f20724bf0c3bb477da064f9b717c8f881","hr1-corpus.json":"d657a0e120f2b7fe8ec3bce107ee41d2b8386f19d87c9f86f013de9166dd39e6"}}]}]. Rejected-candidate diagnostics: []. Later candidates are unattempted. The coordinator must complete stage 2 in frozen seed order, retaining any quota rejection. W1 cannot establish query quotas or semantic entailment. No -o destination was supplied; this report uses W1-REPORT.md inside the authorized directory.

Development diagnostics are retained separately: an import-entry failure (exit 1), sixteen timestamp errors (checker exit 1), and sandbox-only piped-child EPERM plus transient inventory self-enumeration (exit 1). These implementation issues were corrected before acceptance; see build/development-diagnostics.json. No seed was discarded to improve results.

Inventory: 14 files, filesystem walk versus Git cached/untracked enumeration, mechanically diffed; filesystem-only 0, Git-only 0; Git exit 0. Whitespace checks include every listed file, including untracked files.

- `README.md`
- `W1-REPORT.md`
- `build/build-world.mjs`
- `build/check-world.mjs`
- `build/config.mjs`
- `build/development-diagnostics.json`
- `build/distractors.mjs`
- `build/filler.mjs`
- `build/foreign.mjs`
- `build/source.mjs`
- `build/targets.mjs`
- `build/world-stats.json`
- `hr1-corpus.json`
- `hr1-facts.json`
