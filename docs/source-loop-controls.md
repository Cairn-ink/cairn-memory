# Source-loop controls (offline driver, not a quality result)

`evaluation/live/source-loop-controls.mjs` runs bounded synthetic cases through
injected shared-core/model implementations. It creates a new temporary SQLite
store per case; there is no option to point it at an existing database. It never
reads credentials or creates a provider transport. Temporary evidence is retained,
not destructively cleaned. Raw reports are private diagnostic data; they are not
the allowlisted public export used by prior ablations.

Each case supplies up to three source windows (four messages each, 800 characters
per message), one query, and evaluation-only required source IDs. Up to eight
cases are accepted. Required IDs are not passed to model methods. Capture uses
`source-bound-v2` qualification and the real extractor/classifier path; no ideal
memories are manually admitted. Every window is followed by close, keyless reopen,
and full snapshot comparison. A failed capture stops later capture windows but
does not hide the partial downstream outcome.

After reopening with the model, MOC recall requests `source-evidence`, limit six.
Controls use the same original, read-only decision-basis port:

- MOC-selected refs, without rescuing missing refs from the rubric.
- Up to six positive-overlap lexical source matches: case-folded Unicode words
  and Han code points, score by unique query-token overlap, snapshot-order ties.
  This deliberately simple baseline is not a semantic retrieval claim.
- All captured source refs. If there are more than six, the oracle is explicitly
  unavailable under the unchanged port cap; it is not truncated.

`capturedCoverage` measures retained source message IDs. `recalledCoverage` counts
only receipt IDs actually returned by recall. Each control's coverage measures
the complete sources attached to its selected refs; basis review may expand those
refs to their full receipts. Keep these stages distinct. Coverage checks presence,
not whether the source actually supports a later assertion or preserves every
detail needed for a real answer.

Empty selection, failed recall, over-cap oracle and rejected basis outputs remain
separate statuses. A structurally accepted basis result is `unassessed`, including
an exact-source but semantically false challenge. `observed` means the diagnostic
ran and preserved snapshots, not that the memory task succeeded. Raw capture
envelopes retain classification/qualification status for later interpretation.

The scripted tests deliberately inject extraction loss, selection/ranking loss,
wrong but structurally valid relationships, provider-output failure and cap overflow.
They use the real shared core, not real models. This does not yet exercise a pinned
installed artifact, MCP consumer, ordered reconciliation, final answers, long-term
maintenance, or held-out/user quality. A paid run still needs separately frozen
cases/rubric, installed provenance, guarded transport, durable budget, failure
retention and independent pre-live review. This driver grants no paid authority.
