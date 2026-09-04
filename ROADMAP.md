# Roadmap

## M1 — internal dogfood (complete)

- Completed real two-session sourced recall against the hosted service.
- Verified pause/resume, fail-open behavior, Source Receipts, and forgetting.

## M2 — public alpha

- Recruit 10 developers; target 6 activations and 4 useful second-session recalls.
- Measure false memories, redaction misses, and recall usefulness before adding vector infrastructure.
- Record a short reproducible demo and publish the repository and `v0.1.0` release.
- Day 7 target: 100 GitHub stars. Day 30 target: 300; stretch: 500.

## M3 — trust and client coverage

- Add automatic Codex lifecycle-hook support without weakening the privacy contract.
- Add the smallest useful memory inspection/edit/delete UI to Cairn.ink.
- Treat `sourced_cross_session_recall`, not stars, as the product north star.

## Later

- Evaluate additional host hooks or extensions without claiming passive capture where none exists.
- Add an npm CLI only if it materially shortens setup or operates a real local service.
- Add explicit human-confirmed promotion from private Memory into governed shared knowledge.
