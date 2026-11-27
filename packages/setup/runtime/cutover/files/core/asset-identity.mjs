import { createHmac } from 'node:crypto';
import { types } from 'node:util';
import { fail } from './validation.mjs';

// Canonical E is streamed into the MAC. In particular, binary input is never
// JSON-stringified, base64-encoded or concatenated into a second large buffer.
const header = (tag, length) => {
  const bytes = Buffer.allocUnsafe(length === undefined ? 1 : 9);
  bytes[0] = tag;
  if (length !== undefined) bytes.writeBigUInt64BE(BigInt(length), 1);
  return bytes;
};
function string(value) {
  if (!value.isWellFormed()) fail('invalid_input');
  return Buffer.from(value, 'utf8');
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const viewFields = Object.fromEntries(['buffer','byteOffset','byteLength'].map(key=>[key,Object.getOwnPropertyDescriptor(typedArrayPrototype,key).get]));
export function binaryView(value) {
  if (!types.isUint8Array(value) || types.isProxy(value)) fail('invalid_input');
  const backing = viewFields.buffer.call(value);
  if (types.isSharedArrayBuffer(backing)) fail('invalid_input');
  try { return new Uint8Array(backing, viewFields.byteOffset.call(value), viewFields.byteLength.call(value)); }
  catch { fail('invalid_input'); }
}
export function writeCanonical(value, write, seen = new Set()) {
  if (value === null) return write(header(0));
  if (typeof value === 'boolean') return write(header(value ? 2 : 1));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_input');
    const bytes = Buffer.from(JSON.stringify(value)); write(header(3, bytes.length)); return write(bytes);
  }
  if (typeof value === 'string') { const bytes = string(value); write(header(4, bytes.length)); return write(bytes); }
  if (types.isUint8Array(value)) { const bytes = binaryView(value); write(header(5, bytes.byteLength)); return write(bytes); }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) fail('invalid_input');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !key.isWellFormed() || !Object.hasOwn(descriptors[key], 'value'))) fail('invalid_input');
  seen.add(value);
  try {
    if (array) {
      if (keys.length !== value.length + 1 || !keys.includes('length')) fail('invalid_input');
      write(header(6, value.length));
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(descriptors, i)) fail('invalid_input');
        writeCanonical(descriptors[i].value, write, seen);
      }
    } else {
      const ordered = keys.map(key => [key, string(key)]).sort((a,b) => Buffer.compare(a[1], b[1]));
      write(header(7, ordered.length));
      for (const [key] of ordered) { writeCanonical(key, write, seen); writeCanonical(descriptors[key].value, write, seen); }
    }
  } finally { seen.delete(value); }
}
export function encodeCanonical(value) {
  const parts = []; writeCanonical(value, part => parts.push(Buffer.from(part))); return Buffer.concat(parts);
}
export const binaryNamespace = ns => [ns.ownerId, ns.scope, ns.projectId];
export function createBinaryIdentity({ cursorSecret, storeId }) {
  return (domain, fields) => {
    const mac = createHmac('sha256', cursorSecret);
    writeCanonical([domain, storeId, ...fields], part => mac.update(part));
    return mac.digest('base64url');
  };
}
