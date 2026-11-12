import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, realisticCardOutput, ns, ok } from '../../core/testing/engine-card-fixture.mjs';
import { validateConsolidation } from '../../core/engine-card-output.mjs';
import { cardSourceKeys } from '../../core/context-read-assembly.mjs';

// Offline synthetic model output uses whole sentences and UUID citations with
// the engine tokenizer, validator and packer. No provider access is needed.
const fixtures = [];
try {
  const measurements = [];
  for (const count of [7, 9, 12]) {
    const model = scriptedConsolidator(({ input }) => realisticCardOutput(input.memories));
    const f = engineCardFixture(null, { model }); fixtures.push(f); f.seed(count);
    const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
    const card = pass.built[0], memories = model.calls[0].memories;
    const fitted = validateConsolidation(realisticCardOutput(memories), memories, model);
    const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(card.id).body;
    assert.equal(body, fitted.body);
    const replaced = cardSourceKeys([{ type: 'card', metadata: { origin: 'engine' }, text: body,
      sourceMemoryRefs: memories.map(memory => ({ namespace: ns, memoryId: memory.id, revision: memory.revision })) }]).size;
    ok(await f.refresh());
    const read = ok(await f.read('what is the current state of Orion'));
    assert.ok(read.metered.items.some(item => item.ref.type === 'card'));
    measurements.push({ memories: count, bodyTokens: model.countTokens(body), memoriesReplaced: replaced,
      currentSentences: fitted.currentState.length, timelineEntries: fitted.timeline.length,
      contradictions: fitted.contradictions.length, packItems: read.metered.items.length, packTokens: read.diagnostics.budget.used });
  }
  console.log(JSON.stringify({ tokenizer: 'o200k_base', measurements }, null, 2));
} finally {
  for (const f of fixtures.reverse()) await f.workspace.cleanup();
}
