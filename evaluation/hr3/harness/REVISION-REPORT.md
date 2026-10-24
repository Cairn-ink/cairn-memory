# Revised HR-3 E-1 / A-1 implementation

Base: `983d239d6315c1d4f36434acc73c367e8f5416f6`, branch
`experiment/hr3-update-policy`. Authority: revised 2026-10-25
[errata](../protocol/errata.md) and protocol v0.3.4. No commit, network, API,
model call or credential read. The existing protocol/errata.md modification
predated this task and was left untouched. Implementation writes are confined
to generator, integration and harness.

## Results

E-1 now accepts an explicitly supported deadline-passed → expiry graph as a
complete explanation, alongside the authored rationale alternatives. Only
changes with no supported cause retain `not_stated`. Bare deadline mentions,
deadline fragments without the causal statement, missing edges/citations and
incorrect `not_stated` answers receive R=0 in the integration regression tests.
The scorer is unchanged; no blocking scorer defect was found.

The generator README lists every affected family/checkpoint: **36 rendered
expiry checkpoints**, comprising six engineering families × two checkpoints
and twelve pilot families × two checkpoints. The previously reported six are
`engineering-expiry-L02-W1`, `pilot-expiry-L02-W1` and
`pilot-expiry-L02-W2`, each at batches **2 and 4**. The full list is in
[generator interpretation item 5](../generator/README.md). Both engineering
and pilot were regenerated; their stored family/gold/support bytes match a
fresh independent generation. All 31 generator inventory files and 30 hashed
payloads match the refreshed freeze. Held-out worlds remain unrendered.

The integration re-check validates and self-scores **120/120 pilot checkpoints
C=O=R=J=1** and scores all **1,984** challenge cases without execution or
validation failures. Results and hashes are recorded in
[mechanical-results.json](../integration/mechanical-results.json). The field
ledger now contains 792 leaf patterns and 1,563,796 audited source leaves.
All 3,140 pass-payload hashes, contextual keys and pass-specific allowlists were
independently rederived in Python. The scorer/challenge tracked bytes match HEAD.

A-1 is implemented by [bounds.mjs](bounds.mjs) and `--bound-report` in the CLI.
The JSON report has 48 arm/checkpoint/type table rows and per-family component
and joint bounds. It records score-state counts, separate outstanding pass
applications/unique keys/propagations, all completion denominators, represented
families/lineages, frozen/applied weights, and separate unresolved-J/any-referral
shares. It retains execution-time artifact/scorer/errata hashes and actual spend.
The complete fake report is [reports/a1-fake-pilot.json](reports/a1-fake-pilot.json).
Its exact label is:

**Uncalibrated engineering pilot — mechanical score bounds; no adjudication.**

Joint endpoints are multiplied within families before frozen-weight aggregation.
A pending pass never reopens a determined score. Unexecuted cases are listed and
excluded from observed denominators; failed attempts remain scored. Partial
groups explicitly condition on represented lineages, retaining relative frozen
weights. No sampling CIs or advancement decisions are produced.

## Commands and actual exit codes

Dependency directories below refer to the existing installations in this
checkout; no dependencies were installed. Logs are local ignored files.

| Command/check | Exit | Result |
| --- | ---: | --- |
| `node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` | 0 | 29/29 tests |
| `emit({split:'engineering', out:'evaluation/hr3/generator/artifacts/engineering'})` and equivalent pilot emission through the generator module | 0 | 30 engineering and 60 pilot families; no rejections |
| Independent generator regeneration, stored-byte comparison, inventory and SHA-256/byte readback | 0 | Deterministic engineering/pilot; 31 inventory files |
| `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` | 0 | 18/18 tests, including all 120 self-scores and revised E-1 rejection cases |
| `node evaluation/hr3/integration/cli.mjs mechanical --out evaluation/hr3/integration/artifacts/revised-e1-final` | 0 | 120 gold checkpoints and 1,984 challenge observations; no failures |
| Integration repeat/readback and independent pass-payload hash/key/allowlist audit | 0 | Repeated outputs agree; 3,140 blinded bundles verified |
| `node evaluation/hr3/integration/cli.mjs gate --index evaluation/hr3/integration/artifacts/revised-e1-final/private-index.json --judgments evaluation/hr3/integration/artifacts/empty-judgments.jsonl --out evaluation/hr3/integration/artifacts/revised-e1-final/gate-no-judgments.json` | 1 | Expected: calibration quota failure; absent judgments stay pending |
| `node --test --experimental-test-isolation=none evaluation/hr3/harness/test/bounds.test.mjs` | 0 | 32/32: all 27 states plus aggregation/referral/failure/provenance coverage |
| `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/generator/artifacts/pilot --out evaluation/hr3/harness/artifacts/revised-a1-pilot --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` | 0 | 480 observations; 2,798 settled reservations; no failures |
| `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/revised-a1-pilot --inputs evaluation/hr3/generator/artifacts/pilot --out evaluation/hr3/harness/reports/a1-fake-pilot.json` | 0 | 48 aggregate rows; 480 per-family records; actual spend $0 |
| `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules --pilot-artifacts evaluation/hr3/harness/artifacts/revised-a1-pilot` | 0 | 67/67 tests; includes fake pilot report and independent smoke runs |
| Final file inventories, hashes, whitespace, write-scope and absolute-path checks | 0 | Inventories, hashes, whitespace and write-scope checks pass |

An initial bound-only test run exited 1 due to floating-point accumulation
(`0.49999999999999994` instead of `0.5`). Aggregation now averages the frozen
equal-weight lineage means directly. The rerun passed all 32 tests, exit 0.
Integration command provenance was also corrected to preserve the separator in
repo-relative command paths; the final re-check records executable paths.

## Changed files

**27 changed/new nonignored files** (the pre-existing protocol errata change is excluded):

```text
evaluation/hr3/generator/README.md
evaluation/hr3/generator/artifacts/engineering/manifest.json
evaluation/hr3/generator/artifacts/pilot/manifest.json
evaluation/hr3/generator/artifacts/verification/tests.tap
evaluation/hr3/generator/deliver.mjs
evaluation/hr3/generator/freeze.json
evaluation/hr3/generator/generate.mjs
evaluation/hr3/generator/test/generator.test.mjs
evaluation/hr3/generator/validate.mjs
evaluation/hr3/harness/.gitignore
evaluation/hr3/harness/README.md
evaluation/hr3/harness/REPORT.md
evaluation/hr3/harness/REVISION-REPORT.md
evaluation/hr3/harness/bounds.mjs
evaluation/hr3/harness/cli.mjs
evaluation/hr3/harness/freeze.json
evaluation/hr3/harness/reports/a1-fake-pilot.json
evaluation/hr3/harness/runner.mjs
evaluation/hr3/harness/test.mjs
evaluation/hr3/harness/test/bounds.test.mjs
evaluation/hr3/harness/test/runner.test.mjs
evaluation/hr3/integration/REPORT.md
evaluation/hr3/integration/delivery.json
evaluation/hr3/integration/mechanical-results.json
evaluation/hr3/integration/reconciliation-fields.json
evaluation/hr3/integration/reproduce.mjs
evaluation/hr3/integration/test/integration.test.mjs
```

This list is cross-checked using (1) scoped `git diff --name-only HEAD` plus
untracked nonignored files and (2) independent recursive filesystem discovery
and blob hashing against the HEAD tree. Regenerated ignored datasets are
inventoried separately by the generator manifests and integration/harness
artifact manifests. Self-hashes are excluded from delivery manifests.

## Unresolved/external gates

There is no known implementation blocker for revised E-1/A-1. Calibration v1
still meets only **36/72** referral quotas; no adjudication was run. Non-author
semantic review, independent calibration v2, measured resource capacity and the
original continuation requirements remain required before development. The
bounds are descriptive engineering outputs, with **actual spend $0** in this
fake exercise. They cannot establish factual accuracy or authorize advancement.
Generator E-2 fixture/control clarification status is outside this task; its
existing control script is retained. The harness's existing separate-declaration
path is unchanged. No long-running work is left unattended.
