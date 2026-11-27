import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { transportFixture } from '../../../integrations/client/test/fixtures/local-transport-workspace.mjs';
import { claude, confirm, credentialPattern, installer, keyedRefusal, launch, legacyFixture, linux, makeCapturePayload,
  operator, prepare, providerFixture, readJSON, recordClientPresence, rpc, setup } from './local-cutover-fix-support.mjs';

test('local setup, cutover, repair, Raw, capture, MCP and uninstall pass no provider key to any child', linux, async t => {
  const f = await legacyFixture(t, { both: true, capture: true });
  const trace = join(f.parent, 'children.jsonl');
  const preload = join(f.parent, 'child-observer.mjs');
  const read = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [];
  for (const name of ['claude', 'codex']) recordClientPresence(f, trace, name);
  writeFileSync(preload, `
import cp from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const preload = fileURLToPath(import.meta.url);
process.execArgv.splice(process.execArgv.indexOf(preload) - 1, 2);
const trace = ${JSON.stringify(trace)};
const record = event => appendFileSync(trace, JSON.stringify(event) + '\\n');
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec']) {
  const original = cp[method];
  cp[method] = (command, ...args) => {
    const index = Array.isArray(args[0]) ? 1 : 0;
    const options = args[index];
    const environment = options?.env ?? process.env;
    record({ child: true, worker: Array.isArray(args[0]) && args[0].some(arg => arg.endsWith('/daemon-worker.mjs')),
      key: Object.keys(environment).some(name => ${credentialPattern}.test(name)) });
    if (method !== 'exec' && method !== 'fork' && Array.isArray(args[0]) &&
        command.startsWith('/') && realpathSync(command) === process.execPath) {
      args[0] = ['--import', preload, ...args[0]];
    }
    return original(command, ...args);
  };
}
globalThis.fetch = () => { record({ fetch: true }); throw new Error('unexpected fixture fetch'); };
syncBuiltinESMExports();
`);
  const env = { OPENAI_API_KEY: providerFixture, CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY: providerFixture,
    CAIRN_SYNTHETIC_API_KEY: providerFixture };
  const secret = { preload, env };
  const output = operator(f, setup, { ...secret, code: 2 });
  assert.ok(output.includes(keyedRefusal));
  assert.ok(read().some(row => row.child === 'claude'));
  assert.deepEqual(read().filter(row => row.key), [], 'local setup passed a credential to a child');
  // Local status also probes the two clients for coexisting hosted registrations.
  operator(f, ['status'], secret);
  assert.deepEqual(read().filter(row => row.key), [], 'local status passed a credential to a child');

  const legacy = transportFixture(t);
  legacy.config.interpretation = 'raw-only';
  legacy.config.raw.mode = 'local-plain-v1';
  legacy.save();
  const legacyCapture = launch(f, '--input-type=module', ['-e', `
import assert from 'node:assert/strict';
import { createLocalCaptureTransport } from ${JSON.stringify(new URL('../../../integrations/client/raw/local-transport.mjs', import.meta.url).href)};
const { options, request } = JSON.parse(process.argv[1]);
const result = await createLocalCaptureTransport({ ...options, env: process.env }).capture(request);
assert.equal(result.status, 200);
`, JSON.stringify({ options: legacy.options, request: legacy.request })], secret);
  assert.equal(legacyCapture.status, 0, legacyCapture.stderr);
  assert.ok(legacy.observed());
  assert.deepEqual(read().filter(row => row.key), [], 'legacy Raw-only capture passed a credential to a child');

  operator(f, prepare, secret);
  operator(f, confirm, secret);
  const { command: node, args: [entry, ...vector] } = claude(f);
  const mcp = launch(f, entry, vector, { ...secret, node, input: rpc('ping', {}) });
  assert.equal(mcp.status, 0, mcp.stderr);
  assert.deepEqual(JSON.parse(mcp.stdout).result, {});
  const { cutover } = readJSON(join(f.root, 'installation.json')).migration;
  const { generation } = readJSON(join(f.root, '.cutover-' + cutover.id, 'capture-claude.json'));
  const installation = join(f.root, 'capture', 'claude', 'core-' + generation);
  const session = randomUUID();
  for (const event of ['SessionStart', 'Stop']) {
    const hook = launch(f, join(dirname(entry), 'capture-cli.mjs'),
      ['hook', '--installation', installation, '--event', event], { ...secret, input: makeCapturePayload(f, session, event) });
    assert.equal(hook.status, 0, hook.stderr);
  }
  assert.equal(JSON.parse(operator(f, ['raw', 'list', '--client', 'claude'], secret)).messageCount, 1);
  operator(f, setup, { ...secret, code: 2 });
  // The repair path is also exercised with a stray provider alias, which never requests consent.
  operator(f, setup, { preload, env: { CAIRN_SYNTHETIC_API_KEY: providerFixture } });
  operator(f, ['uninstall', '--local', '--yes'], { ...secret, entry: installer });
  const observations = read();
  assert.ok(observations.some(row => row.child === 'claude'));
  assert.ok(observations.some(row => row.child === 'codex'));
  assert.ok(observations.some(row => row.worker));
  assert.deepEqual(observations.filter(row => row.key || row.fetch), []);
});
