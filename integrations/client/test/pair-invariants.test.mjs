import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile, stat, chmod, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import * as pairing from "../pairing.mjs";
import * as sourceIdentity from "../identity.mjs";
import * as builtIdentity from "../../../plugins/cairn-memory/lib/identity.mjs";
import { snapshotHome } from "../testing/sequence-snapshot.mjs";
import { opaqueProjectId, projectKey } from "../identity.mjs";
import { exerciseInterruptions, INTERRUPTION_OPERATIONS } from "../testing/interruption-cases.mjs";
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
    "projectKey",
    "installId",
    "opaqueProjectId",
    "rootMarker",
    "recordedPairRoots",
    "sameRoot",
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
        extra = {
          root: join(home, "reset"),
          primaryClient: "claude",
          confirmIdentityReset: true,
        };
      if (operation.name === "repair") {
        extra = {
          originalKey: await projectKey(root, { create: false }),
          confirmKeyRepair: true,
        };
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
    const codexBinding = JSON.parse(
      await readFile(join(home, ".cairn-memory-profile/binding.json"), "utf8"),
    );
    assert.equal(codexBinding.root, result.root);
    assert.equal(codexBinding.fingerprint, binding.fingerprint);
    assert.ok(codexBinding.roots.some((entry) => entry.root === result.root));
    const install = JSON.parse(
      await readFile(join(home, ".cairn-memory-clients/install.json"), "utf8"),
    );
    if (install.clients.codex)
      assert.equal(
        install.clients.codex.fingerprint,
        binding.fingerprint,
        "P: Codex uses the same fingerprint helper",
      );
    assert.equal(JSON.stringify(binding).includes(await projectKey(result.root)), false);
    assert.deepEqual(JSON.parse(await readFile(join(result.root, "paired-root"), "utf8")), {
      version: 1,
      paired: true,
    });
  });
}

test("identity source and bundle export only the safe identity facade", async () => {
  const expected = ["installId", "opaqueProjectId", "projectKey", "rootMarker"];
  for (const module of [sourceIdentity, builtIdentity])
    assert.deepEqual(Object.keys(module).sort(), expected);
});

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
  await pairing.repairIdentity({
    ...options,
    root,
    originalKey,
    confirmKeyRepair: true,
  });
  assert.equal(await projectKey(root), originalKey);
});

test("201 random sequences and 48 scripted fixtures enforce P, K, b, b-prime, identity and containment", async (t) => {
  const sequences = generateSequences();
  assert.equal(sequences.length, 249);
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
    {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: undefined,
        CX2_SEQUENCE_SOURCE_ROOT: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
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
  assert.equal(result.sequences, 249);
  assert.ok(result.sequencesWithPairHistory >= 100, "substantial paired-state coverage");
  assert.deepEqual(result.seeds, SEQUENCE_SEEDS);
});

// Mutation rows are parsed from the plan, not maintained as a parallel test list.
const operationPlan = (
  await readFile(new URL("../../../docs/plans/codex-client.md", import.meta.url), "utf8")
)
  .split("<!-- pairing-operation-table:start -->")[1]
  .split("<!-- pairing-operation-table:end -->")[0];
const operationRows = operationPlan
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .slice(2)
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim()),
  );
for (const [id, operation, damage, outcome, effect] of operationRows) {
  assert.ok(
    [
      "initialize",
      "adopt",
      "complete",
      "reset",
      "repair",
      "codex",
      "facade",
      "interrupt",
      "detect",
    ].includes(operation) ||
      ["reset-claude-default", "reset-codex-default", "reset-codex-custom"].includes(operation),
  );
  assert.ok(
    [
      "json",
      "mode",
      "directory",
      "key-replaced",
      "key-and-coordination-lost",
      "no-claude",
      "profile-conflict",
      "alias",
      "alias-root-lost",
      "pre-keyed",
      "invalid-backup",
      "root-file",
      "key-directory",
      "key-mode",
      "root-lost",
      "coordination-lost",
    ].includes(damage) ||
      (operation === "interrupt" && INTERRUPTION_OPERATIONS.includes(damage)),
  );
  assert.ok(["unchanged", "new-marked-binding", "same-end-state"].includes(effect));
  test(`operation table ${id}: ${operation} with ${damage}`, async (t) => {
    const workspace = createTestWorkspace(t, {
      prefix: "cx2-operation-table-",
    });
    if (operation === "interrupt") {
      const points = await exerciseInterruptions(workspace.path, damage);
      t.diagnostic(JSON.stringify({ interruptionOperation: damage, points }));
      return;
    }
    const home = join(workspace.path, "home");
    await mkdir(home, { mode: 0o700 });
    const root = join(home, "shared");
    const profile = join(home, "a");
    const options = {
      home,
      root,
      env: { HOME: home, CLAUDE_PLUGIN_DATA: profile },
      claudeProfileRoot: profile,
      hostsStopped: true,
      standardClaudeOrigin: true,
      consent: { claude: true, codex: true },
      configured: { claude: true, codex: true },
    };
    if (damage === "no-claude" || (operation === "initialize" && damage === "pre-keyed"))
      await pairing.resolveClient({
        ...options,
        client: "codex",
        usesClaude: false,
        initialize: true,
      });
    else {
      await pairing.initializePairing(options);
      await pairing.completePairing(options);
    }
    const binding = join(profile, ".cairn-memory-profile/binding.json");
    const originalKey = ["no-claude", "pre-keyed"].includes(damage)
      ? "33333333-3333-4333-8333-333333333333"
      : await projectKey(root, { create: false });

    if (damage === "json") await writeFile(binding, "{");
    if (damage === "mode") await chmod(binding, 0o644);
    if (damage === "directory") {
      await unlink(binding);
      await mkdir(binding);
    }
    if (damage === "key-mode") await chmod(join(root, "project-key"), 0);
    if (damage === "key-replaced")
      await writeFile(join(root, "project-key"), "11111111-1111-4111-8111-111111111111\n");
    if (damage === "key-and-coordination-lost") {
      await rm(root, { recursive: true });
      await rm(join(home, ".cairn-memory-clients"), { recursive: true });
    }

    if (damage === "profile-conflict") options.claudeProfileRoot = join(home, "b");
    let destination = join(home, operation.endsWith("default") ? ".cairn-memory" : "next");
    if (["alias", "alias-root-lost"].includes(damage)) {
      const alias = join(home, "alias");
      await symlink(home, alias);
      destination = join(alias, "shared");
    }
    if (damage === "pre-keyed") {
      const target = operation === "initialize" ? root : destination;
      await mkdir(target, { recursive: true, mode: 0o700 });
      await writeFile(join(target, "project-key"), "22222222-2222-4222-8222-222222222222\n", {
        mode: 0o600,
      });
    }
    if (damage === "root-file" || damage === "root-lost" || damage === "alias-root-lost") {
      await rm(root, { recursive: true });
      if (damage === "root-file") await writeFile(root, "synthetic file");
    }
    if (damage === "key-directory") {
      await unlink(join(root, "project-key"));
      await mkdir(join(root, "project-key"));
    }
    if (damage === "coordination-lost")
      await rm(join(home, ".cairn-memory-clients"), { recursive: true });
    const before = await snapshotHome(home);
    let result, failure;
    try {
      if (operation.startsWith("reset"))
        result = await pairing.resetIdentity({
          ...options,
          root: destination,
          primaryClient: operation.includes("codex") ? "codex" : "claude",
          confirmIdentityReset: true,
        });
      else if (operation === "repair")
        result = await pairing.repairIdentity({
          ...options,
          originalKey: damage === "invalid-backup" ? 12345 : originalKey,
          confirmKeyRepair: true,
        });
      else if (operation === "codex")
        result = await pairing.resolveClient({
          ...options,
          client: "codex",
          pairingRecord: join(home, ".cairn-memory-clients/pairing.json"),
        });
      else if (operation === "facade")
        result = await projectKey(damage === "alias-root-lost" ? destination : root, { home });
      else if (operation === "detect") result = await pairing.detectClients(options);
      else if (operation === "complete") result = await pairing.completePairing(options);
      else
        result = await pairing.initializePairing({
          ...options,
          adopt: operation === "adopt",
        });
    } catch (error) {
      failure = error;
    }
    if (failure) assert.equal(failure.constructor, Error);
    assert.equal(failure?.message ?? result?.status, outcome);
    if (effect === "unchanged") assert.deepEqual(await snapshotHome(home), before);
    else {
      assert.equal(await stat(join(result.root, "paired-root")).then(() => true), true);
      assert.equal(JSON.parse(await readFile(binding, "utf8")).root, result.root);
    }
  });
}

test("caught write failures roll back each explicit binding operation", async (t) => {
  for (const operation of pairing.PAIR_ROOT_OPERATIONS) {
    const workspace = createTestWorkspace(t, { prefix: "cx2-rollback-" });
    const home = join(workspace.path, "home");
    await mkdir(home, { mode: 0o700 });
    const root = join(home, "shared");
    const options = {
      home,
      root,
      env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, "a") },
      hostsStopped: true,
      standardClaudeOrigin: true,
      consent: { claude: true, codex: true },
      configured: { claude: true, codex: true },
    };
    let extra = {};
    if (operation.name === "adopt") {
      await projectKey(root);
      extra.adopt = true;
    } else if (operation.name !== "initialize") {
      await pairing.initializePairing(options);
      if (operation.name === "reset")
        extra = {
          root: join(home, "next"),
          primaryClient: "codex",
          confirmIdentityReset: true,
        };
      if (operation.name === "repair") {
        extra = {
          originalKey: await projectKey(root, { create: false }),
          confirmKeyRepair: true,
        };
        await unlink(join(root, "project-key"));
      }
    }
    const before = await snapshotHome(home);
    await assert.rejects(
      operation.run({
        ...options,
        ...extra,
        checkpoint: async (stage) => {
          if (stage === "before-commit") throw new Error("synthetic_write_failure");
        },
      }),
      /synthetic_write_failure/,
    );
    assert.deepEqual(await snapshotHome(home), before, operation.name);
  }
});
