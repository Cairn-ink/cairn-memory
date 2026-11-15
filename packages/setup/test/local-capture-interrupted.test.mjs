import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setupFixture } from '../../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { configureCapture, captureStatus } from '../lib/local-capture.mjs';
import { translator } from '../lib/messages.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
test('interrupted disable retains active SQL and hooks and status requires finishing opt-out', async t => {
  const f = await setupFixture(t), root = join(f.root, 'installer');
  await mkdir(join(root, 'capture'), { recursive: true, mode: 0o700 });
  f.request.installationDirectory = join(root, 'capture/claude');
  assert.equal((await f.setup()).status, 'prepared');
  // The fixture API was constructed before relocating the installation.
  const { createLocalRawSetup } = await import('../../../integrations/client/raw/local-setup.mjs');
  const engine = createLocalRawSetup({ installationDirectory: f.request.installationDirectory });
  assert.equal((await f.scoped(() => engine.activate())).status, 'active');
  const node = join(f.root, 'interrupted-node');
  await writeFile(node, '#!/bin/sh\nkill -KILL $$\n', { mode: 0o700 });
  const settingsPath = join(root, 'capture-settings.json');
  await writeFile(settingsPath, JSON.stringify({ version: 1, clients: { claude: {
    enabled: true, noticed: true, engineId: '0.6.7-aaaaaaaaaaaa', node,
  } } }), { mode: 0o600 });
  const env = { HOME: f.root, CLAUDE_CONFIG_DIR: dirname(f.clientConfigPath), PATH: '/usr/bin:/bin', TMPDIR: f.root };
  const output = [], context = { env, t: translator('en'), write: line => output.push(line) };
  await assert.rejects(() => configureCapture(root, { database: { path: f.request.databasePath } }, ['claude'], context, { enabled: false }));
  assert.equal((await json(settingsPath)).clients.claude.enabled, false, 'preference durably saved before child interruption');
  assert.equal(f.control().automaticCaptureEnabled, true, 'SQL authority was not revoked');
  assert.ok((await json(f.clientConfigPath)).hooks.Stop);
  assert.equal((await json(join(f.request.installationDirectory, 'installation.json'))).phase, 'active');
  for (const lang of ['en', 'zh']) {
    output.length = 0;
    await captureStatus(root, 'claude', { ...context, t: translator(lang) });
    assert.match(output.join('\n'), lang === 'en' ? /turning off was interrupted/ : /關閉作業中斷/);
    assert.match(output.join('\n'), /npx @cairn-ink\/memory config --local-capture off/);
    assert.doesNotMatch(output.join('\n'), /capture: off|擷取：off/);
  }
  const hooks = await readFile(f.clientConfigPath, 'utf8');
  assert.equal((await engine.disable()).status, 'disabled');
  assert.equal(f.control().automaticCaptureEnabled, false);
  output.length = 0; await captureStatus(root, 'claude', context);
  assert.match(output.join('\n'), /Claude Code local capture: off \(off\)/, 'completed disable remains off with an unavailable retained runtime');
  await writeFile(f.clientConfigPath, hooks, { mode: 0o600 });
  output.length = 0; await captureStatus(root, 'claude', context);
  assert.match(output.join('\n'), /turning off was interrupted/, 'disabled journal alone is insufficient while hooks remain');
});
