// Run explicitly with a locally available base ref.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemoryService } from "../../packages/core/src/service/index.mjs";
import { captureSendTrace, providerCalls } from "../../packages/core/test/helpers/service-capture-send-refresh.mjs";
import { createTestWorkspace } from "./workspace.mjs";

const base = process.argv[2];
assert.ok(base && !base.startsWith("-"), "usage: node tools/testing/service-capture-send-refresh.qualification.mjs <base-ref>");
const root = fileURLToPath(new URL("../../", import.meta.url));
const workspace = createTestWorkspace(null, { prefix: "service-capture-refresh-parity-" });
try {
  const archive = join(workspace.path, "base.tar");
  execFileSync("git", ["archive", "--output", archive, base, "packages/core/src"], { cwd: root });
  execFileSync("tar", ["-xf", archive, "-C", workspace.path]);
  const previous = await import(pathToFileURL(join(workspace.path, "packages/core/src/service/index.mjs")).href);
  const expected = await captureSendTrace(previous.createMemoryService);
  const actual = await captureSendTrace(createMemoryService);

  const refresh = ["run", "lock", "lock", "pause.get", "suppressions.snapshot", "capture.assertEligible", "capture.load"];
  const dispatch = actual.calls.findIndex(([method, , phase]) => method === "gate" && phase === "dispatch");
  const start = dispatch - refresh.length;
  assert.ok(start >= 0);
  assert.deepEqual(actual.calls.slice(start, dispatch).map(([method]) => method), refresh);
  assert.equal(actual.calls[dispatch + 1][0], "model.call");
  const finishRead = actual.calls.findIndex(([method], index) => index > dispatch && method === "capture.load");
  assert.ok(finishRead > dispatch);
  assert.deepEqual(actual.calls.slice(finishRead - 4, finishRead + 2).map(([method]) => method),
    ["run", "lock", "lock", "pause.get", "capture.load", "capture.assertEligible"]);
  assert.deepEqual(actual.calls.toSpliced(finishRead, 1).toSpliced(start, refresh.length), expected.calls);
  assert.deepEqual({ ...actual, calls: undefined, mutations: undefined },
    { ...expected, calls: undefined, mutations: undefined });
  const writes = trace => trace.mutations.map(({ method, args }) => [method, args]);
  assert.deepEqual(writes(actual), writes(expected));

  const serialized = JSON.stringify(providerCalls(expected.calls));
  assert.equal(JSON.stringify(providerCalls(actual.calls)), serialized);
  const digest = createHash("sha256").update(serialized).digest("hex");
  process.stdout.write(`Hosted capture: ${expected.calls.length} base trace entries, ${actual.calls.length} current entries, ` +
    `${actual.mutations.length} writes, ${Buffer.byteLength(serialized)} provider trace bytes, sha256 ${digest}\n`);
} finally {
  await workspace.cleanup();
}
