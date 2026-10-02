import assert from "node:assert/strict";
import test from "node:test";
import { readFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import {
  BASE,
  observeStandalone,
  observeProfiles,
  observeProfileForms,
  candidateGolden,
} from "../testing/main-golden.mjs";
import { observeHosted } from "./observe-legacy.mjs";
const plugin = fileURLToPath(new URL("../../../plugins/cairn-memory/", import.meta.url));
const golden = JSON.parse(
  await readFile(new URL("./fixtures/claude-hosted-3a1c17d9.json", import.meta.url)),
);
test("frozen golden pins main 0.1.1 and its complete runtime source inventory", () => {
  assert.equal(golden.base, BASE);
  for (const file of [
    "lib/identity.mjs",
    "lib/version.mjs",
    "scripts/hook.mjs",
    "scripts/launch-capture.mjs",
  ]) {
    assert.match(golden.hashes[`plugins/cairn-memory/${file}`], /^[a-f0-9]{64}$/);
  }
  assert.equal(golden.standalone.length, 86);
  const candidate = candidateGolden(golden.standalone);
  for (const variant of candidate) {
    const requests = variant.requestBytes.trim().split("\n").filter(Boolean).map(JSON.parse);
    const starts = requests.filter(request => request.url.endsWith("/session-start"));
    const enabledStart = variant.mode !== "paused-standalone" && requests.some(request =>
      request.url.endsWith("/telemetry") && JSON.parse(request.body).event === "plugin_started");
    assert.equal(starts.length, enabledStart ? 1 : 0, variant.mode);
    for (const request of starts) assert.deepEqual(JSON.parse(request.body), {
      version: 1, session_id: "synthetic-session",
    });
  }
});
test("isolated plugin preserves no-history parity and explicitly refuses lost 0.1.2 history", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cx2-main-parity-" });
  for (const name of ["lib", "scripts"])
    await cp(join(plugin, name), join(workspace.path, name), { recursive: true });
  const actual = await observeStandalone(workspace.path);
  const expected = candidateGolden(golden.standalone);
  assert.equal(expected.filter((variant) => variant.mode.startsWith("local-marker-")).length, 8);
  assert.deepEqual(actual, expected);
  assert.deepEqual(await observeHosted(workspace.path), golden.hosted);
  assert.deepEqual(await observeProfiles(workspace.path), golden.profiles);
  assert.deepEqual(await observeProfileForms(workspace.path), golden.profileForms);
});
