# HR-2b synthetic long-item world

W1 authoring product for protocol v1.1, frozen at `d3a6e24f` (amending v1
at `c546bfc1`). Candidate in use is **1**, seed **500613191**: the first
stage-1 pass after the coordinator rejected candidate 0 under v1.1.
Stage-2 validation and W3's semantic re-audit remain pending.
All people, organizations, incidents, conversations and amounts are invented.
The setting is independent Taiwan-based founder workspaces. Nothing describes
real conversations, product usage, or benchmark measurements.

The two schema products are `hr1-facts.json` and `hr1-corpus.json`, version
`hr2b-fixture-v1`. The legacy filenames are intentional. No queries, labels,
splits, rankings, assembly code or assembly results are authored or read here.
The independent coordinator owns stage 2 and fixture freezing; W1 does not
commit or create `FROZEN.md`.

## Reproduce

Run from the repository root with the installed research `tiktoken@1.0.22`:

```sh
node evaluation/retrieval-research/fixtures-hr2b/build/build-world.mjs --candidate 1
node evaluation/retrieval-research/fixtures-hr2b/build/build-world.mjs --candidate 1 --check
node evaluation/retrieval-research/fixtures-hr2b/build/check-world.mjs --candidate 1
```

For retained statistics, independently checked inventory, actual subprocess
exits and the delivery report:

```sh
node evaluation/retrieval-research/fixtures-hr2b/build/check-world.mjs --candidate 1 --record --verify-builds -o W1-REPORT.md
```

`build-world.mjs` writes **only** the two schema products. `--check` rebuilds
in memory and compares both files byte for byte without writing. The checker
does not rewrite either schema product. `--record` writes
`build/world-stats.json`; `-o` must name a path inside this fixture directory.
Output JSON and process statuses state actual exit codes. No network or API
is required, and no package installation is performed. The CommonJS tiktoken
entry is imported directly by ESM; no `createRequire` is used.

## Frozen generation choices

`build/config.mjs` was written before the first rendering. Its named PRNG is
mulberry32, with a frozen ordered sequence of sixteen numeric seeds. Default
builder candidate index is still zero; the commands above explicitly pin
candidate 1. All banks and source arrays have stable order.
Largest-remainder apportionment, ties in declared order, fixes exact bucket
counts before seeded shuffling. No process time, locale-dependent random
source, network input, query or label influences a build.

The amended receipt-count distribution is **1: 20%, 2: 25%, 3: 25%, 4: 30%**.
Each memory has one to four receipts, matching the core's per-admission cap.
Later-only evidence is in receipts two through four.

Within each role, fact placement is allocated before memory receipt counts. One-receipt
memories are chosen only among episodes without a later-receipt fact. The
remaining receipt-count multiset is shuffled over the remaining memories.
Raw receipts are sorted by parsed event time and their temporary stable ids
before ordinal `#s1` through `#s4` ids and evidence positions are assigned.
Every fact keeps its placement in every expressing memory. Body placement
uses body-only expressions with `span:null`; first-only and later-only facts
are stated in exactly one corresponding receipt of each expressing memory.

Whole authored sentences are assembled without truncation. For each unit,
the builder enumerates diverse windows of its seeded sentence-bank
permutation, using each opening and ending clause at most once per unit,
measures feasible constructions with o200k_base, and chooses
near the declared centers (body 148/218/300, receipt 54/96/143). Seeded
capacity matching assigns the frozen band quotas jointly with feasibility.
Bands are lower-inclusive, upper-exclusive, except inclusive 400/200 last
endpoints. The schema's 4000/800 UTF-16 caps also apply. Bodies have three to
eight complete sentences and one or two paragraphs. Receipts are complete
user or assistant turns, never prefixes of longer text.

The v1 candidate 0 was rejected at stage 2; the supplied coordinator
diagnostics are retained verbatim in `build/world-stats.json`, pointing to
`build/candidate0-v1-validation/`. That directory is retained unchanged and
is never read or traversed by the W1 checker. Earlier development diagnostics
are also preserved. Protocol v1.1 §9 restarts the unchanged frozen candidate
sequence at **candidate 0**, rather than advancing because of the v1 rejection.
That rebuild failed stage 1 on duplicate normalized body
`m-9e1321fab528a943` and failed identity. The coordinator rejected it,
independently confirming changed placement, changed fact-to-memory plan from
memory index 160, and a changed facts view due to distractor coverage; facts,
families, lexicon and target coverage were identical. This supplied resolution
is retained in the history with reference `build/candidate0-v11-identity/`.
Neither retained directory is opened or traversed by W1.

Per §9 and the coordinator's explicit authorization, this round advanced to
**candidate 1**, the second frozen seed. Its build, byte check and structural
checker all exited **0**, with no structural errors. No further candidate was
attempted. All seven generator files, including the four-bin `RECEIPT_COUNTS`,
are byte-identical to HEAD: no family, factual source, filler bank, lexicon
rule, seed sequence, PRNG, rendering rule or band logic was edited this round.
Their hashes and source commit are retained in `generatorIntegrity`.

New candidates may have different coverage, placement and facts-view content.
The candidate-0 identity gate does not apply and is not run by the checker.
`build/check-identity.mjs` stays unchanged for the record; only its file-list
and Git utilities are imported. W1 never reads query categories or W2/W3
products. If a new candidate fails a structural check, the checker records its
exit codes, hashes, command output, errors and statistics, and the next frozen
seed is tried without editing the generator. Sequence guards prevent skipping
an unattempted seed or advancing past an unrejected passing candidate.

`check-world.mjs --candidate 1 --record --report-only -o W1-REPORT.md`
refreshes delivery reporting and file-list/whitespace verification from the
saved result, without building, rechecking the world or advancing a seed. It
retains the recorded exit status rather than treating reporting as acceptance.

A structural pass is not two-stage acceptance. The
coordinator owns stage-2 validation under v1.1 and W3's full re-audit.
Later candidates remain unattempted unless separately authorized and recorded.
Pre-acceptance implementation failures and their fixes are disclosed in
`build/development-diagnostics.json`, distinct from seed selection.

## Authored factual world and lifecycle

`build/targets.mjs` contains forty individually authored bilingual threads.
There are ten engineering, seven work-preference, seven operations, eight
finance, six product and two everyday families. Each contains seven rendered
facts plus one plausible absent fact. Canonical facts and renderer wording
are new; the checker compares every exact canonical statement against the
HR-1 world returned by its named pattern builder. HR-1 files are never changed.

Each target family has four extracted episodes, three facts per episode:

| Episode | Facts | Lifecycle |
| --- | --- | --- |
| Historical note | old decision, bound, nearby assignment | historical |
| Adoption note | successor, bound, primary assignment | current; supersedes historical note |
| Explanation note | reason, nearby assignment, rejected/proposed option | current |
| Confirmation note | bound, primary assignment, rejected/proposed option | current |

The changed decision and its reason never share a memory. The primary
assignment and the near-miss assignment also never share a memory. Rejected
and proposed options remain explicitly rejected/proposed in current notes.
Still-valid bounds or attributes in a historical note have current support
elsewhere. Memory state follows its decision; a historical extracted note is
ineligible for current-intent retrieval even when some attributes remain true.

The interpretation of “2–4 facts” is per memory including receipts. A body
may deliberately omit every answer-bearing detail when all its facts have
receipt placement. Its topical anchor identifies the conversation without
stating a canonical fact. Foreign memories have one fact each; the 2–4
requirement is applied to targets, and voluntarily to distractors.

Canonical language and memory language are distinct. Twenty reason-only
episodes use opposite canonical/rendering languages, ten in each direction;
other facts can also cross language. Mixed notes and turns contain
substantive Chinese and English clauses. Memory-language apportionment is
55% zh / 30% en / 15% mixed independently at each scale.

## Distractors and foreign workspaces

`build/distractors.mjs` contains forty distinct hand-authored adjacent-artifact
threads with seven factual cores and one unused hypothetical fact each.
They share a target project entity but explicitly scope claims to teaching
props, exercise materials or rehearsal equipment. Four episodes per family
use these individually authored cores: 160 `authoring:"hand"` memories.
Four additional episodes per family use the disclosed domain-specific
fabrication specifications in `FABRICATION`: 160 `authoring:"template"`
memories. These describe different named fabrication pieces with two
attributes per memory. Exactly half of distractors use substantive templates.
Name-prefixing, topic anchors, metadata and shared filler do not convert an
individually authored factual core into a factual template; all such shared
construction is nevertheless disclosed.

Targets use namespace `target`, scale `S300`; distractors use namespace
`target`, scale `S1000-extra`. Their length, receipt-count, language and
distinct-fact-placement distributions match. Receipt and body token means
and UTF-16 means are checked within 15%; histograms and shares within five
percentage points. No duplicate copy is created for the derived S1000 scale.

`build/foreign.mjs` describes ten independent namespaces-as-worlds, stored in
the schema's single `foreign` namespace and `foreign` scale. Each contributes
two authored near-duplicate decisions, a unique custody-code anchor and three
fabrication facts, for sixty memories. Near-duplicates change answer-bearing
attributes and point to their targets through `nearDuplicateOf`. The anchors
never occur in the target namespace. Foreign lengths and distributions also
follow the long-item bands, although the protocol only fixes their count.

## Filler, non-supporting text and exact regions

`build/filler.mjs` contains ordered domain leads and role endings. Their
factorization yields 1080 complete authored bank sentences, all disclosed as
`corpus.filler.sentences[{id,text}]`, including unused combinations. `note`
means assistant extracted-note prose; `user` and `assistant` mean chat-turn
prose. Chinese and English banks are used together for mixed units. The
factorization and every full sentence are public, not hidden generated text.

Every filler occurrence is disclosed in `corpus.filler.ranges` with sentence
id, memory id, body/receipt, receipt id or null, and exact UTF-16 `[start,end)`
offsets. Ranges are nonoverlapping and ordered within their unit. Every unit
has at least one disclosed filler sentence. No filler mentions a project,
person, answer-bearing amount, date, adopted choice, reason, assigned duty,
rejected/proposed option or hypothetical absent fact.

Entity-bearing topical anchors are **not padding-bank sentences**: they
serve the protocol's required topical reference in non-supporting units.
Their exact text, template id and UTF-16 intervals are separately disclosed
in `corpus.topicalScaffolds`. They intentionally contain entity terms and
therefore cannot pass the fact-free filler lexicon test. W3 must audit them
alongside all non-supporting text. This separation is an explicit encoding
decision, not a semantic exemption. Factual sentences are separately located
in the build record's `generation.evidenceRanges`. Scaffolds, evidence and
filler together account for every sentence, apart from separators.

`facts.forbiddenLexicon` maps **every** canonical fact, including absent and
non-target facts, to normalized entity aliases, translations, distinctive
phrases, numeric forms and date forms. Numeric forms include comma-free,
Chinese cardinal, English cardinal and spoken digits; date forms include
ISO, slashes, Chinese and English spellings. Scanning uses NFKC, lowercase,
whitespace collapse and substring containment. Every bank sentence is scanned
against every fact, even when unused. Mechanical checks cannot establish
semantic fact-freeness, alias completeness, or unannotated paraphrase absence;
the separate W3 audit remains required.

Each `expresses` row names its exact supporting body or receipt. The required
region is that whole unit, with no required character window. Internal
evidence/filler offsets exist solely for disclosure and author diagnostics.

## Stage-1 checks and limitations

`build/check-world.mjs` reads the two products, own generation sources and the
named HR-1 pattern builder. It checks schema fields, ids, references, cycles,
supersession, temporal consistency, fact/memory states, seven-plus-absent
families, episode separation, 2–4 facts, hard-negative availability, lengths,
sentence/paragraph counts, receipt counts/order, fact placement consistency,
five-point share tolerances, 15% means, namespaces, foreign links, filler
lexicons/ranges, normalized body uniqueness, exact unannotated statements,
HR-1 exact-statement non-overlap and deterministic rebuilding. Annotation
totals are independently aggregated forward and backward. The delivery
owned-file inventory uses a filesystem walk with prohibited products pruned
and Git's cached/untracked enumeration over an explicit W1 allowlist. The
changed-file list is independently derived from Git diff plus untracked
paths and filesystem bytes versus HEAD blobs, then diffed with a count.
Whitespace checks cover owned tracked and untracked files only; no W2/W3
file or retained validation file is opened. This round runs only the build,
its byte check and the world checker; no test file is run.

The checker does not certify query-category eligibility, guard-stratum
quotas, semantic entailment, label accuracy, retrieval difficulty or assembly
behavior. Repeated editorial filler and balanced authored distributions are
synthetic design choices. This world is suitable for independent inspection,
not a claim about how real founders distribute information. Any semantic or
quota defect must be resolved before the coordinator freezes the fixture.
