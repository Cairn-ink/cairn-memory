import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { missingCaptureDisable, rawImportControlsCase } from "@cairn-ink/conformance/raw-import-controls";
import { rawFactory } from "./fixtures/raw.mjs";

const testCase = rawImportControlsCase();
test(`memory ${testCase.id} ${testCase.title}`, async t => {
  const reason = await runCase(rawFactory(), testCase);
  assert.equal(reason, missingCaptureDisable);
  t.diagnostic("Window and enabled imports passed. The reference adapter has no namespace capture-disable control.");
  t.skip(reason);
});
