# Explicit qualification experiment capability (S4a)

Fixed base: `d8be5819f721fc00b5d6be4a70a2dee88a960432`.
S3b passed both runtime matrices and independent Standards/Spec review.
Local dependent work only; inherited private disclosure hold remains.

## Frozen contract

This prepares bounded fake-transport verification for a later one-shot synthetic
pilot. It does not run paid calls, access real keys/ledgers, reset a budget,
change existing experiment authorization or publish/deploy anything.

- G1: add `authorizeQualificationExtension({ledger,policy,authorizationId})`
  and `createQualificationExperimentRequestGuard({ledger,policy,
  qualificationExtension,fetchImpl})` through the existing request guard, not
  a second transport or ledger. Capability is independent of extraction and
  reconciliation extensions: exact baseline policy, fixed `cairn_qualify` and
  DEFAULT_MODEL only. Preserve all existing constructors and their allowlists;
  they still deny qualification even when its new file exists.
- G2: immutable `experiment-qualification-extension.json` holds version,
  authorizationId, exact ledger/policy, fixed method/model and settled creation
  checkpoint. Provision only against an existing bound policy and open settled
  ledger under its SQLite writer lock. Reuse safe 0600 exclusive/fsynced binding
  helpers; exact same authorization is idempotent, different/partial/unsafe
  bindings fail without replacing or repairing anything. No budget initialization
  or historical reservation refund.
- G3: verify the capability/token/file and ledger prefix at construction, on
  each request, and again after caller-controlled request accessors before any
  reservation. Preserve schema equality, local and remote token bounds, exact
  endpoint/model/framing, response/cancellation/unknown-cost settlement. New
  guard adds qualify to baseline methods only; it does not grant reconcile or
  alternative extraction models. Static adapter schemas export stays unchanged.
- G4: negative tests cover all three legacy guards denying count/generation
  after qualification provisioning, fake/missing/corrupt/symlink/hardlink/
  oversized/changed capability, invalid checkpoint, unsettled ledger,
  authorization mismatch, callback tampering, wrong model/method/schema/route,
  budget exhaustion and retained unknown count cost. Positive tests use fake
  HTTP and actual adapter count/generate framing. New tests join the ordinary
  request-guard command; existing extension tests still pass.
- G5: add `createQualificationLiveSession` in
  `evaluation/live/qualification-session.mjs`, with exact input
  `{ledger,apiKey,qualificationExtension,fetchImpl}`. It reuses the existing
  experimentPolicy and new guard, never default native fetch or new ledger.
  Validate key/transport before constructing the guard, permit at most US$50
  ledger limit, and expose only `request`, `getState`, `close`. Request accepts
  `/responses` and `/responses/input_tokens` and only baseline extract/classify/
  qualify formats; no host answer/judge/reconcile/alternative model route.
  Preserve caller cancellation and keep the real key inside the parent session.
  Old createLiveSession's US$20 contract remains unchanged. This session's
  cumulative ledger ceiling is not a per-pilot cap: later operator must enforce
  its smaller US$1/100-HTTP checkpoint delta and exclusive one-shot intent.
- G6: experiment-only cairn-launcher accepts exactly
  `--capture-qualification source-bound-v1` as optional configuration and passes
  it to the installed server. Invalid or duplicate options fail before opening
  its database/provider access. Old mode unchanged. Use existing authenticated
  loopback proxy; no new listener type or production endpoint.
- G7: actual installed MCP + installed adapter test through launcher/proxy/new
  session/guard with fake upstream HTTP captures and inspects qualified data,
  closes and restarts, replays with zero additional provider requests, verifies
  shared ledger conservation and that child sees proxy token rather than real
  key. Cross-route/old-session rejection precedes transport and reservation.
  No source-only capture may substitute for actual capture_memory invocation.
- G8: both Node22.16/24 generic/JSON/plugin, OpenAI/MCP offline, full offline
  live-evidence, ledger/guard tests and demos, installed-artifact gates; final
  frozen commit receives independent Standards and Spec review before pilot
  operator work or any real resource access. No core/qualification semantics,
  model prices, output ceiling, old fixtures or old failed results are changed.

## Following pilot, not performed here

Freeze new synthetic sources, expected observations, source/archive hashes,
operator, per-run caps and scoring before I/O. Reuse the existing US$50 phase
ledger without reset. Stop on unexpected ledger activity, transport/persistence
failure or cap exhaustion; count every failed/not-run case, do not rerun it into
a success. Report source-production semantics separately from protocol validity.
Source qualification still does not establish currentness or decision rationale.

## Local verification

Root ran the final G8 gates on Node 22.16.0 and 24.15.0. Each passed generic 31,
OpenAI 157, MCP 35, budget-ledger 15, request-guard 54 and installed-artifact 21
tests. Offline live-evidence passed 66 with 27 skipped, not 93 passes. JSON/
plugin validation and OpenAI-offline/budget/guard demos exited 0. Core and adapter
runtime are unchanged from the previously dual-verified S3b base.

The installed integration uses the actual launcher, installed MCP server and
installed adapter through the authenticated proxy and new session/guard. Six
fake HTTP requests reserve 30000 microUSD on a temporary synthetic ledger;
three successful count responses retain unknown actual cost. Cold replay makes
no new requests. No actual phase ledger, provider key or paid request was used.
An initially overstrict cancellation test expected a reservation for a request
already cancelled before dispatch; the existing guard correctly rejects it
before reservation. The final test asserts that stronger no-I/O behavior.
