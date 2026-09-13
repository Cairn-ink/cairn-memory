# Source-backed rationale — R1

Base: `7480dbca8db49467496cfaeed3f8e2bd1458f0d3` (open integration PR #70).

## Objective and sequence

Build the shared core's inspectable decision/premise/challenge substrate first,
then integrate candidate discovery and automatic capture, MCP consumption, and a
fresh frozen real-model comparison. R1 is not completion of that full loop.
No second engine, hosted migration, package publication or paid call in R1.

## Acceptance

1. `reviewRationale({namespace, refs})` accepts 2–6 distinct revision-bound current
   memories. One injected `relate` call sees only request-local memory/receipt
   indices, complete retained source excerpts and submitted roles. No summaries,
   qualification labels, namespace or source-client identifiers are sent.
2. Strict output contains 0–10 proposed `supports-decision` or
   `challenges-premise` edges with endpoint indices and receipt indices. A support
   may point within one memory/receipt recording both decision and reason; a
   challenge requires distinct memories. No separate premise must be fabricated.
   Core resolves receipt IDs and SHA256 digests, not the model. Invalid output
   rejects the entire batch; no writes on stale sources, provider errors or
   budget failure. Existing 6000-input/1024-output/30-second model bounds apply.
3. Persist edges atomically in the same SQLite engine, bound to both revisions
   and actual receipts. Repeating an identical proposal is storage-idempotent
   (not provider-call-idempotent). Maximum 10 incident edges per memory; overflow
   rejects the whole batch. Every proposal remains `model-proposed`, never truth,
   verified adoption, execution authority, supersession or a replacement choice.
4. `getRationale({namespace, memoryId, revision})` is keyless and returns the
   root, incoming supporting premises, and incoming challenges to those premises,
   with source-only evidence. At most 6 memories / 10 edges / 24000 serialized
   UTF-16 units; overflow fails explicitly, never silently truncates. A complete
   retained receipt set must fit. This is bounded linked evidence, not exhaustive
   discovery or an answer generator. `reconfirmation-suggested` appears only for
   a persisted support/challenge path; otherwise `unassessed`, never `confirmed`.
5. Corrections, forgetting, receipt changes and all revision changes (including
   legacy, filing and retirement) invalidate incident links. Source digests and
   exact ownership/revisions are rechecked on read and at final atomic commit,
   including unselected inputs. No source text is duplicated in the edge table.
6. Migrate schema 11 to 12 atomically without altering prior memories/receipts,
   store identity or unrelated tables; older supported migrations still work.
   Restart preserves edges; rejected migration rolls back. No user DBs in tests.
7. Offline tests cover the A/offline example, empty/no-change and malformed
   proposals, foreign/stale refs, bounds, failures, concurrent mutation, cold
   reads and lifecycle invalidation. Scripted models test mechanics, NOT semantic
   recognition. Run generic/core gates and relevant demos on Node 22.16 and 24;
   independent Standards and Spec reviews on the final committed diff.
8. Extend the explicit artifact runtime allowlist for the new core imports and
   prompt; existing installed MCP behavior still works. Run offline installed
   artifact gates on both Node versions. This packages the embedded method but
   does not expose it as an MCP tool or enable a provider.

## Following slices (not claimed delivered by R1)

- R2: bounded MOC candidate discovery + capture scheduling, source-attributed
  automatic inference through the real adapter; no hand-wired fixture IDs.
- R3: MCP/installed-host retrieval of linked evidence inside existing budgets,
  without changing default compatibility or treating proposals as facts.
- R4: fresh independently authored frozen semantic cases; baseline/candidate
  comparison under the existing cumulative authorization, including abstention,
  false adoption/replacement, source/rationale coverage, cost and latency.

## Reproduction gates

Run under Node 22.16.0 and 24.15.0:

```sh
npm test
npm run validate
npm run test:core
node --test core/test/rationale.test.mjs core/test/model-diagnostics.test.mjs
npm run demo:store
npm run demo:moc
npm run demo:recall
npm run demo:capture
npm run demo:history
npm run demo:conflicts
npm run demo:rebuild
npm ci --prefix tools/plugin-validation
npm run validate --prefix tools/plugin-validation
npm ci --prefix adapters/mcp
npm ci --prefix adapters/openai
node packaging/prepare-cache.mjs
npm run test:artifact
```

All databases are freshly generated synthetic temporary files. Adapter installs
and cache preparation fetch public dependencies, not models. No real-provider
requests, user keys, hosted databases, publication or deployment in this slice.
The schema-11 test constructs prior shape by removing only new rationale objects
from a synthetic database; older migration tests additionally use frozen fixtures.
This is not a production-data migration rehearsal or an independent v11 export.
