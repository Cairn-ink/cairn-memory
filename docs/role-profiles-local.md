# Local role profiles and task receipts

Enable the local plaintext preview with all three opt-ins:

```sh
cairn-memory --db /absolute/path/store.sqlite --owner owner \
  --method-packages local-v1 --context-read context-read-v1 --role-profiles local-v1
```

Project hosts add `--project project`. To include the owner's personal namespace,
add both `--method-read-personal` and `--context-read-personal`. The read sets
must be identical; mismatches refuse configuration rather than combining grants.
Duplicate flags, unknown values and missing dependencies refuse. The exclusive
retained-Raw profile cannot be combined with these flags. `--check-config` checks
syntax and reports the role capability, direct agent mutation mode, attribution
and tokenizer without opening a database, inspecting a key or contacting a provider.

Startup explicitly upgrades the ordinary writer to v32. Stop mixed-version writers
before upgrading: older binaries refuse v32. Without the role flag, existing tools,
response shapes and migration defaults remain unchanged. Validation of a store
already upgraded to v32 always checks the role schema and guards.

The CLI fixes `actorId` to `cairn-local-mcp` and `agentId` to `--client` (default
`cairn-local-mcp`). These are attribution labels supplied by host configuration,
not authentication or execution authority. Programmatic hosts use
`createCairnServer({path,namespace,methodPackages:'local-v1',contextRead:'context-read-v1',
roleProfiles:'local-v1',roleProfileAttribution:{actorId,agentId}})`; the attribution
object is optional and has the same defaults. Personal-read booleans must match.
The server constructs synchronous method-specific authority grants. Exactly the
three profile mutations use `write`; context reads and supplemental reason scopes
use `read`. Tool arguments cannot override namespace, read set, attribution or ports.

## Tools and mutation guards

The flag adds four tools. No confirmation or terminal step is required for direct
agent publication; publication immediately makes the release current.

- `publish_role_profile_release`: `roleKey`, `actionId`, both head expectations,
  `fields`, optional `changeReason`.
- `disable_role_profile`: `roleKey`, `actionId`, both head expectations.
- `delete_role_profile_release`: the same guards plus `release` and `expectedRevision`.
- `read_role_task_context`: the closed mode-specific read interface below.

Both `expectedCurrentRelease` and `expectedRegistryRevision` are required. Use
null/null only for an absent registry. Disabled barriers can have a null release
and a positive revision. Every mutation, including historical release deletion,
advances registry CAS. Concurrent stale writes return `revision_conflict`. Exact
replay of an action is inert; changed input under that action returns `action_conflict`.
Restore by publishing earlier content as a new immutable release.

`fields` contains 1–8 `duties` and 1–8 `requiredOutputs`, each nonblank text of at
most 300 UTF-16 units. Optional `methods` names up to 16 distinct package refs;
`related` names up to 16 Memory/Card refs, without copying their bodies. Optional
`appliesTo` and change-reason `text` are at most 500 units; reason refs are at most
16 closed U2 refs. Role keys are 1–200 ASCII letters/digits/dot/underscore/hyphen.
Release inputs and retained payloads are bounded to 32,768 UTF-8 bytes; each
namespace has at most 256 profiles and each profile 128 releases including tombstones.
Retained release and reason payloads share a 50,000,000-byte owner quota.

## Read modes and caller-held receipts

`now` requires `roleKey` and accepts `task` and `history`. `then` takes `receipt`
and optional `history`; `refresh` takes `receipt` and optional `task`. `compare`
takes `roleKey`, same-family `from`/`to` release or method-version refs and optional
`cursor`. `file` takes `receipt`, exact `package`, `path` and optional half-open
`range:{start,end}`. History takes `profile`, optional `limit` (max 20) and `cursor`.
Tasks are at most 4,000 units. Semantic search stays disabled.

Keep the complete receipt string verbatim outside the engine: **a lost receipt
cannot be recovered**. There is no receipt lookup or revocation table. The receipt
is inside the single metered text block, so clients forwarding that block retain
it. `then` and `file` return that original receipt unchanged; `refresh` resolves
the whole selection again and issues a new receipt ID. Receipts authenticate
identities, and every call still requires fresh host authorization.

Project profiles precede personal profiles. Disabled or unavailable winners block
fallback. Profile applicability labels are `current`, `newer-release-available`,
`withdrawn`, `unavailable`, or `no-profile`; method adoption is assessed independently.
Historical bytes do not become current guidance. Comparisons show only mechanical
changes and recorded edge reasons; missing prose means “reason not recorded”.

Text file continuation uses the receipt's exact immutable version, with whole,
code-point-aligned ranges of at most 4,000 UTF-16 units. Binary file mode exposes
metadata only and requires `--assets local-v1` and separate U4 read authority in
its startup namespace. Fetch binary bytes through an authorized U4 host API using
the returned exact version. Adoption switches never replace receipt file bytes;
deletion or revoked access makes continuation unavailable or refuses it.

## Budgets and limitations

Optional `budget:{maxTokens,maxItems}` defaults to 4,000 tokens and 12 evidence
items; ranges are 64–4,000 tokens and 1–24 items. Optional `deadlineMs` defaults to
1,000, maximum 5,000, cooperatively covering preparation, counting and delivery.
The local `o200k_base` counter meters the complete canonical success text including
the escaped receipt. It does not bound the client's whole prompt or model spend.
Mandatory fields, scope note, method/status summaries and receipt must fit together.
Overflow returns measured `budget_insufficient` with required token/byte counts,
without a new receipt or partial guidance. Legal maximum Unicode fields or many
packages may exceed the budget. File ranges fit whole or refuse.

Independent ceilings are 32,768 receipt bytes, 65,536 core-envelope bytes and
262,144 transport bytes. Diagnostics appear only in
`_meta['ink.cairn/context-read-diagnostics']`; clients must explicitly keep `_meta`
out of model input. Metadata is not invisible to arbitrary clients.

Profiles, methods, related content and receipts confer no access, truth or
execution permission. Local plaintext, best-effort redaction and logical deletion
do not promise secure erasure of journals, backups or caller copies. Related-source
fences suppress guidance after source invalidation without recovering purged prose.
This preview makes no claims about answer quality, live cross-agent sessions,
authoring UI, relation/MOC retrieval, engine receipt lookup or current-dependent
Card/representation invalidation. See [limitations](limitations.md).
