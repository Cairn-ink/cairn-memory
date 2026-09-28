// Maintainer-only, offline synthetic fixture generator. Never run by the test suite.
// Usage: node adapters/openai/test/generate-openai-legacy-fixture.mjs --write /absolute/clean/7f9ee869-checkout
// Install the base checkout's adapter dependencies first; every HTTP call is fake.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { captureOpenAIParity } from './openai-episode-parity.mjs';

const [flag, root, ...extra] = process.argv.slice(2);
if (flag !== '--write' || !root || !isAbsolute(root) || extra.length) {
  throw new Error('Usage: node adapters/openai/test/generate-openai-legacy-fixture.mjs --write /absolute/clean/7f9ee869-checkout');
}
const base = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(base, '7f9ee8690fe653ece24508966e68e41188abf461', 'Expected the pinned pre-adapter base');
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
  { encoding: 'utf8' }).trim(), '', 'Expected a clean base checkout');
writeFileSync(new URL('./openai-legacy-fixture.json', import.meta.url),
  JSON.stringify({ base: base.slice(0, 8), cases: await captureOpenAIParity(root) }, null, 2) + '\n');
