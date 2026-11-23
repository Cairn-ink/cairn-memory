import assert from "node:assert/strict";
import { test } from "node:test";
import { redactV1, redactHostedCurrent, redactCore, PRIVACY_REDACTION_VERSIONS, REDACT_CORE_POLICY } from "../src/index.mjs";
import { assertText, cases, coreRefusal, expected, inputOf } from "./privacy-vectors.mjs";

test("redaction version numbers and union policy are pinned", () => {
  assert.deepEqual(PRIVACY_REDACTION_VERSIONS, { v1: 1, hostedCurrent: 2, core: 3 });
  assert.ok(Object.isFrozen(PRIVACY_REDACTION_VERSIONS));
  assert.equal(REDACT_CORE_POLICY, "union");
});

for (const vector of cases) {
  test(`redaction: ${vector.id}`, () => {
    const input = inputOf(vector);
    const row = expected[vector.id];
    if (row.redactCore.refusal) {
      assert.equal(row.redactSecretsV1.refusal, "TypeError");
      assert.equal(row.redactSecrets.refusal, "TypeError");
      for (const redact of [redactV1, redactHostedCurrent, redactCore]) {
        assert.throws(() => redact(input), coreRefusal(row.redactCore.refusal));
      }
      return;
    }

    const v1 = redactV1(input);
    const hosted = redactHostedCurrent(input);
    const union = redactCore(input);
    assertText(v1, row.redactSecretsV1);
    assertText(v1, row.clientRedact);
    assertText(v1, row.pluginRedact);
    assertText(hosted, row.redactSecrets);
    assertText(union, row.redactCore);
    const mask = "[REDACTED]";
    if (v1 !== input || hosted !== input) {
      assert.notEqual(union, input);
      assert.ok(union.includes(mask));
    }
    if (v1 === hosted) assert.equal(union, v1);
    assert.equal(redactCore(union), union);
  });
}

test("union keeps the full v1 match when hosted PAT masking hides the bearer boundary", () => {
  const input = `Bearer crn_pat_${"TESTONLY".repeat(4)}`;
  assert.equal(redactV1(input), "[REDACTED]");
  assert.equal(redactHostedCurrent(input), "Bearer [REDACTED]");
  assert.equal(redactCore(input), "[REDACTED]");
});
