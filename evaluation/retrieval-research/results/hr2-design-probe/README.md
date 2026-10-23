# HR-2 design probe (dev split only; not a result)

Produced 2026-10-23 by the U5b coordinator before the HR-2 protocol was
frozen. These scripts measured whether the charter §6 budgets bind on the
frozen HR-1 fixture, and whether the assembly arms differ at all. See
`docs/plans/budgeted-assembly-hr2.md` §1 for what was learned.

- `measure.mjs <extracted rankings dir>`: token volume of the top-12 / top-24
  candidates of three test rankings, body only and body + spans, with the
  product counter (`o200k_base`). Reads only token counts and categories; no
  evidence labels are used for scoring. Output: `volume-test-S1000.txt`.
- `probe.mjs <rankings dir> dev`: macro group coverage of six packing arms on
  the **dev** split rankings in `results/dev/`, budgets 128–1536. Output:
  `probe-dev-S1000.txt`.

Both need `npm ci --offline --ignore-scripts --prefix adapters/openai` for
`tiktoken`. The test-split rankings were only used for token volume, never for
coverage, before the freeze.
