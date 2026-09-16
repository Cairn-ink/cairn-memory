# Lightweight relation-definition comparison

Fixed base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`.
This is an isolated experiment, not a runtime default or database migration.

## Decision and acceptance

- RD1: Write a short, provisional relation guide distinguishing support,
  challenge, elaboration, replacement, reaffirmation and discussion continuation.
  Addition is a storage operation; considered/tentative/adopted are claim states.
  Specify direction, source/target meaning, positive and negative examples,
  same-subject/scope/time constraints and abstention. Only the two existing
  rationale wire types may be emitted in this experiment. Other distinctions
  explain why not to force a support/challenge; they are not implemented edges.
- RD2: Freeze ten fresh bilingual synthetic cases and a separate explicit
  required/allowed-edge rubric before provider calls. Include correct supports,
  premise challenges, considered and tentative alternatives, explicit changes,
  elaboration, reaffirmation, different actors/scopes, historical evidence and
  unadopted advice. Neither rubric nor case labels enter model input.
- RD3: Compare the unchanged existing relation prompt against that exact prompt
  plus the short guide. Same model, sources, wire schema and token ceilings;
  alternate arm order deterministically. Record all twenty slots including
  failures/unrun, original proposals and malformed output distinctly from empty.
  Do not write memories, create edges, change decisions or alter the core.
- RD4: An explicit operator reuses the existing USD50 durable ledger and
  immutable rationale capability, with exact settled checkpoint, transitive
  source pins and a new exclusive durable once-only intent. No grants, resets,
  credential discovery, retries or failure-case replacement. Expected forty
  HTTP requests including token counts, hard additional cap sixty-four requests
  and USD0.32 conservative reservations. All calls use the existing guarded
  transport; unknown costs retain reservations. Fail-stop on transport,
  persistence, pin, accounting or cap failure. Retain sanitized request/response
  or failure evidence and cleanup/accounting status in a private directory.
- RD5: Fake-HTTP tests verify both prompts and ordering, no rubric leakage,
  no storage mutations, malformed/failed/unrun preservation, permanent halt,
  one-shot refusal, pins/checkpoint/cap and injected-key redaction. Run generic,
  JSON and live-evidence offline gates on Node22.16 and24; independent Standards
  and Spec review must pass the frozen candidate before any actual paid run.
- RD6: Primary runs at most one paid comparison under the existing authorization
  after review. Compare unsupported extra edges, omitted required edges and
  complete-case outcomes, retaining all denominators. Independently inspect
  source semantics and report uncertainty, known/unknown cost and latency.
  Freeze any public synthetic result projection; no raw provider/private data.
  No reliability claim or default promotion from this small nonblind development
  sample. A negative result is a valid outcome, not a reason to rerun cases.

One bounded Sol/high implementation worker owns the experiment files; primary
owns integration, acceptance, paid execution and PR delivery. This independent
branch does not require PR136 to merge. No merge, release or deployment.

## Frozen experiment and verification map

The provider-facing fixture, separate rubric, and short guide were frozen before
any provider call. Their SHA256 digests are, respectively,
`95137a94a7702085889aa68df70d2b899488fde4b7aef9915d9610d749fb650f`,
`048786044462967a3bafe7fc4b8fcef6076319a46295133662188e9035d2a436`,
and `6622d642c652e0d70c9151b2d8cae012e973f16d8239a48b8622812327cadff4`.
The fixture contains only source memories and receipts. The rubric is never
loaded into model input. The ten cases span adopted support, changed premise,
two reasons, considered and tentative options, explicit replacement,
elaboration, reaffirmation, different actors, and historical choice plus
unadopted advice. The wire cannot express replacement, continuation or
tentative relationships; those distinctions require abstention rather than
pretending no conceptual relation exists.

Before any paid outcomes, independent Spec pre-review found that the
reaffirmation case's second receipt did not state its reason, making one allowed
support edge ambiguous. The fixture now explicitly repeats the same choice
*because of* the same reason, and its rubric accepts any of the four directed
supports as coverage. Multiple valid supports are allowed: this case checks
relation type and scope, not minimal edge precision. A later corroborating
source supporting the earlier decision does not claim that the later message
caused the past choice. This is a pre-outcome fixture clarification, not
post-result tuning; the changed hashes above are the new freeze.

| Entry point / affected check | RD mapping | Owner and evidence |
| --- | --- | --- |
| `docs/relation-definition-lite-guide.md` | RD1 | Implementation worker; exact guide hash above and prompt equality fake-HTTP test. |
| `evaluation/live/relation-definition-fixture.json` and `relation-definition-rubric.json` | RD2, RD6 | Implementation worker; source-only fixture assertions, independent scorer with required/allowed/required-any tuples. Human source-semantic review remains required. |
| `evaluation/live/relation-definition-lite.mjs` | RD3–RD5 | Implementation worker; explicit one-shot operator, existing guarded session/attempt and immutable capability, exact checkpoint and transitive pins, twenty deterministic slots, 64 HTTP / USD0.32 additional cap. No core/store/host entrypoint changed. |
| `evaluation/live/relation-definition-score.mjs` | RD6 | Implementation worker; offline tuple counts retain total and scored obligations, proposed edges, unsupported extras, omissions, complete cases, and failed/malformed/not-run denominators. It does not replace source-semantic inspection. |
| `evaluation/live/test/relation-definition-lite.test.mjs` | RD1–RD6 offline safety | Implementation worker; Node22.16 focused fake-HTTP 9/9 passing after final changes. Primary owns independent Node22.16/24 generic, JSON and live-evidence gates, final acceptance, review and any paid run. |

The only changed model-facing path is the explicit operator. It invokes the
existing source-only core `proposeRationale` and real OpenAI adapter with the
current prompt or that exact prompt plus guide. Both arms retain the same
request-local source input, strict schema, model and token ceilings. The
operator never constructs a store or calls a mutation method. The existing
qualification-session/request-guard and qualification-pilot-attempt enforce
durable campaign transport; the local serialized cap further limits this run.
Any transport, pin, persistence, accounting or cap failure halts later slots.
Invalid model output is retained as malformed, not scored as empty or retried.

The [paid outcome](../relation-definition-lite-results.md) is now recorded with
source binding, request/cost uncertainty, latency, all denominators and
independent source-semantic inspection. No default promotion or retry follows
from this partial improvement.

An early primary Node24 focused run overlapped a live edit of the self-pinned
operator and halted on `pin_or_binding_changed`. This is expected pin-fence
behavior against an in-flight source mutation, not a stable-candidate test
result. Repeat the gate only after the implementation worker freezes files.

Primary reran the frozen implementation on Node22.16.0 and24.15.0:
`npm test` (106 passing each), `npm run validate`,
`npm run validate --prefix tools/plugin-validation`, and
`npm run test:live-evidence-offline` (246 passing,30 intentional installed-only
skips each;276 total). All passed. The nine new fake-HTTP checks run in that
suite. No typecheck applies to this JavaScript repository. Primary inspected
all seven new files; no core, schema, default, packaging or host changes.
Implementation owner: `relation_definition_impl`, Sol/high; primary supervised
fixture disambiguation, safety checks and denominator reporting. No routing
fallback was needed; agent token/cost measurements were not exposed.
After the pre-live Spec clarification, primary reran the complete
`npm run test:live-evidence-offline` suite on both runtimes:246 pass,30 skips,
zero failures each. Only fixture/rubric, their pins, focused assertions and this
record changed; generic/plugin/runtime code was unchanged.

## Execution and handoff evidence

Both independent reviewers (Sol/high, not implementers) passed the pre-live
candidate `bc17cf10561c3e9efc4a47be3d04be44463bc020` against the fixed base.
Standards found no hard violation (one non-blocking duplicated-safety-helper
heuristic); Spec's first-pass reaffirmation ambiguity was resolved before the
second review. Primary then executed exactly one guarded comparison: 40 HTTP,
USD0.20 reserved, USD0.006691 known-usage estimate, 20 unknown-cost count requests,
zero unsettled attempts and completed cleanup. Primary plus independent Spec
agent source inspection agree with all frozen scores; no post-outcome tuning.

Shared campaign checkpoint after the run: 2157 requests, USD24.986 conservatively
reserved, USD1.361273 known-usage estimates and 1004 unknown-cost requests. The
USD50 limit is unchanged; reservation headroom is USD25.014, not an invoice balance.

Primary owns the closed synthetic projection and outcome analysis; the bounded
implementation worker owns its offline frozen-result regression test. No source
engine/default/schema changed. The experiment answers the lightweight-definition
question with partial improvement, not attainment of general memory reliability.
After adding the frozen result regression, primary reran the full offline
evidence suite on Node22.16.0 and24.15.0:247 passed,30 intentional skips,
zero failures each. Primary also compared all twenty public edge lists directly
with the private run and checked the publication files for the injected key;
the projection matches and contains no key. The paid execution files and their
source hashes remain unchanged.
