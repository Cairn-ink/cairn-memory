import { homedir, tmpdir, uptime } from "node:os";
import { isAbsolute, join, resolve, relative, dirname } from "node:path";
import {
  opendir,
  open,
  readFile,
  readlink,
  unlink,
  lstat,
  stat,
  access,
  realpath,
  link,
  mkdir,
  writeFile,
  rmdir,
  rename,
  readdir,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import {
  privateDirectory,
  privateRead,
  privateWrite,
  checkedPath,
  probeEntry,
  notifyWrite,
  syncDirectory,
} from "./private-state.mjs";
import { withFileLock } from "./file-lock.mjs";

import { setPaused, readControlState } from "./control-state.mjs";

async function randomIdFile(dataDir, filename, { create = true, client = "claude", home } = {}) {
  const path = join(dataDir, filename);
  async function readIdentity() {
    const entry = await probeEntry(path, {
      read: () => readFile(path, "utf8"),
    });
    if (entry.state === "unknown") failUnreadable(entry.code);
    if (entry.state === "absent") {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
    const value = entry.value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`invalid_identity: ${filename}`);
    }
    if (filename === "project-key") await cleanupKeyPublication(resolve(dataDir));
    return value;
  }
  try {
    return await readIdentity();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (filename === "project-key") {
    await publishProjectKey(dataDir, { create, strict: false, client, home });
    return readIdentity();
  }
  if (!create) throw new Error("standalone_key_missing");
  await publishLegacyFile(dataDir, filename);
  return readIdentity();
}

/** One tri-state marker probe; invalid-but-present markers still count. */
async function markerProbe(root, name) {
  const directory = join(root, ".");
  const parent = await probeEntry(directory, { read: () => stat(directory) });
  if (parent.state !== "present") return parent;
  if (!parent.value.isDirectory() || !owned(parent.value)) return { state: "absent" };
  return probeEntry(join(directory, name));
}
async function rootMarkerImpl(root, name) {
  const entry = await markerProbe(root, name);
  if (entry.state === "unknown") failUnreadable(entry.code);
  return entry.state === "present";
}

/** Every durable recorded pair root, independent of readiness or root-local markers. */
function recordedPairRootsImpl(coordination) {
  const readable = coordination.coordination === "readable" || coordination.state === "readable";
  const install = readable ? (coordination.install ?? { clients: {} }) : { clients: {} };
  return [
    ...new Set(
      [
        install.shared?.root,
        readable && coordination.record?.root,
        ...(coordination.durableHistory?.state === "valid"
          ? [
              coordination.durableHistory.root,
              ...(coordination.durableHistory.roots ?? []).map((entry) => entry.root),
            ]
          : []),
        install.resetPending?.root,
        ...Object.values(install.clients ?? {})
          .filter((binding) => binding.fingerprint)
          .map((binding) => binding.root),
        ...(install.retired ?? []).flatMap((entry) => [
          entry.root,
          ...CLIENTS.map((name) => entry[name]?.root),
        ]),
      ].filter(Boolean),
    ),
  ];
}

/** Filesystem identity belongs in the probe layer, never in the pure decision. */
async function rootIdentity(path, { cache = new Map() } = {}) {
  path = resolve(path);
  const inspect = (candidate) => {
    if (!cache.has(candidate))
      cache.set(
        candidate,
        probeEntry(candidate, {
          read: async () => ({
            path: await realpath(candidate),
            info: await stat(candidate),
          }),
        }),
      );
    return cache.get(candidate);
  };
  const entry = await inspect(path);
  if (entry.state === "unknown") failUnreadable(entry.code);
  if (entry.state === "present") return { present: true, ...entry.value };
  let ancestor = dirname(path);
  for (;;) {
    const parent = await inspect(ancestor);
    if (parent.state === "unknown") failUnreadable(parent.code);
    if (parent.state === "present") {
      if (!parent.value.info.isDirectory()) failUnreadable("ENOTDIR");
      return {
        present: false,
        path: resolve(parent.value.path, relative(ancestor, path)),
      };
    }
    const next = dirname(ancestor);
    if (next === ancestor) failUnreadable("ENOENT");
    ancestor = next;
  }
}
async function sameRootImpl(a, b, options = {}) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (resolve(a) === resolve(b)) return true;
  const cache = options.cache ?? new Map();
  const left = await rootIdentity(a, { cache });
  const right = await rootIdentity(b, { cache });
  if (left.present !== right.present) return false;
  return (
    left.path === right.path ||
    (left.present && left.info.dev === right.info.dev && left.info.ino === right.info.ino)
  );
}
async function containsRoot(roots, root) {
  for (const candidate of roots) if (await sameRoot(candidate, root)) return true;
  return false;
}
const failUnreadable = (code) => {
  const error = new Error("state_unreadable");
  error.detail = code;
  throw error;
};

async function publishLegacyFile(dataDir, filename) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const value = randomUUID();
  const temporaryPath = join(dataDir, `.${filename}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${value}\n`, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporaryPath, join(dataDir, filename));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

const repairCapability = Symbol("explicit original-key restore");
const creationCapability = Symbol("explicit pending first publication");
const validKey = (key) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);

// The only publication gate for project-key, including legacy creation and adoption.
async function publishProjectKey(
  dataDir,
  {
    create = true,
    strict = true,
    checkpoint,
    originalKey,
    capability,
    repairProfileRoot,
    home,
    client = "claude",
  } = {},
) {
  // Preserve 0.1.1's empty plugin-data error rather than resolving it to cwd.
  if (dataDir === "" && !strict) await mkdir(dataDir, { recursive: true });
  dataDir = resolve(dataDir);
  if (!CLIENTS.includes(client)) fail("invalid_client");
  if (capability === repairCapability) {
    const history = await readBindingHistory(repairProfileRoot);
    if (
      history.state !== "valid" ||
      !(await sameRoot(history.root, dataDir)) ||
      history.fingerprint !== identityFingerprint(originalKey ?? "")
    )
      fail("repair_key_conflict");
  }
  const retired = await markerProbe(dataDir, "retired");
  if (retired.state === "unknown") failUnreadable(retired.code);
  if (retired.state === "present") fail("pairing_needed");
  const marker = await markerProbe(dataDir, "paired-root");
  if (marker.state === "unknown") failUnreadable(marker.code);
  const coordination = await probeCoordination(stateLocations({ home: home ?? homedir() }));
  if (coordination.coordination === "degraded" && capability !== repairCapability) {
    if (!create) fail(strict ? "paired_key_missing" : "standalone_key_missing");
    failUnreadable(coordination.detail);
  }
  if (coordination.durableHistory?.state === "invalid") fail("binding_history_invalid");
  const recorded = await containsRoot(recordedPairRoots(coordination), dataDir);
  if (marker.state === "present" || recorded) {
    const pending = coordination.install.resetPending ?? coordination.install.shared;
    const firstPublication =
      capability === creationCapability &&
      marker.state === "absent" &&
      pending &&
      (await sameRoot(pending.root, dataDir)) &&
      !pending.initialized;
    if (capability !== repairCapability && !firstPublication) throw new Error("paired_key_missing");
  }
  if (!create) throw new Error(strict ? "paired_key_missing" : "standalone_key_missing");
  if (originalKey !== undefined && !validKey(originalKey))
    throw new Error("invalid_identity: project-key");
  const publish = async () => {
    const keyPath = join(dataDir, "project-key");
    const existing = await probeEntry(keyPath, {
      read: () => readFile(keyPath, "utf8"),
    });
    if (existing.state === "unknown") failUnreadable(existing.code);
    if (existing.state === "present") {
      await cleanupKeyPublication(dataDir);
      return; // EEXIST reads the winner, never rewrites it.
    }
    const pendingPath = join(dataDir, ".project-key.pending");
    const staged = await probeEntry(pendingPath, {
      read: () => privateRead(pendingPath, { missing: true, portable: !strict }),
    });
    if (staged.state === "unknown") failUnreadable(staged.code);
    if (staged.state === "present") {
      // Staging is intent, never authority to restore a deleted key. Recheck the
      // ordinary mint gate above and publish a new value (or the explicit backup).
      await unlink(pendingPath);
      await notifyWrite(pendingPath, "unlink");
    }
    const prior = await creatorRecord(dataDir);
    if (prior.state === "unknown") failUnreadable(prior.code);
    if (
      (marker.state === "present" || recorded) &&
      prior.state === "present" &&
      capability !== repairCapability &&
      capability !== creationCapability
    )
      fail("paired_key_missing");
    const value = {
      version: 1,
      client: prior.value?.client ?? client,
      key: originalKey ?? randomUUID(),
    };
    await writeIdentityFile(pendingPath, JSON.stringify(value), { strict });
    // Creator intent is durable before the key becomes visible. Both are published
    // under the mint lock; only the linked project-key establishes a winner.
    await writeIdentityFile(
      join(dataDir, "created-by"),
      JSON.stringify({
        version: 1,
        client: value.client,
        fingerprint: identityFingerprint(value.key),
      }),
      { strict },
    );
    await writeIdentityFile(keyPath, `${value.key}\n`, {
      strict,
      exclusive: true,
      checkpoint,
    });
    const winner = (await readFile(keyPath, "utf8")).trim();
    if (winner !== value.key) {
      if (capability === repairCapability) fail("repair_key_conflict");
      // A released pre-creator writer can win EEXIST without obeying the mint lock.
      // Its existing key has no trustworthy creator; do not attribute it to us.
      const creator = await creatorRecord(dataDir);
      if (creator.value?.fingerprint === identityFingerprint(value.key)) {
        await unlink(join(dataDir, "created-by"));
        await notifyWrite(join(dataDir, "created-by"), "unlink");
      }
    }
    await unlink(pendingPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await notifyWrite(pendingPath, "unlink");
  };
  if (strict) await privateDirectory(dataDir);
  else await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (capability === creationCapability || capability === repairCapability) await publish();
  else {
    const acquired = await withFileLock(join(dataDir, ".project-key.lock"), publish, {
      timeoutMs: 5000,
      pollMs: 10,
    });
    if (!acquired) {
      const winner = await probeEntry(join(dataDir, "project-key"));
      if (winner.state !== "present") fail("key_publication_busy");
    }
  }
}

// A successful key probe may remove interrupted publication artifacts. A live
// publisher owns its staging file; only an absent or definitively dead lock permits
// cleanup. No staging value is ever used to restore a deleted project-key.
async function cleanupKeyPublication(root) {
  const pendingPath = join(root, ".project-key.pending");
  const lockPath = join(root, ".project-key.lock");
  const pending = await probeEntry(pendingPath);
  const lock = await probeEntry(lockPath, {
    read: () => privateRead(lockPath, { missing: true, portable: true }),
  });
  if (pending.state === "unknown") failUnreadable(pending.code);
  if (lock.state === "unknown") failUnreadable(lock.code);
  if (pending.state === "absent" && lock.state === "absent") return;
  const cleanup = async () => {
    if ((await privateRead(pendingPath, { missing: true, portable: true })) !== undefined) {
      await unlink(pendingPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await notifyWrite(pendingPath, "unlink");
    }
  };
  if (lock.state === "absent") return cleanup();
  let owner;
  try {
    owner = JSON.parse(lock.value);
  } catch {
    failUnreadable("invalid_key_publication_lock");
  }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    failUnreadable("invalid_key_publication_lock");
  try {
    process.kill(owner.pid, 0);
    return;
  } catch (error) {
    if (error.code !== "ESRCH") return;
  }
  await withFileLock(lockPath, cleanup, { timeoutMs: 250, pollMs: 10 });
}

async function writeIdentityFile(path, bytes, { strict, exclusive = false, checkpoint } = {}) {
  if (strict) return privateWrite(path, bytes, { exclusive, checkpoint });
  await checkedPath(path, { missing: true, portable: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const staged = await open(temporary, "wx", 0o600);
  try {
    await staged.writeFile(bytes);
    await staged.sync();
  } finally {
    await staged.close();
  }
  try {
    if (exclusive) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } else await rename(temporary, path);
    if (process.platform !== "win32") await syncDirectory(dirname(path));
    await notifyWrite(path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function creatorRecord(root) {
  root = resolve(root);
  const parent = await probeEntry(root, { read: () => stat(root) });
  if (parent.state === "present" && !owned(parent.value)) return { state: "absent" };
  const existence = await probeEntry(join(root, "created-by"));
  const entry = await probeEntry(join(root, "created-by"), {
    read: () => privateRead(join(root, "created-by"), { missing: true, portable: true }),
  });
  if (entry.state === "absent") {
    const pending = await probeEntry(join(root, ".project-key.pending"), {
      read: () =>
        privateRead(join(root, ".project-key.pending"), {
          missing: true,
          portable: true,
        }),
    });
    if (pending.state !== "present") return pending;
    try {
      const value = JSON.parse(pending.value);
      if (value.version !== 1 || !CLIENTS.includes(value.client) || !validKey(value.key))
        throw new Error("invalid_key_publication");
      return {
        state: "present",
        value: {
          version: 1,
          client: value.client,
          fingerprint: identityFingerprint(value.key),
        },
      };
    } catch (error) {
      return { state: "unknown", code: "invalid_key_publication", error };
    }
  }
  if (entry.state !== "present")
    return { ...entry, present: existence.state === "present" };
  try {
    const value = JSON.parse(entry.value);
    if (
      value.version !== 1 ||
      !CLIENTS.includes(value.client) ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint)
    )
      throw new Error("invalid_creator_record");
    return { state: "present", value };
  } catch (error) {
    return { state: "unknown", code: "invalid_creator_record", error, present: true };
  }
}

async function firstProjectKey(root, { client = "claude", home, checkpoint } = {}) {
  if (!(await keyPresent(root, { strict: true })))
    await publishProjectKey(root, {
      client,
      home,
      checkpoint,
      capability: creationCapability,
    });
  return projectKey(root, { create: false });
}

/** Restore only the supplied original backup; never generate a repair identity. */
async function restoreProjectKey(dataDir, originalKey, profileRoot, home) {
  if (typeof originalKey !== "string" || !validKey(originalKey))
    throw new Error("invalid_identity: project-key");
  await privateDirectory(dataDir);
  const entry = await probeEntry(join(dataDir, "project-key"), {
    read: () => privateRead(join(dataDir, "project-key"), { missing: true }),
  });
  if (entry.state === "unknown") failUnreadable(entry.code);
  const existing = entry.value;
  if (existing === undefined)
    await publishProjectKey(dataDir, {
      originalKey,
      capability: repairCapability,
      repairProfileRoot: profileRoot,
      home,
    });
  const winner = await projectKey(dataDir, { create: false });
  if (winner !== originalKey) throw new Error("repair_key_conflict");
  return winner;
}

/** Anonymous product telemetry id. This value may be sent to Cairn. */
function installIdImpl(dataDir) {
  return randomIdFile(dataDir, "install-id");
}

/**
 * Stable project id keyed with a separate secret that never leaves the device.
 * Keeping it separate from installId prevents Cairn from testing likely paths.
 */
async function projectKeyImpl(
  dataDir,
  { create = true, checkpoint, originalKey, home, client = "claude" } = {},
) {
  if (originalKey !== undefined) fail("invalid_original_key");
  await checkedPath(dataDir, { directory: true, missing: true });
  const path = join(dataDir, "project-key");
  const entry = await probeEntry(path, {
    read: () => privateRead(path, { missing: true }),
  });
  if (entry.state === "unknown") failUnreadable(entry.code);
  let value = entry.value;
  if (value === undefined) {
    await publishProjectKey(dataDir, { create, checkpoint, home, client });
    value = await privateRead(path);
  }
  const key = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("invalid_identity: project-key");
  }
  await cleanupKeyPublication(dataDir);
  return key;
}

async function opaqueProjectIdImpl(dataDir, cwd, options) {
  if (!cwd) return undefined;
  const key = options?.strict
    ? await projectKey(dataDir, options)
    : await randomIdFile(dataDir, "project-key", options);
  return createHmac("sha256", key).update(String(cwd)).digest("hex");
}

const CLIENTS = ["claude", "codex"];
const fail = (message) => {
  throw new Error(message);
};
const absolute = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  isAbsolute(value) &&
  resolve(value) === value;

const normalizeRoot = (root) =>
  typeof root === "string" && isAbsolute(root) ? resolve(root) : root;
const beneath = (parent, child) =>
  child === parent ||
  (!relative(parent, child).startsWith("..") && !isAbsolute(relative(parent, child)));

function stateLocationsImpl({
  home = homedir(),
  temporary = tmpdir(),
  env = process.env,
  setup = false,
} = {}) {
  if (setup && !absolute(home)) fail("pairing_requires_durable_home");
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
    claudeRoot: normalizeRoot(env.CLAUDE_PLUGIN_DATA ?? join(base, ".cairn-memory")),
    knownClaudeRoot:
      env.CLAUDE_PLUGIN_DATA ?? join(base, ".claude/plugins/data/cairn-memory-cairn-memory"),
  };
}

async function probeCoordination(locations) {
  const empty = {
    coordination: "absent",
    install: { version: 1, clients: {} },
    record: undefined,
  };
  const home = await probeEntry(locations.home || locations.temporary, {
    read: () => stat(locations.home || locations.temporary),
  });
  if (
    home.state !== "present" ||
    !home.value.isDirectory() ||
    !(await probe(async () => {
      await access(locations.home || locations.temporary, constants.X_OK);
      return true;
    }, false))
  )
    return empty;
  locations.durableHome = (await rootIdentity(locations.home || locations.temporary)).path;
  const durableHistory = await readBindingHistory(locations.home || locations.temporary);
  empty.durableHistory = durableHistory;
  const entry = await probeEntry(locations.coordination);
  if (entry.state === "absent") return empty;
  if (entry.state === "unknown") return { ...empty, coordination: "degraded", detail: entry.code };
  if (entry.value.isSymbolicLink()) {
    const target = await probeEntry(locations.coordination, {
      read: () => stat(locations.coordination),
    });
    if (target.state === "absent") return empty;
    return { ...empty, coordination: "degraded", detail: "state_symlink" };
  }
  if (!entry.value.isDirectory() || !owned(entry.value)) return empty;
  try {
    await checkedPath(locations.coordination, { directory: true });
    const install = validateInstall(await jsonFile(locations.install));
    const record = await jsonFile(locations.pairing);
    if (record) validateRecord(record, locations);
    return { coordination: "readable", install, record, durableHistory };
  } catch (error) {
    const entries = await Promise.all(
      [locations.install, locations.pairing].map((path) => probeEntry(path)),
    );
    if (entries.every((entry) => entry.state === "absent")) return empty;
    return {
      ...empty,
      coordination: "degraded",
      detail: error.code ?? error.message,
    };
  }
}

async function jsonFile(path) {
  const entry = await probeEntry(path, {
    read: () => privateRead(path, { missing: true }),
  });
  if (entry.state === "unknown") failUnreadable(entry.code);
  const text = entry.value;
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
      !["established", "pending"].includes(binding?.state) ||
      (binding?.fingerprint !== undefined && !/^[0-9a-f]{64}$/.test(binding.fingerprint))
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
  for (const receipt of [value.resetPending, value.lastReset]) {
    if (
      receipt &&
      (!absolute(receipt.root) ||
        !CLIENTS.includes(receipt.client) ||
        (receipt.initialized !== undefined && typeof receipt.initialized !== "boolean") ||
        (receipt.profileRoot !== undefined && !absolute(receipt.profileRoot)))
    )
      fail("invalid_install");
  }
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
  if (
    !beneath(locations.durableHome ?? locations.home, root) &&
    [locations.temporary, "/tmp", "/var/tmp"].some((path) => beneath(path, root))
  )
    fail("temporary_pairing_root");
}
async function requireTemporarySource(root, locations) {
  if (!absolute(root)) fail("adopt_from_requires_temporary_root");
  const source = await realpath(root);
  const home = await realpath(locations.home);
  const temporaryRoots = (
    await Promise.all(
      [locations.temporary, "/tmp", "/var/tmp"].map((path) =>
        probe(() => realpath(path), undefined),
      ),
    )
  ).filter(Boolean);
  if (beneath(home, source) || !temporaryRoots.some((parent) => beneath(parent, source)))
    fail("adopt_from_requires_temporary_root");
}

async function keyPresent(root, { strict = false } = {}) {
  if (strict && !absolute(root)) fail("invalid_state_path");
  const entry = await probeEntry(join(root, "project-key"), {
    read: async () => {
      if (strict) {
        await checkedPath(root, { directory: true, missing: true });
        return privateRead(join(root, "project-key"), { missing: true });
      }
      return readFile(join(root, "project-key"), "utf8");
    },
  });
  if (entry.state === "unknown") failUnreadable(entry.code);
  if (entry.state === "absent" || entry.value === undefined) return false;
  if (!validKey(entry.value.trim())) fail("invalid_identity: project-key");
  await cleanupKeyPublication(resolve(root));
  return true;
}

/** Bounded metadata-only evidence in Cairn's root; never read a host transcript. */
async function hasClaudeEvidenceImpl(root) {
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
async function detectClientsImpl(options = {}) {
  const locations = stateLocations(options);
  if (options.claudeProfileRoot !== undefined && !absolute(options.claudeProfileRoot))
    fail("invalid_claude_profile_root");
  const coordination = await probeCoordination(locations);
  if (coordination.coordination === "degraded") failUnreadable(coordination.detail);
  if (coordination.durableHistory?.state === "invalid") fail("binding_history_invalid");
  const { install, record } = coordination;
  const roots = [
    ...new Set([
      locations.defaultRoot,
      ...(options.root ? [options.root] : []),
      locations.knownClaudeRoot,
      locations.claudeRoot,
      ...(options.claudeProfileRoot === undefined ? [] : [options.claudeProfileRoot]),
      ...Object.values(install.clients).map((binding) => binding.root),
      ...(record ? [record.root] : []),
      ...(install.resetPending ? [install.resetPending.root] : []),
    ]),
  ];
  const keys = [];
  for (const root of roots) {
    const entry = await probeEntry(join(root, "project-key"), {
      read: () => readFile(join(root, "project-key"), "utf8"),
    });
    if (entry.state === "unknown") {
      const usedRoots = [
        options.root ?? locations.defaultRoot,
        options.adoptFrom,
        options.claudeProfileRoot ??
          (options.env ?? process.env).CLAUDE_PLUGIN_DATA ??
          (options.standardClaudeOrigin ? locations.knownClaudeRoot : undefined),
        ...recordedPairRoots(coordination),
      ].filter(Boolean);
      if (!options.setup || (await containsRoot(usedRoots, root))) failUnreadable(entry.code);
    }
    if (entry.state === "present" && validKey(entry.value.trim())) keys.push(root);
  }
  return { ...coordination, locations, install, record, keys };
}

/** Boot and namespace identity belong to lock owners, not durable bindings. */
async function localLivenessImpl({ platform = process.platform } = {}) {
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
    return {
      boot: Date.now() - uptime() * 1000,
      namespace: "darwin",
      platform,
      isAlive,
    };
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
  const inspect = options.claudeFacts ? probeClaudeFacts : detectClients;
  await inspect(options);
  const locations = stateLocations(options);
  const liveness = options.liveness ?? (await localLiveness());
  // Unsupported lock ownership must not create coordination and turn an
  // otherwise fresh standalone install into degraded state (notably Windows).
  if (!liveness.namespace) fail("pairing_platform_unsupported");
  const coordinationExisted = !!(await probe(() => lstat(locations.coordination), undefined));
  await privateDirectory(locations.coordination);
  try {
    await checkedPath(locations.lock, { missing: true });
    await options.beforeSetupLock?.();
    let result;
    const acquired = await withFileLock(
      locations.lock,
      async () => {
        result = await work(await inspect(options), liveness);
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
    if (!coordinationExisted) await rmdir(locations.coordination).catch(() => {});
    return result;
  } catch (error) {
    if (!coordinationExisted) await rmdir(locations.coordination).catch(() => {});
    throw error;
  }
}

// Explicit setup touches only this finite set of private files. Never scan a HOME
// or a host directory. Rollback runs under the same setup lock, with hosts stopped.
async function setupTransaction(options, work) {
  const operation = options.setupOperation;
  return locked(options, async (snapshot, liveness) => {
    const { locations, install } = snapshot;
    const profileRoot = normalizeRoot(
      options.claudeProfileRoot ??
        claudeRegistration(install)?.profileRoot ??
        (options.env ?? process.env).CLAUDE_PLUGIN_DATA,
    );
    const registeredProfile = claudeRegistration(install)?.profileRoot;
    if (registeredProfile && !(await sameRoot(profileRoot, registeredProfile)))
      fail("claude_profile_mismatch");
    const history = profileRoot && (await readBindingHistory(profileRoot));
    const codexHistory = await readBindingHistory(locations.home);
    if (codexHistory.state === "invalid") fail("binding_history_invalid");
    if (operation === "repair" && !claudeRegistration(install)?.profileRoot)
      fail("repair_binding_missing");
    if (history?.state === "invalid")
      fail(operation === "repair" ? "binding_history_invalid" : "binding_identity_mismatch");
    const destination = options.root ?? snapshot.record?.root ?? locations.defaultRoot;
    if (operation !== "reset" && codexHistory.state === "valid") {
      if (!(await sameRoot(codexHistory.root, destination))) fail("binding_identity_mismatch");
      if (await keyPresent(destination)) {
        const fingerprint = identityFingerprint(await projectKey(destination, { create: false }));
        if (fingerprint !== codexHistory.fingerprint)
          fail(operation === "repair" ? "repair_key_conflict" : "binding_identity_mismatch");
      }
    }
    if (operation !== "reset" && history?.state === "valid") {
      if (!(await sameRoot(history.root, destination))) fail("binding_identity_mismatch");
      if (await keyPresent(destination)) {
        const fingerprint = identityFingerprint(await projectKey(destination, { create: false }));
        if (fingerprint !== history.fingerprint)
          fail(operation === "repair" ? "repair_key_conflict" : "binding_identity_mismatch");
      }
    }
    if (operation !== "reset" && (await keyPresent(destination))) {
      const fingerprint = identityFingerprint(await projectKey(destination, { create: false }));
      for (const binding of Object.values(install.clients))
        if (
          (await sameRoot(binding.root, destination)) &&
          binding.fingerprint &&
          binding.fingerprint !== fingerprint
        )
          fail(operation === "repair" ? "repair_key_conflict" : "binding_identity_mismatch");
    }
    const roots = [
      ...new Set(
        [
          destination,
          ...(operation === "reset" ? [] : recordedPairRoots(snapshot)),
          operation === "reset" ? (install.shared?.root ?? history?.root) : undefined,
        ].filter(Boolean),
      ),
    ];
    const files = [
      locations.install,
      locations.pairing,
      ...roots.flatMap((root) =>
        [
          "project-key",
          "created-by",
          ".project-key.pending",
          "paired-root",
          "retired",
          "control.json",
          "paused",
        ].map((name) => join(root, name)),
      ),
      bindingHistoryPath(locations.home),
      ...(profileRoot ? [bindingHistoryPath(profileRoot)] : []),
    ];
    const directories = new Set();
    const previous = new Map();
    // Validate every write target before any durable side effect. Cairn-owned leaf
    // directories are strict; host-owned ancestors keep their existing modes.
    for (const path of files) {
      const parent = dirname(path);
      await checkedPath(parent, { directory: true, missing: true });
      let directory = parent;
      while (!(await probe(() => lstat(directory), undefined))) {
        directories.add(directory);
        const ancestor = dirname(directory);
        if (ancestor === directory) break;
        directory = ancestor;
      }
      const bytes = await privateRead(path, { missing: true });
      previous.set(path, bytes);
    }
    async function rollback() {
      for (const [path, bytes] of previous) {
        const current = await privateRead(path, { missing: true });
        if (current === bytes) continue;
        if (bytes === undefined)
          await unlink(path).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        else await privateWrite(path, bytes);
      }
      for (const path of [...directories].sort((a, b) => b.length - a.length))
        await rmdir(path).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    try {
      // A later setup supersedes the reset receipt before its first state change.
      // The existing rollback restores it when that operation fails.
      if (snapshot.install.lastReset && operation !== "reset")
        await saveInstall(locations, snapshot.install);
      const result = await work(snapshot, liveness);
      await options.checkpoint?.("before-commit");
      if (
        !result ||
        !["paired", "binding_pending", "identity_reset", "key_restored"].includes(result.status)
      )
        await rollback();
      return result;
    } catch (error) {
      await rollback();
      throw error;
    }
  });
}
const saveInstall = (locations, install, { resetReceipt = false } = {}) => {
  if (!resetReceipt) delete install.lastReset;
  return privateWrite(locations.install, JSON.stringify(validateInstall(install)));
};
const disabled = (status = "pairing_needed", detail) => ({
  status,
  enabled: false,
  ...(detail ? { detail } : {}),
});

function parsePairingRecordImpl(argv = []) {
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

async function activeBinding(root, env, status = "single", paired = false) {
  if (await retiredRoot(root)) return disabled("pairing_needed", "retired root");
  if (
    paired &&
    env.CAIRN_MEMORY_STATE_DIR !== undefined &&
    !(await sameRoot(env.CAIRN_MEMORY_STATE_DIR, root))
  ) {
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

async function selectCodexBinding(options, snapshot, delivered) {
  const { client = "claude", env = process.env } = options;
  const { locations, install, record, keys } = snapshot;
  const binding = install.clients[client];
  if (
    snapshot.durableHistory?.state === "valid" &&
    (snapshot.coordination !== "readable" || !binding?.fingerprint)
  )
    return disabled("pairing_record_missing");
  if (delivered !== undefined) {
    if (!absolute(delivered) || delivered !== locations.pairing) {
      fail("pairing_record_mismatch");
    }
    if (!record) fail("pairing_record_missing");
  }
  if (install.resetPending) return disabled();
  if (record || install.shared || binding?.state === "pending") {
    if (!record || !delivered || !install.shared?.ready) return disabled();
    if (process.platform === "win32") fail("pairing_platform_unsupported");
    if (
      !binding ||
      binding.state !== "established" ||
      !(await sameRoot(binding.root, record.root)) ||
      !install.shared.initialized ||
      install.shared.id !== record.id ||
      !(await sameRoot(install.shared.root, record.root)) ||
      install.shared.policy !== record.policy
    ) {
      fail("pairing_record_mismatch");
    }
    if (await retiredRoot(record.root)) return disabled("pairing_needed", "retired root");
    if (!(await keyPresent(record.root, { strict: true }))) {
      return disabled("paired_key_missing");
    }
    if (
      (snapshot.durableHistory?.state === "valid" &&
        (!(await sameRoot(snapshot.durableHistory.root, record.root)) ||
          snapshot.durableHistory.fingerprint !== binding.fingerprint)) ||
      binding.fingerprint !== identityFingerprint(await projectKey(record.root, { create: false }))
    )
      return disabled("binding_identity_mismatch");
    return {
      ...(await activeBinding(record.root, env, "paired", true)),
      expectedFingerprint: binding.fingerprint,
    };
  }
  const other = install.clients[CLIENTS.find((name) => name !== client)];
  const root = binding?.root ?? options.root ?? locations.defaultRoot;
  if (!absolute(root)) fail("invalid_state_path");
  const pairedRoot =
    (await rootMarker(root, "paired-root")) ||
    (await containsRoot(recordedPairRoots(snapshot), root));
  if (pairedRoot && !binding?.fingerprint) return disabled("pairing_record_missing");
  if (pairedRoot && !(await keyPresent(root, { strict: true })))
    return disabled("paired_key_missing");
  const creator = await creatorRecord(root);
  if (creator.state === "unknown") failUnreadable(creator.code);
  if (creator.value?.client === "claude" && !binding) return disabled();
  let established =
    (binding?.state === "established" && (await sameRoot(binding.root, root))) ||
    creator.value?.client === "codex";
  const conflict =
    !!other ||
    (await probe(() => hasClaudeEvidence(root), false)) ||
    (client === "codex" &&
      keys.length > 0 &&
      (!(await containsRoot(keys, root)) ||
        keys.length > 1 ||
        (!established && options.usesClaude !== false)));
  if (!established && conflict) return disabled();
  if (
    client === "codex" &&
    !established &&
    !options.standardClaudeOrigin &&
    options.usesClaude !== false
  )
    return disabled();
  if (conflict && !(await containsRoot(keys, root))) return disabled();
  if (binding?.fingerprint) {
    if (!(await keyPresent(root, { strict: true }))) return disabled("paired_key_missing");
    if (binding.fingerprint !== identityFingerprint(await projectKey(root, { create: false })))
      return disabled("binding_identity_mismatch");
  }
  return {
    ...(await activeBinding(
      root,
      env,
      conflict || (creator.value?.client === "codex" && options.usesClaude !== false)
        ? "pairing_needed"
        : "single",
    )),
    expectedFingerprint: binding?.fingerprint,
  };
}

const retiredRoot = (root) => absolute(root) && rootMarker(root, "retired");

const profileMarkerPath = (root) => join(root, ".cairn-memory-profile", "legacy.json");
const bindingHistoryPath = (root) => join(root, ".cairn-memory-profile", "binding.json");
const identityFingerprint = (key) =>
  createHmac("sha256", key).update("cairn-memory:binding:v1").digest("hex");

async function readBindingHistory(profileRoot) {
  const directory = join(profileRoot, ".cairn-memory-profile");
  const parent = await probeEntry(directory);
  if (parent.state === "absent") return { state: "absent" };
  if (parent.state === "unknown") return { state: "invalid", detail: parent.code };
  const entry = await probeEntry(bindingHistoryPath(profileRoot));
  if (entry.state === "absent") return { state: "absent" };
  if (entry.state === "unknown") return { state: "invalid", detail: entry.code };
  const value = await probe(async () => {
    await checkedPath(directory, { directory: true });
    return jsonFile(bindingHistoryPath(profileRoot));
  }, undefined);
  if (
    value?.version !== 1 ||
    !(await sameRoot(value.profileRoot, profileRoot)) ||
    !absolute(value.root) ||
    !/^[0-9a-f]{64}$/.test(value.fingerprint) ||
    (value.roots !== undefined &&
      (!Array.isArray(value.roots) ||
        value.roots.some(
          (entry) => !absolute(entry.root) || !/^[0-9a-f]{64}$/.test(entry.fingerprint),
        )))
  )
    return { state: "invalid" };
  return { state: "valid", ...value };
}

// Only explicit reset may replace recorded scope. No option-clearing/leave side effect.
async function writeBindingHistory(profileRoot, root, { reset = false, install, home } = {}) {
  profileRoot = (await rootIdentity(profileRoot)).path;
  root = (await rootIdentity(root)).path;
  const previous = await readBindingHistory(profileRoot);
  const fingerprint = identityFingerprint(await projectKey(root, { create: false }));
  if (previous.state === "invalid") fail("binding_identity_mismatch");
  if (
    !reset &&
    previous.state === "valid" &&
    (!(await sameRoot(previous.root, root)) || previous.fingerprint !== fingerprint)
  )
    fail("binding_identity_mismatch");
  if (install) {
    for (const client of CLIENTS)
      if (await sameRoot(install.clients[client]?.root, root)) {
        install.clients[client].root = root;
        install.clients[client].fingerprint = fingerprint;
        if (client === "claude") install.clients[client].profileRoot = profileRoot;
      }
    if (await sameRoot(install.shared?.root, root)) install.shared.root = root;
    if (await sameRoot(install.resetPending?.root, root)) install.resetPending.root = root;
    for (const retired of install.retired ?? [])
      if (retired.claude && (await sameRoot(retired.claude.profileRoot, profileRoot)))
        retired.claude.profileRoot = profileRoot;
  }
  const homes = home ? [(await rootIdentity(home)).path] : [];
  for (const localRoot of new Set([profileRoot, ...homes])) {
    const localHistory = await readBindingHistory(localRoot);
    if (localHistory.state === "invalid") fail("binding_history_invalid");
    const roots =
      localHistory.state === "valid"
        ? [
            ...(localHistory.roots ?? []),
            { root: localHistory.root, fingerprint: localHistory.fingerprint },
          ]
        : [];
    roots.push({ root, fingerprint });
    await privateWrite(
      bindingHistoryPath(localRoot),
      JSON.stringify({
        version: 1,
        profileRoot: localRoot,
        root,
        fingerprint,
        roots: [...new Map(roots.map((entry) => [entry.root, entry])).values()],
      }),
    );
  }
}

const owned = (info) => typeof process.getuid !== "function" || info.uid === process.getuid();
const probe = async (read, missing) => {
  try {
    return await read();
  } catch {
    return missing;
  }
};

async function rootFacts(root, { strict = false, evidence = false, metadataOnly = false } = {}) {
  const info = await probe(() => stat(root), undefined);
  const usable = !!info?.isDirectory();
  const retiredEntry = await markerProbe(root, "retired");
  const sharedEntry = await markerProbe(root, "paired-root");
  const retired = retiredEntry.state === "present";
  const sharedMarker = sharedEntry.state === "present";
  const validKey = evidence && (await probe(() => keyPresent(root), false));
  // A present key is not freshness, even if its bytes are invalid. The ordinary
  // identity reader preserves released standalone errors without replacing it.
  const keyEntry = metadataOnly ? { state: "absent" } : await probeEntry(join(root, "project-key"));
  const key = keyEntry.state === "present";
  const creator = await creatorRecord(root);
  const keyRead = key
    ? await probeEntry(join(root, "project-key"), {
        read: () => readFile(join(root, "project-key"), "utf8"),
      })
    : keyEntry;
  let error;
  if (strict && !retired) {
    try {
      if (!(await keyPresent(root, { strict: true }))) error = "paired_key_missing";
    } catch (failure) {
      error = failure.code ?? failure.message.split(":")[0];
    }
  }
  return {
    root,
    creator: creator.value?.client,
    creatorState: creator.state,
    creatorPresent: creator.present,
    creatorError: creator.code,
    usable,
    markerState: [retiredEntry, sharedEntry].some((entry) => entry.state === "unknown")
      ? "unknown"
      : sharedEntry.state,
    keyState: keyRead.state,
    unreadable: [retiredEntry, sharedEntry, keyRead].find((entry) => entry.state === "unknown")
      ?.code,
    key,
    retired,
    sharedMarker,
    validKey,
    error,
    evidence: evidence && (await probe(() => hasClaudeEvidence(root), false)),
  };
}

/** Every filesystem failure becomes a fact, never another selection path. */
async function probeClaudeFactsImpl(options = {}) {
  const env = options.env ?? process.env;
  const locations = stateLocations(options);
  const base = locations.home || locations.temporary;
  const homeInfo = await probe(() => stat(base), undefined);
  const homeUsable =
    !!homeInfo?.isDirectory() &&
    (await probe(async () => {
      await access(base, constants.X_OK);
      return true;
    }, false));
  const facts = {
    locations,
    homeUsable,
    pluginRootAbsolute: absolute(locations.claudeRoot),
    coordination: "absent",
    registration: "none",
    install: { version: 1, clients: {} },
    record: undefined,
    canRegister: false,
    platform: options.liveness?.platform ?? process.platform,
  };
  if (homeUsable) Object.assign(facts, await probeCoordination(locations));
  const registration = claudeRegistration(facts.install);
  if (registration) {
    facts.registration = !(await sameRoot(registration.profileRoot, locations.claudeRoot))
      ? "other"
      : facts.install.clients.claude
        ? "self-active"
        : "self-retired";
  }
  facts.profile = await rootFacts(locations.claudeRoot);
  facts.profileIsRecordedPairRoot = await probe(
    () => containsRoot(recordedPairRoots(facts), locations.claudeRoot),
    false,
  );
  facts.bindingHistory = await readBindingHistory(locations.claudeRoot);
  facts.localMarker = "absent";
  const markerPath = profileMarkerPath(locations.claudeRoot);
  const markerDirectory = join(locations.claudeRoot, ".cairn-memory-profile");
  const markerParent = await probeEntry(markerDirectory);
  let markerEntry;
  if (markerParent.state === "unknown") facts.localMarker = "invalid";
  if (markerParent.state === "present") {
    const entry = await probeEntry(markerPath);
    if (entry.state === "unknown") facts.localMarker = "invalid";
    if (entry.state === "present") markerEntry = entry.value;
  }
  if (markerEntry) {
    facts.localMarker = "invalid";
    const marker = await probe(async () => {
      await checkedPath(join(locations.claudeRoot, ".cairn-memory-profile"), {
        directory: true,
      });
      return jsonFile(markerPath);
    }, undefined);
    if (
      marker?.version === 1 &&
      (await sameRoot(marker.profileRoot, locations.claudeRoot)) &&
      (await sameRoot(marker.root, locations.defaultRoot))
    )
      facts.localMarker = "valid";
  }
  // Only an own active binding can authorize probing a non-default shared root.
  if (facts.registration === "self-active") {
    facts.bound = await rootFacts(facts.install.clients.claude.root, {
      strict: !!facts.record && !!facts.install.shared?.ready,
    });
    if (
      (facts.bindingHistory.state === "valid" || facts.install.clients.claude.fingerprint) &&
      facts.bound.key
    ) {
      facts.bound.fingerprint = await probe(
        async () => identityFingerprint(await projectKey(facts.bound.root, { create: false })),
        undefined,
      );
    }
  }
  if (facts.registration === "none") {
    facts.default = await rootFacts(locations.defaultRoot, {
      evidence:
        (!facts.profile.key && facts.coordination !== "degraded") ||
        (facts.profile.root === locations.defaultRoot && facts.coordination !== "degraded"),
      metadataOnly: facts.profile.key && facts.profile.root !== locations.defaultRoot,
    });
  }
  for (const root of [facts.profile, facts.bound, facts.default].filter(Boolean))
    root.recorded = await probe(() => containsRoot(recordedPairRoots(facts), root.root), false);
  const option = env.CLAUDE_PLUGIN_OPTION_PAIRING_RECORD || undefined;
  const argument = options.pairingRecord || undefined;
  const delivered = argument ?? option;
  facts.delivery =
    delivered === undefined
      ? "none"
      : (argument && option && argument !== option) ||
          !absolute(delivered) ||
          delivered !== locations.pairing
        ? "wrong"
        : "delivered";
  facts.stateDir = env.CAIRN_MEMORY_STATE_DIR;
  facts.sameRoots = [];
  const identityCache = new Map();
  const relevant = [
    ...new Set(
      [
        locations.claudeRoot,
        locations.defaultRoot,
        facts.bound?.root,
        facts.record?.root,
        facts.install.shared?.root,
        facts.install.clients.codex?.root,
        facts.bindingHistory.root,
        facts.stateDir,
      ].filter((root) => typeof root === "string"),
    ),
  ];
  for (let i = 0; i < relevant.length; i++)
    for (let j = i + 1; j < relevant.length; j++) {
      // Unrelated unreadable roots do not gate the selected profile.
      if (await probe(() => sameRoot(relevant[i], relevant[j], { cache: identityCache }), false))
        facts.sameRoots.push([relevant[i], relevant[j]]);
    }
  return facts;
}

/** The only Claude root/eligibility decision. No I/O, clock, environment or throws. */
function resolveClaudeBindingImpl(facts) {
  const equal = (a, b) =>
    a === b || facts.sameRoots?.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  const stop = (status = "pairing_needed", detail) => ({
    enabled: false,
    root: undefined,
    createKey: false,
    status,
    ...(detail ? { detail } : {}),
  });
  const select = (root, createKey, status = "single", detail, paired = false) => {
    if (root.markerState === "unknown" || root.keyState === "unknown")
      return stop("state_unreadable", root.unreadable);
    if (root.retired) return stop("pairing_needed", "retired root");
    if (
      (root.sharedMarker ||
        root.recorded ||
        (facts.profileIsRecordedPairRoot && equal(root.root, facts.profile.root))) &&
      !root.key
    )
      return stop("paired_key_missing");
    if (paired && root.error) return stop(root.error);
    const registeredFingerprint =
      facts.registration === "self-active" && facts.install.clients.claude?.fingerprint;
    if (registeredFingerprint && !root.key) return stop("paired_key_missing");
    if (registeredFingerprint && registeredFingerprint !== root.fingerprint)
      return stop("binding_identity_mismatch");
    if (facts.bindingHistory?.state === "valid" && !root.key) return stop("paired_key_missing");
    if (
      facts.bindingHistory?.state === "valid" &&
      (!equal(facts.bindingHistory.root, root.root) ||
        facts.bindingHistory.fingerprint !== root.fingerprint)
    )
      return stop("binding_identity_mismatch");
    if (!createKey && !root.key)
      return stop(paired ? "paired_key_missing" : "standalone_key_missing", detail);
    if (paired && facts.stateDir !== undefined && !equal(facts.stateDir, root.root))
      return stop("state_dir_mismatch");
    return {
      enabled: true,
      root: root.root,
      createKey,
      status,
      paired,
      ...(facts.bindingHistory?.state === "valid"
        ? { expectedFingerprint: facts.bindingHistory.fingerprint }
        : registeredFingerprint
          ? { expectedFingerprint: registeredFingerprint }
          : {}),
      ...(detail ? { detail } : {}),
      register: false,
    };
  };
  if (facts.delivery === "wrong") return stop("pairing_record_mismatch");
  if (facts.durableHistory?.state === "invalid") return stop("binding_history_invalid");
  if (facts.profile.creatorState === "unknown")
    return stop("state_unreadable", facts.profile.creatorError);
  if (facts.profile.markerState === "unknown" || facts.profile.keyState === "unknown")
    return stop("state_unreadable", facts.profile.unreadable);
  if (facts.bindingHistory && facts.bindingHistory.state !== "absent") {
    if (
      facts.bindingHistory.state !== "valid" ||
      facts.coordination !== "readable" ||
      !["self-active", "self-retired"].includes(facts.registration) ||
      (facts.install.shared && !facts.record)
    )
      return stop("pairing_record_missing");
  }
  if (facts.coordination === "absent" && facts.localMarker !== "absent")
    return stop("pairing_record_missing");
  if (facts.coordination === "degraded") {
    if (facts.delivery !== "none") return stop("pairing_needed", "coordination unreadable");
    if (facts.profile.key)
      return select(facts.profile, false, "standalone_unregistered", "coordination unreadable");
    if (facts.localMarker === "valid")
      return select(facts.default, false, "standalone_unregistered", "coordination unreadable");
    return stop("pairing_needed", "coordination unreadable");
  }
  if (facts.delivery !== "none" && !facts.record) return stop("pairing_record_missing");
  if (facts.registration === "other") {
    if (facts.delivery !== "none") return stop("pairing_record_mismatch");
    return select(facts.profile, true, "standalone_unregistered");
  }
  if (facts.registration === "self-retired" || facts.install.resetPending) return stop();
  const binding = facts.install.clients.claude;
  if (facts.record || facts.install.shared || binding?.state === "pending") {
    const shared = facts.install.shared;
    if (!facts.record || facts.delivery === "none" || !shared?.ready) return stop();
    if (facts.platform === "win32") return stop("pairing_platform_unsupported");
    if (
      !binding ||
      binding.state !== "established" ||
      !equal(binding.root, facts.record.root) ||
      !shared.initialized ||
      shared.id !== facts.record.id ||
      !equal(shared.root, facts.record.root) ||
      shared.policy !== facts.record.policy
    )
      return stop("pairing_record_mismatch");
    return select(facts.bound, false, "paired", undefined, true);
  }
  if (facts.registration === "self-active") {
    if (facts.install.clients.codex && !facts.bound.key) return stop();
    return select(facts.bound, true, facts.install.clients.codex ? "pairing_needed" : "single");
  }
  if (
    facts.default?.creatorState === "unknown" &&
    (facts.default.keyState === "present" || facts.default.creatorPresent)
  )
    return stop("state_unreadable", facts.default.creatorError);
  const codexCreated =
    facts.default?.creator === "codex" &&
    !facts.default.sharedMarker &&
    !facts.default.recorded &&
    !facts.default.retired;
  const ownCodexCreated =
    facts.profile.creator === "codex" && !facts.profile.sharedMarker && !facts.profile.recorded;
  const codex =
    facts.install.clients.codex ??
    (ownCodexCreated
      ? { root: facts.profile.root }
      : codexCreated
        ? { root: facts.default.root }
        : undefined);
  if (!codex && facts.localMarker !== "absent") return stop("pairing_record_missing");
  let root = facts.profile;
  const createKey = true;
  if (
    facts.pluginRootAbsolute &&
    !root.key &&
    facts.default?.validKey &&
    !facts.default.sharedMarker &&
    !facts.default.recorded &&
    facts.default.evidence
  ) {
    root = facts.default;
  }
  const legacy =
    equal(root.root, facts.default?.root) &&
    facts.default.validKey &&
    facts.default.evidence &&
    !facts.default.sharedMarker &&
    !facts.default.recorded;
  if (codex && (!root.key || (equal(codex.root, root.root) && !legacy))) return stop();
  return select(root, createKey, codex ? "pairing_needed" : "single");
}

async function resolveClaudeClient(options) {
  const facts = await probeClaudeFacts(options);
  const binding = resolveClaudeBinding(facts);
  if (binding.enabled) {
    binding.workerEnv = {
      ...(options.env ?? process.env),
      CAIRN_MEMORY_STATE_DIR: binding.root,
    };
    if (options.initialize)
      await identityForBinding(binding, "claude", undefined, stateLocations(options).home);
  }
  return binding;
}

/** Claude decisions never share the setup/Codex detector's exception path. */
async function resolveClientImpl(options = {}) {
  const client = options.client ?? "claude";
  if (!CLIENTS.includes(client)) fail("invalid_client");
  if (client === "claude") return resolveClaudeClient(options);
  if (typeof options.usesClaude !== "boolean") fail("uses_claude_required");
  const snapshot = await detectClients(options);
  let binding = await selectCodexBinding(options, snapshot, options.pairingRecord || undefined);
  if (binding.enabled && options.initialize)
    await identityForBinding(binding, client, undefined, stateLocations(options).home);
  return binding;
}

async function identityForBinding(binding, client, cwd = "initialization", home) {
  if (binding.expectedFingerprint) {
    const key = await projectKey(binding.root, { create: false });
    if (identityFingerprint(key) !== binding.expectedFingerprint) fail("binding_identity_mismatch");
    return createHmac("sha256", key).update(String(cwd)).digest("hex");
  }
  const projectId = await opaqueProjectId(
    binding.root,
    cwd,
    binding.paired || client !== "claude"
      ? { strict: true, create: !binding.paired, client, home }
      : binding.createKey === false
        ? { create: false, home }
        : { home },
  );
  if (!binding.paired) {
    const creator = await creatorRecord(binding.root);
    if (creator.state === "unknown") failUnreadable(creator.code);
    const otherCreator = creator.value && creator.value.client !== client;
    if (
      otherCreator &&
      !(await rootMarker(binding.root, "paired-root")) &&
      !(client === "claude" && (await hasClaudeEvidence(binding.root)))
    )
      fail("pairing_needed");
  }
  return projectId;
}

async function clientProjectIdImpl(options, cwd, binding) {
  if (!cwd) return undefined;
  binding ??= await resolveClient(options);
  if (!binding.enabled) fail(binding.status);
  return identityForBinding(binding, options.client ?? "claude", cwd, stateLocations(options).home);
}

/** CX-7 API: no host execution. Caller obtains consent and stops hosts/workers. */
async function initializePairingImpl(options = {}) {
  const setupOptions = { ...options, setup: true };
  const locations = stateLocations(setupOptions); // refuse bad home before writes
  if (
    options.hostsStopped !== true ||
    !CLIENTS.every((client) => options.consent?.[client] === true)
  )
    fail("pairing_consent_required");
  locations.durableHome = (await rootIdentity(locations.home)).path;
  const root = (await rootIdentity(options.root ?? locations.defaultRoot)).path;
  setupOptions.root = root;
  durable(root, locations);
  if ((await retiredRoot(root)) || (await retiredRoot(options.adoptFrom)))
    return disabled("retired_root");
  if (options.adoptFrom) await requireTemporarySource(options.adoptFrom, locations);
  const initial = await detectClients(setupOptions);
  if (!initial.install.shared && options.adopt !== true && (await containsRoot(initial.keys, root)))
    return disabled("existing_key_requires_adoption");
  if (initial.record && !initial.install.shared) fail("pairing_record_mismatch");
  let profileRoot = normalizeRoot(
    options.claudeProfileRoot ??
      claudeRegistration(initial.install)?.profileRoot ??
      (options.env ?? process.env).CLAUDE_PLUGIN_DATA ??
      (options.standardClaudeOrigin === true ? locations.knownClaudeRoot : undefined),
  );
  if (profileRoot === undefined) return disabled("claude_profile_root_required");
  if (!absolute(profileRoot)) fail("invalid_claude_profile_root");
  profileRoot = (await rootIdentity(profileRoot)).path;
  const registeredProfile = claudeRegistration(initial.install)?.profileRoot;
  if (registeredProfile !== undefined && !(await sameRoot(registeredProfile, profileRoot)))
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
  return setupTransaction(
    {
      ...setupOptions,
      claudeProfileRoot: profileRoot,
      setupOperation: "initialize",
    },
    async ({ install, keys, record: existingRecord }) => {
      if ((await retiredRoot(root)) || (await retiredRoot(options.adoptFrom)))
        return disabled("retired_root");
      if (options.adoptFrom) await requireTemporarySource(options.adoptFrom, locations);
      const registration = claudeRegistration(install);
      if (registration && !(await sameRoot(registration.profileRoot, profileRoot)))
        fail("claude_profile_mismatch");
      const history = await readBindingHistory(profileRoot);
      if (
        history.state === "invalid" ||
        (history.state === "valid" && !(await sameRoot(history.root, root)))
      )
        fail("binding_identity_mismatch");
      if (history.state === "valid" && !(await keyPresent(root)))
        return disabled("paired_key_missing");
      if (existingRecord && (!install.shared || !install.shared.initialized))
        fail("pairing_record_mismatch");
      if (install.resetPending) fail("identity_reset_pending");
      if (
        install.shared &&
        (!(await sameRoot(install.shared.root, root)) ||
          (existingRecord && existingRecord.id !== install.shared.id))
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
      if (
        options.adoptFrom &&
        (!options.adopt || !(await sameRoot(install.shared.adoptFrom, options.adoptFrom)))
      )
        fail("pending_binding_mismatch");
      if (!install.shared.initialized) {
        if (install.shared.adoptFrom && !(await keyPresent(root))) {
          await publishProjectKey(root, {
            originalKey: await projectKey(install.shared.adoptFrom, {
              create: false,
            }),
            checkpoint: options.checkpoint,
            home: locations.home,
            capability: creationCapability,
          });
        }
        if (install.shared.policy === "initialize-shared")
          await firstProjectKey(root, {
            home: locations.home,
            checkpoint: options.checkpoint,
          });
        if (!(await keyPresent(root, { strict: true }))) return disabled("paired_key_missing");
        install.shared.initialized = true;
        await saveInstall(locations, install);
        await options.checkpoint?.("initialized");
      } else if (!(await keyPresent(root, { strict: true }))) return disabled("paired_key_missing");
      // Root-local history survives loss or replacement of the coordination directory.
      await markPairRoot(root);
      await writeBindingHistory(profileRoot, root, {
        install,
        home: locations.home,
      });
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
        if (install.shared.barrierPaused === undefined) {
          install.shared.barrierPaused = (await readControlState(root)).paused;
          await saveInstall(locations, install);
        }
        await setPaused(root, true, { rotate: true });
        if (!install.shared.barrierPaused) await setPaused(root, false);
        install.shared.barrier = true;
        await saveInstall(locations, install);
      }
      await saveInstall(locations, install);
      return {
        status: install.shared.ready ? "paired" : "binding_pending",
        enabled: install.shared.ready,
        pairingRecord: locations.pairing,
        root,
      };
    },
  );
}

/** Call only after BOTH hook configurations have the record and workers are stopped. */
async function completePairingImpl(options = {}) {
  if (
    options.hostsStopped !== true ||
    !CLIENTS.every((client) => options.configured?.[client] === true)
  )
    fail("binding_configuration_required");
  return setupTransaction(
    { ...options, setup: true, setupOperation: "complete" },
    async ({ install, record, locations }) => {
      if (install.resetPending) fail("identity_reset_pending");
      if (
        !record ||
        !install.shared?.initialized ||
        !install.shared.barrier ||
        install.shared.id !== record.id ||
        !(await sameRoot(install.shared.root, record.root))
      )
        fail("pending_binding_mismatch");
      if (await retiredRoot(record.root)) return disabled("retired_root");
      if (!(await keyPresent(record.root, { strict: true }))) return disabled("paired_key_missing");
      if (!install.clients.claude?.profileRoot) fail("binding_history_invalid");
      for (const client of CLIENTS)
        install.clients[client] = {
          ...install.clients[client],
          root: record.root,
          state: "established",
        };
      await markPairRoot(record.root);
      await writeBindingHistory(install.clients.claude.profileRoot, record.root, {
        install,
        home: locations.home,
      });
      install.shared.ready = true;
      await saveInstall(locations, install);
      return {
        status: "paired",
        enabled: true,
        pairingRecord: locations.pairing,
        root: record.root,
      };
    },
  );
}

const RESET_DISCLOSURE =
  "Old project memories are no longer addressable by the new identity; " +
  "the second client requires explicit adoption. Resume starts at EOF.";

/** Explicit stopped-worker identity reset; old roots and memories are retained. */
async function resetIdentityImpl(options = {}) {
  if (
    options.confirmIdentityReset !== true ||
    options.hostsStopped !== true ||
    !CLIENTS.includes(options.primaryClient)
  )
    fail("identity_reset_confirmation_required");
  const locations = stateLocations({ ...options, setup: true });
  durable(options.root, locations);
  if (await retiredRoot(options.root)) return disabled("retired_root");
  const initial = await detectClients({ ...options, setup: true });
  const profileRoot = normalizeRoot(
    options.claudeProfileRoot ??
      claudeRegistration(initial.install)?.profileRoot ??
      (options.env ?? process.env).CLAUDE_PLUGIN_DATA,
  );
  if (!absolute(profileRoot)) fail("identity_reset_history_required");
  const initialHistory = await readBindingHistory(profileRoot);
  if (initialHistory.state === "invalid") fail("binding_identity_mismatch");
  if (
    initial.install.lastReset &&
    (await sameRoot(initial.install.lastReset.root, options.root)) &&
    initial.install.lastReset.client === options.primaryClient &&
    (await sameRoot(
      initial.install.lastReset.profileRoot ?? claudeRegistration(initial.install)?.profileRoot,
      profileRoot,
    )) &&
    initialHistory.state === "valid" &&
    (await sameRoot(initialHistory.root, options.root)) &&
    (await keyPresent(options.root, { strict: true })) &&
    identityFingerprint(await projectKey(options.root, { create: false })) ===
      initialHistory.fingerprint
  )
    return {
      status: "identity_reset",
      root: options.root,
      alreadyComplete: true,
      writes: 0,
      disclosure: RESET_DISCLOSURE,
    };
  if (
    !initial.install.resetPending &&
    initial.install.retired?.length &&
    initialHistory.state === "valid" &&
    (await sameRoot(initialHistory.root, options.root))
  )
    fail("identity_reset_requires_new_root");
  const retry =
    initial.install.resetPending &&
    (await sameRoot(initial.install.resetPending.root, options.root));
  const destination = await probeEntry(options.root);
  if (destination.state === "unknown") failUnreadable(destination.code);
  if (
    !retry &&
    destination.state === "present" &&
    (!destination.value.isDirectory() || (await readdir(options.root)).length !== 0)
  )
    fail("reset_destination_not_new");
  return setupTransaction(
    {
      ...options,
      claudeProfileRoot: profileRoot,
      setup: true,
      setupOperation: "reset",
    },
    async ({ install, record, keys }) => {
      const history = await readBindingHistory(profileRoot);
      if (history.state === "invalid") fail("binding_identity_mismatch");
      if (!install.shared && history.state === "valid" && !(await keyPresent(history.root))) {
        install.shared = {
          id: randomUUID(),
          root: history.root,
          policy: "initialize-shared",
          initialized: true,
          ready: false,
        };
        install.clients.claude = {
          root: history.root,
          profileRoot,
          state: "established",
        };
        install.clients.codex = { root: history.root, state: "established" };
        record = { root: history.root };
      }
      if (await retiredRoot(options.root)) return disabled("retired_root");
      if (
        !install.shared ||
        (!record && !install.resetPending) ||
        (await sameRoot(options.root, install.shared.root))
      )
        fail("identity_reset_requires_new_root");
      if (install.resetPending && !(await sameRoot(install.resetPending.root, options.root)))
        fail("pending_binding_mismatch");
      const destination = await probeEntry(options.root);
      if (destination.state === "unknown") failUnreadable(destination.code);
      if (
        !install.resetPending &&
        destination.state === "present" &&
        (!destination.value.isDirectory() || (await readdir(options.root)).length !== 0)
      )
        fail("reset_destination_not_new");
      if (!install.resetPending) {
        install.resetPending = {
          root: options.root,
          client: options.primaryClient,
          initialized: false,
        };
        await saveInstall(locations, install);
      }
      if (destination.state === "absent") {
        await mkdir(dirname(options.root), { recursive: true, mode: 0o700 });
        await mkdir(options.root, { mode: 0o700 }); // exclusive create; EEXIST refuses
        await notifyWrite(options.root, "directory");
      }
      await firstProjectKey(options.root, {
        home: locations.home,
        client: options.primaryClient,
      });
      // Retire the old root before the new identity can become active. Retrying a
      // stopped-host reset may rotate again, but never re-enables old workers.
      const oldRoot = await probeEntry(install.shared.root, {
        read: () => checkedPath(install.shared.root, { directory: true, missing: true }),
      });
      if (oldRoot.state === "unknown") failUnreadable(oldRoot.code);
      if (oldRoot.state === "present") {
        await setPaused(install.shared.root, true, { rotate: true });
        await privateWrite(
          join(install.shared.root, "retired"),
          JSON.stringify({ version: 1, retired: true }),
        );
      }
      await markPairRoot(options.root);
      await setPaused(options.root, true, { rotate: true });
      const retired = [
        ...(install.retired ?? []),
        {
          ...install.shared,
          invalidated: true,
          claude: { ...install.clients.claude },
        },
      ];
      await unlink(locations.pairing).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await notifyWrite(locations.pairing, "unlink");
      const resetInstall = {
        version: 1,
        lastReset: {
          root: options.root,
          client: options.primaryClient,
          profileRoot,
        },
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
      };
      await writeBindingHistory(profileRoot, options.root, {
        reset: true,
        install: resetInstall,
        home: locations.home,
      });
      await saveInstall(locations, resetInstall, { resetReceipt: true });
      return {
        status: "identity_reset",
        root: options.root,
        disclosure: RESET_DISCLOSURE,
      };
    },
  );
}

// All successful pair-root operations publish through this single helper.
async function markPairRoot(root) {
  const pendingPath = join(root, ".project-key.pending");
  const pending = await jsonFile(pendingPath);
  if (pending) {
    const key = await projectKey(root, { create: false });
    const creator = await creatorRecord(root);
    if (
      pending.version !== 1 ||
      !CLIENTS.includes(pending.client) ||
      pending.key !== key ||
      creator.state !== "present" ||
      creator.value.client !== pending.client ||
      creator.value.fingerprint !== identityFingerprint(key)
    )
      failUnreadable("invalid_key_publication");
    await unlink(pendingPath);
    await notifyWrite(pendingPath, "unlink");
  }
  await privateWrite(join(root, "paired-root"), JSON.stringify({ version: 1, paired: true }));
}

/** Explicit original-backup repair, under the setup lock with both hosts stopped. */
async function repairIdentityImpl(options = {}) {
  if (typeof options.originalKey !== "string" || !validKey(options.originalKey))
    fail("invalid_original_key");
  if (options.hostsStopped !== true || options.confirmKeyRepair !== true)
    fail("key_repair_confirmation_required");
  return setupTransaction(
    { ...options, setup: true, setupOperation: "repair" },
    async ({ install }) => {
      const root = options.root;
      if (
        !absolute(root) ||
        !(await containsRoot(recordedPairRoots({ coordination: "readable", install }), root))
      )
        fail("pairing_record_mismatch");
      if (await retiredRoot(root)) return disabled("retired_root");
      const profileRoot = claudeRegistration(install)?.profileRoot;
      if (!profileRoot) fail("repair_binding_missing");
      const history = await readBindingHistory(profileRoot);
      if (
        history.state !== "valid" ||
        !(await sameRoot(history.root, root)) ||
        history.fingerprint !== identityFingerprint(options.originalKey ?? "")
      )
        fail("repair_key_conflict");
      if (history.state !== "valid") fail("binding_history_invalid");
      await restoreProjectKey(root, options.originalKey, profileRoot, stateLocations(options).home);
      await markPairRoot(root);
      await writeBindingHistory(profileRoot, root, {
        install,
        home: stateLocations(options).home,
      });
      await saveInstall(stateLocations(options), install);
      return { status: "key_restored", root };
    },
  );
}

function refusal(error) {
  if (
    error?.constructor === Error &&
    !error.code &&
    /^[a-z][a-z0-9_]*(?:: [^\n]+)?$/.test(error.message)
  )
    return error;
  const named = new Error(error.code ? "state_unreadable" : "invalid_arguments");
  named.detail = error.code ?? error.message;
  return named;
}
function boundary(work) {
  return (...args) => {
    try {
      const result = work(...args);
      return result && typeof result.then === "function"
        ? result.catch((error) => {
            throw refusal(error);
          })
        : result;
    } catch (error) {
      throw refusal(error);
    }
  };
}
export const rootMarker = boundary(rootMarkerImpl);
export const recordedPairRoots = boundary(recordedPairRootsImpl);
export const sameRoot = boundary(sameRootImpl);
export const installId = boundary(installIdImpl);
export const projectKey = boundary(projectKeyImpl);
export const opaqueProjectId = boundary(opaqueProjectIdImpl);
export const stateLocations = boundary(stateLocationsImpl);
export const hasClaudeEvidence = boundary(hasClaudeEvidenceImpl);
export const detectClients = boundary(detectClientsImpl);
export const localLiveness = boundary(localLivenessImpl);
export const parsePairingRecord = boundary(parsePairingRecordImpl);
export const probeClaudeFacts = boundary(probeClaudeFactsImpl);
export const resolveClaudeBinding = boundary(resolveClaudeBindingImpl);
export const resolveClient = boundary(resolveClientImpl);
export const clientProjectId = boundary(clientProjectIdImpl);
export const initializePairing = boundary(initializePairingImpl);
export const completePairing = boundary(completePairingImpl);
export const resetIdentity = boundary(resetIdentityImpl);
export const repairIdentity = boundary(repairIdentityImpl);

/** Mutation inventory: tests exercise every operation, including adoption separately. */
export const PAIR_ROOT_OPERATIONS = Object.freeze([
  { name: "initialize", run: initializePairing },
  { name: "adopt", run: initializePairing },
  { name: "complete", run: completePairing },
  { name: "reset", run: resetIdentity },
  { name: "repair", run: repairIdentity },
]);
