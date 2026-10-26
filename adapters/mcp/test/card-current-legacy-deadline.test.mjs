import test from 'node:test';
import assert from 'node:assert/strict';
import { contextToolResponse } from '../context-read-transport.mjs';
import { frozenSource, loadSource, legacyDeadlineControl } from '../../../core/testing/card-current-deadline-fixture.mjs';
const legacyTransport = await loadSource(frozenSource('transport'), new URL('../context-read-transport.mjs', import.meta.url),
  source => source, specifier => import.meta.resolve(specifier));
for (const schema33 of [false, true]) for (const stage of ['before-preparation', 'between-candidates'])
  test(`C26 entire frozen no-declaration MCP envelope survives ${stage}; schema ${schema33 ? 33 : 32}`, async t => {
    const [legacy, current] = await legacyDeadlineControl(t, { stage, schema33 });
    const before = legacyTransport.contextToolResponse(legacy.envelope, { assembly: true });
    const after = contextToolResponse(current.envelope, { assembly: true });
    assert.equal(JSON.stringify(after), JSON.stringify(before), 'full MCP envelope, including all diagnostics and snapshot metadata');
    assert.equal(after.isError, false);
    assert.equal(after._meta['ink.cairn/context-read-diagnostics'].omitted.unavailable, 0);
  });
