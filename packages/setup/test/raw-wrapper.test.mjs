import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { newDescriptor, executableFor } from '../lib/local-descriptor.mjs';

async function fixture(t, script, { clock = false } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'raw-wrapper-' });
  const home = join(ws.path, 'home'), root = join(home, 'local'), bin = join(ws.path, 'bin');
  for (const path of [home, root, bin, join(root, 'data')]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(bin, 'claude'), `#!${process.execPath}\nconsole.log('[]');\n`, { mode: 0o700 });
  const descriptor = newDescriptor(root, '0.6.6');
  const id = '0.6.6-0123456789ab', executable = executableFor(root, id);
  await mkdir(join(executable, '..'), { recursive: true, mode: 0o700 });
  descriptor.state = 'installed';
  descriptor.engine = { id, package: 'cairn-memory-local-preview', packageVersion: '0.0.0-preview.1', sha256: '0'.repeat(64) };
  descriptor.clients.claude = { server: 'cairn-local', scope: 'user', home, vector: {
    engineId: id, node: process.execPath, databasePath: descriptor.database.path, ownerId: descriptor.ownerId, projectId: null } };
  await writeFile(join(root, 'installation.json'), JSON.stringify(descriptor), { mode: 0o600 });
  await writeFile(executable, script);
  const harness = join(ws.path, 'main.mjs'), observed = join(ws.path, 'timers.json');
  await writeFile(harness, `import {main} from ${JSON.stringify(new URL('../lib/setup.mjs', import.meta.url).href)};
    import {writeFileSync} from 'node:fs';
    const timers=[], real=setTimeout;
    if(${clock})globalThis.setTimeout=(fn,ms,...args)=>{
      if(ms>=120000){timers.push(ms);return real(fn,ms/1000,...args);}return real(fn,ms,...args);
    };
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
const retry = { ok: false, error: { code: 'local_raw_privacy_write_failed', retryable: true } };

test('installer raw deletion survives the old watchdog and preserves engine retryable exit and JSON', async t => {
  const f = await fixture(t, `const timer=setInterval(()=>process.stderr.write('128/1,008 prepared\\n'),30);
    setTimeout(()=>{clearInterval(timer);process.stderr.write('rerun the same command to continue\\n');
      console.log(${JSON.stringify(JSON.stringify(retry))});process.exitCode=3;},300);`, { clock: true });
  const result = await f.run();
  assert.equal(result.code, 3, result.stdout + result.stderr); assert.equal(result.signal, null);
  assert.equal((await f.timers()).at(-1), 630000, 'outer deadline exceeds the engine budget plus shutdown');
  assert.equal(result.stdout, JSON.stringify(retry) + '\n');
  assert.match(result.stderr, /128\/1,008 prepared\n/);
  assert.match(result.stderr, /rerun the same command to continue\n/);
});

test('installer watchdog makes a hung confirmed deletion resumable, with shorter inspection deadlines', async t => {
  const f = await fixture(t, 'setInterval(()=>{},1000);', { clock: true });
  const result = await f.run();
  assert.equal(result.code, 3); assert.equal(JSON.parse(result.stdout).error.retryable, true);
  assert.equal(result.stderr, 'rerun the same command to continue\n');
  assert.equal((await f.timers()).at(-1), 630000);
  for (const args of [['raw', 'list'], ['raw', 'delete', 'synthetic-conversation']]) {
    const inspected = await f.run(args);
    assert.equal(inspected.code, 1); assert.equal(JSON.parse(inspected.stdout).error.retryable, false);
    assert.equal((await f.timers()).at(-1), 120000);
  }
});

test('installer forwards only exact bounded engine stderr forms and leaves stdout JSON lines unchanged', async t => {
  const f = await fixture(t, `process.stderr.write('storage busy; waiting to retry\\n128/1,008 prepared\\nrerun the same command to continue\\n');
    process.stderr.write('arbitrary private diagnostic\\n 128/1,008 prepared\\n01/2 prepared\\n1/2 prepared\\r\\n');
    process.stderr.write('x'.repeat(200000)+'\\n');
    process.stderr.write('1/2 prepared\\n'.repeat(5000));
    console.log(${JSON.stringify(JSON.stringify(retry))});process.exitCode=3;`);
  const result = await f.run();
  assert.equal(result.code, 3); assert.equal(result.stdout, JSON.stringify(retry) + '\n');
  const lines = result.stderr.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['storage busy; waiting to retry', '128/1,008 prepared', 'rerun the same command to continue']);
  assert.equal(lines.length, 4096); assert.ok(lines.slice(3).every(line => line === '1/2 prepared'));
});
