# Evaluation-only chronology candidate

Base: `0c7c40bdb738c1144d12f3a21084619e4b084f96`. This slice prepares a
falsifiable prompt-only arm; it does not claim semantic improvement or dispatch
paid calls. The preceding three-case once-only correction run is complete and
must not be rerun. MOC, SQLite, core prompts/defaults and provider schema stay.

## Acceptance

- TC1: Add an evaluation-only model facade that changes only the `relate`
  system instructions by appending one fixed chronology/coverage guidance file
  to the exact baseline source-only rationale prompt. Reject unrelated/focused
  prompts instead of accidentally modifying another task. Leave `input`,
  response schema, output ceiling 1024, cancellation and source indices intact.
- TC2: Count the actual modified serialized request with the injected exact
  counter before its one underlying `relate` call; retain the 6000 input ceiling
  and existing context-window requirement. Forward errors, never retry, filter,
  repair or invent output. Keep all other model methods unchanged. Snapshot
  bound callbacks and cloned input before calling counters; mutable callbacks
  must not change what is sent after counting. Cancellation before/after the
  provider must reject. Existing core output validation remains authoritative.
- TC3: Fixed guidance distinguishes event/applicability time from import time,
  receipt storage time and array order. Earlier success does not refute a later
  explicit loss; historical support remains historical. Preserve independently
  supported reasons and genuine challenges, respecting subject/scope. Later
  timestamps alone are not proof, and a later correction can explicitly rebut
  an earlier report. Unknown/conflicting time stays uncertain. No implied
  decision adoption, permission, current truth, or requirement to emit any edge.
- TC4: Offline tests inspect the exact request and unchanged baseline, token
  overflow/counter failure before provider, once-only errors, cancellation,
  callback mutation and preservation of all raw output including wrong or empty
  proposals. One real synthetic-core replacement integration must show the same
  source/revision guards and cold persistence with a scripted model; no accuracy
  claim. Run targeted, generic, JSON/strict plugin and required affected suites
  on Node22.16/24; no key or network/provider test.
- TC5: Document fixed candidate provenance and a later paired comparison on
  six fresh bilingual histories, with separate rubric, frozen before scoring.
  Count false direction, missed genuine challenge, missing independent support,
  abstention, structural failure and cost. The candidate must be frozen before
  the scored fixture is provided to its implementer. Do not implement or score
  the paid runner here. No new production schema or default promotion.

Official OpenAI guidance, checked 2026-09-17, recommends explicit instructions
and checking ambiguity/conflicts, with empirical evaluation rather than assuming
prompt changes work:
https://developers.openai.com/api/docs/guides/latest-model?model=gpt-4.1
The experiment preserves `gpt-4.1-mini-2025-04-14`; it is not a model migration.

One Sol/high worker implements the isolated facade/guidance/tests. Primary owns
fresh scoring acceptance and eventual bounded experiment. Independent final
Spec/Standards reviews gate delivery; passing scripted tests proves mechanics,
not relation accuracy. Keep this slice small and reuse model-budget helpers.

## Preparation evidence

Guidance SHA256 was frozen at
`96b820313b6617895b6a792b798b34d7289f032c3e67e3f325c441b9018d8cda`
before primary-authored fresh fixture/rubric. The worker did not read that
fixture. Primary added a fixture-integrity regression and independently ran the
full generic suite, JSON and strict plugin checks on Node22.16.0/24.15.0: pass.
This includes the facade/cold-core integration tests. Worker additionally ran
the unchanged full core suite (687/687 on each version). A formerly empty-only
cold test was strengthened to preserve a nonempty graph after malformed output.
No provider request, paid runner, new schema or product default change.

## Node 20 generic CI correction

The first PR CI run found that the test file imported the SQLite-backed core at
module load, which made the entire generic suite fail on Node 20 before its
pure facade tests could run. The integration test now follows adjacent
architecture tests: it imports core dynamically only inside a Node >=22.16
test, with an explicit skip on older runtimes. The facade, frozen guidance and
fresh scored fixture are unchanged. This correction requires a new exact-head
CI run; an earlier green run does not apply to the corrected commit.
