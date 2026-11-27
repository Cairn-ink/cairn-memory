import assert from "node:assert/strict";
import { test } from "node:test";
import { PROCEDURAL_TAG_CASES, RECEIPT_ID_CASES, runCase } from "@cairn-ink/conformance";
import { SQLITE_ERROR_MAP } from "../src/index.mjs";
import { fixture } from "./storage-fixtures.mjs";

const factory = {
  name: "sqlite",
  async open() {
    const { adapter, close } = await fixture();
    return {
      adapter, close, embeddingDimensions: null, sessionRefs: "hashed", harness: {},
      nativeErrorMap: SQLITE_ERROR_MAP, busyNativeCodes: ["SQLITE_BUSY", "SQLITE_LOCKED"],
    };
  },
};

for (const testCase of [...PROCEDURAL_TAG_CASES, ...RECEIPT_ID_CASES]) {
  if (testCase.needsOff?.includes("proceduralTags")) continue;
  test(`${testCase.id} ${testCase.title}`, async t => {
    const reason = await runCase(factory, testCase);
    assert.equal(reason, testCase.pending ?? null);
    if (reason !== null) t.skip(reason);
  });
}
