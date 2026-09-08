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
| inspect_memory | memoryId with optional receiptLimit/receiptCursor, OR limit/cursor | Page through receipts for one memory, or list this namespace |
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

Supported secret shapes are redacted in storage and before recall sends a query
to a model; redaction is best effort, not complete secret detection. The server
does not capture transcripts or install hooks. Forgetting is not secure disk
erasure; SQLite/WAL/backups may retain old bytes. Protect the database directory
and review provider retention policy before handling real conversations.

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
