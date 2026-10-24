## 6. Items, units and representations

- A candidate **item** is one memory of the ranking. It has one **body unit**
  (the memory content) and one **span unit per span**, in fixture order. In
  product terms the body is the Memory content and spans are its receipts
  (`fetchCandidateEvidence` returns content plus receipt refs; receipt text is
  read separately, so spans are the natural "deepen" layer).
- Unit cost is `tokens(unit text) + O`, charged once per admitted unit, where
  `O` is an abstract per-unit surcharge, not measured metadata serialization.
  Primary `O = 0` only; `O = 8` is a sensitivity run.
- A unit is either wholly in the context or absent. No partial units. Admit
  exact fits and continue through all scheduled units; never re-sort the
  frozen ranking.
- **Admission rule (whole-unit).** An arm visits units in its schedule and
  admits each unit independently when its cost fits the remaining budget;
  otherwise it skips that unit and continues. A span unit is scheduled only if
  its item's body unit was admitted (sources never appear detached from their
  memory; this is also contract §15's invariant). "First span" means
  `spans[0]`; a zero-span item contributes only a body. Only P-top+tail tests
  whole-item bundles atomically.
- Arms (all deterministic, all consume the ranking in order; the context is the
  set of admitted units):

| Arm | Pass 1 | Pass 2 |
| --- | --- | --- |
| P-top | for each item in rank order: its body, then its spans in order (rank-first whole-unit) | — |
| P-top-s1 | the same with only `spans[0]` | — |
| P-cover | body of every item in order | all spans, item order then span order |
| P-cover-s1 | body of every item in order | `spans[0]` of each item in order |
| P-top+tail | whole-item bundles (body + all spans, atomically) in order until the first bundle that does not fit | body-only tail starting with that failed item, continuing in order |

- A budget run admits units until the schedule is exhausted; `used ≤ budget`
  always holds. Report per query the admitted unit IDs, their costs and the
  total.
- **Grid.** Five arms × three rankings × `O ∈ {0, 8}` × budgets
  `{128, 192, 256, 384, 512, 768, 1024, 1536}`, test split, S1000. Only the §4
  primary cell is confirmatory; every other contrast, including P-cover-s1, is
  exploratory.
- Not run: **P-prefix** (its body-shortening stage is inert because no body
  exceeds 82 units; the current `packRank` as a whole is not benchmarked) and
  **P-window** (a short-body fixture does not meaningfully test the intended
  window treatment). See §1.2.
