# Old-graph-visible full-set control, offline only

Fixed base: `e68d79f747e895a0dcffedcee3eda13d9793ba32`.
One Sol/high worker implements this independent evaluation-only facade while
the primary prepares the comparison and verifies the adapter delivery.

- DC1: Add a narrow evaluation facade around an injected model's `relate`.
  It accepts a frozen old-edge list as explicit setup and only accepts the
  unmodified ordinary source-only rationale request (no focus or other task).
  Preserve the complete source memories and append the supplied old-edge
  indices/tuples marked unverified, so its provider input has exactly the
  disposition input shape. Validate that shape using the existing disposition
  schema helper before provider access. No IDs, namespaces, metadata, labels
  or expected answers may be added. No core or product prompt changes.
- DC2: Freeze the control instruction in a new evaluation prompt file before
  any new scored fixture is written. Append to existing relate-rationale.md:
  old edges are unverified proposals, examine them against sources, return a
  complete proposed edge set (not only additions), omission excludes an edge
  from this projected set, preserve supported historical reasons, distinguish
  present applicability, and respect subject/time/scope/uncertainty. At most
  ten normal relation tuples; no disposition labels or automatic writes.
  Explicitly document that the two arms compare whole prompt/output protocols,
  not an isolated causal effect: the existing relate prompt includes detailed
  relation definitions that the current disposition prompt does not inline.
- DC3: Capture bound provider/counter callbacks and signal, clone/freeze caller
  input and setup before arbitrary callbacks, count the actual expanded request
  with the existing 6000-input/1024-output limits, preserve cancellation and
  no-retry behavior, pass raw output without repair. Reject malformed setup,
  request shape, custom/getter input and unsupported focus before transport.
  Do not spread unrelated model methods into new authority; expose only what
  the core proposal helper needs. Preserve contextWindow and valid counter.
- DC4: Tests prove exact provider-visible matched input, immutable snapshots,
  count of expanded content, bounds/abort/provider error handling, zero HTTP
  on rejection and raw malformed/empty outputs unchanged. Exercise through
  the real core proposal helper with a freshness callback and a synthetic
  installed adapter using fake HTTP, so the two-phase transport is observable.
  No database writes are necessary: this is a proposal-only evaluation helper,
  not use of reviewRationale's persistent replace path.
- DC5: No fixture/rubric/operator, provider key, real HTTP, paid grant or shared
  ledger access. Previous evidence and prompts stay immutable. Document fair
  input equality and cold graph immutability as later operator gates, not
  results already achieved here. No production default, MCP or packaging API.
- DC6: Generic tests and JSON/strict-plugin validation on Node22.16 and24.15,
  relevant adapter fake tests on both, primary independent focused probes,
  fixed-candidate independent Standards/Spec review, latest-head CI and PR.
  Any test using SQLite must dynamically import and skip only that integration
  on Node20; pure facade tests remain in generic CI. No merge or release.

Allowed files: new evaluation/architecture/rationale-disposition-control.mjs,
new evaluation/architecture/prompts/rationale-disposition-control.md,
new evaluation/architecture/test/rationale-disposition-control.test.mjs,
new packaging/test/rationale-disposition-control.test.mjs, this plan and a
narrow docs/rationale-disposition-control.md. The primary approved that
separate installed test file before it was added. No shared worker files,
application code or dependency changes.

## Frozen instruction and implementation record

- The control-only appended prompt was frozen before any new scored case at
  SHA-256 `7b19f4deb938e192dcf6b386384ecb76aeb226f6524100fe8899b74bab5174ee`.
  Neither the ordinary core relation prompt nor any DR prompt is edited here.
- Owner: Sol/high worker, fixed base `e68d79f747e895a0dcffedcee3eda13d9793ba32`.
  The sole new entrypoint is the evaluation facade constructor. Its intended
  caller is the existing source-only `proposeRationale` helper, not persistent
  `reviewRationale`, automatic capture, MCP or provider guard. The installed
  regression imports this facade from source and the core helper/adapter from
  the installed artifact; the facade is not packaged.
- Targeted pure facade tests pass 6/6 on Node 22.16 and 24.15; the installed
  fake-HTTP test passes 1/1 on both. The latter observes exact count/generate
  phases, source-plus-old-edge input and unmodified relation output through
  installed code, without opening a database. Worker generic tests passed
  127/127 and JSON validation passed on both Node 22.16 and 24.15; the native
  strict-plugin validator passed. No token/cost/elapsed-time usage is inferred
  from these scripted tests.
- Primary serial verification on Node 22.16 and 24.15 passed pure facade 6/6,
  full installed-artifact suite 70/70 (69 existing plus this new test), generic
  127/127, JSON validation and strict plugin/marketplace validation. The
  unchanged full adapter suite was not duplicated; installed real-adapter
  fake transport passed on both. Primary corrections before freeze required
  post-provider abort checking, direct-call denial after an expanded count
  over 6,000, and freezing the whole sent provider request; focused tests now
  cover each. No threshold, shared guard or core code was changed.
- A separate primary inline synthetic core probe on both runtimes used the
  public DR/DS source review and the stored disposition snapshot to build the
  control setup. It found control provider input deeply equal to candidate
  input, and original sources, map and incident graphs unchanged warm and
  after writer-close/keyless-cold reopen. This was a local scripted probe,
  not an installed or paid paired-run result; the later frozen operator must
  independently re-establish equal inputs and cold immutability.
- The later comparison must pin which disposition prompt version it uses.
  Baseline relation definitions/trust warning were not inlined in initial DR
  v1; a separate DS v2 alignment is planned, not delivered or tested here.
  No fresh scored fixture, rubric, semantic judgment or paid result exists in
  this slice. Fixed-candidate independent reviews, exact-head CI and PR remain
  primary-owned delivery gates.

## First review correction

- Independent Spec review found that the initial facade armed `relate` before
  its arbitrary token counter returned. The primary reproduced a deterministic
  red trace against frozen `36477f8`: a reentrant counter called `relate`, then
  returned 6,001 tokens; the result was `counted=6001, sends=1`. This could
  bypass the expanded input limit even though ordinary core use rejected the
  count. No prompt, core or provider adapter change was needed.
- The facade now keeps the candidate request local while counting. Only a
  successful in-budget count arms the one-shot send; nested counting/sending,
  counter throw or invalid result permanently denies it. Output counting is
  separately fenced so a callback cannot use that path to arm a request.
  The primary's same minimized probe on the corrected code returned
  `invalid_disposition_control_request`, `sends=0` (green). Three synthetic
  tests cover reentrant send, nested input/output count and throwing/NaN
  counters. The frozen control prompt hash above is unchanged.
- Corrected worker gates passed pure facade 9/9, generic 130/130 and the
  installed real-adapter fake-transport test 1/1 on both Node 22.16 and 24.15.
  The primary will rerun affected gates against the committed correction;
  its earlier full artifact 70/70 and JSON/strict-plugin results above belong
  to the pre-correction candidate. No paid call, shared ledger access or
  semantic result was involved.

## Second review correction

- Independent Standards review found a second one-shot gap in `fb96cb3`:
  `relate` still left phase `prepared` while inspecting caller-owned request
  properties. A Proxy signal getter on its second read reentered `relate`, so
  both calls reached the bound provider. The worker reproduced the exact
  deterministic red symptom with a focused test: two sends instead of zero.
  Separate descriptor and prototype traps, and a signal `aborted` getter,
  also exposed a send before denial. These are synthetic callbacks, not HTTP.
- The facade now clears its prepared request and enters `validating` before
  inspecting caller data. Any nested count/send poisons the attempt; validation
  checks that state immediately before entering `sending`. Abort checks both
  before and after the provider call recheck state, so a callback cannot turn
  an invalid attempt into a successful result. Four new tests cover the
  second-read, descriptor/prototype, pre-send and post-provider paths. The
  original red reproductions are now green; a post-provider reentry rejects
  after exactly its already-started first send, without a second send.
- Worker gates on this correction passed pure facade 13/13, generic 134/134
  and installed real-adapter fake transport 1/1 on both Node 22.16 and 24.15;
  JSON validation also passed on both.
  Primary independent reruns/review and exact-head CI remain pending. The
  frozen control prompt remains byte-identical. No provider key, real HTTP,
  paid call, shared ledger or scored fixture was used.

## Final signal snapshot correction

- Primary integration audit found that `b9c5a6f` read `request.signal` twice:
  a Proxy could supply a valid `AbortSignal` for `instanceof`, then a different
  value for the forwarded request without reentering or changing phase. A
  focused synthetic test went red on that commit (`reads=2`, expected one).
  The facade now captures the signal once during guarded validation and uses
  that exact value for type check, pre/post abort checks and provider forwarding.
  Reentry on that sole read still poisons the attempt before transport; a
  second-read trap is never invoked. No prompt or product code changed.
- Corrected worker gates passed pure facade 15/15, generic 136/136 and the
  installed fake-transport regression 1/1 on both Node 22.16 and 24.15.
  Primary independent confirmation and latest-head CI remain pending. No real
  provider call, credential or shared ledger was used.
