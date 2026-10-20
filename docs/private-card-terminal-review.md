# Private Cards through local MCP and terminal review

The installed local preview can create an authored private Card from already
retained Memory receipts, inspect its support, and confirm it through a separate
local terminal. No key or model call is needed for this workflow. Confirmation
records private curation, not truth, adoption, current applicability, execution
permission or publication. Product integration and deployment belong to the
product team.

## Start and draft

Use the existing inspected [local artifact installation](install-artifact.md),
then opt one MCP process into the additional tools:

```sh
cairn-memory --db /absolute/path/memory.sqlite --owner local-person --private-cards local-v1
```

Add `--project PROJECT` for an exact project namespace. The database parent must
exist; keep the database outside `node_modules`. Default startup without this
option keeps the existing tools and strict schemas. A server fixes owner, scope
and project at startup; no Card tool accepts namespace, authority, approval,
claimed user role or a serialized token. Programmatic startup uses
`createCairnServer({path, namespace, privateCards:'local-v1'})`.

Use `remember_memory` only on actual user intent, then inspect the Memory's
current ID and revision. Deliberate drafting is a separate call:

```json
{
  "actionId": "my-private-draft-1",
  "title": "Review plan",
  "body": "Check Tuesday availability.",
  "memoryRefs": [{"memoryId": "INSPECTED_MEMORY_ID", "revision": 1}]
}
```

Pass this to `create_private_card_draft`. It selects the explicit
`retained-receipts-v1` policy, accepts 1–6 current same-namespace Memory refs,
and resolves the complete bounded set of their actual retained receipts or
refuses atomically. It does not silently take a convenient source prefix.
Receipts remain `completeness:'excerpt-only'`, conversation coverage is unknown,
and required Memory interpretation dependencies use exact revisions. Full Raw,
automatic chat capture, new source archives and automatic Memory-to-Card
promotion are not enabled. Title/body input remains untrusted and subject to
the core's strict bounds/redaction. The MCP transport caps input at 64 KiB and
output at 256 KiB; the whole core Card response caps at 64 KiB.

The opt-in tools are:

| Tool | Arguments and behavior |
| --- | --- |
| `private_card_capabilities` | Empty object; inspect exact core capabilities, without private data. |
| `inspect_private_card` | `cardId`, optional `responseByteLimit` ≤65536; exact current authored payload, bindings and support. |
| `list_private_cards` | `states:['draft'|'confirmed']`, optional `limit`/`cursor`; metadata only, default 20/max 50. |
| `read_private_card_source` | `source`, optional `limit`/`cursor`; copy an inspected binding's source ref **without namespace**. Server inserts its exact namespace. No implicit surrounding fetch. |
| `create_private_card_draft` | `actionId,title,body,memoryRefs:[{memoryId,revision}]`; authored drafting only. |
| `cancel_private_card_draft` | `cardId,expectedRevision,actionId`; purge that exact draft's body and bindings. |
| `inspect_private_card_operation` | `operationActionId`; bounded content-free operation result. |
| `list_private_card_effects` | Optional `limit`/`cursor`; bounded durable content-free effects. |
| `confirm_private_card_draft` | `cardId,expectedRevision,actionId`; always refuses `approval_required`. |

Source refs use either receipt fields
`{type:'receipt',memoryId,memoryRevision,receiptId,contentIdentity,completeness:'excerpt-only'}`
or existing submitted-note fields
`{type:'submitted-note',sourceId,revision,contentIdentity,completeness:'provided-note'}`.
Opaque identities and cursors are issued by core; callers cannot mint them.
There is no MCP source-note submission, confirmed edit/delete, or authority
constructor. Note-backed Cards created by separately trusted hosts remain
inspectable, but the MCP draft tool uses existing Memory receipts only.

## Confirm the exact revision in a terminal

Inspect the draft first, then run this separately from the MCP protocol:

```sh
cairn-memory review-card --db /absolute/path/memory.sqlite --owner local-person --card EXACT_CARD_ID --revision 1
```

Include the same `--project PROJECT` when applicable. From a repository checkout,
replace `cairn-memory` with `node adapters/mcp/cli.mjs` in both commands.

On a POSIX terminal, the review command requires terminal stdin/stdout and opens
its controlling `/dev/tty`. It displays the exact namespace and entire inspected
draft, including title, body, bindings, revisions, attribution and support. All
untrusted values render as ASCII JSON: control sequences, embedded newlines,
Unicode format/bidi controls and non-ASCII characters are escaped. They cannot
draw a fake terminal prompt. The whole escaped display is bounded at 512 KiB.

After inspecting that data, type the exact displayed `CONFIRM CARD_ID REVISION`
phrase and press Enter. Any other answer, EOF, unavailable controlling terminal,
piped stdin/stdout, unsupported platform, missing Card, wrong revision or changed
payload refuses confirmation. There is no `--yes`, environment approval or prompt
injection callback. Ambient provider credentials are not consulted by this command.
Its final content-free core envelope and actual process exit code report success
(0) or failure (1).

The local command grants `explicit-user` authority only after that interaction,
for one exact confirmation method/input/revision in that process. Authority and
grants are opaque in-memory objects, never tool arguments. The complete draft is
re-read after the prompt; core performs its canonical revision/source checks at
commit. Editing/cancelling a draft or changing/deleting its source while review
is open makes that inspected approval stale. Re-inspect and review the new state;
do not blindly retry. The MCP process never reads terminal answers from protocol
stdin and cannot acquire this explicit-user grant.

This is a trusted local operator channel for a locally controlled plaintext
store. It does not authenticate a remote user, protect against arbitrary local
code execution, or establish hosted approval/encryption safety. Terminal
scrollback may retain displayed private data. Logical source deletion also does
not guarantee erasure from SQLite free pages, journals or backups.

## Restart, change and forget

Restart MCP with the same database, namespace and opt-in, then inspect the Card.
Its confirmed state and independent authored current body persist. Changing or
forgetting an underlying Memory canonically invalidates interpretation support:
dependent drafts become content-free cancelled tombstones; a confirmed authored
body remains inspectable with unsupported/needs-review support. An old body must
not be described as current evidence just because it is still private and
confirmed. Source inspection cannot recover forgotten receipt text. Effects
notify consumers; consumers must revalidate canonical state and must not treat
an effect or old confirmation as new permission.

The synthetic tests exercise actual stdio and installed processes, real PTY
keystrokes, stale review and cold restart without keys or provider requests.
Synthetic operator keystrokes are test evidence only; they do not claim a real
person approved a Card or demonstrate semantic quality. Full Raw, hosted safety,
publication, model-assisted drafting, common evidence retrieval and product UI
are separate gates; this adapter does not invent another retrieval engine.
