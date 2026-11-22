import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openContextReader } from '../../core/index.mjs';
import { assemblyFixture, controlledClock, ns, ok } from '../../core/testing/context-read-assembly-fixture.mjs';
import { refresh } from '../../core/testing/context-read-core-fixture.mjs';

const baseline = process.argv[2];
if (!baseline) throw new Error('Pass a baseline source directory.');
const prior = await import(pathToFileURL(resolve(baseline, 'core/index.mjs')));
const cleanup = [];
const scope = { after(fn) { cleanup.push(fn); } };
try {
  controlledClock(scope);
  const fixture = assemblyFixture(scope);
  fixture.seed();
  ok(await fixture.trusted.call(fixture.context, 'refreshContextIndex', refresh()));
  const config = { path: fixture.path, contextRead: fixture.config };
  const before = prior.openContextReader(config), after = openContextReader(config);
  cleanup.push(() => before.close(), () => after.close());
  for (const query of ['assembly', 'total assembly', 'next steps']) {
    const input = { query, raw: false, readSet: [ns], types: ['memory'], intent: 'current',
      representation: 'memory-compact-v1', deadlineMs: 5000 };
    const run = reader => fixture.trusted.call(reader, 'contextRead', input);
    const expected = await run(before), actual = await run(after);
    ok(expected); ok(actual);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  }
  console.log('Compared 3 complete compact read envelopes.');
} finally {
  for (const dispose of cleanup.reverse()) await dispose();
}
