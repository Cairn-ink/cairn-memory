import { homedir, tmpdir, uptime } from "node:os";
import { isAbsolute, join, resolve, relative } from "node:path";
import { opendir, readFile, readlink, unlink, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { privateDirectory, privateRead, privateWrite, checkedPath } from "./private-state.mjs";
import { withFileLock } from "./file-lock.mjs";
import { opaqueProjectId, projectKey } from "./identity.mjs";
import { setPaused, readControlState } from "./control-state.mjs";

const CLIENTS = ["claude", "codex"];
const fail = (message) => {
  throw new Error(message);
};
const absolute = (value) =>
  typeof value === "string" && isAbsolute(value) && resolve(value) === value;

export function stateLocations({
  home = homedir(),
  temporary = tmpdir(),
  env = process.env,
  setup = false,
} = {}) {
  if (setup && !absolute(home))
    fail("Cannot determine an absolute home directory; setup made no changes.");
  const base = home || temporary;
  const coordination = join(base, ".cairn-memory-clients");
  return {
    home,
    temporary,
    coordination,
    install: join(coordination, "install.json"),
    pairing: join(coordination, "pairing.json"),
    lock: join(coordination, "setup.lock"),
    defaultRoot: join(base, ".cairn-memory"),
    claudeRoot: env.CLAUDE_PLUGIN_DATA ?? join(base, ".cairn-memory"),
    knownClaudeRoot:
      env.CLAUDE_PLUGIN_DATA ?? join(base, ".claude/plugins/data/cairn-memory-cairn-memory"),
  };
}

async function jsonFile(path) {
  const text = await privateRead(path, { missing: true });
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    fail("invalid_pairing_metadata");
  }
}
function validateInstall(value) {
  if (!value) return { version: 1, clients: {} };
  if (
    value.version !== 1 ||
    !value.clients ||
    typeof value.clients !== "object" ||
    Array.isArray(value.clients)
  )
    fail("invalid_install");
  for (const [client, binding] of Object.entries(value.clients)) {
    if (
      !CLIENTS.includes(client) ||
      !absolute(binding?.root) ||
      (client === "claude" && !absolute(binding.profileRoot)) ||
      !["established", "pending"].includes(binding?.state)
    )
      fail("invalid_install");
  }
  if (
    value.shared &&
    (!absolute(value.shared.root) ||
      typeof value.shared.id !== "string" ||
      !["initialize-shared", "adopt-existing"].includes(value.shared.policy) ||
      typeof value.shared.initialized !== "boolean" ||
      typeof value.shared.ready !== "boolean")
  )
    fail("invalid_install");
  if (
    value.retired !== undefined &&
    (!Array.isArray(value.retired) ||
      value.retired.some(
        (entry) => !entry || !absolute(entry.claude?.profileRoot) || !absolute(entry.claude?.root),
      ))
  )
    fail("invalid_install");
  return value;
}
// Retired ownership still identifies the profile that must explicitly re-adopt.
function claudeRegistration(install) {
  return install.clients.claude ?? install.retired?.at(-1)?.claude;
}

function validateRecord(record, locations) {
  if (
    !record ||
    record.version !== 1 ||
    !absolute(record.root) ||
    !Array.isArray(record.participants) ||
    record.participants.length !== 2 ||
    !CLIENTS.every((client) => record.participants.includes(client)) ||
    !["initialize-shared", "adopt-existing"].includes(record.policy) ||
    typeof record.id !== "string"
  )
    fail("invalid_pairing_record");
  durable(record.root, locations);
  return record;
}
function durable(root, locations) {
  if (!absolute(locations.home) || !absolute(root)) fail("pairing_requires_durable_home");
  // Test homes may be under TMPDIR; the durable logical boundary is the explicit home.
  // Outside it, reject the known temporary-storage trees.
  const beneath = (parent, child) =>
    child === parent ||
    (!relative(parent, child).startsWith("..") && !isAbsolute(relative(parent, child)));
  if (
    !beneath(locations.home, root) &&
    [locations.temporary, "/tmp", "/var/tmp"].some((path) => beneath(path, root))
  )
    fail("temporary_pairing_root");
}
async function keyPresent(root, { strict = false } = {}) {
  if (strict && !absolute(root)) fail("invalid_state_path");
  let bytes;
  if (strict) {
    await checkedPath(root, { directory: true, missing: true });
    bytes = await privateRead(join(root, "project-key"), { missing: true });
  } else {
    // Read-only discovery must preserve released Claude's host-owned paths.
    try {
      bytes = await readFile(join(root, "project-key"), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (bytes === undefined) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bytes.trim()))
    fail("invalid_identity: project-key");
  return true;
}

/** Bounded metadata-only evidence in Cairn's root; never read a host transcript. */
export async function hasClaudeEvidence(root) {
  const directory = join(root, "sessions");
  if (!(await checkedPath(directory, { directory: true, missing: true }))) return false;
  const entries = await opendir(directory);
  let count = 0;
  for await (const entry of entries) {
    if (++count > 256) return false; // Absence/uncertainty requires confirmation.
    if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
    const value = await jsonFile(join(directory, entry.name));
    if (Number.isSafeInteger(value?.offset) && value.offset >= 0) return true;
  }
  return false;
}

/** Read-only, exact known-file checks. Unknown Claude origins need a setup answer. */
export async function detectClients(options = {}) {
  const locations = stateLocations(options);
  if (options.claudeProfileRoot !== undefined && !absolute(options.claudeProfileRoot))
    fail("invalid_claude_profile_root");
  if (await checkedPath(locations.coordination, { directory: true, missing: true })) {
    /* validated */
  }
  const install = validateInstall(await jsonFile(locations.install));
  const record = await jsonFile(locations.pairing);
  if (record) validateRecord(record, locations);
  const roots = [
    ...new Set([
      locations.defaultRoot,
      locations.knownClaudeRoot,
      locations.claudeRoot,
      ...(options.claudeProfileRoot === undefined ? [] : [options.claudeProfileRoot]),
      ...Object.values(install.clients).map((binding) => binding.root),
      ...(record ? [record.root] : []),
      ...(install.resetPending ? [install.resetPending.root] : []),
    ]),
  ];
  const keys = [];
  for (const root of roots) if (await keyPresent(root)) keys.push(root);
  return { locations, install, record, keys };
}

/** Boot and namespace identity belong to lock owners, not durable bindings. */
export async function localLiveness({ platform = process.platform } = {}) {
  const isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  };
  if (platform === "linux") {
    return {
      boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
      namespace: await readlink("/proc/self/ns/pid"),
      platform,
      isAlive,
    };
  }
  if (platform === "darwin") {
    // os.uptime is system uptime in seconds. Allow two seconds of sampling/
    // rounding drift when comparing estimates from separate processes.
    return { boot: Date.now() - uptime() * 1000, namespace: "darwin", platform, isAlive };
  }
  return { platform, namespace: undefined, boot: undefined, isAlive };
}

function ownerAlive(owner, liveness) {
  if (!owner || !liveness.namespace) fail("pid_namespace_unverified");
  const differentBoot =
    owner.boot !== undefined &&
    liveness.boot !== undefined &&
    (typeof owner.boot === "number" && typeof liveness.boot === "number"
      ? Math.abs(owner.boot - liveness.boot) > 2000
      : owner.boot !== liveness.boot);
  // After reboot even a reused PID cannot be this lock's owner. Namespace
  // comparison is meaningful only within one boot.
  if (differentBoot) return false;
  if (owner.namespace !== liveness.namespace) fail("pid_namespace_unverified");
  return liveness.isAlive(owner.pid);
}

async function locked(options, work) {
  await detectClients(options);
  const locations = stateLocations(options);
  const liveness = options.liveness ?? (await localLiveness());
  if (options.setup && !liveness.namespace) fail("pairing_platform_unsupported");
  await privateDirectory(locations.coordination);
  await checkedPath(locations.lock, { missing: true });
  let result;
  const acquired = await withFileLock(
    locations.lock,
    async () => {
      result = await work(await detectClients(options), liveness);
    },
    {
      timeoutMs: options.timeoutMs ?? 2000,
      pollMs: 10,
      context: { namespace: liveness.namespace, boot: liveness.boot },
      isAlive: (_pid, owner) => ownerAlive(owner, liveness),
      validatePath: (path) => checkedPath(path, { missing: true }),
      read: (path) => privateRead(path, { missing: true }),
      validateOwner: async (owner) => {
        ownerAlive(owner, liveness);
      },
    },
  );
  if (!acquired) fail("setup_busy");
  return result;
}
const saveInstall = (locations, install) =>
  privateWrite(locations.install, JSON.stringify(install));
const disabled = (status = "pairing_needed") => ({ status, enabled: false });

export function parsePairingRecord(argv = []) {
  let pairingRecord;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--pairing-record") {
      rest.push(argv[i]);
      continue;
    }
    if (pairingRecord !== undefined || !absolute(argv[i + 1])) fail("invalid_pairing_argument");
    pairingRecord = argv[++i];
  }
  return { pairingRecord, rest };
}

function activeBinding(root, env, status = "single", paired = false) {
  if (paired && env.CAIRN_MEMORY_STATE_DIR !== undefined && env.CAIRN_MEMORY_STATE_DIR !== root) {
    fail("state_dir_mismatch");
  }
  return {
    enabled: true,
    status,
    root,
    paired,
    workerEnv: { ...env, CAIRN_MEMORY_STATE_DIR: root },
  };
}

async function selectBinding(options, snapshot, delivered) {
  const { client = "claude", env = process.env } = options;
  const { locations, install, record, keys } = snapshot;
  const binding = install.clients[client];
  const registration = claudeRegistration(install);
  if (
    client === "claude" &&
    !registration &&
    ((await retiredRoot(locations.defaultRoot)) || (await retiredRoot(locations.claudeRoot)))
  )
    return disabled("coordination_unreadable: pairing_needed");
  const legacyClaude =
    client === "claude" &&
    !registration &&
    (locations.claudeRoot === locations.defaultRoot || !keys.includes(locations.claudeRoot)) &&
    keys.includes(locations.defaultRoot) &&
    (await hasClaudeEvidence(locations.defaultRoot));
  const claudeRoot = legacyClaude ? locations.defaultRoot : locations.claudeRoot;
  const profileRoot = registration?.profileRoot;
  if (delivered !== undefined) {
    if (!absolute(delivered) || delivered !== locations.pairing) {
      fail("pairing_record_mismatch");
    }
    if (!record) fail("pairing_record_missing");
  }
  // A registry entry belongs to one profile, not every Claude sharing this HOME.
  if (client === "claude" && registration && locations.claudeRoot !== profileRoot) {
    if (delivered !== undefined) fail("pairing_record_mismatch");
    return activeBinding(claudeRoot, env, "standalone_unregistered");
  }
  if (client === "claude" && registration && !binding) return disabled();
  if (install.resetPending) return disabled();
  if (record || install.shared || binding?.state === "pending") {
    if (!record || !delivered || !install.shared?.ready) return disabled();
    if (process.platform === "win32") fail("pairing_platform_unsupported");
    if (
      !binding ||
      binding.state !== "established" ||
      binding.root !== record.root ||
      !install.shared.initialized ||
      install.shared.id !== record.id ||
      install.shared.root !== record.root ||
      install.shared.policy !== record.policy
    ) {
      fail("pairing_record_mismatch");
    }
    if (!(await keyPresent(record.root, { strict: true }))) {
      return disabled("paired_key_missing");
    }
    return activeBinding(record.root, env, "paired", true);
  }
  const other = install.clients[CLIENTS.find((name) => name !== client)];
  const root =
    binding?.root ?? (client === "claude" ? claudeRoot : (options.root ?? locations.defaultRoot));
  if (!absolute(root)) fail("invalid_state_path");
  let established = binding?.state === "established" && binding.root === root;
  if (!established && client === "claude" && keys.includes(root)) {
    established = !other || other.root !== root || legacyClaude;
  }
  const conflict =
    !!other ||
    (client === "codex" &&
      (keys.some((keyRoot) => keyRoot !== root) || (!established && keys.length > 0)));
  if (!established && conflict) return disabled();
  if (
    client === "codex" &&
    !established &&
    !options.standardClaudeOrigin &&
    options.usesClaude !== false
  )
    return disabled();
  if (conflict && !keys.includes(root)) return disabled();
  return activeBinding(root, env, conflict ? "pairing_needed" : "single");
}

async function retiredRoot(root) {
  if (!absolute(root)) return false;
  const marker = await jsonFile(join(root, "retired"));
  if (marker === undefined) return false;
  if (marker?.version !== 1 || marker.retired !== true) fail("invalid_retired_marker");
  await checkedPath(root, { directory: true });
  return true;
}

async function fallbackStandalone(options, delivered, snapshot) {
  const locations = stateLocations(options);
  if (
    (options.client ?? "claude") === "claude" &&
    (!snapshot || !claudeRegistration(snapshot.install))
  ) {
    try {
      for (const root of new Set([locations.claudeRoot, locations.defaultRoot])) {
        if (await retiredRoot(root)) return disabled("coordination_unreadable: pairing_needed");
      }
    } catch {
      return disabled("coordination_unreadable: pairing_needed");
    }
  }
  if (
    (options.client ?? "claude") !== "claude" ||
    delivered !== undefined ||
    snapshot?.record ||
    snapshot?.install.shared ||
    snapshot?.install.resetPending ||
    snapshot?.install.clients.codex
  )
    return undefined;
  // Even an unreadable surviving record proves this is not standalone.
  try {
    await lstat(locations.pairing);
    return undefined;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return undefined;
  }
  const env = options.env ?? process.env;
  let root = locations.claudeRoot;
  let explicitKey = false;
  if (env.CLAUDE_PLUGIN_DATA !== undefined) {
    try {
      await lstat(join(locations.claudeRoot, "project-key"));
      explicitKey = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Untrusted metadata cannot justify minting a replacement for an evidenced key.
  const preserveLegacy = !snapshot || !claudeRegistration(snapshot.install);
  if (explicitKey) root = locations.claudeRoot;
  else if (preserveLegacy) {
    try {
      if (
        (await keyPresent(locations.defaultRoot)) &&
        (await hasClaudeEvidence(locations.defaultRoot))
      )
        root = locations.defaultRoot;
    } catch {
      // Legacy identity reads retain their own original error behavior.
      // Unavailable optional evidence cannot disable standalone memory.
    }
  }
  return activeBinding(root, env, "standalone_unregistered");
}

/** Normal hooks only read. Registration alone needs the setup lock. */
export async function resolveClient(options = {}) {
  const { client = "claude", env = process.env } = options;
  if (!CLIENTS.includes(client)) fail("invalid_client");
  const option =
    client === "claude" ? env.CLAUDE_PLUGIN_OPTION_PAIRING_RECORD || undefined : undefined;
  const argument = options.pairingRecord || undefined;
  if (argument !== undefined && option !== undefined && argument !== option) {
    fail("pairing_record_mismatch");
  }
  const delivered = argument ?? option;
  let snapshot;
  let binding;
  try {
    snapshot = await detectClients(options);
    binding = await selectBinding(options, snapshot, delivered);
  } catch (error) {
    binding = await fallbackStandalone(options, delivered, snapshot);
    if (!binding) throw error;
  }
  if (!binding.enabled) return binding;
  if (
    snapshot &&
    !binding.paired &&
    binding.status !== "standalone_unregistered" &&
    !snapshot.install.clients[client]
  ) {
    try {
      binding = await locked(
        { ...options, timeoutMs: options.timeoutMs ?? 100 },
        async (current) => {
          const selected = await selectBinding(options, current, delivered);
          if (selected.enabled && !selected.paired && !current.install.clients[client]) {
            current.install.clients[client] = {
              root: selected.root,
              state: "established",
              ...(client === "claude" ? { profileRoot: current.locations.claudeRoot } : {}),
            };
            await saveInstall(current.locations, current.install);
          }
          return selected;
        },
      );
    } catch (error) {
      // A contender may have registered a different client while we waited.
      // Re-read before using the standalone fallback; never bypass its binding.
      try {
        snapshot = await detectClients(options);
        binding = await selectBinding(options, snapshot, delivered);
        if (binding.enabled && !snapshot.install.clients[client]) {
          binding = await fallbackStandalone(options, delivered, snapshot);
        }
      } catch {
        binding = await fallbackStandalone(options, delivered, snapshot);
      }
      if (!binding) throw error;
    }
  }
  if (binding.enabled && options.initialize) await identityForBinding(binding, client);
  return binding;
}

async function identityForBinding(binding, client, cwd = "initialization") {
  return opaqueProjectId(
    binding.root,
    cwd,
    binding.paired || client !== "claude" ? { strict: true, create: !binding.paired } : undefined,
  );
}

export async function clientProjectId(options, cwd, binding) {
  if (!cwd) return undefined;
  binding ??= await resolveClient(options);
  if (!binding.enabled) fail(binding.status);
  return identityForBinding(binding, options.client ?? "claude", cwd);
}

/** CX-7 API: no host execution. Caller obtains consent and stops hosts/workers. */
export async function initializePairing(options = {}) {
  const setupOptions = { ...options, setup: true };
  const locations = stateLocations(setupOptions); // refuse bad home before writes
  if (
    options.hostsStopped !== true ||
    !CLIENTS.every((client) => options.consent?.[client] === true)
  )
    fail("pairing_consent_required");
  const root = options.root ?? locations.defaultRoot;
  durable(root, locations);
  const initial = await detectClients(setupOptions);
  if (initial.record && !initial.install.shared) fail("pairing_record_mismatch");
  const profileRoot =
    options.claudeProfileRoot ??
    claudeRegistration(initial.install)?.profileRoot ??
    (options.env ?? process.env).CLAUDE_PLUGIN_DATA ??
    (options.standardClaudeOrigin === true ? locations.knownClaudeRoot : undefined);
  if (profileRoot === undefined) return disabled("claude_profile_root_required");
  if (!absolute(profileRoot)) fail("invalid_claude_profile_root");
  const registeredProfile = claudeRegistration(initial.install)?.profileRoot;
  if (registeredProfile !== undefined && registeredProfile !== profileRoot)
    fail("claude_profile_mismatch");
  if (!options.standardClaudeOrigin && options.usesClaude === undefined)
    return { status: "claude_confirmation_needed", enabled: false };
  if (
    !initial.install.shared &&
    (initial.keys.length ||
      Object.keys(initial.install.clients).length ||
      options.usesClaude === true) &&
    options.adopt !== true
  )
    return disabled();
  return locked(setupOptions, async ({ install, keys, record: existingRecord }) => {
    const registration = claudeRegistration(install);
    if (registration && registration.profileRoot !== profileRoot) fail("claude_profile_mismatch");
    if (existingRecord && (!install.shared || !install.shared.initialized))
      fail("pairing_record_mismatch");
    if (install.resetPending) fail("identity_reset_pending");
    if (
      install.shared &&
      (install.shared.root !== root || (existingRecord && existingRecord.id !== install.shared.id))
    )
      fail("pending_binding_mismatch");
    if (!install.shared) {
      if (
        (keys.length || Object.keys(install.clients).length || options.usesClaude === true) &&
        options.adopt !== true
      )
        return disabled();
      if (options.adoptFrom && !options.adopt) fail("adoption_confirmation_required");
      if (options.adopt && !(await keyPresent(options.adoptFrom ?? root)))
        fail("adopted_key_missing");
      if (
        options.adoptFrom &&
        (await keyPresent(root)) &&
        (await projectKey(root, { create: false })) !==
          (await projectKey(options.adoptFrom, { create: false }))
      )
        fail("adoption_key_conflict");
      install.shared = {
        id: randomUUID(),
        root,
        policy: options.adopt ? "adopt-existing" : "initialize-shared",
        initialized: false,
        ready: false,
        ...(options.adoptFrom ? { adoptFrom: options.adoptFrom } : {}),
      };
      for (const client of CLIENTS)
        install.clients[client] = {
          root,
          state: "pending",
          ...(client === "claude" ? { profileRoot } : {}),
        };
      await saveInstall(locations, install);
      await options.checkpoint?.("binding-written");
    }
    if (options.adoptFrom && (!options.adopt || install.shared.adoptFrom !== options.adoptFrom))
      fail("pending_binding_mismatch");
    if (!install.shared.initialized) {
      if (install.shared.adoptFrom && !(await keyPresent(root))) {
        const source = await projectKey(install.shared.adoptFrom, { create: false });
        await privateWrite(join(root, "project-key"), `${source}\n`, {
          exclusive: true,
          checkpoint: options.checkpoint,
        });
        if ((await projectKey(root, { create: false })) !== source) fail("adoption_key_conflict");
      }
      // Retrying after publication always reads the winner. Adoption never creates.
      await projectKey(root, {
        create: install.shared.policy === "initialize-shared",
        checkpoint: options.checkpoint,
      });
      install.shared.initialized = true;
      await saveInstall(locations, install);
      await options.checkpoint?.("initialized");
    } else if (!(await keyPresent(root, { strict: true }))) return disabled("paired_key_missing");
    const record = {
      version: 1,
      id: install.shared.id,
      root,
      participants: CLIENTS,
      policy: install.shared.policy,
    };
    await privateWrite(locations.pairing, JSON.stringify(record));
    // Establish the EOF barrier before either client can become active.
    if (!install.shared.barrier) {
      const before = await readControlState(root);
      await setPaused(root, true, { rotate: true });
      if (!before.paused) await setPaused(root, false);
      install.shared.barrier = true;
      await saveInstall(locations, install);
    }
    return {
      status: install.shared.ready ? "paired" : "binding_pending",
      enabled: install.shared.ready,
      pairingRecord: locations.pairing,
      root,
    };
  });
}

/** Call only after BOTH hook configurations have the record and workers are stopped. */
export async function completePairing(options = {}) {
  if (
    options.hostsStopped !== true ||
    !CLIENTS.every((client) => options.configured?.[client] === true)
  )
    fail("binding_configuration_required");
  return locked({ ...options, setup: true }, async ({ install, record, locations }) => {
    if (install.resetPending) fail("identity_reset_pending");
    if (
      !record ||
      !install.shared?.initialized ||
      !install.shared.barrier ||
      install.shared.id !== record.id ||
      install.shared.root !== record.root
    )
      fail("pending_binding_mismatch");
    if (!(await keyPresent(record.root, { strict: true }))) return disabled("paired_key_missing");
    for (const client of CLIENTS)
      install.clients[client] = {
        ...install.clients[client],
        root: record.root,
        state: "established",
      };
    install.shared.ready = true;
    await saveInstall(locations, install);
    return { status: "paired", enabled: true, pairingRecord: locations.pairing, root: record.root };
  });
}

/** Explicit stopped-worker identity reset; old roots and memories are retained. */
export async function resetIdentity(options = {}) {
  if (
    options.confirmIdentityReset !== true ||
    options.hostsStopped !== true ||
    !CLIENTS.includes(options.primaryClient)
  )
    fail("identity_reset_confirmation_required");
  const locations = stateLocations({ ...options, setup: true });
  durable(options.root, locations);
  return locked({ ...options, setup: true }, async ({ install, record, keys }) => {
    if (
      !install.shared ||
      (!record && !install.resetPending) ||
      options.root === install.shared.root ||
      (keys.includes(options.root) && !install.resetPending)
    )
      fail("identity_reset_requires_new_root");
    if (install.resetPending && install.resetPending.root !== options.root)
      fail("pending_binding_mismatch");
    install.resetPending = { root: options.root, client: options.primaryClient };
    await saveInstall(locations, install);
    // Retire the old root before the new identity can become active. Retrying a
    // stopped-host reset may rotate again, but never re-enables old workers.
    await setPaused(install.shared.root, true, { rotate: true });
    await privateWrite(
      join(install.shared.root, "retired"),
      JSON.stringify({ version: 1, retired: true }),
    );
    await projectKey(options.root);
    await setPaused(options.root, true, { rotate: true });
    const retired = [
      ...(install.retired ?? []),
      { ...install.shared, invalidated: true, claude: { ...install.clients.claude } },
    ];
    await unlink(locations.pairing).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await saveInstall(locations, {
      version: 1,
      retired,
      clients: {
        [options.primaryClient]: {
          root: options.root,
          state: "established",
          initialized: true,
          ...(options.primaryClient === "claude"
            ? { profileRoot: install.clients.claude.profileRoot }
            : {}),
        },
      },
    });
    return {
      status: "identity_reset",
      root: options.root,
      disclosure:
        "Old project memories are no longer addressable by the new identity; " +
        "the second client requires explicit adoption. Resume starts at EOF.",
    };
  });
}
