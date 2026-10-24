# Local Raw V1: public constructor and installed closure (P4b-B1)

Status: frozen local verification passed; committed review and remote delivery pending.
Fixed dependency: `3941e97409cebf5e1e1ab3f882e939e15a7488d5`,
[P4a PR #455](https://github.com/Cairn-ink/cairn-memory/pull/455).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-v1-public`.
Branch: `feat/raw-local-v1-public`.
P4a is ready/unmerged: both independent reviews and all31 latest-head checks
pass on that exact commit; merge tree equals the reviewed candidate tree.
Parent: `raw-local-v1-completion.md`, step3; original authority:
`raw-layer-contract.md` and its pure-local synthetic-development exception.

## Outcome and ownership

Publish the existing Raw composition through `openMemoryCore` and include its
actual runtime closure in the private local install artifact. This remains the
same Raw/Memory/authored-Card engine, not another host-owned implementation.
Raw retention stays explicitly configured and default-off. No automatic Card,
new model/algorithm, live call, real transcript, product pin, merge, registry
release, deployment or operational migration is in this packet.

One GPT6.1Sol/high author owns implementation; primary owns this contract,
integration, separate acceptance, gating and delivery. Two other non-author
reviewers inspect the same final commit for Standards and Spec. Preserve all
existing unrelated work. Use owned synthetic stores and temporary workspaces.

This packet is not complete installed hook capture. Later bounded packets still
own one-shot local transport/model guards, durable SQL authority and controls,
versioned client cursor/recovery and actual installed MCP/terminal lifecycle.
The whole V1 acceptance in the parent plan remains required.

## Public constructor contract

`openMemoryCore({...existingOptions, rawConversations})` accepts exactly the
following explicit Raw option:

```
{ mode: 'raw-v1' | 'off', port?, capBytes?, readPolicy }
```

- No option means the unchanged ordinary public facade. There is no implicit
  Raw capture, source-read capability or retention from privateCards/episodes.
- Explicit option must be a plain object (ordinary or null prototype), with
  own data properties only, no symbols, accessors or unknown names. `mode` and
  `readPolicy` are required. A top-level rawConversations accessor is rejected
  without calling it. Null/undefined/boolean supplied options are invalid, not
  equivalent to omission. Invalid Raw options fail before opening/creating or
  upgrading a SQLite file. Do not change all legacy option semantics to achieve
  this narrowly scoped Raw validation.
- `raw-v1` requires an explicit positive safe-integer cap and a valid port.
  `off` may omit the cap and port. Any provided cap must be valid; omission must
  not rewrite the store's durable cap. A present capBytes or port with value
  undefined is not omission and refuses with its corresponding invalid-input
  or crypto-unavailable error. readPolicy is required and synchronous in both
  modes. Return values retain the existing closed generation/reason
  validation at prepare/commit. This trusted host callback is not wire authority
  and cannot be promised pure by a JavaScript sandbox.
  Constructor validation establishes callability, not proof of synchronous
  behavior; Promise/invalid result rejection remains at prepare/commit.
- Keep the existing `raw-seal-v1` port: version plus callable sealRaw/openRaw,
  including off-mode readers. Do not introduce a decoder-only port. Preserve a
  host object's receiver and opaque key state; snapshot validated method
  references/config before asynchronous work, not the host's secrets. Mutating
  the supplied config/method slots later cannot change the registered options.
  Port class methods may be inherited; accessor-based version/method definitions
  are not accepted or invoked. Extra opaque host state is not serialized or
  inspected. Invalid/missing required ports fail `raw_crypto_unavailable`, not
  native errors; malformed ordinary Raw fields fail `invalid_input`.
- Public selection always enables existing lineage and deletion protections.
  Raw source resolution additionally needs valid existing privateCards authority;
  the Raw option does not create that authority. Internal sources/lineage/deletion
  booleans remain unavailable as public options. With Raw alone, capture, paged
  conversation reads, usage, switches and revision-bound delete are available;
  authorized Card methods are not added. With privateCards too, existing opaque
  per-call authority remains required for source resolution and authored Cards.
- Off mode can inspect/read/delete existing Raw with the appropriate port;
  reads do not invoke capture policy or model work. Without a decoder, encrypted
  or local-plain retained reads fail unavailable, never guess plaintext fallback.
  Default feature-off opens retain existing invalidation/deletion fences.

## Composition and scope

Avoid a contract-to-Raw-to-contract import cycle: extract the existing composition
to receive the existing core builder, then let both the public dispatch and
internal compatibility factory call it. Do not copy storage, capture, admission,
dedup, projection, lineage or deletion algorithms. One runtime/connection and
the existing error/success envelopes remain authoritative. No schema bump or
new public npm dependency is expected; stop for a concrete conflict instead of
inventing a migration.

Allowed author files:

- `core/contract.mjs`, `core/raw-capture.mjs` and new `core/raw-composition.mjs`.
- A small new `core/raw-options.mjs` only if separating strict constructor
  validation materially clarifies the boundary; keep it in the closure.
- `packaging/artifact-files.json`, new `core/test/raw-public.test.mjs`, new
  `packaging/test/raw-conversations.test.mjs` and its dedicated fixture.
- `core/test/raw-source-bounds.test.mjs` and `packaging/test/private-cards.test.mjs`
  only to replace obsolete file-absence expectations for genuinely promoted
  modules. Preserve internal-selector/default-off/authority negative tests.
- The same narrow obsolete archive-absence assertion/comment correction is
  allowed in `core/test/raw-boundaries.test.mjs`, `core/test/raw-capture.test.mjs`
  and `core/test/raw-deletion.test.mjs`. Keep the compatibility raw-capture
  wrapper absent if still unreachable.
- Minimal accurate API/installed-preview documentation in
  `docs/raw-local-journal.md`, `docs/install-artifact.md`, `CHANGELOG.md`.
- `docs/limitations.md` only to retain the independently reproduced pre-existing
  skipped-tail pause/resume limitation below. Its runtime repair is a subsequent
  packet, not permission to change Raw storage/control behavior here.

Primary owns this plan and the parent completion plan. Other runtime, manifests,
generated hooks, setup, model adapters, product code and tests are read-only.
Report a necessary additional path before editing it; primary decides scope.

Derive final public import/asset closure rather than copying the old internal
factory's closure audit. Keep internal compatibility factory uninstalled if the
public path does not reach it. Mechanically reconcile the manifest/archive and
independent actual module resolution/asset reads, with exact counts and hashes.
An installed child may not fall back to a source-worktree module or fixture engine.

## Observable acceptance

| ID | Pass condition |
| --- | --- |
| B1-01 | Malformed/extra/accessor/symbol Raw config and port failures refuse before store creation. Own getter counters stay zero. Explicit modes/cap/port combinations and method snapshot/receiver behavior match the contract; omission preserves the ordinary facade. |
| B1-02 | Public and internal construction share one composition without a circular import or copied engine. Existing internal P1–P3 tests continue to pass; public lineage/deletion cannot be disabled by an option or wire field. |
| B1-03 | Reopen off with no cap preserves durable usage/cap; read-only port works; absent decoder never leaks text. Off capture skips Raw but ordinary Memory interpretation remains independent. |
| B1-04 | Both clients' bounded synthetic parts go through the public captureRaw path. Fresh processes reconstruct long exact whitespace/Unicode through paged reads. First/middle/final overlap replay adds no model call or duplicate saved bytes; continuation has zero model calls. Raw saving and interpretation failure are reported separately. |
| B1-05 | Public paths preserve pause/project/session fences, forgotten spans, revision-bound deletion and stale-source invalidation across restart. Authorized Raw-only source can support an explicitly authored Card without fabricating a Memory. Missing privateCards/per-call authority refuses; no automatic Card. |
| B1-06 | Actual private npm archive installs offline in an initialized, explicitly prefixed synthetic project. Fresh child stages perform public capture/replay/read/Card/delete lifecycle from installed bytes only. Manifest/archive and independently traced import/asset closure agree; required files never skip. |
| B1-07 | Both Node22.16/24.15 pass affected gates, primary independent acceptance and separate fixed-commit dual review; all latest-head CI checks pass before ready/unmerged. Success/failure owned scratch is gone, foreign paths untouched, and actual exits recorded. |

## Verification and supervision

Start with focused new public/core and installed tests. For each changed entrypoint
trace dependent callers and record affected checks before final freeze. On both
supported runtimes run `test:core`, `test:mcp`, `test:artifact`, generic `npm test`,
`validate`, plus `demo:store`, `demo:capture`, `demo:private-cards`,
`demo:episodes`, `demo:session-context` and the existing native plugin validator.
Include unchanged client/setup generated parity checks. Core CI's other demos
remain latest-head remote gates. No TypeScript gate exists in this JS repository.

Inspect dependency directories for symlinks before any installation; reuse valid
locked tooling without deleting a shared install. For artifact gates read current
CONTRIBUTING and explicitly prepare the cache via the owned runner; public
registry metadata only, no provider request. Use a fresh bounded owned matrix
workspace, sanitize application environment, serial timing-sensitive groups and
record actual progress/exits plus cleanup. Do not infer health from PID alone.
The native plugin validator uses existing isolated pinned tooling. Do not run
all historical paid or optional native-Mem0 experiments for this constructor change.

Primary independently checks the complete actual diff and personally runs
constructor-before-store negative cases and real public/installed restart paths.
Freeze source hashes and reconcile changed-file inventories by two independent
routes. Commit only scoped files, reread current gates, rerun affected checks,
then dispatch separate non-author reviews against that exact commit/fixed base.
Retain initial failures and causal fixes rather than silently rerunning green.
No push before both reviews pass. Supervise every applicable CI job on the latest
remote head, verify mergeability and exact tree, then ready but do not merge.

Worker checkpoints: strict option/composition seam; public lifecycle and installed
closure; focused tests; frozen affected matrix. Report contradictions promptly or
after20minutes without a completed checkpoint. After two unsuccessful correction
rounds on one cause, primary re-scopes instead of repeating it. The existing
12–18hour continuous-work discussion checkpoint remains in force.

## Read-only feasibility checkpoint

The prospective GPT6.1Sol/high author inspected constructor/runtime/archive
callers on dependency3941e97 without edits, tests or API calls. It identifies
two additional obsolete absence assertions in raw-boundaries/raw-capture tests;
primary's separate full text search also identifies raw-deletion.test.mjs.
The allowed list above includes only those narrow assertion updates. Primary
inspected all three sites; their ordinary-facade negatives remain required.
This is feasibility evidence, not a test pass. Provision the future worktree's
locked adapter/validator tooling and artifact cache explicitly before gates.

## Implementation and primary acceptance record

Author assignment: `/root/raw_p3c_dedup61`, actual GPT6.1Sol/high, fixed
base3941e97. Primary inspected the independent preflight and owns final
acceptance, not the worker's runtime edits. Both review axes remain non-authors.

Primary byte-compared all three dependency lockfiles against the already
provisioned P3c tooling (exit0) and created ignored local dependency directories
with package-entry symlinks to those unchanged installs:2 OpenAI,14 MCP and3
validator entries. Whole-directory symlinks initially appeared as untracked
because node_modules/ ignores directories; only those three newly created links
were replaced, with the original installs preserved. No npm ci/removal touched
shared packages. Explicit public-registry metadata preparation through the owned
runner exits0; no application/provider environment or model calls are used.

Primary's independent constructor/lifecycle suite is frozen outside the repo at
`/tmp/cairn-raw-b1-evidence.B2X2u2/primary-public.test.mjs` plus its fresh-process
child. On the unchanged P4a dependency it passes2/6, actual exit1: the existing
default and malformed-option negatives pass, while the new public Raw option
is deliberately not yet accepted. This is a missing-feature baseline, not a
regression in P4a. Preserve primary-public-baseline22.log; later implementation
must pass the same contract tests, with fixture defects distinguished explicitly.

Early implementation checkpoint (not final source freeze): the unchanged primary
suite passes6/6 on Node22.16; enabling its actual private-archive/offline-install
case passes7/7, both actual exit0. Each installed lifecycle uses three distinct
fresh processes and only the installed public entrypoint: both clients' exact
long Unicode/whitespace, overlap replay, authorized Raw-only authored Card,
revision-bound deletion, retained confirmed body/unavailable source and restart
fences. All owned workspaces are removed. These are local scripted-model
lifecycle checks, not live-hook delivery or semantic accuracy.

An independent public-entry closure probe compares a literal import/asset walk
with actual Node24 module resolution and asset reads: both yield108 files, all
present in the manifest, zero missing entries and no compatibility raw-capture
wrapper. Probe exit0; it does not invoke the constructor or make network calls.
Retain primary-public-early22.log, primary-public-installed-early22.log and
primary-public-closure-early24.json in the bounded evidence directory. Repeat
the key installed paths and closure on final frozen/committed bytes; these early
results do not replace the affected matrix, independent review or latest-head CI.

### Next-packet blocker discovered independently

A read-only control-seam audit identified a previously untested pause/resume
case. Primary's separate six-case synthetic reproduction confirms it on both
the working public path and unchanged P4a internal path: both clients, with an
incomplete first part skipped for quota_reached, notice_required or raw_disabled,
pause and resume, then a fresh higher-ordinal message. All six refuse
raw_part_out_of_order (actual exit1 for each run). Existing reservation closure
selects only pending saved assemblies; these skipped assemblies are already
closed and retain an incomplete transport tail. This is not a B1 regression or
a semantic-model failure. The tests close/remove their owned stores on failure.

Preserve primary-barrier-recovery.test.mjs and the baseline22/p4a22 logs in the
same evidence directory. B1-05 verifies existing in-flight fences and deletion/
exclusion behavior, not universal pause/resume recovery. The full local installed
hook gate remains blocked until a subsequent bounded control-barrier correction
passes this unchanged oracle, preserves old part dispositions/accounting and
prevents backfill. Do not widen this constructor packet or report complete V1.

Primary also mechanically compared the extracted composition body to the fixed
P4a factory. After normalizing only the injected builder's name, the bodies are
byte-identical (actual exit0); the old factory now delegates. This corroborates
the direct diff inspection that B1 did not rewrite the capture/admission engine.
The author's first combined public/installed run passed17/18, actual exit1:
the added forgetting test expected the wrong existing finite error code.
Deletion remains source_unavailable; a retained but forgotten span is
source_excluded. Correct only those fixture expectations, retain the red log,
and rerun before freezing. No runtime correction was warranted by that failure.

### Frozen candidate verification

The corrected focused roster passes98/98 on Node22.16/24.15, both actual exit0:
16 new public cases, two new installed cases and80 preserved checks. Each
installed case independently traces108 public import/asset files, compares
126 archive paths and runs four fresh-process stages. The transient mistaken
replacement of the other source-error expectation was caught during primary
inspection and corrected before any rerun; it was not a separate failed run.

The17 author-owned files are frozen at digest
45195f96c4b97731a2af9aa86c9e57390520d3952d7139e7aa61853d3b77a79f.
Primary's independently derived19-path inventory (including two primary plans)
matches the author's complete list and all17 hashes; both comparison and
sha256sum -c exit0. The shared composition byte comparison above also exits0.

Primary reruns the unchanged independent seven-case real-archive/public suite
on both frozen runtimes:7/7 each, actual exit0 (Node22 3.695s; Node24 3.621s).
Both parent and fresh child workspaces clean up. The independent Node24 public
closure again yields108 matching literal/actual files, no manifest gaps and
no network calls, exit0. Logs: primary-public-frozen22.log,
primary-public-frozen24.log and primary-public-closure-frozen24.json. The
larger affected matrix, committed-source reruns, both reviews and remote CI
remain gates; these frozen results do not imply those later gates passed.

Affected entrypoint/caller coverage: public openMemoryCore's option validation
and capability selection are covered by the16 new public tests and primary
seven-case suite; existing core consumers and MCP hosts remain full-suite gates.
The internal Raw factory delegates without changing its selector flags, with
the preserved P1/P2/P3 rosters in the focused/full core checks. Artifact manifest
promotion changes exactly five old file-absence assertions while preserving
ordinary-facade and authority negatives; both new installed cases independently
verify the full runtime closure and actual bytes. No hook/setup runtime changed;
their generated parity checks remain required. Final file inventories are
independently reconciled for19 incremental and113 cumulative paths versus the
recorded main base, both actual exit0.

Primary independently derives the promoted runtime-manifest delta: seven added
modules, zero removed, totaling58,139 source bytes. package.json, build.mjs and
both adapter dependency locks remain byte-identical to the fixed base, exit0.
This establishes no new npm runtime dependency or parallel engine; source-byte
count is not a compressed package-size, memory-use or lightweight benchmark.

The frozen serial matrix completes26/26 commands across Node22.16/24.15,
all actual exits0, with outer controller exit0. Per runtime: core1,657/1,657,
MCP125/125, generic635/635; artifact96 pass plus one expected native-Windows
skip out of97. Validation, five demos, native validator and both generated
parity checks also exit0. No retries, signals or interruption occurred.
The primary independently parses the26 result records and controller report,
confirms both exact owned workspaces are absent, and finds no failed command
(exit0). Source hashes remain17/17 unchanged; both inventories agree on19
paths, and git diff --check exits0. Evidence is worker-matrix-report.json,
worker-matrix-results.jsonl and the supervised per-command logs in the bounded
evidence directory. Commit-bound primary reruns, dual review and CI follow;
this matrix does not itself declare complete installed Raw V1.
