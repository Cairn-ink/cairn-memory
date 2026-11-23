import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelRequest } from '../src/capture/wire.mjs';

const fixture = new URL('./fixtures/capture/engine-wire-goldens.json', import.meta.url);
const { cases, adapterOnlyCases } = JSON.parse(readFileSync(fixture, 'utf8'));
const requests = [...cases, ...adapterOnlyCases].filter(golden => golden.body);
assert.ok(requests.length > 0);

for (const { method, name, request, qualificationInputMode, body } of requests) {
  test('request schema name / ' + method + ' / ' + name, () => {
    const built = buildModelRequest(method, request, { qualificationInputMode });
    assert.equal(built.request.schemaName, body.text.format.name);
  });
}
