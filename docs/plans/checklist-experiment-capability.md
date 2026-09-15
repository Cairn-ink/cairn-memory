# Separate checklist experiment capability

Dependent base: `05fd2e636bbecfe7abc19e2861949ab9eb2a89fc`.

The adapter exists but every existing paid guard rejects its new method. Add
one closed capability using existing durable budget machinery, not a new ledger
or permissive transport. This implementation is offline only; it does not issue
the real campaign's grant or start an experiment.

## Acceptance

1. Export `authorizeChecklistSelectionExtension(options)` and
   `createChecklistSelectionExperimentRequestGuard(options)`. The latter accepts
   only ledger, policy, fetchImpl and `checklistSelectionExtension`. Reuse the
   existing immutable authorization binding, issuance checkpoint, durable
   reservation/settlement and constructor validation. A distinct file named
   `experiment-checklist-selection-extension.json` binds only
   `cairn_selectChecklist` with the fixed baseline model. Older grants, baseline
   guards, schemas allowlists and campaign limits remain unchanged.
2. The new guard allows only exact request-scoped checklist schema/instructions
   framing on `/responses/input_tokens` and `/responses` under existing input,
   output, request/response-byte, timeout and reservation ceilings. It rejects
   hostCompletion, other methods, other models, caller-controlled dispatch,
   changed schema, redirects and unsupported fields before provider I/O or
   reservation. It does not claim schema adherence proves semantic correctness.
3. Preserve safe binding lifecycle: wrong ledger/run/policy/id/checkpoint,
   missing/tampered/symlink grants and unsettled issuance fail closed. Reusing the
   same valid authorization is idempotent, not an allowance reset. Check the
   capability again before requests. Failed provider calls retain conservative
   reservations and settle according to existing rules without retry.
4. Add a closed parent-only `createChecklistSelectionLiveSession` factory in
   `evaluation/live/qualification-session.mjs`; reuse its private closed helper.
   Only the new fixed guard/method/model
   and existing two paths are available. It takes explicit parent credentials,
   never discovers environment keys, and exposes request/getState/close. It
   cannot create a ledger, issue grants, dispatch arbitrary factories or add
   host/capture/rank permissions. Existing parent sessions stay unchanged.
5. Fake-service tests cover positive count+generate, schema/route/method/model
   denial, immutable binding lifecycle, zero-I/O/zero-reservation denial, token
   bounds, cancellation/failure accounting, session option/credential rejection
   and aggregate budget exhaustion. Prove old guards still reject the method
   even after the new grant exists. No real keys, provider requests or real
   campaign files are touched.
6. Add new guard tests to the existing explicit script list; run full guard and
   budget suites/demos, offline live-evidence suite, generic tests, JSON and
   strict plugin checks on Node22.16/24. Install isolated dependencies as required.
   Independent Standards/Spec review and all required CI precede merge. Document
   that a frozen operator, fresh paired cases, offline failure rehearsals and
   bounded real issuance/execution remain separate unfinished gates. No release,
   deployment, default promotion or quality claim.
