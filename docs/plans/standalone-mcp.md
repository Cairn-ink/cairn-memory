# Thin local MCP host acceptance

Base `ca087ba3cd5388331423ca767249b196a318e4c1` (#17). May proceed alongside
frozen evaluation; evaluation remains a product-readiness gate.

- M01: Source-run stdio server implements MCP tools remember_memory,
  recall_memory, inspect_memory, correct_memory and forget_memory over the
  existing openMemoryCore. No duplicate persistence, extraction or recall engine.
- M02: One exact namespace is bound at trusted startup (owner, personal/project,
  optional project ID). No tool accepts owner, namespace, database path or readSet.
  Inputs reject unknown fields. Two hosts sharing a database cannot read/correct/
  forget each other's namespace. Personal/project identities are distinct.
- M03: Remember/correct accept <=600-character text and a kind, construct honest
  explicit source receipts from that text, and return actual current revisions.
  Correct/forget require expectedRevision. Inspection supports get by ID and
  bounded list/cursor and receipt pagination. Errors preserve safe core codes,
  never keys/raw exceptions.
- M04: Recall uses the existing injected model ports, returns evidence explicitly
  marked untrusted and current revisions. No model means explicit unavailable,
  not an undisclosed lexical fallback. No passive capture claim or hooks.
- M05: CLI accepts only documented startup flags; no whole env/database
  discovery. Database path is explicit, not a model argument. OpenAI key comes
  only from process environment. stdout contains protocol only. Graceful transport
  close closes SQLite; no telemetry, HTTP listener, accounts or deployment.
- M06: Use pinned official SDK dependencies outside core. Exercise actual stdio
  client/server requests, listing tools, persistence across restart, revision
  conflicts, invalid inputs, namespace isolation and lifecycle. Injected scripted
  models/fake HTTP test protocol, not real semantic quality. Independently test
  actual provider through the host within the remaining shared budget if feasible;
  never claim paid model/client evidence from scripted tests.
- M07: Tests on Node22.16 and24, core/plugin regression and isolated adapter CI.
  Document exact source install/start/config, dependency provenance and limits.
  npm publication, clean-package install, named-client matrix and remote connector
  support remain separate packages. No ChatGPT/universal-client badge.
- M08: Verify candidate and independently review Standards/Spec before push/PR.
  No self merge, release, deploy or production database access.

SDK reference checked 2026-09-08: official v2 stdio server/client guides at
https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server and
https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html .
Registry reports @modelcontextprotocol/server and /client 2.0.0, zod4.5.4.

Status: specification/implementation in progress. No standalone client acceptance
or publication is claimed yet.

## Offline protocol evidence

`node --test adapters/mcp/test/*.test.mjs` passes 11 tests on Node22.16.0 and
24.20.0 using real subprocess stdio connections. Both legacy initialization and
pinned modern 2026-07-28 discovery exercise the same tools. Evidence includes
restart persistence, revision guards, owner/project/personal isolation, strict
inputs, list/receipt pagination, query/storage redaction and forget behavior.
Scripted models exercise recall protocol, not semantic quality.

A separate synthetic actual-provider-through-host probe passed on 2026-09-09
(Asia/Taipei): official SDK Client called remember → recall → forget → recall
through linked in-memory MCP transports and this exact host factory. The returned
memory ID and source excerpt matched; after forgetting, recall returned none.
This was not a stdio/provider combined test or a named-client compatibility test;
stdio is independently covered above. Six HTTP requests, all200, reservation
US$0.026688; generation1073 input/87 output tokens, estimate US$0.0005684.
Shared authorization ledger at this point: #17 US$0.160128 + baseline evaluation
US$0.747264 + classification diagnostic US$0.008896 + this probe US$0.026688 =
US$0.942976 reserved of the authorized US$5. No unrecorded retries.

An oversized-message test found a process-lifetime issue: SDK transport closure
alone left an open stdin pipe keeping the process alive. The CLI now closes its
handle and destroys its owned stdin on transport errors; the same regression
passes with the parent's stdin kept open. No SDK or core code was forked.

`npm test` (31 plugin tests), `npm run validate`, and isolated Claude plugin
validation pass. Core is unchanged from the verified #17 parent (177 tests and
eight core demos on both runtimes); CI will additionally rerun its matrix.
Independent fixed-candidate review remains next; no merge/release is implied.
