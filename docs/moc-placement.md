# MOC organization preview — S2b

The public core now has persisted topic groups and guarded classification.
An L2 group contains L1 groups; an L1 group contains memory references. Memories
can belong to multiple topics. These are navigation structures, not evidence or
permissions: only current memory records and source receipts support a claim.

This extends the same SQLite store and `openMemoryCore` facade as
[S2a](storage-contract.md). It does **not** add semantic recall, a local MCP
server, a production model adapter, a hosted migration or Moss maintenance.
The released plugin's hosted HTTP path is unchanged.

## Propose, then commit

The async `classifyPlacement` method reads an exact namespace and asks an
explicitly injected model for one bounded batch proposal. Classification does
not write. Submit the returned proposal separately using `applyPlacement`, with
the returned memory revisions and index revision. A stale proposal fails without
creating partial groups or restoring deleted content.

The model sees only selected memories and a bounded, current classification
map. Content/labels are untrusted data, not instructions. Only visible existing
IDs at the correct hierarchy level may be selected. If the map is incomplete,
the classifier cannot infer that a topic is absent and propose a new one.
Failure leaves admitted memories inspectable through model-free `list`/`get`.

`applyPlacement` may also be called directly by a trusted embedding application
with a handcrafted proposal. Its transaction still validates namespace, IDs,
levels, versions and canonical duplicate titles. The embedding application
authenticates the caller; possession of a group ID grants no access.

The exact inputs/results and acceptance cases are documented in the
[S2b plan](plans/s2-moc-placement.md). `linkMocs` adds a guarded L2→L1 edge.
`get` returns validated placements; `list` filters actual filed/unfiled state.
Correction, deletion and material changes through either core facade remove old
memory memberships. Exact admission retries leave organization unchanged.

## Model and token-counting port

`openMemoryCore({path, model})` accepts this explicit adapter:

```js
const model = {
  contextWindow: 8192,
  countTokens(text) { /* synchronous exact tokenizer for this provider/model */ },
  async classify({ system, input, maxOutputTokens, signal }) {
    // Invoke the chosen model, honoring the output limit and AbortSignal.
    // Return a parsed proposal object; never execute commands in its content.
  },
};
```

There is no default model, cloud fallback or bundled tokenizer. `countTokens`
must cover the exact serialized request for the adapter's model, including its
system text/input/output-limit fields; the adapter must account for any extra
provider framing within the reserved protocol budget. A call needs context ≥8192,
input ≤6000 tokens, output ≤1024, with 1024 reserved for framing. Missing/invalid
counting fails explicitly. The classifier has a 30-second deadline and passes an
AbortSignal; late output cannot commit anything.

`map` uses only the local counter, not a model request. Its entire serialized
success envelope is bounded to at most 4000 counted tokens (or a smaller supplied
budget), including cursors and invalid-reference reports. `list`, `get`, explicit
admission, correction, forgetting and manual placement do not need a model.

The bundled `core/testing/mock-placement-model.mjs` is a **scripted test double**.
Its byte-based counting is a deterministic test convention, not a real tokenizer
or evidence of model performance. Do not use it for production classification.

## Maps, stale data and paging

`map({namespace,purpose:'recall'|'classification',parentRef?,limit?,cursor?,tokenBudget?})`
returns bounded group snapshots, references and unfiled labels. Short memories
may appear verbatim in their 120-code-point redacted label; there is no body or
receipt field. Source-derived group titles become null when their source revision
is changed/forgotten. Empty groups and ancestors disappear from recall maps;
classification retains the empty catalog to prevent accidental duplicate topics.

Root maps contain both levels and their edges. A versioned parentRef restricts
the result to its direct children and edges. Broken/foreign/stale references
are reported as invalid without referenced content. Snapshot labels never
authorize fetches or substitute for a source receipt.

Keep namespace, purpose, parentRef, limit and budget unchanged when continuing a
cursor. A namespace mutation makes it stale. `exhausted:false` means incomplete,
not absence; follow the cursor or explicitly stop. A first item/envelope that
cannot fit fails `context_item_too_large`, avoiding non-progressing pagination.
Map page reads are bounded in JavaScript; SQLite still performs joins/sorting.
This preview has no measured large-scale latency/resource claim.

## Migration and verification

Opening v1, v3 or v4 data upgrades atomically to schema v5. Existing memory/source
IDs, suppression, revisions and cursor identity survive. Pre-MOC v1/v3 memories
start unfiled; v4 organization is preserved. Old v1/v3/v4 binaries cannot open v5.
Draft-v2 and unknown schemas remain
unsupported. Back up meaningful data with writers closed before upgrading;
there is no downgrade/export tool or secure-erasure guarantee.

Run `npm run test:core` on Node ≥22.16. Tests use fresh temporary SQLite files and
scripted models to cover group creation/reuse, hierarchy, multi-membership,
failure, stale proposals, isolation, derived-title deletion, bounded map paging,
migration and restart. Existing CI runs these on 22.16 and 24. The prior optional
eight-case storage-oracle runner remains storage-only; it is not expanded into a
claim that the entire S1 memory/placement suite passes.

`npm run demo:moc` runs a source-checkout example of admission, read-only mock
classification, explicit placement, hierarchy inspection and deletion. It prints
the retained synthetic database path for inspection; no account or model needed.

[S2c](fetch-recall.md) now adds bounded fetch/recall orchestration. MCP and
real-model organization/retrieval evaluation remain separate milestones.
Mock outcomes are not those quality results.
