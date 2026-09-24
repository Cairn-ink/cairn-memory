# Explicit MCP capture deadline and cold-state recovery acceptance

Fixed base: `d58935f77a6b54dab4f650b04826657a9fce5150`.
The plan-only branch was rebased from the original `580537f` candidate after
its independent review added a test-only ordered-retirement rollback assertion.
No MCP implementation preceded this corrected-base freeze.
Branch: `feat/mcp-capture-deadline`. Primary owns this preimplementation contract;
implementation owner GPT-6 Sol/high. Do not begin implementation until the
dependency's independent reviews and exact-head CI pass. If its head changes,
rebase this plan before implementation and record the actual fixed base.

## Decision and boundary

Expose the existing embedded deadline through trusted MCP host configuration:
optional programmatic `captureDeadlineMs` and CLI `--capture-deadline-ms`.
Require an explicitly enabled capture qualification mode (v1 or v2); reject a
deadline setting on a host without capture. Keep omission and every existing
default unchanged. No new model-controlled tool argument, tool, provider
setting, host/client timeout, retry, persistence schema or core algorithm.

The programmatic value is an own-property, snapshotted safe integer 1–120000.
Explicit undefined/null/booleans/strings/floats/nonfinite values are invalid.
CLI accepts only canonical positive ASCII decimal digits in that range;
leading zeros, signs, spaces, fractional/exponential forms and repeated flags
are invalid. Validate before opening a database or creating a model. Syntax-only
`--check-config` reports the configured numeric bound only when present, without
claiming runtime readiness or contacting a provider. Caller mutation after
construction cannot alter the setting.

Pass the validated value to the shared core; never create a second deadline
engine in the host. It applies to each capture independently, not to server
lifetime, manual remember, recall, inspection or explicit classification.
The client still needs enough time for startup, synchronous work and cleanup.
This is cooperative rather than a hard response-time SLA or a billing cap.

## Observable acceptance

- H1 — Strict trusted configuration: valid minimum/maximum and both capture
  qualification modes work; malformed/omitted/explicit-undefined/inherited
  options behave as specified. CLI duplicate/unknown flags still reject.
  Invalid config creates no database and performs no provider request.
  Check-config remains syntax-only, keyless and secret-safe; option snapshots
  cannot change through the original config object.
- H2 — Public compatibility: tool schemas and inventories are identical to
  the equivalent existing option combinations. The deadline adds no tool or
  argument. Capture-message attempts to override it or namespace authority
  fail. Omission preserves defaults and keyless manual flows. Compose with
  v2 staged capture, automatic rationale and existing classification recovery
  without enabling any of them implicitly.
- H3 — Actual transport: through actual SDK stdio, a capture that reaches a
  deliberately stalled model stage returns the core timeout envelope before
  the test client's generous deadline. Prove the model stage was entered.
  Before-admission expiry leaves no admitted memories or receipts. A second
  independent capture or manual operation can succeed on the same server;
  there is no automatic retry or extra model request.
- H4 — Honest partial state: through actual stdio, commit admission then stall
  initial classification until the invocation expires. Capture remains an
  admission success with failed classification; do not flatten it to a
  transport failure or assume timeout erased storage. Restart keylessly and
  inspect the exact batch with the existing opt-in initial-classification view:
  source receipts remain, initial failure remains, current filing is inspectable.
  Then explicitly classify inspected current unfiled refs with scripted/fake
  responses: exactly classification work, no capture/extraction replay, no
  receipt changes. The original initial status is not rewritten as recovery
  history. Repeated/stale/corrected/forgotten refs preserve existing guards.
- H5 — Installed path: build and inspect the local archive, offline-install
  into a fresh temporary project, and exercise the actual installed CLI flag
  and core through stdio with fake provider HTTP. Test at least pre-admission
  timeout and post-admission cold inspection/recovery, proving which phases
  actually ran. Compare installed runtime/host hashes. No local source-import
  substitute for this acceptance. Retain any setup or timing failures.
- H6 — Documentation and claims: technical help/setup docs explain explicit
  configuration, per-call scope, partial success, inspection before recovery,
  no automatic retry, no guaranteed hard return time and no API spend cap.
  Existing longer-client-timeout advice is not silently invalidated by the
  opt-in. Native Hermes is still a separate next packet; do not claim that it
  forwards this flag or exposes recovery tools yet. No semantic score or whole
  S1 pass follows from these mechanical checks.

## Allowed work and verification

Allowlist: `adapters/mcp/cli.mjs`, `adapters/mcp/server.mjs`, directly affected
MCP configuration tests and focused new deadline tests/fixtures under
`adapters/mcp/test/`; focused installed tests under `packaging/test/`;
technical `docs/standalone-mcp.md`, `docs/capture.md`, `docs/limitations.md`,
`docs/protocol.md`, `CHANGELOG.md`, and this plan. No core edits are anticipated;
if required, stop implementation and explain the failing evidence to primary
for rescoping before touching them. Do not change artifact/dependency manifests,
model prompts, guards, budget policy/ledger, old cases, benchmark configs or
Hermes integration in this packet. No real credentials or provider calls.

Run BOTH Node 22.16.0 and 24.15.0: focused configuration/transport/installed
checks, full MCP and artifact suites (explicit cache preparation), generic and
JSON/strict-plugin validation, full core and capture/admission/MOC/store demos.
Run offline live-evidence and request-guard regressions for actual adapter
cancellation integration. All tests use fresh synthetic databases, explicitly
fake HTTP/scripted models and generous external test deadlines. Tests must
assert intended model/write stages were reached, not pass because setup timed
out. Core real-clock and precommit coverage remains in the dependency.

Primary inspects the full fixed-base diff and reruns key CLI/SDK/installed/cold
recovery paths. Freeze a candidate, obtain independent Standards and Spec
reviews on that same full diff, correct and repeat affected gates and both
reviews, then open a dependent draft PR against `feat/capture-invocation-deadline`.
Require exact-head CI and current mergeability before ready. Do not merge,
publish or deploy. Record SHA, command results, failures, known limitations and
next action in the PR; do not report a started job as a passed gate.

## Next convergence checkpoint

After this packet: native Hermes opt-in forwarding and the same installed
inspection/recovery flow, then a newly frozen development smoke within the
existing cumulative budget and shared ledger. Use existing inspection and
explicit classification before considering a new recovery-history schema or
background queue. Fresh scored comparison remains separate; keep old failures
and fixed-N denominators intact. No user decision is needed for these scoped
offline steps.
