# Local MCP source preview

`recall_memory` can opt into `contextMode: "source-evidence"` to rank and return
complete retained sources instead of generated summaries and qualification
labels. In this mode, omit includeQualification or set it false; explicit true
conflicts. Existing defaults are unchanged without contextMode or the startup
option below. See
[source evidence context](source-evidence-context.md) for limits and examples.

To select that presentation by default for one local server, start with
`--recall-context source-evidence`, or pass `recallContext: 'source-evidence'`
to `createCairnServer`. A call with an explicit `contextMode` wins, including
`rationale-evidence`; `includeQualification: false` does not turn off the
source default. To use legacy summary context by default, restart without
this option. `inspect_memory` remains available for explicit interpretations.
The option does not enable capture, source snapshot, staging, or a provider.
Recall still needs a configured model; keyless remember and inspection still
work. Complete retained excerpts can expose more source text than legacy
summary-oriented context, within the same namespace and budgets. Sources do
not establish truth, current applicability, or execution authority.
This is a runtime MCP flag, not an `install:preview` option. For an installed
preview, append the flag/value pair to the generated `stdio.args` in your MCP
client (or invoke the installed executable with them); the installer receipt
itself remains unchanged.

The thin MCP host exposes the existing public core; it is not a second engine
or a client that requires a Cairn cloud account. This package provides source-run
stdio transport. Registry packaging, named-client compatibility and remote
connectors are separate acceptance gates. General memory quality is evaluated
separately; a protocol test does not establish relevance.

## Start from source

### Keyless complete-source walkthrough

After installing the two isolated adapter dependency sets shown below, configure
your local MCP client to launch:

```sh
node adapters/mcp/cli.mjs --db /absolute/path/to/memory.sqlite --owner local-user --source-snapshot current-admitted-v1
```

No API key is needed. To check syntax, place `--check-config` before `--db`;
the check loads no tokenizer, opens no database and contacts no provider.
Normal opted-in startup loads the existing local `o200k_base` tokenizer. Default
keyless startup does not load it. This independent flag adds only
`read_memory_sources`; capture, qualification and staging remain separate options.

In your MCP client, explicitly call `remember_memory` with synthetic content
such as `{"content":"I might use the blue desk for now.","kind":"preference"}`.
Close the client session, reopen with the same database/owner/project, and call
`read_memory_sources` with `{}`. It returns exact retained excerpts with
`coverage: "complete-current-admitted"` and `semanticCoverage: "unassessed"`.
Inspect the memory's revision and call `forget_memory` to remove it; a later
snapshot excludes it. These operations make no provider requests.

The read tool accepts only `limit` (1–12, default 6) and `tokenBudget` (1–4,000,
default 4,000). It delegates to [the shared snapshot](bounded-source-snapshot.md)
using the startup namespace. Whole-set overflow fails without partial evidence
or fallback. The token budget measures the **core success envelope** using
`o200k_base`; the byte ceiling is 24,000 UTF-8 bytes. Neither includes MCP framing,
the transport trust wrapper, or the host's entire model prompt.

This exposes the whole small current-admitted set, including potentially
unrelated personal sources. It is not full conversation history, relevance,
truth, continuing applicability or execution authority. Historical, deleted
and staged sources are excluded. Semantic recall and capture still require
separately configured generation methods. No answer is generated or repaired.

Programmatic hosts use `createCairnServer({path,namespace,
sourceSnapshot:'current-admitted-v1',model:{countTokens}})`. The callable counter
is required before database opening. The optional OpenAI adapter's narrow
`countOpenAITokens` export reuses its existing local counter without credentials
or provider model creation. Custom counters retain the shared core's synchronous
exact-tokenizer requirements and failure checks.

### Source startup commands

On Node >=22.16, from the repository root:

```sh
npm ci --prefix adapters/mcp
npm ci --prefix adapters/openai
node adapters/mcp/cli.mjs --db /absolute/path/to/memory.sqlite --owner local-user
# Optional source-first presentation for recall_memory:
node adapters/mcp/cli.mjs --db /absolute/path/to/memory.sqlite --owner local-user --recall-context source-evidence
```

The database parent directory must exist and be controlled by you. Supply
`OPENAI_API_KEY` via the process environment/secret manager to enable model-based
recall. Without it, explicit remember/inspect/correct/forget work, but recall
returns `model_not_configured`; it never silently substitutes lexical lookup.
The optional OpenAI adapter sends selected inputs to OpenAI and may incur charges.
The live-test guard is not a production per-user spending limit on this host.

The server waits on stdin; stdout is reserved for MCP JSON-RPC. Configure your
local MCP client to spawn that exact Node command with the same arguments and
an appropriate working directory. Do not place a key in command-line arguments
or committed client configuration. This document does not certify any particular
client/version; source protocol tests use the official SDK client.

`--db` and `--owner` are required. `--project PROJECT_ID` optionally binds this
server to that project instead of personal scope. Use separate configured server
instances for separate scopes. Owner/project identifiers are local trusted
configuration, not an account system or an authentication boundary against
someone who can edit your process configuration or read your database file.

## Tools

| Tool | Input | Behavior |
| --- | --- | --- |
| remember_memory | content, optional kind | Explicit memory plus receipt derived from supplied content |
| recall_memory | query, optional limit (1–12), includeQualification, contextMode, selectionMode | Same bounded model-driven core recall; source qualification defaults on with qualified capture unless source context is resolved |
| inspect_memory | memoryId with optional receiptLimit/receiptCursor/includeQualification, OR limit/cursor/states | Page through receipts and optional qualification for one memory, or list this namespace with optional active/historical filtering |
| capture_memory (opt-in only) | batchId, messages containing role/content | Explicitly submitted extraction and source qualification; no automatic retirement |
| inspect_capture_admission (opt-in only) | batchId | Keyless admission-only status and bounded fresh member refs; classification always unknown |
| classify_unfiled_memories (opt-in only) | refs: 1–5 unique memoryId/revision pairs | Explicit, guarded model classification and placement of current unfiled memories |
| correct_memory | memoryId, expectedRevision, content, optional kind | Compare-and-set correction with a new explicit receipt |
| forget_memory | memoryId, expectedRevision | Compare-and-set logical deletion and suppression |

Remember/correct text is limited to 600 characters; kind defaults to fact.
Inspection list/receipt pages default to 20 and cap at 50; use nextReceiptCursor
as receiptCursor to continue receipt inspection. List and receipt parameters
cannot be mixed. Unknown fields, including
owner/namespace/readSet/path tool arguments, reject. Scope is fixed at startup.
Tool results carry the core success/error envelope as JSON text. Memory content
and receipts are explicitly untrusted data, not instructions for the client.
Tool receipt text is the supplied assertion, not proof that the assertion is true
or an authenticated transcript of what a human said.

### Explicit classification of unfiled memories

Add `--classification-recovery guarded-v1`, or set
`classificationRecovery: 'guarded-v1'` on `createCairnServer`, to expose
`inspect_capture_admission` and `classify_unfiled_memories`. The option is
independent of capture and adds two tools to the five-tool default. A keyless
server still offers inspection; calling classification without a model returns
`model_not_configured`. `--check-config` reports the option and whether a model
key is present without opening the database or contacting a provider.

To recover a lost capture response, call
`inspect_capture_admission` with `{"batchId":"the-original-batch-id"}`. The
read uses the server's fixed namespace and local MCP client; it does not call
capture or a provider, claim an expired lease, or retry anything. `absent` and
`pending` return no members. `completed` means admission committed, not that
classification succeeded. It returns the existing bounded `suppressedCount`
and at most five committed distinct members in stored order. A current member
contains only `status: "current"`, `memoryId`, its **fresh** `revision`, and
per-member `filing.status`; a historical, forgotten or missing member is
`status: "closed"` with no actionable ref. No content, receipts, digest,
lease token or submitted source text is returned. Empty members can mean an
empty completion or all inputs suppressed; the count distinguishes these.
Classification remains `{"status":"unknown"}` even when every member is
filed or an empty-parent proposal leaves a member unfiled. Neither state
proves classification succeeded or failed.

Inspect each memory first, then explicitly submit its current reference:

```json
{"refs":[{"memoryId":"id-from-inspection","revision":1}]}
```

The tool accepts one to five distinct references in the server's configured
namespace. It checks all are present, active, at those exact revisions and
unfiled before contacting the model. The model sees bounded current memory
content, classification metadata and the existing topic catalog; this may incur provider
charges, and this host has no account spending cap. The core checks revisions
again during classification and atomic placement. Concurrent calls may both
spend model requests. If one changes placement, the other's stale guards stop
a conflicting change; no-op proposals can both succeed. A stale reference must
be inspected again; an already filed memory is ineligible. The tool never
retries automatically.
A correction invalidates its old reference, while a fresh inspected reference
to the corrected active unfiled memory can be classified without changing its
corrected content or source receipts.

The result reports `status: "applied"` for the placement operation and returns
actual memory revisions, filing statuses and placement metadata. An applied
proposal with no parent can leave a memory unfiled. Another explicit request
with the same refs can classify it again. Applied does not certify filing quality
or source truth. This tool does not extract, admit, recapture,
change receipts, review rationale, prove a failed capture batch or treat
remembered consent as authority. Capture duplicate behavior is unchanged.
There is no durable incomplete-classification journal or whole-capture 30-second
deadline; this is a bounded explicit operation, not S1 completion.

If a trusted local caller uses [core supersession](supersession.md), inspection
also includes labeled historical memories. List pages remain metadata-only;
ID inspection retains the old body/receipts and bounded replacement references.
Historical does not mean current: recall excludes these records, correction is
rejected, and forgetting remains available at the inspected revision. Supersession
is not deletion or secure erasure; historical evidence remains until separately
forgotten. No new supersede tool or passive capture is added to MCP. The opt-in
submitted capture tool below does not establish chronology or retire memories.
Stop all old-runtime processes/connections, including idle readers, before the
v8 database upgrade; mixed-version coexistence is unsupported.

### Inspect an explicitly requested change history

This workflow needs neither a model key nor a provider call:

1. Call `inspect_memory` with `{"states":["historical"],"limit":20}`. Use
   `nextCursor` as `cursor` with the same filters for more metadata pages.
2. Inspect a returned ID with `{"memoryId":"the-returned-id"}` and page its
   receipts with `receiptCursor`. The response identifies retained historical
   content and, when available, a `supersession.replacement` reference.
3. Inspect that recorded successor ID. Match its receipt IDs against the old
   record's `supersession.receiptIds` before describing a change. Follow further
   recorded links only as needed; no automatic chain traversal is implied.

Absent `states`, listing still includes active and historical records.
`["active"]` filters to active records, and either ordering of both states is
equivalent to the default. Empty, duplicate or unknown states reject; states
cannot be combined with `memoryId`. Each call is scoped to the configured owner
and project. Mutations invalidate list/receipt pagination rather than returning
cached evidence. Explicit forgetting removes the record from inspection.

These calls are separate reads, not an atomic multi-tool snapshot. If a link or
its bound receipts are no longer available, re-inspect rather than silently use
a new successor revision as the original evidence. A source may document a change
without documenting a reason: say "no reason recorded" in that case. A citation
must support the explanation, not merely mention the same subject.

Historical records are retained supersessions, not a guarantee of what was true
on a date or a full log of overwritten corrections. Timestamps are not inferred
real-world validity periods. Tool guidance does not prove an agent will select
these calls or interpret the evidence correctly; interactive-host and model
quality remain separate gates. Recalled consent never grants execution authority.

Supported secret shapes are redacted in storage and before recall sends a query
to a model; redaction is best effort, not complete secret detection. The server
does not capture transcripts or install hooks. Forgetting is not secure disk
erasure; SQLite/WAL/backups may retain old bytes. Protect the database directory
and review provider retention policy before handling real conversations.

## Opt-in submitted source-qualified capture

Add `--capture-qualification source-bound-v2` (or the compatible v1 mode) to expose
`capture_memory` as a sixth tool. Absence retains the existing five tools; invalid
settings reject before opening storage. Library hosts can supply the same
`captureQualification` constructor setting to `createCairnServer`. The namespace
and mode are snapshotted at construction, never selected by tool arguments.

V2 asks the model to select source evidence per interpreted field; the shared
core computes exact quotes, character offsets and field coverage. V1 retains
its original model-written anchor contract. Both store the same S1 metadata,
and neither proves interpretation or authorizes automatic replacement. Reusing
a completed batch under the other mode fails rather than reinterpreting it.
See [core-owned evidence candidates](capture.md#core-owned-evidence-candidates-v2).

```json
{
  "batchId": "synthetic-note-001",
  "messages": [
    {"role": "user", "content": "I am considering taking the train on Fridays."}
  ]
}
```

Submit only messages the user actually intends to save. This does not read a
transcript, install a hook, authenticate a human speaker or establish execution
permission. User/assistant roles and text are caller-submitted claims, not a
verified transcript. Reuse the same batch ID and payload only where replay is
allowed; do not invent a fresh retry ID after failure. Staged failures are
inspect/discard-only, not automatically retried. Completed live-stage replay makes no model calls;
changing canonical content, role or order at the same batch ID conflicts.

Batch IDs use the core's 200-unit opaque identifier rules. Supply 1–24 messages,
each with 1–4000 UTF-16 units; the canonical total must not exceed 20000. The
core rejects malformed Unicode and applies normalization and best-effort secret
redaction. The server fixes client `cairn-local-mcp` and session
`submitted-capture`; each source message ID is SHA-256 of the JSON array
`['cairn.mcp.submitted-message.v1',batchId,index]`. These deterministic identifiers
support replay, not authentication or encryption. Do not put secrets in batch IDs.

The same core performs bounded extraction, then one qualification batch against
the exact retained receipt excerpts (at most 800 UTF-16 units). This requires a
configured model key and transmits selected text; it can incur charges, with no
account spending cap. Empty extraction skips qualification. Missing model or
invalid qualification fails explicitly without partial memories. Qualifying an
existing unqualified duplicate fails rather than backfilling its provenance.
Provider credentials remain environment-only; configuration checking verifies
neither credentials nor model availability and contacts no provider or database.

`capture_memory` v2 results include `retainedSourceWindow`: the per-message
800 UTF-16-unit limit and indices with omitted normalized source tails. V2
extraction uses those same retained prefixes; tail-only facts are unavailable.
Full-text changes still conflict with an existing batch ID. This field describes
source retention, not semantic completeness or how an older duplicate was
originally extracted. The client cannot override the source window.

### Optional staged source inspection

Add `--capture-evidence staged-v1` alongside
`--capture-qualification source-bound-v2` to retain a bounded source view
atomically before extraction. This explicit option adds `inspect_capture_evidence`
and `discard_capture_evidence`; it does not install hooks or change ordinary recall.
Both tools accept only `{batchId:"your-original-batch-id"}`. Namespace and client
are fixed by startup, never supplied by the tool caller. Staging requires v2;
invalid combinations reject before database access. Programmatic servers use
the equivalent `captureEvidence: 'staged-v1'` setting.

To inspect or discard after restarting without enabling new retention, use
`--capture-evidence-access staged-v1` alone (programmatic `captureEvidenceAccess`).
No qualification option or API key is needed. This access-only configuration
exposes seven tools, not `capture_memory`; staging implies access and exposes
eight tools without the separate rationale option. Existing default/v1/v2
discovery stays unchanged when neither new option is set. `--check-config`
reports access and retention separately and remains syntax-only.

The tools return the shared core's [staged evidence contract](staged-capture-evidence.md).
Failed extraction/qualification leaves an untrusted source, not an admitted
memory. Original IDs/roles and truncated-source metadata remain inspectable;
assistant suggestions are not human decisions or execution authority. Retention
is fixed at 24 hours, at most 24 normalized/redacted 800-unit message prefixes
per event, 64 live payloads and 1 MiB of payload bytes per exact namespace.
Expiry is observed on access, not by an idle background worker. This is not a
complete transcript archive; content-free replay fences remain.

Live identical captures report processing; admitted live stages can replay
without model work. Failed, expired, discarded or forgotten staged events are
closed to further interpretation, including when retention is later disabled.
Inspect/discard instead of automatically retrying; never change a batch ID to
bypass closure. Discard fences unfinished admission but does not forget an
already admitted memory. Successful correction or forgetting clears **all staged
payloads in the configured namespace**, including pending work, even when this
connection has staging disabled. Other admitted memories and namespaces remain.
Already sent provider requests cannot be recalled; logical deletion does not
erase SQLite free pages, journals or backups. Stop older runtime connections
before upgrading the database.

Inspect a result with
`inspect_memory({memoryId:"returned-id",includeQualification:true})`. This works
without a key, including after restart. Omitted/false preserves ordinary ID
inspection. The flag is invalid on listing calls, even when false. Existing
receipt pagination remains unchanged; qualification anchors can reference
receipts outside the selected page. Correction clears qualification; forgetting
removes access. Retained historical qualifications remain inspectable.

With either capture qualification mode configured, `recall_memory` defaults to
`includeQualification:true`: the complete source description travels through
ranking and into returned items. Explicit false opts out for compatibility.
An unconfigured server retains legacy behavior unless true is requested; this
also works for existing qualified data after reopening with a recall model.
Recall still needs a model; inspection is the keyless operation. Null denotes
unqualified evidence, not confirmation. Source descriptions count within the
existing fetch/rank budgets; insufficient space fails rather than dropping
anchors. Receipt prefixes can remain incomplete, so follow inspection pages
before claiming missing source context. Retrieval coverage is not truth coverage.

Source binding is not semantic truth: the qualifier's subject, attribution,
commitment and other labels remain unverified interpretations. Capture creates
no trusted claim-slot bindings, accepts no causal sequence or transition input,
and never retires previous memories. Incompatible active claims may coexist;
recall does not automatically settle which is current. Inspect evidence before
explaining a change, and state when reasons or identity are unknown. Existing
explicit remember/correct tools remain keyless and are not silently reclassified.
Remembered consent is never execution authorization.

The 64KiB incoming transport cap still applies; some otherwise core-sized Unicode
batches exceed it. Oversize input rejects rather than truncating the transcript.
The 256KiB output cap also remains. No named-client compatibility or semantic
accuracy claim follows from scripted stdio/installation tests.

## Limits and verification

No HTTP listener, OAuth, automatic capture, hosted account, telemetry, automatic
model retries or npm publication is included. Incoming stdio messages are capped
at 64 KiB; tool-result JSON is capped at 256 KiB and fails explicitly rather than
truncating source evidence. No production database is used in tests.

`npm run test:mcp` runs synthetic actual-protocol tests without a key or model
service. SDK server/client 2.0.0 and Zod4.5.4 are pinned outside core; the lockfile
pins transitive packages. Registry metadata identifies MIT licensing; installed
packages retain their license notices. Core remains dependency-free. See
[acceptance and evidence](plans/standalone-mcp.md).
