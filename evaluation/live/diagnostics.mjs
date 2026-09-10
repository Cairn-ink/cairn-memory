import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { emitDiagnostic } from '../../core/model-diagnostics.mjs';

export const DIAGNOSTIC_SLOT_LIMIT = 64;
export const DIAGNOSTIC_SLOT_BYTES = 256;
const slotName = (index) => `event-${String(index).padStart(2, '0')}.json`;
const fail = () => { throw new Error('invalid_diagnostic_directory'); };

export function validateDiagnosticDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || directory.includes('\0') || path.resolve(directory) !== directory) fail();
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
    || (stat.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail();
  return directory;
}

// Reuse the core's finite vocabulary, and never serialize the incoming object.
function projectEvent(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).length !== 4) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    for (const key of ['version', 'stage', 'layer', 'reason']) {
      if (!Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value')) return null;
    }
    if (fields.version.value !== 1 || typeof fields.stage.value !== 'string'
      || typeof fields.layer.value !== 'string' || typeof fields.reason.value !== 'string') return null;
    let event = null;
    emitDiagnostic({ onDiagnostic: (projected) => { event = projected; } },
      fields.stage.value, fields.layer.value, fields.reason.value);
    return event;
  } catch { return null; }
}

function mark(directory, name) {
  try {
    validateDiagnosticDirectory(directory);
    writeFileSync(path.join(directory, name), '', { mode: 0o600, flag: 'wx' });
  } catch { /* A failed observer cannot affect the operation or write to stdout. */ }
}

export function createDiagnosticCollector(directory) {
  validateDiagnosticDirectory(directory);
  return (value) => {
    try {
      validateDiagnosticDirectory(directory);
      const event = projectEvent(value);
      if (!event) { mark(directory, 'write-failed'); return; }
      const bytes = `${JSON.stringify(event)}\n`;
      if (Buffer.byteLength(bytes) > DIAGNOSTIC_SLOT_BYTES) {
        mark(directory, 'write-failed'); return;
      }
      for (let index = 0; index < DIAGNOSTIC_SLOT_LIMIT; index += 1) {
        try {
          writeFileSync(path.join(directory, slotName(index)), bytes, { mode: 0o600, flag: 'wx' });
          return;
        } catch (error) {
          if (error?.code !== 'EEXIST') { mark(directory, 'write-failed'); return; }
        }
      }
      mark(directory, 'overflow');
    } catch { mark(directory, 'write-failed'); }
  };
}

function readSlot(directory, name, maximum) {
  let descriptor;
  try {
    descriptor = openSync(path.join(directory, name), constants.O_RDONLY
      | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || stat.size > maximum) return { corrupted: true };
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum) return { corrupted: true };
    return { bytes: bytes.subarray(0, length) };
  } catch (error) {
    return error?.code === 'ENOENT' ? { missing: true } : { corrupted: true };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readDiagnostics(directory) {
  const result = { version: 1, events: [], collection: {
    slotLimit: DIAGNOSTIC_SLOT_LIMIT, slotBytes: DIAGNOSTIC_SLOT_BYTES,
    capacityReached: false, overflow: false, corrupted: false,
    writeFailed: false, deliveryGuaranteed: false,
  } };
  try {
    validateDiagnosticDirectory(directory);
    let occupied = 0;
    for (let index = 0; index < DIAGNOSTIC_SLOT_LIMIT; index += 1) {
      const slot = readSlot(directory, slotName(index), DIAGNOSTIC_SLOT_BYTES);
      if (slot.missing) continue;
      occupied += 1;
      let event = null;
      if (slot.bytes) {
        try { event = projectEvent(JSON.parse(slot.bytes.toString('utf8'))); } catch { /* corrupt */ }
      }
      if (event) result.events.push(event);
      else result.collection.corrupted = true;
    }
    result.collection.capacityReached = occupied === DIAGNOSTIC_SLOT_LIMIT;
    for (const [name, field] of [['overflow', 'overflow'], ['write-failed', 'writeFailed']]) {
      const marker = readSlot(directory, name, 0);
      if (!marker.missing) result.collection[field] = true;
      if (marker.corrupted) result.collection.corrupted = true;
    }
  } catch { result.collection.corrupted = true; }
  return result;
}
