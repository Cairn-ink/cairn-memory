# N36 execution and review contract — prospective, no paid invocation yet

Primary decision after the five-file offline preparation was independently
accepted. This supplements, never rewrites, the frozen S1–S6 quality thresholds.
Original frozen corpus SHA256 is
a5169b632c8a986fea37e6fec0d6def3e50b3c096d1b2ca2c5813c277ef83daa.
The twelve extraction source modules are byte-identical to runtime cce0c5511ef49b82e4a261b2d9f915124e7edb75; execution binds its actual runtime bytes and Node version.

## Question and limits

Does subdividing the same input into whole-message groups of at most ten
canonical windows improve faithful extraction of important source details?
Control: eight batches. Candidate: sixteen batches. Same baseline extraction
prompt, gpt-4.1-mini-2025-04-14, 6,000 input tokens, 1,024 output tokens,
five items per batch, four canonical windows per item. No changed prompt,
qualification, admission, MOC placement, retrieval, answer or judge pipeline.
This is a synthetic extraction experiment, not a competitive benchmark result.

Live limit, if accepted later: US$1 conservative new reservations, at most
48 total count/generation requests. Original cumulative US$400 ledger and
US$30 protected reserve remain; no reset/refund. The original ledger must be inspected immediately before any separately authorized grant.
The full conservative request envelope must fit before launch. This document
does not itself issue a capability or satisfy implementation/operation review.

Alternate logical arm order by case: odd cases control then candidate; even
cases candidate then control. Preserve original message order within every
candidate arm. Each batch gets exactly one count and at most one generation;
no retry, replacement, second seed, changed source, or rewriting an old run.
All eight cases and sixteen logical arms remain visible, including unexecuted
and structural refusal outcomes. Preserve bounded unmodified parsed extractor
output before receipt binding under the private evidence contract; exact HTTP
bytes are not required. Never retain credentials or headers. Do not add a
parallel accounting or HTTP engine.

## Fixed semantic adjudication

1. Credit each of the sixteen named anchors once per logical arm, never per
   item or per sub-batch. An anchor is retained only if at least one valid
   extracted item's actual claim expresses that anchor's complete material
   meaning AND that same item's attached canonical receipts support it.
   Merely citing a window containing the words is source coverage, not credit.
   Material meaning includes named subject, object/value, attribution, stated
   uncertainty, condition, relevant time, negation and non-adoption. Paraphrase
   is allowed; an exact quote is not required. Count exact source coverage
   separately as a diagnostic, not as the semantic score. Source coverage means
   that every frozen supporting passage for an anchor appears in attached
   receipts somewhere across that logical arm; distributed receipt coverage
   never substitutes for same-item semantic credit.
2. For anchor-7-1, require one item that expresses the complete recorded
   A→LC→CC→Slate→Kit North lookup relationship with all four required canonical
   windows attached. Four independently retained links do not earn this anchor;
   report them separately. Case8's five-window chain cannot satisfy the current
   per-item cap and is excluded from sixteen, but every resulting item still
   receives safety review. Narrow valid links are permitted; an unsupported
   complete-chain assertion is a citation-insufficiency error.
3. Inspect EVERY returned item, including unrelated assistant advice and all
   sub-batches, for unsupported promotion, citation insufficiency, attribution
   errors and chronology errors. Assistant advice must not become an adopted
   user preference or verified personal fact. Actual real-world truth of advice
   is not established by synthetic source attribution. Unsupported attribution
   is citation insufficiency; advice promoted to adoption is unsupported
   promotion. Rejected parsed proposals remain visible for diagnosis and review
   but earn no credit; the zero-error gate applies to valid, canonically bound
   claims, while structural refusal is separately counted. A rejected output
   is not silently repaired into a reviewable bound claim.
4. Distinguish batch-local fidelity from later current-state use. An early
   extraction is judged against information actually available in that batch;
   it is not wrong merely because a later batch corrects it. Case5's earlier
   18:00 claim can be a faithful historical extraction. Credit anchor-5-1 only
   for the corrected 19:00/not18:00/Pine-unchanged meaning with its proper
   receipt; retaining an unqualified old claim alone earns no such credit.
   Record coexistence of old/new claims and whether output explicitly marks
   correction. Do not invent supersession links or claim reconciliation.
   Earlier candidate 18:00 extraction establishes no later current state, even
   when faithful locally. A control batch containing the correction must frame
   the earlier value historically rather than presenting it as current.
   A batch that sees the correction but presents the old value as current has
   a chronology error. Case4's dates and ordered change must remain distinct.
   A later current-state projection needs a separate integration test even if
   this extraction experiment passes.
5. Two independent nonauthor reviewers see all returned claims and bound
   receipts, the relevant batch input and full source timeline for context,
   but no control/candidate labels, no hypothesis direction, no prior scores,
   no other review, and no retention-credit hints. Opaque labels and shuffled
   logical-arm order are fixed before model execution in a private mapping.
   Source/sub-batch structure can reveal partitioning, so report this as
   label-blinded review, not guaranteed treatment blinding. Reviewers judge
   per-item support first without anchors, then each independently maps the
   judged claims to the frozen anchors in a second phase, still without scores,
   treatment labels or the other review. Freeze phase-one judgments before
   revealing anchors. Automatic receipt coverage never supplies semantic credit;
   anchors are never sent into extraction inputs.
6. Both reviewers must agree for an anchor to count as retained; disagreements
   and unknowns stay visible and block advancement rather than being resolved
   by choosing a favorable score. Both must inspect every item and all sixteen
   logical-arm outcome positions. A refusal/not-run is not a semantic zero
   disguised as a completed run. A complete valid empty extraction earns zero
   anchors but is not a structural refusal. Report raw batch refusals and
   logical arms with any refusal separately; S5's no-increase comparison uses
   the latter (eight logical arms per condition): any structurally refused
   sub-batch makes its logical arm refused for that count. Valid bound items
   from its other completed sub-batches may still earn credit; the arm remains
   explicitly partial/refused, never wholly completed. Reviewers acknowledge
   each refused or not-run position without fabricating missing items.

Advancement requires all frozen S5 conditions jointly: at least two additional
candidate anchors out of sixteen; no control-retained anchor lost; both named
assistant anchors retained; no increased logical-arm structural refusals;
zero observed candidate unsupported promotions, citation insufficiencies or
chronology errors; no unknown or missing review. Any execution halt or not-run
blocks a passing quality conclusion. Report control safety issues as well.
No single scalar erases a safety failure.

## Required observations and stop conditions

Retain bounded unmodified parsed extraction observations before binding them, items,
validation/refusal codes, exact attached source identities and text, complete
slot order and durable completion/exit, request counts and shared-ledger
reservation deltas. The source mapping and canonical compiler must be the
frozen actual implementation. A compiler refusal remains visible; do not repair
the model's output in the experiment. Retention is not admission success.

Before paid calls: exact serialized request bodies and source/runtime/rubric
pins, roster order, actual adapter/guard/canonical compiler integration,
success and refusal outcomes, zero-send drift/replay denials, fake-HTTP
accounting/halt controls, success/failure owned cleanup, both supported Nodes,
primary verification and independent review. Generic indexed-extraction denial
must remain denied; a source-role-specific grant cannot silently authorize a
different corpus. Closed N30/N35 capabilities are never reused.

Malformed provider/usage, unsafe transport, unknown settlement, foreign ledger
row, stale pins, persistence failure or consumed claim: stop the entire operation,
retain evidence and no retry. Ordinary structural extraction refusal after a
successfully settled request may continue only to the next already-frozen slot
under the accepted extraction guard's rules.

## Product decision after the experiment

A pass only justifies a small opt-in integration proposal and fresh cold-session
tests for chronology, capture/admission/filing and recall. A fail is retained and
does not justify tuning these eight cases and rerunning them as fresh evidence.
Both outcomes must disclose increased aggregate item capacity, count/generation
cost, and unmeasured classification cost. Default MOC and production behavior
stay unchanged. No merge/release/deploy follows from this contract.
