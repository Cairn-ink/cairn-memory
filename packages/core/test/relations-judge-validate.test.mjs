import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRelationVerdicts } from "../src/relations/judge.mjs";

const evidence = {
  candidateCount: 6,
  sourceIndices: [0, 1, 2, 3, 4, 6],
  messages: [{ role: "user" }, ...Array.from({ length: 5 }, () => ({ role: "assistant" }))],
};
const transition = (overrides = {}) => ({
  replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
  relation: "supersedes", valueChange: "changed", adoption: "explicit", ...overrides,
});
const validate = (...transitions) => validateRelationVerdicts({ transitions }, evidence);

test("validation keeps only actionable relations after validating every transition", () => {
  assert.deepEqual(validate(), []);
  for (const relation of ["reaffirms", "compatible", "unresolved", "historical_context"]) {
    assert.deepEqual(validate(transition({ relation, valueChange: "unchanged", adoption: "uncertain" })), []);
  }
  assert.deepEqual(validate(
    transition({ evidenceIndices: [0, 1, 2, 3] }),
    transition({ predecessorIndex: 1, relation: "contradicts", adoption: "not_adopted", valueChange: "unknown", evidenceIndices: [1] }),
    transition({ predecessorIndex: 2, relation: "contradicts", valueChange: "changed" }),
  ), [
    { predecessorIndex: 0, relation: "supersedes" },
    { predecessorIndex: 1, relation: "contradicts" },
    { predecessorIndex: 2, relation: "contradicts" },
  ]);
  assert.equal(validate(...Array.from({ length: 5 }, (_, predecessorIndex) => transition({ predecessorIndex }))).length, 5);
});

const { adoption: omitted, ...missingAdoption } = transition();
const invalidOutputs = [
  ["non-object response", null],
  ["absent transitions", {}],
  ["non-array transitions", { transitions: {} }],
  ["unknown response field", { transitions: [], extra: true }],
  ["sparse transitions", { transitions: Array(1) }],
  ["more than five transitions", { transitions: Array.from({ length: 6 }, (_, predecessorIndex) => transition({ predecessorIndex })) }],
  ["same predecessor even for discarded relations", { transitions: [
    transition({ relation: "compatible" }), transition({ relation: "unresolved" }),
  ] }],
];
const invalidTransitions = [
  ["missing transition field", missingAdoption],
  ["unknown transition field", transition({ extra: true })],
  ["unknown relation", transition({ relation: "related" })],
  ["unknown valueChange", transition({ valueChange: "changed-ish" })],
  ["unknown adoption", transition({ adoption: "implicit" })],
  ["invalid discarded verdict", transition({ relation: "reaffirms", adoption: null })],
  ["supersedes without changed value", transition({ valueChange: "unknown" })],
  ["supersedes without explicit adoption", transition({ adoption: "not_adopted" })],
  ["supersedes without a user message", transition({ evidenceIndices: [1] })],
  ["contradicts with unchanged value", transition({ relation: "contradicts", valueChange: "unchanged" })],
  ["nonzero replacement index", transition({ replacementIndex: 1 })],
  ["string replacement index", transition({ replacementIndex: "0" })],
  ["negative predecessor", transition({ predecessorIndex: -1 })],
  ["out-of-bounds predecessor", transition({ predecessorIndex: 6 })],
  ["fractional predecessor", transition({ predecessorIndex: 0.5 })],
  ["empty evidence", transition({ evidenceIndices: [] })],
  ["more than four evidence indices", transition({ evidenceIndices: [0, 1, 2, 3, 4] })],
  ["sparse evidence", transition({ evidenceIndices: Array(1) })],
  ["repeated evidence index", transition({ evidenceIndices: [0, 0] })],
  ["evidence outside source indices", transition({ evidenceIndices: [0, 5] })],
  ["evidence outside messages", transition({ evidenceIndices: [0, 6] })],
  ["non-integer evidence index", transition({ evidenceIndices: [0, 1.5] })],
];
for (const [title, output] of [...invalidOutputs, ...invalidTransitions.map(([title, value]) => [title, { transitions: [value] }])]) {
  test(`validation rejects ${title}`, () => {
    assert.throws(() => validateRelationVerdicts(output, evidence), { code: "invalid_model_output" });
  });
}
