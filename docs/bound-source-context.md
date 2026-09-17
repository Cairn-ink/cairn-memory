# Bound source-context review

`core.reviewSourceContext({ namespace, refs })` is an explicit, read-only local
assessment of 1–6 current memories in one exact namespace. Each ref must contain
its current `memoryId` and `revision`. It requires an injected
`model.reviewSourceContext({ system, input, responseSchema, maxOutputTokens,
signal })` and `model.countTokens(text)`; opening a core without them does not
enable any provider. The operation is not an MCP or hosted HTTP tool.

The optional OpenAI adapter supplies this explicit model port using its
existing `basisModel` selection. It validates the source-only CU request and
schema, then uses bounded count and generation calls with a 3,072-output-token
reservation and 6,000-input-token ceiling. This does not alter other adapter
ports or authorize the method in existing paid-experiment guards; fake-HTTP
integration is not real-provider or semantic acceptance.

The core takes a transactional `rationaleSnapshot` before calling the model.
The request contains only original receipt roles, exact excerpt passages and
source-local numeric indices. It excludes namespace, persistent memory/receipt
IDs, generated memory content, stored qualification, relation graph and
client/session/event metadata. Receipt text can contain instructions, but is
data only. The caller's injected model chooses whether or where to transmit it;
hosts should use a provider appropriate for that personal content.

The model response must match the strict CU `responseSchema`. The core compiles
it with [`compileSourceContextUnits`](source-context-units.md), then maps every
unit's source and receipt indices to captured `memoryId`, `revision` and
`receiptId`. Equality is by captured position and ID, never by excerpt text.
The result also contains the selected source evidence, `indexRevision`,
`status: 'assessment-only'`, `persistence: 'not-stored'`,
`sourceSelectionCoverage: 'unassessed'`, `semanticCoverage: 'unassessed'` and
`evidenceTrust: 'untrusted-data-not-instructions'`. Each compiled unit retains
`interpretationStatus: 'model-proposed-unverified'`. A successful result is not
a durable interpretation, authenticated speaker, permission, complete history
or correct current-world answer. The selected source set is caller-chosen, not
semantically complete.

The source-only CU raw and prepared inputs each have a 6,000-UTF-16-unit cap;
the proposal and compiled CU result each have a 24,000-UTF-16-unit cap. The
model call reserves 3,072 output tokens, counts its full schema-bearing input
within 6,000 tokens and the declared context window, and has the existing
30-second deadline and 40,000-character intermediate JSON bound. A detached
post-call proposal is counted again at the same output ceiling. The entire
public success envelope must fit 24,000 UTF-8 bytes. Overflow, malformed
output or unavailable counters fail instead of truncating or dropping sources
or units. Existing model calls retain their 1,024-token request/output shape.

The final transactional snapshot comparison occurs after the model call,
counter callbacks, compilation and byte check. It rejects selected source or
namespace-epoch changes, including correction, forgetting, supersession and
receipt drift without an epoch bump. Another namespace's change alone does not
invalidate this review. No callback runs after that final read. Nothing is
persisted: reopening the store reveals the same memories and receipts, not
the proposed units.

Explicit `core.reviewSourceContext({ namespace, refs, version: 2 })` uses the
same captured source snapshot, identity binding, 30-second deadline and final
freshness fence, but selects a separate version 2 prompt and response schema.
Each returned unit carries source-attributed epistemic stance, claimant and
reporter fields with exact source anchors; the result derives `version: 2`.
Versionless calls retain their original prompt, request bytes and result shape.
An `asserted` source stance is not Cairn confirmation, and claimant/reporter
labels are not authenticated identities; the same person can also be the
subject. Both semantic and source-selection
coverage remain unassessed. No new provider is selected, and no interpretation
is written to the store.

Explicit `{ namespace, refs, version: 3 }` selects a separate prompt and the
version 3 CU `{ units, reasonLinks }` response. The compiler accepts only
same-receipt, factual-to-decision, cited `stated-reason-for` associations, then
binds each link to the captured `memoryId`, `revision` and `receiptId` just as
it binds units. A link is an unverified account of a source-stated reason, not
a verified cause, adoption, current applicability, permission or persisted
rationale edge. The versionless and version 2 prompts, schemas, transport
bytes and result shapes are unchanged. The same model, limits, snapshot fence,
unassessed coverage and non-persistence apply; no receipt is guaranteed a unit.
