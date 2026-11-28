import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareWire, golden, legacyResponse } from './fixtures/local-host-wire-replay.mjs';

const source = '26992ac1d7eeb2942c8a3d3f43e4a9cb2270d798';
const fixturePath = 'packaging/test/fixtures/installed-local-0.6.11-wire.json';

test('the legacy tools/list matches the pinned source bytes', () => {
  const previous = execFileSync('git', ['show', `${source}:${fixturePath}`], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8',
  });
  const replay = readFileSync(new URL('../../' + fixturePath, import.meta.url), 'utf8');
  const [, sourceList] = /^  "toolsList": (\[\n[\s\S]*?^  \]),$/mu.exec(previous);
  const [, legacyList] = /^  "legacyToolsList": (\[\n[\s\S]*?^  \]),$/mu.exec(replay);
  assert.ok(Buffer.from(legacyList).equals(Buffer.from(sourceList)), 'legacy tools/list bytes changed');
  assert.deepEqual(legacyResponse('tools/list').result.tools, JSON.parse(sourceList));
});

test('tools/list comparison selects the expected list for each installer', async () => {
  async function differences(tools, options) {
    const comparison = await compareWire(async method => {
      if (method === 'tools/list') return { result: { tools } };
      throw new Error('tools/list selector probe');
    }, () => {}, undefined, options);
    return comparison.differences.filter(difference => difference.startsWith('tools/list '));
  }
  assert.deepEqual(await differences(golden.legacyToolsList, { legacy: true }), []);
  assert.deepEqual(await differences(golden.toolsList), []);
  assert.ok((await differences(golden.legacyToolsList)).length > 0);
  assert.ok((await differences(golden.toolsList, { legacy: true })).length > 0);
});
