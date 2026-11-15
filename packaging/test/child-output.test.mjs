import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { collectChildOutput } from './fixtures/child-output.mjs';

async function splitOutput(t, bytes, offset, stream) {
  // The parent acknowledges the first pipe read before allowing the next write.
  // The delay also keeps the child's writes separate on real pipes.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const bytes = Buffer.from(${JSON.stringify([...bytes])});
    process.once('message', () => setTimeout(() => {
      process.${stream}.write(bytes.subarray(${offset}), () => process.disconnect());
    }, 10));
    process.${stream}.write(bytes.subarray(0, ${offset}));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const done = collectChildOutput(child);
  let first = true;
  const lengths = [];
  child[stream].on('data', chunk => {
    lengths.push(chunk.length);
    if (first) { first = false; child.send('continue'); }
  });
  return { result: await done, lengths };
}

for (const text of ['\u0301', '中', '繁', '🙂', '𠮷']) {
  for (let offset = 1; offset < Buffer.byteLength(text); offset++) {
    for (const stream of ['stdout', 'stderr']) test(`${stream} decodes ${text} split at byte ${offset}`, async t => {
      const { result, lengths } = await splitOutput(t, Buffer.from(text), offset, stream);
      assert.equal(result.code, 0); assert.equal(result.signal, null);
      assert.deepEqual(lengths, [offset, Buffer.byteLength(text) - offset]);
      assert.equal(result[stream], text);
      assert.equal(result[stream === 'stdout' ? 'stderr' : 'stdout'], '');
    });
  }
}
for (const stream of ['stdout', 'stderr']) test(`${stream} refuses malformed UTF-8 at close`, async t => {
  await assert.rejects(splitOutput(t, Buffer.from([0xcc, 0xff]), 1, stream), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
});
for (const [stream, limit] of [['stdout', 262144], ['stderr', 65536]]) test(`${stream} keeps its byte limit and terminates the child`, async t => {
  const child = spawn(process.execPath, ['-e', `process.${stream}.write('中'.repeat(${Math.floor(limit/3)+1}));setInterval(()=>{},1000);`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const result = await collectChildOutput(child);
  assert.equal(result.signal, 'SIGTERM'); assert.equal(result.code, null);
  assert.ok(Buffer.byteLength(result[stream]) > limit);
});
