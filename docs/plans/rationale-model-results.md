# Preserve the fixed model-control evidence

Base d27e5a5ef4ea6528279c47abbdd42c4db9bbd633 (#84 merge).
Prepared before live execution; no outcomes are asserted here.

## Acceptance

1. Export exactly the frozen eight-case, three-model, two-input-mode schedule,
   including failed and not-run arms, raw proposed edges and warm/cold evidence.
   Preserve unavailable/malformed output as unavailable, never as empty edges.
2. Public output is a closed synthetic projection: no keys, private paths,
   namespaces, sessions, transport headers or authorization files. Include fixed
   provenance hashes, all model IDs, costs/unknowns and per-arm request counts.
3. Preserve the exact pre-outcome fixture/rubric and independent review caveats.
   Report model comparison within each input mode, with source ambiguity,
   direction, role, scope, abstention and missing positive links distinguished.
4. No automatic semantic grading or conclusions from completion. State manual
   ingestion, synthetic sample and same-family reviewer limitations; do not claim
   full MCP capture/answer reliability or erase earlier failed experiments.
5. Pure exporter tests cover frozen schedule, retained failures, privacy rejection
   and exact published evidence. Generic/live-offline gates on both runtimes and
   independent dual review before delivery. No paid calls in this report slice.
