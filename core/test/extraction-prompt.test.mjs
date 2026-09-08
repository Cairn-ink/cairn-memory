import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Prompt delivery and scripted storage contracts, not model entailment grading.
const namespace = { ownerId: 'synthetic-extraction-policy', scope: 'personal', projectId: null };
const statements = [
  'The workshop uses a drawing application.',
  'I may use a tablet for sketches.',
  'The coordinator says the workshop proposed a shorter session but has not adopted it.',
];
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t) {
  let delivered;
  const core = openMemoryCore({
    path: join(mkdtempSync(join(tmpdir(), 'cairn-extraction-policy-')), 'memory.sqlite'),
    model: { contextWindow: 8192, countTokens: () => 1,
      extract: (request) => {
        delivered = request;
        return { items: statements.map((content, index) => ({ content, kind: 'context',
          confidence: 0.7, sourceIndices: [index] })) };
      },
      classify: ({ input }) => ({ items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) }),
    },
  });
  t.after(() => core.close());
  return { core, delivered: () => delivered };
}
const captureInput = () => ({ namespace, client: 'synthetic', sessionId: 'policy-session',
  eventId: 'policy-event', messages: statements.map((content, index) => ({
    id: `source-${index}`, role: 'user', content,
  })) });

test('extraction port receives source-faithful relationship and qualification policy', async (t) => {
  const { core, delivered } = fixture(t);
  ok(await core.capture(captureInput()));
  const { system, input } = delivered();
  assert.deepEqual(input.messages.map(({ content }) => content), statements);
  assert.match(system, /preserve[^\n]*relationship/i);
  assert.match(system, /negation, modality, attribution, and uncertainty/i);
  assert.match(system, /usage does not establish implementation/i);
  assert.match(system, /proposal does not establish adoption/i);
  assert.match(system, /adoption does not establish completed deployment/i);
  assert.match(system, /do not invent entity types, roles, or exclusivity/i);
  assert.match(system, /high confidence does not justify unsupported additions/i);
  assert.match(system, /entailed paraphrases are allowed/i);
  assert.match(system, /empty items array is valid/i);
  assert.match(system, /selecting an index is not proof of entailment/i);
});

test('scripted faithful capture preserves content and trusted source receipts through storage', async (t) => {
  const { core } = fixture(t);
  const result = ok(await core.capture(captureInput()));
  assert.equal(result.admission.memories.length, statements.length);
  for (const admitted of result.admission.memories) {
    const detail = ok(core.get({ namespace, memoryId: admitted.id }));
    const index = statements.indexOf(detail.memory.content);
    assert.notEqual(index, -1);
    assert.equal(detail.memory.content, statements[index]);
    assert.deepEqual(detail.receipts.map(({ client, sessionId, eventId, role, excerpt }) =>
      ({ client, sessionId, eventId, role, excerpt })), [{ client: 'synthetic',
      sessionId: 'policy-session', eventId: `source-${index}`, role: 'user', excerpt: statements[index] }]);
  }
});
