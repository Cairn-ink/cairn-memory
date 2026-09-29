// Synthetic operation runner. Real hook modules execute in one isolated process;
// only stdin/stdout and fetch are replaced, avoiding hundreds of host processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as pairing from "../pairing.mjs";
import { readControlState } from "../control-state.mjs";
import { projectKey } from "../identity.mjs";
import { SEQUENCE_SEEDS, generateSequences } from "./sequences.mjs";

const parent = process.argv[2];
const hook = new URL("../../../plugins/cairn-memory/scripts/hook.mjs", import.meta.url);
const output = process.stdout.write.bind(process.stdout);
const priorCwd = process.cwd();
const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
const violations = [];
let home;
const check = (path) => {
  if (typeof path !== "string" && !(path instanceof URL) && !Buffer.isBuffer(path)) return;
  const full = resolve(path instanceof URL ? fileURLToPath(path) : String(path));
  if (full !== home && !full.startsWith(home + "/")) {
    violations.push(full);
    throw new Error(`sequence_write_outside_home:${full}`);
  }
};
// Guard the write syscalls, including writes through opened file handles. A hook
// swallowing an exception cannot hide a violation: the list is checked each step.
for (const api of [fs, fsp]) {
  for (const name of [
    "writeFile",
    "appendFile",
    "mkdir",
    "rm",
    "unlink",
    "chmod",
    "rmdir",
    "mkdtemp",
    "createWriteStream",
    "truncate",
  ])
    for (const method of [name, `${name}Sync`]) {
      if (typeof api[method] !== "function") continue;
      const original = api[method];
      api[method] = function (path, ...args) {
        check(path);
        return original.call(this, path, ...args);
      };
    }
  for (const name of ["link", "rename", "copyFile", "symlink"])
    for (const method of [name, `${name}Sync`]) {
      if (typeof api[method] !== "function") continue;
      const original = api[method];
      api[method] = function (from, to, ...args) {
        check(from);
        check(to);
        return original.call(this, from, to, ...args);
      };
    }
  for (const method of ["open", "openSync"]) {
    if (typeof api[method] !== "function") continue;
    const original = api[method];
    api[method] = function (path, flags, ...args) {
      if (typeof flags === "number" ? (flags & 3) !== 0 : /[wa+]/.test(flags)) check(path);
      return original.call(this, path, flags, ...args);
    };
  }
}
syncBuiltinESMExports();
const exists = async (path) =>
  fsp.lstat(path).then(
    () => true,
    () => false,
  );
const keyAt = async (root) =>
  fsp.readFile(join(root, "project-key"), "utf8").then(
    (s) => s.trim(),
    () => undefined,
  );
const id = (key) => createHmac("sha256", key).update("/synthetic/sequence").digest("hex");
let serial = 0;
let completedSequences = 0;
let sequencesWithPairHistory = 0;
const started = performance.now();
const coverage = new Map();
const sequences = generateSequences();
for (let index = 0; index < sequences.length; index++) {
  const { seed, operations } = sequences[index];
  home = join(parent, `home-${index}`);
  await fsp.mkdir(home, { mode: 0o700 });
  process.chdir(home);
  const roots = [join(home, ".cairn-memory"), join(home, "shared"), join(home, "next")];
  const profileA = join(home, "a");
  let profile = profileA;
  let option;
  let activeRoot = roots[index % 2];
  const pairRoots = new Map();
  const pairedProfiles = new Map();
  const pairedIds = new Map();
  const requests = [];
  const env = () => ({
    HOME: home,
    CLAUDE_PLUGIN_DATA: profile,
    CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: option,
  });
  const settings = () => ({
    home,
    env: env(),
    temporary: join(home, "tmp"),
    root: activeRoot,
    claudeProfileRoot: profileA,
    hostsStopped: true,
    consent: { claude: true, codex: true },
    configured: { claude: true, codex: true },
    standardClaudeOrigin: true,
  });
  const ownRoot = () => (profile === undefined ? roots[0] : resolve(home, profile));
  async function hookAction(action) {
    process.env.HOME = home;
    process.env.TMPDIR = join(home, "tmp");
    for (const [name, value] of Object.entries(env())) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete process.env.CAIRN_MEMORY_STATE_DIR;
    process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN = "synthetic";
    process.env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT = "http://127.0.0.1:1";
    process.env.CLAUDE_PLUGIN_OPTION_TELEMETRY = "false";
    const transcript = join(home, "transcript.jsonl");
    await fsp.appendFile(
      transcript,
      JSON.stringify({
        type: "user",
        uuid: `message-${serial}`,
        message: { content: "Please remember synthetic sequence examples." },
      }) + "\n",
    );
    globalThis.fetch = async (url, request) => {
      requests.push(JSON.parse(request.body));
      return { ok: true, status: 200, json: async () => ({ memories: [], memoryCount: 1 }) };
    };
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify({
          cwd: "/synthetic/sequence",
          prompt: "synthetic recall",
          session_id: "sequence-session",
          transcript_path: transcript,
        }),
      ]),
    });
    process.argv = [process.execPath, hook.pathname, action];
    let text = "";
    process.stdout.write = process.stderr.write = (chunk) => {
      text += chunk;
      return true;
    };
    process.exitCode = 0;
    await import(`${hook.href}?sequence=${serial++}`);
    const code = process.exitCode;
    process.exitCode = 0;
    return { text, code };
  }
  try {
    for (const operation of operations) {
      coverage.set(operation, (coverage.get(operation) ?? 0) + 1);
      const before = new Map();
      for (const root of roots)
        before.set(root, {
          marked: await exists(join(root, "paired-root")),
          key: await keyAt(root),
          pause: await readControlState(root),
        });
      const requestStart = requests.length;
      const actor = ownRoot();
      let result;
      let failure;
      try {
        if (["initialize", "adopt"].includes(operation)) {
          if (operation === "adopt" && !(await exists(join(activeRoot, "paired-root")))) {
            await projectKey(activeRoot);
            // Genuine default-root adoption with existing Claude cursors.
            await fsp.mkdir(join(activeRoot, "sessions"), { mode: 0o700 });
            await fsp.writeFile(
              join(activeRoot, "sessions", "a".repeat(64) + ".json"),
              '{"offset":1}',
              { mode: 0o600 },
            );
          }
          result = await pairing.initializePairing({ ...settings(), adopt: operation === "adopt" });
          if (result.pairingRecord) option = result.pairingRecord;
        } else if (operation === "complete") {
          result = await pairing.completePairing(settings());
          if (result.enabled) {
            pairedProfiles.set(profileA, result.root);
            pairedIds.set(profileA, id(await keyAt(result.root)));
          }
        } else if (operation.startsWith("reset-")) {
          const root = operation.endsWith("default") ? roots[0] : roots[2];
          result = await pairing.resetIdentity({
            ...settings(),
            root,
            confirmIdentityReset: true,
            primaryClient: operation.split("-")[1],
          });
          if (result.status === "identity_reset") {
            activeRoot = root;
            if (operation.includes("claude")) {
              pairedProfiles.set(profileA, root);
              pairedIds.set(profileA, id(await keyAt(root)));
              option = undefined;
            }
          }
        } else if (operation === "repair") {
          result = await pairing.repairIdentity({
            ...settings(),
            confirmKeyRepair: true,
            originalKey: pairRoots.get(activeRoot),
          });
        } else if (operation === "delete-key") {
          await fsp.rm(join(activeRoot, "project-key"), { force: true });
        } else if (operation.startsWith("coord-")) {
          const coordination = join(home, ".cairn-memory-clients");
          await fsp.rm(coordination, { recursive: true, force: true });
          if (operation === "coord-empty") await fsp.mkdir(coordination, { mode: 0o700 });
          if (operation === "coord-file") await fsp.writeFile(coordination, "unrelated");
        } else if (operation.startsWith("fresh-")) {
          profile =
            operation === "fresh-unset"
              ? undefined
              : operation === "fresh-relative"
                ? index % 2
                  ? "relative-profile"
                  : "missing/../.cairn-memory"
                : join(home, "b");
          option = undefined;
        } else result = await hookAction(operation);
      } catch (error) {
        failure = error;
      }
      // Invariant P: every successful operation in the exported inventory marks its root.
      if (
        result?.root &&
        ["binding_pending", "paired", "identity_reset", "key_restored"].includes(result.status)
      ) {
        assert.equal(
          await exists(join(result.root, "paired-root")),
          true,
          "P: successful mutation marked root",
        );
        const history = JSON.parse(
          await fsp.readFile(join(profileA, ".cairn-memory-profile", "binding.json"), "utf8"),
        );
        assert.equal(history.root, result.root, "P: successful mutation records profile binding");
        assert.equal(
          history.fingerprint,
          createHmac("sha256", await keyAt(result.root))
            .update("cairn-memory:binding:v1")
            .digest("hex"),
          "P: identity fingerprint",
        );
      }
      for (const root of roots) {
        const old = before.get(root);
        const key = await keyAt(root);
        const marked = await exists(join(root, "paired-root"));
        if (marked && key && !pairRoots.has(root)) pairRoots.set(root, key);
        if (old.marked && key !== undefined && key !== old.key) {
          assert.equal(operation, "repair", "K: marked root gained a key outside repair");
          assert.equal(key, pairRoots.get(root), "repair restores original identity");
        }
        // (b) unrelated never-paired profiles cannot borrow identity or controls.
        // (b') owning this root, including unset plugin data, permits EXISTING sharing.
        if (
          !pairedProfiles.has(actor) &&
          actor !== root &&
          old.marked &&
          ["recall", "capture", "pause", "resume", "status"].includes(operation)
        ) {
          const pairId = pairRoots.get(root) && id(pairRoots.get(root));
          assert.ok(
            requests.slice(requestStart).every((r) => r.project_id !== pairId),
            "b: unrelated identity",
          );
          assert.deepEqual(await readControlState(root), old.pause, "b: unrelated pause");
        }
        if (
          actor === root &&
          old.marked &&
          old.key &&
          !(await exists(join(root, "retired"))) &&
          ["pause", "resume"].includes(operation) &&
          result?.code === 0
        )
          assert.equal(
            (await readControlState(root)).paused,
            operation === "pause",
            "b-prime: own controls",
          );
      }
      if (profile === undefined && !option && ["recall", "pause", "resume"].includes(operation)) {
        const own = before.get(actor);
        if (
          own?.marked &&
          own.key &&
          !(await exists(join(actor, "retired"))) &&
          !(await exists(join(actor, ".cairn-memory-profile", "binding.json")))
        ) {
          assert.equal(result?.code, 0, "b-prime: own existing root remains available");
          if (operation === "recall" && !own.pause.paused) {
            assert.equal(requests.length, requestStart + 1, "b-prime: own existing key sends");
            assert.equal(requests.at(-1).project_id, id(own.key));
          }
        }
      }
      if (pairedProfiles.has(actor))
        for (const request of requests.slice(requestStart))
          assert.equal(
            request.project_id,
            pairedIds.get(actor),
            "c: paired identity never silently changes",
          );
      assert.deepEqual(violations, [], "d: every write is inside synthetic HOME");
      // Expected refusals must not hide implementation errors or failed assertions.
      if (failure)
        assert.match(
          failure.message,
          /^(binding_|paired_|pairing_|pending_|adopt|identity_reset_|retired_|invalid_|claude_|key_repair_|repair_|unsafe_|EEXIST|ENOTDIR|ENOENT)/,
          "unexpected operation error",
        );
    }
    completedSequences++;
    if (pairRoots.size) sequencesWithPairHistory++;
  } catch (error) {
    output(JSON.stringify({ seed, index, operations, failure: error.stack }) + "\n");
    process.exitCode = 1;
    break;
  }
}
process.stdout.write = output;
Object.defineProperty(process, "stdin", stdin);
process.chdir(priorCwd);
output(
  JSON.stringify({
    sequences: completedSequences,
    sequencesWithPairHistory,
    seeds: SEQUENCE_SEEDS,
    runtimeMs: Math.round(performance.now() - started),
    coverage: Object.fromEntries(coverage),
  }) + "\n",
);
