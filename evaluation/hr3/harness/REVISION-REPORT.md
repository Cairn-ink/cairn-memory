# HR-3 audit re-check R3

Base: `ff192c6b346bc1e265c7eff85eb056a6cd5109bf`, branch
`experiment/hr3-update-policy`; clean worktree at entry. Authority: protocol
v0.3.4, errata rev2 and the accepted non-author re-check. No commits, network,
API/model calls or credential reads. Writes are confined to generator,
integration and harness. Protocol, scorer and challenge bytes are unchanged.

## Finding → fix → test

| Accepted finding | Fix | Verification |
| --- | --- | --- |
| P1: supported expiry triggers destroy effective unstated/multi-hop allocation | Chose the auditor's **fixture-rebalancing** alternative. Retain valid clock triggers in direct expiry. Replace non-direct expiry with fresh unscheduled-lapse fixtures that have no preannounced deadline. Derive effective status/minimum accepted edge count from gold; keep authored topology separate. Restore original allocation definitions, guard membership, weights and power allocation. | Gold-derived validation at both probes: engineering 20 multi-hop / 5 unstated, pilot 40 / 10. All six per-type graph allocations remain exact. Prospective development 120 / 40 and test 800 / 400 are preserved without rendering held-out conversations/gold. A deliberately added one-edge shortcut is rejected even if the authored label says multi-hop. All 120 pilot gold self-scores give C=O=R=J=1. |
| P1: official writer rejects interrupted stages | Accept hash-verified incomplete/stopped pilot artifacts. Preserve completion flag, stop reason and unexecuted IDs; label aggregates as partial observed cohorts. Verify the journal read-only; distinguish settled spend from outstanding reservation ceilings and unknown final billing. Never resume or approve continuation. | CLI on actual interrupted artifacts exits 0: complete=false, three_transport_failures, 2 attempted (1 valid, 1 failed), 478 unexecuted, 3 outstanding reservations. Unit coverage includes cap_exceeded, settled and unknown real billing, fake zero spend, all 27 states, weights/referral distinctions, hash verification and overwrite rejection. Runner test compares ledger/manifest bytes before and after reporting. |
| P2: E-2 authoring-path coverage and metadata incomplete | Fixtures explicitly choose confirm_with_dependencies with no standalone declaration, or confirm without dependencies then declare against null. Runner executes the supplied path without removing dependencies. Clear active blocked/unresolved E-2 flags; external certification gates stay explicit. | Pilot: 24 direct confirmations, 16 separate declarations; both paths in all eight branches. Public product tests execute all 16 path×branch combinations, inspect null declaration expectations / positive review revisions, and require no authorized-call failures. Unauthorized controls still refuse mutation. |

## Explicit fixture changes and preserved artifacts

The protocol's allocation definitions are unchanged; we did not redefine
“multi-hop” to mean an authored topology that has a one-edge alternative.
`reason-strata.mjs` derives status and the minimum edge count across accepted
complete gold graphs. Every rendered family publishes `reason_strata`, separately
from `authored_rationale_topology`; its `multi_hop` guard membership is derived.

Only direct expiry carries a preannounced clock deadline. A non-clock lapse
reports expiry without a successor or fallback. In unstated cases no cause is
supplied; in conditional cases the complete supported causal graph is required.
Its occurrence timestamp is not a deadline previously attached to the assertion.
The earlier assertion's source-claimed end is unbounded. This transparently
changes sources, source intervals, C/O gold, reason gold and semantic bank IDs
for the affected fresh fixtures; the frozen question template is retained.
The frozen public-operation policies are unchanged; no special P handling is
added to improve outcomes on the replacement fixtures.

There are **48 fresh affected lineage specifications** among the original 310:
five engineering, five pilot, eight development and thirty test. The original
per-split lineage multiplicities, language totals, per-type causal counts and
control totals remain intact. Held-out worlds stay unrendered; affected held-out
IDs/bank aliases are fresh before later gated generation. Frozen weights remain
1/30, 1/50, 1/200 overall; 1/6, 1/10, 1/40 within type; and 1/20, 1/30, 1/100
for the multi-hop guard. Their original power-analysis allocation is unchanged.

**15 rendered families / 30 checkpoints are replaced**. For each family below,
batches 2 and 4 change, and `-R3` is inserted immediately before `-Wn`:

```text
engineering-expiry-L02-W1
engineering-expiry-L03-W1
engineering-expiry-L04-W1
engineering-expiry-L05-W1
engineering-expiry-L06-W1
pilot-expiry-L02-W1
pilot-expiry-L02-W2
pilot-expiry-L03-W1
pilot-expiry-L03-W2
pilot-expiry-L04-W1
pilot-expiry-L04-W2
pilot-expiry-L05-W1
pilot-expiry-L05-W2
pilot-expiry-L06-W1
pilot-expiry-L06-W2
```

The direct L01 engineering/pilot cases retain supported expiry triggers. The
three L02 families replace the six previously reported unstated-expiry cases
with fresh genuinely unstated fixtures. Existing explicit deadline examples
are preserved, not relabeled as lacking a supported cause.

Earlier engineering/pilot datasets, manifests, README and freeze are retained
byte-for-byte in `../generator/artifacts/previous-ff192c6b/`, with 18 archived
payloads and an archive manifest. Previous integration records are retained in
`../integration/artifacts/previous-ff192c6b/`. The prior revision report is
[reports/REVISION-ff192c6b.md](reports/REVISION-ff192c6b.md), and the prior complete
fake report remains [reports/a1-fake-pilot.json](reports/a1-fake-pilot.json).
The prior harness freeze is [reports/freeze-ff192c6b.json](reports/freeze-ff192c6b.json).
These are historical artifacts, not active R3 certifications. Current partial
report: [reports/a1-r3-stopped-pilot.json](reports/a1-r3-stopped-pilot.json).
Large deterministic JSONL datasets retain the repository's existing ignore policy;
the archived bytes and their hashes remain available locally and are inventoried.

## Commands and actual exit codes

Dependency arguments below are the existing `adapters/mcp/node_modules` and
`adapters/openai/node_modules` in this checkout. No installation was performed.
All statuses are captured process exit codes, never inferred from stdout tails.

| Command/check | Exit | Result |
| --- | ---: | --- |
| `node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` | 0 | 31/31 tests |
| Archive previous outputs, then call generator `emit` for engineering and pilot at the active artifact paths | 0 | 30 engineering / 60 pilot, zero rejects; restored effective strata and E-2 paths |
| Independent generator regeneration + stored-byte / archive SHA-256 comparison | 0 | Engineering/pilot byte-identical; all 18 prior generator payloads unchanged |
| `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` | 0 | 19/19 tests; all 120 self-scores pass |
| `node evaluation/hr3/integration/cli.mjs mechanical --out evaluation/hr3/integration/artifacts/audit-recheck-r3` | 0 | 120 gold checkpoints, 1,984 challenge observations, zero validation/execution failures |
| Zero-judgment calibration gate on the regenerated index | 1 | Expected: 36/72 referral quotas; judgments remain pending |
| `node --test --experimental-test-isolation=none evaluation/hr3/harness/test/bounds.test.mjs` | 0 | 32/32: all 27 states, aggregation, stopped accounting and provenance |
| `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` | 0 | 67/67 tests; new complete fake pilot (480 observations, 2,786 reservations), both E-2 paths and interrupted CLI |
| Injected fake transport run to `evaluation/hr3/harness/artifacts/audit-recheck-r3-stopped` | 0 | Expected three_transport_failures stop exercised and persisted; no real calls |
| `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/audit-recheck-r3-stopped --inputs evaluation/hr3/generator/artifacts/pilot --out evaluation/hr3/harness/reports/a1-r3-stopped-pilot.json` | 0 | 48 partial table rows, 2 attempted / 478 unexecuted; actual fake spend $0 |
| Final independent inventories, hashes, write-scope, UTF-8/newline/whitespace and local-path checks | 0 | Git and independent filesystem/blob inventories, hashes, write scope, whitespace and path checks pass |

An initial new integration assertion expected a mechanical zero for every
incomplete multi-hop graph and exited 1. The frozen scorer can refer unknown
semantic equivalences; a referral is not an accepted complete graph. The test
now verifies that incomplete graphs never receive R=1 and that unresolved cases
have a correctness referral. The unchanged scorer's complete gold still earns
R=1. The rerun passed 19/19, exit 0. No scorer patch was made. A final whitespace check initially exited 2 for an extra
blank line at the end of integration/REPORT.md; that line was removed and the
check was rerun.

## Changed files

**36 changed/new nonignored paths**:

```text
evaluation/hr3/generator/README.md
evaluation/hr3/generator/artifacts/engineering/manifest.json
evaluation/hr3/generator/artifacts/pilot/manifest.json
evaluation/hr3/generator/artifacts/previous-ff192c6b/README.md
evaluation/hr3/generator/artifacts/previous-ff192c6b/archive-manifest.json
evaluation/hr3/generator/artifacts/previous-ff192c6b/engineering/manifest.json
evaluation/hr3/generator/artifacts/previous-ff192c6b/freeze.json
evaluation/hr3/generator/artifacts/previous-ff192c6b/pilot/manifest.json
evaluation/hr3/generator/artifacts/verification/r3-tests.tap
evaluation/hr3/generator/bank.mjs
evaluation/hr3/generator/controls.mjs
evaluation/hr3/generator/deliver.mjs
evaluation/hr3/generator/freeze.json
evaluation/hr3/generator/generate.mjs
evaluation/hr3/generator/inventory.mjs
evaluation/hr3/generator/reason-strata.mjs
evaluation/hr3/generator/test/generator.test.mjs
evaluation/hr3/generator/validate.mjs
evaluation/hr3/harness/README.md
evaluation/hr3/harness/REPORT.md
evaluation/hr3/harness/REVISION-REPORT.md
evaluation/hr3/harness/bounds.mjs
evaluation/hr3/harness/cli.mjs
evaluation/hr3/harness/freeze.json
evaluation/hr3/harness/product.mjs
evaluation/hr3/harness/reports/REVISION-ff192c6b.md
evaluation/hr3/harness/reports/a1-r3-stopped-pilot.json
evaluation/hr3/harness/reports/freeze-ff192c6b.json
evaluation/hr3/harness/test/bounds.test.mjs
evaluation/hr3/harness/test/product.test.mjs
evaluation/hr3/harness/test/runner.test.mjs
evaluation/hr3/integration/REPORT.md
evaluation/hr3/integration/delivery.json
evaluation/hr3/integration/mechanical-results.json
evaluation/hr3/integration/reconciliation-fields.json
evaluation/hr3/integration/test/integration.test.mjs
```

Inventories are cross-checked using (1) scoped git diff plus untracked nonignored
files and (2) an independent recursive filesystem inventory and Git-blob hashes
against the HEAD tree. Regenerated ignored datasets and stage artifacts have
separate explicit-output-map versus filesystem/hash checks. Delivery manifests
exclude their own hashes.

## Remaining external gates

The three accepted implementation findings are addressed. Non-author semantic
review of fresh fixtures, independent calibration v2, maximal token-fit checks,
resource capacity and original development-entry requirements remain pending.
Calibration v1 still meets only 36/72 referral quotas. No adjudication, factual
research-arm accuracy, Advance/Keep decision or continuation approval is produced.
