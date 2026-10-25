# A-5 structural checks (synthetic design computations)

These are the computations behind errata A-5 (protocol `../../protocol/errata.md`), copied from the protocol author's dispatch record. They use no pilot data.

- `a5-structural-r1.py`, `a5-percentile-bound-r1.py`: exact or analytic coverage ceilings of the frozen corrected bootstrap for binary absolute panels at the pilot, development and test allocations.
- `a5-fixed-matrix-r1.py`: probes using the actual frozen draw matrix (`../random.mjs`).
- `a5-kl-check-r1.py`: checks of the KL-Chernoff carrier.
- `*-results.json`, `a5-structural-r1-report.md`, `a5-computation-exits-r1.txt`: recorded outputs and exit codes.

The only edit after the recorded runs: `a5-fixed-matrix-r1.py` imported `random.mjs` by an absolute local path. It now resolves the same module relative to this directory. The `script_sha256` recorded in `a5-fixed-matrix-r1-results.json` is therefore that of the original file.
