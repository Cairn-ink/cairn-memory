import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'excerpt-cursor-test', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const payload = cursor => JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString('utf8'));

test('internal excerpt cursors bind query and policy without exposing query; public cursors remain compatible', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-excerpt-cursors-')), 'memory.sqlite');
  let observed = [];
  let selections = 0;
  const model = { contextWindow: 8192,
    countTokens(text) {
      if (text) {
        const value = JSON.parse(text);
        if (value.ok && value.value?.nextCursor) observed.push(value.value.nextCursor);
      }
      // Fixed synthetic counter isolates cursor/page behavior, not provider cost.
      return 1;
    },
    select() { selections++; return { refs: [] }; },
    rank() { assert.fail('empty selection must not rank'); },
  };
  let core = openMemoryCore({ path, model });
  t.after(() => core.close());
  for (let i = 0; i < 101; i++) ok(core.admit({ namespace,
    memory: { content: `Synthetic cursor note ${i}`, kind: 'fact' },
    receipts: [{ client: 'test', sessionId: 'cursor', eventId: `note-${i}`,
      role: 'user', excerpt: `Synthetic cursor note ${i}` }],
  }));
  const publicCursor = ok(core.map({ namespace })).nextCursor;
  assert.ok(publicCursor);
  assert.equal(payload(publicCursor).o, 'map');
  assert.equal(Object.hasOwn(payload(publicCursor), 'q'), false);
  const run = async query => {
    observed = []; selections = 0;
    const result = ok(await core.recall({ readSet: [namespace], query }));
    assert.equal(result.coverage, 'complete');
    assert.equal(selections, 2);
    assert.deepEqual(result.memories, []);
    assert.ok(observed.length > 0);
    const cursor = observed[0];
    const binding = payload(cursor);
    assert.equal(binding.o, 'recall_map');
    assert.equal(typeof binding.q, 'string');
    assert.ok(binding.q.length > 20);
    assert.ok(binding.x);
    assert.equal(JSON.stringify(binding).includes(query), false);
    assert.equal(core.map({ namespace, cursor }).error?.code, 'invalid_cursor');
    return cursor;
  };
  const first = await run('Juniper ownership');
  const other = await run('Cedar rollout');
  assert.notEqual(payload(first).q, payload(other).q);
  core.close();
  core = openMemoryCore({ path, model });
  assert.equal(ok(core.map({ namespace, cursor: publicCursor })).exhausted, true);
  const reopened = await run('Juniper ownership');
  assert.equal(reopened, first);
  assert.equal(core.map({ namespace, query: 'Juniper ownership' }).error?.code, 'invalid_input');
});
