# HR-3 generator: A-4 public slots

Authority: `../protocol/protocol-v0.3.4.md` and `../protocol/errata.md`, especially A-4 §§2, 4, 5, 7 and 10. This directory makes no API/model/network calls and does not read credentials. Node 22.16+ ESM; no dependencies. Nothing here authorizes paid execution.

`public-contract.json` is the single versioned public contract. Its closed JSON schema is `public-contract.schema.json`; `contract.mjs` loads its exact contents and validates the executable subset used by that schema. Both models must receive its exact bytes or its complete deterministic projection. A repository path or hash alone is insufficient. `extractionInput` includes a full copy; the harness owns complete provider requests and the reader's copy. The contract covers all three slot domains, bilingual/mixed subject/predicate/field aliases, literal route identifiers, exact rational units, Boolean aliases, normalization, duplicate handling, the 12-cell scope domain, Taipei half-open time semantics, update meanings, all historical labels, citation address forms, and independent engineering examples. No allocation, gold, version selection or causal graph is an alias-table entry.

`answer.schema.json` defines the closed slot answer: `current.rows`, `old.records[].{predecessor_turn,status,rows}`, and `reason.{status,support}`. Every row carries scope, source-claimed interval, route/approval/cap slots, and citations. `validateAnswer` additionally enforces value/null coupling, scope/time validity, citation address source coupling and status semantics. Runtime checks preserve explicit false and zero; an omitted field becomes `not_specified`, never false, zero, unavailable or inherited during extraction.

The pilot uses seed `hr3-worlds-a4-pilot-v1`. Allocation retains seed `hr3-worlds-v1`: 30 lineages × 2 members, 12 families/type, languages 33 zh-Hant / 18 English / 9 mixed, 40 Card controls and 20 safety controls. Both dependency-authoring paths remain exercised in every Card branch. Causal allocation and effective guards are unchanged: 40 multi-hop and 10 unstated families at both checkpoints. The source timeline preserves four observations, two checkpoints, future-effective/retroactive variants, explicit deadline versus conditional/unexplained expiry, and no fallback. New dates/quantities are fresh deterministic draws, not independent roots.

Naming uses independent subject and route streams. Six neutral bilingual subject identities occur twice in each change type. All six route permutations are counterbalanced at every supplied version, giving four uses of each route per version/type. Route names do not incorporate subjects, conditions, rejection labels or version suffixes. Public record names are opaque and rotated; chronological public turn addresses remain explicit because A-4 requires predecessor identification. Reason station names are independently permuted opaque identifiers rather than encoded type/causal ordinals. Internal family/lineage/event IDs remain private allocation metadata and never enter questions or extraction inputs.

Questions announce subject, predicate, checkpoint, requested scope, all three slots, focal turn and each exact predecessor turn with its source record name. Every question announces the complete shared historical vocabulary: `previously_adopted | erroneous | expired | unavailable | unresolved`. It never selects the case's correct historical label. The closed answer form and complete quoted causal-explanation requirement are explicit and identical across arms.

Gold has three separate private projections:

- `gold.checkpoints[].G_correct`: slot rows and public predecessor turns, empty answer citations/support, plus private `acceptedGraphs` topology. Remove that scorer-only key before applying the answer wire schema.
- `gold.checkpoints[].private_causal`: the original canonical Claim projection, reason-node meanings and accepted graph topology, retained for independent cell/field semantic replay and scorer integration. This is private authoring/correctness material, never model instructions or delivery.
- `support.checkpoints[]`: original assertion spans and OR-of-AND edge-support alternatives, with exact UTF-16 source offsets and quotations. These stay out of correctness-only projections.

`correctnessOnly` returns a deep copy of `G_correct`. Consumers needing private causal node meanings must explicitly use `private_causal`; support adjudication receives neither gold projection. Empty gold citations are placeholders, not fabricated delivered evidence. Quoted-explanation readers select actual delivered unit addresses; the harness/scorer own that mapping.

`validateFamily` checks the private Claim projection against an independent chronological cell/field evaluator, then checks slot projection against it. It validates all causal topologies, exact edge-support conjunctions, source spans/direction, E-1 expiry triggers, E-2 controls and questions. `slotRowsKey` compares expanded scopes and rational quantities, collapses equivalent duplicates and retains contradictions.

`leakage.mjs` publishes deterministic question/contract-only checks in the pilot manifest. Eighteen independently authored matched pairs cover three languages and route, approval, quantity, history, reason and replacement absence. Each pair has identical public questions and complete contracts but different evidence and correct answers. A deterministic answer based on those inputs alone can match at most one member per pair (50% over each pair). This is a finite non-identifiability check, not a model-performance estimate. Identifier balance is separately checked against the rendered pilot.

`exclusions.mjs` reads (never rewrites) `../harness/reports/inspected-heldout-references.json`. It verifies 504 cases / 77 families / 66 lineages and per-lineage case hashes, and excludes calibration/tuning candidates matching a family, lineage, declared ancestry closure, serialization hash or reference-row hash. The registry records 33 development and 33 test lineages; it does not establish freshness for unlisted worlds. Original R3 ancestry and the 8 development / 30 test replacement obligations remain. A-4 naming/seed revisions stay within engineering/pilot roots and carry explicit fixture-amendment disclosures.

Both `generateFamily` and `generateSplit` reject development/test before rendering. Their allocation metadata remains visible for auditing; replacement conversations and gold remain unrendered. A future reviewed freshness/calibration change must replace the banks and their public naming table before lifting this gate. Do not pass held-out families into a certificate merely to discover a maximum.

Only `artifacts/pilot/` is regenerated for A-4. The previous pilot and its freeze are preserved byte-for-byte in `artifacts/previous-e5555ee3/`, with an archive manifest. Existing engineering artifacts are historical and remain unchanged; they are not A-4 certificates. Previous R3/R4 archives are also unchanged.

Reproduce into an empty directory within this generator directory:

```sh
node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/generator/artifacts/pilot-reproduction
node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs
node evaluation/hr3/generator/freeze.mjs
```

`emit` refuses overwrite and independently checks planned files against directory enumeration and disk SHA-256. `freeze.mjs` cross-checks a manual recursive walk against recursive `readdir`, prints a count and hashes every delivered file except the manifest's own bytes. The test isolation option avoids this sandbox's child-runner output failure; CLI subprocess tests use dedicated file descriptors. Run only this directory's tests.

Implementation decisions: A-4 does not prescribe metadata property names; `private_causal` preserves the old graph without adding it to the reader response. The public contract currently names only engineering/pilot material, because active held-out replacements are gated. Fresh seeds do not assert new roots. No unresolved generator semantic ambiguity was found. Complete-request/tokenizer/headroom, embeddings, scorer/serializer equivalence and cumulative-budget certificates belong to their assigned workers and remain pending; this generator freeze is not experiment-wide execution approval.
