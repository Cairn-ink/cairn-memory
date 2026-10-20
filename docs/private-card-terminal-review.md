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
| `select_evidence` | `query,types:['memory'|'card'],intent:'current'|'history'`, optional `limit,scanRows,scanBodyUnits,deadlineMs,cursor`; bounded metadata selection with honest coverage. |
| `fetch_evidence` | `refs,intent`, optional `responseByteLimit`; exact typed canonical items plus opaque snapshot. Omit namespace in refs. |
| `revalidate_evidence` | `snapshot`, optional `responseByteLimit`; fresh whole items or a fixed error without stale text. |
| `map_evidence` | `type:'memory'|'card'`, optional `purpose,parentRef,limit,cursor`; bounded typed topic/ref/unfiled navigation. |
| `apply_card_placement` | `actionId,refs,expectedIndexRevision,proposal`; organize 1–5 exact confirmed Card refs without namespace, with at most three parents per item. |
| `propose_evidence_mapping` | `actionId,memoryTopic,cardTopic,expectedMemoryIndexRevision,expectedCardIndexRevision`; proposed same-level topic metadata only. |
| `list_evidence_mappings` | `type,mocId`, optional `limit,cursor`; versioned mapping metadata, state and qualified navigability. |

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

To also review the resulting Card's applicability in that same atomic action,
append `--applicability current`, `historical`, `conflict` or `unknown`. The
command displays the exact choice separately from the untrusted draft. Its typed
phrase then becomes `CONFIRM CARD_ID REVISION APPLICABILITY current` (or the exact
other choice). A generic confirmation phrase cannot approve that review.
Omitting the flag preserves the original confirmation phrase and unknown
applicability; neither source availability nor ordinary confirmation implies
current applicability. No MCP tool grants this review authority.

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

Common evidence tools use the same canonical engine and exact namespace. For
example, call `select_evidence` with
`{query:'review',types:['memory','card'],intent:'current'}`. Selection returns
typed refs and qualification/support metadata without body text. Defaults are
12 matches, 128 scanned rows, 256,000 body units and a 1,000 ms deadline; maxima
are 24, 1,024, 2,000,000 and 5,000 ms. Literal Unicode word overlap is a bounded
navigation aid, not semantic ranking or a promise of complete recall. Use the
returned coverage and continuation cursor.

Pass 1–24 selected refs to `fetch_evidence`, removing only each ref's namespace;
the server reinserts its configured scope. A Memory ref is
`{type:'memory',memoryId,revision}` and a Card ref is
`{type:'card',cardId,revision,bodyRevision}`. Fetch returns whole canonical items,
explicit state/support/provenance and an opaque snapshot. Receipt/note text is
read separately through `read_private_card_source`. Optional whole-response
`responseByteLimit` defaults/maxes at 65,536 bytes; there is no partial-body
fallback. `revalidate_evidence({snapshot})` performs the final canonical check
before using those items. A source/Memory/Card or namespace generation change
returns `snapshot_stale` with no stale body. Foreign/tampered snapshots refuse.
An unchanged snapshot survives a new process with the same store and scope.

Current intent includes active visible Memories and confirmed Cards whose
canonical required support is eligible and whose exact revision was explicitly
reviewed current. History returns retained authored artifacts with qualifications;
it does not recover forgotten sources or previous bodies. Invalidation clears the
effective current review, so restarting or navigating history cannot silently
restore current applicability. See [the common-read contract](private-evidence-local.md)
for complete coverage, authority and provenance limits.

## Typed navigation and explicit organization

The same opt-in exposes `map_evidence({type:'memory'})` and
`map_evidence({type:'card'})`. Both return typed topic/ref/unfiled metadata,
index revision, coverage and continuation. Optional `purpose` is `recall` or
`classification`; an exact `parentRef:{mocId,revision}` narrows direct children.
L2 topics contain L1 topics, and L1 topics contain their own typed records.
Default pages contain 20 items, max 50, within the same 64 KiB core envelope.
Card pages examine at most 256 physical candidates per page; skipped/stale rows
consume that allowance and partial coverage remains explicit. Card IDs never
enter the old Memory map DTO. No model/classifier is called.

Inspect a confirmed Card and the current Card index, then explicitly file it:

```json
{
  "actionId": "place-private-card-1",
  "refs": [{"type":"card","cardId":"INSPECTED_CARD_ID","revision":2,"bodyRevision":1}],
  "expectedIndexRevision": 3,
  "proposal": {"items":[{
    "cardId":"INSPECTED_CARD_ID",
    "parentIds":[],
    "newL1":{"title":"Review plans","parentL2Ids":[],"newL2Title":"Personal practice"}
  }]}
}
```

Pass this to `apply_card_placement`, substituting the actual inspected IDs and
revisions. The strict shared placement grammar accepts up to five unique Card
refs and three parents per item. An empty parent list without `newL1` unfiles.
It requires eligible canonical source support, exact Card/body/index revisions,
and same-namespace parent topics at the expected levels. Failed placement rolls
back atomically and leaves the authored Card retrievable. Filing preserves Card
authorship, body/revision and applicability review; common current/history reads
remain available regardless of filing. Source invalidation hides obsolete Card
membership and derived topic titles without purging the independent authored
confirmed body.

`propose_evidence_mapping` accepts same-level exact
`memoryTopic:{mocId,revision}` and `cardTopic:{mocId,revision}`, both expected
index revisions, and an action ID. The proposal is metadata with
`state:'proposed'` and `navigable:false`. Use `list_evidence_mappings` for its
current state, endpoint/index versions, navigability and reason. Startup grants
only the two bounded organization actions (placement and proposal), alongside
the explicitly advertised read/draft methods. A namespace, serialized grant,
claimed role, confirmation flag or tool invocation cannot mint `explicit-user`
authority. Mapping activation, reviewed refresh and removal remain the trusted
core `reviewEvidenceMapping` host API; no MCP tool exposes that action. Mappings
do not expand read permission, prove source support or implicitly change literal
selection. See [the organization contract](private-organization-local.md).

The synthetic tests exercise actual stdio and installed processes, real PTY
keystrokes, stale review and cold restart without keys or provider requests.
Synthetic operator keystrokes are test evidence only; they do not claim a real
person approved a Card or demonstrate semantic quality. Full Raw, hosted safety,
publication, model-assisted drafting, mapping review UI and product UI are separate
gates; the adapter uses the core's implemented common-read facade.
