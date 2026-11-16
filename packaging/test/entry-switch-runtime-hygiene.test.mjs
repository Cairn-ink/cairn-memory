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
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { content: 'daemon_ready\ndaemon_draining\n', size: 29, mtime: 2 });
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
test('stamp keeps its name and kind; log metadata changes require content append or reset', () => {
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
  after.entries.filter(e => !e.name.endsWith('.log')).forEach(e => e.inode++);
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

test('live content append permits a new inode and backwards wall-clock mtime', () => {
  const before = base(), after = copy(before);
  Object.assign(before.entries.find(e => e.name.endsWith('.log')), { mtime: '20' });
  Object.assign(after.entries.find(e => e.name.endsWith('.log')), { inode: 2, content: 'daemon_ready\ndaemon_exit\n', size: 25, mtime: '10' });
  passes(classify(before, after));
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
    const result = classify(before, after); passes(result);
    assert.deepEqual(result.diagnostics, ['foreign identity revived: ' + prefix]);
  }
});

test('non-ready append cannot excuse removed endpoints of dead or ownerless foreign identities', () => {
  for (const ownerless of [false, true]) {
    const before = base(false); if (ownerless) before.identities = [];
    const after = copy(before); after.identities = [identity(successor)];
    after.entries = after.entries.filter(e => e.name.endsWith('.log'));
    replaceLog(after, 'daemon_ready\ndaemon_draining\n');
    fails(classify(before, after));
    const preserved = copy(before); replaceLog(preserved, 'daemon_ready\ndaemon_draining\n');
    const result = classify(before, preserved); passes(result);
    assert.deepEqual(result.diagnostics, [], 'non-ready append does not revive the identity');
  }
});

test('every foreign log rejects changed prefixes, non-codes, partial lines, wrong types and invalid shrink', () => {
  for (const state of ['live', 'dead', 'ownerless', 'takeover']) for (const [content, changes] of [
    ['daemon_exit\ndaemon_ready\n', {}], ['daemon_ready\nnot_a_code\n', {}],
    ['daemon_ready\ndaemon_exit', {}], ['daemon_ready\ndaemon_exit\n', { kind: 'socket' }],
    ['daemon_exit\n', {}], ['daemon_ready\n\n', {}],
  ]) {
    const before = base(state === 'live' || state === 'takeover');
    if (state === 'ownerless') before.identities = [];
    const after = copy(before); if (state === 'takeover') after.identities = [identity(successor)];
    replaceLog(after, content, changes); fails(classify(before, after));
  }
});

test('valid log reset crosses 262144 bytes; the exact boundary and invalid reset lines fail', () => {
  // 21843 whole daemon_exit lines = 262116 bytes; two new lines cross the cap.
  for (const alive of [true, false]) {
    const before = base(alive), after = copy(before), old = 'daemon_exit\n'.repeat(21843);
    replaceLog(before, old); replaceLog(after, 'daemon_draining\ndaemon_ready\n');
    passes(classify(before, after));
    replaceLog(after, 'daemon_exit\n'); fails(classify(before, after));
    replaceLog(after, 'not_a_code\n'.repeat(4)); fails(classify(before, after));
  }
  const before = base(), after = copy(before);
  replaceLog(before, 'daemon_exit\n'.repeat(21843) + 'daemon_draining\n'); // 262132 bytes.
  replaceLog(after, 'daemon_exit\n'); // Exactly 262144 is not a reset.
  fails(classify(before, after));
});

test('revival preserves non-endpoint baseline entries and non-identity entries', () => {
  for (const name of ['identity-v1.key', prefix + '.unknown', prefix + '.stamp.tmp-synthetic']) {
    const before = base(false); before.entries.push({ ...entry('.unknown'), name });
    const after = copy(before); after.identities = [identity(successor)];
    replaceLog(after, 'daemon_ready\ndaemon_ready\n');
    passes(classify(before, after));
    after.entries.find(e => e.name === name).mtime++; fails(classify(before, after));
  }
});
