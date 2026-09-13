# Local MCP source preview

The thin MCP host exposes the existing public core; it is not a second engine
or a client that requires a Cairn cloud account. This package provides source-run
stdio transport. Registry packaging, named-client compatibility and remote
connectors are separate acceptance gates. General memory quality is evaluated
separately; a protocol test does not establish relevance.

## Start from source

On Node >=22.16, from the repository root:

```sh
npm ci --prefix adapters/mcp
npm ci --prefix adapters/openai
node adapters/mcp/cli.mjs --db /absolute/path/to/memory.sqlite --owner local-user
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
| recall_memory | query, optional limit (1–12) | Same bounded model-driven core recall with current source evidence |
| inspect_memory | memoryId with optional receiptLimit/receiptCursor/includeQualification, OR limit/cursor/states | Page through receipts and optional qualification for one memory, or list this namespace with optional active/historical filtering |
| capture_memory (opt-in only) | batchId, messages containing role/content | Explicitly submitted extraction and source qualification; no automatic retirement |
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

Add `--capture-qualification source-bound-v1` to the startup command to expose
`capture_memory` as a sixth tool. Absence retains the existing five tools; invalid
settings reject before opening storage. Library hosts can supply the same
`captureQualification` constructor setting to `createCairnServer`. The namespace
and mode are snapshotted at construction, never selected by tool arguments.

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
verified transcript. Reuse the same batch ID and payload for retries; do not
invent a fresh retry ID after failure. Completed replay makes no model calls;
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

Inspect a result with
`inspect_memory({memoryId:"returned-id",includeQualification:true})`. This works
without a key, including after restart. Omitted/false preserves ordinary ID
inspection. The flag is invalid on listing calls, even when false. Existing
receipt pagination remains unchanged; qualification anchors can reference
receipts outside the selected page. Correction clears qualification; forgetting
removes access. Retained historical qualifications remain inspectable.

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
