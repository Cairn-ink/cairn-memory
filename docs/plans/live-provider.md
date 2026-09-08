# Live provider lifecycle acceptance

Base: `5f17b4399ffdd6d7f5b1ee04e1fb106a2af163a9` (merged #16).
Scope: first live acceptance of the existing optional OpenAI adapter, not a
semantic benchmark, MCP server, release, or production migration.

## Acceptance (L01–L08)

- L01: An opt-in command runs a fixed synthetic capture → classify → recall →
  close/reopen → recall → correct → recall → forget → recall lifecycle using
  the real model ports and temporary SQLite. Extraction must produce the seeded
  preference with source bindings; classification must apply; recall must return
  its current revision and receipts. Forget must remove it from get/list/recall.
- L02: No implicit network calls from imports, ordinary tests, or CI. Live CLI
  requires an explicit live flag, a positive bounded budget and OPENAI_API_KEY.
  The runner never reads a whole project env or accepts a user database path.
- L03: The only remote endpoints are the adapter's fixed OpenAI count/generate
  endpoints, with pinned model and no redirects/retries/tools. Reserve a
  conservative cost before each request, including failed/unknown outcomes.
  Enforce request and cumulative spend bounds before network I/O; fail closed.
  Report reserved upper estimate separately from observed usage estimate; neither
  is an invoice or a provider-side account cap. Test budget rejection offline.
- L04: Report stage outcomes, request counts/statuses, token counts, elapsed time,
  model, runtime, fixture version and retained synthetic database. Never log keys,
  auth headers, raw provider responses or environment values. Errors are sanitized.
- L05: Test success, rejection, malformed responses, timeout/abort, budget
  exhaustion and redaction of errors using fake HTTP. Gate these in existing
  offline adapter CI on Node 22.16 and 24; actual live calls stay manual.
- L06: Run the actual provider lifecycle. Preserve failures as well as successes;
  do not weaken expectations after observing outputs or report a blocked run as
  passed. Any adapter/core fixes require focused regression tests and review.
- L07: Update delivery status and sequence: eight remaining PR packages are live
  acceptance, frozen evaluation, thin MCP, packaging/client matrix, first Hermes
  integration (subject to interface check), professional launch kit, private
  pinned-core adapter, private migration/rollback rehearsal. Public product at
  package six; production cutover remains separately approved. Evaluation
  fixtures/MCP contracts may proceed before live acceptance; scored quality and
  readiness claims may not. Preserve provenance, MOC, isolation, correction and
  forgetting plus the single public engine rule. Moss/full UI are deferred.
- L08: Independent Standards and Spec review on the verified candidate; no merge,
  publication or deployment. Report exact test evidence and remaining limitations.

## Live authorization and accounting

Owner approved proceeding after the proposed first-test US$5 total ceiling.
Only the existing local OpenAI key may be supplied to the process; synthetic
fixtures only. DRI alone executes paid requests and tracks all run reservations
against that total, never resetting the session budget when retrying.

Pricing checked 2026-09-08: pinned gpt-4.1-mini-2025-04-14, input $0.40 and output
$1.60 per million tokens. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Unknown token-count endpoint billing must not be assumed free: reserve the full
bounded request allowance for both endpoint types. No billing guarantee beyond
these documented rates; stop if pricing/request shape changes.

## Evidence

Run 1, 2026-09-08, Node 22.16.0: **provisional pass, superseded by review**. No earlier paid attempts in this
work package. Fixture `review-preference-v1`, pinned model above, fresh SQLite
retained locally (not committed). The DRI loaded only the key assignment into
the runner process; no application environment/database was used.

| Stage | Outcome | Elapsed ms |
| --- | --- | ---: |
| capture/classify | passed | 10391 |
| recall | passed | 4361 |
| close/reopen/recall | passed | 4250 |
| correct/recall | passed | 4470 |
| forget/get/list/recall | passed | 1192 |

Total 24665 ms; 18 HTTP requests (nine count/generation pairs), all HTTP 200.
Each generation's usage input count matched its preflight count, as enforced by
the adapter. By invocation, input/output tokens were: extract 340/33, classify
564/51, select 436/40, rank 448/40, select 436/40, rank 448/40, select 344/40,
rank 448/40, select 291/5. Generation total 3755 input, 329 output tokens.

Observed generation usage estimate: US$0.0020284 (not an invoice; excludes any
unreported count-endpoint charge). Nonrefundable conservative reservation across
both endpoint types: US$0.080064. Shared US$5 authorization remaining after this
reservation: US$4.919936. Run-local ceiling was US$0.25; no retries or parallel
paid runs occurred. Further runs must be recorded here without resetting that
shared allowance. Reports include no raw provider content or credentials.

Review found that checking the two extracted keywords admitted an opposite
preference. The lifecycle was exercised but that run is not sufficient final
L01 evidence. The corrected predicate accepts only anchored positive templates
preserving the diagrams-over-long-prose preference for code reviews; unknown
paraphrases fail closed. Contradictions, third-party preferences and unrelated
keyword overlap are regression cases. The predicate was fixed before rerunning.

Run 2, 2026-09-08, Node 22.16.0: **passed with corrected assertion**. Same frozen
source, model and lifecycle; no provider prompt changes. Stage times were
5249 / 3256 / 4335 / 4262 / 1254 ms in the table's order, total 18356 ms. All
18 HTTP requests were 200. Per invocation input/output tokens: extract 340/33,
classify 566/51, select 434/41, rank 447/41, select 434/41, rank 447/41,
select 345/41, rank 456/41, select 291/5. Total 3760 input /335 output;
generation usage estimate US$0.0020400, reservation US$0.080064.

Across both runs: generation usage estimate US$0.0040684; conservative reserved
total US$0.160128; remaining shared authorization US$4.839872. Both attempts are
retained here; the second, not the provisional first, supplies final L01 evidence.

This records synthetic integration lifecycles, not a semantic benchmark,
resource guarantee, real-human onboarding, standalone MCP, or commercial parity.
No provider/core changes were required by this run.

Offline verification: `node --test core/test/*.test.mjs` passed 177 tests on
Node 22.16.0 and 24.20.0. `node --test adapters/openai/test/*.test.mjs` passed
30 tests on both runtimes, including 14 new runner/guard tests. `node
examples/openai-offline.mjs` passed on both. `npm test` passed 31 plugin tests;
`npm run validate` and `npm run validate --prefix tools/plugin-validation`
passed. Optional packages were installed with `npm ci --prefix adapters/openai`
and `npm ci --prefix tools/plugin-validation`. No typecheck applies to this
JavaScript-only repository. Independent final-candidate review is next.
