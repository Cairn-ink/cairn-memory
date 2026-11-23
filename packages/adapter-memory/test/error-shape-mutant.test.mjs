import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";

const testCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-2");
assert.ok(testCase);

function runWithFactConflict(replaceError) {
  return runCase({
    name: "memory error shape mutant",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      const { uow, harness, nativeErrorMap } = adapter;
      return {
        adapter: {
          ...adapter,
          uow: {
            async run(owner, options, fn) {
              try {
                return await uow.run(owner, options, fn);
              } catch (error) {
                if (error.code === "fact_conflict") throw replaceError(error);
                throw error;
              }
            },
          },
        },
        harness,
        nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      };
    },
  }, testCase);
}

class ForeignError extends Error {}

const malformedConflicts = [
  ["an Error without an own code", () => new Error("fact_conflict")],
  ["a foreign Error subclass with only code and message",
    () => Object.assign(new ForeignError("fact_conflict"), { code: "fact_conflict" })],
  ["an Error with the wrong kind",
    () => Object.assign(new ForeignError("fact_conflict"), { ...new CoreError("fact_conflict"), kind: "internal" })],
  ["a plain object with all fields",
    () => ({ ...new CoreError("fact_conflict"), message: "fact_conflict" })],
  ["a CoreError with the wrong retryable value", (error) => Object.assign(error, { retryable: true })],
];

for (const [description, replaceError] of malformedConflicts) {
  test(`K-FACT-2 rejects ${description}`, async () => {
    await assert.rejects(runWithFactConflict(replaceError), { message: "Expected CoreError fact_conflict" });
  });
}

test("K-FACT-2 accepts a CoreError from a second copy of core", async () => {
  const directory = await mkdtemp(join(tmpdir(), "core-errors-"));
  try {
    const copy = join(directory, "errors.mjs");
    await copyFile(new URL("../../core/src/errors.mjs", import.meta.url), copy);
    const { CoreError: OtherCoreError } = await import(pathToFileURL(copy).href);
    const error = new OtherCoreError("fact_conflict");
    assert.ok(!(error instanceof CoreError));
    assert.equal(await runWithFactConflict(() => error), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
