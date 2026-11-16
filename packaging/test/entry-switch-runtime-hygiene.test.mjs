import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRuntimeHygiene } from './fixtures/entry-switch-installed.mjs';

const prefix = 'd-' + 'a'.repeat(32), foreign = 'd-' + 'b'.repeat(32), own = 'd-' + 'c'.repeat(32);
const owner = { pid: 101, start: '1', boot: 'synthetic', namespace: 'synthetic' };
const successor = { ...owner, pid: 102, start: '2' };
const entry = (suffix, changes = {}, base = prefix) => ({ name: base + suffix,
  kind: suffix === '.sock' ? 'socket' : 'file', inode: 1, size: 10, mtime: 1, ...changes });
const identity = (value = owner, alive = true, base = prefix) => ({ prefix: base, owner: value, alive });
const snapshot = (entries, identities = [], retired = []) => ({ entries, identities, retired });
const base = (alive = true) => snapshot(['.lock', '.lock.owner-token', '.lock.reap-token', '.sock', '.json', '.stamp', '.log'].map(s => entry(s)), [identity(owner, alive)]);
const copy = value => structuredClone(value);
const classify = (before, after, ownership) => classifyRuntimeHygiene(before, after, ownership);
const passes = result => assert.deepEqual(result.errors, []);
const fails = result => assert.ok(result.errors.length > 0, JSON.stringify(result));
// This is the exact former teardown rule: only names added to the folder matter.
const oldRule = (before, after) => after.entries.filter(e => !before.entries.some(b => b.name === e.name));

test('foreign identities created after baseline pass; the old global rule rejects the same snapshots', () => {
  const before = base(), after = copy(before);
  after.entries.push(entry('.json', {}, foreign)); after.identities.push(identity(successor, true, foreign));
  assert.equal(oldRule(before, after).length, 1); passes(classify(before, after));
});
test('live heartbeat rename and append-only log pass, without mutating either snapshot', () => {
  const before = base(), after = copy(before);
  Object.assign(after.entries.find(e => e.name.endsWith('.stamp')), { inode: 2, size: 11, mtime: 2 });
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { size: 20, mtime: 2 });
  const saved = copy({ before, after }); passes(classify(before, after));
  assert.deepEqual({ before, after }, saved);
  // A heartbeat crossing the snapshot may leave an atomic publication temp.
  after.entries.push(entry('.stamp.tmp-synthetic'));
  assert.equal(oldRule(before, after).length, 1); passes(classify(before, after));
});
test('dead or ownerless foreign entries must keep name, kind, inode, size and mtime exactly', () => {
  for (const ownerless of [false, true]) for (const field of ['name', 'kind', 'inode', 'size', 'mtime']) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.entries[0][field] = typeof after.entries[0][field] === 'number' ? 99 : 'changed';
    fails(classify(before, after));
  }
});
test('touching a live foreign lock, owner, reaper, socket or descriptor fails', () => {
  for (const suffix of ['.lock', '.lock.owner-token', '.lock.reap-token', '.sock', '.json']) {
    const before = base(), after = copy(before); after.entries.find(e => e.name === prefix + suffix).mtime++;
    fails(classify(before, after));
  }
});
test('stamp keeps its name and kind; log keeps its inode and cannot shrink', () => {
  for (const [suffix, changes] of [['.stamp', { name: prefix + '.renamed' }], ['.stamp', { kind: 'socket' }],
    ['.log', { inode: 2 }], ['.log', { size: 1 }], ['.log', { mtime: 2 }]]) {
    const before = base(), after = copy(before); Object.assign(after.entries.find(e => e.name === prefix + suffix), changes);
    fails(classify(before, after));
  }
});
test('a live foreign identity may disappear wholly only after its owner dies', () => {
  const before = base();
  passes(classify(before, snapshot([], [], [identity(owner, false)])));
  fails(classify(before, snapshot([], [], [identity(owner, true)])));
  fails(classify(before, snapshot([entry('.log')], [], [identity(owner, false)])));
});
test('a live non-test takeover passes with a diagnostic; a dead or test owner fails', () => {
  const before = base(), after = base(); after.identities = [identity(successor)];
  after.entries.forEach(e => e.inode++);
  const result = classify(before, after); passes(result);
  assert.equal(result.diagnostics.length, 1); assert.match(result.diagnostics[0], /takeover/);
  fails(classify(before, after, { owners: [successor] }));
  after.identities[0].alive = false; fails(classify(before, after));
});
test('test-owned identity files, token markers, logs and key may not remain, even if pre-existing', () => {
  for (const name of [own + '.stamp.tmp-synthetic', own + '.lock.owner-token', own + '.log', 'test-key', 'token.reap-child']) {
    const before = snapshot([{ ...entry('.log'), name }]), after = copy(before);
    fails(classify(before, after, { prefixes: [own], names: ['test-key', own + '.log'], tokenPrefixes: ['token'] }));
  }
});
test('non-identity entries and unrecognized files of pre-existing live identities stay exact', () => {
  for (const name of ['identity-v1.key', 'foreign.log', prefix + '.unknown']) {
    const before = base(), value = { ...entry('.log'), name }; before.entries.push(value);
    const after = copy(before); after.entries.at(-1).mtime++;
    fails(classify(before, after)); passes(classify(before, copy(before)));
  }
});

test('new non-identity entries fail', () => {
  fails(classify(snapshot([]), snapshot([{ ...entry('.log'), name: 'foreign-key' }])));
});

test('additions to dead or ownerless foreign identities are diagnostic only', () => {
  for (const ownerless of [false, true]) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.entries.push(entry('.lock.owner-new-foreign'));
    const result = classify(before, after); passes(result);
    assert.ok(result.diagnostics.some(line => line.includes(prefix + '.lock.owner-new-foreign')));
    assert.deepEqual(after.entries.slice(0, -1), before.entries);
  }
});

test('live log growth compares exact sizes without imposing a wall-clock mtime order', () => {
  const before = base(), after = copy(before);
  Object.assign(before.entries.find(e => e.name.endsWith('.log')), { size: '9007199254740992', mtime: '20' });
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { size: '9007199254740993', mtime: '10' });
  passes(classify(before, after));
});
