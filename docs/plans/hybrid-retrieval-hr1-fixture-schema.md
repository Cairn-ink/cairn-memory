# HR-1 fixture schema (`hr1-fixture-v2`)

Companion to the [HR-1 protocol](hybrid-retrieval-hr1.md) §4. All files live in
`evaluation/retrieval-research/fixtures/` and are UTF-8 JSON with
`"version": "hr1-fixture-v2"`. Identifiers are ASCII. Text fields hold synthetic
natural language: Traditional Chinese as used in Taiwan, English, or mixed.

## Who writes what

| File | Writer | Readers |
| --- | --- | --- |
| `hr1-facts.json` | World author (W1) | Tools, auditor |
| `hr1-corpus.json` | World author (W1) | Tools, harness, auditor. **Never the query author** |
| `hr1-facts-view.json` | Tool, generated from the two files above | Query author (W2) |
| `hr1-queries.json` | Query author (W2) | Tools, auditor |
| `hr1-split.json`, `hr1-labels.json` | Tools (deterministic) | Harness, auditor |
| `hr1-label-audit.json` | Label auditor (W3) | Tools (applied before freeze) |

## `hr1-facts.json`

```json
{
  "version": "hr1-fixture-v2",
  "families": [
    { "id": "fam-001", "role": "target", "domain": "engineering", "summary": "one line" }
  ],
  "facts": [
    {
      "id": "F-0001",
      "family": "fam-001",
      "kind": "decision",
      "state": "current",
      "supersedes": null,
      "reasonFor": null,
      "nearDuplicateOf": null,
      "eventTime": "2026-08-14T09:00:00Z",
      "entities": ["小林", "PostgreSQL"],
      "statementLang": "zh",
      "statement": "canonical statement of the fact",
      "rendered": true,
      "coverage": "body"
    }
  ]
}
```

- **Family fields**
  - `role` ∈ `target` (S300; queries may target it), `distractor` (S1000
    extras), `foreign` (foreign namespace).
  - `domain` ∈ `engineering`, `work-preferences`, `operations`, `finance`,
    `product`, `everyday`.
- **Fact fields**
  - `kind` ∈ `fact`, `preference`, `decision`, `instruction`, `context`,
    `reason`, `event`.
  - `state` ∈ `current`, `historical`, `rejected`, `proposed`. `historical` facts
    are superseded by a later fact through `supersedes`.
  - `reasonFor` points to the decision this fact explains.
  - `nearDuplicateOf` (foreign facts only) points to the target fact it imitates.
  - `rendered: false` marks an **absent fact**: plausible but never rendered into
    any memory. It is used for C8.
  - `coverage` (target facts only, intended): `body` means at least one target
    memory body expresses the fact; `span-only` means only spans do.
- **Minimum family count.** Protocol v2.1 §4.3 requires each category to draw
  test queries from at least ten families and dev queries from at least four.
  W1 therefore writes **at least 40 target families**, each able to support
  queries in several categories.

## `hr1-corpus.json`

```json
{
  "version": "hr1-fixture-v2",
  "memories": [
    {
      "id": "m-0001",
      "namespace": "target",
      "scale": "S300",
      "lang": "zh",
      "kind": "decision",
      "state": "current",
      "supersedes": null,
      "eventTime": "2026-08-14T09:00:00Z",
      "domain": "engineering",
      "authoring": "hand",
      "content": "assistant-style extracted note (memory body)",
      "spans": [
        { "id": "m-0001#s1", "role": "user", "eventTime": "2026-08-14T09:00:00Z", "text": "verbatim chat message excerpt" }
      ],
      "expresses": [
        { "fact": "F-0001", "where": "body", "span": "m-0001#s1" }
      ]
    }
  ]
}
```

- **Memory fields**
  - `namespace` ∈ `target`, `foreign`.
  - `scale` ∈ `S300`, `S1000-extra`, `foreign`.
  - `lang` ∈ `zh`, `en`, `mixed`.
  - `kind` is one of Cairn's five Memory kinds: `fact`, `preference`,
    `decision`, `instruction`, `context`.
  - `state` ∈ `current`, `historical`. `supersedes` links memories.
  - Each memory has 1–3 spans. Span IDs are `<memoryId>#s<n>`.
  - `authoring` ∈ `hand`, `template` (lets tools check the at-most-half-template rule for S1000 extras).
- **`expresses`** lists every fact the memory conveys.
  - `where: "body"` means the body states the fact.
  - `where: "span"` means only the named span states it.
  - Content length is at most 4,000 UTF-16 units; spans at most 800.

## `hr1-facts-view.json` (generated, text-free about memories)

- **Copied from `hr1-facts.json`**: facts of `target` and `foreign` families,
  with their `statement`.
- **Added by the tool**:
  - `memoryLangs`: the languages of memories expressing the fact.
  - `actualCoverage`: `body`, `span-only` or `absent`.
  - `memoryCount`.
  - `memoryStates`.
- **Never included**: memory content, span text or memory IDs.

## `hr1-queries.json`

```json
{
  "version": "hr1-fixture-v2",
  "queries": [
    {
      "id": "q-001",
      "family": "fam-001",
      "category": "C1",
      "secondaryTags": ["C7"],
      "lang": "zh",
      "intent": "current",
      "text": "the question a person would ask their assistant",
      "requiredFacts": ["F-0001"],
      "keyTerm": "PostgreSQL",
      "note": "why these facts are necessary and sufficient"
    }
  ]
}
```

- `category` ∈ `C1`–`C8` or `FOREIGN` (foreign-only isolation control).
- `keyTerm` is required for C1 and C2.
- C8 and `FOREIGN` queries reference absent or foreign facts respectively.
- Query authors do not assign splits.

## Generated files

- **`hr1-split.json`**: `{family → "dev"|"test"}` from a seeded deterministic
  assignment meeting the protocol quotas (about 6 dev / 14 test per category,
  dev 30% ± 3%).
- **`hr1-labels.json`**: one entry per query, containing:
  - `split`;
  - `groups`: `[{fact, members:[{memory, where, scale, namespace}]}]`, listing
    eligible members only under the query's intent;
  - `hardNegatives`;
  - mechanical `checks` per category;
  - `overlap`: T1/T1+ token overlap with each group member.
- **`hr1-label-audit.json`** (W3):
  `{overrides:[{query, action, detail, reason}]}`, where `action` ∈
  `add-member`, `remove-member`, `recategorize`, `drop-query`,
  `add-hard-negative`, `remove-hard-negative`. Tools apply the overrides, then
  re-run the validator.
