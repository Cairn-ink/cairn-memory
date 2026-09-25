# Source-qualified capture budget boundary: reproduce before repair

Fixed base: `d302abe4ba6a523a83b7660c05375335f79d6a6c` (PR #229).
Branch: `fix/qualification-budget-boundary`. Primary owns diagnosis acceptance
and the repair decision; bounded implementation owner GPT-6 Sol/high.

## Retained observed symptom

The fixed six-case development source-pair run halted after seven requests,
before any scoring. Each arm retains six unresolved slots; there is no semantic
accuracy result. The prefix arm's first batch returned `invalid_model_output`
and incomplete ingestion. The indexed arm later received a provider input-count
observation of 8,701 against a configured 7,024 ceiling, settling that attempt
unknown and producing a global dispatch halt. These are two distinct symptoms;
the first is not explained by the second. Do not claim the overflowing method
or a precise invalid-output cause until traced. Raw provider response bodies
may not be retained; a missing body is not evidence of a particular validator.

No paid retry, replacement case, old-policy modification, ledger repair,
reservation refund, credential access or held-out data access is in scope.
The seven attempts and their failure are immutable. The 30 reserved holdouts
stay untouched. Budget authority remains cumulative US$200, not new money.

Independent read-only accounting audit (GPT-6 Sol/high) confirmed all original
12,633 attempts unchanged, plus seven new attempts: current 12,640 requests and
US$86.206460 conservatively reserved. This run reserved US$0.035000; reported
generation usage accounts for US$0.007104, while four count requests have no
known actual cost (three successful counts and one unknown outcome). No pending
request or judge call remains. This is accounting evidence, not a semantic
result, billing invoice, or proof of the failure's cause.

## D1 — Tight feedback loop (first worker packet)

Use actual shared core, OpenAI adapter and request guard with synthetic sources,
fake HTTP and a new synthetic ledger. Reproduce the indexed qualified-capture
count boundary with deterministic generated extraction output and a legitimate
oversize input-count response. Exercise the real capture → prompt construction →
count → guard interaction, not a direct throw or an unrelated canned error.
Include a within-limit control. Distinguish a fixture that demonstrates the
guard's intended rejection from a prompt-shape reproduction that establishes
why a normal source-qualified request reaches it. Do not overclaim causation.

Produce one fast agent-runnable red-capable command and the smallest synthetic
fixture. Record the exact observed red verdict before any runtime repair. Do not
weaken the guard, alter ceilings, truncate evidence or change scoring to make
it green. Run on Node22.16 and24.15 with the isolated adapter dependencies.
Allowed initial edits: this plan and a focused regression test under
`evaluation/live/test/qualified-source-budget-boundary.test.mjs`. No runtime
edits or commits until primary accepts the red seam and freezes D2 below.

## D2 — Diagnosis before repair

Primary personally reran D1 on both pinned Node runtimes: control PASS and the
same intended global-halt assertion RED, each under one second. Test SHA256
`8b4eb96ef3e39b2c549d0aaee9abd1853dea829d8231b7c9897377c00e65913b`.
Before probing, ranked falsifiable hypotheses are:

1. Adapter local preflight omits strict output-schema or framing tokens. If so,
   measuring the complete request rather than a partial input will reveal the
   gap; a preflight-only synthetic probe should refuse before guarded count.
2. Qualification expands repeated evidence and/or schema per extracted item.
   If so, controlled item/candidate counts will explain request growth, and
   lossless bounded grouping should reduce per-call size without weakening
   source qualification. No grouping implementation is authorized yet.
3. Core/adapter default budgets differ from the pinned guard's input ceiling.
   If so, the observed configured bounds at the exact call boundary will differ;
   explicit matching values should change the early refusal point. Do not change
   the guard or real plan to test this.

Probe scope: synthetic-only measurement/assertions in the D1 test and this plan;
read relevant runtime code, but no runtime edits, paid calls, policy changes,
source truncation or fixture repair that obscures the retained red result.

After reproducing and minimising, primary records ranked falsifiable hypotheses
and a narrowly scoped repair. A guard catching an over-limit request is not
automatically a guard bug. Prefer a product-level bounded prompt/state solution
when evidence supports it. Preserve source attribution, qualification semantics,
staged evidence, namespace boundaries and honest partial/incomplete status.
Keep a separate investigation for `invalid_model_output`; if retained evidence
cannot identify its cause, say unknown and use synthetic reason-specific tests
or bounded source-free observability in a later contract.

## D1 reproduction checkpoint — synthetic only, before any repair

One focused test now drives a real indexed-window `openMemoryCore` capture with
`source-bound-v2`, the OpenAI adapter, a consumed qualified-pair capability,
the same guarded count/generation routes, a fresh synthetic ledger, and fake
HTTP. It generates four attributed source turns and four valid extraction
items. The fake count is the local tokenizer count of each complete serialized
provider request, including the dynamic strict schema; it is not a hard-coded
method/count response and is not the actual provider's tokenizer.

The fast red-capable command is
`node --test evaluation/live/test/qualified-source-budget-boundary.test.mjs`.
With the same fixture except one additional UTF-16 unit in each source turn,
the within-limit control yields a qualified-candidate count of exactly 7,024,
all three count/generation method pairs complete, capture succeeds, and the
guard remains open. The oversized case yields count 7,032 before qualification
generation; capture returns `qualification_failed`, the count attempt settles
unknown with actual cost null, and the guard globally halts. The desired
`halted === false` assertion is RED on both Node 22.16 and 24.15 in under one
second. An initial much larger fixture was rejected by the adapter's local
preflight before count, so it was not accepted as this reproduction; reducing
to four turns/four items exposes the intended count boundary.

This establishes that a naturally constructed source-qualified prompt can
reach the guarded count ceiling without a canned over-limit response. It does
not establish that the historic 8,701 was `qualifyCandidates`, that this
synthetic provider count matches the real tokenizer, or why the prefix arm
returned `invalid_model_output`. No runtime/guard/policy/cap change or paid
retry has occurred in D1.

## D2 synthetic probe checkpoint — no repair yet

The focused test now records the adapter/guard local preflight count, complete
serialized fake-provider request count, strict-schema contribution and bounded
source-candidate text contribution. These are deterministic counts under the
*local* tokenizer used by the fake provider; they are not a reconstruction of
the actual provider's 8,701-token response. On both Node 22.16 and 24.15,
`node --test evaluation/live/test/qualified-source-budget-boundary.test.mjs`
retains the D1 red test, while the within-limit and D2 probe tests pass
(2 pass, 1 intended red; about three seconds). No debug instrumentation remains.

For the four-item/four-source indexed case, adapter/guard preflight sees 2,379
tokens, below 6,000, while the complete serialized count request is 7,032,
above the guard's 7,024 input ceiling. The strict schema itself counts 4,561;
replacing only that schema with null reduces the full request by 4,558 tokens.
Removing source/item text from a measurement-only copy reduces it by 1,016.
These marginal contributions are not additive because tokenization depends on
surrounding JSON. H1 is supported for this synthetic seam: preflight excludes
the schema/framing that the provider count sees. The existing 6,000 local plus
1,024 framing reserve equals the 7,024 guard ceiling; count and generation
channels both advertise 7,024. A much larger fixture is refused locally as
`context_budget_exceeded` before qualification count, without guard halt. H3's
proposed *configuration mismatch* is not observed; the missing schema in the
local estimate, not a changed cap, explains this synthetic gap.

Holding four candidate sources and 114 source units fixed, three extracted
items produce 12 candidates and 5,564 complete-request tokens; four items
produce 16 candidates and 7,032. Holding four items fixed, one source per
item produces four candidates and 5,844 tokens versus 16 candidates and
7,032. The four-item schema contribution rises from 4,222 to 4,558 as the
candidate sets expand. Holding four items/sources fixed, 113 versus 114
source units yields 7,024 versus 7,032. H2 is supported: both per-item schema
repetition and repeated exact evidence enlarge the request. This is a
prompt-shape mechanism, not proof of the historic method or prefix failure.

The cheapest lossless candidate to investigate next is factoring the repeated
request-scoped strict schema with `$defs`/`$ref`, keeping the same four-item
response fields, candidate-index restrictions and core source compilation in
one call. It would require explicit schema-validator/guard compatibility and
provider-support tests; no such change is authorized or proven yet. Separately,
full-wire local admission could prevent a future over-limit count from
becoming a global unknown, but by itself would only refuse the case earlier,
not make the source exposure usable. Lossless per-item grouping is a fallback
if measured schema factoring is insufficient; it increases model calls and
would require new conservative projection/phase caps. No guard ceiling lift,
evidence truncation, semantic relaxation or paid retry is proposed.

## D2 repair contract — frozen after primary reproduction and probes

Primary reran all three synthetic tests on Node 22.16 and 24.15: both have
two passes and the same intended D1 failure. H1 and H2 are supported at this
synthetic seam; H3's configuration-mismatch explanation is not. The repair
owner remains GPT-6 Sol/high. No user decision or new provider access is needed.

The first repair is request-scoped qualification-schema factoring plus a
complete-wire local admission check for `qualifyCandidates`, not larger caps
or more model calls. OpenAI's [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
was searched and opened on 2026-09-25; its definitions section documents local
`$defs`/`$ref`. This establishes documented syntax support, not actual provider
token savings, account availability or live compatibility of this candidate.

Acceptance:

- D2a: Factor repeated candidate-qualification schema only. Expand all generated
  references in an independent test and require exact equality to the original
  schema across 1–5 items and varied candidate counts/non-contiguous indices.
  Keep known-value evidence requirements, item-local candidate sets, bounds,
  named slots and all core compilation checks. Do not generalize this into an
  arbitrary external-schema engine or alter other methods' wire formats.
- D2b: Count the complete serialized qualification count-request locally before
  any HTTP callback. Apply the existing 6,000 local ceiling as an additional
  conservative admission check. Preserve existing local checks and authoritative
  provider-count/output checks. Neither tokenizer is a guarantee about the
  other's exact result; guard behavior and all caps remain unchanged.
- D2c: Both original four-item fixtures must now complete real core capture and
  classification under the same guarded fake HTTP in exactly three count /
  generation pairs, with all four qualified memories, source receipts and
  anchors intact. Reopen the synthetic store and confirm persisted evidence.
  Do not make the test green by changing source text, counts, caps or success
  criteria. Retain the red checkpoint as local history before changing runtime.
- D2d: A still-too-large complete wire request must fail locally with
  `context_budget_exceeded`, make no qualification HTTP request, not globally
  halt the guard, and admit no partial batch. A subsequent small independent
  capture must remain usable. Malformed/foreign/missing evidence still fails
  closed; no retries, skipped items, truncation or silent unknown fallback.
- D2e: No new calls per capture, output budget, semantic policy, stored schema,
  protocol identity, ledger policy, dependency or packaging format changes.
  If factoring is insufficient, return measured evidence to primary before
  considering lossless grouping and a separately revised call projection.
- D2f: Retain the terminal paid failure honestly in limitations and this plan.
  The prefix invalid-output cause is unknown: retained artifacts have only
  `capture`/`invalid_model_output`, no method/subreason/raw body. This repair
  does not claim to fix that symptom or establish semantic reliability.

Allowed runtime: `adapters/openai/schemas.mjs` and `adapters/openai/index.mjs`
(a narrowly factored local helper only if genuinely needed). Allowed tests:
focused adapter qualification/schema tests and this integrated live-offline
regression. Documentation: this plan, `docs/limitations.md`, `CHANGELOG.md` and
the relevant technical provider document if behavior needs explanation. No
core algorithm, guard, phase projection, CI, dependency, model, corpus or paid
artifact change. Main personally inspects and reruns both runtime gates before
freezing the deliverable candidate for independent reviews.

## D3 — Verification and delivery (after D2)

Require red→green at the real seam, within-limit and oversized controls,
source/namespace/deadline regressions, and no budget or paid-protocol weakening.
Recheck CONTRIBUTING for all affected suites, personally rerun on both Node
versions, freeze the final diff and obtain independent Standards/Spec reviews
against this original base. Deliver via a dependent PR with exact-head all CI
and mergeability. No merge, release or deploy. A synthetic repair is not a new
semantic score or a reason to rerun the consumed six-case roster.
