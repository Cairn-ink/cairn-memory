import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstalledDocumentCards, confirmInstalledUpgrade, legacyKeyedFixture, scalar, setupInstalledConsent, withInstalledMcp,
  withUpgradeInstallers } from './local-cutover-keyed-fixture.mjs';

const key = 'synthetic-installed-credential';
await withUpgradeInstallers(async installers => {
  const blocked = await legacyKeyedFixture(installers, 'timeless-status', { seed: false, timeless: true });
  const messages = [
    ['en', 'Local cutover paused. Found 3 Raw sessions without event times. Legacy service remains active until a follow-up release addresses this.'],
    ['zh', '本機切換已暫停。發現 3 個 Raw 工作階段缺少事件時間。舊版服務會繼續運作，直到後續版本解決此限制。'],
  ];
  const bytes = readFileSync(blocked.source);
  for (const [lang, line] of messages) {
    // testClients appends --lang en to its command, so use the installed
    // program directly for the language matrix.
    const run = (action, code) => {
      const result = spawnSync(process.execPath, [join(installers.candidate, 'bin/memory.mjs'), ...action, '--lang', lang], {
        env: blocked.f.environment, cwd: blocked.f.parent, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL',
      });
      assert.equal(result.status, code, result.stdout + result.stderr);
      assert.equal(result.stdout.split('\n').filter(text => text === line).length, 1, result.stdout);
    };
    run(['setup', '--local'], 2);
    run(['status'], 0);
    assert.ok(readFileSync(blocked.source).equals(bytes));
  }
  await setupInstalledConsent(installers, blocked.f, key);
  confirmInstalledUpgrade(installers, blocked.f, blocked.source, blocked.legacy);

  const { f, source, legacy } = await legacyKeyedFixture(installers, 'installed-keyed');
  assert.equal(scalar(source, 'SELECT count(*) FROM memories'), 10);
  assert.equal(scalar(source, 'SELECT count(*) FROM raw_messages WHERE occurred_at IS NOT NULL'), 3);
  await setupInstalledConsent(installers, f, key);
  const { database, entry } = confirmInstalledUpgrade(installers, f, source, legacy);
  buildInstalledDocumentCards(f, entry);
  assert.equal(scalar(database, 'SELECT count(*) FROM cairn_document_cards'), 3);
  const preload = join(f.parent, 'provider.mjs'), trace = join(f.parent, 'fetch-count.log');
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/embeddings');
  assert.equal(options.headers.Authorization, 'Bearer ' + process.env.OPENAI_API_KEY);
  const { dimensions, input, model } = JSON.parse(options.body);
  assert.equal(model, 'text-embedding-3-small');
  assert.equal(dimensions, 1536);
  appendFileSync(${JSON.stringify(trace)}, 'embedding\\n');
  const embedding = [1, ...Array(dimensions - 1).fill(0)];
  return Response.json({ object: 'list', model, data: input.map((_, index) => ({ index, embedding })) });
};
`, { mode: 0o600 });
  await withInstalledMcp(f, async tool => {
    const content = 'The synthetic Selenite room holds a brass telescope.';
    assert.equal((await tool('remember_memory', { content })).ok, true);
    const read = await tool('read_memory_context', { query: 'Selenite', types: ['memory', 'card'], intent: 'current' });
    assert.equal(read.ok, true);
    assert.ok(JSON.stringify(read.value.items).includes(content));
    const card = await tool('read_memory_context', { query: 'Amaranth', types: ['memory', 'card'], intent: 'current' });
    assert.equal(card.ok, true);
    assert.ok(card.value.items.some(item => item.ref?.type === 'card' && item.body.includes('Amaranth')));
  }, { key, preload });
  assert.equal(scalar(database, 'SELECT count(*) FROM cairn_memories'), 11);
  assert.equal(scalar(database, "SELECT count(*) FROM cairn_memories WHERE json_extract(body, '$.embedding.model') = 'text-embedding-3-small'"), 1);
  assert.equal(readFileSync(trace, 'utf8'), 'embedding\n');
  console.log('Installed 0.6.11 keyed cutover, linked consent, MCP remember and read, and timed/untimed admission passed.');
});
