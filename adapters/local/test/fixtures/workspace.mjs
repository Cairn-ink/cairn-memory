import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../../core/index.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export function fixture(t, { client = 'codex', namespace = { ownerId: 'synthetic-local', scope: 'personal', projectId: null } } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'local-oneshot-' }), databasePath = join(workspace.path, 'memory.sqlite');
  const home = join(workspace.path, 'home'), usageRoot = join(workspace.path, 'usage-root');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(usageRoot, { mode: 0o700 });
  const core = openMemoryCore({ path: databasePath, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  workspace.defer(() => core.close());
  const current = ok(core.getLocalCaptureControl({ namespace, client }));
  const granted = ok(core.setLocalCaptureControl({ namespace, client, targetId: 'synthetic-oneshot', expectedStoreId: current.storeId,
    expectedRevision: current.revision, automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
  const authority = { version: 'local-capture-authority-v1', targetId: granted.targetId, storeId: granted.storeId, namespace, client,
    expectedControlRevision: granted.revision, expectedConsentGeneration: granted.consentGeneration,
    expectedNamespaceGeneration: ok(core.getCaptureControl({ namespace })).generation,
    expectedRawRevision: ok(core.getRawCaptureControl({ ownerId: namespace.ownerId, client })).revision };
  const config = { version: 'local-capture-config-v1', databasePath, authority, raw: { mode: 'local-plain-v1', capBytes: 1000000 },
    provider: { profile: 'openai-baseline-v1', apiKeyEnv: 'SYNTHETIC_LOCAL_KEY' }, usage: { root: usageRoot, dailyCap: 20, concurrency: 1 },
    timeouts: { captureMs: 5000, processMs: 9000 } };
  const configPath = join(workspace.path, 'config.json'), trace = join(workspace.path, 'trace.jsonl');
  const save = () => writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 }); save();
  const request = (id = 'first', text = 'synthetic_source_secret\n Ａ🙂 e\u0301 ', ordinal = 1) => ({ version: 2, client, event_id: id, session_id: 'synthetic-session',
    ...(namespace.scope === 'project' ? { project_id: namespace.projectId } : {}), messages: [{ id: 'message-' + id, role: 'user', occurred_at: null,
      message_ordinal: ordinal, content: text, part: { index: 0, start: 0, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } }] });
  function launch(input, { mode = 'empty', key = true, bytes, args = [], preloads = [], environment = {}, cli = join(root, 'adapters/local/cli.mjs'), corePath = join(root, 'core/index.mjs') } = {}) {
    const child = spawn(process.execPath, ['--import', join(root, 'adapters/local/test/fixtures/http.mjs'),
      ...preloads.flatMap(path => ['--import', path]), cli, '--config', configPath, ...args], {
      cwd: workspace.path, stdio: ['pipe', 'pipe', 'pipe'], env: {
        PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1', SYNTHETIC_MODE: mode, SYNTHETIC_TRACE: trace,
        SYNTHETIC_CONFIG: configPath, SYNTHETIC_CORE: corePath, ...(key ? { SYNTHETIC_LOCAL_KEY: 'synthetic_key_secret' } : {}), ...environment,
      },
    });
    let stdout = '', stderr = '', timedOut = false;
    const done = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr, timedOut }));
    });
    workspace.defer(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await done; });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 262144) child.kill('SIGTERM'); });
    child.stderr.on('data', text => { stderr += text; if (stderr.length > 16384) child.kill('SIGTERM'); });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes ?? JSON.stringify(input));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 12000);
    done.then(() => clearTimeout(timer), () => clearTimeout(timer));
    return { child, done };
  }
  const run = async (input, options) => (await launch(input, options).done);
  const calls = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const ledger = () => {
    const directory = join(usageRoot, 'usage'); if (!existsSync(directory)) return null;
    const files = readdirSync(directory).filter(name => name.endsWith('.json')); assert.equal(files.length, 1);
    return JSON.parse(readFileSync(join(directory, files[0]), 'utf8'));
  };
  const reply = outcome => {
    assert.equal(outcome.timedOut, false); assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.signal, null);
    assert.doesNotMatch(outcome.stdout + outcome.stderr, /synthetic_source_secret|synthetic_key_secret/);
    assert.equal(outcome.stdout.trim().split('\n').length, 1); return JSON.parse(outcome.stdout);
  };
  return { workspace, core, config, namespace, client, databasePath, configPath, trace, save, request, run, launch, calls, ledger, reply };
}
