# Explicit incident-proposal inspection

Base `d38e63250a3f560a30a315ed98a471665d8f2aed` (#74).
The live pilot proposed/inserted eight edges but exposed four through the
decision-support projection. Fix observability without silently promoting orphan
or backward proposals into answer context. No model-quality claim is implied.

## Acceptance

1. `getRationale` accepts optional `view: 'incident-proposals'` or
   `view: 'decision-context'`. Omitted/decision-context retains the exact existing
   payload and traversal. Unknown/null views fail before the read.
2. Incident view returns all directly incoming/outgoing proposal edges for the
   current root, including orphan challenges and self-support exactly once,
   in deterministic order. Do not traverse unrelated edges of neighbors.
   Return `view: 'incident-proposals'`, `coverage: 'root-incident-only'` and
   `status: 'unassessed'` even when a challenge exists. These are unverified
   proposals, not a validated decision or automatic reconfirmation suggestion.
3. Reuse existing SQLite storage and atomic source/revision/digest checks.
   Preserve exact namespace isolation and the six-memory, ten-edge, 24000-unit
   complete-graph bounds; overflow fails, not silently truncates. No new schema,
   model call, credential, token-budget widening or decision mutation.
4. The already opt-in keyless MCP `inspect_rationale` exposes the optional view.
   Fetch/recall continue using decision-context only; no automatic inclusion of
   incident proposals. Default tools and capture behavior remain unchanged.
5. Regression exercises orphan challenge invisibility in old mode versus explicit
   inspection, outgoing support, self-edge deduplication, isolated neighbor edges,
   namespace/revision/receipt mutation, cold restart and forgetting. Actual MCP
   SDK and installed artifact prove optional mode is wired without provider calls.
   Required core/MCP/artifact/generic gates on both Node versions, independent
   dual review and CI before autonomous merge.

This is the observability part of the next reliability work, not a repair of
model inference, fine-grained claim binding or Chinese recall selection.
