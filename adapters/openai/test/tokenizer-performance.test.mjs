import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('A01 regression: maximum-length whitespace cannot monopolize synchronous counting', () => {
  // A process timeout can interrupt a blocked synchronous tokenizer; an in-process
  // setTimeout cannot. Synthetic text only, no provider or credentials.
  const adapter = new URL('../index.mjs', import.meta.url).href;
  const script = `import { createOpenAIModel } from ${JSON.stringify(adapter)};
    const model = createOpenAIModel({apiKey:'synthetic',fetchImpl:()=>{throw Error('Network forbidden')}});
    const result = model.countTokens(' '.repeat(40000));
    if (!Number.isSafeInteger(result) || result < 1) process.exit(2);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
  });
  assert.equal(child.error, undefined, 'Tokenizer exceeded the 5-second process guard');
  assert.equal(child.status, 0, child.stderr);
});
