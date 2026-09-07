# 2A — local memory persistence

Base: `201996e12cec4fcdb86f2c69859631e1e8e503af`.

This is a source-runnable SQLite storage foundation, not the completed OSS
memory engine. Extraction/model inference, semantic retrieval, MCP/HTTP servers,
export/restore tooling, host adapters, and hosted migration remain later work.

## Acceptance

1. Public-source JavaScript opens a local SQLite database with no account,
   token, private package, runtime npm dependency, or outbound request.
   Core requires Node >=22.16; existing plugin Node 20 support remains intact.
2. Every store operation is bound to an explicit owner and exact personal or
   project namespace. Guessed memory IDs cannot read, correct, or forget another
   namespace's data. This is an embedded trusted API, not authentication.
3. Memory and at least one bounded, redacted Source Receipt commit atomically.
   Exact normalized-content deduplication is namespace-local, merges distinct
   receipts, and remains correct across processes. Inferred input cannot
   downgrade explicit memory. Invalid input leaves no partial state.
4. Memory, receipts, deletion suppression, and correction state survive close
   and reopen in a separate process. Correction requires the expected revision,
   replaces active receipts, and suppresses re-ingestion of the old content.
   Forget removes active content/receipts and retains a content-free tombstone;
   replay cannot silently resurrect forgotten or superseded content.
5. Deterministic lexical search returns only active matching memories in the
   exact namespace; unrelated and empty queries return nothing. Clearly label
   this as lexical storage lookup, not semantic recall or extraction evidence.
6. Real-file tests cover lifecycle, boundaries, transaction rollback, malformed
   input, concurrent first-open/writes, restart, schema mismatch, and privacy.
   CI covers core Node 22.16 and 24 plus existing plugin Node 20/22 gates.
7. Publish a runnable synthetic example, API/retention limitations, dependency
   provenance and staged hosted-consumption plan. No private source, credentials,
   production configuration/data, deployment, release, or hosted change.

## Dependency and publication boundary

Inspected the private memory service imports: Drizzle, application DB/schema,
model extraction, and application contracts. No root license was present in
that private checkout. None of those files or dependencies is copied here.
The new storage implementation is authored directly in the Apache-2.0 public
repository. The redactor is imported from the already-public plugin module,
retaining one copy and its existing repository license. There are no model
weights, additional bundled libraries, or runtime npm packages in this change.

Node's built-in `node:sqlite` is used rather than a native npm addon. Node
22.16 emits an experimental SQLite warning; synchronous operations and the
bounded SQLite busy timeout suit a small local store, not a high-throughput
hosted server. See the [Node SQLite API](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).
Future packaging must retain runtime licensing/notices; this PR does not
redistribute Node binaries or claim a completed legal audit of private code.

The hosted implementation is deliberately unchanged. The public core is the
target shared implementation; next stages add model/extraction and adapters,
then a separately reviewed hosted migration compares behavior and replaces
private implementation paths. Do not create another engine for each host.

## Verification

Local Node 22.16: `npm run test:core` passes 17/17 real-SQLite tests;
`npm run demo:store` passes the synthetic lifecycle; existing `npm test` passes
31/31 plugin tests; `npm run validate` passes JSON/version consistency.
The isolated Claude validator and `git diff --check` also pass. No TypeScript
gate applies. Independent fixed-commit review and CI results are recorded in
the delivery PR. Only synthetic temporary databases were used.
