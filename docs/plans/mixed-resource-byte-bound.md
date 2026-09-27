# Aggregate fact-payload bound for mixed resource projection

Status: implementation contract, not accepted paid-run authority.

## Scope and ownership

Dependency base ecfe68c66622a35d726f6b868c9b523c940951b8 (PR245), isolated
branch fix/mixed-resource-byte-bound. This is a dependent branch under the
standing stacked-work authorization; do not change the frozen parent worktree.
Primary owns proof, integration and acceptance. GPT6Sol/high worker owns
mixed-resource.mjs, its resource tests, and focused documentation of the bound.
No memory algorithm, prompt/model/profile, source rendering, native code,
guard, operational ledger, grant, key, provider or original dataset change.

## Problem and proof

Current R reserves maximum tokens independently for three fact-embedding batch
calls and up to256 singleton fallbacks. Both request families can happen: a
later batch failure makes native Mem02.2.0 retry the entire fact list individually.
Never remove fallback or call it mutually exclusive with batching.

The fixed wire profile limits the complete accepted chat response, including
its normalized forwarded representation, to262144 UTF-8 bytes. Each selected
fact text is a disjoint substring after JSON decoding; decoding escapes cannot
increase its UTF-8 byte count beyond the containing response representation.
The native path forms mem_texts from only those facts. Ordinary cl100k byte-BPE
tokens each consume at least one byte; replacing LF with space adds no bytes.
Thus each complete embedding pass has at most262144 total tokens, not256
independent maxima of8192. Optional NLP is absent in the pinned native profile,
and its absence must remain verified by the existing native artifact/child gates.

For at most m nonempty requests whose summed tokens are at most T,
sum ceil(tokens_i/50) <= ceil(T/50)+(m-1). Minimum reservation1 is already
satisfied by every nonempty input's positive token count. Therefore:

- Batch family: at most3 requests, <=5245 microUSD per source batch.
- Singleton fallback family: at most256 requests, <=5498 microUSD per source batch.
- Count both, <=10743 microUSD, replacing the old independent59984 bound.

Use checked integer arithmetic and derive constants from the canonical profile.
Retain conservative request counts and every other stage exactly. Version the
resource projection to distinguish the tighter bound from historical reports;
do not rewrite old evidence or refund ledger reservations.

## Acceptance

R1: Same API/validation, native profile and monetary policy. Changed numbers
only for these two fact-embedding monetary stages and their totals/version.
Zero-batch results unchanged; requests unchanged for all cases, including
full fallback. No cost forecast or completion guarantee.

R2: Independent numeric goldens: one source batch/N1 joint278requests/209819
microUSD; N30/B30 joint8340requests/6294570microUSD. A synthetic30-case array
with total1477 batches has joint394689requests/89084675microUSD; these are
arithmetic fixtures, not a benchmark score or actual cost.

R3: Tests use actual inspectMem0WireRequest/Response and deterministic synthetic
facts, not merely the new formula copied into expected values. Cover empty,
1/99/100/101/256 facts, duplicate texts, LF, non-ASCII/escaped text, a response
near the accepted byte cap, and oversized/invalid responses. Show each valid
family's sum of actual per-request reservations stays below its bound; include
all batches plus all singleton fallbacks as the conservative combined path.
Document exactly why the pinned no-NLP native path permits at most two passes.
Include a boundary/mutant check that would reject undercounting fallback.

R4: Existing resource adversarial/overflow/profile/shortfall cases remain.
Generic npm test/validate and test:longmemeval plus ingestion/comparison/public
demos on pinned Node22.16 and24.15 per CONTRIBUTING. Install only locked isolated
OpenAI dependencies; no real provider or original dataset. Main independently
reruns key wire/bound paths and required integration gates; fixed candidate
commit reviewed by separate Standards and Spec agents before push/PR.

R5: Document proof, pinned-native assumptions and remaining request-cap gate
in existing mixed resource docs/limitations. Do not claim paid launch is ready:
same-dollar schema2 request-cap extension remains separate work. No mutation
of old private P30 outputs or old R reports. Any new projection explicitly
supersedes arithmetic only and does not alter source, answers or model behavior.

Worker must record raw commands/results and candidate hash; no push, merge,
release or deployment. The primary owns PR delivery after independent gates.

## Implementation and verification evidence

Actual implementation owner: GPT-6 Sol/high on the isolated dependent
`fix/mixed-resource-byte-bound` worktree at fixed base
`ecfe68c66622a35d726f6b868c9b523c940951b8`. The only runtime entrypoint
changed is `projectMixedResources(options)`; its validated canonical policy,
stage and wire-profile snapshots, input/error shape, request counts and all
non-fact monetary stages remain unchanged. The two fact-stage reservations now
use an aggregate byte-derived per-pass ceiling, with checked BigInt arithmetic
and explicit `mixed-resource-projection-v2`. No provider or operational entrypoint
is called by this pure module.

Focused tests use the actual Mem0 wire request/response inspectors for 0, 1,
99, 100, 101 and 256 facts, duplicated text, LF-to-space embedder input,
Unicode/escaped text and a deterministic low-compressibility response within
256 bytes of the accepted response-byte ceiling. They independently inspect
every batch and singleton request reservation. Oversized responses, 257 facts
and an overlong fact are denied. Fixed goldens assert all 259 possible fact
requests and both monetary families; removing the singleton family would fail
those assertions. These scripted responses establish wire acceptance and
arithmetic, not model generation likelihood or empirical spend.

The fresh worktree's first focused run stopped at the documented missing
isolated `tiktoken` prerequisite. `npm ci --prefix adapters/openai` installed
only the existing locked adapter set; no source change was used to make that
environment failure pass. Pinned plugin-validation tooling was likewise
installed with its existing lockfile. After prerequisites, the serial matrix
below passed on Node 22.16.0 and 24.15.0; raw logs are retained in the private
verification archive and available to the primary reviewer.

| Gate (each runtime) | Result |
| --- | --- |
| `node --test evaluation/longmemeval/test/mixed-resource.test.mjs` | 13/13 pass |
| `npm run test:longmemeval` | 178/178 pass |
| `npm test` | 112/112 pass |
| `npm run validate` | pass |
| `npm run demo:longmemeval-ingestion` | pass |
| `npm run demo:longmemeval-comparison` | pass |
| `npm run demo:longmemeval-public` | pass |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin pass |

`git diff --check` passed. This evidence does not include a native Mem0
execution, paid call, original corpus evaluation, request-cap authorization or
claim that the fixed-30 run is launch-ready. Independent fixed-diff reviews and
primary exact-HEAD verification remain separate delivery gates.
