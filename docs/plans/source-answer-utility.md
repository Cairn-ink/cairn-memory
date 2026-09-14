# Downstream source answer utility evidence

Base: `b0bcaeed4693113297896324cb1b73059f599e15`.

## Question and scope

Does the evidence returned by the installed capture/recall loop help a controlled
downstream consumer answer questions about decisions and their changing reasons?
Compare no memory, actual MOC source receipts, the existing lexical control's
source receipts, and those same MOC receipts plus its unassessed basis. Reuse the
four already-seen source-loop questions, not a new blind benchmark. This step
does not recapture memory, test a GUI/MCP host, change defaults, publish a package,
or establish general memory reliability.

## Acceptance criteria

1. Freeze the fixture and semantic rubric before the once-only paid calls.
   Preserve exact source-loop receipt text, order and basis; no oracle rescue or
   expected answers in model-facing inputs. Use the same safe consumer instruction
   and pinned model in every arm. Rotate arm order by case.
2. Retain all sixteen slots, exact model-facing bodies, raw answer text, finish
   reasons, failures, usage and conservative accounting. A fixed synthetic-only
   public projection must reject other fixtures and private/credential material.
   Provider/session identifiers and local paths do not belong in public evidence.
3. Enforce the existing US$50 ledger, at most sixteen host HTTP requests and
   US$0.80 reservations, durable once-only intent, no retry or model switching,
   and permanent halt after transport/guard failure. Rehearse successful,
   malformed and transport-failed paths without a provider key; independently
   review the operator before live execution.
4. Assess useful supported answers separately from appropriate abstention,
   unsupported additions/contradictions and missing requested details. No-memory
   abstention is not an incorrect answer or remembered knowledge. Explicitly
   examine whether incomplete basis links actually harm downstream answers.
5. Report every arm and caveat: development cases, one sample per arm, nonblind
   agent judgment, explicitly instructed consumer, synthetic source material,
   reused upstream retrieval. Do not promote a graph mode or claim MOC superiority
   from compilation counts or these four cases.
6. Add offline regression tests for exact projection, missing/failing slots,
   malformed/truncated output retention and privacy rejection. Run the full
   live-evidence offline suite on Node 22.16 and 24, generic tests, JSON validation
   and strict plugin validation. Freeze a candidate and pass independent Standards
   and Spec reviews before PR delivery. No production data or keys in tests.
