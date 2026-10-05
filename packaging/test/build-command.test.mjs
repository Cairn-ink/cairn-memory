import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, commandInvocation } from '../build.mjs';

test('Windows npm CLI invocation preserves literal paths and arguments without a shell', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-npm-invocation-' });
  const cli = join(workspace.path, 'npm path & spaces', 'npm-cli.js');
  mkdirSync(dirname(cli));
  writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const args = ['install', '--prefix', join(workspace.path, 'target & literal %NAME%'), 'quoted"value'];
  const invocation = commandInvocation('npm', args, { platform: 'win32', npmExecPath: cli });
  const result = spawnSync(invocation.executable, invocation.args, { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test('Windows direct invocation finds bundled npm, rejects wrappers and missing CLI', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bundled-npm-' });
  const execPath = join(workspace.path, 'node.exe');
  const cli = join(workspace.path, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, '// synthetic npm entry point');
  assert.deepEqual(commandInvocation('npm', ['pack'], {
    platform: 'win32', execPath, npmExecPath: join(workspace.path, 'npm.cmd'),
  }), { executable: execPath, args: [cli, 'pack'] });
  assert.throws(() => commandInvocation('npm', [], { platform: 'win32',
    execPath: join(workspace.path, 'absent', 'node.exe'), npmExecPath: 'relative/npm-cli.js',
  }), /artifact_npm_cli_not_found/);
});

test('non-Windows npm and non-npm commands retain their invocation', () => {
  assert.deepEqual(commandInvocation('npm', ['pack'], { platform: 'linux' }), { executable: 'npm', args: ['pack'] });
  assert.deepEqual(commandInvocation('tar', ['-tzf'], { platform: 'win32' }), { executable: 'tar', args: ['-tzf'] });
});

test('archive inspection accepts CRLF but still rejects an unexpected archive member', async () => {
  const artifacts = [];
  try {
    for (const unexpected of [false, true]) {
      const build = () => buildArtifact({ runCommand(executable, args, cwd, userconfig) {
        if (executable === 'npm') artifacts.push(args[args.indexOf('--pack-destination') + 1]);
        const output = command(executable, args, cwd, userconfig);
        if (executable !== 'tar') return output;
        return output.trim().split(/\r?\n/).concat(unexpected ? ['package/unexpected.mjs'] : []).join('\r\n') + '\r\n';
      } });
      if (unexpected) assert.throws(build, /unexpected_archive_contents/);
      else assert.ok(build().files.includes('bin/cairn-memory.mjs'));
    }
  } finally {
    for (const path of artifacts) await rm(path, { recursive: true });
  }
});
