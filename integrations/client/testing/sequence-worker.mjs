// Synthetic operation runner. Real hook modules execute in one isolated process;
// only stdin/stdout and fetch are replaced, avoiding hundreds of host processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
const source = process.env.CX2_SEQUENCE_SOURCE_ROOT;
const moduleUrl = (name) =>
  source
    ? pathToFileURL(join(source, "integrations/client", name))
    : new URL(`../${name}`, import.meta.url);
const pairing = await import(moduleUrl("pairing.mjs"));
const identity = await import(moduleUrl("identity.mjs"));
// Independent observations: no production identity/ownership helpers in the oracle.
async function readControlState(root) {
  try {
    const value = JSON.parse(await fsp.readFile(join(root, "control.json"), "utf8"));
    return {
      paused: value.paused || (await exists(join(root, "paused"))),
      generation: value.generation,
    };
  } catch (error) {
    return {
      paused: error.code !== "ENOENT" || (await exists(join(root, "paused"))),
      generation: error.code === "ENOENT" ? "initial" : "invalid",
    };
  }
}
const { projectKey } = identity;
import { snapshotHome } from "./sequence-snapshot.mjs";
import { exerciseInterruptions, INTERRUPTION_OPERATIONS } from "./interruption-cases.mjs";
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
  process.env.HOME = home;
  process.env.TMPDIR = join(home, "tmp");
  process.chdir(home);
  const roots = [join(home, ".cairn-memory"), join(home, "shared"), join(home, "next")];
  const profileA = join(home, "a");
  let profile = profileA;
  let option;
  let activeRoot = sequences[index].pairRoot === "default" ? roots[0] : roots[1];
  let codexId;
  let codeUsesClaude = false;
  const creators = new Map();
  let bindingProfile;
  // The model is built ONLY by explicit successful operation history. Deletion,
  // corruption and unreadable metadata cannot erase pair-root ownership.
  const pairRoots = new Map();
  const currentKeys = new Map();
  const retiredRoots = new Set();

  const observations = new Set(roots);
  let alias;
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
    claudeProfileRoot: bindingProfile ?? profileA,
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
      return {
        ok: true,
        status: 200,
        json: async () => ({ memories: [], memoryCount: 1 }),
      };
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
      const before = new Map(
        await Promise.all(
          [...observations].map(async (root) => {
            const [retired, marked, key, pause] = await Promise.all([
              exists(join(root, "retired")),
              exists(join(root, "paired-root")),
              keyAt(root),
              readControlState(root),
            ]);
            return [root, { retired, marked, key: key ?? currentKeys.get(root), pause }];
          }),
        ),
      );
      const requestStart = requests.length;
      const installPath = join(home, ".cairn-memory-clients", "install.json");
      const installBefore = await fsp.readFile(installPath, "utf8").catch(() => undefined);
      const recordedBefore = new Set(pairRoots.keys());
      const oldActiveRoot = activeRoot;
      let requestedProfile = profileA;
      let apiBefore;
      const call = async (work) => {
        apiBefore = await snapshotHome(home);
        return work();
      };
      const actorPath = operation === "unset-recall" ? roots[0] : ownRoot();
      let actor = await fsp.realpath(actorPath).catch(() => actorPath);
      let result;
      let failure;
      try {
        if (operation === "bind-profile-alias") {
          await fsp.mkdir(profileA, { recursive: true, mode: 0o700 });
          profile = join(home, "profile-alias");
          if (!(await exists(profile))) await fsp.symlink(profileA, profile);
          requestedProfile = profile;
          result = await call(() =>
            pairing.initializePairing({
              ...settings(),
              claudeProfileRoot: profile,
            }),
          );
          if (result.pairingRecord) option = result.pairingRecord;
        } else if (operation === "repoint-profile-alias") {
          const target = join(home, "b");
          await fsp.mkdir(target, { recursive: true, mode: 0o700 });
          if (!(await exists(join(target, "project-key"))))
            await fsp.writeFile(
              join(target, "project-key"),
              "22222222-2222-4222-8222-222222222222\n",
              { mode: 0o600 },
            );
          const path = join(home, "profile-alias");
          await fsp.rm(path, { force: true });
          await fsp.symlink(target, path);
          profile = path;
        } else if (operation === "clear-option") {
          option = undefined;
        } else if (["initialize", "adopt"].includes(operation)) {
          if (operation === "adopt" && !(await exists(join(activeRoot, "paired-root")))) {
            await projectKey(activeRoot, { home });
            // Genuine default-root adoption with existing Claude cursors.
            await fsp.mkdir(join(activeRoot, "sessions"), { mode: 0o700 });
            await fsp.writeFile(
              join(activeRoot, "sessions", "a".repeat(64) + ".json"),
              '{"offset":1}',
              { mode: 0o600 },
            );
          }
          result = await call(() =>
            pairing.initializePairing({
              ...settings(),
              adopt: operation === "adopt",
            }),
          );
          if (result.pairingRecord) option = result.pairingRecord;
        } else if (operation === "complete") {
          result = await call(() => pairing.completePairing(settings()));
          if (result.enabled) {
            codexId = id(await keyAt(result.root));
            pairedProfiles.set(profileA, result.root);
            pairedIds.set(profileA, id(await keyAt(result.root)));
          }
        } else if (["reset-alias", "reset-prekeyed"].includes(operation)) {
          let destination;
          if (operation === "reset-alias") {
            alias = join(home, "alias");
            if (!(await exists(alias))) await fsp.symlink(home, alias);
            destination = join(alias, activeRoot.slice(home.length + 1));
          } else {
            destination = join(home, "b");
            await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
            await fsp.writeFile(
              join(destination, "project-key"),
              "22222222-2222-4222-8222-222222222222\n",
              { mode: 0o600 },
            );
          }
          observations.add(destination);
          result = await call(() =>
            pairing.resetIdentity({
              ...settings(),
              root: destination,
              primaryClient: "claude",
              confirmIdentityReset: true,
            }),
          );
          assert.notEqual(
            result?.status,
            "identity_reset",
            "reset destination must refuse aliases and pre-keyed roots",
          );
        } else if (operation === "initialize-prekeyed") {
          const destination = join(home, "b");
          await fsp.rm(destination, { recursive: true, force: true });
          await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
          await fsp.writeFile(
            join(destination, "project-key"),
            "22222222-2222-4222-8222-222222222222\n",
            { mode: 0o600 },
          );
          result = await call(() =>
            pairing.initializePairing({ ...settings(), root: destination }),
          );
          assert.equal(
            result?.status,
            "existing_key_requires_adoption",
            "pre-keyed destination requires adoption",
          );
        } else if (operation.startsWith("facade-")) {
          let target = activeRoot;
          if (operation === "facade-alias-key") {
            const alias = join(home, "alias");
            if (!(await exists(alias))) await fsp.symlink(home, alias);
            target = join(alias, activeRoot.slice(home.length + 1));
          }
          result = await call(() =>
            operation === "facade-project-id"
              ? identity.opaqueProjectId(activeRoot, "/synthetic/sequence", { home })
              : identity.projectKey(
                  target,
                  operation === "facade-original-key"
                    ? { originalKey: "22222222-2222-4222-8222-222222222222", home }
                    : { home },
                ),
          );
        } else if (operation === "repair-invalid") {
          result = await call(() =>
            pairing.repairIdentity({
              ...settings(),
              confirmKeyRepair: true,
              originalKey: 12345,
            }),
          );
        } else if (operation === "crashed-lock") {
          const location = join(home, ".cairn-memory-clients");
          await fsp.mkdir(location, { recursive: true, mode: 0o700 });
          const live = await pairing.localLiveness();
          await fsp.writeFile(
            join(location, "setup.lock"),
            JSON.stringify({
              pid: 2147483647,
              token: randomUUID(),
              boot: live.boot,
              namespace: live.namespace,
            }),
            { mode: 0o600 },
          );
        } else if (operation === "root-mode-host") {
          await fsp.mkdir(activeRoot, { recursive: true, mode: 0o755 });
          await fsp.chmod(activeRoot, 0o755);
        } else if (
          operation.startsWith("root-mode-") ||
          operation.startsWith("key-mode-") ||
          operation.startsWith("coord-mode-")
        ) {
          const target = operation.startsWith("root-")
            ? activeRoot
            : operation.startsWith("key-")
              ? join(activeRoot, "project-key")
              : join(home, ".cairn-memory-clients");
          if (await exists(target))
            await fsp.chmod(
              target,
              operation.endsWith("zero") ? 0 : operation.startsWith("key-") ? 0o600 : 0o700,
            );
        } else if (operation === "root-file") {
          await fsp.rm(activeRoot, { recursive: true, force: true });
          currentKeys.delete(activeRoot);
          await fsp.writeFile(activeRoot, "synthetic replaced root");
        } else if (operation === "key-directory") {
          await fsp.rm(join(activeRoot, "project-key"), {
            recursive: true,
            force: true,
          });
          currentKeys.delete(activeRoot);
          await fsp.mkdir(join(activeRoot, "project-key"), {
            recursive: true,
            mode: 0o700,
          });
        } else if (operation === "profile-alias") {
          alias = join(home, "profile-alias");
          if (!(await exists(alias))) await fsp.symlink(profileA, alias);
          profile = alias;
        } else if (operation === "delete-reset-root") {
          if (activeRoot === roots[2] || retiredRoots.size)
            await fsp.rm(activeRoot, { recursive: true, force: true });
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
              originalKey: pairRoots.get(activeRoot) ?? "33333333-3333-4333-8333-333333333333",
            }),
          );
        } else if (operation === "setup-implicit") {
          const input = settings();
          requestedProfile =
            bindingProfile ??
            profile ??
            join(home, ".claude/plugins/data/cairn-memory-cairn-memory");
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
        } else if (operation === "codex-binding-delete") {
          await fsp.rm(join(home, ".cairn-memory-profile/binding.json"), {
            force: true,
          });
        } else if (operation === "interrupt") {
          const parent = join(home, "interruption");
          await fsp.mkdir(parent, { mode: 0o700 });
          const setupOperation =
            sequences[index].setupOperation ??
            INTERRUPTION_OPERATIONS[seed % INTERRUPTION_OPERATIONS.length];
          await exerciseInterruptions(parent, setupOperation, {
            source,
            onlyPoint: seed,
          });
        } else if (operation === "codex-first") {
          const target = roots[0];
          codeUsesClaude = true;
          result = await call(() =>
            pairing.resolveClient({
              home,
              root: target,
              client: "codex",
              usesClaude: true,
              env: { HOME: home },
              initialize: true,
              standardClaudeOrigin: true,
            }),
          );
          if (result.enabled && !before.get(target)?.key) creators.set(target, "codex");
        } else if (operation === "claude-first") {
          profile = undefined;
          actor = roots[0];
          option = undefined;
          result = await hookAction("recall");
          if (await keyAt(roots[0])) creators.set(roots[0], "claude");
        } else if (operation.startsWith("codex-")) {
          const input = {
            ...settings(),
            client: "codex",
            env: { HOME: home },
            pairingRecord:
              operation === "codex-single" || (codeUsesClaude && !pairRoots.has(activeRoot))
                ? undefined
                : join(home, ".cairn-memory-clients/pairing.json"),
            initialize: operation === "codex-single",
            usesClaude: codeUsesClaude,
          };
          result = await call(() => pairing.resolveClient(input));
          if (result.enabled) {
            const projectId = await pairing.clientProjectId(input, "/synthetic/sequence", result);
            if (codexId === undefined && pairRoots.has(result.root))
              assert.fail("Codex cannot inherit unbound pair identity");
            if (codexId !== undefined)
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
          actor = roots[0];
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
          currentKeys.delete(activeRoot);
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
            await fsp.mkdir(resolve(path, ".."), {
              recursive: true,
              mode: 0o700,
            });
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
          await fsp.rm(join(activeRoot, "project-key"), {
            recursive: true,
            force: true,
          });
          currentKeys.delete(activeRoot);
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
        } else {
          assert.ok(
            ["capture", "recall", "pause", "resume", "status"].includes(operation),
            `unhandled operation: ${operation}`,
          );
          result = await hookAction(operation);
        }
      } catch (error) {
        // Damage operations may be inapplicable after a preceding corruption.
        // API calls never receive this exemption, and invariants still run.
        if (!apiBefore && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR", "EEXIST"].includes(error.code))
          result = { fixtureInapplicable: error.code };
        else failure = error;
      }
      if (
        apiBefore &&
        result &&
        typeof result === "object" &&
        !result.fixtureInapplicable &&
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
      if (sequences[index].expectedRefusal && operation === operations.at(-1))
        assert.equal(failure?.message ?? result?.status, sequences[index].expectedRefusal);
      if (
        sequences[index].finding ===
          "alias switches without an option retain standalone delivery" &&
        operation === "recall"
      )
        assert.ok(
          requests.length > requestStart,
          "a switched profile with its own key must send standalone",
        );
      if (
        creators.get(roots[0]) === "codex" &&
        !pairRoots.has(roots[0]) &&
        !pairedProfiles.has(actor) &&
        ["recall", "capture"].includes(operation) &&
        (actor === roots[0] || !before.get(actor)?.key)
      ) {
        assert.equal(
          requests.length,
          requestStart,
          "creator: newcomer Claude never sends Codex identity",
        );
        assert.equal(await keyAt(actor), before.get(actor)?.key, "creator: newcomer never mints");
      }
      if (
        creators.get(roots[0]) === "claude" &&
        !pairRoots.has(roots[0]) &&
        operation === "codex-single"
      )
        assert.equal(result?.enabled, false, "creator: Codex never inherits Claude's identity");
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
        assert.equal(result?.status, "identity_reset", "explicit lost-state reset must recover");
      const unsuccessful =
        failure ||
        (apiBefore &&
          result &&
          typeof result === "object" &&
          !["paired", "binding_pending", "identity_reset", "key_restored", "single"].includes(
            result.status,
          ));
      if (unsuccessful && apiBefore)
        assert.deepEqual(
          await snapshotHome(home),
          apiBefore,
          "F: failed operation leaves HOME byte-identical",
        );

      const explicit =
        [
          "initialize",
          "initialize-prekeyed",
          "adopt",
          "complete",
          "repair",
          "repair-invalid",
          "setup-implicit",
          "bind-profile-alias",
        ].includes(operation) || operation.startsWith("reset-");
      if (
        !explicit &&
        (operation.startsWith("codex-") ||
          ["recall", "capture", "pause", "resume", "status", "unset-recall"].includes(operation))
      )
        assert.equal(
          await fsp.readFile(installPath, "utf8").catch(() => undefined),
          installBefore,
          "registration only through explicit setup for both clients",
        );
      // Invariant P: every successful operation in the exported inventory marks its root.
      if (
        result?.root &&
        ([
          "initialize",
          "adopt",
          "complete",
          "repair",
          "setup-implicit",
          "bind-profile-alias",
        ].includes(operation) ||
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
        assert.equal(history.root, result.root, "P: successful mutation records profile binding");
        if (!(source && reproduce)) {
          const codexHistory = JSON.parse(
            await fsp.readFile(join(home, ".cairn-memory-profile/binding.json"), "utf8"),
          );
          assert.equal(
            codexHistory.root,
            result.root,
            "P: durable Codex binding matches the operation",
          );
          assert.equal(
            codexHistory.fingerprint,
            history.fingerprint,
            "P: both histories share the identity fingerprint",
          );
          for (const knownRoot of pairRoots.keys())
            assert.ok(
              codexHistory.roots.some((entry) => entry.root === knownRoot),
              "P: durable history retains every model pair root",
            );
        }
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
      if (
        explicit &&
        result?.root &&
        ["binding_pending", "paired", "identity_reset", "key_restored"].includes(result.status)
      ) {
        const key = await keyAt(result.root);
        if (operation.startsWith("reset-")) retiredRoots.add(oldActiveRoot);
        pairRoots.set(result.root, key);
        currentKeys.set(result.root, key);
        observations.add(result.root);
        bindingProfile = requestedProfile;
        const owner = await fsp.realpath(requestedProfile).catch(() => requestedProfile);
        pairedProfiles.set(owner, result.root);
        pairedIds.set(owner, id(key));
        codexId = id(key);
      }
      const afterKeys = new Map(
        await Promise.all([...observations].map(async (root) => [root, await keyAt(root)])),
      );
      for (const root of observations) {
        const old = before.get(root);
        if (!old) continue;
        const key = afterKeys.get(root);
        if (
          retiredRoots.has(root) &&
          ["recall", "capture", "unset-recall", "codex-recall", "codex-capture"].includes(operation)
        )
          assert.ok(
            requests
              .slice(requestStart)
              .every((request) => request.project_id !== id(old.key ?? "")),
            "retired roots never send",
          );

        if (
          recordedBefore.has(root) &&
          key !== undefined &&
          key !== old.key &&
          operation !== "replace-key"
        ) {
          assert.equal(operation, "repair", "K: model pair root gained a key outside repair");
          assert.equal(key, pairRoots.get(root), "repair restores original identity");
        }
        // (b) unrelated never-paired profiles cannot borrow identity or controls.
        // (b') owning this root, including unset plugin data, permits EXISTING sharing.
        if (
          !pairedProfiles.has(actor) &&
          actor !== root &&
          pairRoots.has(root) &&
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
          pairRoots.has(root) &&
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
    if (!reproduce) process.exitCode = 1;
  } finally {
    // Permission damage is part of the sequence, never a burden on workspace cleanup.
    for (const path of [...observations, join(home, ".cairn-memory-clients")]) {
      const info = await fsp.lstat(path).catch(() => undefined);
      if (info?.isDirectory()) await fsp.chmod(path, 0o700);
      const key = join(path, "project-key");
      const keyInfo = await fsp.lstat(key).catch(() => undefined);
      if (keyInfo?.isFile()) await fsp.chmod(key, 0o600);
    }
  }
  if (process.exitCode && !reproduce) break;
}
process.stdout.write = output;
Object.defineProperty(process, "stdin", stdin);
process.chdir(priorCwd);
output(
  JSON.stringify({
    sequences: completedSequences,
    randomSequences: sequences.filter((sequence) => !sequence.scripted && !reproduce).length,
    scriptedFixtures: sequences.filter((sequence) => sequence.scripted || reproduce).length,
    sequencesWithPairHistory,
    seeds: SEQUENCE_SEEDS,
    runtimeMs: Math.round(performance.now() - started),
    coverage: Object.fromEntries(coverage),
    findings,
  }) + "\n",
);
