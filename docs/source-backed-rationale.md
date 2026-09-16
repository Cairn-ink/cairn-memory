# Source-backed rationale (embedded preview)

The shared SQLite core can retain **model-proposed** support/challenge links
and inspect their source evidence. This is a new embedded API, not an enabled
automatic capture stage by default, deployed service or measured quality result.
The separate [opt-in capture/MCP integration](automatic-rationale-loop.md) now
uses these same methods; the original R1 slice did not include that integration.
It does not replace MOC or introduce another database engine.

```js
const result = await core.reviewRationale({ namespace, refs: [
  { memoryId: decision.id, revision: decision.revision },
  { memoryId: premise.id, revision: premise.revision },
  { memoryId: challenge.id, revision: challenge.revision },
] });
const evidence = core.getRationale({ namespace,
  memoryId: decision.id, revision: decision.revision });
```

`reviewRationale` uses one host-injected `model.relate` method. By default it sends only
local indices, source excerpts and submitted roles from 1–6 current memories.
Embedded callers can separately opt into [unverified claim focus](rationale-claim-focus.md)
with `inputMode: 'claim-focus-v1'`; automatic capture remains source-only.
The optional OpenAI adapter now implements the port; the embedded caller can also
inject another model. Explicit review callers select references; optional capture
uses bounded MOC discovery. Semantic accuracy is not established. No model runs
inside a database transaction. The usual token
counter/context-window requirements and 6000/1024 token bounds apply, with a
30-second timeout and no retry. Repeated calls can incur repeated inference;
identical stored proposals deduplicate, but the operation is not a replay ledger.

The strict result is `{ edges: [{ from, to, relation, fromReceipt, toReceipt }] }`,
with request-local indices and at most 10 edges. Relations are
`supports-decision` (premise → decision) and `challenges-premise` (new evidence →
premise). The core resolves receipt identity and hashes; source attachment does
not prove entailment, adoption, temporal ordering or subject/scope matching.
An empty proposal in the default append-only mode does not withdraw an existing
proposal. An explicit embedded `writeMode: 'replace-reviewed'` instead treats the
new proposal as the complete proposed edge set **only among the supplied 1–6
revision-guarded refs**. It removes old links whose two endpoints are in that
set but were not proposed, preserves crossing and unrelated links, and inserts
new proposals atomically. A valid empty output clears only those in-scope links.
The response adds `writeMode` and `removed` to the existing counters only in
this mode; identical re-review leaves the namespace index revision unchanged.
The default response and automatic capture remain append-only. No replay ledger
or historical edge record is created. This is model-proposal correction, not
edge adjudication or source correction; correction or forgetting of actual
source evidence still invalidates links.
Support may point within one memory/receipt when it records both the decision
and its reason; challenges require distinct memories. These are memory-level
proposals, not independently validated claim slots or a general causal graph.

`getRationale` needs no model or key. It returns the root, incoming supports and
their incoming challenges, sources and edges. It excludes generated summaries
and qualifications, but **edge types themselves are unverified interpretations**.
A support/challenge path yields `reconfirmation-suggested`; otherwise it yields
`unassessed`, not confirmed. It never changes the decision or chooses a substitute.
For “A was chosen for offline support; A may not support offline”, the returned
sources allow a host to explain the challenge without claiming adoption of B.
The host still has to interpret those sources; this API does not generate answers.

Reads are bounded to 6 memories, 10 edges and 24000 serialized UTF-16 units.
The write snapshot also has that character cap. Complete retained receipts must
fit (at most 100 per memory); overflow returns `context_item_too_large` or
`rationale_limit`, never a partial rationale. `coverage: linked-evidence-only`
is not a claim to have found every relevant source. Host/model token budgets
remain a separate gate before using this keyless inspection payload in a prompt.

Both endpoints bind to current revisions and actual receipts. The entire read
set is revalidated after callbacks and atomically before writes, including
unselected inputs. At most 10 incident edges per memory are allowed. Corrections,
forgetting, receipt changes, retirement and filing revision changes invalidate
incident links, including legacy writes. Conservative invalidation may require
another review even when the underlying wording has not changed.

Schema 12 adds the relation table, index and invalidation triggers. Older supported
databases migrate atomically; old binaries do not support schema 12. Use backups
before an intentional upgrade; no down-migration or repair is included. There is
no copied source text in relation rows, but IDs, relation types and receipt hashes
can expose relationships to someone with file access. Logical deletion does not
securely erase SQLite journals or backups. See [protocol](protocol.md).

MOC discovery, capture and MCP/installed consumption are now separately opt-in.
A frozen fresh semantic comparison remains outstanding. See [acceptance and sequence](plans/source-backed-rationale.md).
