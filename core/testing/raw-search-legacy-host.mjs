import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { sourceFixture, savedSource, ns } from './raw-source-fixtures.mjs';
import { searchFixture } from './raw-search-fixtures.mjs';

// A single host combines the original port and candidate-only authorization.
// Keep the real native service behind it so request-shape regressions are seen.
export async function legacyRawHost(t) {
  const f = sourceFixture(t);
  for (const [index, text] of ['telescope alpha', 'telescope beta', 'telescope gamma'].entries())
    await savedSource(f, text, { sessionId: 'synthetic-legacy-' + index });
  const events = [];
  const s = await searchFixture(f, { setupHost(host) {
    const authorize = host.authority.authorize;
    host.authority.authorize = (request, credential) => {
      events.push({ authorize: request, credential });
      if (request.method === 'rawSearchSource' && !request.input.candidate) return null;
      return authorize(request, credential);
    };
  } });
  await s.maintain({ maxItems: 128, maxMs: 5000 });
  for (let attempt = 0; ; attempt++) {
    const result = await s.search({ query: 'telescope' });
    if (result.coverage.status === 'complete' && result.candidates.length === 3) break;
    assert.ok(attempt < 32, 'synthetic legacy index becomes complete');
    await s.tick({ maxItems: 128, maxMs: 5000 });
  }
  let issued;
  const port = {
    async search(...args) {
      events.push({ port: 'search', args });
      const result = await s.service.search(...args); issued = result.candidates;
      return result;
    },
    prepare(...args) { events.push({ port: 'prepare', args }); return s.service.prepare(...args); },
    revalidate(...args) { events.push({ port: 'revalidate', args }); return s.service.revalidate(...args); },
  };
  const identity = f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
  // Derived from 6508d148: context-read-three-layer.mjs:33-41,
  // raw-search-index.mjs:222 and raw-search-authority.mjs:59,90-95.
  // Build expected bytes from this run's issued candidates and store binding;
  // no IDs, proofs, fields, key order or payload bindings are normalized away.
  const authorization = (method, input) => ({ authorize: {
    method, namespace: ns, actionClass: 'read', actionId: null, targetId: null, expectedRevision: null,
    payloadBinding: createHmac('sha256', identity.cursor_secret)
      .update(JSON.stringify(['raw-search-request-v1', identity.store_id, [method, input]])).digest('base64url'), input,
  }, credential: s.host.token });
  const expected = () => {
    const input = { query: 'telescope', intent: 'current' };
    return [{ port: 'search', args: [input, s.host.token] }, authorization('rawSearch', input),
      ...issued.flatMap(candidate => [{ port: 'prepare', args: [candidate, { intent: 'current' }, s.host.token] },
        authorization('rawSearchSource', { candidate, intent: 'current' })])];
  };
  events.length = 0;
  return { ...f, s, port, events, expected, get issued() { return issued; },
    input: { query: 'telescope', readSet: [ns] }, token: s.host.token };
}

export function assertLegacyDelivery(f, result) {
  assert.equal(result.coverage, 'included');
  assert.equal(result.items.length, 3, 'configured legacy host delivers every candidate');
  assert.deepEqual(result.items.map(item => item.value.messageId), f.issued.map(candidate => candidate.messageId));
  assert.equal(JSON.stringify(f.events), JSON.stringify(f.expected()), 'exact base port/authorization trace bytes');
}
