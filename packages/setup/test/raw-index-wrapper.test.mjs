import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { validateRawOptions } from '../lib/local-raw.mjs';
import { translator } from '../lib/messages.mjs';
import { terminalWriter } from '../lib/output.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { newDescriptor, executableFor } from '../lib/local-descriptor.mjs';

async function fixture(t, script, { clock = false, discoveryDelay = 0, projectId = null } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'raw-index-wrapper-' });
  const home = join(ws.path, 'home'), root = join(home, 'local'), bin = join(ws.path, 'bin');
  for (const path of [home, root, bin, join(root, 'data')]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(bin, 'claude'), `#!${process.execPath}\nsetTimeout(()=>console.log('[]'),${discoveryDelay});\n`, { mode: 0o700 });
  const descriptor = newDescriptor(root, '0.6.6');
  descriptor.projectId = projectId;
  const id = '0.6.6-0123456789ab', executable = executableFor(root, id);
  await mkdir(join(executable, '..'), { recursive: true, mode: 0o700 });
  descriptor.state = 'installed';
  descriptor.engine = { id, package: 'cairn-memory-local-preview', packageVersion: '0.0.0-preview.1', sha256: '0'.repeat(64) };
  descriptor.clients.claude = { server: 'cairn-local', scope: 'user', home, vector: {
    engineId: id, node: process.execPath, databasePath: descriptor.database.path, ownerId: descriptor.ownerId, projectId } };
  await writeFile(join(root, 'installation.json'), JSON.stringify(descriptor), { mode: 0o600 });
  await writeFile(executable, script);
  const harness = join(ws.path, 'main.mjs'), observed = join(ws.path, 'timers.json');
  await writeFile(harness, `import {main} from ${JSON.stringify(new URL('../lib/setup.mjs', import.meta.url).href)};
    import {writeFileSync} from 'node:fs';
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    const timers=[], real=setTimeout, spawn=childProcess.spawn;
    let rawWatchdogPending=false;
    if(${clock}){
      // Only the timer armed directly after this fixture's Raw spawn is sped up.
      childProcess.spawn=(node,args,...rest)=>{
        const child=spawn(node,args,...rest);
        if(args?.[0]===${JSON.stringify(executable)})rawWatchdogPending=true;
        return child;
      };
      syncBuiltinESMExports();
      globalThis.setTimeout=(fn,ms,...args)=>{
        if(rawWatchdogPending && (ms===120000 || ms===630000)){
          rawWatchdogPending=false;timers.push(ms);return real(fn,ms/1000,...args);
        }
        return real(fn,ms,...args);
      };
    }
    process.exitCode=await main(process.argv.slice(2),{interactive:false});
    writeFileSync(${JSON.stringify(observed)},JSON.stringify(timers));`);
  const run = (args = ['raw', 'delete', 'synthetic-conversation', '--yes']) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, ...args], { cwd: ws.path,
      env: { HOME: home, CAIRN_MEMORY_HOME: root, CODEX_HOME: join(home, 'codex'), PATH: bin, TMPDIR: ws.path, LANG: 'en_US.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', v => stdout += v); child.stderr.on('data', v => stderr += v);
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { run, timers: async () => JSON.parse(await readFile(observed, 'utf8')) };
}

for (const [line, code] of [['index: present', 0], ['index: built', 0], ['index: insufficient_space', 1],
  ['index: deferred', 1], ['index: busy, close Claude Code and Codex and run again', 3]])
test('raw index passes only --db and preserves verbatim engine output/exit: ' + line, async t => {
  const f = await fixture(t, `import assert from 'node:assert/strict';
    assert.deepEqual(process.argv.slice(2),['raw','index','--db',process.env.HOME+'/local/data/memory.sqlite']);
    process.stdout.write(${JSON.stringify(line + '\n')});process.exitCode=${code};`, { projectId: 'synthetic-project' });
  const result = await f.run(['raw', 'index']);
  assert.equal(result.code, code, result.stdout + result.stderr); assert.equal(result.signal, null);
  assert.equal(result.stdout, line + '\n'); assert.equal(result.stderr, '');
});

test('raw index preserves engine JSON failures and the existing stderr filter', async t => {
  const failure = { ok: false, error: { code: 'synthetic_index_failure', retryable: false } };
  const f = await fixture(t, `console.log(${JSON.stringify(JSON.stringify(failure))});
    process.stderr.write('private diagnostic\\nstorage busy; waiting to retry\\n');process.exitCode=2;`);
  const result = await f.run(['raw', 'index']);
  assert.equal(result.code, 2); assert.equal(result.stdout, JSON.stringify(failure) + '\n');
  assert.equal(result.stderr, 'storage busy; waiting to retry\n');
});

test('raw index refuses extra operands/options through local_raw_arguments', async t => {
  const f = await fixture(t, "throw new Error('invalid index must not spawn');");
  const lines = [];
  terminalWriter(line => lines.push(line))(translator('en')('local_raw_arguments'));
  for (const extra of [['extra'], ['--all'], ['--namespace', 'synthetic'], ['--conversation', 'synthetic'],
    ['--client', 'claude'], ['--verbose'], ['--yes'], ['--local'], ['--cloud'], ['--no-capture'], ['--purge-config'],
    ['--owner', 'synthetic'], ['--db', '/synthetic.sqlite'], ['--project', 'synthetic'],
    ['--endpoint', 'https://example.invalid'], ['--local-capture', 'off'], ['--codex-daily-cap', '1'], ['--codex-capture-exec', 'off']]) {
    const result = await f.run(['raw', 'index', ...extra]);
    assert.equal(result.code, 2); assert.equal(result.stdout, lines.join('\n') + '\n');
    assert.equal(result.stderr, '');
  }
  for (const options of [{ yes: true }, { local: true }, { cloud: true }, { noCapture: true }, { purgeConfig: true },
    { endpoint: 'https://example.invalid' }, { owner: 'synthetic' }, { db: '/synthetic.sqlite' }, { project: 'synthetic' },
    { localCapture: false }, { dailyCap: 1 }, { captureExec: false }])
    assert.throws(() => validateRawOptions(options, { argv: ['raw', 'index'] }),
      { key: 'local_raw_arguments', code: 2 });
});

test('raw index watchdog allows 630 seconds and still bounds a hung build', async t => {
  const f = await fixture(t, 'setInterval(()=>{},1000);', { clock: true });
  const result = await f.run(['raw', 'index']);
  assert.equal(result.code, 1); assert.equal(result.signal, null);
  assert.deepEqual(await f.timers(), [630000]);
  assert.equal(result.stdout, JSON.stringify({ ok: false, error: { code: 'raw_command_failed', retryable: false } }) + '\n');
  assert.equal(result.stderr, '');
});
