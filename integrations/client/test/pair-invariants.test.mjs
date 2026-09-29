import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import * as pairing from "../pairing.mjs";
import { opaqueProjectId, projectKey } from "../identity.mjs";
import { SEQUENCE_SEEDS, generateSequences, OPERATIONS } from "../testing/sequences.mjs";

// Every public operation must be classified. New mutation exports cannot bypass
// the operation inventory and its successful-publication test unnoticed.
test("pair-root operation inventory covers the public mutation surface", () => {
  const readers = [
    "stateLocations",
    "detectClients",
    "parsePairingRecord",
    "probeClaudeFacts",
    "resolveClaudeBinding",
    "resolveClient",
    "clientProjectId",
    "localLiveness",
    "hasClaudeEvidence",
  ];
  const writers = new Set(pairing.PAIR_ROOT_OPERATIONS.map((operation) => operation.run));
  for (const [name, value] of Object.entries(pairing))
    if (typeof value === "function" && !readers.includes(name))
      assert.ok(writers.has(value), `${name} must declare its pair-root publication behavior`);
});

for (const operation of pairing.PAIR_ROOT_OPERATIONS) {
  test(`invariant P: ${operation.name} marks the resulting root`, async (t) => {
    const workspace = createTestWorkspace(t, { prefix: "cx2-operation-" });
    const home = join(workspace.path, "home");
    await mkdir(home, { mode: 0o700 });
    const root = join(home, ".cairn-memory");
    const options = {
      home,
      root,
      env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, "a") },
      temporary: workspace.path,
      standardClaudeOrigin: true,
      hostsStopped: true,
      consent: { claude: true, codex: true },
      configured: { claude: true, codex: true },
    };
    let extra = {};
    if (operation.name === "adopt") {
      await projectKey(root);
      await mkdir(join(root, "sessions"), { mode: 0o700 });
      await writeFile(join(root, "sessions", "a".repeat(64) + ".json"), '{"offset":1}', {
        mode: 0o600,
      });
      extra = { adopt: true };
    } else if (operation.name !== "initialize") {
      await pairing.initializePairing(options);
      // Remove marker to prove this operation itself establishes invariant P.
      await unlink(join(root, "paired-root"));
      if (operation.name === "complete")
        await unlink(join(options.env.CLAUDE_PLUGIN_DATA, ".cairn-memory-profile", "binding.json"));
      if (operation.name === "reset")
        extra = { root: join(home, "reset"), primaryClient: "claude", confirmIdentityReset: true };
      if (operation.name === "repair") {
        extra = { originalKey: await projectKey(root, { create: false }), confirmKeyRepair: true };
        await unlink(join(root, "project-key"));
      }
    }
    const historyPath = join(
      options.env.CLAUDE_PLUGIN_DATA,
      ".cairn-memory-profile",
      "binding.json",
    );
    const historyBefore = await stat(historyPath).catch(() => undefined);
    const result = await operation.run({ ...options, ...extra });
    assert.ok(result.root, result.status);
    if (historyBefore)
      assert.notEqual(
        (await stat(historyPath)).ino,
        historyBefore.ino,
        "binding operation republishes history through its helper",
      );
    const binding = JSON.parse(
      await readFile(
        join(options.env.CLAUDE_PLUGIN_DATA, ".cairn-memory-profile", "binding.json"),
        "utf8",
      ),
    );
    assert.equal(binding.root, result.root);
    assert.equal(binding.profileRoot, options.env.CLAUDE_PLUGIN_DATA);
    assert.match(binding.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(binding).includes(await projectKey(result.root)), false);
    assert.deepEqual(JSON.parse(await readFile(join(result.root, "paired-root"), "utf8")), {
      version: 1,
      paired: true,
    });
  });
}

test("invariant K guards both strict and legacy publication; only original-key repair restores", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cx2-mint-" });
  const home = join(workspace.path, "home");
  await mkdir(home, { mode: 0o700 });
  const options = {
    home,
    env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, "a") },
    hostsStopped: true,
    standardClaudeOrigin: true,
    consent: { claude: true, codex: true },
  };
  const { root } = await pairing.initializePairing(options);
  const originalKey = await projectKey(root, { create: false });
  await unlink(join(root, "project-key"));
  for (const strict of [false, true])
    await assert.rejects(opaqueProjectId(root, "/synthetic", { strict }), /paired_key_missing/);
  await assert.rejects(opaqueProjectId(`${root}/missing/..`, "/synthetic"), /paired_key_missing/);
  assert.equal((await pairing.initializePairing(options)).status, "paired_key_missing");
  await assert.rejects(readFile(join(root, "project-key")), { code: "ENOENT" });
  await assert.rejects(
    pairing.repairIdentity({
      ...options,
      root,
      originalKey: "99999999-9999-4999-8999-999999999999",
      confirmKeyRepair: true,
    }),
    /repair_key_conflict/,
  );
  await assert.rejects(readFile(join(root, "project-key")), { code: "ENOENT" });
  await pairing.repairIdentity({ ...options, root, originalKey, confirmKeyRepair: true });
  assert.equal(await projectKey(root), originalKey);
});

test("300 seeded operation sequences enforce P, K, b, b-prime, identity and containment", async (t) => {
  const sequences = generateSequences();
  assert.equal(sequences.length, 300);
  assert.ok(sequences.every((sequence) => sequence.operations.length <= 7));
  assert.deepEqual([...new Set(sequences.map((sequence) => sequence.seed))], SEQUENCE_SEEDS);
  for (const operation of OPERATIONS)
    assert.ok(
      sequences.some((sequence) => sequence.operations.includes(operation)),
      operation,
    );
  const workspace = createTestWorkspace(t, { prefix: "cx2-sequences-" });
  const child = spawn(
    process.execPath,
    [new URL("../testing/sequence-worker.mjs", import.meta.url).pathname, workspace.path],
    { env: { ...process.env, CLAUDE_PLUGIN_DATA: undefined }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  t.diagnostic(output.trim());
  assert.equal(code, 0, output);
  const result = JSON.parse(output.trim().split("\n").at(-1));
  assert.equal(result.sequences, 300);
  assert.ok(result.sequencesWithPairHistory >= 120, "substantial paired-state coverage");
  assert.deepEqual(result.seeds, SEQUENCE_SEEDS);
});
