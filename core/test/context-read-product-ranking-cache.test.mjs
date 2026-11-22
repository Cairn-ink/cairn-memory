import assert from 'node:assert/strict';
import test from 'node:test';
import { openProductIndex } from '../context-product-index.mjs';
import { bare, ok, snapshot, subsetFixture, vector } from '../testing/context-product-subset-fixture.mjs';

for (const semantic of [false, true]) {
  test(`product ${semantic ? 'hybrid' : 'lexical'} ranking is retained only after final evidence succeeds`, async t => {
    const f = subsetFixture(t, { semantic });
    let refuse = true, refusedCursor, refusals = 0;
    const port = f.facade.port;
    const facade = { ...f.facade, port: { ...port,
      encode(kind, ...args) {
        const encoded = port.encode(kind, ...args);
        if (refuse && kind === 'cursor') refusedCursor = encoded;
        return encoded;
      },
      evidence: { ...port.evidence, itemsInside(...args) {
        if (refuse && refusedCursor) {
          refusals++;
          throw Object.assign(new Error('final evidence refused'), { code: 'evidence_unavailable' });
        }
        return port.evidence.itemsInside(...args);
      } },
    } };
    const index = openProductIndex({ path: f.f.path, facade, ownerCoverage: f.p.ownerCoverage, maintenance: false,
      authorize: () => ({ accessGenerations: f.access, check() {}, envelope: work => work() }),
      ...(semantic ? {
        operation: () => ({ operationCutoffMonoNs: String(process.hrtime.bigint() + 5_000_000_000n) }),
        semantic: {
          snapshot: async () => snapshot,
          gate: { check() {} },
          configuration: { queryEmbeddingMaxMs: 2000, selection: { requestTimeoutMs: 2000 }, finalizeReserveMs: 1000 },
          call: async () => ({ vectors: [vector()] }),
        },
      } : {}),
    });
    t.after(() => index.close());
    const find = patch => index.run('findCandidates', { ...f.query, semantic, limit: 1, ...patch }, {});

    assert.deepEqual(await find(), bare('evidence_unavailable'));
    assert.equal(refusals, 1);
    assert.ok(refusedCursor, 'final evidence refused after the request created a cursor');
    refuse = false;
    const refusedContinuation = await find({ cursor: refusedCursor });

    const first = ok(await find());
    assert.ok(first.nextCursor);
    assert.notEqual(first.nextCursor, refusedCursor);
    if (semantic) assert.equal(first.trace.effective, 'hybrid');
    const second = ok(await find({ cursor: first.nextCursor }));
    assert.equal(second.items[0].rank, 2);
    assert.notEqual(second.items[0].ref.memoryId, first.items[0].ref.memoryId);
    assert.deepEqual(refusedContinuation, bare('cursor_stale'), 'the refused read left no retained ranking');
  });
}
