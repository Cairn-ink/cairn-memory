# Contained native Mem0 gateway — Y acceptance contract

Fixed base: f85322724eb91e4900d49cf1a400e8ce2f98ea4a (X/#239).
Target branch feat/mem0-native-gateway, isolated sibling worktree.
Primary owns architecture, acceptance and final integration. One GPT-6 Sol/high
worker implements; separate nonauthors review Standards and Spec on final SHA.
Copy this contract into docs/plans/mem0-native-gateway.md before implementation.

Outcome: run actual pinned Mem0 OSS 2.2.0 add/search through X/W using a private
AF_UNIX gateway and a contained native child. This packet is fake-provider
verification only, not a shared scoring runner, fairness freeze, paid launch,
operational ledger migration, installed Cairn host change or quality score.

## Acceptance Y1–Y15

Public call shapes are exact own-data options:
`inspectMem0NativeArtifact({venvRoot,pythonRoot})` returns a frozen descriptor
with the two digest fields and private in-process identity;
`mem0NativeConfiguration({topK,threshold,childTimeoutMs,httpTimeoutMs})` returns
`{configuration,configurationSha256}` frozen;
`runMem0NativeCase({artifact,configuration,guard,handle,input})` takes those
factory results and the actual trusted X objects. No caller spawn/fetch/clock,
child-path or reap-attestation injection in production entrypoints. Test seams
must remain private to controlled fixtures, not alternate public authority.

- Y1 Add evaluation-only artifact inspection, gateway and Python child. Public
  entrypoints are inspectMem0NativeArtifact, mem0NativeConfiguration and
  runMem0NativeCase. Keep dependencies outside core/install artifact. No model
  key lookup or network fetch in these helpers; transport is only X's already
  supplied parent fetch. Actual execution requires Linux/bwrap, explicit local
  artifact paths and an active Mem0/generation scope. No automatic install.
- Y2 Artifact inspection reads finite trees: venv root and declared CPython
  root, both canonical existing directories. At most 100,000 entries / 1 GiB
  regular-file bytes total; reject special files, unreadable entries, symlink
  escapes/cycles and invalid roots. Symlinks may resolve inside either declared
  root; record literal link targets and canonical target role/relative path.
  Hash every executable/importable tree file including .pyc/.pth/.so and data,
  sorted role/relative-path entries containing type, executable bits, byte size
  and SHA256 or link target. No reliance on package version or RECORD alone.
  Bound mem0 sourceTree separately from the full dependency/execution tree:
  sorted installed mem0 files excluding __pycache__ and .pyc; dependency digest
  includes the entire two-root tree plus distribution METADATA names/versions.
  Canonical serialization and version/domain tags must be specified in plan.
  Require exactly one mem0ai metadata version2.2.0 and the expected Python3.11
  layout. Return frozen sourceTreeSha256/dependencyLockSha256 and local opaque
  reusable descriptor; no source/file text in diagnostics. A JSON lookalike
  cannot substitute for the inspected descriptor. Record trusted-host model:
  OS/libraries/kernel are trusted external prerequisites; same-UID hostile host
  mutation is not prevented. Rehash the declared trees before spawn and after
  reap; mismatch is global. Do not claim immutable snapshots or portable timing.
- Y3 mem0NativeConfiguration freezes exact closed config: profile version,
  full W wire profile, topK (1–100), threshold (finite0..1), childTimeoutMs
  (positive safe integer<=3,600,000), fixed termGraceMs2000/reapMs5000,
  inputBytes8MiB/outputBytes2MiB/stderrBytes64KiB, HTTP timeout equal X's
  mem0TimeoutMs, child-source SHA256 and native settings below. Hash normalized
  config with a documented version/domain. Reject getters/unknown fields and
  malformed bounds before spawn/socket/ledger/HTTP. Native settings pinned:
  local Qdrant1536, graph/reranker/vision/telemetry off, retry0, infer=True,
  search rerank=False/explain=False/show_expired=False; no optional spaCy path.
  Verify config digest and both artifact digests equal the active X manifest;
  W profile must match exactly. Profile/config hashes are local private metadata.
  The hashed configuration is a TEMPLATE: every behavioral field above plus
  fixed scopePolicy x-schedule-case-v1, storePolicy fresh-private-case-v1,
  transportPolicy private-uds-v1. It contains no ephemeral paths or user_id.
  Runtime socket/store roots are created privately by the helper; user_id is
  exactly capability.schedule[handle.snapshot().ordinal].caseId. Validate
  handle ordinal/arm/phase against that exact schedule and its declared arms;
  neither caller nor child may override these derived values. Explicit template
  separation closes the independent preimplementation review clarification.
- Y4 Exact input is {batches,query}; batches1–2500 each1–24 exact messages
  {role,content}, role user/assistant/system, nonempty well-formed Unicode text.
  Bound serialized UTF8 input8MiB and query<=16KiB; never truncate, split,
  reorder, add timestamps, read a corpus or invent source IDs. Future common
  runner supplies rendered dates and identical visible source information.
  Keep input/source data private; no raw stdout/stderr/request text in errors.
- Y5 Invoke helper inside X withCaseScope using actual guard+current handle.
  Check active mem0/generation and capture immutable ordinal/case/arm/phase
  from that schedule. One private0700 socket/store root per invocation, no
  child/store/socket reuse across cases. Bind HTTP handlers with AsyncResource
  inside this scope, not merely listener construction outside it. Child never
  supplies case identity, ledger, provider URL or authorization. Guard remains
  final route/body/accounting authority; no parallel physical requests.
- Y6 UDS accepts only POST /v1/chat/completions and /v1/embeddings with bounded
  JSON bodies up to corresponding W request cap. Validate headers/framing and
  complete UTF8 JSON before guard dispatch; fixed fake Authorization header,
  Content-Type application/json and fresh explicit AbortController signal.
  Ignore no malformed framing: normalized gateway fault, zero provider dispatch.
  Never proxy arbitrary URLs/headers/credentials. Invoke mem0ChatFetch or
  mem0EmbeddingFetch with their W endpoint; W validates/canonicalizes/prices.
  Relay only returned validated/sanitized status/body and safe content headers.
  Track all accepted request promises/connections; bounded HTTP-body timeout
  and concurrent/queued connections cannot evade closed-scope fencing.
- Y7 Add ONLY a trusted scoped handle.halt() to X's mixed guard: no args,
  irreversible global halt plus abort current scope work; works after local
  seal while handle still owns active scope. Stale/closed handle calls inert.
  This is restrictive authority only, no new dispatch/reset/reap assertion.
  Global fault after a local seal must not be hidden by X's callback-swallow
  behavior. Update narrow X docs/contract note and tests; old guards unchanged.
  Do not intentionally send malformed HTTP as a backdoor global-stop signal.
- Y8 Child containment: bwrap user/net/PID/IPC isolation, --die-with-parent,
  default PID1 reaper, clear environment, explicit piped stdio/no extra FDs.
  Read-only declared runtime/venv/child/socket, minimal read-only OS libraries;
  private writable case store/dev/proc only. No host home/repo/etc/run/sys or
  credential mounts. Interpreter -I -B, no user-site; MEM0_DIR/cache/TMPDIR
  set before native import. Validate absolute interpreter symlink/home and
  bind original paths. No network capability; dummy key only. Fresh isolated
  child fixture proves host canary/env unreadable, socket mount not writable,
  AF_INET blocked, and child cannot change transport identity. Same-UID hostile
  host is excluded; do not call this a universal sandbox/security guarantee.
- Y9 Use real Memory.from_config; explicit UDS httpx/httpx2 client with
  trust_env=False, retry0 and pinned timeout. Prefer one consistent tested
  client; installed OpenAI explicitly accepts legacy httpx, not a blocker.
  Native add(messages,user_id=fixedCaseScope,infer=True) per ordered batch,
  then native search(query,filters={user_id:fixedCaseScope},top_k,threshold,
  rerank=False,explain=False,show_expired=False). No timestamp/reference_date,
  custom extraction prompt, inferFalse shortcut, custom search replacement,
  oracle joining, external vector service or optional entity NLP. Native
  output/notice logging must not corrupt the one stdout protocol envelope.
- Y10 Native add may catch insert failures and return planned records. For
  each bounded returned ADD record, model-free native get must confirm same
  ID/content persisted before continuing; absence/mismatch is global, not
  success. Empty/duplicate native results are allowed; do not infer how many
  facts should exist or repair them. Bound<=256 add records/batch; verified
  count is returned-record count, not claim of unique facts or source truth.
  Preserve native search order. Single output envelope exact version
  cairn-mem0-native-result-v1, verifiedAddRecords, results. Project each result
  to exact {id,memory,score,attributedTo}: nonempty ID<=200 UTF16, nonempty
  memory<=65536 UTF16, finite score, nullable attribution string<=200 UTF16.
  Omitted native attribution becomes null, not inferred user provenance.
  Results<=configured topK; enforce whole output2MiB; no truncation/re-ranking.
  This normalized private payload does not expose source provenance or dates;
  renderer/fairness selection remains a later frozen protocol.
- Y11 One finite child watchdog uses trusted handle.revoke(), classified as
  cancelled (not a core deadline), then bounded cleanup. On normal completion,
  close/fence listener and connections, await child exit/reap and all accepted
  guarded promises; then verify no pending attempts and no global halt before
  returning {status:'completed',value:validatedEnvelope}. Enclosing scope stays
  active for future shared answer work. On guard local seal, stop accepting,
  terminate/reap/drain, return {status:'sealed',value:null}; never let caught
  native errors/output restore success. On malformed output, child crash,
  disconnect/unknown gateway fault, artifact drift or cleanup failure, call
  current handle.halt(), clean up as far as possible, then throw normalized
  source-safe error; no later scope or paid dispatch. First observed global
  cause wins over timeout/cancellation. No automatic retry/resume/refund.
- Y12 TERM grace2s then KILL; require exit/close acknowledgment by reap5s.
  Own-spawned process-group target only, never arbitrary caller PID. Drain
  in-flight guarded work within its accepted HTTP deadline plus bounded grace;
  still-pending/unreaped is global. Drain stderr continuously but kill/fail at
  64KiB; stdout exactly one bounded JSON envelope, no last-plausible-line parser.
  No exported fake reaped:true or process-success claim accepted from caller.
  Temporary source stores stay private; scoped cleanup only after quiescence,
  preserve bounded failure diagnostics without raw source or credentials.
- Y13 Portable offline tests exercise actual UDS/server + X + fresh nonempty
  real50→100→200→v2 ledger using controlled subprocess doubles; label doubles.
  Cover both wire routes, correct ALS, spoofed identity/path/header, malformed
  body/length/oversize/output, concurrent and late sockets, batch500 fallback
  with fresh reservations, known-priced local seal/caught-error denial,
  unknown usage/global stop, transport/disconnect and cancellation first-cause,
  hung/crashed child, failed reap/drain and settlement fault. Prove old child
  cannot dispatch into next scope; swallowed global error cannot advance.
  Artifact config/version/content/symlink/pyc tamper rejects before HTTP.
- Y14 Separate opt-in LOCAL native gate on Node22.16/24.15 uses real pinned
  installed Mem0, real bwrap, real UDS and X with fake transport/fresh synthetic
  ledger. Actual add/persistence/search pass, SDK retry0, native fallback is
  counted, containment probes pass, local seal exits child and next valid arm
  works; global/cleanup failure forbids next arm. Missing prerequisites fail
  this explicit gate, never count skipped as passed. Ordinary CI can report
  native gate not run; it does not replace mandatory local native evidence.
  No old probe/helper replay, provider key or operational ledger permitted.
- Y15 Both Nodes: full budget/guard/live-offline, new portable tests, npmtest,
  JSON/pinned strict plugin/marketplace, budget+guard demos and explicit native
  gate; Python syntax without writing pyc to checked artifacts. Primary reads
  actual final diff, runs separately designed native/process acceptance on
  frozen SHA. Separate nonauthor Standards+Spec, correct/retest/rereview final
  whole range; scoped PR main, all latest-head CI green/mergeable before ready.
  No merge/release/deploy. Preserve all failures and limitations honestly.

## Allowed files and stop conditions

New evaluation/experiment-budget/mem0-native-{artifact,gateway}.mjs,
testing/mem0-native-child.py, focused tests/controlled fixtures in that subtree;
request-guard.mjs only Y7 handle halt and its focused tests; package scripts;
docs/plans/mem0-native-gateway.md, narrow request-guard/protocol/limitations docs,
X plan extension note and CONTRIBUTING gate. No ledger/W/core/adapter changes,
dependencies/lockfiles/CI changes, downloaded corpus, API keys or paid calls.
Before coding, audit for contradictory requirements/unworkable bounded paths;
report concrete issues to primary. No silent scope expansion or weakened gate.

After Y: common source/context/answer/scorer runner and whole matched-resource
freeze; original reserved30 once only after feasibility; installed Cairn host
opt-in/growth and cold-session acceptance. This does not pass S2–S5 by itself.

## Primary preimplementation clarification

One internal `evaluation/experiment-budget/mem0-native-runtime.mjs` is allowed
for the lifecycle/kernel and injected controlled subprocess doubles in Y13
tests. The production `runMem0NativeCase` entrypoint hardcodes the real child,
spawn and bwrap path and accepts no process/child-path hooks or global mutable
test switch. Y14's separate actual pinned native gate and primary independent
public-entry acceptance remain mandatory. The guard and handle are trusted
parent-owned X objects; Y validates their closed capability/schedule/config
snapshots and relies on X's active AsyncLocalStorage route authorization. Shape
validation is not presented as authenticating arbitrary caller-created JS
objects. Native child input cannot choose these objects, configuration or
case identity.

For Y14 containment-only testing, the internal runtime module exports its
production `bubblewrapArguments` assembler. A trusted same-process test calls
it with the real pinned child mount, then substitutes only the final Python
command with a synthetic `-c` probe. The public gateway offers no launcher,
child path, mount, or reap override; this seam is not paid-run authority.

## Implemented private identity serialization

The artifact inspector sorts role/relative-path tuples by JavaScript code-unit
order, normalizes paths to forward slashes, and hashes UTF-8 of the literal
domain tag, newline, JSON serialization, newline. Full dependency tuples are
`[role,relativePath,type,executableBits,byteSize,sha256]` for regular files
and directories, or additionally literal link and canonical target role/path
for symlinks. Its domain is `cairn.mem0.native.dependency-lock.v1`; the
serialized object has ordered `entries` and installed distribution `metadata`
name/version triples. The separate installed `mem0/` file-only digest omits
`__pycache__/` and `.pyc` under domain `cairn.mem0.native.source-tree.v1`.
The configuration digest uses the same tag/newline/JSON/newline format under
`cairn.mem0.native.configuration.v1`; the frozen template includes the fixed
local HTTP base URL `http://unix-gateway/v1`. The native input's serialized
`{batches,query}` cap is 8 MiB; the fixed parent-to-child wrapper has a
separate 2 KiB allowance. These hashes identify a trusted local installation,
not an immutable snapshot or a portable runtime-time guarantee.
The configuration also binds the fixed private HTTP connection limit (4),
header count (40), per-header value bound (256 characters) and header deadline
(`min(2000,httpTimeoutMs)`), so those transport bounds cannot silently drift.
The production launcher additionally verifies that its own detached process
group no longer exists after child close, within the bounded reap interval;
the internal process double does not use that host PID probe. A deny-only
internal test seam can force a still-live group for cleanup testing; it cannot
attest that a group exited, and the public case helper accepts no such option.
The configuration fingerprints the 16 KiB HTTP parser header-block cap and
`bwrap-user-net-pid-ipc-root-readonly-v1` containment policy. Node's implicit
header-count truncation is disabled so the explicit 40-header check sees the
whole bounded block. The production bwrap assembly remounts its synthetic root
read-only after setting up mounts; `/case/store` remains the sole ordinary writable bind and
contains precreated private `tmp` and `cache` directories. A controlled test
checks `/tmp` and `/app` deny writes while the store allows them.

## Author verification record

The implementation owner was GPT-6 Sol/high on branch
`feat/mem0-native-gateway` at fixed base
`f85322724eb91e4900d49cf1a400e8ce2f98ea4a`. The original author corrected
one X9 test expectation after adding the restrictive `halt` handle; the narrow
red/green check and the full guard gate then passed. This record distinguishes
the original author's preserved checkpoint from the resumed author's terminal
results. All runs used fake HTTP, fresh synthetic ledgers, and no provider key,
operational ledger, corpus, or paid request.

| Gate | Node 22.16 | Node 24.15 |
| --- | --- | --- |
| `test:mem0-native-gateway` | 29/29 pass (preserved author checkpoint) | 29/29 pass (preserved author checkpoint) |
| `test:mem0-native-local` with explicit pinned roots and real bwrap/Mem0 | 7/7 pass (preserved author checkpoint) | 7/7 pass (preserved author checkpoint) |
| `test:experiment-budget` | 58/58 pass (preserved author checkpoint) | 58/58 pass (resumed author) |
| `test:experiment-request-guard` | 285/285 pass (preserved author checkpoint) | 285/285 pass (resumed author) |
| `test:live-evidence-offline` | 340 pass, 30 expected skips (preserved author checkpoint) | 340 pass, 30 expected skips (resumed author) |
| `npm test` | 112/112 pass (preserved author checkpoint) | 112/112 pass (resumed author) |
| `npm run validate` and budget/guard demos | pass (preserved author checkpoint) | pass (resumed author) |
| Pinned `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin pass (resumed author) | marketplace and strict plugin pass (resumed author) |

The resumed author also parsed `testing/mem0-native-child.py` with Python's
`ast.parse` without generating bytecode; `git diff --check` passed. Raw logs for
the resumed Node 24 `npm test`, JSON, demos, and both pinned plugin checks are
in a private verification archive. The earlier terminal results and the
resumed budget, guard, and live-offline results were preserved as terminal
command outcomes in the agent handoff/tool transcript, not inferred from partial
logs. Primary acceptance and
both independent fixed-diff review axes remain separate delivery gates.

Primary source inspection of candidate `9a255d47a1c2bb1ba11ae9af83f6da0c6d00b894`
found a Y12 cleanup fault: an owned process group still live after child close
halted X but did not prevent removal of the private case root. The retained
focused test was red on Node 22 (`Missing expected rejection`) before the
kernel observed the test-only flag. A controlled mutation of the corrected
kernel removed only the root-cleanup quiescence condition: the same test then
failed specifically because the root was absent (`false !== true`) despite the
global halt. Restoring the condition restored 2/2 focused passes for the
live-group and ordinary-cleanup cases; the runtime source SHA-256 returned to
its pre-mutation value. The test's internal
flag can only force non-quiescence, and the public helper rejects it. The full
affected gates, independent acceptance, and both review axes must use the new
candidate rather than the pre-correction results above.

After restoring the cleanup condition, both Node 22.16 and 24.15 passed the
corrected portable gateway suite (30/30), pinned local native/containment
suite (7/7), budget suite (58/58), request guard suite (285/285), and generic
`npm test` (112/112). JSON validation, the budget and guard demos, and pinned
marketplace/strict plugin validation passed on both Nodes. The prior live
offline results remain pre-correction evidence; this correction changes only
the native runtime's private cleanup predicate, its focused test, and this
plan. The private verification archive retains the corrected terminal logs
and the cleanup-predicate mutation failure.
