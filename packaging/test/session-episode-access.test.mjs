import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { command, packageName } from '../build.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const build = fileURLToPath(new URL('../build.mjs', import.meta.url));
const deny = fileURLToPath(new URL('../../adapters/mcp/test/fixtures/episode-deny-imports.mjs', import.meta.url));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('installed core capture is cold-discoverable and forgettable through installed keyless episode CLI',
  { timeout: 120000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-episode-' });
    const built = spawnSync(process.execPath, [build], { encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, TMPDIR: workspace.path, TMP: workspace.path,
        TEMP: workspace.path, NODE_NO_WARNINGS: '1' } });
    assert.equal(built.status, 0, built.stderr);
    const artifact = JSON.parse(built.stdout);
    const root = join(workspace.path, 'install');
    mkdirSync(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-episode-install',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/cli.mjs', 'adapters/mcp/server.mjs',
      'core/contract.mjs', 'core/episode-reads.mjs', 'core/episode-storage.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'),
        artifact.sourceHashes[file]);
    }
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/contract.mjs')));
    const path = join(root, 'episode.sqlite');
    const namespace = { ownerId: 'installed-episode-owner', scope: 'personal', projectId: null };
    let generated = 0;
    let core = openMemoryCore({ path, captureQualification: 'source-bound-v2',
      captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' },
      model: { contextWindow: 8192, countTokens: () => 1,
        interpretEpisode(request) {
          generated++;
          const sourceIndex = request.input.classificationTarget[0];
          const field = value => ({ value, anchors: [{ sourceIndex, start: 0,
            end: request.input.sources[sourceIndex].text.length }] });
          return { type: field('work'), language: 'en', gist: field('Synthetic installed interpretation.'),
            outcome: null, nextStep: null, disposition: null };
        }, extract: () => ({ items: [] }) } });
    workspace.defer(() => core?.close());
    const source = 'INSTALLED_EPISODE_SOURCE_SENTINEL private synthetic text.';
    const captured = ok(await core.capture({ namespace, client: 'installed-client',
      sessionId: 'installed-session', eventId: 'installed-event',
      episodeContext: { clientLabel: 'Synthetic installed client', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'installed-message', role: 'user', content: source, occurredAt: null }] }));
    assert.equal(captured.admission.memories.length, 0);
    const warm = ok(core.getEpisode({ namespace, episodeId: captured.episode.id }));
    assert.equal(warm.sources.items[0].text, source);
    assert.equal(generated, 1);
    core.close(); core = null;

    const cli = join(root, 'node_modules/.bin/cairn-memory');
    const args = ['--db', path, '--owner', namespace.ownerId, '--session-episodes-access', 'episode-v1'];
    const check = spawnSync(process.execPath, ['--import', deny, cli, '--check-config', ...args],
      { encoding: 'utf8', timeout: 5000, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).episodeGenerationEnabled, false);
    const start = async () => {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', deny, cli, ...args],
        env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
      const client = new Client({ name: 'synthetic-installed-episode', version: '1.0.0' });
      let connected = false;
      workspace.defer(() => connected ? client.close() : transport.close());
      await client.connect(transport);
      connected = true;
      return client;
    };
    const call = async (client, name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      const result = JSON.parse(response.content[0].text);
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
      assert.equal(Boolean(response.isError), !result.ok);
      return result;
    };
    const cold = await start();
    const names = (await cold.listTools()).tools.map(tool => tool.name);
    assert.equal(names.includes('capture_memory'), false);
    assert.deepEqual(names.filter(name => name.includes('session_episode')),
      ['list_session_episodes', 'inspect_session_episode', 'forget_session_episode']);
    const range = { since: new Date(Date.now() - 86_400_000).toISOString(),
      until: new Date(Date.now() + 86_400_000).toISOString(), timeBasis: 'receipt' };
    const page = ok(await call(cold, 'list_session_episodes', range));
    assert.deepEqual(page.items.map(item => item.id), [captured.episode.id]);
    assert.deepEqual(ok(await call(cold, 'inspect_session_episode', { episodeId: captured.episode.id })), warm);
    ok(await call(cold, 'forget_session_episode', { episodeId: captured.episode.id,
      expectedRevision: warm.episode.revision }));
    await cold.close();
    const restarted = await start();
    assert.deepEqual(ok(await call(restarted, 'list_session_episodes', range)).items, []);
    const missing = await call(restarted, 'inspect_session_episode', { episodeId: captured.episode.id });
    assert.equal(missing.error.code, 'episode_not_found');
    assert.equal(JSON.stringify(missing).includes(source), false);
    assert.equal(generated, 1);
    await restarted.close();
    assert.equal(existsSync(path), true);
  });
