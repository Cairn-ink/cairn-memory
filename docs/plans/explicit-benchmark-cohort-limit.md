# Explicit bounded public-benchmark cohort loading

Base: `4bc8892f3699e24191331f75c64483f42f45fde9`. This dependent change supports
the user's approved larger evaluation, not any increase in monetary authority.

## Observed RED

The primary prepared 36 new LongMemEval cases without model calls. On the fixed
base, calling `loadPreparedPilot({directory: preparedDirectory})` rejected
`invalid_manifest` at `evaluation/live/pilot.mjs:184`. The validator contains
`manifest.selection.count > 7`. No case execution, ledger mutation or provider
request occurred. Prepared files are retained unchanged. They must not become
public fixtures or enter model context during implementation/review.

## Acceptance

- **C1 — Explicit limit, unchanged default.** Permit an optional `maxCases`
  parameter on `loadPreparedPilot`. Default remains 7. Explicit values must be
  positive safe integers at most 500; null, undefined when explicitly supplied,
  fractions, strings, accessors if unsupported by existing snapshot conventions,
  and unknown fields reject. Manifest count must not exceed that limit. Preserve
  every existing source/digest/order/identity/content/permission validation.
- **C2 — CLI opt-in.** Add `--max-prepared-cases <n>` to the public-pilot CLI,
  default 7, parsed before provider-key access or case claims. Report the
  effective bound in prospective operator metadata/dry-run output. Loading more
  cases grants no spending authority; existing cumulative and batch preflight
  limits and one-shot disjoint schedules remain authoritative. No implicit
  budget extension, run resume, retry, replacement or failed-case removal.
- **C3 — Existing resource limits.** Preserve current manifest/artifact byte
  ceilings and all token/timeout/concurrency limits. A larger valid case count
  with oversized artifacts still fails. The count ceiling alone does not claim
  that the entire 500-case corpus fits a single existing artifact envelope.
- **C4 — Observable offline tests.** Use independently generated synthetic
  preparation with at least eight distinct cases: default rejects it; explicit
  sufficient bound loads it with exact IDs/digests and private evaluator
  separation; too-small/invalid bounds reject. Tampered digest and malformed
  identities still reject under the opt-in. Exercise the actual CLI with fake
  transport/keyless dry-run, asserting zero provider/key/claim effects on
  preflight denial. Boundary-test 1, 7, 8, 36 and 500 bounds without downloading
  or exposing a real corpus.
- **C5 — Delivery.** Document the pilot-only default and explicit expansion,
  record test commands, and freeze a scoped commit. Generic/JSON/plugin,
  LongMemEval and live-offline checks on Node 22.16 and 24. Primary will inspect
  the final diff, rerun key checks and obtain independent non-author Standards
  and Spec review before delivery or paid use. No merge/release/deploy.

Allowed files: loader, public-pilot CLI, focused synthetic tests and related
evaluation documentation. Do not touch core/model prompts, source corpus,
private prepared artifacts, credentials or the actual campaign ledger.

Primary owns this contract and integration with the separately reviewed budget
extension (which also touches the CLI). Serialize CLI integration; no shared
worktree writes. Implementation delegation remains required.

## Implemented candidate

- `loadPreparedPilot` retains a seven-case default and accepts only an own,
  data-valued positive safe-integer `maxCases` no greater than 500. The value
  changes only the manifest-count comparison; artifact byte, digest, ordering,
  identity, evaluator and filesystem checks are unchanged.
- The CLI accepts `--max-prepared-cases`, validates it before loading or any
  key/claim path, and records the effective bound in dry-run output and durable
  operator metadata. It does not alter any ledger, request, token, timeout,
  concurrency, retry or resume policy.
- Synthetic eight-case tests retain evaluator separation; cover bounds 1, 7,
  8, 36 and 500 plus invalid/accessor/unknown options; and recheck digest and
  identity failures under the opt-in. The executable CLI is launched in an
  eight-case keyless dry-run and leaves ledger files and accounting unchanged.

## Offline verification evidence

All commands completed successfully on both Node 22.16.0 and Node 24.15.0:

```sh
node --test --test-reporter=dot plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs
node scripts/validate-json.mjs
node --test --test-reporter=dot evaluation/longmemeval/test/*.test.mjs
node evaluation/longmemeval/public-demo.mjs
node --test --test-reporter=dot evaluation/live/test/*.test.mjs
```

The focused eight-case CLI regression additionally launches
`evaluation/live/public-pilot-cli.mjs` as a child process with synthetic
prepared data, `--max-prepared-cases 8`, `--dry-run`, no provider key and a
verified zero-transport path. No private corpus, paid request, campaign ledger
or retained pilot artifact was read or changed.
