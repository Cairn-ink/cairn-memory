# Model-backed value and pilot evidence

This experiment asks two different questions: can a real chat agent use Cairn
across fresh sessions, and does Cairn help answer held-out long-history questions?
Neither offline tests nor one successful chat establishes general memory quality.

The [first retained live report](evidence/first-live-evidence.md) is negative for
long-history QA and includes demonstrated judge false positives. Read it before
using any machine aggregate as a product-quality claim.

## Run boundary

The experiment uses one explicitly authorized cumulative USD20 allowance. The
operator creates one private ledger, then reopens it for connectivity checks,
Hermes, pilot answering/judging and any failed attempts. There is no automatic
renewal. `createLiveSession({ledger, apiKey, fetchImpl})` in
`evaluation/live/session.mjs` requires an existing ledger and explicit one-attempt
transport. It discovers no credentials, does not initialize a ledger, and does
not run a model when imported. The only permitted model is the existing
`gpt-4.1-mini-2025-04-14` baseline; application/provider defaults are unchanged.

The frozen policy conservatively prices standard text input/output at USD0.40 /
USD1.60 per million tokens, from the [official model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Cached-token discounts are not assumed. Host attempts reserve USD0.05; Cairn count
and generation attempts reserve USD0.005 each. Reservations are retained even
when actual usage costs less; unknown costs are not zero. Usage-priced totals
are estimates, not a provider invoice or an invoice-ceiling guarantee.

The temporary loopback proxy is a test bridge, not a hosted product. It binds
only 127.0.0.1, requires a random capability and accepts three fixed POST routes.
Children receive that capability instead of the real provider credential. Every
accepted model request passes through the same reviewed request guard. No SDK
retry or unguarded fallback is permitted. Raw provider errors are not reflected
in HTTP errors or public reports. The operator must still control local files
and processes; this is not a sandbox against a malicious same-user process.

## Value track

Use the frozen A–F prompts and no-memory control in
[first use](hermes-first-use.md). Each stage starts a fresh pinned Hermes agent
process with no prior conversation history. Only its dedicated synthetic Cairn
profile/store persists. Actual discovered tool schemas and actual tool results
are required; the operator cannot manufacture successful responses or repair an
answer. Inspect sources/current revisions and active-state deletion separately
from the final natural-language answer.

This is explicitly requested tool use with a temporary experiment transport
launcher, not automatic capture, a human user study, a stock-host installation
claim or proof of every client's compatibility. Native-host completion must be
reported separately from existing SDK/core lifecycle evidence.

## Evaluation track

The unchanged prepared seven-case LongMemEval-S pilot is checked against its
manifest hashes. Generation uses only history/questions and isolated per-case
SQLite stores. The existing comparison runner supplies Cairn, lexical and
no-memory arms with identical answering contracts, 6000 evidence tokens, 8000
request tokens and 512 output tokens. Three cases may generate concurrently;
all generation completes before any judge receives reference answers.

The pinned `cairn-pilot-judge-v1` rubric accepts semantic equivalence, rejects
contradictions/unsupported additions, requires complete answers and explicit
abstention for unanswerable references, and retains ambiguous judgments as
unknown. The judge is a separate call to the same model, not an independent
human or the official LongMemEval evaluator. Exact-match diagnostics remain
separate. No model/prompt tuning or cherry-picking is justified by this pilot.

Publish each arm's planned, completed, judged, correct and failed counts;
coverage, costs, latency and storage are separate measurements. Preserve failed
generation and unknown judgments. Source traceability does not prove semantic
support, and safety failures are not averaged away by QA accuracy. Raw corpus
and per-case transcripts remain private local artifacts; public results contain
only aggregates, source identifiers and synthetic value evidence.

New pilot aggregates can include a Cairn-arm `ingestionFailure` with exactly
`{stage, reason}`: a finite capture/classification stage and allowlisted error
code from the first recorded failed or partial batch. No memory, source or event
IDs, batch indices, raw results, text or exception properties are added to that
diagnostic. Existing case identifiers remain unchanged. Projection happens again
at the aggregate boundary, so even a private string shaped like a legal error
code cannot be reflected. These fields are local opt-in experiment reporting,
not telemetry or hosted protocol changes; the operator still controls retention.

Preserving a new diagnostic does not recover a missing historical cause. The
original first-live evidence remains untouched. Generation/scoring eligibility,
denominators and the interpretation of partial ingestion do not change. See
[summary acceptance](plans/ingestion-failure-summary.md).

## Offline contributor check

```sh
npm ci --prefix adapters/openai
npm ci --prefix adapters/mcp
npm run test:live-evidence-offline
```

Run on Node22.16 and24. No live invocation or credential discovery is hidden in
the test command. Paid runs require operator-supplied scope, ledger, key and
transport; see [acceptance](plans/live-value-evidence.md). Results must identify
the exact source/artifact hashes tested and retain all attempted runs.

## Explicit operator integration

These modules are opt-in experiment APIs, not an installed consumer CLI. First
create a single authorized private ledger using the documented
[ledger workflow](experiment-budget.md), preserve its directory/runId/limit/cap,
and reopen those exact values for every subsequent stage. Never create a new
ledger to get around consumed reservations. Use synthetic profiles only; do not
point this harness at your normal Hermes home or existing memory database.

An operator script in the checkout can wire the already authorized session:

```js
import { createLiveSession } from './evaluation/live/session.mjs';
import { loadPreparedPilot, runPilot } from './evaluation/live/pilot.mjs';
import { runHermesValueExperiment } from './evaluation/live/hermes.mjs';

// ledgerConfig is the preserved existing ledger identity, not a new allowance.
// Inject only the authorized provider key; never log it or source a whole env.
const session = createLiveSession({
  ledger: ledgerConfig, apiKey: authorizedKey, fetchImpl: globalThis.fetch,
});
try {
  const pilot = await loadPreparedPilot({ directory: preparedPilotDirectory });
  await runPilot({ pilot, directory: newEmptyPilotDirectory, session });
  await runHermesValueExperiment({
    session, hermesCheckout, hermesPython, nodePath,
    cairnExecutable, cairnArtifact, cairnArtifactSha256,
    privateDirectory: newEmptyHermesDirectory,
  });
} finally {
  session.close();
}
```

Supply absolute local paths explicitly. `hermesPython` must be the pinned
checkout's virtual-environment launcher, not its resolved base interpreter.
Use the actual private archive and its recorded SHA256 plus an installation
whose checked core/adapter sources match this checkout. The harness rejects
nonempty profile targets and archive/source mismatches before paid calls.
Record the source hashes and configuration before running. Calls above incur
charges; they are not run by `npm test` or CI. Pilot files must already be
prepared under [the preparation contract](benchmark-preparation.md); raw per-case
checkpoints are sensitive corpus artifacts and must remain private.

The normal offline suite skips the pinned-Hermes integration unless all six
explicit fixture variables are supplied: `CAIRN_HERMES_CHECKOUT`,
`CAIRN_HERMES_PYTHON`, `CAIRN_NODE`, `CAIRN_EXECUTABLE`, `CAIRN_ARTIFACT` and
`CAIRN_ARTIFACT_SHA256`. This opt-in test uses scripted HTTP, not a provider key.
Pure lifecycle predicate tests run without Hermes. A CI skip is not host evidence.
