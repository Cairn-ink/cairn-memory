# Read-only lineage verification for mixed-engine accounting

Fixed dependency base: `b1d4e825e44035d4d75656a817a84ebec4b480e2`
(bound embedding accounting, PR #236).
Branch: `feat/mixed-embedding-lineage`.
Primary owns this contract and acceptance. One bounded GPT-6 Sol/high worker
implements after the dependency's exact-head CI passes; independent nonauthor
Standards and Spec reviewers inspect the final fixed-base candidate.

## Purpose and boundary

The future Cairn/Mem0 comparison must retain the existing cumulative budget
authorization chain after an explicit v2 accounting migration. Reuse its
read-only lineage checks rather than copy the sensitive recursion or relabel
an old two-Cairn capability. This packet adds no authority to spend.

No operator ledger, credentials, corpus, holdout, or consumed paid-run helper
may be opened. All evidence uses new synthetic temporary data. No provider
request, actual migration, cap change, grant, claim, retry, refund, release,
deployment or merge belongs to this packet. It does not change ordinary Cairn
installation or provide a new memory-quality result.

## Observable acceptance

- M1 Add only this verification entrypoint to
  `evaluation/experiment-budget/request-guard.mjs`:
  `assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger, policy,
  benchmarkExtension, snapshot })`. Success returns `undefined`, never a
  handle, callback, capability or transport. Existing entrypoints retain their
  signatures and behavior, including their refusal of v2 ledgers.
- M2 Validate the exact four outer own-data fields. Recursively detach nested
  JSON-like values without invoking accessors. Reject symbols, sparse arrays,
  non-enumerable object fields, extra array properties (other than intrinsic
  `length`), unsupported prototypes/values and cycles. Bound traversal to depth
  32, 1,000,000 visited values and 16 MiB of
  cumulative UTF-8 key/string data, before constructing an unbounded serialized
  copy. These new-entrypoint limits must accommodate 50,000 five-field public attempt
  records plus the small lineage; prove that with synthetic in-memory values,
  not 50,000 SQLite writes. Do not refactor old callers onto this new validator.
- M3 Before binding-file access, require the exact nine-field B3 snapshot
  shape: `schemaVersion`, `runId`, `limitMicroUsd`, `requestCap`,
  `reservedMicroUsd`, `requestCount`, `state`, `attempts`, `historySha256`.
  Require schema 2; matching ledger identity/caps; safe counters and sums;
  unique valid attempt UUIDs; all four allowed channels; the existing outcome
  and actual-cost shapes; and lowercase 64-hex history digest. Mirror B's
  invariants: pending outcome requires null actual cost, but terminal actual
  cost may also be null; overrun state holds exactly when some known actual
  exceeds its reservation. Reject malformed claimed-open overrun state, not
  merely as busy. Also require B-compatible lexical directory validity:
  nonempty string, no NUL, resolving to a non-root path. Do not open a database
  to validate this supplied snapshot.
- M4 Require the existing chained US$200 parent. Reuse private
  `validateConstructor`, `verifyPairParent` and their existing recursive
  file-binding and original-prefix checks. Preserve the original policy and
  lineage semantics. No duplicate authorization recursion, v1 ledger loader,
  writable database open, file sync/write, claim creation or HTTP request.
  Binding reads remain bounded, read-only and no-follow. Success does not
  authenticate the supplied snapshot or its current suffix/digest.
- M5 Make provenance limits explicit. The old parent's original-prefix digest
  differs from B's full current rowid-aware witness. A future mixed guard must
  invoke this assertion on the authentic snapshot supplied inside B4's bound
  authorization transaction, then bind its entire current history to a distinct
  grant/claim. Read-only preflight may use B3. A supplied object, a well-shaped
  digest, or this assertion's return never independently grants authority.
- M6 Preserve inherited error classes and codes. Invalid outer/nested
  descriptors or unsupported detached values use
  `ExperimentRequestGuardError('invalid_options')`; malformed supplied B
  snapshots use `ExperimentBudgetError('invalid_ledger')`; well-formed pending
  or overrun snapshots use `ExperimentRequestGuardError('extension_busy')`.
  Existing constructor/policy/lineage errors retain their existing classes and
  codes. Errors contain no source text, paths, raw exception or secrets.
- M7 Build a real synthetic nonempty 50→100→200 chained history, explicitly
  migrate it to v2, and verify positive B3 and actual B4-callback paths. Confirm
  inputs, all ledger/binding bytes, directory entries and counters are unchanged
  by this assertion. Test missing/modified parent binding, changed original
  prefix, wrong identity/caps/policy, v1, pending, overrun, malformed accounting,
  nested accessors (zero getter calls), and traversal limits. Demonstrate that
  a supplied same-prefix/different-suffix snapshot with a syntactically valid
  digest can satisfy inherited lineage alone; never label that suffix authentic.
  Old v1 inspection and guard entrypoints must still reject actual migrated v2.
- M8 Run full budget, request-guard, live-evidence-offline, generic, JSON,
  pinned strict plugin/marketplace validation and budget/guard demos on both
  Node 22.16.0 and 24.15.0. Install only the existing isolated dependencies.
  Primary inspects the actual combined diff and independently exercises the
  new integrated path. Freeze a clean local candidate, obtain independent
  Standards/Spec review on the same fixed-base diff, correct and reverify, then
  push a dependent PR. Latest-head CI must pass before ready. There is no
  TypeScript gate in this JavaScript repository.

## Allowed scope

`evaluation/experiment-budget/request-guard.mjs`; one focused new test under
its `test/` directory; this plan; a narrow technical addition to
`docs/embedding-ledger-migration.md` and `docs/limitations.md`; and appending
the new test path to root `test:experiment-request-guard` without dropping old
tests. A descriptor-only snapshot helper stays private to the new entrypoint.

No ledger implementation, core, adapter, phase quota, runner, CI, dependency,
lockfile, pricing, model, host, public wire schema or actual operational data
changes. Report any interface mismatch instead of broadening this packet.

## Next gate

The distinct mixed capability/guard and revocable key-owning UDS gateway come
next, followed by matched rendering, runner, fairness and resource validation.
The original reserved 30 cases remain untouched for one joint S3 protocol.
This seam alone cannot justify migrating the actual ledger or starting it.

## Execution record

The primary clarified M2's original “six-field” wording: a B3 public attempt
has exactly five fields. The contract above and the positive 50,000-attempt
in-memory test use that existing shape; neither changes the ledger schema.
One new export is a read-only assertion. Its descriptor-first detacher is
private to this entrypoint, bounded at depth 32, one million visited values
and 16 MiB cumulative UTF-8 key/string bytes. It validates supplied B3
accounting after existing constructor validation and before chained-parent
binding and original-prefix checks. It never opens SQLite or returns a grant. The
existing constructors, pair parent inspector, B3/B4 ledger and all transport
callers remain unchanged. The newly affected caller is a future B4
authorization callback only; the focused test owns that integration path.

Focused evidence on Node 22.16.0 and 24.15.0: 6/6 pass, including actual
synthetic 50→100→200 lineage, nonempty mixed outcomes, explicit v2 migration,
B3 read-only and B4 callback paths, byte/entry/counter preservation, inherited
prefix and binding failures, descriptor getter count zero, malformed/pending/
overrun classes, and a 50,000-attempt valid in-memory suffix with only four
actual SQLite attempt rows. A same-prefix, different-suffix supplied snapshot
with a syntactically valid different digest passes inherited lineage by design;
the test never calls it authentic. The first focused run was 5/6 because its
test expected `unsafe_policy_binding` for a modified chain digest; the
existing verifier returned `policy_mismatch`. The assertion was corrected to
that inherited code; no product-runtime change followed from this test error.
Primary's separate pre-freeze synthetic acceptance exercised the nonempty
chain, B3/B4, missing-binding ordering, getter rejection, changed-prefix denial
and unauthenticated-suffix behavior on both Node versions. Dependency-base
absence of the new export was also checked. Final frozen-head primary
acceptance and independent reviews remain owned by primary.

On frozen candidate `120defa69b326067689718064f5d5c7fc942eee2`, primary
personally reran the integrated synthetic path and all 18 matrix gates across
both Node versions; every gate passed. Independent Standards and Spec reviews
of that same fixed-base diff each reported zero findings. This correction
round changes only the factual order stated in this plan and records those
results; primary will repeat affected checks and both review axes on the new
final head before push.

Both sequential Node 22.16.0 and 24.15.0 M8 matrices passed with isolated
OpenAI, MCP and pinned Claude validation dependencies installed:

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm run test:experiment-budget` | 58 pass | 58 pass |
| `npm run test:experiment-request-guard` | 255 pass | 255 pass |
| `npm run test:live-evidence-offline` | 340 pass, 30 expected skips | 340 pass, 30 expected skips |
| `npm test` | 112 pass | 112 pass |
| `npm run validate` | pass | pass |
| `npm run validate --prefix tools/plugin-validation` (pinned Claude 2.1.260, marketplace and strict plugin) | pass | pass |
| `npm run demo:experiment-budget` | pass | pass |
| `npm run demo:experiment-request-guard` | pass | pass |

No TypeScript gate exists. The work is offline synthetic verification only;
it provides no current-suffix authenticity, claim, credential owner, transport
authority, provider result or benchmark-quality inference.
