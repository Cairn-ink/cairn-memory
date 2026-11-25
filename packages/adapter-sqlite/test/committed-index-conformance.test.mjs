import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMITTED_INDEX_CASES, runCase } from "@cairn-ink/conformance";
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

for (const testCase of COMMITTED_INDEX_CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
