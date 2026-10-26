# B4a: supervised local capture process transport

Status: final source and affected regression accepted; candidate commit,
committed acceptance, independent dual review and remote CI pending.
Fixed base: `581786936a06d8f185faf175493fcbbea04fbc83` (B3 PR #460,
dual independent reviews passed; all31 remote checks now pass, ready/unmerged).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-transport`.
Branch: `feat/raw-local-transport`.

## Outcome and scope

Continue step 3 of `raw-local-v1-completion.md`. Connect a trusted host worker
to the installed B3 one-shot process; do not implement a second engine, provider
or budget. This packet alone does not enable automatic capture. Separate later
packets own versioned producer/cursor persistence, Claude/Codex host entrypoints,
setup and the final installed Raw/Memory/Card lifecycle.

Synthetic local development, offline tests and a reviewed PR only. No user
transcript/config/database, provider credential, live call, merge, publication,
deployment, operational migration, product pin/flag or client enablement.
The primary owns this contract and independent acceptance; one GPT 6.1 Sol/high
worker owns implementation and tests. Two nonauthor GPT 6.1 Sol/high axes later
review the same committed fixed-base diff. Preserve dirty primary worktrees.

## Trusted API and binding

Implement a new opt-in `createLocalCaptureTransport(options)` in
`integrations/client/raw/local-transport.mjs`, returning an immutable object
with `capture(request, { signal } = {})`. This is not a replacement for hosted
v1 transport and is not exported from an automatic host entrypoint yet.

Closed constructor options: `nodeExecutable`, `runtimeRoot`, `configPath`,
`expectedAuthority`, `home`, optional `env`, optional `deadlineMs` (default and
maximum 155000; minimum 3000). Paths are normalized absolute trusted host
settings, never request fields. `env` defaults to process.env but is never
spread or enumerated into a child. Snapshot validated options and authority;
do not accept caller mutation, dynamic command arguments, alternate modules or
source paths from the request. Freeze/detach a strict capture-v2 request before
any await. Invalid request/scope refuses before spawning a capture child.

Use the existing closed configuration and authority validators, not a competing
schema. Read the owner-private config as one bounded snapshot. Compare its full
canonical authority with expectedAuthority, including store, target, namespace,
client and all generation/revision fields. A same-project but different owner
or store is not an acceptable match. Compare normalized personal namespace
representations, not JSON insertion order. B3 remains the durable final check;
the transport must not auto-refresh consent or call setters.

Add exactly one optional trusted CLI binding:
`--config <path> --config-digest <lowercase 64-hex SHA256>`.
The existing two-argument CLI remains valid. Hash the UTF-8 text returned by the
existing private reader; both processes use the same function and encoding.
This is a configuration-text snapshot commitment, not a claim about arbitrary
raw-byte equivalence or hostile same-user executable replacement. The child
checks the digest before parsing/opening a writable store or looking up a key.
A replacement after parent read therefore refuses instead of retargeting work.
No inline config, key, module, command or additional process-budget flag.

Move the node:sqlite import inside asynchronous preflight so pure config and
transport import on a Node 20 host does not load SQLite. The capture child still
requires an explicitly selected supported Node >=22.16 runtime. No download,
PATH fallback, runtime installation or schema upgrade on invocation.

## Process and environment contract

Run only two fixed subprocess shapes, shell:false, no detached process:
the selected executable with `--version`, then the same executable with the
fixed `<runtimeRoot>/adapters/local/cli.mjs` and config/digest arguments.
The version probe must exit 0 with one bounded exact stable vMAJOR.MINOR.PATCH
line (22.minor >=16 or major >22; no prerelease). Tested runtime claims remain
limited to the actual 22.16/24.15 matrix, not every accepted future version;
reject missing/old/malformed/nonzero runtimes before capture. Bound the probe
to at most 2000ms within the one operation deadline. The runtime root/CLI must
exist as the expected local install; no source-tree fallback or search path.

Child environment is closed: validated explicit HOME, fixed PATH=/usr/bin:/bin,
LANG=C.UTF-8, and only the selected provider variable for the capture process.
No inherited NODE_OPTIONS, loader/preload/debug flags, LD_/DYLD_ variables,
proxy variables, hosted/subscription tokens or unrelated API keys. Probe gets
no provider key. Supported forwarded names are OPENAI_API_KEY or
`CAIRN_[A-Z0-9_]{1,96}_API_KEY`; other configured names explicitly refuse for
this transport even if standalone B3 can name them. Never forward a reserved
execution/environment variable as a credential. Read only the named own-data
value, rejecting accessors/proxies for a supplied environment. Missing selected
key is allowed: B3's replay/continuation paths remain keyless. Present values
are bounded strings without control/NUL characters; never print or persist them.
Forwarding a key is not permission to change B3's lazy validation/dispatch.
The selected environment value is snapshotted once after the config read names
it; no constructor-time snapshot of the entire environment is claimed. Other
options/authority and each request are detached before asynchronous work.

Write exactly the frozen bounded JSON request and EOF to stdin. Bound stdout
to 262144 bytes and drain/discard stderr without retaining arbitrary prose;
stderr over 65536 bytes terminates the child. Probe output is bounded to 128
bytes per stream. Use strict UTF-8 decoding and exactly one JSON line, no extra
record/banner/trailing prose. An envelope is accepted only after child close
with exit 0, no signal, successful stdin completion and before the deadline.
Receiving apparently valid bytes followed by a hang/nonzero exit is failure.

One monotonic deadline begins before configuration/probe work. Reserve the
final 2000ms for termination: SIGTERM at work-budget exhaustion, SIGKILL after
1000ms if still alive, and observe actual child close. User cancellation,
overflow, pipe errors and malformed output follow the same supervised teardown;
no retry, detached work or returning success with an unreaped child. Timers and
listeners are removed on every settled path. Never return a successful result
because a timeout Promise won a race. Do not promise Node timers can terminate
an uninterruptible kernel hang; uncertainty is never successful completion.

Return only `{ status, body }` with strict envelope and bounded closed bodies.
200/202 and 429 use `classifyRawAcknowledgement` against the frozen request.
Allow only B3's fixed non-2xx refusal codes; interpretation_incomplete retains
matching bounded Raw dispositions (validate their identity/shape without
claiming admission). Never forward arbitrary error prose. Transport failures
throw a content-free fixed-code error with `uncertain` false before capture
spawn and true once capture may have started. No caller may advance on that
error, processing, quota or incomplete interpretation. This packet itself has
no cursor, usage writes, model calls or retries.

## Acceptance

| ID | Required observable result |
| --- | --- |
| B4a-01 | Strict request/constructor validation and full expected-authority binding; both clients and personal/project namespaces. Wrong owner/store/target/generation cannot dispatch despite matching project ID. Mutation after call cannot replace frozen request/options. |
| B4a-02 | Actual fixed version probe and capture subprocess: supported explicit runtime works; missing/old/invalid/nonzero/hanging probe refuses with no capture. No shell, PATH fallback, dynamic command or provider key in probe. |
| B4a-03 | Actual child receives only the closed environment and one selected fake key; adversarial NODE_OPTIONS/preload/proxy/unrelated token sentinels are absent. Missing key still launches replay/continuation. Unsafe configured key names/accessors refuse without invoking them. |
| B4a-04 | Replace private config after parent snapshot but before child read; exact digest mismatch refuses before DB/usage/provider effects. Unchanged snapshot succeeds. Existing standalone CLI and strict unknown/duplicate argument rejection remain. |
| B4a-05 | Complete/duplicate/continuation, durable processing, quota and interpretation-incomplete are distinguished. Wrong message/index, oversized/malformed/invalid-UTF8/two-line reply, nonzero exit after valid reply, stderr flood and broken stdin cannot advance. No stdout/stderr/key/source leakage in errors. |
| B4a-06 | Real cooperative and SIGTERM-ignoring child tests establish cancellation, shared deadline (including slow prep/probe), escalation and actual reaping. Partial reply/hanging child never succeeds. Abort before spawn starts nothing; error uncertainty accurately records capture launch. |
| B4a-07 | Fresh process against actual B3/core/SQLite gives exact source and stable replay/continuation with zero extra usage; fake HTTP only for initial interpretation. Installed private archive test has no source fallback; independently derive complete import/assets closure and cross-check archive inventory. |
| B4a-08 | Owned success/failure/timeout fixtures leave no unexpected scratch or children. Both Node22.16/24.15 suites pass with actual exit codes. Node20 CI import smoke proves no eager SQLite; do not infer unrun full Node20 integration or native macOS/Windows behavior. Existing hosted/v1 defaults and bundle/setup manifests remain unchanged. |

## Implementation files and verification

Worker may add the transport plus small adjacent pure process/reply helpers,
dedicated tests/fixtures under integrations/client/test, and a dedicated
packaging test/fixture. Narrow shared edits: adapters/local/configuration.mjs
(shared snapshot/digest and lazy SQLite), existing local tests, minimal shared
reply constants if necessary, artifact-files.json, package.json, CI discovery,
CHANGELOG.md, docs/raw-local-journal.md and docs/limitations.md. Root owns this
plan. No existing hosted transport/runtime guard/producer/parser/host worker,
schema, provider profile, runtime bundle, setup or product edits. No commits
or push by worker. Escalate an unexpected shared-file need before editing.

Trace actual callers and imports, including packaging and both unchanged host
entrypoints. First freeze focused test rosters and demonstrate boundary cases;
then freeze source and run affected full gates with the owned runner. Required
on both runtimes: new transport and local suites, artifact, generic validation,
Codex/client/Raw producer, lifecycle, bundle/setup consistency and real native
plugin validation. Core implementation is unchanged; retain B3 full core/MCP/
OpenAI evidence only after proving their source/dependency identity, and run
the affected B3 integrated acceptance against the new adapter boundary. If
imports or runtime changes make those retained gates inapplicable, expand the
roster explicitly before running it, not after a failure.

No source edit while a final gate runs. Retain every red result and classify
its cause before retry. Use existing workspace fixtures and synthetic HOME;
check node_modules symlinks and lock identity before sharing installed deps.
Primary independently inspects the diff and runs committed key acceptance;
both independent review axes and latest remote CI precede ready delivery.

## Subsequent seams retained, not hidden in this packet

The shared local-v2 worker must persist canonical pending parts before sending,
advance only matching completed acknowledgements, and preserve ordinal/session
identity across source epochs. Cursor metadata must not persist raw session IDs
or content; Claude selection state must persist independently from host trust.
Excluded records need a verified source commitment before advancing. Confirmed
incomplete interpretation remains visible; uncertain delivery can only replay
the same identity under an explicitly bounded policy. No silent new ID, quota
reset or automatic reinterpretation. Host setup/bundler and final lifecycle
remain separate acceptance work; completion of this transport is not V1 done.

## Work record

B3 delivery is accepted at the fixed base: all31 latest-head checks succeeded,
four workflow records bind the reviewed commit and merge preview180fb2c has
the identical62acfd0 tree. One GitHub job/check remained in_progress despite
all successful steps and a successful workflow. Its retained direct log had
198/198 Codex,5/5 client,38/38 Raw producer. One scoped job rerun reconciled
the remote state; no source change or waiver. B3 stays unmerged.

Primary has frozen a separate15-case actual-process acceptance roster before
B4a's final implementation: SHA256
`e1cd16eba6742f26fcf9e6c1d23bbe93c734953585a0c6f8c2c503b61462c3bf`.
Its syntax check exits0; no behavioral pass is claimed yet. Evidence directory
is `/tmp/cairn-raw-b4a-evidence.s8eoux` (primary-* and author-* owners).

Interim primary source inspection identified two boundary problems. The author
then reproduced both through actual transport subprocesses: normal owned0755
HOME was incorrectly rejected by a private-state0700 check, and a supported
executable removed after its probe caused no-PID ENOENT yet was marked uncertain.
The two-case red has actual exit1 and is retained. The bounded corrections must
preserve private config/usage checks, refuse foreign/non-directory HOME without
changing its permissions, and derive capture uncertainty from actual launch
evidence. Primary also froze a separate two-case acceptance supplement at
`707c99756c8a21c87109053db1afdc78c682fd7a273c40b1f3b6a3657f703437`;
it is not a renamed15-case denominator. Corrected observed behavior, complete
source freeze, final affected gates, dual review and delivery remain pending.

Primary first-source acceptance is complete: the frozen15-case roster passed
15/15 on Node22.16.0 and24.15.0, actual child exits0/null signals and enclosing
owned-runner exit0. Its separate two-case HOME/no-PID supplement passed2/2 on
each runtime, actual exits0. The observed10-path source snapshot did not change
during these runs; inner and outer owned workspaces were removed. These are
pre-final-source results, not a substitute for final committed acceptance.

The author then added only the approved packaging/CI/docs discovery and focused
boundary coverage. Final focused35/35 (32 transport plus3 config binding),
installed2/2 and SQLite-fenced pure-import smoke passed on both runtimes, actual
exits0. Installed proof independently derives135 CLI/transport imports/assets
and observes exactly those135 archive files across both clients; five fresh
capture children per client distinguish3 completed and2 incomplete responses.
No local Node20 binary is available; its actual import gate remains remote CI.

The author freezes18 paths plus this primary-owned plan (19 total). Two
mechanical inventory routes agree; the1798-file source snapshot excluding this
plan is SHA256 `961d0e38022df953a05138a896659ea7255365d94dcd494ce50c572edced3c4f`.
The18 author-path digest is
`6408f253aabb6477d8fc61e5e948cbd087bed0e75046474980de3367b1055c18`.
Complete core/MCP/OpenAI/shared-guard sources and three manifest/lock pairs are
unchanged from B3;18 installed dependency entries resolve to the same package
trees. These facts permit retaining B3's unaffected full core/MCP/OpenAI gates;
they do not replace the changed adapter's integrated tests or latest-head CI.

Final affected roster is14 serial gates per runtime,28 total: local transport,
pure import, local adapter, artifact, generic tests, JSON validation, native
plugin validation, capture demo, bundle consistency, setup consistency,
workspace lifecycle, Codex, client parity and Raw producer. Each gate must
record actual exit/signal, source/dependency freeze and owned cleanup. A failure
stops the matrix for diagnosis; no source changes during a run. Primary will
then rerun its15-case roster plus the separate2-case supplement on the final
candidate, personally exercise the installed archive, and obtain two independent
nonauthor reviews on the exact committed fixed-base diff before delivery.

Before the approved matrix launched, an additional actual-public-call check
found a forged AbortSignal prototype could leave one operation timer after a
settled refusal. The same isolated red is0/1, actual exit1 on both runtimes;
an async-hooks diagnostic attributes the remaining timer to scope creation,
not the test harness. No matrix ran on that source. Native brand validation
now precedes timer allocation and native signal getter/listener methods avoid
caller-owned accessors during checks and cleanup. The correction changes only
local-process.mjs, its tracked test and limitations; the original freeze and
all red logs remain retained. Corrected focused37/37 includes the external
red-to-green case plus36 tracked cases, actual exit0 on each runtime.

Primary's separately frozen three-case signal supplement also passes3/3 on
each runtime, actual owned-runner exits0. It covers forged native prototype,
Proxy traps and genuinely cancelled signals with own getter/method overrides;
no timer or child remains. This supplements, not renames, the15+2 roster.
The corrected18-author/1798-source freeze is author digest
`01b94386a50c09ff649565137632f164fa42468b78e1887ff9cf24669f191c5b`,
full source digest
`3d02bc5088b90540fcfa4c9a6580790045858453404b6a4a9b449af8c5c85813`.
Dependencies and modes are unchanged. The same28-gate roster is rebound to
this corrected freeze; original evidence is never overwritten.

### Historical28-gate completion and final narrow caller correction

The corrected matrix completes28/28 unique commands (14 each Node22.16/24.15),
all actual exits0/null signals; enclosing owned runner also exits0. Per runtime:
transport33/33, local30/30, artifact104 passed plus one native-Windows skip,
generic635/635, workspace lifecycle25/25, Codex198/198, client5/5, Raw producer
38/38. Pure import, JSON/native validation, capture demo, bundle and setup
consistency all exit0. Primary independently audits those rows, counts,
source/dependency equality and absence of inner/outer workspaces, actual exit0.

While this frozen matrix ran, a separate primary public-boundary probe found
the transport caller still used instanceof before the native helper's Proxy
rejection. A caller's getPrototypeOf trap therefore ran once. This did not
start a child or leak a timer, but violates the intended rejection boundary.
The new separately frozen one-case supplement fails0/1 with actual exit1 on
both runtimes; do not relabel the historical matrix as covering that case.
It remains separate from the primary15+2+3 rosters. The narrowly authorized
correction is public Proxy refusal before reflection, its tracked regression
and limitations text only; no source changed during the historical matrix.

Retain22 unaffected historical gate results with complete source/dependency
identity proof. Replace only six affected entries: transport, pure import and
artifact on each runtime. Do not restart the whole28-command run. Exact final
freeze and all six actual outcomes still gate the candidate; primary21-case
acceptance (15+2+3+1), personally exercised installed2-case proof, fixed-SHA dual
review and latest remote CI remain required before ready/unmerged delivery.

### Final source accepted

The public Proxy guard correction changes exactly three author paths: transport,
its tracked regression and limitations. Final18-author digest is
`1074a3dd0f8fbb31f7d369e14d5d7b6209c1d6b675da939b032be2c680a26ad4`;
the1798-file source digest is
`59f326b2dd6dae929adaf5c1de73e449a6c0821a84abef0222a045a43e1290f7`.
All six replacement commands complete with actual exit0/null signals and the
enclosing runner exits0: transport34/34, pure import0, artifact104 passed plus
one native-Windows skip, on each runtime. Historical28 evidence is retained;
22 unaffected entries plus these six replacements constitute the final roster.
Before/after source and18 dependency entries match exactly. Primary separately
audits all six records and verifies both owned workspace roots are absent.

Primary final-source acceptance passes its original15 cases and separate2+3+1
supplements on both runtimes,21/21 each, all actual child and outer exits0.
Primary also personally runs the two installed-archive cases on each runtime,
actual exits0; this is exercised author coverage, not independently authored
coverage. No test source or candidate file changes during these runs. Inner and
outer owned scratch roots are removed. Git diff plus untracked inventory and an
independent complete base/current Git-blob-and-mode comparison agree on19 paths,
including the plan, CI and packaging changes; final author/source digests agree.
No live provider call, user transcript, merge, deployment or automatic client
activation is part of these results. The next gates remain the exact committed
candidate acceptance, two nonauthor reviews and latest-head remote CI.
