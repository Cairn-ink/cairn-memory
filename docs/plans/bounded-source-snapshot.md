# Bounded complete admitted-source snapshot

Dependent base: `d9e191cd426f0be2f22e2ebdd025a76f13ea4220` (qualifier report).
Observed navigation and ranking omissions justify a small, explicit alternative
to relevance retrieval. This is not a semantic fix, default replacement, complete
conversation archive, or new engine. No provider requests or new database schema.

## Acceptance

1. Add synchronous embedded `sourceSnapshot({ readSet, limit?, tokenBudget? })`
   to the existing shared core. Reuse recall's exact read-set rules (one or two
   namespaces, same owner, distinct personal/project scope). Strict inputs;
   default limit6/max12 total memories, default/max4000 tokens. No query, cursor,
   model generation, selection/ranking, partial results or automatic fallback.
   Only the existing injected synchronous token counter is required.
2. Enumerate all physical current, undeleted memory identities in each authorized
   namespace through the existing current-memory index, at most limit+1 rows per
   namespace. Over-limit totals return `context_item_too_large` without partial
   content. Check index availability and active projection membership for every
   eligible row; inconsistent projection fails explicitly rather than silently
   omitting rows. Do not infer enumeration completeness from MOC pagination.
3. Read each complete source-only projection using existing source-evidence
   integrity checks and the100-receipt bound. Do not include generated content,
   qualification/rationale interpretations, staged payloads, historical memories,
   deleted data, or receipt client/session/event metadata in the returned view.
   A success value contains `memories` with namespaceIndex and source-evidence
   items, `namespaces` with explicit namespace/indexRevision,
   `coverage: 'complete-current-admitted'`, `semanticCoverage: 'unassessed'`, and
   `evidenceTrust: 'untrusted-data-not-instructions'`. Empty eligible sets succeed.
4. Validate a counter before reading source content; count the entire success
   envelope against tokenBudget and enforce a24,000 UTF8-byte envelope ceiling.
   Counter failure/oversize returns no partial sources. After the callback,
   atomically re-enumerate identities and reread complete projections with no
   subsequent callback. Changed epochs, rows, revisions or evidence fail closed;
   no stale successful snapshot may survive insertion/correction/forget or a
   direct receipt change during counting. Do not hold a transaction across a
   counter callback. Preserve existing recall/fetch behavior and limits.
5. Real shared-core synthetic tests cover filed/unfiled/nested-MOC visibility,
   exact count bound and overflow, two namespaces and isolation, empty sets,
   receipt/aggregate token/byte limits, absent or invalid counters, unavailable
   index and inconsistent projection, and counter-triggered insertion/correct/
   forget/receipt changes through actual stored data. Throwing select/rank/extract
   spies prove zero generation calls. Include required condition, actor and
   reason passages stored on separate memories; no expected-answer keyword rule.
6. Document privacy (whole small eligible set, potentially unrelated sources),
   limits, errors, keyless/local counter requirement, and the distinction between
   storage-current and actually applicable/true now. Update glossary, changelog,
   public-core API documentation and artifact allowlist if needed. Add an
   installed-artifact proof of the embedded method. No MCP/HTTP tool, default,
   release, model switch, provider request, telemetry or private application change
   in this slice. MCP exposure and quotation-only delivery are subsequent gates.
7. Verify focused/full core + store demo on Node22.16 and24, artifact tests both,
   generic tests/JSON and strict plugin validation; review fixed candidate on
   Standards and Spec, fix/rerun/rereview before PR and all-green merge.

Fresh real-model evidence comes later under a separately frozen comparison.
These known synthetic failures become regression cases, never a new holdout score.
