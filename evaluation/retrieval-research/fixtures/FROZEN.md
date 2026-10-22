# HR-1 fixture freeze (`hr1-fixture-v2`)

Frozen on 2026-10-23 before any result-producing run (protocol v2.2 §4.1 step 6).

After any test-split result, no change to these bytes is allowed (protocol §9.7). A
defect creates a new fixture version, reported alongside this one.

**Provenance**:
- facts and corpus: `hr1_world_author` (W1);
- queries: `hr1_query_author` (W2), written from the text-free facts view in an
  isolated folder;
- split and labels: deterministic tools;
- overrides: `hr1_label_audit` (W3), 11 operations, applied with
  `tools/apply-audit.mjs`.

All three authors are separate Codex gpt-6.1-sol/xhigh workers.
`tools/validate.mjs` returns ok on Node 22.16.0 and 24.15.0, and the
public-API preflight finds 0 incompatibilities across 1,100 memories.

| File | SHA-256 |
| --- | --- |
| `hr1-facts.json` | `339fbdb91158a7593265c129c31bc205f4efe6a552301bcab1e063e12f8e5087` |
| `hr1-corpus.json` | `1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5` |
| `hr1-facts-view.json` | `65fc2e46c474f8d3f532bae7ea9a95441a17a67c4350fe01a091022b10e18971` |
| `hr1-queries.json` | `91648404a6ea32866081a7e308e20235fd0209835ff2cfee09b7abe074bae9ea` |
| `hr1-split.json` | `00e96f9e764da780d7024eac62bc15442dde3e02166c4057bbf49d82ae8c1ebb` |
| `hr1-labels.json` | `7e9b8054cf7e5bec7b71789319696ee871a4d5c627c877cba0952f6c74211622` |
| `hr1-label-audit.json` | `5e1e585fc5d85ccb92965fd0f15d70dea8f727dc7622990174ece03e21a01d0d` |
