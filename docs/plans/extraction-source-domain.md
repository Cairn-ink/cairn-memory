# Extraction source-index domain

Status: bounded adapter repair candidate; synthetic offline evidence only.

## Evidence and scope

The retained cohort records three `invalid_extraction_source_range` failures.
Their returned indices and provider response objects were not retained, so
neither the exact historical cause nor a semantic repair can be established.
The observable contract gap is narrower: the optional OpenAI extract schema
currently allows every nonnegative integer, while core accepts only the
batch-local source positions `0..messages.length - 1`.

This change is limited to the optional adapter's outgoing extract schema,
focused offline tests, and documentation. It does not change core validation,
prompts, default models, budgets, retries, admission, ledgers, or paid calls.

## Acceptance

1. For a canonical source batch of 1–24 messages, the outgoing strict extract
   schema permits source indices exactly `0..messages.length - 1` and rejects
   nonexistent indices. A zero-message direct adapter request can produce only
   `{ "items": [] }`, preserving existing offline callers.
2. The adapter rejects malformed source snapshots before any HTTP call, including
   missing, sparse, oversized, duplicate, reordered, or noncanonical indices.
   The request schema must never gain authority from caller-supplied labels.
3. Count and generation carry the same schema and detached serialized input;
   mutation during the count await cannot alter either request.
4. A malicious fake or custom adapter can still return invalid or duplicate
   references; core independently rejects the whole batch with zero admission.
   Valid references still produce receipts from the original source messages.
5. There is no automatic retry or policy change. Verification uses fake HTTP
   and synthetic temporary stores only. Passing it does not establish that the
   three retained failures are repaired or that source meaning is correct.

## Verification

First run the focused outgoing-payload test red against the base. Then run it
green, the existing adapter extraction/profile/transport/lifecycle/capture
tests, `npm test`, `npm run validate`, `npm run test:openai`, and
`npm run demo:openai-offline` on Node 22.16 and 24. Run applicable core safety
and plugin validation gates on both runtimes. Record exact outcomes and final
candidate SHA for fixed-diff review.

## Local candidate evidence

The pre-fix command on Node 22.16,
`node --test adapters/openai/test/extraction-source-domain.test.mjs`, failed on
the actual outgoing count payload: the one-message schema accepted source `1`
(`true !== false`). After the schema change, the same focused command passes
4/4. The new cases inspect outgoing schema and count/generation bodies; they
also check a zero-message request and malformed snapshots before fake HTTP.

On both Node 22.16 and 24.15, `npm run test:openai` passes 204/204,
`npm test` passes 110/110, `npm run validate` passes, and
`npm run demo:openai-offline` passes. The pinned maintainer
`npm run validate --prefix tools/plugin-validation` passes both marketplace and
strict plugin validation. `npm run test:experiment-request-guard` passes 163/163.
The focused core command
`node --test core/test/capture.test.mjs core/test/model-diagnostics.test.mjs`
passes 26/26 on both runtimes. Its named C02 case asserts original id, role and
excerpt receipts despite adapter/caller mutation; C04–C06 assert whole-batch
zero admission for duplicate and out-of-range custom-adapter references.

No provider request, paid retry, private corpus or production store was used.
