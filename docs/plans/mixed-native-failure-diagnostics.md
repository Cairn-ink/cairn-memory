# Prospective native terminal-failure diagnostics

Fixed base7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4. This is evaluation-only
observation, not a native runtime correction, retry permission, scoring change
or cause attribution. A halted mixed generation currently discards the native
runtime/gateway exception category when preserving its outer scope failure.
The old exception is not recoverable from a later synthetic demonstration.

## Contract

- NF1: On the existing Mem0 execution catch path only, retain an optional
  immutable own-data `nativeFailure` object containing exactly
  `{version:1,layer,reason}` in private arm diagnostics. Layer is `runtime` or
  `gateway`; reason belongs to a finite explicit allowlist of codes actually
  emitted by the two existing native error classes. No regex-based arbitrary
  pass-through. Successful arms, Cairn errors and unrecognized errors gain no
  field. No exception message, stack, cause, key, text, body, URL, ID, length,
  path, constructor name or arbitrary caller value is captured.
- NF2: Project only recognized own-data code on the existing typed native
  errors. Reject proxies, accessors, unknown codes/classes, plain forged
  objects, malformed/missing values and hostile properties without invoking
  getters or coercion. Projection failure yields no observation and must not
  replace an operation result or exception. Frozen output has the exact three
  fields; callers cannot mutate the retained classification afterward.
- NF3: Preserve outer `scope_execution_failed`/global halt, sealed scopes,
  fixed-N accounting and failure eligibility. This field is observation only,
  never authority to continue, resolve, retry, refund, promote or reclassify
  an unknown. No change to native framing/cancellation/reap/containment,
  timers, quota/policy/schema, keys, core, prompts, model selection, prepared
  identity or scorer. Do not change historical private reports.
- NF4: Retain the category on the actual mixed runner catch→diagnostics path,
  including when X's outer scope throws and overwrites the top-level reason.
  Exercise genuine typed gateway/kernel failures, not only a detached helper
  with fabricated strings. Existing private report cloning/freezing must keep
  the exact object. No new public launcher, runtime replacement, test-only
  injection option, model API or alternate native child path.
- NF5: Freeze a red-capable regression before the runtime change and retain
  its base failure. Cover representative runtime+gateway categories, unknown
  codes/classes and hostile descriptors/proxies, success/Cairn parity and
  real global-stop/native cleanup behavior. Inspect all changed call sites
  and private report consumers. New owned fixtures close resources before
  removal through canonical createTestWorkspace/run.mjs. No provider key,
  actual corpus/book, private operator/control/output or live call.
- NF6: Keep scope to mixed-generation plus a small native diagnostic projector
  and focused tests; native kernel/gateway code changes require primary
  re-scoping first. Document finite observation/privacy/unknown limitations in
  mixed comparison documentation, docs/privacy.md and docs/limitations.md;
  include CHANGELOG and this plan. No README promotional claim, paid score,
  installed-product/default-parity or historical-cause claim.
- NF7: Author gates on both pinnedNode22.16/24.15: generic tests, validate,
  LongMemEval suite and mixed/demo comparisons, plus ordinary native-gateway
  and the explicit installed mixed-native-local gate using existing pinned
  local native prerequisites and fake HTTP. No skipped installed prerequisite
  counts as a pass. Install only this worktree's locked OpenAI dependencies
  when required. No operational scripts, packaging publication or production.
- NF8: Freeze a scoped local candidate before pushing; primary reads actual
  complete diff and personally reruns affected catch, projection, global-stop
  and cleanup paths on both Nodes. Independent nonauthor Standards and Spec
  reviews inspect the same fixed base/candidate. Latest remote-head CI must
  pass and PR be mergeable before ready delivery; do not merge/release/deploy.

Primary owns planning/integration/acceptance; one bounded actualGPT-6.1Sol/high
worker owns implementation. Record exact files, source hashes, commands,
counts, failures/corrections and limits here. A new paid run needs a separately
frozen prospective protocol and applicable authority, not this diagnostic PR.

## Implementation and evidence

Owner: one bounded implementation worker, requested/actual `gpt-6.1-sol`
with `high` reasoning. Primary retains acceptance and independent review.
Worktree `/home/chichieh/Github/cairn-memory-worktrees/mixed-native-failure-diagnostics`,
branch `fix/mixed-native-failure-diagnostics`; base is the fixed SHA above.
No kernel/gateway, core, provider prompt, policy, timer, framing or scorer edit.
Primary clarified NF6 after checking CONTRIBUTING: also update
`docs/protocol.md` to document the captured-field threat boundary. This expands
documentation only; it does not weaken the contract or change any schema.

Entrypoint trace: the existing `runMixedGeneration` Mem0 execution catch
projects the error before storing local diagnostics. X's `withCaseScope`
may then throw; the outer catch keeps `scope_execution_failed`. The subsequent
arm diagnostic spread, `reportSnapshot` own-data clone and recursive freeze
retain only the three finite values. `mixed-scoring.mjs` accepts diagnostics
as private metadata and does not use them to determine answer eligibility,
fixed N, guard authority or a score. The fixed base has no optional generation
journal; the new object is ordinary JSON own data and survives the existing
clone. A later journal integration must preserve the same observation-only
boundary and does not follow automatically from these tests.

Locked prerequisite install: `npm ci --prefix adapters/openai --ignore-scripts`
in this worktree only, added 1 package, audit 2 packages, 0 vulnerabilities.
Native roots used only for synthetic installed tests:
`/tmp/cairn-mem0-preflight.vDNO3z/venv` and
`/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu`.
No provider key, actual corpus, private control or historical report was read.

### RED freeze

Before either production edit, Node22.16 ran the actual existing M7b test
twice through `tools/testing/run.mjs` with
`--test-name-pattern='M7b malformed native usage'` and
`evaluation/longmemeval/testing/mixed-native.test.mjs` plus the two explicit
`CAIRN_MEM0_NATIVE_*_ROOT` values above. Each run had 0 pass / 1 fail:
`native.diagnostics.nativeFailure` was undefined, expected exactly
`{version:1,layer:'runtime',reason:'native_gateway_failed'}`. The preceding
outer `haltReason` and native arm `reason` assertions already passed as
`scope_execution_failed`. This is a synthetic prospective regression, not
the exception or cause of an earlier paid attempt.

Frozen test source SHA256 values:

- `test/mixed-native-failure.test.mjs`:
  `d78584dd5adf51578dbc5b39eb0cf1cff939755cab795701be3526a706b28b94`
- `testing/mixed-native.test.mjs`:
  `0b0a0944b63f6f9c0c622388abd4fd0fd8b0785bb8b748cbc27618f94fd5f8e5`

The focused helper test also failed 0/1 before implementation with
`ERR_MODULE_NOT_FOUND` for the not-yet-created projector; this is supplementary
RED evidence, not the actual-catch assertion evidence above.
Unchanged base source hashes (paths under `evaluation/`):

- `longmemeval/mixed-generation.mjs`:
  `e8df279093a21dc5eb8d42aef148dbaed8fcef74205f0a76831dbaed2414c99f`
- `experiment-budget/mem0-native-runtime.mjs`:
  `1a9ca8304ec1c14cf7ea75aea74bc3e45c09798ec7362feb7059bc5d03ebfe1f`
- `experiment-budget/mem0-native-gateway.mjs`:
  `ee3c214947407b25cc211d2d99901670ba7103438a0fb4f722318ef1151d94d1`

### GREEN and corrections

The first focused run after implementation passed hostile and genuine gateway
tests, but its clone assertion failed on the existing null-prototype report
object (2 pass / 1 fail). Comparing the spread fields plus exact own keys and
frozen state corrected this expectation without changing production. The next
M7b run retained the expected category and outer halt, but failed its newly
assumed one-scope outcome count: actual X globally throws before appending any
outcome. The test now preserves that existing zero-outcome behavior and asserts
the one unknown attempt, no pending attempts and native unknownActualCount=1.
Primary personally checked source and accepted both test-only corrections.

Focused Node22 projector tests then passed 3/3; installed actual M7b passed 1/1
with no skip, no later Cairn dispatch and no newly retained native scratch.
Final focused test hashes:

- `test/mixed-native-failure.test.mjs`:
  `e12b8d566fe6efda26782ca7646b8a048837c174b140de754cf7f347769bce58`
- `testing/mixed-native.test.mjs`:
  `bee26201d1768989a7a6364b3906dfd99d8d5e15ec2c277d2e9f357e09bfdf23`

The new focused tests create no owned resource or file. Existing M7b closes its
guard in `finally`; the canonical runner removes its invocation workspace after
process completion. Native kernel cleanup remains its existing checked child,
process-group, listener and transport lifecycle. Success and failed Cairn arms
are checked for absence of the field in the actual installed C1–C7 pair.

### Full author gates

Both pinned Nodes completed every command below with exit 0. Each invocation
used its corresponding `/home/chichieh/.nvm/versions/node/v22.16.0/bin` or
`v24.15.0/bin` at the front of PATH and the two native-root environment variables
above. Raw synthetic logs are retained at
`/tmp/cairn-native-failure-gates.Y2F6CP/node-<version>-<script-with-colons-as-hyphens>.log`.

| Exact package command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm test` | 580/580, 0 skips | 580/580, 0 skips |
| `npm run validate` | Pass | Pass |
| `npm run test:longmemeval` | 196/196, 0 skips | 196/196, 0 skips |
| `npm run demo:longmemeval-ingestion` | Pass | Pass |
| `npm run demo:longmemeval-comparison` | Pass | Pass |
| `npm run demo:longmemeval-public` | Pass | Pass |
| `npm run demo:longmemeval-mixed` | Pass, no transport dispatched | Pass, no transport dispatched |
| `npm run test:mem0-native-gateway` | 45/45, 0 skips | 45/45, 0 skips |
| `npm run test:mixed-native-local` | 26/26, 0 skips | 26/26, 0 skips |

The focused 3/3 projector suite also passed directly on Node24.15.0 using
`node tools/testing/run.mjs evaluation/longmemeval/test/mixed-native-failure.test.mjs`.
No full gate failed. Only the explicitly recorded RED and two test-expectation
corrections failed. No paid call or experiment, native source fix, production
action, push or PR was performed by this worker.

Production source SHA256 verified after all gates:

- `longmemeval/mixed-generation.mjs`:
  `34618abf6251ebfb7f073d2c4d1c8661101f09132719dd1d8708bbf006750d9a`
- `longmemeval/mixed-native-failure.mjs`:
  `a20cdf1dac6ca443abfacccb5123799d99494da780865cb95413de8517bbf11e`

Final test hashes still match the GREEN hashes above; native runtime/gateway
still match their recorded base hashes. `git diff --check` passed. The scoped
local candidate consists of this plan, CHANGELOG, the four comparison/privacy/
protocol/limitations documents, mixed-generation, the new projector and focused
test, and the existing installed mixed-native test. Primary records its exact
commit and owns personal both-Node affected reruns, dual nonauthor fixed-diff
reviews, push/PR and latest-head CI. Those are required delivery gates, not
author-gate passes or permission to merge.
