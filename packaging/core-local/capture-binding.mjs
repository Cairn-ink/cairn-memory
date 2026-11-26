import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { realpath, lstat } from 'node:fs/promises';
import { checkedPath, privateRead } from '../../integrations/client/private-state.mjs';
import { captureLock } from './capture-lock.mjs';
import { localAuthorityInput } from '../../core/local-authority-input.mjs';
import { absolute, exact, fault } from './capture-input.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const numeric = /^(0|[1-9][0-9]*)$/u;
const providerKeyName = /^(?:OPENAI_API_KEY|CAIRN_[A-Z0-9_]{1,96}_API_KEY)$/u;
const fail = () => fault('authority_changed');

export async function captureStoreIdentity(database) {
  await checkedPath(database);
  if (await realpath(database) !== database) fail();
  const info = await lstat(database, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) fail();
  return { device: String(info.dev), inode: String(info.ino) };
}

export function trustedBinding(value, directory) {
  const binding = exact(value, ['version', 'phase', 'generation', 'database', 'device', 'inode', 'attemptId', 'migrationId', 'attestation',
    'legacyDigest', 'sourceRoot', 'sourceIdentity', 'authority', 'supportPath', 'executable']);
  const { version, phase, generation, database, device, inode, attemptId, migrationId, attestation,
    legacyDigest, sourceRoot, sourceIdentity, authority, supportPath, executable } = binding;
  const source = exact(sourceIdentity, ['device', 'inode']);
  if (version !== 'core-local-capture-v1' || !['staged', 'armed'].includes(phase) || !uuid.test(generation) ||
      basename(directory) !== 'core-' + generation || ![database, sourceRoot, supportPath, executable].every(absolute) ||
      ![device, inode, source.device, source.inode].every(v => typeof v === 'string' && numeric.test(v)) ||
      !uuid.test(attemptId) || !uuid.test(migrationId) || !hash.test(attestation) || !hash.test(legacyDigest) ||
      [directory, database, supportPath, executable].some(path => path === sourceRoot || path.startsWith(sourceRoot + '/'))) fail();
  return { ...binding, authority: localAuthorityInput(authority) };
}

export async function withCaptureBinding(directory, executable, signal, work) {
  if (!absolute(directory) || !basename(directory).startsWith('core-')) fail();
  const legacy = dirname(directory);
  await checkedPath(directory, { directory: true });
  if (await realpath(directory) !== directory) fail();
  return captureLock(join(legacy, '.setup.lock'), async () => {
    signal.throwIfAborted();
    const binding = trustedBinding(JSON.parse(await privateRead(join(directory, 'binding.json'))), directory);
    if (binding.phase !== 'armed' || binding.executable !== executable || await realpath(executable) !== executable) fail();
    const descriptor = JSON.parse(await privateRead(join(dirname(dirname(legacy)), 'installation.json')));
    const migration = descriptor.migration;
    if (descriptor.version !== 'cairn-local-installation-v2' || migration?.state !== 'verified' ||
        migration.cutover?.aborting !== false || migration.cutover.attemptId !== binding.attemptId ||
        migration.cutover.result?.attestation !== binding.attestation || migration.cutover.source?.storeId !== binding.authority.storeId) fail();
    const old = await privateRead(join(legacy, 'installation.json'));
    if (createHash('sha256').update(old).digest('hex') !== binding.legacyDigest) fail();
    const { request, phase, storeId, targetId } = JSON.parse(old);
    if (phase !== 'disabled' || storeId !== binding.authority.storeId || targetId !== binding.authority.targetId ||
        request.installationDirectory !== legacy || request.databasePath === binding.database ||
        request.client !== binding.authority.client || request.sourceRoot !== binding.sourceRoot ||
        request.rawMode !== 'local-plain-v1' || request.interpretationConsent || !request.plaintextRawConsent || !request.foregroundConsent ||
        typeof request.providerApiKeyEnv !== 'string' || !providerKeyName.test(request.providerApiKeyEnv)) fail();
    const actual = await captureStoreIdentity(binding.database);
    if (actual.device !== binding.device || actual.inode !== binding.inode) fail();
    return work(binding, legacy, request.providerApiKeyEnv);
  }, { signal });
}
