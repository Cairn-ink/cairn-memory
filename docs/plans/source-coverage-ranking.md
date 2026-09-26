# Source-evidence complementary-coverage candidate

Status: implementation acceptance contract; prospective paired evaluation is
unrun. Fixed base: `4bc8892f3699e24191331f75c64483f42f45fde9`.

## Hypothesis and boundary

The source-evidence ranker should preserve a small set of complementary,
directly relevant receipts when a question asks for multiple facts, sessions,
times, people, scopes, reasons or changes. It should not collapse that evidence
to the one candidate most similar to the query. This is a provisional prompt
candidate, not a proven retrieval repair or evidence that ranking caused the
observed LongMemEval losses.

Only `core/prompts/recall-rank-source-evidence.md` changes live behavior. The
default, qualified and rationale rank prompts remain byte-identical. Selection,
validation, limits, context modes, wire models, storage, qualification, public
pilot/CLI and database behavior remain unchanged. No switch or version field is
added because a live execution is bound to the exact candidate commit.

## Frozen public synthetic comparison inputs

The exact previous source-evidence prompt is retained as an evaluation fixture.
Its SHA-256 before this change is
`e08ced39cfe8873be5b03fc473d52acbf9ff6682c0741c2a5514df1ce3dc63db`.
The model-facing case fixture contains no evaluation labels. The separate rubric
freezes source order, any-of required source groups, optional indices, redundant
groups and irrelevant zero-based indices below. These expectations must never
be supplied to either prompt arm. The frozen model-facing fixture SHA-256 is
`d51fda299c7795049e6926ded0083889dbaa849c6b8ace0bae6a15d2a5a0121e`;
the separate rubric SHA-256 is
`f04721dfd198e82fe3b03b811cc52538e57a72dbc0dc59283b096ee15a8b1bca`.

| Order | Case | Coverage | Required groups (any one per group) | Irrelevant |
| ---: | --- | --- | --- | --- |
| 1 | `simple-exact` | one exact answer | `[[0]]` | `[1,2]` |
| 2 | `multi-fact-three-cards` | three requested facts across three cards | `[[0],[1],[2]]` | `[3]` |
| 3 | `historical-current` | dated past fact and current state in reachable current records | `[[0],[1]]` | `[2]` |
| 4 | `rejected-proposal` | proposer/change plus explicit rejection | `[[0],[1]]` | `[2]` |
| 5 | `pending-choice` | option-specific considerations and unresolved status | `[[0],[1],[2]]` | `[3]` |
| 6 | `premise-challenge` | decision, recorded reason and later invalidation | `[[0],[1]]` | `[2]` |
| 7 | `person-scope-separation` | distinct people and work/personal scopes | `[[0],[1],[2]]` | `[3]` |
| 8 | `temporal-three-events` | baseline, dated exception and return | `[[0],[1],[2]]` | `[3]` |
| 9 | `duplicate-vs-complementary` | either equivalent booking plus complementary update | `[[0,1],[2]]` | `[3]` |
| 10 | `no-answer` | answer absent | `[]` | `[0,1,2]` |
| 11 | `untrusted-embedded-instructions` | relevant evidence containing inert instructions | `[[0]]` | `[1,2]` |
| 12 | `irrelevant-decoys` | relevant source amid lexical decoys | `[[2]]` | `[0,1,3]` |

Every case currently has `optionalSourceIndices: []`; the explicit field keeps
optional evidence distinct from genuinely irrelevant evidence. The duplicate
case expresses equivalence through the `[0,1]` required group and separately
records `redundantSourceGroups: [[0,1]]`, so neither sufficient duplicate is
mislabeled irrelevant while selecting both can be counted as redundancy.

All names, events, products and facts in these fixtures are invented for this
test. The fixtures contain no real dataset questions or answers. They are
development cases, not a hidden or representative benchmark.

## Acceptance criteria

- **SCR1 — candidate behavior:** Source-evidence instructions ask for an
  ordered unique subset that jointly covers distinct, directly requested
  information. They distinguish complementary events from duplicates;
  proposal from adoption; and an invalidated reason from a cancelled or
  replaced choice. They do not reconstruct omitted text, impose a minimum
  result count, retain unrelated candidates or forbid an empty result.
- **SCR2 — unchanged boundaries:** Existing `limit`, per-namespace selection
  caps, candidate pool validation, exact reference shape, source-only context,
  token budgets and final freshness checks remain unchanged. Default,
  qualified and rationale rank prompts remain byte-identical.
- **SCR3 — real-core plumbing:** Scripted actual-core tests demonstrate that
  exact full retained receipts reach the rank call, selected complementary
  references survive the authoritative final read, and out-of-pool, duplicate
  and stale rank outputs still fail. The successful path makes the existing
  selection/rank calls only and does not widen limits. These tests establish
  plumbing, not model relevance.
- **SCR4 — frozen comparison package:** A bounded architecture fixture retains
  the exact baseline prompt and twelve model-facing cases in fixed source order;
  a separate rubric retains the frozen required groups and optional, redundant
  and irrelevant annotations. Offline tests verify identities, separation,
  bounds and hashes without asserting that prompt wording improves model quality.
- **SCR5 — honest documentation:** Changelog and limitations describe the
  candidate as unscored and provisional. The prior `selected 2 -> rank 1` and
  `selected 4 -> rank 1` observations are motivation only, not causal proof.
- **SCR6 — verification:** Generic tests, validation, core tests and the store
  and recall demos pass on Node 22.16 and Node 24. Relevant OpenAI adapter tests
  run on both only if adapter code or fixtures are changed. No credential,
  provider call, paid request, old artifact write, push or merge occurs.

## Known limits and review record

Prompt instructions cannot guarantee complementary coverage, correct temporal
interpretation or resistance to embedded instructions. Navigation may omit a
needed card before rank; the fixed limit may be too small; extra candidates may
add noise; answer synthesis may still overstate evidence. A future paired run
must bind both prompt bytes, fixture/rubric hashes, candidate commit, model and
request controls, retain failures and score required-source retention separately
from irrelevant-source exposure. Passing offline tests does not authorize that
run.

Pre-commit verification on the final prompt and fixture bytes:

- Node 22.16.0 and 24.15.0:
  `node --test plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs`
  passed 110/110.
- Both runtimes: `node --test core/test/*.test.mjs` passed 649/649.
- Both runtimes: `node scripts/validate-json.mjs`,
  `node examples/local-store.mjs` and `node examples/recall.mjs` passed.
- Focused source-evidence plus architecture tests passed 22/22 after fixture
  correction. No OpenAI adapter file or fixture changed, so no adapter-specific
  gate was required. No provider call or credential was used.

| Requirement | Owner | Fixed point | Evidence / status |
| --- | --- | --- | --- |
| SCR1–SCR5 implementation | delegated implementation worker | base above; candidate pending | Complete pre-commit; primary owns acceptance and integration. |
| SCR6 verification | delegated implementation worker, then primary rerun | candidate pending | Worker gates above passed; primary rerun remains required by workflow. |
| Standards and spec review | independent reviewers selected by primary | final candidate SHA | Required before delivery; not replaced by worker self-review. |
