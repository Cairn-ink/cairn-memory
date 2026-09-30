import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const requireSDK = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(requireSDK.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(requireSDK.resolve('@modelcontextprotocol/client/stdio'));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('IS9 inspected offline installed artifact adds local history only on opt-in and survives process restart', { timeout: 60000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-history-' });
  const artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-history-install', private: true }));
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath],
    workspace.path, artifact.userconfig);
  const packagePath = join(workspace.path, 'node_modules', packageName);
  assert.equal(hash(artifact.artifactPath), artifact.sha256);
  for (const [path, expected] of Object.entries(artifact.sourceHashes)) assert.equal(hash(join(packagePath, path)), expected, path);
  const executable = join(packagePath, 'bin/cairn-memory.mjs');
  const database = join(workspace.path, 'memory.sqlite');
  async function connect(history) {
    const client = new Client({ name: 'synthetic-installed-history', version: '1.0.0' });
    workspace.defer(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', executable,
        '--db', database, '--owner', 'synthetic-installed-history', ...(history ? ['--history-updates', 'explicit-v1'] : [])],
      cwd: workspace.path, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
    return client;
  }
  async function call(client, name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.content.length, 1); assert.equal(response.content[0].type, 'text');
    const result = JSON.parse(response.content[0].text);
    assert.equal(Boolean(response.isError), !result.ok);
    assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
    return result;
  }
  let client = await connect(false);
  const defaults = (await client.listTools()).tools;
  assert.deepEqual(defaults.map(tool => tool.name).sort(),
    ['remember_memory', 'recall_memory', 'inspect_memory', 'correct_memory', 'forget_memory'].sort());
  const old = ok(await call(client, 'remember_memory', { content: 'Synthetic installed review is Friday.' })).memory;
  const original = ok(await call(client, 'inspect_memory', { memoryId: old.id }));
  await client.close(); client = await connect(true);
  assert.deepEqual((await client.listTools()).tools.filter(tool => tool.name !== 'supersede_memory'), defaults);
  const updated = ok(await call(client, 'supersede_memory', { memoryId: old.id, expectedRevision: old.revision,
    replacement: { content: 'Synthetic installed review is Monday.', kind: 'fact' }, sourceExcerpt: 'I have adopted Monday for the installed review.' }));
  const historical = ok(await call(client, 'inspect_memory', { memoryId: old.id }));
  const current = ok(await call(client, 'inspect_memory', { memoryId: updated.memory.id }));
  assert.equal(historical.memory.state, 'historical'); assert.deepEqual(historical.receipts, original.receipts);
  assert.equal(current.memory.state, 'active');
  assert.equal(current.receipts[0].excerpt, 'I have adopted Monday for the installed review.');
  assert.deepEqual(historical.supersession.receiptIds, current.receipts.map(receipt => receipt.id));
  await client.close(); client = await connect(true);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: old.id })), historical);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: updated.memory.id })), current);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { states: ['active'] })).memories.map(memory => memory.id), [updated.memory.id]);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { states: ['historical'] })).memories.map(memory => memory.id), [old.id]);
  const stale = await call(client, 'supersede_memory', { memoryId: old.id, expectedRevision: old.revision,
    replacement: { content: 'Synthetic stale successor.', kind: 'fact' }, sourceExcerpt: 'Synthetic stale source.' });
  assert.equal(stale.error.code, 'revision_conflict');
  const failed = await call(client, 'supersede_memory', { memoryId: updated.memory.id, expectedRevision: updated.memory.revision,
    replacement: { content: 'Synthetic overflowing source.', kind: 'fact' }, sourceExcerpt: 'ﬃ'.repeat(300) });
  assert.equal(failed.error.code, 'invalid_input');
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: updated.memory.id })), current);
  const db = new DatabaseSync(database); workspace.defer(() => db.close());
  const snapshot = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  const beforeUnicode = snapshot();
  for (const lone of ['\ud800', '\udc00']) {
    for (const patch of [{ sourceExcerpt: lone }, { replacement: { content: lone, kind: 'fact' } }]) {
      const rejected = await call(client, 'supersede_memory', { memoryId: updated.memory.id,
        expectedRevision: updated.memory.revision, replacement: { content: 'Synthetic Unicode replacement.', kind: 'fact' },
        sourceExcerpt: 'Synthetic adopted update.', ...patch });
      assert.equal(rejected.error.code, 'invalid_input');
      assert.deepEqual(snapshot(), beforeUnicode);
    }
  }
  const corrected = ok(await call(client, 'correct_memory', { memoryId: updated.memory.id, expectedRevision: updated.memory.revision,
    content: 'Synthetic installed Monday morning review.' })).memory;
  assert.equal(corrected.id, updated.memory.id);
  assert.equal(ok(await call(client, 'inspect_memory', { memoryId: old.id })).supersession.evidenceAvailable, false);
  ok(await call(client, 'forget_memory', { memoryId: corrected.id, expectedRevision: corrected.revision }));
  const lost = ok(await call(client, 'inspect_memory', { memoryId: old.id }));
  assert.deepEqual(lost.supersession, { previousRevision: old.revision, replacement: null, receiptIds: [], evidenceAvailable: false });
  await client.close(); client = await connect(false);
  assert.deepEqual((await client.listTools()).tools, defaults);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: old.id })), lost);
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
