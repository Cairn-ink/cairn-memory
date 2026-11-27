import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedPath, privateRead } from '../../integrations/client/private-state.mjs';
import { captureStoreIdentity } from './capture-binding.mjs';
import { localProviderConsentFile, localProviderConsentText } from './provider-config.mjs';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const enginePattern = /^core-local-v1-([a-f0-9]{64})(?:-r(?:[2-9]|[1-9]\d+))?$/u;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const refuse = () => Object.assign(new Error('daemon_active_store'), { code: 'daemon_active_store' });
const packageName = 'cairn-memory-core-local-candidate';

export function managedGeneration(path = packageRoot) {
  const modules = dirname(path), app = dirname(modules), generation = dirname(app), engine = dirname(generation);
  if (basename(path) !== packageName || basename(modules) !== 'node_modules' ||
      basename(app) !== 'app' || basename(engine) !== 'engine') return;
  const id = basename(generation), match = enginePattern.exec(id);
  if (!match) throw refuse();
  return { root: dirname(engine), id, build: match[1], packageRoot: path };
}

export async function assertActiveAuthority(generation, options, { modelConsent = false } = {}) {
  if (!generation) throw refuse();
  const { root, id, packageRoot } = generation;
  if (await realpath(packageRoot) !== packageRoot) throw refuse();
  await checkedPath(root, { directory: true });
  const descriptor = JSON.parse(await privateRead(join(root, 'installation.json')));
  const { migration, database, clients } = descriptor;
  const cutover = migration?.cutover;
  if (descriptor.version !== 'cairn-local-installation-v2' || descriptor.state !== 'installed' ||
      descriptor.operation !== null || migration?.state !== 'verified' || migration.targetEngineId !== id ||
      cutover?.aborting !== false || cutover.reclaiming || !uuid.test(cutover.id) || !uuid.test(cutover.attemptId) ||
      cutover.sourcePath !== database?.path || typeof database?.path !== 'string' ||
      descriptor.ownerId !== options.owner || descriptor.projectId !== (options.project ?? null) ||
      !(clients?.claude || clients?.codex)) throw refuse();
  const expected = join(dirname(database.path), 'cairn-capture-' +
    createHash('sha256').update(database.path).digest('hex') + '-' + cutover.attemptId + '.sqlite');
  if (expected !== options.database) throw refuse();
  const maintenance = join(root, '.cutover-' + cutover.id);
  await checkedPath(maintenance, { directory: true });
  if (await privateRead(join(maintenance, 'repair.json'), { missing: true }) !== undefined) throw refuse();
  const receipt = JSON.parse(await privateRead(join(maintenance, 'activation.json')));
  const { device, inode } = await captureStoreIdentity(expected);
  if (Object.keys(receipt).length !== 5 || receipt.version !== 1 || receipt.phase !== 'active' ||
      receipt.attempt !== cutover.attemptId || !/^\d+:\d+$/u.test(receipt.source) ||
      receipt.target !== device + ':' + inode) throw refuse();
  const store = { path: expected, dev: device, ino: inode };
  if (!modelConsent) return store;
  const consent = await privateRead(join(maintenance, localProviderConsentFile), { missing: true });
  if (consent !== undefined && consent !== localProviderConsentText(options.owner, options.project ?? null)) {
    throw refuse();
  }
  return { ...store, modelConsent: consent !== undefined };
}
