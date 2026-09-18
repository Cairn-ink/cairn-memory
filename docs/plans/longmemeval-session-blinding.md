# LongMemEval session-label blinding contract

This bounded repair closes a metadata leak in prepared LongMemEval-S pilots.
It changes preparation and its offline consumers, not core memory semantics,
provider calls, private datasets, or benchmark-quality claims. Fixed base:
`83a10c3b7664b1f67485a19e7d84d24dcb3041a5`.

## Acceptance

- **SB1 — separated identity:** `history.jsonl` carries a deterministic opaque
  session ID for each question and zero-based session occurrence, independent
  of the source session-ID string. Source IDs and their occurrence-to-opaque
  mapping exist only in the private operator manifest. The evaluator's strict
  existing shape is retained: `answer_session_ids` uses the mapped opaque ID,
  so scoring can join it to a prepared run without raw source IDs.
- **SB2 — label invariance:** Given two valid source snapshots differing only
  in `haystack_session_ids` and corresponding `answer_session_ids`, prepared
  model-facing history and question files are byte-identical. Turn IDs and all
  scripted capture, recall and answer callback payloads are identical too.
  Source dialogue may naturally contain the word “answer”; this is not removed
  or rejected by a lexical substring rule.
- **SB3 — fidelity and duplicate handling:** Preparation preserves exact turn
  content, roles, order and dates. Identical repeated raw-ID sessions remain
  distinct indexed occurrences, with distinct opaque session and turn IDs.
  Conflicting repeated source-ID bodies and an answer ID resolving to multiple
  occurrences remain rejected before writing.
- **SB4 — coverage and generation boundary:** Retrieved and packed reference-
  session coverage is correct under the opaque mapping. Generation receives
  only prepared history/question and never receives the evaluator or manifest.
  One offline integration test exercises preparation → actual synthetic local
  core comparator → separate score, including reference coverage.
- **SB5 — migration:** Preparation schema is versioned to v2. Old v1 artifacts
  are unsafe for session-label-blinding claims and must be regenerated from
  the reviewed pinned source; no in-place relabel is asserted equivalent.
  Existing callers are audited, with fail-closed incompatibilities documented
  or explicitly migrated.
- **SB6 — verification:** On Node 22.16 and 24 run `npm run
  test:longmemeval`, `npm test`, `npm run validate`, `npm run
  demo:longmemeval-ingestion`, `npm run demo:longmemeval-comparison`, and
  `npm run test:live-evidence-offline`.
  Tests and demos use synthetic data and scripted models only.

## Implementation notes and boundary

Keep the exported four-argument `stableTurnId` as the legacy v1 helper for
existing hand-built fixtures; introduce a clearly versioned label-independent
helper for v2 preparation. The new manifest mapping is operator-only and must
never be provided to generation. `evaluation/live/pilot.mjs` is a strict
caller of the preparation schema; its loader accepts v2 only, validates the
private map and derived public IDs against loaded histories, and rejects old
v1 artifacts. Live orchestration, transport, and pricing remain unchanged.

## Verification record

The implementation worker used only synthetic fixtures and scripted models.
No provider key, private corpus or paid request was used. After installing
the documented isolated adapter dependency sets, these gates passed on both
Node 22.16.0 and 24.15.0:

| Command | Result on each runtime |
| --- | --- |
| `npm run test:longmemeval` | 43 passed, 0 failed; includes label-invariance callbacks and actual-core prepare → compare → score |
| `npm test` | 106 passed, 0 failed |
| `npm run validate` | JSON/schema version checks passed |
| `npm run demo:longmemeval-ingestion` | Synthetic-only PASS |
| `npm run demo:longmemeval-comparison` | Synthetic-only PASS |
| `npm run test:live-evidence-offline` | 239 passed, 30 skipped, 0 failed; includes v1/map/turn tamper rejection |

The first Node 22 live-offline attempt could not load the isolated `tiktoken`
dependency; `npm ci --prefix adapters/openai` and `npm ci --prefix adapters/mcp`
resolved that environment setup, and the complete suite then passed. The
primary independently inspected the implementation and callback assertions,
then reran every command above on both runtime versions with the same pass and
skip counts. Strict plugin and marketplace validation also passed on both
runtimes. The 30 skipped opt-in cases are not passing evidence. Implementation
owner: Sol/high worker; primary owned integration acceptance and bounded test
corrections. Independent fixed-commit review and remote CI remain delivery
gates, not semantic-quality evidence. Runtime token/cost totals are unavailable.
