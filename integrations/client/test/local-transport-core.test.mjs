import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fixture, ok } from '../../../adapters/local/test/fixtures/workspace.mjs';
import { transportFixture } from './fixtures/local-transport-workspace.mjs';
import { createLocalCaptureTransport } from '../raw/local-transport.mjs';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
function options(f) {
  f.config.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY'; f.save();
  return { nodeExecutable: process.execPath, runtimeRoot: root, configPath: f.configPath, expectedAuthority: f.config.authority,
    home: f.workspace.path, env: {}, deadlineMs: 7000 };
}
for (const client of ['claude-code', 'codex']) test(`B4a actual ${client} B3/SQLite process retains exact Unicode suffix and keyless replay without usage`, async t => {
  const f = fixture(t, { client }), transport = createLocalCaptureTransport(options(f)), text = ' \t\n Ａ🙂 e\u0301 ';
  const first = f.request('multipart', text.slice(0, 3));
  first.messages[0].part.totalUnits = text.length; first.messages[0].part.totalBytes = Buffer.byteLength(text);
  const response = await transport.capture(first); assert.equal(response.status, 200);
  const replay = await transport.capture(first); assert.equal(replay.status, 200);
  // No eligible first-part projection means no admission duplicate is claimed.
  assert.equal(replay.body.duplicate, false); assert.deepEqual(replay.body.raw, response.body.raw);
  const suffix = { ...first, event_id: 'suffix', messages: [{ ...first.messages[0], content: text.slice(3), part: { ...first.messages[0].part, index: 1, start: 3 } }] };
  assert.equal((await transport.capture(suffix)).status, 200); assert.equal(f.ledger(), null); assert.equal(f.calls().length, 0);
  const db = new DatabaseSync(f.databasePath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? ORDER BY part_index').all(response.body.raw.conversationId);
    assert.equal(rows.length, 2); assert.equal(Buffer.concat(rows.map(row => Buffer.from(row.sealed))).toString('utf8'), text);
  } finally { db.close(); }
});

test('B4a actual B3 child refuses changed config text after parent snapshot before store or provider effects', async t => {
  const f = fixture(t), synthetic = transportFixture(t), config = options(f), before = ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId }));
  const transport = createLocalCaptureTransport({ ...config, nodeExecutable: synthetic.executable({ changeConfig: f.configPath }) });
  await assert.rejects(transport.capture(f.request()), error => error.code === 'local_capture_transport_failed' && error.uncertain === true);
  assert.deepEqual(ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId })), before); assert.equal(f.ledger(), null); assert.equal(f.calls().length, 0);
});
