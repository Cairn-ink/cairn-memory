# Native Hermes capture deadline and explicit classification recovery

Fixed base: `2f343e33ab37117d3d21dc055be2465508161e88` (MCP deadline).
Freeze this contract before implementation. Do not start implementation before
dependency reviews and exact-head CI pass. If the dependency changes, rebase
this plan-only branch and record its actual base before implementation.
Primary owns the contract; implementation uses
GPT-6 Sol/high because configuration, credentials and cross-process state are
in scope. Branch: `feat/hermes-capture-recovery`.

## Decision

Expose the existing installed MCP/core behavior in the native Hermes provider,
without another memory engine or timeout/recovery algorithm. Add two optional,
trusted profile settings. Defaults, passive hooks and ordinary tools stay as-is.

- `capture_deadline_ms`: canonical positive ASCII decimal **string** 1–110000,
  requiring `capture_qualification: source-bound-v2`. The pinned native setup
  wizard produces strings; both persisted and wizard configuration use this
  one representation. Reject JSON numbers, booleans, null, empty, whitespace,
  leading zero, signs, fractions, exponent notation, non-ASCII digits and
  out-of-range values. The 110000 maximum leaves a nominal 10-second margin
  under the existing capture SDK 120-second envelope, not a return-time SLA.
  Use `when` in the wizard to offer it only with v2 capture; no fresh-setup default.
- `classification_recovery: guarded-v1`: independent explicit opt-in adding
  `cairn_inspect_capture_admission` and `cairn_classify_unfiled_memories`, with
  schemas from installed MCP. This enables a read tool AND an explicit
  model-assisted write tool, not an automatic recovery queue.

Forward only fixed CLI flags/validated settings to installed MCP. No new
model-facing authority fields. Dedicated CAIRN_MEMORY_OPENAI_API_KEY may reach
explicit classification as well as existing capture/recall; inspection,
discovery and manual CRUD stay keyless. Never inherit a generic provider key,
NODE_OPTIONS, arbitrary environment or user-controlled model endpoint.

New explicit classification uses the existing extended transport envelopes
(SDK/helper/provider 120/125/135 seconds) so a core model timeout at 30 seconds
is not raced by the ordinary SDK 30-second deadline. Other operations retain
their envelopes, including ordinary recall. Capture alone receives the core
invocation bound. Outer transport limits remain independent, cooperative core
work is not preemptive, and already committed admission is never rolled back
merely because a later response fails.

## Observable acceptance

- N1 Configuration and setup: real pinned wizard collects optional strings,
  omits fresh blanks, preserves existing values on blank reconfiguration and
  stores no key. Conditional deadline prompt works. Strict rejection occurs
  before saving Cairn's `cairn.json` or accessing profile memory; prior valid
  Cairn configuration remains intact. The pinned host writes its activation
  `config.yaml` before calling provider validation and can write separately
  collected secrets afterward; do not claim whole-wizard atomicity or modify
  upstream Hermes. Document this boundary and retain a full `cmd_setup` test
  with synthetic paths/secrets, not only the field collector.
  Removing capture requires removing its dependent deadline;
  recovery can remain independently enabled. Restart is required for changes.
- N2 Discovery and authority: exact inventories 5 default / 6 capture / 7
  recovery / 8 both; deadline adds no tool. Schemas match installed MCP and are
  deep-copied. Discovery is keyless and uses only its disposable DB. Actual
  MemoryManager registration and AIAgent routing expose only opted-in tools.
  Tool arguments cannot override deadline, identity, profile, executable or
  recovery authority. Profile/context/symlink/revision guards remain intact.
- N3 Transport and credentials: observe fixed forwarded flags and operation
  envelopes; test invalid direct bridge deadline/recovery values. Observe a
  synthetic dedicated-key canary for capture/recall/classification and remove
  it before any non-fake launch. New inspection/list/manual tools receive no
  key. Generic credentials and NODE_OPTIONS are absent. Shutdown still reaps
  active helper/SDK children; session config binding remains enforced.
- N4 Actual installed lifecycle: on both supported Node runtimes use real
  pinned Hermes MemoryManager, SDK subprocess and hash-checked installed Cairn
  archive, with explicitly fake provider HTTP and synthetic profiles. Enter
  extraction then exceed a short configured bound: return core timeout with
  no new admission/receipts. In a separate batch admit then stall classifier:
  truthful admission success/classification failure, retained source receipts.
  Prove phases were entered; retain failures rather than simply relaxing time.
- N5 Cold inspection and explicit recovery: terminate the first manager and
  load a new keyless manager/session. Inspect exact batch and current unfiled
  references plus initial failed status; no source leakage or provider call.
  Then explicit classify from a scripted AIAgent tool dispatch files those
  fresh refs with classification only: no extraction/admission replay, same
  receipts/content, unchanged original raw initial journal. Public initial
  view becomes unknown after revision change, as already specified. Repeated
  stale refs reject without extra model work. Late fake output cannot write;
  prove actual completion or actual process termination, not a sleep alone.
- N6 Honesty and compatibility: existing four-file native host suite remains
  green. Technical setup explains optional string/range, removal/restart,
  paid explicit classification, uncertain-response inspection, no auto retry,
  no spend cap, no hard latency promise and no semantic-quality/S1-complete
  claim. Keep historical evidence dated; don't rewrite earlier paid results.

### Preimplementation wizard clarification

Source inspection of pinned Hermes found `cmd_setup` seeds its field collector
from `config.yaml` rather than the provider's separately persisted `cairn.json`.
Earlier direct field-collector tests cannot establish actual reconfiguration
retention. Have `get_config_schema` offer defaults only from a valid existing
configuration in the active profile (paths and recognized non-secret settings).
The real `_prompt` returns its default on blank input. Fresh or invalid prior
configuration supplies no optional defaults; never read memory or credentials
for schema creation. Keep `save_config` strict replacement, not an implicit
merge that would mask omitted/removed settings. Test full native setup with no
preseeded `memory.cairn`, actual blank/default prompt behavior, conditional field
visibility, valid retention and invalid-value preservation of `cairn.json`.
This adjustment is frozen before implementation; all actual profiles are out of
scope and tests use only temporary homes.

## Scope and verification

Allow `integrations/hermes/cairn/__init__.py`, `bridge.py`, README and focused
tests under `integrations/hermes/test/`; technical updates to
`docs/hermes-memory-provider.md`, `docs/hermes-agent-loop.md`,
`docs/standalone-mcp.md`, `docs/capture.md`, `docs/limitations.md`,
`docs/protocol.md`, CHANGELOG, ROADMAP and this plan. ROADMAP is limited to
the native offline gate/status update required by CONTRIBUTING; preserve
historical evaluation and pending merge/semantic boundaries. No core/MCP runtime, prompts,
manifest/dependency changes, Hermes upstream edits, real profile/key/ledger,
benchmark cases, background queue, package release or deployment.

Use pinned Hermes c8aa5608c24e3636e77c267650c0f1f52e44adb0 (0.21.1), host MCP
2.0.0 and canonical scripts/run_tests.sh. Read the runner before execution;
set retries to zero so failures cannot disappear behind automatic reruns.
Build/inspect/offline-install fresh Cairn archive and compare relevant runtime
hashes. Execute existing four host files plus new recovery acceptance on BOTH
Node 22.16.0 and 24.15.0; use no real network/model key. Run generic tests,
JSON/strict-plugin validation, full MCP and artifact suites on both. Core is
unchanged; exercise capture/admission/MOC/store demos as integration regressions.
Primary independently inspects the whole diff and runs installed pinned-host
entrypoints on final combined content. Record commands, counts, archive hashes,
tested candidate, retained failures and limitations.

Freeze candidate; independently review Standards and Spec at the same fixed
base/head using Sol6/high; correct findings with affected rechecks and both
reviews. Open a dependent draft PR against feat/mcp-capture-deadline, monitor
exact-head CI and current mergeability before ready; do not merge.

## Implementation and verification record

GPT-6 Sol/high implemented the bounded native provider and bridge changes in
the isolated `feat/hermes-capture-recovery` worktree from the fixed base above.
The only production code changes are `integrations/hermes/cairn/__init__.py`
and `bridge.py`; no core, MCP, prompt, manifest or Hermes upstream runtime was
changed. Full pinned-host call-site tracing covered native setup, schema
discovery, MemoryManager registration and dispatch, AIAgent tool routing,
SDK/helper envelopes, credential forwarding and session/profile fencing.

The independently built private archive SHA-256 is
`f77d837dc8940e94535d227e27e272863ffc47c5af0397d21a7e6e4398a5b8ad`.
It was offline installed into a fresh temporary project; all 72 listed
packaged source-file hashes matched. On **each** of Node 22.16.0 and 24.15.0:

| Gate | Result |
| --- | --- |
| Pinned Hermes canonical `scripts/run_tests.sh` on all five native test files, `--file-retries 0` | 22 passed, 0 failed |
| Generic `npm test`; `npm run validate`; strict plugin validation | 112 passed; JSON and strict plugin validation passed |
| Full `npm run test:mcp`; full `npm run test:artifact` | 91 passed; 70 passed |
| `demo:store`, `demo:admission`, `demo:moc`, `demo:capture` | All passed with synthetic temporary databases |

Hermes's source archive lacks `.git`, so its optional bytecode-precompile
step prints a warning; the canonical test runner still executes and exits
successfully. The deadline test observed the intended fake model stages and
actual late completion before checking that no late writes appeared. Cold
inspection made no provider request. Synthetic credentials were removed before
non-fake launches. No real key, paid request, production profile, ledger,
release, push or merge was used by the implementation worker. These results
are mechanical integration evidence, not semantic quality or a hard latency
guarantee. Primary final-candidate acceptance and both independent fixed-diff
reviews remain required before delivery.

## Next checkpoint

### First independent review correction

Candidate `d5ffc8f78bebbe70538f591ae70b5dd3eb54678b` passed primary full
pinned-host acceptance (22/22 on both runtimes), generic and validation gates.
Independent Spec (GPT-6 Sol/high) passed N1–N6 with no findings. Independent
Standards (GPT-6 Sol/high) required synchronizing the new native offline gate
in ROADMAP under CONTRIBUTING, and suggested a clearer name for the timeout
selector. Before correction implementation, primary added that narrow roadmap
scope above and accepted renaming local `extended` variables to
`uses_extended_timeout` in provider/bridge. No behavior, bound or semantic gate
changes. Rerun native host/generic/validation checks on both runtimes, freeze a
new candidate, then review both axes again against the original fixed base.

Correction changed only ROADMAP's native offline gate/status and the local
timeout-selector name in the provider and bridge. The earlier failed semantic
evaluation, unmerged-candidate status and paid-model gate remain explicit;
runtime conditions and timeout constants are unchanged. Against the same
offline-installed, hash-checked `f77d837d...` archive, the canonical pinned
Hermes five-file runner with `--file-retries 0` passed **22/22** on Node 22.16.0
and **22/22** on Node 24.15.0. `npm test` passed **112/112** on each; JSON and
strict plugin validation passed on each. The unchanged MCP, artifact and
synthetic demo gates retain their prior both-runtime results above. The
runner's optional missing-`.git` precompile notice remains nonblocking; no
new failed test or provider request was observed. Independent fixed-diff
reviews and primary final-candidate acceptance are still pending for the
corrected commit.

This closes the native offline adoption gap, not all reliability work. Next
freeze a small fresh real-model development smoke and reconcile existing shared
budget before execution; use inspected actual installed paths and no old30
reruns. Candidate retrieval/answer diagnostics and matched competitor scoring
remain separately gated. No new user decision is required for this offline work.
