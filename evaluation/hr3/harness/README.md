# HR-3 offline execution harness

Node 22.16+ ESM, built-ins and the product's existing MCP/tiktoken dependencies.
No dependency installation, credential access, HTTP client, or network call is
implemented. All research dispatches, including nested P embeddings, go through
an injected transport and a durable reservation journal.

Regenerate the frozen pilot into a fresh directory, then run the fake CLI:

```sh
node evaluation/hr3/generator/cli.mjs --split pilot --out <TEMP>/hr3-inputs
node evaluation/hr3/harness/cli.mjs --stage pilot --inputs <TEMP>/hr3-inputs --out <TEMP>/hr3-pilot
```

`--stage smoke` uses the first two frozen pilot families. The CLI always uses
`FakeTransport`. A pilot writes 240 cached extraction replies, 480 deliveries,
480 reader replies, 480 scorer outputs, checkpoint/final arm states, the paid-API
journal, and aggregate JSONL/summary files. The scorer is called directly through
its exported `score` interface. Referrals remain pending; no adjudicator runs.

If this checkout has no installed product dependencies, point at **existing**
installations using `--mcp-dependencies <deps-worktree>/adapters/mcp/node_modules` and
`--tokenizer-dependencies <deps-worktree>/adapters/openai/node_modules`. This only changes
module resolution; it does not copy/install packages or contact a registry.
The actual `o200k_base` encoding is used; there is no production token-counter
fallback. The runtime verifies 195 product files against the P pin.

Run only this harness's tests:

```sh
node evaluation/hr3/harness/test.mjs
```

The same dependency-path flags work here. Tests include a complete fake pilot
and two independent smoke runs. To validate an already completed CLI pilot
instead of repeating it, add `--pilot-artifacts <TEMP>/hr3-pilot`. Unit tests and
smoke determinism still execute. No sibling or broad product suite is run.

## Revised A-1 bound report

For a completed or interrupted fake/authorized engineering pilot, run:

```sh
node evaluation/hr3/harness/cli.mjs --bound-report PILOT_OUTPUT --inputs GENERATED_PILOT --out NEW_BOUND_REPORT.json
```

This flag reads and verifies recorded artifacts, including stopped/incomplete runs; it does not execute a stage or
load product/tokenizer dependencies. Output is a JSON report with the exact label
“Uncalibrated engineering pilot — mechanical score bounds; no adjudication.”
It contains 48 aggregate table rows: four arms × two separate checkpoints ×
(overall + five change types), plus per-family C/O/R/J bounds. Each table includes
score-state counts, pass-specific outstanding referral applications, unique keys
and repeat/propagated applications, planned/attempted/valid-completion and failed/
unexecuted denominators, represented family/lineage IDs, applied weights, and
separate unresolved-J and any-referral shares (counts and weighted shares).

`bounds.mjs` maps scores 0/1/null to [0,0]/[1,1]/[0,1] without reopening a
mechanical score because a pass is outstanding. It multiplies C/O/R endpoints
within a family, then averages lineage means using frozen 1/30 overall or 1/6
within-type weights. Failed attempts remain scored. Missing cases are listed;
partial groups explicitly condition on represented lineages and normalize their
frozen weights. No observations means null rates, never observed failures.

`run.json` captures execution-time protocol/errata, generator and scorer/harness
hashes. Reports retain those hashes, verify the recorded stage manifest and
input bytes, and include actual spend (zero for fake transport), separately from
simulated ledger charges. Old stages without execution-time hashes must be
rerun; the report never substitutes current hashes for historical provenance.
The writer requires hash-verified pilot artifacts and a new output file.
It preserves `complete:false`, stop reasons, attempted scores and all unexecuted
IDs. Every interrupted aggregate is labeled “partial observed cohort; not
completed-pilot bounds”. Reporting never resumes execution or approves
continuation. The journal is read and its hash chain checked without opening a
ledger writer. Settled charges and outstanding reservation IDs/ceilings are
separate. With real unsettled billing, `actualSpendUSD` is null and
`actualSpendKnown` is false; settled spend is still reported. Fake actual spend
remains zero. A completed run is not required for reporting. Sampling confidence
intervals are deferred. These descriptive bounds cannot produce an Advance/Keep
decision, enter development/test estimates, or certify factual accuracy.

## Injected transport contract

See `transport.d.ts` and `requests.mjs`. `Transport.send(request, {signal})`
performs exactly one dispatch and returns the observed model, actual provider
request ID, raw text or embedding vectors, completion status, and full billed
input/output usage. The primary supplies the real client outside this directory
and obtains its credentials itself. A client must send the validated `body`
verbatim, honor abort, disable SDK retries, and preserve malformed/refused replies.
Only `TransportError` permits the one harness transport retry. No response repair
or semantic-quality retry exists.

Use `GuardedTransport(realTransport, ledger)` and `createEmbedder(guarded, ...)`.
Do not call a provider from an embedder directly. Embeddings are 1,536-dimensional
`text-embedding-3-small`, with hosted fusion configuration. P batches are refused
as submitted if bounds fail; the harness never splits/truncates P input. Research
bodies can be explicitly batched at 64 inputs. The fake uses deterministic hashed
word vectors and a deliberately incomplete source-only parser. Its normal reader
returns schema-valid `unresolved`/`unavailable` answers; this verifies execution,
not model accuracy. `modes` can inject malformed, truncated, model-mismatched or
transport-failure replies, and `replies[bodyHash]` supplies explicit canned replies.

## Frozen execution choices

`requests.mjs` freezes the prompts and strict Responses bodies. Primary calls
use temperature 0; alternative extraction uses reasoning none and no temperature.
Output caps are 1,024 extraction / 768 reader, `store:false`, no tools/prior state.
The scorer's Answer schema is preserved semantically, converting `oneOf` to
provider-supported `anyOf` for disjoint tagged variants and pruning unreachable
schema definitions. Extraction outputs contain exactly the §2 fields, with
field/value assignments, source-turn/record-name anchors, and causal-edge quotes.

`research.mjs` freezes compact canonical JSON bodies, separate original quote
units, exact extensional scope keys, per-field/per-cell T materialization, U
version selection, and destructive O projections. The hand-written tests cover
all nine required update cases. Bodies use BM25-T1 (1.2/.75), equal-weight
RRF k=10, channel depth 24, twelve selected candidates per intent, and whole-item
assembly under 2,000 actual serialized tokens per intent. No raw source offset is
used as a delivered citation offset; scorer delivery units retain source maps.

P uses only `core/index.mjs`, `adapters/mcp/server.mjs`, and public SDK calls over
an in-memory MCP connection. Each family gets a separate private file-backed
temporary store, removed after its public operation trace is saved. MCP performs
correction and context retrieval. Core public operations perform admission,
supersession, forgetting, Card/method authoring and bounded refresh. Cards,
methods, dependencies and context-read are enabled; optional MOC/relation sources
are absent. Refresh and both MCP retrieval tools run independently per intent.
Reader input contains the actual representation-v2 text blocks; diagnostics,
snapshots, raw sources and scorer gold never enter it.

P's scheduled expiry re-inspects identity/revision/currentness/deadline content,
records before/after results as `adapter-scheduled`, and never creates an answer
archive. Corrections do not inherit absent deadlines. Named forgetting is checked
by identity; independent copies remain. E-2 fixtures explicitly distinguish confirmation with dependencies and no later
null declaration from confirmation without dependencies plus separate declaration.
The runner executes either supplied path verbatim; reviews use inspected positive revisions.
Fixture Card edits retain inspected public bindings because the generator's empty
binding list is refused by the pinned API. This discrepancy needs upstream review.

Research/fake bytes and scores are deterministic. Raw P identities, fingerprints,
snapshot fences, timestamps and timings are the actual pinned product outputs and
can vary across fresh stores; they are retained rather than rewritten. Tests
compare research bytes and all-arm scored outcomes across independent executions.

## Accounting and restarts

The append-only journal uses an exclusive directory lock, hash-linked records,
fsync before dispatch, integer nanodollars and immutable prices/plan/caps. Each
retry reserves independently. Unknown charges retain the full reservation.
Settlements are unique by provider request ID and cannot exceed input/output
bounds. Byte bounds count the complete provider body plus 4,096; ceiling failures
occur before dispatch. Embeddings reserve sum(bytes+16), with per-input, batch,
aggregate, request-body and separate 64M research/P unit limits.

Stage limits are $24/$46/$345/$45 for pilot/development/test/alternative,
subordinate to $450 operational and $500 authorization with $50 unavailable.
Use one shared journal and one frozen combined plan across paid stages: changing
stage does not reset totals. Configuration changes, stale locks, incomplete or
corrupt records, repeated reservation IDs, and unlisted dispatches fail closed.
The smoke allowance is the pilot allowance, not an additional paid entitlement.

A transport timeout aborts a hung dispatch. Three cumulative transport failures,
five minutes without completed dispatch progress, model/accounting mismatch,
unexplained usage, authorization exposure, or budget exhaustion stop execution.
The runner persists completed answers and public operations on failure. A crash
between settlement and extraction-cache publication requires reconciliation;
reserving the same ID again is prohibited. Cached extraction replay validates
request, reply and record hashes and performs no dispatch. The CLI requires a
fresh output directory; it does not silently resume partially executed P stores.

The CLI is attended and exits after completion. It provides no unattended agent
monitor/notification service. No paid-stage readiness, maximal-reference 768-token
certification, adjudication calibration, continuation gate, or research accuracy
claim follows from these offline tests.


## Audit re-check R3 records

`reports/a1-r3-stopped-pilot.json` is the current stopped-run CLI example.
`reports/a1-fake-pilot.json` and `reports/REVISION-ff192c6b.md` are preserved
historical artifacts from the preceding implementation. Current finding/fix/test
mapping and the fixture-rebalancing disclosure are in `REVISION-REPORT.md`.
