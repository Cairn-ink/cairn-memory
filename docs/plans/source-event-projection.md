# Opt-in neighborhood source-event projection

Fixed stacked base: `e6712331d24a76276ac7b4720f63d82006a32abc` (PR161).
Branch `feat/source-event-projection`. PR163 is offline design evidence, not a
runtime dependency. Preserve the primary worktrees and all prior live evidence.

## Outcome and boundary

Transmit one exact original source event once while preserving every distinct
memory/revision/receipt association. Seven cards backed by six original events
must be representable without merging cards or inventing a representative card.
This changes an explicit core/MCP read option only, not default recall, stored
memory, relation inference, model prompts/profiles or permission enforcement.

## Acceptance

- SEP1: Add `sourceProjection: 'neighborhood-source-events-v1'` only with
  `contextMode: 'rationale-neighborhood-evidence'`, explicit existing
  `rankingMode: 'source-evidence-first-v1'`, one namespace, no selectionMode and
  no enabled qualification. Limit is one through six roots, default six.
  Invalid combinations reject before model/counter work. Preserve every legacy
  option/result, including explicit false qualification and old limit behavior.
- SEP2: The new result has `sourceEvents`, not `memories`. Each event has only
  role, original excerpt, provenanceCollision and associations; each association
  has memoryId, revision, currentness and receiptId. Keep existing namespace and
  coverage metadata plus explicit projection/ranking markers and top-level
  `sourceSelectionCoverage: 'unassessed'` /
  `evidenceTrust: 'untrusted-data-not-instructions'`. Traversal completion is
  not semantic completeness. Do not fabricate
  representative identities, summaries, graph edges or semantic status. Explain
  that currentness is stored lifecycle state, not verified real-world truth.
- SEP3: Group only exact namespace/client/session/event/role/canonical-excerpt
  identity using authoritative internal receipt metadata. No text-only grouping,
  new normalization, metadata inferred from public DTOs or stable exported event
  identifiers. Same submitted event metadata with divergent excerpts stays in
  separate groups, each provenanceCollision=true. The disclosure is limited to
  collision existence within the already authorized namespace; no raw client,
  session or event identifier leaves this projection. Submitted provenance is
  not authenticated identity or semantic evidence by itself.
- SEP4: All candidate refs, revisions, retained sources and namespace epoch are
  rechecked using the existing final-read fence. Selected-root expansion,
  internal source identity reads, grouping and validation happen within the
  same authoritative transaction. No callback/model/count after final read;
  no post-transaction database fetch for grouping. Validate all selected source
  and edge copies, including shared-source consistency; do not bypass the v1
  validator merely to permit a larger identity union.
- SEP5: Explicit new bounds: six source-event groups, 36 distinct associations,
  and 24,000 UTF-8 bytes for the complete returned value. No partial/truncated
  result, fallback or extra model call. Keep per-root graph/source bounds and
  all preexisting navigation limits. V1's six-memory and 24,000-UTF-16 contract
  remains unchanged. Deduplicate repeated traversal of the same association,
  never drop different card/revision/receipt associations for one shared event.
- SEP6: Actual-core tests create seven distinct synthetic cards with six events,
  two genuine interpretations of one event, and graph neighborhoods whose union
  contains all seven. Legacy v1 rejects the identity overflow; new mode returns
  all seven associations and six source passages. Round-trip original receipts,
  distinct-event equal-text separation, all provenance discriminators, reused
  event collision, malformed/stale source, namespace isolation, graph/source
  changes during ranking, three overflows and no store mutation are exercised.
  Empty complete results have an explicit new shape, not a legacy coercion.
- SEP7: Update the MCP request schema and test actual stdio and installed local
  artifact/core calls with the new output. Validate field allowlists, association
  bindings and original text in the receiving test consumer; no inferred answer
  quality or claim that all external hosts understand the new option. Existing
  SDK/MCP/installed legacy consumers retain their old responses. Document a small
  opt-in invocation and the remaining actual-answer-consumer integration gap.
- SEP8: Run focused and full core/MCP/artifact gates, store/MOC/recall demos,
  generic and JSON/strict plugin validation on PATH-pinned Node22.16 and24.15.
  Generic tests and JSON validation also pass actual Node20 (SQLite-only tests
  stay in appropriate runtime suites). Follow packaging cache instructions before
  artifact gates. Primary directly reruns key actual-core and installed paths;
  independent Standards and Spec review on the same frozen candidate precede
  push/PR. Monitor latest-head CI; no merge, publication, deployment or paid call.

## Implementation ownership

One Sol/high worker implements within this isolated tree. Main owns contract,
integration choices and acceptance. Scope: core projection/read plumbing and
targeted tests, MCP schema/tests, one installed artifact test, this plan,
protocol/source-projection/standalone docs and CHANGELOG. No evaluation/live,
private ledger, model prompts/defaults, new inference, capture, stored schema,
host profile or answer generator changes. Keep code sharing proportionate;
production must not import the offline evaluation module.

No semantic-reliability improvement is claimed by structural integration.
Future semantic checking and fresh end-to-end answer evaluation remain separate.

## Implementation notes

The internal event identity, source/edge consistency, group and association
checks run inside the final read transaction. The 24,000-byte guard serializes
the complete public value synchronously after that transaction, as the legacy
value-length guard does; no database, model or token-counter callback follows.
The 36-identity internal source-union bound follows from at most 36 distinct
associations, while the legacy six-identity union path remains unchanged.
Receipt associations are never truncated to make a result fit. The synthetic
complete-value byte-boundary unit test uses valid-shape long identifiers; it
tests the guard, not the lengths of ordinary generated UUIDs. Actual-core tests
exercise the reachable six-group, 36-association success and seventh-group or
37th-association failures through the recall API.

## Offline verification record

The worker installed isolated MCP, OpenAI and maintainer validation dependencies
with `npm ci --prefix adapters/mcp`, `npm ci --prefix adapters/openai` and
`npm ci --prefix tools/plugin-validation` under Node 22.16.0. Before artifact
tests, `node packaging/prepare-cache.mjs` populated public npm metadata only.
Every Node 22/24 command below used `PATH=/home/chichieh/.nvm/versions/node/<version>/bin:$PATH`
for npm and all children, not just a direct node binary.

| Gate command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 143 passed | 143 passed |
| `npm run test:core` | 726 passed | 726 passed |
| `npm run test:mcp` | 74 passed | 74 passed |
| `npm run test:artifact` | 73 passed | 73 passed |
| `npm run demo:store`, `npm run demo:moc`, `npm run demo:recall` | passed | passed |
| `npm run validate` | passed | passed |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin passed | marketplace and strict plugin passed |
| `node --test core/test/source-event-projection.test.mjs adapters/mcp/test/source-event-projection.test.mjs packaging/test/source-event-projection-mcp.test.mjs` | 11 passed, final focused content | 11 passed, final focused content |

Actual Node 20.20.2 was selected with `npm exec --yes --package=node@20.20.2 --
sh -c '<command>'`: `npm test` passed 136 with seven expected SQLite-only
skips; `npm run validate` passed. The Node 22/24 full suites were run before
the last focused-test assertions were tightened and then full core was rerun
on exact final content: 726/726 on each runtime. The focused core/MCP/installed
checks were likewise rerun on both final-content runtimes.
