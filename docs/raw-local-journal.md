# Internal local Raw journal and capture registration (P1/P2)

This is the storage/read foundation in
[the local V1 plan](plans/raw-local-v1-completion.md), not completed Raw capture
or the whole RL-1 package. It is default-off and authorized only for pure-local,
synthetic development and tests. It adds no public capture mutation, MCP tool,
client hook, Raw → Card resolver, hosted encryption or production enablement.
P2 adds an internal factory that joins the existing bounded capture engine;
ordinary public capture retains its existing request and response contract.

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
checked. The P2 factory below joins authoritative capture controls, admission
and episode registration. The standalone P1 journal remains model-free and does
not make an ordinary public opener perform this integration automatically.

## Internal P2 factory

`openRawCaptureCore(coreOptions, rawOptions)` in `core/raw-capture.mjs` is an
internal, synthetic-only construction seam. `coreOptions` uses unchanged strict
`openMemoryCore` options. `rawOptions` supplies the journal's explicit mode, port,
cap and trusted synchronous `readPolicy`. Public `openMemoryCore` does not accept
these fields or forward construction extensions. The usable factory and its
capture-storage module remain absent from the installed artifact manifest.
No capabilities, MCP tools, client producers or HTTP wire versions are added.

Only this internal construction opts into additive schema **25**. Genuine P1
schema 24 stores migrate transactionally; the new capture ownership and session
fence records start empty, with no inferred backfill. `rawConversations:true`
alone still creates schema 24. Option-off current openers preserve schema 25;
the actual frozen P1 opener refuses it. As before, stop/drain older writers
before any future operational migration; this packet migrates synthetic stores
only.

`captureRaw` takes the journal's camel-case message-part request, plus ordinary
`causal` or episode-mode `episodeContext` at the top level. It validates and
detaches identity, context, profile and bounded normalized first-part projection
before asynchronous sealing. The durable, content-free ownership mapping records
first-part and eligible-projection message IDs, projection/profile digests, the
HMAC session identity, namespace generation and staging disposition. It does not
store another transcript or implement a second admission engine.

The prepared registration joins the real `claimAdmission` transaction for
ordinary, staged and ordered capture, or `reserveEpisodeBatch` for episodes.
Raw, usage, immutable event/part identities and required admission/episode
observation either commit together or roll back together. Raw commits before
staging expiry can advance the namespace epoch; the ordered proof is acquired
after both. Episode registration precedes duplicate/processing branches and lazy
interpretation of another session. Provider and sealing/opening callbacks run
outside the write transaction.

Only initially fresh index-zero messages enter the existing model projection.
Continuations make no extractor, qualifier, classifier or episode calls and do
not create admission claims or advance episode debounce counts. A mixed batch
uses only its fresh first parts. Blank or otherwise ineligible canonical first
parts retain exact Raw and explicitly report `no-eligible-first-part`; a later
continuation cannot become substitute model input. Exact replay and new-event
overlap retain original ownership. A live original claim reports processing;
failed/expired interpretation remains explicitly incomplete without a new-event
retry. An intentionally absent interpretation does not invent a pending job.
New Raw first parts that collide with an already covered legacy episode message
(including a mixed batch) refuse atomically instead of backfilling that source
without its own admission reservation. Frozen legacy batches keep their legacy
path; only fresh post-upgrade ranges are eligible for future client adoption.

The internal result separates source saving from interpretation:

```js
{ ok: true, value: {
  raw: { conversationId, revision, parts },
  interpretation: /* existing core success/error envelope */
} }
```

Registration failure returns the existing error envelope with no successful Raw
result. After successful registration, extraction/qualification failure, staging
release/expiry or capacity bypass leaves Raw intact. Internal staged capture may
bypass full staging and records `not-staged`; ordinary legacy capture still
refuses capacity. This internal split is **not the future public v2 wire
acknowledgement**. An interpretation error/incomplete/processing result is not
permission for a future client to advance its capture cursor as completed.

Through this internal factory, namespace pause/project-stop setters close affected pending Raw
assemblies in their control transaction, including when episodes are off. The
owner/client Raw-off setter closes only that owner/client's pending assemblies.
All preserve accepted parts and release unused reservations once. Resume/on
permits fresh messages but never backfills a closed suffix. Sealing rechecks
these controls and session fences before commit. Namespace generation and
session deletion are checked again inside admission publication, including
unstaged and ordered capture. Raw-off after registration permits Memory work to
finish. Episode prose publication is also fenced for the new path.

`fenceSession({namespace,client,sessionId})` is a narrow internal tombstone seam
for episode-off race/restart fixtures. Existing episode deletion tombstones also
fence registration and publication. This is not `deleteConversation`: full D5
source cascades, D6 forgotten-span exclusions and host withdrawal effects remain
P3. The factory must remain unavailable to real capture clients until those
protections and installed-client acceptance are complete. Arbitrary option-off
v25 writers do not yet join Raw reservation closure to their control changes;
that mutation-safety work remains P3. The durable admission guard already checks
namespace/session fences for existing Raw admissions, but does not establish all
option-off control or source mutations as complete.

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

The three `core/test/raw-capture*.test.mjs` suites additionally exercise actual
P2 admission/episode transactions, controls/fences, bounded model projections,
ordered proofs, staged bypass, replay, migration and independent child processes.
`core/testing/raw-v24-database.mjs` freezes the actual P1 opener from
`0be04cdcc9e5a88b3702bf915510da810d5e797a`, with only an explanatory header and
relative import relocation. All fixtures use synthetic owned workspaces.

These establish internal P1/P2 mechanics. Precise source deletion/exclusion,
Raw → Card, installed Raw lifecycle, production controls/encryption and semantic
quality remain later packets and acceptance gates in the plan. Existing
installed/public compatibility tests do not establish installed Raw capability.
