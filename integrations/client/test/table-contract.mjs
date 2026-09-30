import assert from "node:assert/strict";

export function closedValues(value, vocabulary) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), Object.keys(vocabulary).sort());
  for (const [name, alternatives] of Object.entries(vocabulary)) {
    assert.ok(alternatives.includes(value[name]), `invalid result ${name}: ${value[name]}`);
  }
  return value;
}

export function assertResults(expected, observed, vocabulary) {
  closedValues(expected, vocabulary);
  closedValues(observed, vocabulary);
  assert.deepEqual(observed, expected);
}

export function assertEveryMutation(expected, observed, vocabulary) {
  assertResults(expected, observed, vocabulary);
  for (const [name, alternatives] of Object.entries(vocabulary)) {
    assert.throws(() => assertResults({ ...expected, [name]: "misspelled" }, observed, vocabulary));
    for (const alternate of alternatives.filter((x) => x !== expected[name])) {
      assert.throws(() => assertResults({ ...expected, [name]: alternate }, observed, vocabulary));
    }
  }
}
