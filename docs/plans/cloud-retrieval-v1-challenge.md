# Complementary retrieval: independent source-only development challenge

Packet B, local fallback; fixed base `52640f2278291d42e79597e542e2f039ccf6b29f`.
Owner: independent GPT-6.1 Sol High worker. Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/cloud-retrieval-v1-challenge`, branch
`test/cloud-retrieval-v1-challenge`. Cloud M1 remains FAIL; local readiness does
not waive it. No A implementation, results or controls were inspected before
this freeze. The public fixtures and this rubric are a development challenge,
not a blind holdout. No provider, model service, corpus, credential or operational
ledger is used. Runtime token/cost/allowance and peak resources are unknown unless
measured explicitly below. No paid or semantic QA evaluation is authorized here.

## Frozen acceptance rubric

The source fixture defines five targeted cases: changed premise, proposal versus
adoption, temporal applicability, natural-language navigation and namespace
collision. Every targeted case must deliver both required exact source passages
and their original submitted roles into the actual unchanged answer request.
Required indices and answer constraints are evaluator-only; neither is passed to
selection, rank, candidate assembly, or answer packing. There is no scripted QA
accuracy claim: the answer constraints describe why both passages matter, not a
model-scored result. A candidate that fails any case retains that failure.

Preconditions: each case has 54 earlier irrelevant history turns and an 18-card
rank-visible review shelf, including unrelated and instruction-bearing sources.
All original turns are admitted using trusted synthetic explicit source windows.
The source-visible selector chooses the visible `Review shelf:` label, while
the ranker chooses by query-word overlap in submitted receipt excerpts, ignoring
stored identities and evaluator fields. Required complements are visibly present
within the 36-card, 6,000-token input bound. Limit six leaves spare capacity after
the scripted seed. Natural navigation supplies an exact shared schedule phrase;
literal-navigation cases supply a repeated source code. We require retaining
explicit source context, not determining truth or adoption from navigation.

The ordinary unexpanded rank is a negative control: it must miss at least one
required passage in every targeted case. The very same delivery assertion must
go red against that ordinary arm. Identical fresh cold SQLite copies isolate
arms. Treatment runs real `core.recall`, authoritative `core.get` verification,
`verifiedRoleEvidence`, and unchanged `packMixedAnswer`. A passage in a candidate
pool or diagnostics alone cannot pass. Verify exact excerpts, roles, namespace,
revision, provenance coordinates, seed order and unchanged rank wire input.

Boundaries required for acceptance: validated empty rank and empty selection
deliver no evidence; no-spare-limit preserves unchanged seeds; mixed namespace
additions require a seed in that namespace; overflow omits a whole authoritative
role-evidence unit under the unchanged answer ceiling; correction or forgetting
during rank returns the core's `revision_conflict`, including a would-be added
source. Descriptor-safe malformed input/output, stale and duplicate references,
input/output token ceilings, detached immutable snapshots, cancellation and
output-counter mutation must retain the shared seam's typed failures. Every
rank delegates once, with original system/input/1024/signal and no new ports.
Diagnostics must contain strategy, exact addedRefs and semanticCoverage
`unassessed`; they do not establish relevance, safety or semantic completeness.

Candidate loading is lazy only to allow explicitly named precondition and
negative-control runs without A. A full suite without `candidate.mjs` fails with
the import error; there is no substitute candidate and no essential skip. Full
integrated acceptance is PENDING primary integration until every required test
actually executes on Node 22.16.0 and 24.15.0. The primary owns combined verification
and independent nonauthor Standards and Spec review; this worker makes scoped
local commits only, with no push, PR, merge or deployment.

## Evidence record

Fixture/rubric freeze commit and SHA-256 hashes will be reported immediately to
primary before implementing the test harness. The fixture and rubric above are
not revised in response to A behavior. Exact test commands, actual exits,
assertion counts, scratch cleanup and elapsed observations follow in a separate
append-only execution record below. Generic suites and validators are baseline
regression evidence; they cannot replace candidate-specific acceptance.
