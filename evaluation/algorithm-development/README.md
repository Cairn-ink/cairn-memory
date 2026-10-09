# Synthetic algorithm comparison

`runAlgorithmDevelopmentComparison({ cases, transport, outputDirectory, onCase })`
accepts the separately validated, deeply frozen 24 source-only cases. Each case
has `{ id, family, question: { text, date }, sessions: [{ id, eventTime,
messages: [{ role, content }] }] }`. The module never imports a rubric or grades
answers. Only an arm with a validated answer has `status: 'completed'`; all
failures and unrun arms remain `unresolved` over 24 cases per arm.

The runner uses existing dated-source preparation, real indexed-evidence
capture with normal classification, cold reopening of the same database, the
existing full-label wrapper, source-evidence recall and verified source-only
answer packing. It uses default selection, bounded-keyset candidate policy and
a six-unit limit in both arms. `bounded-source-scan` is deliberately omitted:
its complete-map shortcut skips selection on small stores. Full labels are the
only intervention; differences in later navigation/ranking inputs are recorded.
ISO event times are rendered consistently as UTC floating-minute source labels.
Receipt `createdAt` remains the normal ingestion stamp, not the event time.

`createAlgorithmDevelopmentTransport({ configuration, checkpoint,
historySha256, apiKey, fetchImpl, onRecord })` opens only an existing schema-2
shared ledger at the exact checkpoint/history. It exposes the pinned adapter's
`model` with extract/classify/select/rank methods and an `answer({question,
units})` method using the exact existing packer. `beginCase({id, ordinal})`
starts capture; `beginArm('baseline'|'full')` begins each one-shot recall/answer
arm, then `endCase()` closes that case. `records()`, `state()`,
`assertHealthy()` and `close()` provide bounded lifecycle inspection. There is
no general HTTP port, environment-key discovery, retry or ledger creation.

The limits are exported as `algorithmLimits`: 40 core calls plus two answers
per case, 1,968 HTTP attempts, 5,000 microUSD reserved per attempt, US$10 local
cap, and US$30 protected under the existing cumulative ceiling. Known valid
usage is priced with the adapter profile even on an overrun; unknown usage
retains its reservation. Authentication, usage, accounting and durable-record
anomalies halt the transport. Other case failures remain in the result.
The 200-second physical transport bound does not extend the unchanged core's
30-second logical call timeout. Case/run upper bounds are 20 minutes/8 hours.

Both callbacks must synchronously durably write their immutable observation
and return `undefined`. HTTP records are emitted before dispatch and after
settlement, keyed by attempt ID. `onCase` emits each completed observation,
including failures and fatal-stop placeholders. The caller owns formal output,
fresh output directory, one-shot marker and manifest freezing; the runner
retains every created database and performs no cleanup. Tests alone use the
existing owned workspace lifecycle.

Run the offline suite with `npm run test:algorithm-development` after
`npm ci --prefix adapters/openai`, on Node 22.16 and 24.15. Neither command
uses a provider credential (the install contacts the package registry).

`launch.mjs` is the primary integration envelope: read-only preparation requires
a clean committed checkout, exact corpus hashes, supported campaign budget and
settled current checkpoint. A separately reviewed manifest must match before
the exclusive start marker and explicit key-provider callback. Reusing an output
directory is rejected, including after key lookup fails. It writes private
pre/post request records, each case, the report and closure record with fsync.
No command auto-discovers a credential or resumes a closed operation.
