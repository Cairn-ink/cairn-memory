import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('TC5 fresh fixture remains bound to the pre-authorship guidance and bounded source-only histories', () => {
  const fixture = JSON.parse(readFileSync(new URL('../rationale-temporal-fixture.json', import.meta.url), 'utf8'));
  const guidance = readFileSync(new URL('../prompts/rationale-temporal-guidance.md', import.meta.url));
  assert.equal(fixture.version, 1);
  assert.equal(fixture.id, 'rationale-temporal-fresh-v1');
  assert.equal(createHash('sha256').update(guidance).digest('hex'),
    fixture.candidateGuidanceSha256BeforeAuthorship);
  assert.equal(fixture.cases.length, 6);
  assert.equal(new Set(fixture.cases.map(item => item.id)).size, 6);
  for (const item of fixture.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['events', 'id']);
    assert.ok(item.events.length >= 1 && item.events.length <= 6);
    assert.equal(new Set(item.events.map(event => event.id)).size, item.events.length);
    for (const event of item.events) {
      assert.deepEqual(Object.keys(event).sort(), ['id', 'role', 'text']);
      assert.equal(event.role, 'user');
      assert.ok(typeof event.id === 'string' && event.id.length > 0);
      assert.ok(typeof event.text === 'string' && event.text.length > 0 && event.text.length <= 600);
    }
  }
});
