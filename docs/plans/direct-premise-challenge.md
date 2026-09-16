# Direct premise challenges in decision context

This fixes a read projection of already-stored rationale proposals. It does not
change proposal generation, relation vocabulary, storage, or decision state.

## Observable acceptance contract

- DC1. For a current root, `decision-context` includes valid stored incoming
  `challenges-premise` edges directly to that root even if no incoming
  `supports-decision` edge exists. It still includes incoming supports and
  challenges to those support sources. Exact rows seen by both paths (notably
  when the root has a self-support) appear once. No edge is inferred or written.
- DC2. The existing ten-edge, six-source, complete-receipt and 24,000-character
  read limits remain fail-closed after deduplication. Exact namespace, current
  revision and cited-receipt digest guards remain. No over-limit graph is
  silently clipped; correction, forgetting and receipt changes still invalidate
  proposals.
- DC3. After cold reopen, both `getRationale` and actual
  `recall({contextMode:'rationale-evidence'})` expose a direct challenge and its
  retained source with `reconfirmation-suggested`. The `source-evidence` arm
  remains unchanged. `incident-proposals` keeps its one-hop inventory and
  `unassessed` status. The challenge remains model-proposed, not proof that a
  premise is false, a decision cancelled, or another choice adopted.
- DC4. Synthetic tests cover a direct-only proposal, self-support deduplication,
  ordinary source-bound capture of A followed by a challenge (without manual
  admission or link insertion), forgetting/correction, and edge/source overflow.
  Scripted model behavior proves read plumbing only, not semantic accuracy.

The reported live-pilot case motivated this read fix, but its provider output
is not a test oracle. Surfacing all valid stored direct proposals also surfaces
incorrect model-proposed challenges; this change is not a semantic filter and
does not improve relation precision. No keys, paid calls, hosted wire/API changes or new retained
fields are part of this packet. Relevant existing entrypoints are embedded
`getRationale`, `fetch` in rationale-evidence mode, and `recall` through that
fetch/read projection. The local MCP rationale inspection delegates to the same
core read; its argument shape and namespace binding do not change.
