import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, splitRaw, ns, localPlainPort, ok }
  from '../../core/testing/raw-capture-fixtures.mjs';

for(const invalidPolicy of [false,true]) test(`non-local Episode preserves source-fence SQL/refusal before policy (invalid=${invalidPolicy})`, async t => {
  const base = localPlainPort();
  let f, input, sealed=false, policyCalls=0;
  const trace=[],prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){if(sealed)trace.push(sql.replace(/\s+/g,' ').trim());return prepare.call(this,sql);});
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sealed)trace.push(sql);return exec.call(this,sql);});
  f = fixture(t, { kind: 'episode', deletion: true, port: {
    ...base,
    async sealRaw(value) {
      ok(f.core.fenceSession({ namespace: ns, client: input.client, sessionId: input.sessionId }));
      // An independently invalidated policy must not replace the older terminal refusal.
      Object.defineProperty(f.policy,'generation',{enumerable:true,configurable:true,
        get(){policyCalls++;return invalidPolicy?null:'notice-1';}});
      sealed=true;
      return base.sealRaw(value);
    },
  } });
  input = request(splitRaw('Synthetic hosted source', { occurredAt: new Date().toISOString() })[0], {}, 'episode');
  const output = await f.core.captureRaw(input);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'conversation_deleted');
  assert.equal(policyCalls,0,'no Raw policy callback after the terminal source fence');
  const fence='SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?';
  assert.ok(trace.includes(fence),JSON.stringify(trace));
  assert.ok(!trace.some(sql=>/SAVEPOINT|raw_mutation_context|local_raw_/.test(sql)),JSON.stringify(trace));
});
