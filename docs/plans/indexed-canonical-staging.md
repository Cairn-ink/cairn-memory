# Opt-in canonical source staging: core boundary

Status: contract fixed before implementation; not shipped or quality-validated.
Base: `1a7a4826ea310a07b281a7c2133cd51826db1dc9`.
Branch: `feat/indexed-canonical-staging`; dependent target:
`docs/source-competition-results`.

## Decision and limits

Retain the canonical submitted source independently of extractor selection in
an explicit embedded `captureSourcePolicy: 'indexed-staged-v1'` mode. Reuse
indexed extraction and the staged evidence lifecycle; do not admit raw messages
as memories, add another model pass, widen receipts, or change default capture.
This is bounded 24-hour recovery/inspection, not a permanent conversation archive,
automatic recall improvement, semantic verification or competitive score.
Canonical means existing normalized, redacted input, not original transcript bytes.

The baseline reproduction has two passing controls: existing indexed capture
with an empty extraction has no staged source; existing staged-v1 retains only
the first at-most-800 units/message. The desired full-source cold inspection
fails today because the new policy is unsupported. Keep that RED observation;
new tests must use fresh synthetic inputs, not retune closed evaluation cases.

## Acceptance

- S1 Explicit own-data constructor option enables the new mode. Defaults,
  indexed-evidence-v1, indexed-windows-v1 and staged-v1 contracts remain intact.
  Reject accessors/unsupported values, qualification, rationale, captureEvidence,
  episodes and causal capture combinations before writes/provider calls. The
  new mode reports qualification not requested, never verified.
- S2 After existing input validation, canonical-window construction and context
  fit checks, admission and source staging commit atomically before extraction.
  Retain every canonical submitted message with ID, role and complete content
  within existing 24-message, 4,000-unit/message, 20,000-unit/batch limits. Empty
  extraction, malformed output and provider failure after claim retain the
  source for exact cold inspection. Pre-claim invalid/context/capacity rejection
  need not retain data and must not call generation.
- S3 Give canonical payloads an explicit format/version distinct from the old
  800-unit prefix format, with policy-separated event digest and strict storage
  validation. Bump SQLite schema to 19 so an older opener refuses it; upgrade
  18 transactionally without altering old payloads, receipts, identities or
  clocks. Preserve all supported older migration paths and foreign keys. Do
  not reinterpret an old payload or silently migrate a replay to new retention.
  Already-open older processes must be stopped before upgrade, as elsewhere.
- S4 Retain existing 24-hour monotonic expiry, 128-KiB/event, 64 active payloads
  and 1-MiB/exact-namespace aggregate quota. Reject overflow rather than silently
  truncating or evicting unrelated evidence. Duplicate replay makes no new
  model call and never renews expiry; changed event/policy digest conflicts.
- S5 Exact owner/scope/project isolation applies to inspection/discard. Discard,
  expiry, correction and forgetting leave the existing content-free replay
  fences; no replay can resurrect purged source. During a pending extraction,
  discard/forget must prevent later admission. Cold reads require no model/key.
  Staged text remains untrusted data, not execution permission or verified fact.
  It does not enter normal get/list/search/MOC/recall/sourceSnapshot. Logical
  purge is not guaranteed physical erasure from SQLite/backups/journals.
- S6 Exercise fresh late details beyond 1,000 units, multi-message corrections,
  assistant attribution, Unicode, redaction, all three empty/failure outcomes,
  policy replay conflicts, exact-namespace boundaries, expiry/rollback clock,
  capacity, pending discard, and old/new schema compatibility. Include retained
  baseline behavior, deterministic failure injection and actual cold reopen.
  Test fixtures use the owned workspace runner and clean success/failure scratch.
- S7 Run generic tests, JSON/maintainer validation, full core tests, store and
  capture demos on exact Node22.16/24.15; run affected migration/episode/indexed
  tests on both. Primary inspects combined diff and personally runs integration
  gates. Two independent nonauthor Standards/Spec reviews inspect one fixed
  commit. Latest-head CI and mergeability are required for ready delivery.

## Scope and follow-through

This PR is core implementation/tests, schema migration and corresponding local
store/protocol/privacy documentation plus changelog. It does not expose a new
MCP/CLI flag, change Hermes, change a hosted service or process user databases.
Host exposure follows separately only after this boundary passes: explicit local
opt-in, exact management/cold-read tests and installed artifact validation.
Bounded source discovery/recall is another acceptance step; known event ID
inspection alone is not useful automatic long-term memory.

No default transcript retention, paid run, old evaluation rerun, merge, release,
deployment, threshold change or historical cleanup. API accounting remains the
existing cumulative US$400 ceiling with US$30 protected; this offline work has
no provider cost. Scope does not grant automatic access to real conversations.

## Ownership and evidence

Primary owns architecture, acceptance and integration. One GPT-6.1 Sol/high
worker owns implementation; two independent nonauthors review the fixed diff.
Record exact exits, changed file inventory by two independent routes, entrypoint
and caller impact, corrections and remaining limitations here or in the PR.

## Author handoff: implementation and bounded verification

Author: GPT-6.1 Sol/high. No provider/key/operational data, installs, commits or
host flags were used. S1–S6 have focused mechanical coverage; S7 local integrated
gates are now complete as recorded below. Fixed-commit independent reviews and
latest-head CI remain primary-owned/pending.
This is retention/lifecycle evidence, not source discovery or semantic quality.

The six production files are `core/contract.mjs`, `core/capture-input.mjs`,
`core/capture.mjs`, `core/database.mjs`, `core/staged-evidence-schema.mjs` and
`core/staged-evidence-storage.mjs`. Constructor validation snapshots the explicit
own policy before database creation; inherited policy is ignored without getters.
`captureMessages` reuses catalog/input fit, admission transactions, leases and
staging lifecycle. `planCaptureBatches` automatically uses the same unchanged
indexed prompt/counter seam. Indexed evidence, qualification, ordered capture and
episode callers retain their prior contracts; no adapter/host activation is added.

Schema19 adds `payload_format` with the legacy prefix default. Canonical views
contain format, complete canonical messages and an empty truncation list with
4,000-unit metadata; prefix payload serialization is unchanged. Inspection validates
payload format/shape/bytes and fails closed on corrupt mismatches. Canonical storage
reads validated own-data indices directly rather than invoking caller array methods,
species constructors or iterators. Legacy migration functions/seeds/frozen JSON
fixtures are unchanged. Eighteen existing test files have only41 latest-version
assertions changed18→19 and one refusal-title update. The new actual-v18 opener
fixture is relocated from the fixed base, locally verified against independently
pinned exact source SHA256 `75898ac6295be56bf1f984774d1819a6f19d374306044894c03b077177ca0e34`
(16,870 bytes), without requiring Git ancestry at test runtime/shallow CI.

The two new test files cover full late source and assistant/correction attribution,
empty/malformed/provider failure with keyless cold reopen, nonempty indexed
prompt/receipt equivalence and no staged promotion, normalization/redaction/Unicode
and mutation detachment, unchanged planner/output limits, pre-claim refusal,
atomic staging rollback, strict storage/format corruption, policy replay conflict,
duplicate expiry/rollback clock, all three quotas, namespace isolation, pending
discard/forget/correction and v18 preservation/rollback/actual old-opener refusal.
Their scripted token counter tests mechanics; the primary's separate integration
controls use an actual local tokenizer. Neither is a live semantic evaluation.

Author focused test commands use exact Node22.16.0 or24.15.0, keyless `env -i`,
`PATH=/usr/bin:/bin`, `TMPDIR=/tmp`, `NODE_DISABLE_COMPILE_CACHE=1` and canonical
`node tools/testing/run.mjs --test-concurrency=1` with flags before file paths.

| Verification | Actual exit | Observation |
| --- | --- | --- |
| Initial Node22 new zero-item test, before implementation | 1 | Unsupported constructor policy (`invalid_input`): meaningful RED. |
| Initial four focused tests after implementation, Node22 | 0 | 4/4, no skips. |
| Expanded first Node22 iteration | 1 | 11/14; three fixture expectations corrected: existing redaction targets secrets rather than email, context refusal is `context_budget_exceeded`, oversized storage text is `invalid_text`. |
| First new migration fixture iteration | 1 | Invalid synthetic digest violated existing64-hex constraint; corrected seed only. |
| Affected six-file Node22 suite | 0 | 64/64, no skips; existing prefix/indexed/episode/confirmation controls included. |
| Affected seven-file Node24 suite | 0 | 67/67, no skips; adds planner controls. Historical pre-final-array-hardening observation. |
| Final two new files, Node22 and Node24 separately | 0 / 0 | 20/20 each, no skips, final production/test bytes. |
| Draft full core, Node22 | 143 | Intentionally stopped the owned runner after40 passes to defer expensive full gates to primary; incomplete, not a pass. |

Final focused command on each runtime:
`node tools/testing/run.mjs --test-concurrency=1 core/test/indexed-canonical-staging.test.mjs core/test/indexed-canonical-staging-migration.test.mjs`.
An owned parent workspace independently checked zero residual entries after each
final invocation and removal of the parent itself. Earlier failing fixtures also
used the canonical runner and immediately registered owned-resource teardown;
no cleanup error was reported. No historical scratch was removed. The primary's
first cold fixture failure was a model-less map token-counter requirement; its
corrected three actual-tokenizer cold cases passed Node24 (3/3, exit0), separately
from the author's final20 tests. At the initial author handoff, full
generic/JSON/maintainer/core/demo acceptance had not yet been claimed; the completed
primary verification is recorded below.

Scope includes the approved short `docs/limitations.md` paragraph, without changing
closed results. Mechanical delivery discovery by diff+untracked files and separately
porcelain status agrees on33 authored paths; three pre-existing validated read-only
dependency links are setup only and excluded. `git diff --check` passed (exit0).
Primary owns final commit/reviews/CI; no author commit/push.

## Primary local verification

Primary completed all14 gates on the unchanged33-file author freeze, with actual
exit0 for every command. Each exact runtime, Node22.16.0 and24.15.0, ran:

| Gate / command | Node22 exit | Node24 exit | Result |
| --- | --- | --- | --- |
| `node tools/testing/run.mjs --test-concurrency=2` plus91 enumerated core test files | 0 | 0 | 1,233/1,233 each; no failures/skips. |
| `node integrations/client/testing/run.mjs --test-concurrency=1` plus21 enumerated generic test files | 0 | 0 | 581/581 each; no failures/skips. |
| `npm run validate` | 0 | 0 | JSON validation passed. |
| `npm run validate --prefix tools/plugin-validation` | 0 | 0 | Maintainer validation passed. |
| `npm run demo:store` | 0 | 0 | Synthetic store demo passed. |
| `npm run demo:capture` | 0 | 0 | Scripted capture demo passed. |
| `npm run demo:episodes` | 0 | 0 | Scripted episode demo passed. |

The primary root gate log retains exact executable paths, complete argv/file lists,
exits and before/after hashes. Core gate concurrency was2, not the author's focused1;
the generic gate used1. Separate primary actual-local-tokenizer integration tests
passed3/3 on both exact runtimes (exit0, cleanup confirmed), exercising empty,
malformed and thrown extraction followed by full canonical keyless cold inspection,
namespace isolation, unchanged duplicate expiry and discard/replay fencing.

Primary inspected all six production files and the combined docs/tests, confirmed
the artifact inventory and ran `git diff --check` (exit0). All33 authored hashes
matched before and after the14 gates. Demo-created synthetic artifacts are
intentionally retained example outputs, not leaked test-workspace residue; ordinary
owned test scratch was cleaned. This doc-only verification append follows that
source/test freeze. Fixed-commit nonauthor Standards/Spec reviews, latest-head CI
and mergeability remain pending before ready delivery. No paid run, host activation,
default retention change or semantic-quality claim follows from these local gates.
