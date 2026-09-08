import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { childEnvironment, parseArguments, runWalkthrough } from '../walkthrough.mjs';

const server = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const walkthrough = fileURLToPath(new URL('../walkthrough.mjs', import.meta.url));
const marker = 'SYNTHETIC-SECRET-NOT-FOR-OUTPUT';

test('walkthrough uses actual stdio lifecycle with model disabled despite inherited key', { timeout: 30000 }, async () => {
  const result = await runWalkthrough({ executable: server }, { OPENAI_API_KEY: marker });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.stages.map(s => s.stage), ['five_tools', 'remember_and_inspect',
    'restart_and_inspect', 'correct_and_reject_stale', 'model_disabled', 'forget_and_empty_inspect']);
  assert.ok(result.stages.every(s => s.status === 'passed'));
  assert.match(result.database, /cairn-walkthrough-.*memory.sqlite$/);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes('Synthetic Harbor'), false);
});

test('arguments reject absent, relative, missing, directory, duplicate and unknown input', async () => {
  for (const args of [[], ['--executable'], ['--executable', 'relative'],
    ['--executable', '/nonexistent-cairn-walkthrough'], ['--executable', '/tmp'],
    ['--executable', server, '--executable', server], ['--executable', server, '--unknown'],
    ['--executable', server, '--with-recall', '--with-recall']]) {
    await assert.rejects(parseArguments(args));
  }
  assert.deepEqual(await parseArguments(['--executable', server]), { executable: server, withRecall: false });
});

test('only explicit recall can forward the model key and no other environment', () => {
  const env = { OPENAI_API_KEY: marker, NODE_OPTIONS: 'do-not-forward', OTHER_SECRET: marker };
  assert.deepEqual(childEnvironment(false, env), { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' });
  assert.deepEqual(childEnvironment(true, env), { OPENAI_API_KEY: marker, NODE_NO_WARNINGS: '1' });
  assert.throws(() => childEnvironment(true, {}));
});

test('invalid CLI input fails without reflecting arguments or inherited credentials', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [walkthrough, '--unknown', marker],
    { env: { OPENAI_API_KEY: marker }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1);
  assert.match(output, /cairn_walkthrough_failed/);
  assert.equal(output.includes(marker), false);
});
