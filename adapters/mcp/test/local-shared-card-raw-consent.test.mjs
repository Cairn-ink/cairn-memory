import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { connect } from './local-shared-support.mjs';
import { sourceFixture, savedSource, ns } from '../../../core/testing/raw-source-fixtures.mjs';
import { scriptedConsolidator } from '../../../core/testing/engine-card-fixture.mjs';

for (const [name, options, expected] of [
  ['default', {}, 0],
  ['explicit opt-in', { rawSemantic: true }, 8],
  ['semantic override', { rawSemantic: true, contextSemantic: false }, 0],
  ['explicit opt-out', { rawSemantic: false }, 0],
]) test(`shared runtime and connection preserve Card Raw consent: ${name}`, { timeout: 20000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('recording model is offline'));
  const model = scriptedConsolidator();
  const f = sourceFixture(t, { lineage: true, model: { ...model, classify: undefined,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: 1, sourceIndices: [0] }] }) } });
  const marker = 'Orion retained raw milestone';
  for (let i = 0; i < 8; i++) await savedSource(f, `${marker} ${i}: synthetic conversation detail`, { sessionId: 'conversation-' + i });
  const memories = f.db.prepare('SELECT id FROM memories ORDER BY id').all();
  assert.equal(memories.length, 8);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n, 8);
  memories.forEach((memory, i) => f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
    .run(new Date(Date.UTC(2026, 0, i * 3 + 1)).toISOString(), memory.id));
  // The public server owns its plaintext Raw port. Observe that port's actual
  // decode of the synthetic sealed parts, with background Raw indexing off.
  let opened = 0;
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, 'decode', function(input, options) {
    if (ArrayBuffer.isView(input) && Buffer.from(input.buffer, input.byteOffset, input.byteLength).includes(marker)) opened++;
    return Reflect.apply(decode, this, [input, options]);
  });
  const server = createLocalSharedRuntime({ path: f.path, namespace: ns, model, rawSearch: false, ...options }, { strict: true });
  const connection = await connect(t, server);
  assert.equal(server.inspect().sdkServers, 1, 'the per-connection server uses the shared runtime');
  assert.equal(server.inspect().runtime.refreshers, 1, 'the shared runtime owns maintenance');
  assert.ok((await connection.client.listTools()).tools.some(tool => tool.name === 'read_memory_context'));
  f.workspace.defer(() => server.close());
  const end = Date.now() + 15000;
  while (!f.db.prepare("SELECT 1 FROM private_cards WHERE state='confirmed'").get() && Date.now() < end) await delay(50);
  await server.close();
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].rawSpans.length, expected, 'R2N_SHARED_CARD_RAW_CONSENT');
  assert.equal(opened, expected, 'only an explicit, non-overridden opt-in opens Raw parts');
  assert.equal(f.db.prepare("SELECT count(*) n FROM private_cards WHERE state='confirmed'").get().n, 1, 'Card still builds');
  if (expected) assert.ok(model.calls[0].rawSpans.every(span => span.text.startsWith(marker)));
});

