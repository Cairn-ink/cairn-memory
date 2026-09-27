# Opt-in indexed evidence capture without claim qualification

Status: offline implementation experiment, not a promoted default or paid result.
Fixed base: `93e52b7afb298d728cb4831c34bbda6dcf750704`.
Branch: `feat/indexed-evidence-capture`.

## Decision and scope

The goal remains a lightweight reliable shared core usable through MCP, Hermes
and other harnesses. Existing explicit admission and source-evidence reads do
not require claim qualification. Indexed-window capture currently does, even
when its consumer wants only the retained source receipts. The completed short
meaning probe produced 24/24 mechanical successes but only 13/24 adjudicated
full semantic successes; qualification is not a certificate of source truth.
The earlier official pilot also retained qualification-stage ingestion failures.
These observations motivate testing a separate lane, not removing safeguards
from the existing qualified lane or asserting a better benchmark score.

This packet adds an explicit extraction-only indexed policy using the same
capture, admission, storage, classification and source-read implementations.
It does not archive all submitted text: extraction still selects at most five
items and four exact retained passages per item, and can fail or omit evidence.
No silent fallback from a failed qualified capture is permitted. Structured
claim qualification, relationship interpretation and current-decision reasoning
remain separate work. No new persistence schema, vector service or model exists.

The currently running official six v3 uses immutable runtime `26a7221`; neither
that runtime nor its cohort, protocol, grant, accounting or scorer may change.
This prospective candidate is independently motivated and cannot relabel that
run. Paid evaluation of it requires separately versioned integration, source-only
preparation, frozen new cases, resource projection and independent acceptance.

## Acceptance contract

- E1: Add only the explicit constructor policy
  `captureSourcePolicy: 'indexed-evidence-v1'`. It requires omission of
  `captureQualification`, `captureEvidence` and `captureRationale`. Invalid,
  explicit-undefined, accessor and incompatible own options fail before database
  opening/model work, following existing own-data policy validation. Omitted or
  inherited policy and the existing `indexed-windows-v1` qualified mode retain
  their existing behavior, digests, prompts and result shapes. The old indexed
  mode still requires source-bound-v2. No new default or host flag.
- E2: Reuse the canonical indexed window catalog, prompt and extraction wire.
  Preserve 24 messages, 4000 units/message, 20000 units/batch, 64 windows,
  800 units/window, five extracted items, four unique receipts/item and all
  current provider/local/output bounds. Reject ill-formed Unicode in submitted
  text and model content in this new policy just as in qualified indexed mode.
  Exact source identity, redaction, normalization and duplicate receipt rejection
  remain host-controlled. No model-authored source text or positional authority.
- E3: Execute extraction, atomic admission, then existing initial classification.
  Never access/call qualify, qualifyCandidates, reconcile, relate or reviewBasis
  in this lane. Reject ANY own causal field before admission/model work, including
  explicit undefined, so omission of qualification cannot activate legacy ordered
  reconciliation. No new bindings, automatic retirements, inferred authority or
  relation writes. Invalid extraction still fails and admits none of the batch;
  classification failure remains an explicit post-admission outcome.
- E4: Bind the new policy to the existing policy-sensitive digest. Identical
  warm/cold replays make no model call; mode/content changes at the same event
  conflict without overwriting prior admission. Preserve processing, stale lease,
  namespace, correction, forgetting, suppression and invocation deadline fences.
  Successful new-policy responses, including processing/duplicate, add exactly
  `qualificationStatus: 'not-requested'` plus the existing indexed catalog
  metadata. Failure responses have no success metadata. This status describes
  this explicitly requested capture interpretation, not semantic accuracy.
- E5: Cold get with includeQualification returns the existing missing-qualification
  representation; source-evidence fetch/recall uses the exact retained receipts,
  not generated summaries or invented metadata. Existing dedup rules are NOT
  loosened: a preexisting record may have separate prior qualifications, and
  this new response must not claim to erase them or qualify the new capture.
  Test mixed qualified/unqualified use explicitly. Document inspection of source
  evidence as the intended read path, not a verified-current-decision view.
- E6: Real-core synthetic regressions cover a useful tail after unit800,
  multiwindow support and two conflicting dated choices, complete old/new sources
  with no retirement, no hidden qualifier calls (throwing methods/getters), warm
  and cold replay, changed policy/input conflicts, empty extraction, malformed
  later item atomicity, invalid causal/options before writes, Unicode/redaction,
  caller mutation, namespace isolation, classification failure, and correction/
  forget with no replay resurrection. At least one base-red/new-green probe must
  use the actual capture/admission/cold-read seam, not just option parsing.
- E7: Installed archive test uses the actual installed core and OpenAI adapter
  with fake HTTP, performs capture then closes/reopens before source-only read,
  checks exact tail receipt and request-stage counts, and ensures there is no
  qualification provider request. Use synthetic keys/data only. Existing current
  qualified capture controls still execute qualification, and invalid output
  still rejects atomically. No source imports standing in for installation.
- E8: Technical docs, protocol boundary, limitations and changelog distinguish
  source binding from truth, extraction-only from qualified interpretation, and
  selected passages from a complete archive. Do not call this a qualified-mode
  repair, an installed-host integration, a causal quality improvement or a score.
  Preserve old evidence and bounds. This change does not authorize an old grant
  to evaluate the new lane or replay a consumed official case.

## Ownership and verification

Primary owns architecture, this contract, scope, final inspection and acceptance.
One GPT-6 Sol/high worker owns actual implementation and tests in this isolated
worktree. Independent non-author Standards and Spec agents inspect the exact
final candidate against the fixed base. Primary personally reruns key integrated
paths; final remote CI and mergeability precede any previously authorized merge.
No registry publication, deployment, production data or new paid call.

Allowed runtime files: `core/contract.mjs`, `core/capture.mjs`,
`core/capture-input.mjs`; existing source-window helper only if necessary to share
unchanged logic. New focused core and packaging tests; this plan; technical
`docs/indexed-evidence-capture.md`, narrow `docs/protocol.md`,
`docs/limitations.md`, `CHANGELOG.md`. No model prompt/schema/provider, benchmark,
guard/ledger, host, dependency, storage-schema, existing frozen-result or version
changes. Report a demonstrated need outside this scope before implementation.

Worker traces all changed entrypoints and adjacent callers, records their gates,
and runs focused tests, full core/OpenAI/artifact, generic/JSON/strict-plugin
checks plus store/capture/admission/recall demos on Node22.16 and24.15. Install
locked isolated adapters and prepare the artifact cache as CONTRIBUTING requires.
Shared capture also requires full LongMemEval and live-evidence-offline regression
on both runtimes; explicit installed coverage is separate from intentional skips.
No typecheck exists in this JavaScript repository. Any failure remains recorded;
fix, rerun affected paths and repeat both review axes after candidate changes.

## Next checkpoint

Only after this offline slice is accepted, decide from the frozen official-six
outcome whether a separately controlled extraction-only comparison is warranted.
Compare mechanical completion, source coverage, fixed-N answer correctness and
total write/read cost. A lower call count alone is not reliability. MCP/Hermes
exposure and ordinary installed-host usability remain a later explicit gate.

## Worker checkpoints and caller trace

Implementation owner: delegated GPT-6 Sol/high, fixed base above. Runtime changes
are limited to constructor/capture option fences, policy-sensitive input snapshot
and success metadata in the existing shared capture engine. Source windows,
prompts, extraction wire, admission/storage, classification and read engines are
unchanged. No model method, dependency, schema, host or benchmark change.

Changed entrypoint: `openMemoryCore` accepts explicit `indexed-evidence-v1`;
`capture` refuses any own causal field before claims. The new lane ignores
inherited enrichment properties rather than activating them. The existing
indexed/default/qualified constructors, MCP/Hermes callers and all benchmark
callers retain their explicit modes; their regression owners are the worker's
core/OpenAI/artifact/LongMemEval/live offline gates and primary final acceptance.
No UI, browser replay or URL change is involved. Installed coverage imports only
archive-installed core and actual OpenAI adapter; source-only reads are cold.

Focused checkpoint: new 13-case actual-core suite passed on Node24.15, alongside
the old indexed-window controls previously passing on Node22.16. Initial new
Unicode test assumed receipt order, which is not guaranteed; changed it to
membership without changing runtime behavior. Initial installed test completed
its assertions but its cleanup referenced a nonexistent build-report directory
property; use the archive's actual parent directory. Full reruns are required.
The qualified-control failure/new-lane success probe exercises extraction,
failed qualification versus actual admission, and cold receipt inspection; it
does not infer semantic benefit from a constructor-only rejection.

Full gates were briefly deferred at primary request while the frozen paid run
remained active, then permitted once primary reported it terminal. This candidate
does not inspect or use that run's data/outcomes and changes none of its artifacts.
Locked adapter/tool installs and explicit public artifact-cache preparation
completed; no provider credentials, corpus, evaluator or operational ledger used.
Gate logs use `/tmp/indexed-evidence-<gate>-<node-version>.log`; final counts and
candidate identity will be recorded after both-runtime verification.

Final worker verification (2026-09-28): Node22.16.0 and24.15.0 each passed
full core 771/771, OpenAI 282/282, installed archive 85/85, LongMemEval
185/185 and generic 112/112, with zero skips in those suites. Live-evidence
offline passed 340 tests with 30 intentional optional installed/host gates
skipped on each runtime; the explicit E7 archive test passed on both, so these
skips do not substitute for its installed coverage. JSON validation, strict
plugin validation and store/capture/admission/recall demos exited 0 on both.
Commands were `npm run test:core`, `npm run test:openai`,
`npm run test:artifact`, `npm run test:longmemeval`,
`npm run test:live-evidence-offline`, `npm test`, `npm run validate`,
the four `npm run demo:<name>` commands, and
`npm run validate --prefix tools/plugin-validation`, with each pinned Node bin
first on PATH. The primary independently reported the new focused 13/13 suite
passing on both runtimes and a Node22 actual original-base qualified failure
versus new-lane admission/cold-read seam. All are mechanical source-binding
evidence, not model quality or benchmark cost results.

Verification handoff retained an incomplete Node24 OpenAI log when session55196
became inaccessible to both primary and worker. Read-only checks found no
remaining candidate test process and no test failure/completion summary in that
log. The completed Node24 core 771/771 log was preserved. Only incomplete OpenAI
and subsequent offline gates were rerun to completion in session36009; the
partial log remains `/tmp/indexed-evidence-test-openai-24.15.0.interrupted.log`.
This was interrupted offline verification, not a provider retry.

Original design/implementation base remains `93e52b7afb298d728cb4831c34bbda6dcf750704`.
Before candidate commit, delivery base fast-forwarded to
`11e91c6a1358c56f7cf9c38a24f55a8d7707b863`: incoming changes touched only
`docs/plans/codex-client.md`, `one-command-setup.md` and `session-episodes.md`.
Inspection found no overlapping runtime/configuration change. Their proposed
host processing, generation-free automatic recall and session-context authority
gates remain separate; this opt-in embedded lane does not implement or enable
them. On the combined tree, the focused 13/13, generic 112/112, JSON and strict
plugin checks passed again on both runtimes, with logs
`/tmp/indexed-evidence-integrated-<gate>-<node-version>.log`.

The original prospective motivation above is retained. The primary now reports
the frozen official run terminal; its runtime and artifacts remain unchanged
and were not inspected or used by this candidate. No paid comparison is implied.
Candidate commit identity and independent review outcomes are delivery evidence
owned by the primary, outside this completed worker verification checkpoint.
