import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = process.argv[2];
if (!baseline) throw new Error('Pass a baseline source directory.');

const scratch = [], scope = { after(fn) { scratch.push(fn); } };
const dispose = async () => { for (const fn of scratch.reverse()) await fn(); };
const originalUuid = crypto.randomUUID;
let serial = 0;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++serial).padStart(12, '0');
syncBuiltinESMExports();
try {
  const prior = await import(pathToFileURL(resolve(baseline, 'core/index.mjs')));
  const current = await import('../../core/index.mjs');
  const { assemblyFixture, controlledClock, ns, ok } = await import('../../core/testing/context-read-assembly-fixture.mjs');
  const { refresh } = await import('../../core/testing/context-read-core-fixture.mjs');
  const { createTestWorkspace } = await import('./workspace.mjs');
  const { splitRaw, request } = await import('../../core/testing/raw-capture-fixtures.mjs');
  controlledClock(scope);
  const workspace = createTestWorkspace(scope);
  const source = request(splitRaw('A lamp needs a new bulb.')[0]);
  const messages = source.messages.map(({ id, role, content, occurredAt }) => ({ id, role, content, occurredAt }));
  const batches = [{ ...source, messages }, { ...source, eventId: 'plain', messages: [
    { id: 'note', role: 'user', content: 'Prefer concise examples.' },
    { id: 'details', role: 'assistant', content: '  1. Set the timer.\n  2. Check the dial.\n' + 'Inspect both valves. '.repeat(12) },
  ] }];
  async function capture(mod, path) {
    serial = 0;
    const calls = [], run = (name, output) => ({ system, input, maxOutputTokens }) => {
      calls.push({ name, system, input, maxOutputTokens });
      return output(input);
    };
    const core = mod.openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
      extract: run('extract', input => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: .9, sourceIndices: [0] }] })),
      classify: run('classify', input => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
        parentIds: [], newL1: { title: 'Notes', parentL2Ids: [] } })) })),
    } });
    try {
      assert.equal(core.forgetCard, undefined);
      const captures = [];
      for (const input of [...batches, batches[0]]) {
        const result = await core.capture(input);
        ok(result);
        captures.push(result);
      }
      return JSON.stringify({ calls, captures });
    } finally { await core.close(); }
  }
  const DateClass = globalThis.Date;
  const instant = DateClass.now();
  globalThis.Date = class extends DateClass {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  try {
    assert.equal(await capture(current, workspace.path + '/current.sqlite'), await capture(prior, workspace.path + '/prior.sqlite'));
  } finally { globalThis.Date = DateClass; }

  const fixture = assemblyFixture(scope);
  fixture.seed();
  ok(await fixture.trusted.call(fixture.context, 'refreshContextIndex', refresh()));
  const config = { path: fixture.path, contextRead: fixture.config };
  const before = prior.openContextReader(config), after = current.openContextReader(config);
  scratch.push(() => before.close(), () => after.close());
  for (const query of ['assembly', 'total assembly', 'next steps']) {
    const input = { query, raw: false, readSet: [ns], types: ['memory'], intent: 'current',
      representation: 'memory-compact-v1', deadlineMs: 5000 };
    const run = async reader => {
      const result = await fixture.trusted.call(reader, 'contextRead', input);
      ok(result);
      return JSON.stringify(result);
    };
    assert.equal(await run(after), await run(before));
  }
  console.log('Compared capture requests, three capture outcomes, and three compact read envelopes.');
} finally {
  crypto.randomUUID = originalUuid;
  syncBuiltinESMExports();
  await dispose();
}
