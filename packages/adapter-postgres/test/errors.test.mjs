import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "../src/errors.mjs";

for (const [code, expected, kind] of [
  ["55P03", "lock_timeout", "retryable"],
  ["57014", "statement_timeout", "retryable"],
  ["40001", "storage_busy", "retryable"],
  ["40P01", "storage_busy", "retryable"],
  ["08000", "storage_error", "retryable"],
  ["08006", "storage_error", "retryable"],
  ["08P01", "storage_error", "retryable"],
  ["57P01", "storage_error", "retryable"],
  ["57P02", "storage_error", "retryable"],
  ["57P03", "storage_error", "retryable"],
  ["57P04", "internal_error", "internal"],
  ["23505", "internal_error", "internal"],
  ["ECONNRESET", "internal_error", "internal"],
  ["constructor", "internal_error", "internal"],
]) {
  test(`maps ${code} to ${expected} without native details`, () => {
    const native = Object.assign(new Error("private native message"), { code, detail: "private SQL details" });
    const error = toPostgresError(native);
    assert.ok(error instanceof CoreError);
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal(error.kind, kind);
    assert.equal(error.retryable, kind === "retryable");
    assert.equal(error.cause, undefined);
    assert.equal(error.detail, undefined);
    assert.doesNotMatch(error.stack, /private native message|private SQL details/);
  });
}

test("preserves a code-only CoreError", () => {
  const error = new CoreError("database_error");
  assert.equal(toPostgresError(error), error);
  assert.equal(error.kind, "internal");
});

test("a throwing native code getter becomes a code-only internal_error", () => {
  const native = { get code() { throw new Error("private getter details"); } };
  const error = toPostgresError(native);
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, "internal_error");
  assert.equal(error.message, "internal_error");
  assert.equal(error.retryable, false);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.stack, /private getter details/);
});
