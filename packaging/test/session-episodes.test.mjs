import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));

test('installed episode access ships all core modules/prompts and reads seeded episodes plus procedural remembers across cold restart',
  { timeout: 90000 }, async t => {
    const ws = createTestWorkspace(t, { prefix: 'se5-installed-' }), root = ws.path;
    const home = join(root, 'home'); mkdirSync(home);
    const artifact = buildArtifact();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-se5-installed', private: true, version: '0.0.0' }));
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/server.mjs', 'adapters/mcp/cli.mjs', 'core/episode-input.mjs', 'core/episode-capture.mjs',
      'core/episode-schema.mjs', 'core/episode-storage.mjs', 'core/episode-reads.mjs', 'core/session-context.mjs', 'core/procedural-storage.mjs',
      'core/prompts/interpret-episode.md', 'core/prompts/extract-episode-sources.md', 'core/prompts/qualify-episode-candidates.md']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    // Seed via the INSTALLED public core with a synthetic port, never repository test helpers.
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/contract.mjs')));
    const namespace = { ownerId: 'synthetic-installed', scope: 'personal', projectId: null }, path = join(root, 'synthetic.sqlite');
    const core = openMemoryCore({ path, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
      sessionEpisodes: { mode: 'episode-v1' }, model: { contextWindow: 8192, countTokens: () => 1,
        interpretEpisode: request => {
          const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: request.input.sources[0].text.length }] });
          return { type: field('quick-one-off-question'), language: 'mixed', gist: field('Synthetic installed 中文 question'),
            outcome: null, nextStep: field('Review installed synthetic proposal'), disposition: null };
        }, extract: () => assert.fail('Quick batch must not extract') } });
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    let episode;
    try {
      episode = ok(await core.capture({ namespace, client: 'synthetic-installed', sessionId: 'private-installed-session', eventId: 'installed-event',
        episodeContext: { clientLabel: 'Synthetic installed', generation: 'initial', origin: 'ordinary' },
        messages: [{ id: 'message', role: 'user', content: 'Synthetic 中文 proposal.', occurredAt: '2026-09-01T00:00:00.000Z' }] })).episode;
    } finally { core.close(); }
    const start = async () => {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', join(root, 'node_modules/.bin/cairn-memory'),
          '--db', path, '--owner', namespace.ownerId, '--session-episodes-access', 'episode-v1'],
        env: { HOME: home, OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
      const client = new Client({ name: 'synthetic-installed', version: '1.0.0' }); ws.defer(() => client.close());
      await client.connect(transport); return client;
    };
    const call = async (client, name, args = {}) => {
      const response = await client.callTool({ name, arguments: args }); const result = JSON.parse(response.content[0].text);
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); assert.equal(Boolean(response.isError), !result.ok); return result;
    };
    const first = await start(), content = 'Synthetic habit: inspect receipts first.';
    const memory = ok(await call(first, 'remember_memory', { content, kind: 'instruction',
      procedural: { anchors: [{ receiptIndex: 0, start: 0, end: content.length }] } })).memory;
    await first.close(); const cold = await start();
    const tools = (await cold.listTools()).tools; assert.equal(tools.some(tool => tool.name === 'capture_memory'), false);
    const page = ok(await call(cold, 'list_session_episodes', { since: '2026-09-01T00:00:00.000Z', until: '2026-09-02T00:00:00.000Z' }));
    assert.deepEqual(page.items.map(item => item.id), [episode.id]);
    const inspected = ok(await call(cold, 'inspect_session_episode', { episodeId: episode.id }));
    assert.equal(inspected.sources.items[0].text, 'Synthetic 中文 proposal.');
    const context = ok(await call(cold, 'read_session_start_context'));
    assert.equal(context.groups.nextSteps.returned, 1); assert.equal(context.groups.procedural.items[0].memory.id, memory.id);
    assert.match(context.framing, /not execution permission/);
    ok(await call(cold, 'forget_session_episode', { episodeId: episode.id, expectedRevision: inspected.episode.revision }));
    assert.equal(ok(await call(cold, 'read_session_start_context')).groups.nextSteps.returned, 0);
    assert.equal(ok(await call(cold, 'inspect_memory', { memoryId: memory.id })).memory.content, content);
  });
