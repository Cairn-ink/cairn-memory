# Explicit candidate qualification experiment (S5c)

Base `285dc40bd99b5cbd211c381dee634a5515d0fcaf`; verified v2 core/adapter/MCP.
Private dependent work, security disclosure hold unchanged. Existing US$50 phase,
not a new grant; no provider call until final offline gates and independent review.

## Acceptance

- E1: Add authorizeCandidateQualificationExtension({ledger,policy,authorizationId})
  and createCandidateQualificationExperimentRequestGuard({ledger,policy,
  candidateQualificationExtension,fetchImpl}). Fixed DEFAULT_MODEL and method
  cairn_qualifyCandidates only, distinct immutable file
  experiment-candidate-qualification-extension.json. Share existing guard,
  accounting, source schema checks and safe authorization writer/lock; do not
  duplicate the accounting engine. A bounded internal refactor may share v1/v2
  capability provisioning, with explicit trusted descriptor selection. Existing
  public factories/method grants/authorization files remain exactly restricted.
  V1 never accepts a v2 capability and vice versa. New capability does not grant
  v1 qualification, reconciliation, alternative extraction models or budget.
- E2: Recheck exact capability/policy/checkpoint on open and each request,
  including after caller accessors and before reservation. Preserve settled
  history, cancellation/timeout accounting, unknown costs, no refunds and shared
  phase ceiling. Partial/unsafe/changed capability files reject without repair.
- E3: Add createCandidateQualificationLiveSession with exact options
  {ledger,apiKey,fetchImpl,candidateQualificationExtension}. Reuse bounded parent
  routing; only baseline extract/qualifyCandidates/classify count+generation.
  No credential discovery/native fetch fallback/host completion/judge/reconcile.
  Preserve old session's strict options and method restrictions.
- E4: Reuse serialized attempt implementation by adding a separately named
  createCandidateQualificationAttempt with closed 36-HTTP/180000-microUSD caps
  and new method allowlist. Internal parameterization is allowed; existing
  createQualificationPilotAttempt retains its exact old limits/options/allowlist.
  No mode disguising or silently upgraded old factory. Keep old pilot/diagnostic
  entry points, fixed sources and recorded evidence unchanged. Per-request
  checkpoint/pin/persistence checks and permanent failure latch remain shared.
- E5: New explicit runCandidateQualificationPilot options exactly
  {ledger,expectedCheckpoint,apiKey,fetchImpl,nodePath,cairnExecutable,
  cairnArtifact,cairnArtifactSha256,privateDirectory,pins}. Freeze new six-case
  fixture, own operator/controller/session/guard/diagnostics/launcher/driver locks
  and installed artifact before I/O; verify pins before each request and artifact
  before first send. Exact canonical executable and private paths, executable Node.
  Reuse getQualificationPilotPins then add new files; no unpinned new helper.
- E6: Exclusive durable ledger-scoped candidate-qualification-heldout-v1-intent
  prevents rerun via another output directory. Local preflight/headroom/policy
  checks precede intent; provisioning E1 fixed authorization ID matching intent
  follows it. Preserve partial intent/capability/evidence, never reset old budget
  or retry a failed source. Only fixture messages go to capture_memory; no
  evaluator labels/query/answers or model-adjusted input.
- E7: Six fresh exact namespaces/databases, one fixed batch per case through
  actual installed v2 MCP+adapter via proxy/new parent guard. Only capture and
  qualification-aware inspect. Initialize all six cases not_run; retain failed,
  empty-admission and classification-failed outcomes explicitly. Structural
  invalid_model_output or context_budget_exceeded may continue to another fresh
  case; transport/timeout/accounting/persistence/pin/cap failures halt remaining
  cases permanently. No manual admission, source repair, binding or retirement.
- E8: Close/restart each completed case; inspect original IDs and replay in
  enforced read-only phase, with zero HTTP. Retain warm/cold records and replay,
  compare exact evidence. No semantic/currentness score from successful storage.
- E9: Retain bounded synthetic request bodies and post-guard parsed provider JSON
  (<=100000 request /262144 response bytes per request), never headers/keys;
  finite installed diagnostic events per case and capture/inspection envelopes.
  Root0700/files0600, defensive credential-echo redaction, finite errors, final
  writable failure/accounting report. Report source/prompt/operator/archive hashes,
  every case outcome and before/after known usage vs reserved budget/unknown costs.
  Missing diagnostic delivery remains explicitly non-probative.
- E10: Independent offline guard/session/controller tests prove E1–E4 with fake
  HTTP and temporary synthetic ledgers. Root actual installed runner verifies
  success36, first-invalid34, transport1 HTTP, all six denominators, no replay
  HTTP, intent reuse/partial intent, exact caps, no keys, and v1 denial even after
  candidate grant exists. Both Node22.16/24 generic/JSON/plugin/OpenAI/MCP/artifact/
  live-offline/ledger/guard +guard demos; fixed final Standards+Spec before live.

## Evidence plan

Six new source cases were authored by a no-context agent without repository,
fixture or implementation access. Root preserves its message text but converts
ambiguous field labels to semantic criteria (e.g. quoted versus reported both
acceptable when attribution is faithful). This is independently authored,
root-curated, not fully blinded. Expected criteria remain evaluator-only and
never enter a model payload. One attempt, no replacements or failed-source reruns.
Maximum36 HTTP reservations are US$0.18 within the original phase. A case may
produce multiple extracted memories and exceed fixed1024 output tokens; record
that failure, do not raise limits during the run. No registry release/deployment,
public security disclosure, general accuracy claim or competitor benchmark.
