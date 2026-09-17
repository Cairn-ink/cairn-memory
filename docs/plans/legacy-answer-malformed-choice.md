# Legacy answer malformed-choice correction

Fixed base: `1bcde455f4ada8870993b26966364d72eed34486` (source-event answer consumer).
This is a separate evaluation-only correction, not a change to frozen experiment evidence.

## Acceptance

- LAC1: With a valid installed source envelope, null, undefined, sparse and primitive single choices return `invalid-output` rather than throwing. Exactly one injected completion attempt; no retry.
- LAC2: The neighborhood wrapper retains the same malformed-output behavior, valid answer behavior and zero-dispatch invalid-source behavior. Trace both entrypoints and their callers.
- LAC3: Preserve model, instruction, request bodies, successful status, source validation and new source-event consumer. No provider/key/env/ledger access or paid calls; synthetic data only.
- LAC4: Record a red reproduction before the minimal guard fix, then run old, neighborhood and new source-event tests plus full offline live suite on Node 22.16 and 24.15. Run generic and JSON/strict validation on both; actual Node 20 generic checks retain expected SQLite skips. No typecheck gate exists.
- LAC5: Freeze the scoped candidate, independent Standards and Spec review against this base, primary actual-diff inspection and key-path rerun before push. Deliver separate PR against main; no merge/release/deploy.

Allowed changes: this plan, `evaluation/live/installed-source-answer-delivery.mjs`, and its and neighborhood consumer tests. Avoid refactoring shared consumers or altering frozen reports.

Routing: bounded implementation delegated to source_rank_first_impl; primary owns contract and acceptance. Independent reviewers must not be the implementation author. Preserve red/green evidence and exact final SHA in this plan or PR.

## Implementation and red/green evidence

The direct installed-source entrypoint calls `deliverInstalledSourceAnswer`.
The neighborhood entrypoint projects RN evidence, then delegates to that same
delivery function. `long-source-history.mjs` also calls the installed-source
function directly; installed artifact tests exercise the direct and RN paths.
The new source-event consumer imports only the unchanged model/instruction
constants and retains its separately validated delivery path. No request,
model, instruction, input source validation or provider behavior was edited.

On fixed base `1bcde455f4ada8870993b26966364d72eed34486`, the new focused
tests for valid source input and malformed single choices (`null`, `undefined`,
sparse and primitive) failed in both public legacy delivery entrypoints. The
first case raised `TypeError: Cannot read properties of null (reading
'finish_reason')` at `installed-source-answer-delivery.mjs:67`, after the one
injected completion. The localized correction checks that `choice` is a
non-array object before reading `finish_reason`. The same cases now return
`invalid-output`, `answer: null`, `completionCalls: 1` and `finishReason: null`
without retry or throwing. Existing valid completion, failure and invalid
source controls remain in their unchanged focused tests.

## Offline verification record

The worker installed the isolated dependency sets with `npm ci --prefix
adapters/openai`, `npm ci --prefix adapters/mcp` and `npm ci --prefix
tools/plugin-validation` under Node 22.16.0. Every Node 22/24 command below
used `PATH=/home/chichieh/.nvm/versions/node/<version>/bin:$PATH` for npm and
child processes. No Node 20 static SQLite import was added; the actual Node
20.20.2 binary was selected with `npm exec --yes --package=node@20.20.2`.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node --test evaluation/live/test/installed-source-answer-delivery.test.mjs evaluation/live/test/neighborhood-source-answer-delivery.test.mjs evaluation/live/test/source-event-answer-delivery.test.mjs` | 15 passed | 15 passed |
| `npm run test:live-evidence-offline` | 276 passed, 30 existing opt-in skips | 276 passed, 30 existing opt-in skips |
| `npm test` | 143 passed | 143 passed |
| `npm run validate` | passed | passed |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin passed | marketplace and strict plugin passed |

Actual Node 20.20.2 `npm test` passed 136 tests with seven expected SQLite-only
skips; `npm run validate` passed. The installed packaging caller tests were
traced by import/callsite inspection but not rerun: this scope changes only
the answer-result discriminator, and the plan's required full offline and
focused gates passed without configuring even a fake provider/proxy.
