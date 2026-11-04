// Test-only markers and observation channel. Never import a provider adapter.
import { createHash } from 'node:crypto';
import { MessagePort, parentPort } from 'node:worker_threads';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const names = ['CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY', 'OPENAI_API_KEY', 'CAIRN_TEST_UNRELATED'];
// Surrounding whitespace also proves that admission preserves the exact value.
export const markers = ['  synthetic-dedicated-key-marker  ', 'synthetic-generic-key-marker',
  'synthetic-unrelated-marker', 'synthetic-rotated-key-marker'];
export const hash = value => value === undefined ? null : createHash('sha256').update(value).digest('hex');

// Include non-enumerable Error fields and nested causes; never invoke getters
// or inspect MessagePort internals. Store only hit indexes, never marker values.
export function markerHits(value) {
  const hits = new Set(), seen = new Set();
  function visit(v) {
    if (typeof v === 'string') markers.forEach((marker, i) => { if (v.includes(marker)) hits.add(i); });
    if (!v || typeof v !== 'object' || seen.has(v) || v instanceof MessagePort) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const bytes = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      visit(bytes.toString('utf8')); visit(bytes.toString('utf16le')); return;
    }
    if (v instanceof ArrayBuffer || v instanceof SharedArrayBuffer) { visit(new Uint8Array(v)); return; }
    for (const key of Reflect.ownKeys(v)) {
      visit(String(key));
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (Object.hasOwn(d, 'value')) visit(d.value);
    }
  }
  visit(value); return [...hits];
}

export function installPortAudit(buffer) {
  const counts = new Int32Array(buffer);
  const capture = (port, direction, message) => {
    if (message?.kind === 'test-key-observation') return;
    const at = (port === parentPort ? 0 : 2) + direction;
    Atomics.add(counts, at, 1);
    for (const i of markerHits(message)) Atomics.add(counts, 4 + i, 1);
  };
  const post = MessagePort.prototype.postMessage, on = MessagePort.prototype.on;
  MessagePort.prototype.postMessage = function(message, ...args) {
    capture(this, 0, message); return Reflect.apply(post, this, [message, ...args]);
  };
  MessagePort.prototype.on = function(event, listener) {
    const port = this;
    return Reflect.apply(on, this, [event, event === 'message' ? function(message, ...args) {
      capture(port, 1, message); return Reflect.apply(listener, this, [message, ...args]);
    } : listener]);
  };
}

// Byte scans run in a separate process with no SQLite connections. In
// particular, do not open raw descriptors beside the engine's SQLite handles.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = JSON.parse(readFileSync(0, 'utf8')), files = [], hits = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile()) {
        const name = relative(root, path), found = markerHits(readFileSync(path));
        files.push(name); if (found.length) hits.push({ name, markers: found });
      } else throw Error('unexpected test workspace entry');
    }
  }
  scan(root); process.stdout.write(JSON.stringify({ files, hits }));
}
