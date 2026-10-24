import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checkedPath, privateRead, privateWrite, syncDirectory } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { fail, exact, sha } from './local-host-profile.mjs';

const commitment = key => createHmac('sha256',key).update(JSON.stringify(['local-raw-worker-v1','installation-key',null])).digest('hex');
const binding = (profile,config) => ({ profileDigest:profile.profileDigest,configDigest:profile.configDigest,
  authorityCommitment:sha(JSON.stringify(config.authority)) });
const readMarker = async profile => {
  const text = await privateRead(profile.markerPath,{ missing:true });
  return text === undefined ? null : JSON.parse(text);
};
async function keyValue(profile) {
  const text = await privateRead(profile.identityKeyPath);
  if (!/^[a-f0-9]{64}\n?$/.test(text)) fail('preparation_invalid');
  const key = Buffer.from(text.trim(),'hex');
  try { return commitment(key); } finally { key.fill(0); }
}

export async function inspectPreparation(profile,config) {
  try {
    const marker = await readMarker(profile);
    const root = await checkedPath(profile.stateRoot,{ directory:true,missing:true });
    const key = await checkedPath(profile.identityKeyPath,{ missing:true });
    if (marker === null && !root && !key) return 'absent';
    if (!marker || !root || !key) fail('preparation_invalid');
    const current = exact(marker,['version','phase','profileDigest','configDigest','authorityCommitment','keyCommitment','rootDevice','rootInode']);
    const expected = binding(profile,config);
    if (current.version !== 'local-raw-host-preparation-v1' || current.phase !== 'ready' ||
        Object.keys(expected).some(field => expected[field] !== current[field]) || current.rootDevice !== String(root.dev) ||
        current.rootInode !== String(root.ino) || current.keyCommitment !== await keyValue(profile)) fail('preparation_invalid');
    const workerRoot = exact(JSON.parse(await privateRead(join(profile.stateRoot,'root.json'))),['version','keyCommitment']);
    if (workerRoot.version !== 'local-raw-state-v1' || workerRoot.keyCommitment !== current.keyCommitment) fail('preparation_invalid');
    await checkedPath(join(profile.stateRoot,'sessions'),{ directory:true });
    return 'ready';
  } catch { fail('preparation_invalid'); }
}

// Every ambiguous durable write stops the operation. A later invocation reads
// the marker, never regenerates a key or continues an interrupted creation.
export async function prepareHost(profile,config,check) {
  try {
    return await stateLock(profile.lockPath,async () => {
      check();
      if (await inspectPreparation(profile,config) === 'ready') return;
      const intent = { version:'local-raw-host-preparation-v1',phase:'creating',profileDigest:profile.profileDigest };
      await privateWrite(profile.markerPath,JSON.stringify(intent),{ exclusive:true });
      if (JSON.stringify(await readMarker(profile)) !== JSON.stringify(intent)) fail('preparation_invalid');
      check();
      // Exclusive creation, not mkdir({recursive:true}), prevents adoption.
      await mkdir(profile.stateRoot,{ mode:0o700 });
      await syncDirectory(dirname(profile.stateRoot));
      check();
      const bytes = randomBytes(32);
      let key;
      try {
        key = await open(profile.identityKeyPath,'wx',0o600);
        await key.writeFile(bytes.toString('hex')+'\n');
        await key.sync();
      } finally { bytes.fill(0); await key?.close(); }
      await syncDirectory(dirname(profile.identityKeyPath));
      check();
      const keyCommitment = await keyValue(profile);
      await privateWrite(join(profile.stateRoot,'root.json'),JSON.stringify({ version:'local-raw-state-v1',keyCommitment }),{ exclusive:true });
      await mkdir(join(profile.stateRoot,'sessions'),{ mode:0o700 });
      await syncDirectory(profile.stateRoot);
      check();
      const root = await checkedPath(profile.stateRoot,{ directory:true });
      if (JSON.stringify(await readMarker(profile)) !== JSON.stringify(intent)) fail('preparation_invalid');
      await privateWrite(profile.markerPath,JSON.stringify({ version:'local-raw-host-preparation-v1',phase:'ready',...binding(profile,config),
        keyCommitment,rootDevice:String(root.dev),rootInode:String(root.ino) }));
      if (await inspectPreparation(profile,config) !== 'ready') fail('preparation_invalid');
    });
  } catch (error) {
    if (error.message === 'state_busy') fail('state_busy');
    if (['cancelled','work_limit'].includes(error.reason)) throw error;
    fail('preparation_invalid');
  }
}
