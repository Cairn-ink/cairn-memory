# Source-event grouping: bounded offline design experiment

Base `3dc0f102ae407c2ef64890f424a7133350c9bc41` (PR162). Evaluation only;
no SDK/MCP format, default, storage, model, policy, grant or production change.

## Question

Can an evidence-only answer packet transmit a repeated original source once
while preserving every distinct admitted memory/revision/receipt association?
The completed diagnostic had seven memory identities but six original source
events; two different interpretations of one event are not duplicate memories.
Do not merge them, drop either association, or report a rescued live answer.

## Acceptance

- SEG1. A small offline experiment uses the actual local core and synthetic
  temporary database. Admit seven distinct memory units supported by six
  original events, with two genuinely different interpretations of one shared
  event. Read complete admitted receipts and preserve all seven associations.
  No semantic model, API key, external provider, real ledger or user database.
- SEG2. Group only exact matching provenance and content: namespace, client,
  sessionId, eventId, role and exact canonical excerpt. Equal text alone is not
  identity. Different namespaces, clients, sessions, events, roles or excerpts
  remain distinct; normalization beyond existing core canonicalization must not
  silently merge sources. A source identity is submitted provenance, not an
  authenticated speaker or proof that a statement is true.
- SEG3. The experimental DTO carries each source text once plus all original
  memory IDs, revisions, currentness and receipt IDs that cite it. No fabricated
  representative memory, lost association, revised card, merged card, source
  status promotion, inferred relation or summary in the answer packet. It must
  be possible to reconstruct every input association exactly from the packet.
- SEG4. Explicit separate budgets: at most six distinct source-event groups,
  at most 36 provenance associations, and at most 24,000 UTF-8 serialized bytes
  for this experimental packet. Reject overflow without truncation or fallback.
  These are new evaluation-only bounds, not equivalent to or a replacement for
  the existing six-memory/24,000-UTF-16 production projection contract.
- SEG5. Deterministic controls prove shared-event grouping, same-text distinct
  events, all provenance discriminators, divergent text under reused event ID,
  differing memory revisions, group/association/byte overflows, round-trip
  associations and no store mutation. Conflicting source content under the same
  submitted event metadata remains distinct and explicitly reported as a
  provenance collision, never silently resolved by recency or input order.
- SEG6. Report counts and bytes for the synthetic actual-core case plus an
  explicitly labeled normalized replay of the public diagnostic inventories.
  Distinguish structural payload availability from semantic answer quality.
  Do not regenerate any failed live answer, modify frozen evidence, claim
  production integration/freshness guarantees or claim measured quality gain.
- SEG7. Keep scope to one evaluation module, focused tests and concise result/
  plan documentation under evaluation/architecture and docs. Generic tests,
  JSON/strict plugin validation and focused experiment pass on both Node22.16
  and24.15 with PATH pinned. No evaluation/live edits. Freeze and independent
  dual review before PR; no merge, release or deployment.

## Integration boundary

The experiment receives an already-read synthetic snapshot, not a live
transaction or authorization capability. A future production design would
still need authoritative snapshot/freshness fences, a versioned external DTO,
compatible consumers and installed MCP evidence. This experiment establishes
none of those by itself. Stop after the offline result and report the smallest
supported implementation direction; do not add a new public API here.

## Ownership

Primary owns design and acceptance. One Sol/high worker owns the scoped module,
tests and notes; reviewers are independent. Preserve PR161/162 candidates and
the private diagnostic evidence unchanged.

## Worker implementation record

The only new callable entrypoint is evaluation-only
`groupSourceEvents(entries)` in `evaluation/architecture`. Its input is a
bounded already-read snapshot; it does not open a database or call a model.
The focused test owns all consumers of this module. The public diagnostic JSON
and source fixture are read-only test inputs; no browser route, URL replay,
shipped API, old caller or answer consumer is changed. The test checks actual
local-core admission and complete `get` receipt pages before grouping, then
checks the before/after store snapshots. It also checks every provenance field,
collisions, revision preservation, deterministic ordering, round-trip links
and the three independent bounds. The result is
[reported separately](../source-event-grouping-results.md).

Worker verification used `PATH=/home/chichieh/.nvm/versions/node/v<VERSION>/bin:$PATH`
for each Node 22.16.0 and 24.15.0 command. `node --test
evaluation/architecture/test/source-event-grouping.test.mjs` passed 5/5;
`npm test` passed 153/153; `npm run validate` and `npm run validate
--prefix tools/plugin-validation` passed. The isolated maintainer tooling was
installed with `npm ci --prefix tools/plugin-validation` under the pinned Node
22 runtime. After the final test assertions, all four per-version gates
were rerun on the final content. No `evaluation/live` file, model, real ledger,
credential or user database was touched. Counts and serialized UTF-8 bytes are
in the result note; they describe payload structure, not semantic quality.

Candidate SHA is reported with the scoped local commit. Primary fixed-point
acceptance and independent Standards/Spec review remain separate before any
push or PR.

Correction round 1, from independent fixed-point review of `68f341f`:
the provenance test now isolates `projectId` while owner, project scope,
client, session, event, role and excerpt are equal. It proves two distinct
groups, exact association round-trip and no collision; a grouping key that
omits `projectId` would fail. The evaluation module's record predicate and
entry validator were renamed for clarity only. All four gates above passed
again on both pinned runtimes before the replacement candidate was frozen.
