# A small cross-session memory walkthrough

This is an instruction script with expected outcomes, **not a recording or an
evaluation result**. The separate [installed-host acceptance](plans/install-artifact.md)
records the actual model-backed synthetic run. No human-user outcome is implied.

First [build and install the local archive](../packaging/README.md). Start it
through a stdio MCP client with an explicit owner and database path. Use the same
bindings after restart. The official SDK path is tested; check the
[client matrix](install-artifact.md#verification-and-compatibility) before choosing
a named host. Do not put a credential in tool arguments or committed config.

For a runnable SDK-driven version, from the source checkout:

```sh
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs --executable /absolute/install/node_modules/.bin/cairn-memory
```

Replace the absolute path with your installed executable. It uses a fresh
synthetic review-date fixture, verifies the same lifecycle, and prints stage
results and a temporary database path. It does not open an existing memory file.
By default it clears the model key and expects `model_not_configured`; no model
request is made. Adding `--with-recall` requires an explicitly supplied
`OPENAI_API_KEY`, sends synthetic data to OpenAI and may incur charges. This
optional path has no built-in dollar ceiling; use your provider's budget controls.
Do not equate a successful no-key walkthrough with semantic recall.

## Session A: save and inspect

Call `remember_memory`:

```json
{"content":"I prefer jasmine tea.","kind":"preference"}
```

Expect `ok: true`, a memory ID and current revision. The receipt is available
through the following inspection call, not in the save response. Keep the
actual returned ID; the identifiers below are placeholders, not runnable IDs.
Call `inspect_memory` with `{"memoryId":"RETURNED_ID"}`. Check the content,
revision and receipt excerpt. This explicit save does not claim to extract a
preference from a whole conversation or authenticate who intended the tool call.

## Session B: restart and retrieve

Stop the MCP subprocess and start a new one using the same database and owner.
`inspect_memory` must still find that ID; persistence does not require a key.
For semantic recall, supply `OPENAI_API_KEY` only to the MCP subprocess through
your host's secret environment configuration. This sends data to OpenAI and may
incur charges. Without a key, the expected result is `model_not_configured`.

Call `recall_memory`:

```json
{"query":"What kind of tea do I prefer?"}
```

The useful outcome is the same current memory with its receipt, not merely a
plausible answer. A missing result or invented detail is a failure worth
reporting. Changing the owner while keeping the database must not expose that
memory; do not mistake a model failure for proof of isolation.

## Correct, inspect, forget

Call `correct_memory` with the ID and the exact revision just inspected:

```json
{"memoryId":"RETURNED_ID","expectedRevision":1,"content":"I prefer mint tea.","kind":"preference"}
```

Replace `1` with the actual revision. Inspect again: the new revision must be
higher and its receipt must explain the correction. A stale revision must fail.
Then call `forget_memory` with the ID and **new** revision. Inspect/list should
no longer show an active memory; a later recall should not return the forgotten
one. This does not erase every SQLite page, receipt or backup.

## What this demonstrates—and does not

The loop makes persistence, provenance and user control observable. It does not
establish general extraction accuracy, automatic capture, fully local model
processing or universal client support. The frozen extraction/source-support
gate currently fails; see the [retained evaluation](https://github.com/Cairn-ink/cairn-memory/pull/23).
