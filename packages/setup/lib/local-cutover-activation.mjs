import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureTargetFor, cutoverId } from './local-cutover-journal.mjs';
import { cutoverRefusal as refuse, withColdStoreLease } from './local-cutover-lease.mjs';
import { boundedJSON, canonicalPath, parseStrictJSON, publishCaptureStore } from './local-descriptor.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const { privateDirectory, privateRead, privateRemove, privateWrite, syncDirectory } = await cutoverImport('state');
const { stateLock } = await cutoverImport('lock');
const { readHostConfiguration, readHostProfile } = await cutoverImport('profile');
const { inspectPreparation } = await cutoverImport('preparation');
const { events, nativeSnapshot, nativeWrite } = await cutoverImport('files');
const { setupRequest } = await cutoverImport('request');
const { nativeSettingsLock } = await cutoverImport('settings');
const { captureStoreIdentity, trustedBinding } = await cutoverImport('binding');
const { entry } = await cutoverImport('paths');
const { byteDigest } = await cutoverImport('backup');
const { documentCardsReady } = await cutoverImport('provider');

const clients = { claude: 'claude-code', codex: 'codex' };
const stages = ['capture-paused', 'capture-store-staged', 'capture-binding-staged', 'capture-native-published', 'capture-armed'];
const sha = value => createHash('sha256').update(value).digest('hex');
const text = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const legacyDirectory = (root, client) => join(root, 'capture', client);
const journalPath = (maintenance, client) => join(maintenance, 'capture-' + client + '.json');

export async function hasCaptureActivation(maintenance) {
  return Object.keys(clients).some(client => entry(journalPath(maintenance, client)));
}

function nativeVector(settings, request, record, node, executable, directory) {
  const config = parseStrictJSON(settings);
  if (config.enabledPlugins?.['cairn-memory@cairn-memory'] === true || !config.hooks || Array.isArray(config.hooks)) {
    throw refuse('cutover_capture_changed');
  }
  const owned = new Set(events(request.client));
  const vector = (node, cli, installation, event) => ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', node,
    cli, 'hook', '--installation', installation, '--event', event].map(quote).join(' ');
  const oldCli = join(record.runtimeRoot, 'integrations/client/raw/local-setup-cli.mjs');
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) throw refuse('cutover_capture_changed');
    const oldCommand = vector(record.nodeExecutable, oldCli, request.installationDirectory, event);
    let replaced = 0;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) throw refuse('cutover_capture_changed');
      for (const hook of group.hooks) {
        if (hook?.command === oldCommand && owned.has(event) && hook.type === 'command' && hook.timeout === 160 &&
            Object.keys(group).length === 1 && Object.keys(hook).length === 3) {
          hook.command = vector(node, executable, directory, event);
          replaced++;
        } else if (typeof hook?.command === 'string' &&
            /cairn[-_/ ]?memory|integrations\/codex\/entry\.mjs|scripts\/launch-capture\.mjs|local-setup-cli\.mjs/iu.test(hook.command)) {
          throw refuse('cutover_capture_changed');
        }
      }
    }
    if (replaced !== (owned.has(event) ? 1 : 0)) throw refuse('cutover_capture_changed');
    owned.delete(event);
  }
  if (owned.size) throw refuse('cutover_capture_changed');
  return text(config);
}

async function legacyRecord(root, client, cutover, maintenance) {
  const directory = legacyDirectory(root, client);
  const saved = parseStrictJSON(await privateRead(join(maintenance, client + '.json')));
  const paused = await privateRead(join(directory, 'installation.json'));
  const current = parseStrictJSON(paused);
  const request = setupRequest(saved.request);
  if (saved.phase !== 'active' || current.phase !== 'disabled' || text({ ...saved, phase: 'disabled' }) !== paused ||
      request.installationDirectory !== directory || request.client !== clients[client] ||
      request.databasePath !== cutover.sourcePath || saved.storeId !== cutover.source.storeId ||
      request.rawMode !== 'local-plain-v1' || !request.plaintextRawConsent || !request.foregroundConsent || request.interpretationConsent) {
    throw refuse('cutover_capture_changed');
  }
  return { directory, saved, request, paused };
}

async function authorityFor(record) {
  const { directory, request, saved } = record;
  const profile = await readHostProfile(join(directory, 'host-profile.json'));
  const config = await readHostConfiguration(profile);
  const { authority } = config;
  const supportPath = request.installation.pluginRoot ?? request.installation.qualificationConfigPath;
  if (profile.configPath !== join(directory, 'capture.json') || profile.stateRoot !== join(directory, 'state') ||
      profile.identityKeyPath !== join(directory, 'identity.key') || config.databasePath !== request.databasePath ||
      authority.storeId !== saved.storeId || authority.targetId !== saved.targetId || authority.client !== request.client ||
      authority.namespace.ownerId !== request.namespace.ownerId || authority.namespace.scope !== request.namespace.scope ||
      (authority.namespace.projectId || null) !== request.namespace.projectId || config.interpretation !== 'raw-only' ||
      (profile.installation.pluginRoot ?? profile.installation.qualificationConfigPath) !== supportPath ||
      await inspectPreparation(profile, config) !== 'ready') throw refuse('cutover_capture_changed');
  return { supportPath, authority };
}

async function journal(maintenance, client, cutover) {
  const path = journalPath(maintenance, client);
  if (!entry(path)) return null;
  const value = await boundedJSON(path, 8 * 1024 * 1024, { privateFile: true });
  if (value.version !== 'capture-activation-v1' || value.client !== client || value.attempt !== cutover.attemptId ||
      !cutoverId(value.generation) || !stages.includes(value.stage) ||
      !['original', 'published'].every(key => typeof value[key] === 'string') ||
      typeof value.settings !== 'string' || !Number.isSafeInteger(value.mode) ||
      !/^[a-f0-9]{64}$/u.test(value.legacyDigest)) throw refuse('cutover_capture_changed');
  return value;
}

export async function stageStore(cutover, beforePublish = async () => {}) {
  const target = captureTargetFor(cutover.sourcePath, cutover.attemptId);
  const reserved = entry(cutover.targetPath), serving = entry(target);
  const selected = reserved ? cutover.targetPath : target;
  if (!!reserved === !!serving || await canonicalPath(selected) !== selected) throw refuse('cutover_target_changed');
  await withColdStoreLease(selected, async assertLease => {
    // A read-only WAL-mode verification can leave a shared index and an
    // empty WAL after its last connection closes. They contain no durable
    // changes and can be retired under exclusion.
    const wal = entry(selected + '-wal');
    const shm = entry(selected + '-shm');
    if (entry(selected + '-journal') || wal && wal.size !== 0n ||
        [wal, shm].some(info => info && (!info.isFile() || info.nlink !== 1n ||
          info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o600n))) throw refuse('cutover_target_companions');
    if (byteDigest(selected) !== cutover.result.targetDigest) throw refuse('cutover_target_changed');
    await assertLease();
    if (wal) await privateRemove(selected + '-wal');
    if (shm) await privateRemove(selected + '-shm');
    if (reserved) {
      await beforePublish();
      await assertLease();
      await publishCaptureStore(cutover.targetPath, target);
    }
    await syncDirectory(dirname(target));
  });
  const identity = await captureStoreIdentity(target);
  return { target, identity };
}

async function writeBinding(directory, desired) {
  const path = join(directory, 'binding.json');
  const current = await privateRead(path, { missing: true });
  const staged = text({ ...desired, phase: 'staged' });
  const armed = text({ ...desired, phase: 'armed' });
  if (current !== undefined && current !== staged && current !== armed) throw refuse('cutover_capture_changed');
  if (current !== text(desired)) await privateWrite(path, text(desired));
}

export async function activateCapture({ root, maintenance, descriptor, manifest, client, env, reattest, onCheckpoint,
  stagedStore, stageOnly = false }) {
  if (!Object.hasOwn(clients, client)) throw refuse('cutover_arguments');
  const { migration } = descriptor, { cutover } = migration;
  const record = await legacyRecord(root, client, cutover, maintenance);
  const { saved, request, paused } = record;
  if (!documentCardsReady && Object.hasOwn(env, request.providerApiKeyEnv)) throw refuse('cutover_capture_changed');
  // Capture can use only the same installed owner and namespace as the client.
  if (!descriptor.clients[client] || request.namespace.ownerId !== descriptor.ownerId ||
      request.namespace.projectId !== descriptor.projectId) throw refuse('cutover_capture_changed');
  const { authority, supportPath } = await authorityFor(record);
  const executable = join(root, 'engine', manifest.engineId, 'app', 'node_modules', manifest.package.name, 'packaging/core-local/capture-cli.mjs');
  if (!Object.hasOwn(manifest.files, 'packaging/core-local/capture-cli.mjs') ||
      await canonicalPath(executable) !== executable) throw refuse('cutover_capture_candidate_required');

  const { captureAdapter } = await import(pathToFileURL(join(dirname(executable), 'capture-slot.mjs')));
  return nativeSettingsLock(request.clientConfigPath + '.cairn-local.lock', request, async () => {
    let current = await journal(maintenance, client, cutover);
    const advance = async stage => {
      if (stages.indexOf(current.stage) >= stages.indexOf(stage)) return;
      current.stage = stage;
      await privateWrite(journalPath(maintenance, client), text(current));
      await onCheckpoint(stage, structuredClone(cutover));
    };
    const before = await nativeSnapshot(request.clientConfigPath, request);
    if (!current) {
      // The journal round-trips the exact native UTF-8 bytes. The strict
      // reader refuses an invalid sequence before any vector is published.
      await boundedJSON(request.clientConfigPath, 1048576);
      const generation = randomUUID(), directory = join(record.directory, 'core-' + generation);
      const published = nativeVector(before.text, request, saved, descriptor.node, executable, directory);
      current = { version: 'capture-activation-v1', client, attempt: cutover.attemptId, generation,
        stage: null, settings: request.clientConfigPath, mode: before.mode, original: before.text,
        published, legacyDigest: sha(paused) };
      await reattest();
      await advance('capture-paused');
    }
    const directory = join(record.directory, 'core-' + current.generation);
    if (current.settings !== request.clientConfigPath || current.legacyDigest !== sha(paused) ||
        current.published !== nativeVector(current.original, request, saved, descriptor.node, executable, directory) ||
        before.mode !== current.mode || ![current.original, current.published].includes(before.text)) throw refuse('cutover_capture_changed');
    const path = join(directory, 'binding.json');
    if (current.stage === 'capture-armed') {
      const binding = trustedBinding(parseStrictJSON(await privateRead(path)), directory);
      if (binding.phase !== 'armed' || before.text !== current.published || binding.executable !== executable ||
          binding.database !== captureTargetFor(cutover.sourcePath, cutover.attemptId)) throw refuse('cutover_capture_changed');
      const actual = await captureStoreIdentity(binding.database);
      if (actual.device !== binding.device || actual.inode !== binding.inode) throw refuse('cutover_target_changed');
      captureAdapter(binding).check();
      return { state: 'capture-armed', client, generation: current.generation, targetPath: binding.database };
    }

    await reattest();
    const { target, identity } = stagedStore ?? await stageStore(cutover, reattest);
    await advance('capture-store-staged');
    const binding = trustedBinding({ version: 'core-local-capture-v1', phase: 'staged', generation: current.generation,
      database: target, ...identity, attemptId: cutover.attemptId, migrationId: cutover.result.migrationId, attestation: cutover.result.attestation,
      legacyDigest: current.legacyDigest, sourceRoot: request.sourceRoot, sourceIdentity: saved.sourceIdentity,
      authority, supportPath, executable }, directory);
    captureAdapter(binding).check();
    await privateDirectory(directory);
    await syncDirectory(record.directory);
    const alreadyArmed = await privateRead(path, { missing: true }) === text({ ...binding, phase: 'armed' });
    if (alreadyArmed && current.stage !== 'capture-native-published') throw refuse('cutover_capture_changed');
    if (!alreadyArmed) await writeBinding(directory, binding);
    await advance('capture-binding-staged');
    await reattest();
    if (before.text === current.original) await nativeWrite(current.settings, current.published, before, request);
    await advance('capture-native-published');
    if (stageOnly) return { state: 'capture-native-published', client };
    await reattest();
    const published = await nativeSnapshot(current.settings, request);
    if (published.text !== current.published || published.mode !== current.mode) throw refuse('cutover_capture_changed');
    await writeBinding(directory, { ...binding, phase: 'armed' });
    await advance('capture-armed');
    return { state: 'capture-armed', client, generation: current.generation, targetPath: target };
  });
}

export async function disarmCaptureActivations(root, cutover, maintenance, rememberAbort, onCheckpoint) {
  const records = [];
  async function lock(index) {
    const client = Object.keys(clients)[index];
    if (client === undefined) {
      // An armed generation cannot begin a new write while abort publishes
      // intent and fences each registered hook under the same client locks.
      for (const { directory } of records) {
        if (entry(join(directory, 'used'))) throw refuse('cutover_capture_in_use');
      }
      await rememberAbort();
      for (const { directory, binding } of records) {
        if (binding) await writeBinding(directory, { ...binding, phase: 'staged' });
        await onCheckpoint('abort-capture-disarmed', structuredClone(cutover));
      }
      return;
    }
    const current = await journal(maintenance, client, cutover);
    if (!current) return lock(index + 1);
    const legacy = legacyDirectory(root, client), directory = join(legacy, 'core-' + current.generation);
    return stateLock(join(legacy, '.setup.lock'), async () => {
      const path = join(directory, 'binding.json');
      const binding = entry(path) ? trustedBinding(parseStrictJSON(await privateRead(path)), directory) : null;
      records.push({ directory, binding });
      return lock(index + 1);
    });
  }
  return lock(0);
}

export async function restoreCaptureVectors(root, cutover, maintenance, onCheckpoint) {
  for (const client of Object.keys(clients)) {
    const current = await journal(maintenance, client, cutover);
    if (!current) continue;
    const saved = parseStrictJSON(await privateRead(join(maintenance, client + '.json')));
    const request = setupRequest(saved.request);
    if (request.clientConfigPath !== current.settings || request.installationDirectory !== legacyDirectory(root, client)) {
      throw refuse('cutover_capture_changed');
    }
    await nativeSettingsLock(current.settings + '.cairn-local.lock', request, async () => {
      const before = await nativeSnapshot(current.settings, request);
      if (before.mode !== current.mode || ![current.original, current.published].includes(before.text)) throw refuse('cutover_capture_changed');
      if (before.text !== current.original) await nativeWrite(current.settings, current.original, before, request);
    });
    await onCheckpoint('abort-capture-native-restored', structuredClone(cutover));
  }
}
