# Bound source-context review

`core.reviewSourceContext({ namespace, refs })` is an explicit, read-only local
assessment of 1–6 current memories in one exact namespace. Each ref must contain
its current `memoryId` and `revision`. It requires an injected
`model.reviewSourceContext({ system, input, responseSchema, maxOutputTokens,
signal })` and `model.countTokens(text)`; opening a core without them does not
enable any provider. The operation is not an MCP or hosted HTTP tool.

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
