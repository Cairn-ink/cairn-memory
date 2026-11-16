import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRuntimeHygiene } from './fixtures/entry-switch-installed.mjs';

const prefix = 'd-' + 'a'.repeat(32), foreign = 'd-' + 'b'.repeat(32), own = 'd-' + 'c'.repeat(32);
const owner = { pid: 101, start: '1', boot: 'synthetic', namespace: 'synthetic' };
const successor = { ...owner, pid: 102, start: '2' };
const entry = (suffix, changes = {}, base = prefix) => ({ name: base + suffix,
  kind: suffix === '.sock' ? 'socket' : 'file', inode: 1, size: 10, mtime: 1,
  ...(suffix === '.log' ? { content: 'daemon_ready\n', size: 13 } : {}), ...changes });
const identity = (value = owner, alive = true, base = prefix) => ({ prefix: base, owner: value, alive });
const snapshot = (entries, identities = [], retired = []) => ({ entries, identities, retired });
const base = (alive = true) => snapshot(['.lock', '.lock.owner-token', '.lock.reap-token', '.sock', '.json', '.stamp', '.log'].map(s => entry(s)), [identity(owner, alive)]);
const copy = value => structuredClone(value);
const classify = (before, after, ownership) => classifyRuntimeHygiene(before, after, ownership);
const passes = result => assert.deepEqual(result.errors, []);
const diagnoses = (result, expected) => { passes(result); assert.ok(result.diagnostics.includes(expected), JSON.stringify(result)); };
const fails = result => assert.ok(result.errors.length > 0, JSON.stringify(result));
// This is the exact former teardown rule: only names added to the folder matter.
const oldRule = (before, after) => after.entries.filter(e => !before.entries.some(b => b.name === e.name));

test('foreign identities created after baseline pass; the old global rule rejects the same snapshots', () => {
  const before = base(), after = copy(before);
  after.entries.push(entry('.json', {}, foreign)); after.identities.push(identity(successor, true, foreign));
  assert.equal(oldRule(before, after).length, 1); diagnoses(classify(before, after), 'foreign identity entry created: ' + foreign + '.json');
});
test('live heartbeat rename and append-only log pass, without mutating either snapshot', () => {
  const before = base(), after = copy(before);
  Object.assign(after.entries.find(e => e.name.endsWith('.stamp')), { inode: 2, size: 11, mtime: 2 });
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { content: 'daemon_ready\ndaemon_draining\n', size: 29, mtime: 2 });
  const saved = copy({ before, after }); diagnoses(classify(before, after), 'foreign log append: ' + prefix + '.log');
  assert.deepEqual({ before, after }, saved);
  // A heartbeat crossing the snapshot may leave an atomic publication temp.
  after.entries.push(entry('.stamp.tmp-synthetic'));
  assert.equal(oldRule(before, after).length, 1); diagnoses(classify(before, after), 'foreign identity entry created: ' + prefix + '.stamp.tmp-synthetic');
});
test('dead or ownerless foreign entry changes to name, kind, inode, size and mtime are diagnostic only', () => {
  for (const ownerless of [false, true]) for (const field of ['name', 'kind', 'inode', 'size', 'mtime']) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.entries[0][field] = typeof after.entries[0][field] === 'number' ? 99 : 'changed';
    diagnoses(classify(before, after), 'dead or ownerless foreign entry changed: ' + prefix + '.lock');
  }
});
test('touching a live foreign lock, owner, reaper, socket or descriptor is diagnostic only', () => {
  for (const suffix of ['.lock', '.lock.owner-token', '.lock.reap-token', '.sock', '.json']) {
    const before = base(), after = copy(before); after.entries.find(e => e.name === prefix + suffix).mtime++;
    diagnoses(classify(before, after), 'live foreign entry changed: ' + prefix + suffix);
  }
});
test('foreign stamp and invalid log metadata changes are diagnostic only', () => {
  for (const [suffix, changes] of [['.stamp', { name: prefix + '.renamed' }], ['.stamp', { kind: 'socket' }],
    ['.log', { inode: 2 }], ['.log', { size: 1 }], ['.log', { mtime: 2 }]]) {
    const before = base(), after = copy(before); Object.assign(after.entries.find(e => e.name === prefix + suffix), changes);
    diagnoses(classify(before, after), suffix === '.log' ? 'foreign log changed invalidly: ' + prefix + suffix : 'live foreign entry changed: ' + prefix + '.stamp');
  }
});
test('foreign disappearance and owner liveness are diagnostic only', () => {
  const before = base();
  diagnoses(classify(before, snapshot([], [], [identity(owner, false)])), 'foreign identity gone with dead owner: ' + prefix);
  diagnoses(classify(before, snapshot([], [], [identity(owner, true)])), 'foreign identity gone without dead owner: ' + prefix);
  diagnoses(classify(before, snapshot([entry('.log')], [], [identity(owner, false)])), 'live foreign entry changed: ' + prefix + '.lock');
});
test('live, dead and test-owner foreign takeovers are diagnostic only', () => {
  const before = base(), after = base(); after.identities = [identity(successor)];
  after.entries.filter(e => !e.name.endsWith('.log')).forEach(e => e.inode++);
  const result = classify(before, after); diagnoses(result, 'foreign identity takeover: ' + prefix);
  assert.ok(result.diagnostics.some(line => line === 'foreign identity takeover: ' + prefix));
  diagnoses(classify(before, after, { owners: [successor] }), 'foreign takeover has dead or test owner: ' + prefix);
  after.identities[0].alive = false; diagnoses(classify(before, after), 'foreign takeover has dead or test owner: ' + prefix);
});
test('test-owned identity files, token markers, logs and key may not remain, even if pre-existing', () => {
  for (const name of [own + '.stamp.tmp-synthetic', own + '.lock.owner-token', own + '.log', 'test-key', 'token.reap-child']) {
    const before = snapshot([{ ...entry('.log'), name }]), after = copy(before);
    fails(classify(before, after, { prefixes: [own], names: ['test-key', own + '.log'], tokenPrefixes: ['token'] }));
  }
});
test('foreign non-identity and unrecognized entry changes are diagnostic only', () => {
  for (const name of ['identity-v1.key', 'foreign.log', prefix + '.unknown']) {
    const before = base(), value = { ...entry('.log'), name }; before.entries.push(value);
    const after = copy(before); after.entries.at(-1).mtime++;
    diagnoses(classify(before, after), (name === prefix + '.unknown' ? 'live foreign entry changed: ' : 'non-identity entry changed: ') + name);
    diagnoses(classify(before, copy(before)), name === prefix + '.unknown' ? 'foreign identity live: ' + prefix : 'non-identity entry unchanged: ' + name);
  }
});

test('new foreign non-identity entries are diagnostic only', () => {
  diagnoses(classify(snapshot([]), snapshot([{ ...entry('.log'), name: 'foreign-key' }])), 'non-identity entry created: foreign-key');
});

test('additions to dead or ownerless foreign identities are diagnostic only', () => {
  for (const ownerless of [false, true]) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.entries.push(entry('.lock.owner-new-foreign'));
    const result = classify(before, after); diagnoses(result, 'foreign identity entry created: ' + prefix + '.lock.owner-new-foreign');
    assert.ok(result.diagnostics.some(line => line.includes(prefix + '.lock.owner-new-foreign')));
    assert.deepEqual(after.entries.slice(0, -1), before.entries);
  }
});

test('live content append permits a new inode and backwards wall-clock mtime', () => {
  const before = base(), after = copy(before);
  Object.assign(before.entries.find(e => e.name.endsWith('.log')), { mtime: '20' });
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { inode: 2, content: 'daemon_ready\ndaemon_exit\n', size: 25, mtime: '10' });
  diagnoses(classify(before, after), 'foreign log append: ' + prefix + '.log');
});

const replaceLog = (after, content, changes = {}) => Object.assign(after.entries.find(e => e.name === prefix + '.log'),
  { content, size: Buffer.byteLength(content), inode: 2, mtime: 2, ...changes });

test('dead and ownerless foreign identities revive only with appended daemon_ready; endpoint reaping passes with names-only diagnostic', () => {
  for (const ownerless of [false, true]) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before);
    after.identities = [identity(successor)];
    after.entries = after.entries.filter(e => e.name.endsWith('.log'));
    replaceLog(after, 'daemon_ready\ndaemon_ready\n');
    const result = classify(before, after); diagnoses(result, 'foreign identity revived: ' + prefix);
  }
});

test('non-ready append and removed foreign endpoints produce diagnostics without revival', () => {
  for (const ownerless of [false, true]) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.identities = [identity(successor)];
    after.entries = after.entries.filter(e => e.name.endsWith('.log'));
    replaceLog(after, 'daemon_ready\ndaemon_draining\n');
    diagnoses(classify(before, after), 'dead or ownerless foreign entry changed: ' + prefix + '.lock');
    const preserved = copy(before); replaceLog(preserved, 'daemon_ready\ndaemon_draining\n');
    const result = classify(before, preserved); diagnoses(result, 'foreign log append: ' + prefix + '.log');
    assert.ok(!result.diagnostics.some(line => line.includes('revived')), 'non-ready append does not revive the identity');
  }
});

test('every foreign log diagnoses changed prefixes, non-codes, partial lines, wrong types and invalid shrink', () => {
  for (const state of ['live', 'dead', 'ownerless', 'takeover']) for (const [content, changes] of [
    ['daemon_exit\ndaemon_ready\n', {}], ['daemon_ready\nnot_a_code\n', {}],
    ['daemon_ready\ndaemon_exit', {}], ['daemon_ready\ndaemon_exit\n', { kind: 'socket' }],
    ['daemon_exit\n', {}], ['daemon_ready\n\n', {}],
  ]) {
    const before = base(state === 'live' || state === 'takeover');
    if (state === 'ownerless') before.identities = [];
    const after = copy(before); if (state === 'takeover') after.identities = [identity(successor)];
    replaceLog(after, content, changes); diagnoses(classify(before, after), 'foreign log changed invalidly: ' + prefix + '.log');
  }
});

test('valid log reset crosses 262144 bytes; the exact boundary and invalid reset lines are diagnostic only', () => {
  // 21843 whole daemon_exit lines = 262116 bytes; two new lines cross the cap.
  for (const alive of [true, false]) {
    const before = base(alive), after = copy(before), old = 'daemon_exit\n'.repeat(21843);
    replaceLog(before, old); replaceLog(after, 'daemon_draining\ndaemon_ready\n');
    diagnoses(classify(before, after), 'foreign log reset: ' + prefix + '.log');
    replaceLog(after, 'daemon_exit\n'); diagnoses(classify(before, after), 'foreign log changed invalidly: ' + prefix + '.log');
    replaceLog(after, 'not_a_code\n'.repeat(4)); diagnoses(classify(before, after), 'foreign log changed invalidly: ' + prefix + '.log');
  }
  const before = base(), after = copy(before);
  replaceLog(before, 'daemon_exit\n'.repeat(21843) + 'daemon_draining\n'); // 262132 bytes.
  replaceLog(after, 'daemon_exit\n'); // Exactly 262144 is not a reset.
  diagnoses(classify(before, after), 'foreign log changed invalidly: ' + prefix + '.log');
});

test('foreign changes during revival remain diagnostic for non-endpoints and non-identity entries', () => {
  for (const name of ['identity-v1.key', prefix + '.unknown', prefix + '.stamp.tmp-synthetic']) {
    const before = base(false); before.entries.push({ ...entry('.unknown'), name });
    const after = copy(before); after.identities = [identity(successor)];
    replaceLog(after, 'daemon_ready\ndaemon_ready\n');
    diagnoses(classify(before, after), 'foreign identity revived: ' + prefix);
    after.entries.find(e => e.name === name).mtime++; diagnoses(classify(before, after), (name === 'identity-v1.key' ? 'non-identity entry changed: ' : 'dead or ownerless foreign entry changed: ') + name);
  }
});

// A foreign diagnostic cannot hide owned residue in the same comparison.
test('foreign changes stay diagnostic while every owned class still fails', () => {
  const before = base(false), after = copy(before); after.entries[0].mtime++;
  for (const name of [own + '.json', own + '.log', 'identity-v1.key', 'own-token.reap-child']) {
    const mixed = copy(after); mixed.entries.push({ ...entry('.json'), name });
    const result = classify(before, mixed, { prefixes: [own], names: ['identity-v1.key'], tokenPrefixes: ['own-token'] });
    assert.deepEqual(result.errors, ['test-owned file remains: ' + name]);
    assert.ok(result.diagnostics.includes('dead or ownerless foreign entry changed: ' + prefix + '.lock'));
  }
});
