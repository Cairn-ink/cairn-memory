# Mem0 OSS engine synthetic preflight

Fixed base: `45eca22639836e8035c3ccbbe6403a9f5c076b1d` (PR #217).
Owner: primary DRI for scope/acceptance; bounded implementation GPT-6 Sol/high.
This packet can proceed alongside the already-running, immutable six-case
development smoke. It neither changes that runtime nor passes its completion
gate. No paid comparison, holdout selection or S3 promotion is authorized here.

## Purpose and frozen scope

The goal remains a lightweight reliable memory layer with a fair comparison to
an existing solution, not 100% accuracy. Before writing a paid comparator,
exercise the actual candidate engine, not just its benchmark harness, using
synthetic messages and fake local HTTP. Candidate: official Mem0 OSS Python
`mem0ai` v2.2.0, commit `47a69e1e72dc562b6fdd49a9ef892229afc7508a`.
Verify the official tag, source, license and installed distribution identity;
fail rather than silently substituting a newer release.

Allowed changes: this plan; isolated maintainer-only files under
`evaluation/comparators/mem0-preflight/`; technical
`docs/mem0-engine-preflight.md`; a narrow limitation entry in
`docs/limitations.md`. No core, MCP, Hermes, scorer, live runner, shared ledger,
root dependencies, release packaging, product defaults or CI workflow changes.
Keep third-party source/venvs/generated stores outside the repository. A pinned
dependency manifest/lock belongs only in the isolated maintainer directory.
No API keys, real corpus, evaluator answers, user collections or real ledger may
be read by the worker or tests. No remote model request or paid-capable mode.

## Acceptance (freeze before implementation)

- M1 Identity/reproducibility: use an isolated Python environment, verify exact
  engine tag/commit/package correspondence and pin all resolved dependencies
  with integrity information. Document install commands, Python version,
  dependency footprint and optional features absent. Public registry/source
  downloads for preparation are allowed; running tests must not download assets.
- M2 No-key boundary: before importing Mem0, set its dedicated temporary config
  and store paths and disable telemetry; launch the test child with an explicit
  environment allowlist and synthetic credentials only. Configure both LLM and
  embedding endpoints to the local fake server. Instrument socket connection
  attempts to reject non-loopback destinations before any engine import; prove
  refusal and account every observed local request. This is synthetic-process
  interception, not an OS sandbox or sufficient guard for future paid runs.
  Do not change the user's home/environment files or global installation.
- M3 Actual behavior: exercise actual `Memory.add` and `Memory.search` with
  ordered synthetic user/assistant messages, separate namespaces/stores and a
  post-cutoff sentinel that the harness never ingests. Inspect fake-request
  messages to establish role order, date treatment, source metadata and returned
  evidence shape. Verify temporal-argument acceptance/rejection directly. Report
  missing source-span/time support without inventing it or patching the engine.
  Fake embeddings and extraction responses prove plumbing, not recall quality.
- M4 Attempts/failures: observe default SDK retry settings without spending or
  waiting through retries; explicitly set controlled clients to zero retries.
  Trigger fake 429, timeout and batch-embedding failure and retain actual counts,
  including any engine batch-to-individual fallback. A local request cap refuses
  further fake work; do not call this the shared paid ledger or a paid guard.
  Never silently turn defaults into the controlled configuration in the report.
- M5 Fairness decision: document default versus controlled model/config choices,
  local Qdrant/SQLite resource costs and optional BM25/reranker status. Identify
  unresolved temporal replay, complete outbound closure, shared ledger/embedding
  pricing, balanced independent arms and fixed-N accounting requirements. No
  result from this packet qualifies Mem0 for scored comparison by itself, changes
  the six-case roster or supports a competitor parity claim.
- M6 Delivery: tests assert the above behavior using the pinned real engine and
  fake HTTP, not only mocked adapter methods. Keep one reproducible no-key command
  with explicit prerequisites and no automatic install at test time. Primary
  inspects the full diff and reruns the actual engine path plus generic/JSON/
  strict-plugin gates on Node 22.16 and 24.15. Freeze candidate, obtain independent
  Standards and Spec review on the same original-base diff, fix and re-review,
  then dependent PR and exact-head CI. No merge, release or deployment.

## Stop, retain and resume

Any real endpoint attempt, user-path write, key read or mismatch between pinned
source and installed engine blocks acceptance. Record the attempted boundary
and fix with synthetic data; do not loosen it to make the check pass. Missing
dependencies or unsupported engine behavior are explicit findings, not an
excuse to substitute an engine version or claim a score. If the packet needs
broader code changes, return the evidence to primary for a new bounded contract.

Before resuming, inspect this plan, worktree status/head and recorded test/review
evidence. The parallel paid smoke has a consumed launch marker: never relaunch
it or infer that a missing report means it has not run. Its private operator
state is owned by primary, not this worker. Continue preparing this independent
offline packet regardless of smoke outcome, but scale no paid benchmark until
the smoke's frozen completion gate and the later comparator guards pass.

## Evidence record

Pending implementation and actual-engine checks. Initial research proposed the
pin and identified timestamp/retry risks; source reading alone is not acceptance.
