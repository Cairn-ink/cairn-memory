# C0b2b — installed ordered capture and fresh MCP lifecycle (offline)

Fixed parent PR56 `0c5c68d8ea22c4475ab0151bf89dceb0fc8ad7f3`.
This package prepares a new explicitly programmed installed-artifact experiment.
It does not run a real provider, provision campaign authorization, increase a
budget, publish, merge, deploy or add autonomous host capture.

## I1 — separate version and frozen source protocol

Add `evaluation/live/installed-ordered-capture-loop.mjs`, exporting
`ORDERED_CAPTURE_LOOP_VERSION = 'installed-ordered-capture-mcp-v1'`, deeply frozen
`ORDERED_CAPTURE_LOOP_FIXTURE`, `runInstalledOrderedCaptureLoop(options)` and
`inspectOrderedCaptureLoopStage(stage,record,state={})`.
Freeze the new fixture before any scored/provider execution:

- first source: `Harbor team review happens on Friday.`
- update source: `Confirmed update: Harbor team review now happens on Monday, replacing Friday.`
- explicit correction: `Harbor team review happens on Tuesday.`
- query: `When does the Harbor team review happen now?`
- client: `installed-ordered-capture-loop`; streamId: `synthetic-ordered-stream`.
- two sessions `synthetic-source-1` and `synthetic-source-2`, events
  `synthetic-event-1` and `synthetic-event-2`, user message IDs
  `synthetic-message-1` and `synthetic-message-2`, sequences1 and2.
- extractionModel: `gpt-5.4-mini-2026-03-17`; other methods retain baseline.

Use these source texts directly, not evaluator propositions or expected answers
in model inputs. This is a narrow single-target lifecycle, not a multi-history
benchmark. Initially require one admitted memory from the single-fact source.
The update must retire that actual predecessor and admit its successor; retain
any additional admitted records rather than dropping them. Consumer mutation
requires an unambiguous fresh recalled/inspected successor, not a producer-held
revision or an arbitrary first result. Stop visibly if the narrow target cannot
be established. The seven-case corpus separately covers broader semantic cases.
Main freezes these fields in `evaluation/live/installed-ordered-fixture.mjs`;
the harness re-exports the version and fixture. A separate mechanical-stage
module may implement the inspector and be re-exported by the harness, allowing
independent implementation and tests without conflating semantic labels.
Fixture SHA256 before implementation:
`45a0e45bc8913712d4e59ab29515859057c1bc648439fd47ffa618dd764a3b01`.

Keep the old installed-v1 fixture, runner behavior and all prior results/reviews
unchanged. Shared pure artifact/path/persistence helpers may be extracted from
the old runner if its existing tests and output contracts remain intact. Do not
change core/provider/MCP wire/runtime or default capture behavior.

## I2 — actual pinned install and controlled transport

Accept only existing-style options `{session,nodePath,cairnExecutable,cairnArtifact,
cairnArtifactSha256,privateDirectory,startProxy?}`. Validate closed plain options,
injected session.request/getState functions, optional proxy factory and exact
artifact/path inputs before model work. No env discovery or live CLI in the
harness. Tests may read only explicit public artifact/runtime selectors.

Inspect SHA256 of the supplied tar archive and compare every allowlisted
installed source file with the archive, using the established verifier. No
source-checkout core/provider substitutes. Require a fresh empty canonical
nonsymlink private mode0700 directory, private exclusive0600 JSON output files,
an explicitly selected Node executable, and a fresh synthetic owner/project.
Retain artifact hash/source hashes and a frozen protocol file before requests.
No global install, production store, user profile or credential forwarding.

Load capture core and adapter from the verified installation. Inject transport
through session.request with the same exact Responses/input_tokens routes as
the existing harness. Use the existing loopback experiment proxy and installed
MCP launcher. Children receive only the synthetic proxy capability/config and
explicit runtime arguments, never a real key or inherited application env.
Each consumer stage B–F opens and closes a NEW real stdio MCP process. A wrapper
around fake MCP clients is not acceptance. No new capture MCP endpoint.

The old session/guards continue rejecting reconciliation. A future paid operator
must explicitly supply the reviewed combined guard and both required tokens;
this package cannot provision those tokens or infer operator permission.

## I3 — six-stage observable lifecycle

Return a report with distinct version/kind, frozen fixture, installed provenance,
namespace, stages, budgetBefore/budgetAfter and status. Final success is only
`mechanical_pass_pending_semantic_review`, never semantic acceptance.
Every stage verdict is `{stage,passedAutomated:boolean,semanticReviewRequired:true}`.
Keep actual capture/tool envelopes, mutation arguments, full raw records and
complete source/relationship evidence in stage records. A helper's flags cannot
replace checking actual observations. No regex/keyword score may claim semantics.

### A — installed source-ordered capture, no manual repair

Capture Friday at sequence1 through the installed core; retain full paginated
raw records/receipts, close and cold-reopen to verify persistence. Capture the
explicit Monday update at sequence2 in the same namespace/stream, then repeat
the full snapshot/cold-reopen. Every capture must be ok/nonduplicate, with
successful classification and a completed reconciliation, never unresolved.
The second capture must be applied with a positive count matching actual newly
historical predecessors. Require the original record now historical, its body
and receipts preserved, and a directional relation to an actually admitted
active successor with real selected user receipts from the second window.
Bind the immutable successor revision to its admission revision, while current
revision/state match its possibly post-filing snapshot. No explicit supersede,
admit, correct, forget, DB patch, fallback or model retry may repair this stage.
Preserve all extra rows; the supplied single-target fixture must remain inspectable.

### B — cold MCP current recall, history and isolation

A new MCP process performs complete recall for the fixed query. Exactly one
returned record must be the active successor, and a fresh inspect must match
its content/revision/receipts. Inspect the predecessor too: historical, original
source receipts and relation intact; it is not returned as current memory.
List/get pagination must retain all inspected records/receipt pages.
Use separate actual MCP processes to test both a foreign owner and foreign
project: empty namespace listing, target get/correct denied, forgetfalse, and
unchanged rightful current record after each attempted foreign operation.
Foreign attempts use synthetic text only and must not mutate the history either.

### C — explicit correction at a freshly rediscovered revision

Another new process recalls/inspects the unique current successor before acting.
Correct that exact ID/revision to Tuesday through correct_memory. Require one
revision increment, explicit correction receipt, and stale correction rejection.
Inspect both current and historical records afterwards. The predecessor remains
historical with unchanged original body/receipts. Correction removes the former
successor source receipts, so the historical relation must explicitly report
unavailable selected evidence (empty receiptIds/evidenceAvailablefalse), not
fabricate the original Monday evidence from Tuesday's correction.

### D — cold corrected recall

New process returns the corrected successor at its current revision and exact
Tuesday content with correction provenance; Friday is not returned as current.
History remains inspectable and its unavailable-evidence state persists.

### E — scoped forgetting with stale-revision rejection

New process again recalls/inspects the current successor. A stale forget must
reject without change. Forget using the freshly inspected current revision,
then require target get to return memory_not_found. Do not delete any other
records. Keep the original predecessor historical, not resurrected.

### F — cold empty current recall and retained history

Final new process returns complete EMPTY recall for the fixed query and cannot
inspect the forgotten successor. Predecessor inspection must preserve original
historical body/revision/receipts and return exactly unavailable linkage:
`{previousRevision, replacement:null, receiptIds:[], evidenceAvailable:false}`.
It must not leak forgotten successor content/receipts/identity via the relation.
Do not require the inspection listing to be empty: physical history remains.
Any extra records from A must remain unchanged except the identified successor
and normal derived filing/index state; preserve their identities, bodies,
revisions, states and source receipts. The harness cannot mass-delete them to
force a pass, nor confuse derived filing invalidation with content deletion.

## I4 — honest failure retention and cleanup

Retain failed capture/judgment/tool envelopes, partial snapshots and stage data.
Any failed prerequisite stops later stages, which remain explicitly not_run;
never rerun a failed stage or remove it from the report. Invalid references,
assistant-only/forged replacement evidence, unresolved judgment, incomplete
recall, stale control failure or history resurrection cannot pass.
Close core handles, all clients and proxy even on failure. Cleanup failures
must fail the report rather than being silently swallowed. Retain finite
content-free errors; never include tokens or raw exception text. Record budget
snapshots via the injected session, without changing its limits or policy.

After preflight, proxy startup, operation, snapshot, budget-read and persistence
failures must produce a failed in-memory report with all observed evidence and
remaining stage identities. Persist protocol/stage/report files best-effort with
exclusive writes; if persistence fails, clearly mark that failure and return
the in-memory evidence instead of claiming durable success or losing it in a
new throw. Do not overwrite pre-existing files. Preflight may reject before any
model work with finite errors. No retries of provider or model failures.

## I5 — independent offline installed verification

Delegate implementation and independent tests separately; main freezes the
protocol, builds/installs the artifact and runs full gates. Tests use the actual
installed core/adapter/tokenizer, real loopback proxy and actual MCP subprocesses.
Only HTTP/model decisions are independently scripted, including cairn_reconcile.
Exercise both unfiled and real MOC filing so immutable/current revisions differ.
Do not put expected outcome/rubric keys or persisted IDs into extract/reconcile.

Add tests under `evaluation/live/test/installed-ordered-capture-loop.test.mjs`
and retain the existing test command. When selectors are absent, installed tests
may explicitly skip for ordinary offline CI, but primary must run the positive
gate with ALL four selectors and report zero skips in that selected file:
CAIRN_NODE, CAIRN_EXECUTABLE, CAIRN_ARTIFACT, CAIRN_ARTIFACT_SHA256.
No OPENAI_API_KEY is read from the environment. Test artifacts/stores are private
temporary data, never existing user databases. No registry publication.

Test successful A–F against the actual install, separate owner/project isolation,
history before/after correction/forget, stale-revision rejections, complete empty
recall, unchanged extra records, malformed/failed reconciliation and classification,
unsafe options/path/artifact mismatch before transport, proxy/cleanup/persistence
failure retention, and mechanical tamper rejection. Deterministic helper-level
fault injection can complement, not replace, the installed positive path.
Preserve original installed-v1 tests/results and all nine frozen corpus hashes.

Run npm ci for both isolated adapters, explicit packaging/prepare-cache.mjs,
and test:live-evidence-offline on Node22.16.0/24.15.0; then explicitly selected
installed old/new tests on both. Also run test:openai, demo:openai-offline,
test:mcp, test:artifact, npm test, npm run validate, and pinned Claude checks
where applicable. No typecheck exists in this JS repo. Verify before candidate
commit, then independent Standards+Spec reviews on that exact commit before PR.
No self-merge. Paid evidence still requires the outstanding method/run grant;
this harness does not complete that gate or establish general product readiness.

## Primary offline checkpoint

On Node22.16.0 and24.15.0, the primary reran both explicitly selected installed
test files against archive SHA256
`49cb04896119c92b78043747517fa87e6db7df30c1a2247b6aacd9c2390d619a`:
26/26 passed, zero skips (new ordered17; original9). The new fixture and nine
prior frozen hashes passed. Actual installed MOC and unfiled A–F paths both
passed; only provider HTTP decisions were scripted. Both runtimes also passed
test:live-evidence-offline (37 passed,27 explicitly skipped without artifact/host
selectors), test:openai (145), npm test (31), demo:openai-offline and validate.
Both test:mcp (20) and test:artifact (14) passed. Claude2.1.260 marketplace and
strict plugin validation passed, as did git diff --check. No paid calls, real
credentials, production stores, publication or merging were used.
