# Installed cold rationale recall regression

Base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`.
Scope: extend the existing installed synthetic lifecycle test, not runtime behavior.

## Acceptance

- CR1: After the existing two captures and warm rationale recall, close the MCP
  client/server and open a fresh installed MCP process on the same temporary DB.
  Recall through the normal tool with explicit `contextMode: rationale-evidence`.
  Assert unchanged root identity/revision, exact supporting/challenging receipts,
  and `reconfirmation-suggested`; rank input and returned rationale must agree.
- CR2: The reopened request performs selection/ranking only, not extraction,
  qualification, classification or relationship inference. Prove this from the
  fake HTTP methods and counts, not only equality of the final response.
- CR3: Preserve the existing separate keyless inspection, duplicate capture and
  forget checks. After forgetting the challenge, reopen once more with the fake
  provider and recall. The removed receipt/edge cannot return, the decision is
  still present, and the suggestion is `unassessed`, not a new adopted choice.
- CR4: All HTTP goes to the existing synthetic proxy with its temporary fake
  token. No real key, user database, paid call, provider policy/launcher edit,
  retry, cap increase, production or public release. Scripted links establish
  lifecycle correctness, not semantic relationship quality or broad reliability.
- CR5: Run the focused installed test and full artifact suite on Node22.16 and24,
  generic tests/validation and strict plugin validations. Primary personally runs
  the focused final candidate on both versions; independent Standards and Spec
  review the same committed diff before branch push/PR and latest-head CI.

## Ownership and limits

Bounded implementation worker: Sol/high for cross-process persistence and test
transport boundaries. Primary owns contract, inspection and final acceptance.
Allowed implementation files: this plan and
`packaging/test/automatic-rationale.test.mjs`. No runtime change is authorized by
this test task; an observed runtime failure is reported for separate diagnosis.
No merge, release or deployment in this scope.

## Worker verification record (pre-review)

The installed test now opens a fresh model-backed MCP process on the same
synthetic database after warm rationale recall and again after keyless
forgetting of the challenge. The cold result equals the warm result exactly,
including root identity/revision, supporting and challenging retained receipts,
and the rank candidate's linked rationale. Each reopened startup makes zero
fake HTTP calls; each recall makes exactly two selection and two ranking fake
HTTP calls, with no extraction, qualification, classification or relation
method. Existing keyless inspection, duplicate capture, incident inspection
and forgetting checks remain. After forgetting, the root and its own support
edge remain, while the challenging receipt/edge is absent and status is
`unassessed`. This is scripted lifecycle evidence, not semantic certification.

An initial focused assertion incorrectly expected no edges after forgetting;
the retained decision's self-support edge is valid. The test was corrected to
compare surviving edges against the warm set excluding only challenge-incident
edges, and to require no `challenges-premise` edge in this fixture. No runtime
defect or runtime change resulted. The corrected focused installed test passed
1/1 on Node 22.16.0 and 1/1 on Node 24.15.0.

On each of Node 22.16.0 and 24.15.0, the isolated MCP, OpenAI and maintainer
tooling `npm ci` commands passed; `node packaging/prepare-cache.mjs` passed;
`npm test`, `npm run validate`, `npm run test:mcp` (71/71), and strict
`npm run validate --prefix tools/plugin-validation` passed. The full
`npm run test:artifact` suite passed 66/66 on each runtime, with no skips.
All HTTP used the existing synthetic loopback proxy and temporary fake token;
no user database, real credential, paid call or production service was used.
Primary independently reran the unchanged focused installed test on Node
22.16.0 (1/1, 2806.615 ms, chunk `21ddfe`) and Node 24.15.0 (1/1,
2561.018 ms, chunk `6ae3f6`), both with no skips. Independent Standards/Spec
review remains pending. No push or PR was made by the implementation worker.
