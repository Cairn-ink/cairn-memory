import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { resolveClient, clientProjectId } from "../pairing.mjs";
import { snapshotHome } from "./sequence-snapshot.mjs";
import { rewriteHome } from "./interruption-home.mjs";

export const INTERRUPTION_OPERATIONS = Object.freeze([
  "initialize",
  "adopt",
  "adopt-temporary",
  "complete",
  "reset-claude",
  "reset-codex",
  "repair",
]);
const worker = fileURLToPath(new URL("./interruption-worker.mjs", import.meta.url));
const fingerprint = (key) =>
  createHmac("sha256", key).update("cairn-memory:binding:v1").digest("hex");
const optional = async (path) =>
  readFile(path, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
const json = async (path) => {
  const value = await optional(path);
  return value && JSON.parse(value);
};
async function run(input) {
  const child = spawn(process.execPath, [worker, JSON.stringify(input)], {
    env: { ...process.env, HOME: input.home, CLAUDE_PLUGIN_DATA: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => (stdout += data));
  child.stderr.on("data", (data) => (stderr += data));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const rows = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { code, rows, final: rows.at(-1), stderr };
}
// The oracle describes end state independently: no production identity helpers.
async function endState(home, operation) {
  const install = await json(join(home, ".cairn-memory-clients/install.json"));
  const roots = operation.startsWith("reset-") ? ["shared", "next"] : ["shared"];
  const state = { roots: {}, clients: {}, history: {} };
  for (const name of roots) {
    const root = join(home, name);
    const key = (await optional(join(root, "project-key")))?.trim();
    assert.ok(key, "finished operation has an identity");
    assert.equal(
      await optional(join(root, ".project-key.pending")),
      undefined,
      "finished publication removes its staged secret",
    );
    const creator = await json(join(root, "created-by"));
    if (creator) {
      assert.equal(creator.fingerprint, fingerprint(key));
      assert.equal(JSON.stringify(creator).includes(key), false);
      assert.equal((await stat(join(root, "created-by"))).mode & 0o777, 0o600);
    }
    const control = await json(join(root, "control.json"));
    state.roots[name] = {
      paired: !!(await optional(join(root, "paired-root"))),
      retired: !!(await optional(join(root, "retired"))),
      paused: control?.paused ?? false,
      creator: creator?.client,
    };
  }
  assert.equal(install.resetPending, undefined);
  for (const [client, binding] of Object.entries(install.clients)) {
    const key = (await optional(join(binding.root, "project-key"))).trim();
    assert.equal(binding.fingerprint, fingerprint(key));
    state.clients[client] = {
      root: binding.root.slice(home.length),
      state: binding.state,
    };
  }
  for (const profile of [home, join(home, "a")]) {
    const history = await json(join(profile, ".cairn-memory-profile/binding.json"));
    const key = (await optional(join(history.root, "project-key"))).trim();
    assert.equal(history.fingerprint, fingerprint(key));
    state.history[profile === home ? "codex" : "claude"] = history.root.slice(home.length);
  }
  state.ready = install.shared?.ready;
  return state;
}

export async function exerciseInterruptions(parent, operation, { source, onlyPoint } = {}) {
  const seed = join(parent, "seed");
  assert.equal((await run({ home: seed, operation, prepare: true, source })).code, 0);
  const uninterrupted = join(parent, "uninterrupted");
  await cp(seed, uninterrupted, { recursive: true });
  // Binding records contain absolute paths; cloned synthetic state must follow its HOME.
  await rewriteHome(uninterrupted, seed);
  const reference = await run({ home: uninterrupted, operation, source });
  assert.equal(reference.code, 0, JSON.stringify(reference));
  const expectedStatus = operation.startsWith("reset-")
    ? "identity_reset"
    : operation === "repair"
      ? "key_restored"
      : operation === "complete"
        ? "paired"
        : "binding_pending";
  assert.equal(reference.final.result.status, expectedStatus);
  const expected = source ? undefined : await endState(uninterrupted, operation);
  const points = reference.final.count;
  assert.ok(points > 0);
  const selected = onlyPoint === undefined ? undefined : 1 + (onlyPoint % points);
  for (let k = 1; k <= points; k++) {
    if (selected !== undefined && k !== selected) continue;
    const home = join(parent, `after-${k}`);
    await cp(seed, home, { recursive: true });
    await rewriteHome(home, seed);
    const interrupted = await run({
      home,
      operation,
      source,
      interruptAfter: k,
    });
    assert.equal(interrupted.code, 86, `${operation} write ${k}: ${JSON.stringify(interrupted)}`);
    const visible = new Map();
    for (const root of [join(home, "shared"), join(home, "next")]) {
      const key = await optional(join(root, "project-key"));
      if (key) visible.set(root, key);
    }
    if (!source) {
      const beforeReads = await snapshotHome(home);
      for (const actor of [
        { client: "claude", profile: join(home, "a"), delivered: true },
        { client: "codex", profile: join(home, "a"), delivered: true },
        { client: "claude", profile: join(home, "b"), delivered: false },
        { client: "claude", profile: undefined, delivered: false },
      ]) {
        const client = actor.client;
        const input = {
          home,
          client,
          env: {
            HOME: home,
            ...(actor.profile ? { CLAUDE_PLUGIN_DATA: actor.profile } : {}),
          },
          ...(actor.delivered
            ? {
                pairingRecord: join(home, ".cairn-memory-clients/pairing.json"),
              }
            : {}),
          usesClaude: false,
        };
        let binding;
        try {
          binding = await resolveClient(input);
        } catch (error) {
          assert.equal(error.constructor, Error);
          assert.ok(
            [
              "pairing_record_missing",
              "pairing_record_mismatch",
              "paired_key_missing",
              "binding_identity_mismatch",
              "pairing_needed",
            ].includes(error.message),
            error.message,
          );
          continue;
        }
        if (!actor.delivered && binding.enabled) {
          assert.equal(
            binding.root,
            actor.profile ?? join(home, ".cairn-memory"),
            "b/b-prime: unrelated profiles never select the custom pair root",
          );
          assert.equal(binding.createKey, true);
          continue; // Resolving a newcomer is read-only; do not mint its standalone key.
        }
        if (binding.enabled) {
          const key = visible.get(binding.root);
          assert.ok(key, "read paths cannot mint a key between interruption and retry");
          assert.equal(
            await clientProjectId(input, "/synthetic/interruption", binding),
            createHmac("sha256", key.trim()).update("/synthetic/interruption").digest("hex"),
          );
        }
      }
      // A successful probe may clean crashed key-publication staging/ownership.
      // All identity, binding, registration and control bytes must remain untouched.
      const withoutPublication = (entries) =>
        entries.filter((entry) => !/(?:^|\/)\.project-key\.(?:pending$|lock(?:$|\.))/.test(entry.path));
      assert.deepEqual(
        withoutPublication(await snapshotHome(home)),
        withoutPublication(beforeReads),
        "read paths never register or change durable identity/control state",
      );
    }
    const beforeRetry = await snapshotHome(home);
    const retried = await run({ home, operation, source });
    if (retried.code !== 0)
      assert.deepEqual(await snapshotHome(home), beforeRetry, "F: refused retry preserves state");
    assert.equal(retried.code, 0, `${operation} write ${k}: ${JSON.stringify(retried)}`);
    assert.equal(retried.final.result.status, expectedStatus, `${operation} write ${k}`);
    if (operation.startsWith("reset-") && k === points && !source) {
      assert.equal(retried.final.result.alreadyComplete, true);
      assert.equal(retried.final.result.writes, 0);
      assert.equal(retried.final.count, 0);
      assert.match(retried.final.result.disclosure, /no longer addressable/);
      assert.deepEqual(await snapshotHome(home), beforeRetry, "final reset retry writes nothing");
    }
    for (const [root, key] of visible)
      assert.equal(
        await optional(join(root, "project-key")),
        key,
        "K/c: retry reuses every visible winner",
      );
    if (!source)
      assert.deepEqual(await endState(home, operation), expected, `${operation} write ${k}`);
  }
  return points;
}
