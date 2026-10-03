# Inert timing-observer rejection correction (O1–O6)

Fixed dependency/delta base: `07d82304a75b0be28f29a15b600b9d32da7d0b96`.
Isolated worktree: `phase-observer-rejection`; branch:
`fix/phase-observer-rejection`. This is an adapter-only correction within the
pending prospective-readiness integration, not paid execution or a historic
transport/timeout fix. Primary owns contract/integration/acceptance; one actual
GPT-6.1 Sol/high worker owns implementation; independent nonauthor Standards
and Spec reviewers inspect the same frozen delta.

## Observed defect

The existing timing callback contract promises inert thrown/rejected observers.
An actual OpenAI adapter extraction with fake HTTP completes both requests and
seven timing events, but a rejected native Promise with a throwing own `catch`
getter leaves seven unhandled rejections. The primary ran the same probe on
Node22.16 and24.15: exit1, `{pass:false,requests:2,events:7,unhandled:7}`.
No provider key, operational ledger or historical case was read. This proves a
callback-observation defect, not the cause of any earlier paid interruption.

## Acceptance

- O1: Freeze and run a real-adapter subprocess regression before changing the
  helper. The rejected native Promise has a throwing own `catch` getter or
  throwing own `catch` function; expected zero unhandled rejections must fail
  against this fixed base with real requests/output preserved. Do not rely on
  node:test's own rejection handler as the sole observation.
- O2: Apply the minimal timing-observer rejection handling correction, bypassing
  a callback-returned value's own `catch` property. Preserve trusted callback
  limits: it can block or use its closure's authority; this is not a sandbox.
  No observer await, input mutation, extra request, retry or production timer
  change. Do not broaden this correction into unrelated observer APIs.
- O3: Ordinary omitted/enabled/throwing/async-rejecting observers and the two
  own-catch controls preserve exact request bodies/order/count, output and error
  envelopes, finite closed timing fields and existing onDiagnostic behavior.
  Include healthy and adapter invalid-output controls; no raw synthetic canary
  or thrown data appears in retained results. Existing bounded timing tests pass.
- O4: Packaging includes the corrected existing helper with its current hash;
  test an installed archive using fake HTTP. No file allowlist, schema, wire,
  dependency lock, version, core, guard, accounting, halt, capture qualification,
  model/prompt or resource policy change. No paid call, real environment key,
  ledger/corpus access, launcher adoption, merge, release or deployment.
- O5: Use createTestWorkspace/owned runner; child cleanup succeeds after genuine
  assertion failures as well as success. Run focused regression, test:openai,
  demo:openai-offline, npm test, validate, test:artifact, strict plugin validation
  and workspace lifecycle on Node22.16/24.15 after documented isolated locked
  dependencies/packaging prerequisites. A green subset is not the full gate.
- O6: Keep original RED and scoped commands/hashes/results. Update limitations,
  roadmap and changelog with the causal limits; do not revise frozen historic
  evidence. Commit the scoped candidate only after gates, no push. Primary
  personally reruns key seams and both reviewers inspect the same final delta.
  Delivery updates the existing #321 integration only after safe fast-forward
  identity verification; no duplicate PR, no merge. Its old CI cannot count for
  the new head; all latest-head applicable CI must finish successfully.

## Ownership and allowed files

Worker: `adapters/openai/phase-timing.mjs`, focused new adapter test/helper,
focused installed test in `packaging/test/install.test.mjs`, scoped entries in
CHANGELOG.md, ROADMAP.md and docs/limitations.md, and evidence append to this
plan. Primary-created acceptance probe in /tmp remains frozen and untouched.
Read current CONTRIBUTING, protocol/privacy, packaging and testing docs before
running prerequisites. Root primary and every other worktree remain untouched.
Entrypoints: callback result -> rejection observation -> unchanged adapter ports;
actual adapter + installed import + owned subprocess -> real fake HTTP -> output
or finite error. The private indexed write packet stays pinned to its original
dependency until any rebind is explicit and independently reverified.

## Worker implementation and preserved RED

The assigned GPT-6.1 Sol/high worker used the existing isolated worktree at the
fixed `07d82304` dependency. It read the shared routing/workflow/diagnosis
instructions, current contributor/protocol/privacy boundaries, installed
artifact documentation and test workspace lifecycle contract. This checkout has
no `scripts/README.md`; `CONTRIBUTING.md` and `docs/install-artifact.md` define
the public packaging prerequisite. No Next.js code is involved.

Entrypoint trace: the existing adapter closes an entered phase, calls the trusted
observer with its unchanged frozen five-field event, and attaches a rejection
handler without awaiting the callback. The correction changes only that handler
attachment in `adapters/openai/phase-timing.mjs`: intrinsic
`Promise.prototype.then.call(Promise.resolve(result), undefined, noOp)` bypasses
the returned value's own `catch`. All adapter ports share this helper; requests,
abort listeners, phase clocks and operation results are unchanged. This does
not harden Promise constructor/species or callback closure authority.

The new `phase-observer-rejection.test.mjs` uses a standalone child script
(`phase-observer-probe.mjs`) through the owned runner, rather than relying on
node:test's rejection handler. It measures actual `unhandledRejection` events
without retaining their reason. Each of six modes (omitted, enabled, synchronous
throw, async rejection, throwing own-catch getter, throwing own-catch function)
runs healthy and invalid-output extraction with injected fake HTTP. Assertions
check exact bodies/order/count, output/error envelopes, existing diagnostics,
frozen closed finite event fields, zero own-catch reads and zero unhandled
rejections. A deliberately failing real child asserts after successful extraction
and proves scratch removal despite exit1. Its fresh workspace is removed in
`finally`; the parent separately asserts its owned directory is empty.

The installed test reuses only this test orchestration, passes the installed
archive's `adapters/openai/index.mjs` path, and imports the actual adapter closure
from that installed package. It checks the packaged helper against the archive's
source hash and current source bytes. The helper/test files themselves remain
outside the artifact allowlist. Existing fourteen bounded timing tests are
unchanged and exercise dependent timeout/core/cold-read seams.

Before changing the runtime helper, the focused regression exited1 on each
supported runtime: getter mode completed requests2/events7 but observed
unhandled7/ownCatchReads7. The deliberate assertion-failure cleanup control passed;
overall tests2/pass1/fail1. Ranked hypotheses were own-catch attachment failure,
settlement timing, and phase-close handler loss; seven own-property reads and
the minimal handler correction distinguish the first.

Raw evidence is intentionally retained at
`/tmp/cairn-phase-observer-evidence.tJyIFt` (only probes, empty npm configs and
logs/summaries, no installed package, database or ledger). Original RED logs:

- `red-node22.log`: SHA-256
  `f9a6db235784714da8f71dfaaa04802b1d01597efc7b4324e03e3cbc28123950`.
- `red-node24.log`: SHA-256
  `0b37b061c60af48d1f56f96f357eb609c7297b32d6b8e478c62663c745bc77b0`.

The exact RED command on each pinned runtime was
`node tools/testing/run.mjs adapters/openai/test/phase-observer-rejection.test.mjs`.
After correction, adding `adapters/openai/test/phase-timing.test.mjs` to this
command passed16/16 with zero failures/skips on both runtimes. The primary's
frozen probe remains untouched (SHA-256
`d21fcaf942304ffea30c2cb8492595be7f39dbf31f90009951116e9252cd43da`).
An in-memory import-path-only rebind to this candidate independently returned
exit0 and `{pass:true,requests:2,events:7,unhandled:0}` on each runtime; both
`primary-probe-green-node*.log` hashes are
`4c41c9818eaf6f8a134e6baf3491281e7e9603ac0041cb8a17a0908e8c599da2`.

## Prerequisites and final gate record

Every verification invocation used `env -i` with the pinned Node bin directory
followed by `/usr/bin:/bin`, `TMPDIR=/tmp` and
`NODE_DISABLE_COMPILE_CACHE=1`. Binaries were
`/home/chichieh/.nvm/versions/node/v22.16.0/bin/node` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin/node`; corresponding npm CLI
scripts ran through `tools/testing/run.mjs --script` for invocation ownership.
No application environment or real provider key was forwarded or discovered.

The three isolated locked dependency installs used npm `ci --prefix` for
`adapters/openai`, `adapters/mcp`, and `tools/plugin-validation`, with
`--ignore-scripts --no-audit --no-fund` and two distinct owned empty npm config
files. They exited0 (1,14,3 installed packages). The first attempted prerequisite
failed because npm rejects loading `/dev/null` as both user and global config;
it ran no tests and is not counted as a passing gate. Using distinct empty
configs corrected that harness configuration without changing dependencies.
`node tools/testing/run.mjs --script packaging/prepare-cache.mjs` then exited0,
preparing only public registry metadata for the four pinned production packages.
No account key, operational data or paid HTTP was involved.

Final runtime helper SHA-256:
`2c7226f68ca344dba09eb71fe2f3f3d523305368bdb2f79572edeb3403f10461`.
Final new probe SHA-256:
`a67a9db92d299666dcabdb5a52a68836e0f62085dffe526227f3d4790bc2f44f`.
Final new regression SHA-256:
`b873a52ff5cf7664b95579419574dfb6d4fddfb0043ecb60c7414383d3fea4ce`.

The worker's local candidate is frozen only after all O5 gates below complete;
the exact commit is reported to the primary for delta review against `07d82304`.
Primary acceptance, independent Standards/Spec review and safe update of existing
#321 remain separate required steps. Prior #321 CI cannot validate a new head.
No push, PR creation, merge, deployment, paid call or historical evidence edit
is performed by this worker. No correction-round escalation or model fallback
was needed; token/cost data are unavailable.

All final O5 commands exited0 on **each** pinned runtime with zero test failures
or skips. They ran as the corresponding pinned npm CLI through
`node tools/testing/run.mjs --script`; the adjacent evidence `.json` files retain
the exact arguments, binary, exit/signal and raw log SHA-256. No source or test
bytes changed during these final gates; later plan edits only record results.
There is no TypeScript/typecheck gate in this JavaScript repository.

| Gate | Node 22.16 | Node 24.15 |
| --- | ---: | ---: |
| Focused new regression + existing phase timing | 16/16 | 16/16 |
| `npm run test:openai` | 332/332 | 332/332 |
| `npm run demo:openai-offline` | pass | pass |
| `npm test` | 581/581 | 581/581 |
| `npm run validate` | pass | pass |
| `npm run test:artifact` | 89/89 | 89/89 |
| `npm run validate --prefix tools/plugin-validation` | marketplace + strict plugin pass | marketplace + strict plugin pass |
| `npm run test:workspace-lifecycle` | 25/25 | 25/25 |

The first strict-plugin invocations exited1 on both runtimes because the earlier
`--ignore-scripts` dependency install left the native executable placeholder.
Those failures remain in `plugin-strict-node*.log`, both SHA-256
`fe1b2ccbe9ed7c9651305185af84ca9ffd0818f069da290c714a3a92f40ed1e7`;
they are not counted as passes. The worker fully inspected the pinned 223-line
`@anthropic-ai/claude-code/install.cjs`: on this host it places the already
downloaded matching optional binary only inside the isolated maintainer
`node_modules`, without network, account configuration or key discovery.
Running that existing postinstall through the owned runner exited0. Subsequent
strict marketplace/plugin checks passed on both runtimes; both corrected log
hashes are
`784e12043f036a0528d1552935f12db0647de1e801d98d12142ad53bdf59bd90`.
This resolved a tooling prerequisite, not a runtime correction or unexplained
green rerun. Dependency lockfiles and tool version2.1.260 remain unchanged.

Both installed O4 controls observed the same archive SHA-256:
`eafa76d2b98fab8c25668c8400d40203ece2e3276821fb76ed04ccb170a18c40`.
Their packaged/current helper hash is the frozen `2c7226f6…` value above.
The actual installed adapter subprocess matrix passed all twelve controls on
each runtime with requests2, seven events when enabled, unhandled0 and
ownCatchReads0. Invalid output retained `invalid_model_output` and the unchanged
`response_envelope` diagnostic; omission emitted no events. Temporary installed
archives, packages and synthetic stores were under the invocation-owned runner
and disposed after their processes stopped. No artifact allowlist or retained
historical build/report was rewritten.

Key full-gate raw log hashes:

- `test-openai-node22.log`:
  `3e30b960dd2336ebb0a1ecb5dad3a6f3109268c58714e938b2f06e8d784e0883`;
  `test-openai-node24.log`:
  `3d0d10e054b22e52b07f4e7aba4c5b6a01e1997d253d36b385149ddf54deda67`.
- `test-artifact-node22.log`:
  `7b8ee71dc76e2fb230c85d016cb5a6c8df965b0f2e8213d9ce5dc45b7df638ff`;
  `test-artifact-node24.log`:
  `b7acf70010c03574546c54951e9ad2bbc2365e0e6cdbaeb34667d22692502d2a`.
- `test-workspace-lifecycle-node22.log`:
  `5d95cf8b4f991d116b128b5719a5d944f7f4ad18b41741a3c76cd654d02ad6ef`;
  `test-workspace-lifecycle-node24.log`:
  `e5207f50f5ecf0b06a485c23613f8b16c87db8034b520dc1c8585ed0b131ddc4`.

The full lifecycle gate covers real subprocess success/failure, catchable Linux
termination, concurrent/repeated runs, cleanup failures and actual
ordered/paired/semantic fixtures. The focused correction additionally checks
its own actual adapter child on success and genuine assertion failure.
Deliberately replaced roots are retained by existing negative controls; detached
sessions, SIGKILL, crashes and native macOS are outside this Linux/WSL evidence.
No debug instrumentation was added. Historical paid causes, semantic acceptance,
provider cancellation/billing, installed MCP/Hermes adoption and fresh paid
expansion remain unproven or separately gated. The private indexed packet stays
bound to its original dependency; this correction does not adopt or rebind it.
