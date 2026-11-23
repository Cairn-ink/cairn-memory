import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CoreError } from "../src/index.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/privacy/${name}.json`, import.meta.url), "utf8"));
export const { cases } = fixture("cases");
const projection = fixture("expected");
export const { cases: expected, keyIds, withholding } = projection;
const { texts } = projection;
export const FAKE_MASTER = "FAKE-CONFORMANCE-ONLY-KEY";
export const FAKE_ROTATED_MASTER = "FAKE-CONFORMANCE-ONLY-ROTATED-KEY";
export const TEST_FINGERPRINT_LABELS = Object.freeze({
  keyIdDomain: "test-key-id",
  shingleKeyPrefix: "test-shingles:",
  legacyExactPrefix: "test-exact\0",
});
export const OWNERS = ["fake-owner-a", "fake-owner-b"];

export function decodeUtf16(encoded) {
  return encoded.replace(/\\u([0-9a-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function inputOf(vector) {
  return Object.hasOwn(vector, "inputUtf16") ? decodeUtf16(vector.inputUtf16) : vector.nonStringInput;
}

export function assertText(actual, index) {
  const recorded = texts[index];
  assert.equal(actual, decodeUtf16(recorded.utf16));
  assert.equal(Buffer.from(actual, "utf8").toString("hex"), recorded.utf8Hex);
}

export function coreRefusal(code) {
  return { name: CoreError.name, code, message: code };
}
