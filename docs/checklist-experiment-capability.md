# Checklist experiment capability (offline delivery)

The [adapter integration](checklist-model-integration.md) deliberately left
existing experiment permissions unchanged. This package adds a separate,
selection-only capability on the existing durable campaign ledger. It does not
issue the real campaign's grant, increase its budget or run a model experiment.

The explicit `authorizeChecklistSelectionExtension` operation binds a distinct
`experiment-checklist-selection-extension.json` file to the ledger, policy,
authorization identifier and issuance checkpoint. The fixed method is
`cairn_selectChecklist`, using the existing baseline model. Authorization is
immutable and idempotent for the same identity; unsettled issuance, mismatched
or unsafe bindings are rejected. Older capability files remain untouched.

`createChecklistSelectionExperimentRequestGuard` validates that binding before
allowing the two existing Responses count/generation routes. It checks the exact
request-scoped schema and existing model/token/byte/time limits. It rejects
host-completion calls and all other methods, including baseline capture, select
and rank. Required noncandidate calls in a later comparison must retain their
existing separately scoped guards, not inherit permissions from this one.

The parent-only `createChecklistSelectionLiveSession` factory in
`evaluation/live/qualification-session.mjs` reuses the existing closed session
helper. Credentials are explicit; the session neither discovers environment keys
nor creates a ledger or grants. Caller options cannot select another method,
model or guard factory. Denials happen without provider I/O or reservation;
attempted provider work uses existing conservative settlement and no retry.

## Remaining execution gates

- Freeze fresh paired cases, rubric, model, adapter/compiler/schema source and
  operator hashes. Compare ordinary selection and the candidate within matched
  call, navigation and context limits; retain malformed and unrun cases.
- Rehearse success, guard/compiler denial, malformed provider output, transport
  interruption and cleanup using fake services before a paid attempt.
- Issue the real immutable capability only as part of that separately frozen,
  authorized operator workflow, using the existing campaign's remaining budget.
  A capability is not a new allowance or permission to access real conversations.
- Evaluate required-source retention, unrelated exposure and answer currentness
  separately. The new guard is a spending/transport boundary, not memory quality.
- Installed MCP wiring and downstream answer-faithfulness improvements remain
  distinct from an embedded-core selection experiment.

See the [acceptance plan](plans/checklist-experiment-capability.md). No publication,
deployment, default promotion or broad reliability claim is included.
