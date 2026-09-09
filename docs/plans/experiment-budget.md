# Persistent experiment budget foundation

Base: `7d0d6ec659f56a475e7001d02ffc22e62fedbf59` (#33/#34 merged).
Track A next slice: prerequisite for one guarded real-chat experiment spanning
host completions and Cairn requests. This is an offline accounting primitive,
not a live transport guard, pricing oracle, paid approval or completed chat run.

## Acceptance G01–G07

- G01: Node >=22.16 built-in SQLite ledger outside core, shared by independent
  processes using the same explicit path. Separate create-new and reopen APIs;
  never reset an existing ledger or silently create a missing one on reopen.
  Immutable run identity, positive safe-integer micro-USD limit and request cap.
  Reopen verifies identity and configuration; no default/refilled historical budget.
- G02: Reserve a caller-supplied conservative nonnegative safe-integer micro-USD
  upper bound atomically before any future request. Unique attempt ID and closed
  channel enum (host completion, Cairn count, Cairn generation). Duplicate IDs
  reject, including after restart; concurrent processes cannot overspend or
  exceed the cap. Failed reservations leave counters unchanged. No auto-retry.
- G03: Reservations are never refunded. Record succeeded/failed/unknown terminal
  outcomes once, optionally with actual safe-integer cost; missing/unknown usage
  stays unknown, not zero. A crash leaves a reserved unresolved attempt that
  still counts. Actual cost above reservation persists an overrun and blocks
  every later reservation. Conservative bounds must be enforced by future
  transport adapters; the ledger alone cannot cap a provider invoice.
- G04: Store only validated identities, channel, integer costs and outcome,
  never prompts, keys, transcripts, raw errors or arbitrary metadata. Closed
  option allowlists and safe fixed errors. Private 0700 new directory/0600 DB,
  real nonsymlink ancestors, no overwrite or destructive cleanup. Reopen rejects
  invalid schema/state and missing/symlinked files. Caller controls paths and
  must not concurrently replace filesystem objects; not an OS sandbox.
- G05: Synthetic temporary-file tests on Node22.16/24 prove normal lifecycle,
  no reset/reopen mismatch, two-process contention, duplicate attempts, exact
  ceiling, cap, zero-cost attempts, crash retention, terminal immutability,
  unknown/failed reservation retention, overrun fail-closed, malformed state and
  privacy/filesystem boundaries. No network, environment keys or paid calls.
- G06: Document exact API, invariant, runnable synthetic example and remaining
  host/transport wiring. No current Hermes/MCP/provider code or model defaults
  change. No claim G01–G05 satisfy the combined live guard in V05: request
  interception, pricing/request upper bounds, shared path wiring and end-to-end
  host failure tests must land before separately approved paid execution.
- G07: Add CI matrix gate, contributor tests/validation and changelog. Primary
  personally exercises cross-process/restart behavior; independent Standards
  and Spec review final committed candidate before push. No publication/merge.

## Ownership

Primary owns acceptance, integration and documentation. Sol high worker owns
the bounded SQLite ledger, tests and package/CI wiring. No private application,
Stripe, pricing lookup or provider account changes. Track B uses another worktree
and will consume this foundation only after reviewed live-run integration.

## Verification record

Worker and primary independently ran `npm run test:experiment-budget` on Node
22.16.0 and 24.20.0: 15/15 passed on each, including real spawned processes,
unresolved process exit, atomic ceiling/cap and immediate busy rejection.
`npm run demo:experiment-budget` passed on both; simulated numbers remain
clearly labeled. Primary also ran `npm test` (31/31) and `npm run validate` on
both runtimes, plus pinned Claude 2.1.260 marketplace and strict plugin
validation: all passed. All runs used sanitized environments without model keys.

Primary independently exercised a separate eight-child-process probe, not the
worker test implementation. A first process reserved 200,000 micro-USD, marked
it failed without usage, closed and reopened without refund; duplicate ID
reservation rejected. Eight new processes attempted 200,000 each against a
1,000,000 limit. Final Node22 and Node24 runs each accepted one child and
returned seven `ledger_busy` results, retaining 400,000 total and two attempts
after reopening. No result authorized spending beyond the configured ceiling.
An earlier prototype with connection timeout admitted four children; it is not
the final immediate-busy behavior and is not a throughput claim. Every attempt
and amount in these probes was synthetic; no network request occurred.

The independent probe script and separate ledger directories are retained in
the primary's synthetic temporary workspace, not bundled as user data. Its
observable scenario is covered by the checked-in tests/demo above. Primary
interventions added opaque IDs, coherent read transactions, sidecar checks,
fixed extended busy errors, safe construction cleanup, explicit busy testing
and non-vacuous concurrency assertions. Sol high owns implementation; separate
Sol high Standards and Spec reviewers inspect the frozen candidate. Exact
review SHA/results are recorded on the PR. Initial Spec review identified two
documentation gaps: missing contributor instructions for the new matrix and
an incomplete API return/error contract. Both are now documented explicitly;
the ledger implementation and verified runtime behavior are unchanged.
Agent cost/elapsed-time totals were
not measured. No private application, model profile, paid run or live host was
changed; G06's transport/price-bound/end-to-end gates remain pending.
