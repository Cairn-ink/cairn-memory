# Audit re-check R3

See [REVISION-REPORT.md](REVISION-REPORT.md) for the accepted finding → fix → test
mapping, explicit fixture rebalancing, changed-file inventory and exit codes.

Current official partial output is
[reports/a1-r3-stopped-pilot.json](reports/a1-r3-stopped-pilot.json). It comes from
actual interrupted pilot artifacts and retains complete=false, the stop reason,
2 attempted observations, 478 unexecuted cases and 3 unsettled reservations.
The report CLI exits 0 without modifying the stage ledger or manifest. Real
unknown billing is separated from settled spend; fake actual spend is zero.

The generator's active effective strata now match frozen requirements: pilot
40 multi-hop and 10 unstated families, engineering 20 and 5, at both checkpoints.
The new E-2 fixture paths cover direct confirmation and separate declaration
across all eight branches. External audit, calibration and paid-stage gates are
still pending. Earlier complete-run reports remain retained as historical
artifacts; their corpus and certification claims are superseded by R3.
