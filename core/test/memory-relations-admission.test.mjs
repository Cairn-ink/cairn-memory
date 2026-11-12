import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryThreadFixture, threadNamespace as namespace, unwrap } from '../testing/memory-thread-fixture.mjs';

const forgotten = 'My breakfast is private oats.';
for (const causal of [false, true]) for (const position of [null, 0, 1, 2]) {
  test(`forgotten extracted facts never reach relation requests; causal=${causal}, position=${position}`, async t => {
    const requests = [], counted = [];
    const f = memoryThreadFixture(t, { model: {
      countTokens: text => { if (text.startsWith('{"system":')) counted.push(JSON.parse(text)); return 1; },
      relateMemories: ({ input }) => {
        requests.push(structuredClone(input));
        return { facts: input.facts.map(fact => ({ factIndex: fact.factIndex, edges: [{
          candidateId: input.candidates[fact.factIndex][0].id, relation: 'refines', confidence: 1,
          reason: 'Synthetic property refinement.' }] })) };
      },
    } });
    const x = (await f.capture(forgotten)).admission.memories[0];
    await f.capture('My breakfast is eggs.');
    await f.capture('My favorite color is green.');
    const current = unwrap(f.core.get({ namespace, memoryId: x.id })).memory;
    unwrap(f.core.forget({ namespace, memoryId: x.id, expectedRevision: current.revision }));
    requests.length = 0; counted.length = 0;
    const facts = position === null ? [forgotten] : ['My breakfast is toast.', 'My favorite color is blue.'];
    if (position !== null) facts.splice(position, 0, forgotten);
    f.model.extract = () => ({ items: facts.map(content => ({ content, kind: 'fact', confidence: 1, sourceIndices: [0] })) });
    const result = await f.capture('Synthetic fresh independent evidence.', causal ? { causal: { streamId: 'synthetic', sequence: 1 } } : {});
    assert.equal(requests.filter(request => JSON.stringify(request).includes(forgotten)).length, 0,
      'forgotten text is refused before relation dispatch');
    assert.equal(counted.filter(request => JSON.stringify(request.input?.facts ?? []).includes(forgotten)).length, 0,
      'forgotten facts are refused before relation token counting');
    assert.equal(result.admission.suppressedCount, 1);
    if (position === null) {
      assert.equal(requests.length, 0);
      assert.equal(result.admission.memories.length, 0);
    } else {
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].facts.map(fact => fact.content), facts.filter(content => content !== forgotten));
      const rows = f.db.prepare(`SELECT a.content AS fact,b.content AS candidate FROM memory_relations r
        JOIN memories a ON a.id=r.from_memory_id JOIN memories b ON b.id=r.to_memory_id
        WHERE a.id IN (${result.admission.memories.map(() => '?').join(',')}) ORDER BY a.content`)
        .all(...result.admission.memories.map(memory => memory.id));
      assert.deepEqual(rows.map(row => ({ ...row })), [
        { fact: 'My breakfast is toast.', candidate: 'My breakfast is eggs.' },
        { fact: 'My favorite color is blue.', candidate: 'My favorite color is green.' },
      ], 'compact relation indices bind back to the original admission facts');
    }
  });
}
