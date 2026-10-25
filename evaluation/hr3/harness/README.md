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
A-2 output caps are 4,352 extraction / 2,176 reader, `store:false`, no tools/prior state.
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
monitor/notification service. No paid-stage readiness, adjudication calibration,
continuation gate, or research accuracy
claim follows from these offline tests.

A-2's current certificate is `reports/cap-certification-a2.json`. It reads the
frozen pilot and independently authored engineering fixtures only; generator
entry-point imports are blocked by a fresh-process guard test. No development or
test worlds are generated. The engineering cases reach 1,867 reader / 3,751
extraction tokens: both pass the required 10% margin at the revised caps
(14.20% reader / 13.81% extraction). The
original failing certificate remains in `reports/cap-certification.json`.

`reports/inspected-heldout-references.json` records the 504 published reference
cases from `aa3b0a14`: 77 families and 33 development + 33 test lineages. They and
their declared derivatives are excluded from calibration and tuning by identifier
or serialization hash; unretained rendered worlds are not claimed to be fresh.
The existing calibration/fresh-bank/allocation gates remain binding. After those
gates, render and recertify replacement banks before any paid held-out call.

Revised A-2 separates three budget findings in `reports/budget-a2.json` and
`reports/budget-a2.md`. Pilot budget fit is the binding pre-pilot criterion:
$17.510400 responses + the entire $2.56 shared embedding allowance = $20.070400,
below $24. The $614.748160 theoretical all-maximum-plus-retry envelope is not
covered, but this informational finding no longer blocks pilot budget fit or
decides later-stage feasibility. Later-stage feasibility is pending real paid
pilot settlement, not inferred from the forecast or fake transport.

Before development, freeze the exact inputs described by
`reports/pre-development-projection.schema.json`. Its integer arithmetic covers
all settled experiment spend, full outstanding reservations, every remaining
stage, research/P embeddings, alternative extraction and contingency. Require
projected completion <= $400 and every stage limit. Any rederived stage limits
must fit within $450 and be disclosed/frozen before development. Dynamic stage
and $450 hard stops, $500 authorization, complete-test requirements and
Inconclusive-on-exhaustion remain unchanged. Projection does not guarantee
completion and is not computed in this offline task.

Regenerate the exclusion manifest, projection schema, certificate and budget
with `inspected-references.mjs`, `projection-schema.mjs`, `cap-certification.mjs`
and `budget-a2.mjs` in this directory, in that order. The certificate and budget
commands both exit 0: the revised caps meet the headroom requirement and the
conservative pilot total is below $24. The prior engineering failure is retained
in `reports/cap-certification-a2-pre-cap-revision.json`.
After the full harness tests, `freeze-a2.mjs` regenerates the applicable manifests
against the current errata hash, preserving the prior harness freeze as history.



## Audit re-check R3 records

`reports/a1-r3-stopped-pilot.json` is the current stopped-run CLI example.
`reports/a1-fake-pilot.json` and `reports/REVISION-ff192c6b.md` are preserved
historical artifacts from the preceding implementation. Current finding/fix/test
mapping and the fixture-rebalancing disclosure are in `REVISION-REPORT.md`.

## Provider-schema correction before the paid pilot (2026-10-25)

The first paid pilot attempt (run `pilot-15b8f1a7`) stopped at its first request. OpenAI rejected the structured-output schema with HTTP 400 `invalid_json_schema`: "schema must have a 'type' key" for `const`-only nodes. The ledger stopped as designed, with one unsettled reservation of US$0.0117. Rejected requests are not billed.

`providerSchema()` now adds the JSON type implied by a `const` value to such nodes. This changes only the provider-facing schema encoding. The answer and extraction schemas, validators, prompts, caps and scorer are unchanged.

Two out-of-ledger diagnostic probes confirmed that both schemas are accepted. They used `max_output_tokens: 16` and cost about US$0.0007 in total, which is recorded here and counted toward the HR-3 authorization.

## A-3 extraction amendment (offline implementation)

Extraction quotes now use `{turn_id, quote, occurrence}`. Occurrences are
one-based exact matches, including overlaps, for extraction anchors only. Reader
citations retain their existing ambiguity check. JavaScript string search
computes UTF-16 offsets for internal source maps. Supplied offsets are ignored;
there is no normalization, fuzzy matching, or gold-assisted repair. Missing or
ill-typed anchor fields are schema failures. A nonexistent occurrence or
non-verbatim quote excludes its event and its dependent reason edges.

Schema-invalid or unparseable output fails the batch. Otherwise every event is
checked independently; valid events survive, and zero survivors is a successful
empty extraction. Within-batch duplicate event IDs exclude all events sharing
that ID. Before arm fan-out, `event-identity.mjs` replaces retained provider IDs
with canonical JSON keys `[family_id, batch_ordinal, raw_event_id]`. Raw IDs,
internal keys, and opaque reader aliases are recorded in extraction diagnostics. Source-turn predecessor
anchors and semantic fields are preserved. P selects only newly received keys,
including when an already received batch is submitted again.
Cached records and `extraction-summary.json` retain event indices/IDs, all
rejection reasons, and indices of edges with invalid quotes. `summary.json` and
the bound report include `pipelineStageDiagnostics`: one row per shared batch,
with valid/rejected event counts, overlapping reason counts, empty batches and
batch failures. These are pipeline diagnostics, never arm accuracy estimates.
Older runs without these diagnostics are marked unavailable, not zero.
Provider-format quote fixtures are constructed only in extraction tests; the
shared internal offset fixtures and their frozen research-state expectations
are unchanged.

`test/fixtures/pilot-cf24810f.jsonl` contains only the 240 original cached bodies
and replies plus their request keys. `replay-a3.mjs` produces
`reports/a3-offline-replay.json`, including every batch's retained-event count
and exclusions. Legacy quotes lack occurrence; this diagnostic explicitly
assigns occurrence 1. Live validation never supplies that default. The first
pilot stays a separate engineering finding; no replay result tunes the system
or enters pooled scores. No paid rerun is performed by this offline task.

Run the attended sequence from the repository root:

```sh
node evaluation/hr3/harness/verify-a3.mjs
```

Each invocation creates a fresh `artifacts/a3-verification-*` destination.
The sequence checks both
provider schemas and replays the fixtures, then regenerates the inspected
exclusion manifest, projection schema, output certificate, complete-request
certificate, and budget in that order. It then runs all generator tests, all integration tests, and
all harness tests, in that order. The harness suite includes its own full fake
pilot. After the suites pass, the sequence generates only pilot inputs, runs
a separate full fake CLI pilot, independently scans its exact reader bodies
and P ingestion payloads with `leak-scan.mjs`, and writes a bound report.
`freeze-a3.mjs` runs last, preserving the prior freeze in
`reports/freeze-pre-a3.json`. The first failed verification is retained as
`reports/a3-verification-first-failure.json`. Every child exit code and log hash
is recorded;
the sequence stops at its first failure. The generator test's existing temporary
directory is redirected into harness artifacts without changing sibling files.
This command is attended and supplies no unattended agent supervision.

Prompt changes cover only revised E-1 and the extraction quote-format
instruction; the stale request for model-computed offsets is removed. Models,
output caps, policies,
scorer, arms, and development/test materials retain their frozen definitions.
`strict-schema.mjs` checks every schema node's type, closed concrete objects,
required properties, references and `anyOf` offline; it makes no provider call.
The A-3 combined pilot budget now uses exact hash-verified ledger exposure.

`request-certification.mjs` certifies complete provider JSON bodies, including
schemas, prompts, checkpoint questions/metadata and both delivered intents.
It uses the real tokenizer, every pilot family and all 180 independent engineering
reference structures for U/T/O under two legal deterministic embedding fixtures.
P is exercised through public operations for all 60 pilot families plus 36
maximal engineering graph/language/boundary cases. Its actual response envelope
is counted as well. Existing whole-item delivery budgets and P's public
`maxTokens: 2000` argument are unchanged. No evidence is truncated to satisfy the
provider framing bound. Exact P identities and token selections can vary across
fresh stores; the observed worst bodies and their hashes are retained.

`reports/request-certification-a3.json` records each measured request, the worst
complete bodies, and the auditor's original U/T regressions (20,855 and 24,133).
Input reservations remain complete-body UTF-8 bytes plus 4,096. The extraction
ceiling is 16,384. Reader ceilings are U/T/P 30,000 and O 22,000, enforced from
frozen reader call IDs before dispatch. Certification requires 5% input headroom,
separately from A-2's 10% output margin. The pilot budget uses equal call counts
per arm, an effective reader ceiling of 28,000, rather than incorrectly charging
every O call at the U/T/P maximum. Unclassified standalone reader requests use
the global 30,000 ceiling; the runtime plan permits only classified arm calls.

A fresh run can supply cumulative exposure with:

```sh
node evaluation/hr3/harness/cli.mjs --stage pilot \
  --inputs GENERATED_PILOT --out NEW_RUN \
  --carry-forward evaluation/hr3/harness/reports/a3-carry-forward.json \
  --mcp-dependencies adapters/mcp/node_modules \
  --tokenizer-dependencies adapters/openai/node_modules
```

The carry-forward manifest is `hr3-carry-forward-v1`, with `ledgers` containing
repository-relative `{path, sha256}` entries and `preparation` containing
`{complete, receipts}`. Each preparation receipt is hash-pinned JSON containing
`version: "hr3-preparation-charge-v1"`, `charge_id`, `stage`, exact integer
`settledNanodollars`, `outstandingNanodollars`, and
`embeddingUnits: {research, product}`. Only the primary can attest that all
preparation charges are included; rounded spending is never a receipt.

`accounting.mjs` verifies source bytes, complete hash chains, reservation/usage
arithmetic, provider IDs, inherited carry snapshots, and disjoint source
ancestry. Already settled charges, full unresolved reservations, and reserved
embedding units seed the new journal's immutable configuration. Reopening a
writer must reproduce the same verified carry input. Stage, operational,
authorization and shared embedding limits apply to cumulative exposure before
any new dispatch. Carrying prior exposure grants no ability to settle old
reservations from a new journal.

The manifest preserves the exact first-pilot ledger and the earlier
schema-rejection ledger, whose reservation remains carried in full. Preparation
receipts now record the complete primary-attested inventory: two schema probes
(input/output 946/5 and 751/16 at the frozen prices, 712,400 nanodollars total),
three unbilled model availability lookups, and the single HTTP 400 unbilled
rejection already covered by the old ledger. The probe receipt adds a separate
1,000,000-nanodollar conservative hold. Completeness is true; receipts are pinned
by hash and probe usage arithmetic is checked. The rejection receipt references
the existing reservation without duplicating it or silently releasing it.

A combined ceiling above $24 or incomplete preparation accounting makes the
budget command fail before tests or another fake pilot. The existing retries,
output requirements and resource allowances are unchanged.

The source-only occurrence-1 replay separately reproduces 730/725/723 event
quote counts and 973/968/965 including edge quotes; 605 of 728 events remain
formally valid. It reproduces 55 families with cross-batch ID collisions,
257 duplicate-ID errors (56 adopted), and 68 eligible earlier adopted events
reselected by P's former filter. The shared internal-key boundary eliminates
these identifier errors and reselections without changing extraction semantics.

## Private-label isolation after the A-3 recheck

Global keys and original fixture labels remain private diagnostics. The research
serializer uses 128-bit opaque record aliases consistently for record IDs,
predecessors and supporting-event references, and record-local opaque aliases
for reason-node IDs and edge endpoints. Claims, scope, intervals, source quotes,
causal direction and update policies are preserved. Internal reducer-state
fixtures stay unchanged; only their serializer hash expectations change.

Controls are authored neutrally in the harness before public P ingestion:
invoice titles and assertions, edits, replay content, action IDs, and namespace
aliases contain no family or lineage markers. Dependency revisions, authoring
paths, authorized/unauthorized operations, named forgetting, independent copies
and foreign isolation retain their behavior. Generator controls remain private
fixture specifications; `generator/` and its frozen pilot are untouched.
P's returned context text is never redacted or rewritten.

`privacy.mjs` checks the complete exact reader request body before dispatch and
checks actual P public-operation arguments before ingestion. It rejects known
family/lineage/namespace identifiers, split and condition identifiers, private
metadata fields, seeds, schema labels and additional declared private labels,
including escaped nested JSON. Source-supported semantic terms such as the
extractor's `change_type: correction` and the frozen reader prompt's expiry rule
remain public semantics; they are not author-assigned fixture identifiers.

`privacy-scan.json` retains execution-time hashes and scan results as private run
diagnostics. `reports/privacy-scan-a3.json` is the independent full-pilot recheck:
120 exact requests per arm, every recorded P public-operation payload, and byte
comparisons between both saved P delivery blocks and the corresponding raw MCP
responses. Any label hit fails verification. The complete-request certificate
uses the same isolation and guards before measuring framing bounds. Its
historical audit reservation figures retain the old finding; current regression
rows and worst-body measurements are recertified with the opaque aliases.

The first privacy-guarded request certification stopped on the administrative
"Engineering stress" prefix in independently authored reference questions.
Those questions now use the neutral "At this checkpoint" prefix before request
construction. Requested answer content and source structures are unchanged.
The stopped verification record is retained in
`reports/a3-privacy-first-failure.json`; the guard was not weakened.
