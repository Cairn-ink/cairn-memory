import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { captureTrace } from "./helpers/service-capture-trace.mjs";

// The model-backed capture trace that service-optional-model.test.mjs qualifies against the
// core-next base with tools/testing/service-optional-model.qualification.mjs.
const QUALIFIED_TRACE = "10e76c2edb0fb103efb7340530e96854ebc3d19beb22596653df82436b487177";

/** @param {unknown} trace */
const digest = trace => createHash("sha256").update(JSON.stringify(trace)).digest("hex");

test("a model-backed capture keeps the qualified trace when Raw-only capture is unset or disabled", async () => {
  for (const rawCapture of [undefined, { enabled: false }]) {
    const trace = await captureTrace(deps => createMemoryService(
      rawCapture === undefined ? deps : { ...deps, config: { ...deps.config, rawCapture } }));
    assert.equal(digest(trace), QUALIFIED_TRACE);
  }
});
