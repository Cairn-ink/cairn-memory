import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decisionContext, relatePlaced } from '../src/index.mjs';
import { buildRelateRequest, relate } from '../src/rationale/relate.mjs';
import { modelReturning, rationaleFixture, readyGate, scope } from './fixtures/rationale/store.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/rationale/engine-goldens.json', import.meta.url), 'utf8'));
const byJson = (a, b) => Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b)));

for (const entry of golden.P1) {
  test('P1 / ' + entry.name, async () => {
    const diagnostics = [];
    const run = relate({
      owner: scope.owner, sources: entry.sources, model: modelReturning(entry.output), gate: readyGate,
      async validateFresh() {}, onDiagnostic: event => diagnostics.push(event),
    });
    if (entry.error) {
      await assert.rejects(run, { code: entry.error });
      assert.deepEqual(diagnostics, [
        { version: 1, stage: 'relate', layer: 'core_validation', reason: 'invalid_rationale' },
        { version: 1, stage: 'relate', layer: 'core_call', reason: 'adapter_output_invalid' },
      ]);
    } else {
      assert.deepEqual(await run, entry.value);
      assert.deepEqual(diagnostics, []);
    }
  });
}

test('P2 / engine wire, strict schema, prompt bytes and framing', () => {
  const { sources, ...expected } = golden.P2;
  const { stage, request } = buildRelateRequest(sources);
  assert.equal(stage, 'rationale');
  assert.equal(JSON.stringify(request.input), JSON.stringify(expected.input));
  assert.equal(JSON.stringify(request.schema), JSON.stringify(expected.schema));
  assert.deepEqual(Buffer.from(request.system), Buffer.from(expected.system));
  assert.equal(request.maxOutputTokens, expected.maxOutputTokens);
  assert.equal(request.schemaName, expected.schemaName);
});

for (const entry of golden.P3) {
  test('P3 / ' + entry.name, async t => {
    const fixture = rationaleFixture(entry.seeds);
    for (const [index, step] of entry.steps.entries()) {
      await t.test(index + ' / ' + step.action, async st => {
        if (step.action === 'review') {
          const result = await relatePlaced({ ...fixture, refs: step.refs.map(i => fixture.guard(entry.seeds[i].id)),
            model: modelReturning(step.output) });
          if (step.expected.error) {
            assert.equal(result.status, 'failed');
            assert.equal(result.error.code, step.expected.error);
          } else {
            assert.equal(result.status, 'reviewed');
            assert.deepEqual({ proposed: result.proposed, inserted: result.inserted }, step.expected);
          }
        } else if (step.action === 'mutate') {
          fixture.mutate(entry.seeds[step.target].id, step.mutation);
          assert.equal(fixture.state.edges.size, step.stored);
        } else if (step.action === 'reopen') {
          st.skip('SQLite persistence and cold reopening are engine host behavior. The core read below runs without a model.');
        } else {
          const memoryId = entry.seeds[step.root].id;
          const selected = step.scope === 'foreign' ? { ...scope, owner: 'foreign-fixture-owner' } : scope;
          const options = { ...fixture, scope: selected, memoryId, revision: step.revision ?? 1 };
          if (step.expected.error && step.view === 'incident-proposals') {
            if (step.expected.error === 'rationale_limit') {
              st.skip('Core has no incident inspection facade. The limit is replayed through decision context in DC2.');
            } else {
              await assert.rejects(decisionContext(options), { code: step.expected.error });
            }
          } else if (step.expected.error === 'invalid_input' && Object.hasOwn(step, 'view')) {
            st.skip('Core decisionContext has a fixed view.');
          } else if (step.view === 'incident-proposals') {
            // Replay the stored rows through the incident port, which has no graph/metadata facade.
            const rows = await fixture.uow.run(scope.owner, { readOnly: true }, tx =>
              fixture.store.incident(tx, scope, memoryId, { limit: 11 }));
            assert.deepEqual(rows.map(({ from, to, relation }) => ({
              relation, from: from.id, to: to.id, fromReceipt: from.receiptId, toReceipt: to.receiptId,
            })).sort(byJson), step.expected.edges.map(({ interpretationStatus: _status, ...edge }) => edge).sort(byJson));
          } else if (step.expected.error) {
            await assert.rejects(decisionContext(options), { code: step.expected.error });
          } else {
            const result = await decisionContext(options);
            assert.deepEqual({ ...result, refs: result.refs.sort(byJson) }, {
              status: step.expected.status,
              refs: step.expected.edges.map(({ from, relation }) => ({
                id: from, revision: step.expected.sources.find(({ memory }) => memory.id === from).memory.revision,
                relation, direction: 'incoming',
              })).sort(byJson),
            });
          }
        }
      });
    }
    assert.equal(fixture.state.edges.size, entry.stored);
  });
}
