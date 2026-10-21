import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { configuration, readConfigurationSnapshot } from '../configuration.mjs';
import { fixture, ok } from './fixtures/workspace.mjs';

const policy = 'append-matching-evidence-v1';
const digest = text => createHash('sha256').update(text).digest('hex');
const detail = (f, id) => ok(f.core.get({ namespace: f.namespace, memoryId: id, includeQualification: true }));
const inspect = f => ok(f.core.list({ namespace: f.namespace })).memories;

test('QD-01 B3 optional policy is own-data, closed, exact and preserves the seven-field omitted shape', t => {
  const f = fixture(t), original = configuration(f.config), serialized = JSON.stringify(original);
  assert.equal(Object.hasOwn(original, 'captureQualifiedDuplicates'), false); assert.equal(Object.keys(original).length, 7);
  assert.equal(JSON.stringify(configuration(JSON.parse(serialized))), serialized);
  const selected = configuration({ ...f.config, captureQualifiedDuplicates: policy });
  assert.equal(selected.captureQualifiedDuplicates, policy); assert.equal(Object.isFrozen(selected), true);
  const { captureQualifiedDuplicates, ...without } = selected; assert.equal(JSON.stringify(without), serialized);
  let reads = 0;
  for (const value of [undefined, null, true, '', 'append-matching-evidence-v2']) {
    assert.throws(() => configuration({ ...f.config, captureQualifiedDuplicates: value }), { code: 'invalid_local_capture_configuration' });
  }
  for (const field of Object.keys(f.config)) {
    const input = { ...f.config, captureQualifiedDuplicates: policy }; delete input[field];
    assert.throws(() => configuration(input), { code: 'invalid_local_capture_configuration' });
  }
  for (const input of [Object.assign(Object.create({ captureQualifiedDuplicates: policy }), f.config),
    Object.assign(Object.create({ get captureQualifiedDuplicates() { reads++; return policy; } }), f.config),
    { ...f.config, get captureQualifiedDuplicates() { reads++; return policy; } },
    { ...f.config, captureQualifiedDuplicates: policy, get provider() { reads++; return f.config.provider; } },
    new Proxy(f.config, { ownKeys() { reads++; }, get() { reads++; } }),
    { ...f.config, captureQualifiedDuplicates: policy, extra: true }]) {
    assert.throws(() => configuration(input), { code: 'invalid_local_capture_configuration' });
  }
  assert.equal(reads, 0); assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
});

for (const client of ['claude-code', 'codex']) for (const selected of [false, true]) {
  test(`QD-02/08 actual ${client} one-shot ${selected ? 'policy appends qualified evidence' : 'default remains incomplete'}`, async t => {
    const f = fixture(t, { client });
    if (selected) { f.config.captureQualifiedDuplicates = policy; f.save(); }
    const inputA = { ...f.request('first', 'Synthetic source A.'), session_id: 'synthetic-session-A' };
    const inputB = { ...f.request('second', 'Synthetic source B.'), session_id: 'synthetic-session-B' };
    const first = f.reply(await f.run(inputA, { mode: 'memory' })); assert.equal(first.status, 200); assert.equal(first.body.memoryCount, 1);
    const id = inspect(f)[0].id, original = detail(f, id).qualification;
    const second = f.reply(await f.run(inputB, { mode: 'memory' }));
    assert.equal(second.status, selected ? 200 : 503);
    if (!selected) assert.equal(second.body.error, 'interpretation_incomplete');
    else assert.equal(second.body.memoryCount, 1);
    const current = detail(f, id); assert.equal(inspect(f).length, 1);
    assert.equal(current.receipts.length, selected ? 2 : 1); assert.deepEqual(current.qualification, original);
    const calls = f.calls().length, used = f.ledger().used;
    const repeated = f.reply(await f.run(inputB, { key: false }));
    assert.equal(repeated.status, selected ? 200 : 503); assert.equal(f.calls().length, calls); assert.equal(f.ledger().used, used);
    assert.deepEqual(f.ledger().reservations, []);
    const snapshot = await readConfigurationSnapshot(f.configPath);
    assert.equal(snapshot.digest, digest(readFileSync(f.configPath, 'utf8')));
    const committed = f.reply(await f.run(inputA, { key: false, args: ['--config-digest', snapshot.digest] }));
    assert.equal(committed.status, 200); assert.equal(committed.body.duplicate, true);
    t.diagnostic(JSON.stringify({ client, policy: selected, firstStatus: first.status, secondStatus: second.status,
      processExits: 'each0/null', receipts: current.receipts.length, originalQualificationPreserved: true }));
    await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
  });
}

test('QD-07 changing policy config preserves digest refusal and cannot reopen old registered events', async t => {
  const f = fixture(t), input = f.request('first', 'Synthetic source A.'), first = f.reply(await f.run(input, { mode: 'memory' }));
  assert.equal(first.status, 200); const before = await readConfigurationSnapshot(f.configPath), calls = f.calls().length;
  f.config.captureQualifiedDuplicates = policy; f.save();
  const stale = await f.run(input, { key: false, args: ['--config-digest', before.digest] });
  assert.equal(stale.code, 1); assert.equal(stale.signal, null); assert.equal(stale.stdout, '');
  const changed = f.reply(await f.run(input, { key: false }));
  assert.equal(changed.status, 409); assert.equal(changed.body.error, 'event_payload_conflict'); assert.equal(f.calls().length, calls);
  const invalid = join(f.workspace.path, 'invalid-policy-config.json');
  writeFileSync(invalid, JSON.stringify({ ...f.config, captureQualifiedDuplicates: null }), { mode: 0o600 });
  await assert.rejects(readConfigurationSnapshot(invalid), { code: 'invalid_local_capture_configuration' });
});
