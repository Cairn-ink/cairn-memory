# Disposition comparison: closed offline transport preparation

Fixed base: `e68d79f747e895a0dcffedcee3eda13d9793ba32`.
This dependent slice prepares a distinct capability for a later six-pair,
read-only comparison. It does not run that comparison, create a real grant,
load credentials, change the shared campaign ledger, or authorize automatic
memory updates. Implementation is delegated to one Sol/high worker; primary
owns comparison design and acceptance, with separate fixed-diff reviewers.

## Acceptance

- DP1: Add a separately named immutable 0600 disposition-comparison grant,
  authorizer and guard constructor. Permit only the pinned baseline
  `gpt-4.1-mini-2025-04-14`, `cairn_relate` and
  `cairn_reviewRationaleDispositions`, on the existing count/generation routes.
  Deny host completion, other models and every other method before any
  reservation or HTTP. Do not widen or rewrite any existing grant.
- DP2: Both methods must carry the exact same allowed input shape: indexed
  retained source memories and explicitly unverified old edges, validated
  using the disposition input contract. Output schema must equal the actual
  method's `schemasFor` result. Retain existing exact framing, local 6000-token,
  1024-output, response bounds, abort and no-retry protections. Prompt and
  fixture hashes remain a later operator preflight, not a claim of this guard.
- DP3: Reuse durable reservation-before-send, actual/unknown accounting and
  capability checkpoint verification, including revalidation after arbitrary
  request/header accessors and before reservation. Cross-kind tokens, changed
  capability files and unbound ledgers must fail closed. No ledger reset or
  refund. Old grants continue rejecting the new disposition method.
- DP4: Add a distinct closed live-session factory and one-shot attempt factory:
  24 HTTP requests, 120000 microUSD conservative reservation, 5000 per request,
  baseline only and the same two methods. Require full headroom and a settled
  exact campaign checkpoint under the existing cumulative US$50 maximum.
  Preserve serial fail-latched queue, pin checks, read-only phase and no retry.
  The factory is not a persistent exactly-once operator or fresh-run intent.
- DP5: Offline fake-HTTP tests prove both methods and phases work, all denied
  model/method/route/shape/schema cases spend zero, capability mutation during
  snapshot is caught, caps cannot be widened, accounting interference stops
  work, and a non-OK/unknown outcome halts queued work without refund. All
  ledgers and keys are synthetic. No shared ledger or real network model call.
- DP6: Update narrowly scoped experiment documentation and record limitations.
  Existing product defaults, core prompts, adapter profiles, static schema
  allowlists, MCP, graph persistence and previous scored evidence are unchanged.
  No launcher, fixture, control prompt, scorer or semantic result in this slice.
- DP7: Primary inspects the diff and independently runs relevant guard,
  budget, live-offline and generic/validation gates on Node 22.16 and 24.15;
  include required installed rationale wire gate and guard/budget demos.
  Serialize CPU-heavy suites to avoid the documented tokenizer contention.
  Freeze scoped candidate, obtain independent Standards and Spec review, then
  push a draft PR against main and verify latest-head CI before ready delivery.
  No merge, publication or deployment.

## Subsequent experiment contract (not implemented here)

Freeze an old-graph-aware full-set control instruction before writing fresh
cases. Both arms must see identical full source evidence and old-edge order,
use the same model and resource bounds, and only project a graph. Hand-seeded
old edges must be labeled as such. A closed seed database may be cloned only
after connection/WAL shutdown, with equality checked before model access.
Freeze fresh fixtures and semantic rubric before any scored call. Include
valid historical support, definitely wrong direction/scope, genuine current
challenges, retraction and genuine uncertainty. Do not score old cases again.

False withdrawal of a valid edge, retaining a definite wrong edge, losing a
genuine current challenge, incomplete coverage or malformed output blocks
consideration of a commit path. Unknown is not truth and cannot hide known
errors. Passing this small diagnostic would justify broader evaluation, not
automatic writes or a general reliability claim. A primary-owned pinned
operator, installed-artifact rehearsal, independent review, raw failure
retention and fresh one-shot intent are still required before paid requests.

## Offline implementation checkpoint

The scoped implementation adds one separate `DISPOSITION_COMPARISON_KIND` binding,
authorizer and guard constructor, a closed two-method baseline live session,
and a fixed 24-request/120,000-microUSD local attempt cap. The guard validates
the disposition input shape for both `relate` and disposition review while
checking the output schema for the actual method; earlier kinds, adapter and
core entrypoints are unchanged. The session exposes only count/generation
routes, and the cap does not create an intent or authorize transport by itself.

Worker synthetic verification on Node 22.16 and 24.15: focused DP tests
10/10 each; full experiment-budget/guard tests 111/111 each; ordinary live-
offline tests 265 passed with 30 intentional skips each; installed rationale
wire gate 4/4 each; generic tests 121/121 each; JSON validation and both
budget/guard demos passed on each runtime. The installed gate used fake HTTP
and locally built artifacts only. `git diff --check` passed. Tests assert that
all seven preceding guard kinds deny the new method, wrong or unbound grant
state and malformed old-graph input spend nothing, a 429 reserves exactly one
request before the queued attempt halts, and uncertain transport retains its
reservation. No real key, shared ledger, provider call or semantic comparison
was used. Primary acceptance, independent fixed-candidate review and CI remain
separate gates; elapsed time and model expense are not inferred here.

The initial disposition prompt and existing `relate` prompt differ in their
inline relation definitions. This transport slice neither changes either
prompt nor makes a fairness claim; a later comparison must pin and disclose
the exact instruction versions before fresh scored cases or paid requests.

## Pre-freeze request-byte correction

Independent Standards review identified a gap between parsed JSON validation
and the unchanged bytes forwarded by the new comparison guard. A synthetic
temporary-ledger regression reproduced that the prior candidate accepted a
non-round-tripping request before this correction. The guard now rejects, for
the disposition-comparison kind only, outer request and nested input text that
do not exactly round-trip through JSON parsing and serialization. It never
normalizes or rewrites provider bytes; older grant code paths are unchanged.
The regression checks both methods and both phases, including hidden duplicate
fields and noncanonical whitespace/escaping/numbers, with zero HTTP and zero
reservation. The valid real-adapter fake transport still passes unchanged.

Corrected candidate verification on both Node 22.16 and 24.15: focused DP
11/11, combined experiment-budget/guard 113/113, ordinary live-offline 265
passed with 30 intentional skips. `git diff --check` passed. The prior installed
rationale wire, generic, JSON and demo evidence pertains to the preceding
candidate; primary separately owns any final combined gates and fixed-diff
reviews. No real key, shared ledger or provider request was used.
