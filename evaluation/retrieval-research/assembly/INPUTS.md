# HR-2 frozen inputs

Protocol HR-2 v1.1, frozen at `c863e9d6`. Paths are relative to the research directory; member paths are relative to the archive root. SHA-256 hashes cover exact bytes. Only these with-foreign S1000 members are authorized for test. Dev rankings are authenticated against FROZEN.md and run metadata, and are exploratory.

```json
{
  "archive": "results/test-final/rankings.tar.xz",
  "archiveSha256": "aa4c506f07bff0b9c9283b1410019cbecef2da9af61e55338c9616acffe6e256",
  "members": {
    "with-foreign/base-S1000/A1.json": "096d5ba71655eda1d91126d14ae5c1c465fb539faece86bb541bcee4bc7074ae",
    "with-foreign/local-S1000/A3--bge-m3.json": "57cb2ccad4928c338026327170de8fd4478a7cae057ececa873401bc405ee672",
    "with-foreign/hosted-S1000/F-RRF10--openai-3-small.json": "f24fc35ffc351a4579645d4509a5f25e24b1597ad82e743f1c311849260064ea"
  },
  "fixtureHashes": {
    "hr1-corpus.json": "1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5",
    "hr1-facts-view.json": "65fc2e46c474f8d3f532bae7ea9a95441a17a67c4350fe01a091022b10e18971",
    "hr1-facts.json": "339fbdb91158a7593265c129c31bc205f4efe6a552301bcab1e063e12f8e5087",
    "hr1-label-audit.json": "5e1e585fc5d85ccb92965fd0f15d70dea8f727dc7622990174ece03e21a01d0d",
    "hr1-labels.json": "7e9b8054cf7e5bec7b71789319696ee871a4d5c627c877cba0952f6c74211622",
    "hr1-queries.json": "91648404a6ea32866081a7e308e20235fd0209835ff2cfee09b7abe074bae9ea",
    "hr1-split.json": "00e96f9e764da780d7024eac62bc15442dde3e02166c4057bbf49d82ae8c1ebb"
  }
}
```

The archive digest records provenance. When consuming an extracted directory, the harness verifies each selected member digest; it does not require the archive beside the extraction. FROZEN.md is independently parsed and all seven fixture files are rehashed on every run and scoring invocation.

## Exploratory host-v2 input (§11 v1.2.1)

Path: `assembly/overhead-host-v2.json` (relative to the research directory).
SHA-256: `5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b`.
Implementation commit: `42627f60`; §11 freeze / `run.extensionCommit`: `4fb90832`.
The frozen base `run.protocolCommit` remains `c863e9d674f23ccebffaf3ad96ab1c4b34eabc82`.
Each host-v2 stage hashes the exact pinned file bytes. Its complete constants
object (including unused probe constants) and `bodyTokens` must match the cell's
model payload exactly. This is an approximate default-Memory calibration,
not shipped-host token counts; later completeness transitions, cross-item
deduplication, non-default metadata, sourceAccess, Cards and UUID/text variation
are not modelled faithfully.

## HR-2b runtime input profile

HR-2b v1.1 is frozen at `d3a6e24f`. Fixture version remains `hr2b-fixture-v1`;
no fixture or ranking hashes are invented here. At run time,
`fixtures-hr2b/FROZEN.md` authenticates its complete listed manifest (including
at least the seven `hr1-*.json` schema files). The corpus version selects
`hr2b-fixture-v1`, and all version-bearing products must agree.
`results/hr2b-rankings/FROZEN.md` authenticates `configuration.json`,
`host-v2-calibration.json`, `dev/A1.json`, `dev/A3--bge-m3.json`,
`test/A1.json` and `test/A3--bge-m3.json`. Both freezes use backtick filename /
SHA-256 tables. Cells embed these manifests, configuration, placement quotas,
represented guard categories, paths and hashes; scoring/reporting re-read and
authenticate them. Keep frozen fixture/ranking paths available throughout.
The HR-2 JSON manifest above remains authoritative only for HR-2.

The amended profile allows 1–4 receipts with histogram `[.20,.25,.25,.30]`.
For each of first-receipt and later-receipt, test requires ≥30 groups / ≥12
families; dev requires ≥4 families and no group minimum. Per-category counts
and the frozen guard-category union remain descriptive; no per-category
minimum applies. The confirmatory later-receipt guard uses
`pooled-group-coverage-v1`: covered-group count difference / group occurrences,
in percentage points, with N contributing families sampled N times with
replacement per draw (10,000 draws, seed `hr2b-bootstrap-v1`, N≥10,
interpolated 2.5/97.5 percentiles, no category redraw). Any invalid draw is
Inconclusive. Absolute guard coverage and ranking ceiling are pooled with
the same denominator; zero pooled ceiling is an Inconclusive gate. The
per-category delta table has point/groups/families only, no CI or decision.
The primary contrast and other strata retain category-macro statistics and
the +3/−5 decision thresholds remain unchanged. Calibration probes 1–4
receipts; the overhead constants are unchanged.

HR-2b ranking commands explicitly select `--fixture-version hr2b-fixture-v1`
before fixture loading; this bypasses only the HR-1 selection branch and is
checked against the authenticated fixture version. Legacy callers retain their
selection-first refusal order.

The exact coordinator commands for protocol §9 steps 3–5 are in
[README.md, Coordinator steps 3–5](README.md#coordinator-steps-35-never-worker-commands).
Execute that complete block, including stage logging, fixed configuration
before calibration, both ranking splits and freeze, scratch assembly output,
compression and final promotion. It records the reviewed checkout before any
output. Only the coordinator runs its ranking/test commands through
`~/.local/bin/cairn-heavy`; workers run individual touched test files only.
