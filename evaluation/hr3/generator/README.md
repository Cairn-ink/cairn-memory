# HR-3 generator: A-6 source names and private trivia

Authority: `../protocol/protocol-v0.3.4.md` and `../protocol/errata.md`, especially A-6 §§2–5 and the generator row of §7. This directory makes no API/model/network calls and does not read credentials. Node 22.16+ ESM; no dependencies. Nothing here authorizes paid execution.

`public-contract.json` is the single versioned public contract. Its closed JSON schema is `public-contract.schema.json`; `contract.mjs` loads its exact contents and validates the executable subset used by that schema. Both models must receive its exact bytes or its complete deterministic projection. A repository path or hash alone is insufficient. `extractionInput` includes a full copy; the harness owns complete provider requests and the reader's copy. The contract covers all three slot domains, bilingual/mixed subject/predicate/field aliases, literal route identifiers, exact rational units, Boolean aliases, normalization, duplicate handling, the 12-cell scope domain, Taipei half-open time semantics, update meanings, all historical labels, citation address forms, and independent engineering examples. No allocation, gold, version selection or causal graph is an alias-table entry.

`answer.schema.json` defines the closed slot answer: `current.rows`, `old.records[].{predecessor_turn,status,rows}`, and `reason.{status,support}`. Every row carries scope, source-claimed interval, route/approval/cap slots, and citations. `validateAnswer` additionally enforces value/null coupling, scope/time validity, citation address source coupling and status semantics. Runtime checks preserve explicit false and zero; an omitted field becomes `not_specified`, never false, zero, unavailable or inherited during extraction.

The pilot uses seed `hr3-worlds-a6-pilot-v1`. Allocation retains seed `hr3-worlds-v1`: 30 lineages × 2 members, 12 families/type, languages 33 zh-Hant / 18 English / 9 mixed, 40 Card controls and 20 safety controls. Both dependency-authoring paths remain exercised in every Card branch. Causal allocation and effective guards are unchanged: 40 multi-hop and 10 unstated families at both checkpoints. The source timeline preserves four observations, two checkpoints, future-effective/retroactive variants, explicit deadline versus conditional/unexplained expiry, and no fallback. New dates/quantities are fresh deterministic draws, not independent roots.

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

Only `artifacts/pilot/` is regenerated for A-6. The previous pilot and its freeze are preserved byte-for-byte in `artifacts/previous-12355a8e/`, with an archive manifest and source fingerprints for fresh-world checks. All earlier archives and engineering artifacts remain unchanged. The fresh seed reuses the same lineage roots; it creates no independent ancestry root. Prior paid extraction/answer caches are never read or reused.

Reproduce into an empty directory within this generator directory:

```sh
node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/generator/artifacts/pilot-reproduction
node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs
node evaluation/hr3/generator/freeze.mjs
```

`emit` refuses overwrite and independently checks planned files against directory enumeration and disk SHA-256. `freeze.mjs` cross-checks a manual recursive walk against recursive `readdir`, prints a count and hashes every delivered file except the manifest's own bytes. The test isolation option avoids this sandbox's child-runner output failure; CLI subprocess tests use dedicated file descriptors. Run only this directory's tests.

Implementation decisions: A-4 does not prescribe metadata property names; `private_causal` preserves the old graph without adding it to the reader response. The public contract currently names only engineering/pilot material, because active held-out replacements are gated. Fresh seeds do not assert new roots. A-6’s independent license review remains an explicit external precondition. The requested offline pilot is provisional while that review is pending; this freeze does not certify that the before-generation review requirement has passed. Complete-request/tokenizer/headroom, embeddings, scorer/serializer equivalence and cumulative-budget certificates belong to their assigned workers and remain pending; this generator freeze is not experiment-wide execution approval.


A-6 public teaching material lives in `public-contract.json.worked_examples`, authored by `examples.mjs` and checked byte-for-data equality in tests. Each group has English and Traditional Chinese counterparts: complete own-name/current-reference extraction with demo identifiers; orthogonal enum fields and rejected proposals; serial reason anchors spanning two current-batch turns; cap-only, complete/future and anchored non-slot context examples; decoded receipt/body addresses and unit-local occurrences; partial-refinement pairs with and without an explicit preservation sentence; complete causal selection including conjunction and independently sufficient alternatives. These are independent teaching worlds, not paid-pilot cases. Their reserved `demo` namespace is excluded from research/calibration worlds by the public policy and executable `assertExampleFree`; this does not ban shared primitives such as false or a canonical unit.

`name_tokens` publishes the full `[A-Za-z0-9_-]+` token rule, adjacent-character boundary checks, prefix exclusion and exact pre-normalization anchoring. `validNameAnchor` demonstrates syntax and occurrence checking only. It never infers an own/reference role from a substring. The model names the new record and references the old name at its current mention; only the harness’s admitted gold-free registry can supply an earlier event/turn identity. No earlier-turn identifiers were inserted into conversation text. The original private AST predecessor anchors remain authoring/gold data and cannot be used by that resolver.

Private scoring provenance is `support.optional_trivia`:

```text
{version:"hr3-optional-trivia-a6-v2", rules_sha256, offset_unit:"utf16",
 emission_inputs:[{turn_id,production,language,template,variables}], origins:[
  {turn_id, positions:[absolute UTF-16 source positions], segments:[
    {production,language,start,end,parts:[
      {kind:"literal",literal_index,start,end} |
      {kind:"interpolated",name,start,end}
    ]}
  ]}
]}
```

`trivia-rules.json` explicitly enumerates each licensed production/language/literal offset before rendering. The deliberately narrow license covers only source-production joining spaces and sentence-final `.` / `。`; it leaves internal separators protected. `renderSentence` records every literal and interpolation; `appendSource` maps only those predeclared literal licenses to absolute source positions. `validateTriviaRegistry` reconstructs every production, verifies complete source coverage, exact literal/part boundaries and exact licensed position sets. Every interpolated code unit remains protected, including decimals, signs, dotted identifiers, audience lists and intervals. All literal causal words, conjunction/sufficiency qualifications, negations and operators remain protected. No punctuation-deletion regex or gold/answer-dependent marking is used. Existing source production strings are checked against the archived sentence bank.

The new private support metadata changes no source words and is absent from `G_correct`, questions and extraction turns. Consumers map origin positions to required support spans; the scorer still resolves exact delivered addresses first. Trivia licenses do not permit dropping an extra citation, bypassing unknown-context referral, restoring missing causal words, or crediting punctuation-only spans. Support OR-of-AND topology, original source offsets, quotation text and existing policy semantics are preserved. Independently reviewing these licenses and certifying changed scorer/provenance keys remain prerequisites; all paid execution gates stay false.

The non-author trivia review rejected provenance authentication (P1-2 in this generator and P1-1 in the scorer), while accepting the 32 license contents. The authentication repair uses `hr3-optional-trivia-a6-v2`; the license file and licensed positions remain unchanged. Version 1 registries are not accepted by the repaired verifier. Scorer integration must migrate its decoder and call the verifier before compiling any license.

`support.optional_trivia.emission_inputs` is a private authoring tape, recorded **before** each source-renderer invocation from world/bank inputs:

```text
[{turn_id, production, language:"en"|"zh", template, variables:{...}}]
```

`template` is the exact bank production; `variables` is a deep snapshot of the original interpolated values. This tape is not recovered from source substrings or candidate part boundaries. `validateTriviaRegistry(registry, turnsMap, trustedEmissionInputs)` requires its third argument and independently re-emits that tape. It checks templates against the bank, byte-exact source text, complete parts/boundaries, every licensed position and the entire canonical registry. There is no parse fallback. `validateFamily` obtains the trusted tape by regenerating the world from the caller's trusted lineage/member/seed; it never treats the candidate registry's own tape as authority.

For the scorer worker, use the exported interface from `generator/trivia.mjs`:

```js
import { verifyFamilyTrivia } from '../generator/trivia.mjs';

// trustedFreeze must already be rooted in the primary's trusted artifact hash.
// Do not accept a freeze, handle or expected digest supplied with a submission.
const handle = trustedFreeze.optional_trivia.family_handles[family.family_id];
const authenticatedRegistry = verifyFamilyTrivia(
  { family, registry: supportRow.optional_trivia },
  handle,
);
// Only compile authenticatedRegistry, never the original mutable candidate.
```

`family` is the frozen authoring family, not a reader answer or delivered-memory item. The verifier uses `family_id`, `lineage_id`, `seed`, `namespace`, and ordered `{turn_id,text}` records from `batches[].turns`. It returns a deeply frozen, detached registry copy or throws; absence of an expected handle fails closed. It first verifies canonical SHA-256 bindings, then replays the now-authenticated input tape. It does not infer variable values from submitted boundaries.

Each handle has exactly `version:"hr3-trivia-auth-a6-v1"`, `family_id`, `lineage_id`, `seed`, `namespace_sha256`, `source_turns_sha256`, `registry_sha256`, `emission_inputs_sha256`, `rules_sha256` and `template_bank_sha256`. Digests use UTF-8 `canonical()` from `common.mjs`: recursively sort object keys, preserve array order, JSON encode with no trailing newline. Source digest input is the flattened ordered array of `{turn_id,text}`; namespace, registry, input tape and complete `SENTENCES` bank are hashed separately. `rules_sha256` hashes the license file's exact bytes. The manifest's `optional_trivia.family_handles` and the freeze's identical map contain one handle per family; the freeze also hashes that map and the complete pilot manifest. `freeze.mjs` independently regenerates all pilot emissions before accepting the manifest's handles, so forged support plus a recomputed manifest hash cannot bootstrap its own trust.

Treat the externally pinned freeze/manifest as the trust boundary. SHA-256 is an integrity binding, not a secret signature: a candidate's self-declared hash is never authentication. Verify the whole pilot artifact set against the trusted freeze hashes before using its families/support. Original source text and the authoring tape remain scoring-side only; they are never supplied as model evidence or as a fallback for O/P history. After verification, consumers must still enforce exact citation addresses, source-position correspondence, supported content and existing referral rules. Authentication does not grant semantic reason credit.
