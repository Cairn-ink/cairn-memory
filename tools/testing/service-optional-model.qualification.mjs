// Run explicitly with a locally available core-next base ref.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemoryService } from "../../packages/core/src/service/index.mjs";
import { captureTrace } from "../../packages/core/test/helpers/service-capture-trace.mjs";
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
  const refresh = ["run", "lock", "lock", "pause.get", "suppressions.snapshot", "capture.assertEligible", "capture.load"];
  const dispatch = actual.calls.findIndex(([method, , phase]) => method === "gate" && phase === "dispatch");
  const start = dispatch - refresh.length;
  assert.ok(start >= 0);
  assert.deepEqual(actual.calls.slice(start, dispatch).map(([method]) => method), refresh);
  const finishRead = actual.calls.findIndex(([method], index) => index > dispatch && method === "capture.load");
  assert.ok(finishRead > dispatch);
  assert.deepEqual(actual.calls.slice(finishRead - 4, finishRead + 2).map(([method]) => method),
    ["run", "lock", "lock", "pause.get", "capture.load", "capture.assertEligible"]);
  const refreshRun = 1 + actual.calls.slice(0, start).filter(([method]) => method === "run").length;
  const mutations = actual.mutations.map(mutation => {
    assert.notEqual(mutation.run, refreshRun, "the refresh has no mutations");
    return { ...mutation, run: mutation.run - Number(mutation.run > refreshRun) };
  });
  const normalized = { ...actual, calls: actual.calls.toSpliced(finishRead, 1).toSpliced(start, refresh.length), mutations };
  assert.deepEqual(normalized, expected);
  assert.equal(JSON.stringify(normalized), JSON.stringify(expected));

  const serialized = JSON.stringify(actual);
  const digest = createHash("sha256").update(serialized).digest("hex");
  process.stdout.write(`Hosted capture: ${expected.calls.length} base trace entries, ${actual.calls.length} current entries, ` +
    `${actual.mutations.length} writes, ${Buffer.byteLength(serialized)} bytes, sha256 ${digest}\n`);
} finally {
  await workspace.cleanup();
}
