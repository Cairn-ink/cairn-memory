# 1b implementation checkpoint

Fixed base: `b18db1590e15d2190e0cba8482fe2278e9580567` (merged admission PR #10).
Acceptance is the complete capture contract and C01–C13 in
[the frozen preparation](https://github.com/Cairn-ink/cairn-memory/blob/11e83667c3d50f4dd83330ce1fd52f02cf789509/docs/plans/capture-orchestration.md)
from PR #11. That preparation need not be merged to implement its reviewed spec;
this PR does not duplicate its file or claim its merge.

Additional delivery acceptance:

- I1: Wire capture into the same facade/runtime, with no second persistence engine,
  schema migration, provider or hosted transport. Errors keep stable envelopes.
- I2: Synthetic integration tests and a source-runnable demo cover C01–C13; run
  all required gates and core tests/demos on Node 22.16 and 24. Model mocks prove
  source/control contracts, not semantic extraction quality.
- I3: Update current documentation and roadmap to reflect the user's explicit
  stacked-branch authorization: verified dependent work can continue before
  parent merge; no agent self-merges, publishes or deploys.

Primary owns facade, demo, docs/CI and integration. Worker owns new capture input,
orchestration and prompt modules. Independent test worker owns new capture tests.

Internal seam: captureMessages({model,input,operations}) returns the success value
or throws a MemoryStoreError. Primary validates the public exact namespace and
top-level allowlist; input.namespace is the canonical PUBLIC namespace (personal
projectId:null). Worker validates all other input and model/evidence fields.
Operations are existing envelope methods claimAdmission, finishAdmission,
abandonAdmission, get, map, classifyPlacement and applyPlacement. Worker unwraps
failures with their stable code; post-admission failures become classification
status as specified. No method bypasses the runtime's transaction helpers.
