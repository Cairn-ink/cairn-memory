import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { realpath, lstat } from 'node:fs/promises';
import { ownData } from '../../../core/local-authority-input.mjs';
import { normalizedPath, readConfigurationSnapshot } from '../../../adapters/local/configuration.mjs';
import { checkedPath, privateRead } from '../private-state.mjs';

export class LocalHostError extends Error {
  constructor(reason) { super('local_raw_host_' + reason); this.reason = reason; }
}
export const fail = reason => { throw new LocalHostError(reason); };
export const sha = value => createHash('sha256').update(value).digest('hex');
export function exact(value, keys) {
  const input = ownData(value, keys);
  if (Object.keys(input).length !== keys.length) fail('invalid_input');
  return input;
}
export const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
const path = value => normalizedPath(value) && value !== '/' && value.length <= 8192;
export const canonicalHostPath = async value => join(await realpath(dirname(value)), value.slice(value.lastIndexOf('/') + 1));

export async function readHostProfile(profilePath) {
  try {
    if (!path(profilePath)) fail('profile_invalid');
    await checkedPath(dirname(profilePath), { directory:true });
    const text = await privateRead(profilePath), input = exact(JSON.parse(text),
      ['version','configPath','configDigest','stateRoot','identityKeyPath','home','installation']);
    if (input.version !== 'local-raw-host-profile-v1' || typeof input.configDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.configDigest) ||
        ![input.configPath,input.stateRoot,input.identityKeyPath,input.home].every(path)) fail('profile_invalid');
    const client = ownData(input.installation,['client','pluginRoot','qualificationConfigPath']).client;
    const installation = exact(input.installation,client === 'claude-code' ? ['client','pluginRoot'] : ['client','qualificationConfigPath']);
    const installationPath = client === 'claude-code' ? installation.pluginRoot : installation.qualificationConfigPath;
    if (!['claude-code','codex'].includes(client) || !path(installationPath)) fail('profile_invalid');
    for (const parent of new Set([dirname(input.configPath),dirname(input.stateRoot),dirname(input.identityKeyPath)]))
      await checkedPath(parent,{ directory:true });
    await checkedPath(input.home,{ directory:true });
    const locations = { profilePath,markerPath:profilePath+'.prepared.json',lockPath:profilePath+'.prepare.lock',
      stateRoot:input.stateRoot,identityKeyPath:input.identityKeyPath,configPath:input.configPath };
    const canonical = await Promise.all(Object.values(locations).map(canonicalHostPath));
    for (let a = 0; a < canonical.length; a++) for (let b = a+1; b < canonical.length; b++)
      if (overlaps(canonical[a],canonical[b])) fail('profile_invalid');
    if ([input.stateRoot,input.identityKeyPath].some(value => overlaps(value,input.home) && value.startsWith(input.home+'/') === false))
      fail('profile_invalid');
    const installed = await lstat(installationPath);
    if (installed.isSymbolicLink() || (client === 'claude-code' ? !installed.isDirectory() : !installed.isFile()) ||
        typeof process.getuid === 'function' && installed.uid !== process.getuid() || (installed.mode & 0o022)) fail('profile_invalid');
    if (client === 'codex') {
      await checkedPath(dirname(installationPath),{ directory:true });
      await checkedPath(installationPath);
    }
    return Object.freeze({ ...input,installation:Object.freeze(installation),profilePath,
      markerPath:locations.markerPath,lockPath:locations.lockPath,profileDigest:sha(text) });
  } catch { fail('profile_invalid'); }
}

export async function readHostConfiguration(profile) {
  let snapshot;
  try { snapshot = await readConfigurationSnapshot(profile.configPath,profile.configDigest); }
  catch { fail('config_invalid'); }
  if (snapshot.config.authority.client !== profile.installation.client) fail('authority_changed');
  try {
    const forbidden = await Promise.all([profile.stateRoot,profile.identityKeyPath,profile.profilePath,profile.markerPath,profile.lockPath]
      .map(canonicalHostPath));
    const [database,usage] = await Promise.all([snapshot.config.databasePath,snapshot.config.usage.root].map(canonicalHostPath));
    if (forbidden.some(value => overlaps(value,database) || overlaps(value,usage))) fail('profile_invalid');
  } catch { fail('profile_invalid'); }
  return snapshot.config;
}

export function hostRuntime() {
  const [major,minor] = process.versions.node.split('.').map(Number);
  if (process.platform !== 'linux' || !(major > 22 || major === 22 && minor >= 16)) fail('runtime_unavailable');
}

export function hostSelection(value, initialize) {
  try {
    const input = ownData(value,['sessionId','sourcePath',...(initialize ? ['start'] : [])]);
    if (typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 200 ||
        !input.sessionId.isWellFormed() || input.sessionId.trim() !== input.sessionId || /[\x00-\x1f\x7f]/.test(input.sessionId) ||
        !path(input.sourcePath)) fail('invalid_input');
    const start = Object.hasOwn(input,'start') ? input.start : 'eof';
    if (!['beginning','eof'].includes(start)) fail('invalid_input');
    return Object.freeze({ sessionId:input.sessionId,sourcePath:input.sourcePath,...(initialize ? { start } : {}) });
  } catch { fail('invalid_input'); }
}
