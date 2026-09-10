import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDiagnosticCollector, readDiagnostics, validateDiagnosticDirectory,
  DIAGNOSTIC_SLOT_LIMIT, DIAGNOSTIC_SLOT_BYTES } from '../diagnostics.mjs';

const event = { version: 1, stage: 'select', layer: 'core_validation', reason: 'non_visible_ref' };
const directory = () => mkdtempSync(path.join(tmpdir(), 'cairn-diagnostics-test-'));
const slot = (root, index) => path.join(root, `event-${String(index).padStart(2, '0')}.json`);

test('collector preserves only the finite event and private bounded slots', () => {
  const root = directory();
  const collect = createDiagnosticCollector(root);
  collect(event);
  assert.deepEqual(readDiagnostics(root), { version: 1, events: [event], collection: {
    slotLimit: 64, slotBytes: 256, capacityReached: false, overflow: false,
    corrupted: false, writeFailed: false, deliveryGuaranteed: false,
  } });
  assert.equal(lstatSync(root).mode & 0o777, 0o700);
  assert.equal(lstatSync(slot(root, 0)).mode & 0o777, 0o600);
  assert.ok(lstatSync(slot(root, 0)).size <= DIAGNOSTIC_SLOT_BYTES);
  assert.equal(readFileSync(slot(root, 0), 'utf8'), `${JSON.stringify(event)}\n`);
});

test('invalid fields, accessors and private-shaped reasons never become captured data', () => {
  const root = directory();
  const collect = createDiagnosticCollector(root);
  let accessed = false;
  for (const invalid of [null, [], { ...event, content: 'PRIVATE_SENTINEL' },
    { ...event, reason: 'PRIVATE_SENTINEL' }, { ...event, layer: '__proto__' },
    { ...event, stage: 'PRIVATE_SENTINEL' }, { ...event, version: 2 },
    { ...event, [Symbol('PRIVATE_SENTINEL')]: true },
    Object.defineProperty({ ...event }, 'reason', { get() { accessed = true; throw Error('PRIVATE_SENTINEL'); } }),
    new Proxy({}, { ownKeys() { throw Error('PRIVATE_SENTINEL'); } }),
  ]) assert.doesNotThrow(() => collect(invalid));
  assert.equal(accessed, false);
  const result = readDiagnostics(root);
  assert.deepEqual(result.events, []);
  assert.equal(result.collection.writeFailed, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(readdirSync(root), ['write-failed']);
  assert.equal(readFileSync(path.join(root, 'write-failed'), 'utf8'), '');
});

test('full capacity is distinct from an observed overflow and never overwrites slots', () => {
  const root = directory();
  const collect = createDiagnosticCollector(root);
  for (let i = 0; i < DIAGNOSTIC_SLOT_LIMIT; i++) collect(event);
  assert.equal(readDiagnostics(root).collection.capacityReached, true);
  assert.equal(readDiagnostics(root).collection.overflow, false);
  collect({ ...event, reason: 'duplicate_ref' });
  const result = readDiagnostics(root);
  assert.equal(result.events.length, 64);
  assert.ok(result.events.every(value => value.reason === event.reason));
  assert.equal(result.collection.overflow, true);
  assert.equal(readdirSync(root).length, 65);
});

test('independent concurrent processes cannot exceed fixed slots or pollute stdout', async () => {
  const root = directory();
  const source = `import { createDiagnosticCollector } from ${JSON.stringify(new URL('../diagnostics.mjs', import.meta.url).href)};
    const collect = createDiagnosticCollector(process.argv[1]);
    for (let i = 0; i < 40; i++) collect(${JSON.stringify(event)});`;
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root],
      { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => {
      try { assert.equal(code, 0); assert.equal(output, ''); resolve(); } catch (error) { reject(error); }
    });
  })));
  const result = readDiagnostics(root);
  assert.equal(result.events.length, 64);
  assert.equal(result.collection.overflow, true);
  assert.equal(result.collection.corrupted, false);
  assert.equal(readdirSync(root).length, 65);
});

test('reader rejects malformed, truncated, oversized, forged and symlinked slots without leaking bytes', () => {
  const root = directory();
  const secret = path.join(directory(), 'secret');
  writeFileSync(secret, 'PRIVATE_SENTINEL', { mode: 0o600 });
  const invalid = ['{', '', 'PRIVATE_SENTINEL'.repeat(100),
    JSON.stringify({ ...event, content: 'PRIVATE_SENTINEL' }),
    JSON.stringify({ ...event, reason: 'PRIVATE_SENTINEL' })];
  invalid.forEach((value, i) => writeFileSync(slot(root, i), value, { mode: 0o600 }));
  symlinkSync(secret, slot(root, 5));
  writeFileSync(slot(root, 6), JSON.stringify(event), { mode: 0o644 });
  mkdirSync(slot(root, 7), { mode: 0o700 });
  writeFileSync(slot(root, 63), JSON.stringify(event), { mode: 0o600 });
  writeFileSync(path.join(root, 'event-64.json'), 'PRIVATE_SENTINEL', { mode: 0o600 });
  const result = readDiagnostics(root);
  assert.deepEqual(result.events, [event]);
  assert.equal(result.collection.corrupted, true);
  assert.equal(result.collection.capacityReached, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  createDiagnosticCollector(root)(event);
  assert.equal(readFileSync(secret, 'utf8'), 'PRIVATE_SENTINEL');
});

test('marker corruption is explicit and invalid directories cannot escape observer containment', () => {
  const root = directory();
  symlinkSync(path.join(root, 'missing'), path.join(root, 'overflow'));
  writeFileSync(path.join(root, 'write-failed'), 'PRIVATE_SENTINEL', { mode: 0o600 });
  assert.equal(readDiagnostics(root).collection.corrupted, true);
  assert.equal(readDiagnostics(root).collection.overflow, true);
  const collect = createDiagnosticCollector(root);
  chmodSync(root, 0o755);
  assert.throws(() => validateDiagnosticDirectory(root));
  assert.doesNotThrow(() => collect(event));
  assert.equal(readDiagnostics(root).collection.corrupted, true);
  const link = path.join(directory(), 'link');
  symlinkSync(directory(), link);
  assert.throws(() => createDiagnosticCollector(link));
  assert.throws(() => createDiagnosticCollector('relative'));
});
