# OpenAI tokenizer performance gate

Status: isolated-test-runner change; the adapter's counter and acceptance
threshold remain unchanged.

## Observed baseline

PR #208 CI run `36042861159`, attempt 1, failed OpenAI Node 22 in job
`107779060947`: the existing 40,000-space counter child hit its 5-second guard
at 5,048 ms. The job reported 205/206 tests passing; Node 24 passed. The CI
resource cause is unknown. On local Node 22, the same synthetic count took about
115 ms for startup plus 89 ms at 10,000 spaces, 278 ms at 20,000, and 1,108 ms
at 40,000; counts were 79, 157 and 313. These observations do not establish a
CI load cause or a runtime performance fix.

## Acceptance contract

- TP1: Move only the existing counter performance test to
  `tokenizer-performance.perf.mjs`. Preserve the 40,000-space input, child
  process, 5,000 ms timeout and successful safe-integer count assertion. Add a
  comment explaining that a separate test phase isolates this measurement from
  parallel test-file loading; do not claim that contention caused the CI miss.
- TP2: The OpenAI package test command first runs every ordinary
  `test/*.test.mjs` file, then runs the performance test alone. Shell `&&` must
  stop on ordinary-test failure and propagate failure from either phase. No
  skipped test, opt-in, timeout increase, removed concurrency check, dependency
  change or adapter runtime change is allowed.
- TP3: On Node 22.16 and 24.15, `npm test --prefix adapters/openai` passes all
  205 ordinary tests and the one isolated performance test (206 total), with
  the original counter gate intact.
- TP4: Root generic `npm test` and `npm run validate` pass; install the pinned
  plugin-validation dependencies and run its validator per `CONTRIBUTING.md`.
- TP5: Record the prior CI failure as historical and unattributed. State that
  isolation protects the acceptance measurement from test-file load; it does
  not repair the tokenizer's repetitive-input cost, establish the CI cause,
  improve semantic quality or justify a product-promotion claim.

Allowed implementation files: `adapters/openai/package.json`, the existing
performance test (renamed within `adapters/openai/test/`), this plan, and
`docs/limitations.md` for a narrow CI evidence note. No other files or external
services are in scope.

## Verification record (local, 2026-09-25)

- On Node 22.16.0 and 24.15.0, `npm test --prefix adapters/openai` passed 205
  ordinary tests and then the isolated performance test (1/1): 206 total, zero
  skipped. The original 40,000-space fixture and 5-second guard remain intact.
- Root `npm test` passed 117/117 on both Node versions. Root `npm run validate`
  validated all ten JSON files and consistent version `0.1.0` on both versions.
- Installed the locked plugin-validation package with
  `npm ci --prefix tools/plugin-validation` (3 packages added, audit reported
  zero vulnerabilities); `npm run validate --prefix tools/plugin-validation`
  passed on Node 22.16.0 and 24.15.0.
- A read-only child-process probe substituted exit codes into the package
  command in memory: a first-phase failure exited 7 without running phase two;
  a second-phase failure propagated exit 9. The committed script uses the same
  `&&` chain and both actual test phases passed.
- `git diff --check` passed. No provider, CI rerun or production operation was
  performed. The prior CI cause remains unknown; this change makes no runtime
  counter or product-quality claim.
