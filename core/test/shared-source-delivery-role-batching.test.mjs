import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { host, publish, read } from './role-fixture.mjs';

test('role evidence batches scoped receipt marker lookups for both read snapshots', async t => {
  const h = host();
  let afterMetering = false;
  const countTokens = h.context.counter.countTokens;
  h.context.counter.countTokens = text => {
    afterMetering = true;
    return countTokens(text);
  };
  const f = await lineageFixture(t, {
    base: 33, eventTime: true,
    options: { methodPackages: h.methods, assets: h.assets, roleProfiles: h.options, contextRead: h.context },
  });
  const role = 'protocol-review';
  ok(f.core.publishRoleProfileRelease(publish(ns, role, 'publish-protocol-review'), {}));
  const memoryIds = ['intake', 'verification', 'handoff'].map(stage => ok(f.core.admit({
    namespace: ns,
    memory: { content: 'Synthetic protocol for ' + stage, kind: 'fact' },
    receipts: [receipt(stage)],
  })).memory.id).sort();

  const lookups = [];
  const prepare = DatabaseSync.prototype.prepare;
  const hook = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql);
    if (sql.includes('CROSS JOIN suppressed s')) {
      const all = statement.all;
      t.mock.method(statement, 'all', function (...bindings) {
        lookups.push({ bindings, afterMetering });
        return all.apply(this, bindings);
      });
    }
    return statement;
  });

  let result;
  try {
    afterMetering = false;
    result = ok(f.core.readRoleTaskContext({ ...read(role, [ns]), task: 'protocol' }, {}));
  } finally {
    hook.mock.restore();
  }
  assert.deepEqual(result.metered.evidence.map(item => item.ref.id).sort(), memoryIds);
  assert.equal(lookups.length, 2, 'one scoped marker lookup in each of the preparation and revalidation snapshots');
  assert.deepEqual(lookups.map(lookup => lookup.afterMetering), [false, true]);
  for (const { bindings } of lookups) {
    assert.deepEqual(JSON.parse(bindings[0]).sort(), memoryIds);
    assert.deepEqual(bindings.slice(-3), [ns.ownerId, ns.scope, ns.projectId ?? '']);
  }
});
