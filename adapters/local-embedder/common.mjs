import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { types } from 'node:util';
// Private lifecycle marker; never serialized into management/tool diagnostics.
export const QUARANTINED = Symbol('local-embedder-quarantined');
export const VERSION = 'cairn-local-embed-v1';
export const IDENTITY = Object.freeze({ id: 'local:bge-m3:dense', dimensions: 1024, normalization: 'l2' });
export const MODEL = Object.freeze({ repository: 'Xenova/bge-m3', revision: '4de13258303883538bd53b696b452bf8099f0858', variant: 'fp32', dimensions: 1024, pooling: 'cls', normalization: 'l2', queryPrefix: '', documentPrefix: '', maxTokens: 8192, inputPolicy: 'reject-over-limit-v1', specialTokens: true });
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const refusal = code => Object.assign(new Error(code), { code });
export const fail = code => { throw refusal(code); };
export function absolutePath(value, code = 'invalid_input') {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') || !isAbsolute(value) || normalize(value) !== value) fail(code);
  return value;
}
export function closed(value, keys, code = 'invalid_input') {
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(code);
  return value;
}
export const canonical = value => JSON.stringify(sort(value)) + '\n';
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
// JSON.parse alone silently accepts duplicate object keys. Parse the grammar
// before constructing objects; strict UTF-8 is shared by disk and IPC readers.
export function strictJSON(bytes, code = 'protocol_error') {
  try {
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    let i = 0, nodes = 0;
    const white = () => { while (/\s/.test(source[i] ?? '') && i < source.length) { if (!' \t\r\n'.includes(source[i])) throw 0; i++; } };
    function string() {
      const start = i++;
      for (; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '"') { const value = JSON.parse(source.slice(start, ++i)); if (!value.isWellFormed()) throw 0; return value; }
      }
      throw 0;
    }
    function value(depth = 0) {
      if (++nodes > 1000000 || depth > 32) throw 0;
      white();
      if (source[i] === '"') return string();
      if (source[i] === '{') {
        i++; white(); const object = {}, seen = new Set();
        if (source[i] === '}') { i++; return object; }
        for (;;) {
          white(); if (source[i] !== '"') throw 0;
          const key = string(); if (seen.has(key)) throw 0; seen.add(key); white();
          if (source[i++] !== ':') throw 0;
          Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, configurable: true, writable: true }); white();
          const end = source[i++]; if (end === '}') return object; if (end !== ',') throw 0;
        }
      }
      if (source[i] === '[') {
        i++; white(); const array = []; if (source[i] === ']') { i++; return array; }
        for (;;) { array.push(value(depth + 1)); white(); const end = source[i++]; if (end === ']') return array; if (end !== ',') throw 0; }
      }
      const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(i));
      if (!match) throw 0; i += match[0].length; return JSON.parse(match[0]);
    }
    const parsed = value(); white(); if (i !== source.length) throw 0; return parsed;
  } catch { fail(code); }
}
export const HASH = /^[0-9a-f]{64}$/;
export function relativePath(path) {
  if (typeof path !== 'string' || !path.isWellFormed() || Buffer.byteLength(path) > 512 || path.includes('\\') || path.includes('\0') || path.split('/').some(p => !p || p === '.' || p === '..') || /^[A-Za-z]:/.test(path)) fail('model_pack_manifest_invalid');
  return path;
}
export function qualification(platform = process.platform, arch = process.arch) {
  return platform === 'linux' && arch === 'x64' || platform === 'darwin' && arch === 'arm64' ? 'qualification-required' : 'unverified';
}
