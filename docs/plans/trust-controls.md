# Client trust-control repairs

Status: implementation candidate. Base: `5ce6d58d2c008bf2f2271bc57925a571bc6db1ee`.

## Acceptance

1. Recall and capture redact supported credential fixtures before transmission.
   Inspect received local HTTP bodies. Recall respects the 4,000-character query
   limit (including the hosted UTF-16 budget), does not split a secret before
   redaction or a Unicode code point at truncation, and skips empty queries.
2. Pause excludes paused conversation text from future automatic capture across
   resume/restart and delayed workers. Specify the conservative boundary for
   unknown sessions, incomplete lines, and requests already in flight. Do not
   promise to retract already transmitted requests. Control state contains no
   conversation text. Preserve bounded/fail-open host operation.
3. First-use identity initialization is atomic across processes: identical cwd
   yields a stable project id, restart retains it, distinct cwd stays distinct.
   Persisted key is never sent and stays separate from telemetry id. Failure to
   persist a stable key must not produce transient scopes.
4. Capture locking cannot steal a live worker's lock solely because a multi-batch
   request takes over 60 seconds; retries and cursor updates stay idempotent.
   Exercise concurrent, partial-failure, paused, and restarted cases locally.
5. Regression tests reproduce the three original defects on the base revision
   and pass on the candidate. Existing tests and JSON/version validation pass;
   run the isolated Claude validator on supported Node and CI Node 20/22.
6. Documentation describes exclusions accurately (ordinary text can contain
   pasted files/paths), recall processing, pause boundaries, and residual risks.
   Add a user-visible changelog entry. No backend/protocol expansion, runtime
   dependency, release/tag, production call, or deployment in this change.

## Verification record

- Baseline: existing 12 tests and JSON/version validation pass on Node 22.16.0.
- New identity tests against the original implementation: 4 failures; 32
  simultaneous calls produced 32 project ids, and 16 separate processes produced
  3 project ids for one fresh directory. Telemetry initialization also raced;
  corrupt state was silently replaced or accepted.
- Recall HTTP regressions against the original hook: 3 failures (raw credential,
  unbounded query, whitespace request); the existing fail-open behavior passed.
- The pause regression failed against the original hook: the local server
  received a second capture after resume where only the pre-pause request was
  permitted. The second request contained paused history.
- Candidate on Node 22.16.0: `npm test` passes 31/31 tests; `npm run validate`
  passes JSON and version consistency; `npm run validate --prefix
  tools/plugin-validation` passes marketplace and strict plugin validation.
  `git diff --check` passes. The repository has no TypeScript/typecheck gate.
- Local HTTP fixtures verify paused-history exclusion, in-flight recall
  suppression, immutable retry batches after transcript growth, and concurrent
  capture. Lock fixtures verify that an hour-old live owner remains protected
  and a dead owner can be recovered. No production endpoint was called.
- Independent Spec review found that malformed detached handoffs could adopt
  the current generation. A regression reproduced one unexpected HTTP request;
  detached capture now requires its launch generation and rejects missing or
  non-string values, while direct capture remains available.
- Intentional limits: the first hook after resume skips through current EOF;
  already initiated requests cannot be recalled. State requires a local
  hard-link-capable filesystem in one PID namespace; interrupted dead-lock
  recovery may require the documented manual recovery. Redaction is best-effort.
- Independent Standards/Spec review and Node 20/22 CI results are recorded in
  the delivery PR, against its exact candidate commit.
