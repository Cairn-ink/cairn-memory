import { join, isAbsolute, dirname } from 'node:path';
import { privateRead, privateWrite, checkedPath } from '../client/private-state.mjs';
import { normalizeEndpoint } from '../client/config.mjs';
import { qualifiedHost } from './parser.mjs';

export const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
export function validateInstallation(value) {
  if (!exact(value, ['version','enabled','hostVersion','codex','node','home','root','pairingRecord','usesClaude',
    'endpoint','runtime','dailyCap']) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
    !qualifiedHost(value.hostVersion) || typeof value.usesClaude !== 'boolean' ||
    ![value.codex,value.node,value.home,value.root,value.runtime].every(path => typeof path === 'string' && isAbsolute(path)) ||
    !(value.pairingRecord === null || (typeof value.pairingRecord === 'string' && isAbsolute(value.pairingRecord))) ||
    !Number.isSafeInteger(value.dailyCap) || value.dailyCap < 1 || value.dailyCap > 100000 ||
    normalizeEndpoint(value.endpoint) !== value.endpoint) throw new Error('invalid_installation');
  return value;
}
export async function readInstallation(path) {
  await checkedPath(dirname(path), { directory: true });
  return validateInstallation(JSON.parse(await privateRead(path)));
}
export async function readCredential(path, endpoint) {
  const value = JSON.parse(await privateRead(join(dirname(path), 'credential.json')));
  if (!exact(value, ['version','endpoint','token']) || value.version !== 1 || value.endpoint !== endpoint ||
    typeof value.token !== 'string' || !value.token || value.token.length > 8192 ||
    /[\s\x00-\x1f\x7f]/u.test(value.token)) throw new Error('invalid_credential');
  return value.token;
}
export const writeCredential = (path, endpoint, token) => privateWrite(join(dirname(path), 'credential.json'),
  JSON.stringify({ version: 1, endpoint, token }));

// Deliberately closed: do not inherit host tokens, proxy credentials, Node
// preload/debug flags or plugin options into the launcher, worker or version CLI.
export function childEnvironment(home) {
  return { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), LANG: 'C.UTF-8' };
}
export function clientOptions(config) {
  return { client: 'codex', home: config.home, root: config.root, usesClaude: config.usesClaude,
    isolatedCodex: !config.usesClaude && config.root !== join(config.home, '.cairn-memory'),
    pairingRecord: config.pairingRecord ?? undefined, env: childEnvironment(config.home) };
}
