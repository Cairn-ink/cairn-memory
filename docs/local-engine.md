# Local memory engine and MCP — developer preview (2B)

The public engine now performs real model extraction and model-assisted recall
over the SQLite store. The local stdio MCP server is a thin adapter to that same
engine. Neither requires a Cairn account. Moss/maintenance and the hosted-service
migration are not included; the deployed service still uses its previous code.

## Install and configure

Use Node >=22.16. From a source checkout:

```bash
npm ci --prefix runtime --ignore-scripts
npm run test:core
npm run test:mcp
```

Core uses Node built-ins only. The optional MCP runtime has its own pinned SDK
and Zod dependencies/lockfile; installing the existing Claude plugin does not
install these dependencies. Nothing is published to npm in this milestone.

Choose an already-installed model in a locally running Ollama instance. Cairn
does not start Ollama, download weights, or select a cloud model automatically.
The following environment is an example; choose a private DB directory and your
own opaque owner/project identifiers:

```bash
CAIRN_DB_PATH=/absolute/private/path/memory.sqlite \
CAIRN_OWNER_ID=local-user \
CAIRN_PROJECT_ID=my-project \
CAIRN_MODEL_PROVIDER=ollama \
CAIRN_MODEL_ENDPOINT=http://127.0.0.1:11434 \
CAIRN_MODEL=deepseek-r1:14b \
CAIRN_MODEL_TIMEOUT_MS=120000 \
node /absolute/path/to/cairn-memory/runtime/server.mjs
```

This command speaks MCP JSON-RPC on stdin/stdout, not an interactive shell.
Configure a stdio-capable MCP host to launch that absolute `server.mjs` path
using Node and those environment variables. No HTTP port or Cairn token is
needed. Browser/remote-only MCP hosts need a separate HTTP transport, which is
not provided here. This server is not an `api_endpoint` for the existing Claude
automatic-capture plugin: that plugin still expects the hosted HTTP contract.

`CAIRN_DB_PATH` and `CAIRN_OWNER_ID` are required. Omit `CAIRN_PROJECT_ID` for a
personal namespace; an empty project ID is invalid. Keep identities stable
across restarts. They are application configuration, not authentication secrets.
Do not put credentials, raw paths, or private prose in identity/source IDs.

The default provider is `none`, so manual remember/correct/forget work without a
model; nonempty recall over stored candidates and capture return
`model_not_configured`. No fake extractor or lexical fallback is substituted.

## Tools

| Tool | Inputs / behavior |
| --- | --- |
| `remember_memory` | `content`, optional `kind`, optional `source`; explicit memory with receipt, defaulting source to the supplied content |
| `capture_memory` | `client`, `eventId`, `sessionId`, `messages: [{id, role, content}]`; explicitly send conversation for inference |
| `recall_memory` | `query`, optional `limit` (1–12, default 6); model-selected private memories with receipts and revisions |
| `correct_memory` | `id`, `expectedRevision`, `content`, optional `kind`/`source`; explicit correction |
| `forget_memory` | `id`, `expectedRevision`; forget in the configured mutation namespace |

Tools reject unknown fields, including caller-supplied owner/project overrides.
All mutations use the configured exact namespace. Recall includes personal
memories and, when configured, that owner's matching-project memories. To modify
a personal memory returned during project recall, use a personal-namespace
server; project configuration does not grant broader mutation permissions.

The local tool schema is its own developer-preview interface, not a change to
the existing hosted HTTP/MCP contract. Inspect `tools/list` for the actual schema.
MCP returns up to four source receipts per memory, plus `receiptCount`; the
embedded store retains all receipts. Recalled text is labelled untrusted data.
This server has **no passive lifecycle hooks**: capture occurs only when a tool
is called. Host installations/catalog placement are not implied.

## Shared engine and model interface

```js
import { openMemoryStore } from './core/index.mjs';
import { createMemoryEngine } from './core/engine.mjs';
import { createOllamaModel } from './core/models/ollama.mjs';

const store = openMemoryStore({path: '/private/memory.sqlite'});
const model = createOllamaModel({model: 'your-installed-model'});
const engine = createMemoryEngine({store, ownerId: 'owner', projectId: 'project', model});
// await engine.capture({client, eventId, sessionId, messages});
// await engine.recall(query, {limit: 6, signal});
// engine.remember(input), engine.correct(id, input, revision), engine.forget(id, revision)
// Close the store after outstanding operations complete.
```

An alternative adapter implements
`generate({task, schema, system, prompt, signal}) -> Promise<parsed JSON>`.
The engine owns input redaction, prompts, output/source validation, admission,
scope, atomic writes, and stale-result checks. The adapter owns its explicitly
configured transport and must respect cancellation and processing consent.
Use the same engine from future hosted and host adapters rather than copying it.
Ollama is the only bundled production adapter today; a generic OpenAI API or
Anthropic adapter is not claimed.

### Extraction and replay

Capture accepts 1–24 user/assistant text messages, each <=20,000 UTF-16 units
and <=24,000 normalized units in total. Unknown/tool fields and duplicate message
IDs are rejected. Up to ten recent existing memories (600 units each) provide
deduplication context. Both input and stored content are redacted before model
processing; redaction is best-effort.

Output must contain at most five bounded memories, legal kinds/confidence and
1–4 in-range evidence indices each. Invalid output fails the whole batch. Source
excerpts are built from those input messages, never from model-generated prose.
Receipt event IDs hash the pair `[capture eventId, message id]`; session/client
and the bounded original excerpt remain inspectable. A valid reference proves
traceability, not that the model's interpretation is correct.

The persistent ledger keys each capture by owner, exact scope/project, client,
and event ID. It stores a hash of normalized/redacted input, not raw conversation.
Completed retries skip model work and return the original counts, even if those
memories have since been forgotten. Counts describe that capture, not current
active memory. Reusing an ID for a different redacted payload is an error,
including after a failed attempt. Concurrent requests get `processing: true`;
retry the same event later without changing it. Failed work releases its lease;
crashed work becomes retryable after timeout plus five seconds. A stale token
cannot commit or release its successor. Model calls run outside transactions.

All inferred memories/receipts and completion commit together. Exact suppressed
content is skipped and counted in `suppressedCount`, never silently restored.
No automatic semantic merging/correction occurs. The ledger is not an unlimited
queue or a guarantee of exactly-once model execution after a crash.

### Recall and limits

Recall considers at most 40 recent eligible memories with a total content budget
of 24,000 UTF-16 units. Older/over-budget memories may be missed. Only candidate
IDs may be returned; the engine fetches current records and drops any whose
revision changed or disappeared during the model request. Empty queries or no
candidates skip model work. Model failures are errors, not quiet cloud/lexical
fallbacks. Explicit local operations remain available after a model failure.

There is no embedding index yet. Model-assisted ranking can understand a
paraphrase, but can also miss relevant memories or select irrelevant ones.
The Ollama adapter requests an 8,192-token context and at most 1,024 output tokens;
character bounds are not tokenizer-aware. Large/multilingual inputs may exceed
a model's effective context or cause truncation/errors. Use small batches and
verify actual model behavior; automatic token-aware chunking is future work.

## Processing destinations and retention

The runtime has no telemetry and does not contact Cairn. Default Ollama access
is numeric loopback only (`127.0.0.1` or `[::1]`, not a DNS hostname). Redirects,
URL credentials, non-root paths, query strings and fragments are rejected.
The local adapter refuses model names explicitly marked `cloud`.

A remote Ollama-compatible endpoint requires both HTTPS and
`CAIRN_ALLOW_REMOTE_MODEL=true`; optional `CAIRN_MODEL_API_KEY` is sent only to
that configured endpoint. This opt-in sends redacted capture messages, recent
memory context, recall queries and candidate memory content to its operator.
There is no fallback destination. Protect keys through host secret configuration.
Requests time out after 30 seconds by default, configurable up to 120 seconds;
cold local model loading may need the higher setting. Responses are capped at
256 KiB. Provider response bodies and credentials are not included in tool errors.

The selected model service is a separate trust boundary: a local proxy, custom
model alias, or server may itself call external systems or log prompts. Cairn
cannot establish its policy from the URL alone. Use genuinely local weights and
verify that service's configuration before claiming fully local processing.
The published probe did not install an OS-level outbound firewall.

Schema v2 transactionally upgrades 2A/v1 files by adding the capture ledger;
existing memories, receipts and suppression remain. Back up user data using a
safe SQLite backup procedure before adopting a new preview version. Old v1
binaries reject v2 files; there is no downgrade tool. Tests use disposable files,
not production migrations. Ledger entries are retained without automatic pruning.
Their hashes can expose guessable input via dictionary attacks. Forget removes
active text/receipts, not ledger identity/counts or SQLite free pages/backups.
See [storage retention and permissions](local-store.md) for the rest of the policy.

## Mock and real verification

`core/testing/mock-model.mjs` exports `createMockModel(steps)`: pass fixed JSON,
errors, or functions inspecting a request. It records calls and never activates
implicitly. The deterministic tests use this adapter with **real SQLite**;
MCP tests use a fake local Ollama HTTP response with a **real SDK client/server**.

```js
import { createMockModel } from './core/testing/mock-model.mjs';
const model = createMockModel([{memories: [{
  content: 'The user prefers concise answers.', kind: 'preference', confidence: 0.9,
  evidence_indices: [0],
}]}]);
// Inject into createMemoryEngine; no model key or inference service needed.
```

For real-model probes, using already-installed weights:

```bash
CAIRN_EVAL_MODEL=deepseek-r1:14b npm run probe:model
CAIRN_EVAL_MODEL=deepseek-r1:14b npm run probe --prefix runtime
```

`CAIRN_EVAL_ENDPOINT` optionally selects a different numeric loopback port. The
probes create new synthetic databases and never load private user data. They
print case results/timings and fail nonzero when assertions fail. The second
probe launches and restarts the actual MCP process. Neither installs weights.
See [recorded results and limitations](evals/local-engine-2b.md).

References: [official MCP server SDK](https://ts.sdk.modelcontextprotocol.io/server),
[client SDK](https://ts.sdk.modelcontextprotocol.io/client),
[Ollama chat API](https://docs.ollama.com/api/chat).
