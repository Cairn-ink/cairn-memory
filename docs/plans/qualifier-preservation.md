# Paired qualifier preservation diagnostic

Dependent base: `bd22892b14a1763d7c6ada39bf2dcb0a50c4f056` (MCP staging).
Question: where can a tentative/conditional commitment become stronger than
its source: capture, retrieval or answer generation? Do not change prompts or
runtime to fit these cases. First delivery is an offline-verifiable protocol.

## Frozen design and acceptance

1. Six independent everyday scenario pairs, twelve histories total, each four
   messages and one question. Pair variants differ only in one user's decisive
   commitment sentence: provisional/conditional/considering versus explicit
   commitment. Each decisive qualifier appears once, not repeated in a recap.
   Cover differing actors, reasons that change, temporary scope and suggestions;
   no real people, personal data, medical/financial/legal guidance or permissions.
2. Separate fixture input from a scoring rubric. Model-facing input contains
   only source IDs/roles/text and question, never required source IDs, labels,
   expected answers or paired-variant classification. Six paired scenarios are
   the unit of interpretation, not twelve independent samples.
3. Each history captures exactly once over the injected MCP client with a
   unique stable batch ID. Close and reopen before inspection and retrieval.
   Inspect staged evidence separately, plus admitted receipts; staged text is
   never inserted into ordinary recall or used to rescue a failed capture.
   Recall once in source-evidence mode. No retries, model/prompt changes or
   skipped failed histories. All twelve history slots and twenty-four answer
   slots exist in the report even when operations fail.
4. Compare two answer inputs under identical question/instructions: retrieved
   source evidence and the complete canonical four-message source control.
   Reuse the unchanged `SOURCE_ANSWER_INSTRUCTION` baseline in both callback
   inputs; sourceKind is operator routing metadata, not a different prompt.
   The control is explicitly synthetic source input, not a fabricated Cairn
   receipt, production recall or authoritative truth. A failed capture leaves
   the retrieval answer not-run; the control may still be measured independently
   and must never turn that history into a successful memory-layer outcome.
5. Report mechanical retention and retrieval coverage separately from semantic
   judgment. Count exact qualifier availability and the required supporting
   source IDs for actor/reason/time review, preserving missing evidence and
   operation errors. Human-readable actor/reason/time expectations are not
   literal search strings and must not produce semantic correctness booleans.
   Preserve post-admission classification failures separately: saved memory
   remains saved and recall may proceed, but the report must retain the failure.
   Generated answers start unassessed;
   lexical matches cannot award semantic correctness. Record commitment
   amplification, attribution swaps, invented reasons and lost time limits in
   a separate review rubric. Any observed amplification blocks a blanket
   qualifier-fidelity claim. Preserve first attempts and partial failures.
6. The driver uses injected client/answer functions only: no credential lookup,
   provider requests, publication or deployment in this slice. Validate all
   fixture/rubric inputs before invoking callbacks. Each qualifier source must
   be the pair's single differing user message, not an unrelated unchanged quote.
   Callback mutation cannot
   alter the frozen input/rubric or later comparisons. Bound messages and report
   snapshots; close clients on failures. Exercise success, capture failure,
   recall failure, answer failure and cross-scenario namespace isolation using
   real shared core and scripted models. Verify rubric never reaches callbacks.

## Verification and later experiment

Both Node 22.16/24 offline evidence suites and new focused tests; generic JSON
and plugin checks. Fixed candidate needs independent Standards and Spec review
and all required CI successes. This slice must not claim installed/live evidence.

A later installed operator must freeze commit/archive/fixture/rubric/operator
hashes, rehearse failures offline, and use the existing cumulative US$50 ledger.
Proposed per-run ceiling: 240 HTTP requests, 24 answer generations, US$3 reserved;
no additional budget, retry or replacement of failed attempts. Actual execution
requires those gates and sufficient conservative remaining allowance, not merely
this plan. The user has not been asked to authorize a new independent budget.

If complete-source answers also amplify commitment, the diagnosis points to
answer consumption; it does not justify marking stored source text as verified
truth. If recall lacks the qualifier while admitted receipts retain it, investigate
retrieval. If staged source retains it but admitted receipts do not, investigate
capture omission without bypassing source qualification or admitting failed work.
