# Internal local Raw journal (P1)

This is the storage/read foundation in
[the local V1 plan](plans/raw-local-v1-completion.md), not completed Raw capture
or the whole RL-1 package. It is default-off and authorized only for pure-local,
synthetic development and tests. It adds no public capture mutation, MCP tool,
client hook, Raw → Card resolver, extraction, hosted encryption or production
enablement. Existing capture continues to use its existing bounded source path.

## Internal boundary

`openDatabase(path, { rawConversations: true })` atomically upgrades a compatible
store to schema 24, including the compatible private-engine schema through 23.
Raw tables start empty; no transcript or legacy evidence is backfilled. Ordinary
new stores remain schema 18, or 23 with the existing private-engine option.
Current option-off openers preserve a genuine schema 24 store. Pre-Raw openers
reject it; stop old writers before any future migration. This packet migrates
only owned synthetic fixtures, never an operational database.

`createRawJournal({ db, mode, port, capBytes, readPolicy })` is an internal source
module and is not part of the installed runtime manifest. Only its schema module
is packaged because the existing database opener statically imports that module.
No installed Raw capability is advertised. The internal journal provides:

- `prepareRegistration(input)`: validate exact namespace and camel-case message
  parts, snapshot host policy/control/namespace/conversation state, then seal
  eligible parts outside a transaction. It returns an opaque token bound to that
  journal instance; caller changes cannot change the prepared input or AAD.
- `commitRegistration(token)`: synchronously recheck state and join an existing
  transaction. A savepoint rolls back that registration on failure. The caller's
  eventual rollback also removes all journal, ledger and usage effects.
- `register(input)`: prepare, then run that commit in its own transaction.
- `getConversation`, `getRawUsage`, internal CAS raw controls and pending-attempt
  closure. These are not attached to `openMemoryCore` or `openMemoryStore`.

The trusted `readPolicy` callback is synchronous and receives exact namespace and
client, returning `{generation,reason}`. A null reason permits prospective saving;
`tool_off`, `notice_required` and `raw_disabled` are content-free policy skips.
Existing durable namespace capture controls and session-deletion state are also
checked. P2 must join authoritative capture controls, admission, episode
registration and their barriers before exposing this primitive to capture.
The internal control/closure primitives here do not make existing public setters
perform that integration automatically.

## Storage and reads

The same SQLite file holds conversations, immutable keyed event/part identities,
content-free message progress, dispositions, raw parts and owner usage. Session
identity uses the existing `s1:` episode HMAC; raw session IDs are not retained.
Parts preserve exact selected/redacted whitespace and Unicode. No normalization,
redaction or whole-message truncation is applied by the journal. Hosts must
redact the entire logical message before splitting it in the later client packet.

The first part reserves the entire declared UTF-8 message size. The owner counter
covers clients and personal/project namespaces in this store. Saving converts
reserved bytes to saved bytes; replay and reads charge nothing. Cap decreases
leave existing reservations intact, and skipped or closed messages cannot be
backfilled after a policy/cap change. Closing a pending attempt releases its
unused reservation once and retains accepted parts. An omitted cap on a reader
preserves the durable configured cap.

The port is explicitly versioned `raw-seal-v1`; seal/open run without a database
transaction. Associated data follows the exact field order in
[the Raw contract](plans/raw-layer-contract.md). Tests use only explicit
`local-plain-v1`, which provides no encryption. The journal validates port
descriptors, local sealed bytes and decoded text's units/bytes/keyed identity.
Failures expose the fixed `raw_crypto_unavailable` code, never port exception
prose or a plaintext fallback. This does not establish the hosted construction,
key lifecycle, backup erasure or production privacy gates.

Reads return whole parts in ordinal/index order, with explicit unknown time and
incomplete coverage. They include `evidenceTrust:'untrusted-data-not-instructions'`
and fit within 65,536 bytes including the success envelope and signed cursor.
Cursors bind store, exact namespace, operation, conversation/revision, part limit,
namespace epoch and position. Publication rechecks revision, epoch and exact
stored part/message metadata after opening. Owner usage uses one SQLite read
snapshot and counts plaintext bytes, not ciphertext or file allocation.

## Verification boundary

`core/test/raw-journal.test.mjs` and `core/test/raw-boundaries.test.mjs` use the
owned test runner and synthetic workspaces, including two real child processes.
The frozen `core/testing/raw-v23-database.mjs` is the actual pre-Raw opener from
`cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`, with only relative imports relocated,
so old-opener refusal remains testable in shallow CI checkouts.

These tests establish P1 mechanics. They do not establish admission/episode
atomicity, first-part-only model budgets, public pause/delete integration,
precise source deletion/exclusion, installed lifecycle or semantic quality.
Those remain the later P2–P4 packets and production acceptance gates in the plan.
