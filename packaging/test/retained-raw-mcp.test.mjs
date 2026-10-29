import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { STORAGE_BUSY_TIMEOUT_MS } from '../../core/database.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { namespace, text, ok, call, host, review, discover, draft, environment, noNetwork } from './fixtures/retained-raw-mcp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), fixture = fileURLToPath(new URL('./fixtures/retained-raw-mcp.mjs', import.meta.url));
function walk(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
}
function closure() {
  const queue = ['core/index.mjs', 'adapters/mcp/cli.mjs'], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path);
    if (!path.endsWith('.mjs')) continue;
    const source = readFileSync(join(root, path), 'utf8');
    for (const match of [...source.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g),
      ...source.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]) {
      const next = relative(root, resolve(root, dirname(path), match[1])); assert.equal(next.startsWith('..'), false);
      if (!lstatSync(join(root, next)).isDirectory()) queue.push(next);
    }
  }
  return [...seen].sort();
}

test('installed retained MCP uses public discovery, real TTY, cold identity and source invalidation', { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'installed-retained-mcp-' }), artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-retained-install', version: '0.0.0', private: true }), { mode: 0o600 });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), executable = join(workspace.path, 'node_modules/.bin/cairn-memory');
  const profilePath = join(workspace.path, 'retained.json'), database = join(workspace.path, '保留 #?%&+.sqlite');
  const manifest = [...JSON.parse(readFileSync(join(installed, 'package.json'))).files].sort();
  const archived = command('tar', ['-tzf', artifact.artifactPath], workspace.path, artifact.userconfig).trim().split('\n').map(path => path.slice('package/'.length)).sort();
  const actual = walk(installed); assert.deepEqual(archived, manifest); assert.deepEqual(actual, archived);
  const traced = closure();
  for (const path of traced) assert.ok(archived.includes(path), path);
  for (const [path, expected] of Object.entries(artifact.sourceHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(join(installed, path))).digest('hex'), expected, path);
  }
  for (const path of ['core/existing-store.mjs', 'core/raw-conversation-list.mjs', 'adapters/mcp/retained-raw-profile.mjs', 'adapters/mcp/retained-raw.mjs']) assert.ok(traced.includes(path));
  t.diagnostic(JSON.stringify({ archiveFiles: archived.length, installedFiles: actual.length, closureFiles: traced.length, independentlyMatched: true }));
  function child(phase, ...args) {
    const result = spawnSync(process.execPath, ['--import', noNetwork, fixture, phase, installed, profilePath, ...args],
      { cwd: workspace.path, encoding: 'utf8', timeout: 15000, env: environment(workspace) });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
    const report = JSON.parse(result.stdout); assert.equal(report.importedCore, join(installed, 'core/index.mjs'));
    assert.equal(report.providerCalls, 0); assert.equal(report.memoryCount, 0);
    t.diagnostic(JSON.stringify({ phase, code: result.status, signal: result.signal, pid: report.pid })); return report;
  }
  child('seed', database);
  const missing = join(workspace.path, 'missing-profile.json');
  const checked = spawnSync(process.execPath, ['--import', noNetwork, executable, '--check-config', '--retained-raw-profile', missing],
    { encoding: 'utf8', timeout: 5000, env: environment(workspace) });
  assert.equal(checked.status, 0, checked.stderr); assert.equal(checked.signal, null); assert.equal(existsSync(missing), false);
  assert.equal(JSON.parse(checked.stdout).profileRead, false);
  const closed = error => {
    t.diagnostic(JSON.stringify({ negotiationRefused: true, name: error.name, code: error.code, message: error.message }));
    return error.name === 'SdkError' && error.message === 'Connection closed';
  };
  for (const extra of [['--owner', namespace.ownerId], ['--db', database]]) {
    const rejected = spawnSync(process.execPath, [executable, '--retained-raw-profile', profilePath, ...extra],
      { encoding: 'utf8', timeout: 5000, env: environment(workspace) });
    assert.equal(rejected.status, 1); assert.equal(rejected.signal, null); assert.equal(rejected.stdout, '');
    await assert.rejects(host(workspace, executable, ['--retained-raw-profile', profilePath, ...extra]), closed);
  }
  const profile = JSON.parse(readFileSync(profilePath)), wrong = join(workspace.path, 'wrong-store.json');
  const invalid = join(workspace.path, 'invalid-profile.json');
  writeFileSync(invalid, JSON.stringify({ ...profile, provider: 'forbidden' }), { mode: 0o600 });
  await assert.rejects(host(workspace, executable, ['--retained-raw-profile', invalid]), closed);
  writeFileSync(wrong, JSON.stringify({ ...profile, storeId: 'synthetic-foreign-store' }), { mode: 0o600 });
  await assert.rejects(host(workspace, executable, ['--retained-raw-profile', wrong]), error => error.code === -32603);
  for (const count of [5, 22]) {
    const local = await host(workspace, executable, ['--db', database, '--owner', namespace.ownerId, ...(count === 22 ? ['--private-cards', 'local-v1'] : [])]);
    assert.equal((await local.client.listTools()).tools.length, count); await local.client.close();
  }
  let local = await host(workspace, executable, ['--retained-raw-profile', profilePath]);
  assert.equal((await local.client.listTools()).tools.length, 25);
  for (const client of ['codex', 'claude-code']) {
    const found = await discover(local.client, client);
    assert.equal(found.pages.flatMap(page => page.messages.flatMap(message => message.parts.map(part => part.text))).join(''), text);
  }
  const saved = await draft(local.client, 'installed-confirm');
  const anchors = [{ rawAnchor: { conversationId: saved.conversationId, messageId: saved.message.id,
    start: 0, end: saved.message.totalUnits, precision: 'whole-message' }, expectedConversationRevision: saved.revision }];
  const budgets = { sourceByteLimit: 64000, scanRowLimit: 1024, deadlineMs: 5000, responseByteLimit: 65536 };
  assert.equal(ok(await call(local.client, 'resolve_source_references', { anchors, budgets })).sources.length, 1);
  assert.equal((await local.client.callTool({ name: 'resolve_source_references', arguments: { anchors, sourceByteLimit: 64000 } })).isError, true);
  assert.equal(ok(await call(local.client, 'read_private_card_source', { source: saved.sources[0], budgets })).parts.map(part => part.text).join(''), text);
  assert.equal((await local.client.callTool({ name: 'read_private_card_source', arguments: { source: saved.sources[0], sourceByteLimit: 64000 } })).isError, true);
  assert.equal((await call(local.client, 'confirm_private_card_draft', { cardId: saved.card.id, expectedRevision: saved.card.revision, actionId: 'mcp-refusal' })).error.code, 'approval_required');
  const tty = review(workspace, executable, profilePath, saved.card); assert.match((await tty.prompt).output, /"type": "raw"/); tty.answer();
  const approved = await tty.done; assert.deepEqual([approved.code, approved.supervisorCode, approved.supervisorSignal], [0, 0, null]);
  await local.client.close(); local = await host(workspace, executable, ['--retained-raw-profile', profilePath]);
  let card = ok(await call(local.client, 'inspect_private_card', { cardId: saved.card.id })).card;
  assert.equal(card.state, 'confirmed'); assert.equal(card.support.applicability, 'current');
  assert.equal(ok(await call(local.client, 'read_private_card_source', { source: saved.sources[0] })).parts.map(part => part.text).join(''), text);
  child('inspect');
  const pending = await draft(local.client, 'installed-stale');
  const waiting = review(workspace, executable, profilePath, pending.card); await waiting.prompt;
  child('delete', pending.conversationId, String(pending.revision)); waiting.answer();
  const stale = await waiting.done; assert.deepEqual([stale.code, stale.supervisorCode, stale.supervisorSignal], [1, 0, null]);
  assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: pending.card.id })).card, null);
  card = ok(await call(local.client, 'inspect_private_card', { cardId: saved.card.id })).card;
  assert.equal(card, null);
  const retainedDb = new DatabaseSync(database, { readOnly: true, timeout: STORAGE_BUSY_TIMEOUT_MS });
  try { assert.equal(retainedDb.prepare('PRAGMA busy_timeout').get().timeout, STORAGE_BUSY_TIMEOUT_MS);
    assert.equal(retainedDb.prepare('SELECT body FROM private_cards WHERE id=?').get(saved.card.id).body, 'Synthetic owner-authored plan.'); }
  finally { retainedDb.close(); }
  assert.equal((await call(local.client, 'read_private_card_source', { source: saved.sources[0] })).ok, false);
  await local.client.close(); local = await host(workspace, executable, ['--retained-raw-profile', profilePath]);
  assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: saved.card.id })).card, null);
  child('inspect'); await local.client.close();
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
