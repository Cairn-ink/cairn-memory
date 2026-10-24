# HR-3 R4 provenance correction

Base: `14504dfc557bd97a7833c493f3210db78322de64`, branch
`experiment/hr3-update-policy`; clean worktree at entry. Authority: protocol
v0.3.4, errata rev2 and the accepted second non-author re-check. No commits,
network/API/model calls or credential reads. Writes are confined to generator,
integration and harness. Protocol, scorer, policies and prompts are unchanged.

## Finding → fix → test

| Finding / requirement | Fix | Verification |
| --- | --- | --- |
| P1: R3 banks are derived but ancestry claims independent roots | Record same-split retired parents, the revision relation, reciprocal derivative links and the archived inventory address. Publish retired bank records so validation can resolve ancestry and detect alias reuse. All 48 R3 entries are disclosed as revisions: ten rendered engineering/pilot lineages and 38 provisional held-out specifications. | Positive parent resolution; negative cross-split parents, cycles, falsely independent R3 roots and active/retired alias reuse. Independent archive comparison verifies the retired banks exactly match their archived predecessors. |
| §9 fresh held-out lineage requirement is still pending | Record an explicit post-calibration-v2, pre-development gate for 8 development and 30 test replacement banks. Preserve every frozen allocation and multiplicity, and require published ancestry/allocation before affected held-out generation. | Gate is pending; existing held-out bank contents remain unchanged and provisional. No fresh held-out semantic banks, conversations or gold are instantiated now. |
| Preserve the two resolved implementation findings | Leave bound writer, accounting, scoring and E-2 execution unchanged. Regenerate metadata/hashes and rerun all three suites. | Integration gold self-score and complete/interrupted harness tests rerun; frozen causal strata and both E-2 paths remain covered. |

## Truthful provenance and pending development gate

The previous claim of **48 fresh independent lineage roots is withdrawn**.
R3 engineering and pilot fixtures are revisions of the archived fixtures;
new identifiers and sampling keys do not establish fresh authoring lineages.
There are five engineering and five pilot revised lineage specifications,
covering fifteen rendered families. Their `ancestry.parent` names the retired
predecessor, e.g. `pilot-expiry-L02-R3` → `pilot-expiry-L02`. The archived parent
bank is published in `retired_lineages`, linked back to its revision and to
`artifacts/previous-ff192c6b/pilot/lineage-inventory.json` in the generator.

The eight development and thirty test R3 entries remain **derived provisional
specifications**, not fresh banks. They also disclose their retired parents;
none is certified as a completed §9 replacement. The original 310 active
allocation slots and multiplicities are unchanged; the 48 retired records are
provenance records, not additional allocated families or inference units.

**Explicit pre-development gate — pending and not implemented now:** after
independent calibration v2 passes, and before development or affected held-out
generation, instantiate fresh semantic banks for the **8 development and 30
test** replacement lineages, preserving every frozen allocation and
multiplicity. Publish their ancestry and allocation before generation.
Current R3 revisions do not certify completion of this fresh-lineage
requirement. This task records the gate; it does not create those banks.

Validators permit disclosed same-split revision ancestry, resolve parents,
check reciprocal links and reject cycles, cross-split ancestry, duplicate bank
identities and literal alias reuse across active and retired banks. Both an
active-to-active cross-split alias and reuse of an archived parent's alias are
invalid. No ancestry relation is concealed by changing a name.

The R3 causal fix remains: direct expiry permits a supported deadline trigger;
non-clock lapse fixtures retain genuine unstated/multi-hop gold. Counts remain
engineering 20 multi-hop / 5 unstated and pilot 40 / 10 at both probes, with
prospective development 120 / 40 and test 800 / 400 allocation slots. Frozen
weights and power-analysis allocation are unchanged.

Earlier artifacts stay preserved. `../generator/artifacts/previous-ff192c6b/`
retains the original predecessors; `../generator/artifacts/previous-14504dfc/`
retains the R3 output metadata/datasets, README and freeze before this correction.
[reports/REVISION-14504dfc.md](reports/REVISION-14504dfc.md) preserves the prior
report as a historical record; its freshness claims are superseded here.

## Commands and actual exit codes

Dependency flags refer to the existing `adapters/mcp/node_modules` and
`adapters/openai/node_modules` in this checkout. No installation was performed.
Exit codes are captured directly, never inferred from a stdout tail.

| Command/check | Exit | Result |
| --- | ---: | --- |
| `node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` | 0 | 35/35: provenance, allocation, deterministic generation and negative validation cases |
| Archive old outputs, then generator `emit` for engineering/pilot at active artifact paths | 0 | 30 engineering + 60 pilot; metadata regeneration only; no held-out rendering |
| Independent stored-byte / archived bank / held-out bank comparisons | 0 | 90 worlds unchanged; 48 retired banks match archive; all 310 active bank contents unchanged |
| `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` | 0 | 19/19; all 120 gold self-scores give C=O=R=J=1 |
| `node evaluation/hr3/integration/cli.mjs mechanical --out evaluation/hr3/integration/artifacts/provenance-r4` | 0 | 120 pilot checkpoints + 1,984 challenge cases; no failures |
| `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` | 0 | 67/67; complete pilot (480 observations, 2,786 reservations), interrupted CLI, 27 states and both E-2 paths |
| Independent inventories, hashes, write-scope, whitespace and local-path checks | 0 | Independent lists, hashes, write scope, whitespace and local-path checks pass |

## Changed files

**21 changed/new nonignored paths**:

```text
evaluation/hr3/generator/README.md
evaluation/hr3/generator/artifacts/engineering/manifest.json
evaluation/hr3/generator/artifacts/pilot/manifest.json
evaluation/hr3/generator/artifacts/previous-14504dfc/README.md
evaluation/hr3/generator/artifacts/previous-14504dfc/archive-manifest.json
evaluation/hr3/generator/artifacts/previous-14504dfc/engineering/manifest.json
evaluation/hr3/generator/artifacts/previous-14504dfc/freeze.json
evaluation/hr3/generator/artifacts/previous-14504dfc/pilot/manifest.json
evaluation/hr3/generator/artifacts/verification/r4-tests.tap
evaluation/hr3/generator/deliver.mjs
evaluation/hr3/generator/freeze.json
evaluation/hr3/generator/inventory.mjs
evaluation/hr3/generator/test/generator.test.mjs
evaluation/hr3/generator/validate.mjs
evaluation/hr3/harness/REPORT.md
evaluation/hr3/harness/REVISION-REPORT.md
evaluation/hr3/harness/freeze.json
evaluation/hr3/harness/reports/REVISION-14504dfc.md
evaluation/hr3/integration/REPORT.md
evaluation/hr3/integration/delivery.json
evaluation/hr3/integration/mechanical-results.json
```

This list is cross-checked through (1) scoped Git diff plus nonignored untracked
files and (2) independent recursive filesystem discovery and Git-blob hashes
against HEAD. Ignored generated datasets and prior archives are inventoried
separately; delivery manifests exclude their own hash.

## Remaining gates

Fresh affected development/test banks remain a future post-calibration-v2,
pre-development requirement. Non-author review, calibration/adjudication,
resource capacity, maximal token-fit and original continuation gates remain
pending. No accuracy claim, Advance/Keep decision or continuation approval is
produced. The two previously resolved implementation findings remain resolved.
