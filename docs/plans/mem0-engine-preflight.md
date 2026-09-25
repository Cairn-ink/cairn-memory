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

GPT-6 Sol/high implemented the isolated packet on branch
`test/mem0-engine-preflight` from fixed base
`45eca22639836e8035c3ccbbe6403a9f5c076b1d`. Candidate review and primary
acceptance are still pending. Initial research proposed the pin and identified
timestamp/retry risks; the checks below add actual-engine evidence, not S3.

Preparation: `uv pip compile --python 3.11 --generate-hashes` resolved 34
packages into the isolated lock, then `uv pip sync --require-hashes --strict`
installed them in `/tmp/cairn-mem0-preflight.vDNO3z/venv` using Python 3.11.12.
The installed environment was 149 MiB by `du -sh`; `site-packages` was
139,116,242 bytes and Mem0's package tree 2,084,155 bytes. These trees include
13,141,486 and 720,927 bytes of generated Python bytecode cache respectively.
The 57 MiB source checkout, download/wheel cache and test-time stores are
separate, not runtime dependency measurements. No relative lightweight claim
is made.
The official tag checkout at that commit and installed distribution `mem0ai
2.2.0` had identical 149 packaged Python/config files, SHA-256 tree fingerprint
`6884f0109e5ef418c58972e12b95e1a5480293a14b0f35ee3be6e2ef7d3a0fcd`.
The focused child verified all 34 installed versions against the hash lock,
including OpenAI SDK 3.19.2.
No optional FastEmbed, spaCy or reranker package was installed.

Focused run:
`/tmp/cairn-mem0-preflight.vDNO3z/venv/bin/python evaluation/comparators/mem0-preflight/run.py`
passed. The child used a synthetic credential and seven-field allowlisted
environment, rejected one deliberate non-loopback socket attempt before Mem0
import, observed 16 fake loopback HTTP requests and no other socket attempt,
and kept config/Qdrant/SQLite paths temporary. An early Python audit hook and
disabled bytecode writes recorded 30 temporary write events, one exact
`/dev/null` write and one deliberately refused unique off-root write; no
other off-root Python-audited write occurred. Native code and existing file
descriptors are outside this proof. Ordinary fake calls now have a five-second
timeout; only the deliberate timeout probe uses 0.1 seconds. Ordered roles survived into
the actual LLM request; the post-cutoff sentinel did not. The prompt used the
2026-09-25 run date instead of the synthetic 2024 source date. Same-store user
namespaces and separate stores returned only their own synthetic facts;
returned evidence had call-level source metadata but no source span.
`add(timestamp)` and `search(reference_date)` explicitly rejected use.
Installed OpenAI SDK clients reported default retries 2/2; controlled clients
used 0/0. A fake 429 and timeout each caused one observed attempt. A failed
two-input embedding batch produced request sizes `1, 2, 1, 1` including query
embedding and two one-input fallbacks. The local cap denied one next request.
FastEmbed BM25 and reranker were absent. These are plumbing assertions with
fake vectors/facts, not retrieval quality, cost, or parity results.
The two temporary Qdrant/SQLite pairs measured 45,658/20,480 and
62,043/20,480 bytes after the synthetic run; this is not a growth profile.

Changed call path: `run.py` launches one isolated child with an explicit env;
`child.py` installs socket checks, verifies installed engine identity, then
invokes real `Memory.add`/`Memory.search` against fake HTTP and local Qdrant.
No product entrypoint, core, scorer, ledger, packaging or CI caller changed.
Primary owns final gate reruns, original-base independent review, PR and CI.

### First-review correction contract (frozen before edits)

At `aab2f80`, independent Spec review passed with zero findings. Standards
found no hard violation and one low heuristic: `connect` and `connect_ex`
duplicate non-loopback refusal/logging. Primary accepts that small maintenance
correction. In `child.py` only, share the address refusal check while retaining
the distinct original socket delegates and existing behavior, counts and
Python-only proof boundaries. Record the correction here; rerun the focused
actual-engine path and contributor gates on both Node runtimes, then both
original-base independent reviews on the new committed candidate. No broader
socket sandbox, paid guard or engine behavior change is in scope.
