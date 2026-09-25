# Optional indexed source windows

The embedded JavaScript core can opt in at trusted construction with both
`captureQualification: 'source-bound-v2'` and
`captureSourcePolicy: 'indexed-windows-v1'`. This is a bounded source-retention
experiment, not a new default, MCP/native flag, hosted input, benchmark mode,
or semantic-quality claim. Active rationale and staged-evidence modes conflict
with it. Omitting the own policy preserves existing capture behavior.

After the existing normalization and redaction snapshot, core tiles each of up
to 24 canonical messages into nonoverlapping, surrogate-safe windows of at most
800 UTF-16 units. It trims boundary spaces with local offset adjustment and
rejects a slice that cannot remain an exact fixed point of receipt
canonicalization. The existing per-message 4,000-unit and batch 20,000-unit
limits remain; at most 64 derived windows are accepted. Segmentation is
deterministic and independent of the question or model output. Transient
normalized offsets are not raw transcript offsets and are not stored.

The extractor receives only `{inputMode:'indexed-windows-v1',messages}` with
global index, original message-group index, claimed role and canonical window
text. It selects one to four distinct indices for each of at most five bounded
items. Core—not the model—resolves original client/session/message identity,
role and exact excerpt. Selecting a window establishes source linkage, not
truth, entailment, adoption, permission, currentness or complete retention.
Duplicate canonical receipt identities reject the whole extraction before
qualification. The unchanged v2 qualification compiler binds local anchors to
the selected excerpts. Ordered capture maps selections back to original source
message indices and remains unresolved without trusted identity; it does not
automatically retire a prior memory.

A successful opt-in capture may return `sourceWindowCatalog` with version 1,
800-unit maximum, message/window counts and `semanticCoverage:'unassessed'`.
This describes the submitted view, including on a duplicate response, not how
an earlier execution selected evidence. It replaces—not supplements—the
prefix-only `retainedSourceWindow` response field in this mode. Failures do not
carry coverage metadata. Exact selected receipts persist under the existing
local-store, journal, backup and logical-forgetting limitations; no transcript
archive or storage migration is added.

The optional OpenAI adapter accepts this distinct 1–64-window extraction
envelope with strict pre-serialization validation and source-index constraints.
Its ordinary 24-message wire format, endpoints, models, retries and token
ceilings are unchanged. Synthetic actual-core tests demonstrate scripted
tail-window selection through admission, qualification, cold inspection and
source recall. A separate installed-artifact test uses the actual adapter with
fake HTTP to verify capture, qualification, inspection and duplicate replay.
They do not show that a model will select the needed passage or answer correctly.

Staged evidence and rationale integration are unsupported. The current public
comparison verifies only the exact first-800-unit canonical prefix and rejects
incompatible window receipts; do not relax that verifier or count an earlier
score as windowed. A scored comparison requires separately frozen versioned
provenance, fixtures, roster, shared outbound/cost guards and independent review.
