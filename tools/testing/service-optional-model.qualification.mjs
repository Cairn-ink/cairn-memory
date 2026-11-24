// Run explicitly with a locally available core-next base ref.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemoryService } from "../../packages/core/src/service/index.mjs";
import { captureTrace } from "../../packages/core/test/helpers/service-capture-trace.mjs";
import { restoreCaptureTraceOrder } from "./fixtures/capture-trace-order.mjs";
import { createTestWorkspace } from "./workspace.mjs";

const base = process.argv[2];
assert.ok(base && !base.startsWith("-"), "usage: node tools/testing/service-optional-model.qualification.mjs <base-ref>");
const root = fileURLToPath(new URL("../../", import.meta.url));
const workspace = createTestWorkspace(null, { prefix: "service-model-parity-" });
try {
  const archive = join(workspace.path, "base.tar");
  execFileSync("git", ["archive", "--output", archive, base, "packages/core/src"], { cwd: root });
  execFileSync("tar", ["-xf", archive, "-C", workspace.path]);
  const previous = await import(pathToFileURL(join(workspace.path, "packages/core/src/service/index.mjs")).href);
  const expected = await captureTrace(previous.createMemoryService);
  const actual = await captureTrace(createMemoryService);
  const restored = { ...actual, ...restoreCaptureTraceOrder(actual, expected.calls) };
  assert.deepEqual(restored, expected);
  assert.equal(JSON.stringify(restored), JSON.stringify(expected));

  const serialized = JSON.stringify(actual);
  const digest = createHash("sha256").update(serialized).digest("hex");
  const restoredDigest = createHash("sha256").update(JSON.stringify(restored)).digest("hex");
  process.stdout.write(`Restored base capture trace sha256 ${restoredDigest}\n`);
  process.stdout.write(`Hosted capture: ${expected.calls.length} base trace entries, ${actual.calls.length} current entries, ` +
    `${actual.mutations.length} writes, ${Buffer.byteLength(serialized)} bytes, sha256 ${digest}\n`);
} finally {
  await workspace.cleanup();
}
