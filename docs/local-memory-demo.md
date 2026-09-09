# A small cross-session memory walkthrough

This is an instruction script with expected outcomes, **not a recording or an
evaluation result**. The no-key path below uses synthetic data and does not
imply a human-user outcome.

## Install from the source checkout

Use Node >=22.16, npm and `tar` from the repository root. Choose a final target
that does not exist yet, under an already existing real parent directory that
you control:

```sh
npm run install:preview -- --directory /absolute/existing-parent/cairn-local --owner local-user
```

The installer rejects an existing target, including a partial installation, and
also rejects symlink components in its parent path. It builds and installs the
private inspected archive, creates `app/` and `data/`, and runs an installed
syntax-only configuration check. It does not start MCP, open a database, make a
model call or edit client configuration.

The private receipt is at:

```text
/absolute/existing-parent/cairn-local/installation-receipt.json
```

It records the artifact hash, exact executable/database paths, owner/project and
generic `stdio.command` / `stdio.args` fields. Copy those two fields into a
local MCP client's subprocess configuration; they are generic stdio settings,
not a compatibility claim for a named client. The receipt contains local paths
and identity and has private permissions. Do not post it or commit it. Keep the
database in the receipt's `data/` directory, outside `node_modules`.

Before connecting a client, run this non-mutating check; it requires no key and
makes no provider requests:

```sh
/absolute/existing-parent/cairn-local/app/node_modules/.bin/cairn-memory \
  --check-config \
  --db /absolute/existing-parent/cairn-local/data/memory.sqlite \
  --owner local-user
```

## Installed no-key walkthrough

Install the isolated MCP SDK in the source checkout, then point the walkthrough
at the installed executable:

```sh
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs \
  --executable /absolute/existing-parent/cairn-local/app/node_modules/.bin/cairn-memory
```

The walkthrough is an actual SDK stdio client talking to the installed process.
It uses a fresh synthetic temporary database and a synthetic owner, so it does
not open the installed `data/memory.sqlite` or any existing memory file. The
child environment deliberately has no model key, even if the parent shell has
one. Expect a JSON report with `status: "passed"`; its recall stage must receive
`model_not_configured`, while the other stages check the five tools, receipts,
restart persistence, revision conflict handling and logical forgetting. This is
the model-free check; it does not test semantic relevance.

Paid semantic recall is a separate opt-in. Put `OPENAI_API_KEY` in the MCP
process's secret environment, never in tool arguments, a receipt or committed
configuration, and run:

```sh
node adapters/mcp/walkthrough.mjs \
  --executable /absolute/existing-parent/cairn-local/app/node_modules/.bin/cairn-memory \
  --with-recall
```

This sends synthetic content and queries to OpenAI and may incur charges. The
walkthrough does not impose a built-in dollar ceiling; use the provider's budget
controls. A passing paid run would be evidence for this bounded installed
fixture, not a real-model full-chat or general semantic-quality claim.

## Session A: save and inspect

The installed walkthrough already exercises this lifecycle. To perform the same
actions manually through any configured stdio MCP client, call `remember_memory`
with an explicit project decision:

```json
{"content":"The Harbor project uses SQLite for local persistence.","kind":"decision"}
```

Expect `ok: true`, a memory ID and the current revision. The receipt is available
through `inspect_memory`, not in the save response. Keep the returned ID; the
identifier below is a placeholder, not a runnable ID:

```json
{"memoryId":"RETURNED_ID"}
```

Check the content, revision and receipt excerpt. This explicit MCP admission
saves the content supplied by the caller; it does not extract a decision from a
whole conversation or authenticate who intended the tool call. The same pattern
can hold a personal preference instead of a project decision.

## Session B: restart and retrieve

Stop the MCP subprocess and start a new one with the same database, owner and
optional project bindings from the generic stdio settings. `inspect_memory` must
still find the ID; persistence does not require a model key.

`recall_memory` is model-guided. Without a key, the expected result is
`model_not_configured`, as in the no-key walkthrough. With the separate paid
opt-in, supply the key only through the MCP process's secret environment and
query:

```json
{"query":"What storage did the Harbor project choose?"}
```

A useful result is the current memory with its receipt. A missing result or an
invented detail is worth reporting; do not treat the model response as trusted
instructions. Changing the owner while keeping the database must not expose the
memory, but a model failure is not by itself proof of isolation.

## Correct, inspect, forget

Call `correct_memory` with the ID and the exact revision just inspected:

```json
{"memoryId":"RETURNED_ID","expectedRevision":1,"content":"The Harbor project uses SQLite for the prototype.","kind":"decision"}
```

Replace `1` with the actual revision. Inspect again: the new revision must be
higher and its receipt must explain the correction. A stale revision must fail.
Then call `forget_memory` with the ID and **new** revision. Inspect/list should
no longer show an active memory; a later recall should not return the forgotten
one. This is logical deletion, not secure erasure of every SQLite page, receipt
or backup.

## Evidence boundaries

- The no-key walkthrough is real MCP SDK-to-installed-process dispatch with
  scripted tool calls. Its passed lifecycle is not model-quality evidence.
- The pinned Hermes evidence exercises the actual AIAgent conversation loop and
  real tool dispatch, but completion responses choose the tool names and
  arguments. It is scripted, not a real-model chat decision test.
- A separate historical paid native `MemoryManager` probe used a real model for
  a bounded two-session provider recall. It is not combined with the scripted
  Hermes loop and is not proof of a real-model full-chat experience.
- Real-model autonomous chat tool selection and universal named-client
  compatibility remain unverified; automatic transcript capture is not
  implemented in this local MCP preview. The released hosted Claude plugin is a
  separate mode with its own automatic capture and service/privacy behavior. See
  the [Hermes loop evidence](hermes-agent-loop.md) and [client matrix](install-artifact.md#verification-and-compatibility).

## Explicit admission and inferred capture

`remember_memory` is direct MCP admission: it stores caller-supplied content and
does not run the extraction model. Programmatic capture is a different API that
can admit inferred items with source receipts. The [default extractor's retained
evaluation](semantic-evaluation.md) still has source-support failures. An
explicitly selected [experimental extraction profile](plans/extraction-model-profile.md)
passed a fixed small synthetic corpus after review, but it is not the MCP
default. Do not apply either extraction result as a quality score for MCP recall
or the Hermes agent loop.

The loop makes persistence, provenance and user control observable. It does not
establish general extraction accuracy, fully local model processing, universal
client support or real-model full-chat behavior. Automatic transcript capture is
not implemented in this local MCP preview.
