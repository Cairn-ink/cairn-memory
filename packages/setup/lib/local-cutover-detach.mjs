import { join } from 'node:path';
import { SetupError } from './errors.mjs';
import { captureTargetFor, cutoverId } from './local-cutover-journal.mjs';
import { boundedJSON, parseStrictJSON } from './local-descriptor.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const recovery = () => new SetupError('local_recovery_required', 2);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const caption = client => client === 'claude' ? 'Claude Code' : 'Codex';
const command = (node, executable, directory, event) => [
  '/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', node, executable,
  'hook', '--installation', directory, '--event', event,
].map(quote).join(' ');

async function activeCaptureRecord(root, maintenance, descriptor, client) {
  const journal = await boundedJSON(join(maintenance, 'capture-' + client + '.json'), 8 * 1024 * 1024, { privateFile: true })
    .catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!journal) return;
  const { cutover } = descriptor.migration;
  if (journal.version !== 'capture-activation-v1' || journal.client !== client ||
      journal.attempt !== cutover.attemptId || !cutoverId(journal.generation) ||
      journal.stage !== 'capture-armed') throw recovery();
  const legacy = join(root, 'capture', client), directory = join(legacy, 'core-' + journal.generation);
  const legacyPath = join(legacy, 'installation.json');
  const original = await boundedJSON(legacyPath, 65536, { privateFile: true });
  if (original?.phase !== 'disabled' || original.request?.clientConfigPath !== journal.settings ||
      original.request.installationDirectory !== legacy ||
      original.request.databasePath !== cutover.sourcePath ||
      original.request.client !== (client === 'claude' ? 'claude-code' : 'codex')) throw recovery();
  return { journal, legacy, directory, request: original.request, target: captureTargetFor(cutover.sourcePath, cutover.attemptId) };
}

function mergePublishedHooks(current, published, events, binding, directory, node, desired) {
  const original = parseStrictJSON(published).hooks;
  const config = current ? parseStrictJSON(current) : {};
  if (!Object.hasOwn(config, 'hooks')) {
    if (!desired) return current;
    config.hooks = {};
  }
  if (typeof config.hooks !== 'object' || !config.hooks || Array.isArray(config.hooks)) throw recovery();
  if (desired && config.enabledPlugins?.['cairn-memory@cairn-memory'] === true) throw recovery();
  let changed = false;
  for (const event of events) {
    const suffix = ['hook', '--installation', directory, '--event', event].map(quote).join(' ');
    const expected = original[event]?.flatMap(group => group.hooks).filter(hook => hook.command?.endsWith(suffix));
    if (expected?.length !== 1) throw recovery();
    const previous = [expected[0].command];
    if (node) previous.push(command(node, binding.executable, directory, event));
    const next = desired && command(desired.node, desired.executable, directory, event);
    if (next) {
      previous.push(next, command(desired.node, binding.executable, directory, event));
      if (node) previous.push(command(node, desired.executable, directory, event));
    }
    const groups = config.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw recovery();
    if (next && binding.phase === 'armed') {
      const owned = groups.flatMap(group => {
        if (!Array.isArray(group?.hooks)) throw recovery();
        return group.hooks.filter(hook => previous.includes(hook?.command)).map(hook => ({ group, hook }));
      });
      if (owned.length !== 1 || Object.keys(owned[0].group).length !== 1 || Object.keys(owned[0].hook).length !== 3 ||
          owned[0].hook.type !== expected[0].type || owned[0].hook.timeout !== expected[0].timeout) throw recovery();
      if (owned[0].hook.command === next) continue;
    }
    const retained = groups.flatMap(group => {
      if (!Array.isArray(group?.hooks)) throw recovery();
      const hooks = group.hooks.filter(hook => hook?.type !== 'command' || !previous.includes(hook.command));
      if (hooks.length === group.hooks.length) return [group];
      changed = true;
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    if (next) {
      retained.push({ hooks: [{ ...expected[0], command: next }] });
      changed = true;
    }
    if (retained.length) config.hooks[event] = retained;
    else delete config.hooks[event];
  }
  if (desired) for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) throw recovery();
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) throw recovery();
      for (const hook of group.hooks) {
        if (typeof hook?.command === 'string' &&
            /cairn[-_/ ]?memory|integrations\/codex\/entry\.mjs|scripts\/launch-capture\.mjs|local-setup-cli\.mjs/iu.test(hook.command) &&
            (!events.includes(event) || hook.command !== command(desired.node, desired.executable, directory, event))) throw recovery();
      }
    }
  }
  return changed ? JSON.stringify(config, null, 2) + '\n' : current;
}

export async function reconcileActiveCapture(root, maintenance, descriptor, client, { enabled, desired, nativePath }) {
  const record = await activeCaptureRecord(root, maintenance, descriptor, client);
  if (!record) return { status: 'disabled' };
  const { journal, request, directory, target, legacy } = record;
  if (nativePath && await nativePath() !== journal.settings) throw recovery();
  const [{ stateLock }, { nativeSettingsLock }, { nativeSnapshot, nativeWrite, events }, { trustedBinding, captureStoreIdentity },
    { privateRead, privateWrite }] = await Promise.all(['lock', 'settings', 'files', 'binding', 'state'].map(cutoverImport));
  return nativeSettingsLock(journal.settings + '.cairn-local.lock', request, () =>
    stateLock(join(legacy, '.setup.lock'), async () => {
      const path = join(directory, 'binding.json');
      const binding = trustedBinding(parseStrictJSON(await privateRead(path)), directory);
      const { cutover } = descriptor.migration;
      if (binding.database !== target || binding.attemptId !== journal.attempt || binding.generation !== journal.generation ||
          binding.migrationId !== cutover.result.migrationId || binding.attestation !== cutover.result.attestation ||
          binding.legacyDigest !== journal.legacyDigest || binding.authority.client !== request.client ||
          binding.authority.storeId !== cutover.source.storeId || binding.sourceRoot !== request.sourceRoot ||
          binding.authority.namespace.ownerId !== descriptor.ownerId ||
          (binding.authority.namespace.projectId || null) !== descriptor.projectId) throw recovery();
      const { device, inode } = await captureStoreIdentity(target);
      if (device !== binding.device || inode !== binding.inode) throw recovery();
      const enable = enabled ?? binding.phase === 'armed';
      const before = await nativeSnapshot(journal.settings, request);
      let after;
      try {
        after = mergePublishedHooks(before.text, journal.published, events(request.client), binding, directory,
          descriptor.node, enable ? desired : undefined);
      } catch (error) {
        if (enable && binding.phase === 'armed') error.reason = 'configuration_changed';
        throw error;
      }
      if (binding.phase === 'armed' && (!enable || desired.executable !== binding.executable))
        await privateWrite(path, JSON.stringify({ ...binding, phase: 'staged' }) + '\n');
      if (after !== before.text) await nativeWrite(journal.settings, after, before, request);
      if (enable && (binding.phase !== 'armed' || desired.executable !== binding.executable))
        await privateWrite(path, JSON.stringify({ ...binding, executable: desired.executable, phase: 'armed' }) + '\n');
      return enable ? { status: 'active', request } : { status: 'disabled' };
    }));
}

export async function disableActiveCapture(root, maintenance, descriptor, client, { t, write }) {
  await reconcileActiveCapture(root, maintenance, descriptor, client, { enabled: false });
  write(t('local_capture_status', { client: caption(client), state: 'off', reason: 'off' }));
}
