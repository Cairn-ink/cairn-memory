# Frozen offline candidate retrieval ablation

This packet fixes the synthetic corpus, query labels, caps and comparison before
the first result-producing run. It diagnoses candidate reachability; it does not
change public recall or measure answer accuracy. The fixture is
`evaluation/architecture/candidate-ablation-fixtures.json` version v1. Case
names and expected keys are evaluator-only and may never enter a strategy query.
Do not revise expected answers or tune the cases after observing results. Retain
negative cases in `docs/limitations.md`.

## Construction and comparison

Use a fresh in-memory public core. Admit 1,030 distinct synthetic bank rows by
`core.admit`. Correct the bank row with the lexicographically greatest generated
memory ID to the frozen zirconium-sextant text so the target lies beyond the
current 1,024-row scan without depending on UUID generation. Admit the fixed
special rows; apply explicit public MOC placement for the active special rows.
Use `core.forget`, `core.correct` and `core.supersede` for lifecycle controls;
admit the foreign row in a different exact namespace. Then enumerate the
authorized exact namespace with complete `core.map({purpose:'recall'})` pages,
including its mixed MOC/edge/unfiled rows. Derive eligible memory references and
topic paths only from that map; read each visible memory with `core.get` and
check the mapped revision and current state. Stop on an incomplete or stale
page. Count all map pages and rows as index-building work. Rebuild both
offline search indexes from that current projection. This is a fresh experiment
index, not an incremental product index or a general snapshot API.

Compare (1) real `core.recall` with deterministic first-visible selection and
ranking, (2) an independent SQLite FTS5/BM25 flat index, and (3) a two-level
MOC-title route followed by branch-local FTS5/BM25 plus a global fallback. The
two indexed arms share the same projected memory/source/topic text. The four
indexed cells cross flat/MOC-first with alias expansion off/on. The predeclared
aliases are global query expansions for both arms, never per-case target keys.
MOC titles and memberships are hand placed diagnostic inputs, not measured
classifier quality. All arm code may receive only the query string, current
projection and fixed configuration; expected keys and source ordinals remain
inside the evaluator.

Each arm returns at most five current source-backed memories. Indexed arms may
materialize at most 24 candidate rows per query. MOC-first inspects at most two
branches, offers three result slots from branch search and reserves two slots
for a global fallback, including when routing points at the wrong branch or a
memory is unfiled. Deduplicate and fill vacant slots from the already bounded
global result. Count branch, fallback and final materializations separately;
report caps and exhaustion. `core.recall` retains its own two-map and fetch
limits, which are reported and not treated as equivalent compute. No arm sees
labels during retrieval.

## Frozen measurements and boundaries

For each fixed query report any@5 and all@5 against evaluator-only expected
source keys; for zero-target cases report retrieved count and false-positive
count, not answer correctness. Preserve multiple-evidence partial hits. Record
the baseline's selection-visible count, selected/fetched count and coverage;
indexed row count, indexed build/query time, rows indexed, and local model-call
count. No provider call or paid request is allowed. Source and memory lengths
remain bounded by their public API. A local millisecond measurement is not a
latency or token-cost estimate; SQLite's internal posting work and token usage
are unknown. FTS5 `unicode61` has limited CJK word segmentation; report exact
and partial-Chinese cases separately.

Reports may contain only frozen names, finite counts, caps, booleans and closed
statuses, with no source/question/answer text, generated IDs, paths or hashes.
Full projected sources exist only in the local process and fresh in-memory
indexes. The safety controls show filtering in this synthetic rebuild, not a
product privacy guarantee or retroactive erasure. No live cohort, competitor or
held-out quality claim follows from this packet. The next gate is a mechanical
runtime candidate-selection design plus separately qualified retrieval evidence.
