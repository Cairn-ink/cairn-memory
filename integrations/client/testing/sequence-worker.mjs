// Synthetic operation runner. Real hook modules execute in one isolated process;
// only stdin/stdout and fetch are replaced, avoiding hundreds of host processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
const source = process.env.CX2_SEQUENCE_SOURCE_ROOT;
const moduleUrl = (name) =>
  source
    ? pathToFileURL(join(source, "integrations/client", name))
    : new URL(`../${name}`, import.meta.url);
const pairing = await import(moduleUrl("pairing.mjs"));
const identity = await import(moduleUrl("identity.mjs"));
const { readControlState } = await import(moduleUrl("control-state.mjs"));
const { projectKey } = identity;
import { snapshotHome } from "./sequence-snapshot.mjs";
import {
  SEQUENCE_SEEDS,
  generateSequences,
  REGRESSION_SEQUENCES,
  OPERATION_REFUSALS,
} from "./sequences.mjs";

const parent = process.argv[2];
const hook = source
  ? pathToFileURL(join(source, "plugins/cairn-memory/scripts/hook.mjs"))
  : new URL("../../../plugins/cairn-memory/scripts/hook.mjs", import.meta.url);
const reproduce = process.argv.includes("--reproduce");
const findings = [];
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
const sequences = reproduce ? REGRESSION_SEQUENCES : generateSequences();
for (let index = 0; index < sequences.length; index++) {
  const { seed, operations } = sequences[index];
  home = join(parent, `home-${index}`);
  await fsp.mkdir(home, { mode: 0o700 });
  process.chdir(home);
  const roots = [join(home, ".cairn-memory"), join(home, "shared"), join(home, "next")];
  const profileA = join(home, "a");
  let profile = profileA;
  let option;
  let activeRoot = sequences[index].pairRoot === "default" ? roots[0] : roots[index % 2];
  let codexId;
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
          retired: await exists(join(root, "retired")),
          marked: await exists(join(root, "paired-root")),
          key: await keyAt(root),
          pause: await readControlState(root),
        });
      const requestStart = requests.length;
      const installPath = join(home, ".cairn-memory-clients", "install.json");
      const installBefore = await fsp.readFile(installPath, "utf8").catch(() => undefined);
      const recordedBefore = new Set();
      if (installBefore) {
        try {
          const value = JSON.parse(installBefore);
          if (value.shared?.root) recordedBefore.add(value.shared.root);
        } catch {}
      }
      let apiBefore;
      const call = async (work) => {
        apiBefore = await snapshotHome(home);
        return work();
      };
      const actor = operation === "unset-recall" ? roots[0] : ownRoot();
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
          result = await call(() =>
            pairing.initializePairing({ ...settings(), adopt: operation === "adopt" }),
          );
          if (result.pairingRecord) option = result.pairingRecord;
        } else if (operation === "complete") {
          result = await call(() => pairing.completePairing(settings()));
          if (result.enabled) {
            codexId = id(await keyAt(result.root));
            pairedProfiles.set(profileA, result.root);
            pairedIds.set(profileA, id(await keyAt(result.root)));
          }
        } else if (operation.startsWith("reset-")) {
          const root = operation.endsWith("default") ? roots[0] : roots[2];
          result = await call(() =>
            pairing.resetIdentity({
              ...settings(),
              root,
              confirmIdentityReset: true,
              primaryClient: ["reset-lost", "reset-other-profile"].includes(operation)
                ? "claude"
                : operation.split("-")[1],
              ...(operation === "reset-other-profile"
                ? { claudeProfileRoot: join(home, "b") }
                : {}),
            }),
          );
          if (result.status === "identity_reset") {
            activeRoot = root;
            if (operation.includes("codex")) codexId = id(await keyAt(root));
            if (operation.includes("claude") || operation === "reset-lost") {
              pairedProfiles.set(profileA, root);
              pairedIds.set(profileA, id(await keyAt(root)));
              option = undefined;
            }
          }
        } else if (operation === "repair") {
          result = await call(() =>
            pairing.repairIdentity({
              ...settings(),
              confirmKeyRepair: true,
              originalKey: pairRoots.get(activeRoot),
            }),
          );
        } else if (operation === "setup-implicit") {
          const input = settings();
          delete input.claudeProfileRoot;
          result = await call(() => pairing.initializePairing({ ...input, adopt: true }));
        } else if (operation === "inventory-repair-public") {
          const built = await import(
            source
              ? pathToFileURL(join(source, "plugins/cairn-memory/lib/identity.mjs"))
              : new URL("../../../plugins/cairn-memory/lib/identity.mjs", import.meta.url)
          );
          assert.equal(
            identity.restoreProjectKey,
            undefined,
            "repair capability is private in source",
          );
          assert.equal(
            built.restoreProjectKey,
            undefined,
            "repair capability is private in bundle",
          );
        } else if (operation.startsWith("codex-")) {
          const input = {
            ...settings(),
            client: "codex",
            env: { HOME: home },
            pairingRecord:
              operation === "codex-single"
                ? undefined
                : join(home, ".cairn-memory-clients/pairing.json"),
            initialize: operation === "codex-single",
            usesClaude: false,
          };
          result = await call(() => pairing.resolveClient(input));
          if (result.enabled && result.paired) {
            const projectId = await pairing.clientProjectId(
              input,
              "/synthetic/sequence",
              result,
            );
            if (codexId === undefined) codexId = projectId;
            assert.equal(projectId, codexId, "c: Codex never silently changes identity");
            if (
              ["codex-capture", "codex-recall"].includes(operation) &&
              !(await readControlState(result.root)).paused
            )
              requests.push({ project_id: projectId, client: "codex" });
          }
        } else if (operation === "unset-recall") {
          const previousProfile = profile,
            previousOption = option;
          profile = undefined;
          option = undefined;
          result = await hookAction("recall");
          profile = previousProfile;
          option = previousOption;
          if (before.get(roots[0]).marked || recordedBefore.has(roots[0]))
            assert.equal(
              await fsp.readFile(installPath, "utf8").catch(() => undefined),
              installBefore,
              "b-prime: interleaved own-root read never registers",
            );
        } else if (operation === "delete-root") {
          await fsp.rm(activeRoot, { recursive: true, force: true });
        } else if (operation === "replace-key") {
          await fsp.mkdir(activeRoot, { recursive: true, mode: 0o700 });
          await fsp.writeFile(
            join(activeRoot, "project-key"),
            "11111111-1111-4111-8111-111111111111\n",
            { mode: 0o600 },
          );
        } else if (operation.startsWith("binding-")) {
          const path = join(profileA, ".cairn-memory-profile/binding.json");
          await fsp.rm(path, { recursive: true, force: true });
          if (operation === "binding-directory")
            await fsp.mkdir(path, { recursive: true, mode: 0o700 });
          else if (operation !== "binding-delete") {
            await fsp.mkdir(join(profileA, ".cairn-memory-profile"), {
              recursive: true,
              mode: 0o700,
            });
            const key = pairRoots.get(activeRoot);
            await fsp.writeFile(
              path,
              operation === "binding-json"
                ? "{"
                : JSON.stringify({
                    version: 1,
                    profileRoot: profileA,
                    root: activeRoot,
                    fingerprint: createHmac("sha256", key ?? "")
                      .update("cairn-memory:binding:v1")
                      .digest("hex"),
                  }),
              { mode: operation === "binding-mode" ? 0o644 : 0o600 },
            );
          }
        } else if (operation.startsWith("retired-") || operation.startsWith("legacy-")) {
          const path = operation.startsWith("retired-")
            ? join(activeRoot, "retired")
            : join(profileA, ".cairn-memory-profile/legacy.json");
          await fsp.rm(path, { recursive: true, force: true });
          if (operation.endsWith("directory"))
            await fsp.mkdir(path, { recursive: true, mode: 0o700 });
          else if (operation.endsWith("json")) {
            await fsp.mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
            await fsp.writeFile(path, "{", { mode: 0o600 });
          }
        } else if (operation.startsWith("marker-")) {
          const path = join(activeRoot, "paired-root");
          await fsp.rm(path, { recursive: true, force: true });
          if (operation === "marker-directory")
            await fsp.mkdir(path, { recursive: true, mode: 0o700 });
          else if (operation === "marker-json") {
            await fsp.mkdir(activeRoot, { recursive: true, mode: 0o700 });
            await fsp.writeFile(path, "{", { mode: 0o600 });
          }
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
      if (
        apiBefore &&
        result &&
        !["paired", "binding_pending", "identity_reset", "key_restored", "single"].includes(
          result.status,
        )
      )
        assert.ok(
          OPERATION_REFUSALS[operation]?.includes(result.status),
          `unexpected ${operation} status: ${result.status}`,
        );
      if (
        operation === "reset-other-profile" &&
        installBefore &&
        (JSON.parse(installBefore).clients.claude ||
          JSON.parse(installBefore).retired?.at(-1)?.claude)
      )
        assert.equal(
          failure?.message ?? result?.status,
          "claude_profile_mismatch",
          "explicit profile conflict must refuse",
        );
      if (failure instanceof assert.AssertionError) throw failure;
      if (failure) {
        assert.equal(
          failure.constructor,
          Error,
          "refusals are named Errors, never TypeError/ERR_*",
        );
        assert.ok(
          OPERATION_REFUSALS[operation]?.includes(failure.message),
          `unexpected ${operation} refusal: ${failure.message}`,
        );
      }
      if (
        sequences[index].finding === "explicit reset recovers lost identity" &&
        operation === "reset-lost"
      )
        assert.equal(
          result?.status,
          "identity_reset",
          "explicit lost-state reset must recover",
        );
      const unsuccessful =
        failure ||
        (apiBefore &&
          result &&
          !["paired", "binding_pending", "identity_reset", "key_restored", "single"].includes(
            result.status,
          ));
      if (unsuccessful && apiBefore)
        assert.deepEqual(
          await snapshotHome(home),
          apiBefore,
          "F: failed operation leaves HOME byte-identical",
        );
      if (
        sequences[index].finding === "explicit reset recovers lost identity" &&
        operation === "reset-lost"
      )
        assert.equal(
          result?.status,
          "identity_reset",
          "explicit lost-state reset must recover",
        );
      if (
        before.get(actor)?.marked &&
        ["recall", "capture", "pause", "resume", "status"].includes(operation)
      )
        assert.equal(
          await fsp.readFile(installPath, "utf8").catch(() => undefined),
          installBefore,
          "b-prime: sharing never writes registration",
        );
      // Invariant P: every successful operation in the exported inventory marks its root.
      if (
        result?.root &&
        (["initialize", "adopt", "complete", "repair", "setup-implicit"].includes(operation) ||
          operation.startsWith("reset-")) &&
        ["binding_pending", "paired", "identity_reset", "key_restored"].includes(result.status)
      ) {
        assert.equal(
          await exists(join(result.root, "paired-root")),
          true,
          "P: successful mutation marked root",
        );
        const installed = JSON.parse(await fsp.readFile(installPath, "utf8"));
        const registeredProfile =
          installed.clients.claude?.profileRoot ?? installed.retired.at(-1).claude.profileRoot;
        const history = JSON.parse(
          await fsp.readFile(
            join(registeredProfile, ".cairn-memory-profile", "binding.json"),
            "utf8",
          ),
        );
        assert.equal(
          history.root,
          result.root,
          "P: successful mutation records profile binding",
        );
        if (installed.clients.codex && !(source && reproduce))
          assert.equal(
            installed.clients.codex.fingerprint,
            history.fingerprint,
            "P: Codex binding carries the same fingerprint",
          );
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
        if (
          old.retired &&
          ["recall", "capture", "unset-recall", "codex-recall", "codex-capture"].includes(
            operation,
          )
        )
          assert.ok(
            requests
              .slice(requestStart)
              .every((request) => request.project_id !== id(old.key ?? "")),
            "retired roots never send",
          );
        if (marked && key && !pairRoots.has(root)) pairRoots.set(root, key);
        if (
          (old.marked || recordedBefore.has(root)) &&
          key !== undefined &&
          key !== old.key &&
          operation !== "replace-key"
        ) {
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
      if (
        profile === undefined &&
        !option &&
        ["recall", "pause", "resume"].includes(operation)
      ) {
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
        for (const request of requests
          .slice(requestStart)
          .filter((request) => request.client !== "codex"))
          assert.equal(
            request.project_id,
            pairedIds.get(actor),
            "c: paired identity never silently changes",
          );
      assert.deepEqual(violations, [], "d: every write is inside synthetic HOME");
    }
    completedSequences++;
    if (pairRoots.size) sequencesWithPairHistory++;
  } catch (error) {
    const finding = {
      seed,
      index,
      finding: sequences[index].finding,
      operations,
      failure: error.message,
    };
    findings.push(finding);
    output(JSON.stringify(finding) + "\n");
    if (!reproduce) {
      process.exitCode = 1;
      break;
    }
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
    findings,
  }) + "\n",
);
