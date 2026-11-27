import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { constants, copyFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { rawRequest, splitRaw } from '../../core/testing/raw-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { golden } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { withUpgradeInstallers } from './local-cutover-upgrade.qualification.mjs';

const ownerId = 'synthetic-owner';
const projectId = 'synthetic-project';
const namespace = { ownerId, scope: 'project', projectId };
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const descriptor = f => json(join(f.root, 'installation.json'));
const registration = f => json(join(f.home, '.claude.json')).mcpServers['cairn-local'];
export const documentTopics = ['Amaranth', 'Borealis', 'Cinnabar'];

function document(topic) {
  return `${topic} workshop checklist
- The ${topic} crew stores the signed inventory in a green cabinet beside the clock.
- Before opening, the ${topic} crew checks the brass latch and tests the emergency bell.
- On Friday, the ${topic} crew copies the map to a blue binder and returns the cabinet key.`;
}

export async function withInstalledMcp(f, work, { key, preload } = {}) {
  const { command, args } = registration(f);
  assert.equal(command, process.execPath);
  const child = spawn(command, [...(preload ? ['--import', preload] : []), ...args], {
    cwd: f.parent,
    env: { ...f.environment, ...(key && { OPENAI_API_KEY: key }) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const closed = once(child, 'close');
  child.stdin.on('error', () => {});
  const reader = createInterface({ input: child.stdout });
  const lines = reader[Symbol.asyncIterator]();
  let id = 0;
  const request = async (method, params) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    try {
      const sequence = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: sequence, method, params }) + '\n');
      const { done, value } = await lines.next();
      assert.ok(!done, 'installed MCP ended before its reply');
      const reply = JSON.parse(value);
      assert.equal(reply.id, sequence);
      assert.ok(reply.result && !reply.error, 'installed MCP refused the RPC');
      return reply.result;
    } finally { clearTimeout(timer); }
  };
  try {
    await request('initialize', golden.exchanges.initialize.params);
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    return await work(async (name, args) => {
      const result = await request('tools/call', { name, arguments: args });
      return JSON.parse(result.content[0].text);
    });
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { assert.equal((await closed)[0], 0, 'installed MCP failed to close'); }
    finally { clearTimeout(timer); reader.close(); }
  }
}

export function scalar(path, sql) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return Object.values(db.prepare(sql).get())[0]; }
  finally { db.close(); }
}

async function captureLegacy(f, source, timeless) {
  const root = dirname(dirname(registration(f).args[0]));
  const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
  const core = openMemoryCore({ path: source, raw: true, rawSearch: false, model: {
    ...rationaleModel(), extract: () => ({ items: [] }),
  } });
  try {
    for (const [index, topic] of documentTopics.entries()) {
      const occurredAt = timeless ? null : new Date(Date.UTC(2025, 0, 2 + index)).toISOString();
      const part = splitRaw(document(topic), { id: 'turn-' + index, ordinal: 1, occurredAt })[0];
      const result = await core.captureRaw(rawRequest(part, { namespace, sessionId: 'session-' + index }));
      assert.equal(result.ok, true);
    }
  } finally { await core.close(); }
}

export async function legacyKeyedFixture(installers, label, { seed = true, timeless = false } = {}) {
  const { baseline, testClients } = installers;
  const f = testClients(label);
  f.run(baseline, ['setup', '--local', '--owner', ownerId, '--project', projectId]);
  const original = descriptor(f);
  assert.equal(original.installerVersion, '0.6.11');
  const source = original.database.path;
  assert.equal(scalar(source, 'PRAGMA user_version'), 29);
  if (seed) {
    try {
      await withInstalledMcp(f, async tool => {
        for (const topic of [...documentTopics, 'Dewdrop', 'Elm', 'Fennel', 'Garnet', 'Hazel', 'Iris', 'Juniper']) {
          const result = await tool('remember_memory', { content: `The ${topic} team keeps one spare lantern.` });
          assert.equal(result.ok, true);
        }
      });
    } finally { f.run(baseline, ['daemon', 'stop', '--local']); }
  }
  await captureLegacy(f, source, timeless);
  assert.equal(scalar(source, 'SELECT count(*) FROM raw_conversations'), 3);
  return { f, source, legacy: registration(f) };
}

export async function setupInstalledConsent(installers, f, key) {
  const { candidate } = installers;
  const { main } = await import(pathToFileURL(join(candidate, 'lib/setup.mjs')));
  const path = process.env.PATH;
  const env = { ...f.environment };
  // Setup reads the key directly. A copy or child environment cannot inherit it.
  Object.defineProperty(env, 'OPENAI_API_KEY', { value: key });
  const lines = [];
  try {
    process.env.PATH = f.environment.PATH;
    const result = await main(['setup', '--local', '--lang', 'en'], {
      env,
      interactive: false, write: line => lines.push(line),
      inspection: { fallbackParent: f.parent, managedPaths: [] },
    });
    assert.equal(result, 0, 'installed keyed setup failed');
  } finally { process.env.PATH = path; }
  assert.ok(lines.some(line => line.includes('Local cutover verified')), 'installed setup did not verify');
  const { migration } = descriptor(f);
  const consent = json(join(f.root, '.cutover-' + migration.cutover.id, 'provider-consent.json'));
  assert.deepEqual(consent, { version: 1, owner: ownerId, project: projectId, profile: 'openai-baseline-v1' });
}

export function confirmInstalledUpgrade(installers, f, source, legacy) {
  assert.deepEqual(registration(f), legacy);
  assert.match(f.run(installers.candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
  const { args: [entry, dbFlag, database] } = registration(f);
  assert.equal(dbFlag, '--db');
  assert.notEqual(database, source);
  assert.notEqual(entry, legacy.args[0]);
  assert.match(readFileSync(source, 'utf8'), /This path is retired/u);
  assert.equal(scalar(database, 'SELECT count(*) FROM cairn_raw_messages'), 3);
  return { entry, database };
}

export function buildInstalledDocumentCards(f, entry) {
  const { cutover } = descriptor(f).migration;
  const { generation } = json(join(f.root, '.cutover-' + cutover.id, 'capture-claude.json'));
  const installation = join(f.root, 'capture', 'claude', 'core-' + generation);
  const executable = join(dirname(entry), 'capture-cli.mjs');
  for (const [index, topic] of documentTopics.entries()) {
    const session = randomUUID();
    const transcript = join(f.home, '.claude', 'projects', session + '.jsonl');
    const hook = event => {
      const child = spawnSync(process.execPath, [executable, 'hook', '--installation', installation, '--event', event], {
        cwd: f.parent, env: f.environment, stdio: ['pipe', 'ignore', 'ignore'],
        input: JSON.stringify({ hook_event_name: event, session_id: session, transcript_path: transcript }),
        timeout: 45_000, killSignal: 'SIGKILL',
      });
      assert.equal(child.status, 0, 'installed capture hook failed');
    };
    writeFileSync(transcript, '', { mode: 0o600 });
    hook('SessionStart');
    writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: randomUUID(), promptSource: 'typed',
      timestamp: new Date(Date.UTC(2025, 1, 2 + index)).toISOString(),
      message: { content: [{ type: 'text', text: document(topic) }] },
    }) + '\n');
    hook('Stop');
  }
}

export function copyStoreForControl(f, database) {
  // The managed entry binds its active receipt to the installed path and inode.
  // Stop the keyed session and place an exact, private copy at that same path.
  const clone = database + '.control';
  for (const suffix of ['-journal', '-wal', '-shm']) {
    assert.throws(() => statSync(database + suffix), { code: 'ENOENT' });
  }
  copyFileSync(database, clone, constants.COPYFILE_EXCL);
  renameSync(clone, database);
  const { cutover } = descriptor(f).migration;
  const path = join(f.root, '.cutover-' + cutover.id, 'activation.json');
  const receipt = json(path);
  const { dev, ino } = statSync(database, { bigint: true });
  receipt.target = dev + ':' + ino;
  writeFileSync(path, JSON.stringify(receipt) + '\n', { mode: 0o600 });
}

export { withUpgradeInstallers };
