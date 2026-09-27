import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from '../qualified-source-pair-launch-cli.mjs';

test('L1 CLI rejects malformed flags before input or credential access', async () => {
  let out = '', err = '', reads = 0;
  const status = await main(['--launch', '--dry-run', '--plan', '/does-not-matter'], {
    stdout: { write(value) { out += value; } }, stderr: { write(value) { err += value; } },
    readKey() { reads++; throw new Error('must not read'); },
  });
  assert.equal(status, 1);
  assert.equal(out, '');
  assert.equal(err, 'invalid_arguments\n');
  assert.equal(reads, 0);
});
