import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from './workspace.mjs';
import { runCensus, runtimeSnapshot, runtimeDifference, displayName } from './artifact-runtime-census.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = (name, size = '1') => ({ name, inode: '1', dev: '1', mode: '33152', links: '1', size, mtime: '1', ctime: '1' });
const recognized = 'd-' + 'a'.repeat(32) + '.log';
function fixtures(workspace, directory) {
  const clean = join(workspace.path, 'clean.test.mjs'), failure = join(workspace.path, 'failure.test.mjs'), leaker = join(workspace.path, 'intentional-leaker.test.mjs');
  const name = 'd-' + randomBytes(16).toString('hex') + '.log', path = join(directory, name);
  writeFileSync(clean, "import test from 'node:test'; test('clean',()=>{});\n");
  writeFileSync(failure, "import test from 'node:test'; test('failure',()=>{throw Error('/private/path must be hidden')});\n");
  writeFileSync(leaker, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(path)},'daemon_exit\\n',{flag:'wx',mode:0o600});\n`);
  return { clean, failure, leaker, path };
}
async function localCensus(leak) {
  const workspace = createTestWorkspace(null, { prefix: 'local-census-control-' });
  const parent = existsSync('/run/user/' + process.getuid()) ? '/run/user/' + process.getuid() : '/tmp/cairn-' + process.getuid();
  const directory = join(parent, 'cairn-memory');
  const f = fixtures(workspace, directory);
  try {
    const files = ['install', 'preview-installer', 'qualified-install-mcp', 'raw-installed-daemon-lifecycle'].map(name => join(root, 'packaging/test/' + name + '.test.mjs'));
    if (leak) files.push(f.leaker);
    const evidenceAt = process.argv.indexOf('--snapshots');
    const evidence = evidenceAt === -1 ? null : process.argv[evidenceAt + 1];
    let index = 0;
    const result = await runCensus({ files, intervalMs: 3100, snapshot: async () => {
      const value = await runtimeSnapshot();
      if (evidence) {
        const file = basename(files[Math.floor(index / 2)]), boundary = index++ % 2 ? 'after' : 'before';
        writeFileSync(join(evidence, file + '-' + boundary + '.json'), JSON.stringify(value, null, 2) + '\n');
      }
      return value;
    } });
    process.exitCode = result.code;
  } finally {
    if (existsSync(f.path)) {
      const pin = lstatSync(f.path), current = lstatSync(f.path);
      assert.equal(current.ino, pin.ino); assert.equal(current.dev, pin.dev); assert.equal(current.uid, process.getuid());
      unlinkSync(f.path);
    }
    await workspace.cleanup();
  }
}
if (process.argv.includes('--local-census') || process.argv.includes('--local-census-leaker')) {
  await localCensus(process.argv.includes('--local-census-leaker'));
} else {
  test('runtime differences attribute added, changed and removed names to the correct file', async () => {
    const messages = [], snapshots = [[], [entry(recognized)], [entry(recognized)], [entry(recognized, '2')], [entry(recognized)], []];
    const result = await runCensus({ files: ['first.test.mjs', 'second.test.mjs', 'third.test.mjs'], snapshot: async () => ({ entries: snapshots.shift() }),
      run: async () => ({ code: 0 }), write: line => messages.push(JSON.parse(line)) });
    assert.equal(result.code, 1);
    assert.deepEqual(messages.map(row => [row.file, row.added, row.changed, row.removed]), [
      ['first.test.mjs', [recognized], [], []], ['second.test.mjs', [], [recognized], []], ['third.test.mjs', [], [], [recognized]],
    ]);
    assert.deepEqual(result.leaks, ['first.test.mjs']);
  });
  test('unrecognized names and snapshot errors are code-only and never leak paths or content', async () => {
    const output = [], results = [{ entries: [entry('secret-path-name')] }, { entries: [entry('secret-path-name', '2'), entry('/absolute/secret')] }];
    const result = await runCensus({ files: ['/private/path/safe.test.mjs'], snapshot: async () => results.shift(), run: async () => ({ code: 0 }), write: line => output.push(line) });
    assert.equal(result.code, 1); assert.equal(displayName('secret-path-name'), '<redacted>');
    assert.doesNotMatch(output.join(''), /secret|private|absolute|\/path/); assert.match(output.join(''), /redacted/);
    for (const diagnostic of ['runtime_folder_missing', 'runtime_snapshot_failed']) {
      const lines = [];
      const isolated = await runCensus({ files: ['clean.test.mjs'], snapshot: async () => ({ diagnostic }), run: async () => ({ code: 0 }), write: line => lines.push(line) });
      assert.equal(isolated.code, 0); assert.match(lines.join(''), new RegExp(diagnostic));
    }
  });
  test('a test failure keeps its actual failure independent of census snapshot failures', async () => {
    const output = [];
    const result = await runCensus({ files: ['failing.test.mjs'], snapshot: async () => ({ diagnostic: 'runtime_snapshot_failed' }), run: async () => ({ code: 7 }), write: line => output.push(JSON.parse(line)) });
    assert.equal(result.code, 7); assert.equal(output[0].rc, 7);
    const thrown = await runCensus({ files: ['failed-snapshot.test.mjs'], snapshot: async () => { throw Error('/private/path'); }, run: async () => ({ code: 0 }), write: line => assert.doesNotMatch(line, /private|path/) });
    assert.equal(thrown.code, 0);
  });
  test('supervised children: an intentional leaker exits zero but census is red and names it; clean passes; test failure stays failed', async t => {
    const workspace = createTestWorkspace(t, { prefix: 'runtime-census-' }), directory = join(workspace.path, 'runtime');
    mkdirSync(directory); const f = fixtures(workspace, directory), output = [];
    const result = await runCensus({ files: [f.clean, f.failure, f.leaker], snapshot: () => runtimeSnapshot(directory), write: line => output.push(JSON.parse(line)) });
    assert.equal(result.code, 1);
    assert.deepEqual(output.map(row => [row.file, row.rc]), [['clean.test.mjs', 0], ['failure.test.mjs', 1], ['intentional-leaker.test.mjs', 0]]);
    assert.deepEqual(result.leaks, ['intentional-leaker.test.mjs']);
    assert.equal(output[2].leak, true); assert.ok(output[2].added.includes(f.path.split('/').at(-1)));
    unlinkSync(f.path);
    const aloneOutput = [];
    const alone = await runCensus({ files: [f.leaker], snapshot: () => runtimeSnapshot(directory), write: line => aloneOutput.push(JSON.parse(line)) });
    assert.equal(alone.code, 1);
    assert.deepEqual(alone.leaks, ['intentional-leaker.test.mjs']);
    assert.equal(aloneOutput[0].rc, 0); assert.equal(aloneOutput[0].file, 'intentional-leaker.test.mjs');
    const clean = await runCensus({ files: [f.clean], snapshot: () => runtimeSnapshot(directory), write: () => {} });
    assert.equal(clean.code, 0);
    t.diagnostic('intentional-leaker.test.mjs: child rc=0, census rc=1; clean rc=0; failing child rc=1');
  });
  test('snapshots use names and lstat metadata without reading entries', async t => {
    const workspace = createTestWorkspace(t, { prefix: 'census-snapshot-' });
    const file = join(workspace.path, recognized); writeFileSync(file, 'never read this content');
    const before = await runtimeSnapshot(workspace.path); writeFileSync(file, 'changed content');
    const after = await runtimeSnapshot(workspace.path);
    assert.deepEqual(runtimeDifference(before, after).changed, [recognized]);
    assert.equal(before.entries[0].content, undefined);
    assert.equal((await runtimeSnapshot(join(workspace.path, 'absent'))).diagnostic, 'runtime_folder_missing');
  });
}
