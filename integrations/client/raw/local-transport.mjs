import { lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { types } from 'node:util';
import { ownData, localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { normalizedPath, readConfigurationSnapshot, requestForTarget } from '../../../adapters/local/configuration.mjs';
import { localProcessScope, LocalCaptureTransportError } from './local-process.mjs';
import { localCaptureReply } from './local-reply.mjs';

// Data-only detachment precedes the shared strict schema, without invoking
// accessors/toJSON or reading through a caller-supplied Proxy.
function detached(value, state = { nodes: 0, seen: new Set() }, depth = 0) {
  if (++state.nodes > 2048 || depth > 8) throw Error();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || state.seen.has(value)) throw Error();
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  state.seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value), copy = array ? [] : {};
  if (array) {
    if (descriptors.length.value > 2048) throw Error();
    copy.length = descriptors.length.value;
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === 'length') continue;
    const entry = descriptors[key];
    if (typeof key !== 'string' || !Object.hasOwn(entry, 'value') || key === '__proto__') throw Error();
    copy[key] = detached(entry.value, state, depth + 1);
  }
  state.seen.delete(value); return copy;
}
const supported = bytes => {
  const text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\n$/.exec(text);
  if (!match || !match.slice(1).every(value => Number.isSafeInteger(Number(value))) ||
      !(Number(match[1]) > 22 || Number(match[1]) === 22 && Number(match[2]) >= 16)) throw Error();
};
function selectedKey(env, name) {
  if (!(name === 'OPENAI_API_KEY' || /^CAIRN_[A-Z0-9_]{1,96}_API_KEY$/.test(name))) throw Error();
  const descriptor = Object.getOwnPropertyDescriptor(env, name);
  if (!descriptor) return {};
  if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !descriptor.value.length ||
      descriptor.value.length > 8192 || !descriptor.value.isWellFormed() || /[\x00-\x1f\x7f-\x9f]/.test(descriptor.value)) throw Error();
  return { [name]: descriptor.value };
}

export function createLocalCaptureTransport(options) {
  let input, authority, env, deadlineMs, cli;
  try {
    input = ownData(options, ['nodeExecutable', 'runtimeRoot', 'configPath', 'expectedAuthority', 'home', 'env', 'deadlineMs']);
    for (const field of ['nodeExecutable', 'runtimeRoot', 'configPath', 'home']) if (!normalizedPath(input[field])) throw Error();
    authority = localAuthorityInput(input.expectedAuthority);
    deadlineMs = Object.hasOwn(input, 'deadlineMs') ? input.deadlineMs : 155000;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 3000 || deadlineMs > 155000) throw Error();
    env = Object.hasOwn(input, 'env') ? input.env : process.env;
    if (!env || typeof env !== 'object' || Array.isArray(env) || types.isProxy(env)) throw Error();
    cli = join(input.runtimeRoot, 'adapters/local/cli.mjs');
    input = Object.freeze({ nodeExecutable: input.nodeExecutable, runtimeRoot: input.runtimeRoot, configPath: input.configPath, home: input.home });
  } catch { throw new LocalCaptureTransportError(false); }
  return Object.freeze({
    async capture(value, callOptions = {}) {
      let scope;
      try {
        const call = ownData(callOptions, ['signal']);
        if (call.signal !== undefined && (types.isProxy(call.signal) || !(call.signal instanceof AbortSignal))) throw Error();
        scope = localProcessScope(deadlineMs, call.signal);
        const request = requestForTarget(detached(value), { authority });
        const encoded = JSON.stringify(request); scope.check();
        const snapshot = await readConfigurationSnapshot(input.configPath); scope.check();
        if (JSON.stringify(localAuthorityInput(snapshot.config.authority)) !== JSON.stringify(authority)) throw Error();
        // The single configured own-data value is snapshotted here, not at
        // constructor time; unrelated environment properties are never read.
        const key = selectedKey(env, snapshot.config.provider.apiKeyEnv);
        const home = await stat(input.home); scope.check();
        if (!home.isDirectory() || typeof process.getuid === 'function' && home.uid !== process.getuid()) throw Error();
        if (!(await lstat(input.runtimeRoot)).isDirectory()) throw Error(); scope.check();
        if (!(await lstat(cli)).isFile()) throw Error(); scope.check();
        const baseEnv = { HOME: input.home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
        supported(await scope.run(input.nodeExecutable, ['--version'], baseEnv, undefined, { probe: true }));
        const output = await scope.run(input.nodeExecutable, [cli, '--config', input.configPath, '--config-digest', snapshot.digest],
          { ...baseEnv, ...key }, encoded);
        const result = localCaptureReply(output, request); scope.check(); return result;
      } catch { throw new LocalCaptureTransportError(scope?.uncertain ?? false); }
      finally { scope?.close(); }
    },
  });
}
