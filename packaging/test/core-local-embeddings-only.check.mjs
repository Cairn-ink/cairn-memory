import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { confirmInstalledUpgrade, legacyKeyedFixture, setupInstalledConsent, withInstalledMcp,
  withUpgradeInstallers } from '../../tools/testing/local-cutover-keyed-fixture.mjs';

const key = 'synthetic-endpoint-test';
const origin = 'https://api.openai.com';
const embeddings = origin + '/v1/embeddings';
const responses = '/v1/responses';
const inputTokens = '/v1/responses/input_tokens';
const importTool = 'fixture_import_memories';

function observeFetch(f) {
  const log = join(f.parent, 'endpoint-observations.jsonl');
  const preload = join(f.parent, 'endpoint-observer.mjs');
  writeFileSync(log, '', { mode: 0o600 });
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// The installed profile has no import tool. Expose the real service method
// only in this fixture, behind the same MCP scope and authority as the other tools.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/packaging/core-local/profile.mjs')) {
    return { ...result, source: result.source.toString() + \`
tools.push({
  name: ${JSON.stringify(importTool)},
  inputSchema: record({ items: array(1, 2, record({ text: content }, ['text'])) }, ['items'], true),
});
\` };
  }
  if (url.endsWith('/packaging/core-local/wire-tools.mjs')) {
    const source = result.source.toString();
    const anchor = "      case 'remember_memory': {";
    assert.ok(source.includes(anchor));
    return { ...result, source: source.replace(anchor, \`
      case ${JSON.stringify(importTool)}: {
        return reply(await service.importMemories(scope, args.items.map(({ text }) => ({ text, kind: 'fact' })),
          { kind: 'import', client: 'synthetic-import', sessionId: 'synthetic-import-session' }));
      }
\` + anchor) };
  }
  return result;
} });

// Keep the preload out of the registered launch identity and also observe
// fetches if an installed daemon worker is started.
const filename = fileURLToPath(import.meta.url);
const flag = process.execArgv.indexOf(filename);
assert.ok(flag > 0 && process.execArgv[flag - 1] === '--import');
process.execArgv.splice(flag - 1, 2);
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => spawn(command,
  args[0]?.endsWith('/daemon-worker.mjs') ? ['--import', filename, ...args] : args, options);
syncBuiltinESMExports();

globalThis.fetch = async (url, options) => {
  const target = new URL(url instanceof Request ? url.url : url).href;
  appendFileSync(${JSON.stringify(log)}, JSON.stringify(target) + '\\n');
  assert.equal(target, ${JSON.stringify(embeddings)});
  assert.equal(options.headers.Authorization, 'Bearer ' + ${JSON.stringify(key)});
  const body = JSON.parse(options.body);
  const vector = [1, ...Array(body.dimensions - 1).fill(0)];
  return Response.json({ object: 'list', model: body.model,
    data: body.input.map((_, index) => ({ index, embedding: vector })) });
};
`, { mode: 0o600 });
  return { preload, requests: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}

function verifyEndpoints(requests, operation, t) {
  const count = {
    embeddings: requests.filter(url => url === embeddings).length,
    responses: requests.filter(url => new URL(url).pathname === responses).length,
    inputTokens: requests.filter(url => new URL(url).pathname === inputTokens).length,
    total: requests.length,
  };
  t.diagnostic(JSON.stringify({ operation, ...count }));
  assert.equal(count.responses, 0, operation + ' sent a request to ' + responses);
  assert.equal(count.inputTokens, 0, operation + ' sent a request to ' + inputTokens);
  assert.ok(requests.every(url => url === embeddings), operation + ' sent a request outside ' + embeddings);
  return count.embeddings;
}

test('consented keyed installed MCP sends requests only to the embeddings endpoint',
  { skip: process.platform !== 'linux', timeout: 120_000 }, async t => {
    await withUpgradeInstallers(async installers => {
      const { f, source, legacy } = await legacyKeyedFixture(installers, 'embeddings-only', { seed: false });
      await setupInstalledConsent(installers, f, key);
      confirmInstalledUpgrade(installers, f, source, legacy);
      const { preload, requests } = observeFetch(f);
      const correctedText = 'The synthetic topaz ledger is stored in a red cabinet.';
      const importText = 'The synthetic topaz map has a silver frame.';
      try {
        await withInstalledMcp(f, async tool => {
          const call = async (operation, name, args, usesEmbeddings = false) => {
            const before = requests().length;
            const reply = await tool(name, args);
            const count = verifyEndpoints(requests().slice(before), operation, t);
            assert.equal(reply.ok, true, operation + ': ' + JSON.stringify(reply));
            if (usesEmbeddings) assert.ok(count > 0, operation + ' must exercise the embeddings stub');
            return reply.value;
          };
          const saved = await call('save', 'remember_memory',
            { content: 'The synthetic topaz ledger is stored in a blue cabinet.' }, true);
          const { id, revision } = saved.memory;
          const { memory } = await call('correct', 'correct_memory',
            { memoryId: id, expectedRevision: revision, content: correctedText }, true);
          assert.equal(memory.content, correctedText);
          const imported = await call('import', importTool, { items: [{ text: importText }] }, true);
          assert.equal(imported.imported, 1);

          const query = 'topaz';
          const plain = await call('recall plain', 'recall_memory', { query }, true);
          assert.ok(plain.memories.some(({ memory }) => memory.content === importText));
          const evidence = await call('recall source-evidence', 'recall_memory', { query, contextMode: 'source-evidence' }, true);
          assert.ok(evidence.memories.some(({ receipts }) => receipts.some(({ excerpt }) => excerpt === correctedText)));

          const search = { query, types: ['memory'], intent: 'current' };
          const context = await call('read_memory_context', 'read_memory_context', search);
          assert.ok(context.items.length > 0);
          const found = await call('find_memory_candidates', 'find_memory_candidates', search);
          assert.ok(found.items.length > 0);
          const inspected = await call('inspect_memory', 'inspect_memory', { memoryId: memory.id });
          assert.equal(inspected.memory.content, correctedText);
        }, { key, preload });
        verifyEndpoints(requests(), 'all requests', t);
      } finally {
        f.run(installers.candidate, ['daemon', 'stop', '--local']);
      }
    });
  });
