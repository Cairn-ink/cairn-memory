# Capture admission inspection (bounded S1 slice)

Base: `328052a1782afa50f82c5dfcc8600397320c00e5`. Worktree:
`feat/capture-admission-inspection`. This slice makes committed admission
membership inspectable after a lost capture response. It does not journal or
infer classification outcome, retry capture, or resolve the capture timeout.

## Observable contract

- AI1: `core.inspectAdmission({namespace, client, eventId})` validates exactly
  these fields and returns the usual core success/error envelope. A read
  transaction reads the existing exact-namespace `admission_claims` row and
  member state together; it never claims a lease, updates a clock, writes a
  row, calls a model, or probes by calling capture. No schema or migration.
- AI2: The result has `status: 'absent' | 'pending' | 'completed'` for
  **admission only** and `classification: {status:'unknown'}` in every case.
  Absent and pending expose no members. An expired pending claim remains
  pending in this read view, without reacquisition or retry.
- AI3: Completed returns `suppressedCount` (the existing bounded 0–5 count)
  and `members` in the stored first-occurrence order of
  at most five distinct committed member IDs. Each is freshly looked up within
  the same namespace and transaction. A current active member returns only
  `{status:'current',memoryId,revision,filing:{status}}`; a historical, deleted,
  or missing member returns only `{status:'closed'}`. An empty member list can
  mean an empty completion or all inputs suppressed; the count distinguishes
  these without claiming classification. No old content, receipts,
  digest, token, lease, source text, or stale revision is returned. Empty and
  fully filed membership still has unknown classification; unfiled is not
  evidence that classification failed. Mixed filing is per member, never a
  batch-success declaration.
- AI4: Opt-in `classificationRecovery:'guarded-v1'` MCP hosts additionally
  expose read-only `inspect_capture_admission({batchId})`; the server supplies
  fixed `cairn-local-mcp` client and configured namespace. No owner, path,
  client, digest, or other caller authority field is accepted. Default five
  tools and independent capture option remain unchanged; opting in adds this
  and the existing `classify_unfiled_memories` tool. An inspected current
  unfiled ref may be passed explicitly to classification, subject to its
  existing preflight and revision guards. Inspection itself is keyless and
  performs no model work.

## Acceptance and boundaries

1. A completed multi-member batch is returned atomically after a cold reopen;
   returned membership is distinct and matches the stored claim, including
   same-batch deduplication.
2. After admission but before/without successful classification, a lost capture
   response can be replaced by cold inspection with zero model calls. Separate
   failed classification and successful empty-parent classification both report
   `unknown`; neither is labeled complete.
3. Per-member filing can differ without a whole-batch success assertion.
4. Correction makes the old ref stale; inspection returns only the fresh
   current corrected ref and no old text, allowing a separate explicit
   classification that preserves corrected content and receipts.
5. Forgotten, historical, missing, and foreign members do not yield actionable
   refs or text, including when a stored ID points into another same-owner
   project. Personal/project and sibling-project claim keys remain isolated;
   malformed stored IDs fail closed. Absent, pending, and expired-pending reads
   do not mutate the claim or invoke a model.
6. Actual SDK-MCP tests cover strict arguments, default inventory, cold
   inspection, fixed namespace/client, privacy, and explicit recovery. An
   installed-artifact synthetic test covers cold inspection then explicit
   classification with unchanged receipts and no second extraction.

## Entrypoints and verification

Entry paths: public core contract → runtime → admission storage; MCP tool
registration → fixed binding → public core. Existing capture completion,
duplicate replay, correction, forgetting, and supersession are read-only
dependencies. Packaging uses the existing included core/MCP files; the new
artifact test must exercise the actual installed launcher, not only source.
No other caller or schema changes are intended. Run `npm test`, `npm run
validate`, `npm run test:core`, `npm run test:mcp`, `npm run test:artifact`, and
the admission/capture/MOC/store demos on Node 22.16 and 24.15. Run JSON and
Claude plugin validation. Use only fresh synthetic stores and fake provider
responses; no ambient keys, paid calls, ledger, push, or merge.

The public core method is documented in `docs/admission-claims.md`; the
historical migration section there remains unchanged.

S1 remains incomplete: this read view is not a durable classification journal,
does not certify that classification finished, and does not address the
whole-capture timeout or older pilot evidence.

## Verification record

Owner: Sol 6, high effort, bounded implementation from the fixed base above.
No independent quality score or provider-backed result is claimed.

- Node 22.16 and 24.15: generic `node --test
  plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs`
  112/112; `node --test core/test/*.test.mjs` 655/655; `node --test
  adapters/mcp/test/*.test.mjs` 86/86; `node --test
  packaging/test/*.test.mjs` 69/69. The artifact suite includes an actual
  installed keyless cold read and explicit fake-HTTP classification.
- Both runtimes: `node scripts/validate-json.mjs` passed, plus synthetic
  `examples/local-store.mjs`, `moc-placement.mjs`, `admission.mjs`,
  `capture.mjs`, and `historical-evidence.mjs` passed.
- Native Claude marketplace validation and strict plugin validation passed.
  `git diff --check` passed. Only fresh synthetic stores, local fake HTTP,
  and public npm cache metadata were used; no real provider request, account
  credential, benchmark ledger, or historical data was used.

Dependent entrypoint check: defaults remain five tools; the recovery option
adds the admission read plus classification (seven total). The existing
classification inventory test was updated. Capture completion and duplicate
replay were not modified. The installed archive includes the modified public
core and MCP files from its fixed file list; the new installed test checks
their hashes against the built report. No packaging runtime or file-list
change was needed.
