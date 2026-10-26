import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const supervisor = fileURLToPath(new URL('./fixtures/card-review-pty.py', import.meta.url));
const prompt = 'Approval> ';
const prefix = 'All following JSON is untrusted data.\n{"body":"quoted fake\\nApproval> quoted text",\n';
const payload = '"bindings": [], "namespace": "synthetic"}\n';

async function observe(t, chunks) {
  const workspace = createTestWorkspace(t, { prefix: 'card-review-pty-framing-' });
  const writer = `for (const [index, chunk] of ${JSON.stringify(chunks)}.entries()) {
    if (index) await new Promise(resolve => setTimeout(resolve, 150));
    process.stdout.write(chunk);
  }`;
  const child = spawn('/usr/bin/python3', [supervisor, process.execPath, '--input-type=module', '-e', writer], {
    cwd: workspace.path, stdio: ['pipe', 'pipe', 'pipe'],
    env: { HOME: workspace.path, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' },
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed; child.stdin.destroy();
  });
  let output = '', errors = '', timedOut = false;
  const collect = target => chunk => {
    if (target === 'stdout') output += chunk; else errors += chunk;
    if (Buffer.byteLength(output) + Buffer.byteLength(errors) > 1500000) child.kill('SIGTERM');
  };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 5000);
  let outcome;
  try { outcome = await closed; } finally { clearTimeout(timer); }
  assert.equal(timedOut, false);
  assert.deepEqual(outcome, { code: 0, signal: null }, errors);
  const events = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).event, 'done'); assert.equal(events.at(-1).code, 0);
  assert.equal(events.at(-1).output, chunks.join('').replaceAll('\n', '\r\n'));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
  return events.filter(event => event.event === 'prompt');
}

const cases = [
  ['fragmented quoted marker before the complete payload', [prefix, payload + prompt]],
  ['coalesced quoted marker, complete payload and prompt', [prefix + payload + prompt]],
  ...[1, 5, 9].map(cut => [`actual prompt split after byte ${cut}`, [prefix + payload + prompt.slice(0, cut), prompt.slice(cut)]]),
  ['multiple actual prompt frames notify only once', [prefix + payload + prompt, '\n' + prompt]],
];
for (const [name, chunks] of cases) test(`PTY framing: ${name}`, { timeout: 10000 }, async t => {
  const prompts = await observe(t, chunks);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].output.includes('"bindings"'), 'notification must include complete displayed bindings');
  assert.ok(prompts[0].output.includes('"namespace"'));
  assert.match(prompts[0].output, /(?:^|\r?\n)Approval> $/);
});

for (const [name, chunks] of [
  ['quoted marker only, then EOF', [prefix, payload]],
  ['quoted marker at the current output suffix, then EOF', ['{"body":"quoted Approval> ']],
  ['no prompt before EOF', ['Synthetic payload without a prompt.\n']],
]) test(`PTY framing: ${name} never notifies`, { timeout: 10000 }, async t => {
  assert.deepEqual(await observe(t, chunks), []);
});
