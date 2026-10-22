# HR-1 synthetic world (W1)

This is the world-author delivery for protocol v2.1 and schema `hr1-fixture-v2`.
It is ready for the coordinator's facts-view generation and independent label
audit; it is **not an audited or frozen fixture**. This directory contains no
queries, rankings, retrieval implementation, or benchmark results.

The setting is an invented Taiwan-based founder working with COO, CTO, and
finance assistants. People, companies, relationships, amounts, incidents,
invoices, PRs, and conversations are invented. Familiar technology names are
identifiers in fictional scenarios, not claims about real products or measured
performance. No private conversations, real financial records, paid APIs, or
external datasets were used. All “verbatim” spans are authored synthetic chat
excerpts, not transcripts collected from users.

## Reproduce and check

Run from the repository root with Node 22.16.0; there are no dependencies:

```sh
node evaluation/retrieval-research/fixtures/build/build-world.mjs
node evaluation/retrieval-research/fixtures/build/build-world.mjs --check
node evaluation/retrieval-research/fixtures/build/check-world.mjs
```

`build-world.mjs` writes only `hr1-facts.json` and `hr1-corpus.json` in this
directory. `--check` compares their bytes with a fresh in-memory build. Neither
mode reads another worker's files. IDs derive deterministically from SHA-256 of
authoring keys and do not expose domain, family, lifecycle, or fact IDs.

To refresh the machine-readable statistics, capturing the actual check status:

```sh
node evaluation/retrieval-research/fixtures/build/check-world.mjs --json > evaluation/retrieval-research/fixtures/build/world-stats.json
check_rc=$?
printf 'CHECK_EXIT_CODE=%s\n' "$check_rc"
```

The check exits nonzero on schema, reference, lifecycle, coverage, count,
distribution, namespace body uniqueness, exact-statement leakage, or
reproducibility failures. Within each namespace, bodies must be unique after
trimming and after trimming, collapsing whitespace, and lowercasing. It checks
1,100 annotations through both a forward scan and a reverse support index. It
also checks embedded Han entities, separated decision/reason evidence,
bidirectional language changes, and verbatim numeric terms in span-only facts.
These checks do not establish semantic entailment, query difficulty, category
quotas, split suitability, or independently audited labels. W2/W3 and the
coordinator own those later stages.

## Authoring and labels

Each target family has seven individually authored rendered facts and, in
fifteen families, one absent fact. The domain modules preserve separate
canonical statements, extracted bodies, and chat excerpts. `B` marks a complete
body expression; `S` marks a body which omits an answer-bearing detail. For an
`S` row, the complete fact exists only in its first span. The other spans are
short acknowledgements without additional facts. Every memory expresses one
complete canonical fact; a partial mention does not count as expressing the
complete fact. This completeness convention needs W3's semantic review.

Each target family includes a decision, its reason in a different memory, a
separate constraint, and related attributes or assignments on shared entities.
Twenty families have a historical decision and a later current decision, linked
at both fact and memory levels. The reason points to the new decision through
`reasonFor`. Rejected/proposed facts remain in **current memories**. Only
superseded decisions have historical memory state. Rejection/proposal labels
come from explicit authored wording rather than a position-based assignment.

Twenty current attribute facts have a second, later chat confirmation, yielding
300 memories from 280 rendered target facts. They retain the same body coverage.
Each confirmation has an individually phrased body in `build/variants.mjs`,
supported by its own unchanged spans, so body deduplication preserves both notes.
Twenty owner facts are rendered in the opposite language to their canonical
statement: ten English-to-Chinese and ten Chinese-to-English. These translations
do not create additional fact or evidence groups. Proper names, identifiers,
currency labels, and technology names can occur in an otherwise Chinese or
English excerpt; `mixed` denotes substantive code switching in the note/chat.

Absent facts have `rendered: false` and `coverage: null`; no memory expresses
them. Their statements are hypothetical ground-truth entries for missing
information, not assertions that a conversation established them. Coverage is
also null for distractor and foreign facts, because the intended coverage label
is defined only for rendered target facts. All expressed non-target facts in
this world have body evidence.

S1000 is the unchanged S300 projection plus the 700 `S1000-extra` rows in the
same target namespace. The 360 hand-authored extras preserve individual complete
statements and primary chat excerpts. The 340 substantive templates are marked
`authoring: "template"` and use domain-specific adjacent artifacts: engineering
test tools, practice-report formats, event supplies, separate event accounts,
tutorial apps, and outing supplies. Reused terms and amounts are scoped to
different attributes, transactions, artifacts, or people. Near matches identify
the difference explicitly. Common acknowledgement spans and deterministic
metadata assembly do not change an individually authored record to template
authorship. No extra intentionally states a target fact.

The foreign namespace represents ten other founders' independent workspaces.
Each has two near-duplicate decisions, one unique anchor fact, and seven local
display-card facts. The twenty near-duplicates point to their target counterparts
with `nearDuplicateOf` and change an answer-bearing attribute. The ten anchor
codes occur only in foreign evidence. Foreign template count is 70; the
at-most-half-template restriction applies to S1000 extras, where it is met.

Source timestamps span March through October 2026. Supersession follows March
to August. Two unchanged adoption threads occur in October after the September
events explaining them. Later confirmations occur on October 14; event-account
records occur after the dated expenses/refunds they describe. Timestamps use
UTC; stated meeting and deadline clocks explicitly use Taipei time where needed.

## Counts

Family counts:

| Domain | Target | Distractor | Foreign |
| --- | ---: | ---: | ---: |
| Engineering | 10 | 10 | 2 |
| Work preferences | 7 | 7 | 2 |
| Operations | 7 | 7 | 2 |
| Finance | 8 | 8 | 2 |
| Product | 6 | 6 | 1 |
| Everyday | 2 | 2 | 1 |
| Total | 40 | 40 | 10 |

There are 1,095 facts: 295 target, 700 distractor, and 100 foreign. Target facts
include 280 rendered and 15 absent facts, each absent fact in a different family.
All-fact kinds are fact 816, decision 140, preference 62, reason 40,
instruction 30, event 4, and context 3. All-fact states are current 1,015,
historical 20, rejected 36, and proposed 24. Target-only kind/state counts and
all scale/domain breakdowns are in `build/world-stats.json`.

Rendered target coverage is **168 body / 112 span-only (40%)**. The 815 null
coverage entries are 15 absent target facts and 800 non-target facts. There are
20 supersession families, 28 families with embedded 2–4-character Han entities,
and 20 foreign near-duplicates.

| Memory subset | Count | zh / en / mixed | Hand / template | 1 / 2 / 3 spans |
| --- | ---: | --- | --- | --- |
| S300 | 300 | 165 / 90 / 45 | 300 / 0 | 180 / 90 / 30 |
| S1000-extra | 700 | 385 / 210 / 105 | 360 / 340 | 420 / 210 / 70 |
| S1000 (derived) | 1,000 | 550 / 300 / 150 | 660 / 340 | 600 / 300 / 100 |
| Foreign | 100 | 55 / 30 / 15 | 30 / 70 | 60 / 30 / 10 |

There are 1,100 physical memory records. Derived S1000 is not a second copy of
S300. Every scale has 55%/30%/15% language proportions and 60%/30%/10% span-count
proportions. Extra domain proportions differ from S300 by less than 0.1
percentage point. Mean length is body plus all span text, in UTF-16 units:
81.007 for S300, 81.837 for extras, and 87.650 for foreign. Extras are **1.03%
longer** overall; each language's extra mean is also within 15% of its S300 mean.
The checker reports body lengths and length quantiles separately.

## Deviations and review priorities

No requested numeric minimum or coverage band is missed. Target families have
seven rendered facts rather than varying between five and ten. The corpus uses
only 20 target confirmations; most evidence groups have one member.

W3 should inspect partial-versus-complete entailment in span-only notes,
rejection/proposal cues, translated ownership wording, and adjacent-artifact
scoping in distractors. Reused Chinese aliases must not collapse distinct roles
or transactions. Some practice/event scopes are conspicuous and may make
distractors easy. The repeated seven-fact structure and one-fact-per-memory
pattern simplify multi-evidence grouping. Terse reason bodies, routine
acknowledgements, and limited conversational messiness may be less realistic
than long working chats. None of these difficulty concerns has been tested by
retrieval runs, and no such run was performed by W1.

## Delivery inventory

The inventory below is generated from the filesystem and cross-checked against
Git's tracked-change/untracked-file paths, restricted to this directory.

<!-- generated-inventory -->

- `README.md`
- `build/build-world.mjs`
- `build/check-world.mjs`
- `build/engineering.mjs`
- `build/extras-engineering.mjs`
- `build/extras-finance.mjs`
- `build/extras-operations.mjs`
- `build/extras-product-everyday.mjs`
- `build/extras-work-preferences.mjs`
- `build/finance.mjs`
- `build/operations.mjs`
- `build/product-everyday.mjs`
- `build/source.mjs`
- `build/variants.mjs`
- `build/work-preferences.mjs`
- `build/world-stats.json`
- `hr1-corpus.json`
- `hr1-facts.json`
